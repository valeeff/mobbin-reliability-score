// ==========================================
// 1. TOTAL DOWNLOADS CALCULATOR
// ==========================================

// Base multipliers (used for Android at 1.0x, iOS at 0.75x)
const BASE_MULTIPLIERS = {
    // Low stakes - Entertainment/Leisure (70-140)
    'Game': 70,
    'Entertainment': 85,
    'Social Networking': 100,
    'Music & Audio': 110,
    'Sports': 115,
    'Photo & Video': 125,
    'Lifestyle': 140,

    // Medium stakes - Transactional/General (160-230)
    'Shopping': 160,
    'Travel': 170,
    'Food & Drink': 170,
    'Education': 200,
    'Reference': 200,
    'Collaboration': 230,
    'Graphics & Design': 220,

    // High stakes - Professional/Business (190-330)
    'Communication': 200,
    'Productivity': 240,
    'Business': 260,
    'Developer Tools': 300,
    'Jobs & Recruitment': 260,
    'Maps & Navigation': 210,
    'AI': 190,
    'CRM': 330,
    'Real Estate': 260,

    // Very high stakes - Financial/Safety-critical (190-380)
    'Utilities': 230,
    'Finance': 230,
    'News': 190,
    'Crypto & Web3': 320,
    'Medical': 380,
    'Health': 340
};

// Store-specific defaults
const DEFAULT_IOS = 150;
const DEFAULT_ANDROID = 220;

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
    const finalAndroid = Math.max(aEstimate, aFloor);

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

function linearRegressionSlope(x, y) {
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
    return (n * sumXY - sumX * sumY) / denom;
}

function computeGrowthSlope(reviewDates) {
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

    return linearRegressionSlope(x, yLog);
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

function calculateGrowthMetrics(reviewDates) {
    return computeGrowthSlope(reviewDates);
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
