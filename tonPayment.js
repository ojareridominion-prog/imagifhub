// tonPayment.js - TON Connect with robust connection handling

import { verifyPremiumStatus } from './premiumManager.js';

let tonConnect = null;
let walletConnected = false;
let walletAddress = null;

const TON_PAYMENT_AMOUNT = 1.12;
const API_URL = "https://imagifhub.onrender.com";  // can be changed to dynamic if needed

function logDebug(...args) {
    console.log("[TON]", ...args);
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
        if (walletRow.innerHTML.includes(msg)) {
            walletRow.innerHTML = originalHtml;
        }
    }, 3000);
}

// Wait for TonConnect SDK to be loaded from index.html
function loadTonConnectSDK() {
    return new Promise((resolve, reject) => {
        if (window.TonConnect) {
            resolve(window.TonConnect);
        } else {
            let attempts = 0;
            const interval = setInterval(() => {
                if (window.TonConnect) {
                    clearInterval(interval);
                    resolve(window.TonConnect);
                } else if (++attempts > 40) { // 8 seconds timeout
                    clearInterval(interval);
                    reject(new Error("SDK load timeout"));
                }
            }, 200);
        }
    });
}

// Initialize TonConnect instance and set up status listener
export async function initTonConnect() {
    if (tonConnect) return tonConnect;
    logDebug("Initializing TonConnect...");
    try {
        await loadTonConnectSDK();
        // Use dynamic manifest URL (relative to current origin)
        const manifestUrl = `${window.location.origin}/ton-manifest.json`;
        logDebug(`Manifest URL: ${manifestUrl}`);
        tonConnect = new window.TonConnect({ manifestUrl });
        
        // Listen to connection status changes
        tonConnect.onStatusChange((wallet) => {
            logDebug("Status change", wallet);
            if (wallet) {
                walletConnected = true;
                walletAddress = wallet.account.address;
                localStorage.setItem("ton_wallet_address", walletAddress);
                logDebug(`Connected: ${walletAddress}`);
            } else {
                logDebug("Disconnected");
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

// Manually check current connection (e.g., after page load)
async function refreshConnectionStatus() {
    try {
        const connector = await initTonConnect();
        // The onStatusChange will fire automatically if a session exists
        // But we also request the current wallet manually (if any)
        if (connector && typeof connector.getWallet === 'function') {
            const wallet = connector.getWallet();
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
        } else {
            // Fallback: use saved address but mark as not connected – user must reconnect
            const saved = localStorage.getItem("ton_wallet_address");
            if (saved) {
                walletAddress = saved;
                walletConnected = false; // not actually connected
                updateWalletUI();
            }
        }
    } catch (e) {
        logError("refreshConnectionStatus error", e);
    }
}

// Fetch admin address from backend
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

// Connect wallet – user action
export async function connectTonWallet() {
    const tg = window.Telegram?.WebApp;
    logDebug("connectTonWallet called");
    setStatusMessage("Initializing TON...");
    try {
        const connector = await initTonConnect();
        if (connector.connected) {
            logDebug("Already connected");
            // Force refresh status
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
            logDebug("Wallets found", wallets.map(w => w.name));
        } catch (e) {
            logError("getWallets failed", e);
            throw new Error("Cannot fetch wallet list: " + e.message);
        }

        if (!wallets || wallets.length === 0) {
            throw new Error("No TON wallets found. Please install Tonkeeper.");
        }

        let selected = wallets.find(w => w.name === "Tonkeeper") || wallets[0];
        logDebug(`Selected wallet: ${selected.name}`);
        setStatusMessage(`Connecting to ${selected.name}...`);

        const result = await connector.connect(selected);
        logDebug("Connection result", result);
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
        else alert(errorMsg);
        return null;
    }
}

// Disconnect wallet
export async function disconnectTonWallet() {
    logDebug("disconnectTonWallet called");
    try {
        const connector = await initTonConnect();
        if (connector.connected) {
            await connector.disconnect();
            logDebug("Disconnected successfully");
        }
    } catch (e) {
        logError("Disconnect error:", e);
    }
    walletConnected = false;
    walletAddress = null;
    localStorage.removeItem("ton_wallet_address");
    updateWalletUI();
}

// Send TON payment and verify
export async function sendTonPremiumPayment() {
    logDebug("sendTonPremiumPayment started");
    setStatusMessage("Preparing TON payment...");
    try {
        const connector = await initTonConnect();
        if (!connector.connected) {
            logDebug("Wallet not connected, attempting connection");
            const connected = await connectTonWallet();
            if (!connected || !connector.connected) {
                throw new Error("Wallet not connected");
            }
        }

        const adminAddr = await fetchTonAdminAddress();
        if (!adminAddr) throw new Error("Admin address not configured");
        logDebug(`Admin address: ${adminAddr}`);

        const userId = window.Telegram.WebApp.initDataUnsafe?.user?.id || Date.now();
        const comment = `premium_${userId}`;
        const amountNano = Math.floor(TON_PAYMENT_AMOUNT * 1e9);

        const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 600,
            messages: [
                {
                    address: adminAddr,
                    amount: amountNano.toString(),
                    payload: comment
                }
            ]
        };
        logDebug("Transaction", transaction);

        setStatusMessage("Sending transaction...");
        const result = await connector.sendTransaction(transaction);
        logDebug("sendTransaction result", result);

        let txHash = result.hash || result.boc;
        if (!txHash) throw new Error("No transaction hash returned");
        logDebug(`Tx hash: ${txHash}`);

        setStatusMessage("Verifying payment...");
        const tg = window.Telegram.WebApp;
        const verifyRes = await fetch(`${API_URL}/api/verify-ton-payment`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Init-Data': tg.initData
            },
            body: JSON.stringify({ txHash })
        });
        const verification = await verifyRes.json();
        logDebug("Verification response", verification);

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

// Update UI of wallet row
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
    overlay.style.cssText = `
        position: fixed; top:0; left:0; width:100%; height:100%;
        background:rgba(0,0,0,0.6); z-index:20000;
        display: flex; align-items: center; justify-content: center;
    `;
    const box = document.createElement('div');
    box.style.cssText = `
        background: #1a1a1a; padding: 20px 30px; border-radius: 20px;
        text-align: center; color: white; font-family: inherit;
        max-width: 280px; backdrop-filter: blur(12px);
        border: 1px solid rgba(255,255,255,0.2);
    `;
    box.innerHTML = `
        <div style="margin-bottom: 20px;">Disconnect wallet?</div>
        <div style="display: flex; gap: 12px; justify-content: center;">
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

// Initialize wallet UI: add row and check existing connection
export async function initWalletUI() {
    logDebug("initWalletUI called");
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
        userCard.appendChild(walletRow);
        logDebug("Wallet row added");

        await refreshConnectionStatus();
    } catch (err) {
        logError("initWalletUI error", err);
    }
    }
