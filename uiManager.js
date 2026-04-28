// uiManager.js
import { state } from './state.js';
import { resetAndLoadFeed } from './feedManager.js';
import { verifyPremiumStatus } from './premiumManager.js';

export function toggleMenu() {
  const panel = document.getElementById('menuPanel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) verifyPremiumStatus();
}

// --- Color management ---
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
  // Also update bar to match background slightly lighter
  document.documentElement.style.setProperty('--bar', colors.bg === '#000000' ? '#1a1a1a' : '#2a2a2a');
}

export function saveUserColors(bg, text, accent) {
  if (bg) localStorage.setItem('user_bg', bg);
  if (text) localStorage.setItem('user_text', text);
  if (accent) localStorage.setItem('user_accent', accent);
  applyUserColors();
}

// --- Collapsible sections ---
export function initCollapsibles() {
  document.querySelectorAll('.collapsible').forEach(coll => {
    const header = coll.querySelector('.collapsible-header');
    header.addEventListener('click', () => {
      coll.classList.toggle('open');
    });
  });
}

// --- Search Bar UI ---
let searchBarOpen = false;
export function toggleSearchBar() {
  const bar = document.getElementById('searchBar');
  searchBarOpen = !searchBarOpen;
  bar.classList.toggle('open', searchBarOpen);
  if (searchBarOpen) {
    document.getElementById('searchInput').focus();
  }
}

export function performSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (query) {
    toggleSearchBar();
    window.loadFeed(state.currentCategory, query, true);
  }
}

export function clearSearch() {
  document.getElementById('searchInput').value = '';
  if (state.activeSearchQuery) {
    window.loadFeed(state.currentCategory, '', true);
  }
  toggleSearchBar();
}

// --- FAB scroll to top ---
export function initFab() {
  const fab = document.getElementById('fabTop');
  if (!fab) return;
  let swiper = state.activeSwiper;
  if (!swiper) return;
  const checkVisibility = () => {
    if (swiper.activeIndex > 3) {
      fab.classList.add('visible');
    } else {
      fab.classList.remove('visible');
    }
  };
  swiper.on('slideChange', checkVisibility);
  fab.addEventListener('click', () => {
    swiper.slideTo(0, 500);
    setTimeout(() => fab.classList.remove('visible'), 500);
  });
  checkVisibility();
}

// --- Existing UI helpers ---
export function triggerSearch() {
  toggleSearchBar();
}

export async function shareBot() { /* unchanged, keep your existing */ }
export function openPremium() { /* unchanged */ }
export function closePremium() { /* unchanged */ }
export function openCopyright() { /* unchanged */ }
export function closeCopyright() { /* unchanged */ }
export function openPrivacy() { /* unchanged */ }
export function closePrivacy() { /* unchanged */ }
export function copyUserId() { /* unchanged */ }
export function toggleDarkText() { /* unchanged */ }
export function initUI() {
  applyUserColors();
  initCollapsibles();
  // Set color picker values
  const colors = getUserColors();
  const bgPicker = document.getElementById('colorBg');
  const textPicker = document.getElementById('colorText');
  const accentPicker = document.getElementById('colorAccent');
  if (bgPicker) bgPicker.value = colors.bg;
  if (textPicker) textPicker.value = colors.text;
  if (accentPicker) accentPicker.value = colors.accent;
  // Existing dark text and theme stuff (keep but we override with user colors)
  const savedTheme = localStorage.getItem("imagifhub-theme") || "theme-black";
  // We'll not use old themes, but keep for compatibility
  document.body.classList.add(savedTheme);
    }
