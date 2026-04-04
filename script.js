// script.js - Full version with proper AdsGram interstitial ads
import { musicLibrary, categories } from './music.js';
import { nativeAds } from './ads.js';
import { getHolidayImage, getFestiveTitle } from './welcome.js';
import { showInterstitialAd } from './adsgram.js';

const API_URL = "https://imagifhub.onrender.com";
let activeSwiper = null;
let currentCategory = "Discover";
let songPools = {};
let isPremiumUser = false;

// Ad sequencing
const AD_FREQUENCY = 3;           // Show ad after every 3 images
let imageCountSinceLastAd = 0;
let adPending = false;

// Native ad cycling (fallback)
let currentNativeAdIndex = 0;

// --- History tracking (unchanged) ---
const SEEN_LIMIT = 20;
const SEEN_KEY = "imagifhub-seen-history";

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

// --- User Info Card & Avatar (unchanged) ---
function generateInitialsAvatar(user) {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    const colors = ['#e56c4b', '#be5c4b', '#b85c4b', '#9c4dff', '#4a90e2', '#50c878', '#f4a460', '#daa520', '#cd5c5c', '#4682b4'];
    const colorIndex = (user.id % colors.length + colors.length) % colors.length;
    ctx.beginPath();
    ctx.arc(50, 50, 50, 0, 2 * Math.PI);
    ctx.fillStyle = colors[colorIndex];
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 40px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let initials = '';
    if (user.first_name) initials += user.first_name.charAt(0).toUpperCase();
    if (user.last_name) initials += user.last_name.charAt(0).toUpperCase();
    if (!initials && user.username) initials = user.username.charAt(0).toUpperCase();
    if (!initials) initials = 'U';
    ctx.fillText(initials, 50, 50);
    return canvas.toDataURL('image/png');
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
    .then(response => {
        if (!response.ok) throw new Error('No photo');
        return response.blob();
    })
    .then(blob => {
        const url = URL.createObjectURL(blob);
        avatarImg.src = url;
    })
    .catch(() => {
        avatarImg.src = generateInitialsAvatar(user);
    });
}

function copyUserId() {
    const userId = document.getElementById('userId').innerText;
    if (userId && userId !== '-') {
        navigator.clipboard.writeText(userId).then(() => {
            const btn = document.getElementById('copyIdBtn');
            const originalText = btn.innerText;
            btn.innerText = '✅ Copied!';
            setTimeout(() => { btn.innerText = originalText; }, 1500);
        }).catch(err => console.error('Failed to copy: ', err));
    }
}

// --- Theme handling (unchanged) ---
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

function applyTheme(themeId) {
    themesList.forEach(t => document.body.classList.remove(t.id));
    if(themeId !== "theme-black") document.body.classList.add(themeId);
    localStorage.setItem("imagifhub-theme", themeId);
}

// --- Music logic (unchanged) ---
function playRandomMusic(cat) {
    const audio = document.getElementById('bgMusic');
    const allSongs = musicLibrary[cat] || musicLibrary["Default"];
    if (!allSongs || allSongs.length === 0) return;
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

// --- Insert a native ad slide (fallback) ---
function insertNativeAdSlide() {
    const nativeAd = nativeAds[currentNativeAdIndex % nativeAds.length];
    currentNativeAdIndex++;
    if (!nativeAd) return;

    const feed = document.getElementById('feed');
    const adHtml = `
        <div class="swiper-slide native-ad" data-type="ad" data-ad-url="${nativeAd.action || ''}">
            <img src="${nativeAd.image}" alt="Ad" style="width:100%; height:100%; object-fit:cover;">
            <div class="ad-overlay">
                <div class="ad-sponsored">Sponsored</div>
                <div class="ad-title">${escapeHtml(nativeAd.title)}</div>
                <div class="ad-description">${escapeHtml(nativeAd.subtitle)}</div>
                <button class="ad-action-btn" data-url="${nativeAd.action || ''}">${escapeHtml(nativeAd.buttonLabel)}</button>
            </div>
            <button class="remove-ads-btn">Remove Ads</button>
        </div>
    `;
    feed.insertAdjacentHTML('beforeend', adHtml);
    if (activeSwiper) activeSwiper.update();
}

// --- Show ad (preferred: AdsGram interstitial, fallback: native slide) ---
async function showAdAndContinue() {
    if (isPremiumUser) return true;

    // Try AdsGram interstitial first
    const adCompleted = await showInterstitialAd();
    if (adCompleted) {
        console.log("[Ad] AdsGram interstitial completed");
        return true;
    } else {
        // Fallback to native ad slide
        console.log("[Ad] AdsGram failed, showing native ad slide");
        insertNativeAdSlide();
        // Wait for user to swipe past the native ad (they can click "Remove Ads" to go premium)
        // The slide will be shown automatically; no need to block further swiping.
        return true;
    }
}

// --- BUILD SLIDES (only images, no pre-inserted ads) ---
function buildSlides(images) {
    return images.map(img => ({
        type: 'image',
        item: img
    }));
}

// --- LOAD FEED (ads are inserted dynamically) ---
async function loadFeed(cat, search = "") {
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

        // Reset ad counter
        imageCountSinceLastAd = 0;
        adPending = false;

        const slides = buildSlides(data);
        feed.innerHTML = slides.map(slide => {
            const item = slide.item;
            const keyword = item.Keyword || '';
            const maxLength = 100;
            let keywordHtml = '';
            if (keyword.length > maxLength) {
                const truncated = keyword.substring(0, maxLength) + '...';
                keywordHtml = `
                    <span class="keyword-short">${escapeHtml(truncated)}</span>
                    <span class="keyword-full" style="display:none;">${escapeHtml(keyword)}</span>
                    <button class="more-btn">more</button>
                    <button class="less-btn" style="display:none;">less</button>
                `;
            } else {
                keywordHtml = `<span>${escapeHtml(keyword)}</span>`;
            }
            return `
                <div class="swiper-slide" data-type="image">
                    <img src="${item.url}" alt="${escapeHtml(item.category)}" style="width:100%; height:100%; object-fit:cover;">
                    <div class="meta-overlay">
                        <div class="category-tag">#${escapeHtml(item.category)}</div>
                        <div class="keyword-container">${keywordHtml}</div>
                    </div>
                </div>
            `;
        }).join('');

        if (activeSwiper) activeSwiper.destroy(true, true);
        activeSwiper = new Swiper('#swiper', {
            direction: 'vertical',
            mousewheel: true,
            on: {
                reachEnd: () => setTimeout(() => loadFeed(currentCategory), 1000),
                slideChange: async function () {
                    const activeSlide = this.slides[this.activeIndex];
                    if (activeSlide && activeSlide.dataset.type === 'image') {
                        const img = activeSlide.querySelector('img');
                        if (img && img.src) trackSeenImage(img.src);

                        // Increment image counter and show ad if threshold reached (only if not premium)
                        if (!isPremiumUser) {
                            imageCountSinceLastAd++;
                            if (imageCountSinceLastAd >= AD_FREQUENCY && !adPending) {
                                adPending = true;
                                imageCountSinceLastAd = 0;
                                // Pause swiper temporarily? We'll just show ad and let user continue.
                                // But showing an interstitial will block UI; after ad, we just reset flag.
                                await showAdAndContinue();
                                adPending = false;
                                // No need to insert slide because interstitial takes over full screen.
                            }
                        }
                    }
                },
                init: function () {
                    const activeSlide = this.slides[this.activeIndex];
                    if (activeSlide && activeSlide.dataset.type === 'image') {
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

// Helper to escape HTML (unchanged)
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// --- PREMIUM FUNCTIONS (unchanged) ---
function formatExpiryDate(expiryStr) {
    if (!expiryStr) return '';
    try {
        const expiryMs = new Date(expiryStr).getTime();
        const nowMs = Date.now();
        const diffMs = expiryMs - nowMs;
        const daysLeft = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (daysLeft < 0) return 'Expired';
        if (daysLeft === 0) return 'Expires today';
        if (daysLeft === 1) return 'Expires tomorrow';
        return `${daysLeft} days left`;
    } catch (e) {
        return '';
    }
}

function updatePremiumUI(isPremium, expiryStr = null, daysLeft = null) {
    const premiumBtn = document.querySelector('.premium-btn-menu');
    const expiryDisplay = document.getElementById('premiumExpiryDisplay');
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
    if (expiryDisplay) {
        if (isPremium) {
            let displayText = '';
            if (daysLeft !== null) {
                if (daysLeft < 0) displayText = 'Expired';
                else if (daysLeft === 0) displayText = 'Expires today';
                else if (daysLeft === 1) displayText = 'Expires tomorrow';
                else displayText = `${daysLeft} days left`;
            } else {
                if (!expiryStr) expiryStr = localStorage.getItem("premiumExpires");
                displayText = formatExpiryDate(expiryStr);
            }
            expiryDisplay.innerText = displayText || "Premium active";
        } else {
            expiryDisplay.innerText = "Enjoy ad-free smooth scrolling";
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
    if (indicator) indicator.style.display = isPremium ? 'block' : 'none';
    if (isPremium) loadFeed(currentCategory);
}

async function verifyPremiumStatus() {
    try {
        const tg = window.Telegram.WebApp;
        const initData = tg.initData;
        if (!initData) {
            console.log("No initData available, using localStorage");
            const isPremium = localStorage.getItem("isPremium") === "true";
            const expiry = localStorage.getItem("premiumExpires");
            isPremiumUser = isPremium;
            updatePremiumUI(isPremium, expiry, null);
            const user = tg.initDataUnsafe?.user;
            if (user) updateUserCard(user);
            return isPremium;
        }
        const response = await fetch(`${API_URL}/api/user-data`, {
            headers: { 'X-Telegram-Init-Data': initData }
        });
        const data = await response.json();
        if (data.user) updateUserCard(data.user);
        else {
            const user = tg.initDataUnsafe?.user;
            if (user) updateUserCard(user);
        }
        const newPremiumStatus = data.premium === true;
        const wasPremium = isPremiumUser;
        isPremiumUser = newPremiumStatus;
        if (data.premium) {
            localStorage.setItem("isPremium", "true");
            localStorage.setItem("premiumExpires", data.expires_at);
            updatePremiumUI(true, data.expires_at, data.days_left);
            if (!wasPremium) loadFeed(currentCategory);
            return true;
        } else {
            localStorage.removeItem("isPremium");
            localStorage.removeItem("premiumExpires");
            updatePremiumUI(false);
            if (wasPremium) loadFeed(currentCategory);
            return false;
        }
    } catch (error) {
        console.log("Error verifying premium:", error);
        const isPremium = localStorage.getItem("isPremium") === "true";
        const expiry = localStorage.getItem("premiumExpires");
        isPremiumUser = isPremium;
        updatePremiumUI(isPremium, expiry, null);
        const user = window.Telegram.WebApp.initDataUnsafe?.user;
        if (user) updateUserCard(user);
        return isPremium;
    }
}

let premiumCheckInterval = null;
const PREMIUM_CHECK_INTERVAL = 30000;

function startPremiumChecking(userId) {
    stopPremiumChecking();
    checkPremiumStatus(userId);
    premiumCheckInterval = setInterval(() => checkPremiumStatus(userId), PREMIUM_CHECK_INTERVAL);
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
            const wasPremium = isPremiumUser;
            isPremiumUser = true;
            localStorage.setItem("isPremium", "true");
            localStorage.setItem("premiumExpires", data.expires_at);
            updatePremiumUI(true, data.expires_at, data.days_left);
            stopPremiumChecking();
            if (!wasPremium) loadFeed(currentCategory);
            const statusEl = document.getElementById('paymentStatus');
            if (statusEl) {
                statusEl.textContent = "✅ Premium activated! Refreshing...";
                statusEl.style.color = "#4CAF50";
            setTimeout(() => closePremium(), 2000);
            }
            return true;
        }
        return false;
    } catch (error) {
        console.log("Error checking premium status:", error);
        return false;
    }
}

// --- UI Functions (unchanged) ---
function toggleMenu() {
    const panel = document.getElementById('menuPanel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) verifyPremiumStatus();
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
        if (navigator.share) await navigator.share(shareData);
        else {
            await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
            alert('Link & Text copied to clipboard!');
   }
    } catch (err) { console.log('Error sharing:', err); }
}

// --- Premium Modal (unchanged) ---
function openPremium() {
    document.getElementById('menuPanel').classList.remove('open');
    document.getElementById('premiumModal').classList.add('active');
}

function closePremium() {
    document.getElementById('premiumModal').classList.remove('active');
}

async function goPremium() {
    const tg = window.Telegram.WebApp;
    const statusEl = document.getElementById('paymentStatus');
    const btn = document.getElementById('btnBuy');
    if (!tg.openInvoice) {
        statusEl.textContent = "Opening Telegram...";
        const userId = tg.initDataUnsafe?.user?.id;
        if (userId) tg.openLink(`https://t.me/IMAGIFHUB_bot?start=premium_${userId}`);
        return;
    }
    statusEl.textContent = "Creating invoice...";
    btn.disabled = true;
    try {
        const response = await fetch(`${API_URL}/api/create-invoice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData }
        });
        if (!response.ok) {
            let errorMsg = 'Failed to create invoice';
            try { const errData = await response.json(); errorMsg = errData.detail || errorMsg; } catch(e) {}
            throw new Error(errorMsg);
        }
        const data = await response.json();
        tg.openInvoice(data.invoice_link, async (status) => {
            if (status === 'paid') {
                statusEl.textContent = "✅ Payment successful! Activating premium...";
                const isPremium = await verifyPremiumStatus();
                if (isPremium) {
                    statusEl.textContent = "✅ Premium activated!";
                    setTimeout(() => closePremium(), 1500);
                } else {
                    statusEl.textContent = "⚠️ Payment received but activation delayed. Please refresh.";
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
        const checkBtn = document.createElement('button');
        checkBtn.className = 'btn-check';
        checkBtn.innerHTML = '🔄 Check Premium Status';
        checkBtn.style.cssText = `background:transparent; color:#4CAF50; border:1px solid #4CAF50; padding:10px; width:100%; border-radius:8px; margin-top:10px; cursor:pointer;`;
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

function openCopyright() {
    document.getElementById('menuPanel').classList.remove('open');
    document.getElementById('copyrightModal').classList.add('active');
}

function closeCopyright() {
    document.getElementById('copyrightModal').classList.remove('active');
}

function initTelegramWebApp() {
    const tg = window.Telegram.WebApp;
    if (tg && tg.expand) {
        tg.expand();
        console.log("Telegram WebApp version:", tg.version);
    }
}

// --- Ad Button Listeners (handles native ad clicks) ---
function setupAdButtonListeners() {
    document.getElementById('feed').addEventListener('click', (e) => {
        const target = e.target;
        const slide = target.closest('.swiper-slide');
        if (!slide) return;

        if (target.classList.contains('ad-action-btn')) {
            const url = target.getAttribute('data-url');
            if (url && url.startsWith('http')) {
                if (window.Telegram?.WebApp?.openLink) {
                    window.Telegram.WebApp.openLink(url);
                } else {
                    window.open(url, '_blank');
                }
            }
            e.stopPropagation();
        }
        else if (target.classList.contains('remove-ads-btn')) {
            openPremium();
            e.stopPropagation();
        }
    });
}

// --- Initialization ---
window.onload = async () => {
    initTelegramWebApp();
    await verifyPremiumStatus();

    document.getElementById('catBar').innerHTML = categories.map(c =>
        `<button class="cat-btn" onclick="loadFeed('${c}')">${c}</button>`
    ).join('');

    document.getElementById('themeGrid').innerHTML = themesList.map(t => `
        <div class="theme-circle" onclick="applyTheme('${t.id}')">
            <div style="background:${t.top}"></div>
            <div style="background:${t.bottom}"></div>
        </div>
    `).join('');

    const audioElem = document.getElementById('bgMusic');
    audioElem.addEventListener('ended', () => {
        if (currentCategory) playRandomMusic(currentCategory);
    });

    const savedTheme = localStorage.getItem("imagifhub-theme") || "theme-black";
    applyTheme(savedTheme);
    applyDarkText();
    updateDarkTextIndicator();

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

    document.querySelector('.top-bar h2').innerText = getFestiveTitle();
    addManualPremiumCheck();

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

    setupAdButtonListeners();
};

// Expose functions globally
window.loadFeed = loadFeed;
window.toggleMenu = toggleMenu;
window.toggleMute = toggleMute;
window.triggerSearch = triggerSearch;
window.applyTheme = applyTheme;
window.shareBot = shareBot;
window.openPremium = openPremium;
window.closePremium = closePremium;
window.goPremium = goPremium;
window.verifyPremiumStatus = verifyPremiumStatus;
window.toggleDarkText = toggleDarkText;
window.openCopyright = openCopyright;
window.closeCopyright = closeCopyright;
window.copyUserId = copyUserId;
