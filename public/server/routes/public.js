const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/public/students
// Public endpoint for Student View (QR Scan)
// Protected by shared PIN client-side (Security by Obscurity + PIN)
router.get('/students', (req, res) => {
    const cls = req.query.class || '';
    const sec = req.query.section || '';

    // Dynamic Query Builder
    let sql = "SELECT id, admission_no, name, class, section, roll_no, house, order_status FROM students WHERE 1=1";
    const params = [];

    // Filter by Class (if provided and not 'All')
    if (cls && cls !== 'All') {
        sql += " AND class = ?";
        params.push(cls);
    }

    // Filter by Section (if provided and not 'All')
    if (sec && sec !== 'All') {
        sql += " AND section = ?";
        params.push(sec);
    }

    // Sort by name
    sql += " ORDER BY name ASC";

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error("Public API Error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        // Map to light structure for client
        const safeRows = rows.map(r => ({
            id: r.admission_no, // Use Admission No as public ID
            name: r.name,
            class: r.class,
            section: r.section,
            house: r.house,
            status: r.order_status
        }));

        res.json(safeRows);
    });
});

module.exports = router;
