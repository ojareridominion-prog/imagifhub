// uiManager.js
import { state } from './state.js';
import { resetAndLoadFeed } from './feedManager.js';
import { verifyPremiumStatus } from './premiumManager.js';

// ==================== CUSTOM THEME ENGINE ====================
const CUSTOM_THEME_KEY = "imagifhub_custom_theme";
let currentMode = "theme"; // 'theme', 'accent', 'text'

// Color palette: black & white first, then 30+ modern colors
const COLOR_PALETTE = [
    "#000000", "#ffffff",           // black, white
    "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff",
    "#ffa500", "#800080", "#ffc0cb", "#a52a2a", "#808080", "#008080",
    "#ff4500", "#2e8b57", "#9400d3", "#ffd700", "#adff2f", "#dc143c",
    "#00bfff", "#32cd32", "#ff1493", "#1e90ff", "#f4a460", "#8b4513",
    "#7f8c8d", "#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#e67e22",
    "#9c4dff", "#ff6b6b", "#4ecdc4", "#ffe66d"
];

function loadCustomSettings() {
    const saved = localStorage.getItem(CUSTOM_THEME_KEY);
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            if (settings.themeColor) document.body.style.setProperty('--bg', settings.themeColor);
            if (settings.accentColor) document.body.style.setProperty('--accent', settings.accentColor);
            if (settings.textColor) document.body.style.setProperty('--text', settings.textColor);
            return;
        } catch(e) { console.warn(e); }
    }
    // Default: black theme (--bg already black, accent #9c4dff, text white)
    document.body.style.setProperty('--bg', '#000000');
    document.body.style.setProperty('--accent', '#9c4dff');
    document.body.style.setProperty('--text', '#ffffff');
}

function saveCustomSettings() {
    const settings = {
        themeColor: document.body.style.getPropertyValue('--bg') || '#000000',
        accentColor: document.body.style.getPropertyValue('--accent') || '#9c4dff',
        textColor: document.body.style.getPropertyValue('--text') || '#ffffff'
    };
    localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(settings));
}

function applyColorToMode(color) {
    switch (currentMode) {
        case 'theme':
            document.body.style.setProperty('--bg', color);
            break;
        case 'accent':
            document.body.style.setProperty('--accent', color);
            break;
        case 'text':
            document.body.style.setProperty('--text', color);
            break;
    }
    saveCustomSettings();
}

function buildColorPalette() {
    const container = document.getElementById('colorPalette');
    if (!container) return;
    container.innerHTML = COLOR_PALETTE.map(hex => `
        <div class="color-swatch" style="background: ${hex};" data-color="${hex}"></div>
    `).join('');
    
    // attach click events
    container.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            const color = swatch.dataset.color;
            applyColorToMode(color);
        });
    });
}

function initSegmentedControl() {
    const container = document.getElementById('themeSegmented');
    if (!container) return;
    const btns = container.querySelectorAll('.seg-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.mode;
        });
    });
}

// ==================== ORIGINAL UI FUNCTIONS (unchanged except removal of old theme grid) ====================
function getMenuOverlay() {
    return document.getElementById('menuOverlay');
}

export function toggleMenu() {
    const panel = document.getElementById('menuPanel');
    const overlay = document.getElementById('menuOverlay');
    if (!panel || !overlay) return;

    const isOpen = panel.classList.contains('open');

    if (!isOpen) {
        panel.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        verifyPremiumStatus();
    } else {
        panel.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    if (!panel.classList.contains('open')) {
        overlay.style.pointerEvents = 'none';
        overlay.style.visibility = 'hidden';
    } else {
        overlay.style.pointerEvents = '';
        overlay.style.visibility = '';
    }
}

function initMenuOverlay() {
    const overlay = getMenuOverlay();
    if (overlay) {
        overlay.addEventListener('click', () => {
            if (document.getElementById('menuPanel').classList.contains('open')) {
                toggleMenu();
            }
        });
    }
}

// Old applyTheme is replaced – we no longer use predefined themes grid
// but keep a no-op to avoid breaking old onclick calls (if any)
window.applyTheme = function(themeId) {
    console.warn("Predefined themes replaced by custom color engine. Use color palette instead.");
};

// ==================== SEARCH PANEL LOGIC (unchanged) ====================
let searchPanelOpen = false;
let globalClickHandler = null;

function closeSearchPanel() {
    if (!searchPanelOpen) return;
    const panel = document.getElementById('searchPanel');
    const searchBtn = document.getElementById('searchBtn');
    if (panel) panel.classList.remove('open');
    if (searchBtn) searchBtn.innerHTML = '🔍';
    document.body.classList.remove('search-open');
    searchPanelOpen = false;
    if (globalClickHandler) {
        document.removeEventListener('click', globalClickHandler);
        globalClickHandler = null;
    }
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
}

function openSearchPanel() {
    if (searchPanelOpen) return;
    const panel = document.getElementById('searchPanel');
    const searchBtn = document.getElementById('searchBtn');
    if (panel) panel.classList.add('open');
    if (searchBtn) searchBtn.innerHTML = '✕';
    document.body.classList.add('search-open');
    searchPanelOpen = true;
    setTimeout(() => {
        const input = document.getElementById('searchInput');
        if (input) input.focus();
    }, 100);
    if (globalClickHandler) document.removeEventListener('click', globalClickHandler);
    globalClickHandler = (e) => {
        if (!searchPanelOpen) return;
        const panel = document.getElementById('searchPanel');
        const searchBtn = document.getElementById('searchBtn');
        if (panel && panel.contains(e.target)) return;
        if (searchBtn && searchBtn.contains(e.target)) return;
        closeSearchPanel();
    };
    document.addEventListener('click', globalClickHandler);
}

function performSearch() {
    const input = document.getElementById('searchInput');
    const query = input.value.trim();
    if (query === "") return;
    closeSearchPanel();
    if (window.loadFeed) {
        window.loadFeed("Discover", query, true);
    } else {
        console.warn("loadFeed not available");
    }
}

export function triggerSearch() {
    if (searchPanelOpen) closeSearchPanel();
    else openSearchPanel();
}

function initSearchPanel() {
    const submitBtn = document.getElementById('searchSubmitBtn');
    const searchInput = document.getElementById('searchInput');
    if (submitBtn) {
        submitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            performSearch();
        });
    }
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                performSearch();
            }
        });
        searchInput.addEventListener('click', (e) => e.stopPropagation());
    }
}

export async function shareBot() {
    const shareData = {
        title: 'IMAGIFHUB',
        text: '‎SnapShot 📸 - Your vibe, your view. Swipe, zoom, vibe 🎉. Effortless image magic ✨. 😊‎',
        url: 'https://t.me/IMAGIFHUB_bot'
    };
    try {
        if (navigator.share) await navigator.share(shareData);
        else {
            await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
            alert('Link & Text copied to clipboard!');
        }
    } catch (err) { console.log('Error sharing:', err); }
}

export function openPremium() {
    const panel = document.getElementById('menuPanel');
    const overlay = getMenuOverlay();
    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    document.getElementById('premiumModal').classList.add('active');
}

export function closePremium() {
    document.getElementById('premiumModal').classList.remove('active');
}

export function openCopyright() {
    const panel = document.getElementById('menuPanel');
    const overlay = getMenuOverlay();
    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    document.getElementById('copyrightModal').classList.add('active');
}

export function closeCopyright() {
    document.getElementById('copyrightModal').classList.remove('active');
}

export function openPrivacy() {
    const panel = document.getElementById('menuPanel');
    const overlay = getMenuOverlay();
    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    document.getElementById('privacyModal').classList.add('active');
}

export function closePrivacy() {
    document.getElementById('privacyModal').classList.remove('active');
}

export function copyUserId() {
    const userId = document.getElementById('userId').innerText;
    if (userId && userId !== '-') {
        navigator.clipboard.writeText(userId).then(() => {
            const btn = document.getElementById('copyIdBtn');
            const originalText = btn.innerText;
            btn.innerText = '✅ Copied!';
            setTimeout(() => { btn.innerText = originalText; }, 1500);
        }).catch(err => console.error('Failed to copy: ', err));
    }
}

export function toggleDarkText() {
    state.darkTextEnabled = !state.darkTextEnabled;
    localStorage.setItem('imagifhub-darktext', state.darkTextEnabled);
    applyDarkText();
    updateDarkTextIndicator();
}

function applyDarkText() {
    document.body.classList.toggle('dark-text', state.darkTextEnabled);
}

function updateDarkTextIndicator() {
    const indicator = document.getElementById('darkTextIndicator');
    if (indicator) indicator.innerText = state.darkTextEnabled ? 'ON' : 'OFF';
}

export function initUI() {
    applyDarkText();
    updateDarkTextIndicator();
    
    // Initialize custom theme engine (replaces old theme grid)
    loadCustomSettings();
    buildColorPalette();
    initSegmentedControl();
    
    initMenuOverlay();
    initSearchPanel();
            }
