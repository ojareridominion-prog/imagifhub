export const nativeAds = [
    {
        id: "premium",
        image: "ads/premium.png",
        title: "Go Premium",
        subtitle: "Remove all ads",
        buttonLabel: "Upgrade",
        action: () => openPremium()
    },
    {
        id: "Temu",
        image: "ads/temu.png",
        title: "Temu",
        subtitle: "legitimate online marketplace",
        buttonLabel: "Shop Now",
        action: () => {
            window.open("https://temu.to/k/e3zj4ye9770", "_blank")
        }
    },
    {
        id: "Stake.com",
        image: "ads/stake.png",
        title: "Sponsored",
        subtitle: "The Global Giant of Crypto Gambling",
        buttonLabel: "Play Now",
        action: () => {
            window.open("https://stake.com/?c=hcYKazFc", "_blank")
        }
    },
    {
        id: "bitoshi africa",
        image: "ads/bitoshi.png",
        title: "Sponsored",
        subtitle: "swap, buy, sell, send and receive crypto with bitoshi africa",
        buttonLabel: "Trade Crypto",
        action: () => {
            window.open("https://bitoshi.africa/ref?username=ojareri", "_blank")
        }
    },
    {
        id: "gemgala",
        image: "ads/gemgala.png",
        title: "Sponsored",
        subtitle: "play games, chat and earn",
        buttonLabel: "Play Games",
        action: () => {
            window.open("https://getblock.me/u/24239713", "_blank")
        }
    },
    {
        id: "telegramchannel",
        image: "ads/channel.png",
        title: "Sponsored",
        subtitle: "join our telegram channel",
        buttonLabel: "Join",
        action: () => {
            window.open("https://t.me/imagifhub", "_blank")
        }
    },
    
    // Add more ads here
];
