const { calculateTotalDownloads } = require('./utils/scoring.js');

const androidData = { ratings: '10,000', genre: 'Finance' };
const iosData = { ratings: '5,000', genre: 'Business' };

console.log('--- Testing Genre Fallback ---');

// Case 1: Mobbin Genre is present
const res1 = calculateTotalDownloads(androidData, iosData, 'Finance');
console.log('Case 1 (Mobbin Genre present):', res1.used_genre);

// Case 2: Mobbin Genre is missing
const res2 = calculateTotalDownloads(androidData, iosData, null);
console.log('Case 2 (Mobbin Genre missing):', res2.used_genre);

// Case 3: Only Android Genre
const res3 = calculateTotalDownloads(androidData, { ratings: 0 }, null);
console.log('Case 3 (Only Android Genre):', res3.used_genre);

// Case 4: No Genres found at all
const res4 = calculateTotalDownloads({ ratings: 0 }, { ratings: 0 }, null);
console.log('Case 4 (No Genres):', res4.used_genre);
