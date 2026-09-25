/**
 * scripts/feedometer-filters.js — FeedOmeter 2.1 Feed Filter Workspace Controller
 * Quality Checks, Jaccard Similarity Duplicate Detection (>=74%), Freshness & Keywords
 */

(function (window, document) {
  'use strict';

  function getApiBase() {
    if (window.FEEDOMETER_CONFIG && window.FEEDOMETER_CONFIG.API_BASE) {
      return window.FEEDOMETER_CONFIG.API_BASE.replace(/\/+$/, '');
    }
    return 'https://feedometer-api.feedometer.workers.dev';
  }

  const filterState = {
    enabled: true,
    noImage: false,
    noDescription: true,
    noDate: false,
    noSecureLink: false,
    missingSource: false,
    dupTitle: true,
    dupDesc: false,
    dupLink: false,
    similarTitle: false,
    oldPosts: false,
    oldDays: 3,
    includeKeywords: '',
    excludeKeywords: '',
    includeDomains: '',
    excludeDomains: ''
  };

  let allArticles = [];

  function init() {
    loadSavedState();
    setupEventListeners();
    handleUrlParams();
  }

  function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const feed = params.get('feed') || params.get('url');
    if (feed) {
      loadFeedForFiltering(feed);
    } else {
      // Load from filter workspace if saved or load sample
      const rawWs = localStorage.getItem('feedometer_filter_workspace');
      if (rawWs) {
        try {
          const ws = JSON.parse(rawWs);
          if (ws.articles && ws.articles.length) {
            allArticles = ws.articles;
            updateTitle(ws.title || 'Feed Preview');
            applyFilters();
            return;
          }
        } catch (_) {}
      }
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

  function updateTitle(title) {
    const titleEl = document.getElementById('filters-page-title');
    if (titleEl) titleEl.textContent = title;
  }

  function loadSavedState() {
    try {
      const raw = localStorage.getItem('feedometer_filter_rules');
      if (raw) Object.assign(filterState, JSON.parse(raw));
    } catch (_) {}
    if (window.FeedOmeterAuth && window.FeedOmeterAuth.isAuthenticated()) {
      fetch(getApiBase() + '/api/filters', { headers: window.FeedOmeterAuth.getAuthHeaders() })
        .then((r) => r.json())
        .then((json) => {
          if (json && json.rules && typeof json.rules === 'object') {
            Object.assign(filterState, json.rules);
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
    setCheck('create-filter-enabled', filterState.enabled);
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
  }

  function setupEventListeners() {
    const bindCheck = (id, key) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', (e) => { filterState[key] = e.target.checked; saveState(); applyFilters(); });
    };

    bindCheck('create-filter-enabled', 'enabled');
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
      oldDaysInput.addEventListener('input', (e) => {
        filterState.oldDays = parseInt(e.target.value, 10) || 3;
        saveState();
        applyFilters();
      });
    }

    const bindText = (id, key) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', (e) => { filterState[key] = e.target.value; saveState(); applyFilters(); });
    };

    bindText('filter-include-keywords', 'includeKeywords');
    bindText('filter-exclude-keywords', 'excludeKeywords');
    bindText('filter-include-domains', 'includeDomains');
    bindText('filter-exclude-domains', 'excludeDomains');

    const btnReset = document.getElementById('create-filter-reset');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        Object.assign(filterState, {
          enabled: true, noImage: false, noDescription: false, noDate: false,
          noSecureLink: false, missingSource: false, dupTitle: false, dupDesc: false,
          dupLink: false, similarTitle: false, oldPosts: false, oldDays: 3,
          includeKeywords: '', excludeKeywords: '', includeDomains: '', excludeDomains: ''
        });
        saveState();
        applyStateToControls();
        applyFilters();
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

      // Quality
      if (!art.image) counts.noImage++;
      if (filterState.enabled && filterState.noImage && !art.image) hide = true;

      const hasDesc = Boolean(art.description && art.description.trim());
      if (!hasDesc) counts.noDescription++;
      if (filterState.enabled && filterState.noDescription && !hasDesc) hide = true;

      const hasDate = Boolean(art.pubDate);
      if (!hasDate) counts.noDate++;
      if (filterState.enabled && filterState.noDate && !hasDate) hide = true;

      const isSecure = String(art.link || '').startsWith('https://');
      if (!isSecure) counts.noSecureLink++;
      if (filterState.enabled && filterState.noSecureLink && !isSecure) hide = true;

      // Duplicate Title
      const cleanTitle = (art.title || '').trim().toLowerCase();
      if (seenTitles.has(cleanTitle)) {
        counts.dupTitle++;
        if (filterState.enabled && filterState.dupTitle) hide = true;
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
        if (filterState.enabled && filterState.similarTitle) hide = true;
      }
      processedTokens.push(tokens);

      // Freshness
      if (art.pubDate) {
        const ageDays = (Date.now() - new Date(art.pubDate).getTime()) / (86400000);
        if (ageDays > filterState.oldDays) {
          counts.oldPosts++;
          if (filterState.enabled && filterState.oldPosts) hide = true;
        }
      }

      // Keywords Include / Exclude
      if (filterState.enabled && filterState.includeKeywords) {
        const inc = filterState.includeKeywords.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        if (inc.length && !inc.some(k => cleanTitle.includes(k))) hide = true;
      }
      if (filterState.enabled && filterState.excludeKeywords) {
        const exc = filterState.excludeKeywords.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        if (exc.some(k => cleanTitle.includes(k))) hide = true;
      }

      if (!hide) visible.push(art);
    });

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
    if (statsBadge) statsBadge.textContent = `${visible.length} of ${allArticles.length} visible`;

    const pageCountBadge = document.getElementById('filters-page-count');
    if (pageCountBadge) pageCountBadge.textContent = `${visible.length} items visible`;

    renderPreviewList(visible);
  }

  function renderPreviewList(articles) {
    const list = document.getElementById('create-filter-preview-list');
    if (!list) return;

    if (!articles.length) {
      list.innerHTML = '<p style="color:#64748b; font-size:0.9rem; padding:1rem; text-align:center;">No articles match the current filter criteria.</p>';
      return;
    }

    list.innerHTML = articles.map(art => {
      const host = art.link ? new URL(art.link).hostname.replace(/^www\./i, '') : 'Feed';
      const dateStr = art.pubDate ? new Date(art.pubDate).toLocaleDateString() : '';
      return `
        <div class="filter-preview-item">
          <div>
            <a class="filter-preview-title" href="${art.link || '#'}" target="_blank" rel="noopener noreferrer">${art.title || 'Untitled'}</a>
            <div class="filter-preview-meta">${host} ${dateStr ? '• ' + dateStr : ''}</div>
          </div>
          ${art.image ? '<span style="font-size:1.1rem;">🖼️</span>' : ''}
        </div>
      `;
    }).join('');
  }

  async function loadFeedForFiltering(feedUrl) {
    try {
      const res = await fetch(getApiBase() + '/api/feed-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: feedUrl, limit: 35, enrichOg: true })
      });
      const data = await res.json();
      if (res.ok && data.articles && data.articles.length > 0) {
        allArticles = data.articles;
        updateTitle(data.name || 'Feed Preview');
        applyFilters();
      }
    } catch (_) {
      loadSampleFeed();
    }
  }

  window.addEventListener('DOMContentLoaded', init);

})(window, document);
