const sqlite3 = require('sqlite3').verbose();
const path = require('path');
// const bcrypt = require('bcrypt'); // Not used

const dbPath = path.join(__dirname, '../planet_local.sqlite');
const db = new sqlite3.Database(dbPath);

const CONFIG_SCHOOL_NAME = "SYSTEM_CONFIG";
const CONFIG_SCHOOL_ADDRESS_MARKER = "SYSTEM_CONFIG_V1";

const CUSTOM_CONFIG = {
    items: [
        { name: "DEBUG_TEST_ITEM_SHIRT", cols: ["U1", "U2"], type: "Male" },
        { name: "DEBUG_TEST_ITEM_PANT", cols: ["L1", "L2"], type: "Male" }
    ],
    formulas: {}
};

const payload = {
    marker: CONFIG_SCHOOL_ADDRESS_MARKER,
    data: CUSTOM_CONFIG
};

const addressJson = JSON.stringify(payload);

async function seed() {
    console.log("Connecting to DB at:", dbPath);

    // 1. Check if exists
    db.get("SELECT * FROM schools WHERE name = ?", [CONFIG_SCHOOL_NAME], async (err, row) => {
        if (err) {
            console.error("Select Error:", err);
            return;
        }

        if (row) {
            console.log("SYSTEM_CONFIG exists (ID: " + row.id + "). Updating...");
            db.run("UPDATE schools SET address = ? WHERE id = ?", [addressJson, row.id], (err) => {
                if (err) console.error("Update Failed:", err);
                else console.log("SUCCESS: Updated SYSTEM_CONFIG with debug items.");
            });
        } else {
            console.log("SYSTEM_CONFIG missing. Creating...");
            // const hash = await bcrypt.hash("system_locked", 10);
            const hash = "$2b$10$debugdummyhashvalidlength123456";
            db.run(
                "INSERT INTO schools (name, username, password_hash, address, phone, email) VALUES (?, ?, ?, ?, ?, ?)",
                [CONFIG_SCHOOL_NAME, "system_config", hash, addressJson, "000", "config@local"],
                function (err) {
                    if (err) console.error("Insert Failed:", err);
                    else console.log("SUCCESS: Created SYSTEM_CONFIG with debug items. ID:", this.lastID);
                }
            );
        }
    });
}

seed();
