const db = require('./config/db');

async function check() {
    console.log("Checking DB Type:", db.execute ? 'MySQL' : 'SQLite');
    const sql = "SELECT id, name, address FROM schools WHERE name = 'SYSTEM_CONFIG'";

    if (db.execute) {
        const [rows] = await db.execute(sql);
        console.log("Rows:", rows);
    } else {
        db.all(sql, [], (err, rows) => {
            if (err) console.error(err);
            console.log("Rows:", rows);
        });
    }
}

check();
