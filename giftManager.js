// giftManager.js - Gifting system
import { state } from './state.js';
import { verifyPremiumStatus } from './premiumManager.js';

const API_URL = "https://imagifhub.onrender.com";

let giftList = [];
let currentGiftDrawerOpen = false;

// Detect current season based on date
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

// Organize gifts by category, sort by price ascending
function organizeGifts(gifts, currentSeason) {
    const categories = {};
    // Filter and sort
    for (const gift of gifts) {
        let visible = true;
        if (gift.season && gift.season !== currentSeason) visible = false;
        if (!visible) continue;
        
        let catKey = gift.category;
        if (gift.season && gift.season === currentSeason) catKey = "this_season";
        
        if (!categories[catKey]) categories[catKey] = [];
        categories[catKey].push(gift);
    }
    // Sort each category by price
    for (const cat in categories) {
        categories[cat].sort((a,b) => a.price - b.price);
    }
    // Order: this_season, everyday, fun, overpriced (if they exist)
    const ordered = [];
    if (categories["this_season"]) ordered.push({ title: "🎁 This Season", items: categories["this_season"] });
    if (categories["everyday"]) ordered.push({ title: "🧸 Everyday Gifts", items: categories["everyday"] });
    if (categories["fun"]) ordered.push({ title: "😎 Fun Gifts", items: categories["fun"] });
    if (categories["overpriced"]) ordered.push({ title: "💎 Overpriced Gifts", items: categories["overpriced"] });
    // Also include other categories that might appear (spring, summer etc) but they're covered by this_season
    return ordered;
}

// Load gifts from backend or fallback to static? Better fetch from backend to match validation.
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

// Show gift drawer (slide down)
export function showGiftDrawer() {
    if (currentGiftDrawerOpen) return;
    const drawer = document.getElementById('giftDrawer');
    if (!drawer) return;
    drawer.classList.add('open');
    currentGiftDrawerOpen = true;
    renderGiftDrawerContent();
}

function closeGiftDrawer() {
    const drawer = document.getElementById('giftDrawer');
    if (drawer) drawer.classList.remove('open');
    currentGiftDrawerOpen = false;
}

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
    // Attach send events
    document.querySelectorAll('.gift-send-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const item = btn.closest('.gift-item');
            if (!item) return;
            const giftId = item.dataset.giftId;
            const giftName = item.dataset.giftName;
            const giftEmoji = item.dataset.giftEmoji;
            const giftPrice = parseInt(item.dataset.giftPrice);
            await sendGift(giftId, giftName, giftEmoji, giftPrice);
        });
    });
}

async function sendGift(giftId, giftName, giftEmoji, giftPrice) {
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
                // Show confetti
                triggerConfetti(true);
                // Refresh recent gift display
                await refreshRecentGiftCard();
                // If overpriced, also refresh premium status and reload feed to remove ads
                if (data.gift && data.gift.category === 'overpriced') {
                    await verifyPremiumStatus();
                }
                // Also show a nice message
                if (tg.showAlert) tg.showAlert(`🎁 ${giftEmoji} ${giftName} sent! Thank you for your gift!`);
                closeGiftDrawer();
            } else {
                if (tg.showAlert) tg.showAlert("Gift purchase cancelled or failed.");
            }
        });
    } catch (err) {
        console.error("Gift error:", err);
        if (tg.showAlert) tg.showAlert("Error sending gift. Please try again.");
    }
}

// Confetti burst with extra effects for overpriced gifts
export function triggerConfetti(isOverpriced = false) {
    // Basic confetti
    canvasConfetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    canvasConfetti({ particleCount: 100, spread: 100, origin: { y: 0.6, x: 0.2 }, startVelocity: 15 });
    canvasConfetti({ particleCount: 100, spread: 100, origin: { y: 0.6, x: 0.8 }, startVelocity: 15 });
    
    if (isOverpriced) {
        // Overpriced extra: fireworks, more particles, glitter
        setTimeout(() => {
            canvasConfetti({ particleCount: 300, spread: 120, origin: { y: 0.5 }, startVelocity: 20, colors: ['#ffd700', '#ffaa00', '#ff5500'] });
        }, 200);
        setTimeout(() => {
            canvasConfetti({ particleCount: 500, spread: 150, origin: { y: 0.3 }, startVelocity: 25, decay: 0.9 });
        }, 500);
        // Also shoot "stars" effect
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                canvasConfetti({ particleCount: 80, spread: 360, origin: { y: 0.5, x: Math.random() }, startVelocity: 30, colors: ['#ffffff', '#ffdd44'] });
            }, i * 300);
        }
    }
}

// Refresh recent gift card on menu
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
            const expiresIn = gift.expires_in_seconds;
            const minutes = Math.floor(expiresIn / 60);
            const seconds = expiresIn % 60;
            container.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:28px;">${gift.gift_emoji}</span>
                    <div><strong>${gift.gift_name}</strong><br><span style="font-size:11px;">${gift.gift_price} ⭐</span></div>
                </div>
                <div style="font-size:11px; margin-top:5px;">⏱️ expires in ${minutes}m ${seconds}s</div>
            `;
        } else {
            container.innerHTML = '<div style="opacity:0.7;">No recent gift sent</div>';
        }
    } catch (e) {
        console.error("Failed to load recent gift", e);
    }
}

// Start countdown timer for recent gift card
let recentGiftInterval = null;
export function startRecentGiftTimer() {
    if (recentGiftInterval) clearInterval(recentGiftInterval);
    recentGiftInterval = setInterval(() => {
        refreshRecentGiftCard();
    }, 1000);
}

// Initialize gift system
export async function initGiftSystem() {
    await loadGifts();
    // Setup gift button on existing slides? Slides are dynamic, we attach event listener to feed for gift buttons
    document.getElementById('feed').addEventListener('click', (e) => {
        const giftBtn = e.target.closest('.gift-icon-btn');
        if (giftBtn && !state.isGiftDrawerOpen) {
            e.preventDefault();
            e.stopPropagation();
            showGiftDrawer();
        }
    });
    // Close drawer when clicking overlay
    const drawer = document.getElementById('giftDrawer');
    const closeBtn = document.getElementById('closeGiftDrawer');
    if (closeBtn) closeBtn.addEventListener('click', closeGiftDrawer);
    if (drawer) {
        drawer.addEventListener('click', (e) => {
            if (e.target === drawer) closeGiftDrawer();
        });
    }
    // Refresh recent gift periodically
    await refreshRecentGiftCard();
    startRecentGiftTimer();
                   }

