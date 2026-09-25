/**
 * scripts/feedometer-feed-search.js
 * Feed Search — find-feeds discovery API + search.html chrome + mature cards
 * (Preview, Follow, feed URL field + copy). Does not touch search.html / find-feeds.html.
 */
(function (global) {
  'use strict';

  const VIEW_QUERIES = {
    trending: 'news',
    ai: 'artificial intelligence',
    markets: 'finance markets',
    world: 'world news',
    space: 'space NASA',
    gaming: 'gaming',
    'ws-ai-hardware': 'semiconductors GPU',
    'ws-space-exp': 'space exploration',
    'ws-agents': 'AI agents',
    'alert-openai': 'OpenAI',
    'alert-nvidia': 'Nvidia',
    'alert-cloudflare': 'Cloudflare'
  };

  const VIEW_META = {
    trending: { icon: '🔥', label: 'Trending', subtitle: 'Discover popular RSS feeds across the web' },
    ai: { icon: '🤖', label: 'AI', subtitle: 'Artificial intelligence & machine learning sources' },
    markets: { icon: '💰', label: 'Markets', subtitle: 'Finance, markets & fintech feeds' },
    world: { icon: '🌍', label: 'World', subtitle: 'World news & geopolitics sources' },
    space: { icon: '🚀', label: 'Space', subtitle: 'Space exploration & science feeds' },
    gaming: { icon: '🎮', label: 'Gaming', subtitle: 'Gaming & interactive tech sources' },
    'ws-ai-hardware': { icon: '⚡', label: 'AI Hardware', subtitle: 'Semiconductors, GPUs & chip makers' },
    'ws-space-exp': { icon: '🚀', label: 'Space Exp', subtitle: 'Space missions & exploration feeds' },
    'ws-agents': { icon: '🤖', label: 'Agents', subtitle: 'AI agents & autonomous systems' },
    'alert-openai': { icon: '🔔', label: 'OpenAI', subtitle: 'OpenAI & ChatGPT related feeds' },
    'alert-nvidia': { icon: '🔔', label: 'Nvidia', subtitle: 'Nvidia & GPU ecosystem feeds' },
    'alert-cloudflare': { icon: '🔔', label: 'Cloudflare', subtitle: 'Cloudflare platform & edge feeds' }
  };

  const VIEW_CHIPS = {
    trending: [
      { label: '🏏 Cricket', topic: 'cricket' },
      { label: '🤖 AI Agents', topic: 'AI Agents' },
      { label: '⚛️ Quantum', topic: 'quantum computing' },
      { label: '⚡ Semiconductors', topic: 'semiconductors' },
      { label: '🛡️ Cybersecurity', topic: 'cybersecurity' },
      { label: '💰 Fintech', topic: 'fintech' },
      { label: '🚀 Space', topic: 'space exploration' }
    ],
    ai: [
      { label: 'LLM', topic: 'large language models' },
      { label: 'OpenAI', topic: 'OpenAI' },
      { label: 'Anthropic', topic: 'Anthropic Claude' },
      { label: 'Machine Learning', topic: 'machine learning' },
      { label: 'Robotics', topic: 'robotics AI' }
    ],
    markets: [
      { label: 'Stocks', topic: 'stock market' },
      { label: 'Crypto', topic: 'cryptocurrency' },
      { label: 'Fintech', topic: 'fintech' },
      { label: 'Economy', topic: 'global economy' },
      { label: 'Startups', topic: 'startup funding' }
    ],
    world: [
      { label: 'Geopolitics', topic: 'geopolitics' },
      { label: 'Europe', topic: 'Europe news' },
      { label: 'Asia', topic: 'Asia news' },
      { label: 'Climate', topic: 'climate policy' },
      { label: 'Diplomacy', topic: 'diplomacy' }
    ],
    space: [
      { label: 'NASA', topic: 'NASA' },
      { label: 'SpaceX', topic: 'SpaceX' },
      { label: 'Astronomy', topic: 'astronomy' },
      { label: 'Mars', topic: 'Mars exploration' },
      { label: 'Satellites', topic: 'satellites' }
    ],
    gaming: [
      { label: 'PC Gaming', topic: 'PC gaming' },
      { label: 'Console', topic: 'PlayStation Xbox' },
      { label: 'Esports', topic: 'esports' },
      { label: 'Indie', topic: 'indie games' },
      { label: 'Mobile', topic: 'mobile games' }
    ],
    'ws-ai-hardware': [
      { label: 'GPU', topic: 'GPU chips' },
      { label: 'NVIDIA', topic: 'Nvidia chips' },
      { label: 'TSMC', topic: 'TSMC' },
      { label: 'Chips', topic: 'semiconductor manufacturing' }
    ],
    'ws-space-exp': [
      { label: 'Artemis', topic: 'Artemis moon' },
      { label: 'JWST', topic: 'James Webb' },
      { label: 'ISS', topic: 'International Space Station' },
      { label: 'Rovers', topic: 'Mars rover' }
    ],
    'ws-agents': [
      { label: 'Autonomous', topic: 'autonomous agents' },
      { label: 'Tool use', topic: 'AI tool use' },
      { label: 'Multi-agent', topic: 'multi-agent systems' },
      { label: 'RAG', topic: 'retrieval augmented generation' }
    ],
    'alert-openai': [
      { label: 'GPT', topic: 'GPT OpenAI' },
      { label: 'ChatGPT', topic: 'ChatGPT' },
      { label: 'API', topic: 'OpenAI API' },
      { label: 'Sora', topic: 'OpenAI Sora' }
    ],
    'alert-nvidia': [
      { label: 'CUDA', topic: 'NVIDIA CUDA' },
      { label: 'Blackwell', topic: 'NVIDIA Blackwell' },
      { label: 'Data center', topic: 'NVIDIA data center' },
      { label: 'AI chips', topic: 'NVIDIA AI chips' }
    ],
    'alert-cloudflare': [
      { label: 'Workers', topic: 'Cloudflare Workers' },
      { label: 'CDN', topic: 'Cloudflare CDN' },
      { label: 'R2', topic: 'Cloudflare R2' },
      { label: 'D1', topic: 'Cloudflare D1' }
    ]
  };

  const state = {
    view: 'trending',
    mode: 'view', // 'view' | 'keyword'
    query: '',
    activeChip: '',
    feeds: [],
    followedUrls: new Set()
  };

  let toastTimer = null;
  let searchSeq = 0;

  function apiBase() {
    return (global.FEEDOMETER_API_BASE ||
      (global.FeedOmeterConfig && global.FeedOmeterConfig.API_BASE_URL) ||
      (global.FEEDOMETER_CONFIG && global.FEEDOMETER_CONFIG.apiBaseUrl) ||
      'https://feedometer-api.feedometer.workers.dev').replace(/\/$/, '');
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatNumber(num) {
    const n = Number(num);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(n));
  }


  function formatRelative(timestamp) {
    if (!timestamp) return 'recently';
    const t = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
    if (!Number.isFinite(t)) return 'recently';
    const diff = Date.now() - t;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    return Math.floor(days / 30) + 'mo ago';
  }

  function showToast(msg) {
    const el = document.getElementById('fs-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function feedDomain(feed) {
    try {
      const u = feed.website_url || feed.site_url || feed.feed_url || feed.url || '';
      return u ? new URL(u).hostname.replace(/^www\./, '') : 'RSS Source';
    } catch (e) {
      return 'RSS Source';
    }
  }

  function normalizeUrl(u) {
    return String(u || '').trim().toLowerCase();
  }

  async function refreshFollowed() {
    state.followedUrls = new Set();
    try {
      if (global.FeedOmeterAuth && global.FeedOmeterAuth.isAuthenticated()) {
        const data = await global.FeedOmeterAuth.getSubscriptions();
        const list = (data && data.subscriptions) || [];
        list.forEach((s) => {
          const u = normalizeUrl(s.feed_url || s.url);
          if (u) state.followedUrls.add(u);
        });
      }
    } catch (e) {}

    try {
      const raw = localStorage.getItem('feedometer_guest_subscriptions') ||
        sessionStorage.getItem('feedometer_guest_subscriptions');
      if (raw) {
        const guestList = JSON.parse(raw);
        if (Array.isArray(guestList)) {
          guestList.forEach((g) => {
            const u = normalizeUrl(g.feed_url || g.url);
            if (u) state.followedUrls.add(u);
          });
        }
      }
    } catch (e) {}
  }

  function isFeedFollowed(feedUrl) {
    return state.followedUrls.has(normalizeUrl(feedUrl));
  }

  function setBadgeCount(viewId, total) {
    const el = document.querySelector('[data-count="' + viewId + '"]');
    if (!el) return;
    el.textContent = typeof total === 'number' ? formatNumber(total) : '—';
  }

  function setActiveNav(viewId) {
    document.querySelectorAll('#sidebar-nav .nav-item').forEach((btn) => {
      const on = Boolean(viewId) && btn.getAttribute('data-view') === viewId;
      btn.classList.toggle('nav-item-active', on);
      btn.classList.toggle('nav-item-inactive', !on);
    });
  }

  function updateContextHeader(viewId) {
    const meta = VIEW_META[viewId] || VIEW_META.trending;
    const iconEl = document.getElementById('context-icon');
    const labelEl = document.getElementById('context-label');
    const subEl = document.getElementById('context-subtitle');
    if (iconEl) iconEl.textContent = meta.icon;
    if (labelEl) labelEl.textContent = meta.label;
    if (subEl) subEl.textContent = meta.subtitle;
  }

  function updateKeywordSearchHeader(query) {
    const iconEl = document.getElementById('context-icon');
    const labelEl = document.getElementById('context-label');
    const subEl = document.getElementById('context-subtitle');
    if (iconEl) iconEl.textContent = '🔍';
    if (labelEl) labelEl.textContent = 'Keyword Search';
    if (subEl) {
      const q = String(query || '').trim();
      subEl.textContent = q
        ? ('Results for “' + q + '”')
        : 'Search feeds by topic, site, or keyword';
    }
  }

  function enterKeywordSearchMode(query) {
    state.mode = 'keyword';
    state.view = null;
    state.activeChip = '';
    setActiveNav(null);
    updateKeywordSearchHeader(query);
    renderChips();
  }

  function renderChips() {
    const host = document.getElementById('related-chips');
    if (!host) return;
    const chips = (state.mode === 'view' && state.view) ? (VIEW_CHIPS[state.view] || []) : [];
    if (!chips.length) {
      host.innerHTML = '';
      return;
    }
    let html = '<span class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">Related:</span>';
    chips.forEach((chip) => {
      const on = state.activeChip &&
        state.activeChip.toLowerCase() === String(chip.topic).toLowerCase();
      const cls = on
        ? 'text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200'
        : 'text-xs font-semibold px-2.5 py-1 rounded-full bg-white hover:bg-blue-50 hover:text-blue-700 border border-slate-200 text-slate-700 transition-colors';
      html += '<button type="button" class="' + cls + '" data-topic="' +
        escapeHtml(chip.topic) + '">' + escapeHtml(chip.label) + '</button>';
    });
    host.innerHTML = html;
    host.querySelectorAll('[data-topic]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const topic = btn.getAttribute('data-topic') || '';
        state.activeChip = topic;
        const input = document.getElementById('search-input');
        if (input) input.value = topic;
        runSearch(topic, { fromChip: true });
      });
    });
  }

  function copyIconSvg() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  }

  function renderFeeds(feeds, execMs) {
    const grid = document.getElementById('results-grid');
    const empty = document.getElementById('empty-state');
    const status = document.getElementById('status-line');
    if (!grid) return;

    state.feeds = Array.isArray(feeds) ? feeds : [];
    grid.innerHTML = '';

    if (!state.feeds.length) {
      if (empty) empty.classList.remove('hidden');
      if (status) status.textContent = 'No feeds found';
      return;
    }
    if (empty) empty.classList.add('hidden');

    const ms = typeof execMs === 'number' ? ' (' + execMs + 'ms)' : '';
    if (status) {
      status.textContent = 'Found ' + state.feeds.length + ' RSS feeds' + ms;
    }

    state.feeds.forEach((feed, idx) => {
      const name = feed.feed_name || feed.title || feed.name || feedDomain(feed);
      const domain = feedDomain(feed);
      const desc = feed.description || ('Syndication feed for ' + name);
      const feedUrl = feed.feed_url || feed.url || '';
      const siteUrl = feed.website_url || feed.site_url || feedUrl;
      const followed = isFeedFollowed(feedUrl);
      const avatar = feed.icon_url || feed.logo_url
        ? '<img src="' + escapeHtml(feed.icon_url || feed.logo_url) + '" alt="" onerror="this.parentElement.textContent=\'' +
          escapeHtml((name || 'F').charAt(0).toUpperCase()) + '\'">'
        : escapeHtml((name || 'F').charAt(0).toUpperCase());
      const velocity = feed.velocity
        ? (String(feed.velocity).indexOf('Post') >= 0 ? feed.velocity : feed.velocity + ' Posts / Week')
        : 'Active Publishing';

      const card = document.createElement('div');
      card.className = 'feed-card';
      card.innerHTML =
        '<div>' +
          '<div class="feed-card-header">' +
            '<div class="feed-avatar">' + avatar + '</div>' +
            '<div class="min-w-0">' +
              '<a href="' + escapeHtml(siteUrl) + '" target="_blank" rel="noopener" class="feed-title-link">' +
                escapeHtml(name) +
              '</a>' +
              '<div class="feed-domain-text">' + escapeHtml(domain) +
                ' <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<p class="feed-description">' + escapeHtml(desc) + '</p>' +
          '<div class="feed-metrics-list">' +
            '<div class="feed-metric-item"><span>•</span><span><strong>' + formatNumber(feed.subscribers) + '</strong> Subscribers</span></div>' +
            '<div class="feed-metric-item"><span>•</span><span><strong>' + escapeHtml(String(velocity)) + '</strong></span></div>' +
            '<div class="feed-metric-item"><span>•</span><span>Updated ' + escapeHtml(formatRelative(feed.last_updated)) + '</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="feed-url-row">' +
          '<input type="text" class="feed-url-input" readonly value="' + escapeHtml(feedUrl) + '" aria-label="Feed URL" />' +
          '<button type="button" class="btn-copy-url" data-copy-idx="' + idx + '" title="Copy feed URL">' + copyIconSvg() + '</button>' +
        '</div>' +
        '<div class="feed-card-actions">' +
          '<button type="button" class="btn-action btn-preview" data-preview-idx="' + idx + '">Preview</button>' +
          '<button type="button" class="btn-action ' + (followed ? 'btn-following' : 'btn-follow') + '" data-follow-idx="' + idx + '">' +
            '<span>' + (followed ? 'Unfollow' : '+ Follow') + '</span>' +
            '<span>💖</span>' +
          '</button>' +
        '</div>';

      grid.appendChild(card);
    });

    grid.querySelectorAll('[data-preview-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-preview-idx'), 10);
        openFeedPreview(state.feeds[idx]);
      });
    });

    grid.querySelectorAll('[data-follow-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-follow-idx'), 10);
        handleFollowClick(state.feeds[idx], btn);
      });
    });

    grid.querySelectorAll('[data-copy-idx]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.getAttribute('data-copy-idx'), 10);
        const feed = state.feeds[idx];
        const url = (feed && (feed.feed_url || feed.url)) || '';
        if (!url) return;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
          } else {
            const ta = document.createElement('textarea');
            ta.value = url;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
          showToast('Copied to clipboard!');
        } catch (e) {
          showToast('Could not copy URL');
        }
      });
    });
  }

  async function runSearch(query, options) {
    options = options || {};
    const fallbackQ = (state.view && VIEW_QUERIES[state.view]) || state.query || 'news';
    const qText = String(query || '').trim() || fallbackQ;
    state.query = qText;

    const input = document.getElementById('search-input');
    if (input && options.syncInput !== false) {
      if (options.fromView && state.view === 'trending') input.value = '';
      else if (!options.fromChip) input.value = options.fromView ? qText : String(query || '').trim();
    }

    if (!options.fromChip) state.activeChip = '';
    renderChips();

    const grid = document.getElementById('results-grid');
    const empty = document.getElementById('empty-state');
    const status = document.getElementById('status-line');
    if (grid) grid.innerHTML = '';
    if (empty) empty.classList.add('hidden');
    if (status) status.textContent = 'Discovering feeds…';

    const sortEl = document.getElementById('filter-sort');
    const langEl = document.getElementById('filter-lang');
    const sort = (sortEl && sortEl.value) || 'relevance';
    const language = (langEl && langEl.value) || 'all';

    const params = new URLSearchParams({
      q: qText,
      category: 'all',
      language: language,
      country: 'all',
      sort: sort,
      limit: '50'
    });

    const seq = ++searchSeq;
    try {
      const res = await fetch(apiBase() + '/api/feeds/find?' + params.toString());
      const data = await res.json();
      if (seq !== searchSeq) return;

      const feeds = (data && (data.feeds || data.sources || data.items)) || [];
      const total = typeof data.total === 'number' ? data.total : feeds.length;
      if (state.view && Object.prototype.hasOwnProperty.call(VIEW_QUERIES, state.view)) {
        setBadgeCount(state.view, total);
      }

      if (feeds.length) {
        renderFeeds(feeds, data.execution_ms);
      } else {
        state.feeds = [];
        if (empty) empty.classList.remove('hidden');
        if (status) status.textContent = 'No feeds found';
      }
    } catch (err) {
      if (seq !== searchSeq) return;
      state.feeds = [];
      if (empty) empty.classList.remove('hidden');
      if (status) status.textContent = 'Search failed — try again';
      console.warn('Feed Search error:', err);
    }
  }

  function switchView(viewId) {
    if (!VIEW_QUERIES[viewId]) return;
    state.mode = 'view';
    state.view = viewId;
    state.activeChip = '';
    setActiveNav(viewId);
    updateContextHeader(viewId);
    runSearch(VIEW_QUERIES[viewId], { fromView: true, syncInput: true });
  }

  async function handleFollowClick(feed, btn) {
    if (!feed || !(feed.feed_url || feed.url)) return;
    const feedUrl = feed.feed_url || feed.url;
    const cleanUrl = normalizeUrl(feedUrl);
    const name = feed.feed_name || feed.title || feed.name || 'feed';
    const currently = state.followedUrls.has(cleanUrl);

    if (currently) {
      state.followedUrls.delete(cleanUrl);
      btn.className = 'btn-action btn-follow';
      btn.innerHTML = '<span>+ Follow</span><span>💖</span>';

      try {
        let guestList = [];
        const raw = localStorage.getItem('feedometer_guest_subscriptions') ||
          sessionStorage.getItem('feedometer_guest_subscriptions');
        if (raw) guestList = JSON.parse(raw);
        if (Array.isArray(guestList)) {
          guestList = guestList.filter((g) => normalizeUrl(g.feed_url || g.url) !== cleanUrl);
          localStorage.setItem('feedometer_guest_subscriptions', JSON.stringify(guestList));
          sessionStorage.setItem('feedometer_guest_subscriptions', JSON.stringify(guestList));
          if (global.FeedOmeterAuth && typeof global.FeedOmeterAuth.setGuestFollows === 'function') {
            global.FeedOmeterAuth.setGuestFollows(guestList);
          }
        }
      } catch (e) {}

      if (global.FeedOmeterAuth && global.FeedOmeterAuth.isAuthenticated()) {
        try {
          const data = await global.FeedOmeterAuth.getSubscriptions();
          const list = (data && data.subscriptions) || [];
          const found = list.find((s) => normalizeUrl(s.feed_url || s.url) === cleanUrl);
          if (found && (found.subscription_id || found.id)) {
            await global.FeedOmeterAuth.unfollowFeed(found.subscription_id || found.id);
          }
        } catch (e) {}
      }
      showToast('Unfollowed ' + name);
      return;
    }

    if (global.FeedOmeterAuth && global.FeedOmeterAuth.isAuthenticated()) {
      try {
        btn.disabled = true;
        btn.innerHTML = '<span>Following…</span>';
        await global.FeedOmeterAuth.followFeed({
          feed_url: feedUrl,
          title: name,
          category: feed.category || 'General',
          website_url: feed.website_url || feed.site_url,
          logo_url: feed.icon_url || feed.logo_url
        });
        state.followedUrls.add(cleanUrl);
        btn.className = 'btn-action btn-following';
        btn.innerHTML = '<span>Unfollow</span><span>💖</span>';
        btn.disabled = false;
        showToast('Following ' + name);
      } catch (err) {
        btn.disabled = false;
        btn.className = 'btn-action btn-follow';
        btn.innerHTML = '<span>+ Follow</span><span>💖</span>';
        showToast(err.message || 'Failed to follow feed');
      }
      return;
    }

    // Guest follow
    try {
      let guestList = [];
      const raw = localStorage.getItem('feedometer_guest_subscriptions') ||
        sessionStorage.getItem('feedometer_guest_subscriptions');
      if (raw) guestList = JSON.parse(raw);
      if (!Array.isArray(guestList)) guestList = [];
      guestList.push({
        feed_url: feedUrl,
        title: name,
        website_url: feed.website_url || feed.site_url,
        logo_url: feed.icon_url || feed.logo_url
      });
      localStorage.setItem('feedometer_guest_subscriptions', JSON.stringify(guestList));
      sessionStorage.setItem('feedometer_guest_subscriptions', JSON.stringify(guestList));
      if (global.FeedOmeterAuth && typeof global.FeedOmeterAuth.setGuestFollows === 'function') {
        global.FeedOmeterAuth.setGuestFollows(guestList);
      }
      state.followedUrls.add(cleanUrl);
      btn.className = 'btn-action btn-following';
      btn.innerHTML = '<span>Unfollow</span><span>💖</span>';
      showToast('Following ' + name + ' (saved on this device)');
    } catch (e) {
      showToast('Could not save follow');
    }
  }

  // Preview state + DOM (borrowed from find-feeds output window)
  let currentPreviewItems = [];
  let currentPreviewViewMode = 'list';
  let previewSearchQuery = '';

  const previewModal = () => document.getElementById('preview-modal');
  const feedTitleEl = () => document.getElementById('feed-title');
  const feedCountBadge = () => document.getElementById('feed-count-badge');
  const cardsContainer = () => document.getElementById('cards-container');
  const previewLoading = () => document.getElementById('preview-loading-spinner');
  const previewError = () => document.getElementById('preview-error-container');
  const feedSearchInput = () => document.getElementById('feed-search-input');
  const viewListBtn = () => document.getElementById('view-list-btn');
  const viewGridBtn = () => document.getElementById('view-grid-btn');

  function cleanSnippet(title, snippet) {
    if (!snippet) return '';
    let s = String(snippet).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (s.toLowerCase().startsWith((title || '').toLowerCase())) {
      s = s.slice((title || '').length).trim();
    }
    return s;
  }

  function getDomainFavicon(url) {
    try {
      if (!url) return '';
      const u = new URL(url.startsWith('http') ? url : 'https://' + url);
      return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(u.hostname) + '&sz=32';
    } catch (_) {
      return '';
    }
  }

  async function openFeedPreview(feed) {
    if (!feed || !(feed.feed_url || feed.url)) return;
    const feedUrl = feed.feed_url || feed.url;
    const modal = previewModal();
    const titleEl = feedTitleEl();
    const countEl = feedCountBadge();
    const cards = cardsContainer();
    const loading = previewLoading();
    const errBox = previewError();
    const searchInput = feedSearchInput();
    if (!modal || !cards) return;

    if (titleEl) titleEl.textContent = feed.feed_name || feed.title || feed.name || 'Top Stories';
    if (countEl) countEl.textContent = 'Loading...';
    cards.innerHTML = '';
    previewSearchQuery = '';
    if (searchInput) searchInput.value = '';
    if (errBox) errBox.style.display = 'none';
    if (loading) loading.style.display = 'flex';

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    try {
      const streamUrl = apiBase() + '/api/view?url=' + encodeURIComponent(feedUrl);
      const res = await fetch(streamUrl);
      const json = await res.json();

      if (loading) loading.style.display = 'none';

      let items = [];
      let title = feed.feed_name || feed.title || feed.name || 'Top Stories';

      if (json && (json.ok || json.status === 'success') && Array.isArray(json.items)) {
        items = json.items;
        if (json.meta && json.meta.title) title = json.meta.title;
      } else if (Array.isArray(json)) {
        items = json;
      } else if (json && Array.isArray(json.stories)) {
        items = json.stories;
      }

      currentPreviewItems = items.map((it, i) => {
        let sourceTitle = '';
        let sourceIcon = '';
        if (typeof it.source === 'object' && it.source) {
          sourceTitle = it.source.title || '';
          sourceIcon = it.source.logo_url || '';
        } else if (typeof it.source === 'string') {
          sourceTitle = it.source;
        }

        return {
          id: it.id || ('item-' + i),
          title: it.title || 'Untitled',
          link: it.link || it.url || feed.website_url || feedUrl,
          description: it.description || it.summary || it.snippet || '',
          pubDate: it.pubDate || it.published_at || it.published || it.date || '',
          image: it.image || it.image_url || it.thumbnail || '',
          source: sourceTitle || feed.feed_name || feed.title || 'RSS',
          sourceIcon: sourceIcon || feed.icon_url || feed.logo_url || ''
        };
      });

      if (titleEl) titleEl.textContent = title;
      if (countEl) {
        countEl.textContent = currentPreviewItems.length +
          (currentPreviewItems.length === 1 ? ' story' : ' stories');
      }

      renderPreviewCards();
    } catch (err) {
      if (loading) loading.style.display = 'none';
      if (errBox) {
        errBox.innerHTML = '<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 1rem 1.25rem; color: #991b1b; font-size: 0.95rem; font-weight: 500;">Could not parse live feed stream: ' +
          escapeHtml(err.message || String(err)) + '</div>';
        errBox.style.display = 'block';
      }
    }
  }

  function setPreviewViewMode(mode) {
    const cards = cardsContainer();
    const listBtn = viewListBtn();
    const gridBtn = viewGridBtn();
    if (!cards) return;
    currentPreviewViewMode = mode;
    if (mode === 'grid') {
      cards.className = 'cards-grid';
      if (gridBtn) gridBtn.classList.add('active');
      if (listBtn) listBtn.classList.remove('active');
    } else {
      cards.className = 'cards-list';
      if (listBtn) listBtn.classList.add('active');
      if (gridBtn) gridBtn.classList.remove('active');
    }
  }

  function renderPreviewCards() {
    const cards = cardsContainer();
    if (!cards) return;
    cards.innerHTML = '';
    let filtered = currentPreviewItems.slice();

    if (previewSearchQuery) {
      filtered = filtered.filter((item) =>
        (item.title || '').toLowerCase().includes(previewSearchQuery) ||
        (item.description || '').toLowerCase().includes(previewSearchQuery)
      );
    }

    if (!filtered.length) {
      cards.innerHTML = '<div style="text-align:center; padding: 3rem 1rem; color: #64748b; font-size: 0.95rem;">No stories found matching your filter.</div>';
      return;
    }

    filtered.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'modern-card';

      let mediaHtml = '';
      if (item.image) {
        mediaHtml =
          '<div class="card-media">' +
            '<img src="' + escapeHtml(item.image) + '" alt="" loading="lazy" onerror="this.parentElement.style.display=\'none\'">' +
          '</div>';
      }

      const faviconSrc = item.sourceIcon || getDomainFavicon(item.link);
      const faviconHtml = faviconSrc
        ? '<img src="' + escapeHtml(faviconSrc) + '" class="source-favicon" alt="" onerror="this.style.display=\'none\'">'
        : '';
      const dateHtml = item.pubDate
        ? '<span class="source-separator">•</span><span class="card-date-time">' + escapeHtml(item.pubDate) + '</span>'
        : '';

      card.innerHTML =
        mediaHtml +
        '<div class="card-content">' +
          '<h3 class="card-title">' +
            '<a href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.title) + '</a>' +
          '</h3>' +
          '<p class="card-snippet">' + escapeHtml(cleanSnippet(item.title, item.description)) + '</p>' +
          '<div class="card-footer">' +
            '<div class="card-source-info">' +
              faviconHtml +
              '<span class="source-name">' + escapeHtml(item.source || 'RSS') + '</span>' +
              dateHtml +
            '</div>' +
          '</div>' +
        '</div>';

      cards.appendChild(card);
    });
  }

  function closeFeedPreview() {
    const modal = previewModal();
    const cards = cardsContainer();
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    currentPreviewItems = [];
    if (cards) cards.innerHTML = '';
  }

  function bindUi() {
    const form = document.getElementById('search-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('search-input');
        const q = input ? input.value.trim() : '';
        if (!q) {
          // Empty search → return to Trending view
          switchView('trending');
          return;
        }
        enterKeywordSearchMode(q);
        runSearch(q, { syncInput: false });
      });
    }

    ['filter-sort', 'filter-lang'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          const fallback = (state.view && VIEW_QUERIES[state.view]) || state.query || 'news';
          runSearch(state.query || fallback, { syncInput: false });
        });
      }
    });

    document.querySelectorAll('#sidebar-nav .nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-view');
        if (view) switchView(view);
      });
    });

    const closeBtn = document.getElementById('preview-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeFeedPreview);

    const modal = previewModal();
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeFeedPreview();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
        closeFeedPreview();
      }
    });

    const listBtn = viewListBtn();
    const gridBtn = viewGridBtn();
    if (listBtn && gridBtn) {
      listBtn.addEventListener('click', () => {
        setPreviewViewMode('list');
        renderPreviewCards();
      });
      gridBtn.addEventListener('click', () => {
        setPreviewViewMode('grid');
        renderPreviewCards();
      });
    }

    const searchInput = feedSearchInput();
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        previewSearchQuery = e.target.value.trim().toLowerCase();
        renderPreviewCards();
      });
    }
  }

  async function init() {
    bindUi();
    await refreshFollowed();
    switchView('trending');

    // Light badge warm-up for a few sibling views (non-blocking)
    const warm = ['ai', 'markets', 'world'];
    warm.forEach(async (viewId) => {
      try {
        const q = VIEW_QUERIES[viewId];
        const res = await fetch(apiBase() + '/api/feeds/find?q=' + encodeURIComponent(q) + '&limit=1&sort=relevance');
        const data = await res.json();
        const total = typeof data.total === 'number' ? data.total : ((data.feeds || []).length);
        setBadgeCount(viewId, total);
      } catch (e) {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.FeedOmeterFeedSearch = {
    search: runSearch,
    switchView: switchView,
    toast: showToast
  };
})(typeof window !== 'undefined' ? window : this);
