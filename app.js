import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

let currentMode = 'vaping';

async function init() {
    registerServiceWorker();
    
    // Fetch initial status
    const { data: status } = await supabase.from('user_status').select('*').single();
    if (status) {
        currentMode = status.current_mode;
        updateUI();
    }
    
    loadData();
}

// Toggle Mode Logic
document.getElementById('mode-toggle').addEventListener('click', async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert("Please log in first!");

    const newMode = currentMode === 'vaping' ? 'quit' : 'vaping';
    const quitDate = newMode === 'quit' ? new Date().toISOString() : null;

    await supabase.from('user_status').upsert({ 
        user_id: user.id,
        current_mode: newMode, 
        quit_date: quitDate 
    });

    currentMode = newMode;
    updateUI();
    loadData(); // Refresh to show 0mg if quit
});

function updateUI() {
    const title = document.getElementById('app-title');
    const toggleBtn = document.getElementById('mode-toggle');
    const entrySection = document.getElementById('entry-section');

    if (currentMode === 'quit') {
        title.innerText = "Quit Tracker 🌿";
        toggleBtn.innerText = "Back to Vaping";
        entrySection.style.display = "none";
    } else {
        title.innerText = "Vape Tracker 💨";
        toggleBtn.innerText = "Switch to Quit Mode";
        entrySection.style.display = "block";
    }
}

async function loadData() {
    const { data: logs } = await supabase.from('vape_logs').select('*').order('start_date', { ascending: true });
    const { data: shifts } = await supabase.from('work_shifts').select('*');
    const { data: status } = await supabase.from('user_status').select('*').maybeSingle();

    renderCalendar(logs, shifts, status || { current_mode: 'vaping' });
}

function renderCalendar(logs, shifts, status) {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    for (let i = 1; i <= daysInMonth; i++) {
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';

        // 1. Determine Intake
        let mg = calculateMgForDate(dateStr, logs, status);
        
        // 2. Check for Work Shift
        const shift = shifts.find(s => s.shift_date === dateStr);
        if (shift) {
            dayEl.classList.add(`shift-${shift.shift_type}`);
            dayEl.innerHTML = `<span>${i}</span><small class="shift-tag">${shift.shift_type}</small><strong>${mg}mg</strong>`;
        } else {
            dayEl.innerHTML = `<span>${i}</span><strong>${mg}mg</strong>`;
        }

        // 3. Add Click Listener for Shift Toggling
        dayEl.addEventListener('click', () => toggleShift(dateStr, shift));

        grid.appendChild(dayEl);
    }
}

function calculateMgForDate(dateStr, logs, status) {
    const targetDate = new Date(dateStr);
    targetDate.setHours(0,0,0,0);

    // If in Quit Mode and date is after quit_date, return 0
    if (status.current_mode === 'quit' && status.quit_date) {
        const quitDate = new Date(status.quit_date);
        quitDate.setHours(0,0,0,0);
        if (targetDate >= quitDate) return 0;
    }

    for (let i = 0; i < logs.length; i++) {
        const current = logs[i];
        const next = logs[i + 1];
        
        const startDate = new Date(current.start_date);
        const endDate = next ? new Date(next.start_date) : new Date();

        if (targetDate >= new Date(startDate.setHours(0,0,0,0)) && targetDate < new Date(endDate.setHours(23,59,59,999))) {
            const totalMg = current.quantity_ml * current.strength_mg;
            const diffTime = Math.abs(endDate - startDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
            return (totalMg / diffDays).toFixed(1);
        }
    }
    return 0;
}

// Form Submission
document.getElementById('vape-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userResponse = await supabase.auth.getUser();
    const user = userResponse.data.user;

    if (!user) return alert("Please log in!");
    
    const payload = {
        quantity_ml: parseFloat(document.getElementById('ml').value),
        strength_mg: parseFloat(document.getElementById('mg').value),
        cost: parseFloat(document.getElementById('cost').value),
        start_date: new Date().toISOString(),
        user_id: user.id
    };

    const { error } = await supabase.from('vape_logs').insert([payload]);
    
    if (!error) {
        alert("Logged!");
        loadData();
    }
});

// Shift Toggling Logic
async function toggleShift(dateStr, currentShift) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert("Please log in!");

    let nextType = null;
    let nextIsWork = false;

    if (!currentShift) {
        nextType = 'M';
        nextIsWork = true;
    } else if (currentShift.shift_type === 'M') {
        nextType = 'A';
        nextIsWork = true;
    } else {
        nextType = null;
        nextIsWork = false;
    }

    if (nextType) {
        await supabase.from('work_shifts').upsert({
            shift_date: dateStr,
            shift_type: nextType,
            is_work_day: nextIsWork,
            user_id: user.id
        });
    } else {
        await supabase.from('work_shifts')
            .delete()
            .match({ shift_date: dateStr, user_id: user.id });
    }

    loadData();
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
}

function updateInsights(logs, shifts) {
    // This filters your calculated daily mg by shift type
    const workDays = shifts.filter(s => s.is_work_day);
    
    // Logic: 
    // 1. Calculate average mg for all 'M' shift days
    // 2. Calculate average mg for all 'A' shift days
    // 3. Calculate average mg for all 'Off' days
}

init();