// monetag.js - Monetag interstitial wrapper with Promise & fallback
// plus rewarded ad support

let monetagReady = false;
let monetagLoading = false;
let interstitialShowing = false;   // prevent concurrent calls

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
    if (interstitialShowing) return;
    interstitialShowing = true;

    const loaded = await loadMonetagSDK();
    if (!loaded || !window.show_10836321) {
        interstitialShowing = false;
        return;
    }

    return new Promise((resolve) => {
        let resolved = false;
        const timeoutMs = 5000;

        const done = () => {
            if (resolved) return;
            resolved = true;
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('visibilitychange', onVisibility);
            clearTimeout(timer);
            interstitialShowing = false;
            resolve();
        };

        const onFocus = () => done();
        const onVisibility = () => {
            if (document.visibilityState === 'visible') done();
        };

        window.addEventListener('focus', onFocus);
        window.addEventListener('visibilitychange', onVisibility);

        const timer = setTimeout(() => {
            console.log('Monetag ad timeout – loading feed anyway');
            done();
        }, timeoutMs);

        try {
            window.show_10836321({
                type: 'inApp',
                inAppSettings: {
                    frequency: 999999,   // effectively disable automatic frequency
                    capping: 0,
                    interval: 999999,         // no automatic interval (was 30)
                    timeout: 5,
                    everyPage: false
                }
            });
        } catch (e) {
            console.error('Monetag show error:', e);
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
        // Fallback for testing: simulate successful ad after 2 seconds
        if (window.Telegram?.WebApp?.showAlert) {
            window.Telegram.WebApp.showAlert("Ad SDK not ready. Please try again later.");
        }
        return false;
    }

    return new Promise((resolve) => {
        let resolved = false;
        const timeoutMs = 35000; // 35 seconds

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
            // Monetag rewarded ad – the function usually returns a Promise
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
                // If it doesn't return a promise, assume it's a synchronous show
                // and we have to rely on events (unlikely)
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
