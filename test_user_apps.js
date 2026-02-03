
const https = require('https');

async function fetchPage(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', (err) => reject(err));
    });
}

async function testApp(appName) {
    console.log(`\n--- Testing App: "${appName}" ---`);
    const searchUrl = `https://play.google.com/store/search?q=${encodeURIComponent(appName)}&c=apps`;

    try {
        const searchHtml = await fetchPage(searchUrl);
        const candidates = new Set();
        const idRegex = /\/store\/apps\/details\?id=([a-zA-Z0-9_.]+)/g;
        let match;
        while ((match = idRegex.exec(searchHtml)) !== null) {
            if (candidates.size >= 5) break;
            candidates.add(match[1]);
        }

        if (candidates.size === 0) {
            console.log('Result: No candidates found.');
            return;
        }

        console.log(`Found candidates:`, [...candidates]);

        for (const appId of candidates) {
            const detailsUrl = `https://play.google.com/store/apps/details?id=${appId}&hl=en_US&gl=US`;
            const detailsHtml = await fetchPage(detailsUrl);

            if (!detailsHtml) {
                console.log(`[${appId}] Failed to fetch details.`);
                continue;
            }

            const ogTitleMatch = detailsHtml.match(/<meta property="og:title" content="([^"]+)">/);
            const rawOgTitle = ogTitleMatch ? ogTitleMatch[1] : 'NOT FOUND';
            const cleanedTitle = rawOgTitle.replace(/ [–-] (Android )?Apps on Google Play.*/i, '').trim();

            console.log(`[${appId}]`);
            console.log(`  Raw og:title: "${rawOgTitle}"`);
            console.log(`  Cleaned Title: "${cleanedTitle}"`);

            // Check if it matches our logic
            const s = appName.toLowerCase().trim();
            const a = cleanedTitle.toLowerCase().trim();
            if (a === s || a.includes(s)) {
                console.log(`  >> MATCH FOUND! <<`);
                // We stop at the first match like the real code does
                return;
            }
        }
        console.log('Result: No suitable match found among these candidates.');

    } catch (e) {
        console.error('Error:', e.message);
    }
}

async function main() {
    const apps = ['Orbit', 'Splitwise', 'Hers'];
    for (const app of apps) {
        await testApp(app);
    }
}

main();
