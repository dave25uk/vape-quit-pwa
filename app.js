import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

let currentMode = 'vaping';
let viewDate = new Date();
let isCalendarLocked = true;
let istoggling = false;

async function init() {
    const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
    if (authError) return console.error("Auth failed:", authError.message);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(err => console.log("SW error:", err));
    }

    const { data: status } = await supabase.from('user_status').select('*').maybeSingle();
    currentMode = (status && status.current_mode) ? status.current_mode : 'vaping';
    updateUI();
    
    // Set default date
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now - offset)).toISOString().slice(0, 16);
    const dateInput = document.getElementById('start-date');
    if (dateInput) dateInput.value = localISOTime;

    // Nav Listeners
    document.getElementById('prev-month')?.addEventListener('click', () => {
        viewDate.setMonth(viewDate.getMonth() - 1);
        loadData();
    });
    document.getElementById('next-month')?.addEventListener('click', () => {
        viewDate.setMonth(viewDate.getMonth() + 1);
        loadData();
    });

    // Lock Button Logic
    const lockBtn = document.getElementById('edit-lock-btn');
    if (lockBtn) {
        const handleLock = (e) => {
            e.preventDefault();
            isCalendarLocked = !isCalendarLocked;
            lockBtn.innerText = isCalendarLocked ? "🔒" : "🔓";
            lockBtn.classList.toggle('unlocked', !isCalendarLocked);
            document.getElementById('calendar-grid')?.classList.toggle('locked', isCalendarLocked);
        };
        lockBtn.addEventListener('click', handleLock);
        lockBtn.addEventListener('touchstart', handleLock, { passive: false });
    }

    // Single Grid Listener (Event Delegation)
    const grid = document.getElementById('calendar-grid');
    const handleGridTap = (e) => {
        if (isCalendarLocked) return;
        const dayEl = e.target.closest('.calendar-day');
        if (!dayEl || dayEl.classList.contains('spacer')) return;

        const dateStr = dayEl.dataset.date;
        const currentType = dayEl.dataset.currentShift || null;
        toggleShift(dateStr, currentType ? { shift_type: currentType } : null);
    };
    grid.addEventListener('click', handleGridTap);

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
    if (!emojiEl || !titleEl) return;

    if (currentMode === 'quit') {
        titleEl.firstChild.textContent = "Quit Tracker ";
        emojiEl.innerText = "🚭"; 
        toggleBtn.innerText = "Switch to Vaping Mode";
    } else {
        titleEl.firstChild.textContent = "Vape Tracker ";
        emojiEl.innerText = "💨";
        toggleBtn.innerText = "Switch to Quit Mode";
    }
}

async function loadData() {
    const { data: logs } = await supabase.from('vape_logs').select('*').order('start_date', { ascending: true });
    const { data: shifts } = await supabase.from('work_shifts').select('*');
    const { data: status } = await supabase.from('user_status').select('*').maybeSingle();

    renderCalendar(logs || [], shifts || [], status || { current_mode: 'vaping' });
    updateInsights(logs || [], shifts || []);
}

function renderCalendar(logs, shifts, status) {
    const grid = document.getElementById('calendar-grid');
    const monthDisplay = document.getElementById('current-month-display');
    grid.innerHTML = '';

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    monthDisplay.innerText = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1).getDay();
    const padding = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let p = 0; p < padding; p++) {
        const spacer = document.createElement('div');
        spacer.className = 'calendar-day spacer';
        grid.appendChild(spacer);
    }

    for (let i = 1; i <= daysInMonth; i++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        dayEl.dataset.date = dateStr;

        const mg = calculateMgForDate(dateStr, logs, status);
        const shift = shifts.find(s => s.shift_date === dateStr);

        if (shift) {
            dayEl.classList.add(`shift-${shift.shift_type}`);
            dayEl.dataset.currentShift = shift.shift_type;
        }

        if (dateStr === new Date().toISOString().split('T')[0]) dayEl.classList.add('today-highlight');

        dayEl.innerHTML = `
            <span>${i}</span>
            ${shift ? `<small class="shift-tag">${shift.shift_type}</small>` : ''}
            <strong>${mg > 0 ? mg + 'mg' : '-'}</strong>
        `;
        grid.appendChild(dayEl);
    }
}

async function toggleShift(dateStr, currentShift) {
    if (istoggling) return;
    istoggling = true;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return (istoggling = false);

    let nextType = null;
    const currentType = currentShift ? currentShift.shift_type : null;

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
            await supabase.from('work_shifts').delete().match({ shift_date: dateStr, user_id: user.id });
        }
        await loadData();
    } catch (err) {
        console.error(err);
    } finally {
        setTimeout(() => { istoggling = false; }, 300);
    }
}

function calculateMgForDate(dateStr, logs, status) {
    const targetDate = new Date(dateStr);
    targetDate.setHours(0,0,0,0);
    const today = new Date();
    today.setHours(0,0,0,0);
    if (targetDate > today) return 0;

    if (status.current_mode === 'quit' && status.quit_date) {
        const quitDate = new Date(status.quit_date);
        quitDate.setHours(0,0,0,0);
        if (targetDate >= quitDate) return 0;
    }

    let gaps = [];
    for (let i = 0; i < logs.length - 1; i++) {
        gaps.push(Math.ceil(Math.abs(new Date(logs[i+1].start_date) - new Date(logs[i].start_date)) / 86400000));
    }
    const projected = gaps.length > 0 ? gaps.reduce((a, b) => a + b) / gaps.length : 7;

    for (let i = 0; i < logs.length; i++) {
        const cur = logs[i];
        const logStart = new Date(cur.start_date);
        const next = logs[i + 1];
        const diff = next ? Math.ceil(Math.abs(new Date(next.start_date) - logStart) / 86400000) : Math.max(projected, 1);
        
        const logEnd = new Date(logStart);
        logEnd.setDate(logEnd.getDate() + (diff - 1));

        if (targetDate >= logStart.setHours(0,0,0,0) && targetDate <= logEnd.setHours(23,59,59,999)) {
            return ((cur.quantity_ml * cur.strength_mg) / diff).toFixed(1);
        }
    }
    return 0;
}

function updateInsights(logs, shifts) {
    const stats = { M: { s: 0, c: 0 }, A: { s: 0, c: 0 }, Off: { s: 0, c: 0 }, T: { s: 0, c: 0 } };
    const now = new Date();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    for (let i = 1; i <= days; i++) {
        const dStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const date = new Date(dStr);
        if (date > now) continue;

        const mg = parseFloat(calculateMgForDate(dStr, logs, { current_mode: 'vaping' }));
        if (mg > 0) {
            const shift = shifts.find(s => s.shift_date === dStr);
            const type = shift ? shift.shift_type : 'Off';
            stats[type].s += mg; stats[type].c++;
            stats.T.s += mg; stats.T.c++;
        }
    }

    document.getElementById('avg-m').innerText = (stats.M.s / (stats.M.c || 1)).toFixed(1) + 'mg';
    document.getElementById('avg-a').innerText = (stats.A.s / (stats.A.c || 1)).toFixed(1) + 'mg';
    document.getElementById('avg-off').innerText = (stats.Off.s / (stats.Off.c || 1)).toFixed(1) + 'mg';
    document.getElementById('avg-daily').innerText = (stats.T.s / (stats.T.c || 1)).toFixed(1) + 'mg';
}

document.getElementById('vape-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return location.reload();

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
        document.getElementById('start-date').value = (new Date(n - n.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        loadData();
    }
});

init();