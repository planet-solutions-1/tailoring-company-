// ConfigLoader.js - Shared Configuration Management for Planet Solutions
// Stores global settings (Dress Types, Formulas) in a special "SYSTEM_CONFIG" school record.

const CONFIG_SCHOOL_NAME = "SYSTEM_CONFIG";
const CONFIG_SCHOOL_ADDRESS_MARKER = "SYSTEM_CONFIG_V1";

// Default Items (Fallback)
const DEFAULT_ITEMS = [
    // BOYS
    { name: "BOYS - FORMAL SHIRT", cols: ["U1", "U2", "U3", "U4", "U6"], type: "Male" },
    { name: "BOYS - TRACK T-SHIRT", cols: ["U1", "U2", "U3", "U4", "U6"], type: "Male" },
    { name: "BOYS - UNIFORM T-SHIRT", cols: ["U1", "U2", "U3", "U4", "U6"], type: "Male" },
    { name: "BOYS - JERKIN", cols: ["U1", "U2", "U3", "U4", "U5"], type: "Male" },
    { name: "BOYS - PULLOVER", cols: ["U1", "U2", "U3", "U4", "U5"], type: "Male" },
    { name: "BOYS - FORMAL PANT", cols: ["L1", "L2"], type: "Male" },
    { name: "BOYS - TRACK PANT", cols: ["L1", "L2"], type: "Male" },
    { name: "BOYS - FORMAL SHORTS", cols: ["L3", "L2"], type: "Male" },
    { name: "BOYS - TRACK SHORTS", cols: ["L3", "L2"], type: "Male" },
    { name: "BOYS - PANT SPECIAL CASE", cols: ["L1", "L2", "L6", "L7"], type: "Male" },
    // GIRLS
    { name: "GIRLS - FORMAL SHIRT", cols: ["U1", "U2", "U3", "U4", "U6"], type: "Female" },
    { name: "GIRLS - TRACK T-SHIRT", cols: ["U1", "U2", "U3", "U4", "U6"], type: "Female" },
    { name: "GIRLS - UNIFORM T-SHIRT", cols: ["U1", "U2", "U3", "U4", "U6"], type: "Female" },
    { name: "GIRLS - JERKIN", cols: ["U1", "U2", "U3", "U4", "U5"], type: "Female" },
    { name: "GIRLS - FULL SLEEVE SHIRT", cols: ["U1", "U2", "U3", "U4", "U5"], type: "Female" },
    { name: "GIRLS - PULLOVER", cols: ["U1", "U2", "U3", "U4", "U5"], type: "Female" },
    { name: "GIRLS - KURTHA SHIRT", cols: ["U7", "U2", "U3", "U4", "U6"], type: "Female" },
    { name: "GIRLS - SPECIAL FROCKS", cols: ["U7", "U2", "U3", "U4", "U6"], type: "Female" },
    { name: "GIRLS - FORMAL PANT", cols: ["L1", "L2"], type: "Female" },
    { name: "GIRLS - TRACK PANT", cols: ["L1", "L2"], type: "Female" },
    { name: "GIRLS - TRACK SHORTS", cols: ["L3", "L2"], type: "Female" },
    { name: "GIRLS - PINOFORE", cols: ["L4", "L2"], type: "Female" },
    { name: "GIRLS - SKIRT", cols: ["L5", "L2"], type: "Female" },
    { name: "GIRLS - PANT SPECIAL CASE", cols: ["L1", "L2", "L6", "L7"], type: "Female" }
];

class ConfigLoader {
    static async load(apiBase, token) {
        if (!apiBase || !token) {
            console.warn("ConfigLoader: Missing API Base or Token, using defaults.");
            return { items: DEFAULT_ITEMS };
        }

        try {
            // Fetch all schools (or search if API supports it, but currently we scan)
            // Using /api/schools for Company/Super Admin, /data/schools for others might vary
            // But this will mostly likely be run by Company Admin or from stored JSON in other apps.
            // Wait: Other apps (School Admin) might not have permission to list ALL schools.
            // But they DO have permission to see "My Patterns". 
            // WE NEED A PUBLIC ENDPOINT or a Shared Resource.
            // Actually, School Admins usually can't list all schools.
            // BUT, the 'planet_editor.html' has the 'boysItems' hardcoded.
            // If we want to make it dynamic, the School Admin needs access to this config.

            // WORKAROUND: For now, we assume the user has access.
            // If 403, we fall back to defaults.

            // Fix: Normalize API Base to remove trailing /api or /, and handle 'api' (no slash)
            // Goal: We want the Root URL (e.g. "" or "http://localhost:3000") so we can append /api/data/schools
            // If apiBase is "/api", we want "".
            let normalizedBase = apiBase;
            if (normalizedBase.endsWith('/api')) normalizedBase = normalizedBase.slice(0, -4);
            if (normalizedBase.endsWith('/')) normalizedBase = normalizedBase.slice(0, -1);

            // PRE-CHECK: Skip request for non-admin roles to avoid 403 Console Errors
            const userRole = sessionStorage.getItem('role');
            // If role exists and is NOT company/super_admin/school, return defaults
            // We allow 'school' so they can see dynamic patterns
            if (userRole && !['company', 'super_admin', 'school', 'manager', 'tailor'].includes(userRole)) {
                console.log("ConfigLoader: Skipping system config for unauthorized role (using defaults).");
                return { items: DEFAULT_ITEMS };
            }

            // Unified Endpoint: Use /api/data/system_config for shared access
            // This is safer and faster than scanning all schools
            const r = await fetch(`${normalizedBase}/api/data/system_config`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (r.status === 403 || r.status === 401) {
                console.warn("ConfigLoader: Access denied (using defaults).");
                return { items: DEFAULT_ITEMS };
            }

            if (r.ok) {
                const data = await r.json();
                if (data && data.address) {
                    try {
                        const config = JSON.parse(data.address);
                        if (config.marker === CONFIG_SCHOOL_ADDRESS_MARKER) {
                            console.log("ConfigLoader: Loaded custom configuration via shared endpoint.");
                            // FIX: Ensure config.data is valid, otherwise return config or defaults
                            if (config.data && Array.isArray(config.data.items)) {
                                return config.data;
                            } else if (config.items && Array.isArray(config.items)) {
                                // Backward compatibility if data wrapper is missing
                                return config;
                            } else {
                                console.warn("ConfigLoader: Invalid config structure (missing items).");
                            }
                        }
                    } catch (e) {
                        // FALLTHROUGH
                    }
                }
            } else {
                // Fallback to Scan (for backwards compatibility or Company Admin view)
                // Or just assume if system_config failed, we use defaults.
                console.log("ConfigLoader: System config endpoint failed, checking fallback list (Company Only).");
                if (['company', 'super_admin'].includes(userRole)) {
                    const r2 = await fetch(`${normalizedBase}/api/data/schools`, { headers: { 'Authorization': `Bearer ${token}` } });
                    if (r2.ok) {
                        const schools = await r2.json();
                        const configSchool = schools.find(s => s.name === CONFIG_SCHOOL_NAME);
                        if (configSchool && configSchool.address) {

                            // FIX: Same validation for fallback
                            if (config && config.data) return config.data;
                            if (config && config.items) return config;
                            console.warn("ConfigLoader: Fallback config invalid.");
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("ConfigLoader: Network request failed, using defaults.", e);
        }

        console.log("ConfigLoader: Using default configuration.");
        return { items: DEFAULT_ITEMS };
    }

    static async save(apiBase, token, newConfig) {
        // Only Company Admin can usually do this
        try {
            // 1. Find existing
            // 1. Find existing
            let normalizedBase = apiBase;
            if (normalizedBase.endsWith('/api')) normalizedBase = normalizedBase.slice(0, -4);
            if (normalizedBase.endsWith('/')) normalizedBase = normalizedBase.slice(0, -1);

            const r = await fetch(`${normalizedBase}/api/data/schools`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const schools = await r.json();
            // FIX: Find by UNIQUE username, not name (which allows duplicates)
            const configSchool = schools.find(s => s.username === 'system_config');

            const payloadData = {
                marker: CONFIG_SCHOOL_ADDRESS_MARKER,
                data: newConfig
            };
            const payloadString = JSON.stringify(payloadData);

            if (configSchool) {
                // UPDATE
                // We use the address field to store the JSON
                const updatePayload = {
                    name: CONFIG_SCHOOL_NAME,
                    address: payloadString,
                    phone: "0000000000",
                    email: "config@system.local",
                    password: "system_config_locked"
                };

                // Assuming PUT /api/schools/:id - NO, existing code uses POST /api/schools for create
                // and maybe PUT /api/schools/:id or /api/data/schools/:id
                // Let's try PUT /api/schools/:id

                const r2 = await fetch(`${normalizedBase}/api/data/schools/${configSchool.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(updatePayload)
                });

                if (!r2.ok) throw new Error(`Update failed: ${r2.status}`);
            } else {
                // CREATE
                const createPayload = {
                    name: CONFIG_SCHOOL_NAME,
                    address: payloadString,
                    phone: "0000000000",
                    email: "config@system.local",
                    password: "system_config_locked",
                    username: "system_config"
                };

                const r2 = await fetch(`${normalizedBase}/api/data/schools`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(createPayload)
                });

                if (!r2.ok) throw new Error(`Create failed: ${r2.status}`);
            }
            return true;
        } catch (e) {
            console.error("ConfigLoader: Save failed", e);
            throw e;
        }
    }
}
