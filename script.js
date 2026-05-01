// === ViperTab ===

// Where to look for new versions. Host a JSON file with this shape:
// { "version": "1.3.0", "url": "https://github.com/.../releases/latest", "notes": "What's new..." }
// On every new tab we GET this URL; if `version` > installed manifest.version, the
// "Update available" banner appears with a download link. Dismissing remembers the
// version so it won't re-prompt until you bump again.
const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/ViperShard/ViperTab/main/version.json';

const $ = (id) => document.getElementById(id);
const SS = (typeof chrome !== 'undefined' && chrome.storage?.local) || null;

async function getStored(key, fallback = null) {
    if (!SS) {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
    }
    return new Promise(res => SS.get([key], r => res(r[key] ?? fallback)));
}
async function setStored(key, value) {
    if (!SS) { localStorage.setItem(key, JSON.stringify(value)); return; }
    return new Promise(res => SS.set({ [key]: value }, res));
}

// Edition detection — main `ViperTab`, `ViperTab Dev`, `ViperTab Student`, `ViperTab Zen`
const EDITION_NAME = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.name) || 'ViperTab';
const IS_DEV_EDITION = /\bdev\b/i.test(EDITION_NAME);
const IS_STUDENT_EDITION = /\bstudent\b/i.test(EDITION_NAME);
const IS_ZEN_EDITION = /\bzen\b/i.test(EDITION_NAME);
const EDITION_ID = IS_DEV_EDITION ? 'dev'
    : IS_STUDENT_EDITION ? 'student'
    : IS_ZEN_EDITION ? 'zen'
    : 'main';
const ALL_EDITIONS = ['main', 'dev', 'student', 'zen'];
const EDITION_LABEL = { main: 'ViperTab', dev: 'ViperTab Dev', student: 'ViperTab Student', zen: 'ViperTab Zen' };
if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-edition', EDITION_ID);
}

const PREFS = {
    timeFormat: '24',
    tempUnit: 'fahrenheit',
    theme: IS_DEV_EDITION ? 'dev'
         : IS_STUDENT_EDITION ? 'light'
         : IS_ZEN_EDITION ? 'zen-dark'
         : 'glass',
    wallpaperId: IS_DEV_EDITION ? 'mono-black'
               : IS_STUDENT_EDITION ? 'sunrise'
               : IS_ZEN_EDITION ? 'mono-black'
               : 'sequoia',
    vizType: 'bars',
    vizPalette: IS_DEV_EDITION ? 'mono' : 'aurora',
    zenAccent: '#c9a36b',  // gold by default; user-customizable in zen edition
    clockStyle: 'digital', // 'digital' | 'analog' — applies to all clock widgets
};

// Tiny pub-sub so widgets can react to global events (theme, prefs, viz toggle).
const events = {
    map: {},
    on(t, fn) { (this.map[t] = this.map[t] || []).push(fn); return () => this.off(t, fn); },
    off(t, fn) { this.map[t] = (this.map[t] || []).filter(f => f !== fn); },
    emit(t, d) { (this.map[t] || []).forEach(fn => fn(d)); },
};

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------
function applyTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    PREFS.theme = name;
    syncSegToggles();
}

// ---------------------------------------------------------------------------
// Wallpapers
// ---------------------------------------------------------------------------
const WALLPAPERS = [
    { id: 'sequoia', name: 'Sequoia', css:
        `radial-gradient(at 20% 20%, #5b6bd6 0%, transparent 50%),
         radial-gradient(at 80% 0%, #b85ea8 0%, transparent 55%),
         radial-gradient(at 100% 80%, #ff8a5b 0%, transparent 50%),
         radial-gradient(at 0% 100%, #3a4ea8 0%, transparent 60%),
         linear-gradient(135deg, #2a3878 0%, #6d3a8e 50%, #c84a78 100%)` },
    { id: 'aurora', name: 'Aurora', css:
        `radial-gradient(at 30% 30%, #00d4ff 0%, transparent 55%),
         radial-gradient(at 70% 75%, #ff00aa 0%, transparent 60%),
         linear-gradient(135deg, #0a1740 0%, #1a4d7d 100%)` },
    { id: 'sunrise', name: 'Sunrise', css:
        `linear-gradient(180deg, #ff7e5f 0%, #feb47b 55%, #ffd1a8 100%)` },
    { id: 'midnight', name: 'Midnight', css:
        `radial-gradient(at 50% 30%, #1a1a3e 0%, transparent 70%),
         radial-gradient(at 70% 80%, #4a1a5e 0%, transparent 60%),
         linear-gradient(180deg, #0a0a1a 0%, #050510 100%)` },
    { id: 'forest', name: 'Forest', css:
        `linear-gradient(135deg, #134e5e 0%, #4a8a6e 60%, #71b280 100%)` },
    { id: 'cosmic', name: 'Cosmic', css:
        `radial-gradient(at 30% 70%, #5e0854 0%, transparent 50%),
         radial-gradient(at 70% 30%, #ff006e 0%, transparent 50%),
         linear-gradient(135deg, #1a0033 0%, #003366 100%)` },
    { id: 'ocean', name: 'Ocean', css:
        `linear-gradient(180deg, #1e3c72 0%, #2a5298 50%, #6dd5ed 100%)` },
    { id: 'ember', name: 'Ember', css:
        `radial-gradient(at 30% 80%, #ff4e00 0%, transparent 55%),
         radial-gradient(at 70% 30%, #ec9f05 0%, transparent 55%),
         linear-gradient(135deg, #2d0a00 0%, #6d1f10 100%)` },
    { id: 'lavender', name: 'Lavender', css:
        `linear-gradient(135deg, #c3a8e0 0%, #a78bca 50%, #7e6db0 100%)` },
    { id: 'mono-black', name: 'Black', css: `#000000` },
    { id: 'mono-white', name: 'White', css: `#f5f5f7` },
    { id: 'graphite', name: 'Graphite', css: `linear-gradient(135deg, #2c3e50 0%, #4a5568 100%)` },
];

function applyWallpaperById(id) {
    const wp = WALLPAPERS.find(w => w.id === id);
    if (!wp) return;
    $('wallpaper').style.backgroundImage = wp.css.startsWith('#') ? 'none' : wp.css;
    $('wallpaper').style.backgroundColor = wp.css.startsWith('#') ? wp.css : '';
    PREFS.wallpaperId = id;
    document.querySelectorAll('.wallpaper-preview').forEach(el =>
        el.classList.toggle('active', el.dataset.id === id));
}
function applyCustomWallpaper(dataUrl) {
    $('wallpaper').style.backgroundImage = `url('${dataUrl}')`;
    $('wallpaper').style.backgroundColor = '';
    PREFS.wallpaperId = 'custom';
    document.querySelectorAll('.wallpaper-preview').forEach(el => el.classList.remove('active'));
}
function renderWallpaperGrid() {
    const grid = $('wallpaper-grid');
    if (!grid) return;
    grid.innerHTML = '';
    WALLPAPERS.forEach(wp => {
        const el = document.createElement('div');
        el.className = 'wallpaper-preview';
        el.dataset.id = wp.id;
        el.title = wp.name;
        if (wp.css.startsWith('#')) el.style.background = wp.css;
        else el.style.backgroundImage = wp.css;
        const lbl = document.createElement('span');
        lbl.className = 'wp-name';
        lbl.textContent = wp.name;
        el.appendChild(lbl);
        el.addEventListener('click', async () => {
            applyWallpaperById(wp.id);
            await setStored('vipertab.wallpaper', null);
            await setStored('vipertab.prefs', PREFS);
        });
        if (wp.id === PREFS.wallpaperId) el.classList.add('active');
        grid.appendChild(el);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtTime(date, tz) {
    const opt = { hour: 'numeric', minute: '2-digit', hour12: PREFS.timeFormat === '12' };
    if (tz) opt.timeZone = tz;
    return date.toLocaleTimeString('en-US', opt);
}
function domainOf(url) {
    try { return new URL(url).hostname; } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Clock rendering helpers (digital + analog) — used by the clock widget
// ---------------------------------------------------------------------------
function renderDigitalClock(container) {
    const html = `
        <div class="widget-time">—</div>
        <div class="widget-date">—</div>`;
    container.insertAdjacentHTML('beforeend', html);
    const t = container.querySelector('.widget-time');
    const d = container.querySelector('.widget-date');
    const update = () => {
        const now = new Date();
        t.textContent = fmtTime(now);
        d.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
}

function renderAnalogClock(container) {
    const NS = 'http://www.w3.org/2000/svg';
    container.insertAdjacentHTML('beforeend', `
        <svg viewBox="-100 -100 200 200" class="analog-clock" aria-label="Analog clock">
            <g class="ac-marks"></g>
            <line class="ac-hour" x1="0" y1="0" x2="0" y2="-52"/>
            <line class="ac-min"  x1="0" y1="0" x2="0" y2="-78"/>
            <line class="ac-sec"  x1="0" y1="0" x2="0" y2="-90"/>
            <circle class="ac-pin"    cx="0" cy="0" r="5"/>
            <circle class="ac-center" cx="0" cy="0" r="2.4"/>
        </svg>
        <div class="widget-date">—</div>`);

    const marks = container.querySelector('.ac-marks');
    for (let i = 0; i < 60; i++) {
        const a = i * 6 * Math.PI / 180;
        const isHour = i % 5 === 0;
        const isCardinal = i % 15 === 0;
        const r1 = isCardinal ? 76 : isHour ? 80 : 86;
        const r2 = 92;
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', (Math.sin(a) * r1).toFixed(3));
        line.setAttribute('y1', (-Math.cos(a) * r1).toFixed(3));
        line.setAttribute('x2', (Math.sin(a) * r2).toFixed(3));
        line.setAttribute('y2', (-Math.cos(a) * r2).toFixed(3));
        line.setAttribute('class',
            isCardinal ? 'ac-mark ac-mark-cardinal' :
            isHour ? 'ac-mark ac-mark-hour' :
            'ac-mark ac-mark-minute');
        marks.appendChild(line);
    }

    const hourHand = container.querySelector('.ac-hour');
    const minHand  = container.querySelector('.ac-min');
    const secHand  = container.querySelector('.ac-sec');
    const dateEl   = container.querySelector('.widget-date');

    let raf = null;
    let lastDateUpdate = 0;
    const tick = () => {
        const now = new Date();
        const ms = now.getMilliseconds();
        const seconds = now.getSeconds() + ms / 1000;
        const minutes = now.getMinutes() + seconds / 60;
        const hours = (now.getHours() % 12) + minutes / 60;
        secHand.setAttribute('transform', `rotate(${(seconds * 6).toFixed(3)})`);
        minHand.setAttribute('transform',  `rotate(${(minutes * 6).toFixed(3)})`);
        hourHand.setAttribute('transform', `rotate(${(hours * 30).toFixed(3)})`);
        const t = now.getTime();
        if (t - lastDateUpdate > 60000 - ms) {
            dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            lastDateUpdate = t;
        }
        raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { if (raf) cancelAnimationFrame(raf); };
}

// Menu-bar clock (always present; not a swappable widget).
function tickMenuClock() {
    const el = $('menu-clock');
    if (!el) return;
    const now = new Date();
    const dayStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    el.textContent = `${dayStr}  ${fmtTime(now)}`;
}

// ---------------------------------------------------------------------------
// Widget library
// ---------------------------------------------------------------------------
// Each widget defines `render(container, size)` that builds DOM into `container`
// and returns a `destroy` function. `sizes` lists which slot sizes it supports.
//
// Sizes:
//   'small' — single grid cell
//   'tall'  — 1 col × 2 rows (slot4)
//   'wide'  — 4 cols × 1 row (slot8)

const WIDGET_LIBRARY = {
    // ----- Time ---------------------------------------------------------
    clock: {
        id: 'clock', name: 'Clock', icon: '🕐', category: 'Time',
        sizes: ['small', 'tall', 'wide'],
        render(container) {
            container.classList.add('clock-widget');
            let cleanup = null;
            const build = () => {
                if (cleanup) { cleanup(); cleanup = null; }
                container.innerHTML = '';
                cleanup = (PREFS.clockStyle === 'analog')
                    ? renderAnalogClock(container)
                    : renderDigitalClock(container);
            };
            build();
            const offStyle = events.on('clock-style', build);
            const offPrefs = events.on('prefs', build);
            return () => {
                if (cleanup) cleanup();
                offStyle(); offPrefs();
                container.classList.remove('clock-widget');
            };
        },
    },
    worldclocks: {
        id: 'worldclocks', name: 'World Clocks', icon: '🌐', category: 'Time',
        sizes: ['small', 'tall'],
        render(container) {
            container.innerHTML = `
                <div class="widget-label"><span>World Clocks</span></div>
                <div class="tz-grid">
                    <div class="tz"><span class="tz-city">New York</span><span data-tz="America/New_York">—</span></div>
                    <div class="tz"><span class="tz-city">London</span><span data-tz="Europe/London">—</span></div>
                    <div class="tz"><span class="tz-city">Tokyo</span><span data-tz="Asia/Tokyo">—</span></div>
                    <div class="tz"><span class="tz-city">Sydney</span><span data-tz="Australia/Sydney">—</span></div>
                </div>`;
            const cells = container.querySelectorAll('[data-tz]');
            const update = () => {
                const now = new Date();
                cells.forEach(c => c.textContent = fmtTime(now, c.dataset.tz));
            };
            update();
            const iv = setInterval(update, 1000);
            const off = events.on('prefs', update);
            return () => { clearInterval(iv); off(); };
        },
    },
    stopwatch: {
        id: 'stopwatch', name: 'Stopwatch', icon: '⏱️', category: 'Time',
        sizes: ['small', 'tall'],
        render(container) {
            container.innerHTML = `
                <div class="widget-label"><span>Stopwatch</span></div>
                <div class="sw-time">00:00.00</div>
                <div class="sw-controls">
                    <button class="sw-btn sw-start">Start</button>
                    <button class="sw-btn sw-lap">Lap</button>
                    <button class="sw-btn sw-reset">Reset</button>
                </div>
                <ol class="sw-laps"></ol>`;
            const timeEl = container.querySelector('.sw-time');
            const startBtn = container.querySelector('.sw-start');
            const lapBtn = container.querySelector('.sw-lap');
            const resetBtn = container.querySelector('.sw-reset');
            const lapsEl = container.querySelector('.sw-laps');
            let raf = null, startedAt = 0, accum = 0, running = false;
            const fmt = ms => {
                const mm = String(Math.floor(ms / 60000)).padStart(2, '0');
                const ss = String(Math.floor((ms / 1000) % 60)).padStart(2, '0');
                const cs = String(Math.floor((ms / 10) % 100)).padStart(2, '0');
                return `${mm}:${ss}.${cs}`;
            };
            const tick = () => {
                const elapsed = accum + (running ? Date.now() - startedAt : 0);
                timeEl.textContent = fmt(elapsed);
                if (running) raf = requestAnimationFrame(tick);
            };
            startBtn.addEventListener('click', () => {
                if (running) {
                    running = false;
                    accum += Date.now() - startedAt;
                    startBtn.textContent = 'Start';
                    cancelAnimationFrame(raf);
                } else {
                    running = true;
                    startedAt = Date.now();
                    startBtn.textContent = 'Pause';
                    tick();
                }
            });
            lapBtn.addEventListener('click', () => {
                if (!running && accum === 0) return;
                const elapsed = accum + (running ? Date.now() - startedAt : 0);
                const li = document.createElement('li');
                li.textContent = fmt(elapsed);
                lapsEl.insertBefore(li, lapsEl.firstChild);
            });
            resetBtn.addEventListener('click', () => {
                running = false; accum = 0;
                cancelAnimationFrame(raf);
                startBtn.textContent = 'Start';
                timeEl.textContent = '00:00.00';
                lapsEl.innerHTML = '';
            });
            return () => { if (raf) cancelAnimationFrame(raf); };
        },
    },
    pomodoro: {
        id: 'pomodoro', name: 'Pomodoro', icon: '🍅', category: 'Time',
        sizes: ['small', 'tall'],
        render(container) {
            container.innerHTML = `
                <div class="widget-label"><span>Pomodoro</span><span class="pomo-mode">Work</span></div>
                <div class="pomo-display">
                    <svg viewBox="0 0 100 100" class="pomo-ring" aria-hidden="true">
                        <circle class="pomo-ring-bg" cx="50" cy="50" r="44"/>
                        <circle class="pomo-ring-fg" cx="50" cy="50" r="44"/>
                    </svg>
                    <div class="pomo-time">25:00</div>
                </div>
                <div class="pomo-controls">
                    <button class="pomo-btn pomo-toggle">▶</button>
                    <button class="pomo-btn pomo-reset">↻</button>
                </div>`;
            const timeEl = container.querySelector('.pomo-time');
            const modeEl = container.querySelector('.pomo-mode');
            const ringFg = container.querySelector('.pomo-ring-fg');
            const toggleBtn = container.querySelector('.pomo-toggle');
            const resetBtn = container.querySelector('.pomo-reset');
            const WORK = 25 * 60, BREAK = 5 * 60;
            let mode = 'work', total = WORK, left = WORK, running = false, iv = null;
            const RING = 2 * Math.PI * 44;
            ringFg.style.strokeDasharray = RING;
            const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
            const refresh = () => {
                timeEl.textContent = fmt(left);
                modeEl.textContent = mode === 'work' ? 'Work' : 'Break';
                ringFg.style.strokeDashoffset = RING * (1 - left / total);
                ringFg.style.stroke = mode === 'work' ? '#ff453a' : '#34c759';
            };
            const switchMode = () => {
                mode = mode === 'work' ? 'break' : 'work';
                total = mode === 'work' ? WORK : BREAK;
                left = total;
                refresh();
            };
            const tickPomo = () => {
                left -= 1;
                if (left <= 0) {
                    running = false;
                    clearInterval(iv);
                    toggleBtn.textContent = '▶';
                    switchMode();
                    return;
                }
                refresh();
            };
            toggleBtn.addEventListener('click', () => {
                if (running) {
                    running = false;
                    clearInterval(iv);
                    toggleBtn.textContent = '▶';
                } else {
                    running = true;
                    iv = setInterval(tickPomo, 1000);
                    toggleBtn.textContent = '⏸';
                }
            });
            resetBtn.addEventListener('click', () => {
                running = false;
                clearInterval(iv);
                left = total;
                toggleBtn.textContent = '▶';
                refresh();
            });
            refresh();
            return () => { if (iv) clearInterval(iv); };
        },
    },

    // ----- Information --------------------------------------------------
    weather: {
        id: 'weather', name: 'Weather', icon: '☁️', category: 'Information',
        sizes: ['small', 'tall'],
        render(container) {
            container.classList.add('weather-widget');
            container.innerHTML = `
                <div class="widget-label"><span>Weather</span></div>
                <div class="weather-temp">—</div>
                <div class="weather-cond">Loading…</div>
                <div class="weather-loc"></div>`;
            const tempEl = container.querySelector('.weather-temp');
            const condEl = container.querySelector('.weather-cond');
            const locEl  = container.querySelector('.weather-loc');
            const codeMap = {
                0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
                45: 'Foggy', 48: 'Foggy',
                51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
                61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
                71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
                80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers',
                85: 'Snow showers', 86: 'Snow showers',
                95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
            };
            // Hardcoded fallback if every geolocation method fails — NYC.
            const FALLBACK = { latitude: 40.7128, longitude: -74.0060, label: 'New York, NY' };

            async function resolveLocation() {
                // Primary: IP-based geolocation (no browser permission needed).
                // ipapi.co's /json/ endpoint is CORS-enabled, returns lat/lng + city.
                try {
                    const r = await fetch('https://ipapi.co/json/');
                    if (r.ok) {
                        const d = await r.json();
                        if (typeof d.latitude === 'number' && typeof d.longitude === 'number') {
                            return {
                                latitude: d.latitude,
                                longitude: d.longitude,
                                label: [d.city, d.region_code || d.region].filter(Boolean).join(', '),
                            };
                        }
                    }
                } catch { /* ipapi unavailable, fall through */ }

                // Last resort: hardcoded default. Weather still shows.
                return FALLBACK;
            }

            async function load() {
                const loc = await resolveLocation();
                const { latitude, longitude } = loc;
                if (loc.label) locEl.textContent = loc.label;
                const unit = PREFS.tempUnit;
                const symbol = unit === 'celsius' ? '°C' : '°F';
                try {
                    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&temperature_unit=${unit}`);
                    const d = await r.json();
                    tempEl.textContent = `${Math.round(d.current.temperature_2m)}${symbol}`;
                    condEl.textContent = codeMap[d.current.weather_code] ?? '—';
                } catch { condEl.textContent = 'Weather offline'; }
            }
            load();
            const off = events.on('prefs', load);
            return () => { off(); container.classList.remove('weather-widget'); };
        },
    },
    status: {
        id: 'status', name: 'Status', icon: '📊', category: 'Information',
        sizes: ['small', 'tall'],
        render(container) {
            container.classList.add('status-widget');
            container.innerHTML = `
                <div class="widget-label"><span>Status</span></div>
                <div class="sys-row">
                    <div class="sys-stat">
                        <span class="sys-icon" data-bat-icon>🔋</span>
                        <div class="sys-meta">
                            <span class="sys-val" data-bat-pct>—</span>
                            <span class="sys-sub" data-bat-status>Battery</span>
                        </div>
                    </div>
                    <div class="sys-bar"><div class="sys-bar-fill" data-bat-fill></div></div>
                </div>
                <div class="sys-row">
                    <div class="sys-stat">
                        <span class="sys-icon">📑</span>
                        <div class="sys-meta">
                            <span class="sys-val" data-tab-count>—</span>
                            <span class="sys-sub" data-tab-health>Tabs</span>
                        </div>
                    </div>
                    <div class="sys-bar"><div class="sys-bar-fill" data-tab-fill></div></div>
                </div>`;
            const batPct = container.querySelector('[data-bat-pct]');
            const batStatus = container.querySelector('[data-bat-status]');
            const batFill = container.querySelector('[data-bat-fill]');
            const batIcon = container.querySelector('[data-bat-icon]');
            const tabCount = container.querySelector('[data-tab-count]');
            const tabHealthEl = container.querySelector('[data-tab-health]');
            const tabFill = container.querySelector('[data-tab-fill]');
            const setHealth = (el, cls) => {
                el.classList.remove('health-good', 'health-ok', 'health-bad', 'health-crit');
                if (cls) el.classList.add(cls);
            };
            const tabHealth = n => n <= 10 ? { l: 'Focused', c: 'health-good' }
                                : n <= 25 ? { l: 'Healthy', c: 'health-good' }
                                : n <= 50 ? { l: 'Busy', c: 'health-ok' }
                                : n <= 100 ? { l: 'Crowded', c: 'health-bad' }
                                : { l: 'Tab hoarder', c: 'health-crit' };
            let batListeners = null;
            (async () => {
                if (typeof navigator.getBattery === 'function') {
                    try {
                        const bat = await navigator.getBattery();
                        const update = () => {
                            const pct = Math.round(bat.level * 100);
                            const charging = bat.charging;
                            const cls = charging ? 'health-good' : pct <= 15 ? 'health-crit' : pct <= 30 ? 'health-bad' : pct <= 50 ? 'health-ok' : 'health-good';
                            batPct.textContent = `${pct}%`;
                            batStatus.textContent = charging ? 'Charging' : pct <= 15 ? 'Critical' : pct <= 30 ? 'Low' : 'Battery';
                            batIcon.textContent = charging ? '⚡' : pct <= 15 ? '🪫' : '🔋';
                            batFill.style.width = `${pct}%`;
                            setHealth(batStatus, cls);
                            setHealth(batFill, cls);
                        };
                        update();
                        bat.addEventListener('levelchange', update);
                        bat.addEventListener('chargingchange', update);
                        batListeners = { bat, update };
                    } catch { batPct.textContent = '—'; batStatus.textContent = 'Unavailable'; }
                } else { batPct.textContent = '—'; batStatus.textContent = 'Unsupported'; }
            })();
            const updateTabs = () => {
                if (typeof chrome === 'undefined' || !chrome.tabs) {
                    tabCount.textContent = '—';
                    tabHealthEl.textContent = 'Unavailable';
                    return;
                }
                chrome.tabs.query({}, tabs => {
                    const n = tabs.length;
                    const info = tabHealth(n);
                    tabCount.textContent = String(n);
                    tabHealthEl.textContent = info.l;
                    setHealth(tabHealthEl, info.c);
                    tabFill.style.width = `${Math.min((n / 50) * 100, 100)}%`;
                    setHealth(tabFill, info.c);
                });
            };
            updateTabs();
            chrome.tabs?.onCreated?.addListener(updateTabs);
            chrome.tabs?.onRemoved?.addListener(updateTabs);
            chrome.tabs?.onUpdated?.addListener(updateTabs);
            return () => {
                container.classList.remove('status-widget');
                if (batListeners) {
                    batListeners.bat.removeEventListener('levelchange', batListeners.update);
                    batListeners.bat.removeEventListener('chargingchange', batListeners.update);
                }
                chrome.tabs?.onCreated?.removeListener(updateTabs);
                chrome.tabs?.onRemoved?.removeListener(updateTabs);
                chrome.tabs?.onUpdated?.removeListener(updateTabs);
            };
        },
    },
    crypto: {
        id: 'crypto', name: 'Crypto', icon: '₿', category: 'Information',
        sizes: ['small', 'tall'],
        render(container) {
            container.innerHTML = `
                <div class="widget-label"><span>Crypto</span></div>
                <ul class="ticker-list"></ul>`;
            const list = container.querySelector('.ticker-list');
            const ids = ['bitcoin', 'ethereum', 'solana', 'cardano'];
            const symbols = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', cardano: 'ADA' };
            async function update() {
                try {
                    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`);
                    const d = await r.json();
                    list.innerHTML = '';
                    ids.forEach(id => {
                        const data = d[id];
                        if (!data) return;
                        const li = document.createElement('li');
                        li.className = 'ticker-row';
                        const change = data.usd_24h_change ?? 0;
                        const up = change >= 0;
                        const name = document.createElement('span'); name.className = 'ticker-name'; name.textContent = symbols[id] || id;
                        const price = document.createElement('span'); price.className = 'ticker-price';
                        price.textContent = '$' + data.usd.toLocaleString('en-US', { maximumFractionDigits: data.usd < 10 ? 4 : 0 });
                        const ch = document.createElement('span'); ch.className = `ticker-change ${up ? 'up' : 'down'}`;
                        ch.textContent = `${up ? '+' : ''}${change.toFixed(1)}%`;
                        li.append(name, price, ch);
                        list.appendChild(li);
                    });
                } catch {
                    list.innerHTML = '';
                    const li = document.createElement('li'); li.className = 'ticker-error';
                    li.textContent = 'Offline';
                    list.appendChild(li);
                }
            }
            update();
            const iv = setInterval(update, 60000);
            return () => clearInterval(iv);
        },
    },
    quote: {
        id: 'quote', name: 'Quote of the Day', icon: '💭', category: 'Information',
        sizes: ['small', 'wide'],
        render(container) {
            container.innerHTML = `
                <div class="widget-label"><span>Quote of the Day</span></div>
                <blockquote class="quote-text">Loading…</blockquote>
                <div class="quote-author">—</div>`;
            const text = container.querySelector('.quote-text');
            const author = container.querySelector('.quote-author');
            const fallback = [
                ['Be yourself; everyone else is taken.', 'Oscar Wilde'],
                ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
                ['The best way out is always through.', 'Robert Frost'],
                ['Stay hungry, stay foolish.', 'Steve Jobs'],
                ['What we think, we become.', 'Buddha'],
            ];
            (async () => {
                try {
                    const r = await fetch('https://api.quotable.io/random?maxLength=140');
                    const d = await r.json();
                    text.textContent = `“${d.content}”`;
                    author.textContent = `— ${d.author}`;
                } catch {
                    const q = fallback[Math.floor(Math.random() * fallback.length)];
                    text.textContent = `“${q[0]}”`;
                    author.textContent = `— ${q[1]}`;
                }
            })();
            return () => {};
        },
    },
    apod: {
        id: 'apod', name: 'Picture of the Day', icon: '🌌', category: 'Information',
        sizes: ['wide', 'tall'],
        render(container) {
            container.innerHTML = `
                <div class="widget-label"><span>Picture of the Day</span></div>
                <div class="apod-img-wrap"><img class="apod-img" alt=""></div>
                <div class="apod-title">Loading…</div>`;
            const img = container.querySelector('.apod-img');
            const titleEl = container.querySelector('.apod-title');
            (async () => {
                try {
                    const r = await fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY');
                    const d = await r.json();
                    if (d.media_type === 'image') img.src = d.url;
                    else if (d.thumbnail_url) img.src = d.thumbnail_url;
                    titleEl.textContent = d.title || '';
                    img.alt = d.title || '';
                } catch { titleEl.textContent = 'Unable to load'; }
            })();
            return () => {};
        },
    },

    // ----- Productivity ------------------------------------------------
    notes: {
        id: 'notes', name: 'Notes', icon: '📝', category: 'Productivity',
        sizes: ['small', 'tall', 'wide'],
        render(container) {
            container.classList.add('notes-widget');
            container.innerHTML = `
                <div class="widget-label"><span>Notes</span></div>
                <textarea class="notes-area" placeholder="Jot something..."></textarea>`;
            const ta = container.querySelector('.notes-area');
            (async () => { ta.value = await getStored('vipertab.notes', ''); })();
            let t;
            const onInput = () => {
                clearTimeout(t);
                t = setTimeout(() => setStored('vipertab.notes', ta.value), 250);
            };
            ta.addEventListener('input', onInput);
            return () => {
                clearTimeout(t);
                ta.removeEventListener('input', onInput);
                container.classList.remove('notes-widget');
            };
        },
    },
    todo: {
        id: 'todo', name: 'To-do List', icon: '✅', category: 'Productivity',
        sizes: ['small', 'tall'],
        render(container) {
            container.innerHTML = `
                <div class="widget-label"><span>To-do</span></div>
                <form class="todo-add"><input type="text" class="todo-input" placeholder="Add a task..."></form>
                <ul class="todo-list"></ul>`;
            const list = container.querySelector('.todo-list');
            const input = container.querySelector('.todo-input');
            const form = container.querySelector('.todo-add');
            let items = [];
            function renderList() {
                list.innerHTML = '';
                items.forEach((item, i) => {
                    const li = document.createElement('li');
                    li.className = 'todo-item' + (item.done ? ' done' : '');
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = item.done;
                    cb.addEventListener('change', () => {
                        items[i].done = cb.checked;
                        setStored('vipertab.todo', items);
                        renderList();
                    });
                    const span = document.createElement('span');
                    span.className = 'todo-text';
                    span.textContent = item.text;
                    const del = document.createElement('button');
                    del.type = 'button';
                    del.className = 'todo-del';
                    del.textContent = '×';
                    del.addEventListener('click', () => {
                        items.splice(i, 1);
                        setStored('vipertab.todo', items);
                        renderList();
                    });
                    li.append(cb, span, del);
                    list.appendChild(li);
                });
            }
            (async () => { items = await getStored('vipertab.todo', []); renderList(); })();
            const onSubmit = (e) => {
                e.preventDefault();
                const v = input.value.trim();
                if (!v) return;
                items.push({ text: v, done: false });
                input.value = '';
                setStored('vipertab.todo', items);
                renderList();
            };
            form.addEventListener('submit', onSubmit);
            return () => form.removeEventListener('submit', onSubmit);
        },
    },
    calculator: {
        id: 'calculator', name: 'Calculator', icon: '🧮', category: 'Productivity',
        sizes: ['tall'],
        render(container) {
            container.classList.add('calc-widget');
            container.innerHTML = `
                <div class="widget-label"><span>Calculator</span></div>
                <div class="calc-display">0</div>
                <div class="calc-keys"></div>`;
            const display = container.querySelector('.calc-display');
            const keys = container.querySelector('.calc-keys');
            const layout = [
                { k: 'C', cls: 'fn' }, { k: '±', cls: 'fn' }, { k: '%', cls: 'fn' }, { k: '÷', cls: 'op' },
                { k: '7' }, { k: '8' }, { k: '9' }, { k: '×', cls: 'op' },
                { k: '4' }, { k: '5' }, { k: '6' }, { k: '−', cls: 'op' },
                { k: '1' }, { k: '2' }, { k: '3' }, { k: '+', cls: 'op' },
                { k: '0', cls: 'zero' }, { k: '.' }, { k: '=', cls: 'op' },
            ];
            let buf = '0', accum = null, pending = null, justOp = true;
            const opFn = { '+': (a, b) => a + b, '−': (a, b) => a - b, '×': (a, b) => a * b, '÷': (a, b) => b === 0 ? NaN : a / b };
            const show = () => {
                let s = buf;
                if (s === 'NaN' || s === 'Infinity' || s === '-Infinity') s = 'Err';
                if (s.length > 11) {
                    const n = parseFloat(s);
                    s = Number.isFinite(n) ? n.toPrecision(8).replace(/\.?0+$/, '') : 'Err';
                }
                display.textContent = s;
            };
            const press = (k) => {
                if (/^[0-9]$/.test(k)) {
                    buf = (buf === '0' || justOp) ? k : buf + k;
                    justOp = false;
                } else if (k === '.') {
                    if (justOp) { buf = '0.'; justOp = false; }
                    else if (!buf.includes('.')) buf += '.';
                } else if (k === 'C') { buf = '0'; accum = null; pending = null; justOp = true; }
                else if (k === '±') { buf = buf.startsWith('-') ? buf.slice(1) : '-' + buf; }
                else if (k === '%') { buf = String(parseFloat(buf) / 100); }
                else if (opFn[k] || k === '=') {
                    const cur = parseFloat(buf);
                    if (accum === null || pending === null) accum = cur;
                    else if (!justOp) accum = opFn[pending](accum, cur);
                    buf = String(accum);
                    pending = (k === '=') ? null : k;
                    justOp = true;
                }
                show();
            };
            layout.forEach(({ k, cls }) => {
                const b = document.createElement('button');
                b.textContent = k;
                if (cls) b.className = cls;
                b.addEventListener('click', () => press(k));
                keys.appendChild(b);
            });
            const onKey = (e) => {
                if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
                const map = { '+': '+', '-': '−', '*': '×', '/': '÷', '=': '=', 'Enter': '=', '.': '.', '%': '%' };
                if (/^[0-9]$/.test(e.key)) press(e.key);
                else if (map[e.key]) press(map[e.key]);
                else return;
                e.preventDefault();
            };
            document.addEventListener('keydown', onKey);
            return () => {
                document.removeEventListener('keydown', onKey);
                container.classList.remove('calc-widget');
            };
        },
    },
    dice: {
        id: 'dice', name: 'Dice', icon: '🎲', category: 'Productivity',
        sizes: ['small'],
        render(container) {
            container.innerHTML = `
                <div class="widget-label"><span>Dice</span></div>
                <div class="dice-value">—</div>
                <div class="dice-controls">
                    <select class="dice-type">
                        <option value="6">d6</option>
                        <option value="10">d10</option>
                        <option value="12">d12</option>
                        <option value="20">d20</option>
                        <option value="100">d100</option>
                    </select>
                    <button class="dice-roll">Roll</button>
                </div>`;
            const valEl = container.querySelector('.dice-value');
            const typeEl = container.querySelector('.dice-type');
            const rollBtn = container.querySelector('.dice-roll');
            rollBtn.addEventListener('click', () => {
                const max = parseInt(typeEl.value);
                valEl.textContent = String(Math.floor(Math.random() * max) + 1);
                valEl.style.animation = 'none';
                void valEl.offsetWidth;
                valEl.style.animation = 'diceRoll 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
            });
            return () => {};
        },
    },

    // ----- Web ----------------------------------------------------------
    search: {
        id: 'search', name: 'Search Bar', icon: '🔍', category: 'Web',
        sizes: ['small', 'wide'],
        render(container) {
            container.innerHTML = `
                <div class="widget-label"><span>Search</span></div>
                <form class="search-form">
                    <select class="search-engine">
                        <option value="https://www.google.com/search?q=">Google</option>
                        <option value="https://duckduckgo.com/?q=">DuckDuckGo</option>
                        <option value="https://www.bing.com/search?q=">Bing</option>
                        <option value="https://www.youtube.com/results?search_query=">YouTube</option>
                        <option value="https://github.com/search?q=">GitHub</option>
                        <option value="https://en.wikipedia.org/wiki/Special:Search?search=">Wikipedia</option>
                    </select>
                    <input type="text" class="search-input" placeholder="Search…">
                    <button type="submit" class="search-go">→</button>
                </form>`;
            const form = container.querySelector('.search-form');
            const engine = container.querySelector('.search-engine');
            const input = container.querySelector('.search-input');
            const onSubmit = (e) => {
                e.preventDefault();
                const v = input.value.trim();
                if (!v) return;
                location.href = engine.value + encodeURIComponent(v);
            };
            form.addEventListener('submit', onSubmit);
            return () => form.removeEventListener('submit', onSubmit);
        },
    },
    recent: {
        id: 'recent', name: 'Recently Closed', icon: '↩️', category: 'Web',
        sizes: ['small', 'tall'],
        render(container) {
            container.classList.add('recent-widget');
            container.innerHTML = `
                <div class="widget-label"><span>Recently Closed</span></div>
                <ul class="recent-list"><li class="recent-empty">Nothing yet</li></ul>`;
            const ul = container.querySelector('.recent-list');
            const update = () => {
                if (typeof chrome === 'undefined' || !chrome.sessions) return;
                chrome.sessions.getRecentlyClosed({ maxResults: 12 }, (sessions) => {
                    ul.innerHTML = '';
                    const items = sessions.filter(s => s.tab).slice(0, 10);
                    if (!items.length) {
                        const li = document.createElement('li');
                        li.className = 'recent-empty';
                        li.textContent = 'Nothing yet';
                        ul.appendChild(li);
                        return;
                    }
                    items.forEach(s => {
                        const li = document.createElement('li');
                        li.textContent = s.tab.title || s.tab.url;
                        li.title = s.tab.url;
                        li.addEventListener('click', () => chrome.sessions.restore(s.tab.sessionId));
                        ul.appendChild(li);
                    });
                });
            };
            update();
            return () => container.classList.remove('recent-widget');
        },
    },

    // ----- Media --------------------------------------------------------
    visualizer: {
        id: 'visualizer', name: 'Sound Visualizer', icon: '🎵', category: 'Media',
        sizes: ['wide'],
        render(container) {
            container.classList.add('visualizer-widget');
            container.innerHTML = `
                <div class="widget-label">
                    <span>Sound</span>
                    <div class="viz-controls">
                        <select class="viz-select viz-type" title="Style">
                            <option value="bars">Bars</option>
                            <option value="mirror">Mirror</option>
                            <option value="wave">Wave</option>
                            <option value="circle">Circle</option>
                        </select>
                        <select class="viz-select viz-palette" title="Palette">
                            <option value="smart">Smart (from tab)</option>
                            <option value="aurora">Aurora</option>
                            <option value="ocean">Ocean</option>
                            <option value="fire">Fire</option>
                            <option value="forest">Forest</option>
                            <option value="rainbow">Rainbow</option>
                            <option value="mono">Mono</option>
                        </select>
                        <button class="viz-btn viz-toggle" title="Capture audio">
                            <svg class="viz-icon" width="12" height="12" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                        </button>
                    </div>
                </div>
                <canvas class="viz-canvas"></canvas>
                <div class="viz-status">Pick a tab and check "Share audio"</div>`;
            const canvas = container.querySelector('.viz-canvas');
            const status = container.querySelector('.viz-status');
            const btn = container.querySelector('.viz-toggle');
            const typeSel = container.querySelector('.viz-type');
            const palSel = container.querySelector('.viz-palette');
            const iconPath = container.querySelector('.viz-icon path');
            const ctx = canvas.getContext('2d');
            const PLAY = 'M8 5v14l11-7z';
            const PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z';
            let audioCtx = null, analyser = null, source = null, stream = null, raf = null;
            let running = false, freqData = null, timeData = null;
            let smartTimer = null;
            typeSel.value = PREFS.vizType;
            palSel.value = PREFS.vizPalette;
            const ro = new ResizeObserver(() => {
                const dpr = window.devicePixelRatio || 1;
                const r = canvas.getBoundingClientRect();
                if (r.width === 0) return;
                canvas.width = Math.floor(r.width * dpr);
                canvas.height = Math.floor(r.height * dpr);
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            });
            ro.observe(canvas);
            const start = async () => {
                try {
                    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                } catch { status.textContent = 'Capture cancelled'; return; }
                const audioTracks = stream.getAudioTracks();
                if (!audioTracks.length) {
                    status.textContent = 'No audio shared — re-pick and check "Share audio"';
                    stream.getTracks().forEach(t => t.stop());
                    stream = null; return;
                }
                audioTracks[0].addEventListener('ended', stop);
                const AC = window.AudioContext || window.webkitAudioContext;
                audioCtx = new AC();
                source = audioCtx.createMediaStreamSource(new MediaStream(audioTracks));
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 1024;
                analyser.smoothingTimeConstant = 0.78;
                source.connect(analyser);
                freqData = new Uint8Array(analyser.frequencyBinCount);
                timeData = new Uint8Array(analyser.fftSize);

                // Smart-palette sampling: keep the video track alive and feed
                // it into a hidden <video> we read frames from every 600ms.
                const videoTracks = stream.getVideoTracks();
                if (videoTracks.length) {
                    setupSmartVideo();
                    smartVideoEl.srcObject = new MediaStream(videoTracks);
                    smartVideoEl.muted = true;
                    smartVideoEl.play().catch(() => {});
                    smartTimer = setInterval(sampleSmartColors, 600);
                }

                running = true;
                btn.classList.add('active');
                iconPath.setAttribute('d', PAUSE);
                status.textContent = 'Visualizing browser audio';
                draw();
            };
            const stop = () => {
                running = false;
                if (raf) cancelAnimationFrame(raf);
                raf = null;
                if (smartTimer) { clearInterval(smartTimer); smartTimer = null; }
                if (smartVideoEl) { try { smartVideoEl.pause(); } catch {} smartVideoEl.srcObject = null; }
                smartTarget = null;
                smartCurrent = null;
                if (stream) stream.getTracks().forEach(t => t.stop());
                if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
                stream = null; audioCtx = null; analyser = null; source = null;
                btn.classList.remove('active');
                iconPath.setAttribute('d', PLAY);
                status.textContent = 'Pick a tab and check "Share audio"';
                const r = canvas.getBoundingClientRect();
                ctx.clearRect(0, 0, r.width, r.height);
            };
            const draw = () => {
                if (!running || !analyser) return;
                analyser.getByteFrequencyData(freqData);
                analyser.getByteTimeDomainData(timeData);
                if (PREFS.vizPalette === 'smart') updateSmartCurrent();
                const r = canvas.getBoundingClientRect();
                const W = r.width, H = r.height;
                ctx.clearRect(0, 0, W, H);
                const fn = { bars: drawBars, mirror: drawMirror, wave: drawWave, circle: drawCircle }[PREFS.vizType] || drawBars;
                fn(ctx, PREFS.vizType === 'wave' ? timeData : freqData, W, H, PREFS.vizPalette);
                raf = requestAnimationFrame(draw);
            };
            btn.addEventListener('click', () => running ? stop() : start());
            typeSel.addEventListener('change', async () => { PREFS.vizType = typeSel.value; await setStored('vipertab.prefs', PREFS); });
            palSel.addEventListener('change', async () => { PREFS.vizPalette = palSel.value; await setStored('vipertab.prefs', PREFS); });
            const offToggle = events.on('visualizer-toggle', () => running ? stop() : start());

            return () => {
                stop();
                ro.disconnect();
                offToggle();
                container.classList.remove('visualizer-widget');
            };
        },
    },

    // ----- Dev tools ---------------------------------------------------
    hackernews: {
        id: 'hackernews', name: 'Hacker News', icon: 'Y', category: 'Dev',
        sizes: ['small', 'tall'],
        render(container) {
            container.classList.add('hn-widget');
            container.innerHTML = `
                <div class="widget-label"><span>Hacker News</span></div>
                <ul class="hn-list"><li class="hn-loading">Loading…</li></ul>`;
            const list = container.querySelector('.hn-list');
            async function load() {
                try {
                    const r1 = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
                    const ids = (await r1.json()).slice(0, 8);
                    const stories = await Promise.all(ids.map(id =>
                        fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json())
                    ));
                    list.innerHTML = '';
                    stories.forEach(s => {
                        if (!s) return;
                        const li = document.createElement('li');
                        li.className = 'hn-row';
                        const a = document.createElement('a');
                        a.href = s.url || `https://news.ycombinator.com/item?id=${s.id}`;
                        a.target = '_blank'; a.rel = 'noopener noreferrer';
                        a.textContent = s.title;
                        a.className = 'hn-title';
                        const meta = document.createElement('span');
                        meta.className = 'hn-meta';
                        meta.textContent = `${s.score ?? 0} · ${s.descendants ?? 0}c`;
                        li.append(a, meta);
                        list.appendChild(li);
                    });
                } catch {
                    list.innerHTML = '';
                    const li = document.createElement('li');
                    li.className = 'hn-error';
                    li.textContent = 'Offline';
                    list.appendChild(li);
                }
            }
            load();
            const iv = setInterval(load, 5 * 60 * 1000);
            return () => { clearInterval(iv); container.classList.remove('hn-widget'); };
        },
    },
    regex: {
        id: 'regex', name: 'Regex Tester', icon: '/.*/', category: 'Dev',
        sizes: ['small', 'tall'],
        render(container) {
            container.classList.add('rx-widget');
            container.innerHTML = `
                <div class="widget-label"><span>Regex Tester</span></div>
                <input type="text" class="rx-pattern" placeholder="/pattern/flags" spellcheck="false">
                <textarea class="rx-test" placeholder="Test string…" spellcheck="false"></textarea>
                <div class="rx-result"></div>`;
            const pattern = container.querySelector('.rx-pattern');
            const test = container.querySelector('.rx-test');
            const result = container.querySelector('.rx-result');
            function run() {
                const p = pattern.value.trim();
                const t = test.value;
                if (!p) { result.textContent = ''; result.className = 'rx-result'; return; }
                try {
                    const m = p.match(/^\/(.+)\/([gimsuy]*)$/);
                    let re;
                    if (m) re = new RegExp(m[1], m[2].includes('g') ? m[2] : m[2] + 'g');
                    else re = new RegExp(p, 'g');
                    const matches = Array.from(t.matchAll(re));
                    result.innerHTML = '';
                    if (matches.length === 0) {
                        result.textContent = 'No matches';
                        result.className = 'rx-result rx-empty';
                    } else {
                        result.className = 'rx-result rx-found';
                        const summary = document.createElement('div');
                        summary.className = 'rx-summary';
                        summary.textContent = `${matches.length} match${matches.length === 1 ? '' : 'es'}`;
                        result.appendChild(summary);
                        matches.slice(0, 12).forEach((match, i) => {
                            const div = document.createElement('div');
                            div.className = 'rx-match';
                            div.textContent = `[${i}] ${match[0]}`;
                            result.appendChild(div);
                        });
                    }
                } catch (e) {
                    result.textContent = `Error: ${e.message}`;
                    result.className = 'rx-result rx-error';
                }
            }
            pattern.addEventListener('input', run);
            test.addEventListener('input', run);
            return () => container.classList.remove('rx-widget');
        },
    },
    json: {
        id: 'json', name: 'JSON Formatter', icon: '{}', category: 'Dev',
        sizes: ['tall', 'wide'],
        render(container) {
            container.classList.add('json-widget');
            container.innerHTML = `
                <div class="widget-label">
                    <span>JSON</span>
                    <div class="json-actions">
                        <button class="json-btn json-format">Format</button>
                        <button class="json-btn json-minify">Minify</button>
                        <button class="json-btn json-clear">Clear</button>
                    </div>
                </div>
                <textarea class="json-area" placeholder='{"paste": "JSON here"}' spellcheck="false"></textarea>`;
            const ta = container.querySelector('.json-area');
            container.querySelector('.json-format').addEventListener('click', () => {
                try { ta.value = JSON.stringify(JSON.parse(ta.value), null, 2); }
                catch (e) { ta.value = `// Error: ${e.message}\n` + ta.value; }
            });
            container.querySelector('.json-minify').addEventListener('click', () => {
                try { ta.value = JSON.stringify(JSON.parse(ta.value)); }
                catch (e) { ta.value = `// Error: ${e.message}\n` + ta.value; }
            });
            container.querySelector('.json-clear').addEventListener('click', () => { ta.value = ''; });
            return () => container.classList.remove('json-widget');
        },
    },
    encoder: {
        id: 'encoder', name: 'Encoder / Decoder', icon: '⇄', category: 'Dev',
        sizes: ['small', 'tall'],
        render(container) {
            container.classList.add('enc-widget');
            container.innerHTML = `
                <div class="widget-label">
                    <span>Encode / Decode</span>
                    <select class="enc-mode">
                        <option value="base64">Base64</option>
                        <option value="url">URL</option>
                        <option value="html">HTML</option>
                    </select>
                </div>
                <textarea class="enc-input" placeholder="Input" spellcheck="false"></textarea>
                <div class="enc-buttons">
                    <button class="enc-btn enc-encode">Encode ↓</button>
                    <button class="enc-btn enc-decode">Decode ↑</button>
                </div>
                <textarea class="enc-output" placeholder="Output" spellcheck="false" readonly></textarea>`;
            const mode = container.querySelector('.enc-mode');
            const input = container.querySelector('.enc-input');
            const output = container.querySelector('.enc-output');
            const transforms = {
                base64: { e: s => btoa(unescape(encodeURIComponent(s))), d: s => decodeURIComponent(escape(atob(s))) },
                url: { e: encodeURIComponent, d: decodeURIComponent },
                html: {
                    e: s => s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]),
                    d: s => { const d = document.createElement('textarea'); d.innerHTML = s; return d.value; }
                }
            };
            function run(direction) {
                try { output.value = transforms[mode.value][direction](input.value); }
                catch (e) { output.value = `Error: ${e.message}`; }
            }
            container.querySelector('.enc-encode').addEventListener('click', () => run('e'));
            container.querySelector('.enc-decode').addEventListener('click', () => run('d'));
            return () => container.classList.remove('enc-widget');
        },
    },
    timestamps: {
        id: 'timestamps', name: 'Timestamps', icon: '⌚', category: 'Dev',
        sizes: ['small', 'tall'],
        render(container) {
            container.classList.add('ts-widget');
            container.innerHTML = `
                <div class="widget-label">
                    <span>Timestamps</span>
                    <button class="ts-now">Now</button>
                </div>
                <div class="ts-rows">
                    <div class="ts-row"><label>Unix s</label><input class="ts-unix" type="text" spellcheck="false"></div>
                    <div class="ts-row"><label>Unix ms</label><input class="ts-unixms" type="text" spellcheck="false"></div>
                    <div class="ts-row"><label>ISO</label><input class="ts-iso" type="text" spellcheck="false"></div>
                    <div class="ts-row"><label>Local</label><input class="ts-local" type="text" readonly></div>
                    <div class="ts-row"><label>Relative</label><input class="ts-rel" type="text" readonly></div>
                </div>`;
            const els = {
                unix:   container.querySelector('.ts-unix'),
                unixms: container.querySelector('.ts-unixms'),
                iso:    container.querySelector('.ts-iso'),
                local:  container.querySelector('.ts-local'),
                rel:    container.querySelector('.ts-rel'),
            };
            function update(date, src) {
                if (!date || isNaN(date.getTime())) return;
                if (src !== 'unix')   els.unix.value   = Math.floor(date.getTime() / 1000);
                if (src !== 'unixms') els.unixms.value = date.getTime();
                if (src !== 'iso')    els.iso.value    = date.toISOString();
                els.local.value = date.toLocaleString();
                const ms = Date.now() - date.getTime();
                const sec = Math.abs(ms / 1000);
                let s;
                if (sec < 60) s = `${Math.round(sec)}s`;
                else if (sec < 3600) s = `${Math.round(sec/60)}m`;
                else if (sec < 86400) s = `${Math.round(sec/3600)}h`;
                else s = `${Math.round(sec/86400)}d`;
                els.rel.value = ms > 0 ? `${s} ago` : `in ${s}`;
            }
            els.unix.addEventListener('input',   () => update(new Date(parseInt(els.unix.value) * 1000), 'unix'));
            els.unixms.addEventListener('input', () => update(new Date(parseInt(els.unixms.value)), 'unixms'));
            els.iso.addEventListener('input',    () => update(new Date(els.iso.value), 'iso'));
            container.querySelector('.ts-now').addEventListener('click', () => update(new Date()));
            update(new Date());
            return () => container.classList.remove('ts-widget');
        },
    },
    scratchpad: {
        id: 'scratchpad', name: 'Scratchpad (multi-tab editor)', icon: '⌨', category: 'Dev',
        sizes: ['tall', 'wide'],
        render(container) {
            container.classList.add('scratch-widget');
            container.innerHTML = `
                <div class="widget-label scratch-bar">
                    <div class="scratch-tabs"></div>
                    <div class="scratch-actions">
                        <button class="scratch-btn scratch-new" title="New tab">+</button>
                    </div>
                </div>
                <textarea class="scratch-area" placeholder="Start typing… (Tab indents)" spellcheck="false"></textarea>`;
            const tabs = container.querySelector('.scratch-tabs');
            const area = container.querySelector('.scratch-area');
            const newId = () => Math.random().toString(36).slice(2, 9);
            let state = { files: [], activeId: null };
            let saveTimer;
            const save = () => {
                clearTimeout(saveTimer);
                saveTimer = setTimeout(() => setStored('vipertab.scratchpad', state), 250);
            };
            const active = () => state.files.find(f => f.id === state.activeId) || state.files[0];
            function render() {
                tabs.innerHTML = '';
                state.files.forEach(f => {
                    const tab = document.createElement('div');
                    tab.className = 'scratch-tab' + (f.id === state.activeId ? ' active' : '');
                    const name = document.createElement('span');
                    name.className = 'scratch-tab-name';
                    name.textContent = f.name;
                    name.title = 'Double-click to rename';
                    name.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        const v = window.prompt('Rename tab:', f.name);
                        if (v !== null) { f.name = v.trim() || 'untitled'; save(); render(); }
                    });
                    const close = document.createElement('button');
                    close.className = 'scratch-tab-close';
                    close.textContent = '×';
                    close.title = 'Close';
                    close.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (state.files.length === 1) return;
                        const idx = state.files.findIndex(x => x.id === f.id);
                        state.files.splice(idx, 1);
                        if (state.activeId === f.id) state.activeId = state.files[Math.max(0, idx - 1)].id;
                        save(); render();
                    });
                    tab.append(name, close);
                    tab.addEventListener('click', () => { state.activeId = f.id; save(); render(); });
                    tabs.appendChild(tab);
                });
                const cur = active();
                area.value = cur ? cur.content : '';
            }
            (async () => {
                state = await getStored('vipertab.scratchpad', null) || { files: [], activeId: null };
                if (!state.files || state.files.length === 0) {
                    const f = { id: newId(), name: 'scratch.txt', content: '' };
                    state = { files: [f], activeId: f.id };
                }
                render();
            })();
            area.addEventListener('input', () => {
                const cur = active(); if (!cur) return;
                cur.content = area.value;
                save();
            });
            area.addEventListener('keydown', (e) => {
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const start = area.selectionStart, end = area.selectionEnd;
                    if (e.shiftKey) {
                        // Outdent: remove up to 2 leading spaces from each selected line
                        const before = area.value.slice(0, start);
                        const lineStart = before.lastIndexOf('\n') + 1;
                        const block = area.value.slice(lineStart, end);
                        const dedented = block.replace(/^(  ?)/gm, '');
                        area.value = area.value.slice(0, lineStart) + dedented + area.value.slice(end);
                        area.selectionStart = lineStart;
                        area.selectionEnd = lineStart + dedented.length;
                    } else {
                        area.value = area.value.slice(0, start) + '  ' + area.value.slice(end);
                        area.selectionStart = area.selectionEnd = start + 2;
                    }
                    const cur = active(); if (cur) { cur.content = area.value; save(); }
                }
            });
            container.querySelector('.scratch-new').addEventListener('click', () => {
                const f = { id: newId(), name: `scratch-${state.files.length + 1}.txt`, content: '' };
                state.files.push(f);
                state.activeId = f.id;
                save(); render();
                area.focus();
            });
            return () => container.classList.remove('scratch-widget');
        },
    },
    jwt: {
        id: 'jwt', name: 'JWT Decoder', icon: '🔓', category: 'Dev',
        sizes: ['small', 'tall'],
        render(container) {
            container.classList.add('jwt-widget');
            container.innerHTML = `
                <div class="widget-label"><span>JWT Decoder</span></div>
                <textarea class="jwt-input" placeholder="Paste JWT here…" spellcheck="false"></textarea>
                <div class="jwt-output"></div>`;
            const input = container.querySelector('.jwt-input');
            const output = container.querySelector('.jwt-output');
            function decode64url(s) {
                const pad = (4 - (s.length % 4)) % 4;
                const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
                return decodeURIComponent(escape(atob(b64)));
            }
            function setError(msg) {
                output.innerHTML = '';
                const div = document.createElement('div');
                div.className = 'jwt-error';
                div.textContent = msg;
                output.appendChild(div);
            }
            function addSection(title, json) {
                const sec = document.createElement('div'); sec.className = 'jwt-section';
                const lbl = document.createElement('div'); lbl.className = 'jwt-label'; lbl.textContent = title;
                const pre = document.createElement('pre'); pre.className = 'jwt-json';
                pre.textContent = JSON.stringify(json, null, 2);
                sec.append(lbl, pre);
                output.appendChild(sec);
            }
            function decode() {
                const v = input.value.trim();
                if (!v) { output.innerHTML = ''; return; }
                const parts = v.split('.');
                if (parts.length < 2) return setError('Not a JWT (need at least 2 dot-separated parts).');
                let header, payload;
                try { header = JSON.parse(decode64url(parts[0])); }
                catch (e) { return setError('Header decode error: ' + e.message); }
                try { payload = JSON.parse(decode64url(parts[1])); }
                catch (e) { return setError('Payload decode error: ' + e.message); }
                output.innerHTML = '';
                if (typeof payload.exp === 'number') {
                    const expMs = payload.exp * 1000;
                    const now = Date.now();
                    const expired = expMs < now;
                    const delta = Math.abs(expMs - now);
                    const days = Math.floor(delta / 86400000);
                    const hours = Math.floor((delta % 86400000) / 3600000);
                    const mins = Math.floor((delta % 3600000) / 60000);
                    const fmt = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                    const exp = document.createElement('div');
                    exp.className = 'jwt-exp ' + (expired ? 'jwt-expired' : 'jwt-valid');
                    exp.textContent = expired ? `⚠ Expired ${fmt} ago` : `✓ Expires in ${fmt}`;
                    output.appendChild(exp);
                }
                addSection('Header', header);
                addSection('Payload', payload);
                if (parts[2]) {
                    const sig = document.createElement('div'); sig.className = 'jwt-sig';
                    sig.textContent = `Signature present (${parts[2].length} chars) — verification requires the secret/key.`;
                    output.appendChild(sig);
                }
            }
            input.addEventListener('input', decode);
            return () => container.classList.remove('jwt-widget');
        },
    },
    hash: {
        id: 'hash', name: 'Hash Generator', icon: '#', category: 'Dev',
        sizes: ['small', 'tall'],
        render(container) {
            container.classList.add('hash-widget');
            container.innerHTML = `
                <div class="widget-label"><span>Hash Generator</span></div>
                <textarea class="hash-input" placeholder="Input text…" spellcheck="false"></textarea>
                <div class="hash-rows"></div>`;
            const input = container.querySelector('.hash-input');
            const rows = container.querySelector('.hash-rows');
            const algos = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
            const cells = {};
            algos.forEach(a => {
                const row = document.createElement('div'); row.className = 'hash-row';
                const lbl = document.createElement('div'); lbl.className = 'hash-algo'; lbl.textContent = a;
                const val = document.createElement('div'); val.className = 'hash-val'; val.textContent = '—'; val.title = 'Click to copy';
                val.addEventListener('click', () => {
                    if (val.textContent && val.textContent !== '—') navigator.clipboard?.writeText(val.textContent);
                });
                row.append(lbl, val);
                rows.appendChild(row);
                cells[a] = val;
            });
            const enc = new TextEncoder();
            const toHex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
            let token = 0;
            async function compute() {
                const v = input.value;
                if (!v) { algos.forEach(a => cells[a].textContent = '—'); return; }
                const my = ++token;
                const data = enc.encode(v);
                for (const a of algos) {
                    try {
                        const buf = await crypto.subtle.digest(a, data);
                        if (my !== token) return;
                        cells[a].textContent = toHex(buf);
                    } catch { cells[a].textContent = 'Error'; }
                }
            }
            input.addEventListener('input', compute);
            return () => container.classList.remove('hash-widget');
        },
    },
    diff: {
        id: 'diff', name: 'Diff Viewer', icon: '⇆', category: 'Dev',
        sizes: ['wide', 'tall'],
        render(container) {
            container.classList.add('diff-widget');
            container.innerHTML = `
                <div class="widget-label"><span>Diff</span></div>
                <div class="diff-inputs">
                    <textarea class="diff-a" placeholder="Original" spellcheck="false"></textarea>
                    <textarea class="diff-b" placeholder="Modified" spellcheck="false"></textarea>
                </div>
                <div class="diff-output"></div>`;
            const a = container.querySelector('.diff-a');
            const b = container.querySelector('.diff-b');
            const out = container.querySelector('.diff-output');
            // Line-based LCS diff
            function lineDiff(A, B) {
                const m = A.length, n = B.length;
                const lcs = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
                for (let i = 1; i <= m; i++) {
                    for (let j = 1; j <= n; j++) {
                        if (A[i-1] === B[j-1]) lcs[i][j] = lcs[i-1][j-1] + 1;
                        else lcs[i][j] = Math.max(lcs[i-1][j], lcs[i][j-1]);
                    }
                }
                const r = [];
                let i = m, j = n;
                while (i > 0 || j > 0) {
                    if (i > 0 && j > 0 && A[i-1] === B[j-1]) { r.unshift({ t: 'eq', l: A[i-1] }); i--; j--; }
                    else if (j > 0 && (i === 0 || lcs[i][j-1] >= lcs[i-1][j])) { r.unshift({ t: 'add', l: B[j-1] }); j--; }
                    else if (i > 0) { r.unshift({ t: 'del', l: A[i-1] }); i--; }
                }
                return r;
            }
            function update() {
                const linesA = a.value.split('\n');
                const linesB = b.value.split('\n');
                if (a.value === '' && b.value === '') { out.innerHTML = ''; return; }
                const d = lineDiff(linesA, linesB);
                out.innerHTML = '';
                const adds = d.filter(x => x.t === 'add').length;
                const dels = d.filter(x => x.t === 'del').length;
                const summary = document.createElement('div');
                summary.className = 'diff-summary';
                const ac = document.createElement('span'); ac.className = 'diff-add-count'; ac.textContent = `+${adds}`;
                const dc = document.createElement('span'); dc.className = 'diff-del-count'; dc.textContent = `−${dels}`;
                summary.append(ac, document.createTextNode('  '), dc);
                out.appendChild(summary);
                d.forEach(line => {
                    const div = document.createElement('div');
                    div.className = `diff-line diff-${line.t}`;
                    const sign = document.createElement('span'); sign.className = 'diff-sign';
                    sign.textContent = line.t === 'add' ? '+' : line.t === 'del' ? '−' : ' ';
                    const text = document.createElement('span'); text.className = 'diff-text';
                    text.textContent = line.l;
                    div.append(sign, text);
                    out.appendChild(div);
                });
            }
            a.addEventListener('input', update);
            b.addEventListener('input', update);
            return () => container.classList.remove('diff-widget');
        },
    },
    // ----- Student edition widgets ------------------------------------
    notebook: {
        id: 'notebook', name: 'Notebook (markdown + disk save)', icon: '📓', category: 'Productivity',
        sizes: ['tall', 'wide'],
        render(container) {
            container.classList.add('nb-widget');
            container.innerHTML = `
                <div class="widget-label nb-bar">
                    <span class="nb-status">Notebook</span>
                    <div class="nb-actions">
                        <button class="nb-btn nb-connect" title="Connect / change folder">📁</button>
                        <button class="nb-btn nb-new" title="New file">+</button>
                    </div>
                </div>
                <div class="nb-tabs"></div>
                <div class="nb-toolbar">
                    <button class="nb-tool" data-md="bold" title="Bold (Ctrl+B)"><b>B</b></button>
                    <button class="nb-tool" data-md="italic" title="Italic (Ctrl+I)"><i>I</i></button>
                    <button class="nb-tool" data-md="h1" title="Heading 1">H1</button>
                    <button class="nb-tool" data-md="h2" title="Heading 2">H2</button>
                    <button class="nb-tool" data-md="link" title="Link (Ctrl+K)">🔗</button>
                    <button class="nb-tool" data-md="list" title="Bullet list">•</button>
                    <button class="nb-tool" data-md="numlist" title="Numbered list">1.</button>
                    <button class="nb-tool" data-md="quote" title="Quote">&ldquo;</button>
                    <button class="nb-tool" data-md="code" title="Code">&lt;/&gt;</button>
                </div>
                <textarea class="nb-area" placeholder="Connect a folder (📁) — your notes will save as .md files on disk." spellcheck="false"></textarea>`;
            const tabsEl = container.querySelector('.nb-tabs');
            const toolbar = container.querySelector('.nb-toolbar');
            const area = container.querySelector('.nb-area');
            const status = container.querySelector('.nb-status');
            const connectBtn = container.querySelector('.nb-connect');
            const newBtn = container.querySelector('.nb-new');
            let dirHandle = null;
            let files = []; // { name, handle, content }
            let activeIdx = -1;
            let saveTimer = null;

            // ---- IndexedDB for FileSystemDirectoryHandle persistence ----
            const DB = 'vipertab-nb', STORE = 'h';
            const idbOpen = () => new Promise((res, rej) => {
                const req = indexedDB.open(DB, 1);
                req.onupgradeneeded = () => req.result.createObjectStore(STORE);
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });
            const idbGet = async (k) => {
                const db = await idbOpen();
                return new Promise((res, rej) => {
                    const r = db.transaction(STORE).objectStore(STORE).get(k);
                    r.onsuccess = () => res(r.result);
                    r.onerror = () => rej(r.error);
                });
            };
            const idbSet = async (k, v) => {
                const db = await idbOpen();
                return new Promise((res, rej) => {
                    const tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).put(v, k);
                    tx.oncomplete = () => res();
                    tx.onerror = () => rej(tx.error);
                });
            };

            async function ensurePerm(handle) {
                if (!handle.queryPermission) return true;
                const cur = await handle.queryPermission({ mode: 'readwrite' });
                if (cur === 'granted') return true;
                const req = await handle.requestPermission({ mode: 'readwrite' });
                return req === 'granted';
            }

            async function loadFolder() {
                files = [];
                for await (const entry of dirHandle.values()) {
                    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
                        const f = await entry.getFile();
                        files.push({ name: entry.name, handle: entry, content: await f.text() });
                    }
                }
                files.sort((a, b) => a.name.localeCompare(b.name));
                if (files.length === 0) {
                    const h = await dirHandle.getFileHandle('notes.md', { create: true });
                    files.push({ name: 'notes.md', handle: h, content: '' });
                }
                activeIdx = 0;
                render();
            }

            function render() {
                tabsEl.innerHTML = '';
                files.forEach((f, i) => {
                    const tab = document.createElement('div');
                    tab.className = 'nb-tab' + (i === activeIdx ? ' active' : '');
                    const name = document.createElement('span');
                    name.className = 'nb-tab-name';
                    name.textContent = f.name.replace(/\.md$/i, '');
                    tab.appendChild(name);
                    tab.title = f.name + ' — double-click to rename';
                    tab.addEventListener('click', () => { activeIdx = i; render(); });
                    tab.addEventListener('dblclick', async (e) => {
                        e.stopPropagation();
                        const proposed = window.prompt('Rename file:', f.name);
                        if (!proposed) return;
                        const newName = proposed.endsWith('.md') ? proposed : proposed + '.md';
                        if (newName === f.name) return;
                        try {
                            const newH = await dirHandle.getFileHandle(newName, { create: true });
                            const w = await newH.createWritable();
                            await w.write(f.content);
                            await w.close();
                            await dirHandle.removeEntry(f.name);
                            f.name = newName; f.handle = newH;
                            render();
                        } catch (err) { status.textContent = 'Rename failed'; }
                    });
                    tabsEl.appendChild(tab);
                });
                if (activeIdx >= 0 && files[activeIdx]) {
                    area.value = files[activeIdx].content;
                    area.disabled = false;
                    status.textContent = files[activeIdx].name;
                } else {
                    area.value = '';
                    area.disabled = true;
                    status.textContent = dirHandle ? 'No file' : 'No folder connected';
                }
            }

            async function tryReconnect() {
                const stored = await idbGet('dir');
                if (!stored) { status.textContent = 'Click 📁 to connect a folder'; return; }
                const ok = await ensurePerm(stored);
                if (!ok) { status.textContent = 'Tap 📁 to reconnect folder'; return; }
                dirHandle = stored;
                await loadFolder();
            }

            async function connect() {
                if (!window.showDirectoryPicker) {
                    status.textContent = 'Browser unsupported (need Chromium)';
                    return;
                }
                try {
                    const h = await window.showDirectoryPicker({ mode: 'readwrite' });
                    dirHandle = h;
                    await idbSet('dir', h);
                    await loadFolder();
                } catch { /* user cancelled */ }
            }

            connectBtn.addEventListener('click', connect);
            newBtn.addEventListener('click', async () => {
                if (!dirHandle) return connect();
                const proposed = window.prompt('New file name:', `note-${files.length + 1}`);
                if (!proposed) return;
                const name = proposed.endsWith('.md') ? proposed : proposed + '.md';
                const h = await dirHandle.getFileHandle(name, { create: true });
                files.push({ name, handle: h, content: '' });
                activeIdx = files.length - 1;
                render();
                area.focus();
            });

            function scheduleSave() {
                clearTimeout(saveTimer);
                saveTimer = setTimeout(async () => {
                    const f = files[activeIdx];
                    if (!f || !f.handle) return;
                    try {
                        const w = await f.handle.createWritable();
                        await w.write(f.content);
                        await w.close();
                        status.textContent = f.name;
                    } catch { status.textContent = 'Save error — reconnect folder'; }
                }, 250);
            }

            area.addEventListener('input', () => {
                if (activeIdx < 0 || !files[activeIdx]) return;
                files[activeIdx].content = area.value;
                scheduleSave();
            });

            function applyMd(action) {
                const start = area.selectionStart, end = area.selectionEnd;
                const before = area.value.slice(0, start);
                const sel = area.value.slice(start, end);
                const after = area.value.slice(end);
                let inserted = sel;
                let cursorOffset = 0;
                switch (action) {
                    case 'bold':    inserted = `**${sel || 'bold'}**`; break;
                    case 'italic':  inserted = `*${sel || 'italic'}*`; break;
                    case 'h1':      inserted = `# ${sel || 'Heading'}`; break;
                    case 'h2':      inserted = `## ${sel || 'Heading'}`; break;
                    case 'link':    inserted = `[${sel || 'text'}](url)`; cursorOffset = inserted.length - 4; break;
                    case 'list':    inserted = sel ? sel.split('\n').map(l => '- ' + l).join('\n') : '- '; break;
                    case 'numlist': inserted = sel ? sel.split('\n').map((l, i) => `${i + 1}. ${l}`).join('\n') : '1. '; break;
                    case 'quote':   inserted = sel ? sel.split('\n').map(l => '> ' + l).join('\n') : '> '; break;
                    case 'code':    inserted = sel.includes('\n') ? `\n\`\`\`\n${sel}\n\`\`\`\n` : `\`${sel || 'code'}\``; break;
                }
                area.value = before + inserted + after;
                if (cursorOffset) {
                    area.selectionStart = start + cursorOffset;
                    area.selectionEnd = start + cursorOffset + 3; // 'url'
                } else {
                    area.selectionStart = start;
                    area.selectionEnd = start + inserted.length;
                }
                area.focus();
                if (files[activeIdx]) { files[activeIdx].content = area.value; scheduleSave(); }
            }

            toolbar.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-md]');
                if (btn) applyMd(btn.dataset.md);
            });

            area.addEventListener('keydown', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    if (e.key.toLowerCase() === 'b') { e.preventDefault(); applyMd('bold'); return; }
                    if (e.key.toLowerCase() === 'i') { e.preventDefault(); applyMd('italic'); return; }
                    if (e.key.toLowerCase() === 'k') { e.preventDefault(); applyMd('link'); return; }
                }
                if (e.key === 'Tab' && !e.shiftKey) {
                    e.preventDefault();
                    const s = area.selectionStart, en = area.selectionEnd;
                    area.value = area.value.slice(0, s) + '  ' + area.value.slice(en);
                    area.selectionStart = area.selectionEnd = s + 2;
                    if (files[activeIdx]) { files[activeIdx].content = area.value; scheduleSave(); }
                }
            });

            tryReconnect();
            return () => { clearTimeout(saveTimer); container.classList.remove('nb-widget'); };
        },
    },
    schoollinks: {
        id: 'schoollinks', name: 'School Quick-Links', icon: '🏫', category: 'Web',
        sizes: ['small', 'tall', 'wide'],
        render(container) {
            container.classList.add('sl-widget');
            container.innerHTML = `
                <div class="widget-label">
                    <span>School Links</span>
                    <button class="sl-edit" title="Edit links">✎</button>
                </div>
                <div class="sl-grid"></div>`;
            const grid = container.querySelector('.sl-grid');
            const editBtn = container.querySelector('.sl-edit');
            const DEFAULTS = [
                { name: 'Docs',       url: 'https://docs.google.com',       cat: 'Class' },
                { name: 'Drive',      url: 'https://drive.google.com',      cat: 'Class' },
                { name: 'Classroom',  url: 'https://classroom.google.com',  cat: 'Class' },
                { name: 'Calendar',   url: 'https://calendar.google.com',   cat: 'Class' },
                { name: 'Gmail',      url: 'https://mail.google.com',       cat: 'Class' },
                { name: 'Wikipedia',  url: 'https://wikipedia.org',         cat: 'Research' },
                { name: 'Wolfram',    url: 'https://wolframalpha.com',      cat: 'Research' },
                { name: 'Scholar',    url: 'https://scholar.google.com',    cat: 'Research' },
                { name: 'Khan',       url: 'https://khanacademy.org',       cat: 'Study' },
                { name: 'Quizlet',    url: 'https://quizlet.com',           cat: 'Study' },
                { name: 'YouTube',    url: 'https://youtube.com',           cat: 'Study' },
                { name: 'ChatGPT',    url: 'https://chatgpt.com',           cat: 'Study' },
            ];
            let items = [];
            async function load() {
                items = await getStored('vipertab.schoollinks', DEFAULTS);
                render();
            }
            function favicon(url) {
                try {
                    const d = new URL(url).hostname;
                    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
                } catch { return ''; }
            }
            function render() {
                grid.innerHTML = '';
                const cats = [...new Set(items.map(i => i.cat || 'Other'))];
                cats.forEach(cat => {
                    const sec = document.createElement('div');
                    sec.className = 'sl-section';
                    const hd = document.createElement('div'); hd.className = 'sl-section-head'; hd.textContent = cat;
                    sec.appendChild(hd);
                    const row = document.createElement('div'); row.className = 'sl-row';
                    items.filter(i => (i.cat || 'Other') === cat).forEach(it => {
                        const a = document.createElement('a');
                        a.className = 'sl-link';
                        a.href = it.url; a.title = it.name;
                        const img = document.createElement('img');
                        img.src = favicon(it.url); img.alt = ''; img.loading = 'lazy';
                        img.addEventListener('error', () => {
                            const sp = document.createElement('span');
                            sp.className = 'sl-fallback';
                            sp.textContent = (it.name || '?').charAt(0).toUpperCase();
                            img.replaceWith(sp);
                        });
                        const lbl = document.createElement('span');
                        lbl.className = 'sl-link-name'; lbl.textContent = it.name;
                        a.append(img, lbl);
                        row.appendChild(a);
                    });
                    sec.appendChild(row);
                    grid.appendChild(sec);
                });
            }
            editBtn.addEventListener('click', async () => {
                const json = window.prompt(
                    'Edit school links (JSON array of {name, url, cat}). Cancel to leave unchanged.',
                    JSON.stringify(items, null, 2)
                );
                if (!json) return;
                try {
                    const next = JSON.parse(json);
                    if (Array.isArray(next)) {
                        items = next;
                        await setStored('vipertab.schoollinks', items);
                        render();
                    }
                } catch { window.alert('Invalid JSON — links unchanged.'); }
            });
            load();
            return () => container.classList.remove('sl-widget');
        },
    },
    duedates: {
        id: 'duedates', name: 'Due Dates', icon: '🗓', category: 'Productivity',
        sizes: ['small', 'tall', 'wide'],
        render(container) {
            container.classList.add('dd-widget');
            container.innerHTML = `
                <div class="widget-label">
                    <span>Due Dates</span>
                    <div class="dd-nav">
                        <button class="dd-prev" title="Previous month">‹</button>
                        <span class="dd-month"></span>
                        <button class="dd-next" title="Next month">›</button>
                    </div>
                </div>
                <div class="dd-grid"></div>
                <div class="dd-list"></div>`;
            const grid = container.querySelector('.dd-grid');
            const list = container.querySelector('.dd-list');
            const monthEl = container.querySelector('.dd-month');
            const prev = container.querySelector('.dd-prev');
            const next = container.querySelector('.dd-next');
            const today = new Date();
            let view = new Date(today.getFullYear(), today.getMonth(), 1);
            let events = {}; // 'YYYY-MM-DD' -> [{ text }]
            const key = (d) => d.toISOString().slice(0, 10);
            const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

            async function load() {
                events = await getStored('vipertab.duedates', {});
                render();
            }

            function render() {
                monthEl.textContent = view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                grid.innerHTML = '';
                const head = ['S','M','T','W','T','F','S'];
                head.forEach(h => {
                    const c = document.createElement('div'); c.className = 'dd-cell dd-head'; c.textContent = h; grid.appendChild(c);
                });
                const first = new Date(view.getFullYear(), view.getMonth(), 1);
                const startWd = first.getDay();
                const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
                for (let i = 0; i < startWd; i++) {
                    const e = document.createElement('div'); e.className = 'dd-cell dd-empty'; grid.appendChild(e);
                }
                for (let d = 1; d <= daysInMonth; d++) {
                    const date = new Date(view.getFullYear(), view.getMonth(), d);
                    const k = key(date);
                    const cell = document.createElement('div');
                    cell.className = 'dd-cell dd-day';
                    if (sameDay(date, today)) cell.classList.add('dd-today');
                    if (events[k]?.length) cell.classList.add('dd-has');
                    cell.textContent = d;
                    cell.title = (events[k] || []).map(e => e.text).join('\n') || 'Click to add an entry';
                    cell.addEventListener('click', async () => {
                        const text = window.prompt(`Add entry for ${date.toLocaleDateString()}:`);
                        if (text == null) return;
                        const trimmed = text.trim();
                        if (!trimmed) return;
                        events[k] = events[k] || [];
                        events[k].push({ text: trimmed });
                        await setStored('vipertab.duedates', events);
                        render();
                    });
                    grid.appendChild(cell);
                }
                // Upcoming list
                list.innerHTML = '';
                const upcoming = Object.keys(events)
                    .filter(k => new Date(k) >= new Date(today.toDateString()))
                    .sort()
                    .slice(0, 6);
                upcoming.forEach(k => {
                    (events[k] || []).forEach((ev, i) => {
                        const li = document.createElement('div');
                        li.className = 'dd-event';
                        const dt = document.createElement('span'); dt.className = 'dd-event-date';
                        dt.textContent = new Date(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        const tx = document.createElement('span'); tx.className = 'dd-event-text'; tx.textContent = ev.text;
                        const x = document.createElement('button'); x.className = 'dd-event-x'; x.textContent = '×';
                        x.addEventListener('click', async () => {
                            events[k].splice(i, 1);
                            if (!events[k].length) delete events[k];
                            await setStored('vipertab.duedates', events);
                            render();
                        });
                        li.append(dt, tx, x);
                        list.appendChild(li);
                    });
                });
            }
            prev.addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); render(); });
            next.addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); render(); });
            load();
            return () => container.classList.remove('dd-widget');
        },
    },
    gpa: {
        id: 'gpa', name: 'GPA Calculator', icon: '🎯', category: 'Productivity',
        sizes: ['small', 'tall'],
        render(container) {
            container.classList.add('gpa-widget');
            container.innerHTML = `
                <div class="widget-label">
                    <span>GPA</span>
                    <div class="gpa-summary"><span class="gpa-val gpa-w">—</span><span class="gpa-sub">weighted</span><span class="gpa-val gpa-u">—</span><span class="gpa-sub">unweighted</span></div>
                </div>
                <div class="gpa-rows"></div>
                <button class="gpa-add">+ Add course</button>`;
            const rows = container.querySelector('.gpa-rows');
            const addBtn = container.querySelector('.gpa-add');
            const valW = container.querySelector('.gpa-w');
            const valU = container.querySelector('.gpa-u');
            const GRADES = { 'A+': 4.3, 'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7, 'C+': 2.3, 'C': 2.0, 'C-': 1.7, 'D+': 1.3, 'D': 1.0, 'D-': 0.7, 'F': 0 };
            const TYPE_BONUS = { 'Reg': 0, 'Hon': 0.5, 'AP': 1.0, 'IB': 1.0 };
            let courses = [];
            async function load() { courses = await getStored('vipertab.gpa', []); render(); }
            function compute() {
                let totalW = 0, totalU = 0, credits = 0;
                courses.forEach(c => {
                    const g = GRADES[c.grade];
                    if (g == null) return;
                    const cr = parseFloat(c.credits) || 1;
                    totalU += g * cr;
                    totalW += (g + (TYPE_BONUS[c.type] || 0)) * cr;
                    credits += cr;
                });
                if (credits === 0) return { w: '—', u: '—' };
                return { w: (totalW / credits).toFixed(2), u: (totalU / credits).toFixed(2) };
            }
            function render() {
                rows.innerHTML = '';
                courses.forEach((c, i) => {
                    const row = document.createElement('div'); row.className = 'gpa-row';
                    const name = document.createElement('input'); name.type = 'text'; name.placeholder = 'Course'; name.value = c.name || ''; name.className = 'gpa-name';
                    name.addEventListener('input', async () => { c.name = name.value; await setStored('vipertab.gpa', courses); });
                    const grade = document.createElement('select'); grade.className = 'gpa-grade';
                    Object.keys(GRADES).forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = g; grade.appendChild(o); });
                    grade.value = c.grade || 'A';
                    grade.addEventListener('change', async () => { c.grade = grade.value; await setStored('vipertab.gpa', courses); update(); });
                    const type = document.createElement('select'); type.className = 'gpa-type';
                    Object.keys(TYPE_BONUS).forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; type.appendChild(o); });
                    type.value = c.type || 'Reg';
                    type.addEventListener('change', async () => { c.type = type.value; await setStored('vipertab.gpa', courses); update(); });
                    const credits = document.createElement('input'); credits.type = 'number'; credits.min = '0'; credits.step = '0.5'; credits.value = c.credits || 1; credits.className = 'gpa-credits';
                    credits.addEventListener('input', async () => { c.credits = credits.value; await setStored('vipertab.gpa', courses); update(); });
                    const x = document.createElement('button'); x.className = 'gpa-x'; x.textContent = '×';
                    x.addEventListener('click', async () => { courses.splice(i, 1); await setStored('vipertab.gpa', courses); render(); });
                    row.append(name, grade, type, credits, x);
                    rows.appendChild(row);
                });
                update();
            }
            function update() {
                const r = compute();
                valW.textContent = r.w;
                valU.textContent = r.u;
            }
            addBtn.addEventListener('click', async () => {
                courses.push({ name: '', grade: 'A', type: 'Reg', credits: 1 });
                await setStored('vipertab.gpa', courses);
                render();
            });
            load();
            return () => container.classList.remove('gpa-widget');
        },
    },
    photos: {
        id: 'photos', name: 'Photo Search', icon: '🖼', category: 'Productivity',
        sizes: ['small', 'tall', 'wide'],
        render(container) {
            container.classList.add('photos-widget');
            container.innerHTML = `
                <div class="widget-label">
                    <span>Photo Search</span>
                    <button class="photos-settings" title="API key settings">⚙</button>
                </div>
                <form class="photos-search">
                    <input type="text" class="photos-input" placeholder="Search photos…" spellcheck="false">
                </form>
                <div class="photos-grid"></div>
                <div class="photos-setup">
                    <p>Free Pixabay API key needed (one-time, ~30 seconds):</p>
                    <ol>
                        <li>Sign in at <a href="https://pixabay.com/accounts/register/" target="_blank" rel="noopener">pixabay.com</a></li>
                        <li>Copy the key shown on the <a href="https://pixabay.com/api/docs/" target="_blank" rel="noopener">API docs page</a></li>
                        <li>Paste it below — saved locally, never sent anywhere else.</li>
                    </ol>
                    <input type="text" class="photos-key" placeholder="Paste your Pixabay key" spellcheck="false">
                    <button type="button" class="photos-save-key">Save key</button>
                </div>`;
            const settingsBtn = container.querySelector('.photos-settings');
            const searchForm  = container.querySelector('.photos-search');
            const searchInput = container.querySelector('.photos-input');
            const grid        = container.querySelector('.photos-grid');
            const setup       = container.querySelector('.photos-setup');
            const keyInput    = container.querySelector('.photos-key');
            const saveKeyBtn  = container.querySelector('.photos-save-key');

            let apiKey = null;

            const showSearch = () => {
                searchForm.style.display = '';
                grid.style.display = '';
                setup.style.display = 'none';
            };
            const showSetup = () => {
                searchForm.style.display = 'none';
                grid.style.display = 'none';
                setup.style.display = '';
            };

            async function load() {
                apiKey = await getStored('vipertab.pixabayKey', null);
                if (apiKey) showSearch(); else showSetup();
            }

            async function search(query) {
                if (!apiKey) return;
                grid.innerHTML = '<div class="photos-status">Searching…</div>';
                try {
                    const url = `https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&image_type=photo&safesearch=true&per_page=24`;
                    const r = await fetch(url);
                    if (!r.ok) {
                        if (r.status === 400) throw new Error('Invalid API key. Replace it via ⚙.');
                        if (r.status === 429) throw new Error('Rate limit reached — wait a minute.');
                        throw new Error('API error ' + r.status);
                    }
                    const d = await r.json();
                    grid.innerHTML = '';
                    if (!d.hits || d.hits.length === 0) {
                        grid.innerHTML = '<div class="photos-status">No results</div>';
                        return;
                    }
                    d.hits.forEach(hit => {
                        const item = document.createElement('a');
                        item.className = 'photo-item';
                        item.href = hit.largeImageURL || hit.webformatURL;
                        item.target = '_blank';
                        item.rel = 'noopener noreferrer';
                        item.title = `${hit.tags}\nClick: open full size · ${hit.user ? 'by ' + hit.user : ''}`;
                        const img = document.createElement('img');
                        img.src = hit.previewURL;
                        img.alt = hit.tags || '';
                        img.loading = 'lazy';
                        img.referrerPolicy = 'no-referrer';
                        item.appendChild(img);
                        // Right-click → copy URL
                        item.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            navigator.clipboard?.writeText(hit.largeImageURL || hit.webformatURL);
                            item.classList.add('copied');
                            setTimeout(() => item.classList.remove('copied'), 600);
                        });
                        grid.appendChild(item);
                    });
                } catch (e) {
                    grid.innerHTML = '';
                    const err = document.createElement('div');
                    err.className = 'photos-status photos-error';
                    err.textContent = e.message || 'Search failed';
                    grid.appendChild(err);
                }
            }

            searchForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const q = searchInput.value.trim();
                if (q) search(q);
            });

            saveKeyBtn.addEventListener('click', async () => {
                const k = keyInput.value.trim();
                if (!k) return;
                apiKey = k;
                await setStored('vipertab.pixabayKey', k);
                showSearch();
                searchInput.focus();
            });
            keyInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); saveKeyBtn.click(); }
            });

            settingsBtn.addEventListener('click', async () => {
                const masked = apiKey ? apiKey.slice(0, 4) + '…' + apiKey.slice(-4) : '(not set)';
                const next = window.prompt(
                    `Pixabay API key\nCurrent: ${masked}\n\nPaste a new key, type "remove" to clear, or Cancel to keep.`
                );
                if (next == null) return;
                if (next.trim().toLowerCase() === 'remove') {
                    apiKey = null;
                    await setStored('vipertab.pixabayKey', null);
                    showSetup();
                } else if (next.trim()) {
                    apiKey = next.trim();
                    await setStored('vipertab.pixabayKey', apiKey);
                    showSearch();
                }
            });

            load();
            return () => container.classList.remove('photos-widget');
        },
    },

    uuid: {
        id: 'uuid', name: 'UUID Generator', icon: '#', category: 'Dev',
        sizes: ['small'],
        render(container) {
            container.classList.add('uuid-widget');
            container.innerHTML = `
                <div class="widget-label"><span>UUID v4</span></div>
                <div class="uuid-display"></div>
                <div class="uuid-buttons">
                    <button class="uuid-btn uuid-new">Generate</button>
                    <button class="uuid-btn uuid-copy">Copy</button>
                </div>
                <ul class="uuid-history"></ul>`;
            const display = container.querySelector('.uuid-display');
            const history = container.querySelector('.uuid-history');
            const past = [];
            function gen() {
                const v = (crypto.randomUUID && crypto.randomUUID()) || fallbackUuid();
                if (display.textContent) past.unshift(display.textContent);
                if (past.length > 5) past.pop();
                display.textContent = v;
                history.innerHTML = '';
                past.forEach(p => {
                    const li = document.createElement('li');
                    li.textContent = p;
                    li.addEventListener('click', () => navigator.clipboard?.writeText(p));
                    history.appendChild(li);
                });
            }
            function fallbackUuid() {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                    const r = Math.random() * 16 | 0;
                    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
                });
            }
            container.querySelector('.uuid-new').addEventListener('click', gen);
            container.querySelector('.uuid-copy').addEventListener('click', () => {
                navigator.clipboard?.writeText(display.textContent);
            });
            gen();
            return () => container.classList.remove('uuid-widget');
        },
    },
};

// ---------------------------------------------------------------------------
// Visualizer drawing helpers (top-level, stateless)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Smart palette — samples the captured tab's video frame and feeds dominant
// colors into the visualizer. Module-scope state so PALETTES.smart can read it.
// ---------------------------------------------------------------------------
let smartVideoEl = null;
let smartCanvas = null;
let smartCtx = null;
let smartTarget = null;   // [[h,s,l], ...] from latest sample
let smartCurrent = null;  // smoothly-lerped toward target each draw frame

function setupSmartVideo() {
    if (smartVideoEl) return;
    smartVideoEl = document.createElement('video');
    smartVideoEl.muted = true;
    smartVideoEl.playsInline = true;
    smartVideoEl.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:160px;height:90px;pointer-events:none;';
    document.body.appendChild(smartVideoEl);
    smartCanvas = document.createElement('canvas');
    smartCanvas.width = 80;
    smartCanvas.height = 45;
    smartCtx = smartCanvas.getContext('2d', { willReadFrequently: true });
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s; const l = (max + min) / 2;
    if (max === min) { h = 0; s = 0; }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if      (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else                h = (r - g) / d + 4;
        h *= 60;
    }
    return [h, s, l];
}

function lerpHue(a, b, t) {
    const diff = ((b - a + 540) % 360) - 180;
    return (a + diff * t + 360) % 360;
}

function extractDominantColors(rgba) {
    const buckets = new Map();
    for (let i = 0; i < rgba.length; i += 16) { // every 4th pixel
        const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
        const [h, s, l] = rgbToHsl(r, g, b);
        if (s < 0.18) continue;          // skip near-grays
        if (l < 0.12 || l > 0.88) continue; // skip near-black / near-white
        const bucket = Math.floor(h / 24); // 15 hue buckets
        const cur = buckets.get(bucket) || { count: 0, s: 0, l: 0 };
        cur.count++; cur.s += s; cur.l += l;
        buckets.set(bucket, cur);
    }
    if (buckets.size === 0) return null;
    return [...buckets.entries()]
        .map(([b, v]) => ({
            h: b * 24 + 12,
            s: Math.min(85, (v.s / v.count) * 100),
            l: Math.max(45, Math.min(65, (v.l / v.count) * 100)),
            count: v.count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map(x => [x.h, x.s, x.l]);
}

function sampleSmartColors() {
    if (!smartVideoEl || !smartVideoEl.videoWidth) return;
    try {
        smartCtx.drawImage(smartVideoEl, 0, 0, smartCanvas.width, smartCanvas.height);
        const data = smartCtx.getImageData(0, 0, smartCanvas.width, smartCanvas.height).data;
        const colors = extractDominantColors(data);
        if (colors && colors.length) smartTarget = colors;
    } catch { /* ignore (e.g. tainted canvas) */ }
}

function updateSmartCurrent() {
    if (!smartTarget) return;
    if (!smartCurrent) { smartCurrent = smartTarget.map(c => [...c]); return; }
    while (smartCurrent.length < smartTarget.length) smartCurrent.push([...smartTarget[smartCurrent.length]]);
    while (smartCurrent.length > smartTarget.length) smartCurrent.pop();
    const RATE = 0.05;
    for (let i = 0; i < smartCurrent.length; i++) {
        smartCurrent[i][0] = lerpHue(smartCurrent[i][0], smartTarget[i][0], RATE);
        smartCurrent[i][1] += (smartTarget[i][1] - smartCurrent[i][1]) * RATE;
        smartCurrent[i][2] += (smartTarget[i][2] - smartCurrent[i][2]) * RATE;
    }
}

const PALETTES = {
    aurora:  (i, n) => [200 + (i / n) * 140, 85, 65],
    ocean:   (i, n) => [180 + (i / n) * 60,  78, 58],
    fire:    (i, n) => [(i / n) * 50,         92, 55],
    forest:  (i, n) => [100 + (i / n) * 80,  72, 52],
    rainbow: (i, n) => [(i / n) * 360,        82, 60],
    mono:    () => [0, 0, 88],
    smart:   (i, n) => {
        if (!smartCurrent || smartCurrent.length === 0) {
            // Fallback while we wait for the first sample (or if no video shared)
            return [220, 35, 75];
        }
        const len = smartCurrent.length;
        const t = (i / n) * len;
        const idx = Math.floor(t) % len;
        const next = (idx + 1) % len;
        const f = t - Math.floor(t);
        const a = smartCurrent[idx];
        const b = smartCurrent[next];
        return [lerpHue(a[0], b[0], f), a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    },
};
const paletteColor = (name, i, n, alpha) => {
    const [h, s, l] = (PALETTES[name] || PALETTES.aurora)(i, n);
    return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
};
function drawBars(ctx, freq, W, H, palette) {
    const BARS = 64, usable = Math.floor(freq.length * 0.7);
    const step = Math.max(1, Math.floor(usable / BARS));
    const slot = W / BARS, gap = 2, barW = Math.max(1, slot - gap);
    const radius = Math.min(barW / 2, 5);
    for (let i = 0; i < BARS; i++) {
        const v = Math.pow(freq[i * step] / 255, 1.4);
        const h = Math.max(2, v * H * 0.95);
        const x = i * slot + gap / 2, y = H - h;
        const grad = ctx.createLinearGradient(0, y, 0, H);
        grad.addColorStop(0, paletteColor(palette, i, BARS, 0.95));
        grad.addColorStop(1, paletteColor(palette, i, BARS, 0.35));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x, H); ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.lineTo(x + barW - radius, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
        ctx.lineTo(x + barW, H);
        ctx.closePath(); ctx.fill();
    }
}
function drawMirror(ctx, freq, W, H, palette) {
    const BARS = 64, cy = H / 2, usable = Math.floor(freq.length * 0.7);
    const step = Math.max(1, Math.floor(usable / BARS));
    const slot = W / BARS, gap = 2, barW = Math.max(1, slot - gap);
    const radius = Math.min(barW / 2, 5);
    for (let i = 0; i < BARS; i++) {
        const v = Math.pow(freq[i * step] / 255, 1.3);
        const h = Math.max(1, v * H * 0.45);
        const x = i * slot + gap / 2, y = cy - h;
        const grad = ctx.createLinearGradient(0, y, 0, cy + h);
        grad.addColorStop(0,    paletteColor(palette, i, BARS, 0.55));
        grad.addColorStop(0.5,  paletteColor(palette, i, BARS, 0.95));
        grad.addColorStop(1,    paletteColor(palette, i, BARS, 0.55));
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.lineTo(x + barW - radius, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
        ctx.lineTo(x + barW, cy); ctx.closePath(); ctx.fill();
        const yb = cy + h;
        ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x, yb - radius);
        ctx.quadraticCurveTo(x, yb, x + radius, yb);
        ctx.lineTo(x + barW - radius, yb);
        ctx.quadraticCurveTo(x + barW, yb, x + barW, yb - radius);
        ctx.lineTo(x + barW, cy); ctx.closePath(); ctx.fill();
    }
}
function drawWave(ctx, time, W, H, palette) {
    const N = time.length;
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0,   paletteColor(palette, 0, 4, 0.95));
    grad.addColorStop(0.5, paletteColor(palette, 2, 4, 0.95));
    grad.addColorStop(1,   paletteColor(palette, 3, 4, 0.95));
    ctx.strokeStyle = grad;
    ctx.shadowColor = paletteColor(palette, 1, 4, 0.6);
    ctx.shadowBlur = 12;
    ctx.beginPath();
    const slice = W / N;
    for (let i = 0; i < N; i++) {
        const v = (time[i] - 128) / 128;
        const x = i * slice, y = H / 2 + v * H / 2 * 0.85;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
}
function drawCircle(ctx, freq, W, H, palette) {
    const cx = W / 2, cy = H / 2;
    const baseR = Math.min(W, H) * 0.18;
    const maxLen = Math.min(W, H) * 0.32;
    const BARS = 96, usable = Math.floor(freq.length * 0.75);
    const step = Math.max(1, Math.floor(usable / BARS));
    ctx.lineCap = 'round';
    for (let i = 0; i < BARS; i++) {
        const v = Math.pow(freq[i * step] / 255, 1.3);
        const len = Math.max(2, v * maxLen);
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const x1 = cx + Math.cos(a) * baseR, y1 = cy + Math.sin(a) * baseR;
        const x2 = cx + Math.cos(a) * (baseR + len), y2 = cy + Math.sin(a) * (baseR + len);
        ctx.strokeStyle = paletteColor(palette, i, BARS, 0.92);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.strokeStyle = paletteColor(palette, BARS / 2, BARS, 0.35);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, baseR - 4, 0, Math.PI * 2); ctx.stroke();
}

// ---------------------------------------------------------------------------
// Slot system
// ---------------------------------------------------------------------------
const SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8'];
const SLOT_SIZES = {
    slot1: 'small', slot2: 'small', slot3: 'small',
    slot5: 'small', slot6: 'small', slot7: 'small',
    slot4: 'tall', slot8: 'wide',
};
const SLOT_NAMES = {
    slot1: 'Top Left',     slot2: 'Top Center',  slot3: 'Top Right',
    slot4: 'Tall Right',
    slot5: 'Middle Left',  slot6: 'Middle Mid',  slot7: 'Middle Right',
    slot8: 'Wide Bottom',
};
const DEFAULT_LAYOUT_MAIN = {
    slot1: 'clock', slot2: 'weather', slot3: 'status', slot4: 'calculator',
    slot5: 'notes', slot6: 'recent',  slot7: 'worldclocks', slot8: 'visualizer',
};
const DEFAULT_LAYOUT_DEV = {
    slot1: 'hackernews', slot2: 'timestamps', slot3: 'uuid', slot4: 'scratchpad',
    slot5: 'encoder', slot6: 'jwt', slot7: 'hash', slot8: 'diff',
};
const DEFAULT_LAYOUT_STUDENT = {
    slot1: 'schoollinks', slot2: 'duedates', slot3: 'pomodoro', slot4: 'notebook',
    slot5: 'todo', slot6: 'gpa', slot7: 'quote', slot8: 'photos',
};

// Widget pools per edition — strictly enforced. Widgets not in the current
// edition's pool are hidden from the picker and replaced by the edition's
// default if they appear in a saved layout.
const WIDGET_EDITIONS = {
    // Main / Zen general pool
    clock:       ['main', 'zen'],
    weather:     ['main', 'zen'],
    status:      ['main', 'zen'],
    notes:       ['main', 'zen'],
    calculator:  ['main', 'zen'],
    worldclocks: ['main', 'zen'],
    recent:      ['main', 'zen'],
    visualizer:  ['main', 'zen'],
    crypto:      ['main', 'zen'],
    quote:       ['main', 'student', 'zen'],
    apod:        ['main', 'zen'],
    stopwatch:   ['main', 'zen'],
    dice:        ['main', 'zen'],
    search:      ['main', 'zen'],
    // Productivity essentials — also available to Student so they aren't forced
    // to install Main for a focus timer / to-do list.
    pomodoro:    ['main', 'student', 'zen'],
    todo:        ['main', 'student', 'zen'],
    // Dev specialty
    hackernews: ['dev'],
    regex:      ['dev'],
    json:       ['dev'],
    encoder:    ['dev'],
    timestamps: ['dev'],
    uuid:       ['dev'],
    scratchpad: ['dev'],
    jwt:        ['dev'],
    hash:       ['dev'],
    diff:       ['dev'],
    // Student specialty
    notebook:    ['student'],
    schoollinks: ['student'],
    duedates:    ['student'],
    gpa:         ['student'],
    photos:      ['student'],
};

function isWidgetAllowedInEdition(widgetId, edition) {
    const allowed = WIDGET_EDITIONS[widgetId];
    if (!allowed) return true; // unflagged widgets default to "available everywhere"
    return allowed.includes(edition);
}
// Zen: only the clock slot and one optional secondary slot are rendered.
// CSS reshapes the grid so the clock takes most of the screen and the secondary
// sits below it.
const DEFAULT_LAYOUT_ZEN = {
    slot4: 'clock',
    slot7: 'weather',
};
const DEFAULT_LAYOUT = IS_DEV_EDITION ? DEFAULT_LAYOUT_DEV
    : IS_STUDENT_EDITION ? DEFAULT_LAYOUT_STUDENT
    : IS_ZEN_EDITION ? DEFAULT_LAYOUT_ZEN
    : DEFAULT_LAYOUT_MAIN;

// Which slots actually render per edition (others stay empty + CSS-hidden)
const ACTIVE_SLOTS = {
    main:    ['slot1','slot2','slot3','slot4','slot5','slot6','slot7','slot8'],
    dev:     ['slot1','slot2','slot3','slot4','slot5','slot6','slot7','slot8'],
    student: ['slot1','slot2','slot3','slot4','slot5','slot6','slot7','slot8'],
    zen:     ['slot4', 'slot7'],
};

const activeWidgets = {};   // slotId -> destroy fn

function renderSlot(slotId, widgetId) {
    const container = document.querySelector(`[data-slot="${slotId}"]`);
    if (!container) return;
    if (activeWidgets[slotId]) { try { activeWidgets[slotId](); } catch {} delete activeWidgets[slotId]; }
    container.innerHTML = '';
    container.className = 'widget';
    container.dataset.slot = slotId;
    container.dataset.widget = widgetId;
    let widget = WIDGET_LIBRARY[widgetId];
    const size = SLOT_SIZES[slotId];
    // Reject if missing, doesn't fit the slot size, or isn't allowed in this edition.
    const valid = widget && widget.sizes.includes(size) && isWidgetAllowedInEdition(widgetId, EDITION_ID);
    if (!valid) {
        const fallbackId = DEFAULT_LAYOUT[slotId] || DEFAULT_LAYOUT_MAIN[slotId];
        widget = WIDGET_LIBRARY[fallbackId];
        if (!widget) return;
        container.dataset.widget = widget.id;
    }
    activeWidgets[slotId] = widget.render(container, size) || (() => {});
}

async function renderLayout() {
    const layout = await getStored('vipertab.layout', DEFAULT_LAYOUT);
    const active = ACTIVE_SLOTS[EDITION_ID] || SLOTS;
    SLOTS.forEach(slotId => {
        const container = document.querySelector(`[data-slot="${slotId}"]`);
        if (!container) return;
        if (!active.includes(slotId)) {
            // Slot not active in this edition — don't render anything
            if (activeWidgets[slotId]) { try { activeWidgets[slotId](); } catch {} delete activeWidgets[slotId]; }
            container.innerHTML = '';
            container.classList.add('slot-inactive');
            return;
        }
        container.classList.remove('slot-inactive');
        const widgetId = layout[slotId] || DEFAULT_LAYOUT[slotId] || DEFAULT_LAYOUT_MAIN[slotId];
        renderSlot(slotId, widgetId);
    });
}

async function changeSlot(slotId, widgetId) {
    const layout = await getStored('vipertab.layout', { ...DEFAULT_LAYOUT });
    layout[slotId] = widgetId;
    await setStored('vipertab.layout', layout);
    renderSlot(slotId, widgetId);
    renderWidgetPicker();
}

async function renderWidgetPicker() {
    const grid = $('widget-picker');
    if (!grid) return;
    const layout = await getStored('vipertab.layout', { ...DEFAULT_LAYOUT });
    grid.innerHTML = '';
    SLOTS.forEach(slotId => {
        const size = SLOT_SIZES[slotId];
        const current = layout[slotId] || DEFAULT_LAYOUT[slotId];
        const row = document.createElement('div');
        row.className = 'slot-row';
        const sizeBadge = size === 'tall' ? '▌' : size === 'wide' ? '▬' : '◻';
        const label = document.createElement('div');
        label.className = 'slot-info';
        const lname = document.createElement('div');
        lname.className = 'slot-name';
        lname.textContent = `${sizeBadge} ${SLOT_NAMES[slotId]}`;
        label.appendChild(lname);
        const select = document.createElement('select');
        select.className = 'slot-select';
        select.dataset.slot = slotId;
        Object.values(WIDGET_LIBRARY)
            .filter(w => w.sizes.includes(size))
            .filter(w => isWidgetAllowedInEdition(w.id, EDITION_ID))
            .forEach(w => {
                const opt = document.createElement('option');
                opt.value = w.id;
                opt.textContent = `${w.icon}  ${w.name}`;
                if (w.id === current) opt.selected = true;
                select.appendChild(opt);
            });
        select.addEventListener('change', () => changeSlot(slotId, select.value));
        label.appendChild(select);
        row.appendChild(label);
        grid.appendChild(row);
    });
}

// ---------------------------------------------------------------------------
// Dock
// ---------------------------------------------------------------------------
const DEFAULT_DOCK = [
    { name: 'Gmail',    url: 'https://mail.google.com' },
    { name: 'Calendar', url: 'https://calendar.google.com' },
    { name: 'Drive',    url: 'https://drive.google.com' },
    { name: 'GitHub',   url: 'https://github.com' },
    { name: 'ChatGPT',  url: 'https://chatgpt.com' },
    { name: 'YouTube',  url: 'https://youtube.com' },
    { name: 'Maps',     url: 'https://maps.google.com' },
];

function buildDockIcon(item) {
    if (item.icon && /^https?:\/\//i.test(item.icon)) {
        const img = document.createElement('img');
        img.src = item.icon; img.alt = item.name || ''; img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        return img;
    }
    if (item.icon && item.icon.trim()) {
        const span = document.createElement('span');
        span.className = 'dock-emoji'; span.textContent = item.icon;
        return span;
    }
    const domain = domainOf(item.url);
    if (domain) {
        const img = document.createElement('img');
        img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
        img.alt = item.name || domain; img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => {
            const fb = document.createElement('span');
            fb.className = 'dock-emoji';
            fb.textContent = (item.name || domain || '?').charAt(0).toUpperCase();
            img.replaceWith(fb);
        });
        return img;
    }
    const span = document.createElement('span');
    span.className = 'dock-emoji'; span.textContent = '🔗';
    return span;
}

async function renderDock() {
    const items = await getStored('vipertab.dock', DEFAULT_DOCK);
    const dock = $('dock');
    dock.innerHTML = '';
    items.forEach(it => {
        const a = document.createElement('a');
        a.className = 'dock-item';
        a.href = it.url; a.title = it.name;
        a.appendChild(buildDockIcon(it));
        dock.appendChild(a);
    });
    if (items.length) {
        const div = document.createElement('div');
        div.className = 'dock-divider';
        dock.appendChild(div);
    }
    const cog = document.createElement('button');
    cog.className = 'dock-item';
    cog.title = 'Settings';
    cog.textContent = '⚙️';
    cog.addEventListener('click', toggleSettings);
    dock.appendChild(cog);
}

async function renderDockEditor() {
    const items = await getStored('vipertab.dock', DEFAULT_DOCK);
    const editor = $('dock-editor');
    editor.innerHTML = '';
    const updateAt = async (i, patch) => {
        items[i] = { ...items[i], ...patch };
        await setStored('vipertab.dock', items);
        renderDock();
    };
    items.forEach((it, i) => {
        const row = document.createElement('li');
        row.className = 'dock-row';
        const ico = document.createElement('input');
        ico.className = 'icon-input';
        ico.value = it.icon || '';
        ico.placeholder = 'auto';
        ico.title = 'Optional: emoji or image URL';
        ico.addEventListener('change', () => updateAt(i, { icon: ico.value }));
        const nm = document.createElement('input');
        nm.className = 'name-input'; nm.value = it.name; nm.placeholder = 'Name';
        nm.addEventListener('change', () => updateAt(i, { name: nm.value }));
        const ur = document.createElement('input');
        ur.className = 'url-input'; ur.type = 'url'; ur.value = it.url; ur.placeholder = 'https://';
        ur.addEventListener('change', () => updateAt(i, { url: ur.value }));
        const del = document.createElement('button');
        del.className = 'del-btn'; del.textContent = '×'; del.title = 'Remove';
        del.addEventListener('click', async () => {
            items.splice(i, 1);
            await setStored('vipertab.dock', items);
            renderDock(); renderDockEditor();
        });
        row.append(ico, nm, ur, del);
        editor.appendChild(row);
    });
}

// ---------------------------------------------------------------------------
// Spotlight + quick actions
// ---------------------------------------------------------------------------
let spotSelected = 0;

function makeQuickActions() {
    return [
        { k: ['theme', 'glass', 'dark', 'light', 'oled'], label: 'Cycle theme', tag: 'Action',
          run: async () => { const o = ['glass','light','oled']; const i = o.indexOf(PREFS.theme); applyTheme(o[(i+1)%o.length]); await setStored('vipertab.prefs', PREFS); } },
        { k: ['clear', 'notes', 'reset'], label: 'Clear notes', tag: 'Action',
          run: async () => { const ta = document.querySelector('.notes-area'); if (ta) ta.value = ''; await setStored('vipertab.notes', ''); } },
        { k: ['open', 'all', 'dock', 'tabs'], label: 'Open all dock items in tabs', tag: 'Action',
          run: async () => { const items = await getStored('vipertab.dock', DEFAULT_DOCK); items.forEach(it => chrome.tabs?.create({ url: it.url, active: false })); } },
        { k: ['wallpaper', 'reset', 'default'], label: 'Reset wallpaper to Sequoia', tag: 'Action',
          run: async () => { applyWallpaperById('sequoia'); await setStored('vipertab.wallpaper', null); await setStored('vipertab.prefs', PREFS); } },
        { k: ['history', 'browsing'], label: 'Open browsing history', tag: 'Action',
          run: () => chrome.tabs?.create({ url: 'chrome://history' }) },
        { k: ['downloads'], label: 'Open downloads', tag: 'Action',
          run: () => chrome.tabs?.create({ url: 'chrome://downloads' }) },
        { k: ['bookmarks', 'manager'], label: 'Open bookmarks manager', tag: 'Action',
          run: () => chrome.tabs?.create({ url: 'chrome://bookmarks' }) },
        { k: ['extensions', 'addons'], label: 'Open extensions', tag: 'Action',
          run: () => chrome.tabs?.create({ url: 'chrome://extensions' }) },
        { k: ['incognito', 'private', 'window'], label: 'New incognito window', tag: 'Action',
          run: () => chrome.windows?.create({ incognito: true }) },
        { k: ['settings', 'control', 'center'], label: 'Open Control Center', tag: 'Action',
          run: () => { closeSpotlight(); $('settings').hidden = false; renderDockEditor(); syncSegToggles(); renderWallpaperGrid(); renderWidgetPicker(); } },
        { k: ['widget', 'library', 'change'], label: 'Edit widgets', tag: 'Action',
          run: () => { closeSpotlight(); $('settings').hidden = false; renderDockEditor(); syncSegToggles(); renderWallpaperGrid(); renderWidgetPicker(); $('widget-picker')?.scrollIntoView({ behavior: 'smooth' }); } },
        { k: ['visualizer', 'sound', 'music', 'audio'], label: 'Toggle sound visualizer', tag: 'Action',
          run: () => { closeSpotlight(); events.emit('visualizer-toggle'); } },
    ];
}
const QUICK_ACTIONS = makeQuickActions();

function buildResultLi(r) {
    const li = document.createElement('li');
    const ico = document.createElement('span'); ico.className = 'res-icon'; ico.textContent = r.icon;
    const lbl = document.createElement('span'); lbl.className = 'res-label'; lbl.textContent = r.label;
    li.appendChild(ico); li.appendChild(lbl);
    if (r.sub) {
        const sub = document.createElement('span');
        sub.className = 'res-sub'; sub.textContent = r.sub;
        li.appendChild(sub);
    }
    if (r.tag) {
        const tag = document.createElement('span');
        tag.className = 'res-tag'; tag.textContent = r.tag;
        li.appendChild(tag);
    }
    li.addEventListener('click', () => { r.action?.(); closeSpotlight(); });
    return li;
}

function openSpotlight() {
    $('spotlight').hidden = false;
    $('spotlight-input').value = '';
    $('spotlight-input').focus();
    runSearch('');
}
function closeSpotlight() { $('spotlight').hidden = true; }

async function runSearch(q) {
    const ul = $('spotlight-results');
    ul.innerHTML = '';
    spotSelected = 0;
    q = q.trim();
    const out = [];
    if (q) {
        const ql = q.toLowerCase();
        QUICK_ACTIONS.forEach(a => {
            const score = a.k.reduce((s, kw) => s + (ql.includes(kw) || kw.includes(ql) ? 1 : 0), 0);
            if (score > 0 || a.label.toLowerCase().includes(ql)) {
                out.push({ icon: '⚡', label: a.label, tag: a.tag, action: a.run });
            }
        });
        const isUrl = /^https?:\/\//i.test(q) || /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(q);
        if (isUrl) {
            const url = /^https?:\/\//i.test(q) ? q : 'https://' + q;
            out.push({ icon: '🌐', label: `Open ${url}`, action: () => location.href = url });
        }
        out.push({ icon: '🔍', label: `Search Google for "${q}"`, action: () => location.href = `https://www.google.com/search?q=${encodeURIComponent(q)}` });
        if (typeof chrome !== 'undefined' && chrome.bookmarks) {
            try {
                const bms = await new Promise(res => chrome.bookmarks.search(q, res));
                bms.filter(b => b.url).slice(0, 5).forEach(b => {
                    out.push({ icon: '⭐', label: b.title || b.url, sub: b.url, action: () => location.href = b.url });
                });
            } catch { /* ignore */ }
        }
        if (typeof chrome !== 'undefined' && chrome.tabs) {
            try {
                const tabs = await new Promise(res => chrome.tabs.query({}, res));
                tabs.filter(t => (t.title + ' ' + t.url).toLowerCase().includes(ql)).slice(0, 5).forEach(t => {
                    out.push({ icon: '📑', label: t.title || t.url, sub: t.url, action: () => chrome.tabs.update(t.id, { active: true }) });
                });
            } catch { /* ignore */ }
        }
    } else {
        out.push({ icon: '⌨️', label: 'Search the web, bookmarks, tabs, and quick actions' });
        QUICK_ACTIONS.slice(0, 4).forEach(a => out.push({ icon: '⚡', label: a.label, tag: a.tag, action: a.run }));
    }
    out.forEach(r => ul.appendChild(buildResultLi(r)));
    updateSpotSelection();
}

function updateSpotSelection() {
    const items = $('spotlight-results').querySelectorAll('li');
    items.forEach((li, i) => li.classList.toggle('selected', i === spotSelected));
    items[spotSelected]?.scrollIntoView({ block: 'nearest' });
}

function initSpotlight() {
    const input = $('spotlight-input');
    input.addEventListener('input', () => runSearch(input.value));
    input.addEventListener('keydown', (e) => {
        const items = $('spotlight-results').querySelectorAll('li');
        if (e.key === 'ArrowDown') { spotSelected = Math.min(spotSelected + 1, items.length - 1); updateSpotSelection(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { spotSelected = Math.max(spotSelected - 1, 0); updateSpotSelection(); e.preventDefault(); }
        else if (e.key === 'Enter') { items[spotSelected]?.click(); }
        else if (e.key === 'Escape') { closeSpotlight(); }
    });
    $('spotlight').addEventListener('click', (e) => {
        if (e.target.id === 'spotlight') closeSpotlight();
    });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function toggleSettings() {
    const s = $('settings');
    if (s.hidden) {
        s.hidden = false;
        renderDockEditor();
        renderWallpaperGrid();
        renderWidgetPicker();
        syncSegToggles();
    } else {
        s.hidden = true;
    }
}
function closeSettings() { $('settings').hidden = true; }

function syncSegToggles() {
    $('time-format')?.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.fmt === PREFS.timeFormat));
    $('temp-unit')?.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.unit === PREFS.tempUnit));
    $('theme-toggle')?.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.theme === PREFS.theme));
    $('clock-style')?.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.style === PREFS.clockStyle));
}

function initSettings() {
    $('control-btn').addEventListener('click', toggleSettings);
    $('apple-btn').addEventListener('click', toggleSettings);
    $('search-btn').addEventListener('click', openSpotlight);
    $('brand-btn').addEventListener('click', toggleSettings);

    $('wallpaper-upload-btn').addEventListener('click', () => $('wallpaper-file').click());
    $('wallpaper-file').addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            applyCustomWallpaper(ev.target.result);
            setStored('vipertab.wallpaper', ev.target.result);
            setStored('vipertab.prefs', PREFS);
        };
        reader.readAsDataURL(f);
    });

    $('dock-add').addEventListener('click', async () => {
        const items = await getStored('vipertab.dock', DEFAULT_DOCK);
        items.push({ name: 'New', url: 'https://' });
        await setStored('vipertab.dock', items);
        renderDock(); renderDockEditor();
    });

    $('time-format').addEventListener('click', async (e) => {
        const fmt = e.target.dataset?.fmt; if (!fmt) return;
        PREFS.timeFormat = fmt;
        await setStored('vipertab.prefs', PREFS);
        syncSegToggles();
        tickMenuClock();
        events.emit('prefs');
    });
    $('temp-unit').addEventListener('click', async (e) => {
        const unit = e.target.dataset?.unit; if (!unit) return;
        PREFS.tempUnit = unit;
        await setStored('vipertab.prefs', PREFS);
        syncSegToggles();
        events.emit('prefs');
    });
    $('theme-toggle').addEventListener('click', async (e) => {
        const t = e.target.dataset?.theme; if (!t) return;
        applyTheme(t);
        await setStored('vipertab.prefs', PREFS);
    });

    $('clock-style')?.addEventListener('click', async (e) => {
        const s = e.target.dataset?.style; if (!s) return;
        PREFS.clockStyle = s;
        await setStored('vipertab.prefs', PREFS);
        syncSegToggles();
        events.emit('clock-style');
    });

    $('layout-reset').addEventListener('click', async () => {
        await setStored('vipertab.layout', { ...DEFAULT_LAYOUT });
        renderLayout();
        renderWidgetPicker();
    });

    // Zen-only: accent color picker
    if (IS_ZEN_EDITION) {
        const zenSettings = $('zen-settings');
        if (zenSettings) zenSettings.hidden = false;
        const picker = $('zen-accent');
        const reset = $('zen-accent-reset');
        if (picker) {
            picker.value = PREFS.zenAccent || '#c9a36b';
            picker.addEventListener('input', async (e) => {
                PREFS.zenAccent = e.target.value;
                applyZenAccent(PREFS.zenAccent);
                await setStored('vipertab.prefs', PREFS);
            });
        }
        if (reset) {
            reset.addEventListener('click', async () => {
                PREFS.zenAccent = '#c9a36b';
                if (picker) picker.value = PREFS.zenAccent;
                applyZenAccent(PREFS.zenAccent);
                await setStored('vipertab.prefs', PREFS);
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Menu bar dropdowns + info modal
// ---------------------------------------------------------------------------
function syncMenuLabels() {
    const t = $('theme-current');
    if (t) t.textContent = PREFS.theme === 'glass' ? 'Glass' : PREFS.theme === 'light' ? 'Light' : 'OLED';
    const tf = $('time-current'); if (tf) tf.textContent = PREFS.timeFormat === '24' ? '24h' : '12h';
    const tu = $('temp-current'); if (tu) tu.textContent = PREFS.tempUnit === 'fahrenheit' ? '°F' : '°C';
}
function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.hidden = true);
    document.querySelectorAll('.menu-item[data-menu]').forEach(b => b.classList.remove('open'));
}

function initMenuBar() {
    document.querySelectorAll('.menu-item[data-menu]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = $(`menu-${btn.dataset.menu}`);
            const isOpen = !menu.hidden;
            closeAllDropdowns();
            if (!isOpen) {
                const rect = btn.getBoundingClientRect();
                menu.style.left = `${rect.left}px`;
                menu.hidden = false;
                btn.classList.add('open');
                syncMenuLabels();
            }
        });
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-menu') && !e.target.closest('.menu-item[data-menu]')) {
            closeAllDropdowns();
        }
    });
    document.querySelectorAll('.dropdown-menu .menu-row').forEach(row => {
        row.addEventListener('click', () => { handleMenuAction(row.dataset.action); closeAllDropdowns(); });
    });
    $('info-close').addEventListener('click', () => $('info-modal').hidden = true);
    $('info-modal').addEventListener('click', (e) => { if (e.target.id === 'info-modal') $('info-modal').hidden = true; });
}

async function handleMenuAction(action) {
    switch (action) {
        case 'theme-cycle': {
            const o = ['glass', 'light', 'oled'];
            const i = o.indexOf(PREFS.theme);
            applyTheme(o[(i + 1) % o.length]);
            await setStored('vipertab.prefs', PREFS);
            break;
        }
        case 'time-toggle':
            PREFS.timeFormat = PREFS.timeFormat === '24' ? '12' : '24';
            await setStored('vipertab.prefs', PREFS);
            syncSegToggles(); tickMenuClock(); events.emit('prefs');
            break;
        case 'temp-toggle':
            PREFS.tempUnit = PREFS.tempUnit === 'fahrenheit' ? 'celsius' : 'fahrenheit';
            await setStored('vipertab.prefs', PREFS);
            syncSegToggles(); events.emit('prefs');
            break;
        case 'visualizer-toggle': events.emit('visualizer-toggle'); break;
        case 'reset-wallpaper':
            applyWallpaperById('sequoia');
            await setStored('vipertab.wallpaper', null);
            await setStored('vipertab.prefs', PREFS);
            break;
        case 'settings-open':
            $('settings').hidden = false;
            renderDockEditor(); renderWallpaperGrid(); renderWidgetPicker(); syncSegToggles();
            break;
        case 'spotlight': openSpotlight(); break;
        case 'shortcuts': showInfo('Keyboard Shortcuts', shortcutsHTML()); break;
        case 'tips':      showInfo('Tips & Features',   tipsHTML()); break;
        case 'about':     showInfo('About ViperTab',    aboutHTML()); break;
        case 'widgets':
            $('settings').hidden = false;
            renderDockEditor(); renderWallpaperGrid(); renderWidgetPicker(); syncSegToggles();
            $('widget-picker')?.scrollIntoView({ behavior: 'smooth' });
            break;
    }
}

function showInfo(title, bodyHTML) {
    $('info-title').textContent = title;
    $('info-body').innerHTML = bodyHTML;
    $('info-modal').hidden = false;
}

function shortcutsHTML() {
    return `
        <table class="shortcut-table">
            <tr><td>Open Spotlight</td><td><kbd>/</kbd> or <kbd>⌘ K</kbd> / <kbd>Ctrl K</kbd></td></tr>
            <tr><td>Close overlay</td><td><kbd>Esc</kbd></td></tr>
            <tr><td>Spotlight: navigate</td><td><kbd>↑</kbd> <kbd>↓</kbd></td></tr>
            <tr><td>Spotlight: open result</td><td><kbd>Enter</kbd></td></tr>
            <tr><td>Calculator: digits</td><td><kbd>0</kbd>–<kbd>9</kbd></td></tr>
            <tr><td>Calculator: ops</td><td><kbd>+</kbd> <kbd>−</kbd> <kbd>*</kbd> <kbd>/</kbd></td></tr>
            <tr><td>Calculator: equals</td><td><kbd>Enter</kbd> or <kbd>=</kbd></td></tr>
        </table>`;
}
function tipsHTML() {
    return `
        <ul class="tips-list">
            <li><strong>Customize widgets.</strong> Open Control Center → Widgets to swap any slot for a different widget. 16 widgets available.</li>
            <li><strong>Spotlight quick actions.</strong> Type <em>theme</em>, <em>incognito</em>, <em>history</em>, <em>clear notes</em>, <em>edit widgets</em> in Spotlight.</li>
            <li><strong>Live dock favicons.</strong> Add any URL to the dock and the icon is fetched automatically.</li>
            <li><strong>Sound visualizer.</strong> Captures browser audio via display capture. Pick a tab playing audio and tick "Share audio".</li>
            <li><strong>Themes &amp; wallpapers.</strong> Glass, Light, and OLED themes pair with 12 built-in wallpapers — or upload your own.</li>
            <li><strong>Keyboard-first.</strong> Press <kbd>/</kbd> anywhere to focus Spotlight. <kbd>Esc</kbd> closes anything open.</li>
        </ul>`;
}
function aboutHTML() {
    const m = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()) || {};
    const name = m.name || 'ViperTab';
    const version = m.version || '—';
    return `
        <div class="about-content">
            <img src="icons/vipershard-logo.png" alt="ViperShard" class="about-logo">
            <h3>${name} v${version}</h3>
            <p>A macOS-inspired new tab page with glass widgets,<br>a customizable dock, and Spotlight search.</p>
            <p class="about-meta">Part of the ViperShard family.</p>
        </div>`;
}

// ---------------------------------------------------------------------------
// Update check + banner
// ---------------------------------------------------------------------------
function compareVersions(a, b) {
    const ap = String(a).split('.').map(Number);
    const bp = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
        const x = ap[i] || 0, y = bp[i] || 0;
        if (x !== y) return x - y;
    }
    return 0;
}

// Edition badges: short label + color identity, used on every update banner.
const EDITION_BADGE = {
    main:    { label: 'Default' },
    dev:     { label: 'Dev'     },
    student: { label: 'Student' },
    zen:     { label: 'Zen'     },
};

async function checkForUpdates() {
    if (!UPDATE_CHECK_URL) return;
    try {
        const r = await fetch(`${UPDATE_CHECK_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const remote = await r.json();
        if (!remote) return;

        const myEdition = EDITION_ID;
        const installed = chrome.runtime?.getManifest?.()?.version || '0.0.0';

        const editions = remote.editions || {
            main:    { version: remote.version, url: remote.url, notes: remote.notes },
            dev:     { version: remote.version, url: remote.url, notes: remote.notes },
            student: { version: remote.version, url: remote.url, notes: remote.notes },
            zen:     { version: remote.version, url: remote.url, notes: remote.notes },
        };

        // Reset the stack on each check so we never have stale entries.
        const stack = $('update-banner-stack');
        if (stack) stack.innerHTML = '';

        // Primary banner FIRST (own edition update) — sticks at top of stack.
        const myInfo = editions[myEdition];
        if (myInfo?.version && compareVersions(myInfo.version, installed) > 0) {
            const dismissed = await getStored(`vipertab.dismissed.${myEdition}`);
            if (myInfo.version !== dismissed) {
                showUpdateBanner({
                    edition: myEdition,
                    secondary: false,
                    title: `${EDITION_LABEL[myEdition]} v${myInfo.version} available`,
                    linkText: 'Download',
                    url: myInfo.url || remote.url,
                    notes: myInfo.notes,
                    dismissKey: `vipertab.dismissed.${myEdition}`,
                    dismissValue: myInfo.version,
                });
            }
        }

        // Secondary banners for ALL other editions with un-dismissed updates —
        // each gets its own row with its own dismiss button.
        for (const otherEdition of ALL_EDITIONS) {
            if (otherEdition === myEdition) continue;
            const otherInfo = editions[otherEdition];
            if (!otherInfo?.version) continue;
            const dismissed = await getStored(`vipertab.dismissed.${otherEdition}`);
            if (otherInfo.version === dismissed) continue;
            showUpdateBanner({
                edition: otherEdition,
                secondary: true,
                title: `${EDITION_LABEL[otherEdition]} v${otherInfo.version} just dropped`,
                linkText: 'Try it',
                url: otherInfo.url || remote.url,
                notes: otherInfo.notes,
                dismissKey: `vipertab.dismissed.${otherEdition}`,
                dismissValue: otherInfo.version,
            });
        }
    } catch { /* offline / repo not set up yet */ }
}

function showUpdateBanner(opts) {
    const stack = $('update-banner-stack');
    if (!stack) return;

    const banner = document.createElement('div');
    banner.className = 'update-banner' + (opts.secondary ? ' secondary' : '');
    if (opts.edition) banner.dataset.badgeEdition = opts.edition;

    const badge = document.createElement('span');
    badge.className = 'badge';
    const meta = EDITION_BADGE[opts.edition];
    badge.textContent = (meta?.label || 'Update').toUpperCase();

    const msg = document.createElement('span');
    msg.className = 'upd-msg';
    msg.textContent = opts.title;

    const link = document.createElement('a');
    link.className = 'upd-link';
    link.href = opts.url || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = (opts.linkText || 'Download') + ' →';
    if (opts.notes) link.title = opts.notes;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'upd-close';
    closeBtn.title = 'Dismiss';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', async () => {
        banner.remove();
        if (opts.dismissKey && opts.dismissValue) {
            await setStored(opts.dismissKey, opts.dismissValue);
        }
    });

    banner.append(badge, msg, link, closeBtn);
    stack.appendChild(banner);
}

// ---------------------------------------------------------------------------
// Global keys
// ---------------------------------------------------------------------------
function initGlobalKeys() {
    document.addEventListener('keydown', (e) => {
        const t = e.target;
        const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
        if (e.key === '/' && !inField) {
            e.preventDefault();
            openSpotlight();
        } else if (e.key === 'Escape') {
            closeSpotlight();
            closeSettings();
            closeAllDropdowns();
            $('info-modal').hidden = true;
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !inField) {
            e.preventDefault();
            openSpotlight();
        }
    });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
    const savedPrefs = await getStored('vipertab.prefs');
    if (savedPrefs) Object.assign(PREFS, savedPrefs);

    // One-time migration: dev-edition installs that predate the terminal theme
    // landed on `glass`. Bump them to the new `dev` theme so the rebuild is visible.
    if (IS_DEV_EDITION && PREFS.theme === 'glass') {
        const migrated = await getStored('vipertab.dev-theme-migrated');
        if (!migrated) {
            PREFS.theme = 'dev';
            await setStored('vipertab.prefs', PREFS);
            await setStored('vipertab.dev-theme-migrated', true);
        }
    }

    applyTheme(PREFS.theme);
    const customWp = await getStored('vipertab.wallpaper');
    if (customWp) applyCustomWallpaper(customWp);
    else applyWallpaperById(PREFS.wallpaperId);

    tickMenuClock();
    setInterval(tickMenuClock, 1000);

    await renderLayout();
    renderDock();

    initSpotlight();
    initSettings();
    initMenuBar();
    initGlobalKeys();

    if (IS_ZEN_EDITION) initZenChrome();
    if (IS_ZEN_EDITION) applyZenAccent(PREFS.zenAccent);
    if (IS_ZEN_EDITION) initFullscreenButton();
    if (IS_ZEN_EDITION) initZenVisualizer();

    checkForUpdates();
}

// ---------------------------------------------------------------------------
// Zen edition: auto-hiding chrome + accent color
// ---------------------------------------------------------------------------
function initZenChrome() {
    let timer = null;
    const html = document.documentElement;
    const refresh = (e) => {
        const showTop    = e.clientY < 50;
        const showBottom = e.clientY > window.innerHeight - 80;
        html.classList.toggle('zen-show-top', showTop);
        html.classList.toggle('zen-show-bottom', showBottom);
    };
    document.addEventListener('mousemove', refresh);
    // On boot show both for a few seconds so users know they exist
    html.classList.add('zen-show-top', 'zen-show-bottom');
    timer = setTimeout(() => {
        html.classList.remove('zen-show-top', 'zen-show-bottom');
    }, 3000);
}

function applyZenAccent(color) {
    if (!color) return;
    document.documentElement.style.setProperty('--zen-accent', color);
}

// Zen Visualizer mode — opens the visualizer widget into a fullscreen overlay
// that takes over the new tab. Floating glass controls fade out on idle, Esc exits.
function initZenVisualizer() {
    const btn = $('zen-viz-btn');
    if (!btn) return;
    let overlay = null;
    let cleanupWidget = null;
    let idleTimer = null;
    function onMouseMove() {
        if (!overlay) return;
        document.body.classList.remove('viz-stage-idle');
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (overlay) document.body.classList.add('viz-stage-idle');
        }, 2000);
    }
    function onKey(e) {
        if (e.key === 'Escape' && overlay) close();
    }
    function open() {
        if (overlay) return;
        overlay = document.createElement('section');
        overlay.className = 'widget visualizer-widget viz-stage-active';
        overlay.dataset.widget = 'visualizer';
        document.body.appendChild(overlay);
        document.body.classList.add('viz-stage-mode');
        cleanupWidget = WIDGET_LIBRARY.visualizer.render(overlay, 'wide');
        // Always-visible close button so the user has an obvious exit
        const closeBtn = document.createElement('button');
        closeBtn.className = 'viz-stage-close';
        closeBtn.title = 'Exit Zen Visualizer (Esc)';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', close);
        document.body.appendChild(closeBtn);
        overlay._closeBtn = closeBtn;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('keydown', onKey);
        onMouseMove();
    }
    function close() {
        if (!overlay) return;
        try { cleanupWidget && cleanupWidget(); } catch {}
        cleanupWidget = null;
        if (overlay._closeBtn) overlay._closeBtn.remove();
        overlay.remove();
        overlay = null;
        document.body.classList.remove('viz-stage-mode', 'viz-stage-idle');
        if (idleTimer) clearTimeout(idleTimer);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('keydown', onKey);
    }
    btn.addEventListener('click', () => overlay ? close() : open());
}

function initFullscreenButton() {
    const btn = $('fullscreen-btn');
    if (!btn) return;
    const path = $('fs-icon-path');
    const ENTER = 'M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4';
    const EXIT  = 'M9 5v4H5M15 5v4h4M9 19v-4H5M15 19v-4h4';
    btn.addEventListener('click', async () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            try { await document.documentElement.requestFullscreen(); }
            catch { /* user gesture required, etc. */ }
        }
    });
    document.addEventListener('fullscreenchange', () => {
        const fs = !!document.fullscreenElement;
        if (path) path.setAttribute('d', fs ? EXIT : ENTER);
        btn.title = fs ? 'Exit fullscreen (Esc)' : 'Enter fullscreen';
    });
}

document.addEventListener('DOMContentLoaded', boot);
