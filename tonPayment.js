// tonPayment.js – Direct blockchain polling (no payload, dynamic amount)
import { verifyPremiumStatus } from './premiumManager.js';

let tonConnectUI = null;
let walletConnected = false;
let walletAddress = null;
let initializationPromise = null;

const API_URL = "https://imagifhub.onrender.com";
const MANIFEST_URL = `${API_URL}/ton-manifest.json`;

function updateWalletUI() {
    const walletRow = document.getElementById('walletConnectRow');
    if (!walletRow) return;
    if (walletConnected && walletAddress) {
        const shortAddr = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
        walletRow.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; width:100%;"><span>💎 TON Wallet</span><span style="font-family:monospace; background:rgba(255,255,255,0.2); padding:2px 8px; border-radius:12px;">${shortAddr}</span></div>`;
        walletRow.onclick = showDisconnectConfirm;
    } else {
        walletRow.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; width:100%;"><span>💎 Connect TON Wallet</span><span style="font-size:20px;">➔</span></div>`;
        walletRow.onclick = () => connectWallet();
    }
}

export async function initTonConnectUI() {
    if (tonConnectUI) return tonConnectUI;
    if (initializationPromise) return initializationPromise;
    
    initializationPromise = (async () => {
        if (document.readyState === 'loading') {
            await new Promise(resolve => {
                document.addEventListener('DOMContentLoaded', resolve, { once: true });
            });
        }
        
        const startTime = Date.now();
        const maxWaitTime = 8000;
        while (!window.TON_CONNECT_UI && (Date.now() - startTime) < maxWaitTime) {
            await new Promise(r => setTimeout(r, 100));
        }
        if (!window.TON_CONNECT_UI) {
            console.error("TonConnectUI SDK failed to load");
            return null;
        }
        const TonConnectUIConstructor = window.TON_CONNECT_UI.TonConnectUI || window.TON_CONNECT_UI.default?.TonConnectUI;
        if (!TonConnectUIConstructor) {
            console.error("TonConnectUI constructor not found");
            return null;
        }
        
        tonConnectUI = new TonConnectUIConstructor({
            manifestUrl: MANIFEST_URL,
            actionsConfiguration: {
                twaReturnUrl: 'https://t.me/IMAGIFHUB_bot/imagifhub'
            }
        });
        
        try {
            const storedWallet = localStorage.getItem("ton_wallet_address");
            if (storedWallet && tonConnectUI.wallet) {
                walletConnected = true;
                walletAddress = tonConnectUI.wallet.account.address;
                updateWalletUI();
            }
        } catch (e) { console.warn(e); }
        
        tonConnectUI.onStatusChange((wallet) => {
            if (wallet) {
                walletConnected = true;
                walletAddress = wallet.account.address;
                try { localStorage.setItem("ton_wallet_address", wallet.account.address); } catch(e) {}
                updateWalletUI();
            } else {
                walletConnected = false;
                walletAddress = null;
                try { localStorage.removeItem("ton_wallet_address"); } catch(e) {}
                updateWalletUI();
            }
        });
        
        return tonConnectUI;
    })();
    return initializationPromise;
}

function closeMenuIfOpen() {
    const panel = document.getElementById('menuPanel');
    const overlay = document.getElementById('menuOverlay');
    if (panel && panel.classList.contains('open')) {
        panel.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}

export async function connectWallet() {
    closeMenuIfOpen();
    await new Promise(resolve => setTimeout(resolve, 150));
    try {
        const ui = await initTonConnectUI();
        if (!ui) throw new Error("TON SDK not ready");
        await ui.openModal();
    } catch (e) {
        console.error("Connection error:", e);
        if (window.Telegram?.WebApp?.showAlert) {
            window.Telegram.WebApp.showAlert("Wallet connection failed. Please try again.");
        }
    }
}

export async function disconnectTonWallet() {
    if (tonConnectUI) {
        try { await tonConnectUI.disconnect(); } catch(e) {}
    }
    walletConnected = false;
    walletAddress = null;
    try { localStorage.removeItem("ton_wallet_address"); } catch(e) {}
    updateWalletUI();
}

function showDisconnectConfirm() {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:20000; display:flex; align-items:center; justify-content:center;`;
    const box = document.createElement('div');
    box.style.cssText = `background:#1a1a1a; padding:20px 30px; border-radius:20px; text-align:center; color:white; max-width:280px; backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.2);`;
    box.innerHTML = `
        <div style="margin-bottom:20px;">Disconnect wallet?</div>
        <div style="display:flex; gap:12px; justify-content:center;">
            <button id="confirmDisconnect" style="background:#ff4444; border:none; padding:8px 20px; border-radius:30px; color:white; font-weight:bold;">Disconnect</button>
            <button id="cancelDisconnect" style="background:transparent; border:1px solid white; padding:8px 20px; border-radius:30px; color:white;">Cancel</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const confirmBtn = box.querySelector('#confirmDisconnect');
    const cancelBtn = box.querySelector('#cancelDisconnect');
    confirmBtn.onclick = async () => {
        await disconnectTonWallet();
        overlay.remove();
    };
    cancelBtn.onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

export async function initWalletUI() {
    try {
        const userCard = document.querySelector('.user-info-card');
        if (!userCard) {
            setTimeout(initWalletUI, 500);
            return;
        }
        const oldRow = document.getElementById('walletConnectRow');
        if (oldRow) oldRow.remove();
        const walletRow = document.createElement('div');
        walletRow.id = 'walletConnectRow';
        walletRow.style.cssText = 'width:100%; margin-top:12px; padding:8px 0; border-top:1px solid rgba(255,255,255,0.1); cursor:pointer;';
        userCard.appendChild(walletRow);
        await initTonConnectUI();
        updateWalletUI();
    } catch (err) {
        console.error("initWalletUI error:", err);
    }
}

// ========== NEW POLLING LOGIC (wallet‑based) ==========
async function pollWalletPayment(walletAddr, expectedAmountTon, maxAttempts = 60, intervalMs = 2000) {
    const tg = window.Telegram.WebApp;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const url = `${API_URL}/api/ton-check-payment?wallet=${encodeURIComponent(walletAddr)}&amount=${expectedAmountTon}`;
            const response = await fetch(url, {
                headers: { 'X-Telegram-Init-Data': tg.initData }
            });
            const result = await response.json();
            if (result.status === 'completed') {
                return true;
            }
        } catch (err) {
            console.warn("Polling error:", err);
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
}

export async function sendTonPremiumPayment() {
    const tg = window.Telegram.WebApp;
    const statusEl = document.getElementById('paymentStatus');
    
    let amountTon = 1.12;
    try {
        const configRes = await fetch(`${API_URL}/api/ton-config`);
        const config = await configRes.json();
        if (config.amount) amountTon = config.amount;
    } catch (e) {
        console.warn("Could not fetch TON amount, using default 1.12", e);
    }
    
    const adminAddr = await fetchTonAdminAddress();
    if (!adminAddr) throw new Error("Admin address missing");

    if (!walletConnected) {
        await connectWallet();
        let attempts = 0;
        while (!walletConnected && attempts < 15) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }
        if (!walletConnected) throw new Error("Wallet not connected");
    }

    // Ensure we have the user's wallet address
    const userWallet = walletAddress;
    if (!userWallet) throw new Error("Wallet address not available");

    const amountNano = Math.floor(amountTon * 1e9);
    
    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{
            address: adminAddr,
            amount: amountNano.toString()
        }]
    };

    try {
        const ui = await initTonConnectUI();
        if (!ui) throw new Error("TON SDK unavailable");
        
        // Send transaction – we don't wait for hash, we will poll the user's wallet history
        await ui.sendTransaction(transaction);
        
        if (statusEl) {
            statusEl.textContent = "⏳ Payment sent. Waiting for blockchain confirmation...";
            statusEl.style.color = "#ffd700";
        }
        
        // Poll the new endpoint using the user's wallet address
        const confirmed = await pollWalletPayment(userWallet, amountTon, 60, 2000);
        
        if (confirmed) {
            await verifyPremiumStatus();
            if (statusEl) {
                statusEl.textContent = "✅ Premium activated!";
                statusEl.style.color = "#4CAF50";
            }
            setTimeout(() => { if (window.closePremium) window.closePremium(); }, 1500);
            return true;
        } else {
            if (statusEl) {
                statusEl.textContent = "⏳ Payment may take a few moments. Checking again...";
                statusEl.style.color = "#ffd700";
            }
            // One last check after extra delay
            await new Promise(r => setTimeout(r, 5000));
            const premiumActive = await verifyPremiumStatus();
            if (premiumActive) {
                if (statusEl) {
                    statusEl.textContent = "✅ Premium activated!";
                    statusEl.style.color = "#4CAF50";
                }
                setTimeout(() => { if (window.closePremium) window.closePremium(); }, 1500);
                return true;
            } else {
                throw new Error("Transaction not confirmed on blockchain after multiple attempts");
            }
        }
    } catch (err) {
        console.error("TON payment error:", err);
        if (tg.showAlert) tg.showAlert("TON payment failed: " + err.message);
        throw err;
    }
}

async function fetchTonAdminAddress() {
    try {
        const res = await fetch(`${API_URL}/api/ton-config`);
        const data = await res.json();
        return data.adminAddress;
    } catch (e) {
        console.error("Failed to fetch admin address", e);
        return null;
    }
}

window.initWalletUI = initWalletUI;
window.sendTonPremiumPayment = sendTonPremiumPayment;
window.disconnectTonWallet = disconnectTonWallet;
