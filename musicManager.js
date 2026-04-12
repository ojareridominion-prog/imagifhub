// musicManager.js
import { musicLibrary } from './music.js';
import { state } from './state.js';

export function playRandomMusic(cat) {
    const audio = document.getElementById('bgMusic');
    const allSongs = musicLibrary[cat] || musicLibrary["Default"];
    if (!allSongs || allSongs.length === 0) return;
    if (!state.songPools[cat] || state.songPools[cat].length === 0) {
        state.songPools[cat] = [...allSongs];
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
