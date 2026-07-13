const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Database configuration (tanpa password untuk default)
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    port: 3306
};

async function setupDatabase() {
    let connection;

    try {
        console.log('🔄 Connecting to MySQL server...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to MySQL server');

        // Read schema.sql
        const schemaPath = path.join(__dirname, 'database', 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        console.log('🔄 Creating database and tables...');
        await connection.query(schema);
        console.log('✅ Database and tables created successfully');

        // Insert default admin if not exists
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash('Skanbara2015', 10);

        await connection.query(`
            INSERT INTO users (username, password, full_name, role)
            VALUES ('admin', ?, 'Administrator', 'admin')
            ON DUPLICATE KEY UPDATE username=username
        `, [hashedPassword]);

        console.log('✅ Default admin account created/updated');
        console.log('📝 Username: admin');
        console.log('📝 Password: Skanbara2015');
        console.log('⚠️  Please change the password after first login!');

    } catch (error) {
        console.error('❌ Error setting up database:', error.message);

        if (error.code === 'ECONNREFUSED') {
            console.log('\n🔧 Troubleshooting:');
            console.log('1. Make sure MySQL server is running');
            console.log('2. Check if MySQL is installed');
            console.log('3. Verify MySQL port (default: 3306)');
            console.log('4. If using XAMPP, start Apache and MySQL from XAMPP Control Panel');
            console.log('5. If using MySQL directly, start MySQL service');
        }

    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 Database connection closed');
        }
    }
}

setupDatabase();
