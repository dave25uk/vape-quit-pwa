import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

let currentMode = 'vaping';
let viewDate = new Date(); // Tracks the month currently being viewed

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

document.getElementById('prev-month').addEventListener('click', () => {
    viewDate.setMonth(viewDate.getMonth() - 1);
    loadData();
});
document.getElementById('next-month').addEventListener('click', () => {
    viewDate.setMonth(viewDate.getMonth() + 1);
    loadData();
});
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
    const monthDisplay = document.getElementById('current-month-display');
    grid.innerHTML = '';

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    // Display Month/Year
    const monthName = viewDate.toLocaleString('default', { month: 'long' });
    monthDisplay.innerText = `${monthName} ${year}`;

    // 1. Calculate Padding Days (Monday Start)
    // getDay() returns 0 for Sunday, 1 for Monday... 
    // We transform it so Monday = 0, Sunday = 6
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const paddingDays = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

    // 2. Days in Month
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Add Empty Padding Slots
    for (let p = 0; p < paddingDays; p++) {
        const spacer = document.createElement('div');
        spacer.className = 'calendar-day spacer';
        grid.appendChild(spacer);
    }

    // 3. Create Actual Day Cells
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

        // Highlight "Today"
        const todayStr = new Date().toISOString().split('T')[0];
        if (dateStr === todayStr) dayEl.classList.add('today-highlight');

        dayEl.innerHTML = `
            <span>${i}</span>
            ${shift ? `<small class="shift-tag">${shift.shift_type}</small>` : ''}
            <strong>${mg > 0 ? mg + 'mg' : '-'}</strong>
        `;

        grid.appendChild(dayEl);
    }

    // Interaction Listener (Keep the one we fixed earlier)
    setupGridListeners(grid);
}

function setupGridListeners(grid) {
    // Remove old listeners to prevent duplicates
    grid.replaceWith(grid.cloneNode(true));
    const newGrid = document.getElementById('calendar-grid');

    const handleInteraction = (e) => {
        const dayEl = e.target.closest('.calendar-day');
        if (!dayEl || dayEl.classList.contains('spacer')) return;

        const dateStr = dayEl.dataset.date;
        const currentShiftType = dayEl.dataset.currentShift;
        const currentShift = currentShiftType ? { shift_type: currentShiftType } : null;

        toggleShift(dateStr, currentShift);
    };

    newGrid.addEventListener('touchstart', handleInteraction, { passive: true });
    newGrid.addEventListener('click', handleInteraction);
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
let istoggling = false; // Prevents double-taps

async function toggleShift(dateStr, currentShift) {
    if (istoggling) return;
    istoggling = true;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        alert("Session lost. Please refresh.");
        istoggling = false;
        return;
    }

    let nextType = !currentShift ? 'M' : (currentShift.shift_type === 'M' ? 'A' : null);

    try {
        if (nextType) {
            // THE FIX: Explicitly handle the 'upsert'
            const { error } = await supabase.from('work_shifts').upsert({
                shift_date: dateStr,
                shift_type: nextType,
                is_work_day: true,
                user_id: user.id
            }, { 
                onConflict: 'shift_date,user_id' // Tells Supabase which row to overwrite
            });

            if (error) throw error;
        } else {
            // Delete if cycling back to 'None'
            const { error } = await supabase.from('work_shifts')
                .delete()
                .match({ shift_date: dateStr, user_id: user.id });

            if (error) throw error;
        }
        
        // Refresh the UI
        await loadData(); 
    } catch (err) {
        alert("Database Error: " + err.message);
    } finally {
        // Allow the next tap after 300ms
        setTimeout(() => { istoggling = false; }, 300);
    }
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