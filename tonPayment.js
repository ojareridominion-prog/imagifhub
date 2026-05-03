// tonPayment.js
import { verifyPremiumStatus } from './premiumManager.js';

let tonConnectUI = null;
let walletConnected = false;
let walletAddress = null;

const API_URL = "https://imagifhub.onrender.com";
// The manifest is now hosted on your GitHub Pages domain
const MANIFEST_URL = "https://ojareridominion-prog.github.io/imagifhub/tonconnect-manifest.json";

// Helper to safely update the wallet row in the menu
function updateWalletUI() {
    const walletRow = document.getElementById('walletConnectRow');
    if (!walletRow) return;
    if (walletConnected && walletAddress) {
        const shortAddr = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
        walletRow.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                <span>💎 TON Wallet</span>
                <span style="font-family:monospace; background:rgba(255,255,255,0.2); padding:2px 8px; border-radius:12px;">${shortAddr}</span>
            </div>
        `;
        walletRow.onclick = showDisconnectConfirm;
    } else {
        walletRow.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                <span>💎 Connect TON Wallet</span>
                <span style="font-size:20px;">➔</span>
            </div>
        `;
        walletRow.onclick = () => connectWallet();
    }
}

// Helper to show connection status in the wallet row
function setStatusMessage(msg, isError = false) {
    const walletRow = document.getElementById('walletConnectRow');
    if (!walletRow) return;
    const style = isError ? 'color:#ff8888;' : 'color:#88ff88;';
    const originalHtml = walletRow.innerHTML;
    walletRow.innerHTML = `<div style="font-size:12px;${style}">${msg}</div>`;
    setTimeout(() => {
        if (walletRow && walletRow.innerHTML === `<div style="font-size:12px;${style}">${msg}</div>`) {
            walletRow.innerHTML = originalHtml;
        }
    }, 3000);
}

// Wait for TonConnectUI to be available (with timeout)
async function waitForTonConnectUI() {
    if (window.TonConnectUI) return window.TonConnectUI;
    return new Promise((resolve) => {
        const handler = () => {
            if (window.TonConnectUI) {
                window.removeEventListener('tonconnect-ready', handler);
                resolve(window.TonConnectUI);
            }
        };
        window.addEventListener('tonconnect-ready', handler);
        // also check immediately in case event was missed
        if (window.TonConnectUI) {
            window.removeEventListener('tonconnect-ready', handler);
            resolve(window.TonConnectUI);
        }
        // timeout after 5 seconds
        setTimeout(() => {
            window.removeEventListener('tonconnect-ready', handler);
            if (window.TonConnectUI) resolve(window.TonConnectUI);
            else resolve(null);
        }, 5000);
    });
}

// Initialize TonConnectUI once
async function initTonConnectUI() {
    if (tonConnectUI) return tonConnectUI;
    const TonConnectUIClass = await waitForTonConnectUI();
    if (!TonConnectUIClass) {
        console.error("[TON] TonConnectUI library not loaded");
        setStatusMessage("Wallet SDK not ready", true);
        return null;
    }
    try {
        const tg = window.Telegram.WebApp;
        // CRITICAL FIX: Use the correct return URL format for Telegram Mini App
        // Must be the exact HTTPS URL of your Mini App, not the bot username format
        const twaReturnUrl = 'https://ojareridominion-prog.github.io/imagifhub/';
        
        tonConnectUI = new TonConnectUIClass({
            manifestUrl: MANIFEST_URL,
            actionsConfiguration: {
                twaReturnUrl: twaReturnUrl,
                returnStrategy: 'back' // fallback strategy
            }
        });
        
        // Listen for connection status changes
        tonConnectUI.onStatusChange((wallet) => {
            if (wallet) {
                walletConnected = true;
                walletAddress = wallet.account.address;
                localStorage.setItem("ton_wallet_address", walletAddress);
                console.log("[TON] Wallet connected:", walletAddress);
                setStatusMessage("✅ Wallet connected");
            } else {
                walletConnected = false;
                walletAddress = null;
                localStorage.removeItem("ton_wallet_address");
                console.log("[TON] Wallet disconnected");
                setStatusMessage("Wallet disconnected");
            }
            updateWalletUI();
        });
        
        // Restore previous session if possible
        const savedAddress = localStorage.getItem("ton_wallet_address");
        if (savedAddress && tonConnectUI.connected && tonConnectUI.wallet) {
            walletConnected = true;
            walletAddress = tonConnectUI.wallet.account.address;
            updateWalletUI();
        }
        return tonConnectUI;
    } catch (e) {
        console.error("[TON] init error:", e);
        setStatusMessage("Init failed: " + e.message, true);
        return null;
    }
}

// Public function to connect wallet
export async function connectWallet() {
    try {
        const ui = await initTonConnectUI();
        if (!ui) throw new Error("TON SDK not available");
        setStatusMessage("Opening wallet selection...");
        await ui.openModal();
    } catch (e) {
        console.error("[TON] Connection error:", e);
        setStatusMessage("Failed to open wallet: " + e.message, true);
        const tg = window.Telegram?.WebApp;
        if (tg?.showAlert) tg.showAlert("Wallet connection failed. Please try again later.");
    }
}

// Disconnect wallet
export async function disconnectTonWallet() {
    if (tonConnectUI) {
        try {
            await tonConnectUI.disconnect();
        } catch (e) { console.warn("[TON] disconnect error:", e); }
    }
    walletConnected = false;
    walletAddress = null;
    localStorage.removeItem("ton_wallet_address");
    updateWalletUI();
    setStatusMessage("Disconnected");
}

// Show confirmation modal before disconnecting
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

// Build the wallet row inside the user info card
export async function initWalletUI() {
    try {
        const userCard = document.querySelector('.user-info-card');
        if (!userCard) {
            setTimeout(initWalletUI, 500);
            return;
        }
        // Remove existing row
        const oldRow = document.getElementById('walletConnectRow');
        if (oldRow) oldRow.remove();

        const walletRow = document.createElement('div');
        walletRow.id = 'walletConnectRow';
        walletRow.style.cssText = 'width:100%; margin-top:12px; padding:8px 0; border-top:1px solid rgba(255,255,255,0.1); cursor:pointer;';
        userCard.appendChild(walletRow);

        // Initialize in background (doesn't block)
        initTonConnectUI().then(() => {
            updateWalletUI();
        }).catch(e => {
            console.warn("[TON] background init error:", e);
            setStatusMessage("Wallet service unavailable", true);
        });
        
        // Show default UI immediately
        updateWalletUI();
    } catch (err) {
        console.error("initWalletUI error:", err);
    }
}

// Premium payment via TON
export async function sendTonPremiumPayment() {
    // Ensure wallet is connected
    if (!walletConnected) {
        await connectWallet();
        // Wait for connection to complete
        let attempts = 0;
        while (!walletConnected && attempts < 15) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }
        if (!walletConnected) {
            throw new Error("Please connect your TON wallet first");
        }
    }

    const tg = window.Telegram.WebApp;
    const adminAddr = await fetchTonAdminAddress();
    if (!adminAddr) throw new Error("Admin address not configured");

    const amountNano = Math.floor(1.12 * 1e9);
    const userId = tg.initDataUnsafe?.user?.id || Date.now();
    const comment = `premium_${userId}`;

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{
            address: adminAddr,
            amount: amountNano.toString(),
            payload: comment
        }]
    };

    setStatusMessage("Sending transaction...");
    try {
        const ui = await initTonConnectUI();
        if (!ui) throw new Error("TON SDK not available");
        const result = await ui.sendTransaction(transaction);
        const boc = result.boc;
        if (!boc) throw new Error("No transaction data");

        setStatusMessage("Verifying payment...");
        const verifyRes = await fetch(`${API_URL}/api/verify-ton-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData },
            body: JSON.stringify({ boc })
        });
        const data = await verifyRes.json();
        if (data.success) {
            await verifyPremiumStatus();
            setStatusMessage("✅ Premium activated!");
            return true;
        } else {
            throw new Error(data.reason || "Verification failed");
        }
    } catch (err) {
        console.error("TON payment error:", err);
        setStatusMessage(err.message, true);
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
        console.error("Failed to fetch TON admin address", e);
        return null;
    }
}

// Expose globally for inline handlers
window.initWalletUI = initWalletUI;
window.sendTonPremiumPayment = sendTonPremiumPayment;
window.disconnectTonWallet = disconnectTonWallet;
