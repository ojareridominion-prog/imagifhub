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
        
        // --- Find this part in loadFeed function and replace it ---
        feed.innerHTML = data.map(img => `
            <div class="swiper-slide" ontouchend="handleDoubleTap(event, ${img.id})">
                <img src="${img.url}" loading="lazy" alt="${img.category}">
                
                <button class="more-btn" onclick="toggleOptionsMenu(event, '${img.id}')">⋮</button>

                <div class="options-menu" id="menu-${img.id}" onclick="event.stopPropagation()">
                    <div class="menu-header">
                        Options
                        <button class="menu-close" onclick="toggleOptionsMenu(event, '${img.id}')">×</button>
                    </div>
                    
                    <button class="menu-item" onclick="downloadImage('${img.url}'); toggleOptionsMenu(event, '${img.id}')">
                        <span>📥</span> Download
                    </button>
                    
                    <button class="menu-item" onclick="saveImage(${img.id}); toggleOptionsMenu(event, '${img.id}')">
                        <span>🔖</span> Save
                    </button>
                </div>
                <div class="meta-overlay">
                    <b>@IMAGIFHUB</b><br><span>#${img.Keyword || img.category}</span>
                </div>
                <div class="action-btns">
                    </div>
            </div>
        `).join('');
// --- End replacement ---
        

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




function save(id) { alert("Saved!"); }

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

async function downloadImage(url) {
    try {
        // Attempt to fetch the image as a blob to force download
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = blobUrl;
        // Use a generic name or try to extract from URL
        a.download = `imagifhub-${new Date().getTime()}.jpg`; 
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
        console.error("Download failed due to CORS or network error, opening in new tab:", e);
        // Fallback: Open in new tab if fetch fails (common due to CORS on external image hosts)
        window.open(url, '_blank');
    }
}

// Replace or update your existing save function
function saveImage(id) {
    // In a full implementation, this would call your API endpoint:
    // fetch(`${API_URL}/playlist/add`, { method: 'POST', ... })
    
    // For now, using a visual confirmation based on your existing code's style
    alert(`Image ${id} saved to playlist!`);
    // Alternatively, you could trigger the heart animation here if you have it:
    // triggerHeartAnimation(id); 
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
    loadFeed("All");
};
          
