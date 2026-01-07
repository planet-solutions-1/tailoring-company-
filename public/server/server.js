require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Fix: Import DB and Auth for SQL Support (Relative)
const db = require('./config/db');
const { authenticateToken } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Fix: Increase Body Limit (Fixing 413 Error for Large Syncs)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer Storage
const UPLOAD_PATH = path.join(process.cwd(), 'public', 'uploads');
console.log("Uploads Directory:", UPLOAD_PATH);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });
        cb(null, UPLOAD_PATH);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
}));
app.use(cors());
app.use(morgan('dev'));

// Serve Uploads via Custom Handler
app.get('/uploads/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(UPLOAD_PATH, filename);
    if (fs.existsSync(filepath)) return res.sendFile(filepath);
    res.status(404).json({ error: "File not found" });
});

// Routes

// 1. School Details (SQL Version - Fixes 404)
app.get('/api/schools/:id', (req, res) => {
    // Prevent Caching of Status/Priority
    res.set('Cache-Control', 'no-store');
    db.get("SELECT id, name, username, priority, status, is_locked, lock_message FROM schools WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) res.json(row);
        else res.json({ id: req.params.id, name: "Unknown School", address: "N/A", logo: "" });
    });
});

// EMERGENCY DATABASE RESET (Per User Request)
app.post('/api/admin/reset-database', async (req, res) => {
    const { secret } = req.body;
    // Strict Secret Check since Auth is invalid
    if (secret !== 'force_reset_2025') {
        return res.status(403).json({ error: "Unauthorized: Invalid Secret" });
    }
    // const username = req.user ? req.user.username : "EmergencyAdmin"; 
    const username = "EmergencyAdmin";
    try {
        if (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production') {
            await db.execute("SET FOREIGN_KEY_CHECKS = 0");
            const tables = ['patterns', 'students', 'orders', 'complaints', 'access_codes', 'measurements', 'activity_logs'];
            for (const t of tables) await db.execute(`DROP TABLE IF EXISTS ${t}`);
            await db.execute("SET FOREIGN_KEY_CHECKS = 1");
            res.json({ message: "Database FULL Reset (Inc. Measurements). Restarting..." });
            setTimeout(() => process.exit(0), 1000);
        } else {
            db.serialize(() => {
                const tables = ['patterns', 'students', 'orders', 'complaints', 'access_codes', 'measurements', 'activity_logs'];
                tables.forEach(t => db.run(`DROP TABLE IF EXISTS ${t}`));
            });
            res.json({ message: "SQLite Database Reset." });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// FORCE SCHEMA INIT (To Fix Missing Tables)
app.post('/api/admin/fix-schema', async (req, res) => {
    const { secret } = req.body;
    if (secret !== 'force_reset_2025') return res.status(403).json({ error: "Unauthorized" });

    try {
        const createMeasurements = `CREATE TABLE IF NOT EXISTS measurements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT NOT NULL,
            data TEXT,
            remarks TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_absent TINYINT DEFAULT 0,
            item_quantities TEXT,
            FOREIGN KEY (student_id) REFERENCES students(id)
        )`;

        if (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production') {
            await db.execute(createMeasurements);
            // Ensure schools has lock_message
            try { await db.execute("ALTER TABLE schools ADD COLUMN lock_message TEXT"); } catch (e) { /* Ignore if exists */ }

            // Settings Table
            await db.execute(`CREATE TABLE IF NOT EXISTS settings (
                key_name VARCHAR(50) PRIMARY KEY,
                value TEXT
            )`);
            // Also ensure others just in case
            await db.execute(`CREATE TABLE IF NOT EXISTS students (
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
                pattern_id INT,
                production_data TEXT,
                FOREIGN KEY (school_id) REFERENCES schools(id)
            )`);
            res.json({ message: "Schema Fixed: Measurements Table Created." });
        } else {
            db.serialize(() => {
                db.run(`CREATE TABLE IF NOT EXISTS measurements (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id INTEGER NOT NULL,
                    data TEXT,
                    remarks TEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    is_absent INTEGER DEFAULT 0,
                    item_quantities TEXT,
                    FOREIGN KEY (student_id) REFERENCES students(id)
                )`);
                // Ensure lock_message exists (ignore error if exists)
                db.run("ALTER TABLE schools ADD COLUMN lock_message TEXT", (err) => { });

                // Settings Table for Dynamic Configuration
                db.run(`CREATE TABLE IF NOT EXISTS settings (
                    key_name TEXT PRIMARY KEY,
                    value TEXT
                )`);
            });
            res.json({ message: "SQLite Schema Fixed." });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. Sync Logic (SQL Version - Fixed 413 & Persistence)
app.post('/api/sync', authenticateToken, async (req, res) => {
    const { students } = req.body;

    // Auth Check
    const schoolId = req.user.schoolId;
    if (!schoolId && req.user.role !== 'company') return res.status(403).json({ error: "Unauthorized School ID" });

    if (!Array.isArray(students)) return res.status(400).json({ error: "Invalid data format" });

    // CHECK LOCK
    const checkLock = await new Promise((resolve) => {
        db.get("SELECT is_locked FROM schools WHERE id = ?", [schoolId], (err, row) => resolve(row));
    });
    if (checkLock && checkLock.is_locked) return res.status(403).json({ error: "School Data is Locked by Admin" });

    console.log(`Syncing ${students.length} students for School #${schoolId}...`);

    let successCount = 0;

    // Bulk Insert/Update using Loop (SQLite/MySQL compatible)
    for (const s of students) {

        const roll = s.roll_no || s.roll || '';
        const adm = s.admission_no || s.adm || '';
        const name = s.name || '';
        const cls = s.class || s.std || '';
        const sec = s.section || s.sec || '';
        const house = s.house || '';
        const gender = s.gender || '';

        if (!adm || !name) continue; // Skip invalid

        // Check if exists
        try {
            // Updated Logic: Check by Admission No within School
            await new Promise((resolve, reject) => {
                db.get("SELECT id FROM students WHERE school_id = ? AND admission_no = ?", [schoolId, adm], (err, row) => {
                    if (err) return reject(err);

                    let studentId = null;

                    const afterStudent = (id) => {
                        studentId = id;
                        // Handle Measurements Sync
                        if (s.measurements) {
                            const measData = JSON.stringify(s.measurements);
                            const remarks = s.remarks || "";

                            // Check if measurement exists
                            db.get("SELECT id FROM measurements WHERE student_id = ?", [studentId], (errM, rowM) => {
                                if (!errM) {
                                    const itemQty = s.item_quantities ? JSON.stringify(s.item_quantities) : null;
                                    if (rowM) {
                                        db.run("UPDATE measurements SET data = ?, remarks = ?, item_quantities = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?", [measData, remarks, itemQty, studentId]);
                                    } else {
                                        db.run("INSERT INTO measurements (student_id, data, remarks, item_quantities) VALUES (?, ?, ?, ?)", [studentId, measData, remarks, itemQty]);
                                    }
                                }
                            });
                        }

                        // Handle Pattern Link & Production Data
                        if (s.pattern_id || s.production_data) {
                            const pid = s.pattern_id || null;
                            const pdata = s.production_data ? JSON.stringify(s.production_data) : null;

                            // Build Dynamic Update
                            let sql = "UPDATE students SET ";
                            const params = [];
                            if (pid) { sql += "pattern_id = ?, "; params.push(pid); }
                            if (pdata) { sql += "production_data = ?, "; params.push(pdata); }

                            // Strip trailing comma
                            sql = sql.slice(0, -2);
                            sql += " WHERE id = ?";
                            params.push(studentId);

                            if (params.length > 1) {
                                db.run(sql, params);
                                // Update Order Status if Linked to Pattern
                                if (pid) {
                                    db.run("INSERT INTO orders (student_id, status) VALUES (?, 'Measurement Completed') ON CONFLICT(student_id) DO UPDATE SET status = 'Measurement Completed'", [studentId], (e) => {
                                        // SQLite syntax above works for modern SQLite (3.24+). For Node/MySQL compat (which db.js uses):
                                        // "INSERT ... ON DUPLICATE KEY UPDATE"
                                        // But this abstrction is tricky. Let's do simple Check-Then-Update/Insert 
                                    });
                                    // Safer approach for our abstraction:
                                    db.get("SELECT id FROM orders WHERE student_id = ?", [studentId], (errO, rowO) => {
                                        if (rowO) db.run("UPDATE orders SET status = 'Measurement Completed' WHERE student_id = ?", [studentId]);
                                        else db.run("INSERT INTO orders (student_id, status) VALUES (?, 'Measurement Completed')", [studentId]);
                                    });
                                }
                            }
                        }

                        resolve();
                    };

                    if (row) {
                        // Update
                        db.run("UPDATE students SET roll_no=?, name=?, class=?, section=?, house=?, gender=?, is_active=1 WHERE id=?",
                            [roll, name, cls, sec, house, gender, row.id],
                            (err) => {
                                if (err) reject(err);
                                else afterStudent(row.id);
                            }
                        );
                    } else {
                        // Insert
                        db.run("INSERT INTO students (school_id, admission_no, roll_no, name, class, section, house, gender) VALUES (?,?,?,?,?,?,?,?)",
                            [schoolId, adm, roll, name, cls, sec, house, gender],
                            function (err) {
                                if (err) reject(err);
                                else afterStudent(this.lastID);
                            }
                        );
                    }
                });
            });
            successCount++;
        } catch (e) {
            console.error("Sync Row Error:", e.message);
        }
    }

    res.json({ success: true, count: successCount, message: `Synced ${successCount} students.` });
});


// Serving Helper Routes
const authRoutes = require('./routes/auth_v2');
const dataRoutes = require('./routes/data');
const publicRoutes = require('./routes/public');

console.log("Mounting /api/auth, /api/data, and /api/public routes...");
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/public', publicRoutes);

// UPLOAD ENDPOINT
app.post('/api/data/upload', upload.array('images', 5), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ error: "No files uploaded" });
        const fileUrls = req.files.map(f => `/uploads/${f.filename}`);
        res.json({ urls: fileUrls });
    } catch (err) {
        res.status(500).json({ error: "Upload failed" });
    }
});

// Serve Static Files -> Fix: Use explicit path relative to server.js
app.use(express.static(path.join(__dirname, '../')));

// Basic Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../login.html')); // Adjusted relative path to climb out of public/server
});

// Explicit Dashboard Routes (Fallback for Static Issues)
app.get('/company_dashboard.html', (req, res) => res.sendFile(path.join(__dirname, '../company_dashboard.html')));
app.get('/school_dashboard.html', (req, res) => res.sendFile(path.join(__dirname, '../school_dashboard.html')));
app.get('/packing_dashboard.html', (req, res) => res.sendFile(path.join(__dirname, '../packing_dashboard.html')));


// DEBUG ROUTE (Remove later)
app.get('/debug-fs', (req, res) => {
    const rootDir = path.join(__dirname, '../');
    fs.readdir(rootDir, (err, files) => {
        res.json({
            cwd: process.cwd(),
            __dirname: __dirname,
            rootDir: rootDir,
            files: files || [],
            error: err ? err.message : null
        });
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    // Auto-Cleanup Logs Every 24 Hours
    setInterval(() => {
        console.log("Running Auto-Cleanup for Logs > 7 Days...");
        const days = 7;
        let sql;
        if (db.execute) sql = "DELETE FROM activity_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)";
        else sql = "DELETE FROM activity_logs WHERE created_at < date('now', '-' || ? || ' days')";

        if (db.execute) {
            db.execute(sql, [days]).then(() => console.log("Auto-Cleanup Done")).catch(e => console.error("Auto-Cleanup Error", e));
        } else {
            db.run(sql, [days], (err) => {
                if (err) console.error("Auto-Cleanup Error", err);
                else console.log("Auto-Cleanup Done");
            });
        }
    }, 24 * 60 * 60 * 1000); // 24 Hours
});
