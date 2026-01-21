const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticateToken, requireRole } = require('../middleware/auth');

// === 1. CONFIGURATION (S Labels, P Labels) ===

router.get('/config/:dressType', authenticateToken, (req, res) => {
    const dressType = req.params.dressType;
    const sql = "SELECT * FROM production_config WHERE dress_type = ?";

    db.get(sql, [dressType], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) {
            return res.json({
                dress_type: dressType,
                s_labels: Array(20).fill('').map((_, i) => `Stage ${i + 1}`),
                p_labels: Array(20).fill('').map((_, i) => `Process ${i + 1}`)
            });
        }
        try {
            res.json({
                ...row,
                s_labels: JSON.parse(row.s_labels),
                p_labels: JSON.parse(row.p_labels)
            });
        } catch (e) {
            res.status(500).json({ error: "Failed to parse config JSON" });
        }
    });
});

router.post('/config', authenticateToken, requireRole('company'), (req, res) => {
    const { dress_type, s_labels, p_labels } = req.body;
    if (!dress_type) return res.status(400).json({ error: "Dress Type required" });

    if (!Array.isArray(s_labels) || s_labels.length !== 20 || !Array.isArray(p_labels) || p_labels.length !== 20) {
        return res.status(400).json({ error: "Labels must be arrays of length 20" });
    }

    const sJson = JSON.stringify(s_labels);
    const pJson = JSON.stringify(p_labels);

    db.get("SELECT id FROM production_config WHERE dress_type = ?", [dress_type], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        if (row) {
            db.run("UPDATE production_config SET s_labels = ?, p_labels = ? WHERE dress_type = ?", [sJson, pJson, dress_type], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, message: "Config Updated" });
            });
        } else {
            db.run("INSERT INTO production_config (dress_type, s_labels, p_labels) VALUES (?, ?, ?)", [dress_type, sJson, pJson], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, message: "Config Created" });
            });
        }
    });
});

// Default Items (Fallback matches ConfigLoader.js)
const DEFAULT_ITEMS = [
    "BOYS - FORMAL SHIRT", "BOYS - TRACK T-SHIRT", "BOYS - UNIFORM T-SHIRT",
    "BOYS - JERKIN", "BOYS - PULLOVER", "BOYS - FORMAL PANT", "BOYS - TRACK PANT",
    "BOYS - FORMAL SHORTS", "BOYS - TRACK SHORTS", "BOYS - PANT SPECIAL CASE",
    "GIRLS - FORMAL SHIRT", "GIRLS - TRACK T-SHIRT", "GIRLS - UNIFORM T-SHIRT",
    "GIRLS - JERKIN", "GIRLS - FULL SLEEVE SHIRT", "GIRLS - PULLOVER",
    "GIRLS - KURTHA SHIRT", "GIRLS - SPECIAL FROCKS", "GIRLS - FORMAL PANT",
    "GIRLS - TRACK PANT", "GIRLS - TRACK SHORTS", "GIRLS - PINOFORE",
    "GIRLS - SKIRT", "GIRLS - PANT SPECIAL CASE"
];

// Helper route to get all used dress types (for dropdown)
router.get('/config-list', authenticateToken, (req, res) => {
    const queries = [
        // 1. Get System Config from Schools Table
        new Promise((resolve) => {
            db.get("SELECT address FROM schools WHERE name = 'SYSTEM_CONFIG'", [], (err, row) => {
                if (err || !row || !row.address) resolve([]);
                else {
                    try {
                        const config = JSON.parse(row.address);
                        // Extract item names from config object
                        let items = [];
                        if (config.data && Array.isArray(config.data)) items = config.data;
                        else if (config.items && Array.isArray(config.items)) items = config.items;
                        else if (Array.isArray(config)) items = config; // Direct array

                        resolve(items.map(i => i.name || i));
                    } catch (e) {
                        console.error("Config Parse Error", e);
                        resolve([]);
                    }
                }
            });
        }),
        // 2. Get Production Config (Legacy support)
        new Promise((resolve) => {
            db.all("SELECT DISTINCT dress_type FROM production_config", [], (err, rows) => {
                if (err || !rows) resolve([]);
                else resolve(rows.map(r => r.dress_type));
            });
        })
    ];

    Promise.all(queries).then(results => {
        const [configNames, prodConfigNames] = results;

        // Merge all sources + Defaults
        const allTypes = new Set([
            ...DEFAULT_ITEMS,
            ...configNames,
            ...prodConfigNames
        ]);

        // Filter empty/null and sort
        const sortedTypes = Array.from(allTypes)
            .filter(t => t && typeof t === 'string' && t.trim() !== '')
            .sort();

        res.json(sortedTypes);
    }).catch(err => {
        console.error("Config List Full Error:", err);
        res.json(DEFAULT_ITEMS); // Absolute fallback
    });
});


// === 2. GROUPS / BATCHES ===

router.get('/groups', authenticateToken, (req, res) => {
    const sql = `
        SELECT g.*, p.current_stage, p.completed_stages, p.notes
        FROM production_groups g
        LEFT JOIN production_progress p ON g.id = p.group_id
        WHERE g.status = 'Active'
        ORDER BY g.created_at DESC
    `;

    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const processed = rows.map(row => {
            let required_stages = [];
            let completed_stages = {}; // Object: { "s-1": 500 }

            try { required_stages = JSON.parse(row.required_stages || '[]'); } catch (e) { }
            try { completed_stages = JSON.parse(row.completed_stages || '{}'); } catch (e) {
                // Fallback for migration: if array [0,1], convert to obj?
                // Simplest is just start fresh.
                completed_stages = {};
            }

            return { ...row, required_stages, completed_stages };
        });

        res.json(processed);
    });
});

router.post('/groups', authenticateToken, (req, res) => {
    if (req.user.role !== 'company' && req.user.role !== 'production_manager') {
        return res.status(403).json({ error: "Unauthorized" });
    }

    const { group_name, dress_type, required_stages, details } = req.body;
    // required_stages: Array of objects [{id: 's-0', name: 'Cutting', target: 500, assigned: 'Group A'}, ...]

    if (!group_name || !dress_type) return res.status(400).json({ error: "Name and Type required" });

    db.run("INSERT INTO production_groups (group_name, dress_type, required_stages, details) VALUES (?, ?, ?, ?)",
        [group_name, dress_type, JSON.stringify(required_stages || []), details || ''],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });

            const groupId = this.lastID;
            db.run("INSERT INTO production_progress (group_id, current_stage, completed_stages) VALUES (?, 0, '{}')", [groupId], (err) => {
                res.json({ success: true, id: groupId });
            });
        }
    );
});


// === 3. PROGRESS UPDATE ===

router.post('/groups/:id/update', authenticateToken, (req, res) => {
    const groupId = req.params.id;
    const { completed_stages, notes } = req.body;
    // completed_stages: Object { "s-0": 250, "s-1": 500 }

    db.run(`UPDATE production_progress 
            SET completed_stages = ?, notes = ?, last_updated = CURRENT_TIMESTAMP 
            WHERE group_id = ?`,
        [JSON.stringify(completed_stages), notes || '', groupId],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

router.post('/groups/:id/complete', authenticateToken, (req, res) => {
    if (req.user.role !== 'company' && req.user.role !== 'production_manager') {
        return res.status(403).json({ error: "Unauthorized" });
    }

    db.run("UPDATE production_groups SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// === 4. EDIT UPDATE ===

router.post('/groups/:id/edit', authenticateToken, (req, res) => {
    if (req.user.role !== 'company' && req.user.role !== 'production_manager') {
        return res.status(403).json({ error: "Unauthorized" });
    }

    const groupId = req.params.id;
    const { group_name, dress_type, status, required_stages } = req.body;

    if (!group_name) return res.status(400).json({ error: "Name is required" });

    // If required_stages is provided, update it too. detailed logic
    const sql = `UPDATE production_groups 
                 SET group_name = ?, dress_type = ?, status = ?, required_stages = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`;

    db.run(sql, [group_name, dress_type, status, JSON.stringify(required_stages || []), groupId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Batch Updated" });
    });
});

// === 5. DELETE ===
router.delete('/groups/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'company' && req.user.role !== 'production_manager') {
        return res.status(403).json({ error: "Unauthorized" });
    }

    const groupId = req.params.id;

    // Delete progress first (optional if FK cascade exists, but good for safety)
    db.run("DELETE FROM production_progress WHERE group_id = ?", [groupId], (err) => {
        if (err) console.error("Error deleting progress:", err);

        // Delete Group
        db.run("DELETE FROM production_groups WHERE id = ?", [groupId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: "Batch Deleted" });
        });
    });
});

module.exports = router;
