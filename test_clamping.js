const { calculateTotalDownloads } = require('./utils/scoring');

// Mock Data
const testCases = [
    {
        name: "Case 1: Below Min (Should Clamp Up)",
        android: { ratings: 100, min_installs: 1000000, genre: "Finance" }, // Est: ~23k. Min: 1M. Expect: 1M
        ios: {},
        description: "Est < Min"
    },
    {
        name: "Case 2: Above Max (Should Clamp Down)",
        android: { ratings: 50000, min_installs: 1000000, genre: "Finance" }, // Est: ~11.5M. Min: 1M, Next Tier: 5M. Expect: 4,999,000
        ios: {},
        description: "Est > Max"
    },
    {
        name: "Case 3: In Range (Should Keep Estimate)",
        android: { ratings: 10000, min_installs: 1000000, genre: "Finance" }, // Est: ~2.3M. Min: 1M, Next Tier: 5M. Expect: ~2.3M
        ios: {},
        description: "Min < Est < Max"
    },
    {
        name: "Case 4: Top Tier (No Max Clamp)",
        android: { ratings: 10000000, min_installs: 1000000000, genre: "Finance" }, // Min: 1B. Max: Infinity. Est: 2.3B. Expect: 2.3B
        ios: {},
        description: "Top Tier"
    },
    {
        name: "User Edge Case: Huge Overestimation",
        // Raw Est: 300M (requires ratings approx ~1.3M for Finance). Range: 10M - 50M.
        // Let's force ratings to give ~300M. 300,000,000 / 230 = 1,304,347 ratings.
        // Min installs: 10,000,000. Next Tier: 50,000,000.
        // Expectation: Clamp to 50,000,000 - 1,000 = 49,999,000.
        android: { ratings: 1305000, min_installs: 10000000, genre: "Finance" },
        ios: {},
        description: "Raw Est 300M vs Range 10M-50M"
    }
];

testCases.forEach(test => {
    const result = calculateTotalDownloads(test.android, test.ios, null);
    console.log(`\n--- ${test.name} ---`);
    console.log(`Input Ratings: ${test.android.ratings.toLocaleString()}`);
    console.log(`Min Installs: ${test.android.min_installs.toLocaleString()}`);
    console.log(`Raw Estimate (approx): ${(test.android.ratings * 230).toLocaleString()}`);
    console.log(`Result Android: ${result.android.toLocaleString()}`);
    console.log(`Desc: ${test.description}`);
});
