/**
 * AI SELF-HEALING MODULE (The "Brain")
 * Monitors network requests and automatically fixes known issues.
 */
class AutoHealer {
    constructor() {
        this.apiBase = '/api';
        this.isHealing = false;
        this.brainIcon = null;
        this.initUI();
        this.interceptFetch();
        console.log("🧠 Auto-Heal Brain: ACTIVE");
    }

    initUI() {
        // Create the "Brain" Indicator
        const div = document.createElement('div');
        div.id = 'ai-brain-hud';
        div.className = 'fixed bottom-4 right-4 z-50 hidden flex-col items-end gap-2 pointer-events-none transition-opacity duration-300';
        div.innerHTML = `
            <div id="ai-brain-msg" class="bg-slate-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg opacity-0 transition-opacity">
                Detecting anomaly...
            </div>
            <div class="w-12 h-12 bg-white rounded-full shadow-2xl border-4 border-blue-100 flex items-center justify-center relative overlow-hidden">
                <div class="absolute inset-0 bg-blue-500 rounded-full opacity-20 animate-ping"></div>
                <div class="z-10 text-2xl">🧠</div>
            </div>
        `;
        document.body.appendChild(div);
        this.brainIcon = div;
    }

    notify(msg) {
        const hud = document.getElementById('ai-brain-hud');
        const txt = document.getElementById('ai-brain-msg');
        if (hud && txt) {
            hud.classList.remove('hidden');
            txt.innerText = msg;
            txt.classList.remove('opacity-0');

            // Pulse effect
            setTimeout(() => {
                txt.classList.add('opacity-0');
                setTimeout(() => hud.classList.add('hidden'), 2000);
            }, 4000);
        }
    }

    interceptFetch() {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            try {
                const response = await originalFetch(...args);

                // ERROR DETECTION
                if (!response.ok) {
                    // Clone response for analysis so original stream remains usable by app
                    const clonedRes = response.clone();
                    this.analyzeError(clonedRes, args);
                }

                return response;
            } catch (error) {
                // Network Failures (Offline, DNS)
                // console.error("Brain intercepted network error:", error);
                this.notify("Network Error: Check Connection");
                throw error;
            }
        };
    }

    async analyzeError(response, args) {
        if (this.isHealing) return;

        const url = response.url;
        const status = response.status;
        let errorBody = "";

        try {
            const data = await response.json();
            errorBody = data.error || JSON.stringify(data);
        } catch (e) {
            try { errorBody = await response.text(); } catch (e2) { }
        }

        console.warn(`🧠 Brain detected ${status} on ${url}:`, errorBody);

        // --- STRATEGY: RATE LIMITING (429) ---
        if (status === 429) {
            this.notify("System Busy (Rate Limit). Slowing down...");
            return; // No auto-fix for rate limits, just inform user
        }

        // --- STRATEGY: MISSING CONFIG (404) ---
        if (url.includes('system_config') && status === 404) {
            this.isHealing = true;
            this.notify("Critical Config Missing. Auto-Repairing...");
            await this.attemptAutoFix('config');
            return;
        }

        // --- STRATEGY: SERVER/DATABASE ERRORS (500) ---
        if (status === 500) {
            if (errorBody.includes("Unknown column") || errorBody.includes("no such column") || errorBody.includes("Table") && errorBody.includes("doesn't exist")) {
                this.isHealing = true;
                this.notify("Database Schema Mismatch. Applying Patch...");
                await this.attemptAutoFix('fix_db');
            } else if (errorBody.includes("Incorrect datetime value")) {
                this.notify("Code Error Detected (Date Format). Please Restart Server.");
            } else {
                this.notify(`Server Error: ${errorBody.substring(0, 30)}...`);
            }
        }
    }

    async attemptAutoFix(type) {
        const route = type === 'fix_db' ? '/api/data/fix_db' : '/api/admin/heal'; // Differing endpoints based on issue

        try {
            const token = sessionStorage.getItem('token');
            const res = await fetch(route, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ issue: type })
            });

            if (res.ok) {
                this.notify("Fix Applied Successfully! Reloading...");
                setTimeout(() => window.location.reload(), 2000);
            } else {
                this.notify("Auto-Fix Failed. Contact Admin.");
            }
        } catch (e) {
            console.error("Heal Failed:", e);
            this.notify("Healer Connection Failed.");
        } finally {
            this.isHealing = false;
        }
    }
}

// Activate
window.AutoHealer = new AutoHealer();
