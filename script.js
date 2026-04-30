// script.js - Main entry point
import { musicLibrary, categories } from './music.js';
import { getHolidayImage, getFestiveTitle } from './welcome.js';
import { state } from './state.js';
import { playRandomMusic, toggleMute } from './musicManager.js';
import { fetchNativeAds, setupAdButtonListeners } from './adsManager.js';
import { verifyPremiumStatus, updateWatchAdCard, startTempPremiumCountdown, showRewardedAdWrapper as premiumRewardedWrapper } from './premiumManager.js';
import { loadFeed, resetAndLoadFeed } from './feedManager.js';
import { 
    toggleMenu, applyTheme, triggerSearch, shareBot, 
    openPremium, closePremium, openCopyright, closeCopyright, 
    openPrivacy, closePrivacy, copyUserId, toggleDarkText, initUI, initSearchPanel 
} from './uiManager.js';
import { initGiftSystem, refreshRecentGiftCard, showGiftDrawer } from './giftManager.js';

const API_URL = "https://imagifhub.onrender.com";

// Expose globals for HTML onclick
window.loadFeed = loadFeed;
window.toggleMenu = toggleMenu;
window.toggleMute = toggleMute;
window.triggerSearch = triggerSearch;
window.applyTheme = applyTheme;
window.shareBot = shareBot;
window.openPremium = openPremium;
window.closePremium = closePremium;
window.goPremium = goPremium;
window.verifyPremiumStatus = verifyPremiumStatus;
window.toggleDarkText = toggleDarkText;
window.openCopyright = openCopyright;
window.closeCopyright = closeCopyright;
window.copyUserId = copyUserId;
window.openPrivacy = openPrivacy;
window.closePrivacy = closePrivacy;

// Payment function
async function goPremium() {
    const tg = window.Telegram.WebApp;
    const statusEl = document.getElementById('paymentStatus');
    const btn = document.getElementById('btnBuy');
    if (!tg.openInvoice) {
        statusEl.textContent = "Opening Telegram...";
        const userId = tg.initDataUnsafe?.user?.id;
        if (userId) tg.openLink(`https://t.me/IMAGIFHUB_bot?start=premium_${userId}`);
        return;
    }
    statusEl.textContent = "Creating invoice...";
    btn.disabled = true;
    try {
        const response = await fetch(`${API_URL}/api/create-invoice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Init-Data': tg.initData
            }
        });
        if (!response.ok) throw new Error('Failed to create invoice');
        const data = await response.json();
        tg.openInvoice(data.invoice_link, async (status) => {
            if (status === 'paid') {
                statusEl.textContent = "✅ Payment successful! Activating premium...";
                const isPremium = await verifyPremiumStatus();
                if (isPremium) {
                    statusEl.textContent = "✅ Premium activated!";
                    setTimeout(() => closePremium(), 1500);
                } else statusEl.textContent = "⚠️ Payment received but activation delayed. Please refresh.";
            } else statusEl.textContent = "❌ Payment cancelled or failed";
            btn.disabled = false;
        });
    } catch (error) {
        console.error("Payment error:", error);
        statusEl.textContent = `❌ ${error.message}`;
        btn.disabled = false;
    }
}
window.goPremium = goPremium;

function addManualPremiumCheck() {
    const premiumCard = document.querySelector('.premium-card');
    if (premiumCard) {
        const checkBtn = document.createElement('button');
        checkBtn.className = 'btn-check';
        checkBtn.innerHTML = '🔄 Check Premium Status';
        checkBtn.style.cssText = `background:transparent; color:#4CAF50; border:1px solid #4CAF50; padding:10px; width:100%; border-radius:8px; margin-top:10px; cursor:pointer;`;
        checkBtn.onclick = async () => {
            const statusEl = document.getElementById('paymentStatus');
            statusEl.textContent = "Checking status...";
            const verified = await verifyPremiumStatus();
            if (verified) {
                statusEl.textContent = "✅ Premium is active!";
                statusEl.style.color = "#4CAF50";
            } else {
                statusEl.textContent = "❌ No active premium found";
                statusEl.style.color = "#ff4444";
            }
        };
        premiumCard.appendChild(checkBtn);
    }
}

function initWatchAdButton() {
    const watchAdBtn = document.getElementById('watchAdBtn');
    if (watchAdBtn) {
        watchAdBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (watchAdBtn.disabled) return;
            watchAdBtn.disabled = true;
            watchAdBtn.innerText = "⏳ Loading ad...";
            try { await premiumRewardedWrapper(); } catch (err) { console.error(err); }
            finally {
                watchAdBtn.disabled = false;
                watchAdBtn.innerText = "🎥 Watch Ad";
            }
        });
    }
}

// Initialization
window.onload = async () => {
    const tg = window.Telegram.WebApp;
    if (tg && tg.expand) tg.expand();

    await fetchNativeAds();
    await verifyPremiumStatus();

    // Build category bar
    const catBar = document.getElementById('catBar');
    if (catBar) {
        catBar.innerHTML = categories.map(c => 
            `<button class="cat-btn" onclick="loadFeed('${c}')">${c}</button>`
        ).join('');
    }

    initUI();
    initSearchPanel();   // <-- ADD THIS LINE to attach search panel events

    const audioElem = document.getElementById('bgMusic');
    if (audioElem) {
        audioElem.addEventListener('ended', () => {
            if (state.currentCategory) playRandomMusic(state.currentCategory);
        });
    }

    initWatchAdButton();
    setupAdButtonListeners();
    addManualPremiumCheck();

    await initGiftSystem();
    const openGiftMenuBtn = document.getElementById('openGiftFromMenuBtn');
    if (openGiftMenuBtn) openGiftMenuBtn.addEventListener('click', () => showGiftDrawer());

    const welcomeOverlay = document.getElementById('welcomeOverlay');
    const continueBtn = document.getElementById('welcomeContinueBtn');
    if (welcomeOverlay && continueBtn) {
        welcomeOverlay.style.backgroundImage = `url('${getHolidayImage()}')`;
        continueBtn.addEventListener('click', () => {
            welcomeOverlay.classList.add('hidden');
            fetch(`${API_URL}/api/trigger-ad`, {
                method: 'POST',
                headers: { 'X-Telegram-Init-Data': tg.initData }
            }).catch(() => {});
            loadFeed("Discover", "", true);
        });
    } else {
        loadFeed("Discover", "", true);
    }

    const titleEl = document.querySelector('.top-bar h2');
    if (titleEl) titleEl.innerText = getFestiveTitle();

    // Keyword expand/collapse
    const feed = document.getElementById('feed');
    if (feed) {
        feed.addEventListener('click', (e) => {
            const container = e.target.closest('.keyword-container');
            if (!container) return;
            if (e.target.classList.contains('more-btn')) {
                const short = container.querySelector('.keyword-short');
                const more = container.querySelector('.more-btn');
                const full = container.querySelector('.keyword-full');
                const less = container.querySelector('.less-btn');
                if (short) short.style.display = 'none';
                if (more) more.style.display = 'none';
                if (full) full.style.display = 'inline';
                if (less) less.style.display = 'inline';
                e.stopPropagation();
            } else if (e.target.classList.contains('less-btn')) {
                const full = container.querySelector('.keyword-full');
                const less = container.querySelector('.less-btn');
                const short = container.querySelector('.keyword-short');
                const more = container.querySelector('.more-btn');
                if (full) full.style.display = 'none';
                if (less) less.style.display = 'none';
                if (short) short.style.display = 'inline';
                if (more) more.style.display = 'inline';
                e.stopPropagation();
            }
        });
    }
};

// Global guard for hidden "Join" elements
document.addEventListener('click', (e) => {
    const target = e.target.closest('a, button, [role="button"]');
    if (!target) return;
    if (target.innerText && /join/i.test(target.innerText)) {
        const isVisibleMenu = target.closest('#menuPanel.open');
        const isVisibleAd = target.closest('.swiper-slide') && target.closest('.ad-action-btn');
        if (!isVisibleMenu && !isVisibleAd) {
            e.preventDefault();
            e.stopPropagation();
            console.warn('Blocked click on hidden Join element', target);
        }
    }
});
