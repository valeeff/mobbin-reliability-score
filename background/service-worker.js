// Background Service Worker
// Handles fetching data to bypass CORS restricted content scripts

// Helper to fetch text content
async function fetchPage(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');
        return await response.text();
    } catch (error) {
        console.error('Background: Error fetching page:', url, error);
        return null;
    }
}

// Helper to check if searched name matches actual title robustly
function isMatch(searched, actual) {
    if (!searched || !actual) return false;

    // Normalize both for comparison
    const s = searched.toLowerCase().trim();
    const a = actual.toLowerCase().trim();

    // 1. Exact match (already normalized)
    if (s === a) return true;

    // 2. Prefix match - actual starts with searched (handles "Binance" matching "Binance.US")
    // Check if actual starts with searched followed by a non-letter (like . or space)
    if (a.startsWith(s) && (a.length === s.length || !/[a-z]/.test(a[s.length]))) {
        return true;
    }

    // 3. Rigid "Base Name" match with Inverted Case support
    // Most apps have a title like "Name: Subtitle" or "Name - Subtitle"
    // We split both the searched name and the actual name by common delimiters.
    const delimiters = /\s*[:\-—–|]\s+/;
    const sParts = s.split(delimiters).map(p => p.trim());
    const aParts = a.split(delimiters).map(p => p.trim());

    // Match if the first part of searched name matches any part of actual name
    if (aParts.includes(sParts[0])) return true;

    // OR if the first part of actual name matches any part of searched name
    if (sParts.includes(aParts[0])) return true;

    // 4. Prefix match on first part of actual (handles "Binance" matching "Binance.US: Buy...")
    const firstActualPart = aParts[0];
    if (firstActualPart.startsWith(s) && (firstActualPart.length === s.length || !/[a-z]/.test(firstActualPart[s.length]))) {
        return true;
    }

    return false;
}

// Category mapping: Mobbin category -> [App Store categories, Google Play categories]
const CATEGORY_MAP = {
    'ai': {
        ios: ['developer tools', 'productivity'],
        android: ['tools', 'productivity']
    },
    'business': {
        ios: ['business'],
        android: ['business']
    },
    'collaboration': {
        ios: ['productivity'],
        android: ['productivity', 'communication']
    },
    'communication': {
        ios: ['social networking'],
        android: ['communication']
    },
    'crm': {
        ios: ['business'],
        android: ['business']
    },
    'crypto & web3': {
        ios: ['finance'],
        android: ['finance']
    },
    'developer tools': {
        ios: ['developer tools'],
        android: ['tools']
    },
    'education': {
        ios: ['education'],
        android: ['education', 'libraries & demo']
    },
    'entertainment': {
        ios: ['entertainment'],
        android: ['entertainment', 'events']
    },
    'finance': {
        ios: ['finance'],
        android: ['finance']
    },
    'food & drink': {
        ios: ['food & drink'],
        android: ['food & drink']
    },
    'graphics & design': {
        ios: ['graphics & design'],
        android: ['art & design']
    },
    'health & fitness': {
        ios: ['health & fitness'],
        android: ['health & fitness']
    },
    'jobs & recruitment': {
        ios: ['business'],
        android: ['business']
    },
    'lifestyle': {
        ios: ['lifestyle'],
        android: ['lifestyle', 'beauty', 'dating', 'parenting', 'personalization']
    },
    'medical': {
        ios: ['medical'],
        android: ['medical']
    },
    'music & audio': {
        ios: ['music'],
        android: ['music & audio']
    },
    'maps & navigation': {
        ios: ['navigation'],
        android: ['maps & navigation']
    },
    'news': {
        ios: ['news', 'magazines & newspapers'],
        android: ['news & magazines', 'comics']
    },
    'photo & video': {
        ios: ['photo & video'],
        android: ['photography', 'video players & editors']
    },
    'productivity': {
        ios: ['productivity'],
        android: ['productivity']
    },
    'real estate': {
        ios: ['business'],
        android: ['house & home']
    },
    'reference': {
        ios: ['reference', 'books'],
        android: ['books & reference']
    },
    'shopping': {
        ios: ['shopping'],
        android: ['shopping']
    },
    'social networking': {
        ios: ['social networking'],
        android: ['social']
    },
    'sports': {
        ios: ['sports'],
        android: ['sports']
    },
    'travel & transportation': {
        ios: ['travel'],
        android: ['travel & local', 'auto & vehicles']
    },
    'utilities': {
        ios: ['utilities', 'weather'],
        android: ['tools', 'weather']
    }
};

// Helper to check if categories match using the mapping
// storeType: 'ios' or 'android'
function isCategoryMatch(mobbinCat, storeCat, storeType = 'android') {
    // If Mobbin has no category, we can't filter - allow match
    if (!mobbinCat) return true;

    // If Mobbin has a category but store doesn't, be cautious - reject
    // This prevents matching wrong apps when the store page doesn't have genre info
    if (!storeCat) return false;

    const mobbinKey = mobbinCat.toLowerCase().trim();
    const storeValue = storeCat.toLowerCase().trim();

    // Check if we have a mapping for this Mobbin category
    const mapping = CATEGORY_MAP[mobbinKey];
    if (mapping) {
        const allowedCategories = mapping[storeType] || [];
        // Check if store category matches any allowed category
        for (const allowed of allowedCategories) {
            if (storeValue === allowed || storeValue.includes(allowed) || allowed.includes(storeValue)) {
                return true;
            }
        }
        // If mapping exists but no match found, reject
        return false;
    }

    // Fallback to keyword matching for unmapped categories
    const mWords = mobbinKey.split(/[\s,&/]+/).filter(w => w.length >= 3);
    const sWords = storeValue.split(/[\s,&/]+/).filter(w => w.length >= 3);

    for (const mw of mWords) {
        for (const sw of sWords) {
            // Shared prefix of at least 4 chars (handles Finance / Financial, Game / Games)
            const overlapLen = Math.min(mw.length, sw.length, 4);
            if (mw.substring(0, overlapLen) === sw.substring(0, overlapLen)) return true;
        }
    }

    return false;
}

// Helper to score description/tagline similarity (tiebreaker)
function descriptionScore(mobbinTagline, storeDesc) {
    if (!mobbinTagline || !storeDesc) return 0;

    const stopWords = new Set(['the', 'and', 'for', 'with', 'your', 'app', 'best', 'free', 'new', 'get', 'all']);
    const mobbinWords = mobbinTagline.toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

    if (mobbinWords.length === 0) return 0;

    const storeText = storeDesc.toLowerCase();
    let matches = 0;
    for (const word of mobbinWords) {
        if (storeText.includes(word)) matches++;
    }

    return matches / mobbinWords.length; // 0 to 1
}

// Scraper Logic (Copied from scraper.js but adapted for Service Worker context if needed)
// We'll keep cleanNum as it's needed here? OR just return raw data and let content script parse?
// Better to return raw data or partially parsed.
// Let's implement full parsing here to keep content script light.

// Helper to extract key search terms from tagline
function getTaglineKeywords(tagline, maxWords = 4) {
    if (!tagline) return '';
    const stopWords = new Set(['the', 'and', 'for', 'with', 'your', 'app', 'best', 'free', 'new', 'get', 'all', 'powered', 'based']);
    const words = tagline.toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 2 && !stopWords.has(w));
    return words.slice(0, maxWords).join(' ');
}

// ✅ Google Play Store Search Deep Dive - A. multi apps page
// Helper to score developer name similarity
function developerScore(iosDev, androidDev) {
    if (!iosDev || !androidDev) return 0;

    const s = iosDev.toLowerCase().trim();
    const a = androidDev.toLowerCase().trim();

    // 1. Exact match
    if (s === a) return 1.0;

    // 2. Contains match (e.g. "Google LLC" vs "Google")
    if (s.includes(a) || a.includes(s)) return 1.0;

    // 3. Word match (e.g. "Meta Platforms, Inc." vs "Meta")
    const sWords = s.split(/\W+/).filter(w => w.length > 2);
    const aWords = a.split(/\W+/).filter(w => w.length > 2);

    for (const sw of sWords) {
        if (aWords.includes(sw)) return 0.9;
    }

    return 0; // No match
}

// ✅ Google Play Store Search Deep Dive - A. multi apps page
async function fetchAndroidData(appName, mobbinCategory = null, mobbinTagline = null, iosDeveloper = null) {
    // Helper function to search and collect candidates
    async function searchPlayStore(query) {
        const searchUrl = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps`;
        const searchHtml = await fetchPage(searchUrl);
        if (!searchHtml) return new Set();

        const candidates = new Set();
        const idRegex = /\/store\/apps\/details\?id=([a-zA-Z0-9_.]+)/g;
        let match;
        while ((match = idRegex.exec(searchHtml)) !== null) {
            if (candidates.size >= 5) break;
            candidates.add(match[1]);
        }
        console.log('Android: Found candidates for "' + query + '":', [...candidates]);
        return candidates;
    }

    // Try initial search with just app name
    let candidates = await searchPlayStore(appName);
    console.log(`Android: Found ${candidates.size} candidates for "${appName}":`, [...candidates]);

    // If we have a tagline, also try searching with tagline keywords
    // This helps with generic names like "Craft" where the app doesn't appear in top results
    if (mobbinTagline) {
        const taglineKeywords = getTaglineKeywords(mobbinTagline);
        if (taglineKeywords) {
            const enhancedQuery = `${appName} ${taglineKeywords}`;
            const additionalCandidates = await searchPlayStore(enhancedQuery);
            console.log(`Android: enhanced search "${enhancedQuery}" found ${additionalCandidates.size} additional candidates:`, [...additionalCandidates]);
            for (const c of additionalCandidates) {
                candidates.add(c);
            }
        }
    }

    if (candidates.size === 0) return { error: 'App not found on Play Store' };

    // Collect all valid candidates with their scores
    const validCandidates = [];

    console.log(`Android: total unique candidates to check: ${candidates.size}`, [...candidates]);

    // Iterate through candidates
    for (const appId of candidates) {
        const detailsUrl = `https://play.google.com/store/apps/details?id=${appId}&hl=en_US&gl=US`;
        const detailsHtml = await fetchPage(detailsUrl);

        if (!detailsHtml) continue;

        // Parse embedded JSON metadata (more reliable than HTML meta tags)
        // Extract title from "name":"..." 
        const nameMatch = detailsHtml.match(/"name":"([^"]+)"/);
        const actualTitle = nameMatch ? nameMatch[1] : '';

        console.log(`Android: Checking candidate ${appId} - Title: "${actualTitle}"`);

        if (isMatch(appName, actualTitle)) {
            // Parse Category from JSON "applicationCategory":"MUSIC_AND_AUDIO"
            const categoryMatch = detailsHtml.match(/"applicationCategory":"([^"]+)"/);
            console.log(`Android: Candidate ${appId} - Category: "${categoryMatch ? categoryMatch[1] : 'N/A'}"`);
            // Convert from MUSIC_AND_AUDIO format to "Music & Audio" for matching
            let actualCategory = '';
            if (categoryMatch) {
                actualCategory = categoryMatch[1]
                    .toLowerCase()
                    .replace(/_/g, ' ')           // MUSIC_AND_AUDIO -> music and audio
                    .replace(/\band\b/g, '&')     // music and audio -> music & audio
                    .replace(/\b\w/g, c => c.toUpperCase()); // Music & Audio
            }

            console.log(`Android: Candidate ${appId} Category: "${actualCategory}" (Mobbin: "${mobbinCategory}")`);

            const isCatMatch = isCategoryMatch(mobbinCategory, actualCategory, 'android');
            const categoryScore = isCatMatch ? 1.0 : 0.0;
            console.log(`Android: Candidate ${appId} - Category Check: Mobbin="${mobbinCategory}" vs Android="${actualCategory}" -> Match? ${isCatMatch ? 'YES' : 'NO'} (Score: ${categoryScore})`);

            // Removed strict rejection: if (!isCatMatch) continue;

            // Parse Description from JSON for scoring
            const descMatch = detailsHtml.match(/"description":"([^"]+)"/);
            const storeDescription = descMatch ? descMatch[1].replace(/\\u0027/g, "'") : '';
            const descScore = descriptionScore(mobbinTagline, storeDescription);

            // Parse Developer (Author)
            let actualDeveloper = '';
            const devMatchJson = detailsHtml.match(/"author":\s*{[^}]*?"name":"([^"]+)"/);
            if (devMatchJson) {
                actualDeveloper = devMatchJson[1];
            } else {
                const devLinkMatch = detailsHtml.match(/\/store\/apps\/developer\?id=[^"]+"[^>]*>([^<]+)<\/a>/);
                if (devLinkMatch) {
                    actualDeveloper = devLinkMatch[1];
                }
            }

            console.log(`Android: Candidate ${appId} - Extracted Developer: "${actualDeveloper}"`);

            const devScore = developerScore(iosDeveloper, actualDeveloper);
            console.log(`Android: Candidate ${appId} - Developer Comparison: iOS="${iosDeveloper || 'N/A'}" vs Android="${actualDeveloper}" -> Score: ${devScore}`);

            console.log(`Android: Candidate ${appId} description score: ${descScore.toFixed(2)}, developer: "${actualDeveloper}" (score: ${devScore.toFixed(2)})`);

            // Parse downloads (still from HTML as not in JSON)
            console.log(`Android: Candidate ${appId} - Attempting regex match for downloads...`);
            let minInstalls = 0;

            // Regex strategies (ordered by reliability)
            const downloadPatterns = [
                /([0-9,.]+[MkK]?)\+\s*Downloads/i,      // "10M+ Downloads" (Classic text)
                /([0-9,.]+[MkK]?)\+\s*downloads/i,      // "10M+ downloads" (Lowercase)
                /"([0-9]{1,3}(?:,[0-9]{3})*\+)"/,       // "10,000,000+" (JSON string with commas)
                /"([0-9,.]+[MkB]\+)"/                   // "5B+" or "10M+" (JSON string with suffix)
            ];

            for (const pattern of downloadPatterns) {
                const match = detailsHtml.match(pattern);
                if (match) {
                    minInstalls = match[1];
                    console.log(`Android: Candidate ${appId} - Extracted downloads badge (min tier): "${minInstalls}" using pattern: ${pattern}`);
                    break;
                }
            }

            if (!minInstalls) {
                console.log(`Android: Candidate ${appId} - FAILED to extract downloads badge. No regex matched.`);
            }
            const ratingCountMatch = detailsHtml.match(/"ratingCount":"(\d+)"/);
            if (ratingCountMatch) {
                ratings = parseInt(ratingCountMatch[1], 10);
            }

            validCandidates.push({
                ratings: ratings,
                min_installs: minInstalls,
                appId: appId,
                category: actualCategory,
                title: actualTitle,
                developer: actualDeveloper,
                categoryScore: categoryScore,
                descScore: descScore,
                devScore: devScore,
                // Composite score for sorting: weighted combination
                // (categoryScore * 3.0) + descScore + (devScore * 2.0)
                finalMatchScore: (categoryScore * 3.0) + descScore + (devScore * 2.0)
            });
        }
    }

    // Return best candidate by match score
    if (validCandidates.length > 0) {
        // Sort by finalMatchScore descending
        validCandidates.sort((a, b) => b.finalMatchScore - a.finalMatchScore);
        const best = validCandidates[0];

        // Ensure we have at least SOME match signal
        if (best.finalMatchScore <= 0) {
            console.log(`Android: Best candidate ${best.appId} has score 0.00. REJECTING.`);
        } else {
            console.log(`Android: Selected best candidate: ${best.appId} (Score: ${best.finalMatchScore.toFixed(2)} | Cat: ${best.categoryScore}, Desc: ${best.descScore.toFixed(2)}, Dev: ${best.devScore.toFixed(2)})`);
            return best;
        }
    }

    // If we loop through all and find nothing matching well:
    return { error: 'App not found (No matching candidates)' };
}

async function fetchIOSData(appName, mobbinCategory = null, mobbinTagline = null) {
    const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(appName)}&entity=software&limit=5`;
    try {
        const response = await fetch(searchUrl);
        const data = await response.json();

        if (data.resultCount === 0) return { error: 'App not found on App Store' };

        // Collect valid candidates with scores
        const validCandidates = [];

        // Verification Loop
        for (const app of data.results) {
            const actualTitle = app.trackName || '';
            const appId = app.trackId;
            const actualCategory = app.primaryGenreName || '';
            const storeDescription = app.description || '';
            const developer = app.artistName || '';

            console.log(`iOS: checking candidate ${appId} - Title: "${actualTitle}", Category: "${actualCategory}"`);

            if (isMatch(appName, actualTitle)) {
                if (!isCategoryMatch(mobbinCategory, actualCategory, 'ios')) {
                    console.log(`iOS: checking candidate ${appId} skipped due to category mismatch`);
                    continue;
                }

                const descScore = descriptionScore(mobbinTagline, storeDescription);
                console.log(`iOS: checking candidate ${appId} description score: ${descScore.toFixed(2)}`);

                const ratings = app.userRatingCount || 0;

                // Reviews RSS
                const rssUrl = `https://itunes.apple.com/us/rss/customerreviews/id=${appId}/sortBy=mostRecent/json`;
                let reviewsDates = [];
                try {
                    const rssResp = await fetch(rssUrl);
                    const rssData = await rssResp.json();
                    if (rssData.feed && rssData.feed.entry) {
                        const entries = Array.isArray(rssData.feed.entry) ? rssData.feed.entry : [rssData.feed.entry];
                        reviewsDates = entries.map(e => e.updated.label);
                    }
                } catch (e) {
                    console.warn('Failed to fetch iOS reviews RSS', e);
                }

                validCandidates.push({
                    ratings: ratings,
                    reviews_dates: reviewsDates,
                    appId: appId,
                    category: actualCategory,
                    title: actualTitle,
                    developer: developer,
                    descScore: descScore
                });
            }
        }

        // Return best candidate by description score
        if (validCandidates.length > 0) {
            validCandidates.sort((a, b) => b.descScore - a.descScore);
            const best = validCandidates[0];
            console.log(`iOS: Selected best candidate: ${best.appId} (score: ${best.descScore.toFixed(2)})`);
            return best;
        }

        return { error: 'App not found on App Store (No matching candidates)' };

    } catch (error) {
        console.error('iOS Fetch Error', error);
        return { error: 'iOS Fetch Failed' };
    }
}



// ✅ Helper to extract genre from Mobbin page HTML
function extractGenreFromMobbinHtml(html) {
    if (!html) return null;

    // Primary: Look for ALL "appCategories" - capture all unique genres
    // Regex stops at boundaries (&, quotes, tags) rather than allowing problematic chars
    const categoryRegex = /filter=appCategories\.([^&"'<>]+)/g;
    const genres = new Set();
    let match;

    while ((match = categoryRegex.exec(html)) !== null) {
        // Decode URL encoding safely (malformed % sequences can throw)
        let decoded = match[1].replace(/\+/g, ' ');
        try { decoded = decodeURIComponent(decoded); } catch { }
        if (decoded) {
            genres.add(decoded);
        }
    }

    if (genres.size > 0) {
        const joined = [...genres].join(', ');
        console.log('Extracting genre from html match appCategories:', joined);
        return joined;
    }

    // Fallback: Look for "appCategory" (single value)
    const categoryMatch = html.match(/"appCategory"\s*:\s*"([^"]+)"/);
    if (categoryMatch && categoryMatch[1]) {
        console.log('Extracting genre from html match appCategory', categoryMatch[1].replace(/\\u0026/g, '&'));
        return categoryMatch[1].replace(/\\u0026/g, '&');
    }

    return null;
}

// ✅ Helper to extract App Store URL from Mobbin page HTML
function extractAppStoreUrlFromMobbinHtml(html) {
    if (!html) return null;

    // Look for appStoreUrl in Next.js data
    console.log('[DEBUG] HTML length:', html.length);

    const idx = html.indexOf('"appStoreUrl"');
    console.log('[DEBUG] indexOf "appStoreUrl":', idx);

    if (idx !== -1) {
        console.log('[DEBUG] snippet near it:\n', html.slice(idx - 100, idx + 200));
    }

    // 1) Does the HTML contain ANY Apple URL?
    const appleIdx = html.indexOf('apps.apple.com');
    console.log('[DEBUG] indexOf apps.apple.com:', appleIdx);
    if (appleIdx !== -1) {
        console.log('[DEBUG] snippet near apps.apple.com:\n', html.slice(appleIdx - 100, appleIdx + 200));
    }

    // 2) Search a few likely key names (Ctrl+F style)
    const keys = ['trackViewUrl', 'itunesUrl', 'appStoreLink', 'appleStoreUrl', 'appleUrl', 'storeUrl'];
    for (const k of keys) {
        const i = html.indexOf(k);
        console.log(`[DEBUG] indexOf ${k}:`, i);
        if (i !== -1) {
            console.log(`[DEBUG] snippet near ${k}:\n`, html.slice(i - 120, i + 220));
            break;
        }
    }

    // Unified Regex Matching: Handles both standard and escaped JSON
    const m = html.match(/"appStoreUrl"\s*:\s*"([^"]+)"/) ||
        html.match(/\\"appStoreUrl\\"\s*:\s*\\"([^\\"]+)\\"/);

    if (m && m[1]) {
        // Unescape JSON-encoded characters (Next.js escapes slashes and ampersands)
        // Also handle double-escaped slashes if it came from the escaped regex
        const url = m[1]
            .replace(/\\u0026/g, '&')
            .replace(/\\\//g, '/')   // Fixes \/ -> /
            .replace(/\\\\/g, '\\'); // Fixes \\ -> \ (just in case)

        if (url.includes('apps.apple.com')) {
            console.log('Extracting App Store URL from HTML:', url);
            return url;
        }
    }

    // Fallback: Direct extraction from raw text if explicit JSON key is missing
    // We reuse appleIdx which was calculated in debug block above (or we recalculate if needed)
    // Note: Variable appleIdx is assumed to be available from previous block. If scope issues, recalculate.
    const fallbackIdx = html.indexOf('apps.apple.com');
    if (fallbackIdx !== -1) {
        console.log('[DEBUG SW] Attempting fallback extraction for apple URL...');
        // Look slightly behind for https:// or https:\/\/
        // Start 12 chars back to catch "https:\/\/"
        const start = Math.max(0, fallbackIdx - 12);
        const end = Math.min(html.length, fallbackIdx + 250);
        const chunk = html.slice(start, end);

        // Match: http(s):// or http(s):\/\/ -> then apps.apple.com -> then path chars
        // Path chars: allow alphanumeric, symbols, AND backslash (for escaped path)
        const fallbackMatch = chunk.match(/(https?:\\?\/\\?\/apps\.apple\.com[^"'\s<>]*)/);

        if (fallbackMatch) {
            let rawUrl = fallbackMatch[1];
            // Normalize: unescape \/ to /
            const cleanUrl = rawUrl.replace(/\\\//g, '/');

            console.log('[DEBUG SW] Fallback extraction FOUND:', cleanUrl);
            return cleanUrl;
        }
    }

    return null;
}

// ✅ Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'FETCH_DATA') {
        const appName = request.appName;
        const category = request.category;
        const tagline = request.tagline;
        const skipIos = request.skipIos || false;  // Skip iOS search if we already have direct URL data
        const iosDeveloper = request.iosDeveloper || null;

        console.log('Fetched', appName, 'GENRE:', category, 'TAGLINE:', tagline, 'skipIos:', skipIos, 'iosDeveloper:', iosDeveloper);

        // Fetch Android always, iOS only if not skipped
        const androidPromise = fetchAndroidData(appName, category, tagline, iosDeveloper);
        const iosPromise = skipIos
            ? Promise.resolve({ error: 'Skipped (using direct URL)' })
            : fetchIOSData(appName, category, tagline);

        Promise.all([androidPromise, iosPromise]).then(([androidData, iosData]) => {
            sendResponse({ androidData, iosData });
        });

        return true; // Keep channel open for async response
    }

    // New handler for direct iOS App Store URL lookup
    if (request.type === 'FETCH_IOS_BY_URL') {
        const appStoreUrl = request.appStoreUrl;
        console.log('Background: Fetching iOS data from direct URL:', appStoreUrl);

        fetchIOSDataByUrl(appStoreUrl).then(iosData => {
            console.log('Background: fetchIOSDataByUrl success:', iosData);
            sendResponse(iosData);
        }).catch(err => {
            console.error('Background: Error fetching iOS by URL', err);
            sendResponse({ error: err.message });
        });

        return true; // Keep channel open for async response
    }

    if (request.type === 'FETCH_MOBBIN_GENRE') {
        const appUrl = request.appUrl;
        console.log('Background: Fetching Mobbin app info for', appUrl);

        // Construct full URL if relative
        const fullUrl = appUrl.startsWith('http') ? appUrl : `https://mobbin.com${appUrl}`;
        console.log('Mobbin Reliability [DEBUG SW]: Fetching page content from:', fullUrl);

        fetchPage(fullUrl).then(html => {
            const genre = extractGenreFromMobbinHtml(html);
            const appStoreUrl = extractAppStoreUrlFromMobbinHtml(html);

            if (appUrl.includes('apple-photos') || appUrl.includes('photos')) {
                console.log('Mobbin Reliability [DEBUG SW]: Apple Photos HTML length:', html.length);
                console.log('Mobbin Reliability [DEBUG SW]: Extracted Genre:', genre);
                console.log('Mobbin Reliability [DEBUG SW]: Extracted AppStoreUrl:', appStoreUrl);
                // Optional: Log a snippet of the HTML if extraction failed
                if (!appStoreUrl) {
                    const match = html.match(/"appStoreUrl"\s*:\s*"([^"]+)"/);
                    console.log('Mobbin Reliability [DEBUG SW]: Manual check for appStoreUrl regex:', match);
                }
            }

            console.log('Background: Extracted genre:', genre, 'appStoreUrl:', appStoreUrl ? 'found' : 'not found');
            sendResponse({ genre, appStoreUrl });
        }).catch(err => {
            console.error('Background: Error fetching Mobbin page', err);
            sendResponse({ genre: null, appStoreUrl: null, error: err.message });
        });

        return true; // Keep channel open for async response
    }
});


// ✅ CACHING HELPERS (TTL Support)
// chrome.storage.local doesn't expire, so we implement manual TTL
const CACHE_TTL_DAYS_AGG = 7;
const CACHE_TTL_DAYS_STOREFRONT = 30; // Storefront data changes slowly, can cache longer or keep same

async function getCache(key) {
    return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
            const entry = result[key];
            if (!entry) {
                resolve(null);
                return;
            }
            // Check TTL
            const now = Date.now();
            if (now > entry.ts + entry.ttlMs) {
                // Expired
                console.log(`[Cache] Expired for ${key}`);
                chrome.storage.local.remove(key); // Cleanup
                resolve(null);
            } else {
                // Valid
                resolve(entry.value);
            }
        });
    });
}

async function setCache(key, value, ttlDays) {
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    const entry = {
        value: value,
        ts: Date.now(),
        ttlMs: ttlMs
    };
    return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: entry }, () => {
            if (chrome.runtime.lastError) {
                console.error('[Cache] Set error:', chrome.runtime.lastError);
            }
            resolve();
        });
    });
}


// ✅ Apple Ratings Aggregation Strategy
// Aggregates ratings from top storefronts to estimate global total.
const STOREFRONTS = [
    'us', 'gb', 'ca', 'au',       // Tier 1 (English)
    'de', 'fr', 'it', 'es', 'pt', 'pl', // Tier 2 (Europe)
    'br', 'mx',                   // Tier 2 (LatAm)
    'in', 'pk',                   // Tier 2 (Asia - massive volume)
    'jp', 'kr', 'cn', 'tw', 'sg', // Tier 1 (Asia - High value)
    'ru'                          // Tier 2 (Other)
];

const MAX_STOREFRONTS = 15;
const EARLY_STOP_THRESHOLD = 0.03; // 3%

async function fetchAggregatedIOSRatings(appId) {
    if (!appId) return { error: 'No App ID provided' };

    // 1. Check Aggregate Cache
    const aggKey = `apple_ratings_agg_v1:${appId}`;
    const cachedAgg = await getCache(aggKey);
    if (cachedAgg) {
        console.log(`[Aggregation] Cache HIT for ${appId} (skipping fetch):`, cachedAgg);
        return cachedAgg;
    }

    console.log(`[Aggregation] Starting aggregation for ${appId}...`);

    let totalRatings = 0;
    let weightedSum = 0;
    let usedStorefronts = [];
    let processedCount = 0;

    // Track running totals for early stop logic
    // We need to track the sum of the last 3 processed to check against total
    let history = []; // Stores userRatingCount of each successful fetch

    for (const country of STOREFRONTS) {
        // Stop conditions
        if (processedCount >= MAX_STOREFRONTS) {
            console.log(`[Aggregation] Early stop: Max storefronts (${MAX_STOREFRONTS}) reached.`);
            break;
        }

        // Check Early Stop Rule: Last 3 storefronts < 3% of total
        // We need at least some base (e.g. 5+ storefronts) before applying this to avoid stopping too early on small variance
        if (usedStorefronts.length >= 5 && history.length >= 3) {
            const last3Sum = history.slice(-3).reduce((a, b) => a + b, 0);
            const ratio = totalRatings > 0 ? (last3Sum / totalRatings) : 0;

            if (ratio < EARLY_STOP_THRESHOLD) {
                console.log(`[Aggregation] Early stop: Last 3 (${usedStorefronts.slice(-3)}) contributed ${(ratio * 100).toFixed(1)}% (< 3%) of total.`);
                break;
            }
        }

        // 2. Per-storefront fetch (with cache)
        const sfKey = `apple_ratings:${appId}:${country}`;
        let sfData = await getCache(sfKey);

        if (!sfData) {
            // Network fetch
            const lookupUrl = `https://itunes.apple.com/lookup?id=${appId}&country=${country}`;
            console.log(`[Aggregation] Fetching URL for ${appId} in ${country}: ${lookupUrl}`);
            try {
                // Non-blocking fetch for unreliable regions
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

                const response = await fetch(lookupUrl, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (response.ok) {
                    const data = await response.json();
                    if (data.resultCount > 0) {
                        const res = data.results[0];
                        sfData = {
                            userRatingCount: res.userRatingCount || 0,
                            averageUserRating: res.averageUserRating || 0,
                            // Store basic metadata from US/primary for content if needs update (optional)
                            trackName: res.trackName,
                            primaryGenreName: res.primaryGenreName,
                            artistName: res.artistName
                        };
                        // Cache successful result
                        await setCache(sfKey, sfData, CACHE_TTL_DAYS_STOREFRONT);
                    }
                }
            } catch (err) {
                console.warn(`[Aggregation] Failed to fetch ${country} for ${appId}:`, err);
                // Can treat as null/empty
            }
        }

        // Process Data
        if (sfData) {
            processedCount++;
            if (sfData.userRatingCount > 0) {
                usedStorefronts.push(country);
                totalRatings += sfData.userRatingCount;
                weightedSum += (sfData.averageUserRating * sfData.userRatingCount);
                history.push(sfData.userRatingCount);
                console.log(`[Aggregation] +${country}: ${sfData.userRatingCount} ratings (Total: ${totalRatings})`);
            } else {
                console.log(`[Aggregation] ${country}: 0 ratings`);
            }
        }
    }

    // Default Fallback: If total is 0 (unlikely for valid apps), try US hard fetch one last time if not tried? 
    // actually loops covers US first.

    const finalAvg = totalRatings > 0 ? (weightedSum / totalRatings) : 0;

    const result = {
        apple_ratings_total_estimated: totalRatings,
        apple_rating_weighted_avg: finalAvg,
        apple_storefronts_used: usedStorefronts
    };

    console.log(`[Aggregation] Finished for ${appId}. Total: ${totalRatings}, Avg: ${finalAvg.toFixed(2)}`);

    // 3. Cache Aggregate Result
    // Only cache if we found data. If 0, might be error or new app. Cache for shorter time?
    // User requested 7-30 days.
    await setCache(aggKey, result, CACHE_TTL_DAYS_AGG);

    return result;
}


// ✅ View Detection (via webNavigation) to handle SPA navigation robustly
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    // Only care about the main frame
    if (details.frameId !== 0) return;

    console.log('Background: History state updated', details.url);

    // Initial check: filter for mobbin host if needed (though manifest limits scope)
    if (!details.url.includes('mobbin.com')) return;

    // Send message to content script
    // We catch errors in case the tab is not ready or content script is not yet listening
    chrome.tabs.sendMessage(details.tabId, {
        type: 'URL_CHANGED',
        url: details.url
    }).catch(err => {
        // Ignored: content script might not be ready yet or page is unloading
    });
}, {
    url: [{ hostContains: 'mobbin.com' }]
});


// ✅ FETCH iOS DATA BY DIRECT URL - B. single app page (bypasses search)
// Used when Mobbin provides the App Store URL directly in the page
async function fetchIOSDataByUrl(appStoreUrl) {
    console.log('[DEBUG] fetchIOSDataByUrl called with:', appStoreUrl);
    try {
        // Extract app ID from URL: https://apps.apple.com/us/app/app-name/id123456789
        const idMatch = appStoreUrl.match(/\/id(\d+)/);
        if (!idMatch) {
            console.error('iOS: Could not extract app ID from URL:', appStoreUrl);
            return { error: 'Invalid App Store URL' };
        }

        const appId = idMatch[1];

        // Use Aggregation Logic
        const aggData = await fetchAggregatedIOSRatings(appId);

        // We still need metadata (title, genre, icon etc.) - Fetch from US (or first available) for consistency
        // Reuse us fetch if it's cached from aggregation loop, otherwise fetch fresh
        let metadata = null;
        const usKey = `apple_ratings:${appId}:us`;
        const usData = await getCache(usKey); // Likely cached by aggregation

        if (usData && usData.trackName && usData.artistName) {
            metadata = usData;
        } else {
            // Fallback fetch just for metadata if US failed or wasn't first?
            // Or just use the first successful cache from aggregation?
            // Simplest: Just fetch US lookup again (cheap) or rely on what we have.
            // Let's do a quick US lookup if missing metadata.
            const lookupUrl = `https://itunes.apple.com/lookup?id=${appId}&country=us`;
            console.log('[DEBUG] Metadata missing or incomplete (no artistName), fetching generic lookup:', lookupUrl);
            const resp = await fetch(lookupUrl);
            if (resp.ok) {
                const d = await resp.json();
                if (d.resultCount > 0) metadata = d.results[0];
            }
        }

        if (!metadata) {
            // If completely failed to get metadata but got ratings (rare), default
            metadata = { trackName: 'Unknown', primaryGenreName: 'Unknown', artistName: 'Unknown' };
        }

        // Fetch reviews RSS for growth metrics (US store is standard for this proxy)
        const rssUrl = `https://itunes.apple.com/us/rss/customerreviews/id=${appId}/sortBy=mostRecent/json`;
        let reviewsDates = [];
        try {
            const rssResp = await fetch(rssUrl);
            const rssData = await rssResp.json();
            if (rssData.feed && rssData.feed.entry) {
                const entries = Array.isArray(rssData.feed.entry) ? rssData.feed.entry : [rssData.feed.entry];
                reviewsDates = entries.map(e => e.updated.label);
            }
        } catch (e) {
            console.warn('iOS (direct URL): Failed to fetch reviews RSS', e);
        }

        console.log(`iOS (direct URL): Found app "${metadata.trackName}" with Aggregated Ratings: ${aggData.apple_ratings_total_estimated}`);

        return {
            ratings: aggData.apple_ratings_total_estimated, // Use Aggregated Total
            start_rating: aggData.apple_rating_weighted_avg, // Pass avg just in case (optional, schema check)
            reviews_dates: reviewsDates,
            appId: appId,
            category: metadata.primaryGenreName,
            title: metadata.trackName,
            developer: metadata.artistName,
            descScore: 1.0,  // Direct URL = perfect confidence
            appStoreUrl: appStoreUrl,
            // Debug info
            _aggregated_storefronts: aggData.apple_storefronts_used
        };

    } catch (error) {
        console.error('iOS (direct URL): Fetch error detailed:', error);
        return { error: `iOS Direct URL Fetch Failed: ${error.message}` };
    }
}

