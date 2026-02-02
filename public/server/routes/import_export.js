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
        const schoolQuery = "SELECT name, address FROM schools WHERE id = ?";
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
            ["Location:", school.address || ""],
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
    if (!school_id) return res.status(400).json({ error: "School ID is required for Master Plan Import" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    try {
        const wb = xlsx.read(req.file.buffer, { type: 'buffer' });

        let createdBatches = 0;
        let createdStudents = 0;

        // 1. Process Overview (Batches)
        const overviewSheet = wb.Sheets[wb.SheetNames[0]]; // Assume First Sheet is Overview
        if (overviewSheet) {
            const batchData = xlsx.utils.sheet_to_json(overviewSheet);
            for (let row of batchData) {
                // Key Mapping: 'Group Name', 'Dress Type', 'Student Count'
                const groupName = row['Group Name'];
                const dressType = row['Dress Type'] || "Standard";
                const count = parseInt(row['Student Count'] || 0);

                if (groupName && count > 0) {
                    // 1. Auto-Register Dress Type if New
                    const [configExists] = await db.query("SELECT id FROM production_config WHERE dress_type = ?", [dressType]);
                    if (!configExists || configExists.length === 0) {
                        const defaultS = JSON.stringify(Array(20).fill('').map((_, i) => `Stage ${i + 1}`));
                        const defaultP = JSON.stringify(Array(20).fill('').map((_, i) => `Process ${i + 1}`));
                        await db.query("INSERT INTO production_config (dress_type, s_labels, p_labels) VALUES (?, ?, ?)", [dressType, defaultS, defaultP]);
                    }

                    // 2. Check existing group to prevent duplicates (Optional but good)
                    const [existingGroup] = await db.query("SELECT id FROM production_groups WHERE group_name = ?", [groupName]);
                    if (existingGroup && existingGroup.length > 0) continue; // Skip if group name already exists

                    const [res] = await db.query(
                        "INSERT INTO production_groups (group_name, dress_type, daily_target, quantity, status, notes) VALUES (?, ?, ?, ?, 'Active', ?)",
                        [groupName, dressType, Math.ceil(count * 0.1), count, "Imported from Master Plan"]
                    );
                    const newGroupId = res.insertId;

                    // Init Progress
                    const stageMap = { "Measurements": "Pending", "Pattern": "Pending", "Cutting": "Pending" };
                    await db.query("INSERT INTO production_progress (group_id, completed_stages) VALUES (?, ?)", [newGroupId, JSON.stringify(stageMap)]);
                    createdBatches++;
                }
            }
        }

        // 2. Process Students ("All Students" Sheet or Index 1)
        let studentSheet = wb.Sheets["All Students"];
        if (!studentSheet && wb.SheetNames.length > 1) {
            studentSheet = wb.Sheets[wb.SheetNames[1]]; // Fallback to 2nd sheet
        }

        if (studentSheet) {
            // Headerless read or Assumption based on inspection
            // Row Format: Group | Dress | Sn | Name | Class | Section | Gender | Qty | U1..U8 | L1..L8
            const rawData = xlsx.utils.sheet_to_json(studentSheet, { header: 1, defval: "" });

            // Skip Header Row if it exists (Check if Row 0 col 0 is 'Group Name' or similar)
            let startRow = 0;
            if (rawData.length > 0 && (rawData[0][0] || "").toString().toLowerCase().includes("group")) {
                startRow = 1;
            }

            for (let i = startRow; i < rawData.length; i++) {
                const row = rawData[i];
                if (!row || row.length < 5) continue; // Skip empty rows

                // Column Mapping (based on 24-col pattern)
                // 0:Group, 1:Dress, 2:Sn, 3:Name, 4:Class, 5:Section, 6:Gender, 7:Qty
                // 8-15: U1-U8, 16-23: L1-L8

                const name = row[3];
                const cls = row[4];
                const section = row[5];

                if (!name) continue;

                // Measurements
                const m = {
                    u1: row[8], u2: row[9], u3: row[10], u4: row[11], u5: row[12], u6: row[13], u7: row[14], u8: row[15],
                    l1: row[16], l2: row[17], l3: row[18], l4: row[19], l5: row[20], l6: row[21], l7: row[22], l8: row[23]
                };

                // Remove undefined
                Object.keys(m).forEach(k => (m[k] === undefined || m[k] === "") && delete m[k]);

                // UPSERT Logic (Check if student exists in School)
                // Match by Name + Class + Section (Best effort)
                const [existing] = await db.query(
                    "SELECT id FROM students WHERE school_id = ? AND name = ? AND class = ? AND section = ?",
                    [school_id, name, cls, section]
                );

                if (existing && existing.length > 0) {
                    // Update
                    await db.query("UPDATE students SET measurements = ? WHERE id = ?", [JSON.stringify(m), existing[0].id]);
                } else {
                    // Insert
                    // Use S.No (row[2]) as Roll No if available
                    const rollNo = row[2] || "";
                    const admNo = `IMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`; // Auto-gen Admission No to pass Not Null constraint

                    await db.query(
                        "INSERT INTO students (school_id, name, class, section, gender, roll_no, admission_no, measurements, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
                        [school_id, name, cls, section, row[6] || 'Unspecified', rollNo, admNo, JSON.stringify(m)]
                    );
                    createdStudents++;
                }
            }
        }

        res.json({ message: `Import Complete. Created ${createdBatches} Batches and ${createdStudents} New Students.` });

    } catch (e) {
        console.error("Plan Import Error:", e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
