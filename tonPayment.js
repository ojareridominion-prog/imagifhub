// tonPayment.js - working with TonConnect UI
import { verifyPremiumStatus } from './premiumManager.js';

let tonConnectUI = null;
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

// Initialise TonConnect UI once
export async function initTonConnect() {
    if (tonConnectUI) return tonConnectUI;
    try {
        // Wait for the global TonConnectUI constructor
        if (!window.TonConnectUI) {
            throw new Error("TonConnectUI not loaded – check script tag");
        }
        tonConnectUI = new window.TonConnectUI({
            manifestUrl: `${API_URL}/ton-manifest.json`   // your existing manifest endpoint
        });

        // Listen for connection changes
        tonConnectUI.onStatusChange((wallet) => {
            if (wallet) {
                walletConnected = true;
                walletAddress = wallet.account.address;
                localStorage.setItem("ton_wallet_address", walletAddress);
                logDebug("Connected:", walletAddress);
            } else {
                walletConnected = false;
                walletAddress = null;
                localStorage.removeItem("ton_wallet_address");
                logDebug("Disconnected");
            }
            updateWalletUI();
        });

        return tonConnectUI;
    } catch (e) {
        logError("initTonConnect error", e);
        return null;
    }
}

// Build the wallet row inside the user info card
export async function initWalletUI() {
    logDebug("initWalletUI called");
    try {
        const userCard = document.querySelector('.user-info-card');
        if (!userCard) {
            setTimeout(initWalletUI, 500);
            return;
        }

        // Remove any previous wallet row
        const oldRow = document.getElementById('walletConnectRow');
        if (oldRow) oldRow.remove();

        const walletRow = document.createElement('div');
        walletRow.id = 'walletConnectRow';
        walletRow.style.cssText =
            'width:100%; margin-top:12px; padding:8px 0; border-top:1px solid rgba(255,255,255,0.1); cursor:pointer;';
        userCard.appendChild(walletRow);

        // Try to restore saved wallet
        const saved = localStorage.getItem("ton_wallet_address");
        if (saved) {
            const connector = await initTonConnect();
            if (connector && connector.connected) {
                const wallet = connector.wallet;
                if (wallet) {
                    walletAddress = wallet.account.address;
                    walletConnected = true;
                } else {
                    walletConnected = false;
                    localStorage.removeItem("ton_wallet_address");
                }
            } else {
                walletConnected = false;
                localStorage.removeItem("ton_wallet_address");
            }
        } else {
            walletConnected = false;
        }
        updateWalletUI();

        // Attach click action (opens modal)
        walletRow.onclick = () => openWalletModal();
    } catch (err) {
        logError("initWalletUI error", err);
    }
}

async function openWalletModal() {
    const connector = await initTonConnect();
    if (!connector) {
        setStatusMessage("Wallet SDK not ready", true);
        return;
    }
    try {
        // This opens the built‑in wallet selection modal
        await connector.openModal();
    } catch (e) {
        logError("Modal open error", e);
        setStatusMessage("Failed to open wallet selection", true);
    }
}

export async function disconnectTonWallet() {
    const connector = await initTonConnect();
    if (connector && connector.disconnect) {
        await connector.disconnect();
    }
    walletConnected = false;
    walletAddress = null;
    localStorage.removeItem("ton_wallet_address");
    updateWalletUI();
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
        walletRow.onclick = () => openWalletModal();
    }
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

// Premium payment via TON (calls the backend verification)
export async function sendTonPremiumPayment() {
    setStatusMessage("Preparing TON payment...");
    try {
        const connector = await initTonConnect();
        if (!connector || !connector.connected) {
            await openWalletModal();
            // Wait a bit for connection
            await new Promise(r => setTimeout(r, 2000));
            if (!connector || !connector.connected) {
                throw new Error("Please connect your wallet first");
            }
        }

        const adminAddr = await fetchTonAdminAddress();
        if (!adminAddr) throw new Error("Admin address not configured");

        const userId = window.Telegram.WebApp.initDataUnsafe?.user?.id || Date.now();
        const comment = `premium_${userId}`;
        const amountNano = Math.floor(TON_PAYMENT_AMOUNT * 1e9); // 1.12 TON in nano

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

        setStatusMessage("Sending transaction...");
        const result = await connector.sendTransaction(transaction);
        let txHash = result?.boc || result?.hash;
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
            throw new Error(verification.reason || "Verification failed");
        }
    } catch (e) {
        logError("sendTonPremiumPayment error:", e);
        setStatusMessage(e.message, true);
        const tg = window.Telegram?.WebApp;
        if (tg?.showAlert) tg.showAlert("TON payment failed: " + e.message);
        throw e;
    }
}

async function fetchTonAdminAddress() {
    try {
        const res = await fetch(`${API_URL}/api/ton-config`);
        const data = await res.json();
        return data.adminAddress;
    } catch (e) {
        logError("Failed to fetch TON admin address", e);
        return null;
    }
}

// Add these lines at the very bottom of tonPayment.js
window.initWalletUI = initWalletUI;
window.sendTonPremiumPayment = sendTonPremiumPayment;
window.disconnectTonWallet = disconnectTonWallet;
