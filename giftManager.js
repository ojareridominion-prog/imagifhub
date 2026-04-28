// giftManager.js
import { state } from './state.js';
import { verifyPremiumStatus } from './premiumManager.js';

const API_URL = "https://imagifhub.onrender.com";
let giftList = [];
let currentGiftDrawerOpen = false;

function closeMenuIfOpen() {
    const panel = document.getElementById('menuPanel');
    if (panel && panel.classList.contains('open')) {
        panel.classList.remove('open');
    }
}

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

export function showGiftDrawer() {
    if (currentGiftDrawerOpen) return;
    closeMenuIfOpen();
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

function showThankYouModal(giftEmoji, giftName) {
    const modal = document.createElement('div');
    modal.className = 'thankyou-modal';
    modal.innerText = `🎁 ${giftEmoji} ${giftName} sent! Thank you!`;
    document.body.appendChild(modal);
    setTimeout(() => modal.remove(), 2000);
}

async function renderGiftDrawerContent() {
    const container = document.getElementById('giftDrawerContent');
    if (!container) return;
    if (!giftList.length) await loadGifts();
    const currentSeason = getCurrentSeason();
    const categories = organizeGifts(giftList, currentSeason);
    
    const tabNames = ['everyday', 'fun', 'overpriced'];
    if (categories.some(c => c.title.includes('This Season'))) tabNames.unshift('seasonal');
    let activeTab = tabNames[0];
    
    const renderByTab = (tab) => {
        let items = [];
        if (tab === 'seasonal') {
            const seasonCat = categories.find(c => c.title.includes('This Season'));
            items = seasonCat ? seasonCat.items : [];
        } else if (tab === 'everyday') {
            const cat = categories.find(c => c.title === '🧸 Everyday Gifts');
            items = cat ? cat.items : [];
        } else if (tab === 'fun') {
            const cat = categories.find(c => c.title === '😎 Fun Gifts');
            items = cat ? cat.items : [];
        } else if (tab === 'overpriced') {
            const cat = categories.find(c => c.title === '💎 Overpriced Gifts');
            items = cat ? cat.items : [];
        }
        return `
            <div class="gift-items-grid">
                ${items.map(gift => `
                    <div class="gift-item" data-gift-id="${gift.id}" data-gift-name="${gift.name}" data-gift-emoji="${gift.emoji}" data-gift-price="${gift.price}" data-category="${gift.category}">
                        <div class="gift-emoji">${gift.emoji}</div>
                        <div class="gift-name">${gift.name}</div>
                        <div class="gift-price">${gift.price} ⭐</div>
                        <button class="gift-send-btn">Send</button>
                    </div>
                `).join('')}
            </div>
        `;
    };
    
    const tabsHtml = `
        <div class="gift-tabs">
            ${tabNames.map(tab => `<button class="gift-tab ${tab === activeTab ? 'active' : ''}" data-tab="${tab}">${tab === 'seasonal' ? '🎀 Seasonal' : tab === 'everyday' ? '🧸 Everyday' : tab === 'fun' ? '😎 Fun' : '💎 Overpriced'}</button>`).join('')}
        </div>
        <div id="giftTabContent">${renderByTab(activeTab)}</div>
    `;
    container.innerHTML = tabsHtml;
    
    document.querySelectorAll('.gift-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.gift-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            document.getElementById('giftTabContent').innerHTML = renderByTab(tab);
            attachSendEvents();
        });
    });
    attachSendEvents();
}

function attachSendEvents() {
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

async function sendGift(giftId, giftName, giftEmoji, giftPrice, category) {
    const tg = window.Telegram.WebApp;
    try {
        const response = await fetch(`${API_URL}/api/create-gift-invoice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData },
            body: JSON.stringify({ giftId })
        });
        if (!response.ok) throw new Error();
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
                            confetti({ particleCount: 600, spread: 140, origin: { y: 0.5 }, colors: ['#ffd700','#ffaa00'], zIndex: 2147483647 });
                        }, 200);
                    }
                }
                closeGiftDrawer();
                await refreshRecentGiftCard();
                if (category === 'overpriced') await verifyPremiumStatus();
                showThankYouModal(giftEmoji, giftName);
            } else {
                if (tg.showAlert) tg.showAlert("Gift purchase cancelled or failed.");
            }
        });
    } catch (err) {
        console.error(err);
        if (tg.showAlert) tg.showAlert("Error sending gift. Please try again.");
    }
}

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

export async function initGiftSystem() {
    await loadGifts();
    document.getElementById('feed')?.addEventListener('click', (e) => {
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
