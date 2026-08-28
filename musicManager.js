// musicManager.js
import { state } from './state.js';

const API_URL = "https://imagifhub.onrender.com";

/**
 * Fetch music URLs for a category from Supabase via backend API.
 */
async function fetchMusicForCategory(category) {
    try {
        const res = await fetch(`${API_URL}/api/music?category=${encodeURIComponent(category)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const urls = await res.json();
        return urls;
    } catch (e) {
        console.error(`Failed to fetch music for category "${category}":`, e);
        return [];
    }
}

/**
 * Play a random track for the given category.
 * Fetches from API if not already cached in state.songPools.
 */
export async function playRandomMusic(cat) {
    const audio = document.getElementById('bgMusic');
    if (!audio) return;

    // If no pool or empty, fetch
    if (!state.songPools[cat] || state.songPools[cat].length === 0) {
        let songs = await fetchMusicForCategory(cat);
        if (songs.length === 0) {
            // Fallback to Default if not already trying Default
            if (cat !== "Default") {
                console.log(`No tracks for "${cat}", falling back to Default`);
                return await playRandomMusic("Default");
            }
            console.warn('No music tracks available.');
            return;
        }
        // Shuffle
        state.songPools[cat] = [...songs];
        for (let i = state.songPools[cat].length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [state.songPools[cat][i], state.songPools[cat][j]] = [state.songPools[cat][j], state.songPools[cat][i]];
        }
    }

    const nextSong = state.songPools[cat].pop();
    audio.src = nextSong;
    audio.load();
    audio.play().catch(() => console.log("Interaction required for audio"));
}

export function toggleMute() {
    const audio = document.getElementById('bgMusic');
    const btn = document.getElementById('muteBtn');
    audio.muted = !audio.muted;
    btn.innerText = audio.muted ? "🔇" : "🔊";
}
