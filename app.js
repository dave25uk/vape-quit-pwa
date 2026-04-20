import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

let currentMode = 'vaping';
let viewDate = new Date(); 
let isCalendarLocked = true; 
let istoggling = false;

async function init() {
    // 1. Handle Authentication
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        await supabase.auth.signInAnonymously();
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 2. Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(err => console.log("SW error:", err));
    }

    // 3. Get User Status (Mode)
    const { data: status } = await supabase.from('user_status')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

    currentMode = (status && status.current_mode) ? status.current_mode : 'vaping';
    
    // 4. Setup UI & Event Listeners
    setupDefaultInputs();
    setupEventListeners();
    updateUI();
    
    // 5. Initial Data Load
    loadData();
}

function setupDefaultInputs() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now - offset)).toISOString().slice(0, 16);
    const dateInput = document.getElementById('start-date');
    if (dateInput) dateInput.value = localISOTime;
}

function setupEventListeners() {
    // Navigation
    document.getElementById('prev-month')?.addEventListener('click', () => {
        viewDate.setMonth(viewDate.getMonth() - 1);
        loadData();
    });

    document.getElementById('next-month')?.addEventListener('click', () => {
        viewDate.setMonth(viewDate.getMonth() + 1);
        loadData();
    });

    // NRT Logging
    document.getElementById('log-patch')?.addEventListener('click', () => {
    const strength = document.getElementById('patch-strength')?.value || 0;
    logNRT('patch', parseFloat(strength));
    });

    document.getElementById('log-lozenge')?.addEventListener('click', () => {
        logNRT('lozenge', 2);
    });

    // Calendar Lock Toggle
    const lockBtn = document.getElementById('edit-lock-btn');
    if (lockBtn) {
        const handleLock = (e) => {
            e.preventDefault();
            isCalendarLocked = !isCalendarLocked;
            lockBtn.innerText = isCalendarLocked ? "🔒" : "🔓";
            lockBtn.style.backgroundColor = isCalendarLocked ? "#f3f4f6" : "#fee2e2";
            document.getElementById('calendar-grid')?.classList.toggle('locked', isCalendarLocked);
        };
        lockBtn.onclick = handleLock;
        lockBtn.ontouchstart = handleLock;
    }

    // Calendar Grid Interactions
    const grid = document.getElementById('calendar-grid');
    if (grid) {
        const handleGridTap = (e) => {
            if (isCalendarLocked) return;
            const dayEl = e.target.closest('.calendar-day');
            if (!dayEl || dayEl.classList.contains('spacer')) return;

            const dateStr = dayEl.dataset.date;
            const currentType = dayEl.dataset.currentShift; 
            toggleShift(dateStr, currentType ? { shift_type: currentType } : null);
        };
        grid.onclick = handleGridTap;
        grid.ontouchstart = handleGridTap;
    }
}

document.getElementById('mode-toggle')?.addEventListener('click', async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const newMode = currentMode === 'vaping' ? 'quit' : 'vaping';
    const quitDate = newMode === 'quit' ? new Date().toISOString() : null;

    await supabase.from('user_status').upsert({ 
        user_id: user.id,
        current_mode: newMode, 
        quit_date: quitDate 
    }, { onConflict: 'user_id' });

    currentMode = newMode;
    updateUI();
    loadData();
});

function updateUI() {
    const emojiEl = document.getElementById('status-emoji');
    const toggleBtn = document.getElementById('mode-toggle');
    const titleEl = document.getElementById('app-title');
    const vapeContainer = document.getElementById('vape-form-container');
    const nrtContainer = document.getElementById('nrt-form-container');

    if (!emojiEl || !toggleBtn || !titleEl) return;

    if (currentMode === 'quit') {
        // UI for when you have ALREADY quit
        titleEl.firstChild.textContent = "Quit Tracker ";
        emojiEl.innerText = "🚭"; 
        toggleBtn.innerText = "Switch to Vaping Mode"; // Offer to go back
        
        if (vapeContainer) vapeContainer.style.display = 'none';
        if (nrtContainer) nrtContainer.style.display = 'block';
    } else {
        // UI for when you are CURRENTLY vaping
        titleEl.firstChild.textContent = "Vape Tracker ";
        emojiEl.innerText = "💨";
        toggleBtn.innerText = "Switch to Quit Mode"; // Offer to quit
        
        if (vapeContainer) vapeContainer.style.display = 'block';
        if (nrtContainer) nrtContainer.style.display = 'none';
    }
}

// Ensure loadData is updated to handle the new insights flow
async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Add this fetch
    const { data: nrtLogs } = await supabase.from('nicotine_replacements')
        .select('*')
        .eq('user_id', user.id);

    const { data: logs } = await supabase.from('vape_logs').select('*').eq('user_id', user.id).order('start_date', { ascending: true });
    const { data: shifts } = await supabase.from('work_shifts').select('*').eq('user_id', user.id);
    const { data: status } = await supabase.from('user_status').select('*').eq('user_id', user.id).maybeSingle();

    // Pass nrtLogs to updateInsights
    updateInsights(logs || [], shifts || [], nrtLogs || []);
    
    const avgText = document.getElementById('avg-daily')?.innerText || "0";
    const currentAvg = parseFloat(avgText);

    // Pass nrtLogs to renderCalendar
    renderCalendar(logs || [], shifts || [], status || { current_mode: 'vaping' }, currentAvg, nrtLogs || []);
	renderHistory();
}

// Add overallAvg to the parameters here
function renderCalendar(logs, shifts, status, overallAvg, nrtLogs){
    const grid = document.getElementById('calendar-grid');
    const monthDisplay = document.getElementById('current-month-display');
    if (!grid || !monthDisplay) return;
    
    grid.innerHTML = '';
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    monthDisplay.innerText = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1).getDay();
    const padding = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let p = 0; p < padding; p++) {
        grid.appendChild(Object.assign(document.createElement('div'), {className: 'calendar-day spacer'}));
    }

    for (let i = 1; i <= daysInMonth; i++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        dayEl.dataset.date = dateStr;

        // Pass overallAvg here so the "cap" works
        const mgValue = calculateMgForDate(dateStr, logs, status, overallAvg, nrtLogs);
        const shift = shifts.find(s => s.shift_date === dateStr);

        if (shift) {
            dayEl.classList.add(`shift-${shift.shift_type}`);
            dayEl.dataset.currentShift = shift.shift_type;
        }

        const todayStr = new Date().toISOString().split('T')[0];
        if (dateStr === todayStr) dayEl.classList.add('today-highlight');

        dayEl.innerHTML = `
            <span>${i}</span>
            ${shift ? `<small class="shift-tag">${shift.shift_type}</small>` : ''}
            <strong>${mgValue > 0 ? mgValue + 'mg' : '-'}</strong>
        `;
        grid.appendChild(dayEl);
    }
}

async function toggleShift(dateStr, currentShift) {
    if (istoggling) return;
    istoggling = true;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { istoggling = false; return; }

    let nextType = null;
    const currentType = currentShift ? (typeof currentShift === 'string' ? currentShift : currentShift.shift_type) : null;

    if (!currentType) nextType = 'M';
    else if (currentType === 'M') nextType = 'A';
    else nextType = null;

    try {
        if (nextType) {
            await supabase.from('work_shifts').upsert({
                shift_date: dateStr,
                shift_type: nextType,
                is_work_day: true,
                user_id: user.id
            }, { onConflict: 'shift_date,user_id' });
        } else {
            await supabase.from('work_shifts').delete().match({ 
                shift_date: dateStr, 
                user_id: user.id 
            });
        }
        await loadData(); 
    } catch (err) {
        console.error(err);
    } finally {
        setTimeout(() => { istoggling = false; }, 200);
    }
}

function calculateMgForDate(dateStr, logs, status, overallAvg = 0, nrtLogs = []) {
    const targetDate = new Date(dateStr);
    targetDate.setHours(0, 0, 0, 0);
    const dayStart = targetDate.getTime();
    const dayEnd = dayStart + 86400000;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (targetDate > today) return 0;

    let dailyVapeNic = 0;
    let dailyNRTNic = 0;

    // 1. Calculate NRT Nicotine (Always counts, even in Quit Mode)
    if (nrtLogs && nrtLogs.length > 0) {
        nrtLogs.forEach(item => {
            // created_at is a timestamp, we want to match the specific day
            const itemDate = new Date(item.created_at).toISOString().split('T')[0];
            if (itemDate === dateStr) {
                dailyNRTNic += parseFloat(item.strength_mg || 0);
            }
        });
    }

    // 2. Calculate Vape Nicotine
    // We only process vapes if we are NOT in quit mode, OR if the target date is BEFORE the quit date
    let shouldCalcVape = true;
    if (status.current_mode === 'quit' && status.quit_date) {
        const qDate = new Date(status.quit_date);
        qDate.setHours(0, 0, 0, 0);
        if (targetDate >= qDate) {
            shouldCalcVape = false;
        }
    }

    if (shouldCalcVape) {
        for (let i = 0; i < logs.length; i++) {
            const cur = logs[i];
            const logStart = new Date(cur.start_date).getTime();
            let logEnd;

            const next = logs[i + 1];
            if (next) {
                logEnd = new Date(next.start_date).getTime();
            } else {
                const now = new Date().getTime();
                const startM = new Date(cur.start_date);
                startM.setHours(0,0,0,0);
                const todayM = new Date();
                todayM.setHours(0,0,0,0);
                
                const actualDaysPassed = Math.round((todayM - startM) / 86400000) + 1;
                const totalNic = cur.quantity_ml * cur.strength_mg;
                const liveAvg = totalNic / actualDaysPassed;

                if (overallAvg > 0 && liveAvg > overallAvg) {
                    if (targetDate >= startM.getTime() && targetDate <= todayM.getTime()) {
                        dailyVapeNic = overallAvg;
                        break; // Stop loop, we found the capped value for this day
                    }
                    continue;
                }
                logEnd = now;
            }

            const totalHours = (logEnd - logStart) / 3600000;
            if (totalHours <= 0) continue;
            const nicPerHour = (cur.quantity_ml * cur.strength_mg) / totalHours;

            const overlapStart = Math.max(dayStart, logStart);
            const overlapEnd = Math.min(dayEnd, logEnd);

            if (overlapStart < overlapEnd) {
                const hoursOnThisDay = (overlapEnd - overlapStart) / 3600000;
                dailyVapeNic += (hoursOnThisDay * nicPerHour);
            }
        }
    }

    const totalTotal = parseFloat(dailyVapeNic) + parseFloat(dailyNRTNic);
    return totalTotal > 0 ? totalTotal.toFixed(1) : 0;
}

function updateInsights(logs, shifts, nrtLogs) {
    // 1. First, calculate the average based on COMPLETED logs only 
    // to avoid the circular logic of using the average to calculate the average.
    let totalMg = 0;
    let totalDays = 0;

    for (let i = 0; i < logs.length - 1; i++) {
        const cur = logs[i];
        const next = logs[i+1];
        const diff = Math.ceil(Math.abs(new Date(next.start_date) - new Date(cur.start_date)) / 86400000);
        totalMg += (cur.quantity_ml * cur.strength_mg);
        totalDays += diff;
    }

    const overallAvg = totalDays > 0 ? (totalMg / totalDays) : 0;

    // 2. Now calculate the specific stats for the UI
    const stats = { M: { s: 0, c: 0 }, A: { s: 0, c: 0 }, Off: { s: 0, c: 0 }, T: { s: 0, c: 0 } };
    const now = new Date();
    now.setHours(0,0,0,0);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    for (let i = 1; i <= daysInMonth; i++) {
        const dStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const date = new Date(dStr);
        if (date > now) continue;

        // Pass the overallAvg into the calculation
        const mg = parseFloat(calculateMgForDate(dStr, logs, { current_mode: 'vaping' }, overallAvg, nrtLogs));
        if (mg > 0) {
            const shift = shifts.find(s => s.shift_date === dStr);
            const type = shift ? shift.shift_type : 'Off';
            stats[type].s += mg; stats[type].c++;
            stats.T.s += mg; stats.T.c++;
        }
    }

    const mEl = document.getElementById('avg-m');
    const aEl = document.getElementById('avg-a');
    const offEl = document.getElementById('avg-off');
    const dailyEl = document.getElementById('avg-daily');

    if (mEl) mEl.innerText = (stats.M.s / (stats.M.c || 1)).toFixed(1) + 'mg';
    if (aEl) aEl.innerText = (stats.A.s / (stats.A.c || 1)).toFixed(1) + 'mg';
    if (offEl) offEl.innerText = (stats.Off.s / (stats.Off.c || 1)).toFixed(1) + 'mg';
    if (dailyEl) dailyEl.innerText = (stats.T.s / (stats.T.c || 1)).toFixed(1) + 'mg';
}



const vapeForm = document.getElementById('vape-form');
if (vapeForm) {
    vapeForm.onsubmit = async (e) => {
        e.preventDefault();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        
        const payload = {
            quantity_ml: parseFloat(document.getElementById('ml').value),
            strength_mg: parseFloat(document.getElementById('mg').value),
            cost: parseFloat(document.getElementById('cost').value),
            start_date: new Date(document.getElementById('start-date').value).toISOString(),
            user_id: user.id 
        };

        const { error } = await supabase.from('vape_logs').insert([payload]);
        if (!error) {
            e.target.reset();
            const n = new Date();
            const dateInput = document.getElementById('start-date');
            if (dateInput) dateInput.value = (new Date(n - n.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
            loadData();
        }
    };
}

async function logNRT(type, mg) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('nicotine_replacements').insert({
        user_id: user.id,
        type: type,
        strength_mg: mg
    });

    if (!error) {
        // This triggers the relay: loadData -> updateInsights -> renderCalendar
        loadData(); 
    } else {
        console.error("Error logging NRT:", error);
    }
}

async function renderHistory() {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    // Fetch recent vapes and NRT
    const [vapeRes, nrtRes] = await Promise.all([
        supabase.from('vape_logs').select('*').eq('user_id', user.id).order('start_date', { ascending: false }).limit(10),
        supabase.from('nicotine_replacements').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10)
    ]);

    // Combine and sort by date
    const combined = [
        ...(vapeRes.data || []).map(v => ({ ...v, sortDate: new Date(v.start_date), displayType: 'vape' })),
        ...(nrtRes.data || []).map(n => ({ ...n, sortDate: new Date(n.created_at), displayType: 'nrt' }))
    ].sort((a, b) => b.sortDate - a.sortDate).slice(0, 10);

    let html = '';

    combined.forEach(item => {
        const dateStr = item.sortDate.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        const isVape = item.displayType === 'vape';
        const color = isVape ? '#6366f1' : '#10b981';
        const table = isVape ? 'vape_logs' : 'nicotine_replacements';
        const label = isVape ? `Vape: ${item.quantity_ml}ml (${item.strength_mg}mg)` : `${item.type}: ${item.strength_mg}mg`;

        html += `
            <div id="row-${item.id}" style="display: flex; flex-direction: column; background: #f9fafb; padding: 12px; border-radius: 8px; border-left: 4px solid ${color}; gap: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="line-height: 1.4;">
                        <span style="font-weight: 600; font-size: 0.95rem;">${label}</span><br>
                        <small style="color: #6b7280;">${dateStr}</small>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button onclick="showEditForm('${item.id}')" 
                                style="background: #eef2ff; border: none; color: #4338ca; padding: 6px 10px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; font-weight: 500;">
                            Edit
                        </button>
                        <button onclick="deleteEntry('${table}', '${item.id}')" 
                                style="background: #fee2e2; border: none; color: #b91c1c; padding: 6px 10px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; font-weight: 500;">
                            Del
                        </button>
                    </div>
                </div>

                <div id="edit-form-${item.id}" style="display: none; background: white; padding: 10px; border-radius: 6px; border: 1px solid #e5e7eb; margin-top: 5px;">
                    <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; align-items: center; font-size: 0.85rem;">
                        ${isVape ? `
                            <label>ml: <input type="number" step="0.1" id="edit-qty-${item.id}" value="${item.quantity_ml}" style="width: 50px; padding: 4px; border: 1px solid #ccc; border-radius: 4px;"></label>
                            <label>£: <input type="number" step="0.01" id="edit-cost-${item.id}" value="${item.cost || 0}" style="width: 55px; padding: 4px; border: 1px solid #ccc; border-radius: 4px;"></label>
                        ` : ''}
                        <label>mg: <input type="number" step="0.1" id="edit-mg-${item.id}" value="${item.strength_mg}" style="width: 50px; padding: 4px; border: 1px solid #ccc; border-radius: 4px;"></label>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="saveEdit('${table}', '${item.id}', ${isVape})" 
                                style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: 600;">
                            Save
                        </button>
                        <button onclick="renderHistory()" 
                                style="background: #f3f4f6; color: #374151; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        `;
    });

    historyList.innerHTML = html || '<p style="text-align: center; color: #9ca3af; padding: 20px;">No recent entries.</p>';
}

// Support functions for Editing
window.showEditForm = function(id) {
    // Hide any other open edit forms to prevent clutter
    document.querySelectorAll('[id^="edit-form-"]').forEach(f => f.style.display = 'none');
    // Show this one
    const form = document.getElementById(`edit-form-${id}`);
    if (form) form.style.display = 'block';
};

window.saveEdit = async function(table, id, isVape) {
    const mg = parseFloat(document.getElementById(`edit-mg-${id}`).value);
    let updateData = { strength_mg: mg };

    if (isVape) {
        updateData.quantity_ml = parseFloat(document.getElementById(`edit-qty-${item.id}`)?.value || 0);
        updateData.cost = parseFloat(document.getElementById(`edit-cost-${item.id}`)?.value || 0);
    }

    const { error } = await supabase.from(table).update(updateData).eq('id', id);

    if (!error) {
        loadData(); // Re-fetch and re-render everything
    } else {
        alert("Update failed: " + error.message);
    }
};

window.deleteEntry = async function(table, id) {
    if (!confirm("Delete this entry? Your daily averages will update immediately.")) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (!error) loadData();
    else alert("Failed to delete: " + error.message);
};

init();