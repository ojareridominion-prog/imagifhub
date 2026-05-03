// tonPayment.js - TON Connect using static SDK with alert debugging
import { verifyPremiumStatus } from './premiumManager.js';

let tonConnect = null;
let walletConnected = false;
let walletAddress = null;
let sdkReady = false;

const TON_PAYMENT_AMOUNT = 1.12;
const API_URL = "https://imagifhub.onrender.com";

function showAlert(msg) {
    const tg = window.Telegram?.WebApp;
    if (tg && tg.showAlert) tg.showAlert(msg);
    else alert(msg);
}

function logDebug(msg) {
    console.log("[TON]", msg);
}

/**
 * Wait for TonConnect SDK (loaded statically via script tag)
 */
function waitForTonConnect(timeout = 10000) {
    return new Promise((resolve, reject) => {
        if (window.TonConnect) {
            sdkReady = true;
            logDebug("TonConnect SDK already present");
            resolve(window.TonConnect);
            return;
        }
        logDebug("Waiting for TonConnect SDK...");
        const start = Date.now();
        const interval = setInterval(() => {
            if (window.TonConnect) {
                clearInterval(interval);
                sdkReady = true;
                logDebug("TonConnect SDK detected");
                resolve(window.TonConnect);
            } else if (Date.now() - start > timeout) {
                clearInterval(interval);
                reject(new Error("TonConnect SDK not loaded. Check your internet and refresh."));
            }
        }, 200);
    });
}

/**
 * Initialize TonConnect instance with manifest
 */
export async function initTonConnect() {
    if (tonConnect) return tonConnect;
    try {
        await waitForTonConnect();
        const manifestUrl = `${API_URL}/ton-manifest.json`;
        logDebug(`Manifest URL: ${manifestUrl}`);
        tonConnect = new window.TonConnect({ manifestUrl });
        tonConnect.onStatusChange((wallet) => {
            if (wallet) {
                walletConnected = true;
                walletAddress = wallet.account.address;
                localStorage.setItem("ton_wallet_address", walletAddress);
                logDebug(`Connected: ${walletAddress}`);
                updateWalletUI();
            } else {
                walletConnected = false;
                walletAddress = null;
                localStorage.removeItem("ton_wallet_address");
                logDebug("Disconnected");
                updateWalletUI();
            }
        });
        return tonConnect;
    } catch (e) {
        logDebug("initTonConnect error: " + e.message);
        showAlert("TON init failed: " + e.message);
        throw e;
    }
}

/**
 * Fetch admin address from backend
 */
export async function fetchTonAdminAddress() {
    try {
        const res = await fetch(`${API_URL}/api/ton-config`);
        const data = await res.json();
        return data.adminAddress;
    } catch (e) {
        showAlert("Failed to fetch TON admin address. Server error.");
        return null;
    }
}

/**
 * Connect TON wallet
 */
export async function connectTonWallet() {
    logDebug("connectTonWallet called");
    try {
        const connector = await initTonConnect();
        if (connector.connected) {
            walletConnected = true;
            walletAddress = connector.account?.address;
            localStorage.setItem("ton_wallet_address", walletAddress);
            updateWalletUI();
            showAlert("Wallet already connected!");
            return walletAddress;
        }

        showAlert("Fetching available wallets...");
        let wallets = [];
        try {
            wallets = await connector.getWallets();
            logDebug("Wallets: " + wallets.map(w => w.name).join(", "));
        } catch (e) {
            logDebug("getWallets error: " + e.message);
            showAlert("Cannot get wallet list: " + e.message);
            return null;
        }

        if (!wallets || wallets.length === 0) {
            showAlert("No TON wallets found. Please install Tonkeeper.");
            return null;
        }

        let selected = wallets.find(w => w.name === "Tonkeeper") || wallets[0];
        logDebug(`Selected wallet: ${selected.name}`);
        showAlert(`Connecting to ${selected.name}...`);

        const result = await connector.connect(selected);
        walletConnected = true;
        walletAddress = result.account.address;
        localStorage.setItem("ton_wallet_address", walletAddress);
        updateWalletUI();
        showAlert("Wallet connected successfully!");
        return walletAddress;
    } catch (e) {
        logDebug("Connection error: " + e.message);
        showAlert("Connection failed: " + e.message);
        return null;
    }
}

/**
 * Disconnect wallet
 */
export async function disconnectTonWallet() {
    try {
        const connector = await initTonConnect();
        if (connector.connected) {
            await connector.disconnect();
        }
    } catch (e) {
        console.error(e);
    }
    walletConnected = false;
    walletAddress = null;
    localStorage.removeItem("ton_wallet_address");
    updateWalletUI();
    showAlert("Wallet disconnected");
}

/**
 * Send TON premium payment and verify
 */
export async function sendTonPremiumPayment() {
    logDebug("sendTonPremiumPayment started");
    try {
        const connector = await initTonConnect();
        if (!connector.connected) {
            showAlert("Wallet not connected. Please connect first.");
            const connected = await connectTonWallet();
            if (!connected) throw new Error("Wallet connection cancelled");
        }

        const adminAddr = await fetchTonAdminAddress();
        if (!adminAddr) throw new Error("Admin address missing");
        logDebug("Admin: " + adminAddr);

        const userId = window.Telegram.WebApp.initDataUnsafe?.user?.id || Date.now();
        const comment = `premium_${userId}`;
        const amountNano = Math.floor(TON_PAYMENT_AMOUNT * 1e9);

        const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 600,
            messages: [{
                address: adminAddr,
                amount: amountNano.toString(),
                payload: comment
            }]
        };

        showAlert(`Sending ${TON_PAYMENT_AMOUNT} TON...`);
        const result = await connector.sendTransaction(transaction);
        let txHash = result.hash || result.boc;
        if (!txHash) throw new Error("No transaction hash");

        logDebug("Tx hash: " + txHash);
        showAlert("Payment sent! Verifying...");

        const tg = window.Telegram.WebApp;
        const verifyRes = await fetch(`${API_URL}/api/verify-ton-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData },
            body: JSON.stringify({ txHash })
        });
        const verification = await verifyRes.json();
        if (verification.success) {
            await verifyPremiumStatus();
            showAlert("✅ Premium activated! Thank you.");
            return true;
        } else {
            throw new Error(verification.reason || "Verification failed");
        }
    } catch (e) {
        logDebug("Payment error: " + e.message);
        showAlert("Payment failed: " + e.message);
        throw e;
    }
}

/**
 * UI update for wallet row
 */
function updateWalletUI() {
    const walletRow = document.getElementById('walletConnectRow');
    if (!walletRow) return;
    if (walletConnected && walletAddress) {
        const shortAddr = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
        walletRow.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                <span>🔗 TON Wallet</span>
                <span style="font-family:monospace; background:rgba(255,255,255,0.2); padding:2px 8px; border-radius:12px;">${shortAddr}</span>
            </div>
        `;
        walletRow.onclick = () => showDisconnectConfirm();
    } else {
        walletRow.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                <span>🔗 Connect TON Wallet</span>
                <span style="font-size:20px;">🔗</span>
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

/**
 * Initialize wallet UI (called from script.js)
 */
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

        const saved = localStorage.getItem("ton_wallet_address");
        if (saved) {
            walletAddress = saved;
            walletConnected = true;
            updateWalletUI();
            // Silently verify connection
            try {
                const connector = await initTonConnect();
                if (connector && !connector.connected) {
                    walletConnected = false;
                    walletAddress = null;
                    localStorage.removeItem("ton_wallet_address");
                    updateWalletUI();
                }
            } catch (e) {
                logDebug("Reconnect check failed: " + e.message);
            }
        } else {
            updateWalletUI();
        }
    } catch (err) {
        logDebug("initWalletUI error: " + err.message);
    }
            }
