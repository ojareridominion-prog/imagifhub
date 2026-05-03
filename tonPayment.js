// tonPayment.js – Updated Modern SDK Integration
import { verifyPremiumStatus } from './premiumManager.js';

let tonConnectUI = null;
let walletConnected = false;
let walletAddress = null;

const API_URL = "https://imagifhub.onrender.com";
const MANIFEST_URL = "https://ojareridominion-prog.github.io/imagifhub/tonconnect-manifest.json";

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

// Initialize TonConnectUI with modern API
export async function initTonConnectUI() {
    if (tonConnectUI) return tonConnectUI;
    if (window.TonConnectUI) {
        tonConnectUI = new window.TonConnectUI({
            manifestUrl: MANIFEST_URL,
            actionsConfiguration: {
                twaReturnUrl: 'https://t.me/IMAGIFHUB_bot/imagifhub'
            }
        });
        // Restore connection if exists
        const storedWallet = localStorage.getItem("ton_wallet_address");
        if (storedWallet && tonConnectUI && tonConnectUI.wallet) {
            walletConnected = true;
            walletAddress = tonConnectUI.wallet.account.address;
            updateWalletUI();
        }
        tonConnectUI.onStatusChange((wallet) => {
            if (wallet) {
                walletConnected = true;
                walletAddress = wallet.account.address;
                localStorage.setItem("ton_wallet_address", wallet.address);
                updateWalletUI();
            } else {
                walletConnected = false;
                walletAddress = null;
                localStorage.removeItem("ton_wallet_address");
                updateWalletUI();
            }
        });
        return tonConnectUI;
    } else {
        console.error("TonConnectUI library not loaded");
        return null;
    }
}

export async function connectWallet() {
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
    localStorage.removeItem("ton_wallet_address");
    updateWalletUI();
}

function showDisconnectConfirm() {
    // ... (your existing disconnect confirm code)
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

export async function sendTonPremiumPayment() {
    if (!walletConnected) {
        await connectWallet();
        let attempts = 0;
        while (!walletConnected && attempts < 15) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }
        if (!walletConnected) throw new Error("Wallet not connected");
    }

    const tg = window.Telegram.WebApp;
    const adminAddr = await fetchTonAdminAddress();
    if (!adminAddr) throw new Error("Admin address missing");

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

    try {
        const ui = await initTonConnectUI();
        if (!ui) throw new Error("TON SDK unavailable");
        const result = await ui.sendTransaction(transaction);
        const boc = result.boc;
        if (!boc) throw new Error("No transaction data");

        const verifyRes = await fetch(`${API_URL}/api/verify-ton-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData },
            body: JSON.stringify({ boc })
        });
        const data = await verifyRes.json();
        if (data.success) {
            await verifyPremiumStatus();
            return true;
        } else {
            throw new Error(data.reason || "Verification failed");
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
