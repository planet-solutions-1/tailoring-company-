try {
    console.log("Testing require paths...");
    console.log("1. Requiring xlsx...");
    require('xlsx');
    console.log("SUCCESS: xlsx");

    console.log("2. Requiring multer...");
    require('multer');
    console.log("SUCCESS: multer");

    console.log("3. Requiring config/db...");
    require('./public/server/config/db');
    console.log("SUCCESS: config/db");

    console.log("4. Requiring routes/import_export...");
    require('./public/server/routes/import_export');
    console.log("SUCCESS: routes/import_export");

} catch (e) {
    console.error("FAILURE:", e.message);
    console.error("CODE:", e.code);
    console.error("STACK:", e.stack);
}
