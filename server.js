require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const mqtt = require('mqtt');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

// Timezone Configuration (WITA - Asia/Makassar)
process.env.TZ = 'Asia/Makassar';

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_session_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Database connection
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sistem_izin',
    port: process.env.DB_PORT || 3306
};

let db;

async function connectDB() {
    try {
        db = await mysql.createConnection(dbConfig);
        console.log('Database connected successfully');
    } catch (error) {
        console.error('Database connection error:', error);
    }
}

connectDB();

// Helper function to format duration
function formatDuration(minutes) {
    if (!minutes || minutes === 0) return '-';

    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    const mins = minutes % 60;

    let result = [];
    if (days > 0) result.push(`${days} hari`);
    if (hours > 0) result.push(`${hours} jam`);
    if (mins > 0) result.push(`${mins} menit`);

    return result.join(' ') || '-';
}

// MQTT Connection
const mqttOptions = {
    clientId: process.env.MQTT_CLIENT_ID || 'server_client',
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    rejectUnauthorized: false, // For self-signed certificates
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 1000
};

const mqttClient = mqtt.connect(process.env.MQTT_BROKER || 'mqtt://localhost', mqttOptions);

mqttClient.on('connect', () => {
    console.log('MQTT Connected');
    // Subscribe ke topics dari ESP32
    mqttClient.subscribe(process.env.MQTT_TOPIC_RFID || 'izin/rfid');      // Menerima data RFID scan dari ESP32
    mqttClient.subscribe(process.env.MQTT_TOPIC_STATUS || 'izin/status');  // Menerima status device dari ESP32
    console.log('Subscribed to: ' + (process.env.MQTT_TOPIC_RFID || 'izin/rfid'));
    console.log('Subscribed to: ' + (process.env.MQTT_TOPIC_STATUS || 'izin/status'));
});

mqttClient.on('error', (error) => {
    console.error('MQTT Connection Error:', error);
});

mqttClient.on('reconnect', () => {
    console.log('MQTT Reconnecting...');
});

mqttClient.on('message', async (topic, message) => {
    try {
        const data = JSON.parse(message.toString());
        console.log('MQTT Message:', topic, data);

        if (topic === (process.env.MQTT_TOPIC_RFID || 'izin/rfid')) {
            console.log('Processing RFID scan...');
            await handleRFIDScan(data);
        } else if (topic === (process.env.MQTT_TOPIC_STATUS || 'izin/status')) {
            await handleDeviceStatus(data);
        }

        // Broadcast to all connected clients
        io.emit('mqtt_message', { topic, data });
    } catch (error) {
        console.error('MQTT message error:', error);
    }
});

// Telegram Bot
const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Store user state for step-by-step operations
const userStates = {};

telegramBot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
        await telegramBot.answerCallbackQuery(query.id);

        if (data === 'dashboard') {
            await sendTelegramDashboard(chatId);
        } else if (data === 'add_teacher') {
            await startAddTeacherFlow(chatId);
        } else if (data === 'active_permissions') {
            await sendActivePermissions(chatId);
        } else if (data === 'history') {
            await sendPermissionHistory(chatId);
        } else if (data === 'device_status') {
            await sendDeviceStatus(chatId);
        } else if (data === 'logs') {
            await sendLogs(chatId);
        } else if (data === 'monthly_recap') {
            await startMonthlyRecapFlow(chatId);
        } else if (data === 'time') {
            await sendCurrentTime(chatId);
        } else if (data === 'back_to_menu') {
            await sendTelegramMenu(chatId);
        } else if (data.startsWith('select_month_')) {
            const month = parseInt(data.replace('select_month_', ''));
            userStates[chatId] = { ...userStates[chatId], month };
            await selectYearForRecap(chatId);
        } else if (data.startsWith('select_year_')) {
            const year = parseInt(data.replace('select_year_', ''));
            userStates[chatId] = { ...userStates[chatId], year };
            await selectFormatForRecap(chatId);
        } else if (data === 'format_excel') {
            userStates[chatId] = { ...userStates[chatId], format: 'excel' };
            await processMonthlyRecapWithSelection(chatId);
        } else if (data === 'format_word') {
            userStates[chatId] = { ...userStates[chatId], format: 'word' };
            await processMonthlyRecapWithSelection(chatId);
        } else if (data === 'format_pdf') {
            userStates[chatId] = { ...userStates[chatId], format: 'pdf' };
            await processMonthlyRecapWithSelection(chatId);
        }
    } catch (error) {
        console.error('Callback query error:', error);
    }
});

telegramBot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    try {
        if (text === '/start') {
            await sendTelegramMenu(chatId);
        } else if (text === '/menu') {
            await sendTelegramMenu(chatId);
        } else if (text === '/time') {
            await sendCurrentTime(chatId);
        } else if (userStates[chatId]?.step === 'add_teacher_name') {
            await processAddTeacherName(chatId, text);
        } else if (userStates[chatId]?.step === 'add_teacher_type') {
            await processAddTeacherType(chatId, text);
        } else if (userStates[chatId]?.step === 'add_teacher_rfid') {
            await processAddTeacherRFID(chatId, text);
        } else if (userStates[chatId]?.step === 'add_teacher_phone') {
            await processAddTeacherPhone(chatId, text);
        } else if (text && text.startsWith('REKAP:')) {
            await processMonthlyRecap(chatId, text);
        } else if (text && text.startsWith('ADD_TEACHER:')) {
            await processAddTeacher(chatId, text);
        }
    } catch (error) {
        console.error('Telegram bot error:', error);
        telegramBot.sendMessage(chatId, 'Terjadi kesalahan. Silakan coba lagi.');
    }
});

async function sendTelegramMenu(chatId) {
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📊 Dashboard', callback_data: 'dashboard' },
                    { text: '➕ Tambah Guru', callback_data: 'add_teacher' }
                ],
                [
                    { text: '📋 Guru Sedang Izin', callback_data: 'active_permissions' },
                    { text: '📜 Riwayat Izin', callback_data: 'history' }
                ],
                [
                    { text: '🔧 Status Device', callback_data: 'device_status' },
                    { text: '📝 Logs', callback_data: 'logs' }
                ],
                [
                    { text: '📅 Rekap Bulanan', callback_data: 'monthly_recap' },
                    { text: '🕐 Jam', callback_data: 'time' }
                ]
            ]
        }
    };

    const message = `
🏫 *Sistem Izin Keluar Masuk*

Selamat datang di bot sistem izin keluar masuk guru.

📌 *Menu Utama:*
📊 Dashboard - Lihat statistik hari ini
➕ Tambah Guru - Tambah guru baru
📋 Guru Sedang Izin - Lihat guru yang sedang izin
📜 Riwayat Izin - Lihat riwayat izin
🔧 Status Device - Cek status perangkat IoT
📝 Logs - Lihat logs sistem
📅 Rekap Bulanan - Unduh rekap bulanan
🕐 Jam - Lihat waktu sekarang (WITA)

Pilih menu di bawah ini:
    `;

    await telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
}

async function sendCurrentTime(chatId) {
    const now = new Date();
    const options = {
        timeZone: 'Asia/Makassar',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };

    const timeString = now.toLocaleString('id-ID', options);

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'time' }],
                [{ text: '📊 Dashboard', callback_data: 'dashboard' }],
                [{ text: '🔙 Kembali ke Menu', callback_data: 'back_to_menu' }]
            ]
        }
    };

    await telegramBot.sendMessage(chatId, `
🕐 *Waktu Sekarang (WITA)*

${timeString}

Zona Waktu: Asia/Makassar (WITA)
GMT Offset: UTC+8
    `, { parse_mode: 'Markdown', ...keyboard });
}

async function sendTelegramDashboard(chatId) {
    try {
        const [totalTeachers] = await db.query('SELECT COUNT(*) as total FROM teachers WHERE is_active = true');
        const [todayPermissions] = await db.query(`
            SELECT COUNT(*) as total
            FROM permissions
            WHERE DATE(check_out_time) = CURDATE()
        `);
        const [monthPermissions] = await db.query(`
            SELECT COUNT(*) as total
            FROM permissions
            WHERE MONTH(check_out_time) = MONTH(CURDATE())
            AND YEAR(check_out_time) = YEAR(CURDATE())
        `);
        const [activePermissions] = await db.query(`
            SELECT COUNT(*) as total
            FROM permissions
            WHERE status = 'out'
        `);

        const message = `
📊 *Dashboard*

👥 Total Guru: ${totalTeachers[0].total}
📅 Izin Hari Ini: ${todayPermissions[0].total}
📆 Izin Bulan Ini: ${monthPermissions[0].total}
🚪 Sedang Izin: ${activePermissions[0].total}
        `;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Refresh', callback_data: 'dashboard' }],
                    [{ text: '📋 Guru Sedang Izin', callback_data: 'active_permissions' }],
                    [{ text: '📜 Riwayat Izin', callback_data: 'history' }],
                    [{ text: '🔙 Kembali ke Menu', callback_data: 'back_to_menu' }]
                ]
            }
        };

        await telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
        console.error('Dashboard error:', error);
    }
}

async function startAddTeacherFlow(chatId) {
    userStates[chatId] = { step: 'add_teacher_name' };

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '❌ Batal', callback_data: 'back_to_menu' }]
            ]
        }
    };

    await telegramBot.sendMessage(chatId, `
➕ *Tambah Guru Baru*

Mari tambahkan guru baru dengan langkah-langkah mudah.

📝 *Langkah 1 dari 4: Nama Guru*

Silakan ketik nama lengkap guru:
    `, { parse_mode: 'Markdown', ...keyboard });
}

async function processAddTeacherName(chatId, text) {
    userStates[chatId] = { ...userStates[chatId], name: text, step: 'add_teacher_type' };

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '👨‍🏫 Guru', callback_data: 'type_guru' },
                    { text: '👨‍💼 Pegawai', callback_data: 'type_pegawai' }
                ],
                [
                    { text: '👨‍💻 Staff', callback_data: 'type_staff' },
                    { text: '❌ Batal', callback_data: 'back_to_menu' }
                ]
            ]
        }
    };

    await telegramBot.sendMessage(chatId, `
✅ Nama: ${text}

📝 *Langkah 2 dari 4: Jenis Guru*

Pilih jenis guru:
    `, { parse_mode: 'Markdown', ...keyboard });
}

async function processAddTeacherType(chatId, text) {
    let type;
    if (text === 'Guru' || text === 'type_guru') type = 'guru';
    else if (text === 'Pegawai' || text === 'type_pegawai') type = 'pegawai';
    else if (text === 'Staff' || text === 'type_staff') type = 'staff';
    else {
        await telegramBot.sendMessage(chatId, '❌ Pilihan tidak valid. Silakan pilih dari tombol di atas.');
        return;
    }

    userStates[chatId] = { ...userStates[chatId], type, step: 'add_teacher_rfid' };

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '❌ Batal', callback_data: 'back_to_menu' }]
            ]
        }
    };

    await telegramBot.sendMessage(chatId, `
✅ Nama: ${userStates[chatId].name}
✅ Jenis: ${type}

📝 *Langkah 3 dari 4: RFID ID*

Silakan ketik RFID ID guru (scan kartu RFID):
    `, { parse_mode: 'Markdown', ...keyboard });
}

async function processAddTeacherRFID(chatId, text) {
    const rfidId = text.trim();

    // Check for duplicate RFID
    const [existingRFID] = await db.query(
        'SELECT id FROM teachers WHERE rfid_id = ?',
        [rfidId]
    );

    if (existingRFID.length > 0) {
        await telegramBot.sendMessage(chatId, `❌ Gagal: RFID ID ${rfidId} sudah terdaftar! Silakan coba lagi.`);
        return;
    }

    userStates[chatId] = { ...userStates[chatId], rfidId, step: 'add_teacher_phone' };

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '⏭️ Lewati', callback_data: 'skip_phone' }],
                [{ text: '❌ Batal', callback_data: 'back_to_menu' }]
            ]
        }
    };

    await telegramBot.sendMessage(chatId, `
✅ Nama: ${userStates[chatId].name}
✅ Jenis: ${userStates[chatId].type}
✅ RFID ID: ${rfidId}

📝 *Langkah 4 dari 4: Nomor HP* (Opsional)

Silakan ketik nomor HP guru (atau lewati):
    `, { parse_mode: 'Markdown', ...keyboard });
}

async function processAddTeacherPhone(chatId, text) {
    const phone = text.trim() || null;

    await saveTeacherToDatabase(chatId);
}

async function saveTeacherToDatabase(chatId) {
    const { name, type, rfidId, phone } = userStates[chatId];

    try {
        // Check for duplicate name
        const [existingName] = await db.query(
            'SELECT id FROM teachers WHERE full_name = ?',
            [name]
        );

        if (existingName.length > 0) {
            await telegramBot.sendMessage(chatId, `❌ Gagal: Nama guru ${name} sudah terdaftar!`);
            delete userStates[chatId];
            return;
        }

        await run(
            'INSERT INTO teachers (rfid_id, full_name, employee_type, phone_number, telegram_chat_id) VALUES (?, ?, ?, ?, ?)',
            [rfidId, name, type, phone, null]  // Set to NULL since notifications go to group
        );

        delete userStates[chatId];

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ Tambah Lagi', callback_data: 'add_teacher' }],
                    [{ text: '📊 Dashboard', callback_data: 'dashboard' }],
                    [{ text: '🔙 Kembali ke Menu', callback_data: 'back_to_menu' }]
                ]
            }
        };

        await telegramBot.sendMessage(chatId, `
✅ *Guru Berhasil Ditambahkan!*

👤 Nama: ${name}
📋 Jenis: ${type}
🏷️ RFID ID: ${rfidId}
📱 No HP: ${phone || '-'}

Guru sekarang dapat menggunakan sistem izin keluar masuk.
Notifikasi akan dikirim ke grup Telegram.
        `, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
        console.error('Add teacher error:', error);
        await telegramBot.sendMessage(chatId, '❌ Gagal menambahkan guru. Terjadi kesalahan sistem.');
        delete userStates[chatId];
    }
}

// Handle callback for teacher type selection
telegramBot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === 'type_guru') {
        await processAddTeacherType(chatId, 'Guru');
    } else if (data === 'type_pegawai') {
        await processAddTeacherType(chatId, 'Pegawai');
    } else if (data === 'type_staff') {
        await processAddTeacherType(chatId, 'Staff');
    } else if (data === 'skip_phone') {
        userStates[chatId] = { ...userStates[chatId], phone: null };
        await saveTeacherToDatabase(chatId);
    }
});

async function processAddTeacher(chatId, text) {
    try {
        const data = text.replace('ADD_TEACHER:', '').split(',');
        if (data.length < 3) {
            await telegramBot.sendMessage(chatId, 'Format salah. Gunakan format: ADD_TEACHER:Nama,Jenis,RFID_ID,NoHP');
            return;
        }

        const [name, type, rfidId, phone] = data;

        // Check for duplicate RFID ID
        const [existingRFID] = await db.query(
            'SELECT id FROM teachers WHERE rfid_id = ?',
            [rfidId.trim()]
        );

        if (existingRFID.length > 0) {
            await telegramBot.sendMessage(chatId, `❌ Gagal: RFID ID ${rfidId.trim()} sudah terdaftar!`);
            return;
        }

        // Check for duplicate name
        const [existingName] = await db.query(
            'SELECT id FROM teachers WHERE full_name = ?',
            [name.trim()]
        );

        if (existingName.length > 0) {
            await telegramBot.sendMessage(chatId, `❌ Gagal: Nama guru ${name.trim()} sudah terdaftar!`);
            return;
        }

        await run(
            'INSERT INTO teachers (rfid_id, full_name, employee_type, phone_number, telegram_chat_id) VALUES (?, ?, ?, ?, ?)',
            [rfidId.trim(), name.trim(), type.trim().toLowerCase(), phone?.trim() || null, null]  // Set to NULL since notifications go to group
        );

        await telegramBot.sendMessage(chatId, `✅ Guru ${name} berhasil ditambahkan!`);
    } catch (error) {
        console.error('Add teacher error:', error);
        await telegramBot.sendMessage(chatId, '❌ Gagal menambahkan guru. Terjadi kesalahan sistem.');
    }
}

async function sendActivePermissions(chatId) {
    try {
        const [permissions] = await db.query(`
            SELECT p.*, t.full_name, t.employee_type
            FROM permissions p
            JOIN teachers t ON p.teacher_id = t.id
            WHERE p.status = 'out'
            ORDER BY p.check_out_time DESC
        `);

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Refresh', callback_data: 'active_permissions' }],
                    [{ text: '📊 Dashboard', callback_data: 'dashboard' }],
                    [{ text: '🔙 Kembali ke Menu', callback_data: 'back_to_menu' }]
                ]
            }
        };

        if (permissions.length === 0) {
            await telegramBot.sendMessage(chatId, 'Tidak ada guru yang sedang izin.', keyboard);
            return;
        }

        let message = '📋 *Guru Sedang Izin*\n\n';
        permissions.forEach(p => {
            const durationMinutes = Math.floor((new Date() - new Date(p.check_out_time)) / 60000);
            message += `👤 ${p.full_name} (${p.employee_type})\n`;
            message += `⏰ Keluar: ${p.check_out_time.toLocaleString()}\n`;
            message += `⏱️ Durasi: ${formatDuration(durationMinutes)}\n\n`;
        });

        await telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
        console.error('Active permissions error:', error);
    }
}

async function sendPermissionHistory(chatId) {
    try {
        const [permissions] = await db.query(`
            SELECT p.*, t.full_name, t.employee_type
            FROM permissions p
            JOIN teachers t ON p.teacher_id = t.id
            ORDER BY p.check_out_time DESC
            LIMIT 20
        `);

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Refresh', callback_data: 'history' }],
                    [{ text: '📊 Dashboard', callback_data: 'dashboard' }],
                    [{ text: '🔙 Kembali ke Menu', callback_data: 'back_to_menu' }]
                ]
            }
        };

        if (permissions.length === 0) {
            await telegramBot.sendMessage(chatId, 'Belum ada riwayat izin.', keyboard);
            return;
        }

        let message = '📜 *Riwayat Izin (20 Terakhir)*\n\n';
        permissions.forEach(p => {
            const status = p.status === 'out' ? '🚪 Keluar' : '✅ Kembali';
            message += `${status} - ${p.full_name}\n`;
            message += `📅 ${p.check_out_time.toLocaleString()}\n`;
            if (p.check_in_time) {
                message += `⏰ Kembali: ${p.check_in_time.toLocaleString()}\n`;
                message += `⏱️ Durasi: ${formatDuration(p.duration_minutes)}\n`;
            }
            message += '\n';
        });

        await telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
        console.error('Permission history error:', error);
    }
}

async function sendDeviceStatus(chatId) {
    try {
        const [devices] = await db.query('SELECT * FROM devices ORDER BY last_seen DESC');

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Refresh', callback_data: 'device_status' }],
                    [{ text: '📊 Dashboard', callback_data: 'dashboard' }],
                    [{ text: '🔙 Kembali ke Menu', callback_data: 'back_to_menu' }]
                ]
            }
        };

        if (devices.length === 0) {
            await telegramBot.sendMessage(chatId, 'Tidak ada device terdaftar.', keyboard);
            return;
        }

        let message = '🔧 *Status Device*\n\n';
        devices.forEach(d => {
            const status = d.status === 'online' ? '🟢 Online' : d.status === 'offline' ? '🔴 Offline' : '🟡 Error';
            message += `${status} - ${d.device_name}\n`;
            message += `ID: ${d.device_id}\n`;
            message += `IP: ${d.ip_address || 'N/A'}\n`;
            message += `Terakhir dilihat: ${d.last_seen ? d.last_seen.toLocaleString() : 'N/A'}\n\n`;
        });

        await telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
        console.error('Device status error:', error);
    }
}

async function sendLogs(chatId) {
    try {
        const [logs] = await db.query(`
            SELECT * FROM rfid_logs
            ORDER BY created_at DESC
            LIMIT 20
        `);

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Refresh', callback_data: 'logs' }],
                    [{ text: '📊 Dashboard', callback_data: 'dashboard' }],
                    [{ text: '🔙 Kembali ke Menu', callback_data: 'back_to_menu' }]
                ]
            }
        };

        if (logs.length === 0) {
            await telegramBot.sendMessage(chatId, 'Belum ada logs.', keyboard);
            return;
        }

        let message = '📝 *Logs RFID (20 Terakhir)*\n\n';
        logs.forEach(l => {
            const action = l.action === 'check_out' ? '🚪 Keluar' : l.action === 'check_in' ? '✅ Masuk' : '❓ Unknown';
            message += `${action} - RFID: ${l.rfid_id}\n`;
            message += `📅 ${l.created_at.toLocaleString()}\n`;
            message += `Status: ${l.status}\n\n`;
        });

        await telegramBot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
        console.error('Logs error:', error);
    }
}

// Monthly Recap Handler
async function handleMonthlyRecap(chatId) {
    await telegramBot.sendMessage(chatId, `
📅 Rekap Bulanan

Silakan kirim format:
REKAP:BULAN:TAHUN

Contoh:
REKAP:5:2026 (untuk Mei 2026)
REKAP:12:2026 (untuk Desember 2026)

File Excel akan dikirim setelah rekap selesai.
    `);
}

async function startMonthlyRecapFlow(chatId) {
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    userStates[chatId] = { step: 'select_month', year: currentYear };

    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];

    const monthButtons = [];
    for (let i = 0; i < months.length; i++) {
        monthButtons.push([{ text: months[i], callback_data: `select_month_${i + 1}` }]);
    }
    monthButtons.push([{ text: '❌ Batal', callback_data: 'back_to_menu' }]);

    const keyboard = {
        reply_markup: {
            inline_keyboard: monthButtons
        }
    };

    await telegramBot.sendMessage(chatId, `
📅 *Rekap Bulanan*

Pilih bulan untuk rekap:
    `, { parse_mode: 'Markdown', ...keyboard });
}

async function selectYearForRecap(chatId) {
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 1, currentYear, currentYear + 1];

    const yearButtons = years.map(year => [{ text: year.toString(), callback_data: `select_year_${year}` }]);
    yearButtons.push([{ text: '❌ Batal', callback_data: 'back_to_menu' }]);

    const keyboard = {
        reply_markup: {
            inline_keyboard: yearButtons
        }
    };

    await telegramBot.sendMessage(chatId, `
📅 *Pilih Tahun*

Pilih tahun untuk rekap:
    `, { parse_mode: 'Markdown', ...keyboard });
}

async function selectFormatForRecap(chatId) {
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📊 Excel (.xlsx)', callback_data: 'format_excel' },
                    { text: '📄 Word (.docx)', callback_data: 'format_word' }
                ],
                [
                    { text: '📑 PDF (.pdf)', callback_data: 'format_pdf' }
                ],
                [
                    { text: '❌ Batal', callback_data: 'back_to_menu' }
                ]
            ]
        }
    };

    await telegramBot.sendMessage(chatId, `
📁 *Pilih Format File*

Pilih format file untuk rekap bulanan:
    `, { parse_mode: 'Markdown', ...keyboard });
}

async function selectYearForRecap(chatId) {
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 1, currentYear, currentYear + 1];

    const yearButtons = years.map(year => [{ text: year.toString(), callback_data: `select_year_${year}` }]);
    yearButtons.push([{ text: '❌ Batal', callback_data: 'back_to_menu' }]);

    const keyboard = {
        reply_markup: {
            inline_keyboard: yearButtons
        }
    };

    await telegramBot.sendMessage(chatId, `
📅 *Pilih Tahun*

Pilih tahun untuk rekap:
    `, { parse_mode: 'Markdown', ...keyboard });
}

async function processMonthlyRecapWithSelection(chatId) {
    const { month, year, format = 'excel' } = userStates[chatId];

    try {
        const [permissions] = await db.query(`
            SELECT p.*, t.full_name, t.employee_type
            FROM permissions p
            JOIN teachers t ON p.teacher_id = t.id
            WHERE MONTH(p.check_out_time) = ? AND YEAR(p.check_out_time) = ?
            ORDER BY p.check_out_time DESC
        `, [month, year]);

        if (permissions.length === 0) {
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Coba Bulan Lain', callback_data: 'monthly_recap' }],
                        [{ text: '🔙 Kembali ke Menu', callback_data: 'back_to_menu' }]
                    ]
                }
            };

            await telegramBot.sendMessage(chatId, `❌ Tidak ada data untuk bulan ${month}/${year}`, keyboard);
            delete userStates[chatId];
            return;
        }

        const fs = require('fs');
        const path = require('path');
        const tempDir = path.join(__dirname, 'temp');

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        let filePath, filename, formatName;

        if (format === 'excel') {
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Rekap Bulanan');

            worksheet.columns = [
                { header: 'No', key: 'no' },
                { header: 'Nama', key: 'name' },
                { header: 'Jenis', key: 'type' },
                { header: 'Waktu Keluar', key: 'check_out' },
                { header: 'Waktu Masuk', key: 'check_in' },
                { header: 'Durasi Waktu', key: 'duration' },
                { header: 'Status', key: 'status' }
            ];

            permissions.forEach((p, index) => {
                worksheet.addRow({
                    no: index + 1,
                    name: p.full_name,
                    type: p.employee_type,
                    check_out: p.check_out_time ? p.check_out_time.toLocaleString() : '-',
                    check_in: p.check_in_time ? p.check_in_time.toLocaleString() : '-',
                    duration: formatDuration(p.duration_minutes),
                    status: p.status === 'out' ? 'Keluar' : 'Kembali'
                });
            });

            filename = `rekap_bulanan_${year}_${month}.xlsx`;
            filePath = path.join(tempDir, filename);
            await workbook.xlsx.writeFile(filePath);
            formatName = 'Excel';
        } else if (format === 'word') {
            const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, HeadingLevel } = require('docx');
            const doc = new Document({
                sections: [{
                    properties: {},
                    children: [
                        new Paragraph({
                            text: `Rekap Bulanan ${month}/${year}`,
                            heading: HeadingLevel.HEADING_1,
                            spacing: { after: 200 }
                        }),
                        new Paragraph({
                            text: `Total Data: ${permissions.length} izin`,
                            spacing: { after: 300 }
                        }),
                        new Table({
                            rows: [
                                new TableRow({
                                    children: [
                                        new TableCell({ children: [new Paragraph('No')] }),
                                        new TableCell({ children: [new Paragraph('Nama')] }),
                                        new TableCell({ children: [new Paragraph('Jenis')] }),
                                        new TableCell({ children: [new Paragraph('Waktu Keluar')] }),
                                        new TableCell({ children: [new Paragraph('Waktu Masuk')] }),
                                        new TableCell({ children: [new Paragraph('Durasi Waktu')] }),
                                        new TableCell({ children: [new Paragraph('Status')] })
                                    ]
                                }),
                                ...permissions.map((p, index) => new TableRow({
                                    children: [
                                        new TableCell({ children: [new Paragraph((index + 1).toString())] }),
                                        new TableCell({ children: [new Paragraph(p.full_name)] }),
                                        new TableCell({ children: [new Paragraph(p.employee_type)] }),
                                        new TableCell({ children: [new Paragraph(p.check_out_time ? p.check_out_time.toLocaleString() : '-')] }),
                                        new TableCell({ children: [new Paragraph(p.check_in_time ? p.check_in_time.toLocaleString() : '-')] }),
                                        new TableCell({ children: [new Paragraph(formatDuration(p.duration_minutes))] }),
                                        new TableCell({ children: [new Paragraph(p.status === 'out' ? 'Keluar' : 'Kembali')] })
                                    ]
                                }))
                            ]
                        })
                    ]
                }]
            });

            filename = `rekap_bulanan_${year}_${month}.docx`;
            filePath = path.join(tempDir, filename);
            const buffer = await Packer.toBuffer(doc);
            fs.writeFileSync(filePath, buffer);
            formatName = 'Word';
        } else if (format === 'pdf') {
            const PDFDocument = require('pdfkit');
            const doc = new PDFDocument();
            const chunks = [];

            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => {
                buffer = Buffer.concat(chunks);
                fs.writeFileSync(filePath, buffer);
            });

            filename = `rekap_bulanan_${year}_${month}.pdf`;
            filePath = path.join(tempDir, filename);

            doc.fontSize(20).text(`Rekap Bulanan ${month}/${year}`, { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(`Total Data: ${permissions.length} izin`);
            doc.moveDown();

            doc.fontSize(10);
            permissions.forEach((p, index) => {
                doc.text(`${index + 1}. ${p.full_name} (${p.employee_type})`);
                doc.text(`   Keluar: ${p.check_out_time ? p.check_out_time.toLocaleString() : '-'}`);
                doc.text(`   Masuk: ${p.check_in_time ? p.check_in_time.toLocaleString() : '-'}`);
                doc.text(`   Durasi: ${formatDuration(p.duration_minutes)}`);
                doc.text(`   Status: ${p.status === 'out' ? 'Keluar' : 'Kembali'}`);
                doc.moveDown();
            });

            doc.end();

            await new Promise(resolve => doc.on('end', resolve));
            formatName = 'PDF';
        }

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Rekap Bulan Lain', callback_data: 'monthly_recap' }],
                    [{ text: '📊 Dashboard', callback_data: 'dashboard' }],
                    [{ text: '🔙 Kembali ke Menu', callback_data: 'back_to_menu' }]
                ]
            }
        };

        await telegramBot.sendDocument(chatId, filePath, {}, {
            filename: filename
        });

        await telegramBot.sendMessage(chatId, `
✅ *Rekap Bulanan ${month}/${year} Berhasil!*

📊 Total Data: ${permissions.length} izin
📁 Format: ${formatName}

File telah dikirim. Anda dapat membukanya di perangkat Anda.
        `, { parse_mode: 'Markdown', ...keyboard });

        fs.unlinkSync(filePath);
        delete userStates[chatId];
    } catch (error) {
        console.error('Monthly recap error:', error);
        await telegramBot.sendMessage(chatId, '❌ Gagal membuat rekap bulanan. Terjadi kesalahan sistem.');
        delete userStates[chatId];
    }
}

async function processMonthlyRecap(chatId, text) {
    try {
        const data = text.replace('REKAP:', '').split(':');
        if (data.length !== 2) {
            await telegramBot.sendMessage(chatId, 'Format salah. Gunakan format: REKAP:BULAN:TAHUN');
            return;
        }

        const month = parseInt(data[0]);
        const year = parseInt(data[1]);

        if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
            await telegramBot.sendMessage(chatId, 'Format salah. Bulan harus 1-12 dan tahun harus angka.');
            return;
        }

        const [permissions] = await db.query(`
            SELECT p.*, t.full_name, t.employee_type
            FROM permissions p
            JOIN teachers t ON p.teacher_id = t.id
            WHERE MONTH(p.check_out_time) = ?
            AND YEAR(p.check_out_time) = ?
            ORDER BY p.check_out_time DESC
        `, [month, year]);

        if (permissions.length === 0) {
            await telegramBot.sendMessage(chatId, `Tidak ada data untuk bulan ${month}/${year}`);
            return;
        }

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Rekap Bulanan');

        worksheet.columns = [
            { header: 'No', key: 'no', width: 5 },
            { header: 'Nama', key: 'name', width: 30 },
            { header: 'Jenis', key: 'type', width: 15 },
            { header: 'Waktu Keluar', key: 'check_out', width: 20 },
            { header: 'Waktu Masuk', key: 'check_in', width: 20 },
            { header: 'Durasi (Menit)', key: 'duration', width: 15 },
            { header: 'Status', key: 'status', width: 15 }
        ];

        permissions.forEach((p, index) => {
            worksheet.addRow({
                no: index + 1,
                name: p.full_name,
                type: p.employee_type,
                check_out: p.check_out_time ? p.check_out_time.toLocaleString() : '-',
                check_in: p.check_in_time ? p.check_in_time.toLocaleString() : '-',
                duration: formatDuration(p.duration_minutes),
                status: p.status === 'out' ? 'Keluar' : 'Kembali'
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();

        await telegramBot.sendDocument(chatId, Buffer.from(buffer), {
            filename: `rekap_bulanan_${year}_${month}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        await telegramBot.sendMessage(chatId, `✅ Rekap bulanan ${month}/${year} berhasil dikirim!`);
    } catch (error) {
        console.error('Monthly recap error:', error);
        await telegramBot.sendMessage(chatId, '❌ Gagal membuat rekap bulanan. Terjadi kesalahan sistem.');
    }
}

// RFID Handler
async function handleRFIDScan(data) {
    try {
        const { rfid_id, device_id } = data;
        console.log(`[RFID Scan] RFID ID: ${rfid_id}, Device ID: ${device_id}`);

        // Log the scan
        const [insertResult] = await db.query(
            'INSERT INTO rfid_logs (rfid_id, action, device_id) VALUES (?, ?, ?)',
            [rfid_id, 'unknown', device_id]
        );
        const logId = insertResult.insertId;

        // Find teacher
        const [teachers] = await db.query('SELECT * FROM teachers WHERE rfid_id = ? AND is_active = true', [rfid_id]);

        if (teachers.length === 0) {
            console.log(`[RFID Scan] Teacher not found for RFID ID: ${rfid_id}`);
            await db.query(
                'UPDATE rfid_logs SET status = ?, message = ? WHERE id = ?',
                ['error', 'RFID tidak terdaftar', logId]
            );

            // Send error response to device immediately
            mqttClient.publish(
                process.env.MQTT_TOPIC_RESPONSE || 'izin/response',
                JSON.stringify({
                    rfid_id,
                    action: 'unknown',
                    status: 'error',
                    message: 'RFID tidak terdaftar',
                    teacher_name: ''
                })
            );
            console.log('Published to izin/response:', { rfid_id, action: 'unknown', status: 'error' });
            return;
        }

        const teacher = teachers[0];
        console.log(`[RFID Scan] Teacher found: ${teacher.full_name}`);

        // Check if teacher is currently out
        const [activePermission] = await db.query(
            'SELECT * FROM permissions WHERE teacher_id = ? AND status = ? ORDER BY check_out_time DESC LIMIT 1',
            [teacher.id, 'out']
        );

        let action, status, message, telegramMessage;

        if (activePermission.length > 0) {
            // Check in
            const checkInTime = new Date();
            const checkOutTime = new Date(activePermission[0].check_out_time);
            const durationMinutes = Math.floor((checkInTime - checkOutTime) / 60000);

            await db.query(
                'UPDATE permissions SET check_in_time = ?, duration_minutes = ?, status = ? WHERE id = ?',
                [checkInTime, durationMinutes, 'in', activePermission[0].id]
            );

            action = 'check_in';
            status = 'success';
            message = `${teacher.full_name} telah kembali. Durasi: ${formatDuration(durationMinutes)}`;

            // Format waktu WITA
            const checkInTimeWITA = checkInTime.toLocaleString('id-ID', {
                timeZone: 'Asia/Makassar',
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            const checkOutTimeWITA = checkOutTime.toLocaleString('id-ID', {
                timeZone: 'Asia/Makassar',
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            telegramMessage = `✅ Anda telah kembali

📋 Nama: ${teacher.full_name}
📅 Tanggal Keluar: ${checkOutTimeWITA}
📅 Tanggal Kembali: ${checkInTimeWITA}
⏱️ Durasi Keluar: ${formatDuration(durationMinutes)}

Terima kasih!`;
        } else {
            // Check out
            await db.query(
                'INSERT INTO permissions (teacher_id, check_out_time, status) VALUES (?, ?, ?)',
                [teacher.id, new Date(), 'out']
            );

            action = 'check_out';
            status = 'success';
            message = `${teacher.full_name} izin keluar`;

            // Format waktu WITA
            const checkOutTimeWITA = new Date().toLocaleString('id-ID', {
                timeZone: 'Asia/Makassar',
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            telegramMessage = `🚪 Anda izin keluar

📋 Nama: ${teacher.full_name}
📅 Waktu Keluar: ${checkOutTimeWITA}
📍 Status: Belum Kembali

Jangan lupa tap kartu saat kembali!`;
        }

        // Update log
        await db.query(
            'UPDATE rfid_logs SET teacher_id = ?, action = ?, status = ?, message = ? WHERE id = ?',
            [teacher.id, action, status, message, logId]
        );

        // Send response to device via MQTT IMMEDIATELY (Server → ESP32)
        mqttClient.publish(
            process.env.MQTT_TOPIC_RESPONSE || 'izin/response',
            JSON.stringify({
                rfid_id,
                action,
                status,
                message,
                teacher_name: teacher.full_name
            })
        );
        console.log('Published to izin/response:', { rfid_id, action, status });

        // Send notification to Telegram group asynchronously (fire and forget - don't await)
        const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (groupChatId) {
            telegramBot.sendMessage(groupChatId, telegramMessage)
                .then(() => {
                    console.log(`Telegram notification sent to group (Chat ID: ${groupChatId})`);
                })
                .catch((error) => {
                    console.error(`Failed to send Telegram notification to group:`, error);
                });
        } else {
            console.log(`No Telegram group chat ID configured`);
        }

    } catch (error) {
        console.error('RFID handler error:', error);
    }
}

// Device Status Handler
async function handleDeviceStatus(data) {
    try {
        const { device_id, status, ip_address } = data;

        await db.query(
            `INSERT INTO devices (device_id, device_name, status, ip_address, last_seen)
             VALUES (?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
             status = VALUES(status),
             ip_address = VALUES(ip_address),
             last_seen = VALUES(last_seen)`,
            [device_id, `Device ${device_id}`, status, ip_address]
        );

        console.log(`Device ${device_id} status updated: ${status}, IP: ${ip_address}`);

        // Broadcast device status update to all connected clients
        io.emit('device_status_update', { device_id, status, ip_address });
    } catch (error) {
        console.error('Device status handler error:', error);
    }
}

// Check offline devices (run every 30 seconds)
setInterval(async () => {
    try {
        const [result] = await db.query(
            `UPDATE devices SET status = 'offline'
             WHERE last_seen < DATE_SUB(NOW(), INTERVAL 90 SECOND)
             AND status = 'online'`
        );

        if (result.affectedRows > 0) {
            console.log(`Checked offline devices: ${result.affectedRows} devices marked offline`);

            // Get offline devices and broadcast update
            const [offlineDevices] = await db.query(
                `SELECT device_id, status, ip_address FROM devices WHERE status = 'offline'`
            );

            offlineDevices.forEach(device => {
                io.emit('device_status_update', {
                    device_id: device.device_id,
                    status: device.status,
                    ip_address: device.ip_address
                });
            });
        }
    } catch (error) {
        console.error('Check offline devices error:', error);
    }
}, 30000); // Every 30 seconds

// Socket.IO
io.on('connection', (socket) => {
    console.log('Client connected');

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

// Auth Routes
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = users[0];
        const isValidPassword = await bcrypt.compare(password, user.password);

        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET || 'your_jwt_secret',
            { expiresIn: '24h' }
        );

        req.session.user = {
            id: user.id,
            username: user.username,
            fullName: user.full_name,
            role: user.role
        };

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                fullName: user.full_name,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out successfully' });
});

app.get('/api/me', (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

// Dashboard Routes
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const [totalTeachers] = await db.query('SELECT COUNT(*) as total FROM teachers WHERE is_active = true');
        const [todayPermissions] = await db.query(`
            SELECT COUNT(*) as total 
            FROM permissions 
            WHERE DATE(check_out_time) = CURDATE()
        `);
        const [monthPermissions] = await db.query(`
            SELECT COUNT(*) as total 
            FROM permissions 
            WHERE MONTH(check_out_time) = MONTH(CURDATE()) 
            AND YEAR(check_out_time) = YEAR(CURDATE())
        `);
        const [activePermissions] = await db.query(`
            SELECT COUNT(*) as total 
            FROM permissions 
            WHERE status = 'out'
        `);

        res.json({
            totalTeachers: totalTeachers[0].total,
            todayPermissions: todayPermissions[0].total,
            monthPermissions: monthPermissions[0].total,
            activePermissions: activePermissions[0].total
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Teachers Routes
app.get('/api/teachers', async (req, res) => {
    try {
        const [teachers] = await db.query('SELECT * FROM teachers WHERE is_active = true ORDER BY created_at DESC');
        res.json(teachers);
    } catch (error) {
        console.error('Get teachers error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/teachers', async (req, res) => {
    try {
        const { rfid_id, full_name, employee_type, phone_number, telegram_chat_id } = req.body;

        // Check for duplicate RFID ID
        const [existingRFID] = await db.query(
            'SELECT id FROM teachers WHERE rfid_id = ?',
            [rfid_id]
        );

        if (existingRFID.length > 0) {
            return res.status(400).json({ error: 'RFID ID sudah terdaftar' });
        }

        // Check for duplicate name
        const [existingName] = await db.query(
            'SELECT id FROM teachers WHERE full_name = ?',
            [full_name]
        );

        if (existingName.length > 0) {
            return res.status(400).json({ error: 'Nama guru sudah terdaftar' });
        }

        await db.query(
            'INSERT INTO teachers (rfid_id, full_name, employee_type, phone_number, telegram_chat_id) VALUES (?, ?, ?, ?, ?)',
            [rfid_id, full_name, employee_type, phone_number, null]  // Set to NULL since notifications go to group
        );

        res.json({ message: 'Teacher added successfully' });
    } catch (error) {
        console.error('Add teacher error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/teachers/:id', async (req, res) => {
    try {
        const { full_name, employee_type, phone_number, telegram_chat_id, is_active } = req.body;
        const { id } = req.params;

        await db.query(
            'UPDATE teachers SET full_name = ?, employee_type = ?, phone_number = ?, telegram_chat_id = ?, is_active = ? WHERE id = ?',
            [full_name, employee_type, phone_number, telegram_chat_id, is_active, id]
        );

        res.json({ message: 'Teacher updated successfully' });
    } catch (error) {
        console.error('Update teacher error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/teachers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('UPDATE teachers SET is_active = false WHERE id = ?', [id]);
        res.json({ message: 'Teacher deleted successfully' });
    } catch (error) {
        console.error('Delete teacher error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Permissions Routes
app.get('/api/permissions/active', async (req, res) => {
    try {
        const [permissions] = await db.query(`
            SELECT p.*, t.full_name, t.employee_type, t.phone_number
            FROM permissions p
            JOIN teachers t ON p.teacher_id = t.id
            WHERE p.status = 'out'
            ORDER BY p.check_out_time DESC
        `);

        // Calculate real-time duration
        const permissionsWithDuration = permissions.map(p => ({
            ...p,
            current_duration: Math.floor((new Date() - new Date(p.check_out_time)) / 60000)
        }));

        res.json(permissionsWithDuration);
    } catch (error) {
        console.error('Get active permissions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/permissions/history', async (req, res) => {
    try {
        const { start_date, end_date, teacher_id } = req.query;
        let query = `
            SELECT p.*, t.full_name, t.employee_type
            FROM permissions p
            JOIN teachers t ON p.teacher_id = t.id
            WHERE 1=1
        `;
        const params = [];

        if (start_date) {
            query += ' AND DATE(p.check_out_time) >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND DATE(p.check_out_time) <= ?';
            params.push(end_date);
        }

        if (teacher_id) {
            query += ' AND p.teacher_id = ?';
            params.push(teacher_id);
        }

        query += ' ORDER BY p.check_out_time DESC';

        const [permissions] = await db.query(query, params);
        res.json(permissions);
    } catch (error) {
        console.error('Get permission history error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/permissions/monthly/:year/:month', async (req, res) => {
    try {
        const { year, month } = req.params;

        const [permissions] = await db.query(`
            SELECT p.*, t.full_name, t.employee_type
            FROM permissions p
            JOIN teachers t ON p.teacher_id = t.id
            WHERE MONTH(p.check_out_time) = ?
            AND YEAR(p.check_out_time) = ?
            ORDER BY p.check_out_time DESC
        `, [month, year]);

        res.json(permissions);
    } catch (error) {
        console.error('Get monthly permissions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export Monthly Excel
app.get('/api/permissions/monthly/:year/:month/export/excel', async (req, res) => {
    try {
        const { year, month } = req.params;

        const [permissions] = await db.query(`
            SELECT p.*, t.full_name, t.employee_type
            FROM permissions p
            JOIN teachers t ON p.teacher_id = t.id
            WHERE MONTH(p.check_out_time) = ?
            AND YEAR(p.check_out_time) = ?
            ORDER BY p.check_out_time DESC
        `, [month, year]);

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Rekap Bulanan');

        worksheet.columns = [
            { header: 'No', key: 'no', width: 5 },
            { header: 'Nama', key: 'name', width: 30 },
            { header: 'Jenis', key: 'type', width: 15 },
            { header: 'Waktu Keluar', key: 'check_out', width: 20 },
            { header: 'Waktu Masuk', key: 'check_in', width: 20 },
            { header: 'Durasi (Menit)', key: 'duration', width: 15 },
            { header: 'Status', key: 'status', width: 15 }
        ];

        permissions.forEach((p, index) => {
            worksheet.addRow({
                no: index + 1,
                name: p.full_name,
                type: p.employee_type,
                check_out: p.check_out_time ? p.check_out_time.toLocaleString() : '-',
                check_in: p.check_in_time ? p.check_in_time.toLocaleString() : '-',
                duration: formatDuration(p.duration_minutes),
                status: p.status === 'out' ? 'Keluar' : 'Kembali'
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=rekap_bulanan_${year}_${month}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Export monthly Excel error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export Monthly Word
app.get('/api/permissions/monthly/:year/:month/export/word', async (req, res) => {
    try {
        const { year, month } = req.params;

        const [permissions] = await db.query(`
            SELECT p.*, t.full_name, t.employee_type
            FROM permissions p
            JOIN teachers t ON p.teacher_id = t.id
            WHERE MONTH(p.check_out_time) = ?
            AND YEAR(p.check_out_time) = ?
            ORDER BY p.check_out_time DESC
        `, [month, year]);

        const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx');
        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    new Paragraph({
                        text: `Rekap Bulanan - ${month}/${year}`,
                        heading: 'Heading1',
                        spacing: { after: 200 }
                    }),
                    new Table({
                        rows: [
                            new TableRow({
                                children: [
                                    new TableCell({ children: [new Paragraph('No')] }),
                                    new TableCell({ children: [new Paragraph('Nama')] }),
                                    new TableCell({ children: [new Paragraph('Jenis')] }),
                                    new TableCell({ children: [new Paragraph('Waktu Keluar')] }),
                                    new TableCell({ children: [new Paragraph('Waktu Masuk')] }),
                                    new TableCell({ children: [new Paragraph('Durasi (Menit)')] }),
                                    new TableCell({ children: [new Paragraph('Status')] })
                                ]
                            }),
                            ...permissions.map((p, index) => new TableRow({
                                children: [
                                    new TableCell({ children: [new Paragraph(String(index + 1))] }),
                                    new TableCell({ children: [new Paragraph(p.full_name)] }),
                                    new TableCell({ children: [new Paragraph(p.employee_type)] }),
                                    new TableCell({ children: [new Paragraph(p.check_out_time ? p.check_out_time.toLocaleString() : '-')] }),
                                    new TableCell({ children: [new Paragraph(p.check_in_time ? p.check_in_time.toLocaleString() : '-')] }),
                                    new TableCell({ children: [new Paragraph(formatDuration(p.duration_minutes))] }),
                                    new TableCell({ children: [new Paragraph(p.status === 'out' ? 'Keluar' : 'Kembali')] })
                                ]
                            }))
                        ]
                    })
                ]
            }]
        });

        const buffer = await Packer.toBuffer(doc);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename=rekap_bulanan_${year}_${month}.docx`);

        res.send(buffer);
    } catch (error) {
        console.error('Export monthly Word error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Print Monthly
app.get('/api/permissions/monthly/:year/:month/print', async (req, res) => {
    try {
        const { year, month } = req.params;

        const [permissions] = await db.query(`
            SELECT p.*, t.full_name, t.employee_type
            FROM permissions p
            JOIN teachers t ON p.teacher_id = t.id
            WHERE MONTH(p.check_out_time) = ?
            AND YEAR(p.check_out_time) = ?
            ORDER BY p.check_out_time DESC
        `, [month, year]);

        const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Rekap Bulanan - ${monthNames[month-1]} ${year}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { text-align: center; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; }
                    @media print {
                        body { margin: 0; }
                        table { page-break-inside: auto; }
                        tr { page-break-inside: avoid; }
                    }
                </style>
            </head>
            <body>
                <h1>Rekap Bulanan - ${monthNames[month-1]} ${year}</h1>
                <table>
                    <thead>
                        <tr>
                            <th>No</th>
                            <th>Nama</th>
                            <th>Jenis</th>
                            <th>Waktu Keluar</th>
                            <th>Waktu Masuk</th>
                            <th>Durasi (Menit)</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        permissions.forEach((p, index) => {
            html += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${p.full_name}</td>
                    <td>${p.employee_type}</td>
                    <td>${p.check_out_time ? p.check_out_time.toLocaleString() : '-'}</td>
                    <td>${p.check_in_time ? p.check_in_time.toLocaleString() : '-'}</td>
                    <td>${formatDuration(p.duration_minutes)}</td>
                    <td>${p.status === 'out' ? 'Keluar' : 'Kembali'}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
                <script>window.print();</script>
            </body>
            </html>
        `;

        res.send(html);
    } catch (error) {
        console.error('Print monthly error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Devices Routes
app.get('/api/devices', async (req, res) => {
    try {
        const [devices] = await db.query('SELECT * FROM devices ORDER BY last_seen DESC');
        res.json(devices);
    } catch (error) {
        console.error('Get devices error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Logs Routes
app.get('/api/logs', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const [logs] = await db.query(`
            SELECT rl.*, t.full_name
            FROM rfid_logs rl
            LEFT JOIN teachers t ON rl.teacher_id = t.id
            ORDER BY rl.created_at DESC
            LIMIT ?
        `, [parseInt(limit)]);

        res.json(logs);
    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export Routes
app.get('/api/export/excel', async (req, res) => {
    try {
        const ExcelJS = require('exceljs');
        const { start_date, end_date } = req.query;

        let query = `
            SELECT p.*, t.full_name, t.employee_type
            FROM permissions p
            JOIN teachers t ON p.teacher_id = t.id
            WHERE 1=1
        `;
        const params = [];

        if (start_date) {
            query += ' AND DATE(p.check_out_time) >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND DATE(p.check_out_time) <= ?';
            params.push(end_date);
        }

        query += ' ORDER BY p.check_out_time DESC';

        const [permissions] = await db.query(query, params);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Riwayat Izin');

        worksheet.columns = [
            { header: 'No', key: 'no', width: 5 },
            { header: 'Nama', key: 'name', width: 30 },
            { header: 'Jenis', key: 'type', width: 15 },
            { header: 'Waktu Keluar', key: 'checkout', width: 25 },
            { header: 'Waktu Masuk', key: 'checkin', width: 25 },
            { header: 'Durasi (Menit)', key: 'duration', width: 15 },
            { header: 'Status', key: 'status', width: 15 }
        ];

        permissions.forEach((p, index) => {
            worksheet.addRow({
                no: index + 1,
                name: p.full_name,
                type: p.employee_type,
                checkout: p.check_out_time,
                checkin: p.check_in_time || '-',
                duration: formatDuration(p.duration_minutes),
                status: p.status === 'out' ? 'Keluar' : 'Kembali'
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=riwayat_izin.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Export Excel error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
