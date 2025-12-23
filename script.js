const API_URL = "https://imagifhub.onrender.com"; 
let activeSwiper = null;
let lastTap = 0;
let currentCategory = "All";

const musicLibrary = {
    "All": ["https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"],
    "Nature": ["https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"],
    "Default": ["https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3"]
};

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

function playRandomMusic(cat) {
    const audio = document.getElementById('bgMusic');
    // Only change/play if source is empty or paused to avoid restart glitches during reshuffle
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
    feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Loading...</h3></div>';
    
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.innerText === cat));
    playRandomMusic(cat);

    try {
        const res = await fetch(`${API_URL}/media?category=${encodeURIComponent(cat)}&search=${search}`);
        const data = await res.json();
        
        feed.innerHTML = data.map(img => `
            <div class="swiper-slide" ontouchend="handleDoubleTap(event, ${img.id})">
                <img src="${img.url}" loading="lazy">
                <div class="meta-overlay">
                    <b>@IMAGIFHUB</b><br><span>#${img.Keyword || img.category}</span>
                </div>
                <div class="action-btns">
                    <button id="like-${img.id}" onclick="like(${img.id})">❤️</button>
                    <button onclick="save(${img.id})">📂</button>
                    <button onclick="downloadImg('${img.url}', ${img.id})">📥</button>
                </div>
            </div>
        `).join('');

        if (activeSwiper) activeSwiper.destroy(true, true);
        activeSwiper = new Swiper('#swiper', { 
            direction: 'vertical', 
            loop: false, // Handle loop manually via reachEnd for fresh shuffle
            on: {
                reachEnd: function () {
                    setTimeout(() => loadFeed(currentCategory), 500);
                }
            }
        });
    } catch(e) { feed.innerHTML = '<h3>Connection Error</h3>'; }
}

function toggleMenu() { document.getElementById('menuPanel').classList.toggle('open'); }

function applyTheme(themeId) {
    themesList.forEach(t => document.body.classList.remove(t.id));
    if(themeId !== "theme-black") document.body.classList.add(themeId);
    localStorage.setItem("imagifhub-theme", themeId);
}

function triggerSearch() {
    let q = prompt("Search wallpapers:");
    if(q) loadFeed("All", q);
}

function handleDoubleTap(e, id) {
    const now = Date.now();
    if (now - lastTap < 300) {
        const heart = document.createElement('div');
        heart.className = 'heart-pop';
        heart.innerHTML = '❤️';
        e.currentTarget.appendChild(heart);
        setTimeout(() => heart.remove(), 600);
    }
    lastTap = now;
}

function like(id) { console.log("Liked:", id); }
function save(id) { alert("Saved!"); }

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
          
