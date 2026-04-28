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

export function toggleMenu() {
    const panel = document.getElementById('menuPanel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) verifyPremiumStatus();
}

export function applyTheme(themeId) {
    themesList.forEach(t => document.body.classList.remove(t.id));
    if (themeId !== "theme-black") document.body.classList.add(themeId);
    localStorage.setItem("imagifhub-theme", themeId);
}

export function getUserColors() {
    return {
        bg: localStorage.getItem('user_bg') || '#000000',
        text: localStorage.getItem('user_text') || '#ffffff',
        accent: localStorage.getItem('user_accent') || '#9c4dff',
    };
}

export function applyUserColors() {
    const colors = getUserColors();
    document.documentElement.style.setProperty('--bg', colors.bg);
    document.documentElement.style.setProperty('--text', colors.text);
    document.documentElement.style.setProperty('--accent', colors.accent);
    document.documentElement.style.setProperty('--bar', colors.bg === '#000000' ? '#1a1a1a' : '#2a2a2a');
}

export function saveUserColors(bg, text, accent) {
    if (bg) localStorage.setItem('user_bg', bg);
    if (text) localStorage.setItem('user_text', text);
    if (accent) localStorage.setItem('user_accent', accent);
    applyUserColors();
}

export function initCollapsibles() {
    document.querySelectorAll('.collapsible').forEach(coll => {
        const header = coll.querySelector('.collapsible-header');
        if (header) {
            header.addEventListener('click', () => {
                coll.classList.toggle('open');
            });
        }
    });
}

let searchBarOpen = false;
export function toggleSearchBar() {
    const bar = document.getElementById('searchBar');
    if (!bar) return;
    searchBarOpen = !searchBarOpen;
    bar.classList.toggle('open', searchBarOpen);
    if (searchBarOpen) {
        document.getElementById('searchInput')?.focus();
    }
}

export function performSearch() {
    const query = document.getElementById('searchInput')?.value.trim();
    if (query) {
        toggleSearchBar();
        window.loadFeed(state.currentCategory, query, true);
    }
}

export function clearSearch() {
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    if (state.activeSearchQuery) {
        window.loadFeed(state.currentCategory, '', true);
    }
    toggleSearchBar();
}

export function initFab() {
    const fab = document.getElementById('fabTop');
    if (!fab) return;
    let swiper = state.activeSwiper;
    if (!swiper) return;
    const checkVisibility = () => {
        if (swiper.activeIndex > 3) fab.classList.add('visible');
        else fab.classList.remove('visible');
    };
    swiper.on('slideChange', checkVisibility);
    fab.addEventListener('click', () => {
        swiper.slideTo(0, 500);
        setTimeout(() => fab.classList.remove('visible'), 500);
    });
    checkVisibility();
}

export function triggerSearch() {
    toggleSearchBar();
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
    document.getElementById('menuPanel')?.classList.remove('open');
    document.getElementById('premiumModal')?.classList.add('active');
}

export function closePremium() {
    document.getElementById('premiumModal')?.classList.remove('active');
}

export function openCopyright() {
    document.getElementById('menuPanel')?.classList.remove('open');
    document.getElementById('copyrightModal')?.classList.add('active');
}

export function closeCopyright() {
    document.getElementById('copyrightModal')?.classList.remove('active');
}

export function openPrivacy() {
    document.getElementById('menuPanel')?.classList.remove('open');
    document.getElementById('privacyModal')?.classList.add('active');
}

export function closePrivacy() {
    document.getElementById('privacyModal')?.classList.remove('active');
}

export function copyUserId() {
    const userIdElem = document.getElementById('userId');
    if (!userIdElem) return;
    const userId = userIdElem.innerText;
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

export function initUI() {
    applyDarkText();
    updateDarkTextIndicator();
    applyUserColors();
    initCollapsibles();
    const savedTheme = localStorage.getItem("imagifhub-theme") || "theme-black";
    applyTheme(savedTheme);
    
    const themeGrid = document.getElementById('themeGrid');
    if (themeGrid) {
        themeGrid.innerHTML = themesList.map(t => `
            <div class="theme-circle" onclick="window.applyTheme('${t.id}')">
                <div style="background:${t.top}"></div>
                <div style="background:${t.bottom}"></div>
            </div>
        `).join('');
    }
    
    const colors = getUserColors();
    const bgPicker = document.getElementById('colorBg');
    const textPicker = document.getElementById('colorText');
    const accentPicker = document.getElementById('colorAccent');
    if (bgPicker) bgPicker.value = colors.bg;
    if (textPicker) textPicker.value = colors.text;
    if (accentPicker) accentPicker.value = colors.accent;
}
