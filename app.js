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
    
    setupDefaultInputs();
    setupEventListeners(); // All buttons are wired up here
    updateUI();
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
    // 1. Navigation Buttons
    document.getElementById('prev-month')?.addEventListener('click', () => {
        viewDate.setMonth(viewDate.getMonth() - 1);
        loadData();
    });

    document.getElementById('next-month')?.addEventListener('click', () => {
        viewDate.setMonth(viewDate.getMonth() + 1);
        loadData();
    });

    // 2. Mode Toggle (Switching between Vape and Quit)
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

    // 3. NRT Logging
    document.getElementById('log-patch')?.addEventListener('click', () => {
        const strength = document.getElementById('patch-strength')?.value;
        if (strength) logNRT('patch', parseFloat(strength));
    });

    document.getElementById('log-lozenge')?.addEventListener('click', () => {
        logNRT('lozenge', 2);
    });

    // 4. Vape Form Submission
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
                setupDefaultInputs(); // Reset date to now
                loadData();
            }
        };
    }

    // 5. Calendar Lock Toggle
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

    // 6. Calendar Grid Interactions
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

function updateUI() {
    const emojiEl = document.getElementById('status-emoji');
    const toggleBtn = document.getElementById('mode-toggle');
    const titleEl = document.getElementById('app-title');
    const vapeContainer = document.getElementById('vape-form-container');
    const nrtContainer = document.getElementById('nrt-form-container');

    if (!emojiEl || !toggleBtn || !titleEl) return;

    if (currentMode === 'quit') {
        titleEl.firstChild.textContent = "Quit Tracker ";
        emojiEl.innerText = "🚭"; 
        toggleBtn.innerText = "Switch to Vaping Mode";
        if (vapeContainer) vapeContainer.style.display = 'none';
        if (nrtContainer) nrtContainer.style.display = 'block';
    } else {
        titleEl.firstChild.textContent = "Vape Tracker ";
        emojiEl.innerText = "💨";
        toggleBtn.innerText = "Switch to Quit Mode";
        if (vapeContainer) vapeContainer.style.display = 'block';
        if (nrtContainer) nrtContainer.style.display = 'none';
    }
}

// ... (Rest of your helper functions: loadData, renderCalendar, toggleShift, calculateMgForDate, updateInsights, logNRT)