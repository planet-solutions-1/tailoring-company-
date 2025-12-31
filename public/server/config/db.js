// const sqlite3 = require('sqlite3').verbose(); // Moved to local block
const mysql = require('mysql2');
const path = require('path');
const fs = require('fs');

let db;

if (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production') {
    // --- MySQL (Railway) ---
    console.log("-----------------------------------------");
    console.log("Initializing MySQL (Railway/Production)...");

    const connectionConfig = process.env.DATABASE_URL || {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS ? '****' : undefined,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306
    };

    if (typeof connectionConfig === 'object') {
        console.log("DB Config:", JSON.stringify({ ...connectionConfig, password: '****' }));
    } else {
        console.log("Using DATABASE_URL connection string");
    }

    let pool = null;
    let promisePool = null;

    try {
        pool = mysql.createPool(process.env.DATABASE_URL || connectionConfig);
        promisePool = pool.promise();
        console.log("MySQL Pool Created.");

        // Test Connection Immediately
        promisePool.query("SELECT 1").then(() => console.log("MySQL Connection Verified ✅"))
            .catch(e => console.error("MySQL Connection Failed ❌:", e.message));

    } catch (err) {
        console.error("Failed to create MySQL Pool:", err);
    }

    // Map common methods to match SQLite style (helper wrapper)
    // Map common methods to match SQLite style (helper wrapper)
    db = {
        get: async (sql, params, callback) => {
            try {
                if (!promisePool) return callback(new Error("Database not connected (No PromisePool)"));
                // Use .query instead of .execute to avoid "Malformed Packet" errors on Railway proxies
                const [rows] = await promisePool.query(sql, params);
                callback(null, rows ? rows[0] : null);
            } catch (e) { console.error("DB GET Error:", e.message); callback(e, null); }
        },
        all: async (sql, params, callback) => {
            try {
                if (!promisePool) return callback(new Error("Database not connected (No PromisePool)"));
                const [rows] = await promisePool.query(sql, params);
                callback(null, rows || []);
            } catch (e) { console.error("DB ALL Error:", e.message); callback(e, null); }
        },
        run: async (sql, params, callback) => {
            try {
                if (!promisePool) return callback(new Error("Database not connected (No PromisePool)"));
                const [result] = await promisePool.query(sql, params);
                if (callback) callback.call({ lastID: result.insertId, changes: result.affectedRows }, null);
            } catch (e) { console.error("DB RUN Error:", e.message); if (callback) callback(e); }
        },
        logActivity: (userId, username, action, details) => {
            // FIRE AND FORGET - Don't crash
            if (promisePool) {
                promisePool.query("INSERT INTO activity_logs (user_id, username, action, details) VALUES (?, ?, ?, ?)", [userId, username, action, details])
                    .catch(e => console.error("Log failed", e.message));
            }
        },
        // EXPOSE RAW QUERY (Preferred over execute for stability)
        query: async (sql, params) => {
            if (!promisePool) throw new Error("Database not connected");
            return await promisePool.query(sql, params);
        },
        // Keep execute for compatibility but map to query
        execute: async (sql, params) => {
            if (!promisePool) throw new Error("Database not connected");
            return await promisePool.query(sql, params);
        },
        serialize: (callback) => {
            if (callback) callback();
        }
    };

    // Init MySQL Schema
    const initMysql = async () => {
        try {
            const queries = [
                `CREATE TABLE IF NOT EXISTS schools (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    username VARCHAR(255) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    priority VARCHAR(50) DEFAULT 'Normal',
                    status VARCHAR(50) DEFAULT 'Pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,
                `CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    role VARCHAR(50) NOT NULL,
                    school_id INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (school_id) REFERENCES schools(id)
                )`,
                `CREATE TABLE IF NOT EXISTS students (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    school_id INT NOT NULL,
                    roll_no VARCHAR(50),
                    admission_no VARCHAR(50) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    class VARCHAR(50),
                    section VARCHAR(50),
                    house VARCHAR(50),
                    gender VARCHAR(50),
                    order_status VARCHAR(50) DEFAULT 'Pending',
                    is_active BOOLEAN DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (school_id) REFERENCES schools(id)
                )`,
                `CREATE TABLE IF NOT EXISTS access_codes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    school_id INT NOT NULL,
                    code VARCHAR(50) NOT NULL,
                    type VARCHAR(50) NOT NULL,
                    expires_at DATETIME NOT NULL,
                    is_active BOOLEAN DEFAULT 1,
                    created_by INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,
                `CREATE TABLE IF NOT EXISTS measurements (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    student_id INT NOT NULL,
                    data TEXT,
                    remarks TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (student_id) REFERENCES students(id)
                )`,
                `CREATE TABLE IF NOT EXISTS orders (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    student_id INT NOT NULL,
                    status VARCHAR(50) DEFAULT 'Pending',
                    is_packed BOOLEAN DEFAULT 0,
                    priority VARCHAR(50) DEFAULT 'Normal',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (student_id) REFERENCES students(id)
                )`,
                `CREATE TABLE IF NOT EXISTS activity_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT,
                    username VARCHAR(255),
                    action VARCHAR(255),
                    details TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,
                `CREATE TABLE IF NOT EXISTS complaints (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    school_id INT NOT NULL,
                    student_name VARCHAR(255),
                    student_reg_no VARCHAR(255),
                    pattern_name VARCHAR(255),
                    gender VARCHAR(50),
                    issue_type VARCHAR(100),
                    class VARCHAR(50),
                    section VARCHAR(50),
                    house VARCHAR(100),
                    rating INT,
                    comment TEXT,
                    image_url TEXT,
                    reply TEXT,
                    status VARCHAR(50) DEFAULT 'Open',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
                )`,
                `CREATE TABLE IF NOT EXISTS patterns (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    school_id INT NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    consumption DECIMAL(10,2) DEFAULT 0,
                    cloth_details TEXT,
                    special_req TEXT,
                    quantities TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
                )`
            ];

            for (const sql of queries) {
                await promisePool.execute(sql);
            }

            // MySQL Migration: Ensure columns exist (Idempotent)
            const newCols = [
                'student_name VARCHAR(255)', 'student_reg_no VARCHAR(255)', 'pattern_name VARCHAR(255)',
                'gender VARCHAR(50)', 'issue_type VARCHAR(100)', 'class VARCHAR(50)', 'section VARCHAR(50)', 'house VARCHAR(100)'
            ];
            for (const colDef of newCols) {
                try {
                    await promisePool.execute(`ALTER TABLE complaints ADD COLUMN ${colDef}`);
                } catch (e) { }
            }

            // STUDENTS TABLE MIGRATION
            try { await promisePool.execute("ALTER TABLE students ADD COLUMN house VARCHAR(50)"); } catch (e) { }
            try { await promisePool.execute("ALTER TABLE students ADD COLUMN order_status VARCHAR(50) DEFAULT 'Pending'"); } catch (e) { }
            try { await promisePool.execute("ALTER TABLE students ADD COLUMN pattern_id INT"); } catch (e) { }
            try { await promisePool.execute("ALTER TABLE students ADD COLUMN production_data TEXT"); } catch (e) { }

            // MEASUREMENTS MIGRATION
            try { await promisePool.execute("ALTER TABLE measurements ADD COLUMN is_absent TINYINT DEFAULT 0"); } catch (e) { }
            try { await promisePool.execute("ALTER TABLE measurements ADD COLUMN item_quantities TEXT"); } catch (e) { }

            // PATTERNS MIGRATION (Ensure description exists if table was old)
            try { await promisePool.execute("ALTER TABLE patterns ADD COLUMN description TEXT"); } catch (e) { }


            console.log("MySQL Tables Initialized.");

            // Seed OR Reset Admin
            const bcrypt = require('bcryptjs');
            const hash = bcrypt.hashSync('admin123', 10);

            const [rows] = await promisePool.execute("SELECT * FROM users WHERE username = ?", ['admin']);

            if (rows.length === 0) {
                console.log("Seeding Default Admin User (MySQL)...");

                // Check if school exists first to prevent Unique Constraint error
                const [schoolRows] = await promisePool.execute("SELECT id FROM schools WHERE username = ?", ['admin']);
                let schoolId;

                if (schoolRows.length > 0) {
                    schoolId = schoolRows[0].id;
                } else {
                    const [schoolRes] = await promisePool.execute(
                        "INSERT INTO schools (name, username, password_hash, priority, status) VALUES (?, ?, ?, 'Normal', 'Pending')",
                        ['Planet Schools', 'admin', hash]
                    );
                    schoolId = schoolRes.insertId;
                }

                await promisePool.execute(
                    "INSERT INTO users (username, password_hash, role, school_id) VALUES (?, ?, ?, ?)",
                    ['admin', hash, 'company', schoolId]
                );
                console.log("Default Admin Created: admin / admin123");
            } else {
                console.log("Admin exists, resetting password (MySQL)...");
                await promisePool.execute("UPDATE users SET password_hash = ? WHERE username = ?", [hash, 'admin']);
            }

        } catch (e) {
            console.error("MySQL Init Error:", e);
        }
    };
    initMysql();

} else {
    // --- SQLite (Local) ---
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.resolve(__dirname, '../../planet_local.sqlite');
    console.log("Connecting to SQLite (Local)...");

    const sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) console.error('Error opening database:', err.message);
        else {
            console.log('Connected to the SQLite database.');
            initSqliteDb(sqliteDb);
        }
    });

    db = sqliteDb;
    db.logActivity = (userId, username, action, details) => {
        sqliteDb.run("INSERT INTO activity_logs (user_id, username, action, details) VALUES (?, ?, ?, ?)", [userId, username, action, details], (err) => {
            if (err) console.error("Log Error:", err);
        });
    };
}

function initSqliteDb(database) {
    const schema = `
        CREATE TABLE IF NOT EXISTS schools (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            priority TEXT DEFAULT 'Normal',
            status TEXT DEFAULT 'Pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            school_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id)
        );
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_id INTEGER NOT NULL,
            roll_no TEXT,
            admission_no TEXT NOT NULL,
            name TEXT NOT NULL,
            class TEXT,
            section TEXT,
            house TEXT,
            gender TEXT,
            is_active BOOLEAN DEFAULT 1,
            order_status TEXT DEFAULT 'Pending', 
            pattern_id INTEGER,
            production_data TEXT, 
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id)
        );
        CREATE TABLE IF NOT EXISTS access_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            type TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            is_active BOOLEAN DEFAULT 1,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS measurements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            data TEXT,
            remarks TEXT,
            is_absent INTEGER DEFAULT 0,
            item_quantities TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students(id)
        );
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            status TEXT DEFAULT 'Pending',
            is_packed BOOLEAN DEFAULT 0,
            priority TEXT DEFAULT 'Normal',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students(id)
        );
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            action TEXT,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS complaints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_id INTEGER NOT NULL,
            student_name TEXT,
            student_reg_no TEXT,
            pattern_name TEXT,
            gender TEXT,
            issue_type TEXT,
            class TEXT,
            section TEXT,
            house TEXT,
            rating INTEGER,
            comment TEXT,
            image_url TEXT,
            reply TEXT,
            status TEXT DEFAULT 'Open',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (school_id) REFERENCES schools(id)
        );
        CREATE TABLE IF NOT EXISTS patterns (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             school_id INTEGER NOT NULL,
             name TEXT NOT NULL,
             description TEXT,
             consumption REAL DEFAULT 0,
             cloth_details TEXT,
             special_req TEXT,
             quantities TEXT,
             created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
             FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
        );
    `;
    database.exec(schema, (err) => {
        if (err) console.error(err);
        else {
            // SQLite Auto-Migration (Columns that might be missing on old DBs)
            database.run("ALTER TABLE schools ADD COLUMN priority TEXT DEFAULT 'Normal'", () => { });
            database.run("ALTER TABLE schools ADD COLUMN status TEXT DEFAULT 'Pending'", () => { });

            // Students
            database.run("ALTER TABLE students ADD COLUMN order_status TEXT DEFAULT 'Pending'", () => { });
            database.run("ALTER TABLE students ADD COLUMN pattern_id INTEGER", () => { });
            database.run("ALTER TABLE students ADD COLUMN production_data TEXT", () => { });

            // Measurements
            database.run("ALTER TABLE measurements ADD COLUMN is_absent INTEGER DEFAULT 0", () => { });
            database.run("ALTER TABLE measurements ADD COLUMN item_quantities TEXT", () => { });

            // Patterns
            database.run("ALTER TABLE patterns ADD COLUMN description TEXT", () => { });


            // Complaints Migration
            ['student_name', 'student_reg_no', 'pattern_name', 'gender', 'issue_type', 'class', 'section', 'house'].forEach(col => {
                database.run(`ALTER TABLE complaints ADD COLUMN ${col} TEXT`, () => { });
            });

            database.get("SELECT count(*) as count FROM users", (err, row) => {
                if (row && row.count == 0) {
                    console.log("Seeding Default Admin User (SQLite)...");
                    const bcrypt = require('bcryptjs');
                    const hash = bcrypt.hashSync('admin123', 10);

                    database.run("INSERT INTO schools (name, username, password_hash, priority, status) VALUES (?, ?, ?, 'Normal', 'Pending')",
                        ['Planet Schools', 'admin', hash], function (err) {
                            if (!err) {
                                const schoolId = this.lastID;
                                database.run("INSERT INTO users (username, password_hash, role, school_id) VALUES (?, ?, ?, ?)",
                                    ['admin', hash, 'company', schoolId]);
                                console.log("Default Admin Created: admin / admin123");
                            }
                        });
                } else {
                    // Check if admin exists and reset pass
                    const bcrypt = require('bcryptjs');
                    const hash = bcrypt.hashSync('admin123', 10);
                    database.run("UPDATE users SET password_hash = ? WHERE username = 'admin'", [hash], (err) => {
                        if (!err) console.log("Admin password reset (SQLite)...");
                    });
                }
            });
        }
    });
}

module.exports = db;
// Force Git Update Timestamp: 123456789

