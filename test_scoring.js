const { calculateTotalDownloads, calculateGrowthMetrics, calculateReliabilityScore } = require('./utils/scoring.js');

// Mock Data based on the User's python script examples logic
// 1. WhatsApp-like (Massive)
const androidLarge = { ratings: '180,000,000', min_installs: '5,000,000,000+', genre: 'Communication' };
const iosLarge = { ratings: 9000000, genre: 'Social Networking' };
// Communication -> "default" 150? Or closest? Users script had specific keys.
// 'Social' in 'Social Networking' -> 90.

// 2. Small App
const androidSmall = { ratings: 100, min_installs: '10,000+', genre: 'Business' };
const iosSmall = { ratings: 50, genre: 'Business' };

// Test Downloads
console.log('--- Testing Downloads ---');
const dlLarge = calculateTotalDownloads(androidLarge, iosLarge);
console.log(`Large App Downloads: ${dlLarge.total} (Expected: > 5M for max score)`);

// 1.2M case (User requested example)
// We need to fake the inputs to get ~1.2M. Rating * 70? 
// 1.2M / 70 ~ 17k ratings.
const dlMedium = calculateTotalDownloads({ ratings: 17000, genre: 'Game' }, { ratings: 0 }); // ~1.2M
console.log(`Medium App Downloads: ${dlMedium.total} (Target ~1.2M)`);

const dlSmall = calculateTotalDownloads(androidSmall, iosSmall);
console.log(`Small App Downloads: ${dlSmall.total} (Expected: ~10k, Score 0 if < 20k)`);

// Test Growth
console.log('\n--- Testing Growth ---');
// Mock dates for "Growing"
const now = new Date();
const datesGrowing = [];
for (let i = 0; i < 30; i++) {
    // 1 review/day initially, then 5, then 10 (exponential-ish)
    const count = i < 10 ? 1 : i < 20 ? 5 : 20;
    for (let k = 0; k < count; k++) {
        const d = new Date(now);
        d.setDate(d.getDate() - (30 - i));
        datesGrowing.push(d.toISOString());
    }
}
const growthRes = calculateGrowthMetrics(datesGrowing, 'Test App', { category: 'Communication', appId: 'com.test.app' }, { genre: 'Social Networking' });
console.log('Growth Result:', growthRes);

// Test Reliability Score
console.log('\n--- Testing Score ---');
const scoreRes = calculateReliabilityScore(dlLarge.total, growthRes);
console.log('Score Result (Large - >5M):', scoreRes);

const scoreResMedium = calculateReliabilityScore(dlMedium.total, 0.05);
console.log('Score Result (Medium - ~1.2M):', scoreResMedium);

const scoreResSmall = calculateReliabilityScore(dlSmall.total, 0.005);
console.log('Score Result (Small - ~10k):', scoreResSmall);
