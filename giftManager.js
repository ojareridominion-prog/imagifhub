// giftManager.js - Gifting system
import { state } from './state.js';
import { verifyPremiumStatus } from './premiumManager.js';

const API_URL = "https://imagifhub.onrender.com";

let giftList = [];
let currentGiftDrawerOpen = false;

// Helper: ensure canvas-confetti is loaded
function ensureConfetti(callback) {
    if (typeof canvasConfetti === 'function') {
        callback();
        return;
    }
    console.warn("canvasConfetti not loaded, attempting to load dynamically");
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1';
    script.onload = () => {
        console.log("canvasConfetti loaded dynamically");
        callback();
    };
    script.onerror = () => {
        console.error("Failed to load canvasConfetti, confetti disabled");
    };
    document.head.appendChild(script);
}

// Helper: close menu if open
function closeMenuIfOpen() {
    const panel = document.getElementById('menuPanel');
    if (panel && panel.classList.contains('open')) {
        panel.classList.remove('open');
    }
}

// Detect current season
function getCurrentSeason() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    if (month === 10) return "halloween";
    if (month === 12 && day <= 30) return "christmas";
    if ((month === 12 && day >= 31) || (month === 1 && day <= 7)) return "newyear";
    if (month >= 6 && month <= 8) return "summer";
    if (month >= 3 && month <= 5) return "spring";
    return null;
}

// Organise gifts by category
function organizeGifts(gifts, currentSeason) {
    const categories = {};
    for (const gift of gifts) {
        let visible = true;
        if (gift.season && gift.season !== currentSeason) visible = false;
        if (!visible) continue;
        
        let catKey = gift.category;
        if (gift.season && gift.season === currentSeason) catKey = "this_season";
        
        if (!categories[catKey]) categories[catKey] = [];
        categories[catKey].push(gift);
    }
    for (const cat in categories) {
        categories[cat].sort((a,b) => a.price - b.price);
    }
    const ordered = [];
    if (categories["this_season"]) ordered.push({ title: "🎁 This Season", items: categories["this_season"] });
    if (categories["everyday"]) ordered.push({ title: "🧸 Everyday Gifts", items: categories["everyday"] });
    if (categories["fun"]) ordered.push({ title: "😎 Fun Gifts", items: categories["fun"] });
    if (categories["overpriced"]) ordered.push({ title: "💎 Overpriced Gifts", items: categories["overpriced"] });
    return ordered;
}

// Load gifts from backend
export async function loadGifts() {
    try {
        const res = await fetch(`${API_URL}/api/gifts`);
        if (res.ok) giftList = await res.json();
        else throw new Error("Failed to load gifts");
    } catch (e) {
        console.error("Error loading gifts:", e);
        giftList = [];
    }
}

// Open gift drawer
export function showGiftDrawer() {
    if (currentGiftDrawerOpen) return;
    closeMenuIfOpen();
    const drawer = document.getElementById('giftDrawer');
    if (!drawer) return;
    drawer.classList.add('open');
    currentGiftDrawerOpen = true;
    renderGiftDrawerContent();
}

// Close gift drawer
function closeGiftDrawer() {
    const drawer = document.getElementById('giftDrawer');
    if (drawer) drawer.classList.remove('open');
    currentGiftDrawerOpen = false;
}

// Render gift items inside drawer
async function renderGiftDrawerContent() {
    const container = document.getElementById('giftDrawerContent');
    if (!container) return;
    if (!giftList.length) await loadGifts();
    const currentSeason = getCurrentSeason();
    const categories = organizeGifts(giftList, currentSeason);
    if (categories.length === 0) {
        container.innerHTML = '<div class="gift-empty">No gifts available</div>';
        return;
    }
    let html = '';
    for (const cat of categories) {
        html += `<div class="gift-category"><div class="gift-category-title">${cat.title}</div><div class="gift-items-grid">`;
        for (const gift of cat.items) {
            html += `
                <div class="gift-item" data-gift-id="${gift.id}" data-gift-name="${gift.name}" data-gift-emoji="${gift.emoji}" data-gift-price="${gift.price}" data-category="${gift.category}">
                    <div class="gift-emoji">${gift.emoji}</div>
                    <div class="gift-name">${gift.name}</div>
                    <div class="gift-price">${gift.price} ⭐</div>
                    <button class="gift-send-btn">Send</button>
                </div>
            `;
        }
        html += `</div></div>`;
    }
    container.innerHTML = html;
    document.querySelectorAll('.gift-send-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const item = btn.closest('.gift-item');
            if (!item) return;
            const giftId = item.dataset.giftId;
            const giftName = item.dataset.giftName;
            const giftEmoji = item.dataset.giftEmoji;
            const giftPrice = parseInt(item.dataset.giftPrice);
            const category = item.dataset.category;
            await sendGift(giftId, giftName, giftEmoji, giftPrice, category);
        });
    });
}

// Enhanced confetti (bigger for overpriced, guaranteed to run)
function triggerConfetti(isOverpriced = false) {
    ensureConfetti(() => {
        if (typeof canvasConfetti !== 'function') return;
        
        // Basic confetti
        canvasConfetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        canvasConfetti({ particleCount: 100, spread: 100, origin: { y: 0.6, x: 0.2 }, startVelocity: 15 });
        canvasConfetti({ particleCount: 100, spread: 100, origin: { y: 0.6, x: 0.8 }, startVelocity: 15 });
        
        if (isOverpriced) {
            setTimeout(() => {
                canvasConfetti({ particleCount: 300, spread: 120, origin: { y: 0.5 }, startVelocity: 20, colors: ['#ffd700', '#ffaa00', '#ff5500'] });
            }, 200);
            setTimeout(() => {
                canvasConfetti({ particleCount: 500, spread: 150, origin: { y: 0.3 }, startVelocity: 25, decay: 0.9 });
            }, 500);
            for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                    canvasConfetti({ particleCount: 80, spread: 360, origin: { y: 0.5, x: Math.random() }, startVelocity: 30, colors: ['#ffffff', '#ffdd44'] });
                }, i * 300);
            }
        }
    });
}

// Send gift (handles invoice, close drawer, delayed confetti, vibration)
async function sendGift(giftId, giftName, giftEmoji, giftPrice, category) {
    const tg = window.Telegram.WebApp;
    try {
        const response = await fetch(`${API_URL}/api/create-gift-invoice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData },
            body: JSON.stringify({ giftId })
        });
        if (!response.ok) throw new Error('Failed to create invoice');
        const data = await response.json();
        tg.openInvoice(data.invoice_link, async (status) => {
            if (status === 'paid') {
                // 1. Close gift drawer
                closeGiftDrawer();
                
                // 2. Ensure WebApp is expanded and focused
                tg.expand();
                
                // 3. Wait a full second for the invoice overlay to disappear completely
                setTimeout(() => {
                    // Vibrate device (Telegram haptic + fallback)
                    const isOverpriced = (category === 'overpriced');
                    try {
                        if (tg.HapticFeedback) {
                            if (isOverpriced) {
                                tg.HapticFeedback.impactOccurred('heavy');
                                setTimeout(() => tg.HapticFeedback.impactOccurred('heavy'), 200);
                                setTimeout(() => tg.HapticFeedback.impactOccurred('heavy'), 400);
                            } else {
                                tg.HapticFeedback.impactOccurred('medium');
                            }
                        } else if (navigator.vibrate) {
                            if (isOverpriced) {
                                navigator.vibrate([200, 100, 200, 100, 200]);
                            } else {
                                navigator.vibrate(100);
                            }
                        }
                    } catch(e) { console.warn("Haptic error", e); }
                    
                    // Trigger confetti bursts
                    triggerConfetti(isOverpriced);
                    if (isOverpriced) {
                        setTimeout(() => triggerConfetti(true), 1000);
                    }
                }, 1000); // increased delay to 1 second
                
                // 4. Refresh recent gift display
                await refreshRecentGiftCard();
                
                // 5. If overpriced gift, refresh premium status
                if (category === 'overpriced') {
                    await verifyPremiumStatus();
                }
                
                // 6. Show alert (already shown by bot, but extra user feedback)
                if (tg.showAlert) tg.showAlert(`🎁 ${giftEmoji} ${giftName} sent! Enjoy the confetti!`);
            } else {
                if (tg.showAlert) tg.showAlert("Gift purchase cancelled or failed.");
            }
        });
    } catch (err) {
        console.error("Gift error:", err);
        if (tg.showAlert) tg.showAlert("Error sending gift. Please try again.");
    }
}

// Refresh "Recent Gift" card in menu
export async function refreshRecentGiftCard() {
    const tg = window.Telegram.WebApp;
    try {
        const res = await fetch(`${API_URL}/api/user-recent-gift`, {
            headers: { 'X-Telegram-Init-Data': tg.initData }
        });
        if (!res.ok) throw new Error();
        const gift = await res.json();
        const container = document.getElementById('recentGiftContent');
        if (!container) return;
        if (gift && gift.gift_name) {
            container.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:28px;">${gift.gift_emoji}</span>
                    <div><strong>${gift.gift_name}</strong><br><span style="font-size:11px;">${gift.gift_price} ⭐</span></div>
                </div>
                <div style="font-size:10px; margin-top:6px; opacity:0.8;">🎁 Recent gift</div>
            `;
        } else {
            container.innerHTML = '<div style="opacity:0.7;">No recent gift sent</div>';
        }
    } catch (e) {
        console.error("Failed to load recent gift", e);
        const container = document.getElementById('recentGiftContent');
        if (container) container.innerHTML = '<div style="opacity:0.7;">No recent gift sent</div>';
    }
}

// Initialize gift system
export async function initGiftSystem() {
    await loadGifts();
    // Listen for gift-icon buttons on the feed (opens drawer)
    document.getElementById('feed').addEventListener('click', (e) => {
        const giftBtn = e.target.closest('.gift-icon-btn');
        if (giftBtn) {
            e.preventDefault();
            e.stopPropagation();
            showGiftDrawer();
        }
    });
    // Close drawer when clicking on overlay or close button
    const drawer = document.getElementById('giftDrawer');
    const closeBtn = document.getElementById('closeGiftDrawer');
    if (closeBtn) closeBtn.addEventListener('click', closeGiftDrawer);
    if (drawer) {
        drawer.addEventListener('click', (e) => {
            if (e.target === drawer) closeGiftDrawer();
        });
    }
    // Load recent gift once
    await refreshRecentGiftCard();
                                                     }
