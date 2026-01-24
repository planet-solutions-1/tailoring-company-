const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    try {
        const pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT || 3306
        });

        console.log("--- CONFIG TABLE ---");
        const [configs] = await pool.query("SELECT DISTINCT dress_type FROM production_config");
        console.log(JSON.stringify(configs.map(c => c.dress_type)));

        console.log("\n--- GROUPS TABLE ---");
        const [groups] = await pool.query("SELECT DISTINCT dress_type FROM production_groups");
        console.log(JSON.stringify(groups.map(g => g.dress_type)));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
