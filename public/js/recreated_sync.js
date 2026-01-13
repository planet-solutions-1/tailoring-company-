async function syncPatternsToCloud() {
    if (patterns.length === 0) return alert("No patterns to sync.");
    if (!confirm(`Sync ${patterns.length} patterns to Cloud?`)) return;

    // Simple Toast
    const showToast = (msg, isErr = false) => {
        const div = document.createElement('div');
        div.className = `fixed top-4 right-4 p-4 rounded shadow-xl text-white font-bold z-50 animate-bounce ${isErr ? 'bg-red-500' : 'bg-green-500'}`;
        div.innerText = msg;
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 3000);
    };

    showToast("Syncing...");

    try {
        let successCount = 0;
        for (const p of patterns) {
            if (!p.student_admission_nos || p.student_admission_nos.length === 0) continue; // Skip empty? No, maybe we want to save pattern def without students.

            // Determine School ID
            // Use p.schoolId from fetch, or p.metadata.schoolId, or default to current user's school if school admin.
            let targetSchoolId = p.schoolId;
            if (!targetSchoolId) {
                // Try to find from metadata
                // Or fallback to logged in user's school
                const uRole = sessionStorage.getItem('role');
                if (uRole === 'school') {
                    // We don't have schoolId in session storage easily accessible as integer?
                    // We rely on backend validation mostly.
                    // But we need to send it.
                }
            }

            // Prepare Payload
            const payload = {
                name: p.name,
                consumption: p.metadata.consumption || 0,
                cloth_details: p.metadata.cloth || "",
                special_req: p.metadata.req || "",
                school_id: targetSchoolId || document.getElementById('newPatternSchool').value, // Fallback to dropdown
                filters: JSON.stringify(p.filters || {}),
                student_admission_nos: p.student_admission_nos
            };

            const res = await fetch('/api/data/patterns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

            if (res.ok) successCount++;
        }

        showToast(`Synced ${successCount} patterns!`);
        setTimeout(() => fetchPatternsFromBackend(), 1000); // Reload to get IDs
    } catch (e) {
        console.error(e);
        showToast("Sync Failed: " + e.message, true);
    }
}
