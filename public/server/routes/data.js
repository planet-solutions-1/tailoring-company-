const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

// Helper: Check Lock Status
const checkLock = async (req, res, schoolId) => {
    // Company overrides lock? (Optional: user wants to block "Teachers")
    // If strict lock is needed even for Admin, remove this line. 
    // REMOVED: if (req.user.role === 'company') return false; 

    return new Promise((resolve) => {
        const sql = "SELECT is_locked, lock_message FROM schools WHERE id = ?";
        const cb = (err, row) => {
            if (err || !row) resolve(false);
            else if (row.is_locked || row.is_locked === 1) {
                res.status(403).json({ error: "School is LOCKED: " + (row.lock_message || "Data modification disabled.") });
                resolve(true);
            } else resolve(false);
        };

        if (db.execute) db.execute(sql, [schoolId]).then(([rows]) => cb(null, rows[0])).catch(e => cb(e));
        else db.get(sql, [schoolId], cb);
    });
};

// === GLOBAL SETTINGS ROUTES ===
router.get('/settings', authenticateToken, async (req, res) => {
    try {
        const sql = "SELECT * FROM settings";
        if (db.execute) {
            const [rows] = await db.execute(sql);
            // Convert to object { key: value }
            const settings = rows.reduce((acc, row) => ({ ...acc, [row.key_name]: row.value }), {});
            res.json(settings);
        } else {
            db.all(sql, [], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                const settings = rows.reduce((acc, row) => ({ ...acc, [row.key_name]: row.value }), {});
                res.json(settings);
            });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/settings', authenticateToken, requireRole('company'), async (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: "Key is required" });

    try {
        const sql = db.execute
            ? "INSERT INTO settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)"
            : "INSERT OR REPLACE INTO settings (key_name, value) VALUES (?, ?)";

        if (db.execute) {
            await db.execute(sql, [key, value]);
            res.json({ success: true });
        } else {
            db.run(sql, [key, value], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// === COMPANY ROUTES ===


// DEBUG ROUTE (Temp)
router.get('/debug', async (req, res) => {
    try {
        const status = {
            env: {
                hasUrl: !!process.env.DATABASE_URL,
                host: process.env.DB_HOST,
                user: process.env.DB_USER,
                db: process.env.DB_NAME
            },
            dbType: db.execute ? 'MySQL' : 'SQLite'
        };

        // Test Query
        await new Promise((resolve, reject) => {
            db.all("SELECT 1 as val", [], (err, rows) => {
                if (err) {
                    status.queryError = err.message;
                    status.queryStack = err.stack;
                    resolve();
                } else {
                    status.queryResult = rows;
                    resolve();
                }
            });
        });

        res.json(status);
    } catch (e) { res.status(500).json({ crash: e.toString() }); }
});

// DEBUG FULL DATA (Temp)
router.get('/debug_full', async (req, res) => {
    try {
        const data = {};
        await new Promise(r => db.all("SELECT * FROM schools", [], (err, rows) => { data.schools = rows; r(); }));
        await new Promise(r => db.all("SELECT * FROM users", [], (err, rows) => { data.users = rows; r(); }));
        await new Promise(r => db.all("SELECT * FROM students", [], (err, rows) => { data.students = rows; r(); }));
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.toString() }); }
});

// GET /api/data/stats - High level metrics
// GET /api/data/stats - High level metrics
router.get('/stats', authenticateToken, requireRole('company'), async (req, res) => {
    const getCount = (sql) => new Promise((resolve, reject) => {
        if (db.execute) {
            // MySQL
            db.execute(sql).then(([rows]) => resolve(rows[0].count)).catch(reject);
        } else {
            // SQLite
            db.get(sql, [], (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        }
    });

    try {
        const [schools, students, packed] = await Promise.all([
            getCount("SELECT COUNT(*) as count FROM schools"),
            getCount("SELECT COUNT(*) as count FROM students WHERE is_active = 1"),
            getCount("SELECT COUNT(*) as count FROM orders WHERE is_packed = 1")
        ]);

        res.json({
            schools,
            students,
            packed,
            pending: students - packed
        });
    } catch (e) {
        console.error("Stats Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/data/schools/:id - Get Single School Details (for Lock Status)
router.get('/schools/:id', authenticateToken, (req, res) => {
    const id = req.params.id;
    // Allow Company or the School itself
    if (req.user.role !== 'company' && req.user.schoolId != id) {
        return res.status(403).json({ error: "Unauthorized" });
    }

    const sql = "SELECT id, name, username, priority, status, deadline, is_locked, lock_message FROM schools WHERE id = ?";

    if (db.execute) {
        db.execute(sql, [id]).then(([rows]) => {
            if (rows.length > 0) res.json(rows[0]);
            else res.status(404).json({ error: "School not found" });
        }).catch(err => res.status(500).json({ error: err.message }));
    } else {
        db.get(sql, [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (row) res.json(row);
            else res.status(404).json({ error: "School not found" });
        });
    }
});

// GET /api/data/schools - List all schools
// GET /api/data/schools - List all schools
router.get('/schools', authenticateToken, requireRole('company'), (req, res) => {
    if (db.execute) {
        db.execute("SELECT * FROM schools").then(([rows]) => res.json(rows)).catch(err => res.status(500).json({ error: err.message }));
    } else {
        db.all("SELECT * FROM schools", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    }
});

// PUT /api/data/schools/:id - Update School Metadata (Priority/Status)
router.put('/schools/:id', authenticateToken, requireRole('company'), (req, res) => {
    const { id } = req.params;
    const { priority, status, start_date, deadline } = req.body;

    // Dynamic Update Query
    const fields = [];
    const params = [];

    if (priority !== undefined) { fields.push("priority = ?"); params.push(priority); }
    if (status !== undefined) { fields.push("status = ?"); params.push(status); }
    if (start_date !== undefined) { fields.push("start_date = ?"); params.push(start_date || null); }
    if (deadline !== undefined) { fields.push("deadline = ?"); params.push(deadline || null); }

    if (fields.length === 0) return res.json({ message: "No fields to update." });

    const sql = `UPDATE schools SET ${fields.join(', ')} WHERE id = ?`;
    params.push(id);

    // Use db.execute if available (MySQL), otherwise db.run (SQLite)
    if (db.execute) {
        db.execute(sql, params)
            .then(([result]) => {
                const affected = result ? result.affectedRows : 'N/A';
                console.log(`[UPDATE DEBUG] ID: ${id} -> Fields: ${fields.length}`);

                // CASCADE UPDATE: If status changed, update ALL Active students for this school
                if (status) {
                    // 1. Backfill missing order rows
                    const backfillSql = `
                        INSERT INTO orders (student_id, status) 
                        SELECT s.id, ? 
                        FROM students s 
                        LEFT JOIN orders o ON s.id = o.student_id 
                        WHERE s.school_id = ? AND s.is_active = 1 AND o.id IS NULL
                     `;
                    // 2. Update existing rows
                    const updateSql = "UPDATE orders SET status = ? WHERE student_id IN (SELECT id FROM students WHERE school_id = ? AND is_active = 1)";

                    db.execute(backfillSql, [status, id])
                        .then(() => db.execute(updateSql, [status, id]))
                        .catch(err => console.error("[BULK UPDATE ERROR]", err));
                }

                if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_SCHOOL', `Updated School #${id}`, req.user.schoolId, req.user.role);
                res.json({ message: "School Updated", debug: { affected } });
            })
            .catch(err => {
                console.error("[UPDATE ERROR]", err);
                res.status(500).json({ error: err.message });
            });
    } else {
        db.run(sql, params, function (err) {
            if (err) return res.status(500).json({ error: err.message });

            // CASCADE UPDATE (SQLite)
            if (status) {
                const backfillSql = `
                    INSERT INTO orders (student_id, status) 
                    SELECT s.id, ? 
                    FROM students s 
                    LEFT JOIN orders o ON s.id = o.student_id 
                    WHERE s.school_id = ? AND s.is_active = 1 AND o.id IS NULL
                 `;
                const updateSql = "UPDATE orders SET status = ? WHERE student_id IN (SELECT id FROM students WHERE school_id = ? AND is_active = 1)";

                db.run(backfillSql, [status, id], () => {
                    db.run(updateSql, [status, id]);
                });
            }

            if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_SCHOOL', `Updated School #${id}`, req.user.schoolId, req.user.role);
            res.json({ message: "School Updated" });
        });
    }
});

// POST /api/data/schools - Create new school
router.post('/schools', authenticateToken, requireRole('company'), async (req, res) => {
    const { name, username, password } = req.body;

    try {
        const hash = await bcrypt.hash(password, 10);

        // 1. Create School
        if (db.execute) {
            // MySQL
            const [schoolRes] = await db.execute(
                "INSERT INTO schools (name, username, password_hash, start_date, deadline) VALUES (?, ?, ?, ?, ?)",
                [name, username, hash, req.body.start_date || null, req.body.deadline || null]
            );
            const schoolId = schoolRes.insertId;

            // 2. Create School Admin User automatically
            await db.execute("INSERT INTO users (username, password_hash, role, school_id) VALUES (?, ?, 'school', ?)", [username, hash, schoolId]);

            res.json({ message: "School and Admin User created successfully", id: schoolId });
        } else {
            // SQLite
            db.run("INSERT INTO schools (name, username, password_hash) VALUES (?, ?, ?)", [name, username, hash], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                const schoolId = this.lastID;

                // 2. Create School Admin User automatically (SQLite)
                db.run("INSERT INTO users (username, password_hash, role, school_id) VALUES (?, ?, 'school', ?)", [username, hash, schoolId], (err) => {
                    if (err) console.error("Auto-User Creation Failed", err);
                });

                res.json({ message: "School created successfully", id: schoolId });
            });
        }

    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/data/school/:id - Update School (Priority/Status)
router.put('/school/:id', authenticateToken, requireRole('company'), (req, res) => {
    const { priority, status } = req.body;
    const { id } = req.params;

    db.run("UPDATE schools SET priority = ?, status = ? WHERE id = ?", [priority, status, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_SCHOOL', `Updated School #${id} -> ${priority} / ${status}`, req.user.schoolId, req.user.role);
        res.json({ message: "School updated" });
    });
});

// POST /api/data/migrate - Manual Schema Migration
// DELETE /api/data/schools/:id - Delete School & Cascade
// DELETE /api/data/schools/:id - Delete School & Cascade
router.delete('/schools/:id', authenticateToken, requireRole('company'), async (req, res) => {
    const { id } = req.params;

    if (db.execute) {
        // MySQL Cascade Delete
        try {
            await db.execute("DELETE FROM measurements WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)", [id]);
            await db.execute("DELETE FROM orders WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)", [id]);
            await db.execute("DELETE FROM patterns WHERE school_id = ?", [id]);
            await db.execute("DELETE FROM users WHERE school_id = ?", [id]);
            await db.execute("DELETE FROM complaints WHERE school_id = ?", [id]);
            await db.execute("DELETE FROM access_codes WHERE school_id = ?", [id]);
            await db.execute("DELETE FROM students WHERE school_id = ?", [id]);
            await db.execute("DELETE FROM schools WHERE id = ?", [id]);

            if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'DELETE_SCHOOL', `Deleted School #${id}`, req.user.schoolId, req.user.role);
            res.json({ message: "School and all related data deleted successfully" });
        } catch (e) {
            console.error("Delete Error", e);
            res.status(500).json({ error: e.message });
        }
    } else {
        // SQLite
        db.serialize(() => {
            db.run("DELETE FROM measurements WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)", [id]);
            db.run("DELETE FROM orders WHERE student_id IN (SELECT id FROM students WHERE school_id = ?)", [id]);
            db.run("DELETE FROM students WHERE school_id = ?", [id]);
            db.run("DELETE FROM patterns WHERE school_id = ?", [id]);
            db.run("DELETE FROM users WHERE school_id = ?", [id]);
            db.run("DELETE FROM complaints WHERE school_id = ?", [id]);
            db.run("DELETE FROM access_codes WHERE school_id = ?", [id]);

            db.run("DELETE FROM schools WHERE id = ?", [id], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'DELETE_SCHOOL', `Deleted School #${id}`, req.user.schoolId, req.user.role);
                res.json({ message: "School and all related data deleted successfully" });
            });
        });
    }
});

// POST /api/data/fix_db - Manual Schema Migration (Renamed from /migrate)
router.post('/fix_db', authenticateToken, requireRole('company'), async (req, res) => {
    try {
        if (db.execute) {
            // MySQL
            try { await db.execute("ALTER TABLE schools ADD COLUMN priority VARCHAR(50) DEFAULT 'Normal'"); } catch (e) { }
            try { await db.execute("ALTER TABLE schools ADD COLUMN status VARCHAR(50) DEFAULT 'Pending'"); } catch (e) { }
            try { await db.execute("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1"); } catch (e) { }
            try { await db.execute("ALTER TABLE schools ADD COLUMN lock_message TEXT"); } catch (e) { }
            try { await db.execute("ALTER TABLE schools ADD COLUMN is_locked BOOLEAN DEFAULT 0"); } catch (e) { }
        } else if (db.run) {
            // SQLite
            db.run("ALTER TABLE schools ADD COLUMN priority TEXT DEFAULT 'Normal'", () => { });
            db.run("ALTER TABLE schools ADD COLUMN status TEXT DEFAULT 'Pending'", () => { });
            db.run("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1", () => { });
            db.run("ALTER TABLE schools ADD COLUMN lock_message TEXT", () => { });
            db.run("ALTER TABLE schools ADD COLUMN is_locked BOOLEAN DEFAULT 0", () => { });
            db.run(`CREATE TABLE IF NOT EXISTS complaints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                school_id INTEGER NOT NULL,
                rating INTEGER,
                comment TEXT,
                image_url TEXT,
                reply TEXT,
                status TEXT DEFAULT 'Open',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
            )`, () => { });

            // Patterns Table
            db.run(`CREATE TABLE IF NOT EXISTS patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                school_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                consumption REAL DEFAULT 0,
                cloth_details TEXT,
                special_req TEXT,
                filters TEXT, 
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
            )`, () => {
                // Migration for existing tables
                db.run("ALTER TABLE patterns ADD COLUMN filters TEXT", () => { });
            });

            // Add pattern_id to students
            db.run("ALTER TABLE students ADD COLUMN pattern_id INTEGER REFERENCES patterns(id) ON DELETE SET NULL", () => { });

        }

        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'MIGRATE_DB', `Triggered manual migration`, req.user.schoolId, req.user.role);
        res.json({ message: "Migration commands sent." });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/data/users/:id/toggle - Toggle User Access
router.put('/users/:id/toggle', authenticateToken, requireRole('company'), (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body; // Expect boolean

    // Prevent disabling self
    if (parseInt(id) === req.user.id) return res.status(400).json({ error: "Cannot disable your own account" });

    db.run("UPDATE users SET is_active = ? WHERE id = ?", [is_active ? 1 : 0, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'TOGGLE_USER', `User #${id} access: ${is_active}`);
        res.json({ message: `User access ${is_active ? 'ENABLED' : 'DISABLED'}` });
    });
});

// PUT /api/data/users/:id/reset-password - Admin Force Reset
router.put('/users/:id/reset-password', authenticateToken, requireRole('company'), async (req, res) => {
    const { id } = req.params;
    const { new_password } = req.body;

    if (!new_password || new_password.length < 4) {
        return res.status(400).json({ error: "Password must be at least 4 chars" });
    }

    try {
        const hash = await bcrypt.hash(new_password, 10);
        db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'RESET_PASSWORD', `Reset password for User #${id}`);
            res.json({ message: "Password reset successfully" });
        });
    } catch (e) {
        res.status(500).json({ error: "Hashing failed" });
    }
});

// PUT /api/data/schools/:id/lock - Toggle Data Lock
router.put('/schools/:id/lock', authenticateToken, requireRole('company'), async (req, res) => {
    const { is_locked, message } = req.body; // Expect boolean or 1/0 + message
    const val = (is_locked === true || is_locked == 1 || is_locked === 'true') ? 1 : 0;
    const msg = message || null;

    try {
        const id = req.params.id;
        if (db.execute) {
            await db.execute("UPDATE schools SET is_locked = ?, lock_message = ? WHERE id = ?", [val, msg, id]);
        } else {
            await new Promise((resolve, reject) => {
                db.run("UPDATE schools SET is_locked = ?, lock_message = ? WHERE id = ?", [val, msg, id], (err) => {
                    if (err) reject(err); else resolve();
                });
            });
        }
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'LOCK_SCHOOL', `School #${id} Lock: ${val}`, req.user.schoolId, req.user.role);
        res.json({ message: `School ${val ? 'Locked' : 'Unlocked'} Successfully` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/data/logs - Activity Logs
// GET /api/data/logs - Activity Logs with Filters
router.get('/logs', authenticateToken, requireRole('company'), (req, res) => {
    const { school_id, user_id, role, start_date, end_date, limit } = req.query;

    let sql = "SELECT * FROM activity_logs WHERE 1=1";
    const params = [];

    // Filters
    if (school_id && school_id !== 'All') {
        sql += " AND school_id = ?";
        params.push(school_id);
    }
    if (user_id && user_id !== 'All') {
        sql += " AND user_id = ?";
        params.push(user_id);
    }
    if (role && role !== 'All') {
        sql += " AND role = ?";
        params.push(role);
    }
    if (start_date) {
        sql += " AND created_at >= ?";
        params.push(`${start_date} 00:00:00`);
    }
    if (end_date) {
        sql += " AND created_at <= ?";
        params.push(`${end_date} 23:59:59`);
    }

    sql += " ORDER BY created_at DESC";

    // If 'limit' is 'none' (for export), don't limit. Else default to 100.
    if (limit !== 'none') {
        sql += " LIMIT 200";
    }

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST /api/data/logs - Client-side Logging (Authenticated)
router.post('/logs', authenticateToken, (req, res) => {
    const { action, details } = req.body;
    if (db.logActivity) {
        db.logActivity(req.user.id, req.user.username, action, details || '', req.user.schoolId, req.user.role);
    }
    res.json({ success: true });
});

// === SCHOOL / EDITOR routes ===

// GET /api/data/students/:schoolId
router.get('/students/:schoolId', authenticateToken, (req, res) => {
    console.log(`GET /students/${req.params.schoolId} hit by ${req.user.username}`);
    const requestedSchoolId = parseInt(req.params.schoolId);
    const user = req.user;

    // RBAC
    if (user.role === 'company') {
        // Allowed 
    } else if (user.role === 'school' && user.schoolId === requestedSchoolId) {
        // Allowed
    } else if ((user.role === 'tailor' || user.role === 'packing') && user.schoolId === requestedSchoolId) {
        // Allowed
    } else {
        return res.sendStatus(403);
    }

    const query = `
        SELECT s.*, 
               m.data as measurements, m.remarks, m.is_absent, m.item_quantities,
               o.status as order_status, o.is_packed, o.priority
        FROM students s
        LEFT JOIN measurements m ON s.id = m.student_id
        LEFT JOIN orders o ON s.id = o.student_id
        WHERE s.school_id = ? AND s.is_active = 1
    `;

    db.all(query, [requestedSchoolId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const students = rows.map(r => {
            if (r.measurements) {
                try { r.measurements = JSON.parse(r.measurements); } catch (e) { }
            }
            if (r.item_quantities) {
                try { r.item_quantities = JSON.parse(r.item_quantities); } catch (e) { }
            }
            return r;
        });
        res.json(students);
    });
});

// POST /api/data/student - Create/Update single student
// POST /api/data/student - Create/Update single student
router.post('/student', authenticateToken, async (req, res) => {
    let { id, school_id, admission_no, roll_no, name, class: cls, section, house, gender } = req.body;

    try {
        // If Update and school_id missing, resolve from DB
        if (id && !school_id) {
            const existing = await new Promise((resolve, reject) => {
                db.get("SELECT school_id FROM students WHERE id = ?", [id], (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });
            if (existing) school_id = existing.school_id;
        }

        if (!school_id) return res.status(400).json({ error: "School ID required" });

        // RBAC Check
        if (req.user.role === 'school' && req.user.schoolId !== school_id) return res.sendStatus(403);
        if (req.user.role === 'tailor' && req.user.schoolId !== school_id) return res.sendStatus(403);

        // Lock Check
        const locked = await checkLock(req, res, school_id);
        if (locked) return;

        // SAFEGUARD: Check for existing Admission No (Upsert Logic)
        if (!id && admission_no && String(admission_no).trim() !== "") {
            const checkSql = "SELECT id FROM students WHERE school_id = ? AND admission_no = ?";
            if (db.execute) {
                const [rows] = await db.execute(checkSql, [school_id, admission_no]);
                if (rows.length > 0) id = rows[0].id;
            } else {
                const row = await new Promise(r => db.get(checkSql, [school_id, admission_no], (e, row) => r(row)));
                if (row) id = row.id;
            }
        }

        if (id) {
            // Update
            db.run("UPDATE students SET roll_no=?, name=?, class=?, section=?, house=?, gender=? WHERE id=?",
                [roll_no, name, cls, section, house, gender, id],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_STUDENT', `Updated student: ${name}`, school_id, req.user.role);
                    res.json({ message: "Updated", id: id });
                }
            );
        } else {
            // Insert
            db.run("INSERT INTO students (school_id, admission_no, roll_no, name, class, section, house, gender) VALUES (?,?,?,?,?,?,?,?)",
                [school_id, admission_no, roll_no, name, cls, section, house, gender],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'CREATE_STUDENT', `Created student: ${name}`, school_id, req.user.role);
                    res.json({ id: this.lastID, message: "Created" });
                }
            );
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/data/students/:id - Delete Student
router.delete('/students/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;

    // Security Check: Find student by ID OR Admission No
    let queryFind = "SELECT id, school_id, name FROM students WHERE admission_no = ?";
    let params = [id];

    if (/^\d+$/.test(id)) {
        queryFind += " OR id = ?";
        params.push(id);
    }

    try {
        // Promisify db.get to await the result
        const row = await new Promise((resolve, reject) => {
            db.get(queryFind, params, (err, r) => {
                if (err) reject(err);
                else resolve(r);
            });
        });

        if (!row) return res.status(404).json({ error: "Student not found" });

        // RBAC: School/Tailor can only delete their own students
        if (req.user.role !== 'company' && req.user.schoolId !== row.school_id) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        // Lock Check
        const locked = await checkLock(req, res, row.school_id);
        if (locked) return;

        // Perform Delete
        const studentId = row.id;

        // Manual Cascade Delete
        // Using db.serialize or chained callbacks (Since we are in async, we can just nest or promise)
        // For simplicity, we keep the callback chain for the deletes as they dont need to return values to us.
        db.run("DELETE FROM measurements WHERE student_id = ?", [studentId], (errMc) => {
            if (errMc) console.error("Warn: Measurement delete failed", errMc.message);
            db.run("DELETE FROM orders WHERE student_id = ?", [studentId], (errOrd) => {
                db.run("DELETE FROM students WHERE id = ?", [studentId], function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'DELETE_STUDENT', `Deleted student: ${row.name}`, studentId && row.school_id ? row.school_id : (req.user.schoolId || req.user.schoolId), req.user.role);
                    res.json({ message: "Student and related data deleted" });
                });
            });
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/data/measurements
// POST /api/data/measurements
router.post('/measurements', authenticateToken, async (req, res) => {
    const { student_id, data, remarks, is_absent, item_quantities } = req.body;

    try {
        // Resolve School ID from Student ID
        const student = await new Promise((resolve, reject) => {
            db.get("SELECT school_id FROM students WHERE id = ?", [student_id], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });

        if (!student) return res.status(404).json({ error: "Student not found" });

        // STRICT Lock Check
        const locked = await checkLock(req, res, student.school_id);
        if (locked) return;

        // Verify Ownership if not Company
        if (req.user.role !== 'company' && req.user.schoolId !== student.school_id) {
            return res.sendStatus(403);
        }

        db.get("SELECT id FROM measurements WHERE student_id = ?", [student_id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });

            const dataStr = JSON.stringify(data);
            const qtyStr = item_quantities ? JSON.stringify(item_quantities) : null;
            const absentVal = is_absent ? 1 : 0;

            if (row) {
                // Update
                db.run("UPDATE measurements SET data = ?, remarks = ?, is_absent = ?, item_quantities = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?",
                    [dataStr, remarks, absentVal, qtyStr, student_id],
                    (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_MEASUREMENTS', `Updated for student #${student_id}`, student.school_id, req.user.role);
                        res.json({ message: "Measurements updated" });
                    }
                );
            } else {
                // Insert
                db.run("INSERT INTO measurements (student_id, data, remarks, is_absent, item_quantities) VALUES (?, ?, ?, ?, ?)",
                    [student_id, dataStr, remarks, absentVal, qtyStr],
                    (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'CREATE_MEASUREMENTS', `Created for student #${student_id}`, student.school_id, req.user.role);
                        res.json({ message: "Measurements saved" });
                    }
                );
            }
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/data/packing
router.post('/packing', authenticateToken, (req, res) => {
    const { student_id, is_packed } = req.body;

    db.get("SELECT id FROM orders WHERE student_id = ?", [student_id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        if (row) {
            db.run("UPDATE orders SET is_packed = ? WHERE student_id = ?", [is_packed ? 1 : 0, student_id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_PACKING', `Student #${student_id} packed: ${is_packed}`);
                res.json({ message: "Packing status updated" });
            });
        } else {
            db.run("INSERT INTO orders (student_id, is_packed) VALUES (?, ?)", [student_id, is_packed ? 1 : 0], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_PACKING', `Student #${student_id} packed: ${is_packed}`);
                res.json({ message: "Packing status created" });
            });
        }
    });
});


// === v5.0 NEW ROUTES ===

// GET /api/data/all_students - Global View (Company Only)
router.get('/all_students', authenticateToken, requireRole('company'), (req, res) => {
    const query = `
        SELECT 
            st.*,
            sc.name as school_name,
            sc.priority as school_priority,
            sc.status as school_status,
            o.status as order_status, 
            o.is_packed, 
            o.priority as order_priority,
            o.priority as order_priority,
            m.data as measurements,
            m.is_absent,
            m.item_quantities,
            p.name as pattern_name,
            p.consumption as pattern_consumption,
            p.quantities as pattern_quantities
        FROM students st
        JOIN schools sc ON st.school_id = sc.id
        LEFT JOIN orders o ON st.id = o.student_id
        LEFT JOIN measurements m ON st.id = m.student_id
        LEFT JOIN patterns p ON st.pattern_id = p.id
        WHERE st.is_active = 1
        ORDER BY sc.name ASC, st.class ASC, st.roll_no ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const students = rows.map(r => {
            if (r.measurements) {
                try { r.measurements = JSON.parse(r.measurements); } catch (e) { }
            }
            if (r.pattern_quantities) {
                try { r.pattern_quantities = JSON.parse(r.pattern_quantities); } catch (e) { }
            }
            if (r.item_quantities) {
                try { r.item_quantities = JSON.parse(r.item_quantities); } catch (e) { }
            }
            return r;
        });
        res.json(students);
    });
});

// GET /api/data/patterns/all - All Patterns (Company)
router.get('/patterns/all', authenticateToken, requireRole('company'), (req, res) => {
    const query = `
        SELECT p.*, s.name as school_name 
        FROM patterns p
        JOIN schools s ON p.school_id = s.id
        ORDER BY p.created_at DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET /api/data/patterns - My Patterns (School/Tailor)
router.get('/patterns', authenticateToken, (req, res) => {
    let schoolId = req.user.schoolId;
    if (req.user.role === 'company') {
        // Company usage: technically they should use /all, but if they hit this, return empty or all?
        // Let's return all for consistency if they use this endpoint.
        return res.redirect('/api/data/patterns/all');
    }

    if (!schoolId) return res.status(403).json({ error: "No School ID" });

    // FIX: Filter out deleted patterns
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    db.all("SELECT * FROM patterns WHERE school_id = ? AND (is_deleted IS NULL OR is_deleted = 0) ORDER BY created_at DESC", [schoolId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST /api/data/patterns - Create Pattern (All Roles)
router.post('/patterns', authenticateToken, async (req, res) => {
    const { name, school_id, description, consumption, cloth_details, special_req, student_admission_nos, filters } = req.body;
    let targetSchoolId = school_id;

    // RBAC: Verify School ID
    if (req.user.role === 'school' || req.user.role === 'tailor') {
        targetSchoolId = req.user.schoolId;
        if (parseInt(school_id) !== parseInt(targetSchoolId)) {
            return res.status(403).json({ error: "Cannot create pattern for another school" });
        }
    }

    if (!targetSchoolId) return res.status(400).json({ error: "School ID required" });

    try {
        // 1. Create Pattern
        const patternId = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO patterns (school_id, name, description, consumption, cloth_details, special_req, filters) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [targetSchoolId, name, description || "", consumption || 0, cloth_details || "", special_req || "", JSON.stringify(filters || {})],
                function (err) {
                    if (err) reject(err); else resolve(this.lastID);
                });
        });

        // 2. Link Students (if provided)
        let updatedCount = 0;
        if (student_admission_nos && Array.isArray(student_admission_nos) && student_admission_nos.length > 0) {
            // Efficiently update students
            const placeholders = student_admission_nos.map(() => '?').join(',');
            const sql = `UPDATE students SET pattern_id = ? WHERE school_id = ? AND admission_no IN (${placeholders})`;

            await new Promise((resolve, reject) => {
                db.run(sql, [patternId, targetSchoolId, ...student_admission_nos], function (err) {
                    if (err) reject(err);
                    else {
                        updatedCount = this.changes;
                        resolve();
                    }
                });
            });
        }

        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'CREATE_PATTERN', `Created Pattern: ${name} (${updatedCount} students)`, targetSchoolId, req.user.role);

        res.json({ message: "Pattern created successfully", id: patternId, students_updated: updatedCount });

    } catch (e) {
        console.error("Pattern Create Error", e);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/users/create - Full User Management
router.post('/users/create', authenticateToken, requireRole('company'), async (req, res) => {
    const { username, password, role, school_id } = req.body;

    // Validate Role
    if (!['company', 'school', 'tailor', 'packing'].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
    }

    try {
        const hash = await bcrypt.hash(password, 10);

        db.run("INSERT INTO users (username, password_hash, role, school_id) VALUES (?, ?, ?, ?)",
            [username, hash, role, school_id || null],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'CREATE_USER', `Created user: ${username} (${role})`);
                res.json({ id: this.lastID, message: "User created successfully" });
            });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/access_codes - Generate Secure Link
router.post('/access_codes', authenticateToken, requireRole('company'), (req, res) => {
    const { school_id, type, expires_in_hours } = req.body;

    // Generate simple 6-char code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Calculate Expiry
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (expires_in_hours || 24));

    db.run("INSERT INTO access_codes (school_id, code, type, expires_at, created_by) VALUES (?, ?, ?, ?, ?)",
        [school_id, code, type, expiresAt.toISOString().slice(0, 19).replace('T', ' '), req.user.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'GENERATE_CODE', `Generated ${type} code for School #${school_id}`);
            res.json({ code, expires_at: expiresAt, message: "Code generated" });
        });
});

// GET /api/access_codes - List Active Codes
router.get('/access_codes', authenticateToken, requireRole('company'), (req, res) => {
    const formattedDate = new Date().toISOString().slice(0, 19).replace('T', ' '); // 'YYYY-MM-DD HH:MM:SS'

    const query = `
        SELECT ac.*, s.name as school_name 
        FROM access_codes ac
        JOIN schools s ON ac.school_id = s.id
        WHERE ac.expires_at > ? AND ac.is_active = 1
        ORDER BY ac.created_at DESC
    `;
    db.all(query, [formattedDate], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET /api/data/users - List All Users
router.get('/users', authenticateToken, requireRole('company'), (req, res) => {
    const query = `
        SELECT u.id, u.username, u.role, u.is_active, u.created_at, s.name as school_name 
        FROM users u 
        LEFT JOIN schools s ON u.school_id = s.id
        ORDER BY u.role ASC, u.created_at DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// PUT /api/data/users/:id - Update User Status
router.put('/users/:id', authenticateToken, requireRole('company'), async (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body;
    const val = is_active ? 1 : 0;

    try {
        if (db.execute) {
            // MySQL
            await db.execute("UPDATE users SET is_active = ? WHERE id = ?", [val, id]);
            res.json({ message: "User status updated" });
        } else if (db.run) {
            // SQLite
            db.run("UPDATE users SET is_active = ? WHERE id = ?", [val, id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "User status updated" });
            });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/data/access_codes/:id/toggle - Toggle Status
router.put('/access_codes/:id/toggle', authenticateToken, requireRole('company'), (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body;

    db.run("UPDATE access_codes SET is_active = ? WHERE id = ?", [is_active ? 1 : 0, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'TOGGLE_CODE', `Toggled Code #${id} -> ${is_active}`);
        res.json({ message: "Status updated" });
    });
});

// === COMPLAINTS ROUTES ===

// GET /api/data/complaints - List All (Company)
router.get('/complaints', authenticateToken, requireRole('company'), (req, res) => {
    const query = `
        SELECT c.*, s.name as school_name 
        FROM complaints c
        JOIN schools s ON c.school_id = s.id
        ORDER BY c.created_at DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST /api/data/complaints - Create (School)
// POST /api/data/complaints - Create (School)
router.post('/complaints', authenticateToken, (req, res) => {
    const {
        student_name, student_reg_no, pattern_name, gender, issue_type, class: cls, section, house,
        rating, comment, image_url
    } = req.body;

    // Auto-detect school ID from user
    const schoolId = req.user.schoolId || req.body.school_id; // Fallback for debug

    if (!schoolId) return res.status(400).json({ error: "School ID required" });

    const sql = `INSERT INTO complaints (
        school_id, student_name, student_reg_no, pattern_name, gender, issue_type, class, section, house,
        rating, comment, image_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [
        schoolId, student_name, student_reg_no, pattern_name, gender, issue_type, cls, section, house,
        rating, comment, image_url
    ];

    db.run(sql, params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'CREATE_COMPLAINT', `Complaint from School #${schoolId}`, schoolId, req.user.role);
        res.json({ id: this.lastID, message: "Complaint Submitted" });
    });
});

// DELETE /api/data/complaints/:id - Delete (School)
router.delete('/complaints/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const schoolId = req.user.schoolId;

    if (!schoolId && req.user.role !== 'company') return res.status(403).json({ error: "Unauthorized" });

    // Allow company to delete too? Maybe just school for now as per request.
    const query = req.user.role === 'company' ? "DELETE FROM complaints WHERE id = ?" : "DELETE FROM complaints WHERE id = ? AND school_id = ?";
    const params = req.user.role === 'company' ? [id] : [id, schoolId];

    db.run(query, params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Not found" });
        res.json({ message: "Deleted successfully" });
    });
});

// PUT /api/data/complaints/:id - Update (School - Edit own complaint)
router.put('/complaints/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const {
        student_name, student_reg_no, pattern_name, gender, issue_type, class: cls, section, house,
        rating, comment, image_url
    } = req.body;
    const schoolId = req.user.schoolId;

    if (!schoolId) return res.status(403).json({ error: "Unauthorized" });

    const sql = `UPDATE complaints SET 
        student_name=?, student_reg_no=?, pattern_name=?, gender=?, issue_type=?, class=?, section=?, house=?,
        rating=?, comment=?, image_url=? 
        WHERE id = ? AND school_id = ?`;

    const params = [
        student_name, student_reg_no, pattern_name, gender, issue_type, cls, section, house,
        rating, comment, image_url, id, schoolId
    ];

    db.run(sql, params, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Not found or unauthorized" });
        res.json({ message: "Updated successfully" });
    });
});

// PUT /api/data/complaints/:id/reply - Reply (Company)
router.put('/complaints/:id/reply', authenticateToken, requireRole('company'), (req, res) => {
    const { id } = req.params;
    const { reply } = req.body; // Status auto-sets to Resolved if reply exists? Optional.

    db.run("UPDATE complaints SET reply = ?, status = 'Resolved' WHERE id = ?", [reply, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'REPLY_COMPLAINT', `Replied to #${id}`, req.user.schoolId, req.user.role);
        res.json({ message: "Reply sent" });
    });
});

// GET /api/data/my_complaints - List School's Own Complaints
router.get('/my_complaints', authenticateToken, (req, res) => {
    // Determine School ID (Role based security)
    let schoolId = null;
    if (req.user.role === 'school') schoolId = req.user.schoolId;
    else if (req.user.role === 'company') schoolId = req.query.school_id; // Company viewing specific?
    else if (req.user.schoolId) schoolId = req.user.schoolId; // Tailor/Packing

    if (!schoolId) return res.status(403).json({ error: "School ID not identified" });

    db.all("SELECT * FROM complaints WHERE school_id = ? ORDER BY created_at DESC", [schoolId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// === PATTERN ROUTES ===

// GET /api/data/patterns/:schoolId
// GET /api/data/patterns/:schoolId - Active Patterns Only
// === DEBUG / REPAIR ROUTES ===
router.post('/debug/fix_trash', authenticateToken, (req, res) => {
    const schoolId = req.user.role === 'company' ? '%' : req.user.schoolId; // Companies fix all
    db.serialize(() => {
        // 1. Fix NULLs -> 0 (Active)
        db.run("UPDATE patterns SET is_deleted = 0 WHERE is_deleted IS NULL", [], (err) => {
            if (err) console.error("Fix NULLs failed", err);

            // 2. Normalize Deleted -> 1
            db.run("UPDATE patterns SET is_deleted = 1 WHERE is_deleted > 0", [], (err2) => {
                res.json({ message: "Trash System Repaired (Schema Normalized)" });
            });
        });
    });
});

// === PATTERN ROUTES ===

// GET /api/data/patterns/:schoolId
// GET /api/data/patterns/:schoolId - Active Patterns Only
router.get('/patterns/:schoolId', authenticateToken, (req, res) => {
    const { schoolId } = req.params;
    // Security check logic omitted for brevity, assuming standard school match
    db.all("SELECT * FROM patterns WHERE school_id = ? AND (is_deleted IS NULL OR is_deleted = 0) ORDER BY created_at DESC", [schoolId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET /api/data/patterns/trash/:schoolId - Trash Patterns Only
router.get('/patterns/trash/:schoolId', authenticateToken, (req, res) => {
    const { schoolId } = req.params;
    if (req.user.role !== 'company' && req.user.schoolId != schoolId) return res.sendStatus(403);

    db.all("SELECT * FROM patterns WHERE school_id = ? AND is_deleted > 0 ORDER BY deleted_at DESC", [schoolId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.delete('/patterns/trash/:schoolId', authenticateToken, (req, res) => {
    const { schoolId } = req.params;
    if (req.user.role !== 'company' && req.user.schoolId != schoolId) return res.sendStatus(403);

    db.run("DELETE FROM patterns WHERE school_id = ? AND is_deleted > 0", [schoolId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Trash Emptied", count: this.changes });
    });
});

router.post('/patterns', authenticateToken, (req, res) => {
    const { school_id, name, description, consumption, cloth_details, special_req, quantities, student_ids, filters, student_admission_nos } = req.body;

    // Ensure quantities/filters are stringified
    let qtyJson = '[]';
    if (quantities) {
        qtyJson = (typeof quantities === 'object') ? JSON.stringify(quantities) : quantities;
    }

    let filtersJson = '{}';
    if (filters) {
        filtersJson = (typeof filters === 'object') ? JSON.stringify(filters) : filters;
    }

    db.serialize(() => {
        db.run("INSERT INTO patterns (school_id, name, description, consumption, cloth_details, special_req, quantities, filters) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [school_id, name, description, consumption, cloth_details, special_req, qtyJson, filtersJson],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                const patternId = this.lastID;

                // Helper to perform linking
                const linkStudents = (idsToLink) => {
                    if (idsToLink && Array.isArray(idsToLink) && idsToLink.length > 0) {
                        const placeholders = idsToLink.map(() => '?').join(',');
                        const sqlLink = `UPDATE students SET pattern_id = ? WHERE id IN (${placeholders})`;
                        const params = [patternId, ...idsToLink];

                        db.run(sqlLink, params, (errLink) => {
                            if (errLink) console.error("Failed to link students to pattern", errLink);
                            res.json({ id: patternId, message: "Pattern Created & Students Linked", count: idsToLink.length });
                        });
                    } else {
                        res.json({ id: patternId, message: "Pattern Created (No students linked)" });
                    }
                };

                // 1. Direct ID Linking (Preferred)
                if (student_ids && Array.isArray(student_ids) && student_ids.length > 0) {
                    linkStudents(student_ids);
                }
                // 2. Admission Number Lookup (Fallback for Sync)
                else if (student_admission_nos && Array.isArray(student_admission_nos) && student_admission_nos.length > 0) {
                    // Look up IDs based on admission numbers and school_id
                    const place = student_admission_nos.map(() => '?').join(',');
                    const sqlLookup = `SELECT id FROM students WHERE school_id = ? AND admission_no IN (${place})`;

                    db.all(sqlLookup, [school_id, ...student_admission_nos], (errLookup, rows) => {
                        if (errLookup) {
                            console.error("Lookup failed", errLookup);
                            return res.json({ id: patternId, message: "Pattern Created but Student Lookup Failed" });
                        }
                        const foundIds = rows.map(r => r.id);
                        linkStudents(foundIds);
                    });
                } else {
                    res.json({ id: patternId, message: "Pattern Created (No students provided)" });
                }
            }
        );
    });
});


// DELETE /api/data/patterns/:id - Delete Pattern & Revert Status
// DELETE /api/data/patterns/:id - SOFT DELETE Pattern
router.delete('/patterns/:id', authenticateToken, (req, res) => {
    const { id } = req.params;

    db.get("SELECT school_id FROM patterns WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Pattern not found" });

        if (req.user.role !== 'company' && row.school_id != req.user.schoolId) {
            return res.status(403).json({ error: "Forbidden: Not your pattern" });
        }

        db.run("UPDATE patterns SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [id], function (err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            if (this.changes === 0) return res.status(404).json({ error: "No changes made (ID not found or already deleted)" });

            // Return new trash count for verification
            db.get("SELECT COUNT(*) as count FROM patterns WHERE school_id = ? AND is_deleted > 0", [row.school_id], (err3, countRow) => {
                res.json({ message: "Pattern moved to Trash", trashCount: countRow ? countRow.count : 0 });
            });
        });
    });
});

// PUT /api/data/patterns/:id/restore - Restore from Trash
router.put('/patterns/:id/restore', authenticateToken, (req, res) => {
    const { id } = req.params;

    db.get("SELECT school_id FROM patterns WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Pattern not found" });

        if (req.user.role !== 'company' && row.school_id != req.user.schoolId) {
            return res.status(403).json({ error: "Forbidden" });
        }

        db.run("UPDATE patterns SET is_deleted = 0, deleted_at = NULL WHERE id = ?", [id], (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ message: "Pattern Restored" });
        });
    });
});

// DELETE /api/data/patterns/:id/permanent - Hard Delete
router.delete('/patterns/:id/permanent', authenticateToken, (req, res) => {
    const { id } = req.params;

    db.get("SELECT school_id FROM patterns WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Pattern not found" });

        if (req.user.role !== 'company' && row.school_id != req.user.schoolId) {
            return res.status(403).json({ error: "Forbidden" });
        }

        db.serialize(() => {
            // 1. Revert Order Status
            db.run("UPDATE orders SET status = 'Pending' WHERE student_id IN (SELECT id FROM students WHERE pattern_id = ?)", [id], (err0) => {
                // 2. Unlink Students
                db.run("UPDATE students SET pattern_id = NULL WHERE pattern_id = ?", [id], (err1) => {
                    // 3. Delete Permanently
                    db.run("DELETE FROM patterns WHERE id = ?", [id], (err2) => {
                        if (err2) return res.status(500).json({ error: err2.message });
                        res.json({ message: "Pattern Deleted Permanently" });
                    });
                });
            });
        });
    });
});

// PUT /api/data/patterns/:id - Update Pattern & Relink Students
router.put('/patterns/:id', authenticateToken, (req, res) => {
    // console.log(`[PUT] Update Pattern ${req.params.id}`, req.body);
    const patternId = req.params.id;
    const { name, description, consumption, cloth_details, special_req, quantities, student_ids } = req.body;

    // 1. Check Ownership First
    db.get("SELECT school_id FROM patterns WHERE id = ?", [patternId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Pattern not found" });

        // Permission: Company or Owner School
        if (req.user.role !== 'company' && row.school_id != req.user.schoolId) {
            return res.status(403).json({ error: "Forbidden: Not your pattern" });
        }

        // Ensure quantities is stringified if it's an object/array, passing raw string if already string
        const qtyJson = (typeof quantities === 'object') ? JSON.stringify(quantities) : (quantities || '[]');

        db.serialize(() => {
            // 2. Update Pattern Fields
            // Handling partial updates if needed, but for now we assume full payload or at least name/desc
            const sql = "UPDATE patterns SET name=?, description=?, consumption=?, cloth_details=?, special_req=?, quantities=? WHERE id=?";
            const params = [
                name || row.name, // Fallback to existing if undefined
                description || row.description,
                consumption !== undefined ? consumption : row.consumption,
                cloth_details !== undefined ? cloth_details : row.cloth_details,
                special_req !== undefined ? special_req : row.special_req,
                qtyJson,
                patternId
            ];

            db.run(sql, params, function (errUpd) {
                if (errUpd) {
                    console.error("Pattern Update Error:", errUpd);
                    return res.status(500).json({ error: errUpd.message });
                }

                // 3. Relink Students (Only if student_ids provided)
                if (student_ids && Array.isArray(student_ids)) {
                    // A. Unlink all students currently linked to this pattern
                    db.run("UPDATE students SET pattern_id = NULL WHERE pattern_id = ?", [patternId], (errUnlink) => {
                        if (errUnlink) console.error("Unlink error", errUnlink);

                        // B. Link new list (if any)
                        if (student_ids.length > 0) {
                            const placeholders = student_ids.map(() => '?').join(',');
                            const sqlLink = `UPDATE students SET pattern_id = ? WHERE id IN (${placeholders})`;
                            const linkParams = [patternId, ...student_ids];
                            db.run(sqlLink, linkParams, (errLink) => {
                                if (errLink) return res.status(500).json({ error: "Failed to relink students" });
                                res.json({ message: "Pattern Updated & Students Relinked" });
                            });
                        } else {
                            res.json({ message: "Pattern Updated (No students linked)" });
                        }
                    });
                } else {
                    res.json({ message: "Pattern Updated" });
                }
            }
            );
        });
    });
});


// DELETE /api/data/patterns/:id - Delete Pattern
router.delete('/patterns/:id', authenticateToken, (req, res) => {
    const patternId = req.params.id;
    db.serialize(() => {
        // 1. Unlink Students
        db.run("UPDATE students SET pattern_id = NULL WHERE pattern_id = ?", [patternId], (errUnlink) => {
            if (errUnlink) console.error("Unlink on delete error", errUnlink);

            // 2. Delete Pattern
            db.run("DELETE FROM patterns WHERE id = ?", [patternId], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Pattern Deleted" });
            });
        });
    });
});

// POST /api/data/reset_tables - Clear Pattern/Measurement Data (Admin)
router.post('/reset_tables', authenticateToken, requireRole('company'), (req, res) => {
    db.serialize ? db.serialize(runReset) : runReset();

    function runReset() {
        // 1. Clear Measurements
        const q1 = "DELETE FROM measurements";

        // 2. Clear Patterns
        const q2 = "DELETE FROM patterns";

        // 3. Unlink Students
        const q3 = "UPDATE students SET pattern_id = NULL";

        // Execute Sequence
        db.run(q1, [], (err1) => {
            if (err1) return res.status(500).json({ error: "Failed to clear measurements: " + err1.message });

            db.run(q2, [], (err2) => {
                if (err2) return res.status(500).json({ error: "Failed to clear patterns: " + err2.message });

                db.run(q3, [], (err3) => {
                    if (err3) return res.status(500).json({ error: "Failed to unlink students: " + err3.message });

                    if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'RESET_DB', 'Cleared patterns, measurements, and unlinked students.');
                    res.json({ message: "Database Tables Reset Successfully (Patterns & Measurements Cleared)." });
                });
            });
        });
    }
});

// POST /api/data/fix_db - Force Schema Migration (Repair)
router.post('/fix_db', authenticateToken, requireRole('company'), (req, res) => {
    const isMySQL = (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production');
    const logs = [];

    const queries = [];

    // 1. PATTERNS TABLE
    if (isMySQL) {
        queries.push({
            label: "Create Table 'patterns' (MySQL)",
            sql: `CREATE TABLE IF NOT EXISTS patterns (
                id INT AUTO_INCREMENT PRIMARY KEY,
                school_id INT NOT NULL,
                name VARCHAR(255) NOT NULL,
                consumption DECIMAL(10,2) DEFAULT 0,
                cloth_details TEXT,
                special_req TEXT,
                quantities TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
            )`
        });
    } else {
        queries.push({
            label: "Create Table 'patterns' (SQLite)",
            sql: `CREATE TABLE IF NOT EXISTS patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                school_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                consumption REAL DEFAULT 0,
                cloth_details TEXT,
                special_req TEXT,
                quantities TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
            )`
        });
    }

    // 2. ALTER TABLE (Columns) - Try/Catch wrapper logic
    // We can't batch these easily in a transaction loop with this abstraction, so we run sequentially.
    const alters = [
        { label: "Add 'pattern_id' to students", sql: "ALTER TABLE students ADD COLUMN pattern_id INT" },
        { label: "Add 'production_data' to students", sql: "ALTER TABLE students ADD COLUMN production_data TEXT" },
        { label: "Add 'house' to students", sql: "ALTER TABLE students ADD COLUMN house VARCHAR(50)" },
        { label: "Add 'is_packed' to orders", sql: "ALTER TABLE orders ADD COLUMN is_packed TINYINT DEFAULT 0" },
        { label: "Add 'remarks' to measurements", sql: "ALTER TABLE measurements ADD COLUMN remarks TEXT" },
        { label: "Add 'is_absent' to measurements", sql: "ALTER TABLE measurements ADD COLUMN is_absent TINYINT DEFAULT 0" },
        { label: "Add 'is_absent' to measurements", sql: "ALTER TABLE measurements ADD COLUMN is_absent TINYINT DEFAULT 0" },
        { label: "Add 'item_quantities' to measurements", sql: "ALTER TABLE measurements ADD COLUMN item_quantities TEXT" },
        { label: "Add 'description' to patterns", sql: "ALTER TABLE patterns ADD COLUMN description TEXT" },
        { label: "Add 'start_date' to schools", sql: "ALTER TABLE schools ADD COLUMN start_date DATETIME" },
        { label: "Add 'deadline' to schools", sql: "ALTER TABLE schools ADD COLUMN deadline DATETIME" },
        { label: "Add 'is_deleted' to patterns", sql: "ALTER TABLE patterns ADD COLUMN is_deleted TINYINT DEFAULT 0" },
        { label: "Add 'deleted_at' to patterns", sql: "ALTER TABLE patterns ADD COLUMN deleted_at DATETIME NULL" }
    ];

    // Helper to run sequential
    let chain = Promise.resolve();

    // First, Create Tables
    queries.forEach(q => {
        chain = chain.then(() => new Promise(resolve => {
            db.run(q.sql, [], (err) => {
                if (err) logs.push(`❌ ${q.label}: ${err.message}`);
                else logs.push(`✅ ${q.label}: Success`);
                resolve();
            });
        }));
    });

    // Then, Alters
    alters.forEach(q => {
        chain = chain.then(() => new Promise(resolve => {
            db.run(q.sql, [], (err) => {
                // Ignore "duplicate column" errors
                if (err) {
                    if (err.message.includes("duplicate") || err.message.includes("exists")) {
                        logs.push(`ℹ️ ${q.label}: Already exists`);
                    } else {
                        logs.push(`❌ ${q.label}: ${err.message}`);
                    }
                } else {
                    logs.push(`✅ ${q.label}: Success`);
                }
                resolve();
            });
        }));
    });

    chain.then(() => {
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'FIX_DB', 'Ran schema repair.', req.user.schoolId, req.user.role);
        res.json({ message: "Repair Report:\n" + logs.join("\n") });
    }).catch(e => {
        res.status(500).json({ error: "Fatal Repair Error: " + e.message });
    });
});

// Logs & Reports
// Logs & Reports
router.get('/logs', authenticateToken, (req, res) => {
    // Role-Based Access Control logic
    const userRole = req.user.role;
    const userSchoolId = req.user.schoolId;
    const userUsername = req.user.username;

    let { school_id, role, username, days } = req.query;

    // ENFORCE FILTERS based on Role
    if (userRole === 'company') {
        // Company can see all, respect query params
    } else if (userRole === 'school') {
        // School can ONLY see their own school's logs
        school_id = userSchoolId; // Override query
    } else {
        // Tailors/Pattern/Others can ONLY see their own logs
        username = userUsername; // Override query
    }

    let sql = "SELECT * FROM activity_logs WHERE 1=1";
    const params = [];

    if (school_id) { sql += " AND school_id = ?"; params.push(school_id); }
    if (role) { sql += " AND role = ?"; params.push(role); }
    if (username) { sql += " AND username = ?"; params.push(username); }

    // Default to 7 days if not specified, or respect 'days' param
    const retentionDays = days || 7;
    if (db.execute) sql += " AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)";
    else sql += " AND created_at >= date('now', '-' || ? || ' days')";
    params.push(retentionDays);

    sql += " ORDER BY created_at DESC LIMIT 500";

    if (db.execute) {
        db.execute(sql, params).then(([rows]) => res.json(rows)).catch(e => res.status(500).json({ error: e.message }));
    } else {
        db.all(sql, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    }
});

router.post('/logs/cleanup', authenticateToken, requireRole('company'), (req, res) => {
    const days = 7;
    let sql;
    if (db.execute) sql = "DELETE FROM activity_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)";
    else sql = "DELETE FROM activity_logs WHERE created_at < date('now', '-' || ? || ' days')";

    if (db.execute) {
        db.execute(sql, [days]).then(([resHeader]) => {
            res.json({ message: `Cleanup Complete. Deleted logs older than ${days} days.`, affected: resHeader.affectedRows });
        }).catch(e => res.status(500).json({ error: e.message }));
    } else {
        db.run(sql, [days], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: `Cleanup Complete.`, affected: this.changes });
        });
    }
});

router.get('/users_report', authenticateToken, requireRole('company'), (req, res) => {
    const sql = `
        SELECT u.id, u.username, u.role, u.created_at, s.name as school_name 
        FROM users u 
        LEFT JOIN schools s ON u.school_id = s.id 
        ORDER BY u.role, s.name
    `;
    if (db.execute) {
        db.execute(sql).then(([rows]) => res.json(rows)).catch(e => res.status(500).json({ error: e.message }));
    } else {
        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    }
});

router.get('/schools/:id/export', authenticateToken, requireRole('company'), async (req, res) => {
    const { id } = req.params;
    try {
        let students = [];
        if (db.execute) {
            const [rows] = await db.execute("SELECT * FROM students WHERE school_id = ?", [id]);
            students = rows;
        } else {
            students = await new Promise((resolve, reject) => {
                db.all("SELECT * FROM students WHERE school_id = ?", [id], (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });
        }

        // Fetch measurements for these students? 
        // For simple export, maybe just student data is enough, or we need to join?
        // Let's get measurements too.
        for (let s of students) {
            if (db.execute) {
                const [m] = await db.execute("SELECT * FROM measurements WHERE student_id = ?", [s.id]);
                s.measurements = m[0] || null;
            } else {
                s.measurements = await new Promise(r => db.get("SELECT * FROM measurements WHERE student_id = ?", [s.id], (e, row) => r(row)));
            }
        }
        res.json(students);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/data/schools/:id/lock - Toggle School Lock & Set Message
router.put('/schools/:id/lock', authenticateToken, requireRole('company'), async (req, res) => {
    const { id } = req.params;
    const { message } = req.body; // Optional message
    const { is_locked } = req.body; // Explicit state

    try {
        const newVal = is_locked ? 1 : 0;

        // Update
        if (db.execute) {
            await db.execute("UPDATE schools SET is_locked = ?, lock_message = ? WHERE id = ?", [newVal, message, id]);
        } else {
            await new Promise((resolve, reject) => {
                db.run("UPDATE schools SET is_locked = ?, lock_message = ? WHERE id = ?", [newVal, message, id], (err) => err ? reject(err) : resolve());
            });
        }
        res.json({ message: "Lock Updated", is_locked: !!newVal });
    } catch (e) {
        console.error("Lock Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// === GLOBAL SETTINGS ===
router.get('/settings', authenticateToken, async (req, res) => {
    try {
        let rows = [];
        if (db.execute) {
            const [r] = await db.execute("SELECT * FROM settings");
            rows = r;
        } else {
            rows = await new Promise((resolve) => db.all("SELECT * FROM settings", [], (err, r) => resolve(r || [])));
        }
        // Convert array to object
        const settings = {};
        rows.forEach(r => settings[r.key_name] = r.value);
        res.json(settings);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/settings', authenticateToken, requireRole('company'), async (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: "Key required" });

    try {
        if (db.execute) {
            // MySQL Upsert
            await db.execute("INSERT INTO settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
        } else {
            // SQLite Upsert
            await new Promise((resolve, reject) => {
                db.run("INSERT OR REPLACE INTO settings (key_name, value) VALUES (?, ?)", [key, value], (err) => err ? reject(err) : resolve());
            });
        }
        res.json({ message: "Saved" });
    } catch (e) {
        console.error("Settings Save Error:", e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
