// giftManager.js - Gifting system (with larger confetti)
import { state } from './state.js';
import { verifyPremiumStatus } from './premiumManager.js';

const API_URL = "https://imagifhub.onrender.com";

let giftList = [];
let currentGiftDrawerOpen = false;

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

// Send gift – with BIG confetti (normal and overpriced)
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
            if (status === 'paid' || status === 'paid_in_chat') {
                // 1. Haptic success
                if (tg.HapticFeedback) {
                    tg.HapticFeedback.notificationOccurred('success');
                }

                // 2. Confetti – bigger for all gifts
                if (typeof confetti === 'function') {
                    // Primary burst (all gifts)
                    confetti({
                        particleCount: 300,      // was 150
                        spread: 100,             // was 70
                        origin: { y: 0.5 },
                        startVelocity: 20,       // faster
                        zIndex: 2147483647
                    });
                    // Secondary burst from sides
                    confetti({
                        particleCount: 200,
                        spread: 80,
                        origin: { y: 0.5, x: 0.2 },
                        startVelocity: 25,
                        zIndex: 2147483647
                    });
                    confetti({
                        particleCount: 200,
                        spread: 80,
                        origin: { y: 0.5, x: 0.8 },
                        startVelocity: 25,
                        zIndex: 2147483647
                    });

                    // Overpriced: extra massive burst + gold colors
                    if (category === 'overpriced') {
                        setTimeout(() => {
                            confetti({
                                particleCount: 600,
                                spread: 140,
                                origin: { y: 0.5 },
                                startVelocity: 30,
                                colors: ['#ffd700', '#ffaa00', '#ff5500', '#ffffff'],
                                zIndex: 2147483647
                            });
                            // And a third big burst from top
                            setTimeout(() => {
                                confetti({
                                    particleCount: 400,
                                    spread: 120,
                                    origin: { y: 0.2 },
                                    startVelocity: 25,
                                    colors: ['#ffd700', '#ffaa00', '#ff5500'],
                                    zIndex: 2147483647
                                });
                            }, 300);
                        }, 200);
                    }
                } else {
                    console.warn("confetti function not available");
                }

                // 3. Close drawer
                closeGiftDrawer();

                // 4. Refresh recent gift
                await refreshRecentGiftCard();

                // 5. Grant premium if overpriced
                if (category === 'overpriced') {
                    await verifyPremiumStatus();
                }

                // 6. Optional alert
                if (tg.showAlert) {
                    tg.showAlert(`🎁 ${giftEmoji} ${giftName} sent! Thank you!`);
                }
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
    document.getElementById('feed').addEventListener('click', (e) => {
        const giftBtn = e.target.closest('.gift-icon-btn');
        if (giftBtn) {
            e.preventDefault();
            e.stopPropagation();
            showGiftDrawer();
        }
    });
    const drawer = document.getElementById('giftDrawer');
    const closeBtn = document.getElementById('closeGiftDrawer');
    if (closeBtn) closeBtn.addEventListener('click', closeGiftDrawer);
    if (drawer) {
        drawer.addEventListener('click', (e) => {
            if (e.target === drawer) closeGiftDrawer();
        });
    }
    await refreshRecentGiftCard();
                }
