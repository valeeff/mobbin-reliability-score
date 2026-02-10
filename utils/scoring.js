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


function weightedLinearRegressionSlope(x, y, weights, appName) {
    const n = x.length;
    if (n < 2) return 0;

    let sumW = 0, sumWX = 0, sumWY = 0, sumWXY = 0, sumWXX = 0;

    for (let i = 0; i < n; i++) {
        const w = weights[i];
        const xi = x[i];
        const yi = y[i];

        sumW += w;
        sumWX += w * xi;
        sumWY += w * yi;
        sumWXY += w * xi * yi;
        sumWXX += w * xi * xi;
    }

    // Weighted means
    const xBar = sumWX / sumW;
    const yBar = sumWY / sumW;

    // Slope formula:
    // b = Sum(w * (x - xBar) * (y - yBar)) / Sum(w * (x - xBar)^2)
    // Expanded: (SumWXY - SumW * xBar * yBar) / (SumWXX - SumW * xBar^2)

    // Using expanded form for efficiency:
    const numerator = sumWXY - (sumW * xBar * yBar);
    const denominator = sumWXX - (sumW * xBar * xBar);

    if (Math.abs(denominator) < 1e-9) return 0; // Avoid division by zero

    const slope = numerator / denominator;

    console.log('[Growth - Weighted Regression Stats]', {
        appName,
        n,
        // sumW,
        // xBar,
        // yBar,
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
    - android link: ${androidLinkVal}
    - genre: ${androidData.category || androidData.genre || iosData.category || iosData.genre || 'N/A'}`);


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

    // update the counts with the cumulative sum
    //for (let i = 1; i < counts.length; i++) {
    //    counts[i] += counts[i - 1];
    //}

    // 3. Calculate Weighted Average of Weekly Growth (Absolute Difference)
    // Formula: Sum( (Count[i] - Count[i-1]) * Weight[i] ) / Sum( Weight[i] )
    // Weight[i] = i^0.25 (to give more weight to recent weeks)

    if (counts.length < 2) return 0;

    // 3. Log-Linear Regression
    // y_t = ln(reviews_t + 1)
    // y = a + b*t

    if (counts.length < 2) return 0;

    const x = [];
    const y = [];
    console.log(`[Growth - Log-Linear Regression Data]`);

    const weights = [];
    for (let i = 0; i < counts.length; i++) {
        const val = Math.log(counts[i] + 1);
        // Weight calculation: recent weeks matter more
        // We use (i+1) because i starts at 0, and we don't want 0 weight for the first week if i=0
        // Or keep your exact formula if week indices are large enough.
        // Your formula was: Math.pow(i / 4, 0.25).
        // Let's use Math.pow((i + 1) / 4, 0.25) to avoid 0 weight at start if desired, 
        // OR adhere strictly to previous logic. Previous logic started loop at i=1 so index was >= 1.
        // Current loop starts at 0. Let's maximize consistency: use (i+1).
        const weekNum = i + 1;
        const w = Math.pow(weekNum / 4, 0.25);

        x.push(i);
        y.push(val);
        weights.push(w);
        console.log(`[Week ${i}] Reviews: ${counts[i]}, Log(Reviews+1): ${val.toFixed(4)}, Weight: ${w.toFixed(4)}`);
    }

    const slope = weightedLinearRegressionSlope(x, y, weights, appName);

    // [User Request] Log for each app
    const newestStr = new Date(maxTime).toISOString().split('T')[0];
    const oldestStr = new Date(minTime).toISOString().split('T')[0];
    // We log "weeks" now instead of days for clarity, or keep days window notation
    const daysWindow = Math.floor((maxTime - minTime) / dayMs);

    console.log(`[Growth Metric Log] App: "${appName}"
    - Reviews Used (Last 365d): ${dates.length}
    - Time Window: ${daysWindow} days (${oldestStr} to ${newestStr})
    - Data Points (Weeks): ${counts.length}
    - Final Growth Score (Log-Linear Regression Slope): ${slope.toFixed(5)}`);

    return slope;
}




// ==========================================
// 3. RELIABILITY SCORE
// ==========================================

// ==============================
// FinalScore from Downloads+Growth (floats 1..5)
// Uses bilinear interpolation on your table
// ==============================

// Helper for linear interpolation
function lerp(val, x0, y0, x1, y1) {
    return y0 + (val - x0) * (y1 - y0) / (x1 - x0);
}

// From downloads to Downloads Score (continuous 1.0-5.0)
function downloadsToScore(totalDownloads) {
    const d = Number(totalDownloads) || 0;

    if (d >= 5000000) return 5;
    if (d >= 1000000) return lerp(d, 1000000, 4, 5000000, 5);
    if (d >= 200000) return lerp(d, 200000, 3, 1000000, 4);
    if (d >= 50000) return lerp(d, 50000, 2, 200000, 3);

    // Scale 0 to 50k -> 1 to 2
    return lerp(d, 0, 1, 50000, 2);
}

// From slope to Growth Score (continuous 1.0-5.0)
function slopeToGrowthScore(slope) {
    // slope is log1p(count) per week
    // Previously: >0.06=5, >0.03=4, >0.01=3, >-0.01=2, else 1
    // We map these thresholds to integer scores and interpolate between them.
    // We strictly anchor the lower bound for score 1 at -0.03 (symmetric-ish step)

    if (slope >= 0.06) return 5;
    if (slope >= 0.03) return lerp(slope, 0.03, 4, 0.06, 5);
    if (slope >= 0.01) return lerp(slope, 0.01, 3, 0.03, 4);
    if (slope >= -0.01) return lerp(slope, -0.01, 2, 0.01, 3);

    // Below -0.01
    // Map -0.03 to -0.01 -> 1 to 2
    if (slope <= -0.03) return 1;
    return lerp(slope, -0.03, 1, -0.01, 2);
}

const SCORE_TABLE = {
    1: { 1: 0, 2: 0.5, 3: 1, 4: 2, 5: 3.5 },
    2: { 1: 0.5, 2: 1, 3: 2, 4: 3.5, 5: 4 },
    3: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4.5 },
    4: { 1: 2, 2: 3, 3: 3.5, 4: 4, 5: 5 },
    5: { 1: 2, 2: 3.5, 3: 4, 4: 4.5, 5: 5 }
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

    // Round to 1 decimal place
    const finalScore = Number(mappedScore.toFixed(1));

    let grade = 'Low';
    if (finalScore >= 9.0) grade = 'Elite';
    else if (finalScore >= 7.5) grade = 'High';
    else if (finalScore >= 5.0) grade = 'Medium';

    console.log(`[Reliability Score Log] App: "${appName}"
    - Downloads: ${totalDownloads} (Score: ${dScore.toFixed(2)})
    - Growth Slope: ${growthSlope === null ? 'N/A' : growthSlope.toFixed(5)} (Score: ${gScore === null ? 'N/A' : gScore.toFixed(2)})
    - Matrix Score (0-5): ${matrixScore.toFixed(2)}
    - Mapped Score (2-10): ${mappedScore.toFixed(2)} -> Snapped: ${finalScore}
    - Grading: ${grade}`);

    return {
        score: finalScore,
        grade: grade,
        dScore: dScore,
        gScore: gScore
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
