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

// Helper route to get all used dress types (for dropdown)
router.get('/config-list', authenticateToken, (req, res) => {
    // Union existing config types with actual used types in patterns
    // Correcting column name: patterns table uses 'name', not 'dress_type'
    const sql = `
        SELECT DISTINCT dress_type FROM production_config
        UNION
        SELECT DISTINCT name as dress_type FROM patterns
        ORDER BY dress_type ASC
    `;

    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error("Config List Error:", err.message);
            // Fallback: just hardcoded if DB fails
            return res.json(["Shirt", "Pant", "Suit"]);
        }
        const types = rows.map(r => r.dress_type).filter(t => t && t.trim() !== ''); // Filter nulls/empty
        res.json(types.length > 0 ? types : ["Shirt", "Pant", "Suit"]);
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

module.exports = router;
