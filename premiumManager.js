// premiumManager.js
import { state } from './state.js';
import { resetAndLoadFeed } from './feedManager.js';
import { showRewardedAd } from './monetag.js';
import { generateInitialsAvatar } from './utils.js';

const API_URL = "https://imagifhub.onrender.com";
const TEMP_PREMIUM_KEY = "imagifhub_temp_premium_expiry";
const TEMP_AD_COUNT_KEY = "imagifhub_temp_ad_count";

function getTempPremiumExpiry() {
    const expiry = localStorage.getItem(TEMP_PREMIUM_KEY);
    if (!expiry) return null;
    const expiryDate = new Date(expiry);
    return expiryDate > new Date() ? expiryDate : null;
}

function setTempPremiumExpiry(expiryDate) {
    if (expiryDate) localStorage.setItem(TEMP_PREMIUM_KEY, expiryDate.toISOString());
    else localStorage.removeItem(TEMP_PREMIUM_KEY);
}

function getTempAdCount() {
    const count = parseInt(localStorage.getItem(TEMP_AD_COUNT_KEY) || "0");
    return Math.min(count, 3);
}

function setTempAdCount(count) {
    localStorage.setItem(TEMP_AD_COUNT_KEY, Math.min(count, 3));
}

async function grantTempPremium() {
    const tg = window.Telegram.WebApp;
    if (!tg.initData) return false;
    try {
        const response = await fetch(`${API_URL}/api/grant-temp-premium`, {
            method: 'POST',
            headers: { 'X-Telegram-Init-Data': tg.initData }
        });
        if (!response.ok) throw new Error("Failed to grant temp premium");
        const data = await response.json();
        const expiryDate = new Date(data.expires_at);
        setTempPremiumExpiry(expiryDate);
        setTempAdCount(0);
        await verifyPremiumStatus();
        resetAndLoadFeed(state.currentCategory);
        updateWatchAdCard();
        startTempPremiumCountdown();
        return true;
    } catch (e) {
        console.error("Error granting temp premium:", e);
        return false;
    }
}

export async function showRewardedAdWrapper() {
    const success = await showRewardedAd();
    if (success) {
        let count = getTempAdCount();
        count++;
        setTempAdCount(count);
        updateWatchAdCard();
        if (count >= 3) await grantTempPremium();
    } else {
        const tg = window.Telegram.WebApp;
        if (tg && tg.showAlert) tg.showAlert("Ad not completed. Please watch the full ad to earn reward.");
    }
}

export function updateWatchAdCard() {
    const card = document.getElementById('watchAdsCard');
    const progressDiv = document.getElementById('watchAdsProgress');
    const timerDiv = document.getElementById('tempPremiumTimer');
    const watchBtn = document.getElementById('watchAdBtn');
    if (!card) return;
    if (state.paidPremiumActive && getTempPremiumExpiry() === null) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'block';
    const tempExpiry = getTempPremiumExpiry();
    if (tempExpiry) {
        progressDiv.innerText = "✨ 1-Hour Premium Active ✨";
        if (watchBtn) watchBtn.style.display = 'none';
    } else {
        const count = getTempAdCount();
        progressDiv.innerText = `${count}/3 ads watched`;
        if (watchBtn) watchBtn.style.display = 'block';
        if (timerDiv) timerDiv.innerText = '';
    }
}

let tempPremiumInterval = null;
export function startTempPremiumCountdown() {
    if (tempPremiumInterval) clearInterval(tempPremiumInterval);
    const updateTimer = () => {
        const expiry = getTempPremiumExpiry();
        const timerDiv = document.getElementById('tempPremiumTimer');
        if (!timerDiv) return;
        if (!expiry) {
            if (timerDiv) timerDiv.innerText = '';
            if (tempPremiumInterval) clearInterval(tempPremiumInterval);
            if (state.isPremiumUser && !getTempPremiumExpiry() && !state.paidPremiumActive) {
                verifyPremiumStatus().then(() => resetAndLoadFeed(state.currentCategory));
            }
            return;
        }
        const now = new Date();
        const diffMs = expiry - now;
        if (diffMs <= 0) {
            setTempPremiumExpiry(null);
            updateWatchAdCard();
            verifyPremiumStatus().then(() => resetAndLoadFeed(state.currentCategory));
            if (tempPremiumInterval) clearInterval(tempPremiumInterval);
            return;
        }
        const minutes = Math.floor(diffMs / 60000);
        const seconds = Math.floor((diffMs % 60000) / 1000);
        timerDiv.innerText = `⏱️ ${minutes}m ${seconds}s left`;
    };
    updateTimer();
    tempPremiumInterval = setInterval(updateTimer, 1000);
}

// ----- MODIFIED: accept isAdmin flag and show "admin" instead of days left -----
function updatePremiumUI(isPremium, expiryStr = null, daysLeft = null, isTemp = false, isAdmin = false) {
    const premiumBtn = document.querySelector('.premium-btn-menu');
    const expiryDisplay = document.getElementById('premiumExpiryDisplay');
    if (premiumBtn) {
        if (isPremium) {
            if (isAdmin) {
                premiumBtn.innerText = "⭐ ADMIN";
                premiumBtn.style.background = "#4CAF50";
                premiumBtn.style.color = "white";
                premiumBtn.disabled = true;
                premiumBtn.onclick = null;
            } else if (isTemp) {
                premiumBtn.innerText = "⏱️ TEMP PREMIUM (1h)";
                premiumBtn.style.background = "#ff8c00";
                premiumBtn.style.color = "white";
                premiumBtn.disabled = true;
                premiumBtn.onclick = null;
            } else {
                premiumBtn.innerText = "⭐ PREMIUM ACTIVE";
                premiumBtn.style.background = "#4CAF50";
                premiumBtn.style.color = "white";
                premiumBtn.disabled = true;
                premiumBtn.onclick = null;
            }
        } else {
            premiumBtn.innerText = "UPGRADE NOW";
            premiumBtn.style.background = "white";
            premiumBtn.style.color = "#9c4dff";
            premiumBtn.disabled = false;
            premiumBtn.onclick = window.openPremium;
        }
    }
    if (expiryDisplay) {
        if (isAdmin) {
            expiryDisplay.innerText = "admin";
        } else if (isPremium) {
            if (isTemp) {
                expiryDisplay.innerText = "⏳ 1‑hour trial – see timer below";
            } else if (daysLeft !== null) {
                expiryDisplay.innerText = `${daysLeft} days left`;
            } else if (expiryStr) {
                expiryDisplay.innerText = formatExpiryDate(expiryStr);
            } else {
                expiryDisplay.innerText = "Premium active";
            }
        } else {
            expiryDisplay.innerText = "Enjoy ad-free smooth scrolling";
        }
    }
    const buyBtn = document.getElementById('btnBuy');
    if (buyBtn) {
        if (isPremium && !isTemp) {
            buyBtn.innerText = "⭐ PREMIUM ACTIVE";
            buyBtn.style.background = "#4CAF50";
            buyBtn.disabled = true;
        } else if (isPremium && isTemp) {
            buyBtn.innerText = "⏱️ TEMP ACTIVE";
            buyBtn.style.background = "#ff8c00";
            buyBtn.disabled = true;
        } else {
            buyBtn.innerText = "Go Premium";
            buyBtn.style.background = "#ffd700";
            buyBtn.disabled = false;
        }
    }
    const indicator = document.getElementById('premiumIndicator');
    if (indicator) indicator.style.display = isPremium ? 'block' : 'none';
}

function formatExpiryDate(expiryStr) {
    if (!expiryStr) return '';
    try {
        const expiryMs = new Date(expiryStr).getTime();
        const diffMs = expiryMs - Date.now();
        const daysLeft = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (daysLeft < 0) return 'Expired';
        if (daysLeft === 0) return 'Expires today';
        if (daysLeft === 1) return 'Expires tomorrow';
        return `${daysLeft} days left`;
    } catch { return ''; }
}

// ----- MODIFIED: capture is_admin from API response and override -----
export async function verifyPremiumStatus(skipReset = false) {
    try {
        const tg = window.Telegram.WebApp;
        const initData = tg.initData;
        let paidPremium = false;
        let expiry = null;
        let daysLeft = null;
        let isAdmin = false;
        if (initData) {
            const response = await fetch(`${API_URL}/api/user-data`, {
                headers: { 'X-Telegram-Init-Data': initData }
            });
            const data = await response.json();
            if (data.user) updateUserCard(data.user);
            else {
                const user = tg.initDataUnsafe?.user;
                if (user) updateUserCard(user);
            }
            paidPremium = data.premium === true;
            expiry = data.expires_at;
            daysLeft = data.days_left;
            isAdmin = data.is_admin === true;   // <--- NEW
        } else {
            paidPremium = localStorage.getItem("isPremium") === "true";
            expiry = localStorage.getItem("premiumExpires");
            const user = tg.initDataUnsafe?.user;
            if (user) updateUserCard(user);
        }
        const tempExpiry = getTempPremiumExpiry();
        const tempActive = tempExpiry !== null;
        
        // Admin overrides everything
        let newPremiumStatus = paidPremium || tempActive;
        if (isAdmin) {
            newPremiumStatus = true;
            paidPremium = true;   // treat as full premium
        }
        
        const wasPremium = state.isPremiumUser;
        state.paidPremiumActive = paidPremium;
        state.isPremiumUser = newPremiumStatus;
        
        const isTemp = tempActive && !paidPremium && !isAdmin;
        
        if (isAdmin) {
            updatePremiumUI(true, null, null, false, true);
            updateWatchAdCard();  // hide watch ads card for admin
        } else if (paidPremium) {
            localStorage.setItem("isPremium", "true");
            if (expiry) localStorage.setItem("premiumExpires", expiry);
            updatePremiumUI(true, expiry, daysLeft, false, false);
            if (!tempActive) updateWatchAdCard();
        } else if (tempActive) {
            updatePremiumUI(true, null, null, true, false);
            updateWatchAdCard();
            startTempPremiumCountdown();
        } else {
            localStorage.removeItem("isPremium");
            localStorage.removeItem("premiumExpires");
            updatePremiumUI(false);
            updateWatchAdCard();
        }
        if (wasPremium !== state.isPremiumUser && !skipReset) {
            resetAndLoadFeed(state.currentCategory);
        }
        return state.isPremiumUser;
    } catch (error) {
        console.log("Error verifying premium:", error);
        const paid = localStorage.getItem("isPremium") === "true";
        const tempExpiry = getTempPremiumExpiry();
        const tempActive = tempExpiry !== null;
        // No admin detection here – fallback
        const newStatus = paid || tempActive;
        const was = state.isPremiumUser;
        state.isPremiumUser = newStatus;
        state.paidPremiumActive = paid;
        const isTemp = tempActive && !paid;
        if (was !== newStatus && !skipReset) {
            resetAndLoadFeed(state.currentCategory);
        }
        updatePremiumUI(newStatus, null, null, isTemp, false);
        if (tempActive) {
            updateWatchAdCard();
            startTempPremiumCountdown();
        } else updateWatchAdCard();
        const user = window.Telegram.WebApp.initDataUnsafe?.user;
        if (user) updateUserCard(user);
        return newStatus;
    }
}

function updateUserCard(user) {
    if (!user) {
        document.getElementById('userName').innerText = 'Unknown User';
        document.getElementById('userId').innerText = '-';
        document.getElementById('userAvatar').src = 'assets/default-avatar.png';
        return;
    }
    let name = user.first_name || '';
    if (user.last_name) name += ' ' + user.last_name;
    if (!name.trim() && user.username) name = '@' + user.username;
    if (!name.trim()) name = `User ${user.id}`;
    document.getElementById('userName').innerText = name;
    document.getElementById('userId').innerText = user.id;
    const avatarImg = document.getElementById('userAvatar');
    const tg = window.Telegram.WebApp;
    fetch(`${API_URL}/api/user-photo`, {
        headers: { 'X-Telegram-Init-Data': tg.initData }
    })
        .then(response => response.ok ? response.blob() : Promise.reject())
        .then(blob => { avatarImg.src = URL.createObjectURL(blob); })
        .catch(() => { avatarImg.src = generateInitialsAvatar(user); });
}
