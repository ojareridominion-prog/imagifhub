// uiManager.js
import { state } from './state.js';
import { resetAndLoadFeed } from './feedManager.js';
import { verifyPremiumStatus } from './premiumManager.js';

const themesList = [
    {id: "theme-black",  top: "#000", bottom: "#000"},
    {id: "theme-white",  top: "#fff", bottom: "#eee"},
    {id: "theme-blood",  top: "#4a0e0e", bottom: "#ff4d4d"},
    {id: "theme-cyan",   top: "#001616", bottom: "#00ffff"},
    {id: "theme-sky",    top: "#071824", bottom: "#7fd6ff"},
    {id: "theme-orange", top: "#2a1400", bottom: "#ff9a3d"},
    {id: "theme-green",  top: "#051f13", bottom: "#66ffb2"},
    {id: "theme-violet", top: "#16001f", bottom: "#f0b3ff"}
];

// Extended color palette for Accent & Text modes (30+ colors)
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

// Legacy applyTheme (kept for compatibility, but custom engine overrides)
export function applyTheme(themeId) {
    themesList.forEach(t => document.body.classList.remove(t.id));
    if (themeId !== "theme-black") document.body.classList.add(themeId);
    localStorage.setItem("imagifhub-theme", themeId);
    // Clear any custom accent/text overrides when applying a full theme
    clearCustomThemeOverrides();
}

// Clear custom accent/text inline styles and storage
function clearCustomThemeOverrides() {
    document.body.style.removeProperty('--accent');
    document.body.style.removeProperty('--text');
    localStorage.removeItem("imagifhub_custom_accent");
    localStorage.removeItem("imagifhub_custom_text");
}

// Apply custom accent color
function setCustomAccent(color) {
    document.body.style.setProperty('--accent', color);
    localStorage.setItem("imagifhub_custom_accent", color);
    // Do not clear theme preset – keep background/bar as is
}

// Apply custom text color
function setCustomText(color) {
    document.body.style.setProperty('--text', color);
    localStorage.setItem("imagifhub_custom_text", color);
}

// Load saved custom settings on startup
function loadCustomThemeSettings() {
    const savedAccent = localStorage.getItem("imagifhub_custom_accent");
    const savedText = localStorage.getItem("imagifhub_custom_text");
    if (savedAccent) document.body.style.setProperty('--accent', savedAccent);
    if (savedText) document.body.style.setProperty('--text', savedText);
    
    // Also load saved theme preset (if any, and no custom override conflicts)
    const savedTheme = localStorage.getItem("imagifhub-theme");
    if (savedTheme && savedTheme !== "theme-black") {
        // Apply theme class without clearing custom overrides (they have higher priority)
        themesList.forEach(t => document.body.classList.remove(t.id));
        document.body.classList.add(savedTheme);
    } else if (!savedTheme || savedTheme === "theme-black") {
        themesList.forEach(t => document.body.classList.remove(t.id));
        // theme-black is default (no class needed)
    }
}

// Populate color swatches based on current mode
function populateColorPalette(mode) {
    const container = document.getElementById('colorPalette');
    if (!container) return;
    
    let colors = [];
    if (mode === "theme") {
        // Theme mode: use representative color (top color) from each preset theme
        colors = themesList.map(theme => ({ color: theme.top, themeId: theme.id }));
    } else {
        // Accent or Text mode: use the full COLOR_PALETTE
        colors = COLOR_PALETTE.map(c => ({ color: c }));
    }
    
    container.innerHTML = colors.map(item => `
        <div class="color-swatch" style="background-color: ${item.color};" 
             data-color="${item.color}" data-theme-id="${item.themeId || ''}"></div>
    `).join('');
    
    // Attach click handlers
    container.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            const color = swatch.dataset.color;
            const themeId = swatch.dataset.themeId;
            if (mode === "theme" && themeId) {
                applyThemePreset(themeId);
            } else if (mode === "accent") {
                setCustomAccent(color);
            } else if (mode === "text") {
                setCustomText(color);
            }
        });
    });
}

// Apply a full theme preset (clears custom accent/text)
function applyThemePreset(themeId) {
    // Remove all theme classes
    themesList.forEach(t => document.body.classList.remove(t.id));
    if (themeId !== "theme-black") document.body.classList.add(themeId);
    localStorage.setItem("imagifhub-theme", themeId);
    // Clear custom overrides
    clearCustomThemeOverrides();
    // Update UI feedback (optional)
    const activeModeBtn = document.querySelector('#customThemeSegmented .theme-seg-option.active');
    if (activeModeBtn && activeModeBtn.dataset.mode === "theme") {
        // if theme mode is active, refresh palette (no change needed)
    }
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
    // The backend endpoint /media/random treats "Discover" as no category filter.
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
    const savedTheme = localStorage.getItem("imagifhub-theme") || "theme-black";
    applyTheme(savedTheme); // will also clear custom overrides (but loadCustomThemeSettings will reapply them if any)
    // Actually we should load custom settings after theme to allow override
    loadCustomThemeSettings();
    
    // Initialize custom theme engine (replaces old theme grid)
    initCustomThemeEngine();
    
    // Initialize menu overlay click handler
    initMenuOverlay();
    
    // Initialize search panel
    initSearchPanel();
        }
