require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer Storage
// Multer Storage
const UPLOAD_PATH = path.join(process.cwd(), 'public', 'uploads');
console.log("Uploads Directory:", UPLOAD_PATH);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });
        cb(null, UPLOAD_PATH);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
}));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Serve Uploads via Custom Handler (Better Debugging + Case Sensitivity)
app.get('/uploads/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(UPLOAD_PATH, filename);

    if (fs.existsSync(filepath)) {
        return res.sendFile(filepath);
    }

    // Try case-insensitive fallback using readdir
    try {
        const files = fs.readdirSync(UPLOAD_PATH);
        const match = files.find(f => f.toLowerCase() === filename.toLowerCase());
        if (match) {
            return res.sendFile(path.join(UPLOAD_PATH, match));
        }
    } catch (e) {
        console.error("Readdir Error:", e);
    }

    res.status(404).json({ error: "File not found", requested: filename, path: UPLOAD_PATH });
});

// Routes
// (JSON Logic Removed to fallback to SQL Routes)

// Serving Uploads
const authRoutes = require('./routes/auth_v2');
const dataRoutes = require('./routes/data');
console.log("Mounting /api/auth and /api/data routes...");
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);

// UPLOAD ENDPOINT
app.post('/api/data/upload', upload.array('images', 5), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No files uploaded" });
        }
        // Return relative paths
        const fileUrls = req.files.map(f => `/uploads/${f.filename}`);
        res.json({ urls: fileUrls });
    } catch (err) {
        console.error("Upload Error", err);
        res.status(500).json({ error: "Upload failed" });
    }
});

// DEBUG ENDPOINT
app.get('/api/debug/ls', (req, res) => {
    try {
        if (!fs.existsSync(UPLOAD_PATH)) return res.json({ error: "Upload dir does not exist", path: UPLOAD_PATH });
        const files = fs.readdirSync(UPLOAD_PATH);
        res.json({ path: UPLOAD_PATH, files });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Serve Static Files (Frontend)
app.use(express.static(path.join(process.cwd(), 'public')));

// Basic Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../login.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`); // JSON-friendly log for status tool
});