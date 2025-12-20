const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../planet_local.sqlite');
console.log("Connecting to:", dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to the SQLite database.');
});

db.serialize(() => {
    console.log("Starting DB Cleanup...");

    // 1. Clear Measurements
    db.run("DELETE FROM measurements", (err) => {
        if (err) console.error("Error clearing measurements:", err.message);
        else console.log("✅ Measurements Table Cleared.");
    });

    // 2. Unlink Students
    db.run("UPDATE students SET pattern_id = NULL", (err) => {
        if (err) console.error("Error unlinking students:", err.message);
        else console.log("✅ Students Unlinked from Patterns.");
    });

    // 3. Clear Patterns
    db.run("DELETE FROM patterns", (err) => {
        if (err) console.error("Error clearing patterns:", err.message);
        else console.log("✅ Patterns Table Cleared.");
    });

    // 4. Reset sqlite_sequence for cleanliness
    db.run("DELETE FROM sqlite_sequence WHERE name='patterns' OR name='measurements'", () => { });

    // 5. Ensure Schema (New Feature Support)
    console.log("Ensuring Schema...");

    db.run(`CREATE TABLE IF NOT EXISTS patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        consumption REAL DEFAULT 0,
        cloth_details TEXT,
        special_req TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
    )`, (err) => {
        if (err) console.error("Error creating patterns table:", err.message);
        else console.log("✅ Patterns Table Schema Verified.");
    });

    // Add pattern_id column if missing - silent fail if exists
    db.run("ALTER TABLE students ADD COLUMN pattern_id INTEGER REFERENCES patterns(id) ON DELETE SET NULL", (err) => {
        if (err && !err.message.includes('duplicate column')) console.log("Note on ALTER:", err.message);
        else console.log("✅ Students Table Schema Verified (pattern_id).");
    });

    // Add production_data column if missing
    db.run("ALTER TABLE students ADD COLUMN production_data TEXT", (err) => { // Store JSON string of Item/Qty
        if (err && !err.message.includes('duplicate column')) console.log("Note on ALTER (production_data):", err.message);
        else console.log("✅ Students Table Schema Verified (production_data).");
    });

});

db.close((err) => {
    if (err) return console.error(err.message);
    console.log('Close the database connection.');
});
