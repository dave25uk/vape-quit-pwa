import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

let currentMode = 'vaping';
let viewDate = new Date(); 
let isCalendarLocked = true; 
let istoggling = false;

// --- INITIALIZATION ---
async function init() {
    try {
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
        setupEventListeners();
        updateUI();
        loadData(); // This populates the calendar and stats
    } catch (err) {
        console.error("Initialization failed:", err);
    }
}

function setupDefaultInputs() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now - offset)).toISOString().slice(0, 16);
    const dateInput = document.getElementById('start-date');
    if (dateInput) dateInput.value = localISOTime;
}

function setupEventListeners() {
    // 1. Navigation
    document.getElementById('prev-month')?.addEventListener('click', () => {
        viewDate.setMonth(viewDate.getMonth() - 1);
        loadData();
    });

    document.getElementById('next-month')?.addEventListener('click', () => {
        viewDate.setMonth(viewDate.getMonth() + 1);
        loadData();
    });

    // 2. Mode Toggle
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
        logNRT('patch', parseFloat(strength || 0));
    });

    document.getElementById('log-lozenge')?.addEventListener('click', () => {
        logNRT('lozenge', 2);
    });

    // 4. Vape Form
    document.getElementById('vape-form')?.addEventListener('submit', async (e) => {
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
            setupDefaultInputs();
            loadData();
        }
    });

    // 5. Calendar Lock
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

    // 6. Grid
    const grid = document.getElementById('calendar-grid');
    if (grid) {
        const handleGridTap = (e) => {
            if (isCalendarLocked) return;
            const dayEl = e.target.closest('.calendar-day');
            if (!dayEl || dayEl.classList.contains('spacer')) return;
            toggleShift(dayEl.dataset.date, dayEl.dataset.currentShift);
        };
        grid.onclick = handleGridTap;
        grid.ontouchstart = handleGridTap;
    }
}

// --- CORE FUNCTIONS ---

function updateUI() {
    const emojiEl = document.getElementById('status-emoji');
    const toggleBtn = document.getElementById('mode-toggle');
    const titleEl = document.getElementById('app-title');
    const vapeContainer = document.getElementById('vape-form-container');
    const nrtContainer = document.getElementById('nrt-form-container');

    if (currentMode === 'quit') {
        if (titleEl) titleEl.firstChild.textContent = "Quit Tracker ";
        if (emojiEl) emojiEl.innerText = "🚭"; 
        if (toggleBtn) toggleBtn.innerText = "Switch to Vaping Mode";
        if (vapeContainer) vapeContainer.style.display = 'none';
        if (nrtContainer) nrtContainer.style.display = 'block';
    } else {
        if (titleEl) titleEl.firstChild.textContent = "Vape Tracker ";
        if (emojiEl) emojiEl.innerText = "💨";
        if (toggleBtn) toggleBtn.innerText = "Switch to Quit Mode";
        if (vapeContainer) vapeContainer.style.display = 'block';
        if (nrtContainer) nrtContainer.style.display = 'none';
    }
}

async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [nrtRes, logsRes, shiftsRes, statusRes] = await Promise.all([
        supabase.from('nicotine_replacements').select('*').eq('user_id', user.id),
        supabase.from('vape_logs').select('*').eq('user_id', user.id).order('start_date', { ascending: true }),
        supabase.from('work_shifts').select('*').eq('user_id', user.id),
        supabase.from('user_status').select('*').eq('user_id', user.id).maybeSingle()
    ]);

    updateInsights(logsRes.data || [], shiftsRes.data || [], nrtRes.data || []);
    
    const avgText = document.getElementById('avg-daily')?.innerText || "0";
    const currentAvg = parseFloat(avgText);

    renderCalendar(logsRes.data || [], shiftsRes.data || [], statusRes.data || { current_mode: 'vaping' }, currentAvg, nrtRes.data || []);
}

// (Insert your calculateMgForDate, updateInsights, renderCalendar, toggleShift, and logNRT here)

init();