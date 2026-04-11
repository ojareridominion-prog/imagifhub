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
    nativeAds: []
};
