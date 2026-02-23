// welcome.js - Holiday detection for welcome overlay

/**
 * Returns the appropriate holiday image URL based on current date.
 * Images should be placed in the 'assets' folder with these names.
 * Recommended image size: 1080x1920 pixels (9:16 portrait).
 */
export function getHolidayImage() {
    const today = new Date();
    const month = today.getMonth() + 1; // 1-12
    const day = today.getDate();

    // Christmas: Dec 20 - Dec 26
    if (month === 12 && day >= 20 && day <= 26) {
        return 'assets/welcome-christmas.jpg';
    }
    // New Year: Dec 27 - Jan 2
    if ((month === 12 && day >= 27) || (month === 1 && day <= 2)) {
        return 'assets/welcome-newyear.jpg';
    }
    // Easter: approximate (March 22 - April 25)
    if ((month === 3 && day >= 22) || (month === 4 && day <= 25)) {
        return 'assets/welcome-easter.jpg';
    }
    // Halloween: October 31
    if (month === 10 && day === 31) {
        return 'assets/welcome-halloween.jpg';
    }
    // Fallback default image
    return 'assets/welcome-default.jpg';
}
