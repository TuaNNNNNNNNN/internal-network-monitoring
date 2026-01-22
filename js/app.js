// Config - Cloud Architecture
// Using OpenSheet for faster JSON access (Edge Cache)
const SHEET_ID = '1wwjXmvOrNn4G7uNdAGPwwa2RpTvfYrRASzAD5PNpbEE';
const MAIL_SHEET_ID = '1Eea0RMfjsrv_JrCadKxdVWvYdsm14riZYtNcuUWOii0';

const JSON_STORES = `https://opensheet.elk.sh/${SHEET_ID}/Stores`;
const JSON_EVENTS = `https://opensheet.elk.sh/${SHEET_ID}/Events`;
const JSON_HIGHLIGHTS = `https://opensheet.elk.sh/${SHEET_ID}/Highlight`;
const JSON_MAIL = `https://opensheet.elk.sh/${MAIL_SHEET_ID}/Mail+YODY`;

// Fallback for News (Unknown tab name, use CSV)
const CSV_HOME = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=165883319`;

// UI Config
const ZOOM_THRESHOLD = 10;

let map, STORES_DATA = [], EVENTS_DATA = [], HIGHLIGHTS_DATA = [], markers = [];
let currentDisplayFilter = 'all';
let searchTimeout;

// Session Check
window.onload = () => {
    const email = localStorage.getItem('yody_user');
    if (email) {
        initDashboard();
    } else {
        if (document.getElementById('loading')) document.getElementById('loading').style.display = 'none';
        if (document.getElementById('login-screen')) document.getElementById('login-screen').style.display = 'flex';
    }
    loadHomeData(); // Run parallel
    initTheme();
};

async function handleLogin() {
    const emailInput = document.getElementById('email-input');
    if (!emailInput) return;
    const email = emailInput.value.trim().toLowerCase();
    const error = document.getElementById('login-error');

    if (!email.endsWith('@yody.vn')) {
        error.textContent = 'Chỉ chấp nhận email @yody.vn';
        error.style.display = 'block';
        return;
    }

    // Set loading state on button
    const btn = document.querySelector('.login-btn');
    const oldText = btn.innerText;
    btn.innerText = 'Đang kiểm tra...';
    btn.disabled = true;

    try {
        const whitelist = await fetchData(JSON_MAIL, 'json');
        // Flatten checks: JSON returns array of objects {Email: "..."} etc.
        // We scan all values in the rows
        const isAuthorized = whitelist.some(row =>
            Object.values(row).some(val => val && val.toString().toLowerCase().trim() === email)
        );

        if (isAuthorized) {
            localStorage.setItem('yody_user', email);
            location.reload();
        } else {
            error.textContent = 'Email không có quyền truy cập';
            error.style.display = 'block';
            btn.innerText = oldText;
            btn.disabled = false;
        }
    } catch (e) {
        console.error(e);
        error.textContent = 'Lỗi kết nối server';
        error.style.display = 'block';
        btn.innerText = oldText;
        btn.disabled = false;
    }
}

async function initDashboard() {
    if (document.getElementById('login-screen')) document.getElementById('login-screen').style.display = 'none';
    if (document.getElementById('loading')) document.getElementById('loading').style.display = 'flex';

    // Init Map
    try {
        if (!map) {
            map = L.map('map', { zoomControl: false }).setView([16.0, 107.5], 6);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
            L.control.zoom({ position: 'bottomleft' }).addTo(map);
        }
    } catch (mapErr) {
        console.error("Map initialization failed:", mapErr);
    }

    // Load Vietnam Border
    try {
        // Cached Fetch with timeout
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject("GeoJSON Timeout"), 5000));
        const fetchPromise = fetch('https://cdn.jsdelivr.net/gh/Vizzuality/growasia_calculator@master/public/vietnam.geojson').then(r => r.json());

        const vnGeoJSON = await Promise.race([fetchPromise, timeoutPromise]);

        L.geoJSON(vnGeoJSON, {
            style: { color: '#00ff88', weight: 2, fillOpacity: 0, opacity: 0.8 }
        }).addTo(map);
    } catch (e) {
        console.warn("Vietnam border fetch failed (non-critical).");
    }

    // Sovereignty: Hoang Sa & Truong Sa
    // PATCH: Cover "Biển Đông" / "South China Sea" label
    const patchIcon = L.divIcon({
        className: 'map-patch',
        html: '<div style="background: #212121; width: 300px; height: 100px; transform: rotate(-25deg); filter: blur(15px); opacity: 0.9;"></div>',
        iconSize: [300, 100],
        iconAnchor: [150, 50]
    });
    L.marker([14.5, 114.0], { icon: patchIcon, interactive: false, zIndexOffset: -100 }).addTo(map);

    const islands = [
        { name: "Quần đảo Hoàng Sa", coords: [16.4, 112.0] },
        { name: "Quần đảo Trường Sa", coords: [10.0, 114.0] }
    ];

    islands.forEach(island => {
        L.marker(island.coords, {
            icon: L.divIcon({
                className: 'map-label',
                html: island.name,
                iconSize: [200, 20],
                iconAnchor: [100, 10]
            }),
            interactive: false
        }).addTo(map);
    });

    // Zoom Listeners (Store Names)
    map.on('zoomend', () => {
        const zoom = map.getZoom();
        if (zoom >= ZOOM_THRESHOLD) {
            document.getElementById('map').classList.add('show-names');
        } else {
            document.getElementById('map').classList.remove('show-names');
        }
    });

    // Load Data
    try {
        await loadData();
    } catch (err) {
        console.error("Dashboard data load failed:", err);
    } finally {
        if (document.getElementById('loading')) {
            document.getElementById('loading').style.display = 'none';
        }
    }
}

async function loadData() {
    try {
        // Parallel Fetch
        const [storesData, eventsData, highlightsData] = await Promise.all([
            fetchData(JSON_STORES, 'json'),
            fetchData(JSON_EVENTS, 'json'),
            fetchData(JSON_HIGHLIGHTS, 'json').catch(() => []) // Optional
        ]);

        // Process Stores: OpenSheet returns Objects automatically
        STORES_DATA = storesData.filter(s => (s.ID || s.id));

        // Process Events: OpenSheet returns Objects
        EVENTS_DATA = eventsData;
        HIGHLIGHTS_DATA = highlightsData;

        // Map events to stores
        // Normalize keys helper
        const getID = (obj) => (obj.ID || obj.id || obj.Store_ID || obj['Store ID'] || '').toString().trim();
        const getStoreID = (obj) => (obj.Store_ID || obj['Store ID'] || obj.StoreID || obj.store_id || '').toString().trim();

        STORES_DATA.forEach(store => {
            const storeID = getID(store);

            // Count violations
            const violations = EVENTS_DATA.filter(event => {
                const eStoreID = getStoreID(event);
                const eID = getID(event); // Fallback if StoreID key is weird, sometimes first col is used?
                // Actually JSON keys are reliable if headers are simple.
                // Fallback check against values if keys fail? 
                // Let's rely on 'Store_ID' or 'ID' column logic from Code.gs which says Col 1 is StoreID.
                // OpenSheet keys = 'Store_ID' usually.
                return eStoreID === storeID;
            });

            const highlights = HIGHLIGHTS_DATA.filter(hl => {
                return getStoreID(hl) === storeID;
            });

            store.violationCount = violations.length;
            store.highlightCount = highlights.length;
            store.violations = violations;
            store.highlights = highlights;
        });

        // console.log('Loaded:', STORES_DATA.length, 'Stores');

        updateStats();
        renderMarkers();
        renderOMStats();
        renderNewsTicker();

    } catch (e) {
        console.error('Data load error:', e);
        // Fallback?
    }
}

async function fetchData(url, type = 'json') {
    // Timeout wrapper
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
        if (type === 'json') {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(id);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } else {
            // CSV via PapaParse (fetched as text then parsed)
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(id);
            const text = await response.text();
            return new Promise((resolve, reject) => {
                Papa.parse(text, {
                    header: true,
                    skipEmptyLines: true,
                    complete: (res) => resolve(res.data),
                    error: (err) => reject(err)
                });
            });
        }
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
}

function renderMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    STORES_DATA.forEach(store => {
        // Filter
        if (currentDisplayFilter === 'violations' && (!store.violationCount || store.violationCount === 0)) return;
        if (currentDisplayFilter === 'clean' && store.violationCount && store.violationCount > 0) return;

        // Process coords
        let lat = parseFloat(store.Latitude || store.Lat || 0);
        let lng = parseFloat(store.Longitude || store.Lng || 0);

        if (isNaN(lat) || isNaN(lng) || lat === 0) return;

        const count = store.violationCount || 0;
        const markerColor = count === 0 ? 'marker-green' :
            count < 3 ? 'marker-yellow' :
                count < 5 ? 'marker-orange' : 'marker-red';

        const icon = L.divIcon({
            className: 'custom-marker',
            html: `<div class="marker-circle ${markerColor}">${count}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const marker = L.marker([lat, lng], { icon }).addTo(map);

        marker.bindTooltip(store.Store_Name || store.Name || 'Cửa hàng', {
            permanent: true,
            direction: 'top',
            className: 'store-label-tooltip',
            offset: [0, -16]
        });

        marker.on('click', () => {
            openStorePopup(store);
            map.setView([lat, lng], 16);
        });

        markers.push(marker);
    });
}

function updateStats() {
    const totalStores = STORES_DATA.length;
    const totalViolations = EVENTS_DATA.length;
    const totalRewards = HIGHLIGHTS_DATA.length;

    if (document.getElementById('stat-total-stores')) document.getElementById('stat-total-stores').innerText = totalStores;
    if (document.getElementById('stat-total-violations')) document.getElementById('stat-total-violations').innerText = totalViolations;
    if (document.getElementById('stat-total-rewards')) document.getElementById('stat-total-rewards').innerText = totalRewards;
}

function renderOMStats() {
    // Sort stores by violations desc
    const sorted = [...STORES_DATA].sort((a, b) => (b.violationCount || 0) - (a.violationCount || 0)).slice(0, 10);
    const container = document.getElementById('om-list');
    if (!container) return;

    container.innerHTML = sorted.map(s => `
        <div class="om-item" onclick="selectSearchStore('${s.ID}')" style="cursor:pointer">
            <span class="om-name">${s.Store_Name || s.Name}</span>
            <span class="om-count" style="background:${s.violationCount > 0 ? 'rgba(244,67,54,0.2)' : 'rgba(0,255,136,0.2)'}; color:${s.violationCount > 0 ? '#ff8a80' : '#69f0ae'}">
                ${s.violationCount || 0}
            </span>
        </div>
    `).join('');
}

function renderNewsTicker() {
    const container = document.getElementById('ticker-content');
    if (!container) return;

    // Use Events or manual highlights
    const items = EVENTS_DATA.slice(0, 5).map(e => {
        const store = STORES_DATA.find(s => getID(s) === getStoreID(e));
        const sName = store ? (store.Store_Name || store.Name) : 'CH #' + getStoreID(e);
        return `<span class="ticker-item"><span class="date">${e.Date || ''}</span> <span class="highlight">[Mới]</span> ${sName}: ${e.Type || 'Ghi nhận sự việc'}</span>`;
    });

    // Fallback static
    if (items.length === 0) {
        container.innerHTML = `<span class="ticker-item">Chào mừng đến với Bản đồ An ninh Nội bộ YODY!</span>`;
    } else {
        container.innerHTML = items.join('');
    }
}

// Helpers for ID access (dup from loadData but needed globally or closured)
function getID(obj) { return (obj.ID || obj.id || obj.Store_ID || obj['Store ID'] || '').toString().trim(); }
function getStoreID(obj) { return (obj.Store_ID || obj['Store ID'] || obj.StoreID || obj.store_id || '').toString().trim(); }

// Popup Logic (Sidebar)
let currentStore = null;
let currentTab = 'violations';

function openStorePopup(store) {
    currentStore = store;
    const popup = document.getElementById('custom-popup');
    popup.classList.add('open');

    // Reset view
    popup.classList.remove('show-detail');

    // Header
    document.getElementById('popup-title').innerText = store.Store_Name || store.Name;
    document.getElementById('popup-address').innerText = store.Address || 'Chưa cập nhật địa chỉ';

    // Switch to current tab
    switchTab('violations');
}

function closePopup() {
    document.getElementById('custom-popup').classList.remove('open');
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.popup-tab').forEach(el => el.classList.remove('active'));
    document.querySelector(`.popup-tab.${tab}`).classList.add('active');

    const list = tab === 'violations' ? currentStore.violations : currentStore.highlights;
    const container = document.getElementById('popup-body');

    if (!list || list.length === 0) {
        container.innerHTML = '<div style="text-align:center; opacity:0.5; margin-top:20px;">Không có dữ liệu</div>';
        return;
    }

    container.innerHTML = list.map(item => `
        <div class="item-card" onclick='showItemDetail(${JSON.stringify(item).replace(/'/g, "&#39;")})'>
            <div class="item-title">
                <span>${item.Type || item['Violation_Type'] || 'Sự việc'}</span>
                <span class="item-date">${item.Date || ''}</span>
            </div>
            <div style="font-size:12px; opacity:0.7; margin-top:4px;">
                ${(item.Description || item.Desc || '').substring(0, 50)}...
            </div>
        </div>
    `).join('');
}

function showItemDetail(item) {
    const detailView = document.getElementById('detail-body');
    detailView.innerHTML = '';

    for (const [k, v] of Object.entries(item)) {
        if (!v || k.startsWith('_')) continue;
        detailView.innerHTML += `
            <div style="margin-bottom:12px;">
                <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase;">${k}</div>
                <div style="font-size:14px;">${v}</div>
            </div>
        `;
    }

    document.getElementById('custom-popup').classList.add('show-detail');
}

function backToList() {
    document.getElementById('custom-popup').classList.remove('show-detail');
}

// Search
function handleSearch(query) {
    clearTimeout(searchTimeout);
    const container = document.getElementById('search-results');

    if (!query.trim()) {
        container.classList.remove('active');
        return;
    }

    searchTimeout = setTimeout(() => {
        const q = query.toLowerCase();
        const matches = STORES_DATA.filter(s => (s.Store_Name || s.Name || '').toLowerCase().includes(q)).slice(0, 10);

        container.innerHTML = matches.length ? matches.map(s => `
            <div class="search-item" onclick="selectSearchStore('${s.ID}')">
                <div>${s.Store_Name || s.Name}</div>
                <div class="sub-text">${s.Address || ''}</div>
            </div>
        `).join('') : '<div class="search-item">Không tìm thấy</div>';

        container.classList.add('active');
    }, 300);
}

function selectSearchStore(id) {
    const store = STORES_DATA.find(s => s.ID.toString() === id.toString());
    if (store) {
        map.setView([parseFloat(store.Latitude || 0), parseFloat(store.Longitude || 0)], 18);
        openStorePopup(store);
        document.getElementById('store-search').value = '';
        document.getElementById('search-results').classList.remove('active');
    }
}

// Home Data (Hybrid CSV)
async function loadHomeData() {
    try {
        const data = await fetchData(CSV_HOME, 'csv');
        // CSV: Array of Objects if header=true.
        // Assuming CSV structure: Category, Title, Excerpt, Detail, Image
        // If header=false, array of arrays.
        // Let's assume header=false based on previous findings? 
        // NOTE: The code in index.html used fetchCSV(CSV, false)!
        // So rawData was array of arrays.
        // My fetchData with 'csv' returns Objects (header=true) by default in my new implementation?
        // Wait, line 236 in part 1: header: true.
        // I should stick to 'header: false' for Home Data if that was the config.
        // But I made fetchData default to true.
        // I'll update loadHomeData to handle Object keys or rewrite fetchData to accept options.
        // Simplest: Just use standard fetch+Papa for this specific case inside here if needed, or rely on keys.
        // Check prev code: `rows.slice(1)` implies headers were row 0.
        // If I use header:true, keys are row 0.
        // So I can map keys.
        // Keys: Category, Title, Excerpt... (Based on col 0, 1, 2...)
        // CSV headers likely: "Category", "Title", ...
        // If headers are missing/messy, header:true is risky.
        // I will overload fetchData to support text-only? 
        // Or just re-implement simple parsing here.

        // Actually, let's just assume headers are valid or use index if keys are unknown?
        // Risky. 
        // Let's use `fetch` directly for CSV_HOME to be safe and set header:false.

        const res = await fetch(CSV_HOME);
        const txt = await res.text();
        const parsed = Papa.parse(txt, { header: false, skipEmptyLines: true });
        const rows = parsed.data; // Array of Arrays

        const valid = rows.slice(1).filter(r => r[1]); // Skip header, check Title

        const posts = valid.map(r => ({
            category: r[0],
            title: r[1],
            excerpt: r[2],
            detail: r[3],
            image: r[4]
        }));

        renderHomeGrid(posts);

    } catch (e) {
        console.error("Home loading error", e);
    }
}

function renderHomeGrid(posts) {
    const grid = document.getElementById('wall-grid');
    if (!grid) return;

    grid.innerHTML = posts.map((p, i) => `
        <div class="news-card" onclick="showNewsDetail(${i})">
            <img src="${cleanImg(p.image)}" class="news-img" onerror="this.src='https://via.placeholder.com/300'">
            <div class="news-content">
                <span class="news-tag">${p.category}</span>
                <div class="news-title">${p.title}</div>
                <div class="news-excerpt">${p.excerpt || ''}</div>
            </div>
        </div>
    `).join('');

    window.HOME_POSTS = posts; // Global for modal
}

function cleanImg(url) {
    if (!url) return 'https://via.placeholder.com/300';
    if (url.includes('google.com/url')) {
        try { return decodeURIComponent(new URL(url).searchParams.get('url')); } catch (e) { }
    }
    const drive = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (drive) return `https://drive.google.com/uc?export=view&id=${drive[1]}`;
    return url;
}

function showNewsDetail(index) {
    const p = window.HOME_POSTS[index];
    const modal = document.getElementById('global-news-modal');
    // Content... (Simplifying for space)
    document.getElementById('global-news-body').innerHTML = `
        <h2>${p.title}</h2>
        <div style="margin-top:10px;">${p.detail || p.excerpt}</div>
    `;
    modal.classList.add('active');
}

function closeNewsModal() {
    document.getElementById('global-news-modal').classList.remove('active');
}

// Theme
function initTheme() {
    const themes = ['dark', 'tet', 'spring', 'summer', 'autumn', 'winter'];
    // Logic for auto-detect (Simplifying)
    const month = new Date().getMonth() + 1;
    let auto = 'dark';
    if (month >= 5 && month <= 7) auto = 'summer';
    else if (month === 1 || month === 2) auto = 'tet';
    // ...

    const saved = localStorage.getItem('theme') || auto;
    document.documentElement.setAttribute('data-theme', saved);

    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.onclick = () => {
        const curr = document.documentElement.getAttribute('data-theme');
        const next = themes[(themes.indexOf(curr) + 1) % themes.length];
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    };
}
