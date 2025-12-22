function like(id) {
    let likes = JSON.parse(localStorage.getItem("likes")) || {};
    likes[id] = !likes[id];
    localStorage.setItem("likes", JSON.stringify(likes));

    const btn = document.getElementById(`like-${id}`);
    if (btn) btn.style.color = likes[id] ? "red" : "white";
}

function downloadImg(url, id) {
    const a = document.createElement("a");
    a.href = url;
    a.download = `imagifhub_${id}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function saveToPlaylist(id, url) {
    let playlist = JSON.parse(localStorage.getItem("playlist")) || [];
    if (!playlist.some(i => i.id === id)) {
        playlist.push({ id, url });
        localStorage.setItem("playlist", JSON.stringify(playlist));
        alert("Saved ✅");
    }
}
