// ==========================================
// 1. TOTAL DOWNLOADS CALCULATOR
// ==========================================

// Base multipliers (used for Android at 1.0x, iOS at 0.75x)
const BASE_MULTIPLIERS = {
    // Low stakes - Entertainment/Leisure (40–105)
    'Game': 60,              // avg(40–80)
    'Entertainment': 68,     // avg(45–90)
    'Social Networking': 75,// avg(50–100)
    'Music & Audio': 75,    // avg(50–100)
    'Sports': 70,           // close to Lifestyle band
    'Photo & Video': 75,    // avg(50–100)
    'Lifestyle': 80,        // avg(55–105)

    // Medium stakes - Transactional/General (50–105)
    'Shopping': 70,         // avg(50–90)
    'Travel': 72,           // avg(50–95)
    'Food & Drink': 72,     // avg(50–95)
    'Education': 80,        // avg(55–105)
    'Reference': 80,        // avg(55–105)
    'Collaboration': 80,    // avg(55–105)
    'Graphics & Design': 80,// avg(55–105)

    // High stakes - Professional/Business (55–125)
    'Communication': 80,    // avg(55–105)
    'Productivity': 85,     // avg(60–110)
    'Business': 88,         // avg(60–115)
    'Developer Tools': 90,  // avg(60–120)
    'Jobs & Recruitment': 88,// avg(60–115)
    'Maps & Navigation': 78,// avg(55–100)
    'AI': 90,               // avg(60–120)
    'CRM': 95,              // avg(65–125)
    'Real Estate': 88,      // avg(60–115)

    // Very high stakes - Financial/Safety-critical (55–150)
    'Utilities': 78,        // avg(55–100)
    'Finance': 90,          // avg(60–120)
    'News': 78,             // avg(55–100)
    'Crypto & Web3': 98,    // avg(65–130)
    'Medical': 105,         // avg(70–140)
    'Health': 113           // avg(75–150)
};

// Store-specific defaults
const DEFAULT_IOS = 15;
const DEFAULT_ANDROID = 22;

// Google Play Store Tiers
const GOOGLE_PLAY_TIERS = [
    100,
    500,
    1000,
    5000,
    10000,
    50000,
    100000,
    500000,
    1000000,
    5000000,
    10000000,
    50000000,
    100000000,
    500000000,
    1000000000
];

function getNextTier(minInstalls) {
    if (!minInstalls) return Infinity;
    // Find the current tier index
    // We assume minInstalls is exactly one of the tiers or slightly higher (rare)
    // We want the strictly next tier.
    for (const tier of GOOGLE_PLAY_TIERS) {
        if (tier > minInstalls) return tier;
    }
    return Infinity; // Already at top tier
}

function cleanNum(value) {
    if (!value) return 0;
    if (typeof value === 'number') return Math.floor(value);

    let s = String(value).toLowerCase().trim();
    s = s.replace(/,/g, '').replace(/\+/g, '').replace(/>/g, '').replace(/</g, '');

    if (s.includes('m')) {
        return Math.floor(parseFloat(s.replace('m', '')) * 1000000);
    }
    if (s.includes('k')) {
        return Math.floor(parseFloat(s.replace('k', '')) * 1000);
    }

    const parsed = parseFloat(s);
    return isNaN(parsed) ? 0 : Math.floor(parsed);
}

/**
 * Get store-specific multiplier for a genre
 * @param {string} genreStr - The genre string
 * @param {string} store - 'ios' or 'android' (default: 'android')
 * @returns {number} - The store-adjusted multiplier
 */
function getMultiplier(genreStr, store = 'android') {
    const isIOS = store.toLowerCase() === 'ios';
    const storeScale = isIOS ? 0.75 : 1.0;
    const defaultValue = isIOS ? DEFAULT_IOS : DEFAULT_ANDROID;

    if (!genreStr) return defaultValue;

    const lowerGenre = String(genreStr).toLowerCase();

    for (const key in BASE_MULTIPLIERS) {
        if (lowerGenre.includes(key.toLowerCase())) {
            return Math.round(BASE_MULTIPLIERS[key] * storeScale);
        }
    }
    return defaultValue;
}

function calculateTotalDownloads(androidData, iosData, mobbinGenre) {
    androidData = androidData || {};
    iosData = iosData || {};

    // Determine the genre to use for multipliers
    let finalUsedGenre = mobbinGenre || 'N/A';

    // Android
    const aRatings = cleanNum(androidData.ratings);
    const aFloor = cleanNum(androidData.min_installs);
    const aGenre = androidData.genre || '';



    // iOS
    const iRatings = cleanNum(iosData.ratings);
    const iGenre = iosData.genre || '';



    // Fallback if mobbinGenre is missing
    if (!mobbinGenre) {
        if (aGenre && iGenre) {
            finalUsedGenre = `${aGenre}/${iGenre} (Store Fallback)`;
        } else if (aGenre || iGenre) {
            finalUsedGenre = `${aGenre || iGenre} (Store Fallback)`;
        }
    }


    // Use store-specific multipliers
    // Android: base * 1.0, iOS: base * 0.75
    const genreForMultiplier = mobbinGenre || aGenre || iGenre;

    const aMult = getMultiplier(genreForMultiplier, 'android');
    const aEstimate = aRatings * aMult;

    // Android Clamping Logic
    // 1. Min: The badge value (aFloor)
    // 2. Max: The start of the next tier
    const aNextTier = getNextTier(aFloor);

    let finalAndroid = aEstimate;

    // Rule 1: If Estimation < Min -> use Min
    if (finalAndroid < aFloor) {
        finalAndroid = aFloor;
    }
    // Rule 2: If Estimation >= Max -> use Max - 1,000
    // (Ensure we don't go below aFloor if the range is weirdly tight, though 1k gap is safe for all >1k tiers)
    else if (aNextTier !== Infinity && finalAndroid >= aNextTier) {
        const capped = aNextTier - 1000;
        finalAndroid = Math.max(aFloor, capped);
    }

    const iMult = getMultiplier(genreForMultiplier, 'ios');
    const finalIOS = iRatings * iMult;

    return {
        total: Math.floor(finalAndroid + finalIOS),
        android: Math.floor(finalAndroid),
        ios: Math.floor(finalIOS),
        used_genre: finalUsedGenre
    };
}

// ==========================================
// 2. GROWTH METRICS 
// ==========================================


function linearRegressionSlope(x, y, appName) {
    const n = x.length;
    if (n < 2) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
        sumXY += x[i] * y[i];
        sumXX += x[i] * x[i];
    }
    const denom = (n * sumXX - sumX * sumX);
    if (denom === 0) return 0;

    const slope = (n * sumXY - sumX * sumY) / denom;
    console.log('[Growth]', {
        appName,
        n,
        sumX,
        sumY,
        sumXY,
        sumXX,
        slope
    });
    return slope;
}

function computeGrowthSlope(reviewDates, appName, androidData = {}, iosData = {}) {
    const iosVal = iosData.ratings || 'N/A';
    const iosLinkVal = iosData.appStoreUrl || (iosData.appId ? `https://apps.apple.com/app/id${iosData.appId}` : 'N/A');
    const androidVal = androidData.ratings || 'N/A';
    const androidLinkVal = androidData.appId ? `https://play.google.com/store/apps/details?id=${androidData.appId}` : 'N/A';

    console.log(`[Basic Info Log] App: "${appName}"
    - ios: ${iosVal}
    - ios link: ${iosLinkVal}
    - android: ${androidVal}
    - android link: ${androidLinkVal}`);

    if (!Array.isArray(reviewDates) || reviewDates.length === 0) {
        console.log(`[Growth Metric Log] App: "${appName}"
    - Reviews Used (Last 365d): 0
    - Time Window: 0 days
    - Data Points (Weeks): 0
    - Final Growth Score (Weekly Log Trend): N/A`);
        return null;
    }

    let dates = reviewDates
        .map(d => new Date(d))
        .filter(d => !isNaN(d.getTime()))
        .sort((a, b) => a - b);

    if (dates.length === 0) return null;

    // 1. Cap to most recent 365 days (relative to the newest review)
    const maxTime = dates[dates.length - 1].getTime();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    const minTime = maxTime - oneYearMs;

    dates = dates.filter(d => d.getTime() >= minTime);

    if (dates.length === 0) return null; // Should not happen given logic above, but safe guard

    // 2. Weekly bins (Aggregated 7-day periods to reduce daily noise)
    const dayMs = 86400000;
    const weekMs = dayMs * 7;

    // We align bins relative to the FIRST review date in the window (dates[0])
    // This ensures we measure trends only during the app's active history (within the last year)
    // rather than punishing it for unrelated silence 10 months ago.
    const startWeekEpoch = Math.floor(dates[0].getTime() / weekMs);
    const bins = new Map();

    for (const d of dates) {
        const currentWeekEpoch = Math.floor(d.getTime() / weekMs);
        const weekIndex = currentWeekEpoch - startWeekEpoch;
        if (weekIndex >= 0) { // Safety check
            bins.set(weekIndex, (bins.get(weekIndex) || 0) + 1);
        }
    }

    // Determine the range of weeks from First Review to Last Review
    const maxWeekIndex = Math.floor(dates[dates.length - 1].getTime() / weekMs) - startWeekEpoch;

    const counts = [];
    // Fill weeks from 0 to maxWeekIndex
    for (let w = 0; w <= maxWeekIndex; w++) {
        counts.push(bins.get(w) || 0);
    }

    // Regression: x = week index (0, 1, 2...), y = log(1 + weekly_count)
    // No need to divide i by 7 here, as 'i' IS the week number.
    const x = counts.map((_, i) => i);
    const yLog = counts.map(c => Math.log1p(c));

    // Calculate Slope
    const slope = linearRegressionSlope(x, yLog, appName);

    // [User Request] Log for each app
    const newestStr = new Date(maxTime).toISOString().split('T')[0];
    const oldestStr = new Date(minTime).toISOString().split('T')[0];
    // We log "weeks" now instead of days for clarity, or keep days window notation
    const daysWindow = Math.floor((maxTime - minTime) / dayMs);

    console.log(`[Growth Metric Log] App: "${appName}"
    - Reviews Used (Last 365d): ${dates.length}
    - Time Window: ${daysWindow} days (${oldestStr} to ${newestStr})
    - Data Points (Weeks): ${counts.length}
    - Final Growth Score (Weekly Log Trend): ${slope.toFixed(5)}`);

    return slope;
}




// ==========================================
// 3. RELIABILITY SCORE
// ==========================================

// ==============================
// FinalScore from Downloads+Growth (floats 1..5)
// Uses bilinear interpolation on your table
// ==============================

// From downloads to Downloads Score (1-5)
function downloadsToScore(totalDownloads) {
    const d = Number(totalDownloads) || 0;

    if (d >= 5000000) return 5;
    if (d >= 1000000) return 4;
    if (d >= 200000) return 3;
    if (d >= 50000) return 2;
    return 1;
}

//From slope to Growth Score (1-5)
function slopeToGrowthScore(slope) {
    // slope is log1p(count) per week
    if (slope > 0.06) return 5;
    if (slope > 0.03) return 4;
    if (slope > 0.01) return 3;
    if (slope > -0.01) return 2;
    return 1;
}

const SCORE_TABLE = {
    1: { 1: 0, 2: 0.5, 3: 1, 4: 2, 5: 3.5 },
    2: { 1: 0.5, 2: 1, 3: 2, 4: 3.5, 5: 4.5 },
    3: { 1: 1, 2: 2, 3: 3.5, 4: 4.5, 5: 5 },
    4: { 1: 2.5, 2: 3.5, 3: 4.5, 4: 5, 5: 5 },
    5: { 1: 3.5, 2: 4, 3: 4.5, 4: 5, 5: 5 }
};

function clamp(v, min = 1, max = 5) {
    return Math.max(min, Math.min(max, v));
}

// getFinalScore implementation matches expectation

// Call: getFinalScore(downloads, growth)
function getFinalScore(downloads, growth) {
    downloads = clamp(Number(downloads));
    growth = clamp(Number(growth));

    const d1 = Math.floor(downloads);
    const d2 = Math.ceil(downloads);
    const g1 = Math.floor(growth);
    const g2 = Math.ceil(growth);

    // Exact integer match
    if (d1 === d2 && g1 === g2) return SCORE_TABLE[d1][g1];

    // Corner values from the table
    const Q11 = SCORE_TABLE[d1][g1];
    const Q21 = SCORE_TABLE[d2][g1];
    const Q12 = SCORE_TABLE[d1][g2];
    const Q22 = SCORE_TABLE[d2][g2];

    // Position within the cell (0..1)
    const xd = (d2 === d1) ? 0 : (downloads - d1) / (d2 - d1);
    const yd = (g2 === g1) ? 0 : (growth - g1) / (g2 - g1);

    // Interpolate left->right on bottom and top edges
    const R1 = Q11 * (1 - xd) + Q21 * xd;
    const R2 = Q12 * (1 - xd) + Q22 * xd;

    // Interpolate bottom->top between those two
    const result = R1 * (1 - yd) + R2 * yd;

    // Return exact interpolated value (0.0 to 5.0) for downstream mapping
    return result;
}



// ==========================================
// 4. PUBLIC API ADAPTERS
// ==========================================

function calculateGrowthMetrics(reviewDates, appName, androidData, iosData) {
    return computeGrowthSlope(reviewDates, appName, androidData, iosData);
}

function calculateReliabilityScore(totalDownloads, growthSlope, appName = 'Unknown') {
    const dScore = downloadsToScore(totalDownloads);
    let matrixScore;
    let gScore = null;

    if (growthSlope === null) {
        // No growth data (e.g. Android only) -> use pure downloads score
        // We use dScore (1-5) directly as base quality score
        matrixScore = dScore;
    } else {
        gScore = slopeToGrowthScore(growthSlope);
        matrixScore = getFinalScore(dScore, gScore); // 0.0 to 5.0 (interpolated)
    }

    // Map 0-5 Matrix Score to 2-10 Final Score
    // Formula: Final = 2 + (Matrix * 1.6)
    // Range 0->2.0, 5->10.0
    const mappedScore = 2 + (matrixScore * 1.6);

    // Snap to nearest 0.5
    const finalScore = Math.round(mappedScore * 2) / 2;

    let grade = 'Low';
    if (finalScore >= 9.0) grade = 'Elite';
    else if (finalScore >= 7.5) grade = 'High';
    else if (finalScore >= 5.0) grade = 'Medium';

    console.log(`[Reliability Score Log] App: "${appName}"
    - Downloads: ${totalDownloads} (Score: ${dScore})
    - Growth Slope: ${growthSlope === null ? 'N/A' : growthSlope.toFixed(5)} (Score: ${gScore === null ? 'N/A' : gScore})
    - Matrix Score (0-5): ${matrixScore.toFixed(2)}
    - Mapped Score (2-10): ${mappedScore.toFixed(2)} -> Snapped: ${finalScore}
    - Grading: ${grade}`);

    return {
        score: finalScore,
        grade: grade
    };
}

// Export for Node.js environment (tests)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateTotalDownloads,
        calculateGrowthMetrics,
        calculateReliabilityScore,
        computeGrowthSlope,
        downloadsToScore,
        slopeToGrowthScore,
        getFinalScore
    };
}
