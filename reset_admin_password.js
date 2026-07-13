const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

// Database configuration
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'sistem_izin',
    port: 3306
};

async function resetAdminPasswords() {
    try {
        const db = await mysql.createConnection(dbConfig);
        console.log('Database connected');

        // Hash password baru
        const newPassword = 'Skanbara2015';
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        console.log('Password hashed:', hashedPassword);

        // Update admin1
        await db.query(
            'UPDATE users SET password = ? WHERE username = ?',
            [hashedPassword, 'admin1']
        );
        console.log('✅ Password admin1 reset to: Skanbara2015');

        // Update admin2
        await db.query(
            'UPDATE users SET password = ? WHERE username = ?',
            [hashedPassword, 'admin2']
        );
        console.log('✅ Password admin2 reset to: Skanbara2015');

        await db.end();
        console.log('\n✅ Semua password admin berhasil direset!');
        console.log('Username: admin1, Password: Skanbara2015');
        console.log('Username: admin2, Password: Skanbara2015');

    } catch (error) {
        console.error('Error:', error.message);
        console.log('\n❌ Pastikan database sudah dibuat dengan: mysql -u root -p < database/schema.sql');
    }
}

resetAdminPasswords();
