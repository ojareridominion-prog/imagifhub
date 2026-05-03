// tonPayment.js - Fully robust TON Connect with fallback CDNs and alerts
import { verifyPremiumStatus } from './premiumManager.js';

let tonConnect = null;
let walletConnected = false;
let walletAddress = null;
let sdkLoadPromise = null;

const TON_PAYMENT_AMOUNT = 1.12;
const API_URL = "https://imagifhub.onrender.com";

function showAlert(msg, isError = true) {
    const tg = window.Telegram?.WebApp;
    if (tg?.showAlert) tg.showAlert(msg);
    else alert(msg);
}

function log(...args) {
    console.log("[TON]", ...args);
}

function loadTonConnectSDK() {
    if (window.TonConnect) return Promise.resolve(window.TonConnect);
    if (sdkLoadPromise) return sdkLoadPromise;

    const sources = [
        "https://unpkg.com/@tonconnect/sdk@2.2.2/dist/tonconnect.js",
        "https://cdn.jsdelivr.net/npm/@tonconnect/sdk@2.2.2/dist/tonconnect.js",
        "https://cdn.skypack.dev/@tonconnect/sdk"
    ];

    sdkLoadPromise = new Promise((resolve, reject) => {
        let attempt = 0;
        let timeout = setTimeout(() => {
            reject(new Error("SDK load timeout after 15s"));
        }, 15000);

        function tryLoad() {
            if (attempt >= sources.length) {
                clearTimeout(timeout);
                reject(new Error("All CDNs failed"));
                return;
            }
            const script = document.createElement('script');
            script.src = sources[attempt];
            script.async = true;
            script.onload = () => {
                if (window.TonConnect) {
                    clearTimeout(timeout);
                    log(`Loaded from ${sources[attempt]}`);
                    resolve(window.TonConnect);
                } else {
                    attempt++;
                    tryLoad();
                }
            };
            script.onerror = () => {
                attempt++;
                tryLoad();
            };
            document.head.appendChild(script);
        }
        tryLoad();
    });
    return sdkLoadPromise;
}

export async function initTonConnect() {
    if (tonConnect) return tonConnect;
    try {
        await loadTonConnectSDK();
        const manifestUrl = `${API_URL}/ton-manifest.json`;
        tonConnect = new window.TonConnect({ manifestUrl });
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
    } catch (e) {
        log("Init error:", e);
        showAlert("Failed to initialize TON: " + e.message);
        throw e;
    }
}

export async function fetchTonAdminAddress() {
    try {
        const res = await fetch(`${API_URL}/api/ton-config`);
        const data = await res.json();
        return data.adminAddress;
    } catch (e) {
        showAlert("Cannot fetch TON admin address");
        return null;
    }
}

export async function connectTonWallet() {
    try {
        const connector = await initTonConnect();
        if (connector.connected) {
            walletConnected = true;
            walletAddress = connector.account.address;
            localStorage.setItem("ton_wallet_address", walletAddress);
            updateWalletUI();
            showAlert("Wallet already connected", false);
            return walletAddress;
        }
        const wallets = await connector.getWallets();
        if (!wallets.length) throw new Error("No wallet found. Install Tonkeeper.");
        const selected = wallets.find(w => w.name === "Tonkeeper") || wallets[0];
        const result = await connector.connect(selected);
        walletConnected = true;
        walletAddress = result.account.address;
        localStorage.setItem("ton_wallet_address", walletAddress);
        updateWalletUI();
        showAlert("Wallet connected!", false);
        return walletAddress;
    } catch (e) {
        log("Connect error:", e);
        showAlert("Connection failed: " + e.message);
        return null;
    }
}

export async function disconnectTonWallet() {
    try {
        const connector = await initTonConnect();
        if (connector.connected) await connector.disconnect();
    } catch (e) {}
    walletConnected = false;
    walletAddress = null;
    localStorage.removeItem("ton_wallet_address");
    updateWalletUI();
}

export async function sendTonPremiumPayment() {
    try {
        const connector = await initTonConnect();
        if (!connector.connected) {
            const ok = await connectTonWallet();
            if (!ok) throw new Error("Wallet not connected");
        }
        const adminAddr = await fetchTonAdminAddress();
        if (!adminAddr) throw new Error("No admin address");
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
        const result = await connector.sendTransaction(transaction);
        const txHash = result.hash || result.boc;
        if (!txHash) throw new Error("No tx hash");
        const tg = window.Telegram.WebApp;
        const verifyRes = await fetch(`${API_URL}/api/verify-ton-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData },
            body: JSON.stringify({ txHash })
        });
        const verification = await verifyRes.json();
        if (verification.success) {
            await verifyPremiumStatus();
            showAlert("✅ Premium activated!", false);
            return true;
        } else {
            throw new Error(verification.reason || "Verification failed");
        }
    } catch (e) {
        log("Payment error:", e);
        showAlert("Payment failed: " + e.message);
        throw e;
    }
}

function updateWalletUI() {
    const row = document.getElementById('walletConnectRow');
    if (!row) return;
    if (walletConnected && walletAddress) {
        const short = `${walletAddress.slice(0,4)}...${walletAddress.slice(-4)}`;
        row.innerHTML = `<div style="display:flex; justify-content:space-between;"><span>💎 TON Wallet</span><span>${short}</span></div>`;
        row.onclick = () => showDisconnectConfirm();
    } else {
        row.innerHTML = `<div style="display:flex; justify-content:space-between;"><span>💎 Connect TON Wallet</span><span>➔</span></div>`;
        row.onclick = () => connectTonWallet();
    }
}

function showDisconnectConfirm() {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:20000; display:flex; align-items:center; justify-content:center;`;
    const box = document.createElement('div');
    box.style.cssText = `background:#1a1a1a; padding:20px; border-radius:20px; text-align:center; color:white;`;
    box.innerHTML = `<div>Disconnect wallet?</div><div style="margin-top:15px;"><button id="confirmDisconnect" style="background:#ff4444; border:none; padding:8px 20px; border-radius:30px; color:white;">Disconnect</button> <button id="cancelDisconnect" style="background:transparent; border:1px solid white; padding:8px 20px; border-radius:30px; color:white;">Cancel</button></div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    box.querySelector('#confirmDisconnect').onclick = async () => { await disconnectTonWallet(); overlay.remove(); };
    box.querySelector('#cancelDisconnect').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

export async function initWalletUI() {
    try {
        const userCard = document.querySelector('.user-info-card');
        if (!userCard) { setTimeout(initWalletUI, 500); return; }
        const old = document.getElementById('walletConnectRow');
        if (old) old.remove();
        const row = document.createElement('div');
        row.id = 'walletConnectRow';
        userCard.appendChild(row);
        const saved = localStorage.getItem("ton_wallet_address");
        if (saved) {
            walletAddress = saved;
            walletConnected = true;
            updateWalletUI();
            try {
                const connector = await initTonConnect();
                if (connector && !connector.connected) {
                    walletConnected = false;
                    walletAddress = null;
                    localStorage.removeItem("ton_wallet_address");
                    updateWalletUI();
                }
            } catch (e) {
                // Silent fail – user can retry manually
                walletConnected = false;
                updateWalletUI();
            }
        } else {
            updateWalletUI();
        }
    } catch (err) {
        log("initWalletUI error", err);
    }
                                        }
