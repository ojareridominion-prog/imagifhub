// tonPayment.js - TON Connect integration (fixed manifest URL + readiness)
import { verifyPremiumStatus } from './premiumManager.js';

let tonConnectUI = null;
let walletConnected = false;
let walletAddress = null;

// ✅ CRITICAL: manifest must be served from the same origin as the Mini App (GitHub Pages)
const MANIFEST_URL = 'https://ojareridominion-prog.github.io/imagifhub/tonconnect-manifest.json';
const API_URL = "https://imagifhub.onrender.com";

// Helper: update wallet row in menu
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

function setStatusMessage(msg, isError = false) {
    const walletRow = document.getElementById('walletConnectRow');
    if (!walletRow) return;
    const style = isError ? 'color:#ff8888;' : 'color:#88ff88;';
    const originalHtml = walletRow.innerHTML;
    walletRow.innerHTML = `<div style="font-size:12px;${style}">${msg}</div>`;
    setTimeout(() => {
        if (walletRow.innerHTML.includes(msg)) walletRow.innerHTML = originalHtml;
    }, 3000);
}

// Wait for TonConnectUI to be available (supports dynamic loading)
async function waitForTonConnectUI() {
    if (window.TonConnectUI) return window.TonConnectUI;
    return new Promise((resolve) => {
        if (window.TonConnectUI) resolve(window.TonConnectUI);
        window.addEventListener('tonconnect-ready', () => resolve(window.TonConnectUI), { once: true });
        // Also check every 200ms as fallback
        const interval = setInterval(() => {
            if (window.TonConnectUI) {
                clearInterval(interval);
                resolve(window.TonConnectUI);
            }
        }, 200);
    });
}

// Initialize TonConnectUI once
async function initTonConnectUI() {
    if (tonConnectUI) return tonConnectUI;
    const TonConnectUIClass = await waitForTonConnectUI();
    if (!TonConnectUIClass) throw new Error("TonConnectUI library not loaded after retry");
    tonConnectUI = new TonConnectUIClass({
        manifestUrl: MANIFEST_URL,
        actionsConfiguration: {
            twaReturnUrl: 'https://t.me/IMAGIFHUB_bot/imagifhub'
        }
    });
    // Restore previous session
    const savedAddress = localStorage.getItem("ton_wallet_address");
    if (savedAddress && tonConnectUI.connected) {
        const wallet = tonConnectUI.wallet;
        if (wallet) {
            walletConnected = true;
            walletAddress = wallet.account.address;
            updateWalletUI();
        }
    }
    tonConnectUI.onStatusChange((wallet) => {
        if (wallet) {
            walletConnected = true;
            walletAddress = wallet.account.address;
            localStorage.setItem("ton_wallet_address", walletAddress);
            console.log("Wallet connected:", walletAddress);
        } else {
            walletConnected = false;
            walletAddress = null;
            localStorage.removeItem("ton_wallet_address");
            console.log("Wallet disconnected");
        }
        updateWalletUI();
    });
    return tonConnectUI;
}

// Public function to connect wallet
export async function connectWallet() {
    try {
        const ui = await initTonConnectUI();
        setStatusMessage("Opening wallet selection...");
        await ui.openModal();
    } catch (e) {
        console.error("Connection error:", e);
        setStatusMessage("Failed to open wallet: " + e.message, true);
        const tg = window.Telegram?.WebApp;
        if (tg?.showAlert) tg.showAlert("Wallet connection failed. Please make sure you have a TON wallet installed (Tonkeeper, Tonhub, etc.)");
    }
}

// Disconnect wallet
export async function disconnectTonWallet() {
    if (tonConnectUI) {
        await tonConnectUI.disconnect();
    }
    walletConnected = false;
    walletAddress = null;
    localStorage.removeItem("ton_wallet_address");
    updateWalletUI();
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

        // Try to restore previous connection
        try {
            const ui = await initTonConnectUI();
            if (ui.connected && ui.wallet) {
                walletConnected = true;
                walletAddress = ui.wallet.account.address;
                localStorage.setItem("ton_wallet_address", walletAddress);
            } else {
                walletConnected = false;
                walletAddress = null;
            }
        } catch (e) {
            console.warn("TON init failed:", e);
            walletConnected = false;
            setStatusMessage("Wallet SDK not ready – tap to retry", true);
        }
        updateWalletUI();
    } catch (err) {
        console.error("initWalletUI error:", err);
    }
}

// Premium payment via TON
export async function sendTonPremiumPayment() {
    // First ensure wallet is connected
    if (!walletConnected) {
        await connectWallet();
        // Wait a bit for connection
        await new Promise(r => setTimeout(r, 2000));
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
