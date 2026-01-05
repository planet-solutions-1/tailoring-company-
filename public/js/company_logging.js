
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
    const date = document.getElementById('log-filter-date')?.value;

    // Build Query
    let query = `?limit=200`; // Default limit for view
    if (schoolId !== 'All') query += `&school_id=${schoolId}`;
    if (userId !== 'All') query += `&user_id=${userId}`;
    if (date) query += `&start_date=${date}&end_date=${date}`;

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
                        <tr class="hover:bg-gray-50 transition-colors border-b border-gray-50">
                            <td class="p-4 text-gray-500 font-bold">${new Date(l.created_at).toLocaleString()}</td>
                            <td class="p-4 font-bold text-gray-700">${l.username}</td>
                            <td class="p-4"><span class="px-2 py-1 rounded text-[10px] font-bold uppercase bg-gray-100 text-gray-500 border border-gray-200">${l.role}</span></td>
                            <td class="p-4 text-gray-500">${l.school_id ? (globalSchools.find(s => s.id == l.school_id)?.name || 'ID: ' + l.school_id) : '-'}</td>
                            <td class="p-4 font-bold text-blue-600">${l.action}</td>
                            <td class="p-4 text-gray-400 italic truncate max-w-xs" title="${l.details}">${l.details || '-'}</td>
                        </tr>
                    `).join('');
        }

    } catch (e) {
        console.error("Log Fetch Error", e);
        if (loading) loading.classList.add('hidden');
        alert("Failed to fetch logs.");
    }
}

async function downloadLogsCSV() {
    const schoolId = document.getElementById('log-filter-school')?.value || 'All';
    const userId = document.getElementById('log-filter-user')?.value || 'All';
    const date = document.getElementById('log-filter-date')?.value;

    // Build Query with limit=none
    let query = `?limit=none`;
    if (schoolId !== 'All') query += `&school_id=${schoolId}`;
    if (userId !== 'All') query += `&user_id=${userId}`;
    if (date) query += `&start_date=${date}&end_date=${date}`;

    try {
        const r = await fetch(`${API_BASE}/data/logs${query}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const logs = await r.json();

        if (!Array.isArray(logs) || logs.length === 0) return alert("No logs to download for current filters.");

        // Convert to CSV
        const header = ['Timestamp', 'Username', 'Role', 'School ID', 'Action', 'Details'];
        const rows = logs.map(l => [
            new Date(l.created_at).toLocaleString().replace(/,/g, ''), // Remove commas for CSV safety
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
    const date = document.getElementById('log-filter-date')?.value;

    // UI Feedback
    const btn = document.activeElement;
    const originalText = btn ? btn.innerText : '';
    if (btn) btn.innerText = 'Generating...';

    const query = `?limit=none` +
        (schoolId !== 'All' ? `&school_id=${schoolId}` : '') +
        (userId !== 'All' ? `&user_id=${userId}` : '') +
        (date ? `&start_date=${date}&end_date=${date}` : '');

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
            doc.text(`Filters: School=${schoolId}, User=${userId}, Date=${date || 'All'}`, 14, 34);

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
};
