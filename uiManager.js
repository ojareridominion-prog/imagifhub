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

export function applyTheme(themeId) {
    themesList.forEach(t => document.body.classList.remove(t.id));
    if (themeId !== "theme-black") document.body.classList.add(themeId);
    localStorage.setItem("imagifhub-theme", themeId);
}

// OLD triggerSearch replaced by expandable panel – we keep the name but implement new behavior
export function triggerSearch() {
    // This function is now handled by the search panel; we can keep empty or call toggleSearchPanel
    toggleSearchPanel();
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
    searchBtn.innerHTML = '✖';
    searchPanelOpen = true;
    // Focus input after animation
    setTimeout(() => {
        const input = document.getElementById('searchInput');
        if (input) input.focus();
    }, 200);
    // Add global click listener to close when clicking outside
    document.addEventListener('click', handleOutsideClickForSearch);
    document.addEventListener('keydown', handleEscKeyForSearch);
}

export function closeSearchPanel() {
    const panel = document.getElementById('searchPanel');
    const searchBtn = document.getElementById('searchBtn');
    if (!panel) return;
    panel.classList.remove('open');
    searchBtn.innerHTML = '🔍';
    searchPanelOpen = false;
    // Clear input
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    // Remove event listeners
    document.removeEventListener('click', handleOutsideClickForSearch);
    document.removeEventListener('keydown', handleEscKeyForSearch);
}

function handleOutsideClickForSearch(e) {
    const panel = document.getElementById('searchPanel');
    const searchBtn = document.getElementById('searchBtn');
    // If click is inside panel or on search button, do nothing
    if (panel.contains(e.target) || searchBtn.contains(e.target)) return;
    closeSearchPanel();
}

function handleEscKeyForSearch(e) {
    if (e.key === 'Escape') {
        closeSearchPanel();
    }
}

export function performSearch() {
    const input = document.getElementById('searchInput');
    const query = input.value.trim();
    if (!query) return;
    // Perform search using loadFeed
    resetAndLoadFeed("Discover", query, true); // skip ad if premium? skipAd = true? We'll use true to avoid extra ad
    closeSearchPanel();
}

export function shareBot() {
    const shareData = {
        title: 'IMAGIFHUB',
        text: '‎SnapShot 📸 - Your vibe, your view. Swipe, zoom, vibe 🎉. Effortless image magic ✨. 😊‎',
        url: 'https://t.me/IMAGIFHUB_bot'
    };
    try {
        if (navigator.share) navigator.share(shareData);
        else {
            navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
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
    
    // Set up search panel event listeners (button and submit)
    const searchBtn = document.getElementById('searchBtn');
    const searchSubmit = document.getElementById('searchSubmitBtn');
    if (searchBtn) {
        searchBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSearchPanel();
        };
    }
    if (searchSubmit) {
        searchSubmit.onclick = (e) => {
            e.preventDefault();
            performSearch();
        };
    }
    // Also listen for Enter key in input
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
