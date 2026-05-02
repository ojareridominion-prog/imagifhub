// script.js - Main entry point
import { musicLibrary, categories } from './music.js';
import { getHolidayImage, getFestiveTitle } from './welcome.js';
import { state } from './state.js';
import { playRandomMusic, toggleMute } from './musicManager.js';
import { fetchNativeAds, setupAdButtonListeners } from './adsManager.js';
import { verifyPremiumStatus, updateWatchAdCard, startTempPremiumCountdown, showRewardedAdWrapper as premiumRewardedWrapper } from './premiumManager.js';
import { loadFeed, resetAndLoadFeed } from './feedManager.js';
import { toggleMenu, applyTheme, triggerSearch, shareBot, openPremium, closePremium, openCopyright, closeCopyright, openPrivacy, closePrivacy, copyUserId, toggleDarkText, initUI } from './uiManager.js';
import { initGiftSystem, refreshRecentGiftCard, showGiftDrawer } from './giftManager.js';
import { initWalletUI, sendTonPremiumPayment } from './tonPayment.js';

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

// Payment / invoice function (supports TON)
async function goPremium() {
    const tg = window.Telegram.WebApp;
    const statusEl = document.getElementById('paymentStatus');
    const btn = document.getElementById('btnBuy');

    const tonOption = document.querySelector('.seg-option.active[data-payment="ton"]');
    if (tonOption) {
        statusEl.textContent = "Processing TON payment...";
        btn.disabled = true;
        try {
            await sendTonPremiumPayment();
            statusEl.textContent = "✅ Payment successful! Premium activated.";
            setTimeout(() => closePremium(), 1500);
        } catch (err) {
            console.error(err);
            statusEl.textContent = "❌ Payment failed: " + err.message;
            if (tg.showAlert) tg.showAlert("Payment failed. Please try again or use Stars.");
        } finally {
            btn.disabled = false;
        }
        return;
    }

    // Stars flow
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

function initPremiumPaymentToggle() {
    const toggleContainer = document.getElementById('premiumPaymentToggle');
    if (!toggleContainer) return;

    const starsOldSpan = document.querySelector('.premium-card .old-price.stars-price');
    const tonOldSpan = document.querySelector('.premium-card .old-price.ton-price');
    const starsNewSpan = document.querySelector('.premium-card .new-price.stars-price');
    const tonNewSpan = document.querySelector('.premium-card .new-price.ton-price');
    const premiumCard = document.querySelector('.premium-card');

    if (!starsOldSpan || !tonOldSpan || !starsNewSpan || !tonNewSpan) return;

    toggleContainer.querySelectorAll('.seg-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            toggleContainer.querySelectorAll('.seg-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const method = btn.dataset.payment;
            if (method === 'stars') {
                starsOldSpan.style.display = 'block';
                tonOldSpan.style.display = 'none';
                starsNewSpan.style.display = 'block';
                tonNewSpan.style.display = 'none';
                premiumCard.classList.remove('payment-mode-ton');
                premiumCard.classList.add('payment-mode-stars');
            } else {
                starsOldSpan.style.display = 'none';
                tonOldSpan.style.display = 'block';
                starsNewSpan.style.display = 'none';
                tonNewSpan.style.display = 'block';
                premiumCard.classList.remove('payment-mode-stars');
                premiumCard.classList.add('payment-mode-ton');
            }
        });
    });

    const activeBtn = toggleContainer.querySelector('.seg-option.active');
    if (activeBtn && activeBtn.dataset.payment === 'stars') {
        premiumCard.classList.add('payment-mode-stars');
    } else {
        premiumCard.classList.add('payment-mode-ton');
    }
}

// Initialization
window.onload = async () => {
    const tg = window.Telegram.WebApp;
    if (tg && tg.expand) tg.expand();

    try {
        await fetchNativeAds();
    } catch (e) { console.warn("fetchNativeAds error:", e); }

    try {
        await verifyPremiumStatus();
    } catch (e) { console.warn("verifyPremiumStatus error:", e); }

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
    initPremiumPaymentToggle();

    try {
        await initGiftSystem();
        const openGiftMenuBtn = document.getElementById('openGiftFromMenuBtn');
        if (openGiftMenuBtn) openGiftMenuBtn.addEventListener('click', () => showGiftDrawer());
    } catch (e) { console.warn("Gift system init error:", e); }

    try {
        await initWalletUI();
    } catch (e) { console.warn("Wallet UI init error:", e); }

    // Welcome overlay (must always work)
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

// Global guard – blocks clicks on hidden Join elements
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
            return false;
        }
    }
});
