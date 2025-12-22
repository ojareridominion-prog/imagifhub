const API_URL = "https://imagifhub.onrender.com";
// Use Telegram User ID if available, otherwise default to a test ID (e.g., 999)
const USER_ID = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 999;

let activeSwiper = null;
let lastTap = 0;
let currentCategory = "All";

// Music Library
const musicLibrary = {
    "All": ["https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"],
    "Nature": ["https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"],
    "Default": ["https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3"]
};

// Categories & Themes
const categories = ["All", "Nature", "Space", "City", "Superhero", "Supervillain", "Robotic", "Anime", "Cars", "Wildlife", "Funny", "Seasonal Greetings", "Dark Aesthetic", "Luxury", "Gaming", "Ancient World"];
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

// --- Core Functionality ---

async function loadFeed(cat, search="") {
    currentCategory = cat;
    const feed = document.getElementById('feed');
    
    // Only show loading if it's a fresh category load, not pagination
    if (!activeSwiper || activeSwiper.isBeginning) {
        feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Loading...</h3></div>';
    }
    
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.innerText === cat));
    playRandomMusic(cat);

    try {
        const res = await fetch(`${API_URL}/media?category=${encodeURIComponent(cat)}&search=${search}`);
        const data = await res.json();
        
        feed.innerHTML = data.map(img => `
            <div class="swiper-slide" ontouchend="handleDoubleTap(event, ${img.id})">
                <img src="${img.url}" loading="lazy" alt="${img.category}">
                <div class="meta-overlay">
                    <b>@IMAGIFHUB</b><br><span>#${img.Keyword || img.category}</span>
                </div>
                <div class="action-btns">
                    <button id="like-${img.id}" onclick="like(${img.id})">🤍</button>
                    <button id="save-${img.id}" onclick="save(${img.id})">📂</button>
                    <button onclick="downloadImg('${img.url}', ${img.id})">📥</button>
                </div>
            </div>
        `).join('');

        if (activeSwiper) activeSwiper.destroy(true, true);
        activeSwiper = new Swiper('#swiper', { 
            direction: 'vertical', 
            loop: false,
            on: {
                reachEnd: function () {
                    // Logic for infinite scroll could go here
                }
            }
        });
    } catch(e) { 
        console.error(e);
        feed.innerHTML = '<div class="swiper-slide" style="display:flex;justify-content:center;align-items:center;"><h3>Connection Error</h3></div>'; 
    }
}

// --- Action Buttons ---

// 1. LIKE FUNCTIONALITY
async function like(id) {
    const btn = document.getElementById(`like-${id}`);
    
    // UI Update immediately for responsiveness
    btn.innerHTML = "❤️"; 
    btn.style.color = "red";
    
    // Visual Pop Animation
    btn.style.transition = "transform 0.2s";
    btn.style.transform = "scale(1.3)";
    setTimeout(() => btn.style.transform = "scale(1)", 200);

    // Backend Call
    try {
        await fetch(`${API_URL}/like/${id}`, { method: 'POST' });
    } catch (e) {
        console.error("Like failed:", e);
    }
}

// 2. SAVE TO PLAYLIST FUNCTIONALITY
async function save(id) {
    const btn = document.getElementById(`save-${id}`);
    
    try {
        const res = await fetch(`${API_URL}/playlist/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: USER_ID, media_id: id })
        });
        
        if (res.ok) {
            btn.innerHTML = "✅"; // Change icon to indicate success
            setTimeout(() => btn.innerHTML = "📂", 2000); // Reset after 2s
        } else {
            alert("Failed to save.");
        }
    } catch (e) {
        console.error("Save error:", e);
        alert("Connection error.");
    }
}

// 3. DOWNLOAD FUNCTIONALITY
async function downloadImg(url, id) {
    try {
        // Fetch the image as a blob to bypass some CORS issues with direct links
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `imagifhub_${id}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up
        window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
        console.error("Download failed, trying fallback:", e);
        // Fallback: Open in new tab if programmatic download fails
        window.open(url, '_blank');
    }
}

// --- Helper Functions ---

function handleDoubleTap(e, id) {
    const now = Date.now();
    if (now - lastTap < 300) {
        const heart = document.createElement('div');
        heart.className = 'heart-pop';
        heart.innerHTML = '❤️';
        e.currentTarget.appendChild(heart);
        setTimeout(() => heart.remove(), 600);
        like(id); // Trigger like on double tap
    }
    lastTap = now;
}

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

function toggleMenu() { document.getElementById('menuPanel').classList.toggle('open'); }

function triggerSearch() {
    let q = prompt("Search wallpapers:");
    if(q) loadFeed("All", q);
}

function applyTheme(themeId) {
    themesList.forEach(t => document.body.classList.remove(t.id));
    if(themeId !== "theme-black") document.body.classList.add(themeId);
    localStorage.setItem("imagifhub-theme", themeId);
}

// --- Initialization ---

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
    loadFeed("All");
};
          
