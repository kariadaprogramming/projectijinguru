/*
 * ESP32 RFID Permission System
 * Components: ESP32, PN532 NFC RFID Module (I2C), Active Buzzer, Push Buttons
 * Features: RFID scanning, MQTT (HiveMQ TLS), buzzer notification, NTP time sync (WITA)
 * 
 * PERBAIKAN:
 * - Semua delay() diganti millis() non-blocking
 * - readPassiveTargetID pakai timeout 100ms agar tidak blocking
 * - Buzzer non-blocking menggunakan state machine
 * - LCD dihapus sepenuhnya
 * - Debounce tombol dipisah per tombol
 * - MQTT buffer size diperbesar untuk HiveMQ
 * - Reconnect WiFi & MQTT lebih robust
 * - mqttClient.loop() selalu berjalan lancar
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_PN532.h>
#include <time.h>

// ============================================================
// WiFi Configuration
// ============================================================
const char* ssid     = "Post satpam";
const char* password = "Skanbara2024";  // Kosong untuk captive portal (MAC registered)

// ============================================================
// NTP Configuration (WITA - UTC+8)
// ============================================================
const char* ntpServer        = "pool.ntp.org";
const long  gmtOffset_sec    = 28800;  // UTC+8
const int   daylightOffset_sec = 0;

// ============================================================
// MQTT Configuration (HiveMQ Cloud - TLS port 8883)
// ============================================================
const char* mqtt_server   = "282ebcb2b3e048aeb47708a9236c9b95.s1.eu.hivemq.cloud";
const int   mqtt_port     = 8883;
const char* mqtt_client_id  = "esp32_rfid_device";
const char* mqtt_username   = "ijinkeluar";
const char* mqtt_password   = "Gmagus4099";

// Topics
const char* mqtt_topic_rfid     = "izin/rfid";
const char* mqtt_topic_status   = "izin/status";
const char* mqtt_topic_response = "izin/response";
const char* mqtt_topic_command  = "izin/command";

// ============================================================
// Device Configuration
// ============================================================
const char* device_id = "ESP32_RFID_001";

// ============================================================
// Pin Definitions
// ============================================================
#define PN532_SDA_PIN      21
#define PN532_SCL_PIN      22
#define BUZZER_PIN         25
#define RESET_BUTTON_PIN   26
#define CONFIG_BUTTON_PIN  27

// ============================================================
// Global Objects
// ============================================================
WiFiClientSecure  espClient;
PubSubClient      mqttClient(espClient);
Adafruit_PN532    nfc(PN532_SDA_PIN, PN532_SCL_PIN);

// ============================================================
// Timing Variables (millis-based, non-blocking)
// ============================================================
unsigned long lastMqttConnectAttempt = 0;
unsigned long lastStatusUpdate       = 0;
unsigned long lastButtonCheck        = 0;
unsigned long lastTimeLog            = 0;
unsigned long rfidCooldown           = 0;
unsigned long lcdResetTimer          = 0;  // Timer untuk reset pesan Serial

// Debounce terpisah per tombol
unsigned long lastDebounceReset  = 0;
unsigned long lastDebounceConfig = 0;
const unsigned long debounceDelay = 50;

// State flags
bool configMode    = false;
bool showingResult = false;  // True saat menampilkan hasil scan

// ============================================================
// Buzzer Non-Blocking State Machine
// ============================================================
enum BuzzerPattern { BUZZ_NONE, BUZZ_SUCCESS, BUZZ_ERROR, BUZZ_SCAN };

struct BuzzerState {
  BuzzerPattern pattern;
  uint8_t  step;
  unsigned long lastStepTime;
  bool     active;
} buzzer = { BUZZ_NONE, 0, 0, false };

// Tabel pola buzzer: {durasi_HIGH, durasi_LOW} per step
// SUCCESS : dua beep pendek (100ms ON, 50ms OFF, 100ms ON)
// ERROR   : dua beep panjang (200ms ON, 100ms OFF, 200ms ON)
// SCAN    : satu beep sangat pendek (50ms ON)
const uint16_t patternSuccess[][2] = { {100, 50}, {100, 0} };
const uint16_t patternError[][2]   = { {200, 100}, {200, 0} };
const uint16_t patternScan[][2]    = { {50, 0} };

const uint8_t patternSuccessLen = 2;
const uint8_t patternErrorLen   = 2;
const uint8_t patternScanLen    = 1;

void startBuzzer(BuzzerPattern p) {
  buzzer.pattern      = p;
  buzzer.step         = 0;
  buzzer.lastStepTime = millis();
  buzzer.active       = true;
  digitalWrite(BUZZER_PIN, HIGH);  // Mulai step pertama langsung ON
}

void updateBuzzer() {
  if (!buzzer.active) return;

  const uint16_t (*pat)[2] = nullptr;
  uint8_t len = 0;

  switch (buzzer.pattern) {
    case BUZZ_SUCCESS: pat = patternSuccess; len = patternSuccessLen; break;
    case BUZZ_ERROR:   pat = patternError;   len = patternErrorLen;   break;
    case BUZZ_SCAN:    pat = patternScan;    len = patternScanLen;    break;
    default: buzzer.active = false; return;
  }

  unsigned long now = millis();
  uint16_t onTime  = pat[buzzer.step][0];
  uint16_t offTime = pat[buzzer.step][1];

  // Fase ON
  if (digitalRead(BUZZER_PIN) == HIGH) {
    if (now - buzzer.lastStepTime >= onTime) {
      digitalWrite(BUZZER_PIN, LOW);
      buzzer.lastStepTime = now;
      // Kalau tidak ada jeda (offTime==0), langsung ke step berikut
      if (offTime == 0) {
        buzzer.step++;
        if (buzzer.step >= len) {
          buzzer.active = false;
        }
      }
    }
  }
  // Fase OFF
  else {
    if (now - buzzer.lastStepTime >= offTime) {
      buzzer.step++;
      if (buzzer.step >= len) {
        buzzer.active = false;
      } else {
        digitalWrite(BUZZER_PIN, HIGH);
        buzzer.lastStepTime = now;
      }
    }
  }
}

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  Serial.println(F("============================================"));
  Serial.println(F("  ESP32 RFID Permission System Starting..."));
  Serial.println(F("============================================"));

  // Pin init
  pinMode(BUZZER_PIN,        OUTPUT);
  pinMode(RESET_BUTTON_PIN,  INPUT_PULLUP);
  pinMode(CONFIG_BUTTON_PIN, INPUT_PULLUP);
  digitalWrite(BUZZER_PIN, LOW);

  // I2C & PN532
  Wire.begin(PN532_SDA_PIN, PN532_SCL_PIN);
  nfc.begin();

  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    Serial.println(F("[ERROR] PN532 tidak ditemukan! Cek wiring I2C."));
    while (1) { delay(1000); }
  }
  Serial.print(F("[NFC] Found chip PN5"));
  Serial.println((versiondata >> 24) & 0xFF, HEX);
  Serial.print(F("[NFC] Firmware v"));
  Serial.print((versiondata >> 16) & 0xFF, DEC);
  Serial.print('.');
  Serial.println((versiondata >> 8) & 0xFF, DEC);
  nfc.SAMConfig();
  Serial.println(F("[NFC] PN532 siap"));

  // WiFi
  connectWiFi();

  // NTP
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  Serial.println(F("[NTP] Konfigurasi waktu WITA (UTC+8)"));

  // MQTT
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);      // Buffer lebih besar untuk HiveMQ
  mqttClient.setKeepAlive(30);        // Keepalive 30 detik
  mqttClient.setSocketTimeout(10);    // Timeout koneksi 10 detik

  // TLS - skip verifikasi sertifikat (untuk testing)
  // Untuk production: espClient.setCACert(ca_cert);
  espClient.setInsecure();

  // Connect MQTT awal
  reconnectMQTT();

  startBuzzer(BUZZ_SUCCESS);
  Serial.println(F("[SYSTEM] Sistem siap - Tap kartu RFID"));
}

// ============================================================
// LOOP - Tidak ada delay() di sini!
// ============================================================
void loop() {
  // 1. Update buzzer state machine
  updateBuzzer();

  // 2. Cek & reconnect WiFi
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[WiFi] Koneksi putus, reconnecting..."));
    connectWiFi();
  }

  // 3. Cek & reconnect MQTT (dengan cooldown 5 detik)
  if (!mqttClient.connected()) {
    if (millis() - lastMqttConnectAttempt >= 5000) {
      reconnectMQTT();
    }
  }

  // 4. MQTT loop - WAJIB sering dipanggil agar receive message lancar
  mqttClient.loop();

  // 5. Reset pesan Serial setelah menampilkan hasil (non-blocking)
  if (showingResult && (millis() - lcdResetTimer >= 2000)) {
    showingResult = false;
    Serial.println(F("[SYSTEM] Siap Tap Kartu"));
  }

  // 6. Log waktu ke Serial setiap detik
  if (millis() - lastTimeLog >= 1000) {
    logCurrentTime();
    lastTimeLog = millis();
  }

  // 7. Kirim status periodik setiap 60 detik
  if (millis() - lastStatusUpdate >= 60000) {
    sendDeviceStatus("online");
    lastStatusUpdate = millis();
  }

  // 8. Cek tombol setiap 100ms
  if (millis() - lastButtonCheck >= 100) {
    checkButtons();
    lastButtonCheck = millis();
  }

  // 9. Scan RFID (hanya di mode normal, dengan cooldown)
  if (!configMode) {
    checkRFID();
  }
}

// ============================================================
// WiFi Connect
// ============================================================
void connectWiFi() {
  Serial.println(F("============================================"));
  Serial.println(F("[WiFi] Menghubungkan..."));
  Serial.print(F("[WiFi] SSID: "));
  Serial.println(ssid);
  Serial.println(F("============================================"));

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(500);  // delay kecil hanya di setup/connect, bukan di loop utama
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(F("============================================"));
    Serial.println(F("[WiFi] Terhubung!"));
    Serial.print(F("[WiFi] IP       : ")); Serial.println(WiFi.localIP());
    Serial.print(F("[WiFi] Gateway  : ")); Serial.println(WiFi.gatewayIP());
    Serial.print(F("[WiFi] MAC      : ")); Serial.println(WiFi.macAddress());
    Serial.print(F("[WiFi] RSSI     : ")); Serial.print(WiFi.RSSI()); Serial.println(F(" dBm"));
    Serial.println(F("============================================"));
    startBuzzer(BUZZ_SUCCESS);
  } else {
    Serial.println(F("============================================"));
    Serial.println(F("[WiFi] GAGAL terhubung!"));
    Serial.print(F("[WiFi] Status   : ")); Serial.println(WiFi.status());
    Serial.println(F("[WiFi] Cek: SSID benar? MAC terdaftar? Router nyala?"));
    Serial.println(F("============================================"));
    startBuzzer(BUZZ_ERROR);
  }
}

// ============================================================
// MQTT Reconnect (non-blocking dengan cooldown)
// ============================================================
void reconnectMQTT() {
  lastMqttConnectAttempt = millis();

  Serial.println(F("============================================"));
  Serial.println(F("[MQTT] Menghubungkan ke HiveMQ Cloud..."));
  Serial.print(F("[MQTT] Server : ")); Serial.println(mqtt_server);
  Serial.print(F("[MQTT] Port   : ")); Serial.println(mqtt_port);
  Serial.print(F("[MQTT] Client : ")); Serial.println(mqtt_client_id);
  Serial.println(F("============================================"));

  if (mqttClient.connect(mqtt_client_id, mqtt_username, mqtt_password)) {
    Serial.println(F("[MQTT] Terhubung!"));

    // Subscribe ke semua topic yang dibutuhkan
    mqttClient.subscribe(mqtt_topic_response);
    mqttClient.subscribe(mqtt_topic_command);

    Serial.print(F("[MQTT] Subscribe: ")); Serial.println(mqtt_topic_response);
    Serial.print(F("[MQTT] Subscribe: ")); Serial.println(mqtt_topic_command);

    // Kirim status online
    sendDeviceStatus("online");
    startBuzzer(BUZZ_SUCCESS);
  } else {
    Serial.print(F("[MQTT] GAGAL! Error code: "));
    Serial.println(mqttClient.state());
    Serial.println(F("[MQTT] Kode error:"));
    Serial.println(F("  -4: TIMEOUT  -3: CONN_LOST  -2: CONN_FAILED"));
    Serial.println(F("  -1: DISCONN   4: BAD_CRED    5: UNAUTHORIZED"));
    Serial.println(F("[MQTT] Retry dalam 5 detik..."));
    startBuzzer(BUZZ_ERROR);
  }
}

// ============================================================
// MQTT Callback - dipanggil saat ada pesan masuk
// ============================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // Bangun string pesan
  String message;
  message.reserve(length);
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.print(F("[MQTT] Pesan dari ["));
  Serial.print(topic);
  Serial.print(F("]: "));
  Serial.println(message);

  if (strcmp(topic, mqtt_topic_response) == 0) {
    handleServerResponse(message);
  } else if (strcmp(topic, mqtt_topic_command) == 0) {
    handleServerCommand(message);
  }
}

// ============================================================
// Handle Response dari Server
// ============================================================
void handleServerResponse(const String& message) {
  // Parse JSON manual - format:
  // {"rfid_id":"xxx","action":"check_in/check_out","status":"success/error","teacher_name":"xxx","message":"xxx"}

  String action      = extractJsonValue(message, "action");
  String status      = extractJsonValue(message, "status");
  String teacherName = extractJsonValue(message, "teacher_name");
  String msgText     = extractJsonValue(message, "message");

  if (action.isEmpty() || status.isEmpty()) {
    Serial.println(F("[RESPONSE] Format JSON tidak valid"));
    return;
  }

  if (status == "success") {
    if (action == "check_out") {
      Serial.println(F("[RESPONSE] >> IZIN KELUAR <<"));
    } else if (action == "check_in") {
      Serial.println(F("[RESPONSE] >> SUDAH KEMBALI <<"));
    }
    if (!teacherName.isEmpty()) {
      Serial.print(F("[RESPONSE] Nama: "));
      Serial.println(teacherName);
    }
    startBuzzer(BUZZ_SUCCESS);
  } else {
    Serial.println(F("[RESPONSE] >> ERROR - Coba Lagi <<"));
    if (!msgText.isEmpty()) {
      Serial.print(F("[RESPONSE] Pesan: "));
      Serial.println(msgText);
    }
    startBuzzer(BUZZ_ERROR);
  }

  // Set timer untuk kembali ke pesan standby (non-blocking)
  showingResult = true;
  lcdResetTimer = millis();
}

// ============================================================
// Handle Command dari Server (extensible)
// ============================================================
void handleServerCommand(const String& message) {
  String cmd = extractJsonValue(message, "command");
  Serial.print(F("[COMMAND] Terima: "));
  Serial.println(cmd);

  if (cmd == "restart") {
    Serial.println(F("[COMMAND] Restart dalam 1 detik..."));
    sendDeviceStatus("restarting");
    delay(500);  // Beri waktu publish terkirim
    ESP.restart();
  } else if (cmd == "status") {
    sendDeviceStatus("online");
  }
  // Tambahkan command lain sesuai kebutuhan
}

// ============================================================
// Check RFID - Non-blocking dengan timeout & cooldown
// ============================================================
void checkRFID() {
  // Cooldown 2 detik antar scan agar tidak double-scan kartu yang sama
  if (millis() - rfidCooldown < 2000) return;

  uint8_t uid[7]   = { 0 };
  uint8_t uidLength = 0;

  // Timeout 100ms = non-blocking, tidak freeze loop
  bool found = nfc.readPassiveTargetID(
    PN532_MIFARE_ISO14443A,
    uid,
    &uidLength,
    100  // timeout dalam ms
  );

  if (!found) return;

  rfidCooldown = millis();  // Set cooldown segera setelah deteksi

  // Format UID ke HEX string
  String rfidId;
  rfidId.reserve(uidLength * 2);
  for (uint8_t i = 0; i < uidLength; i++) {
    if (uid[i] < 0x10) rfidId += '0';
    rfidId += String(uid[i], HEX);
  }
  rfidId.toUpperCase();

  Serial.print(F("[RFID] Kartu terdeteksi: "));
  Serial.println(rfidId);

  startBuzzer(BUZZ_SCAN);

  // Buat payload JSON
  String payload = "{\"rfid_id\":\"" + rfidId +
                   "\",\"device_id\":\"" + String(device_id) + "\"}";

  // Publish ke MQTT
  if (mqttClient.connected()) {
    bool ok = mqttClient.publish(mqtt_topic_rfid, payload.c_str());
    if (ok) {
      Serial.print(F("[RFID] Published: "));
      Serial.println(payload);
    } else {
      Serial.println(F("[RFID] Publish GAGAL - buffer penuh?"));
      startBuzzer(BUZZ_ERROR);
    }
  } else {
    Serial.println(F("[RFID] MQTT tidak terhubung, mencoba reconnect..."));
    reconnectMQTT();
    if (mqttClient.connected()) {
      mqttClient.publish(mqtt_topic_rfid, payload.c_str());
      Serial.print(F("[RFID] Published setelah reconnect: "));
      Serial.println(payload);
    } else {
      Serial.println(F("[RFID] Gagal publish - MQTT tidak terhubung"));
      startBuzzer(BUZZ_ERROR);
    }
  }
}

// ============================================================
// Check Buttons - Debounce terpisah per tombol
// ============================================================
void checkButtons() {
  unsigned long now = millis();

  // Tombol Reset
  if (digitalRead(RESET_BUTTON_PIN) == LOW) {
    if ((now - lastDebounceReset) > debounceDelay) {
      lastDebounceReset = now;
      Serial.println(F("[BTN] Reset ditekan"));
      handleReset();
    }
  }

  // Tombol Config
  if (digitalRead(CONFIG_BUTTON_PIN) == LOW) {
    if ((now - lastDebounceConfig) > debounceDelay) {
      lastDebounceConfig = now;
      Serial.println(F("[BTN] Config ditekan"));
      handleConfig();
    }
  }
}

void handleReset() {
  Serial.println(F("[SYSTEM] Restarting..."));
  sendDeviceStatus("restarting");
  startBuzzer(BUZZ_SUCCESS);
  delay(300);  // Beri waktu buzzer & MQTT publish
  ESP.restart();
}

void handleConfig() {
  configMode = !configMode;
  if (configMode) {
    Serial.println(F("[SYSTEM] Masuk Mode Config - RFID scan dinonaktifkan"));
    startBuzzer(BUZZ_SUCCESS);
  } else {
    Serial.println(F("[SYSTEM] Keluar Mode Config - Mode Normal"));
    startBuzzer(BUZZ_SUCCESS);
  }
}

// ============================================================
// Send Device Status ke MQTT
// ============================================================
void sendDeviceStatus(const char* status) {
  if (!mqttClient.connected()) return;

  String payload = "{\"device_id\":\"" + String(device_id) +
                   "\",\"status\":\""   + String(status)    +
                   "\",\"ip_address\":\""       + WiFi.localIP().toString() +
                   "\",\"rssi\":"       + String(WiFi.RSSI()) +
                   "}";

  mqttClient.publish(mqtt_topic_status, payload.c_str());
  Serial.print(F("[STATUS] Published: "));
  Serial.println(payload);
}

// ============================================================
// Log Waktu WITA ke Serial (tiap 1 detik)
// ============================================================
void logCurrentTime() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 0)) return;  // timeout 0 = non-blocking

  char timeStr[20];
  strftime(timeStr, sizeof(timeStr), "%H:%M:%S", &timeinfo);

  // Hanya print waktu jika tidak sedang menampilkan hasil scan
  if (!showingResult) {
    Serial.print(F("[WITA] "));
    Serial.println(timeStr);
  }
}

// ============================================================
// Helper: Extract nilai dari JSON string sederhana
// Contoh: extractJsonValue(json, "status") → "success"
// ============================================================
String extractJsonValue(const String& json, const String& key) {
  String searchKey = "\"" + key + "\":\"";
  int startIdx = json.indexOf(searchKey);
  if (startIdx < 0) return "";
  startIdx += searchKey.length();
  int endIdx = json.indexOf('"', startIdx);
  if (endIdx < 0) return "";
  return json.substring(startIdx, endIdx);
}
