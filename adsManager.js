// adsManager.js
import { state } from './state.js';
import { showMonetagInterstitial, showRewardedAd } from './monetag.js';

const API_URL = "https://imagifhub.onrender.com";

export async function fetchNativeAds() {
    try {
        const response = await fetch(`${API_URL}/api/ads`);
        if (response.ok) {
            state.nativeAds = await response.json();
            console.log(`Loaded ${state.nativeAds.length} native ads`);
        } else {
            console.warn('Failed to load ads, using empty array');
            state.nativeAds = [];
        }
    } catch (e) {
        console.error('Error fetching ads:', e);
        state.nativeAds = [];
    }
}

export function buildSlides(images, isPremium) {
    if (isPremium) {
        return images.map(img => ({ type: 'image', item: img }));
    }
    const slides = [];
    let imageCounter = 0;
    const AD_FREQUENCY = 3;
    for (let i = 0; i < images.length; i++) {
        slides.push({ type: 'image', item: images[i] });
        imageCounter++;
        if (imageCounter % AD_FREQUENCY === 0) {
            const ad = state.nativeAds[state.currentAdIndex % state.nativeAds.length];
            slides.push({
                type: 'ad',
                item: { ...ad, index: state.currentAdIndex % state.nativeAds.length }
            });
            state.currentAdIndex++;
        }
    }
    return slides;
}

export function setupAdButtonListeners() {
    document.getElementById('feed').addEventListener('click', async (e) => {
        const target = e.target;
        const slide = target.closest('.swiper-slide');
        if (!slide) return;
        
        // ✅ NEW: Only allow click if this slide is the current active slide
        if (state.activeSwiper && state.activeSwiper.activeIndex !== [...state.activeSwiper.slides].indexOf(slide)) {
            e.preventDefault();
            e.stopPropagation();
            console.warn("Blocked click on non‑active ad slide");
            return;
        }

        if (target.classList.contains('remove-ads-btn')) {
            window.openPremium();
            e.stopPropagation();
            return;
        }
        
        if (target.classList.contains('ad-action-btn')) {
            const adIndex = parseInt(slide.dataset.adIndex);
            if (!isNaN(adIndex) && state.nativeAds[adIndex]) {
                const ad = state.nativeAds[adIndex];
                if (ad.action) window.open(ad.action, '_blank');
            }
            e.stopPropagation();
        }
    });
}

export { showMonetagInterstitial, showRewardedAd };
