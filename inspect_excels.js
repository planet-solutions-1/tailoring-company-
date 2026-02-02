const XLSX = require('xlsx');
const path = require('path');

const file1 = path.join(__dirname, 'public', 'Production_Plan_Master (2).xlsx');
const file2 = path.join(__dirname, 'public', 'PLANETFINAL_WithData (15).xlsx');

function inspectFile(filePath) {
    console.log(`\n--- Inspecting: ${path.basename(filePath)} ---`);
    try {
        const workbook = XLSX.readFile(filePath);
        console.log("Sheets:", workbook.SheetNames);
        const sheetName = "All Students"; // Check specific sheet
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
            console.log("Sheet 'All Students' not found. Checking Index 1...");
            const idx1 = workbook.SheetNames[1];
            if (idx1) console.log("Index 1 Sheet:", idx1);
        }

        // Read a larger range to find the table start
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, defval: "" });
        console.log(`\n--- Inspecting: ${path.basename(filePath)} (First 15 rows) ---`);
        if (data.length > 0) {
            console.log("HEADERS:", JSON.stringify(data[0])); // Force full output
        }
        for (let i = 0; i < Math.min(data.length, 15); i++) {
            // Filter out empty rows/cells for cleaner view
            const row = data[i].filter(c => c !== "");
            if (row.length > 0) console.log(`Row ${i}:`, row);
        }
    } catch (e) {

        console.error("Error reading file:", e.message);
    }
}

inspectFile(file1);
// inspectFile(file2);
