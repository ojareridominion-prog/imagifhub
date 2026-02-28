// welcome.js - Holiday detection for welcome overlay
import { musicLibrary, categories } from './music.js';
import { nativeAds } from './ads.js';
import { getHolidayImage } from './welcome.js';

const API_URL = "https://imagifhub.vercel.app"; 
let activeSwiper = null;
let currentCategory = "Discover";
let songPools = {}; // Tracks unplayed songs for each category

const SEEN_LIMIT = 20;
const SEEN_KEY = "imagifhub-seen-history";
const PREMIUM_CHECK_INTERVAL = 30000; // 30 seconds
let premiumCheckInterval = null;

// --- Dark Text State ---
let darkTextEnabled = localStorage.getItem('imagifhub-darktext') === 'true';

function toggleDarkText() {
    darkTextEnabled = !darkTextEnabled;
    localStorage.setItem('imagifhub-darktext', darkTextEnabled);
    applyDarkText();
    updateDarkTextIndicator();
}

function applyDarkText() {
    document.body.classList.toggle('dark-text', darkTextEnabled);
}

function updateDarkTextIndicator() {
    const indicator = document.getElementById('darkTextIndicator');
    if (indicator) indicator.innerText = darkTextEnabled ? 'ON' : 'OFF';
}

// --- HISTORY TRACKING ---
function getSeenList() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } 
    catch { return []; }
}

function trackSeenImage(url) {
    let seen = getSeenList();
    seen = seen.filter(u => u !== url);
    seen.push(url);
    if (seen.length > SEEN_LIMIT) seen.shift();
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}

// --- THEME CONFIG ---
const themesList = [
    {id: "theme-black",  top: "#000", bottom: "#000"},
    {id: "theme-white",  top: "#fff", bottom: "#eee"},
    {id: "theme-blood",  top: "#4a0e0e", bottom: "#ff4d4d"},
    {id: "theme-cyan",   top: "#001616", bottom: "#00ffff"},
    {id: "theme-sky",    top: "#071824", bottom: "#7fd6ff"},
    {id: "theme-orange", top: "#2a1400", bottom: "#ff9a3d"},
    {id: "theme-green",  top: "#051f13", bottom: "#66ffb2"},
    {id: "theme-violet", top: "#16001f", bottom: "#f0b3ff"}
];

// --- MUSIC LOGIC ---
function playRandomMusic(cat) {
    const audio = document.getElementById('bgMusic');
    const allSongs = musicLibrary[cat] || musicLibrary["Default"];

    if (!allSongs || allSongs.length === 0) return;

    // Refill and shuffle pool if empty
    if (!songPools[cat] || songPools[cat].length === 0) {
        songPools[cat] = [...allSongs];
        for (let i = songPools[cat].length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [songPools[cat][i], songPools[cat][j]] = [songPools[cat][j], songPools[cat][i]];
        }
    }

    const nextSong = songPools[cat].pop();
    audio.src = nextSong;
    audio.load();
    audio.play().catch(() => console.log("Interaction required for audio"));
}

function toggleMute() {
    const audio = document.getElementById('bgMusic');
    const btn = document.getElementById('muteBtn');
    audio.muted = !audio.muted;
    btn.innerText = audio.muted ? "🔇" : "🔊";
}

// --- CORE FEED LOGIC ---
async function loadFeed(cat, search="") {
    currentCategory = cat;
    const feed = document.getElementById('feed');
    const audio = document.getElementById('bgMusic');
    
    feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Loading...</h3></div>';
    
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.innerText === cat));

    if (audio.paused || currentCategory !== cat) {
        playRandomMusic(cat);
    }

    try {
        const res = await fetch(`${API_URL}/media?category=${encodeURIComponent(cat)}&search=${search}`);
        let data = await res.json();

        if (data && data.length > 0) {
            const seenList = getSeenList();
            const uniqueData = data.filter(item => !seenList.includes(item.url));
            if (uniqueData.length > 0) data = uniqueData;
        }
        
        if (!data || data.length === 0) {
            feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>No Images Found</h3></div>';
            return;
        }

        // Build slides with keyword truncation
        feed.innerHTML = data.map(item => {
            const keyword = item.Keyword || '';
            const maxLength = 100;
            let keywordHtml = '';
            
            if (keyword.length > maxLength) {
                const truncated = keyword.substring(0, maxLength) + '...';
                keywordHtml = `
                    <span class="keyword-short">${truncated}</span>
                    <span class="keyword-full" style="display:none;">${keyword}</span>
                    <button class="more-btn">more</button>
                    <button class="less-btn" style="display:none;">less</button>
                `;
            } else {
                keywordHtml = `<span>${keyword}</span>`;
            }

            return `
                <div class="swiper-slide">
                    <img src="${item.url}" alt="${item.category}" style="width:100%; height:100%; object-fit:cover;">
                    <div class="meta-overlay">
                        <div class="category-tag">#${item.category}</div>
                        <div class="keyword-container">
                            ${keywordHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        if (activeSwiper) activeSwiper.destroy(true, true);
        activeSwiper = new Swiper('#swiper', { 
            direction: 'vertical', 
            mousewheel: true,
            on: {
                reachEnd: function () {
                    setTimeout(() => loadFeed(currentCategory), 1000);
                },
                slideChange: function () {
                    const activeSlide = this.slides[this.activeIndex];
                    const img = activeSlide.querySelector('img');
                    if (img && img.src) trackSeenImage(img.src);
                    maybeShowAd(); 
                },
                init: function() {
                    const activeSlide = this.slides[this.activeIndex];
                    if(activeSlide) {
                        const img = activeSlide.querySelector('img');
                        if (img && img.src) trackSeenImage(img.src);
                    }
                }
            }
        });
        
    } catch(e) { 
        feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Connection Error</h3></div>'; 
    }
}

// --- PREMIUM VERIFICATION FUNCTIONS ---

// ✅ FIXED: Uses UTC timestamps to avoid timezone errors
function formatExpiryDate(expiryStr) {
    if (!expiryStr) return '';
    try {
        const expiryMs = new Date(expiryStr).getTime();      // UTC milliseconds
        const nowMs = Date.now();                             // UTC milliseconds
        const diffMs = expiryMs - nowMs;
        const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (daysLeft < 0) return 'Expired';
        if (daysLeft === 0) return 'Expires today';
        if (daysLeft === 1) return 'Expires tomorrow';
        return `${daysLeft} days left`;
    } catch (e) {
        return '';
    }
}

async function verifyPremiumStatus() {
    try {
        const tg = window.Telegram.WebApp;
        const initData = tg.initData;
        
        if (!initData) {
            console.log("No initData available, using localStorage");
            const isPremium = localStorage.getItem("isPremium") === "true";
            updatePremiumUI(isPremium);
            return isPremium;
        }
        
        const response = await fetch(`${API_URL}/api/user-data`, {
            headers: {
                'X-Telegram-Init-Data': initData
            }
        });
        
        const data = await response.json();
        
        if (data.premium) {
            localStorage.setItem("isPremium", "true");
            localStorage.setItem("premiumExpires", data.expires_at);
            updatePremiumUI(true);
            // ✅ Expiry info no longer displayed
            stopPremiumChecking();
            return true;
        } else {
            localStorage.removeItem("isPremium");
            localStorage.removeItem("premiumExpires");
            updatePremiumUI(false);
            return false;
        }
    } catch (error) {
        console.log("Error verifying premium:", error);
        const isPremium = localStorage.getItem("isPremium") === "true";
        updatePremiumUI(isPremium);
        return isPremium;
    }
}

function startPremiumChecking(userId) {
    stopPremiumChecking();
    checkPremiumStatus(userId);
    premiumCheckInterval = setInterval(() => {
        checkPremiumStatus(userId);
    }, PREMIUM_CHECK_INTERVAL);
}

function stopPremiumChecking() {
    if (premiumCheckInterval) {
        clearInterval(premiumCheckInterval);
        premiumCheckInterval = null;
    }
}

async function checkPremiumStatus(userId) {
    try {
        const response = await fetch(`${API_URL}/api/check-premium?user_id=${userId}`);
        const data = await response.json();
        
        if (data.is_premium) {
            localStorage.setItem("isPremium", "true");
            localStorage.setItem("premiumExpires", data.expires_at);
            updatePremiumUI(true);
            stopPremiumChecking();
            
            const statusEl = document.getElementById('paymentStatus');
            if (statusEl) {
                statusEl.textContent = "✅ Premium activated! Refreshing...";
                statusEl.style.color = "#4CAF50";
                setTimeout(() => {
                    loadFeed(currentCategory);
                    closePremium();
                }, 2000);
            }
            return true;
        }
        return false;
    } catch (error) {
        console.log("Error checking premium status:", error);
        return false;
    }
}

function updatePremiumUI(isPremium) {
    const premiumBtn = document.querySelector('.premium-btn-menu');
    
    if (premiumBtn) {
        if (isPremium) {
            premiumBtn.innerText = "⭐ PREMIUM ACTIVE";
            premiumBtn.style.background = "#4CAF50";
            premiumBtn.style.color = "white";
            premiumBtn.disabled = true;
            premiumBtn.onclick = null;
            
            // Expiry info removed from menu
        } else {
            premiumBtn.innerText = "UPGRADE NOW";
            premiumBtn.style.background = "white";
            premiumBtn.style.color = "#9c4dff";
            premiumBtn.disabled = false;
            premiumBtn.onclick = openPremium;
        }
    }
    
    const buyBtn = document.getElementById('btnBuy');
    if (buyBtn) {
        if (isPremium) {
            buyBtn.innerText = "⭐ PREMIUM ACTIVE";
            buyBtn.style.background = "#4CAF50";
            buyBtn.disabled = true;
        } else {
            buyBtn.innerText = "Go Premium";
            buyBtn.style.background = "#ffd700";
            buyBtn.disabled = false;
        }
    }
    
    const indicator = document.getElementById('premiumIndicator');
    if (indicator) {
        indicator.style.display = isPremium ? 'block' : 'none';
    }
    
    if (isPremium) {
        hideAd();
    }
}

// --- UI & THEME FUNCTIONS ---
function toggleMenu() { 
    const panel = document.getElementById('menuPanel');
    panel.classList.toggle('open');
    // When menu opens, refresh premium status (no expiry info displayed)
    if (panel.classList.contains('open')) {
        verifyPremiumStatus();
    }
}

function applyTheme(themeId) {
    themesList.forEach(t => document.body.classList.remove(t.id));
    if(themeId !== "theme-black") document.body.classList.add(themeId);
    localStorage.setItem("imagifhub-theme", themeId);
}

function triggerSearch() {
    let q = prompt("Search images:");
    if(q) loadFeed("Discover", q);
}

async function shareBot() {
    const shareData = {
        title: 'IMAGIFHUB',
        text: '‎SnapShot 📸 - Your vibe, your view. Swipe, zoom, vibe 🎉. Effortless image magic ✨. 😊‎',
        url: 'https://t.me/IMAGIFHUB_bot'
    };
    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
            alert('Link & Text copied to clipboard!');
        }
    } catch (err) { console.log('Error sharing:', err); }
}

// --- ADS LOGIC ---
let adIndex = Number(localStorage.getItem("adIndex") || 0);
let currentAdLink = null;
let actionCount = Number(localStorage.getItem("actionCount") || 0);

function getNextAd() {
    const ad = nativeAds[adIndex % nativeAds.length];
    adIndex++;
    localStorage.setItem("adIndex", adIndex);
    return ad;
}

function showAd() {
    const isPremium = localStorage.getItem("isPremium") === "true";
    if (isPremium) return;
    
    const ad = getNextAd();
    if (!ad) return;
    currentAdLink = ad.action; 
    document.getElementById("adImage").src = ad.image;
    document.getElementById("adTitle").innerText = ad.title;
    document.getElementById("adSubtitle").innerText = ad.subtitle;
    document.getElementById("nativeAd").classList.remove("hidden");
}

function hideAd(event) {
    if (event) event.stopPropagation(); 
    document.getElementById("nativeAd").classList.add("hidden");
}

function maybeShowAd() {
    const isPremium = localStorage.getItem("isPremium") === "true";
    if (isPremium) {
        hideAd();
        return;
    }
    
    actionCount++;
    localStorage.setItem("actionCount", actionCount);
    if (actionCount % 3 === 0) {
        showAd();
    } else {
        hideAd();
    }
}

// --- PREMIUM MODAL FUNCTIONS ---
function openPremium() {
    document.getElementById('menuPanel').classList.remove('open');
    document.getElementById('premiumModal').classList.add('active');
}

function closePremium() {
    document.getElementById('premiumModal').classList.remove('active');
}

// 🔁 REPLACED goPremium() WITH NEW IN‑APP PURCHASE VERSION
 async function goPremium() {
    const tg = window.Telegram.WebApp;
    const statusEl = document.getElementById('paymentStatus');
    const btn = document.getElementById('btnBuy');

    if (!tg.openInvoice) {
        // fallback as before
        statusEl.textContent = "Opening Telegram...";
        const userId = tg.initDataUnsafe?.user?.id;
        if (userId) {
            const botLink = `https://t.me/IMAGIFHUB_bot?start=premium_${userId}`;
            tg.openLink(botLink);
        }
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

        if (!response.ok) {
            let errorMsg = 'Failed to create invoice';
            try {
                const errData = await response.json();
                errorMsg = errData.detail || errorMsg;
            } catch (e) { /* ignore */ }
            throw new Error(errorMsg);
        }

        const data = await response.json();
        const invoiceLink = data.invoice_link;   // ✅ full invoice URL

        tg.openInvoice(invoiceLink, async (status) => {
            if (status === 'paid') {
                statusEl.textContent = "✅ Payment successful! Activating premium...";
                const isPremium = await verifyPremiumStatus();
                if (isPremium) {
                    statusEl.textContent = "✅ Premium activated!";
                    setTimeout(() => {
                        closePremium();
                        loadFeed(currentCategory);
                    }, 1500);
                } else {
                    statusEl.textContent = "⚠️ Payment received but activation delayed. Please check again in a moment.";
                }
            } else {
                statusEl.textContent = "❌ Payment cancelled or failed";
            }
            btn.disabled = false;
        });
    } catch (error) {
        console.error("Payment error:", error);
        statusEl.textContent = `❌ ${error.message}`;
        btn.disabled = false;
    }
 }

function addManualPremiumCheck() {
    const premiumCard = document.querySelector('.premium-card');
    if (premiumCard) {
        // Ensure paymentStatus exists (it's now in HTML, but we add a button)
        const checkBtn = document.createElement('button');
        checkBtn.className = 'btn-check';
        checkBtn.innerHTML = '🔄 Check Premium Status';
        checkBtn.style.cssText = `
            background: transparent;
            color: #4CAF50;
            border: 1px solid #4CAF50;
            padding: 10px;
            width: 100%;
            border-radius: 8px;
            margin-top: 10px;
            cursor: pointer;
        `;
        checkBtn.onclick = async () => {
            const statusEl = document.getElementById('paymentStatus');
            statusEl.textContent = "Checking status...";
            statusEl.style.color = "#ffd700";
            
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

// --- TELEGRAM WEBAPP INIT ---
function initTelegramWebApp() {
    const tg = window.Telegram.WebApp;
    if (tg && tg.expand) {
        tg.expand();
        console.log("Telegram WebApp version:", tg.version);
        console.log("Available methods:", Object.keys(tg));
        const user = tg.initDataUnsafe?.user;
        if (user) {
            console.log("User ID:", user.id);
        }
    }
}

// --- INITIALIZATION ---
window.onload = async () => {
    // 1. Initialize Telegram WebApp
    initTelegramWebApp();
    
    // 2. Check premium status on load
    await verifyPremiumStatus();
    
    // 3. Setup Categories
    document.getElementById('catBar').innerHTML = categories.map(c => 
        `<button class="cat-btn" onclick="loadFeed('${c}')">${c}</button>`
    ).join('');
    
    // 4. Setup Themes
    document.getElementById('themeGrid').innerHTML = themesList.map(t => `
        <div class="theme-circle" onclick="applyTheme('${t.id}')">
            <div style="background:${t.top}"></div>
            <div style="background:${t.bottom}"></div>
        </div>
    `).join('');

    // 5. Audio Ended Listener
    const audioElem = document.getElementById('bgMusic');
    audioElem.addEventListener('ended', () => {
        if (currentCategory) playRandomMusic(currentCategory); 
    });

    // 6. Load Saved Theme
    const savedTheme = localStorage.getItem("imagifhub-theme") || "theme-black";
    applyTheme(savedTheme);
    
    // 7. Apply Dark Text preference
    applyDarkText();
    updateDarkTextIndicator();
    
    // 8. Setup Welcome Overlay with dynamic holiday image
    const welcomeOverlay = document.getElementById('welcomeOverlay');
    const continueBtn = document.getElementById('welcomeContinueBtn');
    
    if (welcomeOverlay && continueBtn) {
        welcomeOverlay.style.backgroundImage = `url('${getHolidayImage()}')`;
        
        continueBtn.addEventListener('click', () => {
            welcomeOverlay.classList.add('hidden');
            loadFeed("Discover");
        });
    } else {
        loadFeed("Discover");
    }
    
    // 9. Add manual premium check button
    addManualPremiumCheck();

    // 10. Delegate click events for more/less buttons
    // 10. Delegate click events for more/less buttons
    document.getElementById('feed').addEventListener('click', (e) => {
        const target = e.target;
        const container = target.closest('.keyword-container');
        if (!container) return;

        if (target.classList.contains('more-btn')) {
            container.querySelector('.keyword-short').style.display = 'none';
            container.querySelector('.more-btn').style.display = 'none';
            container.querySelector('.keyword-full').style.display = 'inline';
            container.querySelector('.less-btn').style.display = 'inline';
            e.stopPropagation();
        } else if (target.classList.contains('less-btn')) {
            container.querySelector('.keyword-full').style.display = 'none';
            container.querySelector('.less-btn').style.display = 'none';
            container.querySelector('.keyword-short').style.display = 'inline';
            container.querySelector('.more-btn').style.display = 'inline';
            e.stopPropagation();
        }
    });
};

// --- GLOBAL EXPOSURE ---
window.loadFeed = loadFeed;
window.toggleMenu = toggleMenu;
window.toggleMute = toggleMute;
window.triggerSearch = triggerSearch;
window.applyTheme = applyTheme;
window.shareBot = shareBot;
window.hideAd = hideAd;
window.openPremium = openPremium;
window.closePremium = closePremium;
window.goPremium = goPremium;
window.verifyPremiumStatus = verifyPremiumStatus;
window.toggleDarkText = toggleDarkText;

window.handleAdClick = (event) => {
    if (!event.target.classList.contains('close-ad-btn')) {
        if (typeof currentAdLink === 'function') currentAdLink();
        else if (typeof currentAdLink === "string") window.open(currentAdLink, '_blank');
        hideAd();
    }
};
