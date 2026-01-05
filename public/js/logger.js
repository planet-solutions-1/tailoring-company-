
/**
 * Centralized Client-Side Logger
 * Connects to /api/data/logs (Auth) or /api/public/logs (Public)
 */
class Logger {
    static async log(action, details = '') {
        const token = sessionStorage.getItem('token');
        if (!token) {
            console.warn("Logger: No token found, skipping auth log.");
            return;
        }

        try {
            await fetch('/api/data/logs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ action, details })
            });
        } catch (e) {
            console.error("Logger Error:", e);
        }
    }

    static async logPublic(username, action, details = '', schoolId = null) {
        try {
            await fetch('/api/public/logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, action, details, school_id: schoolId })
            });
        } catch (e) {
            console.error("Public Logger Error:", e);
        }
    }
}

// Global Exposure
window.Logger = Logger;
