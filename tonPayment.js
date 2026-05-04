// tonPayment.js – TON Connect with webhook support
import { verifyPremiumStatus } from './premiumManager.js';

let tonConnectUI = null;
let walletConnected = false;
let walletAddress = null;

const API_URL = "https://imagifhub.onrender.com";
const MANIFEST_URL = `${API_URL}/ton-manifest.json`;
const SDK_CHECK_INTERVAL = 100;  // ms
const SDK_TIMEOUT = 8000;        // ms

// Helper to show Telegram alert with exact error
function showErrorAlert(message) {
    const tg = window.Telegram?.WebApp;
    if (tg && tg.showAlert) {
        tg.showAlert(`⚠️ TON Connect Error:\n${message}`);
    } else {
        alert(`TON Connect Error: ${message}`);
    }
    console.error("[TON]", message);
}

// Wait for TonConnectUI SDK to be available
function waitForTonConnectSDK() {
    return new Promise((resolve, reject) => {
        if (window.TonConnectUI) {
            resolve(window.TonConnectUI);
            return;
        }
        let elapsed = 0;
        const interval = setInterval(() => {
            if (window.TonConnectUI) {
                clearInterval(interval);
                resolve(window.TonConnectUI);
            } else {
                elapsed += SDK_CHECK_INTERVAL;
                if (elapsed >= SDK_TIMEOUT) {
                    clearInterval(interval);
                    reject(new Error("TON Connect SDK did not load after 8 seconds. Check your internet or script availability."));
                }
            }
        }, SDK_CHECK_INTERVAL);
    });
}

export async function initTonConnectUI() {
    if (tonConnectUI) return tonConnectUI;

    try {
        const TonConnectUIClass = await waitForTonConnectSDK();
        tonConnectUI = new TonConnectUIClass({
            manifestUrl: MANIFEST_URL,
            actionsConfiguration: {
                twaReturnUrl: 'https://t.me/IMAGIFHUB_bot/imagifhub'
            }
        });

        // Restore previous connection
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
                localStorage.setItem("ton_wallet_address", wallet.account.address);
                updateWalletUI();
            } else {
                walletConnected = false;
                walletAddress = null;
                localStorage.removeItem("ton_wallet_address");
                updateWalletUI();
            }
        });

        return tonConnectUI;
    } catch (err) {
        showErrorAlert(err.message);
        return null;
    }
}

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

export async function connectWallet() {
    try {
        const ui = await initTonConnectUI();
        if (!ui) {
            throw new Error("TON Connect UI not initialized. SDK may be unavailable.");
        }
        await ui.openModal();
    } catch (err) {
        // Provide exact error
        let detail = err.message;
        if (err.message.includes("Manifest")) {
            detail = "Manifest could not be loaded. Please contact support.";
        } else if (err.message.includes("wallet")) {
            detail = "No wallet detected. Install TonKeeper, TonHub, or a compatible wallet.";
        }
        showErrorAlert(detail);
    }
}

export async function disconnectTonWallet() {
    if (tonConnectUI) {
        try { await tonConnectUI.disconnect(); } catch(e) { console.warn("Disconnect error:", e); }
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
        let walletRow = document.getElementById('walletConnectRow');
        if (!walletRow) {
            walletRow = document.createElement('div');
            walletRow.id = 'walletConnectRow';
            walletRow.style.cssText = 'width:100%; margin-top:12px; padding:8px 0; border-top:1px solid rgba(255,255,255,0.1); cursor:pointer;';
            userCard.appendChild(walletRow);
        }
        await initTonConnectUI();
        updateWalletUI();
    } catch (err) {
        console.error("initWalletUI error:", err);
        // Don't show alert here – UI will still work but wallet row may show "Connect"
    }
}

let paymentPollingInterval = null;

export async function sendTonPremiumPayment() {
    const tg = window.Telegram.WebApp;
    const adminAddr = await fetchTonAdminAddress();
    if (!adminAddr) throw new Error("Admin TON address not configured on server.");

    if (!walletConnected) {
        await connectWallet();
        let attempts = 0;
        while (!walletConnected && attempts < 15) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }
        if (!walletConnected) throw new Error("Wallet not connected after retries. Please connect first.");
    }

    const amountNano = Math.floor(1.12 * 1e9);
    const userId = tg.initDataUnsafe?.user?.id;
    if (!userId) throw new Error("User ID not found. Please restart the app.");
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
        if (!ui) throw new Error("TON Connect UI not available.");

        const result = await ui.sendTransaction(transaction);
        const boc = result.boc;
        if (!boc) throw new Error("No transaction BOC returned from wallet.");

        const statusEl = document.getElementById('paymentStatus');
        if (statusEl) {
            statusEl.textContent = "⏳ Payment submitted. Waiting for confirmation...";
            statusEl.style.color = "#ffd700";
        }

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
            // Poll for premium status confirmation
            let attempts = 0;
            const maxAttempts = 20;
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
            throw new Error(data.reason || "Verification failed.");
        }
    } catch (err) {
        const errorMsg = err.message || "Unknown TON payment error.";
        showErrorAlert(errorMsg);
        throw err;
    }
}

async function fetchTonAdminAddress() {
    try {
        const res = await fetch(`${API_URL}/api/ton-config`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.adminAddress) throw new Error("Admin address missing in response.");
        return data.adminAddress;
    } catch (e) {
        console.error("Failed to fetch admin address", e);
        throw new Error("Could not retrieve payment address. Try again later.");
    }
}

// Expose for debugging and manual use (optional)
window.initWalletUI = initWalletUI;
window.sendTonPremiumPayment = sendTonPremiumPayment;
window.disconnectTonWallet = disconnectTonWallet;
