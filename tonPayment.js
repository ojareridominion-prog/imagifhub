// tonPayment.js - TON Connect with working welcome overlay
import { verifyPremiumStatus } from './premiumManager.js';

let tonConnect = null;
let walletConnected = false;
let walletAddress = null;
let debugEnabled = true;

const TON_PAYMENT_AMOUNT = 1.12;
const API_URL = "https://imagifhub.onrender.com";

function logDebug(...args) {
    if (debugEnabled) console.log("[TON DEBUG]", ...args);
}
function logError(...args) {
    console.error("[TON ERROR]", ...args);
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

function loadTonConnectSDK() {
    return new Promise((resolve, reject) => {
        if (window.TonConnect) return resolve(window.TonConnect);
        let attempts = 0;
        const interval = setInterval(() => {
            if (window.TonConnect) {
                clearInterval(interval);
                resolve(window.TonConnect);
            } else if (++attempts > 100) { // 20 seconds timeout
                clearInterval(interval);
                reject(new Error("SDK load timeout"));
            }
        }, 200);
    });
}

export async function initTonConnect() {
    if (tonConnect) return tonConnect;
    try {
        await loadTonConnectSDK();
        const manifestUrl = `${window.location.origin}/ton-manifest.json`;
        tonConnect = new window.TonConnect({ manifestUrl });
        tonConnect.onStatusChange((wallet) => {
            if (wallet) {
                walletConnected = true;
                walletAddress = wallet.account.address;
                localStorage.setItem("ton_wallet_address", walletAddress);
            } else {
                walletConnected = false;
                walletAddress = null;
                localStorage.removeItem("ton_wallet_address");
            }
            updateWalletUI();
        });
        return tonConnect;
    } catch (e) {
        logError("initTonConnect failed", e);
        throw e;
    }
}

export async function fetchTonAdminAddress() {
    try {
        const res = await fetch(`${API_URL}/api/ton-config`);
        const data = await res.json();
        return data.adminAddress;
    } catch (e) {
        logError("Failed to fetch TON admin address", e);
        return null;
    }
}

export async function connectTonWallet() {
    const tg = window.Telegram?.WebApp;
    setStatusMessage("Initializing TON...");
    try {
        const connector = await initTonConnect();
        if (connector.connected) {
            const wallet = connector.getWallet?.();
            if (wallet) {
                walletConnected = true;
                walletAddress = wallet.account.address;
                localStorage.setItem("ton_wallet_address", walletAddress);
                updateWalletUI();
                setStatusMessage("Wallet already connected");
                return walletAddress;
            }
        }
        setStatusMessage("Fetching wallets...");
        let wallets = [];
        try {
            wallets = await connector.getWallets();
        } catch (e) {
            throw new Error("Cannot fetch wallet list: " + e.message);
        }
        if (!wallets || wallets.length === 0) {
            throw new Error("No TON wallets found. Install Tonkeeper.");
        }
        let selected = wallets.find(w => w.name === "Tonkeeper") || wallets[0];
        setStatusMessage(`Connecting to ${selected.name}...`);
        const result = await connector.connect(selected);
        walletConnected = true;
        walletAddress = result.account.address;
        localStorage.setItem("ton_wallet_address", walletAddress);
        updateWalletUI();
        setStatusMessage("Connected!");
        return walletAddress;
    } catch (e) {
        logError("Wallet connection error:", e);
        let errorMsg = "Failed to connect wallet. ";
        if (e.message?.includes("timeout")) errorMsg += "SDK loading timeout. Please refresh.";
        else if (e.message?.includes("No wallets")) errorMsg += "No TON wallets found. Install Tonkeeper.";
        else errorMsg += e.message || "Please try again later.";
        setStatusMessage(errorMsg, true);
        if (tg?.showAlert) tg.showAlert(errorMsg);
        return null;
    }
}

export async function disconnectTonWallet() {
    try {
        const connector = await initTonConnect();
        if (connector.connected) await connector.disconnect();
    } catch (e) { logError("Disconnect error:", e); }
    walletConnected = false;
    walletAddress = null;
    localStorage.removeItem("ton_wallet_address");
    updateWalletUI();
}

export async function sendTonPremiumPayment() {
    setStatusMessage("Preparing TON payment...");
    try {
        const connector = await initTonConnect();
        if (!connector.connected) {
            const connected = await connectTonWallet();
            if (!connected || !connector.connected) throw new Error("Wallet not connected");
        }
        const adminAddr = await fetchTonAdminAddress();
        if (!adminAddr) throw new Error("Admin address not configured");
        const userId = window.Telegram.WebApp.initDataUnsafe?.user?.id || Date.now();
        const comment = `premium_${userId}`;
        const amountNano = Math.floor(TON_PAYMENT_AMOUNT * 1e9);
        const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 600,
            messages: [{ address: adminAddr, amount: amountNano.toString(), payload: comment }]
        };
        setStatusMessage("Sending transaction...");
        const result = await connector.sendTransaction(transaction);
        let txHash = result.hash || result.boc;
        if (!txHash) throw new Error("No transaction hash returned");
        setStatusMessage("Verifying payment...");
        const tg = window.Telegram.WebApp;
        const verifyRes = await fetch(`${API_URL}/api/verify-ton-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData },
            body: JSON.stringify({ txHash })
        });
        const verification = await verifyRes.json();
        if (verification.success) {
            await verifyPremiumStatus();
            setStatusMessage("Premium activated!");
            return true;
        } else {
            throw new Error(verification.reason || "Payment verification failed");
        }
    } catch (e) {
        logError("sendTonPremiumPayment error:", e);
        setStatusMessage(e.message, true);
        const tg = window.Telegram?.WebApp;
        if (tg?.showAlert) tg.showAlert("TON payment failed: " + e.message);
        throw e;
    }
}

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
        walletRow.onclick = () => showDisconnectConfirm();
    } else {
        walletRow.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                <span>💎 Connect TON Wallet</span>
                <span style="font-size:20px;">➔</span>
            </div>
        `;
        walletRow.onclick = () => connectTonWallet();
    }
}

function showDisconnectConfirm() {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:20000; display:flex; align-items:center; justify-content:center;`;
    const box = document.createElement('div');
    box.style.cssText = `background:#1a1a1a; padding:20px 30px; border-radius:20px; text-align:center; color:white; font-family:inherit; max-width:280px; backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.2);`;
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
    confirmBtn.onclick = async () => { await disconnectTonWallet(); overlay.remove(); };
    cancelBtn.onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

// ⭐ NON‑BLOCKING: uses setTimeout retry, returns immediately
export async function initWalletUI() {
    logDebug("initWalletUI called");
    try {
        const userCard = document.querySelector('.user-info-card');
        if (!userCard) {
            setTimeout(initWalletUI, 1000);
            return;
        }
        const oldRow = document.getElementById('walletConnectRow');
        if (oldRow) oldRow.remove();
        const walletRow = document.createElement('div');
        walletRow.id = 'walletConnectRow';
        userCard.appendChild(walletRow);
        const saved = localStorage.getItem("ton_wallet_address");
        if (saved) {
            walletAddress = saved;
            walletConnected = true;
            updateWalletUI();
            // silently verify connection
            try {
                const connector = await initTonConnect();
                if (connector && !connector.connected) {
                    walletConnected = false;
                    walletAddress = null;
                    localStorage.removeItem("ton_wallet_address");
                    updateWalletUI();
                } else if (connector && connector.connected) {
                    const wallet = connector.getWallet?.();
                    if (wallet) walletAddress = wallet.account.address;
                }
            } catch (e) { logError("Reconnection check failed", e); }
        } else {
            updateWalletUI();
        }
    } catch (err) {
        logError("initWalletUI error", err);
    }
    }
