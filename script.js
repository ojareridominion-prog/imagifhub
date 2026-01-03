import { musicLibrary, categories } from './music.js';
import { nativeAds } from './ads.js';

const API_URL = "";
let activeSwiper = null;
let currentCategory = "Discover";
let songPools = {}; // Tracks unplayed songs for each category

const SEEN_LIMIT = 20;
const SEEN_KEY = "imagifhub-seen-history";

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

// --- MUSIC LOGIC (SHUFFLE POOL) ---
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
    if (localStorage.getItem("isPremium") === "true") return;
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
    if (localStorage.getItem("isPremium") === "true") return;
    actionCount++;
    localStorage.setItem("actionCount", actionCount);
    if (actionCount % 5 === 0) showAd();
    else hideAd();
}

// --- INITIALIZATION ---
window.onload = () => {
    // 1. Setup Categories
    document.getElementById('catBar').innerHTML = categories.map(c => 
        `<button class="cat-btn" onclick="loadFeed('${c}')">${c}</button>`
    ).join('');
    
    // 2. Setup Themes
    document.getElementById('themeGrid').innerHTML = themesList.map(t => `
        <div class="theme-circle" onclick="applyTheme('${t.id}')">
            <div style="background:${t.top}"></div>
            <div style="background:${t.bottom}"></div>
        </div>
    `).join('');

    // 3. Audio Ended Listener
    const audioElem = document.getElementById('bgMusic');
    audioElem.addEventListener('ended', () => {
        console.log("Song ended, picking next track...");
        playRandomMusic(currentCategory); 
    });

    // 4. Load Saved Theme & Initial Feed
    const savedTheme = localStorage.getItem("imagifhub-theme") || "theme-black";
    applyTheme(savedTheme);
    loadFeed("Discover");
};

// --- GLOBAL EXPOSURE ---
window.loadFeed = loadFeed;
window.toggleMenu = toggleMenu;
window.toggleMute = toggleMute;
window.triggerSearch = triggerSearch;
window.applyTheme = applyTheme;
window.shareBot = shareBot;
window.hideAd = hideAd;
window.handleAdClick = (event) => {
    if (!event.target.classList.contains('close-ad-btn')) {
        if (typeof currentAdLink === 'function') currentAdLink();
        else if (typeof currentAdLink === 'string') window.open(currentAdLink, '_blank');
        hideAd();
    }
};
