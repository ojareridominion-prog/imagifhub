// welcome.js - Holiday detection for welcome overlay
import { musicLibrary, categories } from './music.js';
import { getHolidayImage, getFestiveTitle } from './welcome.js';
import { showMonetagInterstitial, showRewardedAd } from './monetag.js';

const API_URL = "https://imagifhub.onrender.com"; 
let activeSwiper = null;
let currentCategory = "Discover";
let songPools = {}; // Tracks unplayed songs for each category

const SEEN_LIMIT = 20;
const SEEN_KEY = "imagifhub-seen-history";
const PREMIUM_CHECK_INTERVAL = 30000; // 30 seconds
let premiumCheckInterval = null;
let isPremiumUser = false;               // GLOBAL PREMIUM FLAG (paid OR temporary)
let paidPremiumActive = false;           // Track paid premium separately
let currentAdIndex = 0;                 // INDEX FOR NATIVE ADS
const AD_FREQUENCY = 3;                 // SHOW AD AFTER EVERY 3 IMAGES
let isLoadingFeed = false;               // PREVENT CONCURRENT FEED LOADS

// --- New random endless scroll variables ---
let allImages = [];                      // Full list of loaded images (no ads)
let sessionSeenUrls = new Set();         // Tracks all URLs shown in current session
let isLoadingMore = false;               // Prevent concurrent page loads
let hasMoreImages = true;                // Whether more images exist on server
const PAGE_SIZE = 30;                    // Number of images per request (30–40)
const MAX_RETRIES = 3;                   // For duplicate filtering
let imagesShownSinceLastAd = 0;          // Counter for Monetag interstitial (every 15 images)

// --- Ads array loaded from API ---
let nativeAds = [];

// --- Search state: prevents auto-refresh when search is active ---
let activeSearchQuery = "";              // non-empty when search mode is active

// --- Dark Text State ---
let darkTextEnabled = localStorage.getItem('imagifhub-darktext') === 'true';

// ==================== TEMPORARY PREMIUM (WATCH ADS) ====================
let tempPremiumInterval = null;
const TEMP_PREMIUM_KEY = "imagifhub_temp_premium_expiry";
const TEMP_AD_COUNT_KEY = "imagifhub_temp_ad_count";

function getTempPremiumExpiry() {
    const expiry = localStorage.getItem(TEMP_PREMIUM_KEY);
    if (!expiry) return null;
    const expiryDate = new Date(expiry);
    return expiryDate > new Date() ? expiryDate : null;
}

function setTempPremiumExpiry(expiryDate) {
    if (expiryDate) {
        localStorage.setItem(TEMP_PREMIUM_KEY, expiryDate.toISOString());
    } else {
        localStorage.removeItem(TEMP_PREMIUM_KEY);
    }
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
    if (!tg.initData) {
        console.error("No initData available");
        return false;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/grant-temp-premium`, {
            method: 'POST',
            headers: {
                'X-Telegram-Init-Data': tg.initData
            }
        });
        
        if (!response.ok) {
            throw new Error("Failed to grant temp premium");
        }
        
        const data = await response.json();
        console.log("Temp premium granted, expires:", data.expires_at);
        
        // Also store locally for immediate UI feedback
        const expiryDate = new Date(data.expires_at);
        setTempPremiumExpiry(expiryDate);
        setTempAdCount(0);
        
        // Reload premium status to activate ad-free mode
        await verifyPremiumStatus();
        resetAndLoadFeed(currentCategory);
        updateWatchAdCard();
        startTempPremiumCountdown();
        
        return true;
    } catch (e) {
        console.error("Error granting temp premium:", e);
        return false;
    }
}

function updateWatchAdCard() {
    const card = document.getElementById('watchAdsCard');
    const progressDiv = document.getElementById('watchAdsProgress');
    const timerDiv = document.getElementById('tempPremiumTimer');
    const watchBtn = document.getElementById('watchAdBtn');
    
    if (!card) return;
    
    // If user has paid premium (and no temp premium active), hide the card
    if (paidPremiumActive && getTempPremiumExpiry() === null) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'block';
    
    const tempExpiry = getTempPremiumExpiry();
    if (tempExpiry) {
        // Temporary premium active
        progressDiv.innerText = "✨ 1-Hour Premium Active ✨";
        if (watchBtn) watchBtn.style.display = 'none';
        // Timer is updated by startTempPremiumCountdown
    } else {
        const count = getTempAdCount();
        progressDiv.innerText = `${count}/3 ads watched`;
        if (watchBtn) watchBtn.style.display = 'block';
        if (timerDiv) timerDiv.innerText = '';
    }
}

function startTempPremiumCountdown() {
    if (tempPremiumInterval) clearInterval(tempPremiumInterval);
    
    const updateTimer = () => {
        const expiry = getTempPremiumExpiry();
        const timerDiv = document.getElementById('tempPremiumTimer');
        if (!timerDiv) return;
        
        if (!expiry) {
            if (timerDiv) timerDiv.innerText = '';
            if (tempPremiumInterval) clearInterval(tempPremiumInterval);
            // Re-evaluate premium status after expiry
            if (isPremiumUser && !getTempPremiumExpiry() && !paidPremiumActive) {
                verifyPremiumStatus().then(() => resetAndLoadFeed(currentCategory));
            }
            return;
        }
        
        const now = new Date();
        const diffMs = expiry - now;
        if (diffMs <= 0) {
            setTempPremiumExpiry(null);
            updateWatchAdCard();
            verifyPremiumStatus().then(() => resetAndLoadFeed(currentCategory));
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
// ==================== END TEMPORARY PREMIUM ====================

async function triggerBotAd() {
    const tg = window.Telegram.WebApp;
    if (!tg.initData) return;
    try {
        await fetch(`${API_URL}/api/trigger-ad`, {
            method: 'POST',
            headers: { 'X-Telegram-Init-Data': tg.initData }
        });
    } catch (e) {
        console.warn("Ad trigger failed", e);
    }
}

// Generate a data URL for a colored circle with initials (Telegram style)
function generateInitialsAvatar(user) {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');

    const colors = [
        '#e56c4b', '#be5c4b', '#b85c4b', '#9c4dff', '#4a90e2',
        '#50c878', '#f4a460', '#daa520', '#cd5c5c', '#4682b4'
    ];
    const colorIndex = (user.id % colors.length + colors.length) % colors.length;
    const bgColor = colors[colorIndex];

    ctx.beginPath();
    ctx.arc(50, 50, 50, 0, 2 * Math.PI);
    ctx.fillStyle = bgColor;
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

function openCopyright() {
    document.getElementById('menuPanel').classList.remove('open');
    document.getElementById('copyrightModal').classList.add('active');
}

function closeCopyright() {
    document.getElementById('copyrightModal').classList.remove('active');
}
// Add after the closeCopyright() function (or anywhere before the global exposure)

function openPrivacy() {
    document.getElementById('menuPanel').classList.remove('open');
    document.getElementById('privacyModal').classList.add('active');
}

function closePrivacy() {
    document.getElementById('privacyModal').classList.remove('active');
}

// Then, inside the global exposure section (window.* = ...), add:


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

// --- HELPER: INTERLEAVE NATIVE ADS AFTER EVERY AD_FREQUENCY IMAGES ---
function buildSlides(images, isPremium) {
    if (isPremium) {
        return images.map(img => ({ type: 'image', item: img }));
    }

    const slides = [];
    let imageCounter = 0;

    for (let i = 0; i < images.length; i++) {
        slides.push({ type: 'image', item: images[i] });
        imageCounter++;

        if (imageCounter % AD_FREQUENCY === 0) {
            const ad = nativeAds[currentAdIndex % nativeAds.length];
            slides.push({
                type: 'ad',
                item: { ...ad, index: currentAdIndex % nativeAds.length }
            });
            currentAdIndex++;
        }
    }
    return slides;
}

// --- LOADING SPINNER ---
function showLoadingSpinner() {
    let spinner = document.getElementById('loadingSpinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'loadingSpinner';
        spinner.innerHTML = '<div class="spinner"></div><p>Loading...</p>';
        spinner.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.7);
            backdrop-filter: blur(8px);
            padding: 10px 20px;
            border-radius: 40px;
            color: white;
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 2000;
            font-size: 14px;
            pointer-events: none;
        `;
        document.body.appendChild(spinner);
    }
    spinner.style.display = 'flex';
}

function hideLoadingSpinner() {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) spinner.style.display = 'none';
}

// --- RENDER SLIDES INTO SWIPER (replaces entire feed) ---
function renderSlides(slides) {
    const feed = document.getElementById('feed');
    feed.innerHTML = slides.map(slide => {
        if (slide.type === 'image') {
            const item = slide.item;
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
                <div class="swiper-slide" data-type="image">
                    <img src="${item.url}" alt="${item.category}" style="width:100%; height:100%; object-fit:cover;">
                    <div class="meta-overlay">
                        <div class="category-tag">#${item.category}</div>
                        <div class="keyword-container">
                            ${keywordHtml}
                        </div>
                    </div>
                </div>
            `;
        } else if (slide.type === 'ad') {
            const ad = slide.item;
            const buttonLabel = ad.buttonLabel || 'Open';
            return `
                <div class="swiper-slide" data-type="ad" data-ad-index="${ad.index}">
                    <img src="${ad.image}" alt="Ad" style="width:100%; height:100%; object-fit:cover;">
                    <div class="ad-overlay">
                        <div class="ad-sponsored">Sponsored</div>
                        <div class="ad-title">${ad.title}</div>
                        <div class="ad-description">${ad.subtitle}</div>
                        <button class="ad-action-btn">${buttonLabel}</button>
                    </div>
                    <button class="remove-ads-btn">Remove Ads</button>
                </div>
            `;
        }
    }).join('');

    // Re-initialize Swiper
    if (activeSwiper) activeSwiper.destroy(true, true);
    activeSwiper = new Swiper('#swiper', { 
        direction: 'vertical', 
        mousewheel: true,
        on: {
            reachEnd: async () => {
                if (activeSearchQuery) return;
                if (!hasMoreImages || isLoadingMore) return;
                await loadMoreImages(true);   // preserve position when auto-loading
            },
            slideChange: function () {
                const activeSlide = this.slides[this.activeIndex];
                if (activeSlide && activeSlide.dataset.type === 'image') {
                    const img = activeSlide.querySelector('img');
                    if (img && img.src) trackSeenImage(img.src);
                    
                    // Increment image counter for Monetag ad (non‑premium only)
                    if (!isPremiumUser) {
                        imagesShownSinceLastAd++;
                        if (imagesShownSinceLastAd >= 15) {
                            imagesShownSinceLastAd = 0;
                            // Pause swiper, show ad, resume
                            this.allowTouchMove = false;
                            showMonetagInterstitial().finally(() => {
                                this.allowTouchMove = true;
                            });
                        }
                    }
                }
            },
            init: function() {
                const activeSlide = this.slides[this.activeIndex];
                if (activeSlide && activeSlide.dataset.type === 'image') {
                    const img = activeSlide.querySelector('img');
                    if (img && img.src) trackSeenImage(img.src);
                }
            }
        }
    });
}

// --- FETCH RANDOM IMAGES FROM BACKEND (no duplicates within session) ---
async function fetchRandomImages(category = currentCategory, search = "", retryCount = 0) {
    if (isLoadingMore) return [];
    isLoadingMore = true;
    showLoadingSpinner();

    try {
        let url = `${API_URL}/media/random?limit=${PAGE_SIZE}`;
        if (category && category !== "Discover") {
            url += `&category=${encodeURIComponent(category)}`;
        }
        if (search && search.trim()) {
            url += `&search=${encodeURIComponent(search.trim())}`;
        }

        const res = await fetch(url);
        let newImages = await res.json();

        if (!newImages || newImages.length === 0) {
            hasMoreImages = false;
            return [];
        }

        const seenHistory = new Set(getSeenList());
        const filtered = newImages.filter(img => 
            !sessionSeenUrls.has(img.url) && !seenHistory.has(img.url)
        );

        if (filtered.length < 10 && retryCount < MAX_RETRIES) {
            console.log(`Only ${filtered.length} new images, retrying... (${retryCount+1}/${MAX_RETRIES})`);
            const more = await fetchRandomImages(category, search, retryCount + 1);
            const combined = [...filtered, ...more];
            const uniqueCombined = [];
            const seenSet = new Set();
            for (const img of combined) {
                if (!seenSet.has(img.url) && !sessionSeenUrls.has(img.url) && !seenHistory.has(img.url)) {
                    seenSet.add(img.url);
                    uniqueCombined.push(img);
                }
            }
            return uniqueCombined;
        }

        filtered.forEach(img => sessionSeenUrls.add(img.url));
        return filtered;
    } catch (e) {
        console.error("Error fetching random images:", e);
        return [];
    } finally {
        isLoadingMore = false;
        hideLoadingSpinner();
    }
}

// --- LOAD MORE IMAGES (called on swipe to end) ---
async function loadMoreImages(preservePosition = false) {
    if (isLoadingMore || !hasMoreImages) return;
    
    let previousIndex = null;
    if (preservePosition && activeSwiper) {
        previousIndex = activeSwiper.activeIndex;
    }
    
    const newImages = await fetchRandomImages(currentCategory, activeSearchQuery);
    if (newImages.length === 0) {
        hasMoreImages = false;
        return;
    }
    
    allImages.push(...newImages);
    const slides = buildSlides(allImages, isPremiumUser);
    renderSlides(slides);
    
    if (preservePosition && previousIndex !== null && activeSwiper) {
        activeSwiper.slideTo(previousIndex, 0);
    }
}

// --- RESET AND LOAD FIRST PAGE (category change or initial load) ---
async function resetAndLoadFeed(cat, search = "", skipAd = false) {
    if (isLoadingFeed) return;
    isLoadingFeed = true;
    
    sessionSeenUrls.clear();
    hasMoreImages = true;
    allImages = [];
    imagesShownSinceLastAd = 0;
    currentAdIndex = 0;
    
    const shouldShowAd = !isPremiumUser && !skipAd && !activeSearchQuery;
    if (shouldShowAd) {
        try {
            await showMonetagInterstitial();
        } catch (e) {
            console.warn('Monetag error, continuing anyway', e);
        }
    }
    
    activeSearchQuery = search || "";
    currentCategory = cat;
    
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.innerText === cat));
    
    const audio = document.getElementById('bgMusic');
    if (audio.paused || currentCategory !== cat) {
        playRandomMusic(cat);
    }
    
    const feed = document.getElementById('feed');
    feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Loading...</h3></div>';
    
    try {
        const newImages = await fetchRandomImages(cat, activeSearchQuery);
        if (newImages.length === 0) {
            feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>No Images Found</h3></div>';
            return;
        }
        allImages = newImages;
        const slides = buildSlides(allImages, isPremiumUser);
        renderSlides(slides);
    } catch (e) {
        feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Connection Error</h3></div>';
    } finally {
        isLoadingFeed = false;
    }
}

async function loadFeed(cat, search = "", skipAd = false) {
    await resetAndLoadFeed(cat, search, skipAd);
}

// --- PREMIUM VERIFICATION FUNCTIONS (modified to include temporary premium) ---

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
    if (indicator) {
        indicator.style.display = isPremium ? 'block' : 'none';
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
        headers: {
            'X-Telegram-Init-Data': tg.initData
        }
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
            setTimeout(() => {
                btn.innerText = originalText;
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy: ', err);
        });
    }
}

async function verifyPremiumStatus() {
    try {
        const tg = window.Telegram.WebApp;
        const initData = tg.initData;
        
        let paidPremium = false;
        let expiry = null;
        let daysLeft = null;
        
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
        } else {
            console.log("No initData available, using localStorage");
            paidPremium = localStorage.getItem("isPremium") === "true";
            expiry = localStorage.getItem("premiumExpires");
            const user = tg.initDataUnsafe?.user;
            if (user) updateUserCard(user);
        }
        // Check temporary premium
        const tempExpiry = getTempPremiumExpiry();
        const tempActive = tempExpiry !== null;
        
        // Combine: user is premium if paid OR temp active
        const newPremiumStatus = paidPremium || tempActive;
        const wasPremium = isPremiumUser;
        
        paidPremiumActive = paidPremium;  // store for UI decisions
        isPremiumUser = newPremiumStatus;
        
        if (paidPremium) {
            localStorage.setItem("isPremium", "true");
            if (expiry) localStorage.setItem("premiumExpires", expiry);
            updatePremiumUI(true, expiry, daysLeft);
            stopPremiumChecking(); // stop periodic checks for paid premium
            // Hide watch-ads card if no temp premium active
            if (!tempActive) updateWatchAdCard();
        } else if (tempActive) {
            // Temporary premium active – treat as premium but without expiry display
            updatePremiumUI(true, null, null);
            // Show watch-ads card with countdown
            updateWatchAdCard();
            startTempPremiumCountdown();
        } else {
            localStorage.removeItem("isPremium");
            localStorage.removeItem("premiumExpires");
            updatePremiumUI(false);
            updateWatchAdCard();
        }
        
        // Only reload feed if premium status changed
        if (wasPremium !== isPremiumUser) {
            resetAndLoadFeed(currentCategory);
        }
        return isPremiumUser;
    } catch (error) {
        console.log("Error verifying premium:", error);
        const paid = localStorage.getItem("isPremium") === "true";
        const tempExpiry = getTempPremiumExpiry();
        const tempActive = tempExpiry !== null;
        const newStatus = paid || tempActive;
        const was = isPremiumUser;
        isPremiumUser = newStatus;
        paidPremiumActive = paid;
        if (was !== newStatus) {
            resetAndLoadFeed(currentCategory);
        }
        updatePremiumUI(paid, null, null);
        if (tempActive) {
            updateWatchAdCard();
            startTempPremiumCountdown();
        } else {
            updateWatchAdCard();
        }
        const user = window.Telegram.WebApp.initDataUnsafe?.user;
        if (user) updateUserCard(user);
        return newStatus;
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
            const wasPremium = isPremiumUser;
            isPremiumUser = true;
            paidPremiumActive = true;
            localStorage.setItem("isPremium", "true");
            localStorage.setItem("premiumExpires", data.expires_at);
            updatePremiumUI(true, data.expires_at, data.days_left);
            stopPremiumChecking();
            if (!wasPremium) {
                resetAndLoadFeed(currentCategory);
            }
            const statusEl = document.getElementById('paymentStatus');
            if (statusEl) {
                statusEl.textContent = "✅ Premium activated! Refreshing...";
                statusEl.style.color = "#4CAF50";
                setTimeout(() => {
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
// --- UI & THEME FUNCTIONS ---
function toggleMenu() { 
    const panel = document.getElementById('menuPanel');
    panel.classList.toggle('open');
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
    if(q) loadFeed("Discover", q, true);
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

// --- PREMIUM MODAL FUNCTIONS ---
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
        const invoiceLink = data.invoice_link;

        tg.openInvoice(invoiceLink, async (status) => {
            if (status === 'paid') {
                statusEl.textContent = "✅ Payment successful! Activating premium...";
                const isPremium = await verifyPremiumStatus();
                if (isPremium) {
                    statusEl.textContent = "✅ Premium activated!";
                    setTimeout(() => {
                        closePremium();
                    }, 1500);
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
        const user = tg.initDataUnsafe?.user;
        if (user) {
            console.log("User ID:", user.id);
        }
    }
}

// --- EVENT DELEGATION FOR AD BUTTONS ---
function setupAdButtonListeners() {
    document.getElementById('feed').addEventListener('click', async (e) => {
        const target = e.target;
        const slide = target.closest('.swiper-slide');
        if (!slide) return;

        if (target.classList.contains('remove-ads-btn')) {
            openPremium();
            e.stopPropagation();
            return;
        }

        if (target.classList.contains('ad-action-btn')) {
            const adIndex = parseInt(slide.dataset.adIndex);
            if (!isNaN(adIndex) && nativeAds[adIndex]) {
                const ad = nativeAds[adIndex];
                if (ad.action) {
                    window.open(ad.action, '_blank');
                }
            }
            e.stopPropagation();
        }
    });
}

// --- FETCH NATIVE ADS FROM API ---
async function fetchNativeAds() {
    try {
        const response = await fetch(`${API_URL}/api/ads`);
        if (response.ok) {
            nativeAds = await response.json();
            console.log(`Loaded ${nativeAds.length} native ads`);
        } else {
            console.warn('Failed to load ads, using empty array');
            nativeAds = [];
        }
    } catch (e) {
        console.error('Error fetching ads:', e);
        nativeAds = [];
    }
}

// --- INITIALIZATION (with watch ad button listener)---
window.onload = async () => {
    initTelegramWebApp();
    await fetchNativeAds();
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
    
    // Watch Ad button listener
    // Watch Ad button listener – add inside window.onload
const watchAdBtn = document.getElementById('watchAdBtn');
if (watchAdBtn) {
    // Remove any existing listeners to avoid duplicates
    const newBtn = watchAdBtn.cloneNode(true);
    watchAdBtn.parentNode.replaceChild(newBtn, watchAdBtn);
    
    newBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        console.log("[WatchAd] Button clicked");
        
        // Disable button briefly to prevent double-click
        newBtn.disabled = true;
        newBtn.innerText = "⏳ Loading ad...";
        
        try {
            await showRewardedAdWrapper();
        } finally {
            newBtn.disabled = false;
            // Restore text if not in temp premium mode
            const tempExpiry = getTempPremiumExpiry();
            if (!tempExpiry) {
                newBtn.innerText = "🎥 Watch Ad";
            } else {
                newBtn.innerText = "🎥 Watch Ad";
            }
        }
    });
}
    
    const welcomeOverlay = document.getElementById('welcomeOverlay');
    const continueBtn = document.getElementById('welcomeContinueBtn');
    
    if (welcomeOverlay && continueBtn) {
        welcomeOverlay.style.backgroundImage = `url('${getHolidayImage()}')`;
        
        continueBtn.addEventListener('click', () => {
            welcomeOverlay.classList.add('hidden');
            triggerBotAd();
            loadFeed("Discover", "", true);
        });
    } else {
        loadFeed("Discover", "", true);
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

// --- GLOBAL EXPOSURE ---
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
window.openPrivacy = openPrivacy;
window.closePrivacy = closePrivacy;
