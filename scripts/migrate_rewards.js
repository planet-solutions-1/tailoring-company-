const db = require('../public/server/config/db');

function migrate() {
    console.log("Starting Migration: Rewards & Delay System...");

    db.serialize(() => {
        // Add points column
        db.run("ALTER TABLE production_groups ADD COLUMN points INTEGER DEFAULT 0", (err) => {
            if (err && !err.message.includes("duplicate column")) {
                console.error("Error adding points:", err.message);
            } else {
                console.log("Column 'points' added or exists.");
            }
        });

        // Add delay_reason column
        db.run("ALTER TABLE production_groups ADD COLUMN delay_reason TEXT DEFAULT ''", (err) => {
            if (err && !err.message.includes("duplicate column")) {
                console.error("Error adding delay_reason:", err.message);
            } else {
                console.log("Column 'delay_reason' added or exists.");
            }
        });

        // Add daily_target column (optional based on request, but good to have)
        db.run("ALTER TABLE production_groups ADD COLUMN daily_target INTEGER DEFAULT 0", (err) => {
            if (err && !err.message.includes("duplicate column")) {
                console.error("Error adding daily_target:", err.message);
            } else {
                console.log("Column 'daily_target' added or exists.");
            }
        });
    });
}

migrate();
