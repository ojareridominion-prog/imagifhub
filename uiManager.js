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
        // Close search panel if open when opening menu
        closeSearchPanel();
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

export function applyTheme(themeId) {
    themesList.forEach(t => document.body.classList.remove(t.id));
    if (themeId !== "theme-black") document.body.classList.add(themeId);
    localStorage.setItem("imagifhub-theme", themeId);
}

// ==================== EXPANDABLE SEARCH PANEL ====================
let isSearchPanelOpen = false;
let searchCloseHandler = null;

function closeSearchPanel() {
    const panel = document.getElementById('searchPanel');
    const catBar = document.getElementById('catBar');
    const searchBtn = document.getElementById('searchBtn');
    if (!panel || !catBar || !searchBtn) return;
    
    panel.classList.remove('active');
    catBar.classList.remove('search-hidden');
    searchBtn.innerText = '🔍';
    isSearchPanelOpen = false;
    
    // Remove global click listener
    if (searchCloseHandler) {
        document.removeEventListener('click', searchCloseHandler);
        searchCloseHandler = null;
    }
    // Remove escape listener
    document.removeEventListener('keydown', handleEscape);
}

function openSearchPanel() {
    const panel = document.getElementById('searchPanel');
    const catBar = document.getElementById('catBar');
    const searchBtn = document.getElementById('searchBtn');
    const input = document.getElementById('searchInput');
    if (!panel || !catBar || !searchBtn) return;
    
    // If already open, just focus
    if (isSearchPanelOpen) {
        input?.focus();
        return;
    }
    
    panel.classList.add('active');
    catBar.classList.add('search-hidden');
    searchBtn.innerText = '✕';
    isSearchPanelOpen = true;
    
    // Focus input after animation
    setTimeout(() => input?.focus(), 100);
    
    // Setup global close on outside click
    if (searchCloseHandler) document.removeEventListener('click', searchCloseHandler);
    searchCloseHandler = (e) => {
        const target = e.target;
        // Don't close if click is inside panel or on search button
        if (target.closest('#searchPanel') || target.id === 'searchBtn') return;
        closeSearchPanel();
    };
    document.addEventListener('click', searchCloseHandler);
    
    // Escape key
    document.removeEventListener('keydown', handleEscape);
    document.addEventListener('keydown', handleEscape);
}

function handleEscape(e) {
    if (e.key === 'Escape' && isSearchPanelOpen) {
        closeSearchPanel();
    }
}

function submitSearch() {
    const input = document.getElementById('searchInput');
    const query = input.value.trim();
    if (query) {
        // Close panel and trigger search
        closeSearchPanel();
        resetAndLoadFeed(state.currentCategory, query);
    } else {
        // If empty, just close
        closeSearchPanel();
    }
}

export function triggerSearch() {
    // Toggle search panel
    if (isSearchPanelOpen) {
        closeSearchPanel();
    } else {
        openSearchPanel();
    }
}

// Expose globally
window.triggerSearch = triggerSearch;
window.closeSearchPanel = closeSearchPanel;

// Initialize search button listener
function initSearchPanel() {
    const searchBtn = document.getElementById('searchBtn');
    const submitBtn = document.getElementById('searchSubmitBtn');
    const searchInput = document.getElementById('searchInput');
    if (searchBtn) {
        // Remove any existing inline onclick, use our listener
        searchBtn.onclick = (e) => {
            e.stopPropagation();
            triggerSearch();
        };
    }
    if (submitBtn) {
        submitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            submitSearch();
        });
    }
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitSearch();
            }
        });
    }
}
// ================================================================

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
    applyTheme(savedTheme);
    // Build theme grid
    document.getElementById('themeGrid').innerHTML = themesList.map(t => `
        <div class="theme-circle" onclick="applyTheme('${t.id}')">
            <div style="background:${t.top}"></div>
            <div style="background:${t.bottom}"></div>
        </div>
    `).join('');
    
    // Initialize menu overlay click handler
    initMenuOverlay();
    
    // Initialize search panel
    initSearchPanel();
        }
