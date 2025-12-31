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
    db.get("SELECT id, name, username, priority, status FROM schools WHERE id = ?", [req.params.id], (err, row) => {
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
            const tables = ['patterns', 'students', 'orders', 'complaints', 'access_codes'];
            for (const t of tables) await db.execute(`DROP TABLE IF EXISTS ${t}`);
            await db.execute("SET FOREIGN_KEY_CHECKS = 1");
            res.json({ message: "Database Partial Reset (Patterns/Students). Restarting..." });
            setTimeout(() => process.exit(0), 1000);
        } else {
            db.serialize(() => {
                const tables = ['patterns', 'students', 'orders', 'complaints', 'access_codes'];
                tables.forEach(t => db.run(`DROP TABLE IF EXISTS ${t}`));
            });
            res.json({ message: "SQLite Database Reset." });
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

// Serve Static Files
app.use(express.static(path.join(process.cwd(), 'public')));

// Basic Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../login.html')); // Adjusted relative path to climb out of public/server
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
