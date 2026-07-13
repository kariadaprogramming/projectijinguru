# Sistem Izin Keluar Masuk Pegawai

Sistem berbasis RFID untuk memonitor izin keluar dan masuk pegawai/guru dengan integrasi Web, Telegram, dan ESP32 IoT.

## 🌟 Fitur Utama

### Web Dashboard
- **Dashboard Real-time**: Statistik total guru, izin hari ini, izin bulan ini, dan guru yang sedang izin
- **Manajemen Guru**: Tambah, edit, dan hapus data guru dengan RFID ID
- **Monitoring Izin**: Lihat guru yang sedang izin secara real-time dengan durasi
- **Riwayat Izin**: Filter berdasarkan tanggal dan guru, rekap bulanan
- **Export Data**: Export ke Excel, print laporan
- **Status Device**: Monitor status perangkat IoT via MQTT
- **Logs RFID**: Lihat semua aktivitas scanning RFID
- **Autentikasi**: Login dengan akun admin

### Telegram Bot
- **Live Keyboard**: Menu interaktif untuk navigasi mudah
- **Tambah Guru**: Tambah guru baru langsung dari Telegram
- **Dashboard**: Lihat statistik sistem
- **Monitoring**: Lihat guru yang sedang izin
- **Riwayat**: Lihat riwayat izin terbaru
- **Status Device**: Monitor status perangkat IoT
- **Logs**: Lihat logs RFID terbaru
- **Notifikasi**: Notifikasi otomatis saat guru izin keluar/kembali

### ESP32 IoT Device
- **RFID Scanner**: Deteksi kartu RFID guru
- **LCD Display**: Tampilkan status dan informasi
- **Buzzer**: Notifikasi suara saat scan berhasil/gagal
- **MQTT Communication**: Komunikasi real-time dengan server
- **Tombol Reset**: Reset perangkat
- **Tombol Config**: Mode konfigurasi

## 📋 Persyaratan Sistem

### Backend (Node.js)
- Node.js v14 atau lebih tinggi
- MySQL/MariaDB
- MQTT Broker (Mosquitto atau sejenis)
- npm

### ESP32 Hardware
- ESP32 Development Board
- RC522 RFID Module
- LCD 16x2 dengan I2C Adapter
- Active Buzzer
- Push Button x2
- Jumper Wires
- Power Supply

### Telegram
- Telegram Bot Token (dari @BotFather)
- Chat ID untuk notifikasi

## 🚀 Instalasi

### 1. Clone Repository
```bash
cd projectijinguru
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup Database
```bash
# Import database schema ke MySQL
mysql -u root -p < database/schema.sql
```

### 4. Konfigurasi Environment
```bash
# Copy file environment example
cp .env.example .env

# Edit .env sesuai konfigurasi Anda
nano .env
```

Isi konfigurasi berikut:
```env
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=sistem_izin
DB_PORT=3306

# JWT & Session
JWT_SECRET=your_jwt_secret_key
SESSION_SECRET=your_session_secret

# MQTT
MQTT_BROKER=mqtt://localhost
MQTT_PORT=1883
MQTT_CLIENT_ID=server_client
MQTT_USERNAME=your_mqtt_username  # Untuk HiveMQ atau broker dengan auth
MQTT_PASSWORD=your_mqtt_password  # Untuk HiveMQ atau broker dengan auth

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_ADMIN_CHAT_ID=your_chat_id

# MQTT Topics
MQTT_TOPIC_RFID=izin/rfid
MQTT_TOPIC_STATUS=izin/status
MQTT_TOPIC_COMMAND=izin/command
MQTT_TOPIC_RESPONSE=izin/response
```

### 5. Setup MQTT Broker

#### Opsi 1: Menggunakan HiveMQ Cloud (Gratis)
1. Daftar di https://www.hivemq.com/
2. Buat cluster baru di HiveMQ Cloud
3. Dapatkan:
   - MQTT Broker URL (contoh: `your-cluster.hivemq.cloud`)
   - Port (biasanya 8883 untuk TLS atau 1883 untuk non-TLS)
   - Username
   - Password
4. Masukkan ke `.env`:
   ```env
   MQTT_BROKER=mqtt://your-cluster.hivemq.cloud
   MQTT_PORT=1883  # atau 8883 untuk TLS
   MQTT_USERNAME=your_hivemq_username
   MQTT_PASSWORD=your_hivemq_password
   ```

#### Opsi 2: Menggunakan Mosquitto (Local)
```bash
# Install Mosquitto (Ubuntu/Debian)
sudo apt-get install mosquitto mosquitto-clients

# Start Mosquitto
sudo systemctl start mosquitto
sudo systemctl enable mosquitto
```

Jika menggunakan Mosquitto tanpa auth, biarkan `MQTT_USERNAME` dan `MQTT_PASSWORD` kosong di `.env`.

### 6. Setup Telegram Bot
1. Buka Telegram dan cari @BotFather
2. Kirim `/newbot` dan ikuti instruksi
3. Copy token bot dan masukkan ke `.env`
4. Untuk mendapatkan Chat ID, kirim pesan ke bot dan akses:
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```

### 7. Jalankan Server
```bash
# Development
npm run dev

# Production
npm start
```

Server akan berjalan di `http://localhost:3000`

### 8. Setup ESP32
1. Buka Arduino IDE
2. Install ESP32 board support
3. Install library yang dibutuhkan:
   - WiFi
   - PubSubClient
   - MFRC522
   - LiquidCrystal_I2C
   - Wire
4. Buka file `esp32/esp32_rfid_izin.ino`
5. Edit konfigurasi WiFi dan MQTT:
   ```cpp
   const char* ssid = "YOUR_WIFI_SSID";
   const char* password = "YOUR_WIFI_PASSWORD";
   const char* mqtt_server = "YOUR_MQTT_BROKER_IP";
   ```
6. Upload ke ESP32
7. Lihat `esp32/WIRING_DIAGRAM.md` untuk wiring

## 📁 Struktur Project

```
sistem-izin-keluar-masuk/
├── database/
│   └── schema.sql              # Database schema
├── esp32/
│   ├── esp32_rfid_izin.ino    # Arduino code untuk ESP32
│   └── WIRING_DIAGRAM.md      # Dokumentasi wiring
├── public/
│   ├── css/
│   │   └── style.css          # Styles untuk frontend
│   ├── js/
│   │   ├── login.js           # Script login
│   │   └── dashboard.js       # Script dashboard
│   ├── index.html             # Halaman login
│   └── dashboard.html         # Halaman dashboard
├── .env.example               # Contoh konfigurasi environment
├── package.json               # Dependencies Node.js
├── server.js                  # Main server file
└── README.md                  # Dokumentasi ini
```

## 🔌 MQTT Topics

Untuk dokumentasi lengkap MQTT flow (subscribe/publish untuk setiap komponen), lihat file **MQTT_FLOW.md**.

### Topics yang digunakan:

| Topic | Direction | Deskripsi |
|-------|-----------|-----------|
| `izin/rfid` | ESP32 → Server | Data RFID scan |
| `izin/status` | ESP32 → Server | Status device IoT |
| `izin/response` | Server → ESP32 | Respon dari server |
| `izin/command` | Server → ESP32 | Command ke device (opsional) |

### Format Message:

#### RFID Scan (izin/rfid)
```json
{
  "rfid_id": "A1B2C3D4",
  "device_id": "ESP32_RFID_001"
}
```

#### Device Status (izin/status)
```json
{
  "device_id": "ESP32_RFID_001",
  "status": "online",
  "ip_address": "192.168.1.100"
}
```

#### Server Response (izin/response)
```json
{
  "rfid_id": "A1B2C3D4",
  "action": "check_out",
  "status": "success",
  "message": "Budi Santoso izin keluar",
  "teacher_name": "Budi Santoso"
}
```

## 👤 Akun Default

| Username | Password | Role |
|----------|----------|------|
| admin1 |  | Admin |
| admin2 |  | Admin |

**Penting**: Ganti password default setelah login pertama!

## 📱 Penggunaan Telegram

### Commands:
- `/start` - Mulai bot dan tampilkan menu
- `/menu` - Tampilkan menu utama

### Menu Live Keyboard:
- 📊 **Dashboard** - Lihat statistik sistem
- ➕ **Tambah Guru** - Tambah guru baru
- 📋 **Guru Sedang Izin** - Lihat guru yang sedang izin
- 📜 **Riwayat Izin** - Lihat riwayat izin
- 🔧 **Status Device** - Monitor status device IoT
- 📝 **Logs** - Lihat logs RFID terbaru

### Format Tambah Guru via Telegram:
```
ADD_TEACHER:Nama,Jenis(Guru/Pegawai/Staff),RFID_ID,NoHP,TelegramChatID
```

Contoh:
```
ADD_TEACHER:Budi Santoso,Guru,A1B2C3D4,081234567890,123456789
```

## 🔧 API Documentation

### Authentication

#### POST /api/login
Login ke sistem
```json
{
  "username": "admin1",
  "password": "Skanbara2015"
}
```

#### POST /api/logout
Logout dari sistem

#### GET /api/me
Cek status login

### Dashboard

#### GET /api/dashboard/stats
Dapatkan statistik dashboard

### Teachers

#### GET /api/teachers
Dapatkan semua guru

#### POST /api/teachers
Tambah guru baru
```json
{
  "rfid_id": "A1B2C3D4",
  "full_name": "Budi Santoso",
  "employee_type": "guru",
  "phone_number": "081234567890",
  "telegram_chat_id": "123456789"
}
```

#### PUT /api/teachers/:id
Update data guru

#### DELETE /api/teachers/:id
Hapus guru (soft delete)

### Permissions

#### GET /api/permissions/active
Dapatkan guru yang sedang izin (real-time)

#### GET /api/permissions/history
Dapatkan riwayat izin dengan filter
```
?start_date=2024-01-01&end_date=2024-01-31&teacher_id=1
```

#### GET /api/permissions/monthly/:year/:month
Dapatkan rekap izin bulanan

### Devices

#### GET /api/devices
Dapatkan semua device IoT

### Logs

#### GET /api/logs
Dapatkan logs RFID
```
?limit=50
```

### Export

#### GET /api/export/excel
Export riwayat izin ke Excel
```
?start_date=2024-01-01&end_date=2024-01-31
```

## 🔍 Troubleshooting

### Database Connection Error
- Pastikan MySQL/MariaDB berjalan
- Cek kredensial di `.env`
- Pastikan database `sistem_izin` sudah dibuat

### MQTT Connection Error
- Pastikan MQTT broker berjalan
- Cek IP address dan port di `.env`
- Pastikan firewall tidak memblokir port MQTT

### Telegram Bot Not Working
- Pastikan bot token benar
- Cek internet connection
- Pastikan bot sudah di-start dengan `/start`

### ESP32 Not Connecting to WiFi
- Cek SSID dan password di code
- Pastikan ESP32 dalam range WiFi
- Cek Serial Monitor untuk error message

### RFID Not Detected
- Pastikan wiring benar (lihat WIRING_DIAGRAM.md)
- Cek power supply (3.3V untuk RC522)
- Pastikan library MFRC522 terinstall

### LCD Not Displaying
- Cek I2C address (0x27 atau 0x3F)
- Pastikan wiring SDA/SCL benar
- Cek contrast (potensiometer di I2C adapter)

## 📝 Catatan Penting

1. **Security**: Ganti password default admin dan JWT secret di production
2. **Backup**: Lakukan backup database secara berkala
3. **Network**: Pastikan ESP32 dan server dalam network yang sama atau dapat mengakses MQTT broker
4. **Power**: Gunakan power supply yang stabil untuk ESP32
5. **RFID Cards**: Pastikan kartu RFID yang digunakan kompatibel dengan RC522 (13.56 MHz)

## 🚀 Deployment ke Server Sendiri

### 1. Push ke GitHub

```bash
# Initialize git jika belum
git init

# Add semua file
git add .

# Commit
git commit -m "Initial commit - Sistem Izin Keluar Masuk"

# Push ke GitHub
git remote add origin https://github.com/username/repository.git
git branch -M main
git push -u origin main
```

### 2. Setup di Server (Ubuntu/Debian)

#### Install Node.js & npm
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### Install MySQL/MariaDB
```bash
sudo apt-get update
sudo apt-get install -y mysql-server
sudo mysql_secure_installation
```

#### Install PM2 (Process Manager)
```bash
sudo npm install -g pm2
```

#### Clone Repository
```bash
cd /var/www
sudo git clone https://github.com/username/repository.git sistem-izin
cd sistem-izin
```

#### Install Dependencies
```bash
npm install
```

#### Setup Database
```bash
sudo mysql -u root -p < database/schema.sql
```

#### Setup Environment
```bash
cp .env.example .env
nano .env
```

Update konfigurasi sesuai server:
```env
PORT=3000
NODE_ENV=production

# Database (MySQL di server)
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=sistem_izin
DB_PORT=3306

# JWT & Session (gunakan random string yang kuat)
JWT_SECRET=your_very_long_random_secret_key_here
SESSION_SECRET=your_very_long_random_session_secret_here

# MQTT (gunakan HiveMQ Cloud atau setup Mosquitto di server)
MQTT_BROKER=mqtts://282ebcb2b3e048aeb47708a9236c9b95.s1.eu.hivemq.cloud
MQTT_PORT=8883
MQTT_CLIENT_ID=server_client
MQTT_USERNAME=ijinkeluar
MQTT_PASSWORD=Gmagus4099

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_ADMIN_CHAT_ID=your_admin_chat_id
TELEGRAM_GROUP_CHAT_ID=-5165251539

# MQTT Topics
MQTT_TOPIC_RFID=izin/rfid
MQTT_TOPIC_STATUS=izin/status
MQTT_TOPIC_COMMAND=izin/command
MQTT_TOPIC_RESPONSE=izin/response
```

#### Jalankan dengan PM2
```bash
# Start aplikasi
pm2 start server.js --name sistem-izin

# Set untuk auto-start saat boot
pm2 startup
pm2 save

# Cek status
pm2 status
pm2 logs sistem-izin
```

#### Setup Nginx (Reverse Proxy - Optional tapi disarankan)
```bash
sudo apt-get install nginx
sudo nano /etc/nginx/sites-available/sistem-izin
```

Tambahkan konfigurasi:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Enable dan restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/sistem-izin /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### Setup SSL dengan Let's Encrypt (Optional)
```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 3. Update dari GitHub

```bash
cd /var/www/sistem-izin
sudo git pull
pm2 restart sistem-izin
```

### 4. Monitoring Server

```bash
# Cek status PM2
pm2 status

# Cek logs
pm2 logs sistem-izin

# Restart aplikasi
pm2 restart sistem-izin

# Stop aplikasi
pm2 stop sistem-izin
```

### 5. Firewall Configuration

```bash
# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow custom port jika tidak pakai Nginx
sudo ufw allow 3000/tcp

# Enable firewall
sudo ufw enable
```

## 🤝 Kontribusi

Project ini masih dalam pengembangan. Silakan berkontribusi dengan:
- Report bug
- Request fitur baru
- Submit pull request

## 📄 Lisensi

Project ini dibuat untuk keperluan pendidikan dan monitoring izin pegawai.

## 👨‍💻 Developer

Dibuat dengan ❤️ untuk sistem monitoring izin keluar masuk pegawai.

## 📞 Support

Untuk pertanyaan atau bantuan, silakan hubungi developer atau buat issue di repository.

---

**Terima kasih telah menggunakan Sistem Izin Keluar Masuk Pegawai!**
