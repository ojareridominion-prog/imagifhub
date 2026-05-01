// giftManager.js - with category filter (horizontal scroll) and grouped sections
import { state } from './state.js';
import { verifyPremiumStatus } from './premiumManager.js';

const API_URL = "https://imagifhub.onrender.com";

let giftList = [];
let currentGiftDrawerOpen = false;
let currentGiftCategoryFilter = "all";
let isDragging = false;
let dragStartY = 0;
let dragRAF = null;

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

// Organise gifts by category with titles (original grouping)
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
    return categories;
}

// Get display title for category key
function getCategoryTitle(catKey) {
    const titles = {
        "this_season": "🎁 This Season",
        "everyday": "🧸 Everyday Gifts",
        "fun": "😎 Fun Gifts",
        "overpriced": "💎 Overpriced Gifts"
    };
    return titles[catKey] || catKey.charAt(0).toUpperCase() + catKey.slice(1);
}

// Build drawer HTML based on current filter (keeps sections)
function buildDrawerHTMLWithFilter() {
    const container = document.getElementById('giftDrawerContent');
    if (!container) return;
    if (!giftList.length) {
        container.innerHTML = '<div class="gift-empty">No gifts available</div>';
        return;
    }
    
    const currentSeason = getCurrentSeason();
    const organized = organizeGifts(giftList, currentSeason);
    
    // Define the order of categories to display when filter is "all"
    const categoryOrder = ["this_season", "everyday", "fun", "overpriced"];
    
    let html = '';
    
    if (currentGiftCategoryFilter === "all") {
        // Show all sections in order
        for (const catKey of categoryOrder) {
            const items = organized[catKey];
            if (items && items.length) {
                html += `<div class="gift-category"><div class="gift-category-title">${getCategoryTitle(catKey)}</div><div class="gift-items-grid">`;
                for (const gift of items) {
                    const isOverpriced = gift.category === "overpriced";
                    html += `
                        <div class="gift-item ${isOverpriced ? 'glow-overpriced' : ''}" data-gift-id="${gift.id}" data-gift-name="${gift.name}" data-gift-emoji="${gift.emoji}" data-stars-price="${gift.price}" data-category="${gift.category}">
                            <div class="gift-emoji">${gift.emoji}</div>
                            <div class="gift-name">${gift.name}</div>
                            <div class="gift-price-container">
                                <span class="gift-price">${gift.price} ⭐</span>
                            </div>
                            <button class="gift-send-btn">Send</button>
                        </div>
                    `;
                }
                html += `</div></div>`;
            }
        }
    } else {
        // Show only selected category
        let items = [];
        if (currentGiftCategoryFilter === "this_season") items = organized["this_season"] || [];
        else if (currentGiftCategoryFilter === "everyday") items = organized["everyday"] || [];
        else if (currentGiftCategoryFilter === "fun") items = organized["fun"] || [];
        else if (currentGiftCategoryFilter === "overpriced") items = organized["overpriced"] || [];
        
        if (items.length) {
            const title = getCategoryTitle(currentGiftCategoryFilter);
            html += `<div class="gift-category"><div class="gift-category-title">${title}</div><div class="gift-items-grid">`;
            for (const gift of items) {
                const isOverpriced = gift.category === "overpriced";
                html += `
                    <div class="gift-item ${isOverpriced ? 'glow-overpriced' : ''}" data-gift-id="${gift.id}" data-gift-name="${gift.name}" data-gift-emoji="${gift.emoji}" data-stars-price="${gift.price}" data-category="${gift.category}">
                        <div class="gift-emoji">${gift.emoji}</div>
                        <div class="gift-name">${gift.name}</div>
                        <div class="gift-price-container">
                            <span class="gift-price">${gift.price} ⭐</span>
                        </div>
                        <button class="gift-send-btn">Send</button>
                    </div>
                `;
            }
            html += `</div></div>`;
        } else {
            html = '<div class="gift-empty">No gifts in this category</div>';
        }
    }
    
    container.innerHTML = html;
    
    // Attach send button listeners
    container.querySelectorAll('.gift-send-btn').forEach(btn => {
        btn.removeEventListener('click', handleSendGift);
        btn.addEventListener('click', handleSendGift);
    });
}

// Initialize horizontally scrollable category filter buttons
function initCategoryFilterButtons() {
    const container = document.getElementById('giftCategoryFilters');
    if (!container) return;
    
    const filters = [
        { id: "all", label: "All" },
        { id: "this_season", label: "This Season" },
        { id: "everyday", label: "Everyday" },
        { id: "fun", label: "Fun" },
        { id: "overpriced", label: "Overpriced" }
    ];
    
    container.innerHTML = filters.map(f => `
        <button class="gift-filter-btn ${currentGiftCategoryFilter === f.id ? 'active' : ''}" data-filter="${f.id}">
            ${f.label}
        </button>
    `).join('');
    
    // Make container horizontally scrollable (CSS handles it)
    container.querySelectorAll('.gift-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filter = btn.dataset.filter;
            if (!filter || filter === currentGiftCategoryFilter) return;
            currentGiftCategoryFilter = filter;
            // Update active class
            container.querySelectorAll('.gift-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Re-render drawer content
            buildDrawerHTMLWithFilter();
        });
    });
}

// Separate handler for gift sending
async function handleSendGift(e) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const item = btn.closest('.gift-item');
    if (!item) return;
    const giftId = item.dataset.giftId;
    const giftName = item.dataset.giftName;
    const giftEmoji = item.dataset.giftEmoji;
    const giftPrice = parseInt(item.dataset.starsPrice);
    const category = item.dataset.category;
    await sendGift(giftId, giftName, giftEmoji, giftPrice, category);
}

// Send gift – with confetti and thank‑you modal
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

// Show temporary thank‑you modal
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

// Close gift drawer – full reset including inline styles
export function closeGiftDrawer() {
    const drawer = document.getElementById('giftDrawer');
    const overlay = document.getElementById('drawerOverlay');
    if (!drawer) return;
    
    drawer.classList.remove('open');
    drawer.style.transform = '';
    drawer.style.transition = '';
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
    currentGiftDrawerOpen = false;
    
    isDragging = false;
    if (dragRAF) {
        cancelAnimationFrame(dragRAF);
        dragRAF = null;
    }
}

// Drag handling (unchanged)
function handleDragStart(e) {
    e.preventDefault();
    isDragging = true;
    dragStartY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    const drawer = document.getElementById('giftDrawer');
    if (drawer) {
        drawer.style.transition = 'none';
        const computedStyle = window.getComputedStyle(drawer);
        const transform = computedStyle.transform;
        if (transform !== 'none') {
            const matrix = transform.match(/matrix.*\((.+)\)/);
            if (matrix) {
                const values = matrix[1].split(', ');
                const currentY = parseFloat(values[values.length - 1]);
                if (!isNaN(currentY)) dragStartY -= currentY;
            }
        }
    }
}

function handleDragMove(e) {
    if (!isDragging) return;
    if (dragRAF) cancelAnimationFrame(dragRAF);
    dragRAF = requestAnimationFrame(() => {
        const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
        let deltaY = clientY - dragStartY;
        if (deltaY < 0) deltaY = 0;
        const drawer = document.getElementById('giftDrawer');
        if (drawer) {
            drawer.style.transform = `translateY(${deltaY}px)`;
        }
    });
}

function handleDragEnd(e) {
    if (!isDragging) return;
    isDragging = false;
    if (dragRAF) cancelAnimationFrame(dragRAF);
    
    const drawer = document.getElementById('giftDrawer');
    const overlay = document.getElementById('drawerOverlay');
    if (!drawer) return;
    
    const clientY = e.type === 'touchend' ? e.changedTouches[0].clientY : e.clientY;
    const deltaY = clientY - dragStartY;
    
    drawer.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.9, 0.4, 1.1)';
    
    if (deltaY > 100) {
        drawer.style.transform = `translateY(100%)`;
        if (overlay) overlay.classList.remove('active');
        setTimeout(() => {
            closeGiftDrawer();
        }, 300);
    } else {
        drawer.style.transform = 'translateY(0)';
        setTimeout(() => {
            if (!isDragging) drawer.style.transition = '';
        }, 300);
    }
}

function initDrawerDrag() {
    const handle = document.getElementById('drawerDragHandle');
    if (!handle) return;
    
    handle.removeEventListener('touchstart', handleDragStart);
    handle.removeEventListener('touchmove', handleDragMove);
    handle.removeEventListener('touchend', handleDragEnd);
    handle.removeEventListener('mousedown', handleDragStart);
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    
    handle.addEventListener('touchstart', handleDragStart, { passive: false });
    handle.addEventListener('touchmove', handleDragMove, { passive: false });
    handle.addEventListener('touchend', handleDragEnd);
    handle.addEventListener('mousedown', handleDragStart);
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
}

// Open gift drawer (with fresh render)
export function showGiftDrawer() {
    if (currentGiftDrawerOpen) return;
    closeMenuIfOpen();
    const drawer = document.getElementById('giftDrawer');
    const overlay = document.getElementById('drawerOverlay');
    if (!drawer) return;
    
    drawer.style.transform = '';
    drawer.style.transition = '';
    
    // Re-render with current filter
    buildDrawerHTMLWithFilter();
    
    drawer.classList.add('open');
    if (overlay) overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    currentGiftDrawerOpen = true;
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

// Initialize gift system – pre‑render everything
export async function initGiftSystem() {
    await loadGifts();
    initCategoryFilterButtons();    // creates horizontal scroll filter UI
    buildDrawerHTMLWithFilter();    // initial render
    initDrawerDrag();
    await refreshRecentGiftCard();
    
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
}
