-- Create database
CREATE DATABASE IF NOT EXISTS sistem_izin;
USE sistem_izin;

-- Users table (for admin accounts)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role ENUM('admin', 'super_admin') DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Teachers/Employees table
CREATE TABLE IF NOT EXISTS teachers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rfid_id VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    employee_type ENUM('guru', 'pegawai', 'staff') DEFAULT 'guru',
    phone_number VARCHAR(20),
    telegram_chat_id VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Permission/Leave records table
CREATE TABLE IF NOT EXISTS permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    teacher_id INT NOT NULL,
    check_out_time DATETIME NOT NULL,
    check_in_time DATETIME,
    duration_minutes INT,
    status ENUM('out', 'in', 'pending') DEFAULT 'out',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
);

-- RFID Logs table (all RFID scans)
CREATE TABLE IF NOT EXISTS rfid_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rfid_id VARCHAR(50) NOT NULL,
    teacher_id INT,
    action ENUM('check_out', 'check_in', 'unknown') NOT NULL,
    status VARCHAR(50),
    message TEXT,
    device_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
);

-- Devices table (IoT devices)
CREATE TABLE IF NOT EXISTS devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(50) UNIQUE NOT NULL,
    device_name VARCHAR(100) NOT NULL,
    device_type VARCHAR(50) DEFAULT 'ESP32',
    status ENUM('online', 'offline', 'error') DEFAULT 'offline',
    last_seen TIMESTAMP,
    ip_address VARCHAR(50),
    mqtt_topic VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- System logs table
CREATE TABLE IF NOT EXISTS system_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    log_type ENUM('info', 'warning', 'error', 'success') NOT NULL,
    message TEXT NOT NULL,
    source VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default admin accounts
INSERT INTO users (username, password, full_name, role) VALUES
('admin1', '$2a$10$HrUkzOKqRzwm3r.4IOw1ou7tWb2ZIaS7CmuKoSnGI4oayDUgXhlMO', 'Admin 1', 'admin'),
('admin2', '$2a$10$HrUkzOKqRzwm3r.4IOw1ou7tWb2ZIaS7CmuKoSnGI4oayDUgXhlMO', 'Admin 2', 'admin');

-- Note: Default password is 'Skanbara2015' (hashed with bcrypt)
-- Change these passwords after first login
