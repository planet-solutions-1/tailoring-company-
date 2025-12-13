-- Schools Table
CREATE TABLE IF NOT EXISTS schools (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users Table (Company Admin, Packing Unit, etc.)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('company', 'tailor', 'packing', 'school') NOT NULL,
    school_id INT, -- Nullable, only for school-specific users
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL
);

-- Access Codes (Temporary access for Tailors/Packing)
CREATE TABLE IF NOT EXISTS access_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    school_id INT NOT NULL,
    code VARCHAR(50) NOT NULL,
    type ENUM('editor', 'packing') NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Students Table
CREATE TABLE IF NOT EXISTS students (
    id INT AUTO_INCREMENT PRIMARY KEY,
    school_id INT NOT NULL,
    roll_no VARCHAR(50),
    admission_no VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    class VARCHAR(50),
    section VARCHAR(50),
    house VARCHAR(100),
    gender VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
    UNIQUE KEY unique_adm_school (school_id, admission_no)
);

-- Measurements Table
CREATE TABLE IF NOT EXISTS measurements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    -- Upper Measurements
    u1 VARCHAR(20), u2 VARCHAR(20), u3 VARCHAR(20), u4 VARCHAR(20),
    u5 VARCHAR(20), u6 VARCHAR(20), u7 VARCHAR(20), u8 VARCHAR(20),
    -- Lower Measurements
    l1 VARCHAR(20), l2 VARCHAR(20), l3 VARCHAR(20), l4 VARCHAR(20),
    l5 VARCHAR(20), l6 VARCHAR(20), l7 VARCHAR(20), l8 VARCHAR(20),
    remarks TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- Orders / Status Table
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    status ENUM('Pending', 'Stitching', 'Completed') DEFAULT 'Pending',
    is_packed BOOLEAN DEFAULT FALSE,
    priority ENUM('Low', 'Normal', 'High') DEFAULT 'Normal',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);
