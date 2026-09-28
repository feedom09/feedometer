/**
 * scripts/feedometer-filters.js — FeedOmeter 2.1 Feed Filter Workspace Controller
 * Quality Checks, Jaccard Similarity Duplicate Detection (>=74%), Freshness & Keywords
 */

(function (window, document) {
  'use strict';

  function getApiBase() {
    if (typeof window !== 'undefined') {
      if (window.FEEDOMETER_API_BASE) return window.FEEDOMETER_API_BASE.replace(/\/+$/, '');
      if (window.FeedOmeterConfig && (window.FeedOmeterConfig.apiBaseUrl || window.FeedOmeterConfig.API_BASE_URL)) {
        return (window.FeedOmeterConfig.apiBaseUrl || window.FeedOmeterConfig.API_BASE_URL).replace(/\/+$/, '');
      }
      if (window.FEEDOMETER_CONFIG && (window.FEEDOMETER_CONFIG.apiBaseUrl || window.FEEDOMETER_CONFIG.API_BASE_URL || window.FEEDOMETER_CONFIG.API_BASE)) {
        return (window.FEEDOMETER_CONFIG.apiBaseUrl || window.FEEDOMETER_CONFIG.API_BASE_URL || window.FEEDOMETER_CONFIG.API_BASE).replace(/\/+$/, '');
      }
    }
    return '';
  }

  const filterState = {
    noImage: false,
    noDescription: false,
    noDate: false,
    noSecureLink: false,
    missingSource: false,
    dupTitle: false,
    dupDesc: false,
    dupLink: false,
    similarTitle: false,
    oldPosts: false,
    oldDays: 3,
    includeKeywords: '',
    excludeKeywords: '',
    includeDomains: '',
    excludeDomains: '',
    language: 'all'
  };

  let allArticles = [];
  let currentFeedUrl = '';
  let currentFeedTitle = 'Feed Preview';
  let currentFilteredArticles = [];

  function extractUnderlyingFeedUrl(u) {
    if (!u) return '';
    let str = String(u).trim();
    try {
      if (str.includes('/api/view')) {
        const parsed = new URL(str, window.location.origin || 'http://127.0.0.1:8787');
        const inner = parsed.searchParams.get('url') || parsed.searchParams.get('q');
        if (inner) str = inner;
      }
    } catch (_) {}
    return str.replace(/\/+$/, '').toLowerCase();
  }

  function urlsMatch(u1, u2) {
    if (!u1 || !u2) return false;
    if (u1 === u2) return true;
    const c1 = extractUnderlyingFeedUrl(u1);
    const c2 = extractUnderlyingFeedUrl(u2);
    if (c1 && c2 && c1 === c2) return true;
    if (u1.includes(encodeURIComponent(u2)) || u2.includes(encodeURIComponent(u1))) return true;
    return false;
  }

  function openInWidgetStudio() {
    const transferData = {
      feedUrl: currentFeedUrl,
      title: currentFeedTitle,
      filterRules: { ...filterState },
      articles: currentFilteredArticles,
      rawArticles: allArticles,
      timestamp: Date.now()
    };
    try {
      localStorage.setItem('feedometer_filter_transfer', JSON.stringify(transferData));
      sessionStorage.setItem('feedometer_filter_transfer', JSON.stringify(transferData));
      localStorage.setItem('feedometer_filter_rules', JSON.stringify(filterState));
    } catch (_) {}

    const params = new URLSearchParams();
    if (currentFeedUrl) params.set('feed', currentFeedUrl);
    if (currentFeedTitle && currentFeedTitle !== 'Feed Preview') params.set('title', currentFeedTitle);
    params.set('from', 'filters');
    window.location.href = `widgets.html?${params.toString()}`;
  }

  function init() {
    // Clear any stale persisted filter toggle states so they can never silently disable filters.
    // We intentionally do NOT restore boolean toggles (noImage, enabled, dupTitle, etc.)
    // across sessions — users should re-select them each visit.
    try { localStorage.removeItem('feedometer_filter_rules'); } catch (_) {}
    loadSavedState();
    setupEventListeners();
    handleUrlParams();
  }

  function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const feed = params.get('feed') || params.get('url');

    // 1. Check if transferred from Widget Studio workspace
    const rawWs = localStorage.getItem('feedometer_filter_workspace') || sessionStorage.getItem('feedometer_filter_workspace');
    if (rawWs) {
      try {
        const ws = JSON.parse(rawWs);
        if (Array.isArray(ws.articles) && ws.articles.length > 0) {
          allArticles = ws.articles;
          currentFeedUrl = ws.feedUrl || ws.url || feed || '';
          currentFeedTitle = ws.title || 'Feed Preview';
          // Only restore text/numeric preferences from saved rules — never booleans
          if (ws.rules) {
            const r = ws.rules;
            if (typeof r.oldDays === 'number' && r.oldDays > 0) filterState.oldDays = r.oldDays;
            if (r.language && r.language !== 'all') filterState.language = r.language;
            if (typeof r.includeKeywords === 'string') filterState.includeKeywords = r.includeKeywords;
            if (typeof r.excludeKeywords === 'string') filterState.excludeKeywords = r.excludeKeywords;
            if (typeof r.includeDomains === 'string') filterState.includeDomains = r.includeDomains;
            if (typeof r.excludeDomains === 'string') filterState.excludeDomains = r.excludeDomains;
          }
          filterState.enabled = true; // Always start with global filter ON
          updateTitle(currentFeedTitle);
          applyStateToControls();
          applyFilters();
          return;
        }
      } catch (_) {}
    }

    // 2. Check if recently previewed from Add Source
    const lastPrevRaw = localStorage.getItem('feedometer_last_preview') || sessionStorage.getItem('feedometer_last_preview');
    if (lastPrevRaw) {
      try {
        const lp = JSON.parse(lastPrevRaw);
        const isMatch = !feed || urlsMatch(lp.feedUrl, feed) || urlsMatch(lp.rawUrl, feed);
        if (isMatch && Array.isArray(lp.articles) && lp.articles.length > 0) {
          allArticles = lp.articles;
          currentFeedUrl = lp.feedUrl || lp.rawUrl || feed || '';
          currentFeedTitle = lp.title || lp.name || 'Feed Preview';
          updateTitle(currentFeedTitle);
          applyStateToControls();
          applyFilters();
          return;
        }
      } catch (_) {}
    }

    if (feed) {
      currentFeedUrl = feed;
      loadFeedForFiltering(feed);
    } else {
      loadSampleFeed();
    }
  }

  function loadSampleFeed() {
    allArticles = [
      { title: 'Global Tech Summit 2026 Keynote Live Stream', link: 'https://example.com/tech-summit', description: 'Complete coverage of the keynotes and announcements.', pubDate: new Date().toISOString(), image: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=600' },
      { title: 'Global Tech Summit 2026: Day 1 Keynote Live', link: 'https://example.com/tech-summit-dup', description: 'Coverage of keynotes and announcements from day one.', pubDate: new Date().toISOString(), image: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=600' },
      { title: 'Breaking Market Update: Equities Rally Broadly', link: 'http://insecure-site.com/markets', description: '', pubDate: new Date(Date.now() - 86400000 * 5).toISOString(), image: '' },
      { title: 'Sustainable Aviation Fuels Pass Commercial Test Flights', link: 'https://reuters.com/sustainable-aviation', description: 'Commercial aircraft completes transatlantic flight powered entirely by synthetic fuel.', pubDate: new Date().toISOString(), image: 'https://images.unsplash.com/photo-1509391365360-2e959784a276?w=600' }
    ];
    updateTitle('Sample Feed Preview');
    applyFilters();
  }

  let currentSortMode = 'newest';
  let localSearchQuery = '';

  function updateTitle(title) {
    const feedSpan = document.getElementById('filters-feed-name-span');
    if (feedSpan) feedSpan.textContent = title;
    const titleEl = document.getElementById('filters-page-title');
    if (titleEl && titleEl.tagName === 'SPAN') titleEl.textContent = title;
  }

  function loadSavedState() {
    // Only restore non-toggle preferences from localStorage — NEVER restore boolean
    // toggle states (noImage, dupTitle, enabled, etc.) because a stale persisted
    // enabled:false would silently disable ALL filters on every page load.
    try {
      const raw = localStorage.getItem('feedometer_filter_rules');
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved.oldDays === 'number' && saved.oldDays > 0) filterState.oldDays = saved.oldDays;
        if (saved.language && saved.language !== 'all') filterState.language = saved.language;
        if (typeof saved.includeKeywords === 'string') filterState.includeKeywords = saved.includeKeywords;
        if (typeof saved.excludeKeywords === 'string') filterState.excludeKeywords = saved.excludeKeywords;
        if (typeof saved.includeDomains === 'string') filterState.includeDomains = saved.includeDomains;
        if (typeof saved.excludeDomains === 'string') filterState.excludeDomains = saved.excludeDomains;
        // All boolean toggles (enabled, noImage, noDescription, etc.) always start as their defaults (false/true)
      }
    } catch (_) {}
    // Cloud sync: only restore text/numeric preferences, not toggle states
    if (window.FeedOmeterAuth && window.FeedOmeterAuth.isAuthenticated()) {
      fetch(getApiBase() + '/api/filters', { headers: window.FeedOmeterAuth.getAuthHeaders() })
        .then((r) => r.json())
        .then((json) => {
          if (json && json.rules && typeof json.rules === 'object') {
            const r = json.rules;
            if (typeof r.oldDays === 'number' && r.oldDays > 0) filterState.oldDays = r.oldDays;
            if (r.language && r.language !== 'all') filterState.language = r.language;
            if (typeof r.includeKeywords === 'string') filterState.includeKeywords = r.includeKeywords;
            if (typeof r.excludeKeywords === 'string') filterState.excludeKeywords = r.excludeKeywords;
            if (typeof r.includeDomains === 'string') filterState.includeDomains = r.includeDomains;
            if (typeof r.excludeDomains === 'string') filterState.excludeDomains = r.excludeDomains;
            applyStateToControls();
            applyFilters();
          }
        }).catch(() => {});
    }
    applyStateToControls();
  }

  function saveState() {
    try {
      localStorage.setItem('feedometer_filter_rules', JSON.stringify(filterState));
    } catch (_) {}
    persistCloud();
  }

  function persistCloud() {
    const headers = (window.FeedOmeterAuth && window.FeedOmeterAuth.getAuthHeaders)
      ? window.FeedOmeterAuth.getAuthHeaders()
      : { 'Content-Type': 'application/json' };
    if (!window.FeedOmeterAuth || !window.FeedOmeterAuth.isAuthenticated()) return;
    fetch(getApiBase() + '/api/filters', {
      method: 'PUT',
      headers: headers,
      body: JSON.stringify({ rules: filterState })
    }).catch(() => {});
  }

  function applyStateToControls() {
    const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };
    setCheck('filter-no-image', filterState.noImage);
    setCheck('filter-no-description', filterState.noDescription);
    setCheck('filter-no-date', filterState.noDate);
    setCheck('filter-no-secure-link', filterState.noSecureLink);
    setCheck('filter-missing-source', filterState.missingSource);
    setCheck('filter-duplicate-title', filterState.dupTitle);
    setCheck('filter-duplicate-description', filterState.dupDesc);
    setCheck('filter-duplicate-link', filterState.dupLink);
    setCheck('filter-similar-title', filterState.similarTitle);
    setCheck('filter-old-posts', filterState.oldPosts);

    const oldDaysInput = document.getElementById('filter-old-days');
    if (oldDaysInput) oldDaysInput.value = filterState.oldDays;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('filter-include-keywords', filterState.includeKeywords);
    setVal('filter-exclude-keywords', filterState.excludeKeywords);
    setVal('filter-include-domains', filterState.includeDomains);
    setVal('filter-exclude-domains', filterState.excludeDomains);

    const langSelect = document.getElementById('filter-language');
    if (langSelect) langSelect.value = filterState.language || 'all';
  }

  function setupEventListeners() {
    const bindCheck = (id, key) => {
      const el = document.getElementById(id);
      if (!el) { console.warn('[Filters] Element not found:', id); return; }
      el.addEventListener('change', function () {
        filterState[key] = this.checked;
        saveState();
        applyFilters();
      });
    };

    bindCheck('filter-no-image', 'noImage');
    bindCheck('filter-no-description', 'noDescription');
    bindCheck('filter-no-date', 'noDate');
    bindCheck('filter-no-secure-link', 'noSecureLink');
    bindCheck('filter-missing-source', 'missingSource');
    bindCheck('filter-duplicate-title', 'dupTitle');
    bindCheck('filter-duplicate-description', 'dupDesc');
    bindCheck('filter-duplicate-link', 'dupLink');
    bindCheck('filter-similar-title', 'similarTitle');
    bindCheck('filter-old-posts', 'oldPosts');

    const oldDaysInput = document.getElementById('filter-old-days');
    if (oldDaysInput) {
      const updateDays = (e) => {
        filterState.oldDays = parseInt(e.target.value, 10) || 3;
        saveState();
        applyFilters();
      };
      oldDaysInput.addEventListener('input', updateDays);
      oldDaysInput.addEventListener('change', updateDays);
    }

    const bindText = (id, key) => {
      const el = document.getElementById(id);
      if (el) {
        const updateText = (e) => {
          filterState[key] = e.target.value;
          saveState();
          applyFilters();
        };
        el.addEventListener('input', updateText);
        el.addEventListener('change', updateText);
      }
    };

    bindText('filter-include-keywords', 'includeKeywords');
    bindText('filter-exclude-keywords', 'excludeKeywords');
    bindText('filter-include-domains', 'includeDomains');
    bindText('filter-exclude-domains', 'excludeDomains');

    const langSelect = document.getElementById('filter-language');
    if (langSelect) {
      const updateLang = (e) => {
        filterState.language = e.target.value;
        saveState();
        applyFilters();
      };
      langSelect.addEventListener('change', updateLang);
      langSelect.addEventListener('input', updateLang);
    }

    const btnReset = document.getElementById('create-filter-reset');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        Object.assign(filterState, {
          noImage: false, noDescription: false, noDate: false,
          noSecureLink: false, missingSource: false, dupTitle: false, dupDesc: false,
          dupLink: false, similarTitle: false, oldPosts: false, oldDays: 3,
          includeKeywords: '', excludeKeywords: '', includeDomains: '', excludeDomains: '',
          language: 'all'
        });
        saveState();
        applyStateToControls();
        applyFilters();
      });
    }

    const btnBack = document.getElementById('filters-back-btn');
    if (btnBack) {
      btnBack.addEventListener('click', (e) => {
        e.preventDefault();
        openInWidgetStudio();
      });
    }

    const btnOpenWidget = document.getElementById('filters-btn-open-widget');
    if (btnOpenWidget) {
      btnOpenWidget.addEventListener('click', (e) => {
        e.preventDefault();
        openInWidgetStudio();
      });
    }

    const btnSidebarWidget = document.getElementById('filters-btn-sidebar-widget');
    if (btnSidebarWidget) {
      btnSidebarWidget.addEventListener('click', (e) => {
        e.preventDefault();
        openInWidgetStudio();
      });
    }

    const sortSelect = document.getElementById('filters-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        currentSortMode = e.target.value || 'newest';
        applyFilters();
      });
    }

    const localSearch = document.getElementById('filters-local-search');
    if (localSearch) {
      localSearch.addEventListener('input', (e) => {
        localSearchQuery = (e.target.value || '').trim().toLowerCase();
        applyFilters();
      });
    }

    const btnViewCards = document.getElementById('filters-btn-view-cards');
    const btnViewList = document.getElementById('filters-btn-view-list');
    const previewList = document.getElementById('create-filter-preview-list');

    if (btnViewCards && btnViewList && previewList) {
      btnViewCards.addEventListener('click', () => {
        previewList.className = 'view-cards';
        btnViewCards.classList.add('active');
        btnViewList.classList.remove('active');
      });
      btnViewList.addEventListener('click', () => {
        previewList.className = 'view-list';
        btnViewList.classList.add('active');
        btnViewCards.classList.remove('active');
      });
    }
  }

  // Token Jaccard Similarity Algorithm (>= 74%)
  function getTokens(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
  }

  function jaccardSimilarity(arr1, arr2) {
    if (!arr1.length || !arr2.length) return 0;
    const set1 = new Set(arr1);
    const set2 = new Set(arr2);
    let intersection = 0;
    set1.forEach(t => { if (set2.has(t)) intersection++; });
    const union = new Set([...arr1, ...arr2]).size;
    return union ? (intersection / union) : 0;
  }

  function applyFilters() {
    const counts = {
      noImage: 0, noDescription: 0, noDate: 0, noSecureLink: 0, missingSource: 0,
      dupTitle: 0, dupDesc: 0, dupLink: 0, similarTitle: 0, oldPosts: 0
    };

    const seenTitles = new Set();
    const seenDescs = new Set();
    const seenLinks = new Set();
    const processedTokens = [];

    const visible = [];

    allArticles.forEach((art, idx) => {
      let hide = false;

      // Quality: Image
      const hasImg = Boolean(art.image || art.image_url || art.thumbnail || art.ogImage || art.hero_image || (art.enclosure && art.enclosure.url));
      if (!hasImg) counts.noImage++;
      if (filterState.noImage && !hasImg) hide = true;

      // Quality: Description
      const hasDesc = Boolean((art.description || art.summary || art.snippet || '').replace(/<[^>]+>/g, '').trim());
      if (!hasDesc) counts.noDescription++;
      if (filterState.noDescription && !hasDesc) hide = true;

      // Quality: Date
      const rawDate = art.pubDate || art.published || art.date || art.isoDate || art.publishedAt;
      const hasDate = Boolean(rawDate);
      if (!hasDate) counts.noDate++;
      if (filterState.noDate && !hasDate) hide = true;

      // Quality: Secure Link
      const isSecure = String(art.link || art.url || '').startsWith('https://');
      if (!isSecure) counts.noSecureLink++;
      if (filterState.noSecureLink && !isSecure) hide = true;

      // Quality: Missing Source
      const hasSource = Boolean(art.source);
      if (!hasSource) counts.missingSource++;
      if (filterState.missingSource && !hasSource) hide = true;

      // Duplicate Title
      const cleanTitle = (art.title || '').trim().toLowerCase();
      if (seenTitles.has(cleanTitle)) {
        counts.dupTitle++;
        if (filterState.dupTitle) hide = true;
      }
      seenTitles.add(cleanTitle);

      // Jaccard Token Similarity
      const tokens = getTokens(art.title);
      let isSimilar = false;
      for (const prevTokens of processedTokens) {
        if (jaccardSimilarity(tokens, prevTokens) >= 0.74) {
          isSimilar = true;
          break;
        }
      }
      if (isSimilar) {
        counts.similarTitle++;
        if (filterState.similarTitle) hide = true;
      }
      processedTokens.push(tokens);

      // Freshness: Age in Days
      if (rawDate) {
        const timeMs = new Date(rawDate).getTime();
        if (!isNaN(timeMs) && timeMs > 0) {
          const ageDays = (Date.now() - timeMs) / (86400000);
          if (ageDays > (filterState.oldDays || 3)) {
            counts.oldPosts++;
            if (filterState.oldPosts) hide = true;
          }
        }
      }

      // Keywords Include / Exclude
      if (filterState.includeKeywords) {
        const inc = filterState.includeKeywords.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        const textTarget = (cleanTitle + ' ' + (art.description || '')).toLowerCase();
        if (inc.length && !inc.some(k => textTarget.includes(k))) hide = true;
      }
      if (filterState.excludeKeywords) {
        const exc = filterState.excludeKeywords.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        const textTarget = (cleanTitle + ' ' + (art.description || '')).toLowerCase();
        if (exc.some(k => textTarget.includes(k))) hide = true;
      }

      // Domains Include / Exclude
      if ((filterState.includeDomains || filterState.excludeDomains) && art.link) {
        try {
          const host = new URL(art.link).hostname.toLowerCase().replace(/^www\./, '');
          if (filterState.includeDomains) {
            const incDom = filterState.includeDomains.toLowerCase().split(',').map(s => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
            if (incDom.length && !incDom.some(d => host.includes(d))) hide = true;
          }
          if (filterState.excludeDomains) {
            const excDom = filterState.excludeDomains.toLowerCase().split(',').map(s => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
            if (excDom.some(d => host.includes(d))) hide = true;
          }
        } catch (_) {}
      }


      // Language
      if (filterState.language && filterState.language !== 'all') {
        const itemLang = (art.language || art.lang || '').toLowerCase();
        if (itemLang && itemLang !== filterState.language.toLowerCase() && !itemLang.startsWith(filterState.language.toLowerCase())) {
          hide = true;
        }
      }

      if (!hide) visible.push(art);
    });

    // Apply local keyword search if typed in search bar
    let displayArticles = visible;
    if (localSearchQuery) {
      displayArticles = visible.filter(art => {
        const text = ((art.title || '') + ' ' + (art.description || '') + ' ' + (art.source || '')).toLowerCase();
        return text.includes(localSearchQuery);
      });
    }

    // Apply sort
    displayArticles.sort((a, b) => {
      if (currentSortMode === 'newest' || currentSortMode === 'oldest') {
        const dateA = new Date(a.pubDate || a.published || a.date || a.isoDate || a.publishedAt || 0).getTime() || 0;
        const dateB = new Date(b.pubDate || b.published || b.date || b.isoDate || b.publishedAt || 0).getTime() || 0;
        return currentSortMode === 'newest' ? dateB - dateA : dateA - dateB;
      }
      if (currentSortMode === 'title') {
        return (a.title || '').localeCompare(b.title || '');
      }
      if (currentSortMode === 'source') {
        const sA = typeof a.source === 'string' ? a.source : (a.source && a.source.title) || '';
        const sB = typeof b.source === 'string' ? b.source : (b.source && b.source.title) || '';
        return sA.localeCompare(sB);
      }
      return 0;
    });

    currentFilteredArticles = displayArticles;

    // Update Counter Badges
    const setBadge = (id, count) => { const el = document.getElementById(id); if (el) el.textContent = count; };
    setBadge('count-no-image', counts.noImage);
    setBadge('count-no-description', counts.noDescription);
    setBadge('count-no-date', counts.noDate);
    setBadge('count-no-secure-link', counts.noSecureLink);
    setBadge('count-missing-source', counts.missingSource);
    setBadge('count-duplicate-title', counts.dupTitle);
    setBadge('count-similar-title', counts.similarTitle);
    setBadge('count-old-posts', counts.oldPosts);

    const statsBadge = document.getElementById('create-filter-stats');
    if (statsBadge) statsBadge.textContent = `${displayArticles.length} of ${allArticles.length} visible`;

    const pageCountBadge = document.getElementById('filters-page-count');
    if (pageCountBadge) pageCountBadge.textContent = `${displayArticles.length} items visible`;

    renderPreviewList(displayArticles);
  }

  function renderPreviewList(articles) {
    const list = document.getElementById('create-filter-preview-list');
    if (!list) return;

    if (!articles.length) {
      list.innerHTML = `
        <div style="grid-column: 1 / -1; text-align:center; padding:3rem 1rem; color:#64748b;">
          <div style="font-size:2.2rem; margin-bottom:0.5rem;">🔍</div>
          <div style="font-weight:750; font-size:1.05rem; color:#1e293b; margin-bottom:0.35rem;">No matching articles</div>
          <p style="font-size:0.85rem; margin:0;">Try adjusting or toggling off some of your filter rules in the left sidebar.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = articles.map(art => {
      let host = 'SOURCE';
      if (art.link) {
        try { host = new URL(art.link).hostname.replace(/^www\./i, ''); } catch (_) {}
      } else if (art.source) {
        host = typeof art.source === 'string' ? art.source : (art.source.title || 'SOURCE');
      }

      const rawImg = art.image || art.image_url || art.thumbnail || art.ogImage || art.hero_image || (art.enclosure && art.enclosure.url) || '';
      const img = (window.FeedImaging && typeof window.FeedImaging.upgradeUrl === 'function')
        ? window.FeedImaging.upgradeUrl(rawImg)
        : (window.upgradeImageUrl ? window.upgradeImageUrl(rawImg) : rawImg);
      const mediaHtml = img
        ? `<div class="filter-preview-media"><img src="${img}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentElement.innerHTML='<div class=\\'filter-preview-placeholder\\'><span>📰</span></div>';" /></div>`
        : `<div class="filter-preview-media"><div class="filter-preview-placeholder"><span>📰</span></div></div>`;

      let dateStr = '';
      if (art.pubDate) {
        try {
          const d = new Date(art.pubDate);
          if (!isNaN(d.getTime())) {
            dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          }
        } catch (_) {}
      }

      const cleanTitle = (art.title || 'Untitled Story').replace(/<[^>]+>/g, '').trim();
      const cleanSnippet = (art.description || art.summary || art.snippet || '').replace(/<[^>]+>/g, '').trim().slice(0, 160);

      return `
        <article class="filter-preview-card">
          ${mediaHtml}
          <div class="filter-preview-body">
            <div class="filter-preview-meta">
              <span class="filter-preview-domain">${host}</span>
              ${dateStr ? `<span>${dateStr}</span>` : ''}
            </div>
            <a class="filter-preview-title" href="${art.link || '#'}" target="_blank" rel="noopener noreferrer" title="${cleanTitle}">${cleanTitle}</a>
            ${cleanSnippet ? `<p class="filter-preview-desc">${cleanSnippet}...</p>` : ''}
          </div>
        </article>
      `;
    }).join('');

    if (window.FeedImaging && typeof window.FeedImaging.enhanceImages === 'function') {
      window.FeedImaging.enhanceImages(list);
    } else if (window.SmartCrop && typeof window.SmartCrop.applyAll === 'function') {
      window.SmartCrop.applyAll(list);
    }
  }

  let filterPollTimer = null;
  let filterPreviewJobId = '';

  function pollFilterPreview() {
    if (!filterPreviewJobId) return;
    window.clearTimeout(filterPollTimer);
    filterPollTimer = window.setTimeout(async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/feed-preview/${encodeURIComponent(filterPreviewJobId)}`);
        if (!res.ok) { filterPreviewJobId = ''; return; }
        const data = await res.json();
        if (data.articles && data.articles.length > allArticles.length) {
          allArticles = data.articles;
          applyFilters();
        }
        if (data.progress && !data.progress.complete) {
          pollFilterPreview();
        } else {
          filterPreviewJobId = '';
        }
      } catch (_) {
        pollFilterPreview();
      }
    }, 1200);
  }

  async function loadFeedForFiltering(feedUrl) {
    try {
      let target = feedUrl;
      try {
        if (feedUrl.includes('/api/view')) {
          const parsed = new URL(feedUrl, window.location.origin || 'http://127.0.0.1:8787');
          target = parsed.searchParams.get('url') || parsed.searchParams.get('q') || feedUrl;
        }
      } catch (_) {}

      const res = await fetch(getApiBase() + '/api/feed-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target, limit: 250, enrichOg: true })
      });
      const data = await res.json();
      if (res.ok && data.articles && data.articles.length > 0) {
        allArticles = data.articles;
        updateTitle(data.name || 'Feed Preview');
        applyFilters();

        if (data.job_id && data.progress && !data.progress.complete) {
          filterPreviewJobId = data.job_id;
          pollFilterPreview();
        }
      }
    } catch (_) {
      loadSampleFeed();
    }
  }

  window.addEventListener('DOMContentLoaded', init);

})(window, document);
