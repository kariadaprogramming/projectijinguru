# Setup Telegram Group untuk Notifikasi Izin Keluar Masuk

## Cara Mengatur Telegram Group untuk Notifikasi Massal

### 1. Buat Grup Telegram
1. Buka aplikasi Telegram di HP atau laptop
2. Buat grup baru dengan nama misalnya: "Sistem Izin Keluar Masuk"
3. Undang semua user yang ingin memantau izin (atasan, satpam, anggota tim, dll)

### 2. Tambahkan Bot ke Grup
1. Buka grup yang sudah dibuat
2. Klik nama grup di atas → Add Member
3. Cari bot Telegram Anda (gunakan username bot yang sudah dibuat)
4. Tambahkan bot ke grup
5. **PENTING**: Berikan izin "Post Messages" kepada bot di grup

### 3. Jadikan Bot sebagai Admin (Opsional tapi disarankan)
1. Klik nama grup → Edit → Administrators
2. Tambahkan bot sebagai administrator
3. Berikan izin untuk mengirim pesan

### 4. Dapatkan Group Chat ID
Ada beberapa cara untuk mendapatkan Group Chat ID:

#### Cara 1: Menggunakan Bot @userinfobot
1. Buka chat dengan bot @userinfobot di Telegram
2. Forward pesan dari grup Anda ke bot ini
3. Bot akan membalas dengan informasi termasuk Chat ID
4. Chat ID grup biasanya diawali dengan `-100` (contoh: `-1001234567890`)

#### Cara 2: Menggunakan API Telegram
1. Buka browser dan akses: `https://api.telegram.org/bot<TOKEN_BOT_ANDA>/getUpdates`
2. Ganti `<TOKEN_BOT_ANDA>` dengan token bot Anda dari @BotFather
3. Kirim pesan apa saja di grup Telegram
4. Refresh halaman API
5. Cari bagian `chat` → `id` untuk mendapatkan Group Chat ID

### 5. Konfigurasi di .env
Buka file `.env` di project Anda dan update:

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=8395409805:AAE6anMkfkfUiyfsuskeqmnIF_wfhniCM6w
TELEGRAM_ADMIN_CHAT_ID=8079389732
TELEGRAM_GROUP_CHAT_ID=-1001234567890  # Ganti dengan Group Chat ID yang Anda dapatkan
```

### 6. Restart Server
Setelah mengubah konfigurasi, restart server:

```bash
npm install
node setup_database.js
npm start
```

## Cara Kerja Notifikasi

### Notifikasi yang akan dikirim ke Grup:
- ✅ Notifikasi saat guru izin keluar (check-out)
- ✅ Notifikasi saat guru kembali (check-in)
- ✅ Detail durasi izin
- ✅ Nama guru dan jenis pegawai
- ✅ Waktu keluar dan kembali

### Semua anggota grup akan:
- 📱 Menerima notifikasi secara real-time di HP
- 💻 Bisa memantau dari laptop/desktop
- 🔄 Mendapatkan update sinkron di semua perangkat
- 📊 Bisa menggunakan keyboard interaktif di Telegram

## Testing Notifikasi

1. Scan kartu RFID guru di device
2. Periksa grup Telegram - notifikasi harus muncul
3. Coba scan lagi untuk check-in
4. Notifikasi kembali harus muncul di grup

## Troubleshooting

### Bot tidak mengirim pesan ke grup:
- Pastikan bot sudah ditambahkan ke grup
- Pastikan bot memiliki izin untuk mengirim pesan
- Cek Group Chat ID di .env sudah benar
- Pastikan token bot valid

### Chat ID tidak ditemukan:
- Pastikan grup sudah ada pesan (kirim pesan test di grup)
- Coba gunakan @userinfobot untuk mendapatkan Chat ID
- Pastikan format Chat ID benar (harus diawali dengan `-100`)

### Notifikasi tidak muncul di HP:
- Pastikan notifikasi Telegram diaktifkan di HP
- Cek setting notifikasi grup di Telegram
- Pastikan koneksi internet stabil
