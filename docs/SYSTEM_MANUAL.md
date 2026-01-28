# 📘 Planet Solutions - Uniform Management System (v1.2.0)
> **Comprehensive System Report & User Manual**
> *Prepared for Planet Solutions*
> *CONFIDENTIAL - INTERNAL USE ONLY*

---

## 1. Executive Summary
The Planet Solutions Uniform Management System is an end-to-end Enterprise Resource Planning (ERP) platform custom-built for high-volume uniform manufacturing. It digitizes the entire lifecycle from school data collection (measurements) to cutting, stitching, and final packing delivery.

**Core Value Proposition:**
- **Zero Data Loss**: Cloud-synced database replaces fragile Excel sheets.
- **Real-Time Tracking**: Know exactly where every student's uniform is (Pending -> Cutting -> Stitching -> Packing).
- **Automated Logistics**: Auto-generates packing stickers, invoices, and cloth consumption reports.

---

## 2. System Architecture (Technical Report)

### 👨‍💻 System Architect & Lead Developer
This entire software ecosystem was architected, developed, and deployed by **Anson Saju**.
- **Role**: Full Stack Architect
- **Responsibility**: End-to-end development (Frontend, Backend, Database, Security, DevOps).

### 🛠 Technology Stack
| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | HTML5, TailwindCSS, Vanilla JS | High-performance, low-dependency UI. |
| **Backend** | Node.js (Express) | Scalable, event-driven API server. |
| **Database** | MySQL (Cloud) / SQLite (Local) | Dual-mode hybrid data storage. |
| **Hosting** | Railway.app | Continuous Deployment & Cloud Infrastructure. |
| **Security** | JWT, Bcrypt, WAF-Lite | Enterprise-standard data protection. |

### 🛡️ Security Features
1.  **Role-Based Access Control (RBAC)**: Strict segregation of duties.
    - *Company Admin*: Full System Control.
    - *School User*: Restricted to their own student data (Read-Only when locked).
    - *Production Staff*: Limited to status updates.
2.  **Rate Limiting**: Intelligent firewall blocks brute-force login attempts.
3.  **Data Safety**:
    - **Soft Delete**: "Recycle Bin" allows recovery of accidentally deleted items for 5 days.
    - **Auto-Backup**: System self-heals critical configuration and logs all activities.

---

## 3. High-Performance Features (Advanced)

### 🧠 Auto-Heal System ("The Brain")
The system includes a self-repairing engine designed by Anson Saju that runs in the background.
- **Database Repair**: Automatically detects missing configuration rows or corrupted schema and regenerates them instantly.
- **Connection Recovery**: If the database connection drops, the system holds requests in a queue and retries seamlessly once reconnected.
- **Zero-Downtime**: Ensures the production floor never stops even during minor server hiccups.

### 🌍 Global Deployment & Data Freedom
- **Global Deploy**: The system is containerized and runs on the Cloud (Railway), making it accessible from any device, anywhere in the world.
- **Full Data Download**: Admins can download the *entire* database (JSON/SQL format) with one click for offline backup or migration.
- **Sync Cloud**: Local changes in the Planet Editor can be pushed to the global server with a single button.

### 📜 Comprehensive Audit Logs
Every action in the system is recorded for accountability.
- **Access Logs**: Who logged in, when, and from what IP address.
- **Activity Logs**: Tracks every deleted student, modified quantity, or status update (e.g., "User X moved Order #123 to Cutting").
- **Error Logs**: Captures system faults for instant debugging by the developer.

---

## 4. Dashboard Ecosystem (User Manual)

The system consists of **6 Specialized Dashboards**, each tailored to a specific department.

### 🏢 1. Company Dashboard (Command Center)
**Audience**: Super Admins, Managers
**Key Features**:
- **School Management**: Add/Edit Schools, Toggle "Lockdown Mode" (Read-Only).
- **Master Data**: Define Dress Types (e.g., "Summer Uniform", "Sports Kit").
- **Analytics & Logs**: View system-wide activity logs and error reports.
- **Recycle Bin**: Restore deleted students or schools.

### 🏭 2. Production Dashboard (The Floor)
**Audience**: Floor Managers, Supervisors
**Key Features**:
- **Kanban Flow**: Move batches through stages: `Pending` → `Cutting` → `Stitching` → `Finished`.
- **Priority Handling**:
    - **Urgent (⭐️)**: Highlights batches requiring immediate attention.
    - **Paused (⏸)**: Greys out batches waiting for raw materials.
- **Process Tracking**: Track sub-tasks (e.g., "Collar Stitching", "Buttoning") for granular control.

### ✂️ 3. Planet Editor (Pattern & Design Lab)
**Audience**: Pattern Masters, Data Entry Operators
A powerful, Excel-like interface for managing measurement data and pattern creation.
**Key Features**:
- **Rapid Data Entry**: Spreadsheet interface for bulk editing student measurements.
- **Math Engine**: Auto-calculates cloth consumption based on student count & size (e.g., "Total Cloth: 450.5 Meters").
- **Cloud Sync**: One-click synchronization pushes local edits to the central database.
- **Export Power**: Generate PDF Breakdowns and Excel sheets for the cutting master.

### 📦 4. Packing Dashboard (Logistics)
**Audience**: Packing Team, Dispatch
**Key Features**:
- **Scan & Pack**: Mark individual items as "Packed" (Checkbox or QR Scan).
- **Bulk Operations**: "Pack Visible" button to mark entire filtered lists (e.g., "All Class 10A") as ready.
- **Sticker Generation**: Auto-creates PDF labels for bags with Student Name, Roll No, and Items.
- **Invoicing**: Generates delivery challans and packing lists for schools.
- **Visual Progress**: Progress bars show % completion per class (e.g., "Class 5B: 80% Packed").

### 🧩 5. Pattern Dashboard (Grouping)
**Audience**: Cutters, Masters
**Key Features**:
- **Pattern Grouping**: Automatically groups students by measurement profiles (e.g., "Size 32 - Slim").
- **Optimization**: Helps cutters minimize waste by cutting similar sizes together.
- **Printable Cards**: Generates "Job Cards" for specific pattern groups.

### 🏫 6. School Portal (Client View)
**Audience**: School Principals, Coordinators
**Key Features**:
- **Live Status**: View real-time status of their students' orders.
- **Measurement Card**: Interactive form for measuring students (if allowed).
- **Read-Only Mode**: When "Locked" by Company, they can only view data, preventing last-minute changes.

---

## 5. Operational Workflows

### ⚡ Urgent Order Handling
1.  Go to **Production Dashboard**.
2.  Find the specific batch.
3.  Click the **Star Icon (⭐️)**.
4.  *Result*: The batch jumps to the top of the list and gets a red border.

### 🛑 Pausing Production
1.  If fabric is missing, click the **Pause Icon (⏸)** on the batch.
2.  *Result*: Batch turns grey and moves to the bottom, signaling "On Hold".

### 📦 Dispatch Process
1.  Go to **Packing Dashboard**.
2.  Filter by `Class` (e.g., "10-A").
3.  Click **Pack Visible** to confirm physical packing.
4.  Click **Stickers** to print bag labels.
5.  Click **PDF** to print the final delivery list for the driver.

---

## 6. Troubleshooting & Support

| Issue | Potential Cause | Solution |
| :--- | :--- | :--- |
| **"Sync Failed" in Editor** | School is Locked | Ask Admin to Unlock in Company Dashboard. |
| **"Canvas Error" on Charts** | Browser Cache | Refresh the page (Ctrl+R). Fixed in v1.2.0. |
| **"User Not Found"** | Wrong Credentials | Verify footer says `v1.2.0`. Contact Support. |

---
*© 2026 Planet Solutions. Developed by Anson Saju.*
