const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'public/production.db'); // Wait, check config/db.js involves planet_local.sqlite or production.db?
// Let's check db definition first.
const db = new sqlite3.Database('c:/Users/sajus/.gemini/antigravity/scratch/planetsolutions/excel-editor-dashboard/public/planet_local.sqlite');

db.all("SELECT id, group_name, daily_target FROM production_groups", [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log("Groups Data:", rows);
});
