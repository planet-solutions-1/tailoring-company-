const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticateToken, requireRole } = require('../middleware/auth');

// === ROBUSTNESS: WRAPPER FOR SYNC/ASYNC DB CALLS ===
// This helper ensures we handle both SQLite (callback-based) and MySQL (promise-based) cleanly
const query = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        if (db.query) { // MySQL Promise Wrapper from db.js
            db.query(sql, params)
                .then(([rows]) => resolve(rows))
                .catch(err => reject(err));
        } else if (db.all) { // SQLite
            // Detect Type
            const method = sql.trim().toUpperCase().startsWith('SELECT') ? 'all' : 'run';
            db[method](sql, params, function (err, rows) {
                if (err) reject(err);
                else resolve(method === 'run' ? { id: this.lastID, changes: this.changes } : rows);
            });
        } else {
            reject(new Error("Unknown Database Adapter"));
        }
    });
};

// Log helper that won't crash
const safeLog = (msg, err) => console.log(`[PROD_REBUILD] ${msg}`, err ? err.message : '');

// === 1. CONFIGURATION (S Labels, P Labels) ===
router.get('/config/:dressType', authenticateToken, async (req, res) => {
    try {
        const dressType = req.params.dressType;
        const rows = await query("SELECT * FROM production_config WHERE dress_type = ?", [dressType]);

        if (!rows || rows.length === 0) {
            return res.json({
                dress_type: dressType,
                s_labels: Array(20).fill('').map((_, i) => `Stage ${i + 1}`),
                p_labels: Array(20).fill('').map((_, i) => `Process ${i + 1}`)
            });
        }

        const row = Array.isArray(rows) ? rows[0] : rows; // Handle MySQL (array) vs SQLite (single obj from get - wait, our wrapper uses ALL for sqlite so array)
        const configRow = Array.isArray(rows) ? rows[0] : rows;

        // Parse JSON safely
        let s_labels = [], p_labels = [];
        try { s_labels = JSON.parse(configRow.s_labels || '[]'); } catch (e) { }
        try { p_labels = JSON.parse(configRow.p_labels || '[]'); } catch (e) { }

        // Fallback if parsing failed or empty
        if (s_labels.length === 0) s_labels = Array(20).fill('').map((_, i) => `Stage ${i + 1}`);
        if (p_labels.length === 0) p_labels = Array(20).fill('').map((_, i) => `Process ${i + 1}`);

        res.json({ ...configRow, s_labels, p_labels });

    } catch (err) {
        safeLog("Config Fetch Error", err);
        res.status(500).json({ error: "Server Error Fetching Config" });
    }
});

router.post('/config', authenticateToken, requireRole('company'), async (req, res) => {
    try {
        const { dress_type, s_labels, p_labels } = req.body;
        if (!dress_type) return res.status(400).json({ error: "Dress Type required" });

        const sJson = JSON.stringify(s_labels || []);
        const pJson = JSON.stringify(p_labels || []);

        const existing = await query("SELECT id FROM production_config WHERE dress_type = ?", [dress_type]);

        if (existing && existing.length > 0) {
            await query("UPDATE production_config SET s_labels = ?, p_labels = ? WHERE dress_type = ?", [sJson, pJson, dress_type]);
            res.json({ success: true, message: "Config Updated" });
        } else {
            await query("INSERT INTO production_config (dress_type, s_labels, p_labels) VALUES (?, ?, ?)", [dress_type, sJson, pJson]);
            res.json({ success: true, message: "Config Created" });
        }
    } catch (err) {
        safeLog("Config Save Error", err);
        res.status(500).json({ error: "Failed to save config" });
    }
});

router.get('/config-list', authenticateToken, async (req, res) => {
    try {
        // Simple distinct query
        const rows = await query("SELECT DISTINCT dress_type FROM production_config");
        const customTypes = rows.map(r => r.dress_type);
        const defaults = ["Shirt", "Pant", "Suit", "Jacket", "Vest", "Kurta", "Safari"]; // Extended Basics

        const all = Array.from(new Set([...defaults, ...customTypes])).sort();
        res.json(all);
    } catch (err) {
        safeLog("Config List Error", err);
        res.json(["Shirt", "Pant"]); // Fallback
    }
});


// === 2. GROUPS / BATCHES (THE PROBLEM AREA) ===

router.get('/groups', authenticateToken, async (req, res) => {
    try {
        // REFACTOR: Use a simplified query first to avoid JOIN bombs if tables are inconsistent
        // 1. Get Groups
        // NOTE: We select specific columns to avoid 'no such column' if user hasn't run migration.
        // BUT wait, if I select specific columns and they don't exist, it still errors. 
        // Strategy: Select * is actually safer if I know the table exists, but if I expect columns that aren't there...
        // Actually 'SELECT *' return what exists. 'SELECT missing_col' throws error.

        let groups = [];
        try {
            groups = await query("SELECT * FROM production_groups ORDER BY created_at DESC");
        } catch (e) {
            // If table missing, return empty (clean fail)
            safeLog("Groups Table Missing or query failed", e);
            return res.json([]);
        }

        // 2. Get Progress (separate query is often safer/faster for lightweight apps than complex joins if schema is volatile)
        let progressMap = {};
        try {
            const progressRows = await query("SELECT * FROM production_progress");
            progressRows.forEach(p => progressMap[p.group_id] = p);
        } catch (e) { safeLog("Progress Table access failed", e); }

        // 3. Merge & Sanitize
        const result = groups.map(g => {
            const p = progressMap[g.id] || {};

            // Safe JSON Parsing helper
            const parse = (str, fallback) => {
                try { return str ? JSON.parse(str) : fallback; } catch (e) { return fallback; }
            };

            return {
                ...g,
                // Ensure all expected fields exist even if DB column is missing (Polyfill)
                daily_target: g.daily_target || 0,
                sku: g.sku || '',
                quantity: g.quantity || 0,
                notes: g.notes || '',
                points: g.points || 0,
                delay_reason: g.delay_reason || null,

                // Progress Data merged flat
                current_stage: p.current_stage || 0,
                completed_stages: parse(p.completed_stages, {}),
                progress_notes: p.notes || '',
                last_updated: p.last_updated || g.created_at,

                // Parse own JSON
                required_stages: parse(g.required_stages, []),
                daily_history: parse(g.daily_history, []),
                last_reward_date: g.last_reward_date || null
            };
        });

        res.json(result);

    } catch (err) {
        safeLog("GET /groups CRITICAL FAILURE", err);
        // FIX: Return valid structure empty array instead of 500 so frontend doesn't crash
        res.json([]);
    }
});

router.post('/groups', authenticateToken, async (req, res) => {
    try {
        const { group_name, dress_type, required_stages, daily_target, quantity, notes } = req.body;

        if (!group_name) return res.status(400).json({ error: "Name required" });

        const stagesJson = JSON.stringify(required_stages || []);
        const safeTarget = parseInt(daily_target) || 0;
        const safeQty = parseInt(quantity) || 0;

        // INSERT
        // Note: If columns are missing in DB, this INSERT will fail.
        // We wrap in try-catch and specific column checks? No, `init.js` should have fixed it.
        // We'll trust the migration, but catch the error.

        const result = await query(
            `INSERT INTO production_groups 
            (group_name, dress_type, status, required_stages, daily_target, quantity, notes) 
            VALUES (?, ?, 'Active', ?, ?, ?, ?)`,
            [group_name, dress_type, stagesJson, safeTarget, safeQty, notes || '']
        );

        const newId = result.insertId || result.id; // MySQL vs SQLite

        // Init Progress
        await query("INSERT INTO production_progress (group_id, current_stage, completed_stages) VALUES (?, ?, ?)",
            [newId, 0, '{}']);

        res.json({ success: true, id: newId, message: "Work Created" });

    } catch (err) {
        safeLog("Create Group Error", err);
        res.status(500).json({ error: "Create Failed: " + err.message });
    }
});

router.post('/groups/:id/update', authenticateToken, async (req, res) => {
    try {
        const { completed_stages, notes } = req.body;
        const json = JSON.stringify(completed_stages || {});

        await query(
            "UPDATE production_progress SET completed_stages = ?, notes = ?, last_updated = CURRENT_TIMESTAMP WHERE group_id = ?",
            [json, notes || '', req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        safeLog("Update Progress Error", err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/groups/:id/edit', authenticateToken, async (req, res) => {
    try {
        const { group_name, dress_type, status, daily_target, quantity } = req.body;

        // Dynamic Update Builder to be safe against missing fields
        let updates = [];
        let params = [];

        if (group_name) { updates.push("group_name = ?"); params.push(group_name); }
        if (dress_type) { updates.push("dress_type = ?"); params.push(dress_type); }
        if (status) { updates.push("status = ?"); params.push(status); }
        if (daily_target !== undefined) { updates.push("daily_target = ?"); params.push(daily_target); }
        if (quantity !== undefined) { updates.push("quantity = ?"); params.push(quantity); }

        updates.push("updated_at = CURRENT_TIMESTAMP");

        if (updates.length === 1) return res.json({ success: true }); // Nothing to update

        const sql = `UPDATE production_groups SET ${updates.join(', ')} WHERE id = ?`;
        params.push(req.params.id);

        await query(sql, params);
        res.json({ success: true });

    } catch (err) {
        safeLog("Edit Batch Error", err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/groups/:id/complete', authenticateToken, async (req, res) => {
    try {
        await query("UPDATE production_groups SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/groups/:id/reward', authenticateToken, async (req, res) => {
    try {
        const points = parseInt(req.body.points) || 10;
        await query("UPDATE production_groups SET points = points + ? WHERE id = ?", [points, req.params.id]);
        res.json({ success: true, message: "Points Awarded" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/groups/:id/delay', authenticateToken, async (req, res) => {
    try {
        const { reason } = req.body;
        await query("UPDATE production_groups SET delay_reason = ? WHERE id = ?", [reason || 'Unknown', req.params.id]);
        res.json({ success: true, message: "Delay Logged" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/groups/:id', authenticateToken, async (req, res) => {
    try {
        await query("DELETE FROM production_progress WHERE group_id = ?", [req.params.id]);
        await query("DELETE FROM production_groups WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/groups/:id/log-daily', authenticateToken, async (req, res) => {
    try {
        const { date, achieved, target, notes } = req.body;
        const id = req.params.id;

        // Get current data
        const rows = await query("SELECT daily_history, last_reward_date, points FROM production_groups WHERE id = ?", [id]);
        if (!rows || rows.length === 0) return res.status(404).json({ error: "Batch not found" });

        const g = rows[0] || rows; // Handle array/obj
        let history = [];
        try { history = JSON.parse(g.daily_history || '[]'); } catch (e) { }

        const newEntry = {
            date: date || new Date().toISOString().split('T')[0],
            achieved: parseInt(achieved) || 0,
            target: parseInt(target) || 0,
            notes: notes || '',
            timestamp: new Date().toISOString()
        };

        // UPSERT LOGIC: Replace if entry exists for this date, otherwise push
        const existingIndex = history.findIndex(h => h.date === newEntry.date);
        if (existingIndex >= 0) {
            history[existingIndex] = newEntry;
        } else {
            history.push(newEntry);
        }

        // Gamification Logic
        let awarded = false;
        let pointsToAdd = 0;
        const today = new Date().toISOString().split('T')[0];
        const lastReward = g.last_reward_date ? new Date(g.last_reward_date).toISOString().split('T')[0] : null;

        // If target met AND not rewarded today
        if (newEntry.achieved >= newEntry.target && newEntry.target > 0) {
            if (lastReward !== today) {
                awarded = true;
                pointsToAdd = 10; // Fixed reward?
            }
        }

        let sql = "UPDATE production_groups SET daily_history = ?";
        let params = [JSON.stringify(history)];

        if (awarded) {
            sql += ", points = points + ?, last_reward_date = ?";
            params.push(pointsToAdd, today);
        } else {
            // If manual "Re-Log" but already rewarded, we don't reward again.
        }

        sql += " WHERE id = ?";
        params.push(id);

        await query(sql, params);

        res.json({ success: true, awarded, pointsAdded: pointsToAdd, history });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// === 3. FIX ROUTE (User Requested "Rebuild/Fix Issues") ===
router.post('/admin/fix-schema-force', async (req, res) => {
    try {
        // Manual trigger to add columns if auto-migration failed
        const cols = [
            "ALTER TABLE production_groups ADD COLUMN daily_target INT DEFAULT 0",
            "ALTER TABLE production_groups ADD COLUMN sku VARCHAR(100)",
            "ALTER TABLE production_groups ADD COLUMN quantity INT DEFAULT 0",
            "ALTER TABLE production_groups ADD COLUMN notes TEXT",
            "ALTER TABLE production_groups ADD COLUMN points INT DEFAULT 0",
            "ALTER TABLE production_groups ADD COLUMN points INT DEFAULT 0",
            "ALTER TABLE production_groups ADD COLUMN delay_reason TEXT",
            "ALTER TABLE production_groups ADD COLUMN daily_history TEXT",
            "ALTER TABLE production_groups ADD COLUMN last_reward_date DATE"
        ];

        let log = [];
        for (const c of cols) {
            try {
                await query(c);
                log.push(`Success: ${c}`);
            } catch (e) {
                // Ignore "duplicate column" errors
                if (e.message && (e.message.includes("Duplicate") || e.message.includes("exists"))) {
                    log.push(`Skipped (Exists): ${c}`);
                } else {
                    log.push(`Error: ${c} -> ${e.message}`);
                }
            }
        }
        res.json({ success: true, log });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

module.exports = router;
