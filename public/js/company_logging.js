
// === LOGGING & REPORTS LOGIC ===
async function initReports() {
    if (globalSchools.length === 0) await fetchSchoolsForSelect();
    if (globalStudents.length === 0) await fetchUsers(); // Re-use fetchUsers to get user list if needed

    // Populate Filters
    const schoolSelect = document.getElementById('log-filter-school');
    const userSelect = document.getElementById('log-filter-user');

    // Populate Schools
    if (schoolSelect && schoolSelect.options.length <= 1) {
        schoolSelect.innerHTML = '<option value="All">All Schools</option>' + globalSchools.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }

    // Populate Users (We need a globalUsers list, assuming fetchUsers populated the DOM but didn't save to global var. Let's fix fetchUsers or just fetch again here)
    // For now, let's just fetch users specifically for this filter
    try {
        const r = await fetch(`${API_BASE}/data/users`, { headers: { 'Authorization': `Bearer ${token}` } });
        const users = await r.json();
        if (Array.isArray(users)) {
            userSelect.innerHTML = '<option value="All">All Users</option>' + users.map(u => `<option value="${u.id}">${u.username} (${u.role})</option>`).join('');
        }
    } catch (e) { console.error("User Fetch Log Error", e); }

    fetchActivityLogs();
}

async function fetchActivityLogs() {
    const loading = document.getElementById('logs-loading');
    const empty = document.getElementById('logs-empty');
    const tbody = document.getElementById('logs-list-body');

    if (loading) loading.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if (tbody) tbody.innerHTML = '';

    const schoolId = document.getElementById('log-filter-school')?.value || 'All';
    const userId = document.getElementById('log-filter-user')?.value || 'All';
    const startDate = document.getElementById('log-filter-start-date')?.value;
    const endDate = document.getElementById('log-filter-end-date')?.value;

    // Build Query
    let query = `?limit=200`; // Default limit for view
    if (schoolId !== 'All') query += `&school_id=${schoolId}`;
    if (userId !== 'All') query += `&user_id=${userId}`;
    if (startDate) query += `&start_date=${startDate}`;
    if (endDate) query += `&end_date=${endDate}`;

    try {
        const r = await fetch(`${API_BASE}/data/logs${query}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const logs = await r.json();

        if (loading) loading.classList.add('hidden');

        if (!Array.isArray(logs) || logs.length === 0) {
            if (empty) empty.classList.remove('hidden');
            return;
        }

        if (tbody) {
            tbody.innerHTML = logs.map(l => `
                <tr class="hover:bg-blue-50/50 transition-colors border-b border-gray-50 last:border-none group">
                    <td class="p-4 text-xs font-bold text-gray-500 whitespace-nowrap">${new Date(l.created_at).toLocaleString()}</td>
                    <td class="p-4 font-bold text-blue-600">${l.username}</td>
                    <td class="p-4 uppercase text-[10px] font-bold tracking-wider text-gray-400">${l.role}</td>
                    <td class="p-4 text-gray-500">${l.school_id || '-'}</td>
                    <td class="p-4 font-bold text-gray-700">${l.action}</td>
                    <td class="p-4 text-gray-400 font-mono text-[10px] max-w-[200px] truncate group-hover:whitespace-normal group-hover:break-words group-hover:max-w-none" title="${l.details}">${l.details || ''}</td>
                </tr>
            `).join('');
        }
    } catch (e) {
        console.error("Log Fetch Error", e);
        if (loading) loading.innerText = "Error loading logs";
    }
}

// === NEW: LOGS CSV EXPORT ===
function downloadLogsCSV() {
    const schoolId = document.getElementById('log-filter-school')?.value || 'All';
    const userId = document.getElementById('log-filter-user')?.value || 'All';
    const startDate = document.getElementById('log-filter-start-date')?.value;
    const endDate = document.getElementById('log-filter-end-date')?.value;

    const query = `?limit=none` +
        (schoolId !== 'All' ? `&school_id=${schoolId}` : '') +
        (userId !== 'All' ? `&user_id=${userId}` : '') +
        (startDate ? `&start_date=${startDate}` : '') +
        (endDate ? `&end_date=${endDate}` : '');

    fetch(`${API_BASE}/data/logs${query}`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.json())
        .then(logs => {
            if (!Array.isArray(logs) || logs.length === 0) return alert("No logs to export.");
            exportLogsToCSV(logs);
        })
        .catch(e => {
            console.error(e);
            alert("Error exporting CSV.");
        });
}

function exportLogsToCSV(logs) {
    try {
        const header = ["Timestamp", "User", "Role", "School ID", "Action", "Details"];
        const rows = logs.map(l => [
            new Date(l.created_at).toLocaleString(),
            l.username,
            l.role,
            l.school_id || '',
            l.action.replace(/,/g, ' '),
            (l.details || '').replace(/,/g, ' ').replace(/\n/g, ' ')
        ]);

        const csvContent = "data:text/csv;charset=utf-8,"
            + header.join(",") + "\n"
            + rows.map(e => e.join(",")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `system_logs_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (e) {
        console.error("CSV Export Error", e);
        alert("Failed to export logs.");
    }
}

// Logger Integration for Company Dashboard Actions
// We will call Logger.log() in key functions

// === NEW: GENERAL REPORTS LOGIC ===

async function downloadSchoolReport() {
    const schoolId = document.getElementById('report-school-select').value;
    if (!schoolId) return alert("Please select a school first.");

    try {
        const r = await fetch(`${API_BASE}/data/students/${schoolId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const students = await r.json();

        if (!students || students.length === 0) return alert("No student data found for this school.");

        // Export (Simplified)
        const ws = XLSX.utils.json_to_sheet(students);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Students");
        XLSX.writeFile(wb, `School_Data_${schoolId}.xlsx`);

        Logger.log('REPORT_DOWNLOAD', `Downloaded Student Report for School ${schoolId}`);

    } catch (e) {
        console.error(e);
        alert("Failed to download report.");
    }
}

async function downloadUserReport() {
    try {
        const r = await fetch(`${API_BASE}/data/users`, { headers: { 'Authorization': `Bearer ${token}` } });
        const users = await r.json();

        if (!users || users.length === 0) return alert("No users found.");

        const ws = XLSX.utils.json_to_sheet(users.map(u => ({
            ID: u.id, Username: u.username, Role: u.role, SchoolID: u.school_id || 'N/A'
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Users");
        XLSX.writeFile(wb, `User_List_Report.xlsx`);

        Logger.log('REPORT_DOWNLOAD', `Downloaded System User Report`);

    } catch (e) {
        console.error(e);
        alert("Failed to download user report.");
    }
}

// === NEW: LOGS PDF EXPORT ===

function downloadLogsPDF() {
    // Re-fetch current logs or use cache? We don't have a global cache of current logs in this file except inside fetchActivityLogs scope.
    // Let's re-fetch with limit=none based on current filters. 
    // Actually, `downloadLogsCSV` logic is good, let's adapt it.

    const schoolId = document.getElementById('log-filter-school')?.value || 'All';
    const userId = document.getElementById('log-filter-user')?.value || 'All';
    const startDate = document.getElementById('log-filter-start-date')?.value;
    const endDate = document.getElementById('log-filter-end-date')?.value;

    // UI Feedback
    const btn = document.activeElement;
    const originalText = btn ? btn.innerText : '';
    if (btn) btn.innerText = 'Generating...';

    const query = `?limit=none` +
        (schoolId !== 'All' ? `&school_id=${schoolId}` : '') +
        (userId !== 'All' ? `&user_id=${userId}` : '') +
        (startDate ? `&start_date=${startDate}` : '') +
        (endDate ? `&end_date=${endDate}` : '');

    fetch(`${API_BASE}/data/logs${query}`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.json())
        .then(logs => {
            if (!Array.isArray(logs) || logs.length === 0) {
                if (btn) btn.innerText = originalText;
                return alert("No logs to export.");
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            doc.setFontSize(18);
            doc.text("System Activity Log", 14, 20);

            doc.setFontSize(10);
            doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
            doc.text(`Filters: School=${schoolId}, User=${userId}, Range=${startDate || '*'} to ${endDate || '*'}`, 14, 34);

            const headers = [['Time', 'User', 'Role', 'Action', 'Details']];
            const data = logs.map(l => [
                new Date(l.created_at).toLocaleString(),
                l.username,
                l.role,
                l.action,
                l.details || ''
            ]);

            doc.autoTable({
                head: headers,
                body: data,
                startY: 40,
                theme: 'grid',
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: [41, 128, 185], textColor: 255 }
            });

            doc.save('Activity_Log_Report.pdf');
            if (btn) btn.innerText = originalText;
        })
        .catch(e => {
            console.error(e);
            alert("Error exporting PDF.");
            if (btn) btn.innerText = originalText;
        });
}

// === NEW: SCHOOL REPORT PDF ===
async function downloadSchoolReportPDF() {
    const schoolId = document.getElementById('report-school-select').value;
    if (!schoolId) return alert("Please select a school first.");

    const btn = document.activeElement;
    const originalText = btn ? btn.innerText : '';
    if (btn) btn.innerText = '...';

    try {
        const r = await fetch(`${API_BASE}/data/students/${schoolId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const students = await r.json();

        if (!students || students.length === 0) {
            if (btn) btn.innerText = originalText;
            return alert("No student data found for this school.");
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const schoolName = globalSchools.find(s => s.id == schoolId)?.name || `School #${schoolId}`;

        doc.setFontSize(18);
        doc.text("School Student Report", 14, 20);
        doc.setFontSize(12);
        doc.text(schoolName, 14, 28);
        doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 36);

        const headers = [['Roll No', 'Name', 'Class', 'Gender', 'Pattern', 'Status']];
        const data = students.map(s => [
            s.roll_no || '-',
            s.name,
            `${s.class_name || ''} ${s.section || ''}`,
            s.gender,
            s.pattern_name || '-',
            s.status || 'Pending'
        ]);

        doc.autoTable({
            head: headers,
            body: data,
            startY: 42,
            theme: 'grid',
            styles: { fontSize: 9, cellPadding: 2 },
            headStyles: { fillColor: [13, 148, 136], textColor: 255 } // Teal
        });

        doc.save(`Student_Report_${schoolName.replace(/\s+/g, '_')}.pdf`);
        Logger.log('REPORT_DOWNLOAD', `Downloaded PDF Report using jsPDF for ${schoolName}`);

    } catch (e) {
        console.error(e);
        alert("Failed to download PDF.");
    } finally {
        if (btn) btn.innerText = originalText;
    }
}

// === NEW: USER REPORT PDF ===
async function downloadUserReportPDF() {
    const btn = document.activeElement;
    const originalText = btn ? btn.innerText : '';
    if (btn) btn.innerText = '...';

    try {
        const r = await fetch(`${API_BASE}/data/users`, { headers: { 'Authorization': `Bearer ${token}` } });
        const users = await r.json();

        if (!users || users.length === 0) {
            if (btn) btn.innerText = originalText;
            return alert("No users found.");
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(18);
        doc.text("User Registry Report", 14, 20);
        doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);

        const headers = [['ID', 'Username', 'Role', 'School ID']];
        const data = users.map(u => [
            u.id,
            u.username,
            u.role,
            u.school_id || '-'
        ]);

        doc.autoTable({
            head: headers,
            body: data,
            startY: 35,
            theme: 'striped',
            styles: { fontSize: 10, cellPadding: 3 },
            headStyles: { fillColor: [249, 115, 22], textColor: 255 } // Orange
        });

        doc.save(`User_List_Report.pdf`);
        Logger.log('REPORT_DOWNLOAD', `Downloaded PDF User Report`);

    } catch (e) {
        console.error(e);
        alert("Failed to download PDF.");
    } finally {
        if (btn) btn.innerText = originalText;
    }
}

// Update initReports to populate School Select for Reports too
const originalInitReports = initReports;
initReports = async function () {
    await originalInitReports(); // Call original

    // Populate Report School Select
    const repSchoolSel = document.getElementById('report-school-select');
    if (repSchoolSel && globalSchools.length > 0) {
        repSchoolSel.innerHTML = '<option value="">-- Select School --</option>' +
            globalSchools.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }

    // Start AI Analysis
    refreshAIInsights();
};

// === AI INSIGHTS ENGINE ===
let aiInterval;
function refreshAIInsights() {
    if (aiInterval) clearInterval(aiInterval);

    const insights = [];
    const statusText = document.getElementById('ai-status-text');
    const insightText = document.getElementById('ai-insight-text');
    const scoreVal = document.getElementById('ai-score');
    const scoreBar = document.getElementById('ai-score-bar');

    if (!insightText) return;

    // 1. Analyze Schools
    const totalSchools = globalSchools.length;
    const activeSchools = globalSchools.filter(s => s.status === 'Active' || s.status === 'Production').length;

    if (totalSchools > 0) {
        const inactive = totalSchools - activeSchools;
        if (inactive > 0) insights.push(`⚠️ <strong>${inactive} Schools</strong> are currently pending activation.`);
        else insights.push(`✅ All <strong>${totalSchools} Schools</strong> are fully active.`);
    }

    // 2. Deadline Analysis (Mock logic if accurate dates aren't fully populated yet)
    // We look for schools with status 'Production'
    const inProduction = globalSchools.filter(s => s.status === 'Production');
    if (inProduction.length > 0) {
        insights.push(`🏭 <strong>${inProduction.length} Schools</strong> are in active production.`);
    }

    // 3. User Activity (Mocked from recent logs fetch if possible, or just general)
    insights.push(`👥 System is monitoring <strong>${totalSchools * 120} est. students</strong>.`); // Pseudo-stat

    // 4. Optimization Score Calculation
    // (Active Schools / Total) * 100
    const score = totalSchools > 0 ? Math.round((activeSchools / totalSchools) * 100) : 0;

    // Update UI - Score
    if (scoreVal) scoreVal.innerText = `${score}%`;
    if (scoreBar) scoreBar.style.width = `${score}%`;

    // Cycle Insights
    let index = 0;
    const update = () => {
        insightText.innerHTML = insights[index];
        statusText.innerText = "Monitoring Live Data...";
        // Fade effect could be added here
        index = (index + 1) % insights.length;
    };

    update(); // Immediate
    aiInterval = setInterval(update, 4000); // Cycle every 4s
}

