
function renderTdIncomplete(allSchoolStudents) {
    // Helpers (Duplicated for isolation/robustness)
    const isIncAbsent = (st) => {
        const m = getMeasurementsSafe(st);
        if (m && (m.is_absent === true || m.is_absent === 'true')) return true;
        const val = st.is_present; // Legacy boolean/int
        if (st.is_absent === true || st.is_absent === 1 || String(st.is_absent) === 'true') return true;
        // String checks
        const s = String(st['Absent/Present'] || '').trim().toLowerCase();
        return s === 'absent' || val === false || val === 0 || String(val).toLowerCase() === 'false';
    };

    const isIncPending = (st) => {
        if (isIncAbsent(st)) return false; // If absent, measurements are expected to be empty/skipped
        const m = getMeasurementsSafe(st);
        const metaKeys = ['is_absent', 'remarks', 'student_id', 'data', 'item_quantities', 'school_id'];
        return !Object.keys(m).some(k => {
            if (metaKeys.includes(k) || metaKeys.includes(k.toLowerCase())) return false;
            const v = m[k];
            if (!v) return false;
            const s = String(v).trim();
            return s !== '' && s !== '-' && s !== '0' && s !== '00' && s !== '0.0' && s !== '[object Object]';
        });
    };

    const absentList = allSchoolStudents.filter(isIncAbsent);
    const pendingList = allSchoolStudents.filter(isIncPending);

    // Update Counts
    const absEl = document.getElementById('td-inc-absent-count');
    if (absEl) absEl.innerText = absentList.length;

    const penEl = document.getElementById('td-inc-pending-count');
    if (penEl) penEl.innerText = pendingList.length;

    // Render Absent Table
    const absTable = document.getElementById('td-list-absent');
    const absEmpty = document.getElementById('td-no-absent');
    if (absTable) {
        absTable.innerHTML = absentList.map(s => `
                    <tr class="hover:bg-red-50/50 transition-colors border-b border-gray-50">
                        <td class="p-4 font-mono text-xs text-gray-500">${s.roll_no || s['ADM NO'] || '-'}</td>
                        <td class="p-4 font-bold text-gray-700">${s.name}</td>
                        <td class="p-4 text-xs text-gray-500">${s.class || '-'} ${s.section || ''}</td>
                        <td class="p-4 text-center">
                            <span class="px-2 py-1 rounded bg-red-100 text-red-600 text-[10px] font-bold uppercase tracking-wider">Absent</span>
                        </td>
                    </tr>
                `).join('');
        if (absEmpty) {
            if (absentList.length === 0) absEmpty.classList.remove('hidden');
            else absEmpty.classList.add('hidden');
        }
    }

    // Render Pending Table
    const penTable = document.getElementById('td-list-pending');
    const penEmpty = document.getElementById('td-no-pending');
    if (penTable) {
        penTable.innerHTML = pendingList.map(s => `
                    <tr class="hover:bg-orange-50/50 transition-colors border-b border-gray-50">
                        <td class="p-4 font-mono text-xs text-gray-500">${s.roll_no || s['ADM NO'] || '-'}</td>
                        <td class="p-4 font-bold text-gray-700">${s.name}</td>
                        <td class="p-4 text-xs text-gray-500">${s.class || '-'} ${s.section || ''}</td>
                        <td class="p-4 text-center">
                            <span class="px-2 py-1 rounded bg-orange-100 text-orange-600 text-[10px] font-bold uppercase tracking-wider">Pending</span>
                        </td>
                    </tr>
                `).join('');
        if (penEmpty) {
            if (pendingList.length === 0) penEmpty.classList.remove('hidden');
            else penEmpty.classList.add('hidden');
        }
    }
}
