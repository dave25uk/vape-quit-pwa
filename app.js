const supabaseUrl = 'https://qysscushyrhgrodlpovg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5c3NjdXNoeXJoZ3JvZGxwb3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE3NzEsImV4cCI6MjA5MTM5Nzc3MX0.1KMpTrpzmi6d-r3nbPzGunpiYHkAjpUxuB32RtAlJqI';
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

init();