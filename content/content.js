// Imports removed to rely on global scope from scoring.js and scraper.js loaded previously in manifest

console.log('Mobbin Reliability Score: Content script loaded');

// Cache for app scores to avoid redundant fetches
const appScoreCache = new Map();
// Cache for genres fetched from Mobbin pages
const genreCache = new Map();

// Helper to check if extension context is valid
function isContextValid() {
    return !!chrome.runtime && !!chrome.runtime.id;
}

// Helper to wait for element
function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }
        const observer = new MutationObserver(() => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve(document.querySelector(selector));
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
}

function formatCount(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
}

function formatReliabilityScore(score) {
    const formatted = score.toFixed(1);
    return formatted === "10.0" ? "10" : formatted;
}

function getColor(grade) {
    const colorMap = {
        'Elite': '#49b54dff', // Green
        'High': '#85d52aff', // Light Green
        'Medium': '#f7c32bff', // Amber
        'Low': '#f75c2bff' // Red
    };
    return colorMap[grade] || '#9E9E9E';
}

// ✅ FETCH STORE DATA WRAPPER - A. multi apps page
// skipIos: if true, skips iOS App Store search (used when we have direct URL)
async function fetchStoreData(appName, genre = null, tagline = null, skipIos = false, iosDeveloper = null) {
    // Message to Background Worker
    if (!isContextValid()) {
        console.warn('Mobbin Reliability: Extension context invalidated. Please refresh the page.');
        return { androidData: { error: 'Invalidated' }, iosData: { error: 'Invalidated' } };
    }

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'FETCH_DATA',
            appName: appName,
            category: genre,
            tagline: tagline,
            skipIos: skipIos,
            iosDeveloper: iosDeveloper
        });
        const { androidData, iosData } = response;

        const hasAndroid = androidData && !androidData.error;
        const hasIOS = iosData && !iosData.error;

        if (!hasAndroid && !hasIOS) {
            appScoreCache.set(appName, null);
            return null; // Not found
        }

        return { androidData, iosData };
    } catch (error) {
        console.error('Mobbin Reliability: Error sending message to background:', error);
        return { androidData: { error: 'Message failed' }, iosData: { error: 'Message failed' } };
    }
}

// ✅ FETCH AND CALCULATE SCORE - A. multi apps page
// appStoreUrl: optional direct iOS URL from Mobbin (skips iOS search if provided)
async function fetchAndCalculateScore(appUrl, appName, genre = null, tagline = null, appStoreUrl = null) {
    const cacheKey = `score_${appUrl}`;
    console.log("cache get [CACHE][GET]", cacheKey, appName, location.href);

    // 1. Check in-memory cache first (fastest)
    if (appScoreCache.has(cacheKey)) {
        console.log('Cache hit (memory):', appUrl);
        return appScoreCache.get(cacheKey);
    }

    // 2. Check persistent session storage (survives navigation)
    try {
        const stored = await chrome.storage.session.get(cacheKey);
        if (stored[cacheKey]) {
            console.log('Cache hit (session storage):', appUrl);
            appScoreCache.set(cacheKey, stored[cacheKey]); // Hydrate memory cache
            return stored[cacheKey];
        }
    } catch (e) {
        // storage.session may not be available in all contexts
        console.warn('Session storage unavailable:', e.message);
    }

    // 3. Fetch fresh data
    // If we have a direct iOS URL, try that first to skip iOS search
    let iosDataFromUrl = null;
    if (appStoreUrl) {
        console.log('Multi-app: Using direct iOS URL:', appStoreUrl);
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'FETCH_IOS_BY_URL',
                appStoreUrl: appStoreUrl
            });
            if (response && !response.error) {
                iosDataFromUrl = response;
                console.log('Multi-app: iOS data from direct URL:', iosDataFromUrl);
            } else {
                console.warn('Multi-app: FETCH_IOS_BY_URL for app returned error or empty:', response);
            }
        } catch (error) {
            console.warn('Multi-app: Direct iOS fetch failed, will search instead:', error);
        }
    }

    // Fetch store data (skip iOS search if we already have data from direct URL)
    const storeData = await fetchStoreData(appName, genre, tagline, !!iosDataFromUrl, iosDataFromUrl?.developer);

    // Handle case where fetchStoreData returns null (no stores found)
    // ⚠️ Only cache in memory, NOT session storage!
    // This allows retry after navigation (single-app view may succeed with tagline)
    // FIX: If we have iosDataFromUrl, we proceed even if search found nothing (e.g. Android missing).
    if (!storeData && !iosDataFromUrl) {
        appScoreCache.set(cacheKey, null);
        return null;
    }

    let androidData = { error: 'Not Found' };
    let searchedIosData = { error: 'Not Found' };

    if (storeData) {
        ({ androidData, iosData: searchedIosData } = storeData);
    }

    // Use direct iOS data if available, otherwise use searched data
    const iosData = iosDataFromUrl || searchedIosData;

    if (appName === "Apple Photos") {
        console.log("Mobbin Reliability [DEBUG]: fetchAndCalculateScore for Apple Photos");
        console.log("Mobbin Reliability [DEBUG]: Direct iOS URL provided?", appStoreUrl);
        console.log("Mobbin Reliability [DEBUG]: Fetched Android Data:", androidData);
        console.log("Mobbin Reliability [DEBUG]: Fetched iOS Data:", iosData);
    }

    const hasAndroid = androidData && !androidData.error;
    const hasIOS = iosData && !iosData.error;

    // ⚠️ Only cache in memory, NOT session storage (same reason as above)
    if (!hasAndroid && !hasIOS) {
        appScoreCache.set(cacheKey, null);
        console.log('No stores fetched for', appName);
        return null;
    }

    // Calculate
    // We prioritize the genre passed in (scraped from the page)
    const downloadStats = calculateTotalDownloads(androidData, iosData, genre);
    const growthMetrics = calculateGrowthMetrics(iosData.reviews_dates || [], appName, androidData, iosData);
    const scoreCard = calculateReliabilityScore(downloadStats.total, growthMetrics, appName);

    const result = {
        scoreCard,
        growthMetrics,
        downloadStats,
        androidId: androidData.appId,
        iosId: iosData.appId,
        iosData: iosData // ✅ Fix: Pass full iOS data so badge can use the URL
    };
    console.log('Calculated score for', appName, result);
    // Explicit debug for Apple Photos
    if (appName === "Apple Photos") {
        console.log("Mobbin Reliability [DEBUG]: fetchAndCalculateScore RESULT:", result);
    }

    // 4. Store in both caches
    console.log("[CACHE][SET]", cacheKey, appName, location.href, result?.iosData?.appStoreUrl);
    appScoreCache.set(cacheKey, result);
    try {
        await chrome.storage.session.set({ [cacheKey]: result });
        console.log('Saved to session storage:', appUrl);
    } catch (e) {
        console.warn('Failed to save to session storage:', e.message);
    }

    console.log("cache set [CACHE][SET]", cacheKey, appName, location.href, result?.iosUrl);
    return result;
}


// --- BADGE INJECTION ---

async function injectFullBadge(appName) {
    // Check if already exists
    if (document.getElementById('mobbin-reliability-badge')) return;

    // 1. INJECT SKELETON IMMEDIATELY
    const badge = document.createElement('div');
    badge.id = 'mobbin-reliability-badge';
    badge.className = 'mobbin-reliability-badge';

    // Skeleton HTML
    badge.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            <div class="mobbin-skeleton-pulse" style="width: 64px; height: 40px; border-radius: 22px;"></div>
            <div style="display: flex; flex-direction: column; justify-content: center;">
                <div class="mobbin-skeleton-pulse" style="width: 90px; height: 16px; border-radius: 4px;"></div>
            </div>
        </div>
    `;
    document.body.appendChild(badge);

    // 2. Determine genre from the page FIRST (strictly await find)
    console.log('Mobbin Reliability: Starting genre wait...');
    const pageGenre = await getMobbinGenre();
    console.log('Mobbin Reliability: Genre wait finished, result:', pageGenre);

    // 3. Fetch store data (tries direct iOS URL first, then search)
    const tagline = getAppTagline();
    const storeData = await fetchStoreDataForSingleApp(appName, pageGenre, tagline);

    // 4. Calculate score if we have data
    let data = null;
    if (storeData) {
        const { androidData, iosData } = storeData;
        const hasAndroid = androidData && !androidData.error;
        const hasIOS = iosData && !iosData.error;

        if (hasAndroid || hasIOS) {
            const downloadStats = calculateTotalDownloads(androidData, iosData, pageGenre);
            const growthMetrics = calculateGrowthMetrics(iosData?.reviews_dates || [], appName, androidData, iosData);
            const scoreCard = calculateReliabilityScore(downloadStats.total, growthMetrics, appName);

            data = {
                scoreCard,
                growthMetrics,
                downloadStats,
                androidId: hasAndroid ? androidData.appId : null,
                iosId: hasIOS ? iosData.appId : null
            };
        }
    }

    // Handle case when neither store is found - still show popup with "Missing"
    // Handle case when neither store is found - still show popup with "Missing"
    let scoreCard;

    if (!data) {
        console.warn('Mobbin Reliability: No data found for', appName, '- showing Missing state');
        scoreCard = { score: 0, grade: 'N/A' };
    } else {
        scoreCard = data.scoreCard;
    }

    // 5. UPDATE BADGE CONTENT
    const color = getColor(scoreCard.grade);


    badge.innerHTML = `
        <div class="mobbin-content-fade" style="display: flex; align-items: center; gap: 8px;">
            <div style="
                background: ${color}; 
                color: white; 
                border-radius: 22px; 
                padding: 0 12px;
                min-width: 44px; 
                height: 40px; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                font-weight: 700; 
                font-size: 18px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.15);
                flex-shrink: 0;
            ">
                ${formatReliabilityScore(scoreCard.score)}<span style="font-size: 10px; font-weight: 500; opacity: 0.9; margin-left: 2px; margin-top: 1px;">/10</span>
            </div>
            <div style="display: flex; flex-direction: column; justify-content: center;">
                <div style="
                    font-weight: 600; 
                    font-size: 15px; 
                    color: #1d1d1f; 
                    letter-spacing: -0.01em; 
                    line-height: 1.2;
                ">
                    ${scoreCard.grade} Reliability
                </div>
            </div>
        </div>
    `;
}

// ✅ POPULATE MINI BADGE - A. multi apps page
// appStoreUrl: optional direct iOS URL from Mobbin (passed through to fetchAndCalculateScore)
async function injectMiniBadge(card, appUrl, appName, genre = null, tagline = null, appStoreUrl = null) {
    // Prevent double injection
    if (card.querySelector('.mobbin-reliability-minibadge')) return;

    // 1. INJECT SKELETON IMMEDIATELY
    const badge = document.createElement('div');
    badge.className = 'mobbin-reliability-minibadge';
    badge.innerHTML = `<div class="mobbin-skeleton-pulse mobbin-skeleton-minibadge"></div>`;

    // Ensure card has relative positioning
    const currentPos = window.getComputedStyle(card).position;
    if (currentPos === 'static') {
        card.style.position = 'relative';
    }
    card.appendChild(badge);

    // 2. Fetch data
    let data = await fetchAndCalculateScore(appUrl, appName, genre, tagline, appStoreUrl);

    let scoreCard, downloadStats, androidId, iosId;

    if (!data) {
        scoreCard = { score: 0, grade: 'N/A' };
        downloadStats = { android: 0, ios: 0, total: 0, used_genre: genre };
        androidId = null;
        iosId = null;
    } else {
        ({ scoreCard, downloadStats, androidId, iosId } = data);
    }
    const color = getColor(scoreCard.grade);

    const androidLink = androidId
        ? `<a href="https://play.google.com/store/apps/details?id=${androidId}" target="_blank">Google Play: <b>${formatCount(downloadStats.android)}</b></a>`
        : '<span style="display:block; color:#999; font-size:11px; margin-top:6px;">Google Play: Missing</span>';

    // Prefer full appStoreUrl (with storefront) if available, otherwise construct generic URL
    const iosUrl = data?.iosData?.appStoreUrl || (iosId ? `https://apps.apple.com/app/id${iosId}` : null);

    console.log(`[Mini Badge] App: ${appName}, iOS URL displayed: ${iosUrl ? 'YES' : 'NO'} (${iosUrl || 'N/A'})`);
    console.log(`[Mini Badge] App: ${appName}, Score: ${scoreCard?.score}, Downloads: Android=${formatCount(downloadStats?.android)} iOS=${formatCount(downloadStats?.ios)}`);

    const iosLink = iosUrl
        ? `<a href="${iosUrl}" target="_blank">App Store: <b>${formatCount(downloadStats.ios)}</b></a>`
        : '<span style="display:block; color:#999; font-size:11px; margin-top:6px;">App Store: Missing</span>';

    // 3. UPDATE CONTENT WITH TRANSITION
    // We replace the innerHTML. The pulse skeleton classes are removed.
    // We wrapper the new content in a span with the fade class if needed, or just apply the animation to the elements.
    // However, since minibadge has specific layout (flex), we can just replace innerHTML and let standard CSS handle it.
    // To make it fade in, we can add the animation class to the elements.

    badge.innerHTML = `
        <div class="score-dot mobbin-content-fade" style="background: ${color};"></div>
        <span class="mobbin-content-fade" style="color: #333;">${formatReliabilityScore(scoreCard.score)}</span>
        
        <div class="mobbin-reliability-tooltip">
            <span class="close-btn">&times;</span>
            <span class="tooltip-header" style="color:${color}">${scoreCard.grade} Reliability (${formatReliabilityScore(scoreCard.score)})</span>
            <div style="font-size: 11px; color: #666; margin-bottom: 4px;">Genre: <b>${downloadStats.used_genre || 'N/A'}</b></div>
            ${androidLink}
            ${iosLink}
        </div>
    `;

    // Interaction Logic
    const tooltip = badge.querySelector('.mobbin-reliability-tooltip');
    const closeBtn = badge.querySelector('.close-btn');

    // Toggle on badge click
    badge.addEventListener('click', (e) => {
        // Prevent navigation (since badge is inside an anchor)
        e.preventDefault();
        e.stopPropagation();

        // Toggle expanded state
        tooltip.classList.toggle('expanded');
    });

    // Close on X click
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent badge click
        tooltip.classList.remove('expanded');
    });

    // Prevent clicks inside tooltip from closing it or navigating, unless it's a link
    tooltip.addEventListener('click', (e) => {
        if (e.target.closest('a')) {
            e.stopPropagation(); // Stop bubbling but allow default action (navigation)
            return;
        }
        e.preventDefault();
        e.stopPropagation();
    });
}


// --- VIEW DETECT & INIT ---

// ✅ EXTRACT APP NAME - B. single app page
// Helper to extract app name with retry
async function getAppName() {
    // Wait for SPA render - retry up to 10 times (3 seconds total)
    for (let i = 0; i < 10; i++) {
        const h1 = document.querySelector('h1');
        if (h1) {
            // App name is the first text node, before any spans
            console.log('NAME:', h1.childNodes[0].textContent.trim());
            return h1.childNodes[0].textContent.trim();
        }
        await new Promise(r => setTimeout(r, 300));
    }
    console.log('NAME not found');
    return null;
}

// ✅ EXTRACT APP TAGLINE - B. single app page
// Helper to extract app tagline from h1
function getAppTagline() {
    const h1 = document.querySelector('h1');
    if (!h1) {
        console.log('TAGLINE not found');
        return null;
    }
    // The tagline is in a nested span with class "inline-block"
    const taglineSpan = h1.querySelector('span.inline-block');
    console.log('TAGLINE:', taglineSpan.innerText.trim());
    return taglineSpan ? taglineSpan.innerText.trim() : null;
}

// ✅ EXTRACT iOS APP STORE URL FROM SCRIPT - B. single app page
// Mobbin embeds the App Store URL directly in Next.js hydration scripts
// Strategy:
// 1. Slug Match (Best): Check if the script contains "slug":"[current-page-slug]"
// 2. Name Presence (Good): Check if appName appears essentially anywhere in the script
// 3. Single Candidate (Fallback): If only one script has an appStoreUrl, assume it's the right one
// ✅ EXTRACT iOS APP STORE URL FROM SCRIPT - B. single app page
// Mobbin embeds the App Store URL directly in Next.js hydration scripts
// Strategy: "Proof Rule" - Candidate must match at least 2 of 3 anchors:
// 1. UUID: matches the uuid in the current page URL
// 2. Slug: matches the current page slug
// 3. Name: matches the app name tokens
//
// + Retry logic for SPA navigation delays
// [Removed findAppStoreUrlWithProof - replaced by background fetch strategy]


// ✅ FETCH STORE DATA FOR SINGLE APP - B. single app page
// Tries direct iOS URL first (from script), then falls back to search
async function fetchStoreDataForSingleApp(appName, genre = null, tagline = null) {
    // 1. Fetch App Store URL via background fetch (consistent with Multi-App)
    // This fetches the page HTML from the background and extracts the URL using reliable regex
    const { appStoreUrl: directIosUrl } = await fetchMobbinAppInfo(window.location.href);
    let iosDataFromUrl = null;

    if (directIosUrl) {
        console.log('Mobbin Reliability (Single App): Using direct iOS URL from background fetch:', directIosUrl);
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'FETCH_IOS_BY_URL',
                appStoreUrl: directIosUrl
            });
            if (response && !response.error) {
                iosDataFromUrl = response;
                console.log('Mobbin Reliability: iOS data from direct URL:', iosDataFromUrl);
            }
        } catch (error) {
            console.warn('Mobbin Reliability: Direct iOS fetch failed, will search instead:', error);
        }
    }

    // 2. Fetch Android data (always via search) and iOS if not already found
    const response = await chrome.runtime.sendMessage({
        type: 'FETCH_DATA',
        appName: appName,
        category: genre,
        tagline: tagline,
        skipIos: !!iosDataFromUrl,  // Skip iOS search if we already have data from direct URL
        iosDeveloper: iosDataFromUrl?.developer || null
    });

    const { androidData, iosData: searchedIosData } = response;

    // Use direct iOS data if available, otherwise use searched data
    const iosData = iosDataFromUrl || searchedIosData;

    const hasAndroid = androidData && !androidData.error;
    const hasIOS = iosData && !iosData.error;

    if (!hasAndroid && !hasIOS) {
        appScoreCache.set(appName, null);
        return null;
    }

    return { androidData, iosData };
}


//✅ EXTRACT APP GENRE - B. single app page
async function getMobbinGenre() {
    try {
        console.log('Mobbin Reliability: trying to get genre...');

        // 1. Try Sentry component first (fast path)
        // We'll retry 3 times (0.9 seconds total) - fallback is fast and reliable
        for (let i = 0; i < 3; i++) {
            const categoryRoot = document.querySelector('[data-sentry-component="Category"]');
            if (categoryRoot) {
                const links = [...categoryRoot.querySelectorAll('a')];
                const genre = links.map(a => a.textContent.trim()).filter(Boolean).join(', ');
                if (genre) {
                    console.log(`GENRE attempt ${i + 1}:`, genre);
                    return genre;
                }
            }
            // Wait 300ms before retrying
            await new Promise(r => setTimeout(r, 300));
        }

        // 2. Structural fallback: start from browse/filter links and walk up to container
        // Targeted approach - no scanning all divs
        console.log('GENRE: fallback to structural search');
        const categoryLinks = document.querySelectorAll('a[href*="/browse/"][href*="filter="]');
        if (categoryLinks.length > 0) {
            // Walk up from first link to find container with <p> sibling (label)
            let container = categoryLinks[0].parentElement;
            while (container && container !== document.body) {
                const hasLabelP = container.querySelector(':scope > p');
                if (hasLabelP) {
                    const links = [...container.querySelectorAll('a[href*="/browse/"][href*="filter="]')];
                    const genre = links.map(a => a.textContent.trim()).filter(Boolean).join(', ');
                    if (genre) {
                        console.log('GENRE (structural fallback):', genre);
                        return genre;
                    }
                }
                container = container.parentElement;
            }
            // If no container with <p> found, just use the links directly
            const genre = [...categoryLinks].map(a => a.textContent.trim()).filter(Boolean).join(', ');
            if (genre) {
                console.log('GENRE (links fallback):', genre);
                return genre;
            }
        }


        //3. Fallback: Search in script tags
        console.log('GENRE: fallback to script search');
        const scripts = [...document.querySelectorAll('script')].map(s => s.textContent || '').join('');

        // Try to find "appCategory" or "appCategories" in Next.js state scripts
        const nextMatch = scripts.match(/"appCategor(?:y|ies)"\s*:\s*"([^"]+)"/);
        if (nextMatch && nextMatch[1]) {
            return nextMatch[1].replace(/\\u0026/g, '&');
        }

        //4. Try to find in href links with filter=appCategories.
        const hrefMatch = scripts.match(/filter=appCategories\.([a-zA-Z0-9%_\s+&-]+)/);
        if (hrefMatch && hrefMatch[1]) {
            const extracted = hrefMatch[1].split(/[&'"]/)[0];
            return decodeURIComponent(extracted.replace(/\+/g, ' '));
        }

        return null;
    } catch (e) {
        console.error('GENRE: Error scraping genre', e);
        return null;
    }
}


//✅ FETCH APP INFO (genre + appStoreUrl) - A. multi apps page - via the background worker
// Caches the PROMISE to deduplicate concurrent in-flight requests
// Returns { genre, appStoreUrl } object
async function fetchMobbinAppInfo(appUrl) {
    // Return cached promise (or resolved value) if exists
    if (genreCache.has(appUrl)) {
        return genreCache.get(appUrl);
    }

    if (!isContextValid()) {
        console.warn('Mobbin Extension: context invalidated.');
        return { genre: null, appStoreUrl: null };
    }

    const fullLogUrl = appUrl.startsWith('http') ? appUrl : `https://mobbin.com${appUrl}`;
    console.log('Mobbin Reliability: Analyzing app page ->', fullLogUrl);

    // Cache the promise immediately (not the result) to deduplicate concurrent calls
    const fetchPromise = chrome.runtime.sendMessage({ type: 'FETCH_MOBBIN_GENRE', appUrl })
        .then(response => {
            const genre = response?.genre || null;
            const appStoreUrl = response?.appStoreUrl || null;
            console.log('Mobbin Extension multi-apps page: Fetched app info for', appUrl, '- genre:', genre, 'appStoreUrl:', appStoreUrl ? 'found' : 'not found');
            return { genre, appStoreUrl };
        })
        .catch(error => {
            console.error('Mobbin Extension: Error fetching app info:', error);
            return { genre: null, appStoreUrl: null };
        });

    genreCache.set(appUrl, fetchPromise);
    return fetchPromise;
}


// ✅ INDIVIDUAL CARD PROCESSING - A. multi apps page
async function processCard(liElement) {
    // Early guard: quickly skip lis that aren't app cards (navs, filters, dropdowns)
    // Check before setting any flags to avoid unnecessary work
    const link = liElement.querySelector('a[href^="/apps/"]');
    if (!link) return;

    // Two-label guard pattern:
    // - mobbinProcessed: "I finished successfully" - never retry
    // - mobbinProcessing: "I'm working on this" - prevent concurrent work

    if (liElement.dataset.mobbinProcessed === "1") return;
    if (liElement.dataset.mobbinProcessing === "1") return;

    liElement.dataset.mobbinProcessing = "1";

    const myToken = navToken; // Capture current navigation state

    try {
        const nameEl = liElement.querySelector('h3');
        if (!nameEl) return;

        const appName = nameEl.innerText.trim();
        if (!appName) return;

        // Extract tagline from sibling <p> element
        // Structure: <div><h3>App Name</h3><p>Tagline</p></div>
        const taglineEl = nameEl.parentElement?.querySelector('p');
        const tagline = taglineEl?.innerText?.trim() || null;
        console.log('Mobbin Extension multi-apps page: Fetched tagline for', appName, ':', tagline);

        const appUrl = link.getAttribute('href');

        if (appName === "Apple Photos") {
            console.log("Mobbin Reliability [DEBUG]: Processing Apple Photos card");
            console.log("Mobbin Reliability [DEBUG]: App URL:", appUrl);
            if (appUrl.includes('/screens')) {
                console.warn("Mobbin Reliability [DEBUG]: ⚠️ Warning: App URL points to a '/screens' subpage. Metadata might be missing here. Base URL should be:", extractBaseAppUrl(appUrl));
            }
        }

        const { genre, appStoreUrl } = await fetchMobbinAppInfo(appUrl);
        if (myToken !== navToken) return; // Stale check

        if (appName === "Apple Photos") {
            console.log("Mobbin Reliability [DEBUG]: fetchMobbinAppInfo result:", { genre, appStoreUrl });
        }

        await injectMiniBadge(link, appUrl, appName, genre, tagline, appStoreUrl);
        if (myToken !== navToken) return; // Stale check after injection (though less critical)

        liElement.dataset.mobbinProcessed = "1";
    } finally {
        delete liElement.dataset.mobbinProcessing;
    }
}


// Helper to extract base app URL from extended screen/ui-elements URLs
// From: /apps/canopi-ios-300771d2-.../7bbf6c63-.../ui-elements
// To:   /apps/canopi-ios-300771d2-...
function extractBaseAppUrl(href) {
    const match = href.match(/^(\/apps\/[^\/]+)/);
    return match ? match[1] : href;
}


// ✅ INDIVIDUAL SCREEN CARD PROCESSING - A. multi apps page (screens/ui-elements view)
async function processScreenCell(cellElement) {
    // Same two-label guard pattern as processCard
    if (cellElement.dataset.mobbinProcessed === "1") return;
    if (cellElement.dataset.mobbinProcessing === "1") return;

    cellElement.dataset.mobbinProcessing = "1";

    const myToken = navToken; // Capture

    try {
        // App link is in the second direct div child (bottom row)
        const appLink = cellElement.querySelector(':scope > div:nth-of-type(2) a[href^="/apps/"]');
        if (!appLink) return;

        // App name with fallbacks
        const nameEl =
            appLink.querySelector('span') ||
            appLink.querySelector('[data-testid="app-name"]') ||
            appLink;

        const appName = (
            nameEl.getAttribute('aria-label') ||
            nameEl.getAttribute('title') ||
            nameEl.textContent || ''
        ).trim();

        if (!appName) return;

        // Extract base app URL (strip screen-id and view-type segments)
        const fullHref = appLink.getAttribute('href');
        const appUrl = extractBaseAppUrl(fullHref);

        // No tagline in screen view
        const { genre, appStoreUrl } = await fetchMobbinAppInfo(appUrl);

        if (myToken !== navToken) return; // Stale check

        await injectMiniBadge(cellElement, appUrl, appName, genre, null, appStoreUrl);

        cellElement.dataset.mobbinProcessed = "1";
    } finally {
        delete cellElement.dataset.mobbinProcessing;
    }
}


// ✅ INITIALIZATION after detection - A. multi apps page
// ✅ INITIALIZATION after detection - A. multi apps page
function initMultiAppView() {
    console.log('Mobbin Extension: Initializing Multi-App View');

    // Helper to process cards within a given container
    function processCardsInContainer(container) {
        // Process app-based cards (li elements) - for content_type=apps
        const lis = container.querySelectorAll('li');
        lis.forEach(li => processCard(li));

        // Process screen-based cards (ScreenCell components) - for content_type=screens/ui-elements
        // Try Sentry component first, then structural fallback for /screens/ + /apps/ URLs
        let screenCells = [...container.querySelectorAll('[data-sentry-component="ScreenCell"]')];

        // Structural fallback: detect screen cards by URL pattern when Sentry attribute is missing
        // Uses JS filter instead of :has() for better browser compatibility
        const isScreensPage = window.location.href.includes('/screens/') ||
            (window.location.search.includes('content_type=screens') ||
                window.location.search.includes('content_type=ui-elements'));
        if (screenCells.length === 0 && isScreensPage) {
            // Screen cells: find divs containing both /screens/ and /apps/ links (screen image + app info)
            const candidateDivs = container.querySelectorAll('div');
            screenCells = [...candidateDivs].filter(div => {
                const hasScreenLink = div.querySelector('a[href*="/screens/"]');
                const hasAppLink = div.querySelector(':scope > div a[href*="/apps/"]');
                return hasScreenLink && hasAppLink;
            });
        }
        screenCells.forEach(cell => processScreenCell(cell));

        // Also check if container itself is a card
        if (container.matches && container.matches('li')) {
            processCard(container);
        }
        // Sentry attribute check with structural fallback for screen cells
        const isContainerScreenCell = container.matches?.('[data-sentry-component="ScreenCell"]') ||
            (isScreensPage && container.matches?.('div') &&
                container.querySelector('a[href*="/screens/"]') &&
                container.querySelector(':scope > div a[href*="/apps/"]'));
        if (isContainerScreenCell) {
            processScreenCell(container);
        }
    }

    // Initial scan of entire main area
    const mainContainer = document.querySelector('main') || document.body;
    processCardsInContainer(mainContainer);

    // Observe only added nodes (performance optimization)
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const addedNode of mutation.addedNodes) {
                // Only process element nodes (skip text nodes)
                if (addedNode.nodeType === Node.ELEMENT_NODE) {
                    processCardsInContainer(addedNode);
                }
            }
        }
    });

    observer.observe(mainContainer, { childList: true, subtree: true });
    window._mobbinObserver = observer;
}


// --- MAIN NAVIGATION LOGIC ---

let navToken = 0;

function removeExistingBadges() {
    const oldBadge = document.getElementById('mobbin-reliability-badge');
    if (oldBadge) {
        oldBadge.remove();
        console.log('Removed existing badge');
    }
}

async function renderBadgeForCurrentView() {
    // Capture token at start of render
    const myToken = navToken;
    console.log(`Render started (Token: ${myToken}) for: ${window.location.pathname}`);

    // Wait for basic hydration/content load
    // We poll a few times because "complete" status from background doesn't mean "React Hydrated"
    await new Promise(r => setTimeout(r, 500));
    if (myToken !== navToken) return;

    // Clear previous observers if any
    if (window._mobbinObserver) {
        window._mobbinObserver.disconnect();
        window._mobbinObserver = null;
    }

    // Cleanup old badges immediately
    removeExistingBadges();

    const path = window.location.pathname;
    const isSingleView = path.startsWith('/apps/');

    // Log detection
    console.log(`Mobbin Extension: Path "${path}" -> SingleView: ${isSingleView}`);

    if (isSingleView) {
        console.log('Mobbin Extension: initializing SINGLE app view');
        // Wait for app name element to appear
        const appName = await getAppName();
        if (myToken !== navToken) return;

        if (appName) {
            injectFullBadge(appName);
        }
    } else {
        // Assume Multi View
        console.log('Mobbin Extension: initializing MULTI app view');
        initMultiAppView();
    }
}

function initExtension() {
    console.log('Mobbin Extension: Loaded');
    renderBadgeForCurrentView();
}

// Run once on load
initExtension();

// Listen for accurate navigation events from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'URL_CHANGED') {
        console.log('Mobbin Extension: URL Change detected via background:', request.url);

        // 1. Increment token to invalidate any pending async work from previous page
        navToken++;

        // 2. Trigger render for new view
        renderBadgeForCurrentView();
    }
});

