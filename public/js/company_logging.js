
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
