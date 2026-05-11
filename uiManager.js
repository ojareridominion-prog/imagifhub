// uiManager.js
import { state } from './state.js';
import { resetAndLoadFeed } from './feedManager.js';
import { verifyPremiumStatus } from './premiumManager.js';

// Extended color palette for Theme, Accent & Text modes (30+ colors)
const COLOR_PALETTE = [
    "#000000", "#ffffff", // black and white first
    "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff",
    "#ff4500", "#ff8c00", "#ffd700", "#adff2f", "#32cd32", "#3cb371",
    "#20b2aa", "#4682b4", "#4169e1", "#6a5acd", "#8a2be2", "#c71585",
    "#db7093", "#ff69b4", "#ffb6c1", "#ffa07a", "#f08080", "#e9967a",
    "#f5deb3", "#f0e68c", "#bdb76b", "#d3d3d3", "#a9a9a9", "#808080",
    "#696969", "#2f4f4f", "#1e1e1e", "#4a4a4a", "#9c4dff", "#ff6b6b",
    "#4ecdc4", "#ffe66d", "#ff9f1c", "#2ec4b6", "#e71d36", "#011627"
];

let currentThemeMode = "theme"; // 'theme', 'accent', 'text'

// Helper: darken a hex color by percent (0-100)
function darkenColor(hex, percent) {
    hex = hex.replace('#', '');
    let r = parseInt(hex.substring(0,2), 16);
    let g = parseInt(hex.substring(2,4), 16);
    let b = parseInt(hex.substring(4,6), 16);
    r = Math.floor(r * (1 - percent / 100));
    g = Math.floor(g * (1 - percent / 100));
    b = Math.floor(b * (1 - percent / 100));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Get menu overlay element
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

// Apply custom theme (background + bar) based on a base color
function applyCustomTheme(baseColor) {
    // Remove any preset theme classes
    document.body.classList.remove(
        'theme-white', 'theme-blood', 'theme-cyan', 'theme-sky',
        'theme-orange', 'theme-green', 'theme-violet'
    );
    document.body.style.setProperty('--bg', baseColor);
    const barColor = darkenColor(baseColor, 30);
    document.body.style.setProperty('--bar', barColor);
    localStorage.setItem('imagifhub_custom_bg', baseColor);
    localStorage.removeItem('imagifhub-theme');
}

function setCustomAccent(color) {
    document.body.style.setProperty('--accent', color);
    localStorage.setItem('imagifhub_custom_accent', color);
}

function setCustomText(color) {
    document.body.style.setProperty('--text', color);
    localStorage.setItem('imagifhub_custom_text', color);
}

function loadCustomThemeSettings() {
    const savedBg = localStorage.getItem('imagifhub_custom_bg');
    if (savedBg) {
        document.body.style.setProperty('--bg', savedBg);
        const barColor = darkenColor(savedBg, 30);
        document.body.style.setProperty('--bar', barColor);
    }
    const savedAccent = localStorage.getItem('imagifhub_custom_accent');
    if (savedAccent) document.body.style.setProperty('--accent', savedAccent);
    const savedText = localStorage.getItem('imagifhub_custom_text');
    if (savedText) document.body.style.setProperty('--text', savedText);
}

// Legacy applyTheme for compatibility with script.js
// Converts old theme names to custom background colors
export function applyTheme(themeId) {
    // Remove old theme classes
    document.body.classList.remove(
        'theme-white', 'theme-blood', 'theme-cyan', 'theme-sky',
        'theme-orange', 'theme-green', 'theme-violet'
    );
    
    // Map old theme IDs to background colors
    const themeMap = {
        'theme-white': '#ffffff',
        'theme-blood': '#4a0e0e',
        'theme-cyan': '#001616',
        'theme-sky': '#071824',
        'theme-orange': '#2a1400',
        'theme-green': '#051f13',
        'theme-violet': '#16001f',
        'theme-black': '#000000'
    };
    
    const bgColor = themeMap[themeId] || '#000000';
    applyCustomTheme(bgColor);
    
    // Also save the theme ID for potential future use
    if (themeId !== 'theme-black') {
        localStorage.setItem('imagifhub-theme', themeId);
    } else {
        localStorage.removeItem('imagifhub-theme');
    }
}

function populateColorPalette(mode) {
    const container = document.getElementById('colorPalette');
    if (!container) return;

    const colors = COLOR_PALETTE.map(c => ({ color: c }));
    container.innerHTML = colors.map(item => `
        <div class="color-swatch" style="background-color: ${item.color};" data-color="${item.color}"></div>
    `).join('');

    container.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            const color = swatch.dataset.color;
            if (mode === "theme") {
                applyCustomTheme(color);
            } else if (mode === "accent") {
                setCustomAccent(color);
            } else if (mode === "text") {
                setCustomText(color);
            }
        });
    });
}

function initCustomThemeEngine() {
    const segmentedContainer = document.getElementById('customThemeSegmented');
    if (!segmentedContainer) return;

    loadCustomThemeSettings();

    segmentedContainer.querySelectorAll('.theme-seg-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (!mode) return;
            segmentedContainer.querySelectorAll('.theme-seg-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentThemeMode = mode;
            populateColorPalette(mode);
        });
    });

    populateColorPalette("theme");
}

// ==================== SEARCH PANEL LOGIC ====================
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
    if (searchPanelOpen) {
        closeSearchPanel();
    } else {
        openSearchPanel();
    }
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

// MODIFIED: refresh TON prices before opening premium modal
export function openPremium() {
    // Update TON prices dynamically (if function exists)
    if (window.updateTonPrices) {
        window.updateTonPrices().catch(console.warn);
    }
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
    loadCustomThemeSettings();
    initCustomThemeEngine();
    initMenuOverlay();
    initSearchPanel();
    }
