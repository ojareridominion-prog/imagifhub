// feedManager.js
import { state } from './state.js';
import { getSeenList, trackSeenImage, showLoadingSpinner, hideLoadingSpinner } from './utils.js';
import { buildSlides, showMonetagInterstitial } from './adsManager.js';
import { playRandomMusic } from './musicManager.js';
import { showGiftDrawer } from './giftManager.js'; // <-- IMPORT for gift button

const API_URL = "https://imagifhub.onrender.com";
const PAGE_SIZE = 30;
const MAX_RETRIES = 3;
const AD_FREQUENCY = 3; // same as in adsManager

// ===== helper to check if an image is saved =====
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

// ===== generateImageSlide with vertical button bar =====
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

    // button bar HTML
    const controlsHtml = `
        <div class="image-controls">
            <button class="ctrl-btn save-btn ${heartClass}" data-image-id="${imageId}" aria-label="Save Image">${saved ? '♥️' : '🤍'}</button>
            <button class="ctrl-btn gift-btn" aria-label="Send Gift">🎁</button>
            <button class="ctrl-btn share-btn" data-image-id="${imageId}" aria-label="Share Image">🔗</button>
            <button class="ctrl-btn refresh-btn" data-image-id="${imageId}" aria-label="Refresh Image">🔄</button>
        </div>
    `;

    return `
        <div class="swiper-slide" data-type="image" data-image-id="${imageId}">
            <img src="${img.url}" alt="${escapeHtml(img.category)}" style="width:100%; height:100%; object-fit:cover;">
            ${controlsHtml}
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

    // Attach button listeners (save, share, refresh, gift)
    initSlideButtonListeners();
}

// ===== unified button listeners =====
function initSlideButtonListeners() {
    const feed = document.getElementById('feed');
    if (!feed) return;
    // Remove previous listener to avoid duplicates
    if (feed._slideListener) {
        feed.removeEventListener('click', feed._slideListener);
    }
    const handler = async (e) => {
        const target = e.target.closest('.ctrl-btn');
        if (!target) return;

        const slide = target.closest('.swiper-slide');
        if (!slide) return;
        const imageId = slide.dataset.imageId;

        // Save button
        if (target.classList.contains('save-btn')) {
            e.stopPropagation();
            if (!imageId) return;
            await toggleSaveImage(imageId, target);
            return;
        }

        // Gift button – use imported function directly (FIXED)
        if (target.classList.contains('gift-btn')) {
            e.stopPropagation();
            showGiftDrawer(); // <-- now works because we imported it
            return;
        }

        // Share button
        if (target.classList.contains('share-btn')) {
            e.stopPropagation();
            if (!imageId) return;
            copyDeepLink(imageId);
            return;
        }

        // Refresh button
        if (target.classList.contains('refresh-btn')) {
            e.stopPropagation();
            const img = slide.querySelector('img');
            if (img) {
                // Force reload by adding cache-busting parameter
                const src = img.src;
                const url = new URL(src);
                url.searchParams.set('_t', Date.now());
                img.src = url.toString();
                if (window.showToast) window.showToast('Refreshing image...', 'info', 1500);
            }
            return;
        }
    };
    feed._slideListener = handler;
    feed.addEventListener('click', handler);
}

// ===== share deep link =====
function copyDeepLink(imageId) {
    const botUsername = 'IMAGIFHUB_bot';
    const deepLink = `https://t.me/${botUsername}?startapp=${imageId}`;
    navigator.clipboard.writeText(deepLink)
        .then(() => {
            if (window.showToast) window.showToast('✅ Image link copied!', 'success', 2000);
        })
        .catch(() => {
            const textarea = document.createElement('textarea');
            textarea.value = deepLink;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            if (window.showToast) window.showToast('✅ Image link copied!', 'success', 2000);
        });
}

// ===== load a single image by ID (for deep link) =====
export async function loadImageById(imageId) {
    try {
        const resp = await fetch(`${API_URL}/media/${imageId}`);
        if (!resp.ok) {
            if (resp.status === 404) {
                if (window.showToast) window.showToast('Image not found', 'error');
                return false;
            }
            throw new Error('Network error');
        }
        const image = await resp.json();
        // Reset feed and show only this image initially
        state.allImages = [image];
        state.sessionSeenUrls.clear();
        state.hasMoreImages = true;
        state.imagesShownSinceLastAd = 0;
        state.currentAdIndex = 0;
        const slides = buildSlides(state.allImages, state.isPremiumUser);
        renderSlides(slides);
        // Load more images in background
        setTimeout(() => loadMoreImages(true), 500);
        return true;
    } catch (err) {
        console.error('loadImageById error:', err);
        if (window.showToast) window.showToast('Failed to load image', 'error');
        return false;
    }
}

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
            state.savedImageIds = new Set(data.saved_images.map(String));
            // Update all save buttons for this image
            document.querySelectorAll(`.save-btn[data-image-id="${imageId}"]`).forEach(btn => {
                const isSaved = data.is_saved;
                btn.classList.toggle('saved', isSaved);
                btn.textContent = isSaved ? '♥️' : '🤍';
            });
            // If saved overlay is open, refresh it
            const overlay = document.getElementById('savedOverlay');
            if (overlay && overlay.classList.contains('active')) {
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

// ===== handle deep link start_param =====
export async function handleDeepLink() {
    const tg = window.Telegram.WebApp;
    const startParam = tg.initDataUnsafe?.start_param;
    if (!startParam) return false;
    console.log('[Deep Link] Loading image:', startParam);
    const success = await loadImageById(startParam);
    return success;
}
