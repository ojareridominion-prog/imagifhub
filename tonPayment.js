// tonPayment.js - TON Connect 2.0 integration with error resilience
import { state } from './state.js';
import { verifyPremiumStatus } from './premiumManager.js';

let tonConnectInstance = null;
let walletConnected = false;
let walletAddress = null;

const TON_PAYMENT_AMOUNT = 1.12;
const API_URL = "https://imagifhub.onrender.com";

// Load TON Connect SDK dynamically
export async function initTonConnect() {
    if (tonConnectInstance) return tonConnectInstance;
    return new Promise((resolve, reject) => {
        if (window.TonConnect) {
            tonConnectInstance = new window.TonConnect();
            resolve(tonConnectInstance);
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@tonconnect/sdk@2.0.0/dist/tonconnect.js';
        script.onload = () => {
            if (window.TonConnect) {
                tonConnectInstance = new window.TonConnect();
                resolve(tonConnectInstance);
            } else {
                reject(new Error("TonConnect SDK loaded but constructor missing"));
            }
        };
        script.onerror = () => reject(new Error("Failed to load TonConnect SDK"));
        document.head.appendChild(script);
    });
}

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

export async function connectTonWallet() {
    try {
        const connector = await initTonConnect();
        if (connector.connected) {
            walletConnected = true;
            walletAddress = connector.wallet.account.address;
            localStorage.setItem("ton_wallet_address", walletAddress);
            updateWalletUI();
            return walletAddress;
        }
        const walletsList = await connector.getWallets();
        const wallet = walletsList.find(w => w.name === "Tonkeeper") || walletsList[0];
        const result = await connector.connect(wallet);
        walletConnected = true;
        walletAddress = result.account.address;
        localStorage.setItem("ton_wallet_address", walletAddress);
        updateWalletUI();
        return walletAddress;
    } catch (e) {
        console.error("Wallet connection error:", e);
        if (window.Telegram?.WebApp?.showAlert) {
            window.Telegram.WebApp.showAlert("Failed to connect wallet. Please try again.");
        }
        return null;
    }
}

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

export async function sendTonPremiumPayment() {
    const connector = await initTonConnect();
    if (!connector.connected) {
        await connectTonWallet();
        if (!connector.connected) {
            throw new Error("Wallet not connected");
        }
    }

    const adminAddr = await fetchTonAdminAddress();
    if (!adminAddr) throw new Error("Admin address not configured");

    const amountNano = Math.floor(TON_PAYMENT_AMOUNT * 1e9);
    const userId = window.Telegram.WebApp.initDataUnsafe?.user?.id || Date.now();
    const comment = `premium_${userId}`;

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

export async function initWalletUI() {
    try {
        const userCard = document.querySelector('.user-info-card');
        if (!userCard) return;

        const oldRow = document.getElementById('walletConnectRow');
        if (oldRow) oldRow.remove();

        const walletRow = document.createElement('div');
        walletRow.id = 'walletConnectRow';
        walletRow.style.cssText = `
            margin-top: 12px;
            padding: 8px 0;
            border-top: 1px solid rgba(255,255,255,0.1);
            cursor: pointer;
            transition: background 0.2s;
            font-size: 14px;
        `;
        walletRow.onmouseenter = () => walletRow.style.background = 'rgba(255,255,255,0.05)';
        walletRow.onmouseleave = () => walletRow.style.background = '';
        userCard.appendChild(walletRow);

        const saved = localStorage.getItem("ton_wallet_address");
        if (saved) {
            walletAddress = saved;
            walletConnected = true;
            updateWalletUI();
        } else {
            updateWalletUI();
        }

        // Try to sync with SDK but don't crash if fails
        try {
            const connector = await initTonConnect();
            if (connector && connector.connected) {
                walletConnected = true;
                walletAddress = connector.wallet.account.address;
                localStorage.setItem("ton_wallet_address", walletAddress);
                updateWalletUI();
            }
        } catch (e) {
            console.warn("TON SDK sync failed, but UI continues", e);
        }
    } catch (err) {
        console.error("initWalletUI fatal error, skipping wallet", err);
        // Do nothing – just let the rest of the app run
    }
            }
