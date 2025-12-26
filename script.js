const API_URL = "https://imagifhub.onrender.com"; 
let activeSwiper = null;
let currentCategory = "Featured";

const musicLibrary = {
    "Featured": ["https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"],
    "Nature": ["https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"],
    "Default": ["https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3"]
};

const categories = ["Featured", "Nature", "Places", "Aesthetic", "Cars", "Luxury", "Anime", "Animals", "Ancient"];

const SEEN_LIMIT = 20;
const SEEN_KEY = "imagifhub-seen-history";

function getSeenList() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } 
    catch { return []; }
}

function trackSeenImage(url) {
    let seen = getSeenList();
    // Remove if exists (to move it to the end/most recent position)
    seen = seen.filter(u => u !== url);
    seen.push(url);
    
    // Keep only the last 20
    if (seen.length > SEEN_LIMIT) seen.shift();
    
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}
// ----------------------

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
    if (!audio.src || audio.paused) {
        const songs = musicLibrary[cat] || musicLibrary["Default"];
        const randomSong = songs[Math.floor(Math.random() * songs.length)];
        audio.src = randomSong;
        audio.play().catch(() => console.log("User interaction required for audio"));
    }
}

function toggleMute() {
    const audio = document.getElementById('bgMusic');
    const btn = document.getElementById('muteBtn');
    audio.muted = !audio.muted;
    btn.innerText = audio.muted ? "🔇" : "🔊";
}

async function loadFeed(cat, search="") {
    currentCategory = cat;
    const feed = document.getElementById('feed');
    
    // Show loading indicator while fetching
    feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Loading...</h3></div>';
    
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.innerText === cat));
    playRandomMusic(cat);

    try {
                const res = await fetch(`${API_URL}/media?category=${encodeURIComponent(cat)}&search=${search}`);
        let data = await res.json(); // Changed 'const' to 'let' to allow reassignment

        // --- ADD THIS FILTERING LOGIC ---
        if (data && data.length > 0) {
            const seenList = getSeenList();
            // Filter out images that are in the seen list
            const uniqueData = data.filter(item => !seenList.includes(item.url));
            
            // If we have unique images, use them. 
            // If filtering removed everything (rare), fall back to original data to avoid empty screen.
            if (uniqueData.length > 0) {
                data = uniqueData;
            }
        }
        // -------------------------------
        
        if (!data || data.length === 0) {
            
            feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>No Images Found</h3></div>';
            return;
        }

        // Map data to Swiper slides
        feed.innerHTML = data.map(item => `
            <div class="swiper-slide">
                <img src="${item.url}" alt="${item.category}" style="width:100%; height:100%; object-fit:cover;">
                
                <div class="meta-overlay">
                    <div style="font-weight:bold; font-size:18px;">#${item.category}</div>
                    <div style="font-size:12px; opacity:0.8;">${item.Keyword || ''}</div>
                </div>

                
            </div>
        `).join('');

         // Refresh Swiper instance
        if (activeSwiper) activeSwiper.destroy(true, true);
        activeSwiper = new Swiper('#swiper', { 
            direction: 'vertical', 
            loop: false, 
            mousewheel: true,
            on: {
                reachEnd: function () {
                    setTimeout(() => loadFeed(currentCategory), 1000);
                },
                // --- ADD THIS EVENT ---
                slideChange: function () {
                    const activeSlide = this.slides[this.activeIndex];
                    const img = activeSlide.querySelector('img');
                    if (img && img.src) {
                        trackSeenImage(img.src);
                    }
                },
                init: function() {
                    // Track the very first image immediately upon load
                    const activeSlide = this.slides[this.activeIndex];
                    if(activeSlide) {
                         const img = activeSlide.querySelector('img');
                         if (img && img.src) trackSeenImage(img.src);
                    }
                }
                // ----------------------
            }
        });
        
    } catch(e) { 
        feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Connection Error</h3></div>'; 
    }
}

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
    if(q) loadFeed("Featured", q);
}

// --- SHARE BOT FUNCTION ---
async function shareBot() {
    // Configuration for sharing
    const shareData = {
        title: 'IMAGIFHUB',
        text: 'Check out IMAGIFHUB! The best place for 4K Gifs and Wallpapers. ✨',
        url: 'https://t.me/IMAGIFHUB_bot' // Replace with your actual bot link
    };

    try {
        // Check if the browser supports native sharing (mobile)
        if (navigator.share) {
            await navigator.share(shareData);
            console.log('Shared successfully');
        } else {
            // Fallback: Copy to clipboard if native share isn't available (desktop)
            await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
            alert('Link & Text copied to clipboard! Share it with your friends.');
        }
    } catch (err) {
        console.log('Error sharing:', err);
    }
}


window.onload = () => {
    document.getElementById('catBar').innerHTML = categories.map(c => 
        `<button class="cat-btn" onclick="loadFeed('${c}')">${c}</button>`
    ).join('');
    
    document.getElementById('themeGrid').innerHTML = themesList.map(t => `
        <div class="theme-circle" onclick="applyTheme('${t.id}')">
            <div style="background:${t.top}"></div>
            <div style="background:${t.bottom}"></div>
        </div>
    `).join('');

    const saved = localStorage.getItem("imagifhub-theme") || "theme-black";
    applyTheme(saved);
    loadFeed("Featured");
};
