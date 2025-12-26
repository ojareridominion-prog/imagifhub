const API_URL = "https://imagifhub.onrender.com"; 
let activeSwiper = null;
let lastTap = 0;
let currentCategory = "Featured";

const musicLibrary = {
    "Featured": ["https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"],
    "Nature": ["https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"],
    "Default": ["https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3"]
};

const categories = ["Featured", "Nature", "Places", "Aesthetic", "Cars", "Luxury", "Anime", "Animals", "Ancient"];

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
    let q = prompt("Search images:");
    if(q) loadFeed("Featured", q);
}





// --- New functions for menu handling ---

function toggleOptionsMenu(event, id) {
    event.stopPropagation(); // Prevent triggering slide taps
    const menuId = `menu-${id}`;
    
    // Close other open menus first
    document.querySelectorAll('.options-menu.show').forEach(m => {
        if(m.id !== menuId) m.classList.remove('show');
    });

    const menu = document.getElementById(menuId);
    if (menu) {
        menu.classList.toggle('show');
    }
}

// Close menu if clicking outside on the slide
document.addEventListener('click', function(e) {
    if (!e.target.closest('.options-menu') && !e.target.closest('.more-btn')) {
         document.querySelectorAll('.options-menu.show').forEach(m => m.classList.remove('show'));
    }
});


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
          
