/**
 * scripts/feedometer-add-source.js — FeedOmeter 2.1 Add Source & RSS Builder Controller
 * Connects to FeedOmeter Unified API (/api/feed-preview, /api/build, /api/subscriptions)
 */

(function (window, document) {
  'use strict';

  function getApiBase() {
    // Keep Add Source aligned with the shared configuration contract. The
    // local test launcher supplies `API_BASE_URL`/`WORKER_URL`; accepting only
    // the obsolete `API_BASE` key silently sent this page to production.
    const configured = window.FEEDOMETER_API_BASE ||
      (window.FEEDOMETER_CONFIG && (
        window.FEEDOMETER_CONFIG.API_BASE ||
        window.FEEDOMETER_CONFIG.API_BASE_URL ||
        window.FEEDOMETER_CONFIG.WORKER_URL ||
        window.FEEDOMETER_CONFIG.apiBaseUrl
      ));
    if (configured) return String(configured).replace(/\/+$/, '');
    return 'https://feedometer-api.feedometer.workers.dev';
  }

  function getAuthHeaders() {
    if (window.FeedOmeterAuth && typeof window.FeedOmeterAuth.getAuthHeaders === 'function') {
      return window.FeedOmeterAuth.getAuthHeaders();
    }
    const token = localStorage.getItem('feedometer_token') || '';
    return token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  function decodeEntities(str) {
    if (!str) return '';
    const txt = document.createElement('textarea');
    txt.innerHTML = str;
    return txt.value;
  }

  // State
  let currentArticles = [];
  let currentFeedMeta = null;
  let currentFeedUrl = '';
  let currentXml = '';
  let activeSort = 'latest';
  let activeTab = 'overview';
  let currentDetected = null;
  let userFollowedUrls = new Set();

  const TLD_REGEX = /\.(com|org|net|io|ai|co|app|dev|news|info|biz|me|tech|blog|tv|online|site|space|xyz|gov|edu|uk|us|in|eu|de|fr|jp|ca|au|br|ru|ch|nl|se|no|es|it|nz|asia|media|world|global|live|club|agency|today|top|vip|digital|cloud|studio|design|store|shop|link|click|stream)([\/:?#]|$)/i;

  function detectClientSourceType(rawInput) {
    const input = String(rawInput || '').trim();
    if (!input) return null;

    // YouTube
    if (/^@([a-zA-Z0-9_.-]+)$/i.test(input)) {
      const handle = input.replace(/^@/, '');
      return { type: 'youtube', subtype: 'handle', label: 'YouTube Channel', icon: '📺', color: '#ef4444', bg: '#fee2e2', hint: `Will resolve official YouTube video feed for @${handle}` };
    }
    if (/^(https?:\/\/)?(www\.|m\.)?youtube\.com\//i.test(input) || /^(https?:\/\/)?youtu\.be\//i.test(input)) {
      return { type: 'youtube', subtype: 'url', label: 'YouTube', icon: '📺', color: '#ef4444', bg: '#fee2e2', hint: 'Will resolve official YouTube RSS feed' };
    }

    // Reddit
    if (/^r\/([a-zA-Z0-9_]+)$/i.test(input)) {
      const sub = input.match(/^r\/([a-zA-Z0-9_]+)$/i)[1];
      return { type: 'reddit', subtype: 'sub', label: 'Reddit Subreddit', icon: '🔴', color: '#ff4500', bg: '#ffedd5', hint: `Will connect to Reddit native stream for r/${sub}` };
    }
    if (/^u\/([a-zA-Z0-9_-]+)$/i.test(input)) {
      const user = input.match(/^u\/([a-zA-Z0-9_-]+)$/i)[1];
      return { type: 'reddit', subtype: 'user', label: 'Reddit User', icon: '👤', color: '#ff4500', bg: '#ffedd5', hint: `Will connect to Reddit user feed for u/${user}` };
    }
    if (/^(https?:\/\/)?(www\.|old\.|new\.)?reddit\.com\//i.test(input)) {
      return { type: 'reddit', subtype: 'url', label: 'Reddit', icon: '🔴', color: '#ff4500', bg: '#ffedd5', hint: 'Will connect to native Reddit RSS stream' };
    }

    // Direct RSS/Atom
    if (/(\.(rss|atom|xml)($|\?))|(\/(feed|rss|rss\.xml|atom\.xml|index\.xml|feed\/)($|\?))|([\?&](format=xml|feed=rss))/i.test(input)) {
      return { type: 'rss_atom', label: 'Direct RSS Feed', icon: '⚡', color: '#d97706', bg: '#fef3c7', hint: 'Direct RSS/Atom feed detected' };
    }

    // Standard Website
    if (/^https?:\/\//i.test(input) || (!/\s/.test(input) && TLD_REGEX.test(input))) {
      return { type: 'website', label: 'Website Scrape', icon: '🌐', color: '#0284c7', bg: '#e0f2fe', hint: 'Will discover RSS feed or extract article stream with Open Graph images' };
    }

    // Keyword / Topic
    return { type: 'keyword', label: 'Topic Feed', icon: '🔍', color: '#7c3aed', bg: '#ede9fe', hint: `Will generate a virtual topic stream for "${input}"` };
  }

  function updateDetectionUi(query) {
    const badge = document.getElementById('source-detected-badge');
    const hint = document.getElementById('source-detected-hint');
    const detected = detectClientSourceType(query);
    currentDetected = detected;

    if (!detected || !query.trim()) {
      if (badge) badge.style.display = 'none';
      if (hint) hint.style.display = 'none';
      return;
    }

    if (badge) {
      badge.style.display = 'inline-flex';
      badge.style.background = detected.bg || '#f1f5f9';
      badge.style.color = detected.color || '#334155';
      badge.innerHTML = `<span>${detected.icon}</span> <span>${detected.label}</span>`;
    }

    if (hint) {
      hint.style.display = 'flex';
      hint.innerHTML = `<span>💡</span> <span>${detected.hint}</span>`;
    }
  }

  async function refreshUserSubscriptions() {
    userFollowedUrls = new Set();
    if (window.FeedOmeterAuth && window.FeedOmeterAuth.isAuthenticated()) {
      try {
        const data = await window.FeedOmeterAuth.getSubscriptions();
        if (data && (data.status === 'success' || Array.isArray(data.subscriptions))) {
          const list = data.subscriptions || [];
          list.forEach(s => {
            const u = (s.feed_url || s.url || '').trim().toLowerCase();
            if (u) userFollowedUrls.add(u);
          });
        }
      } catch (e) {
        console.warn('Could not refresh subscriptions:', e);
      }
    }
    // Also merge guest subscriptions from FeedOmeterAuth, localStorage and sessionStorage
    try {
      let guestList = [];
      if (window.FeedOmeterAuth && typeof window.FeedOmeterAuth.getGuestFollows === 'function') {
        guestList = window.FeedOmeterAuth.getGuestFollows();
      }
      if (!Array.isArray(guestList) || guestList.length === 0) {
        const raw = localStorage.getItem('feedometer_guest_subscriptions') || sessionStorage.getItem('feedometer_guest_subscriptions');
        if (raw) guestList = JSON.parse(raw);
      }
      if (Array.isArray(guestList)) {
        guestList.forEach(g => {
          const u = (g.feed_url || g.url || '').trim().toLowerCase();
          if (u) userFollowedUrls.add(u);
        });
      }
    } catch (e) {}
  }

  function isFeedFollowed(feedUrl) {
    if (!feedUrl) return false;
    const clean = feedUrl.trim().toLowerCase();
    return userFollowedUrls.has(clean);
  }

  function init() {
    refreshUserSubscriptions();
    setupEventListeners();
    handleUrlParams();
  }

  function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q') || params.get('url') || params.get('site');
    if (q) {
      const input = document.getElementById('add-source-query');
      if (input) {
        input.value = q;
        updateDetectionUi(q);
      }
      retrieveFeed(q);
    }
  }

  function setupEventListeners() {
    const input = document.getElementById('add-source-query');
    if (input) {
      input.addEventListener('input', (e) => {
        updateDetectionUi(e.target.value);
      });
    }

    const form = document.getElementById('add-source-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('add-source-query');
        if (input && input.value.trim()) {
          retrieveFeed(input.value.trim());
        }
      });
    }

    const btnRefresh = document.getElementById('btn-top-refresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        const input = document.getElementById('add-source-query');
        if (input && input.value.trim()) {
          retrieveFeed(input.value.trim());
        } else {
          resetView();
        }
      });
    }

    // Copy Feed URL
    const btnCopyFeedUrl = document.getElementById('btn-copy-feed-url');
    if (btnCopyFeedUrl) {
      btnCopyFeedUrl.addEventListener('click', () => {
        const urlInput = document.getElementById('overview-feed-url');
        if (urlInput && urlInput.value) {
          navigator.clipboard.writeText(urlInput.value).then(() => {
            showToast('Feed URL copied to clipboard!');
          });
        }
      });
    }

    // Copy Vanity URL
    const btnCopyVanityUrl = document.getElementById('btn-copy-vanity-url');
    if (btnCopyVanityUrl) {
      btnCopyVanityUrl.addEventListener('click', () => {
        const vanityInput = document.getElementById('overview-vanity-url');
        if (vanityInput && vanityInput.value) {
          navigator.clipboard.writeText(vanityInput.value).then(() => {
            showToast('Shareable branded URL copied!');
          });
        }
      });
    }

    // Copy XML
    const btnCopyXml = document.getElementById('btn-copy-xml');
    if (btnCopyXml) {
      btnCopyXml.addEventListener('click', () => {
        const xmlTa = document.getElementById('xml-output');
        if (xmlTa && xmlTa.value) {
          navigator.clipboard.writeText(xmlTa.value).then(() => {
            showToast('RSS 2.0 XML copied!');
          });
        }
      });
    }

    // Follow Feed Button
    const btnFollowFeed = document.getElementById('btn-follow-feed');
    if (btnFollowFeed) {
      btnFollowFeed.addEventListener('click', handleFollowClick);
    }

    // Sub-Tabs
    document.querySelectorAll('.source-tool-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tool = e.currentTarget.getAttribute('data-tool');
        if (tool) switchTab(tool);
      });
    });

    // Sorting
    const btnSortLatest = document.getElementById('sort-latest');
    const btnSortOldest = document.getElementById('sort-oldest');
    if (btnSortLatest && btnSortOldest) {
      btnSortLatest.addEventListener('click', () => {
        activeSort = 'latest';
        btnSortLatest.classList.add('is-active');
        btnSortOldest.classList.remove('is-active');
        renderArticles();
      });
      btnSortOldest.addEventListener('click', () => {
        activeSort = 'oldest';
        btnSortOldest.classList.add('is-active');
        btnSortLatest.classList.remove('is-active');
        renderArticles();
      });
    }

    // OPML Import
    const opmlInput = document.getElementById('add-source-opml-input');
    if (opmlInput) {
      opmlInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showToast(`Importing ${file.name}...`);
        try {
          const xmlText = await file.text();
          const token = window.FeedOmeterAuth ? window.FeedOmeterAuth.getToken() : null;
          const res = await fetch(getApiBase() + '/api/opml/import', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/xml',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: xmlText
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Import failed');

          const s = data.stats || {};
          showToast(`✅ Imported ${s.subscriptions_created || 0} feeds across ${s.folders_created || 0} folders!`);
          await refreshUserSubscriptions();
          updateFollowButtonUi();
        } catch (err) {
          showToast('❌ Import error: ' + err.message);
        } finally {
          opmlInput.value = '';
        }
      });
    }
  }

  function showToast(msg) {
    let toast = document.getElementById('feedo-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'feedo-toast';
      toast.className = 'feedo-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, 2500);
  }

  function switchTab(toolName) {
    activeTab = toolName;
    document.querySelectorAll('.source-tool-tab').forEach(t => {
      const isMatch = t.getAttribute('data-tool') === toolName;
      t.classList.toggle('is-active', isMatch);
      t.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });

    document.querySelectorAll('.source-tool-panel').forEach(p => {
      const isMatch = p.getAttribute('data-panel') === toolName;
      p.hidden = !isMatch;
    });

    if (toolName === 'widgets') {
      const btnWidgetStudio = document.getElementById('btn-open-widget-studio');
      if (btnWidgetStudio && currentFeedUrl) {
        const isKeyword = currentDetected && currentDetected.type === 'keyword';
        const publicFeedUrl = getApiBase() + (isKeyword ? '/api/view?q=' : '/api/view?url=') + encodeURIComponent(currentFeedUrl);
        btnWidgetStudio.href = 'widgets.html?feed=' + encodeURIComponent(publicFeedUrl);
      }
    }
  }

  function renderDiscoveryRecovery(statusBox, recovery) {
    if (!statusBox) return;
    const suggestions = Array.isArray(recovery && recovery.suggestions) && recovery.suggestions.length
      ? recovery.suggestions
      : ['Paste an RSS/Atom URL', 'Search FeedOmeter’s directory', 'Try Visual Builder for an accessible page'];
    statusBox.style.display = 'block';
    statusBox.innerHTML = `
      <div class="status-error">
        <strong>We could not access this website directly.</strong>
        <span>It may use bot protection, rate limiting, or site restrictions.</span>
        <ul>${suggestions.map((suggestion) => `<li>${suggestion}</li>`).join('')}</ul>
      </div>`;
  }

  async function retrieveFeed(query) {
    const rawTarget = String(query || '').trim();
    if (!rawTarget) return;

    const btn = document.getElementById('btn-retrieve');
    const statusBox = document.getElementById('retrieve-status');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-btn-circle"></span>';
    }
    let loadingMsg = 'Fetching source and extracting high-resolution Open Graph images...';
    if (currentDetected) {
      if (currentDetected.type === 'youtube') loadingMsg = 'Resolving official YouTube channel video feed and thumbnails...';
      else if (currentDetected.type === 'reddit') loadingMsg = 'Connecting to native Reddit RSS stream...';
      else if (currentDetected.type === 'keyword') loadingMsg = `Synthesizing topic feed articles for "${rawTarget}"...`;
      else if (currentDetected.type === 'rss_atom') loadingMsg = 'Parsing live RSS/Atom XML feed...';
    }

    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.innerHTML = `
        <div class="status-loading">
          <div class="feedo-spinner"></div>
          <span>${loadingMsg}</span>
        </div>
      `;
    }

    try {
      const res = await fetch(getApiBase() + '/api/feed-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawTarget, limit: 35, enrichOg: true })
      });

      const data = await res.json();
      if (!res.ok || data.status === 'error' || !data.articles || data.articles.length === 0) {
        const recovery = data.recovery;
        if (recovery && recovery.type === 'site_access_restricted') {
          renderDiscoveryRecovery(statusBox, recovery);
          return;
        }
        throw new Error(data.message || 'Could not extract articles from this source.');
      }

      currentArticles = data.articles || [];
      currentFeedMeta = data.meta || {};
      currentFeedUrl = data.url || rawTarget;
      currentXml = data.xml || '';

      displayFeedOverview(data);
      if (statusBox) statusBox.style.display = 'none';

    } catch (err) {
      if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.innerHTML = `<div class="status-error">⚠️ ${err.message}</div>`;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
      }
    }
  }

  function displayFeedOverview(data) {
    const overviewSection = document.getElementById('add-source-overview');
    const titleEl = document.getElementById('overview-feed-title');
    const feedUrlInput = document.getElementById('overview-feed-url');
    const vanityUrlInput = document.getElementById('overview-vanity-url');
    const xmlOutput = document.getElementById('xml-output');
    const xmlAccordion = document.getElementById('accordion-xml');
    const sortWrap = document.getElementById('sort-control-wrap');
    const btnWidgetStudio = document.getElementById('btn-open-widget-studio');

    const feedTitle = (data.meta && data.meta.title) || data.name || 'Your Feed';
    if (overviewSection) overviewSection.hidden = false;
    if (titleEl) titleEl.textContent = feedTitle;
    
    // API Feed URL
    const isKeyword = currentDetected && currentDetected.type === 'keyword';
    const publicFeedUrl = getApiBase() + (isKeyword ? '/api/view?q=' : '/api/view?url=') + encodeURIComponent(currentFeedUrl);
    if (feedUrlInput) feedUrlInput.value = publicFeedUrl;

    // Save state to sessionStorage for zero-lag instant transition to Widget Studio & Reader
    try {
      sessionStorage.setItem('feedometer_last_preview', JSON.stringify({
        feedUrl: publicFeedUrl,
        rawUrl: currentFeedUrl,
        title: feedTitle,
        name: feedTitle,
        articles: currentArticles,
        xml: currentXml,
        meta: currentFeedMeta,
        timestamp: Date.now()
      }));
    } catch (_) {}

    // Branded Vanity Link
    const vanityUrl = 'https://feedometer.pages.dev/rss?feed=' + encodeURIComponent(currentFeedUrl);
    if (vanityUrlInput) vanityUrlInput.value = vanityUrl;

    // Widget Studio Link
    if (btnWidgetStudio) {
      btnWidgetStudio.href = 'widgets.html?feed=' + encodeURIComponent(publicFeedUrl);
      btnWidgetStudio.onclick = function (e) {
        try {
          sessionStorage.setItem('feedometer_last_preview', JSON.stringify({
            feedUrl: publicFeedUrl,
            rawUrl: currentFeedUrl,
            title: feedTitle,
            name: feedTitle,
            articles: currentArticles,
            xml: currentXml,
            meta: currentFeedMeta,
            timestamp: Date.now()
          }));
        } catch (_) {}
      };
    }

    // XML Accordion
    if (xmlOutput) xmlOutput.value = currentXml;
    if (xmlAccordion) xmlAccordion.style.display = currentXml ? 'block' : 'none';

    if (sortWrap) sortWrap.style.display = 'flex';

    activeSort = 'latest';
    const btnSortLatest = document.getElementById('sort-latest');
    const btnSortOldest = document.getElementById('sort-oldest');
    if (btnSortLatest) btnSortLatest.classList.add('is-active');
    if (btnSortOldest) btnSortOldest.classList.remove('is-active');

    updateFollowButtonUi();
    renderArticles();
  }

  function parseArticleTimestamp(article) {
    const raw = article.pubDate || article.published || article.date || article.isoDate || article.updated || article.timestamp;
    if (raw) {
      const t = new Date(raw).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    return 0;
  }

  function renderArticles() {
    const grid = document.getElementById('articles-grid');
    if (!grid) return;

    grid.innerHTML = '';
    if (!currentArticles || !currentArticles.length) {
      grid.innerHTML = '<p class="articles-empty">No articles found in this feed.</p>';
      return;
    }

    // Check if articles have distinct timestamps
    const timestamps = currentArticles.map(a => parseArticleTimestamp(a));
    const uniqueTimestamps = new Set(timestamps.filter(t => t > 0));
    const hasDistinctDates = uniqueTimestamps.size > 1;

    let sorted = currentArticles.slice();
    if (hasDistinctDates) {
      if (activeSort === 'latest') {
        sorted.sort((a, b) => parseArticleTimestamp(b) - parseArticleTimestamp(a));
      } else {
        sorted.sort((a, b) => parseArticleTimestamp(a) - parseArticleTimestamp(b));
      }
    } else {
      // Fallback for homepage scrapes where items don't have distinct pubDate tags:
      // Scraped articles are top-to-bottom (latest first). Reverse for oldest first.
      if (activeSort === 'oldest') {
        sorted.reverse();
      }
    }

    sorted.forEach((article) => {
      const card = document.createElement('article');
      card.className = 'feedo-article-card';
      card.setAttribute('role', 'listitem');

      const imgUrl = article.image || article.ogImage || article.thumbnail;
      let mediaHtml = '';
      if (imgUrl) {
        mediaHtml = `
          <a class="feedo-card-media" href="${article.link || '#'}" target="_blank" rel="noopener noreferrer">
            <img src="${imgUrl}" alt="" loading="lazy" decoding="async" onerror="this.parentElement.innerHTML='<div class=\\'feedo-card-placeholder\\'><span>📰</span></div>';" />
          </a>
        `;
      } else {
        mediaHtml = `
          <a class="feedo-card-media" href="${article.link || '#'}" target="_blank" rel="noopener noreferrer">
            <div class="feedo-card-placeholder"><span>📰</span></div>
          </a>
        `;
      }

      const cleanTitle = decodeEntities(article.title) || 'Untitled Article';
      const cleanSnippet = decodeEntities(article.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 140);
      let host = 'Source';
      if (article.link) {
        try {
          host = new URL(article.link).hostname.replace(/^www\./i, '');
        } catch (_) {
          host = article.source || 'Source';
        }
      } else if (article.source) {
        host = article.source;
      }

      card.innerHTML = `
        ${mediaHtml}
        <div class="feedo-card-body">
          <div class="feedo-card-meta">
            <span class="feedo-card-domain">${host}</span>
          </div>
          <a class="feedo-card-title" href="${article.link || '#'}" target="_blank" rel="noopener noreferrer" title="${cleanTitle}">
            ${cleanTitle}
          </a>
          ${cleanSnippet ? `<p class="feedo-card-desc">${cleanSnippet}...</p>` : ''}
        </div>
      `;
      grid.appendChild(card);
    });
  }

  function updateFollowButtonUi() {
    const btn = document.getElementById('btn-follow-feed');
    if (!btn || !currentFeedUrl) return;
    const isFollowed = isFeedFollowed(currentFeedUrl);
    if (isFollowed) {
      btn.className = 'btn-following';
      btn.innerHTML = '<span>✓ Following</span><span class="follow-heart-icon">💖</span>';
    } else {
      btn.className = 'btn-follow';
      btn.innerHTML = '<span>+ Follow</span><span class="follow-heart-icon">💖</span>';
    }
  }

  async function handleFollowClick() {
    const btn = document.getElementById('btn-follow-feed');
    if (!btn || !currentFeedUrl) return;

    const feedTitle = (currentFeedMeta && currentFeedMeta.title) || 'Feed';
    const cleanUrl = currentFeedUrl.trim().toLowerCase();
    const isCurrentlyFollowed = isFeedFollowed(currentFeedUrl);

    if (isCurrentlyFollowed) {
      // Unfollow action
      userFollowedUrls.delete(cleanUrl);
      btn.className = 'btn-follow';
      btn.innerHTML = '<span>+ Follow</span><span class="follow-heart-icon">💖</span>';

      try {
        let guestList = [];
        const raw = localStorage.getItem('feedometer_guest_subscriptions') || sessionStorage.getItem('feedometer_guest_subscriptions');
        if (raw) guestList = JSON.parse(raw);
        if (Array.isArray(guestList)) {
          guestList = guestList.filter(g => (g.feed_url || '').trim().toLowerCase() !== cleanUrl);
          localStorage.setItem('feedometer_guest_subscriptions', JSON.stringify(guestList));
          sessionStorage.setItem('feedometer_guest_subscriptions', JSON.stringify(guestList));
          if (window.FeedOmeterAuth && typeof window.FeedOmeterAuth.setGuestFollows === 'function') {
            window.FeedOmeterAuth.setGuestFollows(guestList);
          }
          if (window.parent && window.parent !== window && window.parent.FeedOmeterAuth && typeof window.parent.FeedOmeterAuth.setGuestFollows === 'function') {
            try { window.parent.FeedOmeterAuth.setGuestFollows(guestList); } catch (e) {}
          }
        }
      } catch (e) {}

      if (window.FeedOmeterAuth && window.FeedOmeterAuth.isAuthenticated()) {
        try {
          const data = await window.FeedOmeterAuth.getSubscriptions();
          const list = (data && data.subscriptions) || [];
          const found = list.find(s => (s.feed_url || '').trim().toLowerCase() === cleanUrl);
          if (found && (found.subscription_id || found.id)) {
            await window.FeedOmeterAuth.unfollowFeed(found.subscription_id || found.id);
          }
        } catch (e) {}
      }

      showToast(`Unfollowed ${feedTitle}`);
      return;
    }

    // Follow action
    const feedPayload = {
      id: 'guest_' + Date.now(),
      feed_name: feedTitle,
      feed_url: currentFeedUrl,
      website_url: (currentFeedMeta && currentFeedMeta.link) || currentFeedUrl,
      category: (currentFeedMeta && currentFeedMeta.category) || 'General',
      icon_url: (currentFeedMeta && (currentFeedMeta.image || currentFeedMeta.icon_url)) || '',
      description: (currentFeedMeta && currentFeedMeta.description) || ('Syndication feed for ' + feedTitle),
      subscribers: 100,
      velocity: 10,
      is_verified: 0,
      last_updated: Date.now(),
      followed_at: Date.now()
    };

    // Always update local cache / guest storage
    userFollowedUrls.add(cleanUrl);
    try {
      let guestList = [];
      const raw = localStorage.getItem('feedometer_guest_subscriptions') || sessionStorage.getItem('feedometer_guest_subscriptions');
      if (raw) guestList = JSON.parse(raw);
      if (!Array.isArray(guestList)) guestList = [];
      if (!guestList.some(g => (g.feed_url || '').trim().toLowerCase() === cleanUrl)) {
        guestList.unshift(feedPayload);
        localStorage.setItem('feedometer_guest_subscriptions', JSON.stringify(guestList));
        sessionStorage.setItem('feedometer_guest_subscriptions', JSON.stringify(guestList));
        if (window.FeedOmeterAuth && typeof window.FeedOmeterAuth.setGuestFollows === 'function') {
          window.FeedOmeterAuth.setGuestFollows(guestList);
        }
        if (window.parent && window.parent !== window && window.parent.FeedOmeterAuth && typeof window.parent.FeedOmeterAuth.setGuestFollows === 'function') {
          try { window.parent.FeedOmeterAuth.setGuestFollows(guestList); } catch (e) {}
        }
      }
    } catch (e) {}

    if (window.FeedOmeterAuth && window.FeedOmeterAuth.isAuthenticated()) {
      try {
        btn.disabled = true;
        btn.innerHTML = '<span>Following...</span>';
        await window.FeedOmeterAuth.followFeed({
          feed_url: currentFeedUrl,
          title: feedTitle,
          category: (currentFeedMeta && currentFeedMeta.category) || 'General',
          website_url: (currentFeedMeta && currentFeedMeta.link) || currentFeedUrl,
          logo_url: (currentFeedMeta && (currentFeedMeta.image || currentFeedMeta.icon_url)) || ''
        });
        btn.className = 'btn-following';
        btn.innerHTML = '<span>✓ Following</span><span class="follow-heart-icon">💖</span>';
        btn.disabled = false;
        showToast(`✓ Following ${feedTitle}!`);
      } catch (err) {
        console.error('Follow error:', err);
        btn.disabled = false;
        btn.className = 'btn-follow';
        btn.innerHTML = '<span>+ Follow</span><span class="follow-heart-icon">💖</span>';
        showToast(err.message || 'Failed to follow feed');
      }
    } else {
      btn.className = 'btn-following';
      btn.innerHTML = '<span>✓ Following</span><span class="follow-heart-icon">💖</span>';
      showToast(`✓ Following ${feedTitle}!`);
    }
  }

  function resetView() {
    currentArticles = [];
    currentFeedMeta = null;
    currentFeedUrl = '';
    currentXml = '';
    const input = document.getElementById('add-source-query');
    if (input) input.value = '';
    const overview = document.getElementById('add-source-overview');
    if (overview) overview.hidden = true;
    const grid = document.getElementById('articles-grid');
    if (grid) grid.innerHTML = '';
  }

  window.addEventListener('feedometer:auth_change', async () => {
    await refreshUserSubscriptions();
    updateFollowButtonUi();
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'feedometer_guest_subscriptions') {
      refreshUserSubscriptions().then(() => updateFollowButtonUi());
    }
  });

  window.addEventListener('DOMContentLoaded', init);

})(window, document);
