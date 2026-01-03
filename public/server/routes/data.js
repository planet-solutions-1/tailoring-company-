const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

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
router.get('/stats', authenticateToken, requireRole('company'), (req, res) => {
    db.get("SELECT COUNT(*) as total_schools FROM schools", [], (err, r1) => {
        if (err) return res.status(500).json({ error: err.message });

        db.get("SELECT COUNT(*) as total_students FROM students WHERE is_active = 1", [], (err, r2) => {
            if (err) return res.status(500).json({ error: err.message });

            db.get("SELECT COUNT(*) as packed_count FROM orders WHERE is_packed = 1", [], (err, r3) => {
                if (err) return res.status(500).json({ error: err.message });

                res.json({
                    schools: r1.total_schools,
                    students: r2.total_students,
                    packed: r3.packed_count,
                    pending: r2.total_students - r3.packed_count
                });
            });
        });
    });
});

// GET /api/data/schools - List all schools
router.get('/schools', authenticateToken, requireRole('company'), (req, res) => {
    db.all("SELECT * FROM schools", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// PUT /api/data/schools/:id - Update School Metadata (Priority/Status)
router.put('/schools/:id', authenticateToken, requireRole('company'), (req, res) => {
    const { id } = req.params;
    // Ensure undefined values become null for SQL binding
    const priority = req.body.priority === undefined ? null : req.body.priority;
    const status = req.body.status === undefined ? null : req.body.status;

    const sql = "UPDATE schools SET priority = COALESCE(?, priority), status = COALESCE(?, status) WHERE id = ?";

    // Use db.execute if available (MySQL), otherwise db.run (SQLite)
    // Use db.execute if available (MySQL), otherwise db.run (SQLite)
    if (db.execute) {
        db.execute(sql, [priority, status, id])
            .then(([result]) => {
                const affected = result ? result.affectedRows : 'N/A';
                const changed = result ? result.changedRows : 'N/A';
                console.log(`[UPDATE DEBUG] ID: ${id}, Prio: ${priority}, Status: ${status} -> Affected: ${affected}, Changed: ${changed}`);

                // CASCADE UPDATE: If status changed, update ALL Active students for this school
                if (status) {
                    // 1. Backfill missing order rows (Optimized LEFT JOIN for performance)
                    const backfillSql = `
                        INSERT INTO orders (student_id, status) 
                        SELECT s.id, ? 
                        FROM students s 
                        LEFT JOIN orders o ON s.id = o.student_id 
                        WHERE s.school_id = ? AND s.is_active = 1 AND o.id IS NULL
                     `;
                    // 2. Update existing rows
                    const updateSql = "UPDATE orders SET status = ? WHERE student_id IN (SELECT id FROM students WHERE school_id = ? AND is_active = 1)";

                    if (db.execute) {
                        // MySQL
                        db.execute(backfillSql, [status, id])
                            .then(() => db.execute(updateSql, [status, id]))
                            .then(() => console.log(`[BULK UPDATE] School ${id} -> ${status}: Orders synced (Backfilled + Updated).`))
                            .catch(err => console.error("[BULK UPDATE ERROR]", err));
                    } else {
                        // SQLite Fallback
                        db.run(backfillSql, [status, id], (err) => {
                            if (err && !err.message.includes('UNIQUE')) console.error("[BULK BACKFILL ERROR]", err);
                            db.run(updateSql, [status, id], (err) => {
                                if (err) console.error("[BULK UPDATE ERROR]", err);
                                else console.log(`[BULK UPDATE] School ${id} -> ${status}: Orders synced.`);
                            });
                        });
                    }
                }

                if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_SCHOOL', `Updated School #${id} Priority/Status`);
                res.json({ message: "School & Students Updated", debug: { affected, changed } });
            })
            .catch(err => {
                console.error("[UPDATE ERROR]", err);
                res.status(500).json({ error: err.message });
            });
    } else {
        db.run(sql, [priority, status, id], function (err) {
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

                db.run(backfillSql, [status, id], (err) => {
                    // Ignore unique errors if race condition
                    db.run(updateSql, [status, id], (err) => {
                        if (err) console.error("[BULK UPDATE ERROR]", err);
                        else console.log(`[BULK UPDATE] School ${id} -> ${status}: Orders synced (SQLite).`);
                    });
                });
            }

            if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_SCHOOL', `Updated School #${id} Priority/Status`);
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
        db.run("INSERT INTO schools (name, username, password_hash) VALUES (?, ?, ?)", [name, username, hash], function (err) {
            if (err) return res.status(500).json({ error: err.message });

            const schoolId = this.lastID;

            // 2. Create User for School Admin
            db.run("INSERT INTO users (username, password_hash, role, school_id) VALUES (?, ?, ?, ?)",
                [username, hash, 'school', schoolId], function (err2) {
                    if (err2) {
                        return res.status(500).json({ error: "School created but User failed: " + err2.message });
                    }

                    // 3. Log
                    if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'CREATE_SCHOOL', `Created school: ${name}`);

                    res.json({ id: schoolId, message: "School and User created" });
                });
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/data/school/:id - Update School (Priority/Status)
router.put('/school/:id', authenticateToken, requireRole('company'), (req, res) => {
    const { priority, status } = req.body;
    const { id } = req.params;

    db.run("UPDATE schools SET priority = ?, status = ? WHERE id = ?", [priority, status, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_SCHOOL', `Updated School #${id} -> ${priority} / ${status}`);
        res.json({ message: "School updated" });
    });
});

// POST /api/data/migrate - Manual Schema Migration
// DELETE /api/data/schools/:id - Delete School & Cascade
router.delete('/schools/:id', authenticateToken, requireRole('company'), (req, res) => {
    const { id } = req.params;

    // 1. Delete Students (Cascade Measurements/Orders/Patterns via DB or Manual)
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
            if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'DELETE_SCHOOL', `Deleted School #${id}`);
            res.json({ message: "School and all related data deleted successfully" });
        });
    });
});

// POST /api/data/migrate - Manual Schema Migration
router.post('/migrate', authenticateToken, requireRole('company'), async (req, res) => {
    try {
        if (db.execute) {
            // MySQL
            try { await db.execute("ALTER TABLE schools ADD COLUMN priority VARCHAR(50) DEFAULT 'Normal'"); } catch (e) { }
            try { await db.execute("ALTER TABLE schools ADD COLUMN status VARCHAR(50) DEFAULT 'Pending'"); } catch (e) { }
            try { await db.execute("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1"); } catch (e) { }
        } else if (db.run) {
            // SQLite
            db.run("ALTER TABLE schools ADD COLUMN priority TEXT DEFAULT 'Normal'", () => { });
            db.run("ALTER TABLE schools ADD COLUMN status TEXT DEFAULT 'Pending'", () => { });
            db.run("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1", () => { });
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
            )`, () => { });

            // Add pattern_id to students
            db.run("ALTER TABLE students ADD COLUMN pattern_id INTEGER REFERENCES patterns(id) ON DELETE SET NULL", () => { });

        }

        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'MIGRATE_DB', `Triggered manual migration`);
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

// GET /api/data/logs - Activity Logs
router.get('/logs', authenticateToken, requireRole('company'), (req, res) => {
    db.all("SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 100", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
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
router.post('/student', authenticateToken, (req, res) => {
    const { id, school_id, admission_no, roll_no, name, class: cls, section, house, gender } = req.body;

    if (req.user.role === 'school' && req.user.schoolId !== school_id) return res.sendStatus(403);
    if (req.user.role === 'tailor' && req.user.schoolId !== school_id) return res.sendStatus(403);

    if (id) {
        // Update
        db.run("UPDATE students SET roll_no=?, name=?, class=?, section=?, house=?, gender=? WHERE id=?",
            [roll_no, name, cls, section, house, gender, id],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_STUDENT', `Updated student: ${name}`);
                res.json({ message: "Updated" });
            }
        );
    } else {
        // Insert
        db.run("INSERT INTO students (school_id, admission_no, roll_no, name, class, section, house, gender) VALUES (?,?,?,?,?,?,?,?)",
            [school_id, admission_no, roll_no, name, cls, section, house, gender],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'CREATE_STUDENT', `Created student: ${name}`);
                res.json({ id: this.lastID, message: "Created" });
            }
        );
    }
});

// DELETE /api/data/students/:id - Delete Student
router.delete('/students/:id', authenticateToken, (req, res) => {
    const { id } = req.params;

    // Security Check: Find student by ID OR Admission No
    // Fix: MySQL Crash on "String vs Int" - Only query 'id' if numeric
    let queryFind = "SELECT id, school_id, name FROM students WHERE admission_no = ?";
    let params = [id];

    if (/^\\d+$/.test(id)) {
        queryFind += " OR id = ?";
        params.push(id);
    }

    db.get(queryFind, params, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Student not found" });

        // RBAC: School/Tailor can only delete their own students
        if (req.user.role !== 'company' && req.user.schoolId !== row.school_id) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        // Perform Delete using the FOUND internal ID (Safe)
        // Fix: Manual Cascade Delete (Measurements & Orders first to avoid Foreign Key Error)
        const studentId = row.id;

        db.run("DELETE FROM measurements WHERE student_id = ?", [studentId], (errMc) => {
            if (errMc) console.error("Warn: Measurement delete failed", errMc.message);

            db.run("DELETE FROM orders WHERE student_id = ?", [studentId], (errOrd) => {
                if (errOrd) console.error("Warn: Order delete failed", errOrd.message);

                db.run("DELETE FROM students WHERE id = ?", [studentId], function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'DELETE_STUDENT', `Deleted student: ${row.name}`);
                    res.json({ message: "Student and related data deleted" });
                });
            });
        });
    });
});

// POST /api/data/measurements
router.post('/measurements', authenticateToken, (req, res) => {
    const { student_id, data, remarks, is_absent, item_quantities } = req.body;

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
                    if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_MEASUREMENTS', `Updated for student #${student_id}`);
                    res.json({ message: "Measurements updated" });
                }
            );
        } else {
            // Insert
            db.run("INSERT INTO measurements (student_id, data, remarks, is_absent, item_quantities) VALUES (?, ?, ?, ?, ?)",
                [student_id, dataStr, remarks, absentVal, qtyStr],
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'CREATE_MEASUREMENTS', `Created for student #${student_id}`);
                    res.json({ message: "Measurements saved" });
                }
            );
        }
    });
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
        GROUP BY st.id
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
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'CREATE_COMPLAINT', `Complaint from School #${schoolId}`);
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
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'REPLY_COMPLAINT', `Replied to #${id}`);
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
router.get('/patterns/:schoolId', authenticateToken, (req, res) => {
    const { schoolId } = req.params;
    // Security check logic omitted for brevity, assuming standard school match
    db.all("SELECT * FROM patterns WHERE school_id = ? ORDER BY created_at DESC", [schoolId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.post('/patterns', authenticateToken, (req, res) => {
    const { school_id, name, description, consumption, cloth_details, special_req, quantities, student_ids } = req.body;

    // Ensure quantities is stringified if it's an object/array, passing raw string if already string
    // Default to '[]' (empty array) instead of '{}' (object) to satisfy Array.isArray checks in frontend
    let qtyJson = '[]';
    if (quantities) {
        qtyJson = (typeof quantities === 'object') ? JSON.stringify(quantities) : quantities;
    }

    db.serialize(() => {
        db.run("INSERT INTO patterns (school_id, name, description, consumption, cloth_details, special_req, quantities) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [school_id, name, description, consumption, cloth_details, special_req, qtyJson],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                const patternId = this.lastID;

                // Link Students if IDs provided
                if (student_ids && Array.isArray(student_ids) && student_ids.length > 0) {
                    const placeholders = student_ids.map(() => '?').join(',');
                    const sqlLink = `UPDATE students SET pattern_id = ? WHERE id IN (${placeholders})`;
                    const params = [patternId, ...student_ids];

                    db.run(sqlLink, params, (errLink) => {
                        if (errLink) console.error("Failed to link students to pattern", errLink);
                        // We respond success even if link fails partially, or we could handle it.
                        // Ideally transaction.
                        res.json({ id: patternId, message: "Pattern Created & Students Linked" });
                    });
                } else {
                    res.json({ id: patternId, message: "Pattern Created (No students linked)" });
                }
            }
        );
    });
});


// DELETE /api/data/patterns/:id - Delete Pattern & Revert Status
router.delete('/patterns/:id', authenticateToken, (req, res) => {
    const { id } = req.params;

    // Check ownership before deleting
    db.get("SELECT school_id FROM patterns WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Pattern not found" });

        // Permission Check: Must be Company OR Owner School
        if (req.user.role !== 'company' && row.school_id != req.user.schoolId) {
            return res.status(403).json({ error: "Forbidden: Not your pattern" });
        }

        db.serialize(() => {
            // 1. Revert Order Status for linked students
            const revertSql = "UPDATE orders SET status = 'Pending' WHERE student_id IN (SELECT id FROM students WHERE pattern_id = ?)";

            db.run(revertSql, [id], (err0) => {
                if (err0) console.error("Warn: Failed to revert order status", err0.message);

                // 2. Unlink students
                db.run("UPDATE students SET pattern_id = NULL WHERE pattern_id = ?", [id], (err) => {
                    if (err) return res.status(500).json({ error: "Failed to unlink students: " + err.message });

                    // 3. Delete Pattern
                    db.run("DELETE FROM patterns WHERE id = ?", [id], (err2) => {
                        if (err2) return res.status(500).json({ error: "Failed to delete pattern: " + err2.message });
                        res.json({ message: "Pattern Deleted, Students Unlinked, Status Reverted to Pending" });
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
        { label: "Add 'description' to patterns", sql: "ALTER TABLE patterns ADD COLUMN description TEXT" }
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
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'FIX_DB', 'Ran schema repair.');
        res.json({ message: "Repair Report:\n" + logs.join("\n") });
    }).catch(e => {
        res.status(500).json({ error: "Fatal Repair Error: " + e.message });
    });
});

module.exports = router;
