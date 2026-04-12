// monetag.js - Monetag interstitial (simplified, no auto-repeat)
// plus rewarded ad support

let monetagReady = false;
let monetagLoading = false;
let interstitialShowing = false;

// Load Monetag SDK dynamically (interstitial)
function loadMonetagSDK() {
    return new Promise((resolve) => {
        if (window.show_10836321) {
            monetagReady = true;
            console.log("[Monetag] SDK already loaded");
            resolve(true);
            return;
        }
        if (monetagLoading) {
            const checkInterval = setInterval(() => {
                if (window.show_10836321) {
                    clearInterval(checkInterval);
                    monetagReady = true;
                    console.log("[Monetag] SDK loaded (waited)");
                    resolve(true);
                }
            }, 100);
            return;
        }
        monetagLoading = true;
        const script = document.createElement('script');
        script.src = 'https://libtl.com/sdk.js';
        script.setAttribute('data-zone', '10836321');
        script.setAttribute('data-sdk', 'show_10836321');
        script.async = true;
        script.onload = () => {
            monetagReady = true;
            console.log("[Monetag] SDK loaded from script");
            resolve(true);
        };
        script.onerror = () => {
            console.warn('[Monetag] SDK failed to load');
            monetagReady = false;
            resolve(false);
        };
        document.head.appendChild(script);
    });
}

// Show interstitial – simple call, no extra settings
export async function showMonetagInterstitial() {
    console.log("[Monetag] showMonetagInterstitial called");
    
    if (interstitialShowing) {
        console.log("[Monetag] Ad already showing, skipping");
        return;
    }
    interstitialShowing = true;

    const loaded = await loadMonetagSDK();
    if (!loaded || !window.show_10836321) {
        console.warn("[Monetag] SDK not ready, aborting");
        interstitialShowing = false;
        return;
    }

    return new Promise((resolve) => {
        let resolved = false;
        // Force release lock after 5 seconds to prevent blocking
        const safetyTimer = setTimeout(() => {
            if (!resolved) {
                console.log("[Monetag] Safety timeout – releasing lock");
                resolved = true;
                interstitialShowing = false;
                resolve();
            }
        }, 5000);

        try {
            // Call the Monetag interstitial WITHOUT any parameters (default)
            console.log("[Monetag] Calling window.show_10836321()");
            const result = window.show_10836321();

            // If it returns a promise, wait for it
            if (result && typeof result.then === 'function') {
                result
                    .then(() => {
                        console.log("[Monetag] Ad promise resolved (closed)");
                        if (!resolved) {
                            clearTimeout(safetyTimer);
                            resolved = true;
                            interstitialShowing = false;
                            resolve();
                        }
                    })
                    .catch((err) => {
                        console.error("[Monetag] Ad promise rejected:", err);
                        if (!resolved) {
                            clearTimeout(safetyTimer);
                            resolved = true;
                            interstitialShowing = false;
                            resolve();
                        }
                    });
            } else {
                // No promise returned – assume ad showed and will close on its own
                console.log("[Monetag] No promise returned, waiting 3 seconds then releasing");
                setTimeout(() => {
                    if (!resolved) {
                        clearTimeout(safetyTimer);
                        resolved = true;
                        interstitialShowing = false;
                        resolve();
                    }
                }, 3000);
            }
        } catch (e) {
            console.error("[Monetag] Exception calling show_10836321:", e);
            if (!resolved) {
                clearTimeout(safetyTimer);
                resolved = true;
                interstitialShowing = false;
                resolve();
            }
        }
    });
}

// Expose a manual test function on window (for debugging)
window.testMonetagAd = async () => {
    console.log("Manual test: showing Monetag ad");
    await showMonetagInterstitial();
    console.log("Manual test: ad finished");
};

// ==================== REWARDED AD (zone 10836319) ====================
let rewardedReady = false;
let rewardedLoading = false;
let rewardedPromiseQueue = null;

function loadRewardedSDK() {
    if (rewardedPromiseQueue) return rewardedPromiseQueue;
    
    rewardedPromiseQueue = new Promise((resolve) => {
        if (window.show_10836319) {
            rewardedReady = true;
            resolve(true);
            return;
        }
        if (rewardedLoading) {
            const checkInterval = setInterval(() => {
                if (window.show_10836319) {
                    clearInterval(checkInterval);
                    rewardedReady = true;
                    resolve(true);
                }
            }, 100);
            return;
        }
        rewardedLoading = true;
        const script = document.createElement('script');
        script.src = 'https://libtl.com/sdk.js';
        script.setAttribute('data-zone', '10836319');
        script.setAttribute('data-sdk', 'show_10836319');
        script.async = true;
        script.onload = () => {
            rewardedReady = true;
            resolve(true);
        };
        script.onerror = () => {
            console.warn('Monetag rewarded SDK failed to load');
            rewardedReady = false;
            resolve(false);
        };
        document.head.appendChild(script);
    });
    return rewardedPromiseQueue;
}

export async function showRewardedAd() {
    console.log("[Rewarded] Attempting to show ad...");
    const loaded = await loadRewardedSDK();
    if (!loaded || !window.show_10836319) {
        console.warn("[Rewarded] SDK not available – showing fallback alert");
        if (window.Telegram?.WebApp?.showAlert) {
            window.Telegram.WebApp.showAlert("Ad SDK not ready. Please try again later.");
        }
        return false;
    }

    return new Promise((resolve) => {
        let resolved = false;
        const timeoutMs = 35000;

        const done = (success = false) => {
            if (resolved) return;
            resolved = true;
            console.log(`[Rewarded] Ad finished with success=${success}`);
            resolve(success);
        };

        const timer = setTimeout(() => {
            console.log('[Rewarded] Timeout – assuming ad failed');
            done(false);
        }, timeoutMs);

        try {
            const adPromise = window.show_10836319();
            if (adPromise && typeof adPromise.then === 'function') {
                adPromise
                    .then(() => {
                        console.log("[Rewarded] Ad completed successfully");
                        clearTimeout(timer);
                        done(true);
                    })
                    .catch((err) => {
                        console.error('[Rewarded] Ad promise rejected:', err);
                        clearTimeout(timer);
                        done(false);
                    });
            } else {
                console.warn('[Rewarded] show_10836319 did not return a Promise, waiting 5 seconds');
                setTimeout(() => {
                    done(true);
                }, 5000);
            }
        } catch (e) {
            console.error('[Rewarded] Exception calling show_10836319:', e);
            clearTimeout(timer);
            done(false);
        }
    });
}

// ==================== CUSTOM PROGRESS MODAL ====================
let progressModal = null;

function createProgressModal() {
    if (progressModal) return progressModal;
    
    const modal = document.createElement('div');
    modal.id = 'adProgressModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.85);
        backdrop-filter: blur(8px);
        z-index: 10001;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: 'Inter', system-ui, sans-serif;
        transition: opacity 0.2s;
        opacity: 0;
        pointer-events: none;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
        background: var(--bar, #1a1a1a);
        padding: 24px 32px;
        border-radius: 24px;
        text-align: center;
        color: var(--text, white);
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        min-width: 240px;
    `;
    
    const progressContainer = document.createElement('div');
    progressContainer.style.cssText = `
        display: flex;
        justify-content: center;
        gap: 16px;
        margin: 20px 0;
    `;
    
    // Create two progress indicators (lines)
    for (let i = 0; i < 2; i++) {
        const line = document.createElement('div');
        line.className = 'progress-line';
        line.style.cssText = `
            width: 40px;
            height: 4px;
            background: rgba(255,255,255,0.3);
            border-radius: 4px;
            transition: all 0.3s ease;
        `;
        progressContainer.appendChild(line);
    }
    
    const messageEl = document.createElement('div');
    messageEl.style.cssText = `
        font-size: 18px;
        font-weight: 500;
        margin-bottom: 16px;
    `;
    
    const subMessage = document.createElement('div');
    subMessage.style.cssText = `
        font-size: 14px;
        opacity: 0.7;
        margin-bottom: 20px;
    `;
    subMessage.innerText = 'Preparing ad...';
    
    const continueBtn = document.createElement('button');
    continueBtn.innerText = 'Continue';
    continueBtn.style.cssText = `
        background: var(--accent, #9c4dff);
        border: none;
        color: white;
        padding: 10px 24px;
        border-radius: 40px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        transition: transform 0.1s;
    `;
    continueBtn.onmouseover = () => continueBtn.style.transform = 'scale(1.02)';
    continueBtn.onmouseout = () => continueBtn.style.transform = 'scale(1)';
    
    content.appendChild(messageEl);
    content.appendChild(progressContainer);
    content.appendChild(subMessage);
    content.appendChild(continueBtn);
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    progressModal = { modal, messageEl, progressLines: progressContainer.children, continueBtn, subMessage };
    return progressModal;
}

/**
 * Show a progress modal before an ad.
 * @param {number} current - current ad number (1-indexed)
 * @param {number} total - total ads (default 2)
 * @returns {Promise<void>} - resolves when user taps Continue or auto-dismiss after 1.5s
 */
async function showProgressModal(current, total = 2) {
    const { modal, messageEl, progressLines, continueBtn, subMessage } = createProgressModal();
    
    // Update message and highlight current line
    messageEl.innerText = `Ad ${current} of ${total}`;
    subMessage.innerText = 'Get ready...';
    for (let i = 0; i < progressLines.length; i++) {
        const line = progressLines[i];
        if (i === current - 1) {
            line.style.background = 'var(--accent, #9c4dff)';
            line.style.boxShadow = '0 0 8px var(--accent, #9c4dff)';
        } else {
            line.style.background = 'rgba(255,255,255,0.3)';
            line.style.boxShadow = 'none';
        }
    }
    
    // Show modal
    modal.style.opacity = '1';
    modal.style.pointerEvents = 'auto';
    
    // Resolve when user clicks Continue OR after 1.5 seconds auto
    let resolved = false;
    const timeout = setTimeout(() => {
        if (!resolved) {
            resolved = true;
            modal.style.opacity = '0';
            modal.style.pointerEvents = 'none';
        }
    }, 1500);
    
    const onClick = () => {
        if (resolved) return;
        clearTimeout(timeout);
        resolved = true;
        modal.style.opacity = '0';
        modal.style.pointerEvents = 'none';
    };
    continueBtn.addEventListener('click', onClick, { once: true });
    
    return new Promise((resolve) => {
        const checkClosed = setInterval(() => {
            if (resolved) {
                clearInterval(checkClosed);
                resolve();
            }
        }, 50);
    });
}

// ==================== SHOW MULTIPLE REWARDED ADS ====================
/**
 * Show multiple rewarded ads one after another with progress modal.
 * @param {number} count - number of ads to show (default 2)
 * @returns {Promise<boolean>} - true only if ALL ads completed successfully
 */
export async function showMultipleRewardedAds(count = 2) {
    console.log(`[Rewarded] Starting ${count} ad(s) sequence`);
    
    for (let i = 1; i <= count; i++) {
        // Show progress modal before each ad
        await showProgressModal(i, count);
        
        const success = await showRewardedAd();
        if (!success) {
            console.log(`[Rewarded] Ad ${i} failed – aborting sequence`);
            if (window.Telegram?.WebApp?.showAlert) {
                window.Telegram.WebApp.showAlert(`Ad ${i} was not completed. Please watch the full ad to earn premium.`);
            }
            return false;
        }
        console.log(`[Rewarded] Ad ${i} completed`);
    }
    
    console.log(`[Rewarded] All ${count} ads completed – reward granted`);
    return true;
}
