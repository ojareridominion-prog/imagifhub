// adsgram.js - Proper AdsGram SDK integration

let adsgramInitialized = false;

/**
 * Initialize AdsGram SDK (if needed)
 * The SDK is loaded via script tag in index.html
 */
function initAdsGram() {
    if (typeof window.Adsgram !== 'undefined' && !adsgramInitialized) {
        console.log('[AdsGram] SDK ready');
        adsgramInitialized = true;
    }
}

/**
 * Show an interstitial ad via AdsGram SDK
 * @returns {Promise<boolean>} - true if ad completed successfully, false if error/skipped
 */
export async function showInterstitialAd() {
    // Wait for SDK to be available
    if (typeof window.Adsgram === 'undefined') {
        console.warn('[AdsGram] SDK not loaded');
        return false;
    }

    initAdsGram();

    return new Promise((resolve) => {
        try {
            window.Adsgram.showInterstitialAd({
                blockId: '26851',  // Your AdsGram block ID
                onShow: () => {
                    console.log('[AdsGram] Ad shown');
                },
                onClose: (data) => {
                    // data.completed indicates if the ad was watched fully
                    if (data && data.completed) {
                        console.log('[AdsGram] Ad completed');
                        resolve(true);
                    } else {
                        console.log('[AdsGram] Ad skipped or closed early');
                        resolve(false);
                    }
                },
                onError: (err) => {
                    console.error('[AdsGram] Error:', err);
                    resolve(false);
                }
            });
        } catch (err) {
            console.error('[AdsGram] Exception:', err);
            resolve(false);
        }
    });
}
