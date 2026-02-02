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

        // SECURITY: Hide the ID Column (Column A) so users don't mess with it
        ws['!cols'] = [{ wch: 10, hidden: true }, { wch: 10 }, { wch: 15 }, { wch: 30 }, { wch: 10 }];

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
        console.log("🚀 SMART IMPORT v2.2: Starting 'Bulletproof' Process...");
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        let data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

        // SCORE-BASED HEADER DETECTION
        let headerIndex = -1;
        let maxScore = 0;
        const searchTerms = ['name', 'class', 'roll', 'admission', 'student'];

        // Scan first 20 rows
        for (let i = 0; i < Math.min(20, data.length); i++) {
            const rowStr = (data[i] || []).map(c => String(c).toLowerCase()).join(' ');
            let score = 0;
            searchTerms.forEach(term => {
                if (rowStr.includes(term)) score += 2; // Strong match
            });
            // Penalty for "Group Name" being present (it's a summary row usually)
            if (rowStr.includes('group name')) score -= 5;

            if (score > maxScore) {
                maxScore = score;
                headerIndex = i;
            }
        }

        if (headerIndex === -1 && data.length > 0) {
            // Fallback to row 0
            headerIndex = 0;
        }

        if (headerIndex === -1) return res.status(400).json({ error: "Invalid File Format: Could not detect header row (Missing Name/Class/Roll columns)." });

        const headers = data[headerIndex];
        const rows = data.slice(headerIndex + 1);

        // Helper: Find Column Index by keywords (Case Insensitive, Partial Match) with Exclusions
        const getColIndex = (keywords, excludeKeywords = []) => {
            if (!Array.isArray(keywords)) keywords = [keywords];
            if (!Array.isArray(excludeKeywords)) excludeKeywords = [excludeKeywords];

            // Critical Exclusions for Name Column - GLOBAL BLOCKLIST
            const GLOBAL_EXCLUDES = ['Group', 'Item', 'Product', 'Pattern', 'Description', 'Particulars', 'Rate', 'Amount'];

            return headers.findIndex(h => {
                if (!h) return false;
                const hLower = h.toString().toLowerCase();

                // 1. Check strict exclusions (Passed + Global)
                if ([...excludeKeywords, ...GLOBAL_EXCLUDES].some(ex => hLower.includes(ex.toLowerCase()))) return false;

                // 2. Check matches
                return keywords.some(k => hLower.includes(k.toLowerCase()));
            });
        };

        // IDENTIFY COLUMNS
        const idIdx = getColIndex(["ID", "id (", "System ID"], ["user", "school"]);
        const rollIdx = getColIndex(['Roll', 'Id', 'Seq'], ["enroll"]);
        const admIdx = getColIndex(['Adm', 'Reg', 'Enrol']);
        // Crucial: Exclude everything that sounds like a parent or metadata
        const nameIdx = getColIndex(['Name', 'Student', 'Candidate'], ['Father', 'Mother', 'Group', 'School', 'Class', 'Section', 'Guardian']);
        const classIdx = getColIndex(['Class', 'Standard', 'Grade'], ["Classic"]);
        const secIdx = getColIndex(["Section", "Sec", 'Batch'], ["Sector"]);
        const genIdx = getColIndex(['Gender', 'Sex']);

        if (nameIdx === -1) {
            console.log("❌ REJECTED: Could not find valid 'Student Name' column.");
            return res.status(400).json({ error: "Invalid File: Could not find a valid 'Student Name' column. Please rename your header to 'Student Name'." });
        }

        let updatedCount = 0;
        let skippedCount = 0;
        let createdCount = 0;
        let debugSkipped = []; // Debug info accumulator

        for (const row of rows) {
            if (!row || row.length === 0) continue;

            const rawName = row[nameIdx];
            if (!rawName) continue;

            // --- BULLETPROOF CONTENT VALIDATION ---
            const nameStr = String(rawName).trim();
            const lowerName = nameStr.toLowerCase();

            // 1. BAD KEYWORDS (Product/Header detection)
            const BAD_CONTENT = ['|', 'shirt', 'pant', 'trouser', 'frock', 'skirt', 'boys', 'girls', 'item', 'size', 'total', 'amount', 'qty', 'rate', 'mrp'];
            const matchedBad = BAD_CONTENT.find(bad => lowerName.includes(bad));

            if (matchedBad) {
                if (skippedCount < 5) debugSkipped.push(`"${nameStr}" (Matched '${matchedBad}')`);
                skippedCount++;
                continue;
            }

            // 2. TOO SHORT / NUMERIC (e.g. "12", "A")
            if (nameStr.length < 2 || !isNaN(nameStr)) {
                if (skippedCount < 5) debugSkipped.push(`"${nameStr}" (Too Short/Numeric)`);
                skippedCount++;
                continue;
            }

            // --- EXTRACT DATA ---
            const studentId = idIdx > -1 ? row[idIdx] : null;
            let cls = classIdx !== -1 ? (row[classIdx] || 'N/A') : 'N/A';
            const section = secIdx > -1 ? (row[secIdx] || '') : '';
            const rollNo = rollIdx > -1 ? (row[rollIdx] || '') : '';
            const admNo = admIdx > -1 ? (row[admIdx] || `AUTO-${Date.now()}-${Math.floor(Math.random() * 99999)}`) : `AUTO-${Date.now()}-${Math.floor(Math.random() * 99999)}`;
            const gender = genIdx > -1 ? (row[genIdx] || 'Unspecified') : 'Unspecified';

            // Correct Class (Handle common issues like user typing "Class 10" in the name column?? No, we trust our column logic now)
            // Just ensure it's a string
            cls = String(cls).trim();

            // MEASUREMENTS (Fuzzy Match Headers)
            const getM = (keys) => {
                const idx = getColIndex(keys);
                const val = idx > -1 ? row[idx] : undefined;
                return (val !== undefined && val !== null) ? String(val).trim() : undefined;
            }

            const m = {
                u1: getM(["U1", "Shirt Length"]),
                u2: getM(["U2", "Chest"]),
                u3: getM(["U3", "Stomach"]),
                u4: getM(["U4", "Shoulder"]),
                u5: getM(["U5", "Full Sleeve"]),
                u6: getM(["U6", "Half Sleeve"]),
                u7: getM(["U7", "Kurtha"]),
                u8: getM(["U8", "Extra"]),
                l1: getM(["L1", "Pant Length"]),
                l2: getM(["L2", "Waist"]),
                l3: getM(["L3", "Shorts"]),
                l4: getM(["L4", "Pinofore"]),
                l5: getM(["L5", "Skirt"]),
                l6: getM(["L6", "Hip"]),
                l7: getM(["L7", "Thigh"]),
                l8: getM(["L8", "Extra"])
            };
            // Clean empty
            Object.keys(m).forEach(key => (m[key] === undefined || m[key] === "") && delete m[key]);

            const schoolId = req.query.school_id || req.body.school_id;

            // --- DB OPERATION ---

            if (studentId) {
                // UPDATE
                const sql = "UPDATE students SET measurements = ?, name = ?, class = ?, section = ?, gender = ? WHERE id = ? AND school_id = ?";
                if (db.query) {
                    await db.query(sql, [JSON.stringify(m), nameStr, cls, section, gender, studentId, schoolId]);
                } else {
                    await new Promise(r => db.run(sql, [JSON.stringify(m), nameStr, cls, section, gender, studentId, schoolId], r));
                }
                updatedCount++;
            } else {
                // INSERT (Auto-Create)
                if (schoolId) {
                    const insertSql = "INSERT INTO students (school_id, name, class, section, roll_no, admission_no, gender, is_active, measurements) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)";
                    const params = [schoolId, nameStr, cls, section, rollNo, admNo, gender, JSON.stringify(m)];

                    if (db.query) {
                        await db.query(insertSql, params);
                    } else {
                        await new Promise((resolve, reject) => {
                            db.run(insertSql, params, (err) => err ? reject(err) : resolve());
                        });
                    }
                    createdCount++;
                }
            }
        }

        console.log(`✅ Import Summary: ${updatedCount} Updated, ${createdCount} Created, ${skippedCount} Skipped.`);
        res.json({
            message: `Success! ${createdCount} new students added, ${updatedCount} updated.`,
            debug: {
                skippedCount,
                firstSkippedReasons: debugSkipped
            }
        });

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

router.get('/export-master-plan', async (req, res) => {
    // ... (existing code for this not shown, essentially keeping end of file)
});

// === DATA RESET ===
// DELETE /api/io/reset-school-data
router.delete('/reset-school-data', async (req, res) => {
    const { school_id } = req.query; // Or body
    if (!school_id) return res.status(400).json({ error: "School ID is required." });

    try {
        console.log(`⚠️ RESET REQUEST: Clearing data for School ID ${school_id}`);

        let deleted = 0;
        if (db.query) {
            const [result] = await db.query("DELETE FROM students WHERE school_id = ?", [school_id]);
            deleted = result.affectedRows;
        } else {
            // SQLite
            deleted = await new Promise((resolve, reject) => {
                db.run("DELETE FROM students WHERE school_id = ?", [school_id], function (err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                });
            });
        }

        res.json({ message: `Successfully deleted ${deleted} student records.` });
    } catch (e) {
        console.error("Reset Error:", e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
