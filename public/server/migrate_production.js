const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'planets.db');
const db = new sqlite3.Database(dbPath);

console.log('Running Production Tracking Schema Migration...');

db.serialize(() => {
    // 1. Production Config Table
    db.run(`CREATE TABLE IF NOT EXISTS production_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dress_type TEXT UNIQUE,
        s_labels TEXT, -- JSON Array of 20 strings
        p_labels TEXT, -- JSON Array of 20 strings
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error("Error creating production_config:", err);
        else console.log("Verified production_config table.");
    });

    // 2. Production Groups (Batches)
    db.run(`CREATE TABLE IF NOT EXISTS production_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_name TEXT,
        dress_type TEXT,
        required_stages TEXT, -- JSON Array of boolean/indices
        details TEXT,
        status TEXT DEFAULT 'Active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error("Error creating production_groups:", err);
        else console.log("Verified production_groups table.");
    });

    // 3. Production Progress
    db.run(`CREATE TABLE IF NOT EXISTS production_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER UNIQUE,
        current_stage INTEGER DEFAULT 0,
        completed_stages TEXT, -- JSON Array of indices
        notes TEXT, -- ecash / misc details
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(group_id) REFERENCES production_groups(id) ON DELETE CASCADE
    )`, (err) => {
        if (err) console.error("Error creating production_progress:", err);
        else console.log("Verified production_progress table.");
    });
});

db.close(() => {
    console.log('Migration Complete.');
});
