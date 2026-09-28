/**
 * scripts/feedometer-search.js — Live catalog search + Discover sidebar / chips / filters
 */
(function (global) {
  'use strict';

  function apiBase() {
    return (global.FEEDOMETER_API_BASE ||
      (global.FeedOmeterConfig && global.FeedOmeterConfig.API_BASE_URL) ||
      (global.FEEDOMETER_CONFIG && global.FEEDOMETER_CONFIG.apiBaseUrl) || '').replace(/\/$/, '');
  }

  function authHeaders() {
    if (global.FeedOmeterAuth && global.FeedOmeterAuth.getAuthHeaders) {
      return global.FeedOmeterAuth.getAuthHeaders();
    }
    return { 'Content-Type': 'application/json' };
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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

  // Sub-topic chips belong to one sidebar menu only
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
      { label: 'Security', topic: 'Cloudflare security' },
      { label: 'R2', topic: 'Cloudflare R2' }
    ]
  };

  const state = {
    query: '',
    view: 'trending',
    activeChip: '',
    timeRange: 'all',
    language: 'all',
    sort: 'relevance',
    rawArticles: [],
    rawFeeds: [],
    feedTotal: 0
  };

  function setBadgeCount(viewId, count) {
    const el = document.querySelector('[data-view-count="' + viewId + '"]');
    if (!el) return;
    const n = Number(count);
    el.textContent = Number.isFinite(n) ? String(n) : '0';
  }

  async function fetchFeedCount(query) {
    const q = encodeURIComponent(String(query || 'news'));
    try {
      const res = await fetch(apiBase() + '/api/feeds/find?q=' + q + '&limit=40', { headers: authHeaders() });
      const json = await res.json();
      const feeds = json.feeds || json.sources || json.items || [];
      // Prefer true aggregated total from discovery engine; fall back to returned rows
      if (typeof json.total === 'number') return json.total;
      return feeds.length;
    } catch (e) {
      return 0;
    }
  }

  async function refreshSidebarCounts() {
    const views = Object.keys(VIEW_QUERIES);
    await Promise.all(views.map(async (viewId) => {
      const count = await fetchFeedCount(VIEW_QUERIES[viewId]);
      setBadgeCount(viewId, count);
    }));
  }

  function toast(message) {
    let el = document.getElementById('feedometer-search-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'feedometer-search-toast';
      el.setAttribute('role', 'status');
      el.style.cssText = [
        'position:fixed', 'bottom:1.25rem', 'left:50%', 'transform:translateX(-50%)',
        'z-index:99999', 'background:#0f172a', 'color:#fff', 'padding:0.65rem 1.1rem',
        'border-radius:10px', 'font-size:0.82rem', 'font-weight:600',
        'box-shadow:0 10px 30px rgba(15,23,42,0.28)', 'opacity:0',
        'transition:opacity 0.18s ease', 'pointer-events:none', 'max-width:90vw'
      ].join(';');
      document.body.appendChild(el);
    }
    el.textContent = String(message || '');
    el.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { el.style.opacity = '0'; }, 2400);
  }

  function setActiveNav(viewId) {
    document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
      const active = btn.getAttribute('data-view') === viewId;
      btn.classList.toggle('nav-item-active', active);
      btn.classList.toggle('nav-item-inactive', !active);
    });
  }

  function setHeader(title, section) {
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.textContent = title || 'Feed discovery';
  }

  function withinTimeRange(published, range) {
    if (!range || range === 'all') return true;
    if (!published) return true;
    const t = new Date(published).getTime();
    if (Number.isNaN(t)) return true;
    const age = Date.now() - t;
    if (range === '24h') return age <= 24 * 60 * 60 * 1000;
    if (range === '7d') return age <= 7 * 24 * 60 * 60 * 1000;
    if (range === '30d') return age <= 30 * 24 * 60 * 60 * 1000;
    return true;
  }

  function applyClientFilters(articles) {
    let list = Array.isArray(articles) ? articles.slice() : [];
    list = list.filter((a) => withinTimeRange(a.published_at || a.published || a.pubDate, state.timeRange));

    if (state.language === 'en') {
      list = list.filter((a) => {
        const lang = String(a.language || a.lang || 'en').toLowerCase();
        return lang === 'en' || lang.indexOf('en') === 0;
      });
    }

    if (state.sort === 'recent') {
      list.sort((a, b) => {
        const ta = new Date(a.published_at || a.published || a.pubDate || 0).getTime() || 0;
        const tb = new Date(b.published_at || b.published || b.pubDate || 0).getTime() || 0;
        return tb - ta;
      });
    } else if (state.sort === 'authority') {
      list.sort((a, b) => {
        const sa = String((a.source && a.source.title) || a.source_title || '');
        const sb = String((b.source && b.source.title) || b.source_title || '');
        return sa.localeCompare(sb);
      });
    }
    return list;
  }

  function sortFeeds(feeds) {
    const list = Array.isArray(feeds) ? feeds.slice() : [];
    if (state.sort === 'authority' || state.sort === 'popularity') {
      list.sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0));
    } else if (state.sort === 'recent' || state.sort === 'freshness') {
      list.sort((a, b) => (b.last_updated || 0) - (a.last_updated || 0));
    } else {
      list.sort((a, b) => (b.discovery_score || 0) - (a.discovery_score || 0));
    }
    return list;
  }

  function rerender() {
    const container = document.getElementById('story-container');
    render(container, sortFeeds(state.rawFeeds), state.query, state.feedTotal);
  }

  async function runSearch(query, options = {}) {
    const qText = String(query || '').trim() || 'news';
    state.query = qText;

    const container = document.getElementById('story-container');
    if (!options.keepHeader) {
      setHeader('Results for “' + qText + '”', 'SEARCH');
    }
    if (container) container.innerHTML = '<p class="text-sm text-slate-500 p-4">Discovering feeds…</p>';

    const input = document.getElementById('search-input');
    if (input && options.syncInput !== false) {
      // Keep omnibox in sync, but don't force "news" into the box for Trending
      if (options.fromView && state.view === 'trending') input.value = '';
      else input.value = options.fromView ? qText : (String(query || '').trim());
    }

    let feeds = [];
    let total = 0;
    try {
      const sortParam = state.sort === 'authority' ? 'popularity'
        : state.sort === 'recent' ? 'freshness'
        : 'relevance';
      const fres = await fetch(
        apiBase() + '/api/feeds/find?q=' + encodeURIComponent(qText) + '&limit=40&sort=' + encodeURIComponent(sortParam),
        { headers: authHeaders() }
      );
      const fjson = await fres.json();
      feeds = fjson.feeds || fjson.sources || fjson.items || [];
      total = typeof fjson.total === 'number' ? fjson.total : feeds.length;
    } catch (e) {}

    state.rawFeeds = feeds;
    state.rawArticles = [];
    state.feedTotal = total;
    if (state.view && Object.prototype.hasOwnProperty.call(VIEW_QUERIES, state.view)) {
      setBadgeCount(state.view, total);
    }
    render(container, sortFeeds(feeds), qText, total);
  }

  function feedDomain(feed) {
    try {
      const u = feed.website_url || feed.site_url || feed.feed_url || feed.url || '';
      return u ? new URL(u).hostname.replace(/^www\./, '') : '';
    } catch (e) {
      return '';
    }
  }

  function chipsHtmlForView(viewId, activeTopic) {
    const chips = VIEW_CHIPS[viewId];
    if (!chips || !chips.length) return '';
    let html = '<div class="mb-3 flex items-center gap-2 flex-wrap" id="view-topic-chips">';
    html += '<span class="text-[11px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">Related:</span>';
    chips.forEach((chip) => {
      const on = activeTopic && activeTopic.toLowerCase() === String(chip.topic).toLowerCase();
      const cls = on
        ? 'topic-chip-btn text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 cursor-pointer'
        : 'topic-chip-btn text-xs font-semibold px-2.5 py-1 rounded-full bg-white hover:bg-blue-50 hover:text-blue-700 border border-slate-200 text-slate-700 transition-colors cursor-pointer';
      html += '<button type="button" class="' + cls + '" data-topic="' + escapeHtml(chip.topic) + '">' + escapeHtml(chip.label) + '</button>';
    });
    html += '</div>';
    return html;
  }

  function render(container, feeds, query, total) {
    if (!container) return;
    const list = Array.isArray(feeds) ? feeds : [];
    const headlineTotal = typeof total === 'number' ? total : list.length;

    let html = '';
    // Chips sit under the sort bar (page chrome) and just above the count
    html += chipsHtmlForView(state.view, state.activeChip || '');

    if (!list.length) {
      html += '<div class="p-6 text-center text-slate-500">No feeds found for this topic. Try another related chip or keyword.</div>';
      container.innerHTML = html;
      return;
    }

    html += '<div class="mb-3 flex items-center justify-between gap-2 flex-wrap">' +
      '<p class="text-sm text-slate-600"><strong class="text-slate-900">' + headlineTotal + '</strong> feeds' +
      (query ? ' for “' + escapeHtml(query) + '”' : '') +
      (list.length < headlineTotal ? ' · showing ' + list.length : '') +
      '</p></div>';

    html += '<h3 class="text-sm font-bold text-slate-700 mb-2">Feeds</h3>';
    html += '<div class="sources-cards-grid">';
    list.forEach((f) => {
      const title = escapeHtml(f.title || f.feed_name || f.name || feedDomain(f) || 'Feed');
      const url = f.feed_url || f.url || '';
      const desc = escapeHtml(f.description || '');
      const domain = escapeHtml(feedDomain(f));
      const subs = f.subscribers ? (Number(f.subscribers).toLocaleString() + ' subs') : '';
      html += '<div class="discovered-source-card">' +
        '<div class="source-card-top">' +
          '<div><div class="source-card-title">' + title + '</div>' +
          (domain ? '<div class="source-card-domain">' + domain + '</div>' : '') +
          '</div>' +
          '<button class="btn-follow-source" data-follow-url="' + escapeHtml(url) + '" data-follow-title="' + title + '">Follow</button>' +
        '</div>' +
        (desc ? '<p class="source-card-desc">' + desc.slice(0, 140) + (desc.length > 140 ? '…' : '') + '</p>' : '') +
        '<div class="source-card-metrics">' +
          (subs ? '<span class="metric-pill">' + escapeHtml(subs) + '</span>' : '') +
          (f.is_verified ? '<span class="metric-pill auth">Verified</span>' : '') +
        '</div>' +
        '<div class="text-[11px] text-slate-400 font-mono break-all mt-1">' + escapeHtml(url) + '</div>' +
      '</div>';
    });
    html += '</div>';

    container.innerHTML = html;
    container.querySelectorAll('[data-follow-url]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!global.FeedOmeterAuth || !global.FeedOmeterAuth.isAuthenticated()) {
          if (global.parent && global.parent.showAuthModal) global.parent.showAuthModal();
          return;
        }
        try {
          await global.FeedOmeterAuth.followFeed({
            feed_url: btn.getAttribute('data-follow-url'),
            title: btn.getAttribute('data-follow-title')
          });
          btn.textContent = 'Following';
          btn.classList.add('followed');
        } catch (e) {
          alert(e.message || 'Could not follow');
        }
      });
    });
  }

  function switchView(viewId, title) {
    state.view = viewId || 'trending';
    state.activeChip = '';
    setActiveNav(state.view);
    setHeader(title || 'Feed discovery');

    const mapped = Object.prototype.hasOwnProperty.call(VIEW_QUERIES, state.view)
      ? VIEW_QUERIES[state.view]
      : String(viewId || '').replace(/^(ws-|alert-)/, '').replace(/-/g, ' ');

    runSearch(mapped, { keepHeader: true, fromView: true, syncInput: true });
  }

  function discoverTopic(topic) {
    const q = String(topic || '').trim();
    if (!q) return;
    state.activeChip = q;
    // Keep current sidebar menu; only refine the feed query
    setHeader((document.getElementById('header-title') || {}).textContent || q);
    runSearch(q, { keepHeader: true, syncInput: true, fromView: true });
  }

  async function createWorkspace() {
    const name = prompt('Name this research workspace (saved search):');
    if (!name || !name.trim()) return;
    if (!global.FeedOmeterAuth || !global.FeedOmeterAuth.isAuthenticated()) {
      toast('Sign in to save workspaces');
      if (global.parent && global.parent.showAuthModal) global.parent.showAuthModal();
      return;
    }
    try {
      const res = await fetch(apiBase() + '/api/search/saved', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: name.trim(), search_query: state.query || name.trim() })
      });
      if (!res.ok) throw new Error('Could not save workspace');
      toast('Workspace saved: ' + name.trim());
      loadSavedSearches();
    } catch (e) {
      toast(e.message || 'Could not save workspace');
    }
  }

  async function loadSavedSearches() {
    const panel = document.getElementById('saved-searches-panel');
    if (!panel || !global.FeedOmeterAuth || !global.FeedOmeterAuth.isAuthenticated()) return;
    try {
      const res = await fetch(apiBase() + '/api/search/saved', { headers: authHeaders() });
      const data = await res.json(); const list = data.saved_searches || [];
      if (!list.length) { panel.hidden = true; return; }
      panel.hidden = false;
      panel.innerHTML = '<div class="text-xs text-slate-500 font-bold uppercase tracking-wide mb-2">Saved workspaces</div><div class="flex gap-2 flex-wrap">' + list.map((s) => '<button type="button" class="px-2.5 py-1 rounded-full bg-white border border-slate-200 text-xs font-semibold" data-saved-query="' + escapeHtml(s.search_query) + '">' + escapeHtml(s.name) + '</button><button type="button" class="text-xs text-slate-400" aria-label="Delete ' + escapeHtml(s.name) + '" data-delete-saved="' + escapeHtml(s.id) + '">×</button>').join('') + '</div>';
      panel.querySelectorAll('[data-saved-query]').forEach((b) => b.addEventListener('click', () => runSearch(b.getAttribute('data-saved-query'))));
      panel.querySelectorAll('[data-delete-saved]').forEach((b) => b.addEventListener('click', async () => { await fetch(apiBase() + '/api/search/saved?id=' + encodeURIComponent(b.getAttribute('data-delete-saved')), { method:'DELETE', headers:authHeaders() }); loadSavedSearches(); }));
    } catch (_) { panel.hidden = true; }
  }

  async function loadCurationWorkspace() {
    const panel = document.getElementById('curation-panel');
    if (!panel || !global.FeedOmeterAuth || !global.FeedOmeterAuth.isAuthenticated()) return;
    try {
      const [tagsRes, collectionsRes, healthRes] = await Promise.all([
        fetch(apiBase() + '/api/curation/tags', { headers: authHeaders() }),
        fetch(apiBase() + '/api/curation/collections', { headers: authHeaders() }),
        fetch(apiBase() + '/api/feed-health', { headers: authHeaders() })
      ]);
      const tags = (await tagsRes.json()).tags || [];
      const collections = (await collectionsRes.json()).collections || [];
      const health = (await healthRes.json()).sources || [];
      panel.hidden = false;
      panel.innerHTML = '<div class="grid gap-3 md:grid-cols-3 text-xs">'
        + '<section class="bg-white border border-slate-200 rounded-xl p-3"><strong>Article tags</strong><div class="mt-2 flex flex-wrap gap-1">' + (tags.map(t => '<span class="px-2 py-1 rounded-full bg-blue-50 text-blue-700">' + escapeHtml(t.name) + '</span>').join('') || '<span class="text-slate-400">No tags yet</span>') + '</div><button class="mt-2 text-blue-700 font-semibold" id="btn-new-tag">+ New tag</button></section>'
        + '<section class="bg-white border border-slate-200 rounded-xl p-3"><strong>Collections</strong><div class="mt-2">' + (collections.map(c => '<div>' + escapeHtml(c.name) + (c.share_token ? ' · <code>public link ready</code>' : '') + '</div>').join('') || '<span class="text-slate-400">No collections yet</span>') + '</div><button class="mt-2 text-blue-700 font-semibold" id="btn-new-collection">+ New collection</button></section>'
        + '<section class="bg-white border border-slate-200 rounded-xl p-3"><strong>Feed health</strong><div class="mt-2">' + (health.slice(0,3).map(h => '<div>' + escapeHtml(h.title) + ' · ' + (h.health_score == null ? 'not measured' : escapeHtml(h.health_score) + '/100') + '</div>').join('') || '<span class="text-slate-400">No subscribed feeds</span>') + '</div><span class="text-slate-400">Lowest health scores appear first</span></section></div>';
      document.getElementById('btn-new-tag').addEventListener('click', async () => { const name=prompt('Tag name'); if(!name) return; await fetch(apiBase()+'/api/curation/tags',{method:'POST',headers:authHeaders(),body:JSON.stringify({name})}); loadCurationWorkspace(); });
      document.getElementById('btn-new-collection').addEventListener('click', async () => { const name=prompt('Collection name'); if(!name) return; const isPublic=confirm('Create a public share link?'); await fetch(apiBase()+'/api/curation/collections',{method:'POST',headers:authHeaders(),body:JSON.stringify({name,is_public:isPublic})}); loadCurationWorkspace(); });
    } catch (_) { panel.hidden = true; }
  }

  async function createAlert() {
    const keyword = prompt('Keyword to watch (in-app alert):');
    if (!keyword || !keyword.trim()) return;
    if (!global.FeedOmeterAuth || !global.FeedOmeterAuth.isAuthenticated()) {
      toast('Sign in to create alerts');
      if (global.parent && global.parent.showAuthModal) global.parent.showAuthModal();
      return;
    }
    try {
      const res = await fetch(apiBase() + '/api/search/alerts', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ keyword: keyword.trim() })
      });
      if (!res.ok) throw new Error('Could not save alert');
      toast('Alert saved for: ' + keyword.trim());
    } catch (e) {
      toast(e.message || 'Could not save alert');
    }
  }

  function wireFilters() {
    const timeEl = document.getElementById('filter-time-range');
    const langEl = document.getElementById('filter-language');
    const sortEl = document.getElementById('filter-sort');

    if (timeEl) {
      timeEl.addEventListener('change', () => {
        state.timeRange = timeEl.value || '24h';
        rerender();
      });
    }
    if (langEl) {
      langEl.addEventListener('change', () => {
        state.language = langEl.value || 'all';
        rerender();
      });
    }
    if (sortEl) {
      sortEl.addEventListener('change', () => {
        state.sort = sortEl.value || 'relevance';
        runSearch(state.query || 'news', { keepHeader: true, fromView: true, syncInput: false });
      });
    }
  }

  function wireTopicChips() {
    const container = document.getElementById('story-container');
    if (!container || container._chipsWired) return;
    container._chipsWired = true;
    container.addEventListener('click', (e) => {
      const chip = e.target && e.target.closest ? e.target.closest('.topic-chip-btn[data-topic]') : null;
      if (!chip) return;
      e.preventDefault();
      discoverTopic(chip.getAttribute('data-topic'));
    });
  }

  function wireSearchBox() {
    const input = document.getElementById('search-input');
    const btn = document.getElementById('btn-discover-search');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const q = input ? input.value.trim() : '';
        if (!q) {
          toast('Type a keyword, then hit Discover');
          if (input) input.focus();
          return;
        }
        setActiveNav('');
        state.view = '';
        state.activeChip = '';
        runSearch(q);
      });
    }
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = input.value.trim();
          if (!q) {
            toast('Type a keyword, then hit Enter');
            return;
          }
          setActiveNav('');
          state.view = '';
          state.activeChip = '';
          runSearch(q);
        }
      });
    }
  }

  function init() {
    wireSearchBox();
    wireTopicChips();
    wireFilters();
    loadSavedSearches();
    loadCurationWorkspace();
    refreshSidebarCounts();

    const params = new URLSearchParams(window.location.search);
    const q = params.get('q') || '';
    const input = document.getElementById('search-input');
    if (input && q) input.value = q;

    if (params.get('alerts') === '1') {
      createAlert();
    }

    if (q) {
      setHeader('Results for “' + q + '”', 'SEARCH');
      runSearch(q, { keepHeader: true });
    } else {
      switchView('trending', '🔥 Trending Stories');
    }
  }

  global.FeedOmeterSearch = {
    switchView: switchView,
    toast: toast,
    search: runSearch,
    discoverTopic: discoverTopic,
    createWorkspace: createWorkspace,
    createAlert: createAlert
  };

  // Keep onclick="FeedOmeterSearch.toast(...)" working for + New / + Add by upgrading those handlers
  global.FeedOmeterSearch.toast = function (msg) {
    if (/workspace/i.test(String(msg || ''))) {
      createWorkspace();
      return;
    }
    if (/alert/i.test(String(msg || ''))) {
      createAlert();
      return;
    }
    toast(msg);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : this);
