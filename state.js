// state.js
export const state = {
    activeSwiper: null,
    currentCategory: "Discover",
    songPools: {},
    allImages: [],
    sessionSeenUrls: new Set(),
    hasMoreImages: true,
    imagesShownSinceLastAd: 0,
    currentAdIndex: 0,
    isLoadingMore: false,
    isLoadingFeed: false,
    activeSearchQuery: "",
    darkTextEnabled: false,
    isPremiumUser: false,
    paidPremiumActive: false,
    nativeAds: [],
    user: null,
    savedImageIds: new Set(),        // for quick "saved" status
    savedImagesList: [],             // full list for viewer (NEW)
    savedOffset: 0,
    savedHasMore: true,
    loadingSaved: false
};
