const mysql = require('mysql2/promise');

// Database configuration
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'sistem_izin',
    port: 3306
};

async function migrateAutoReturn() {
    let connection;

    try {
        console.log('🔄 Connecting to MySQL server...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to MySQL server');

        console.log('🔄 Adding auto-return columns to teachers table...');

        // Add auto_return_enabled column
        await connection.query(`
            ALTER TABLE teachers
            ADD COLUMN IF NOT EXISTS auto_return_enabled BOOLEAN DEFAULT FALSE
        `);
        console.log('✅ Added auto_return_enabled column');

        // Add auto_return_min_minutes column
        await connection.query(`
            ALTER TABLE teachers
            ADD COLUMN IF NOT EXISTS auto_return_min_minutes INT DEFAULT 20
        `);
        console.log('✅ Added auto_return_min_minutes column');

        // Add auto_return_max_minutes column
        await connection.query(`
            ALTER TABLE teachers
            ADD COLUMN IF NOT EXISTS auto_return_max_minutes INT DEFAULT 30
        `);
        console.log('✅ Added auto_return_max_minutes column');

        // Remove time window columns if they exist (for cleanup)
        try {
            await connection.query(`
                ALTER TABLE teachers
                DROP COLUMN IF EXISTS auto_return_start_time
            `);
            console.log('✅ Removed auto_return_start_time column (if existed)');
        } catch (error) {
            // Column may not exist, that's fine
        }

        try {
            await connection.query(`
                ALTER TABLE teachers
                DROP COLUMN IF EXISTS auto_return_end_time
            `);
            console.log('✅ Removed auto_return_end_time column (if existed)');
        } catch (error) {
            // Column may not exist, that's fine
        }

        console.log('\n✅ Migration completed successfully!');
        console.log('📝 Auto-return columns have been added to the teachers table.');
        console.log('⚠️  Time window columns have been removed (24-hour auto-return enabled).');
        console.log('⚠️  Auto-return settings are now controlled via .env file only.');
        console.log('⚠️  Set AUTO_RETURN_RFID_IDS in .env to specify which RFID IDs use auto-return.');
        console.log('⚠️  Set AUTO_RETURN_MIN_MINUTES and AUTO_RETURN_MAX_MINUTES in .env for duration limits.');
        console.log('⏰ Auto-return works 24 hours based on duration (min-max minutes only).');
        console.log('🔄 Server will sync .env settings to database on startup.');

    } catch (error) {
        console.error('❌ Migration error:', error.message);

        if (error.code === 'ER_DUP_FIELDNAME') {
            console.log('\nℹ️  Some columns may already exist. This is normal if migration was run before.');
        }
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 Database connection closed');
        }
    }
}

migrateAutoReturn();
