import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

let currentMode = 'vaping';
let viewDate = new Date(); 
let isCalendarLocked = true; 
let istoggling = false;

async function init() {
    const { data: { session } } = await supabase.auth.getSession();
	document.getElementById('log-patch')?.addEventListener('click', () => logNRT('patch', 21));
document.getElementById('log-lozenge')?.addEventListener('click', () => logNRT('lozenge', 2));
	
    if (!session) {
        await supabase.auth.signInAnonymously();
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(err => console.log("SW error:", err));
    }

    const { data: status } = await supabase.from('user_status')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

    currentMode = (status && status.current_mode) ? status.current_mode : 'vaping';
    updateUI();
    
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now - offset)).toISOString().slice(0, 16);
    const dateInput = document.getElementById('start-date');
    if (dateInput) dateInput.value = localISOTime;

    const prevBtn = document.getElementById('prev-month');
    const nextBtn = document.getElementById('next-month');
    
    if (prevBtn) {
        prevBtn.onclick = () => {
            viewDate.setMonth(viewDate.getMonth() - 1);
            loadData();
        };
    }
    if (nextBtn) {
        nextBtn.onclick = () => {
            viewDate.setMonth(viewDate.getMonth() + 1);
            loadData();
        };
    }

    const lockBtn = document.getElementById('edit-lock-btn');
    if (lockBtn) {
        const handleLock = (e) => {
            e.preventDefault();
            isCalendarLocked = !isCalendarLocked;
            lockBtn.innerText = isCalendarLocked ? "🔒" : "🔓";
            lockBtn.style.backgroundColor = isCalendarLocked ? "#f3f4f6" : "#fee2e2";
            const grid = document.getElementById('calendar-grid');
            if (grid) grid.classList.toggle('locked', isCalendarLocked);
        };
        lockBtn.onclick = handleLock;
        lockBtn.ontouchstart = handleLock;
    }

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

    loadData();
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
    
    if (currentMode === 'quit') {
        vapeContainer.style.display = 'none';
        nrtContainer.style.display = 'block';
        // ... rest of your existing title/emoji code
    } else {
        vapeContainer.style.display = 'block';
        nrtContainer.style.display = 'none';
        // ... rest of your existing title/emoji code
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
    await supabase.from('nicotine_replacements').insert({
        user_id: user.id,
        type: type,
        strength_mg: mg
    });
    loadData(); // Refresh the calendar to show the new mg
}

init();