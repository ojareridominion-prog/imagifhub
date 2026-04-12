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
