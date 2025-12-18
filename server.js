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
// === DATABASE LOGIC (Injected Fix) ===
const DB_FILE = path.join(__dirname, 'database', 'students.json');
const COMPLAINTS_FILE = path.join(__dirname, 'database', 'complaints.json');
const SCHOOLS_FILE = path.join(__dirname, 'database', 'schools.json');

// Ensure DB Dir
if (!fs.existsSync(path.dirname(DB_FILE))) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

function readJson(file) {
    if (!fs.existsSync(file)) return [];
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.error("Read Error", file, e);
        return [];
    }
}
function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// === NEW API ENDPOINTS (Fixing 404s & 500s) ===
// 1. School Details (Dynamic)
app.get('/api/schools/:id', (req, res) => {
    const schools = readJson(SCHOOLS_FILE);
    const school = schools.find(s => String(s.id) === String(req.params.id));
    if (school) {
        res.json(school);
    } else {
        res.json({ id: req.params.id, name: "Unknown School", address: "N/A", logo: "" });
    }
});

// 2. Sync Logic (Laptop -> Server)
app.post('/api/sync', (req, res) => {
    const { students } = req.body;
    if (Array.isArray(students)) {
        writeJson(DB_FILE, students);
        res.json({ success: true, count: students.length });
    } else {
        res.status(400).json({ error: "Invalid data" });
    }
});

// 3. Public Student Fetch (Mobile View)
app.get('/api/public/students', (req, res) => {
    const { class: cls, section, admission_no } = req.query;
    let students = readJson(DB_FILE);
    if (cls) students = students.filter(s => String(s.class || '').trim() === cls);
    if (section) students = students.filter(s => String(s.section || '').trim() === section);
    if (admission_no) students = students.filter(s => String(s.admission_no || '') === admission_no);
    res.json(students);
});

// 3.5 DELETE Student (Fix 500 Error & 404 for Imported Data)
app.delete('/api/data/students/:id', (req, res) => {
    const idToDelete = req.params.id;
    let students = readJson(DB_FILE);
    const initialLen = students.length;

    // Filter out the student (Match by database ID OR admission number)
    // Trim whitespace to ensure clean matching
    students = students.filter(s =>
        String(s.id || '').trim() !== String(idToDelete).trim() &&
        String(s.admission_no || '').trim() !== String(idToDelete).trim()
    );

    if (students.length < initialLen) {
        writeJson(DB_FILE, students);
        res.json({ success: true, message: "Deleted" });
    } else {
        res.status(404).json({ error: "Student not found" });
    }
});

// 4. Complaints Logic
app.get(['/api/data/complaints/:id', '/api/data/my_complaints'], (req, res) => {
    res.json(readJson(COMPLAINTS_FILE));
});
app.post('/api/data/complaints', (req, res) => {
    const ticket = { ...req.body, id: Date.now(), status: 'Pending', created_at: new Date() };
    const tickets = readJson(COMPLAINTS_FILE);
    tickets.push(ticket);
    writeJson(COMPLAINTS_FILE, tickets);
    res.json(ticket);
});

// === END INJECTED FIX ===

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