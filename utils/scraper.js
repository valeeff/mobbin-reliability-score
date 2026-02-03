/**
 * Data Fetching / Scraping Logic
 * Fetches data from Google Play Store and Apple App Store
 */

// Helper to fetch text content
async function fetchPage(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');
        return await response.text();
    } catch (error) {
        console.error('Error fetching page:', url, error);
        return null;
    }
}

// ==========================================
// GOOGLE PLAY SCRAPER
// ==========================================

async function fetchAndroidData(appName) {
    // Search for the app to get the ID
    // Note: This matches the first result.
    const searchUrl = `https://play.google.com/store/search?q=${encodeURIComponent(appName)}&c=apps`;
    const searchHtml = await fetchPage(searchUrl);

    if (!searchHtml) return { error: 'Failed to search Play Store' };

    // Crude regex to find the first app link "/store/apps/details?id=..."
    // This is fragile and depends on Play Store DOM structure.
    const appLinkMatch = searchHtml.match(/\/store\/apps\/details\?id=([a-zA-Z0-9_.]+)/);
    if (!appLinkMatch) return { error: 'App not found on Play Store' };

    const appId = appLinkMatch[1];
    const detailsUrl = `https://play.google.com/store/apps/details?id=${appId}&hl=en_US&gl=US`;
    const detailsHtml = await fetchPage(detailsUrl);

    if (!detailsHtml) return { error: 'Failed to fetch details page' };

    // Parse Data
    // Ratings: Look for aria-label or specific classes. This is highly unstable.
    // We'll try a few common patterns or just return mocks if scraping fails for this demo.

    // Example patterns (subject to change by Google):
    // Min Installs: "100,000+" -> often in a div with "Downloads"
    // Genre: Breadcrumbs or specific category links

    // For robustness in this prompt-based coding, I'll use regex to look for patterns near keys.

    // Min Downloads
    // Pattern: "100,000+" followed by "Downloads"
    let minInstalls = 0;
    const downloadsMatch = detailsHtml.match(/([0-9,]+)\+/);
    // This is too broad, let's look for specific json data often embedded in scripts or specific UI text.
    // Actually, for this demo, let's look for the text "Downloads" and grab the number before it?
    // "1B+ Downloads" or similar.
    const downloadsTextMatch = detailsHtml.match(/([0-9,.]+[MkK]?)\+\s*Downloads/i) || detailsHtml.match(/([0-9,.]+[MkK]?)\+\s*downloads/);
    if (downloadsTextMatch) {
        minInstalls = downloadsTextMatch[1]; // Will be cleaned by cleanNum
    }

    // Ratings Count
    // "2.5M reviews"
    let ratings = 0;
    const reviewsMatch = detailsHtml.match(/([0-9,.]+[MkK]?)\s+reviews/);
    if (reviewsMatch) {
        ratings = reviewsMatch[1];
    }

    return {
        ratings: ratings,
        min_installs: minInstalls,
        appId: appId
    };
}

// ==========================================
// APPLE APP STORE SCRAPER
// ==========================================

async function fetchIOSData(appName) {
    // Search
    // https://www.google.com/search?q=site:apps.apple.com+appName ??
    // Or direct App Store search if possible? Apple doesn't have a simple GET search url that returns HTML easily parseable without JS sometimes.
    // Let's try searching Google for "site:apps.apple.com/app <appName>"
    // This might be blocked by Google captcha.
    // Alternative: Use an iTunes API! Apple has a public lookup API.
    // https://itunes.apple.com/search?term=yelp&entity=software

    const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(appName)}&entity=software&limit=1`;
    try {
        const response = await fetch(searchUrl);
        const data = await response.json();

        if (data.resultCount === 0) return { error: 'App not found on App Store' };

        const app = data.results[0];

        // Ratings
        const ratings = app.userRatingCount || 0;

        // Reviews Dates for Growth Calculation
        // The iTunes API doesn't give review dates history.
        // We'd need to scrape the RSS feed or the page: https://apps.apple.com/us/app/id...
        // RSS: https://itunes.apple.com/us/rss/customerreviews/id=.../json

        const appId = app.trackId;
        const rssUrl = `https://itunes.apple.com/us/rss/customerreviews/id=${appId}/sortBy=mostRecent/json`;

        let reviewsDates = [];
        try {
            const rssResp = await fetch(rssUrl);
            const rssData = await rssResp.json();
            if (rssData.feed && rssData.feed.entry) {
                // Entry can be array or single object
                const entries = Array.isArray(rssData.feed.entry) ? rssData.feed.entry : [rssData.feed.entry];
                reviewsDates = entries.map(e => e.updated.label); // e.updated.label is date string
            }
        } catch (e) {
            console.warn('Failed to fetch iOS reviews RSS', e);
        }

        return {
            ratings: ratings,
            reviews_dates: reviewsDates,
            appId: appId
        };

    } catch (error) {
        console.error('iOS Fetch Error', error);
        return { error: 'iOS Fetch Failed' };
    }
}
