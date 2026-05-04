// tonPayment.js – TON Connect with webhook support
import { verifyPremiumStatus } from './premiumManager.js';

let tonConnectUI = null;
let walletConnected = false;
let walletAddress = null;

const API_URL = "https://imagifhub.onrender.com";
const MANIFEST_URL = `${API_URL}/ton-manifest.json`;  // ✅ use backend manifest

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
    
    // ✅ Wait for the SDK to load (max 5 seconds)
    const startTime = Date.now();
    
    // 1. Corrected check: Use window.TON_CONNECT_UI
    while (!window.TON_CONNECT_UI && (Date.now() - startTime) < 5000) {
        await new Promise(r => setTimeout(r, 50));
    }
    
    // 2. Corrected check: Use window.TON_CONNECT_UI
    if (!window.TON_CONNECT_UI) {
        console.error("TonConnectUI SDK failed to load");
        return null;
    }
    
    // 3. Corrected instantiation: Use window.TON_CONNECT_UI.TonConnectUI
    tonConnectUI = new window.TON_CONNECT_UI.TonConnectUI({
        manifestUrl: MANIFEST_URL,
        actionsConfiguration: {
            twaReturnUrl: 'https://t.me/IMAGIFHUB_bot/imagifhub'
        }
    });
    
    // Restore connection if exists
    const storedWallet = localStorage.getItem("ton_wallet_address");
    if (storedWallet && tonConnectUI.wallet) {
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

let paymentPollingInterval = null;

export async function sendTonPremiumPayment() {
    const tg = window.Telegram.WebApp;
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

        // Show payment pending status
        const statusEl = document.getElementById('paymentStatus');
        if (statusEl) {
            statusEl.textContent = "⏳ Payment submitted. Waiting for confirmation...";
            statusEl.style.color = "#ffd700";
        }
        
        // Submit for verification (webhook will handle confirmation)
        const verifyRes = await fetch(`${API_URL}/api/verify-ton-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData },
            body: JSON.stringify({ boc })
        });
        
        const data = await verifyRes.json();
        
        if (data.pending) {
            if (statusEl) {
                statusEl.textContent = "✅ Payment submitted! Premium will activate automatically once confirmed.";
                statusEl.style.color = "#4CAF50";
            }
            
            // Fallback polling in case webhook is delayed (10 seconds max)
            let attempts = 0;
            const maxAttempts = 20; // 20 * 500ms = 10 seconds
            const pollInterval = setInterval(async () => {
                attempts++;
                const isPremium = await verifyPremiumStatus();
                if (isPremium) {
                    clearInterval(pollInterval);
                    if (statusEl) {
                        statusEl.textContent = "✅ Premium activated!";
                        setTimeout(() => {
                            if (window.closePremium) window.closePremium();
                        }, 1500);
                    }
                } else if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    if (statusEl) {
                        statusEl.textContent = "⚠️ Payment confirmed but activation may be delayed. Please refresh in a few seconds.";
                    }
                }
            }, 500);
            
            return true;
        } else if (data.success) {
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
