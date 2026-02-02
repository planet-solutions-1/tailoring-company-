const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Placeholder for Report Routes
router.get('/', (req, res) => {
    res.json({ message: "Reports Module Active" });
});

module.exports = router;
