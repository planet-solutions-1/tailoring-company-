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
    const { priority, status } = req.body;

    const sql = "UPDATE schools SET priority = COALESCE(?, priority), status = COALESCE(?, status) WHERE id = ?";
    db.run(sql, [priority, status, id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_SCHOOL', `Updated School #${id} Priority/Status`);
        res.json({ message: "School Updated" });
    });
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
               m.data as measurements, m.remarks,
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

// POST /api/data/measurements
router.post('/measurements', authenticateToken, (req, res) => {
    const { student_id, data, remarks } = req.body;

    db.get("SELECT id FROM measurements WHERE student_id = ?", [student_id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        const dataStr = JSON.stringify(data);

        if (row) {
            // Update
            db.run("UPDATE measurements SET data = ?, remarks = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?",
                [dataStr, remarks, student_id],
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'UPDATE_MEASUREMENTS', `Updated for student #${student_id}`);
                    res.json({ message: "Measurements updated" });
                }
            );
        } else {
            // Insert
            db.run("INSERT INTO measurements (student_id, data, remarks) VALUES (?, ?, ?)",
                [student_id, dataStr, remarks],
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
            m.data as measurements
        FROM students st
        JOIN schools sc ON st.school_id = sc.id
        LEFT JOIN orders o ON st.id = o.student_id
        LEFT JOIN measurements m ON st.id = m.student_id
        WHERE st.is_active = 1
        ORDER BY sc.name ASC, st.class ASC, st.roll_no ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const students = rows.map(r => {
            if (r.measurements) {
                try { r.measurements = JSON.parse(r.measurements); } catch (e) { }
            }
            return r;
        });
        res.json(students);
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
router.post('/complaints', authenticateToken, (req, res) => {
    const { rating, comment, image_url } = req.body;
    // Auto-detect school ID from user
    const schoolId = req.user.schoolId || req.body.school_id; // Fallback for debug

    if (!schoolId) return res.status(400).json({ error: "School ID required" });

    db.run("INSERT INTO complaints (school_id, rating, comment, image_url) VALUES (?, ?, ?, ?)",
        [schoolId, rating, comment, image_url],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'CREATE_COMPLAINT', `Complaint from School #${schoolId}`);
            res.json({ id: this.lastID, message: "Complaint Submitted" });
        }
    );
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

module.exports = router;
