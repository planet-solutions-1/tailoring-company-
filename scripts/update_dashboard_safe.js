const fs = require('fs');
const path = 'c:/Users/sajus/.gemini/antigravity/scratch/planetsolutions/excel-editor-dashboard/public/production_dashboard.html';

const existing = fs.readFileSync(path, 'utf8');
const lines = existing.split('\n');

// Target lines 571 to 793 (1-based) -> 570 to 792 (0-based)
// Check validation
if (!lines[570].includes('function renderDashboard() {')) {
    console.error('Line 571 mismatch:', lines[570]);
    process.exit(1);
}
if (!lines[792].includes('}')) {
    console.error('Line 793 mismatch:', lines[792]);
    process.exit(1);
}

const newContent = `        function renderDashboard() {
            const grid = document.getElementById('batches-grid');
            const hudContainer = document.getElementById('hud-container');

            // 1. Calculate Stats & Global Data
            let totalVolume = 0;
            let totalProgressSum = 0;
            let activeCount = ALL_GROUPS.length;
            let leaderboard = [];

            // 2. Filter & Map Data
            const filtered = ALL_GROUPS.filter(g => {
                // Calculate Pct for this group
                let t = 0, c = 0;
                if (Array.isArray(g.required_stages)) {
                    g.required_stages.forEach(s => {
                        if (s.type === 'task' || (s.id && s.id.startsWith('S'))) {
                            const tgt = parseInt(s.target) || 0;
                            const cur = parseInt(g.completed_stages[s.id]) || 0;
                            t += tgt;
                            c += Math.min(cur, tgt);
                        }
                    });
                }
                const pct = t > 0 ? (c / t) * 100 : 0;
                
                // Systematic Metrics
                const dailyTarget = g.daily_target || 0;
                const dailyProgressPct = dailyTarget > 0 ? (c / dailyTarget) * 100 : 0; // Simplified: Total vs Daily Target
                
                g._pct = pct;
                g._vol = t;
                g._dailyPct = dailyProgressPct;
                g._completedItems = c;

                // Push to Leaderboard Candidate List (if active)
                if (pct < 100) leaderboard.push(g);

                // Accumulate Globals
                totalVolume += t;
                totalProgressSum += pct;

                // Filtering Matches
                const matchesText = g.group_name.toLowerCase().includes(FILTER_QUERY.toLowerCase()) ||
                    g.dress_type.toLowerCase().includes(FILTER_QUERY.toLowerCase());

                let matchesStatus = true;
                if (FILTER_STATUS === 'completed') matchesStatus = pct >= 100;
                if (FILTER_STATUS === 'in-progress') matchesStatus = pct < 100 && pct > 0;
                if (FILTER_STATUS === 'not-started') matchesStatus = pct === 0;
                if (FILTER_STATUS === 'delayed') matchesStatus = !!g.delay_reason;

                return matchesText && matchesStatus;
            });

            // Sort Leaderboard: High Points > High Daily Progress
            leaderboard.sort((a, b) => (b.points || 0) - (a.points || 0) || b._dailyPct - a._dailyPct);
            const top3 = leaderboard.slice(0, 3);

            const globalAvg = activeCount > 0 ? Math.round(totalProgressSum / activeCount) : 0;

            // 3. Render HUD (4 Cols)
            if (hudContainer) {
                hudContainer.innerHTML = \`
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                        
                        <!-- Col 1: Active Batches -->
                        <div class="clay-card p-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white relative overflow-hidden group">
                            <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition">
                                <svg class="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/></svg>
                            </div>
                            <div class="relative z-10">
                                <p class="text-blue-100 text-xs font-bold uppercase tracking-widest mb-1">Active Batches</p>
                                <h3 class="text-3xl font-extrabold tracking-tight">\${activeCount}</h3>
                                <div class="mt-2 text-xs text-blue-200">System Online</div>
                            </div>
                        </div>

                        <!-- Col 2: Leaderboard (NEW) -->
                        <div class="clay-card p-4 border-l-4 border-yellow-400 bg-white relative overflow-hidden">
                            <h4 class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">🏆 Top Performers</h4>
                            <div class="space-y-2">
                                \${top3.map((g, i) => \`
                                    <div class="flex justify-between items-center text-sm">
                                        <div class="flex items-center gap-2">
                                            <span class="font-bold \${i === 0 ? 'text-yellow-500' : 'text-slate-400'}">#\${i + 1}</span>
                                            <span class="font-medium text-slate-700 truncate max-w-[100px]">\${g.group_name}</span>
                                        </div>
                                        <div class="flex items-center gap-1">
                                            <span class="text-xs font-bold text-yellow-600">\${g.points || 0} pts</span>
                                        </div>
                                    </div>
                                \`).join('') || '<div class="text-xs text-gray-400 italic">No active data yet</div>'}
                            </div>
                        </div>

                        <!-- Col 3: Volume -->
                        <div class="clay-card p-6 border-l-4 border-purple-500 relative overflow-hidden group">
                             <div class="flex justify-between items-start">
                                <div>
                                    <p class="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Total Volume</p>
                                    <h3 class="text-3xl font-extrabold text-slate-800">\${totalVolume.toLocaleString()}</h3>
                                </div>
                                <div class="p-2 bg-purple-50 rounded-lg text-purple-600">
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                                </div>
                            </div>
                        </div>

                        <!-- Col 4: Efficiency -->
                        <div class="clay-card p-6 border-l-4 border-teal-500 relative overflow-hidden group">
                             <div class="flex justify-between items-start">
                                <div>
                                    <p class="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Efficiency</p>
                                    <h3 class="text-3xl font-extrabold text-slate-800">\${globalAvg}%</h3>
                                </div>
                                <div class="p-2 bg-teal-50 rounded-lg text-teal-600">
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- CONTROL BAR (Added Delayed Filter) -->
                    <div class="flex flex-col md:flex-row justify-between items-center gap-4 mb-8">
                        <div class="relative w-full md:w-96 group">
                            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <svg class="h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                            </div>
                            <input type="text" 
                                placeholder="Search batches..." 
                                oninput="FILTER_QUERY = this.value; renderDashboard();"
                                class="pl-10 block w-full clay-input bg-white border-none py-3 shadow-sm group-focus-within:shadow-lg transition-all duration-300">
                        </div>
                        <div class="flex gap-2 bg-slate-100 p-1 rounded-xl overflow-x-auto">
                            <button onclick="setFilterStatus('all')" data-status="all" class="filter-pill px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white shadow-lg shadow-blue-500/30 transition-all">All</button>
                            <button onclick="setFilterStatus('in-progress')" data-status="in-progress" class="filter-pill px-4 py-2 rounded-lg text-sm font-bold bg-white text-slate-600 hover:bg-gray-50 transition-all">In Progress</button>
                            <button onclick="setFilterStatus('completed')" data-status="completed" class="filter-pill px-4 py-2 rounded-lg text-sm font-bold bg-white text-slate-600 hover:bg-gray-50 transition-all">Completed</button>
                            <button onclick="setFilterStatus('delayed')" data-status="delayed" class="filter-pill px-4 py-2 rounded-lg text-sm font-bold bg-white text-red-500 hover:bg-red-50 transition-all">Delayed ⚠️</button>
                        </div>
                    </div>
                \`;
            }

            // 4. Render Grid
            grid.innerHTML = '';

            if (filtered.length === 0) {
                grid.innerHTML = \`
                    <div class="col-span-full py-12 text-center text-gray-400">
                        <svg class="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>    
                        <p class="text-lg font-medium">No batches found</p>
                    </div>
                \`;
                return;
            }

            filtered.forEach(g => {
                const pct = Math.round(g._pct);
                const points = g.points || 0;
                const isDelayed = !!g.delay_reason;
                const isGold = points >= 50;
                const dailyTarget = g.daily_target || 0;

                // Status Color Logic
                let barColor = 'bg-blue-500';
                let glowColor = 'shadow-blue-500/30';
                let statusText = 'In Progress';
                let statusClass = 'text-blue-600';
                let cardBorder = 'border-transparent';
                let bgEffect = '';

                if (isDelayed) {
                    barColor = 'bg-red-500';
                    glowColor = 'shadow-red-500/30';
                    statusText = 'Delayed';
                    statusClass = 'text-red-600';
                    cardBorder = 'border-l-4 border-red-500 shadow-red-100';
                } else if (pct >= 100) {
                    barColor = 'bg-green-500';
                    glowColor = 'shadow-green-500/30';
                    statusText = 'Completed';
                    statusClass = 'text-green-600';
                } else if (pct === 0) {
                    barColor = 'bg-slate-300';
                    glowColor = 'shadow-none';
                    statusText = 'Not Started';
                }

                if (isGold) {
                    cardBorder = 'border-2 border-yellow-400 shadow-yellow-100';
                    bgEffect = 'bg-yellow-50/30';
                }
                
                // Badges Logic
                let statusBadge = '';
                const completedCount = g._completedItems;
                
                if (dailyTarget > 0 && completedCount >= dailyTarget) {
                    statusBadge += \`<span class="bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full text-[10px] font-bold border border-orange-200">🔥 On Fire</span>\`;
                } else if (dailyTarget > 0 && completedCount < (dailyTarget * 0.3) && pct < 100) {
                     statusBadge += \`<span class="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-[10px] font-bold">🐢 Lagging</span>\`;
                }

                grid.innerHTML += \`
                    <div class="clay-card p-0 cursor-pointer hover:-translate-y-1 hover:shadow-2xl transition-all duration-300 relative group overflow-hidden bg-white \${cardBorder} \${bgEffect}" onclick="openDetail('\${g.id}')">
                        <!-- Top Accent (if not delayed) -->
                        \${!isDelayed ? \`<div class="h-2 w-full \${barColor} relative overflow-hidden"><div class="absolute inset-0 bg-white/30 animate-[shimmer_2s_infinite]"></div></div>\` : ''}
                        
                        <div class="p-6">
                            <div class="flex justify-between items-start mb-4">
                                <div class="flex flex-col">
                                    <div class="flex items-center gap-2 mb-1">
                                         <span class="text-[0.65rem] font-bold text-slate-400 uppercase tracking-widest">Batch #\${g.id}</span>
                                         \${isGold ? '<span title="Ace Performer" class="text-yellow-500 animate-bounce">🏆</span>' : ''}
                                         \${isDelayed ? '<span title="Production Delayed" class="text-red-500 animate-pulse">⚠️</span>' : ''}
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <h3 class="text-xl font-bold text-slate-800 leading-tight group-hover:text-blue-600 transition">\${g.group_name}</h3>
                                        \${statusBadge}
                                    </div>
                                </div>
                                <span class="bg-slate-50 border border-slate-100 text-slate-500 text-[0.65rem] font-bold px-3 py-1 rounded-full uppercase tracking-wider">\${g.dress_type}</span>
                            </div>

                            \${points > 0 ? \`
                            <div class="mb-3">
                                <span class="inline-flex items-center gap-1 bg-yellow-100 text-yellow-700 text-xs font-bold px-2 py-0.5 rounded border border-yellow-200">
                                    <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg> 
                                    \${points} Pts
                                </span>
                            </div>\` : ''}

                            \${isDelayed ? \`
                            <div class="mb-3 bg-red-50 p-2 rounded border border-red-100 text-xs text-red-600 leading-tight">
                                <strong>Constraint:</strong> \${g.delay_reason}
                            </div>\` : ''}
                            
                            <!-- Mini Stats -->
                            <div class="grid grid-cols-2 gap-4 mb-6">
                                <div>
                                    <p class="text-[0.65rem] text-slate-400 font-bold uppercase">Volume</p>
                                    <p class="text-sm font-bold text-slate-700">\${g._vol} items</p>
                                </div>
                                <div class="text-right">
                                    <p class="text-[0.65rem] text-slate-400 font-bold uppercase">Status</p>
                                    <p class="text-sm font-bold \${statusClass}">\${statusText}</p>
                                </div>
                            </div>

                            <!-- Progress Bar -->
                            <div class="relative pt-2">
                                <div class="flex justify-between text-xs mb-1">
                                    <span class="font-bold text-slate-400">Completion</span>
                                    <span class="font-bold text-slate-800">\${pct}%</span>
                                </div>
                                <div class="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden shadow-inner">
                                    <div class="\${barColor} h-full rounded-full relative shadow-lg \${glowColor}" style="width: \${pct}%">
                                        <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-full h-full opacity-0 group-hover:opacity-100 animate-shimmer"></div>
                                    </div>
                                </div>
                                <div class="flex justify-between mt-1">
                                     <div class="text-[10px] text-slate-400 font-bold uppercase">Daily Target: \${dailyTarget > 0 ? dailyTarget : 'N/A'}</div>
                                     <div class="text-[10px] text-slate-400 font-bold uppercase">Total: \${g._vol}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                \`;
            });
        }`;

// 0-based index splice
// Remove 223 lines (792 - 570 + 1)
lines.splice(570, 793 - 570, newContent);

fs.writeFileSync(path, lines.join('\n'));
console.log('Successfully updated renderDashboard!');
