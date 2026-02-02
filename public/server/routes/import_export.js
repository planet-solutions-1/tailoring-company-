const express = require('express');
const router = express.Router();
const db = require('../config/db');
const xlsx = require('xlsx');
const multer = require('multer');
const fs = require('fs');

// Configure Multer for processing files in memory
const upload = multer({ storage: multer.memoryStorage() });

// === EXPORT: Generate Measurement Sheet ===
// GET /api/io/measurements/:school_id
router.get('/measurements/:school_id', async (req, res) => {
    const { school_id } = req.params;

    try {
        // 1. Fetch School & Students
        const schoolQuery = "SELECT name, district FROM schools WHERE id = ?";
        const studentsQuery = "SELECT * FROM students WHERE school_id = ? AND is_active = 1 AND is_deleted = 0 ORDER BY class, section, roll_no";

        let school, students;

        // DB Abstraction - Handling both Promise (MySQL) and Callback (SQLite) styles roughly
        // Ideally rely on the uniform `db.query` or `db.get/all` wrapper if it supports promises.
        // Assuming db.query returns a promise based on previous file inspection:
        if (db.query) {
            const [sRows] = await db.query(schoolQuery, [school_id]);
            school = sRows[0];
            const [stRows] = await db.query(studentsQuery, [school_id]);
            students = stRows;
        } else {
            // Fallback for older sqlite wrapper if needed (simplified)
            return res.status(500).json({ error: "Database wrapper does not support promises" });
        }

        if (!school) return res.status(404).json({ error: "School not found" });

        // 2. Prepare Excel Data
        // HEADER METADATA
        const metadata = [
            ["FILE METADATA"],
            ["School ID:", school_id],
            ["School Name:", school.name],
            ["Location:", school.district],
            ["Generated On:", new Date().toLocaleString()],
            [] // Spacer
        ];

        // COLUMNS
        const headerRow = [
            "ID (DO NOT EDIT)", "Roll No", "Admission No", "Student Name", "Class", "Section", "Gender",
            "U1 (SHIRT LENGTH)", "U2 (CHEST)", "U3 (STOMACH)", "U4 (SHOULDER)", "U5 (FULL SLEEVE)", "U6 (HALF SLEEVE)", "U7 (KURTHA/SPECIAL)", "U8 (EXTRA)",
            "L1 (PANT LENGTH)", "L2 (WAIST)", "L3 (SHORTS LENGTH)", "L4 (PINOFORE LENGTH)", "L5 (SKIRT LENGTH)", "L6 (HIP)", "L7 (THIGH)", "L8 (EXTRA)"
        ];

        const dataRows = students.map(s => {
            let m = {};
            try { m = JSON.parse(s.measurements || '{}'); } catch (e) { }

            return [
                s.id, s.roll_no, s.admission_no, s.name, s.class, s.section, s.gender,
                m.u1 || "", m.u2 || "", m.u3 || "", m.u4 || "", m.u5 || "", m.u6 || "", m.u7 || "", m.u8 || "",
                m.l1 || "", m.l2 || "", m.l3 || "", m.l4 || "", m.l5 || "", m.l6 || "", m.l7 || "", m.l8 || ""
            ];
        });

        const wsData = [...metadata, headerRow, ...dataRows];
        const ws = xlsx.utils.aoa_to_sheet(wsData);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, "Measurements");

        // 3. Send Buffer
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', `attachment; filename="Measurements_${school.name.replace(/ /g, '_')}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (e) {
        console.error("Export Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// === IMPORT: Process Measurement Sheet ===
// POST /api/io/measurements
router.post('/measurements', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        // Find Header Row (Look for "Student Name")
        let headerIndex = -1;
        for (let i = 0; i < Math.min(data.length, 20); i++) {
            if (data[i].includes("Student Name") || data[i].includes("ID (DO NOT EDIT)")) {
                headerIndex = i;
                break;
            }
        }

        if (headerIndex === -1) return res.status(400).json({ error: "Invalid File Format: Could not find header row." });

        const headers = data[headerIndex];
        const rows = data.slice(headerIndex + 1);

        let updatedCount = 0;

        for (let row of rows) {
            // Map columns roughly based on known structure or index
            // Assuming fixed index from our Export, but allow robustness
            const idIndex = headers.indexOf("ID (DO NOT EDIT)");
            const rollIndex = headers.indexOf("Roll No");

            // Core data
            const studentId = idIndex > -1 ? row[idIndex] : null;

            // Construct Measurements Object
            // Indices (roughly based on export)
            const m = {
                u1: row[headers.indexOf("U1 (SHIRT LENGTH)")],
                u2: row[headers.indexOf("U2 (CHEST)")],
                u3: row[headers.indexOf("U3 (STOMACH)")],
                u4: row[headers.indexOf("U4 (SHOULDER)")],
                u5: row[headers.indexOf("U5 (FULL SLEEVE)")],
                u6: row[headers.indexOf("U6 (HALF SLEEVE)")],
                u7: row[headers.indexOf("U7 (KURTHA/SPECIAL)")],
                u8: row[headers.indexOf("U8 (EXTRA)")],
                l1: row[headers.indexOf("L1 (PANT LENGTH)")],
                l2: row[headers.indexOf("L2 (WAIST)")],
                l3: row[headers.indexOf("L3 (SHORTS LENGTH)")],
                l4: row[headers.indexOf("L4 (PINOFORE LENGTH)")],
                l5: row[headers.indexOf("L5 (SKIRT LENGTH)")],
                l6: row[headers.indexOf("L6 (HIP)")],
                l7: row[headers.indexOf("L7 (THIGH)")],
                l8: row[headers.indexOf("L8 (EXTRA)")]
            };

            // Remove empty/undefined
            Object.keys(m).forEach(key => (m[key] === undefined || m[key] === "") && delete m[key]);

            if (studentId) {
                // Update by ID
                await db.query("UPDATE students SET measurements = ? WHERE id = ?", [JSON.stringify(m), studentId]);
                updatedCount++;
            }
        }

        res.json({ message: `Successfully updated ${updatedCount} student records.` });

    } catch (e) {
        console.error("Import Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// === IMPORT: Master Production Plan ===
// POST /api/io/production-plan
router.post('/production-plan', upload.single('file'), async (req, res) => {
    const { school_id } = req.body;
    if (!school_id) return res.status(400).json({ error: "School ID is required" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    try {
        const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(sheet); // Assume standard Key-Value headers on Row 1

        let createdBatches = 0;

        for (let row of data) {
            // Mapping based on user file: 'Group Name', 'Dress Type', 'Student Count'
            const groupName = row['Group Name'];
            const dressType = row['Dress Type'] || "Standard";
            const count = parseInt(row['Student Count'] || 0);

            if (groupName && count > 0) {
                // Create Production Group
                const [res] = await db.query(
                    "INSERT INTO production_groups (group_name, dress_type, daily_target, quantity, status, notes) VALUES (?, ?, ?, ?, 'Active', ?)",
                    [groupName, dressType, Math.ceil(count * 0.1), count, "Imported from Master Plan"]
                );
                const newGroupId = res.insertId;

                // Init Progress
                const stages = ["Measurements", "Pattern", "Cutting", "Stitching", "Finishing", "Packing", "Dispatch"];
                const stageMap = { "Measurements": "Pending", "Pattern": "Pending", "Cutting": "Pending" }; // Default start
                await db.query(
                    "INSERT INTO production_progress (group_id, completed_stages) VALUES (?, ?)",
                    [newGroupId, JSON.stringify(stageMap)]
                );

                createdBatches++;
            }
        }

        res.json({ message: `Production Plan Imported. Created ${createdBatches} new batches.` });

    } catch (e) {
        console.error("Plan Import Error:", e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
