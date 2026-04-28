// giftManager.js
import { state } from './state.js';
import { verifyPremiumStatus } from './premiumManager.js';

const API_URL = "https://imagifhub.onrender.com";
let giftList = [];
let currentGiftDrawerOpen = false;

function closeMenuIfOpen() { /* unchanged */ }

function getCurrentSeason() { /* unchanged */ }

function organizeGifts(gifts, currentSeason) { /* unchanged but returns categories */ }

export async function loadGifts() { /* unchanged */ }

export function showGiftDrawer() {
  if (currentGiftDrawerOpen) return;
  closeMenuIfOpen();
  const drawer = document.getElementById('giftDrawer');
  drawer.classList.add('open');
  currentGiftDrawerOpen = true;
  renderGiftDrawerContent();
}

function closeGiftDrawer() {
  document.getElementById('giftDrawer').classList.remove('open');
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
  
  // Build tabs
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
  
  // Attach tab events
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
        // Confetti (same as before)
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
        // Show custom modal (no alert)
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

export async function refreshRecentGiftCard() { /* unchanged */ }
export async function initGiftSystem() { /* unchanged (but remove alert references) */ }
