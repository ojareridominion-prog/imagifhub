// --- TELEGRAM USER ---
const tg = window.Telegram?.WebApp;
const user = tg?.initDataUnsafe?.user;
const telegramId = user?.id || null;

// --- ADMIN WHITELIST ---
const ADMIN_IDS = [
    123456789 // ← REPLACE WITH YOUR TELEGRAM ID
];

// --- ELEMENTS ---
const statusText = document.getElementById("statusText");
const subscribeBtn = document.getElementById("subscribeBtn");

// --- ADMIN ALWAYS PREMIUM ---
if (telegramId && ADMIN_IDS.includes(telegramId)) {
    statusText.innerText = "You are Premium (Admin)";
    subscribeBtn.style.display = "none";
}

// --- PAYMENT PLACEHOLDER ---
subscribeBtn.addEventListener("click", () => {
    alert("Premium subscriptions are coming soon 🚀");
});

document.getElementById("cancelBtn").addEventListener("click", async () => {
    if (confirm("Are you sure? Your premium features will stop at the end of the current period.")) {
        // Update Supabase to set auto_renew = false (if you implement recurring)
        alert("Auto-renewal cancelled.");
    }
});
