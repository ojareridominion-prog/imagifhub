// monetag.js - Monetag interstitial wrapper with Promise & fallback
// plus rewarded ad support

let monetagReady = false;
let monetagLoading = false;
let interstitialShowing = false;

// Load Monetag SDK dynamically (interstitial)
function loadMonetagSDK() {
    return new Promise((resolve) => {
        if (window.show_10836321) {
            monetagReady = true;
            resolve(true);
            return;
        }
        if (monetagLoading) {
            const checkInterval = setInterval(() => {
                if (window.show_10836321) {
                    clearInterval(checkInterval);
                    monetagReady = true;
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
            resolve(true);
        };
        script.onerror = () => {
            console.warn('Monetag SDK failed to load');
            monetagReady = false;
            resolve(false);
        };
        document.head.appendChild(script);
    });
}

// Show interstitial and wait for it to be closed (or timeout)
export async function showMonetagInterstitial() {
    // Avoid overlapping ad requests
    if (interstitialShowing) {
        console.log('[Monetag] Ad already showing, skipping');
        return;
    }
    interstitialShowing = true;

    const loaded = await loadMonetagSDK();
    if (!loaded || !window.show_10836321) {
        console.warn('[Monetag] SDK not ready');
        interstitialShowing = false;
        return;
    }

    return new Promise((resolve) => {
        let resolved = false;
        const timeoutMs = 15000; // 15 seconds – enough for ad to load/close

        const done = () => {
            if (resolved) return;
            resolved = true;
            interstitialShowing = false;
            resolve();
        };

        // Set a timeout in case the ad never triggers a close event
        const timer = setTimeout(() => {
            console.log('[Monetag] Ad timeout – resolving anyway');
            done();
        }, timeoutMs);

        try {
            // Call Monetag interstitial – use default settings (no auto‑repeat)
            // The SDK will show the ad and (hopefully) call the onAdClosed callback
            const result = window.show_10836321({
                type: 'inApp',
                onAdClosed: () => {
                    console.log('[Monetag] Ad closed by user');
                    clearTimeout(timer);
                    done();
                }
            });

            // If the SDK returns a promise, await it (fallback)
            if (result && typeof result.then === 'function') {
                result
                    .then(() => {
                        console.log('[Monetag] Ad promise resolved');
                        clearTimeout(timer);
                        done();
                    })
                    .catch((err) => {
                        console.error('[Monetag] Ad promise rejected:', err);
                        clearTimeout(timer);
                        done();
                    });
            } else if (result && typeof result === 'object' && !result.onAdClosed) {
                // If no callback was provided, assume ad shows and we need to wait a bit
                console.log('[Monetag] No onAdClosed callback, waiting 5 seconds');
                setTimeout(() => {
                    clearTimeout(timer);
                    done();
                }, 5000);
            }
        } catch (e) {
            console.error('[Monetag] Exception calling show_10836321:', e);
            clearTimeout(timer);
            done();
        }
    });
}

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
