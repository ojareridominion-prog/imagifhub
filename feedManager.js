// feedManager.js
import { state } from './state.js';
import { getSeenList, trackSeenImage, showLoadingSpinner, hideLoadingSpinner } from './utils.js';
import { buildSlides, showMonetagInterstitial } from './adsManager.js';
import { playRandomMusic } from './musicManager.js';

const API_URL = "https://imagifhub.onrender.com";
const PAGE_SIZE = 30;
const MAX_RETRIES = 3;

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
        const seenHistory = new Set(getSeenList());
        const filtered = newImages.filter(img => !state.sessionSeenUrls.has(img.url) && !seenHistory.has(img.url));
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

function renderSlides(slides) {
    const feed = document.getElementById('feed');
    feed.innerHTML = slides.map(slide => {
        if (slide.type === 'image') {
            const item = slide.item;
            const keyword = item.Keyword || '';
            const maxLength = 100;
            let keywordHtml = '';
            if (keyword.length > maxLength) {
                const truncated = keyword.substring(0, maxLength) + '...';
                keywordHtml = `
                    <span class="keyword-short">${truncated}</span>
                    <span class="keyword-full" style="display:none;">${keyword}</span>
                    <button class="more-btn">more</button>
                    <button class="less-btn" style="display:none;">less</button>
                `;
            } else keywordHtml = `<span>${keyword}</span>`;
            return `
                <div class="swiper-slide" data-type="image">
                    <img src="${item.url}" alt="${item.category}" style="width:100%; height:100%; object-fit:cover;">
                    <div class="meta-overlay">
                        <div class="category-tag">#${item.category}</div>
                        <div class="keyword-container">${keywordHtml}</div>
                    </div>
                </div>
            `;
        } else {
            const ad = slide.item;
            return `
                <div class="swiper-slide" data-type="ad" data-ad-index="${ad.index}">
                    <img src="${ad.image}" alt="Ad" style="width:100%; height:100%; object-fit:cover;">
                    <div class="ad-overlay">
                        <div class="ad-sponsored">Sponsored</div>
                        <div class="ad-title">${ad.title}</div>
                        <div class="ad-description">${ad.subtitle}</div>
                        <button class="ad-action-btn">${ad.buttonLabel || 'Open'}</button>
                    </div>
                    <button class="remove-ads-btn">Remove Ads</button>
                </div>
            `;
        }
    }).join('');
    if (state.activeSwiper) state.activeSwiper.destroy(true, true);
    state.activeSwiper = new Swiper('#swiper', {
        direction: 'vertical',
        mousewheel: true,
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
}

export async function loadMoreImages(preservePosition = false) {
    if (state.isLoadingMore || !state.hasMoreImages) return;
    let previousIndex = null;
    if (preservePosition && state.activeSwiper) previousIndex = state.activeSwiper.activeIndex;
    const newImages = await fetchRandomImages(state.currentCategory, state.activeSearchQuery);
    if (newImages.length === 0) {
        state.hasMoreImages = false;
        return;
    }
    state.allImages.push(...newImages);
    const slides = buildSlides(state.allImages, state.isPremiumUser);
    renderSlides(slides);
    if (preservePosition && previousIndex !== null && state.activeSwiper) {
        state.activeSwiper.slideTo(previousIndex, 0);
    }
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
    feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Loading...</h3></div>';
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
