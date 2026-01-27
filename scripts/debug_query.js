const path = require('path');
// Adjust path to db config based on project structure
const db = require('../public/server/config/db');

const sql = `
    SELECT g.*, g.daily_target, p.current_stage, p.completed_stages, p.notes
    FROM production_groups g
    LEFT JOIN production_progress p ON g.id = p.group_id
    WHERE g.status = 'Active'
    ORDER BY g.created_at DESC
`;

console.log("Running query...");
db.all(sql, [], (err, rows) => {
    if (err) {
        console.error("Error running query:", err);
        return;
    }
    console.log(`Found ${rows.length} rows.`);
    if (rows.length > 0) {
        console.log("First row sample:");
        console.log(JSON.stringify(rows[0], null, 2));

        console.log("\nChecking daily_target values:");
        rows.forEach(row => {
            console.log(`ID: ${row.id}, Batch: ${row.batch_number}, Daily Target: ${row.daily_target} (Type: ${typeof row.daily_target})`);
        });
    } else {
        console.log("No active groups found.");
    }
});
