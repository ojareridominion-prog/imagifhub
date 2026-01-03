//

const tg = window.Telegram?.WebApp;
const user = tg?.initDataUnsafe?.user;
const telegramId = user?.id || null;

// --- ADMIN WHITELIST ---
const ADMIN_IDS = [
    6403924487
];

const statusText = document.getElementById("statusText");
const subscribeBtn = document.getElementById("subscribeBtn"); // Ensure this ID matches your HTML button

// --- ADMIN CHECK ---
if (telegramId && ADMIN_IDS.includes(telegramId)) {
    // If you have a specific element for status, update it
    if(statusText) statusText.innerText = "You are Premium (Admin)";
    if(subscribeBtn) subscribeBtn.style.display = "none";
}

// --- GO PREMIUM FUNCTION ---
// Attach this to the window so the HTML 'onclick' can find it
window.goPremium = async function() {
    if (!telegramId) {
        alert("Please open this app from Telegram to subscribe.");
        return;
    }

    // Disable button to prevent double clicks
    const btn = document.querySelector('.premium-btn');
    if(btn) btn.innerText = "Loading...";

    try {
        // 1. Get the invoice URL from your API
        const res = await fetch('/api/create-invoice', {                                              
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: telegramId })
        });
        
        const data = await res.json();
        
        if (!data.invoice_url) {
            throw new Error("Could not generate invoice");
        }

        // 2. Open the Invoice inside Telegram
        tg.openInvoice(data.invoice_url, function(status) {
            if (status === "paid") {
                tg.showPopup({
                    title: "Success!",
                    message: "Welcome to Premium! 🌟",
                    buttons: [{type: "ok"}]
                });
                // Optionally reload to update UI
                localStorage.setItem("isPremium", "true");
                setTimeout(() => window.location.href = "index.html", 1500);
            } else if (status === "cancelled") {
                // User closed the popup
            } else {
                alert("Payment failed or was cancelled.");
            }
            if(btn) btn.innerText = "Go Premium";
        });

    } catch (error) {
        console.error(error);
        alert("Error creating invoice. Please try again.");
        if(btn) btn.innerText = "Go Premium";
    }
};

window.goBack = function() {
    window.location.href = "index.html";
};
