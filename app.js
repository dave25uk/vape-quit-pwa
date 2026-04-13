import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

let currentMode = 'vaping';

async function init() {
    // 1. Force an anonymous sign-in and WAIT for it
    const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
    
    if (authError) {
        console.error("Auth failed:", authError.message);
        alert("Authentication failed: " + authError.message);
        return; 
    }

    // Double-check we actually have a user ID now
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        console.log("Still no user, retrying...");
        // If it fails, we try one more time or alert
        return;
    }

    console.log("Logged in successfully as:", user.id);

    // 2. Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(err => console.log("SW error:", err));
    }

    // 3. Fetch initial status (use maybeSingle to avoid errors if empty)
    const { data: status } = await supabase.from('user_status').select('*').maybeSingle();
    if (status) {
        currentMode = status.current_mode;
        updateUI();
    }
    
    // 4. Set default date for iPhone (local time fix)
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now - offset)).toISOString().slice(0, 16);
    
    const dateInput = document.getElementById('start-date');
    if (dateInput) dateInput.value = localISOTime;

    // 5. Finally load the data
    loadData();
}

document.getElementById('mode-toggle').addEventListener('click', async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert("Please log in!");

    const newMode = currentMode === 'vaping' ? 'quit' : 'vaping';
    const quitDate = newMode === 'quit' ? new Date().toISOString() : null;

    await supabase.from('user_status').upsert({ 
        user_id: user.id,
        current_mode: newMode, 
        quit_date: quitDate 
    });

    currentMode = newMode;
    updateUI();
    loadData();
});

function updateUI() {
    const title = document.getElementById('app-title');
    const toggleBtn = document.getElementById('mode-toggle');
    const entrySection = document.getElementById('entry-section');

    if (currentMode === 'quit') {
        title.innerText = "Quit Mode 🌿";
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

    renderCalendar(logs || [], shifts || [], status || { current_mode: 'vaping' });
    updateInsights(logs || [], shifts || []);
}

function renderCalendar(logs, shifts, status) {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    for (let i = 1; i <= daysInMonth; i++) {
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(i).padStart(2, '0');
        const dateStr = `${now.getFullYear()}-${month}-${day}`;
        
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';

        const mg = calculateMgForDate(dateStr, logs, status);
        const shift = shifts.find(s => s.shift_date === dateStr);

        if (shift) dayEl.classList.add(`shift-${shift.shift_type}`);
        
        dayEl.innerHTML = `
            <span>${i}</span>
            ${shift ? `<small class="shift-tag">${shift.shift_type}</small>` : ''}
            <strong>${mg > 0 ? mg + 'mg' : '-'}</strong>
        `;

        // This handles both iPhone taps and desktop clicks
const handleInteraction = (e) => {
    e.preventDefault(); // Prevents "ghost clicks"
    toggleShift(dateStr, shift);
};

dayEl.addEventListener('touchstart', handleInteraction, { passive: false });
dayEl.addEventListener('click', handleInteraction);
        grid.appendChild(dayEl);
    }
}

function calculateMgForDate(dateStr, logs, status) {
    const targetDate = new Date(dateStr);
    targetDate.setHours(0,0,0,0);
    
    const today = new Date();
    today.setHours(0,0,0,0);

    // Stop calculation if the date is in the future
    if (targetDate > today) return 0;

    if (status.current_mode === 'quit' && status.quit_date) {
        const quitDate = new Date(status.quit_date);
        quitDate.setHours(0,0,0,0);
        if (targetDate >= quitDate) return 0;
    }

    // Calculate historical average gap for projection
    let historicalGaps = [];
    for (let i = 0; i < logs.length - 1; i++) {
        const diff = Math.abs(new Date(logs[i+1].start_date) - new Date(logs[i].start_date));
        historicalGaps.push(Math.ceil(diff / (1000 * 60 * 60 * 24)));
    }
    const projectedDays = historicalGaps.length > 0 
        ? historicalGaps.reduce((a, b) => a + b) / historicalGaps.length 
        : 7;

    for (let i = 0; i < logs.length; i++) {
        const current = logs[i];
        const next = logs[i + 1];
        const logStart = new Date(current.start_date);
        
        let diffDays;
        if (next) {
            diffDays = Math.ceil(Math.abs(new Date(next.start_date) - logStart) / (1000 * 60 * 60 * 24)) || 1;
        } else {
            diffDays = Math.max(projectedDays, 1);
        }

        const logEnd = new Date(logStart);
        logEnd.setDate(logEnd.getDate() + (diffDays - 1)); 

        const compStart = new Date(logStart).setHours(0,0,0,0);
        const compEnd = new Date(logEnd).setHours(23,59,59,999);

        if (targetDate.getTime() >= compStart && targetDate.getTime() <= compEnd) {
            const totalMg = current.quantity_ml * current.strength_mg;
            return (totalMg / diffDays).toFixed(1);
        }
    }
    return 0;
}

// Form Submission
document.getElementById('vape-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Get the user from the current anonymous session
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
        alert("Session expired. Refreshing...");
        location.reload();
        return;
    }
    
    const payload = {
        quantity_ml: parseFloat(document.getElementById('ml').value),
        strength_mg: parseFloat(document.getElementById('mg').value),
        cost: parseFloat(document.getElementById('cost').value),
        start_date: new Date(document.getElementById('start-date').value).toISOString(),
        user_id: user.id 
    };

    const { error } = await supabase.from('vape_logs').insert([payload]);
    
    if (error) {
        alert("Save error: " + error.message);
    } else {
        alert("Vape Logged!");
        e.target.reset();
        
        // Reset the date input to "now" for the next entry
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        document.getElementById('start-date').value = (new Date(now - offset)).toISOString().slice(0, 16);
        
        loadData();
    }
});

// Shift Toggling Logic
async function toggleShift(dateStr, currentShift) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let nextType = !currentShift ? 'M' : (currentShift.shift_type === 'M' ? 'A' : null);

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
    loadData();
}

function updateInsights(logs, shifts) {
    const stats = { 
        M: { sum: 0, count: 0 }, 
        A: { sum: 0, count: 0 }, 
        Off: { sum: 0, count: 0 },
        Total: { sum: 0, count: 0 } 
    };
    
    const now = new Date();
    now.setHours(0,0,0,0);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(now.getFullYear(), now.getMonth(), i);
        // Only calculate for days that have actually happened
        if (date > now) continue;

        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const mg = parseFloat(calculateMgForDate(dateStr, logs, { current_mode: 'vaping' }));
        
        if (mg > 0) {
            const shift = shifts.find(s => s.shift_date === dateStr);
            const type = shift ? shift.shift_type : 'Off';
            
            stats[type].sum += mg;
            stats[type].count++;
            
            // Add to the Master Average
            stats.Total.sum += mg;
            stats.Total.count++;
        }
    }

    document.getElementById('avg-m').innerText = (stats.M.sum / (stats.M.count || 1)).toFixed(1) + 'mg';
    document.getElementById('avg-a').innerText = (stats.A.sum / (stats.A.count || 1)).toFixed(1) + 'mg';
    document.getElementById('avg-off').innerText = (stats.Off.sum / (stats.Off.count || 1)).toFixed(1) + 'mg';
    document.getElementById('avg-daily').innerText = (stats.Total.sum / (stats.Total.count || 1)).toFixed(1) + 'mg';
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
}

init();