// utils.js
const SEEN_KEY = "imagifhub-seen-history";
const SEEN_LIMIT = 20;

export function getSeenList() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } 
    catch { return []; }
}

export function trackSeenImage(url) {
    let seen = getSeenList();
    seen = seen.filter(u => u !== url);
    seen.push(url);
    if (seen.length > SEEN_LIMIT) seen.shift();
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}

export function generateInitialsAvatar(user) {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    const colors = [
        '#e56c4b', '#be5c4b', '#b85c4b', '#9c4dff', '#4a90e2',
        '#50c878', '#f4a460', '#daa520', '#cd5c5c', '#4682b4'
    ];
    const colorIndex = (user.id % colors.length + colors.length) % colors.length;
    ctx.beginPath();
    ctx.arc(50, 50, 50, 0, 2 * Math.PI);
    ctx.fillStyle = colors[colorIndex];
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 40px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let initials = '';
    if (user.first_name) initials += user.first_name.charAt(0).toUpperCase();
    if (user.last_name) initials += user.last_name.charAt(0).toUpperCase();
    if (!initials && user.username) initials = user.username.charAt(0).toUpperCase();
    if (!initials) initials = 'U';
    ctx.fillText(initials, 50, 50);
    return canvas.toDataURL('image/png');
}

export function showLoadingSpinner() {
    let spinner = document.getElementById('loadingSpinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'loadingSpinner';
        spinner.innerHTML = '<div class="spinner"></div><p>Loading...</p>';
        spinner.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.7);
            backdrop-filter: blur(8px);
            padding: 10px 20px;
            border-radius: 40px;
            color: white;
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 2000;
            font-size: 14px;
            pointer-events: none;
        `;
        document.body.appendChild(spinner);
    }
    spinner.style.display = 'flex';
}

export function hideLoadingSpinner() {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) spinner.style.display = 'none';
          }
