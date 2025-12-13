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
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
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
}));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Serve Uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
const authRoutes = require('./routes/auth_v2');
const dataRoutes = require('./routes/data');
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

// Serve Static Files (Frontend)
app.use(express.static(path.join(__dirname, '../')));

// Basic Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../login.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`); // JSON-friendly log for status tool
});
