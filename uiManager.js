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

// ==================== MENU ====================
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

// ==================== THEME ====================
export function applyTheme(themeId) {
    themesList.forEach(t => document.body.classList.remove(t.id));
    if (themeId !== "theme-black") document.body.classList.add(themeId);
    localStorage.setItem("imagifhub-theme", themeId);
}

// ==================== EXPANDABLE SEARCH PANEL ====================
let searchPanelOpen = false;

export function toggleSearchPanel() {
    if (searchPanelOpen) {
        closeSearchPanel();
    } else {
        openSearchPanel();
    }
}

function openSearchPanel() {
    const panel = document.getElementById('searchPanel');
    const searchBtn = document.getElementById('searchBtn');
    if (!panel) return;
    panel.classList.add('open');
    if (searchBtn) searchBtn.innerHTML = '✖';
    searchPanelOpen = true;
    setTimeout(() => {
        const input = document.getElementById('searchInput');
        if (input) input.focus();
    }, 200);
    document.addEventListener('click', handleOutsideClickForSearch);
    document.addEventListener('keydown', handleEscKeyForSearch);
}

export function closeSearchPanel() {
    const panel = document.getElementById('searchPanel');
    const searchBtn = document.getElementById('searchBtn');
    if (!panel) return;
    panel.classList.remove('open');
    if (searchBtn) searchBtn.innerHTML = '🔍';
    searchPanelOpen = false;
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    document.removeEventListener('click', handleOutsideClickForSearch);
    document.removeEventListener('keydown', handleEscKeyForSearch);
}

function handleOutsideClickForSearch(e) {
    const panel = document.getElementById('searchPanel');
    const searchBtn = document.getElementById('searchBtn');
    if (!panel) return;
    if (panel.contains(e.target) || (searchBtn && searchBtn.contains(e.target))) return;
    closeSearchPanel();
}

function handleEscKeyForSearch(e) {
    if (e.key === 'Escape') closeSearchPanel();
}

export function performSearch() {
    const input = document.getElementById('searchInput');
    const query = input.value.trim();
    if (!query) return;
    resetAndLoadFeed("Discover", query, true);
    closeSearchPanel();
}

// ==================== SHARE ====================
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

// ==================== MODALS ====================
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
    if (!userIdSpan) return;
    const userId = userIdSpan.innerText;
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

// ==================== DARK TEXT ====================
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

// ==================== INITIALIZATION ====================
export function initUI() {
    // Apply dark text
    applyDarkText();
    updateDarkTextIndicator();

    // Apply saved theme
    const savedTheme = localStorage.getItem("imagifhub-theme") || "theme-black";
    applyTheme(savedTheme);

    // Build theme grid
    const themeGrid = document.getElementById('themeGrid');
    if (themeGrid) {
        themeGrid.innerHTML = themesList.map(t => `
            <div class="theme-circle" onclick="applyTheme('${t.id}')">
                <div style="background:${t.top}"></div>
                <div style="background:${t.bottom}"></div>
            </div>
        `).join('');
    }

    // Menu overlay close on click
    initMenuOverlay();

    // --- Search panel event binding ---
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        // Remove any existing listener to avoid duplicates
        searchBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSearchPanel();
        };
    }

    const searchSubmit = document.getElementById('searchSubmitBtn');
    if (searchSubmit) {
        searchSubmit.onclick = (e) => {
            e.preventDefault();
            performSearch();
        };
    }

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch();
            }
        });
    }
}

// --- Legacy triggerSearch (compatibility) ---
export function triggerSearch() {
    toggleSearchPanel();
}
