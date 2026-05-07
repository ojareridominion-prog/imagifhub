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
    // Remove # if present
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

    // Safety: guarantee that overlay loses pointer events when closed
    if (!panel.classList.contains('open')) {
        overlay.style.pointerEvents = 'none';
        overlay.style.visibility = 'hidden';
    } else {
        overlay.style.pointerEvents = '';
        overlay.style.visibility = '';
    }
}

// Close menu when clicking on overlay
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
    const barColor = darkenColor(baseColor, 30); // 30% darker
    document.body.style.setProperty('--bar', barColor);
    localStorage.setItem('imagifhub_custom_bg', baseColor);
    localStorage.removeItem('imagifhub-theme'); // clear old theme preset
}

// Apply custom accent color
function setCustomAccent(color) {
    document.body.style.setProperty('--accent', color);
    localStorage.setItem('imagifhub_custom_accent', color);
}

// Apply custom text color
function setCustomText(color) {
    document.body.style.setProperty('--text', color);
    localStorage.setItem('imagifhub_custom_text', color);
}

// Load saved custom settings on startup
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

// Populate color swatches based on current mode
function populateColorPalette(mode) {
    const container = document.getElementById('colorPalette');
    if (!container) return;

    // For all modes, use the same COLOR_PALETTE
    const colors = COLOR_PALETTE.map(c => ({ color: c }));

    container.innerHTML = colors.map(item => `
        <div class="color-swatch" style="background-color: ${item.color};" data-color="${item.color}"></div>
    `).join('');

    // Attach click handlers
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

// Initialize custom theme engine UI
function initCustomThemeEngine() {
    const segmentedContainer = document.getElementById('customThemeSegmented');
    if (!segmentedContainer) return;

    // Load saved settings
    loadCustomThemeSettings();

    // Set up segmented control
    segmentedContainer.querySelectorAll('.theme-seg-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (!mode) return;
            // Update active class
            segmentedContainer.querySelectorAll('.theme-seg-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentThemeMode = mode;
            populateColorPalette(mode);
        });
    });

    // Initial population for default mode (theme)
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
    // Remove global click listener
    if (globalClickHandler) {
        document.removeEventListener('click', globalClickHandler);
        globalClickHandler = null;
    }
    // Clear input value
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

    // Focus input after panel opens
    setTimeout(() => {
        const input = document.getElementById('searchInput');
        if (input) input.focus();
    }, 100);

    // Set up global click listener to close when clicking outside
    if (globalClickHandler) document.removeEventListener('click', globalClickHandler);
    globalClickHandler = (e) => {
        if (!searchPanelOpen) return;
        const panel = document.getElementById('searchPanel');
        const searchBtn = document.getElementById('searchBtn');
        // If click is inside panel or on search button, don't close
        if (panel && panel.contains(e.target)) return;
        if (searchBtn && searchBtn.contains(e.target)) return;
        // Otherwise close
        closeSearchPanel();
    };
    document.addEventListener('click', globalClickHandler);
}

function performSearch() {
    const input = document.getElementById('searchInput');
    const query = input.value.trim();
    if (query === "") return;

    // Close search panel
    closeSearchPanel();

    // FIX: Search across ALL categories – force category to "Discover"
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

// Initialize search panel event listeners
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
        // Prevent click propagation to document when clicking inside input
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

    // Load custom theme settings (background, accent, text)
    loadCustomThemeSettings();

    // Initialize custom theme engine (replaces old theme grid)
    initCustomThemeEngine();

    // Initialize menu overlay click handler
    initMenuOverlay();

    // Initialize search panel
    initSearchPanel();
                }
