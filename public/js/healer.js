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
                    await this.analyzeError(response, args);
                }

                return response;
            } catch (error) {
                // Network Failures
                console.error("Brain intercepted network error:", error);
                throw error;
            }
        };
    }

    async analyzeError(response, args) {
        if (this.isHealing) return; // Don't loop

        const url = response.url;
        const status = response.status;

        console.warn(`🧠 Brain detected ${status} on ${url}`);

        // CASE 1: SYSTEM CONFIG MISSING (404)
        if (url.includes('system_config') && status === 404) {
            this.isHealing = true;
            this.notify("Missing Config detected. Attempting Auto-Repair...");

            const success = await this.triggerHeal('config');
            if (success) {
                this.notify("Config Restored! Reloading...");
                setTimeout(() => window.location.reload(), 1500);
            } else {
                this.notify("Auto-Repair Failed.");
            }
            this.isHealing = false;
        }

        // CASE 2: GENERIC DATABASE ERROR (500)
        if (status === 500) {
            // Check if schema related (basic assumption)
            this.notify("Database instability detected. Checking Schema...");
            // We could trigger a schema refresh, but let's be conservative
        }
    }

    async triggerHeal(type) {
        try {
            const token = sessionStorage.getItem('token');
            const res = await fetch(`${this.apiBase}/admin/heal`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ issue: type })
            });
            const data = await res.json();
            console.log("Healing Result:", data);
            return data.success;
        } catch (e) {
            console.error("Heal RPC Failed:", e);
            return false;
        }
    }
}

// Activate
window.AutoHealer = new AutoHealer();
