// adsgram.js - AdsGram integration for in‑feed ads

// Your AdsGram block ID (provided in the task)
const ADSGRAM_BLOCK_ID = "26851";

// Timeout in ms for fetching an ad
const FETCH_TIMEOUT = 5000;

/**
 * Fetch a single ad from AdsGram.
 * @returns {Promise<Object|null>} Ad object with image, title, subtitle, buttonLabel, action (URL)
 */
export async function fetchAdsgramAd() {
    // Check if SDK is loaded
    if (typeof window === "undefined" || !window.Adsgram) {
        console.warn("[AdsGram] SDK not loaded");
        return null;
    }

    // Create a promise that rejects after timeout
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("AdsGram fetch timeout")), FETCH_TIMEOUT)
    );

    // Try to get an ad using the AdsGram method.
    // According to AdsGram documentation, you can use `showAd` for interstitials,
    // but for native/in‑feed ads we assume a method like `getNativeAd` exists.
    // If the actual method differs, replace it with the correct one.
    const fetchPromise = new Promise((resolve) => {
        try {
            // Hypothetical method – replace with the real AdsGram native ad call if needed.
            // For demonstration we use `getNativeAd`; adjust according to AdsGram docs.
            if (typeof window.Adsgram.getNativeAd === "function") {
                window.Adsgram.getNativeAd({ blockId: ADSGRAM_BLOCK_ID })
                    .then((adData) => {
                        if (adData && adData.image && adData.link) {
                            resolve({
                                image: adData.image,
                                title: adData.title || "Sponsored",
                                subtitle: adData.description || "",
                                buttonLabel: adData.buttonText || "Learn More",
                                action: adData.link,   // URL string
                            });
                        } else {
                            console.warn("[AdsGram] Invalid ad data", adData);
                            resolve(null);
                        }
                    })
                    .catch((err) => {
                        console.error("[AdsGram] getNativeAd error:", err);
                        resolve(null);
                    });
            } else {
                // Fallback: if the specific method is not available, try generic showAd? Not suitable.
                console.warn("[AdsGram] getNativeAd not implemented in SDK");
                resolve(null);
            }
        } catch (e) {
            console.error("[AdsGram] Exception:", e);
            resolve(null);
        }
    });

    try {
        const ad = await Promise.race([fetchPromise, timeoutPromise]);
        return ad || null;
    } catch (err) {
        console.error("[AdsGram] Fetch failed:", err);
        return null;
    }
    }
