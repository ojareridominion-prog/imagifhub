// script.js - Main entry point
import { musicLibrary, categories } from './music.js';
import { getHolidayImage, getFestiveTitle } from './welcome.js';
import { state } from './state.js';
import { playRandomMusic, toggleMute } from './musicManager.js';
import { fetchNativeAds, setupAdButtonListeners } from './adsManager.js';   // removed showRewardedAdWrapper
import { verifyPremiumStatus, updateWatchAdCard, startTempPremiumCountdown, showRewardedAdWrapper as premiumRewardedWrapper } from './premiumManager.js';
import { loadFeed, resetAndLoadFeed } from './feedManager.js';
import { toggleMenu, applyTheme, triggerSearch, shareBot, openPremium, closePremium, openCopyright, closeCopyright, openPrivacy, closePrivacy, copyUserId, toggleDarkText, initUI } from './uiManager.js';
import { initGiftSystem, refreshRecentGiftCard, showGiftDrawer } from './giftManager.js';   // NEW

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
window.goPremium = goPremium;        // defined below
window.verifyPremiumStatus = verifyPremiumStatus;
window.toggleDarkText = toggleDarkText;
window.openCopyright = openCopyright;
window.closeCopyright = closeCopyright;
window.copyUserId = copyUserId;
window.openPrivacy = openPrivacy;
window.closePrivacy = closePrivacy;

// Payment / invoice function (needs API call)
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

// Helper to add manual check button to premium modal
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

// Watch ad button listener
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

// Premium modal payment method toggle (Stars ↔ TON) with mode classes
function initPremiumPaymentToggle() {
    const toggleContainer = document.getElementById('premiumPaymentToggle');
    if (!toggleContainer) return;

    const starsPriceSpan = document.querySelector('.premium-card .stars-price');
    const tonPriceSpan = document.querySelector('.premium-card .ton-price');
    const premiumCard = document.querySelector('.premium-card');

    toggleContainer.querySelectorAll('.seg-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Update active state
            toggleContainer.querySelectorAll('.seg-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const method = btn.dataset.payment;
            if (method === 'stars') {
                starsPriceSpan.style.display = 'block';
                tonPriceSpan.style.display = 'none';
                premiumCard.classList.remove('payment-mode-ton');
                premiumCard.classList.add('payment-mode-stars');
            } else {
                starsPriceSpan.style.display = 'none';
                tonPriceSpan.style.display = 'block';
                premiumCard.classList.remove('payment-mode-stars');
                premiumCard.classList.add('payment-mode-ton');
            }
        });
    });

    // Set initial state (default Stars)
    const activeBtn = toggleContainer.querySelector('.seg-option.active');
    if (activeBtn && activeBtn.dataset.payment === 'stars') {
        premiumCard.classList.add('payment-mode-stars');
    } else {
        premiumCard.classList.add('payment-mode-ton');
    }
}

// Initialization
window.onload = async () => {
    // Expand Telegram WebApp
    const tg = window.Telegram.WebApp;
    if (tg && tg.expand) tg.expand();

    await fetchNativeAds();
    await verifyPremiumStatus();

    // Build category bar
    document.getElementById('catBar').innerHTML = categories.map(c => 
        `<button class="cat-btn" onclick="loadFeed('${c}')">${c}</button>`
    ).join('');

    initUI();

    const audioElem = document.getElementById('bgMusic');
    audioElem.addEventListener('ended', () => {
        if (state.currentCategory) playRandomMusic(state.currentCategory);
    });

    initWatchAdButton();
    setupAdButtonListeners();
    addManualPremiumCheck();
    initPremiumPaymentToggle();   // NEW: enable segmented toggle in premium modal

    // Initialize gift system
    await initGiftSystem();
    // Attach menu button for gift drawer
    const openGiftMenuBtn = document.getElementById('openGiftFromMenuBtn');
    if (openGiftMenuBtn) openGiftMenuBtn.addEventListener('click', () => showGiftDrawer());

    // Welcome overlay
    const welcomeOverlay = document.getElementById('welcomeOverlay');
    const continueBtn = document.getElementById('welcomeContinueBtn');
    if (welcomeOverlay && continueBtn) {
        welcomeOverlay.style.backgroundImage = `url('${getHolidayImage()}')`;
        continueBtn.addEventListener('click', () => {
            welcomeOverlay.classList.add('hidden');
            // Trigger bot ad (optional)
            fetch(`${API_URL}/api/trigger-ad`, {
                method: 'POST',
                headers: { 'X-Telegram-Init-Data': tg.initData }
            }).catch(() => {});
            loadFeed("Discover", "", true);
        });
    } else {
        loadFeed("Discover", "", true);
    }

    document.querySelector('.top-bar h2').innerText = getFestiveTitle();

    // Keyword expand/collapse listeners
    document.getElementById('feed').addEventListener('click', (e) => {
        const container = e.target.closest('.keyword-container');
        if (!container) return;
        if (e.target.classList.contains('more-btn')) {
            container.querySelector('.keyword-short').style.display = 'none';
            container.querySelector('.more-btn').style.display = 'none';
            container.querySelector('.keyword-full').style.display = 'inline';
            container.querySelector('.less-btn').style.display = 'inline';
            e.stopPropagation();
        } else if (e.target.classList.contains('less-btn')) {
            container.querySelector('.keyword-full').style.display = 'none';
            container.querySelector('.less-btn').style.display = 'none';
            container.querySelector('.keyword-short').style.display = 'inline';
            container.querySelector('.more-btn').style.display = 'inline';
            e.stopPropagation();
        }
    });
};

// Global guard – blocks clicks on hidden elements containing "Join"
document.addEventListener('click', (e) => {
    const target = e.target.closest('a, button, [role="button"]');
    if (!target) return;
    
    // Check if the element contains the text "Join" (case‑insensitive)
    if (target.innerText && /join/i.test(target.innerText)) {
        // Only allow click if the element is inside the open menu panel OR is a visible ad button
        const isVisibleMenu = target.closest('#menuPanel.open');
        const isVisibleAd = target.closest('.swiper-slide') && target.closest('.ad-action-btn');
        if (!isVisibleMenu && !isVisibleAd) {
            e.preventDefault();
            e.stopPropagation();
            console.warn('Blocked click on hidden Join element', target);
            return false;
        }
    }
});
