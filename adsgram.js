// adsgram.js - AdsGram integration using direct advbot API

const ADSGRAM_BLOCK_ID = "26851";
const FETCH_TIMEOUT = 5000;

/**
 * Strips HTML tags from a string
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
    if (!html) return "";
    return html.replace(/<[^>]*>/g, "");
}

/**
 * Fetch a single ad from AdsGram advbot API
 * @returns {Promise<Object|null>} Ad object with image, title, subtitle, buttonLabel, action
 */
export async function fetchAdsgramAd() {
    // Get Telegram user ID
    let userId = "0";
    try {
        if (window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
            userId = window.Telegram.WebApp.initDataUnsafe.user.id;
        }
    } catch (e) {
        console.warn("[AdsGram] Could not get Telegram user ID:", e);
    }

    const url = `https://api.adsgram.ai/advbot?blockid=${ADSGRAM_BLOCK_ID}&tgid=${userId}`;

    // Timeout promise
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("AdsGram API timeout")), FETCH_TIMEOUT)
    );

    const fetchPromise = fetch(url)
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            
            // Expected response structure: { ads: [...] } or maybe direct ad object
            // Let's be flexible: if data.ads is array and has at least one item, use first.
            let adData = null;
            if (data.ads && Array.isArray(data.ads) && data.ads.length > 0) {
                adData = data.ads[0];
            } else if (data.image_url || data.image) {
                // Direct ad object
                adData = data;
            } else {
                console.warn("[AdsGram] Unexpected API response format", data);
                return null;
            }

            // Extract fields
            const image = adData.image_url || adData.image || "";
            const title = adData.title || "Sponsored";
            // Strip HTML from text_html or description
            const rawDescription = adData.text_html || adData.description || "";
            const subtitle = stripHtml(rawDescription);
            const buttonLabel = adData.button_text || adData.cta_text || "Learn More";
            const action = adData.link || adData.url || "";

            if (!image || !action) {
                console.warn("[AdsGram] Missing required fields", { image, action });
                return null;
            }

            return {
                image: image,
                title: title,
                subtitle: subtitle,
                buttonLabel: buttonLabel,
                action: action,
            };
        })
        .catch((err) => {
            console.error("[AdsGram] Fetch error:", err);
            return null;
        });

    try {
        const ad = await Promise.race([fetchPromise, timeoutPromise]);
        return ad || null;
    } catch (err) {
        console.error("[AdsGram] Request failed:", err);
        return null;
    }
}
