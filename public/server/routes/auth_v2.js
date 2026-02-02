const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/db');

// Helper to get user by username
function getUserByUsername(username) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function createUser(username, password, role, schoolId = null) {
    return new Promise(async (resolve, reject) => {
        const hash = await bcrypt.hash(password, 10);
        db.run("INSERT INTO users (username, password_hash, role, school_id) VALUES (?, ?, ?, ?)",
            [username, hash, role, schoolId], function (err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
    });
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
    let { username, password } = req.body;
    if (username) username = username.trim();
    if (password) password = password.trim();
    try {
        const user = await getUserByUsername(username);
        if (!user) return res.status(400).json({ error: "User not found" });

        if (await bcrypt.compare(password, user.password_hash)) {
            // Fetch School Name if applicable
            let schoolName = null;
            if (user.school_id) {
                try {
                    const schoolRow = await new Promise((resolve) => {
                        db.get("SELECT name FROM schools WHERE id = ?", [user.school_id], (err, row) => resolve(row));
                    });
                    if (schoolRow) schoolName = schoolRow.name;
                } catch (e) { }
            }

            const accessToken = jwt.sign(
                { id: user.id, username: user.username, role: user.role, schoolId: user.school_id },
                'hardcoded_secret_key_fixed',
                { expiresIn: '12h' }
            );

            // SECURITY: Set HTTP-Only Cookie for Dashboard Access
            res.cookie('token', accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production', // Secure in Prod
                maxAge: 12 * 60 * 60 * 1000 // 12 Hours
            });

            res.json({
                accessToken,
                role: user.role,
                schoolId: user.school_id,
                user: {
                    username: user.username,
                    schoolName: schoolName || ''
                }
            });
        } else {
            res.status(401).json({ error: "Invalid password" });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/auth/register (Protected: Super Admin Only for Admin creation)
router.post('/register', async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    // Default open registration is usually NOT desired for production, but kept if legacy depends on it.
    // However, for creating 'admin' role, we MUST require Super Admin token.
    let { username, password, role, schoolId } = req.body;
    if (username) username = username.trim();
    if (password) password = password.trim();
    if (role) role = role.trim();

    if (role === 'admin' || role === 'production_manager') {
        if (!token) return res.status(401).json({ error: "Unauthorized" });
        try {
            const decoded = jwt.verify(token, 'hardcoded_secret_key_fixed');
            if (decoded.role !== 'company') return res.status(403).json({ error: "Only Super Admin can create Admins" });
        } catch (e) {
            return res.status(403).json({ error: "Invalid Token" });
        }
    }

    try {
        await createUser(username, password, role, schoolId);
        res.status(201).json({ message: "User created" });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/auth/update-credentials (Super Admin Only)
router.post('/update-credentials', async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    let { username, password } = req.body;
    if (username) username = username.trim();
    if (password) password = password.trim();

    try {
        const decoded = jwt.verify(token, 'hardcoded_secret_key_fixed');
        if (decoded.role !== 'company') return res.status(403).json({ error: "Action Restricted to Super Admin" });

        const hash = await bcrypt.hash(password, 10);

        // Prevent changing username to one that exists (unless it's self) -- simplistic check
        // Ideally we check if new username exists first. 
        // Here we just update.

        db.run("UPDATE users SET username = ?, password_hash = ? WHERE id = ?",
            [username, hash, decoded.id],
            function (err) {
                if (err) return res.status(500).json({ error: "Update failed. Username may be taken." });
                res.json({ message: "Credentials updated" });
            }
        );

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/auth/access-code (For Tailors/Packing Login)
router.post('/access-code', (req, res) => {
    const { code } = req.body;
    db.get("SELECT * FROM access_codes WHERE code = ? AND is_active = 1", [code], (err, row) => {
        if (err) return res.status(500).json({ error: "Db error" });
        if (!row) return res.status(401).json({ error: "Invalid Access Code" });

        // Check expiry
        const now = new Date();
        const expires = new Date(row.expires_at);
        if (now > expires) {
            return res.status(401).json({ error: "Code Expired" });
        }

        const type = row.type; // 'editor' or 'packing'
        const accessToken = jwt.sign(
            { role: type === 'editor' ? 'tailor' : 'packing', schoolId: row.school_id, temp: true },
            'hardcoded_secret_key_fixed',
            { expiresIn: '8h' }
        );
        res.json({ accessToken, role: type, schoolId: row.school_id });
    });
});


// POST /api/auth/generate-code (Company Admin Only)
router.post('/generate-code', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, 'hardcoded_secret_key_fixed', (err, user) => {
        if (err || user.role !== 'company') return res.sendStatus(403);

        const { schoolId, type, durationHours } = req.body; // type: 'editor' | 'packing'
        console.log(`[DEBUG] Generating Code for SchoolID: ${schoolId}, Type: ${type} by User: ${user.username}`);

        if (!schoolId) return res.status(400).json({ error: "School ID is missing" });

        // Generate Code
        const code = Math.random().toString(36).substring(2, 8).toUpperCase(); // e.g., "X7Z9A2"

        // Expiry
        const expiresAt = new Date(Date.now() + (durationHours || 4) * 60 * 60 * 1000); // Default 4 hours

        db.run("INSERT INTO access_codes (school_id, code, type, expires_at, created_by) VALUES (?, ?, ?, ?, ?)",
            [schoolId, code, type, expiresAt.toISOString().slice(0, 19).replace('T', ' '), user.id],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ code, expiresAt, schoolId, type });
            }
        );
    });
});

// GET /api/auth/access-codes (List active codes)
router.get('/access-codes', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, 'hardcoded_secret_key_fixed', (err, user) => {
        if (err || user.role !== 'company') return res.sendStatus(403);

        const sql = `
            SELECT ac.code, ac.type, ac.expires_at, s.name as school_name 
            FROM access_codes ac 
            LEFT JOIN schools s ON ac.school_id = s.id 
            WHERE ac.is_active = 1 
            ORDER BY ac.expires_at DESC
        `;

        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });
});

// DELETE /api/auth/access-code/:code (Revoke Code)
router.delete('/access-code/:code', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, 'hardcoded_secret_key_fixed', (err, user) => {
        if (err || user.role !== 'company') return res.sendStatus(403);

        const code = req.params.code;
        db.run("UPDATE access_codes SET is_active = 0 WHERE code = ?", [code], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Code revoked" });
        });
    });
});

module.exports = router;
