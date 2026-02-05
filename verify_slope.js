const { computeGrowthSlope } = require('./utils/scoring.js');

function testSlope(name, dates) {
    const slope = computeGrowthSlope(dates, name);
    console.log(`\nTest: ${name}`);
    console.log(`Slope: ${slope}`);
    return slope;
}

const dayMs = 86400000;
const today = Date.now();

// 1. Concentrated Late (Acceleration)
// 1 review 30 days ago, then 5 reviews yesterday
const lateDates = [
    new Date(today - 30 * dayMs).toISOString(),
    new Date(today - 1 * dayMs).toISOString(),
    new Date(today - 1 * dayMs).toISOString(),
    new Date(today - 1 * dayMs).toISOString(),
    new Date(today - 1 * dayMs).toISOString(),
    new Date(today - 1 * dayMs).toISOString()
];

// 2. Concentrated Early (Deceleration)
// 5 reviews 30 days ago, then 1 review yesterday
const earlyDates = [
    new Date(today - 30 * dayMs).toISOString(),
    new Date(today - 30 * dayMs).toISOString(),
    new Date(today - 30 * dayMs).toISOString(),
    new Date(today - 30 * dayMs).toISOString(),
    new Date(today - 30 * dayMs).toISOString(),
    new Date(today - 1 * dayMs).toISOString()
];

// 3. Evenly Spread (Steady)
// 1 review every 5 days for 30 days
const steadyDates = [];
for (let i = 30; i >= 0; i -= 5) {
    steadyDates.push(new Date(today - i * dayMs).toISOString());
}

// 4. Verification Check
const slopeLate = testSlope('Concentrated Late (Should be Positive)', lateDates);
const slopeEarly = testSlope('Concentrated Early (Should be Negative)', earlyDates);
const slopeSteady = testSlope('Evenly Spread (Should be ~0)', steadyDates);

if (slopeLate > 0.01) console.log("✅ Late concentration is Positive");
else console.error("❌ Late is not positive enough");

if (slopeEarly < -0.01) console.log("✅ Early concentration is Negative");
else console.error("❌ Early is not negative enough");

if (Math.abs(slopeSteady) < 0.01) console.log("✅ Steady is approximately Zero");
else console.error("❌ Steady is not close to zero");
