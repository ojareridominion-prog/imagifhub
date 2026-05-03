// tonPayment.js - TON Connect with dynamic script loading and fallback
import { verifyPremiumStatus } from './premiumManager.js';

let tonConnect = null;
let walletConnected = false;
let walletAddress = null;
let sdkLoadPromise = null;

const TON_PAYMENT_AMOUNT = 1.12;
const API_URL = "https://imagifhub.onrender.com";

/**
 * Dynamically load TonConnect SDK with fallback CDN
 */
function loadTonConnectSDK() {
    if (window.TonConnect) return Promise.resolve(window.TonConnect);
    if (sdkLoadPromise) return sdkLoadPromise;

    sdkLoadPromise = new Promise((resolve, reject) => {
        const primarySrc = 'https://unpkg.com/@tonconnect/sdk@2.2.2/dist/tonconnect.js';
        const fallbackSrc = 'https://cdn.jsdelivr.net/npm/@tonconnect/sdk@2.2.2/dist/tonconnect.js';
        
        let attempt = 0;
        const tryLoad = (src) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => {
                if (window.TonConnect) {
                    console.log("[TON] SDK loaded from", src);
                    resolve(window.TonConnect);
                } else {
                    reject(new Error("TonConnect not available after script load"));
                }
            };
            script.onerror = () => {
                console.warn(`[TON] Failed to load from ${src}`);
                if (attempt === 0) {
                    attempt++;
                    tryLoad(fallbackSrc);
                } else {
                    reject(new Error("Failed to load TonConnect SDK from both sources"));
                }
            };
            document.head.appendChild(script);
        };
        tryLoad(primarySrc);
    });
    return sdkLoadPromise;
}

/**
 * Initialize TonConnect instance with manifest
 */
export async function initTonConnect() {
    if (tonConnect) return tonConnect;
    await loadTonConnectSDK();
    tonConnect = new window.TonConnect({
        manifestUrl: `${API_URL}/ton-manifest.json`
    });
    // Listen to connection status changes
    tonConnect.onStatusChange((wallet) => {
        if (wallet) {
            walletConnected = true;
            walletAddress = wallet.account.address;
            localStorage.setItem("ton_wallet_address", walletAddress);
            updateWalletUI();
        } else {
            walletConnected = false;
            walletAddress = null;
            localStorage.removeItem("ton_wallet_address");
            updateWalletUI();
        }
    });
    return tonConnect;
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
        console.error("Failed to fetch TON admin address", e);
        return null;
    }
}

/**
 * Connect TON wallet
 */
export async function connectTonWallet() {
    const tg = window.Telegram?.WebApp;
    try {
        const connector = await initTonConnect();
        if (connector.connected) {
            walletConnected = true;
            walletAddress = connector.account?.address;
            localStorage.setItem("ton_wallet_address", walletAddress);
            updateWalletUI();
            return walletAddress;
        }

        // Get available wallets
        const wallets = await connector.getWallets();
        if (!wallets || wallets.length === 0) {
            throw new Error("No TON wallets found. Please install Tonkeeper.");
        }
        let selected = wallets.find(w => w.name === "Tonkeeper") || wallets[0];
        const result = await connector.connect(selected);
        walletConnected = true;
        walletAddress = result.account.address;
        localStorage.setItem("ton_wallet_address", walletAddress);
        updateWalletUI();
        return walletAddress;
    } catch (e) {
        console.error("Wallet connection error:", e);
        let errorMsg = "Failed to connect wallet. ";
        if (e.message?.includes("timeout")) errorMsg += "SDK loading timeout. Please refresh.";
        else if (e.message?.includes("No wallets")) errorMsg += "No TON wallets found. Install Tonkeeper.";
        else errorMsg += "Please try again later.";
        if (tg?.showAlert) tg.showAlert(errorMsg);
        else alert(errorMsg);
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
        console.error("Disconnect error:", e);
    }
    walletConnected = false;
    walletAddress = null;
    localStorage.removeItem("ton_wallet_address");
    updateWalletUI();
}

/**
 * Send TON premium payment and verify
 */
export async function sendTonPremiumPayment() {
    const connector = await initTonConnect();
    if (!connector.connected) {
        const connected = await connectTonWallet();
        if (!connected || !connector.connected) {
            throw new Error("Wallet not connected");
        }
    }

    const adminAddr = await fetchTonAdminAddress();
    if (!adminAddr) throw new Error("Admin address not configured");

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

    const result = await connector.sendTransaction(transaction);
    let txHash = result.hash || result.boc;
    if (!txHash) throw new Error("No transaction hash returned");

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
    if (verification.success) {
        await verifyPremiumStatus();
        return true;
    } else {
        throw new Error(verification.reason || "Payment verification failed");
    }
}

/**
 * Update UI for wallet row
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
    try {
        const userCard = document.querySelector('.user-info-card');
        if (!userCard) return;

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
            // Verify connection silently
            try {
                const connector = await initTonConnect();
                if (connector && !connector.connected) {
                    walletConnected = false;
                    walletAddress = null;
                    localStorage.removeItem("ton_wallet_address");
                    updateWalletUI();
                }
            } catch (e) {
                console.warn("Reconnection check failed", e);
            }
        } else {
            updateWalletUI();
        }
    } catch (err) {
        console.error("initWalletUI error", err);
    }
}
