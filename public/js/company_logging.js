
// === COMPANY DASHBOARD LOGGING & AI INSIGHTS ===

let aiInterval = null;

async function initAI(logs, stats) {
    if (!logs || logs.length === 0) return;

    // We can show a small "AI Insight" toast or card based on logs
    // E.g. "High activity detected in School X"
    // For now, let's just log to console or update a hidden div
    console.log("AI Init", logs.length);
}

function stopAI() {
    if (aiInterval) clearInterval(aiInterval);
}

function startAI() {
    stopAI();
    // Simple periodic check or "simulation" of live data
    const update = async () => {
        // In a real app, this might poll for "notifications"
        // console.log("AI Polling...");
    };

    update(); // Immediate
    aiInterval = setInterval(update, 4000); // Cycle every 4s
}

// === NEW: DASHBOARD WIDGETS ===

async function fetchProductionPipeline() {
    const container = document.getElementById('production-pipeline-list');
    if (!container) return;

    // Use globalSchools if available, otherwise fetch
    if ((typeof globalSchools === 'undefined') || !globalSchools || globalSchools.length === 0) {
        if (typeof fetchSchoolsForSelect === 'function') await fetchSchoolsForSelect();
    }

    if (!globalSchools || globalSchools.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-400 py-4 text-xs">No schools found to display.</div>`;
        return;
    }

    // 1. Group Schools by Status
    // Define exact order of pipeline
    const pipeline = ['Measurements', 'Processing', 'Production', 'Dispatch', 'Delivered'];
    const groups = {
        'Measurements': [], 'Processing': [], 'Production': [], 'Dispatch': [], 'Delivered': []
    };

    globalSchools.forEach(s => {
        const st = s.status || 'Measurements';
        if (groups[st]) groups[st].push(s);
        else groups['Measurements'].push(s); // Default fallback
    });

    // 2. Render Vertical List of Stages
    container.innerHTML = pipeline.map(stage => {
        const schools = groups[stage];
        const count = schools.length;
        const colorMap = {
            'Measurements': 'bg-yellow-50 text-yellow-600 border-yellow-100',
            'Processing': 'bg-orange-50 text-orange-600 border-orange-100',
            'Production': 'bg-blue-50 text-blue-600 border-blue-100',
            'Dispatch': 'bg-indigo-50 text-indigo-600 border-indigo-100',
            'Delivered': 'bg-emerald-50 text-emerald-600 border-emerald-100'
        };
        const color = colorMap[stage];

        // If no schools in this stage, dim it? Or show 0.
        const opacity = count === 0 ? 'opacity-60' : '';

        return `
        <div class="flex items-center gap-4 mb-3 last:mb-0 ${opacity}">
             <!-- Badge / Stage Name -->
             <div class="w-32 flex-shrink-0">
                 <span class="block px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${color} text-center shadow-sm">
                    ${stage}
                 </span>
             </div>

             <!-- Schools List (Horizontal Scroll or just Count + Names truncated) -->
             <div class="flex-1 bg-white border border-gray-100 rounded-lg p-2 shadow-sm min-h-[44px] flex items-center overflow-hidden">
                 ${count === 0 ?
                `<span class="text-[10px] text-gray-300 italic pl-2">No schools</span>` :
                `<div class="flex gap-2 w-full overflow-x-auto custom-scrollbar pb-1">
                        ${schools.map(s => `
                            <span class="flex-shrink-0 px-2 py-1 rounded-md bg-gray-50 text-gray-600 text-[10px] font-bold border border-gray-200 truncate max-w-[150px]" title="${s.name}">
                                ${s.name}
                            </span>
                        `).join('')}
                     </div>`
            }
             </div>

             <!-- Count -->
             <div class="w-12 text-center">
                 <span class="text-lg font-black text-gray-700">${count}</span>
             </div>
        </div>
        `;
    }).join('');
}

async function fetchRecentIssues() {
    const list = document.getElementById('recent-issues-list');
    if (!list) return;

    // We can fetch "Open Tickets/Complaints" (if an API exists) or reuse Logs for "Errors"
    // Better: Reuse the 'fetchComplaints' logic but just get the data without rendering the full view.
    // Or, mock it via "Overdue Schools" if no complaints API readily separated.

    // Let's look for "Urgent" schools that are overdue as "Issues" + Actual Complaints.
    // Since we don't have a direct "Recent Unresolved Complaints" API endpoint handy in this file context without duplication,
    // let's create a hybrid view of "Urgent Overdue Schools" (Critical) and "Recent Error Logs" (Operational).

    let content = '';

    // 1. Overdue Schools (Critical)
    const overdue = (typeof globalSchools !== 'undefined' ? globalSchools : [])
        .filter(s => s.deadline && new Date(s.deadline) < new Date());

    if (overdue.length > 0) {
        content += `<p class="text-[10px] uppercase font-bold text-red-400 mb-2">Overdue Projects</p>`;
        content += overdue.slice(0, 3).map(s => `
            <div class="bg-red-50 p-3 rounded-lg border border-red-100 mb-2">
                <div class="flex justify-between">
                    <span class="text-xs font-bold text-red-700 truncate">${s.name}</span>
                    <span class="text-[10px] font-bold text-red-400">OVERDUE</span>
                </div>
                <div class="text-[10px] text-red-500 mt-1">Deadline: ${new Date(s.deadline).toLocaleDateString()}</div>
            </div>
        `).join('');
    }

    // 2. Recent System Errors (from Logs)
    try {
        const r = await fetch(`${API_BASE}/data/logs?limit=20`, { headers: { 'Authorization': `Bearer ${token}` } });
        const logs = await r.json();
        const errors = logs.filter(l => l.action.includes('ERROR') || l.action.includes('DELETE') || l.details.includes('Failed')).slice(0, 5);

        if (errors.length > 0) {
            content += `<p class="text-[10px] uppercase font-bold text-gray-400 mb-2 mt-4">System Alerts</p>`;
            content += errors.map(l => `
                <div class="bg-gray-50 p-3 rounded-lg border border-gray-100 mb-2 hover:bg-white hover:shadow-sm transition-all group">
                    <div class="flex items-start gap-2">
                        <div class="text-red-500 mt-0.5">⚠️</div>
                        <div class="overflow-hidden">
                            <p class="text-xs font-bold text-gray-700 truncate group-hover:whitespace-normal">${l.action}</p>
                            <p class="text-[10px] text-gray-400 truncate group-hover:whitespace-normal group-hover:break-words">${l.details}</p>
                            <p class="text-[9px] text-gray-300 mt-1 font-mono">${new Date(l.created_at).toLocaleString()}</p>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    } catch (e) { console.error(e); }

    if (content === '') {
        list.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-gray-300 opacity-60">
            <svg class="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <span class="text-xs font-bold">All Systems Healthy</span>
        </div>`;
    } else {
        list.innerHTML = content;
    }
}
