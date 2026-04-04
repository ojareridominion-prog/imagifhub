// welcome.js - Holiday detection for welcome overlay
import { musicLibrary, categories } from './music.js';
import { nativeAds } from './ads.js';
import { getHolidayImage, getFestiveTitle } from './welcome.js';

const API_URL = "https://imagifhub.onrender.com"; 
let activeSwiper = null;
let currentCategory = "Discover";
let songPools = {};

const SEEN_LIMIT = 20;
const SEEN_KEY = "imagifhub-seen-history";
const PREMIUM_CHECK_INTERVAL = 30000;
let premiumCheckInterval = null;
let isPremiumUser = false;
let currentAdIndex = 0;
const AD_FREQUENCY = 3;                 // Show ad group after every 3 images


// --- Dark Text State ---
let darkTextEnabled = localStorage.getItem('imagifhub-darktext') === 'true';

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

// ==================== AdsGram Integration ====================

/**
 * Fetch a single ad from AdsGram.
 * Returns a Promise that resolves to an ad object with fields:
 *   - image: string (URL of the ad creative)
 *   - title: string
 *   - subtitle: string (description)
 *   - buttonLabel: string (CTA text)
 *   - action: string (click URL) or function
 * If the ad fails to load, the Promise rejects.
 */
async function fetchSingleAdsGramAd() {
    if (!window.Adsgram) {
        console.warn("AdsGram SDK not loaded");
        throw new Error("AdsGram SDK not available");
    }

    // Replace with your actual AdsGram block ID and ad placement logic
    // Example using AdsGram's in-feed ad method (adjust based on your AdsGram setup)
    return new Promise((resolve, reject) => {
        // Create a temporary container for the ad (required by some AdsGram methods)
        const container = document.createElement('div');
        container.style.display = 'none';
        document.body.appendChild(container);

        // Initialize the ad unit
        const ad = new window.Adsgram.MainAd({
            blockId: "YOUR_ADSGRAM_BLOCK_ID",  // <-- REPLACE WITH YOUR ACTUAL BLOCK ID
            container: container,
            onBannerLoaded: (data) => {
                // data typically contains creativeUrl, title, description, cta, clickUrl
                document.body.removeChild(container);
                resolve({
                    image: data.creativeUrl || data.imageUrl,
                    title: data.title || "Sponsored",
                    subtitle: data.description || "Advertisement",
                    buttonLabel: data.ctaText || "Learn More",
                    action: data.clickUrl || data.link,
                    isAdsGram: true
                });
            },
            onError: (error) => {
                document.body.removeChild(container);
                console.error("AdsGram error:", error);
                reject(error);
            },
            onNoBanner: () => {
                document.body.removeChild(container);
                reject(new Error("No banner available"));
            }
        });
        ad.load();
    });
}

/**
 * Ensure we have at least `count` AdsGram ads in the cache.
 * Fetches missing ads in parallel.
 */
async function ensureAdsgramAds(count) {
    if (!ADSGRAM_ENABLED) return;
    const needed = Math.max(0, count - adsgramAdCache.length);
    if (needed === 0) return;

    // Avoid concurrent fetches that would over-fetch
    if (isFetchingAdsgram) {
        // Wait for ongoing fetch to complete
        return new Promise((resolve) => {
            adsgramFetchQueue.push(resolve);
        });
    }

    isFetchingAdsgram = true;
    const fetchPromises = [];
    for (let i = 0; i < needed; i++) {
        fetchPromises.push(fetchSingleAdsGramAd().catch(err => {
            console.warn("AdsGram fetch failed, will use native fallback", err);
            return null;
        }));
    }

    const results = await Promise.all(fetchPromises);
    const validAds = results.filter(ad => ad !== null);
    adsgramAdCache.push(...validAds);

    isFetchingAdsgram = false;

    // Resolve any queued waiters
    while (adsgramFetchQueue.length) {
        const resolve = adsgramFetchQueue.shift();
        resolve();
    }
}

/**
 * Get an ad group consisting of:
 *   - 1 native ad (from nativeAds, cyclically)
 *   - 2 AdsGram ads (or fallback to native if not enough AdsGram ads)
 */
// ==================== Ad Type Cycling ====================
const AD_TYPE_CYCLE = ['native', 'adsgram', 'adsgram'];  // repeats: native, adsgram, adsgram
let currentAdTypeIndex = 0;

// Single ad cache for AdsGram (pre-fetch one at a time)
let nextAdsgramAd = null;
let fetchingAdsgram = false;

/**
 * Fetch one AdsGram ad and store it in nextAdsgramAd.
 * Returns a Promise that resolves when the ad is ready (or null if failed).
 */
async function prefetchAdsgramAd() {
    if (fetchingAdsgram) return;
    fetchingAdsgram = true;
    try {
        const ad = await fetchSingleAdsGramAd();
        nextAdsgramAd = ad;
    } catch (e) {
        console.warn("AdsGram prefetch failed", e);
        nextAdsgramAd = null;
    } finally {
        fetchingAdsgram = false;
    }
}

/**
 * Get the next ad based on the current type in the cycle.
 * Returns a Promise that resolves to an ad object.
 */
async function getNextAd() {
    const type = AD_TYPE_CYCLE[currentAdTypeIndex];
    // Advance for next call
    currentAdTypeIndex = (currentAdTypeIndex + 1) % AD_TYPE_CYCLE.length;

    if (type === 'native') {
        // Native ad from your array (cyclical)
        const ad = nativeAds[currentAdIndex % nativeAds.length];
        currentAdIndex++;
        return { ...ad, type: 'native' };
    } else {
        // AdsGram ad (with fallback to native if unavailable)
        if (!ADSGRAM_ENABLED) {
            // Fallback to native
            const fallback = nativeAds[currentAdIndex % nativeAds.length];
            currentAdIndex++;
            return { ...fallback, type: 'native_fallback' };
        }

        // Use cached AdsGram ad if available
        let ad = nextAdsgramAd;
        if (ad) {
            nextAdsgramAd = null;
            // Pre-fetch the next one in background
            prefetchAdsgramAd();
            return { ...ad, type: 'adsgram' };
        } else {
            // No cached ad: fetch synchronously (may delay, but fallback ensures ad is shown)
            try {
                ad = await fetchSingleAdsGramAd();
                // Pre-fetch the next one
                prefetchAdsgramAd();
                return { ...ad, type: 'adsgram' };
            } catch (e) {
                console.warn("AdsGram fetch failed, using native fallback", e);
                const fallback = nativeAds[currentAdIndex % nativeAds.length];
                currentAdIndex++;
                return { ...fallback, type: 'native_fallback' };
            }
        }
    }
}

// Start pre-fetching the first AdsGram ad when the app loads
setTimeout(() => prefetchAdsgramAd(), 2000);

// ==================== Core Feed Logic ====================

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

        // Build slides with ad groups
        const slides = await buildSlidesWithAds(data, isPremiumUser);
        
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
            } else {
                // Ad slide (native or AdsGram)
                const ad = slide.item;
                const buttonLabel = ad.buttonLabel || 'Open';
                const isAdsGram = ad.type === 'adsgram';
                const actionUrl = ad.action && typeof ad.action === 'string' ? ad.action : '';
return `
    <div class="swiper-slide" data-type="ad" data-ad-id="${ad.id || ''}" data-ad-type="${ad.type}" ${actionUrl ? `data-action-url="${actionUrl}"` : ''}>
        <img src="${ad.image}" alt="Ad" style="width:100%; height:100%; object-fit:cover;">
        <div class="ad-overlay">
            <div class="ad-sponsored">${isAdsGram ? 'Advertisement' : 'Sponsored'}</div>
            <div class="ad-title">${ad.title}</div>
            <div class="ad-description">${ad.subtitle}</div>
            <button class="ad-action-btn" ${actionUrl ? `data-action-url="${actionUrl}"` : ''}>${buttonLabel}</button>
        </div>
        <button class="remove-ads-btn">Remove Ads</button>
    </div>
`;
            }
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
                    if (activeSlide && activeSlide.dataset.type === 'image') {
                        const img = activeSlide.querySelector('img');
                        if (img && img.src) trackSeenImage(img.src);
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
        
    } catch(e) { 
        feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Connection Error</h3></div>'; 
    }
}

/**
 * Build slides array interleaving image slides with ad groups.
 * For premium users, returns only images (no ads).
 */
async function buildSlidesWithAds(images, isPremium) {
    if (isPremium) {
        return images.map(img => ({ type: 'image', item: img }));
    }

    const slides = [];
    let imageCounter = 0;

    for (let i = 0; i < images.length; i++) {
        slides.push({ type: 'image', item: images[i] });
        imageCounter++;

        if (imageCounter >= AD_FREQUENCY) {
            // Insert ONE ad (type determined by cycle)
            const ad = await getNextAd();
            slides.push({ type: 'ad', item: ad });
            imageCounter = 0;
        }
    }
    return slides;
}

// ==================== Premium Functions ====================

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
    
    if (isPremium) {
        loadFeed(currentCategory);
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
            headers: {
                'X-Telegram-Init-Data': initData
            }
        });
        
        const data = await response.json();
        
        if (data.user) {
            updateUserCard(data.user);
        } else {
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
            stopPremiumChecking();
            if (!wasPremium) {
                loadFeed(currentCategory);
            }
            return true;
        } else {
            localStorage.removeItem("isPremium");
            localStorage.removeItem("premiumExpires");
            updatePremiumUI(false);
            if (wasPremium) {
                loadFeed(currentCategory);
            }
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
            localStorage.setItem("isPremium", "true");
            localStorage.setItem("premiumExpires", data.expires_at);
            updatePremiumUI(true, data.expires_at, data.days_left);
            stopPremiumChecking();
            if (!wasPremium) {
                loadFeed(currentCategory);
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

function setupAdButtonListeners() {
    document.getElementById('feed').addEventListener('click', (e) => {
        const target = e.target;
        const slide = target.closest('.swiper-slide');
        if (!slide) return;

        if (target.classList.contains('ad-action-btn')) {
            // Try to get action URL from button or slide
            const actionUrl = target.dataset.actionUrl || slide.dataset.actionUrl;
            if (actionUrl) {
                window.open(actionUrl, '_blank');
            } else {
                // Fallback for native ads that use a function
                const adId = slide.dataset.adId;
                const nativeAd = nativeAds.find(a => a.id == adId);
                if (nativeAd && nativeAd.action) {
                    if (typeof nativeAd.action === 'function') {
                        nativeAd.action();
                    } else if (typeof nativeAd.action === 'string') {
                        window.open(nativeAd.action, '_blank');
                    }
                }
            }
            e.stopPropagation();
        } else if (target.classList.contains('remove-ads-btn')) {
            openPremium();
            e.stopPropagation();
        }
    });
}

// ==================== UI Functions ====================

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


// Store action URLs for AdsGram ads in button dataset when rendering
// (Modified in buildSlidesWithAds rendering part)
// We'll adjust the HTML generation to include data-action-url for AdsGram ads

// ==================== Initialization ====================

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

// Override the slide generation to include action URL for AdsGram ads
// We'll modify the feed innerHTML generation inside loadFeed to attach data-action-url
// But to keep it clean, we'll override the rendering part where ad slide is created.
// Since loadFeed uses slides.map, we need to inject the action URL into the button.

// Patch the loadFeed function's slide generation for AdsGram ads
// This is a monkey-patch but works for the purpose.
const originalLoadFeed = loadFeed;
window.loadFeed = async function(cat, search) {
    await originalLoadFeed(cat, search);
    // After rendering, attach action URLs to AdsGram ad buttons
    document.querySelectorAll('.swiper-slide[data-ad-type="adsgram"]').forEach(slide => {
        const btn = slide.querySelector('.ad-action-btn');
        if (btn && !btn.dataset.actionUrl) {
            // Find the ad object that corresponds to this slide (simplified: assume it's stored)
            // We could store the action URL in a data attribute during generation.
            // For simplicity, we'll re-extract from the global ad cache? Not reliable.
            // Better to modify the HTML generation directly.
        }
    });
};

// To properly store action URL, we need to adjust the HTML generation inside loadFeed.
// Since we can't replace the entire loadFeed again, I'll provide a modified version of the ad slide HTML:
// In the `slides.map` inside loadFeed, for AdsGram ads, add:
// data-action-url="${ad.action}"
// and in the button: data-action-url="${ad.action}"
// Then in the event listener, use that.

// The final loadFeed function is already updated above with the correct HTML structure.
// Please ensure the `slides.map` includes the data-action-url attribute for AdsGram ads.

// For completeness, here is the corrected ad slide HTML section (already included in the loadFeed above):
/*
return `
    <div class="swiper-slide" data-type="ad" data-ad-id="${ad.id || ''}" data-ad-type="${ad.type}" ${ad.type === 'adsgram' ? `data-action-url="${ad.action}"` : ''}>
        <img src="${ad.image}" alt="Ad" style="width:100%; height:100%; object-fit:cover;">
        <div class="ad-overlay">
            <div class="ad-sponsored">${isAdsGram ? 'Advertisement' : 'Sponsored'}</div>
            <div class="ad-title">${ad.title}</div>
            <div class="ad-description">${ad.subtitle}</div>
            <button class="ad-action-btn" ${ad.type === 'adsgram' ? `data-action-url="${ad.action}"` : ''}>${buttonLabel}</button>
        </div>
        <button class="remove-ads-btn">Remove Ads</button>
    </div>
`;
*/

// Update event listener to use the data-action-url
const originalSetup = setupAdButtonListeners;
window.setupAdButtonListeners = function() {
    document.getElementById('feed').addEventListener('click', (e) => {
        const target = e.target;
        const slide = target.closest('.swiper-slide');
        if (!slide) return;

        if (target.classList.contains('ad-action-btn')) {
            const actionUrl = target.dataset.actionUrl || slide.dataset.actionUrl;
            if (actionUrl) {
                window.open(actionUrl, '_blank');
            } else {
                // Fallback for native ads (by id)
                const adId = slide.dataset.adId;
                const nativeAd = nativeAds.find(a => a.id == adId);
                if (nativeAd && nativeAd.action) {
                    if (typeof nativeAd.action === 'function') {
                        nativeAd.action();
                    } else if (typeof nativeAd.action === 'string') {
                        window.open(nativeAd.action, '_blank');
                    }
                }
            }
            e.stopPropagation();
        } else if (target.classList.contains('remove-ads-btn')) {
            openPremium();
            e.stopPropagation();
        }
    });
};

// Re-run setup after load
window.setupAdButtonListeners();

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
