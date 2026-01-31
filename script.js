import { musicLibrary, categories } from './music.js';
import { nativeAds } from './ads.js';

const API_URL ="https://imagifhub.vercel.app"; //"imagifhub.vercel.app";
let activeSwiper = null;
let currentCategory = "Discover";
let songPools = {}; // Tracks unplayed songs for each category

const SEEN_LIMIT = 20;
const SEEN_KEY = "imagifhub-seen-history";
const PREMIUM_CHECK_INTERVAL = 30000; // 30 seconds
let premiumCheckInterval = null;

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

    // Play music if it's not already playing or if we switched categories
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

        feed.innerHTML = data.map(item => `
            <div class="swiper-slide">
                <img src="${item.url}" alt="${item.category}" style="width:100%; height:100%; object-fit:cover;">
                <div class="meta-overlay">
                    <div style="font-weight:bold; font-size:18px;">#${item.category}</div>
                    <div style="font-size:12px; opacity:0.8;">${item.Keyword || ''}</div>
                </div>
            </div>
        `).join('');

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
            stopPremiumChecking(); // Stop checking if premium is active
            return true;
        } else {
            localStorage.removeItem("isPremium");
            localStorage.removeItem("premiumExpires");
            updatePremiumUI(false);
            return false;
        }
    } catch (error) {
        console.log("Error verifying premium:", error);
        // Fall back to localStorage if server check fails
        const isPremium = localStorage.getItem("isPremium") === "true";
        updatePremiumUI(isPremium);
        return isPremium;
    }
}

function startPremiumChecking(userId) {
    // Clear any existing interval
    stopPremiumChecking();
    
    // Check immediately
    checkPremiumStatus(userId);
    
    // Then check every 30 seconds
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
            
            // Show success message
            const statusEl = document.getElementById('paymentStatus');
            if (statusEl) {
                statusEl.textContent = "✅ Premium activated! Refreshing...";
                statusEl.style.color = "#4CAF50";
                
                // Refresh the feed to remove ads
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
    // Update menu button
    const premiumBtn = document.querySelector('.premium-btn-menu');
    if (premiumBtn) {
        if (isPremium) {
            premiumBtn.innerText = "⭐ PREMIUM ACTIVE";
            premiumBtn.style.background = "#4CAF50";
            premiumBtn.style.color = "white";
            premiumBtn.disabled = true;
            premiumBtn.onclick = null;
        } else {
            premiumBtn.innerText = "UPGRADE NOW";
            premiumBtn.style.background = "white";
            premiumBtn.style.color = "#9c4dff";
            premiumBtn.disabled = false;
            premiumBtn.onclick = openPremium;
        }
    }
    
    // Update modal button
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
    
    // Update premium indicator
    const indicator = document.getElementById('premiumIndicator');
    if (indicator) {
        indicator.style.display = isPremium ? 'block' : 'none';
    }
    
    // Hide ad if premium
    if (isPremium) {
        hideAd();
    }
}

// --- UI & THEME FUNCTIONS ---
function toggleMenu() { 
    document.getElementById('menuPanel').classList.toggle('open'); 
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
    if (actionCount % 5 === 0) {
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

async function goPremium() {
    console.log("Starting premium purchase flow...");
    const tg = window.Telegram.WebApp;
    const btn = document.getElementById('btnBuy');
    const statusEl = document.getElementById('paymentStatus');
    
    // Get user ID from Telegram
    const userId = tg.initDataUnsafe?.user?.id;
    
    if (!userId) {
        statusEl.textContent = "❌ Please open in Telegram app to purchase";
        statusEl.style.color = "#ff4444";
        return;
    }
    
    btn.innerText = "Opening Telegram...";
    btn.disabled = true;
    statusEl.textContent = "Opening Telegram for payment...";
    statusEl.style.color = "#ffd700";
    
    try {
        // Method 1: Use Telegram's openLink method (most reliable)
        if (tg.openLink) {
            const botLink = `https://t.me/IMAGIFHUB_bot?start=premium_${userId}`;
            tg.openLink(botLink);
            tg.close();
        }
        // Method 2: Use window.open for web
        else {
            const botLink = `https://t.me/IMAGIFHUB_bot?start=premium_${userId}`;
            window.open(botLink, '_blank');
        }
        
        // Start checking for premium status
        statusEl.textContent = "✅ Opened Telegram. Complete purchase in chat, then return here...";
        
        // Start polling for premium activation
        startPremiumChecking(userId);
        
        // Set timeout to stop checking after 10 minutes
        setTimeout(() => {
            stopPremiumChecking();
            if (localStorage.getItem("isPremium") !== "true") {
                statusEl.textContent = "❌ Purchase timeout. Please try again.";
                btn.innerText = "Go Premium";
                btn.disabled = false;
            }
        }, 600000); // 10 minutes
        
    } catch (error) {
        console.error("Error opening Telegram:", error);
        statusEl.textContent = "❌ Error opening Telegram. Please try again.";
        btn.innerText = "Go Premium";
        btn.disabled = false;
    }
}

function addManualPremiumCheck() {
    // Add a manual check button to premium modal
    const premiumCard = document.querySelector('.premium-card');
    if (premiumCard) {
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
        
        // Debug
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
        playRandomMusic(currentCategory); 
    });

    // 6. Load Saved Theme & Initial Feed
    const savedTheme = localStorage.getItem("imagifhub-theme") || "theme-black";
    applyTheme(savedTheme);
    loadFeed("Discover");
    
    // 7. Add manual premium check button
    addManualPremiumCheck();
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

window.handleAdClick = (event) => {
    if (!event.target.classList.contains('close-ad-btn')) {
        if (typeof currentAdLink === 'function') currentAdLink();
        else if (typeof currentAdLink === "string") window.open(currentAdLink, '_blank');
        hideAd();
    }
};
