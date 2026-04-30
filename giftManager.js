// giftManager.js - Gifting system (professional drag-to-close, thank‑you modal)
import { state } from './state.js';
import { verifyPremiumStatus } from './premiumManager.js';

const API_URL = "https://imagifhub.onrender.com";

let giftList = [];
let currentGiftDrawerOpen = false;
let isDragging = false;
let dragStartY = 0;

// Helper: close menu if open
function closeMenuIfOpen() {
    const panel = document.getElementById('menuPanel');
    if (panel && panel.classList.contains('open')) {
        panel.classList.remove('open');
        const overlay = document.getElementById('menuOverlay');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
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

// Close gift drawer – clean, CSS transition handles the exit
export function closeGiftDrawer() {
    const drawer = document.getElementById('giftDrawer');
    const overlay = document.getElementById('drawerOverlay');
    if (!drawer) return;
    
    drawer.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
    drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
    currentGiftDrawerOpen = false;
    
    // Reset inline transform after animation finishes
    setTimeout(() => {
        if (!drawer.classList.contains('open')) {
            drawer.style.transform = '';
            drawer.style.transition = '';
        }
    }, 300);
}

// Show temporary thank‑you modal (fades after 2 seconds)
function showThankYouModal(giftName, giftEmoji) {
    const existing = document.getElementById('giftThankYouModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'giftThankYouModal';
    modal.innerHTML = `
        <div style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0,0,0,0.85);
            backdrop-filter: blur(12px);
            color: white;
            padding: 20px 28px;
            border-radius: 40px;
            text-align: center;
            z-index: 20001;
            font-size: 20px;
            font-weight: bold;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            white-space: nowrap;
            pointer-events: none;
            animation: fadeOutModal 2s ease forwards;
        ">
            🎁 ${giftEmoji} ${giftName} sent!<br>Thank you! 💖
        </div>
    `;
    if (!document.querySelector('#giftModalStyle')) {
        const style = document.createElement('style');
        style.id = 'giftModalStyle';
        style.textContent = `
            @keyframes fadeOutModal {
                0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                100% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); visibility: hidden; }
            }
        `;
        document.head.appendChild(style);
    }
    document.body.appendChild(modal);
    setTimeout(() => modal.remove(), 2000);
}

// Open gift drawer
export function showGiftDrawer() {
    if (currentGiftDrawerOpen) return;
    closeMenuIfOpen();
    const drawer = document.getElementById('giftDrawer');
    const overlay = document.getElementById('drawerOverlay');
    if (!drawer) return;
    drawer.classList.add('open');
    overlay.classList.add('active');
    overlay.style.pointerEvents = 'auto';
    document.body.style.overflow = 'hidden';
    currentGiftDrawerOpen = true;
    renderGiftDrawerContent();
}

// ========== PROFESSIONAL DRAG LOGIC (instant, no lag) ==========
function handleDragStart(e) {
    e.preventDefault();
    isDragging = true;
    dragStartY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    const drawer = document.getElementById('giftDrawer');
    drawer.style.transition = 'none';
}

function handleDragMove(e) {
    if (!isDragging) return;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    const deltaY = clientY - dragStartY;
    if (deltaY > 0) {
        const drawer = document.getElementById('giftDrawer');
        drawer.style.transition = 'none';
        drawer.style.transform = `translateY(${deltaY}px)`;
    }
}

function handleDragEnd(e) {
    if (!isDragging) return;
    isDragging = false;
    const drawer = document.getElementById('giftDrawer');
    const clientY = e.type === 'touchend' ? e.changedTouches[0].clientY : e.clientY;
    const deltaY = clientY - dragStartY;
    // Re‑enable smooth transition
    drawer.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
    // If dragged more than 100px, close; else snap back instantly
    if (deltaY > 100) {
        closeGiftDrawer();
    } else {
        drawer.style.transform = 'translateY(0)';
    }
}

function initDrawerDrag() {
    const handle = document.getElementById('drawerDragHandle');
    if (!handle) return;
    // Remove old listeners to avoid duplicates
    handle.removeEventListener('touchstart', handleDragStart);
    handle.removeEventListener('touchmove', handleDragMove);
    handle.removeEventListener('touchend', handleDragEnd);
    handle.removeEventListener('mousedown', handleDragStart);
    handle.removeEventListener('mousemove', handleDragMove);
    handle.removeEventListener('mouseup', handleDragEnd);
    
    handle.addEventListener('touchstart', handleDragStart, { passive: false });
    handle.addEventListener('touchmove', handleDragMove);
    handle.addEventListener('touchend', handleDragEnd);
    // Optional mouse support for desktop testing
    handle.addEventListener('mousedown', handleDragStart);
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
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

// Send gift – with confetti and thank‑you modal (no Telegram alert)
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
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                if (typeof confetti === 'function') {
                    confetti({ particleCount: 300, spread: 100, origin: { y: 0.5 }, startVelocity: 20, zIndex: 2147483647 });
                    confetti({ particleCount: 200, spread: 80, origin: { y: 0.5, x: 0.2 }, startVelocity: 25, zIndex: 2147483647 });
                    confetti({ particleCount: 200, spread: 80, origin: { y: 0.5, x: 0.8 }, startVelocity: 25, zIndex: 2147483647 });
                    if (category === 'overpriced') {
                        setTimeout(() => {
                            confetti({ particleCount: 600, spread: 140, origin: { y: 0.5 }, startVelocity: 30, colors: ['#ffd700', '#ffaa00', '#ff5500', '#ffffff'], zIndex: 2147483647 });
                            setTimeout(() => {
                                confetti({ particleCount: 400, spread: 120, origin: { y: 0.2 }, startVelocity: 25, colors: ['#ffd700', '#ffaa00', '#ff5500'], zIndex: 2147483647 });
                            }, 300);
                        }, 200);
                    }
                }
                closeGiftDrawer();
                await refreshRecentGiftCard();
                if (category === 'overpriced') await verifyPremiumStatus();
                showThankYouModal(giftName, giftEmoji);
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
    
    const overlay = document.getElementById('drawerOverlay');
    if (overlay) overlay.addEventListener('click', closeGiftDrawer);
    
    initDrawerDrag();
    
    await refreshRecentGiftCard();
                    }
