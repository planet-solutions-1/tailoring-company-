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
        // 1. Fetch from Configs (Production Templates)
        const configRows = await query("SELECT DISTINCT dress_type FROM production_config");
        const configTypes = configRows.map(r => r.dress_type).filter(x => x);

        // 2. Fetch from Used Groups (Ad-hoc usage)
        const groupRows = await query("SELECT DISTINCT dress_type FROM production_groups");
        const groupTypes = groupRows.map(r => r.dress_type).filter(x => x);

        // 3. Fetch from Company Dashboard Config (System Config Record)
        let systemTypes = [];
        try {
            // The company dashboard saves global config in a school record with username 'system_config'
            const sysRows = await query("SELECT address FROM schools WHERE username = 'system_config'");
            if (sysRows.length > 0 && sysRows[0].address) {
                const raw = JSON.parse(sysRows[0].address);
                // ConfigLoader saves as { marker:..., data: [items...] } OR { items: [...] }
                let items = [];
                if (raw.data && Array.isArray(raw.data)) items = raw.data;
                else if (raw.items && Array.isArray(raw.items)) items = raw.items;
                else if (Array.isArray(raw)) items = raw; // Legacy array

                // Extract name
                systemTypes = items.map(i => i.name).filter(x => x);
            }
        } catch (e) {
            console.log("Error fetching system_config for dress types:", e.message);
        }

        const defaults = ["Shirt", "Pant", "Suit", "Jacket", "Vest", "Kurta", "Safari"];

        // Merge & De-duplicate (Case Insensitive Normalization)
        const rawList = [...defaults, ...configTypes, ...groupTypes, ...systemTypes];
        const uniqueSet = new Set();
        const finalMap = new Map();

        rawList.forEach(t => {
            if (!t || typeof t !== 'string') return;
            const clean = t.trim();
            const lower = clean.toLowerCase();

            if (!finalMap.has(lower)) {
                // Formatting: Title Case IF it was all lower, otherwise keep original casing (e.g. CAPS)
                const isAllLower = clean === lower;
                let formatted = clean;
                if (isAllLower) {
                    formatted = clean.charAt(0).toUpperCase() + clean.slice(1);
                }
                finalMap.set(lower, formatted);
            }
        });

        const all = Array.from(finalMap.values()).sort();
        res.json(all);
    } catch (err) {
        safeLog("Config List Error", err);
        res.json(["Shirt", "Pant", "Suit"]); // Fallback
    }
});


// === 2. GROUPS / BATCHES (THE PROBLEM AREA) ===

// --- INVENTORY ROUTES ---
router.get('/inventory', authenticateToken, async (req, res) => {
    try {
        const rows = await query("SELECT * FROM inventory_materials ORDER BY name");
        res.json(rows);
    } catch (err) {
        // Self-Healing: Create Table if missing
        if (err.message && (err.message.includes("no such table") || err.message.includes("does not exist"))) {
            console.log("Auto-Creating Inventory Table...");
            try {
                await query(`CREATE TABLE IF NOT EXISTS inventory_materials (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, 
                    name TEXT, 
                    stock INTEGER DEFAULT 0, 
                    unit TEXT DEFAULT 'Units', 
                    cost_per_unit REAL DEFAULT 0
                )`);
                // Retry
                const rows = await query("SELECT * FROM inventory_materials ORDER BY name");
                return res.json(rows);
            } catch (e2) {
                return res.status(500).json({ error: "Init Failed: " + e2.message });
            }
        }
        res.status(500).json({ error: err.message });
    }
});

router.post('/inventory', authenticateToken, async (req, res) => {
    try {
        const { name, stock, unit, cost } = req.body;
        // Check if exists
        const existing = await query("SELECT id FROM inventory_materials WHERE name = ?", [name]);
        if (existing.length > 0) {
            // Update
            await query("UPDATE inventory_materials SET stock = stock + ? WHERE id = ?", [parseInt(stock), existing[0].id]);
        } else {
            // Insert
            await query("INSERT INTO inventory_materials (name, stock, unit, cost_per_unit) VALUES (?, ?, ?, ?)",
                [name, parseInt(stock), unit || 'Meters', parseFloat(cost) || 0]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/inventory/deduct', authenticateToken, async (req, res) => {
    try {
        const { deductions } = req.body; // Array of { id, qty }
        for (const d of deductions) {
            await query("UPDATE inventory_materials SET stock = MAX(0, stock - ?) WHERE id = ?", [d.qty, d.id]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- EXPORT ROUTES ---
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

        // Fix: Update Stages if provided
        if (req.body.required_stages) {
            updates.push("required_stages = ?");
            params.push(JSON.stringify(req.body.required_stages));
        }

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

router.post('/groups/:id/defects', authenticateToken, async (req, res) => {
    try {
        const { type, description } = req.body;
        const id = req.params.id;

        // Fetch current
        const rows = await query("SELECT defects, points FROM production_groups WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ error: "Batch not found" });

        let defects = [];
        try { defects = JSON.parse(rows[0].defects || '[]'); } catch (e) { }

        const newDefect = {
            type,
            description,
            date: new Date().toISOString()
        };
        defects.push(newDefect);

        // Penalty? Maybe -5 points
        const newPoints = Math.max(0, (rows[0].points || 0) - 5);

        await query("UPDATE production_groups SET defects = ?, points = ? WHERE id = ?",
            [JSON.stringify(defects), newPoints, id]);

        res.json({ success: true, message: "Defect Logged" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/groups/:id/log-daily', authenticateToken, async (req, res) => {
    try {
        const { date, achieved, target, notes } = req.body;
        const id = req.params.id;

        // Get current data (Self-Healing)
        let rows;
        try {
            rows = await query("SELECT daily_history, last_reward_date, points FROM production_groups WHERE id = ?", [id]);
        } catch (e) {
            if (e.message && e.message.includes("Unknown column")) {
                console.log("Self-Healing (Select): Adding missing columns...");
                const fixCols = [
                    "ALTER TABLE production_groups ADD COLUMN daily_history TEXT",
                    "ALTER TABLE production_groups ADD COLUMN last_reward_date DATE",
                    "ALTER TABLE production_groups ADD COLUMN points INT DEFAULT 0",
                    "ALTER TABLE production_groups ADD COLUMN delay_reason TEXT",
                    // New Columns for QC & Inventory
                    "ALTER TABLE production_groups ADD COLUMN defects TEXT DEFAULT '[]'",
                    "CREATE TABLE IF NOT EXISTS inventory_materials (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, stock INTEGER, unit TEXT, cost_per_unit REAL)"
                ];
                for (const c of fixCols) { try { await query(c); } catch (ex) { } }
                // Retry
                rows = await query("SELECT daily_history, last_reward_date, points FROM production_groups WHERE id = ?", [id]);
            } else {
                throw e;
            }
        }

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

        // ... existing gamification ...
        // Extract Shift Times
        const { start_time, target_end, actual_end } = req.body;
        newEntry.start_time = start_time;
        newEntry.target_end = target_end;
        newEntry.actual_end = actual_end;

        // Calculate Efficiency Bonus
        let durationBonus = 0;
        let isLate = false;

        if (target_end && actual_end) {
            const tDate = new Date(`1970-01-01T${target_end}`);
            const aDate = new Date(`1970-01-01T${actual_end}`);

            // Difference in minutes
            const diffMs = aDate - tDate;
            // If diffMs <= 0 -> Early/OnTime
            // If diffMs > 0 -> Late

            if (diffMs <= 0 && newEntry.achieved >= newEntry.target) {
                durationBonus = 10; // Speed Bonus
            } else if (diffMs > 0) {
                isLate = true;
            }
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
                pointsToAdd = 10 + durationBonus; // Base 10 + Speed Bonus
            } else if (durationBonus > 0) {
                // Already awarded base, but maybe speed bonus achieved now?
                // For simplicity, only award ONCE per day to avoid spamming updates.
                // OR allow additive updates? Simpler to stick to "First completion wins".
                // Let's assume re-saving updates points if not already capped?
                // Current logic resets points per day in DB? No, it accumulates.
                // We only add points if `lastReward !== today`. so once per day.
                // If they update log to be faster, they miss the bonus if already claimed.
                // This is acceptable V1.
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

        try {
            await query(sql, params);
        } catch (dbErr) {
            // SELF-HEALING: If column missing, fix and retry
            if (dbErr.message && dbErr.message.includes("Unknown column")) {
                console.log("Self-Healing: Adding missing columns...");
                const fixCols = [
                    "ALTER TABLE production_groups ADD COLUMN daily_history TEXT",
                    "ALTER TABLE production_groups ADD COLUMN last_reward_date DATE",
                    "ALTER TABLE production_groups ADD COLUMN points INT DEFAULT 0",
                    "ALTER TABLE production_groups ADD COLUMN delay_reason TEXT"
                ];
                for (const c of fixCols) { try { await query(c); } catch (e) { } }

                // Retry Update
                await query(sql, params);
            } else {
                throw dbErr;
            }
        }

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
