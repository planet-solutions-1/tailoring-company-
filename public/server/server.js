require('dotenv').config();
console.log("--- SYSTEM RESTART v1.2.0 ---");
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

// Fix: Import DB and Auth for SQL Support (Relative)
const db = require('./config/db');
const { authenticateToken } = require('./middleware/auth');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken'); // Required for verification

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cookieParser()); // Enable Cookie Parsing

// ---------------------------------------------------------
// SECURITY: COOKIE AUTH GUARD (Blocks Unauthorized Page Access)
// ---------------------------------------------------------
const requireCookieAuth = (req, res, next) => {
    // 1. Check Cookie
    const token = req.cookies.token;

    if (!token) {
        // No Token -> Redirect to Login
        return res.redirect('/login');
    }

    // 2. Verify Token
    jwt.verify(token, 'hardcoded_secret_key_fixed', (err, user) => {
        if (err) {
            // Invalid/Expired -> Redirect to Login
            return res.redirect('/login');
        }
        // Valid -> Attach User & Proceed
        req.user = user;
        next();
    });
};

// Security: Rate Limiters
// 1. Strict Limiter for Login (Anti-Brute Force)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 requests per windowMs
    message: { error: "Too many login attempts, please try again after 15 minutes" },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// 2. General Limiter for API (Anti-DDoS)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // Limit each IP to 300 requests per windowMs
    message: { error: "Too many requests from this IP, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
});

// Trust Proxy (Required for Rate Limit behind Revers Proxy like Railway)
app.set('trust proxy', 1);

// Fix: Increase Body Limit (Fixing 413 Error for Large Syncs)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Apply Limiters
app.use('/api/auth/login', loginLimiter); // Apply strict limit to login
app.use('/api/', apiLimiter); // Apply general limit to all API routes

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

// ---------------------------------------------------------
// SECURITY: WAF-LITE (SQL Injection Blocker)
// ---------------------------------------------------------
const sqlBlocker = (req, res, next) => {
    const maliciousPatterns = [
        /\bUNION\s+SELECT\b/i,
        /\bDROP\s+TABLE\b/i,
        /\bDELETE\s+FROM\b/i,
        /\bINSERT\s+INTO\b/i,
        /\bUPDATE\s+\w+\s+SET\b/i,
        /(\%27)|(\')|(\-\-)|(\%23)|(#)/i // Basic check for comments/quotes in odd places (Be careful with false positives in text)
    ];

    // Less aggressive regex for text content, strict for structure
    const strictPatterns = [
        /\bUNION\s+SELECT\b/i,
        /\bDROP\s+TABLE\b/i,
        /\bDELETE\s+FROM\b/i
    ];

    const check = (input) => {
        if (!input) return false;
        const str = typeof input === 'string' ? input : JSON.stringify(input);
        return strictPatterns.some(regex => regex.test(str));
    };

    if (check(req.body) || check(req.query) || check(req.params)) {
        console.warn(`[WAF] Blocked Malicious Request from ${req.ip}`);
        return res.status(403).json({ error: "Security Alert: Malicious Pattern Detected" });
    }
    next();
};

app.use(sqlBlocker);

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    hsts: true, // Enable HSTS for HTTPS security
    frameguard: { action: 'deny' } // Prevent Clickjacking
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

// 1. School Details (SQL Version - Fixed 404 & Added RBAC)
app.get('/api/schools/:id', authenticateToken, (req, res) => {
    // RBAC Check
    if (req.user.role !== 'company' && parseInt(req.user.schoolId) !== parseInt(req.params.id)) {
        return res.status(403).json({ error: "Access Denied: You can only view your own school." });
    }

    // Prevent Caching of Status/Priority
    res.set('Cache-Control', 'no-store');
    db.get("SELECT id, name, username, priority, status, is_locked, lock_message FROM schools WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) res.json(row);
        else res.json({ id: req.params.id, name: "Unknown School", address: "N/A", logo: "" });
    });
});

// GET /api/schools - For Select Dropdowns
app.get('/api/schools', authenticateToken, (req, res) => {
    if (req.user.role === 'company') {
        db.all("SELECT id, name FROM schools ORDER BY name ASC", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    } else {
        // School/Tailor can only see themselves
        db.all("SELECT id, name FROM schools WHERE id = ?", [req.user.schoolId], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    }
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

            // === PRODUCTION TRACKING TABLES (MySQL) ===
            await db.execute(`CREATE TABLE IF NOT EXISTS production_config (
                id INT AUTO_INCREMENT PRIMARY KEY,
                dress_type VARCHAR(255) UNIQUE,
                s_labels TEXT,
                p_labels TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);

            await db.execute(`CREATE TABLE IF NOT EXISTS production_groups (
                id INT AUTO_INCREMENT PRIMARY KEY,
                group_name VARCHAR(255),
                dress_type VARCHAR(255),
                required_stages TEXT,
                details TEXT,
                status VARCHAR(50) DEFAULT 'Active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);

            await db.execute(`CREATE TABLE IF NOT EXISTS production_progress (
                id INT AUTO_INCREMENT PRIMARY KEY,
                group_id INT UNIQUE,
                current_stage INT DEFAULT 0,
                completed_stages TEXT,
                notes TEXT,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (group_id) REFERENCES production_groups(id) ON DELETE CASCADE
            )`);

            res.json({ message: "Schema Fixed: Measurements & Production Tables Created." });
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

                // === PRODUCTION TRACKING TABLES (SQLite) ===
                db.run(`CREATE TABLE IF NOT EXISTS production_config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    dress_type TEXT UNIQUE,
                    s_labels TEXT,
                    p_labels TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS production_groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_name TEXT,
                    dress_type TEXT,
                    required_stages TEXT,
                    details TEXT,
                    status TEXT DEFAULT 'Active',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

                db.run(`CREATE TABLE IF NOT EXISTS production_progress (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_id INTEGER UNIQUE,
                    current_stage INTEGER DEFAULT 0,
                    completed_stages TEXT,
                    notes TEXT,
                    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(group_id) REFERENCES production_groups(id) ON DELETE CASCADE
                )`);
            });
            res.json({ message: "SQLite Schema Fixed (Inc. Production)." });
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
const productionRoutes = require('./routes/rebuild_production');

console.log("Mounting /api/auth, /api/data, /api/public, and /api/production routes...");
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/production', productionRoutes);
// Admin & Backup Routes
const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

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

// ---------------------------------------------------------
// URL MASKING & CLEAN ROUTES (Security Feature)
// ---------------------------------------------------------

// 1. Block Direct Access to .html files (Force Clean URLs)
app.use((req, res, next) => {
    if (req.path.endsWith('.html')) {
        return res.status(404).send('Not Found (Security Mask Active)');
    }
    next();
});

// 2. Map Clean Routes to Html Files (PROTECTED)
app.get('/company', requireCookieAuth, (req, res) => res.sendFile(path.join(__dirname, '../company_dashboard.html')));
app.get('/school', requireCookieAuth, (req, res) => res.sendFile(path.join(__dirname, '../school_dashboard.html')));
app.get('/production', requireCookieAuth, (req, res) => res.sendFile(path.join(__dirname, '../production_dashboard.html')));
app.get('/packing', requireCookieAuth, (req, res) => res.sendFile(path.join(__dirname, '../packing_dashboard.html')));
app.get('/tailor', requireCookieAuth, (req, res) => res.sendFile(path.join(__dirname, '../planet_editor.html')));
app.get('/admin', requireCookieAuth, (req, res) => res.sendFile(path.join(__dirname, '../admin_dashboard.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../login.html')));

app.get('/api/health', async (req, res) => {
    try {
        await db.query("SELECT 1");
        res.json({ status: 'ok', database: 'connected', time: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ status: 'error', database: e.message });
    }
});

// Serve Static Files (CSS, JS, Images) - Excluding HTML due to blocker above
app.use(express.static(path.join(__dirname, '../')));

// Root Route -> Login
app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.redirect('/login');
});

// Remove old explicit fallback routes since we have mapped them above
// app.get('/company_dashboard.html', ...); // Removed
// app.get('/school_dashboard.html', ...); // Removed
// app.get('/packing_dashboard.html', ...); // Removed

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

    // Auto-Cleanup Logs & Trash Every 24 Hours
    setInterval(() => {
        console.log("Running Auto-Cleanup Job (Logs & Trash)...");

        // 1. Logs > 7 Days
        const logDays = 7;
        let logSql;
        if (db.execute) logSql = "DELETE FROM activity_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)";
        else logSql = "DELETE FROM activity_logs WHERE created_at < date('now', '-' || ? || ' days')";

        // 2. Trash > 5 Days (PERMANENT DELETE)
        const trashDays = 5;
        let trashSchoolSql, trashStudentSql;

        if (db.execute) {
            // MySQL
            trashSchoolSql = "DELETE FROM schools WHERE is_deleted = 1 AND deleted_at < DATE_SUB(NOW(), INTERVAL ? DAY)";
            trashStudentSql = "DELETE FROM students WHERE is_deleted = 1 AND deleted_at < DATE_SUB(NOW(), INTERVAL ? DAY)";

            db.execute(logSql, [logDays]).catch(e => console.error("Log Cleanup Error", e));
            db.execute(trashSchoolSql, [trashDays]).catch(e => console.error("School Trash Cleanup Error", e));
            db.execute(trashStudentSql, [trashDays]).catch(e => console.error("Student Trash Cleanup Error", e));

        } else {
            // SQLite
            trashSchoolSql = "DELETE FROM schools WHERE is_deleted = 1 AND deleted_at < date('now', '-' || ? || ' days')";
            trashStudentSql = "DELETE FROM students WHERE is_deleted = 1 AND deleted_at < date('now', '-' || ? || ' days')";

            db.serialize(() => {
                db.run(logSql, [logDays]);
                db.run(trashSchoolSql, [trashDays]);
                db.run(trashStudentSql, [trashDays]);
            });
        }
    }, 24 * 60 * 60 * 1000); // 24 Hours

    // SCHEMA MIGRATION: Ensure Soft Delete Columns Exist
    setTimeout(async () => {
        const softDeleteCols = [
            "ALTER TABLE schools ADD COLUMN is_deleted BOOLEAN DEFAULT 0",
            "ALTER TABLE schools ADD COLUMN deleted_at TIMESTAMP",
            "ALTER TABLE students ADD COLUMN is_deleted BOOLEAN DEFAULT 0",
            "ALTER TABLE students ADD COLUMN deleted_at TIMESTAMP"
        ];

        for (const sql of softDeleteCols) {
            try {
                if (db.execute) await db.execute(sql);
                else {
                    await new Promise((resolve, reject) => {
                        db.run(sql, (err) => err ? reject(err) : resolve());
                    });
                }
            } catch (e) { /* Ignore 'duplicate column' errors */ }
        }
        console.log("Schema Check: Soft Delete columns ensured.");
    }, 5000); // Wait 5s for DB connection
});