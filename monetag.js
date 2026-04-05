// monetag.js - Monetag interstitial wrapper with Promise & fallback

let monetagReady = false;
let monetagLoading = false;

// Load Monetag SDK dynamically
function loadMonetagSDK() {
    return new Promise((resolve) => {
        if (window.show_10836321) {
            monetagReady = true;
            resolve(true);
            return;
        }
        if (monetagLoading) {
            // wait for existing load
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
    // Only for non-premium – check will be done by caller
    // Wait for SDK
    const loaded = await loadMonetagSDK();
    if (!loaded || !window.show_10836321) {
        return; // fallback silently
    }

    return new Promise((resolve) => {
        let resolved = false;
        const timeoutMs = 5000; // 5 seconds max wait

        // Function to clean up and resolve
        const done = () => {
            if (resolved) return;
            resolved = true;
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('visibilitychange', onVisibility);
            clearTimeout(timer);
            resolve();
        };

        // When user returns to the page (ad overlay closed)
        const onFocus = () => done();
        const onVisibility = () => {
            if (document.visibilityState === 'visible') done();
        };

        window.addEventListener('focus', onFocus);
        window.addEventListener('visibilitychange', onVisibility);

        // Fallback timeout
        const timer = setTimeout(() => {
            console.log('Monetag ad timeout – loading feed anyway');
            done();
        }, timeoutMs);

        // Show the ad
        try {
            window.show_10836321({
                type: 'inApp',
                inAppSettings: {
                    frequency: 1,      // show on every call (SDK may still enforce its own cap)
                    capping: 0,
                    interval: 30,
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
