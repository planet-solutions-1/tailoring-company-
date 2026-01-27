const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../public/planet_local.sqlite');
const db = new sqlite3.Database(dbPath);

const sql = `
    SELECT g.*, g.daily_target, p.current_stage, p.completed_stages, p.notes
    FROM production_groups g
    LEFT JOIN production_progress p ON g.id = p.group_id
    WHERE g.status = 'Active'
    ORDER BY g.created_at DESC
    LIMIT 1
`;

db.get(sql, [], (err, row) => {
    if (err) {
        console.error("Query Error:", err);
        process.exit(1);
    }
    if (!row) {
        console.log("No active groups found to test with.");
        // Create a dummy one if needed, but likely there are some.
    } else {
        console.log("Keys in row:", Object.keys(row));
        console.log("daily_target value:", row.daily_target);
        if (row.hasOwnProperty('daily_target')) {
            console.log("SUCCESS: daily_target is present.");
        } else {
            console.error("FAILURE: daily_target is MISSING.");
            process.exit(1);
        }
    }
    db.close();
});
