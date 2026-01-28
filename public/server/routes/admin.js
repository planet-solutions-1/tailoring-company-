const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

// Helper to run query as promise
const query = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        if (db.execute) db.execute(sql, params).then(([rows]) => resolve(rows)).catch(reject);
        else db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
};

const exec = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        if (db.execute) db.execute(sql, params).then(resolve).catch(reject);
        else db.run(sql, params, function (err) { err ? reject(err) : resolve(this) });
    });
};

const TABLES = ['schools', 'users', 'students', 'measurements', 'orders', 'patterns', 'complaints', 'settings', 'activity_logs', 'access_codes'];

// GET /api/admin/backup - Download Full JSON
router.get('/backup', authenticateToken, requireRole('company'), async (req, res) => {
    try {
        const backup = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            tables: {}
        };

        for (const table of TABLES) {
            backup.tables[table] = await query(`SELECT * FROM ${table}`);
        }

        const filename = `planet_backup_${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.send(JSON.stringify(backup, null, 2));

        // Log
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'BACKUP', 'Created Full System Backup');

    } catch (e) {
        console.error("Backup Error:", e);
        res.status(500).json({ error: "Backup Failed: " + e.message });
    }
});

// POST /api/admin/restore - Upload & Restore (Expects JSON body or file content)
// Note: Frontend should read file and send as JSON body for simplicity in this version
router.post('/restore', authenticateToken, requireRole('company'), async (req, res) => {
    const { data } = req.body; // Expects parsed JSON object

    if (!data || !data.tables) return res.status(400).json({ error: "Invalid Backup Format" });

    try {
        // 1. Transaction Start (Implicit via Sequential Exec for simple DB wrappers)
        // For MySql/SQLite mixed, we just do sequential with "Best Effort" rollback if possible, 
        // but since we TRUNCATE first, it's destructive anyway.

        console.log("Starting Restore Process...");

        // Disable FK Checks (MySQL specific, SQLite uses PRAGMA)
        if (db.execute) await db.execute("SET FOREIGN_KEY_CHECKS = 0");
        else await exec("PRAGMA foreign_keys = OFF");

        for (const table of TABLES) {
            if (data.tables[table]) {
                const rows = data.tables[table];
                console.log(`Restoring ${table}: ${rows.length} rows...`);

                // TRUNCATE/DELETE
                await exec(`DELETE FROM ${table}`);

                // RESET AUTO INCREMENT if possible (SQLite specific usually)
                if (!db.execute) await exec(`DELETE FROM sqlite_sequence WHERE name=?`, [table]);

                // INSERT
                if (rows.length > 0) {
                    const keys = Object.keys(rows[0]);
                    const cols = keys.join(',');
                    const placeholders = keys.map(() => '?').join(',');
                    const sql = `INSERT INTO ${table} (${cols}) VALUES (${placeholders})`;

                    for (const row of rows) {
                        const values = keys.map(k => {
                            const val = row[k];
                            // Handle date objects or nulls if needed, JSON keeps them as strings usually which is fine for DB
                            return val;
                        });
                        await exec(sql, values);
                    }
                }
            }
        }

        // Enable FK Checks
        if (db.execute) await db.execute("SET FOREIGN_KEY_CHECKS = 1");
        else await exec("PRAGMA foreign_keys = ON");

        console.log("Restore Complete");
        if (db.logActivity) db.logActivity(req.user.id, req.user.username, 'RESTORE', 'Restored System from Backup');

        res.json({ success: true, message: "System Restored Successfully" });

    } catch (e) {
        console.error("Restore Error:", e);
        // Attempt Re-enable FK
        if (db.execute) await db.execute("SET FOREIGN_KEY_CHECKS = 1");
        else await exec("PRAGMA foreign_keys = ON");

        res.status(500).json({ error: "Restore Failed (Partial Data Possible): " + e.message });
    }
});

// POST /api/admin/reset - Reset Database (Wipe Business Data)
router.post('/reset', authenticateToken, requireRole('company'), async (req, res) => {
    try {
        // Collect Audit Info
        const ip = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('User-Agent');
        const auditInfo = `IP: ${ip} | User-Agent: ${userAgent}`; // MAC Address is not accessible in Web Apps

        console.log(`[RESET DB] Initiated by ${req.user.username}. ${auditInfo}`);

        // Tables to Wipe (Business Data Only - Keep Users/Settings/Logs to avoid bricking)
        // We wipe 'schools' which cascades to 'students', 'orders' etc usually, but we explicit delete for safety.
        const WIPE_TABLES = ['students', 'measurements', 'orders', 'complaints', 'schools', 'patterns'];

        if (db.execute) await db.execute("SET FOREIGN_KEY_CHECKS = 0");
        else await exec("PRAGMA foreign_keys = OFF");

        for (const table of WIPE_TABLES) {
            if (table === 'schools') {
                await exec(`DELETE FROM schools WHERE username != 'system_config'`);
            } else {
                await exec(`DELETE FROM ${table}`);
            }
            if (!db.execute && table !== 'schools') await exec(`DELETE FROM sqlite_sequence WHERE name=?`, [table]);
        }

        if (db.execute) await db.execute("SET FOREIGN_KEY_CHECKS = 1");
        else await exec("PRAGMA foreign_keys = ON");

        // Log Critical Action
        if (db.logActivity) {
            db.logActivity(req.user.id, req.user.username, 'DB_RESET', `WIPED ALL DATA. Audit: ${auditInfo}`);
        }

        res.json({ success: true, message: "Database Reset Complete. Operational data wiped." });

    } catch (e) {
        console.error("Reset Error:", e);
        res.status(500).json({ error: "Reset Failed: " + e.message });
    }
});

module.exports = router;
