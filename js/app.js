/**
 * YODY Internal Network Monitoring - Portal Logic
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

// --- GLOBAL STATE ---
let map;
let STORES_DATA = [];
let EVENTS_DATA = [];
let HIGHLIGHTS_DATA = [];
let HOME_DATA = [];
let markers = [];
let currentDisplayFilter = 'all';
let searchTimeout;
let currentStore = null;
let currentTab = 'violations';

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

    // Initialize all components in parallel
    await Promise.all([
        initMap(),
        loadPortalData(),
        loadHomeData()
    ]);

    document.getElementById('loading').style.display = 'none';

    // Start seasonal decorations
    startSeasonalDecorations();
}

// --- AUTHENTICATION ---
async function handleLogin() {
    const emailInput = document.getElementById('email-input');
    const email = emailInput.value.trim().toLowerCase();
    const error = document.getElementById('login-error');

    if (!email.endsWith('@yody.vn')) {
        error.textContent = 'Chỉ chấp nhận email @yody.vn';
        error.style.display = 'block';
        return;
    }

    const btn = document.querySelector('.login-btn');
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
            btn.innerText = 'ĐĂNG NHẬP';
            btn.disabled = false;
        }
    } catch (e) {
        console.error(e);
        error.textContent = 'Lỗi kết nối server';
        error.style.display = 'block';
        btn.innerText = 'ĐĂNG NHẬP';
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

        // Process Stores
        STORES_DATA = stores.filter(s => s.ID || s.Store_ID);

        // Indexing for performance
        const eventsMap = new Map();
        const highlightsMap = new Map();

        events.forEach(e => {
            const id = (e.Store_ID || e['Store ID'] || '').toString();
            if (!eventsMap.has(id)) eventsMap.set(id, []);
            eventsMap.get(id).push(e);
        });

        highlights.forEach(h => {
            const id = (h.Store_ID || h['Store ID'] || '').toString();
            if (!highlightsMap.has(id)) highlightsMap.set(id, []);
            highlightsMap.get(id).push(h);
        });

        STORES_DATA.forEach(s => {
            const id = (s.ID || s.Store_ID || '').toString();
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
          <div class="news-footer">Chi tiết &rarr;</div>
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
    ${mediaHtml}
    <span class="news-tag">${p.category || 'TIN TỨC'}</span>
    <h2 style="font-size:28px; color:#fff; margin-bottom:20px;">${p.title}</h2>
    <div style="font-size:16px; line-height:1.8; color:var(--text-muted); white-space:pre-wrap;">${p.detail || p.excerpt || 'Không có nội dung chi tiết.'}</div>
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
        return `<span class="ticker-item"><span class="date">${e.Date || ''}</span> <span class="highlight">[MỚI]</span> ${name}: ${e.Type || 'Sự việc mới'}</span>`;
    });

    container.innerHTML = items.length ? items.join('') : '<span class="ticker-item">Chào mừng đến với YODY Internal Network Monitoring Portal</span>';
}

function updateStats() {
    document.getElementById('stat-total-stores').innerText = STORES_DATA.length;
    document.getElementById('stat-total-violations').innerText = EVENTS_DATA.length;
    document.getElementById('stat-total-rewards').innerText = HIGHLIGHTS_DATA.length;
}

function renderOMStats() {
    const sorted = [...STORES_DATA].sort((a, b) => b.violationCount - a.violationCount).slice(0, 10);
    const container = document.getElementById('om-list');
    container.innerHTML = sorted.map(s => `
        <div class="om-item" onclick="selectSearchStore('${s.ID || s.Store_ID}')" style="cursor:pointer">
            <span class="om-name">${s.Store_Name || s.Name}</span>
            <span class="om-count" style="background:${s.violationCount > 3 ? 'rgba(244,67,54,0.2)' : 'rgba(0,255,136,0.2)'}; color:${s.violationCount > 3 ? '#ff8a80' : '#69f0ae'}">
                ${s.violationCount}
            </span>
        </div>
    `).join('');
}

// --- MAP LOGIC ---
async function initMap() {
    map = L.map('map', { zoomControl: false }).setView([16.0, 106.0], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Vietnam GeoJSON for borders
    try {
        const vnBorder = await fetch('https://cdn.jsdelivr.net/gh/Vizzuality/growasia_calculator@master/public/vietnam.geojson').then(r => r.json());
        L.geoJSON(vnBorder, { style: { color: 'var(--accent-color)', weight: 1.5, fillOpacity: 0.05 } }).addTo(map);
    } catch (e) { }

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
        if (map.getZoom() >= 10) document.getElementById('map').classList.add('show-names');
        else document.getElementById('map').classList.remove('show-names');
    });
}

function renderMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    STORES_DATA.forEach(s => {
        if (currentDisplayFilter === 'violations' && s.violationCount === 0) return;
        if (currentDisplayFilter === 'clean' && s.violationCount > 0) return;

        const lat = parseFloat(s.Latitude || s.Lat);
        const lng = parseFloat(s.Longitude || s.Lng);
        if (!lat || !lng) return;

        const colorClass = s.violationCount === 0 ? 'marker-green' :
            (s.violationCount < 3 ? 'marker-yellow' :
                (s.violationCount < 5 ? 'marker-orange' : 'marker-red'));

        const pulseHtml = (s.violationCount >= 5) ? `<div class="marker-pulse pulse-high"></div>` : '';

        const icon = L.divIcon({
            className: 'custom-marker',
            html: `<div class="marker-container">${pulseHtml}<div class="marker-circle ${colorClass}">${s.violationCount}</div></div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const m = L.marker([lat, lng], { icon }).addTo(map);
        m.bindTooltip(s.Store_Name || s.Name, { permanent: true, direction: 'top', className: 'store-label-tooltip', offset: [0, -20] });

        m.on('click', () => {
            openStorePopup(s);
            map.setView([lat, lng], 15);
        });

        markers.push(m);
    });
}

// --- SIDEBAR / POPUP ---
function openStorePopup(store) {
    currentStore = store;
    const popup = document.getElementById('custom-popup');
    popup.classList.add('open');
    popup.classList.remove('show-detail');

    document.getElementById('popup-title').innerText = store.Store_Name || store.Name;
    document.getElementById('popup-address').innerText = store.Address || 'Chưa cập nhật địa chỉ';

    switchTab(currentTab || 'violations');
}

function closePopup() {
    document.getElementById('custom-popup').classList.remove('open');
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.popup-tab').forEach(el => el.classList.remove('active'));
    document.querySelector(`.popup-tab.${tab}`).classList.add('active');

    const list = tab === 'violations' ? currentStore.violations : currentStore.highlights;
    const body = document.getElementById('popup-body');

    if (!list || list.length === 0) {
        body.innerHTML = '<div style="text-align:center; padding:40px; opacity:0.5;">Không có dữ liệu.</div>';
        return;
    }

    body.innerHTML = list.map(item => `
    <div class="item-card" onclick="showItemDetail(${JSON.stringify(item).replace(/"/g, '&quot;')})">
      <div class="item-title">
        <span>${item.Type || item['Violation_Type'] || 'Ghi nhận'}</span>
        <span class="item-date">${item.Date || ''}</span>
      </div>
      <div style="font-size:13px; opacity:0.7; line-height:1.4;">${(item.Description || item.Desc || '').substring(0, 60)}...</div>
    </div>
  `).join('');
}

function showItemDetail(item) {
    const body = document.getElementById('detail-body');
    body.innerHTML = Object.entries(item).map(([k, v]) => {
        if (!v || k.startsWith('_')) return '';
        return `<div style="margin-bottom:15px;"><div style="font-size:11px; font-weight:700; opacity:0.5; text-transform:uppercase;">${k}</div><div style="font-size:15px; margin-top:4px; line-height:1.5;">${v}</div></div>`;
    }).join('');

    document.getElementById('view-detail').style.transform = 'translateX(0)';
}

function backToList() {
    document.getElementById('view-detail').style.transform = 'translateX(100%)';
}

function setDisplayFilter(filter) {
    currentDisplayFilter = filter;
    document.querySelectorAll('.filter-option').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');
    renderMarkers();
}

function handleSearch(query) {
    clearTimeout(searchTimeout);
    const results = document.getElementById('search-results');
    if (!query.trim()) { results.classList.remove('active'); return; }

    searchTimeout = setTimeout(() => {
        const q = query.toLowerCase();
        const matches = STORES_DATA.filter(s => (s.Store_Name || s.Name || '').toLowerCase().includes(q) || (s.Address || '').toLowerCase().includes(q)).slice(0, 10);

        results.innerHTML = matches.map(s => `
            <div class="search-item" onclick="selectSearchStore('${s.ID || s.Store_ID}')">
                <div style="font-weight:600;">${s.Store_Name || s.Name}</div>
                <div class="sub-text">${s.Address || ''}</div>
            </div>
        `).join('');
        results.classList.add('active');
    }, 300);
}

function selectSearchStore(id) {
    const store = STORES_DATA.find(s => (s.ID || s.Store_ID || '').toString() === id.toString());
    if (store) {
        map.setView([parseFloat(store.Latitude || store.Lat), parseFloat(store.Longitude || store.Lng)], 16);
        openStorePopup(store);
        document.getElementById('store-search').value = '';
        document.getElementById('search-results').classList.remove('active');
    }
}

// --- THEME & ANIMATIONS ---
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

const THEMES = [
    { id: 'dark', icon: '🌙', name: 'Tối' },
    { id: 'tet', icon: '🧧', name: 'Tết' },
    { id: 'spring', icon: '🌸', name: 'Xuân' },
    { id: 'summer', icon: '🌊', name: 'Hạ' },
    { id: 'autumn', icon: '🍂', name: 'Thu' },
    { id: 'winter', icon: '❄️', name: 'Đông' }
];

document.getElementById('theme-toggle-btn').onclick = () => {
    const curr = document.documentElement.getAttribute('data-theme');
    const idx = THEMES.findIndex(t => t.id === curr);
    const next = THEMES[(idx + 1) % THEMES.length];
    applyTheme(next.id);
    localStorage.setItem('theme', next.id);
};

function startSeasonalDecorations() {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark') return;

    const config = {
        tet: { char: '🧧', count: 12 },
        spring: { char: '🌸', count: 15 },
        summer: { char: '🌊', count: 0 }, // No animation for summer
        autumn: { char: '🍂', count: 20 },
        winter: { char: '❄️', count: 30 }
    };

    const item = config[theme];
    if (!item || item.count === 0) return;

    for (let i = 0; i < item.count; i++) {
        createDecoration(item.char, theme);
    }
}

function createDecoration(char, theme) {
    const el = document.createElement('div');
    el.className = 'decoration';
    el.innerText = char;
    el.style.left = Math.random() * 100 + 'vw';
    el.style.fontSize = (Math.random() * 20 + 10) + 'px';
    el.style.opacity = Math.random() * 0.5 + 0.3;
    el.style.animationName = theme === 'winter' ? 'snow' : 'fall';
    el.style.animationDuration = (Math.random() * 10 + 5) + 's';
    el.style.animationDelay = (Math.random() * 10) + 's';
    el.style.animationIterationCount = 'infinite';
    document.body.appendChild(el);
}

// --- NAVIGATION ---
function scrollToSection(id) {
    const el = document.getElementById(id);
    if (el) {
        const y = el.getBoundingClientRect().top + window.pageYOffset - 60;
        window.scrollTo({ top: y, behavior: 'smooth' });
    }
}

window.addEventListener('scroll', () => {
    const y = window.scrollY + 100;
    const sections = ['home-section', 'map-section', 'report-section'];
    const items = document.querySelectorAll('.nav-item');

    sections.forEach((id, i) => {
        const sec = document.getElementById(id);
        if (!sec) return;
        if (y >= sec.offsetTop && y < sec.offsetTop + sec.offsetHeight) {
            items.forEach(it => it.classList.remove('active'));
            if (items[i]) items[i].classList.add('active');
        }
    });
});

function toggleMobileSidebar() {
    document.querySelector('.sidebar').classList.toggle('open');
}
