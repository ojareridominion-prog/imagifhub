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

function getMenuOverlay() {
    return document.getElementById('menuOverlay');
}

// ----- SEARCH PANEL STATE -----
let isSearchPanelOpen = false;
let searchCloseHandler = null;

// ----- CLOSE SEARCH PANEL (defined first so it can be used anywhere) -----
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

// ----- OPEN SEARCH PANEL -----
function openSearchPanel() {
    const panel = document.getElementById('searchPanel');
    const catBar = document.getElementById('catBar');
    const searchBtn = document.getElementById('searchBtn');
    const input = document.getElementById('searchInput');
    if (!panel || !catBar || !searchBtn) return;
    
    if (isSearchPanelOpen) {
        input?.focus();
        return;
    }
    
    panel.classList.add('active');
    catBar.classList.add('search-hidden');
    searchBtn.innerText = '✕';
    isSearchPanelOpen = true;
    
    setTimeout(() => input?.focus(), 100);
    
    if (searchCloseHandler) document.removeEventListener('click', searchCloseHandler);
    searchCloseHandler = (e) => {
        const target = e.target;
        if (target.closest('#searchPanel') || target.id === 'searchBtn') return;
        closeSearchPanel();
    };
    document.addEventListener('click', searchCloseHandler);
    
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
    const query = input ? input.value.trim() : '';
    if (query) {
        closeSearchPanel();
        resetAndLoadFeed(state.currentCategory, query);
    } else {
        closeSearchPanel();
    }
}

// ----- TRIGGER SEARCH (toggle) -----
export function triggerSearch() {
    if (isSearchPanelOpen) {
        closeSearchPanel();
    } else {
        openSearchPanel();
    }
}

// Expose for global use (if needed)
window.triggerSearch = triggerSearch;
window.closeSearchPanel = closeSearchPanel;

// ----- MENU TOGGLE (now safe because closeSearchPanel already exists) -----
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
        // Close search panel if open
        if (typeof closeSearchPanel === 'function') closeSearchPanel();
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
            const panel = document.getElementById('menuPanel');
            if (panel && panel.classList.contains('open')) {
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

// ----- SHARE BOT -----
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

// ----- PREMIUM MODALS -----
export function openPremium() {
    const panel = document.getElementById('menuPanel');
    const overlay = getMenuOverlay();
    if (panel && panel.classList.contains('open')) {
        panel.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    const modal = document.getElementById('premiumModal');
    if (modal) modal.classList.add('active');
}

export function closePremium() {
    const modal = document.getElementById('premiumModal');
    if (modal) modal.classList.remove('active');
}

export function openCopyright() {
    const panel = document.getElementById('menuPanel');
    const overlay = getMenuOverlay();
    if (panel && panel.classList.contains('open')) {
        panel.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    const modal = document.getElementById('copyrightModal');
    if (modal) modal.classList.add('active');
}

export function closeCopyright() {
    const modal = document.getElementById('copyrightModal');
    if (modal) modal.classList.remove('active');
}

export function openPrivacy() {
    const panel = document.getElementById('menuPanel');
    const overlay = getMenuOverlay();
    if (panel && panel.classList.contains('open')) {
        panel.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    const modal = document.getElementById('privacyModal');
    if (modal) modal.classList.add('active');
}

export function closePrivacy() {
    const modal = document.getElementById('privacyModal');
    if (modal) modal.classList.remove('active');
}

export function copyUserId() {
    const userIdSpan = document.getElementById('userId');
    const userId = userIdSpan ? userIdSpan.innerText : '';
    if (userId && userId !== '-') {
        navigator.clipboard.writeText(userId).then(() => {
            const btn = document.getElementById('copyIdBtn');
            if (btn) {
                const originalText = btn.innerText;
                btn.innerText = '✅ Copied!';
                setTimeout(() => { btn.innerText = originalText; }, 1500);
            }
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

// ----- INITIALIZE UI -----
function initSearchPanel() {
    const searchBtn = document.getElementById('searchBtn');
    const submitBtn = document.getElementById('searchSubmitBtn');
    const searchInput = document.getElementById('searchInput');
    if (searchBtn) {
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

export function initUI() {
    applyDarkText();
    updateDarkTextIndicator();
    const savedTheme = localStorage.getItem("imagifhub-theme") || "theme-black";
    applyTheme(savedTheme);
    
    const themeGrid = document.getElementById('themeGrid');
    if (themeGrid) {
        themeGrid.innerHTML = themesList.map(t => `
            <div class="theme-circle" onclick="applyTheme('${t.id}')">
                <div style="background:${t.top}"></div>
                <div style="background:${t.bottom}"></div>
            </div>
        `).join('');
    }
    
    initMenuOverlay();
    initSearchPanel();
                                     }
