import { createClient } from '@supabase/supabase-js';
// Vite uses 'import.meta.env' instead of 'process.env'
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

const supabase = supabase.createClient(supabaseUrl, supabaseKey);


let currentMode = 'vaping';

// Initialize App
async function init() {
    registerServiceWorker();
    const { data: status } = await supabase.from('user_status').select('*').single();
    if (status) {
        currentMode = status.current_mode;
        updateUI();
    }
    loadData();
}

// Toggle Mode
document.getElementById('mode-toggle').addEventListener('click', async () => {
    const newMode = currentMode === 'vaping' ? 'quit' : 'vaping';
    const quitDate = newMode === 'quit' ? new Date().toISOString() : null;

    await supabase.from('user_status').upsert({ 
        current_mode: newMode, 
        quit_date: quitDate 
    });

    currentMode = newMode;
    updateUI();
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
    // 1. Fetch vape_logs
    // 2. Fetch work_shifts
    // 3. Run the gap-calculation logic discussed earlier
    // 4. Render the calendar
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
}

async function loadData() {
    const { data: logs } = await supabase.from('vape_logs').select('*').order('start_date', { ascending: true });
    const { data: shifts } = await supabase.from('work_shifts').select('*');
    const { data: status } = await supabase.from('user_status').select('*').single();

    renderCalendar(logs, shifts, status);
}

function renderCalendar(logs, shifts, status) {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = ''; // Clear existing

    // Get current month's days
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
            dayEl.classList.add('work-day');
            dayEl.innerHTML += `<small class="shift-tag">${shift.shift_type}</small>`;
        }

        dayEl.innerHTML += `<span>${i}</span><strong>${mg}mg</strong>`;
        grid.appendChild(dayEl);
    }
}

function calculateMgForDate(dateStr, logs, status) {
    const targetDate = new Date(dateStr);

    // If in Quit Mode and date is after quit_date, return 0
    if (status.current_mode === 'quit' && targetDate >= new Date(status.quit_date)) {
        return 0;
    }

    // Find which vape log covers this date
    for (let i = 0; i < logs.length; i++) {
        const current = logs[i];
        const next = logs[i + 1];
        
        const startDate = new Date(current.start_date);
        const endDate = next ? new Date(next.start_date) : new Date(); // Use "now" for current vape

        if (targetDate >= startDate && targetDate < endDate) {
            const totalMg = current.quantity_ml * current.strength_mg;
            const diffTime = Math.abs(endDate - startDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
            return (totalMg / diffDays).toFixed(1);
        }
    }
    return 0;
}

document.getElementById('vape-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const payload = {
        quantity_ml: parseFloat(document.getElementById('ml').value),
        strength_mg: parseFloat(document.getElementById('mg').value),
        cost: parseFloat(document.getElementById('cost').value),
        start_date: new Date().toISOString(),
        user_id: (await supabase.auth.getUser()).data.user.id
    };

    const { error } = await supabase.from('vape_logs').insert([payload]);
    
    if (!error) {
        alert("Logged!");
        loadData(); // Refresh calendar
    }
});

init();