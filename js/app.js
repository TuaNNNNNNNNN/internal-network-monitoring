/**
 * YODY Internal Network Monitoring - Exact Replication Logic
 * Optimized for Cloudflare Pages (Static Hosting)
 */

// --- CONFIGURATION ---
const SHEET_ID = '1wwjXmvOrNn4G7uNdAGPwwa2RpTvfYrRASzAD5PNpbEE';
const MAIL_SHEET_ID = '1Eea0RMfjsrv_JrCadKxdVWvYdsm14riZYtNcuUWOii0';

const JSON_STORES = `https://opensheet.elk.sh/${SHEET_ID}/Stores`;
const JSON_EVENTS = `https://opensheet.elk.sh/${SHEET_ID}/Events`;
const JSON_HIGHLIGHTS = `https://opensheet.elk.sh/${SHEET_ID}/Highlight`;
const JSON_MAIL = `https://opensheet.elk.sh/${MAIL_SHEET_ID}/Mail+YODY`;
const CSV_HOME = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=165883319`;

// UI Config
const ZOOM_THRESHOLD = 10;

// GLOBAL STATE
let map, STORES_DATA = [], EVENTS_DATA = [], HIGHLIGHTS_DATA = [], HOME_DATA = [], markers = [];
let currentDisplayFilter = 'all', currentTab = 'violations', searchTimeout;
let currentStore = null;

// --- INITIALIZATION ---
window.onload = () => {
    const email = localStorage.getItem('yody_user');
    if (email) {
        initPortal();
    } else {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('login-screen').style.display = 'flex';
    }
    initTheme();
};

async function initPortal() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('loading').style.display = 'flex';

    // Initialize Map
    map = L.map('map', { zoomControl: false }).setView([16.0, 107.5], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    // Sovereignty Labels
    const islands = [
        { name: "QUẦN ĐẢO HOÀNG SA (VIỆT NAM)", coords: [16.5, 112.0] },
        { name: "QUẦN ĐẢO TRƯỜNG SA (VIỆT NAM)", coords: [10.0, 114.5] }
    ];
    islands.forEach(isl => {
        L.marker(isl.coords, {
            icon: L.divIcon({ className: 'map-label', html: isl.name, iconSize: [300, 20] }),
            interactive: false
        }).addTo(map);
    });

    map.on('zoomend', () => {
        if (map.getZoom() >= ZOOM_THRESHOLD) document.getElementById('map').classList.add('show-names');
        else document.getElementById('map').classList.remove('show-names');
    });

    // Load Data
    await Promise.all([
        loadPortalData(),
        loadHomeData()
    ]);

    document.getElementById('loading').style.display = 'none';
    startSeasonalDecorations();
}

// --- AUTHENTICATION ---
async function handleLogin() {
    const email = document.getElementById('email-input').value.trim().toLowerCase();
    const error = document.getElementById('login-error');
    const btn = document.querySelector('.login-btn');

    if (!email.endsWith('@yody.vn')) {
        error.textContent = 'Chỉ chấp nhận email @yody.vn';
        error.style.display = 'block';
        return;
    }

    btn.innerText = 'Đang kiểm tra...';
    btn.disabled = true;

    try {
        const response = await fetch(JSON_MAIL);
        const whitelist = await response.json();
        const isAuthorized = whitelist.some(row =>
            Object.values(row).some(val => val && val.toString().toLowerCase().trim() === email)
        );

        if (isAuthorized) {
            localStorage.setItem('yody_user', email);
            location.reload();
        } else {
            error.textContent = 'Email không có quyền truy cập';
            error.style.display = 'block';
            btn.innerText = 'Đăng nhập';
            btn.disabled = false;
        }
    } catch (e) {
        error.textContent = 'Lỗi kết nối server';
        error.style.display = 'block';
        btn.innerText = 'Đăng nhập';
        btn.disabled = false;
    }
}

// --- DATA LOADING ---
async function loadPortalData() {
    try {
        const [stores, events, highlights] = await Promise.all([
            fetch(JSON_STORES).then(r => r.json()),
            fetch(JSON_EVENTS).then(r => r.json()),
            fetch(JSON_HIGHLIGHTS).then(r => r.json()).catch(() => [])
        ]);

        EVENTS_DATA = events;
        HIGHLIGHTS_DATA = highlights;
        STORES_DATA = stores.filter(s => s.ID || s.Store_ID);

        const eventsMap = new Map();
        const highlightsMap = new Map();

        events.forEach(e => {
            const id = (e.Store_ID || e['Store ID'] || '').toString().trim();
            if (!eventsMap.has(id)) eventsMap.set(id, []);
            eventsMap.get(id).push(e);
        });

        highlights.forEach(h => {
            const id = (h.Store_ID || h['Store ID'] || '').toString().trim();
            if (!highlightsMap.has(id)) highlightsMap.set(id, []);
            highlightsMap.get(id).push(h);
        });

        STORES_DATA.forEach(s => {
            const id = (s.ID || s.Store_ID || '').toString().trim();
            s.violations = eventsMap.get(id) || [];
            s.highlights = highlightsMap.get(id) || [];
            s.violationCount = s.violations.length;
            s.highlightCount = s.highlights.length;
        });

        updateStats();
        renderMarkers();
        renderOMStats();
        renderNewsTicker();
    } catch (e) {
        console.error("Portal data error:", e);
    }
}

async function loadHomeData() {
    try {
        const response = await fetch(CSV_HOME);
        const text = await response.text();
        const parsed = Papa.parse(text, { header: false, skipEmptyLines: true });
        const rows = parsed.data;

        HOME_DATA = rows.slice(1).filter(r => r[1]).map(r => ({
            category: r[0],
            title: r[1],
            excerpt: r[2],
            detail: r[3],
            image: r[4]
        }));

        renderHomeGrid();
    } catch (e) {
        console.error("Home data error:", e);
    }
}

// --- UI RENDERING ---
function renderHomeGrid() {
    const grid = document.getElementById('wall-grid');
    if (!grid) return;
    grid.innerHTML = HOME_DATA.map((p, i) => {
        let img = p.image || 'https://via.placeholder.com/400x250';
        if (img.includes('google.com/url')) {
            try { img = decodeURIComponent(new URL(img).searchParams.get('url')); } catch (e) { }
        }
        const drive = img.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (drive) img = `https://drive.google.com/uc?export=view&id=${drive[1]}`;

        return `
            <div class="news-card" onclick="showNewsDetail(${i})">
                <img src="${img}" class="news-img" onerror="this.src='https://via.placeholder.com/400x250'">
                <div class="news-content">
                    <span class="news-tag">${p.category || 'TIN TỨC'}</span>
                    <div class="news-title">${p.title}</div>
                    <div class="news-excerpt">${p.excerpt || ''}</div>
                    <div class="news-footer"><span>Chi tiết →</span></div>
                </div>
            </div>
        `;
    }).join('');
}

function showNewsDetail(index) {
    const p = HOME_DATA[index];
    const modal = document.getElementById('global-news-modal');
    const body = document.getElementById('global-news-body');

    let img = p.image || '';
    if (img.includes('google.com/url')) {
        try { img = decodeURIComponent(new URL(img).searchParams.get('url')); } catch (e) { }
    }
    const drive = img.match(/\/d\/([a-zA-Z0-9_-]+)/);

    let mediaHtml = '';
    if (drive) {
        mediaHtml = `<iframe src="https://drive.google.com/file/d/${drive[1]}/preview" width="100%" height="450px" style="border:none; border-radius:12px; background:#000;"></iframe>`;
    } else if (img) {
        mediaHtml = `<img src="${img}" style="width:100%; border-radius:12px; margin-bottom:20px;">`;
    }

    body.innerHTML = `
        <div style="margin-bottom:20px;">${mediaHtml}</div>
        <h2 style="font-size:24px; color:var(--text-color); margin-bottom:12px;">${p.title}</h2>
        <div style="font-size:13px; color:#fcb900; margin-bottom:20px; text-transform:uppercase; letter-spacing:1px;">${p.category || 'TIN TỨC'}</div>
        <div style="font-size:16px; color:var(--text-color); line-height:1.6; white-space:pre-wrap;">${p.detail || p.excerpt || 'Không có nội dung chi tiết.'}</div>
    `;
    modal.classList.add('active');
}

function closeNewsModal() {
    document.getElementById('global-news-modal').classList.remove('active');
}

function renderNewsTicker() {
    const container = document.getElementById('ticker-content');
    if (!container) return;
    const items = EVENTS_DATA.slice(0, 10).map(e => {
        const store = STORES_DATA.find(s => (s.ID || s.Store_ID || '').toString() === (e.Store_ID || e['Store ID'] || '').toString());
        const name = store ? (store.Store_Name || store.Name) : 'Cửa hàng';
        return `<span class="ticker-item"><span class="date">[${e.Date || ''}]</span> <span class="highlight">${name}</span>: ${(e.Description || e.Type || '').substring(0, 60)}...</span>`;
    });
    container.innerHTML = items.join(' <span style="margin: 0 10px; color: rgba(255,255,255,0.2)">|</span> ');
}

function updateStats() {
    document.getElementById('total-stores').innerText = STORES_DATA.length;
    document.getElementById('total-violations').innerText = EVENTS_DATA.length;
    document.getElementById('total-rewards').innerText = HIGHLIGHTS_DATA.length;
    updateTopViolations();
}

function updateTopViolations() {
    const top = [...STORES_DATA].filter(s => s.violationCount > 0).sort((a, b) => b.violationCount - a.violationCount).slice(0, 5);
    const container = document.getElementById('top-violations');
    container.innerHTML = top.map((s, i) => `
        <div class="om-item" onclick="selectSearchStore('${s.ID || s.Store_ID}')" style="cursor:pointer; padding: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 24px; height: 24px; background: ${i === 0 ? '#f44336' : (i === 1 ? '#ff9800' : (i === 2 ? '#ffeb3b' : '#999'))}; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; color: #000;">${i + 1}</div>
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-weight: 600; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${s.Store_Name || s.Name}</div>
                    <div style="font-size: 10px; color: rgba(255,255,255,0.6);">${s.violationCount} vi phạm</div>
                </div>
            </div>
        </div>
    `).join('');
}

function renderOMStats() {
    const omCounts = {};
    STORES_DATA.forEach(s => {
        if (s.violationCount > 0) {
            const addr = s.Address || '';
            let om = 'Khác';
            if (addr.includes('OM.')) om = addr.split('OM.')[1].split(',')[0].trim();
            omCounts[om] = (omCounts[om] || 0) + s.violationCount;
        }
    });
    const sorted = Object.entries(omCounts).sort((a, b) => b[1] - a[1]);
    document.getElementById('om-list').innerHTML = sorted.map(([name, count]) => `
        <div class="om-item">
            <span class="om-name">${name}</span>
            <span class="om-count">${count}</span>
        </div>
    `).join('');
}

// --- MAP LOGIC ---
function renderMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    STORES_DATA.forEach(s => {
        if (currentDisplayFilter === 'violations' && s.violationCount === 0) return;
        if (currentDisplayFilter === 'clean' && s.violationCount > 0) return;

        const lat = parseFloat(s.Latitude || s.Lat);
        const lng = parseFloat(s.Longitude || s.Lng);
        if (!lat || !lng) return;

        const color = s.violationCount === 0 ? 'marker-green' :
            (s.violationCount <= 2 ? 'marker-yellow' :
                (s.violationCount <= 4 ? 'marker-orange' : 'marker-red'));

        const pulse = (s.violationCount >= 5) ? '<div class="marker-pulse pulse-high"></div>' : '';

        const icon = L.divIcon({
            className: 'custom-marker',
            html: `<div class="marker-container">${pulse}<div class="marker-circle ${color}">${s.violationCount}</div></div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const m = L.marker([lat, lng], { icon }).addTo(map);
        m.bindTooltip(s.Store_Name || s.Name, { permanent: true, direction: 'top', className: 'store-label-tooltip', offset: [0, -16] });
        m.on('click', () => { openStorePopup(s); map.setView([lat, lng], 16); });
        markers.push(m);
    });
}

// --- POPUP LOGIC ---
function openStorePopup(store) {
    currentStore = store;
    const popup = document.getElementById('custom-popup');
    popup.classList.add('open');
    popup.classList.remove('show-detail');
    document.getElementById('popup-store-name').innerText = store.Store_Name || store.Name;
    document.getElementById('popup-store-address').innerText = store.Address || '';
    document.getElementById('tab-violations-count').innerText = store.violationCount;
    document.getElementById('tab-rewards-count').innerText = store.highlightCount;
    switchTab('violations');
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.popup-tab').forEach(el => el.classList.remove('active'));
    document.querySelector(`.popup-tab.${tab}`).classList.add('active');

    const items = tab === 'violations' ? currentStore.violations : currentStore.highlights;
    const body = document.getElementById('popup-body');
    body.innerHTML = items?.length ? items.map(item => `
        <div class="item-card" onclick="showDetail(${JSON.stringify(item).replace(/"/g, '&quot;')})">
            <div class="item-title"><span>${(item.Description || item.Type || '').substring(0, 40)}...</span></div>
            <div class="item-preview" style="display:flex; justify-content:space-between; margin-top:4px;">
                <span>${item.Date || ''}</span>
                <span style="font-size:10px; opacity:0.7; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px;">${item.Type || 'Ghi nhận'}</span>
            </div>
        </div>
    `).join('') : '<div style="text-align:center; padding:20px; color:rgba(255,255,255,0.5);">Không có dữ liệu</div>';
}

function showDetail(item) {
    const body = document.getElementById('detail-body');
    body.innerHTML = Object.entries(item).map(([k, v]) => v ? `
        <div class="detail-field">
            <div class="detail-label">${k.replace(/_/g, ' ')}</div>
            <div class="detail-value">${v}</div>
        </div>
    ` : '').join('');
    document.getElementById('custom-popup').classList.add('show-detail');
}

function closePopup() { document.getElementById('custom-popup').classList.remove('open'); }
function backToList() { document.getElementById('custom-popup').classList.remove('show-detail'); }

// --- SEARCH & FILTER ---
function handleSearch(query) {
    clearTimeout(searchTimeout);
    const results = document.getElementById('search-results');
    if (!query.trim()) { results.classList.remove('active'); return; }
    searchTimeout = setTimeout(() => {
        const q = query.toLowerCase();
        const matches = STORES_DATA.filter(s => (s.Store_Name || s.Name || '').toLowerCase().includes(q) || (s.Address || '').toLowerCase().includes(q)).slice(0, 10);
        results.innerHTML = matches.map(s => `
            <div class="search-item" onclick="selectSearchStore('${s.ID || s.Store_ID}')">
                <div>${s.Store_Name}</div>
                <div class="sub-text">${s.Address || ''}</div>
            </div>
        `).join('');
        results.classList.add('active');
    }, 300);
}

function selectSearchStore(id) {
    const s = STORES_DATA.find(st => (st.ID || st.Store_ID || '').toString() === id.toString());
    if (s) {
        map.setView([parseFloat(s.Latitude || s.Lat), parseFloat(s.Longitude || s.Lng)], 18);
        openStorePopup(s);
        document.getElementById('store-search').value = '';
        document.getElementById('search-results').classList.remove('active');
    }
}

function setDisplayFilter(filter) {
    currentDisplayFilter = filter;
    document.querySelectorAll('.filter-option').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');
    renderMarkers();
}

// --- THEME & DECORATIONS ---
const THEMES = [
    { id: 'dark', icon: '🌙', name: 'Tối' },
    { id: 'tet', icon: '🧧', name: 'Tết' },
    { id: 'spring', icon: '🌸', name: 'Xuân' },
    { id: 'summer', icon: '🌊', name: 'Hạ' },
    { id: 'autumn', icon: '🍂', name: 'Thu' },
    { id: 'winter', icon: '❄️', name: 'Đông' }
];

function initTheme() {
    const manual = localStorage.getItem('theme');
    const auto = getSeasonalTheme();
    applyTheme(manual || auto);
}

function getSeasonalTheme() {
    const m = new Date().getMonth() + 1;
    const d = new Date().getDate();
    if ((m === 1 && d >= 20) || (m === 2 && d <= 15)) return 'tet';
    if (m >= 2 && m <= 4) return 'spring';
    if (m >= 5 && m <= 7) return 'summer';
    if (m >= 8 && m <= 10) return 'autumn';
    return 'winter';
}

function applyTheme(id) {
    document.documentElement.setAttribute('data-theme', id);
    const theme = THEMES.find(t => t.id === id);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.innerHTML = `<span>${theme.icon}</span> ${theme.name}`;
}

function toggleTheme() {
    const curr = document.documentElement.getAttribute('data-theme');
    const idx = THEMES.findIndex(t => t.id === curr);
    const next = THEMES[(idx + 1) % THEMES.length];
    applyTheme(next.id);
    localStorage.setItem('theme', next.id);
}

function startSeasonalDecorations() {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark') return;
    const config = { tet: '🧧', spring: '🌸', autumn: '🍂', winter: '❄️' };
    const char = config[theme];
    if (char) {
        for (let i = 0; i < 20; i++) {
            const el = document.createElement('div');
            el.className = 'decoration';
            el.innerText = char;
            el.style.left = Math.random() * 100 + 'vw';
            el.style.fontSize = (Math.random() * 20 + 10) + 'px';
            el.style.animation = `${theme === 'winter' ? 'snow' : 'fall'} ${Math.random() * 10 + 5}s linear infinite`;
            el.style.animationDelay = Math.random() * 10 + 's';
            el.style.position = 'fixed'; el.style.top = '-50px'; el.style.zIndex = '10000'; el.style.pointerEvents = 'none';
            document.body.appendChild(el);
        }
    }
}

// --- UTILS ---
function scrollToSection(id) {
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.offsetTop - 60, behavior: 'smooth' });
}

window.addEventListener('scroll', () => {
    const y = window.scrollY + 100;
    const sections = ['home-section', 'map-section', 'report-section'];
    sections.forEach((id, i) => {
        const sec = document.getElementById(id);
        if (sec && y >= sec.offsetTop && y < sec.offsetTop + sec.offsetHeight) {
            document.querySelectorAll('.nav-item').forEach(it => it.classList.remove('active'));
            document.querySelectorAll('.nav-item')[i].classList.add('active');
        }
    });
});

function toggleMobileSidebar() { document.querySelector('.sidebar').classList.toggle('open'); }
