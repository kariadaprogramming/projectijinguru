/*
 * ESP32 RFID Permission System
 * Components: ESP32, PN532 NFC RFID Module (I2C), LCD 16x2 (I2C), Active Buzzer, Push Buttons
 * Features: RFID scanning, MQTT communication, LCD display, buzzer notification, NTP time sync (WITA)
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_PN532.h>
#include <LiquidCrystal_I2C.h>
#include <time.h>

// WiFi Configuration (Captive Portal - MAC Address Registered, No Password)
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "";  // Empty password for captive portal (MAC address registered)

// NTP Configuration (WITA - Asia/Makassar)
const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 28800;  // WITA = UTC+8 (8 hours = 28800 seconds)
const int daylightOffset_sec = 0;    // WITA doesn't use daylight saving

// MQTT Configuration (HiveMQ Cloud with TLS)
const char* mqtt_server = "282ebcb2b3e048aeb47708a9236c9b95.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;  // Port 8883 untuk TLS/SSL
const char* mqtt_client_id = "esp32_rfid_device";
const char* mqtt_username = "ijinkeluar";
const char* mqtt_password = "Gmagus4099";
const char* mqtt_topic_rfid = "izin/rfid";
const char* mqtt_topic_status = "izin/status";
const char* mqtt_topic_response = "izin/response";
const char* mqtt_topic_command = "izin/command";

// Device Configuration
const char* device_id = "ESP32_RFID_001";

// Pin Definitions (PN532 NFC Module - I2C)
#define PN532_SDA_PIN 21  // I2C SDA
#define PN532_SCL_PIN 22  // I2C SCL

#define BUZZER_PIN 25
#define RESET_BUTTON_PIN 26
#define CONFIG_BUTTON_PIN 27

// LCD Configuration (I2C address usually 0x27 or 0x3F)
#define LCD_ADDRESS 0x27
#define LCD_COLUMNS 16
#define LCD_ROWS 2

// Global Objects
WiFiClientSecure espClient;  // Gunakan WiFiClientSecure untuk TLS
PubSubClient mqttClient(espClient);
LiquidCrystal_I2C lcd(LCD_ADDRESS, LCD_COLUMNS, LCD_ROWS);

// PN532 NFC Module (I2C)
Adafruit_PN532 nfc(PN532_SDA_PIN, PN532_SCL_PIN);

// Variables
unsigned long lastMqttConnectAttempt = 0;
unsigned long lastStatusUpdate = 0;
unsigned long lastButtonCheck = 0;
bool mqttConnected = false;
bool configMode = false;

// Button debounce
unsigned long lastDebounceTime = 0;
const unsigned long debounceDelay = 50;

void setup() {
  Serial.begin(115200);
  Serial.println("ESP32 RFID Permission System Starting...");

  // Initialize pins
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RESET_BUTTON_PIN, INPUT_PULLUP);
  pinMode(CONFIG_BUTTON_PIN, INPUT_PULLUP);

  digitalWrite(BUZZER_PIN, LOW);

  // Initialize I2C for PN532 and LCD
  Wire.begin(PN532_SDA_PIN, PN532_SCL_PIN);

  // Initialize PN532 NFC Module
  nfc.begin();
  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    Serial.print("Didn't find PN53x board");
    while (1);
  }
  Serial.print("Found chip PN5");
  Serial.println((versiondata >> 24) & 0xFF, HEX);
  Serial.print("Firmware ver. ");
  Serial.print((versiondata >> 16) & 0xFF, DEC);
  Serial.print('.');
  Serial.println((versiondata >> 8) & 0xFF, DEC);

  nfc.SAMConfig();
  Serial.println("PN532 NFC initialized");

  // Initialize LCD (I2C address 0x27)
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Sistem Izin");
  lcd.setCursor(0, 1);
  lcd.print("Initializing...");

  // Connect to WiFi
  connectWiFi();

  // Configure NTP time (WITA - UTC+8)
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  Serial.println("NTP time configured for WITA (UTC+8)");

  // Initialize MQTT with TLS
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setCallback(mqttCallback);

  // Setup TLS for HiveMQ Cloud
  // Untuk production, gunakan CA certificate yang valid
  // Untuk testing, kita bisa skip certificate verification
  espClient.setInsecure();  // Skip certificate verification (hanya untuk testing!)
  // espClient.setCACert(ca_cert);  // Untuk production, gunakan CA certificate
  
  // Send initial status
  sendDeviceStatus("online");
  
  // Display ready message
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Siap Tap Kartu");
  lcd.setCursor(0, 1);
  lcd.print("Device: ");
  lcd.print(device_id);
  
  beepSuccess();
  Serial.println("System ready");
}

void loop() {
  // Check WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }
  
  // Check MQTT connection
  if (!mqttClient.connected()) {
    reconnectMQTT();
  }
  mqttClient.loop();

  // Display current time on LCD (every second)
  static unsigned long lastTimeDisplay = 0;
  if (millis() - lastTimeDisplay > 1000) {
    displayCurrentTime();
    lastTimeDisplay = millis();
  }

  // Send periodic status update
  if (millis() - lastStatusUpdate > 60000) { // Every 60 seconds
    sendDeviceStatus("online");
    lastStatusUpdate = millis();
  }

  // Check buttons
  if (millis() - lastButtonCheck > 100) {
    checkButtons();
    lastButtonCheck = millis();
  }

  // Check for RFID card
  if (!configMode) {
    checkRFID();
  }

  delay(10);
}

void connectWiFi() {
  Serial.println("===========================================");
  Serial.println("WiFi Connection Starting...");
  Serial.print("SSID: ");
  Serial.println(ssid);
  Serial.print("Password: ");
  Serial.println(password == "" ? "None (Captive Portal)" : "Hidden");
  Serial.println("===========================================");

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi");

  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    lcd.setCursor(0, 1);
    lcd.print("Connecting...");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("===========================================");
    Serial.println("WiFi Connected Successfully!");
    Serial.println("===========================================");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Gateway: ");
    Serial.println(WiFi.gatewayIP());
    Serial.print("Subnet Mask: ");
    Serial.println(WiFi.subnetMask());
    Serial.print("DNS: ");
    Serial.println(WiFi.dnsIP());
    Serial.print("MAC Address: ");
    Serial.println(WiFi.macAddress());
    Serial.print("RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    Serial.println("===========================================");

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Connected");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP());
    beepSuccess();
    delay(2000);

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Siap Tap Kartu");
    lcd.setCursor(0, 1);
    lcd.print("Device: ");
    lcd.print(device_id);
  } else {
    Serial.println();
    Serial.println("===========================================");
    Serial.println("WiFi Connection Failed!");
    Serial.println("===========================================");
    Serial.print("WiFi Status: ");
    Serial.println(WiFi.status());
    Serial.println("Please check:");
    Serial.println("1. SSID is correct");
    Serial.println("2. MAC address is registered in router");
    Serial.println("3. Router is powered on");
    Serial.println("4. ESP32 is within range");
    Serial.println("===========================================");

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Failed");
    lcd.setCursor(0, 1);
    lcd.print("Check Router");
    beepError();
    delay(2000);
  }
}

void reconnectMQTT() {
  if (millis() - lastMqttConnectAttempt < 2000) {
    return;
  }

  lastMqttConnectAttempt = millis();

  Serial.println("===========================================");
  Serial.println("MQTT Connection Attempt...");
  Serial.print("MQTT Server: ");
  Serial.println(mqtt_server);
  Serial.print("MQTT Port: ");
  Serial.println(mqtt_port);
  Serial.print("Client ID: ");
  Serial.println(mqtt_client_id);
  Serial.print("Username: ");
  Serial.println(mqtt_username);
  Serial.println("===========================================");

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("MQTT Connect...");

  // Connect with username and password for HiveMQ
  if (mqttClient.connect(mqtt_client_id, mqtt_username, mqtt_password)) {
    Serial.println("===========================================");
    Serial.println("MQTT Connected Successfully!");
    Serial.println("===========================================");

    mqttConnected = true;

    // Subscribe to topics
    mqttClient.subscribe(mqtt_topic_response);  // Subscribe untuk respon dari server
    mqttClient.subscribe(mqtt_topic_command);   // Subscribe untuk command dari server (opsional)

    Serial.print("Subscribed to: ");
    Serial.println(mqtt_topic_response);
    Serial.print("Subscribed to: ");
    Serial.println(mqtt_topic_command);
    Serial.println("===========================================");

    // Send initial device status
    sendDeviceStatus("online");

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("MQTT Connected");
    beepSuccess();
    delay(1000);

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Siap Tap Kartu");
    lcd.setCursor(0, 1);
    lcd.print("Device: ");
    lcd.print(device_id);
  } else {
    Serial.println("===========================================");
    Serial.println("MQTT Connection Failed!");
    Serial.println("===========================================");
    Serial.print("Error Code: ");
    Serial.println(mqttClient.state());
    Serial.println("Error Codes:");
    Serial.println("-4 : MQTT_CONNECTION_TIMEOUT");
    Serial.println("-3 : MQTT_CONNECTION_LOST");
    Serial.println("-2 : MQTT_CONNECT_FAILED");
    Serial.println("-1 : MQTT_DISCONNECTED");
    Serial.println(" 0 : MQTT_CONNECTED");
    Serial.println(" 1 : MQTT_CONNECT_BAD_PROTOCOL");
    Serial.println(" 2 : MQTT_CONNECT_BAD_CLIENT_ID");
    Serial.println(" 3 : MQTT_CONNECT_UNAVAILABLE");
    Serial.println(" 4 : MQTT_CONNECT_BAD_CREDENTIALS");
    Serial.println(" 5 : MQTT_CONNECT_UNAUTHORIZED");
    Serial.println("===========================================");
    Serial.println("Retrying in 5 seconds...");
    Serial.println("===========================================");

    mqttConnected = false;

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("MQTT Failed");
    beepError();
    delay(1000);

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Siap Tap Kartu");
    lcd.setCursor(0, 1);
    lcd.print("Device: ");
    lcd.print(device_id);
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("]: ");

  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.println(message);

  // Handle response from server (Server → ESP32)
  if (String(topic) == mqtt_topic_response) {
    Serial.println("Received from izin/response");
    handleServerResponse(message);
  }
  // Handle command from server (Server → ESP32) - Opsional untuk future use
  else if (String(topic) == mqtt_topic_command) {
    Serial.println("Received from izin/command");
    // Implement command handling di sini jika diperlukan
    // Contoh: restart, config, dll
  }
}

void handleServerResponse(String message) {
  // Parse JSON response
  // Expected format: {"rfid_id":"xxx","action":"check_in/check_out","status":"success/error","message":"xxx","teacher_name":"xxx"}
  
  int actionIndex = message.indexOf("\"action\":");
  int statusIndex = message.indexOf("\"status\":");
  int messageIndex = message.indexOf("\"message\":");
  int nameIndex = message.indexOf("\"teacher_name\":");
  
  if (actionIndex > 0 && statusIndex > 0) {
    String action = message.substring(actionIndex + 9, message.indexOf("\"", actionIndex + 10));
    String status = message.substring(statusIndex + 9, message.indexOf("\"", statusIndex + 10));
    
    lcd.clear();
    
    if (status == "success") {
      if (action == "check_out") {
        lcd.setCursor(0, 0);
        lcd.print("IZIN KELUAR");
        beepSuccess();
      } else if (action == "check_in") {
        lcd.setCursor(0, 0);
        lcd.print("SUDAH KEMBALI");
        beepSuccess();
      }
      
      // Display teacher name if available
      if (nameIndex > 0) {
        String teacherName = message.substring(nameIndex + 16, message.indexOf("\"", nameIndex + 17));
        lcd.setCursor(0, 1);
        if (teacherName.length() > 16) {
          lcd.print(teacherName.substring(0, 16));
        } else {
          lcd.print(teacherName);
        }
      }
      
      delay(1500);
    } else {
      lcd.setCursor(0, 0);
      lcd.print("ERROR");
      lcd.setCursor(0, 1);
      lcd.print("Coba Lagi");
      beepError();
      delay(1000);
    }
    
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Siap Tap Kartu");
    lcd.setCursor(0, 1);
    lcd.print("Device: ");
    lcd.print(device_id);
  }
}

void checkRFID() {
  uint8_t uid[] = { 0, 0, 0, 0, 0, 0, 0 };
  uint8_t uidLength;

  // Check for NFC card
  if (!nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength)) {
    return;
  }

  // Get RFID ID
  String rfidId = "";
  for (uint8_t i = 0; i < uidLength; i++) {
    if (uid[i] < 0x10) {
      rfidId += "0";
    }
    rfidId += String(uid[i], HEX);
  }
  rfidId.toUpperCase();

  Serial.print("RFID ID detected: ");
  Serial.println(rfidId);

  // Display on LCD
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("RFID Terdeteksi");
  lcd.setCursor(0, 1);
  lcd.print(rfidId);

  beepScan();

  // Send to MQTT (ESP32 → Server)
  String payload = "{\"rfid_id\":\"" + rfidId + "\",\"device_id\":\"" + String(device_id) + "\"}";

  // Check MQTT connection before publishing
  if (mqttClient.connected()) {
    if (mqttClient.publish(mqtt_topic_rfid, payload.c_str())) {
      Serial.println("Published to izin/rfid: " + payload);
    } else {
      Serial.println("Failed to publish to izin/rfid - MQTT not ready");
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("MQTT Error");
      lcd.setCursor(0, 1);
      lcd.print("Retry...");
      beepError();
      delay(500);
    }
  } else {
    Serial.println("MQTT not connected - attempting to reconnect");
    reconnectMQTT();
    // Retry publish after reconnect attempt
    if (mqttClient.connected()) {
      mqttClient.publish(mqtt_topic_rfid, payload.c_str());
      Serial.println("Published to izin/rfid after reconnect: " + payload);
    }
  }

  // Wait before next scan (reduced from 2000ms to 500ms for faster response)
  delay(500);
}

void checkButtons() {
  // Check reset button
  if (digitalRead(RESET_BUTTON_PIN) == LOW) {
    if ((millis() - lastDebounceTime) > debounceDelay) {
      Serial.println("Reset button pressed");
      handleReset();
      lastDebounceTime = millis();
    }
  }
  
  // Check config button
  if (digitalRead(CONFIG_BUTTON_PIN) == LOW) {
    if ((millis() - lastDebounceTime) > debounceDelay) {
      Serial.println("Config button pressed");
      handleConfig();
      lastDebounceTime = millis();
    }
  }
}

void handleReset() {
  Serial.println("Resetting device...");
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Resetting...");
  beepSuccess();
  delay(1000);
  ESP.restart();
}

void handleConfig() {
  configMode = !configMode;
  
  if (configMode) {
    Serial.println("Entering config mode");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Mode Config");
    lcd.setCursor(0, 1);
    lcd.print("Tap untuk RFID");
    beepSuccess();
  } else {
    Serial.println("Exiting config mode");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Mode Normal");
    beepSuccess();
    delay(1000);
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Siap Tap Kartu");
    lcd.setCursor(0, 1);
    lcd.print("Device: ");
    lcd.print(device_id);
  }
}

void sendDeviceStatus(String status) {
  String payload = "{\"device_id\":\"" + String(device_id) + "\",\"status\":\"" + status + "\",\"ip_address\":\"" + WiFi.localIP().toString() + "\"}";
  mqttClient.publish(mqtt_topic_status, payload.c_str());
  Serial.println("Published to izin/status: " + payload);
}

// Display current time on LCD
void displayCurrentTime() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("Failed to obtain time");
    return;
  }

  char timeStr[16];
  strftime(timeStr, sizeof(timeStr), "%H:%M:%S", &timeinfo);

  lcd.setCursor(0, 0);
  lcd.print("WITA: ");
  lcd.print(timeStr);
}

// Buzzer functions
void beepSuccess() {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(100);
  digitalWrite(BUZZER_PIN, LOW);
  delay(50);
  digitalWrite(BUZZER_PIN, HIGH);
  delay(100);
  digitalWrite(BUZZER_PIN, LOW);
}

void beepError() {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(200);
  digitalWrite(BUZZER_PIN, LOW);
  delay(100);
  digitalWrite(BUZZER_PIN, HIGH);
  delay(200);
  digitalWrite(BUZZER_PIN, LOW);
}

void beepScan() {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(50);
  digitalWrite(BUZZER_PIN, LOW);
}
