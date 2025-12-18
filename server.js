const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'students.json');
const COMPLAINTS_FILE = path.join(__dirname, 'complaints.json');

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('public'));

// === DATABASE HELPERS ===
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

// === ROUTES ===

// 1. SCHOOL DETAILS (Fixes 404)
app.get('/api/schools/:id', (req, res) => {
    // Return mock school details
    res.json({
        id: req.params.id,
        name: "Demo School (Synced)",
        address: "123 Education Lane",
        logo: ""
    });
});

// 2. STUDENTS (Sync & Fetch)
app.post('/api/sync', (req, res) => {
    const { students } = req.body;
    if (Array.isArray(students)) {
        writeJson(DB_FILE, students);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: "Invalid data" });
    }
});

// Match frontend: `/api/data/students/${schoolId}` or `/api/school/students`
app.get(['/api/data/students/:id', '/api/school/students'], (req, res) => {
    res.json(readJson(DB_FILE));
});

// 3. PUBLIC FETCH (Student View)
app.get('/api/public/students', (req, res) => {
    const { class: cls, section, admission_no } = req.query;
    let students = readJson(DB_FILE);

    if (cls) students = students.filter(s => String(s.class || '').trim() == cls);
    if (section) students = students.filter(s => String(s.section || '').trim() == section);
    if (admission_no) students = students.filter(s => String(s.admission_no || '') == admission_no);

    res.json(students);
});

// 4. COMPLAINTS (Support)
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

// 5. MOCK UPLOAD (Images)
app.post('/api/data/upload', (req, res) => {
    // We can't easily save multipart files without multer, so we return a placeholder
    // Or we expect base64? Frontend sends `FormData`.
    // For simplicity, just return a success with a fake or generic URL.
    res.json({
        url: "https://via.placeholder.com/150",
        message: "File uploaded (Mock)"
    });
});

// Catch-all
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});