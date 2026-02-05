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

function computeGrowthSlope(reviewDates, appName) {
    if (!Array.isArray(reviewDates) || reviewDates.length < 15) return 0;

    const dates = reviewDates
        .map(d => new Date(d))
        .filter(d => !isNaN(d.getTime()))
        .sort((a, b) => a - b);

    if (dates.length < 15) return 0;

    // Weekly bins: key = week index since first review
    const start = dates[0];
    const bins = new Map();
    for (const d of dates) {
        const week = Math.floor((d - start) / (1000 * 60 * 60 * 24 * 7));
        bins.set(week, (bins.get(week) || 0) + 1);
    }

    // Build ordered, dense series (fill missing weeks with 0)
    const weeks = Array.from(bins.keys()).sort((a, b) => a - b);
    const minW = weeks[0];
    const maxW = weeks[weeks.length - 1];

    let counts = [];
    for (let w = minW; w <= maxW; w++) counts.push(bins.get(w) || 0);

    // Drop launch + partial last week if enough history
    if (counts.length >= 6) counts = counts.slice(1, -1);

    // Focus on recent momentum (last 12 full weeks)
    const WINDOW = 12;
    if (counts.length > WINDOW) counts = counts.slice(-WINDOW);

    if (counts.length < 4) return 0;

    const x = counts.map((_, i) => i);
    const yLog = counts.map(c => Math.log1p(c));

    return linearRegressionSlope(x, yLog, appName);
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

    // Optional: snap to nearest 0.5 like your table style
    return Math.round(result * 2) / 2;
}



// ==========================================
// 4. PUBLIC API ADAPTERS
// ==========================================

function calculateGrowthMetrics(reviewDates, appName) {
    return computeGrowthSlope(reviewDates, appName);
}

function calculateReliabilityScore(totalDownloads, growthSlope) {
    const dScore = downloadsToScore(totalDownloads);
    const gScore = slopeToGrowthScore(growthSlope);
    const finalRaw = getFinalScore(dScore, gScore); // 0 to 5

    const score100 = Math.round(finalRaw * 20);

    let grade = 'Low';
    if (score100 >= 90) grade = 'Elite';
    else if (score100 >= 70) grade = 'High';
    else if (score100 >= 40) grade = 'Medium';

    return {
        score: score100,
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
