// script.js - Main entry point
import { categories } from './music.js';
import { getHolidayImage, getFestiveTitle } from './welcome.js';
import { state } from './state.js';
import { playRandomMusic, toggleMute } from './musicManager.js';
import { fetchNativeAds, setupAdButtonListeners } from './adsManager.js';
import { verifyPremiumStatus, updateWatchAdCard, startTempPremiumCountdown, showRewardedAdWrapper as premiumRewardedWrapper } from './premiumManager.js';
import { loadFeed, resetAndLoadFeed, handleDeepLink } from './feedManager.js';
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

// ===== NEW: saved images state =====
state.savedImageIds = new Set();
state.savedOffset = 0;
state.savedLimit = 20;
state.savedHasMore = true;
state.loadingSaved = false;
state.savedImagesList = [];  // <-- ADDED for viewer

// ===== NEW: Toast notification =====
function showToast(message, type = 'info', duration = 3000) {
    // Simple toast using Telegram alert or console
    if (window.Telegram?.WebApp?.showAlert) {
        window.Telegram.WebApp.showAlert(message);
    } else {
        alert(message);
    }
}
window.showToast = showToast;

// ===== NEW: Saved images overlay functions =====
function openSavedOverlay() {
    // Close menu if open
    const panel = document.getElementById('menuPanel');
    if (panel && panel.classList.contains('open')) {
        panel.classList.remove('open');
        document.getElementById('menuOverlay').classList.remove('active');
        document.body.style.overflow = '';
    }
    document.getElementById('savedOverlay').classList.add('active');
    loadSavedImages(true);
}

function closeSavedOverlay() {
    closeSavedViewer();  // ensure viewer is closed when gallery is closed
    document.getElementById('savedOverlay').classList.remove('active');
}

// ===== UPDATED: SAVED IMAGE VIEWER (sub‑viewer) =====
let savedSwiperInstance = null;

function openSavedViewer(startIndex = 0) {
    const viewerModal = document.getElementById('savedViewerModal');
    const swiperWrapper = document.getElementById('savedSwiperWrapper');

    if (!state.savedImagesList || state.savedImagesList.length === 0) return;

    // Render slides from saved list
    swiperWrapper.innerHTML = state.savedImagesList.map(img => `
        <div class="swiper-slide">
            <img src="${img.url}" alt="${img.Keyword || 'Saved Image'}" loading="lazy" />
            <div class="slide-caption">
                <h3>${img.Keyword || 'Untitled'}</h3>
            </div>
        </div>
    `).join('');

    // Show modal and activate pointer events
    viewerModal.classList.remove('hidden');
    viewerModal.classList.add('active');

    // Destroy existing Swiper instance if present
    if (savedSwiperInstance) {
        savedSwiperInstance.destroy(true, true);
        savedSwiperInstance = null;
    }

    // Initialize Swiper after modal display update
    setTimeout(() => {
        savedSwiperInstance = new Swiper('#savedSwiperContainer', {
            direction: 'vertical',
            initialSlide: startIndex,
            loop: state.savedImagesList.length > 1,
            observer: true,
            observeParents: true,
            pagination: {
                el: '#savedSwiperContainer .swiper-pagination',
                clickable: true,
            },
            touchRatio: 1,
        });
    }, 50);
}

function closeSavedViewer() {
    const viewerModal = document.getElementById('savedViewerModal');
    viewerModal.classList.add('hidden');
    viewerModal.classList.remove('active');

    if (savedSwiperInstance) {
        savedSwiperInstance.destroy(true, true);
        savedSwiperInstance = null;
    }
}

// Bind close button
document.getElementById('closeSavedViewerBtn')?.addEventListener('click', closeSavedViewer);

async function loadSavedImages(reset = false) {
    if (state.loadingSaved || (!state.savedHasMore && !reset)) return;
    state.loadingSaved = true;

    const grid = document.getElementById('savedGrid');
    if (reset) {
        grid.innerHTML = '';
        state.savedOffset = 0;
        state.savedHasMore = true;
        // Show skeleton
        for (let i = 0; i < 4; i++) {
            const skel = document.createElement('div');
            skel.className = 'skeleton-card';
            skel.innerHTML = `<div class="img"></div><div class="line"></div>`;
            grid.appendChild(skel);
        }
    }

    try {
        if (!state.user) {
            grid.innerHTML = '<div class="saved-empty-state">Unable to load user context.</div>';
            return;
        }
        const resp = await fetch(`${API_URL}/api/saved-images?telegram_id=${state.user.id}`);
        const images = await resp.json();

        if (reset) grid.innerHTML = '';

        if (!images || images.length === 0) {
            if (reset) {
                grid.innerHTML = '<div class="saved-empty-state">No images saved yet</div>';
            }
            state.savedHasMore = false;
            return;
        }

        state.savedImagesList = images;  // <-- store for viewer

        images.forEach((img, index) => {
            const card = document.createElement('div');
            card.className = 'game-card';
            card.innerHTML = `
                <button class="card-menu-btn">⋮</button>
                <div class="card-dropdown">
                    <div class="card-dropdown-item delete-item">🗑 Delete</div>
                </div>
                <img src="${img.url}" alt="${img.Keyword || 'Image'}" loading="lazy" />
                <div class="info">
                    <div class="title">${img.Keyword || 'Untitled'}</div>
                    <div class="category">${img.category || 'Other'}</div>
                </div>
            `;

            const menuBtn = card.querySelector('.card-menu-btn');
            const dropdown = card.querySelector('.card-dropdown');
            const deleteItem = card.querySelector('.delete-item');

            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.classList.toggle('show');
            });

            deleteItem.addEventListener('click', async (e) => {
                e.stopPropagation();
                dropdown.classList.remove('show');
                await window.toggleSaveImage(img.id, null);
                // toggleSaveImage will refresh the overlay if it's open
            });

            // ---- CLICK ON CARD OPENS THE VIEWER ----
            card.addEventListener('click', () => {
                openSavedViewer(index);
            });

            grid.appendChild(card);
        });

        state.savedHasMore = false; // no pagination for now, all images loaded at once
    } catch (e) {
        console.error(e);
        if (reset) grid.innerHTML = '<div class="saved-empty-state">Failed to load saved images.</div>';
        showToast('Failed to load saved images.', 'error');
    } finally {
        state.loadingSaved = false;
    }
}
// Expose loadSavedImages globally for use in feedManager
window.loadSavedImages = loadSavedImages;

// ===== NEW: fetch saved image IDs =====
async function fetchSavedImageIds() {
    if (!state.user || !state.user.id) return;
    try {
        const resp = await fetch(`${API_URL}/api/saved-images?telegram_id=${state.user.id}`);
        const images = await resp.json();
        if (Array.isArray(images)) {
            state.savedImageIds = new Set(images.map(img => String(img.id)));
        }
    } catch (err) {
        console.error("Failed to fetch saved image IDs:", err);
    }
}

// ===== Payment / invoice function =====
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
    const paymentInfoText = document.getElementById('paymentInfoText');

    if (!starsOldSpan || !tonOldSpan || !starsNewSpan || !tonNewSpan) return;

    function setPaymentInfo(method) {
        if (method === 'stars') {
            paymentInfoText.innerHTML = `🔒 <b>Secure Payment via Telegram</b><br>
                                         Clicking "Go Premium" will create telegram star invoice.`;
        } else {
            paymentInfoText.innerHTML = `🔒 <b>Secure Payment via TON</b><br>
                                         Clicking "Go Premium" will start TON payment.<br><br>
                                         ⚠️ <b>Important:</b> Only use a self‑custodial TON wallet (e.g., Tonkeeper, MyTonWallet, TON Space). Exchange wallets will not work. Do not change or alter anything like comment or price in transaction.`;
        }
    }

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
                setPaymentInfo('stars');
            } else {
                starsOldSpan.style.display = 'none';
                tonOldSpan.style.display = 'block';
                starsNewSpan.style.display = 'none';
                tonNewSpan.style.display = 'block';
                premiumCard.classList.remove('payment-mode-stars');
                premiumCard.classList.add('payment-mode-ton');
                setPaymentInfo('ton');
            }
        });
    });

    const activeBtn = toggleContainer.querySelector('.seg-option.active');
    if (activeBtn && activeBtn.dataset.payment === 'stars') {
        premiumCard.classList.add('payment-mode-stars');
        setPaymentInfo('stars');
    } else {
        premiumCard.classList.add('payment-mode-ton');
        setPaymentInfo('ton');
    }
}

// ====== DEFERRED INITIALIZATION ======
async function initializeApp() {
    const tg = window.Telegram.WebApp;
    if (tg && tg.expand) tg.expand();

    try {
        await fetchNativeAds();
    } catch (e) { console.warn("fetchNativeAds error:", e); }

    // Build category bar
    document.getElementById('catBar').innerHTML = categories.map(c => 
        `<button class="cat-btn" onclick="loadFeed('${c}')">${c}</button>`
    ).join('');

    initUI();

    const audioElem = document.getElementById('bgMusic');
    audioElem.addEventListener('ended', () => {
        if (state.currentCategory) {
            playRandomMusic(state.currentCategory).catch(console.error);
        }
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

    // Verify premium status WITHOUT triggering feed reload
    await verifyPremiumStatus(true);

    // ===== NEW: fetch saved image IDs after user is set =====
    if (state.user) {
        await fetchSavedImageIds();
    }

    // ===== NEW: handle deep link – if loaded, skip default feed =====
    const deepLinkLoaded = await handleDeepLink();
    if (!deepLinkLoaded) {
        // Finally load the feed
        await loadFeed("Discover", "", true);
    }
}

// ====== WELCOME OVERLAY ======
window.onload = () => {
    const welcomeOverlay = document.getElementById('welcomeOverlay');
    const continueBtn = document.getElementById('welcomeContinueBtn');
    
    if (welcomeOverlay && continueBtn) {
        welcomeOverlay.style.backgroundImage = `url('${getHolidayImage()}')`;
        
        continueBtn.addEventListener('click', async () => {
            // ===== SET USER EARLY =====
            const tg = window.Telegram.WebApp;
            if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
                state.user = tg.initDataUnsafe.user;
            }
            
            welcomeOverlay.classList.add('hidden');
            
            fetch(`${API_URL}/api/trigger-ad`, {
                method: 'POST',
                headers: { 'X-Telegram-Init-Data': tg.initData }
            }).catch(() => {});
            
            await initializeApp();
        });
    } else {
        // No welcome overlay? Still try to set user.
        const tg = window.Telegram.WebApp;
        if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
            state.user = tg.initDataUnsafe.user;
        }
        initializeApp();
    }
    
    document.querySelector('.top-bar h2').innerText = getFestiveTitle();
    
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

    // ===== NEW: saved overlay event listeners =====
    const savedLink = document.getElementById('savedImagesLink');
    if (savedLink) {
        savedLink.addEventListener('click', (e) => {
            e.preventDefault();
            openSavedOverlay();
        });
    }

    const closeSavedBtn = document.getElementById('closeSavedOverlay');
    if (closeSavedBtn) {
        closeSavedBtn.addEventListener('click', closeSavedOverlay);
    }

    const refreshSavedBtn = document.getElementById('refreshSavedBtn');
    if (refreshSavedBtn) {
        refreshSavedBtn.addEventListener('click', () => {
            state.savedOffset = 0;
            state.savedHasMore = true;
            loadSavedImages(true);
        });
    }

    const savedOverlay = document.getElementById('savedOverlay');
    if (savedOverlay) {
        savedOverlay.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeSavedOverlay();
        });
    }
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

document.addEventListener("DOMContentLoaded", () => {
    // No initialization here – everything waits for CONTINUE
});
