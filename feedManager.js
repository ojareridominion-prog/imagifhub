// feedManager.js
import { state } from './state.js';
import { getSeenList, trackSeenImage, showLoadingSpinner, hideLoadingSpinner } from './utils.js';
import { buildSlides, showMonetagInterstitial } from './adsManager.js';
import { playRandomMusic } from './musicManager.js';

const API_URL = "https://imagifhub.onrender.com";
const PAGE_SIZE = 30;
const MAX_RETRIES = 3;
const AD_FREQUENCY = 3; // same as in adsManager

// ===== NEW: helper to check if an image is saved =====
function isImageSaved(imageId) {
    return state.savedImageIds && state.savedImageIds.has(String(imageId));
}

async function fetchRandomImages(category = state.currentCategory, search = "", retryCount = 0) {
    if (state.isLoadingMore) return [];
    state.isLoadingMore = true;
    showLoadingSpinner();
    try {
        let url = `${API_URL}/media/random?limit=${PAGE_SIZE}`;
        if (category && category !== "Discover") url += `&category=${encodeURIComponent(category)}`;
        if (search && search.trim()) url += `&search=${encodeURIComponent(search.trim())}`;
        const res = await fetch(url);
        let newImages = await res.json();
        if (!newImages || newImages.length === 0) {
            state.hasMoreImages = false;
            return [];
        }
        
        // For search: ignore localStorage seen history, only filter by current session
        const isSearchActive = search && search.trim().length > 0;
        let seenHistory = new Set();
        if (!isSearchActive) {
            seenHistory = new Set(getSeenList());
        }
        
        const filtered = newImages.filter(img => 
            !state.sessionSeenUrls.has(img.url) && !seenHistory.has(img.url)
        );
        
        if (filtered.length < 10 && retryCount < MAX_RETRIES) {
            const more = await fetchRandomImages(category, search, retryCount + 1);
            const combined = [...filtered, ...more];
            const uniqueCombined = [];
            const seenSet = new Set();
            for (const img of combined) {
                if (!seenSet.has(img.url) && !state.sessionSeenUrls.has(img.url) && !seenHistory.has(img.url)) {
                    seenSet.add(img.url);
                    uniqueCombined.push(img);
                }
            }
            return uniqueCombined;
        }
        
        filtered.forEach(img => state.sessionSeenUrls.add(img.url));
        return filtered;
    } catch (e) {
        console.error("Error fetching random images:", e);
        return [];
    } finally {
        state.isLoadingMore = false;
        hideLoadingSpinner();
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    }).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function(c) {
        return c;
    });
}

// Modified generateImageSlide with save button
function generateImageSlide(img) {
    const keyword = img.Keyword || '';
    const maxLength = 100;
    let keywordHtml = '';
    if (keyword.length > maxLength) {
        const truncated = keyword.substring(0, maxLength) + '...';
        keywordHtml = `
            <span class="keyword-short">${truncated}</span>
            <span class="keyword-full" style="display:none;">${escapeHtml(keyword)}</span>
            <button class="more-btn">more</button>
            <button class="less-btn" style="display:none;">less</button>
        `;
    } else {
        keywordHtml = `<span>${escapeHtml(keyword)}</span>`;
    }

    const imageId = img.id;
    const saved = isImageSaved(imageId);
    const heartClass = saved ? 'saved' : '';

    return `
        <div class="swiper-slide" data-type="image" data-image-id="${imageId}">
            <img src="${img.url}" alt="${escapeHtml(img.category)}" style="width:100%; height:100%; object-fit:cover;">
            <button class="gift-icon-btn" aria-label="Send Gift">🎁</button>
            <button class="save-image-btn ${heartClass}" data-image-id="${imageId}" aria-label="Save Image">❤️</button>
            <div class="meta-overlay">
                <div class="category-tag">#${escapeHtml(img.category)}</div>
                <div class="keyword-container">${keywordHtml}</div>
            </div>
        </div>
    `;
}

function generateAdSlide(ad, adIndex) {
    return `
        <div class="swiper-slide" data-type="ad" data-ad-index="${adIndex}">
            <img src="${ad.image}" alt="Ad" style="width:100%; height:100%; object-fit:cover;">
            <div class="ad-overlay">
                <div class="ad-sponsored">Sponsored</div>
                <div class="ad-title">${escapeHtml(ad.title)}</div>
                <div class="ad-description">${escapeHtml(ad.subtitle)}</div>
                <button class="ad-action-btn">${escapeHtml(ad.buttonLabel || 'Open')}</button>
            </div>
            <button class="remove-ads-btn">Remove Ads</button>
        </div>
    `;
}

async function appendMoreImages(newImages) {
    if (!state.activeSwiper || newImages.length === 0) return false;

    const swiper = state.activeSwiper;
    const oldImageCount = state.allImages.length;
    const htmlSlides = [];
    let localAdIndex = state.currentAdIndex;

    for (let i = 0; i < newImages.length; i++) {
        const img = newImages[i];
        htmlSlides.push(generateImageSlide(img));

        // Insert native ad after every AD_FREQUENCY images (continuing pattern)
        const position = oldImageCount + i + 1;
        if (!state.isPremiumUser && position % AD_FREQUENCY === 0) {
            const ad = state.nativeAds[localAdIndex % state.nativeAds.length];
            htmlSlides.push(generateAdSlide(ad, localAdIndex % state.nativeAds.length));
            localAdIndex++;
        }
    }

    if (htmlSlides.length === 0) return false;

    swiper.appendSlide(htmlSlides);
    swiper.update();

    state.currentAdIndex = localAdIndex;
    state.allImages.push(...newImages);
    newImages.forEach(img => state.sessionSeenUrls.add(img.url));

    return true;
}

function renderSlides(slides) {
    const feed = document.getElementById('feed');
    feed.innerHTML = slides.map(slide => {
        if (slide.type === 'image') {
            return generateImageSlide(slide.item);
        } else {
            return generateAdSlide(slide.item, slide.item.index);
        }
    }).join('');

    if (state.activeSwiper) state.activeSwiper.destroy(true, true);
    state.activeSwiper = new Swiper('#swiper', {
        direction: 'vertical',
        mousewheel: true,
        effect: 'fade',
        fadeEffect: { crossFade: true },
        speed: 400,
        on: {
            reachEnd: async () => {
                if (state.activeSearchQuery) return;
                if (!state.hasMoreImages || state.isLoadingMore) return;
                await loadMoreImages(true);
            },
            slideChange: function () {
                const activeSlide = this.slides[this.activeIndex];
                if (activeSlide && activeSlide.dataset.type === 'image') {
                    const img = activeSlide.querySelector('img');
                    if (img && img.src) trackSeenImage(img.src);
                    if (!state.isPremiumUser) {
                        state.imagesShownSinceLastAd++;
                        if (state.imagesShownSinceLastAd >= 15) {
                            state.imagesShownSinceLastAd = 0;
                            this.allowTouchMove = false;
                            showMonetagInterstitial().finally(() => { this.allowTouchMove = true; });
                        }
                    }
                }
            },
            init: function() {
                const activeSlide = this.slides[this.activeIndex];
                if (activeSlide && activeSlide.dataset.type === 'image') {
                    const img = activeSlide.querySelector('img');
                    if (img && img.src) trackSeenImage(img.src);
                }
            }
        }
    });

    // Attach save button listeners after slides are rendered
    initSaveButtonListeners();
}

// ===== NEW: event delegation for save buttons =====
function initSaveButtonListeners() {
    const feed = document.getElementById('feed');
    if (!feed) return;
    // Remove any previous listener to avoid duplicates (use a flag or just remove)
    // We'll use a named function so we can remove and re-add, but for simplicity we use a single listener with event delegation.
    // If listener already exists, we remove it first.
    if (feed._saveListener) {
        feed.removeEventListener('click', feed._saveListener);
    }
    const handler = async (e) => {
        const btn = e.target.closest('.save-image-btn');
        if (!btn) return;
        e.stopPropagation();
        const imageId = btn.dataset.imageId;
        if (!imageId) return;
        await toggleSaveImage(imageId, btn);
    };
    feed._saveListener = handler;
    feed.addEventListener('click', handler);
}

// ===== NEW: toggle save image (used by both feed and saved overlay) =====
export async function toggleSaveImage(imageId, btnElement) {
    if (!state.user || !state.user.id) {
        if (window.Telegram?.WebApp?.showAlert) {
            window.Telegram.WebApp.showAlert("Please open the app inside Telegram to save images.");
        }
        return;
    }
    const tg = window.Telegram.WebApp;
    try {
        const resp = await fetch(`${API_URL}/api/toggle-save-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData },
            body: JSON.stringify({ telegram_id: state.user.id, image_id: imageId })
        });
        const data = await resp.json();
        if (data.status === 'success') {
            // Update state
            state.savedImageIds = new Set(data.saved_images.map(String));
            // Update button appearance if provided
            if (btnElement) {
                const isSaved = data.is_saved;
                btnElement.classList.toggle('saved', isSaved);
                btnElement.textContent = isSaved ? '❤️' : '🤍';
            }
            // If saved overlay is open, refresh it
            const overlay = document.getElementById('savedOverlay');
            if (overlay && overlay.classList.contains('active')) {
                // loadSavedImages is defined in script.js, so we call it via window
                if (window.loadSavedImages) {
                    window.loadSavedImages(true);
                }
            }
        } else {
            throw new Error(data.message || 'Failed to toggle save');
        }
    } catch (err) {
        console.error('Toggle save error:', err);
        if (window.Telegram?.WebApp?.showAlert) {
            window.Telegram.WebApp.showAlert('Failed to save image. Please try again.');
        }
    }
}

// Expose toggleSaveImage globally for use in script.js (overlay delete)
window.toggleSaveImage = toggleSaveImage;

export async function loadMoreImages(preservePosition = false) {
    if (state.isLoadingMore || !state.hasMoreImages) return;
    const newImages = await fetchRandomImages(state.currentCategory, state.activeSearchQuery);
    if (newImages.length === 0) {
        state.hasMoreImages = false;
        return;
    }
    await appendMoreImages(newImages);
}

export async function resetAndLoadFeed(cat, search = "", skipAd = false) {
    if (state.isLoadingFeed) return;
    state.isLoadingFeed = true;
    state.sessionSeenUrls.clear();
    state.hasMoreImages = true;
    state.allImages = [];
    state.imagesShownSinceLastAd = 0;
    state.currentAdIndex = 0;
    const shouldShowAd = !state.isPremiumUser && !skipAd && !state.activeSearchQuery;
    if (shouldShowAd) {
        try { await showMonetagInterstitial(); } catch (e) { console.warn(e); }
    }
    state.activeSearchQuery = search || "";
    state.currentCategory = cat;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.innerText === cat));
    const audio = document.getElementById('bgMusic');
    if (audio.paused || state.currentCategory !== cat) playRandomMusic(cat);
    const feed = document.getElementById('feed');
    // Skeleton loading
    feed.innerHTML = `
        <div class="skeleton-wrapper">
            <div class="skeleton-slide">
                <div class="skeleton-image"></div>
                <div class="skeleton-text"></div>
                <div class="skeleton-text-small"></div>
            </div>
            <div class="skeleton-slide">
                <div class="skeleton-image"></div>
                <div class="skeleton-text"></div>
                <div class="skeleton-text-small"></div>
            </div>
        </div>
    `;
    try {
        const newImages = await fetchRandomImages(cat, state.activeSearchQuery);
        if (newImages.length === 0) {
            feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>No Images Found</h3></div>';
            return;
        }
        state.allImages = newImages;
        const slides = buildSlides(state.allImages, state.isPremiumUser);
        renderSlides(slides);
    } catch (e) {
        feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Connection Error</h3></div>';
    } finally {
        state.isLoadingFeed = false;
    }
}

export async function loadFeed(cat, search = "", skipAd = false) {
    await resetAndLoadFeed(cat, search, skipAd);
}
