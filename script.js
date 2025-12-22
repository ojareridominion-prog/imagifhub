// =======================
// DOWNLOAD IMAGE
// =======================
function downloadImg(url, id) {
    const a = document.createElement("a");
    a.href = url;
    a.download = `imagifhub_${id}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// =======================
// LIKE IMAGE
// =======================
function like(id) {
    let likes = JSON.parse(localStorage.getItem("likes")) || {};

    likes[id] = !likes[id];
    localStorage.setItem("likes", JSON.stringify(likes));

    const btn = document.getElementById(`like-${id}`);
    if (btn) {
        btn.style.color = likes[id] ? "red" : "white";
    }
}

// =======================
// SAVE TO PLAYLIST
// =======================
function saveToPlaylist(id, url) {
    let playlist = JSON.parse(localStorage.getItem("playlist")) || [];

    if (!playlist.some(item => item.id === id)) {
        playlist.push({ id, url });
        localStorage.setItem("playlist", JSON.stringify(playlist));
        alert("Saved to Playlist ✅");
    } else {
        alert("Already saved ⚠️");
    }
}
