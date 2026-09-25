/**
 * globalsearch/global-search.js — FeedOmeter 2.1 Universal Boolean Spotlight Search
 * Cross-Scope Indexing (Menu Routes, Live Articles, Folders & Bookmarks) + BooleanParser Evaluator
 */
(function (global) {
  'use strict';

  // Static App Navigation Index
  const STATIC_MENU_INDEX = [
    { id: 'home', title: 'Home Dashboard', scope: 'menu', href: 'home.html', icon: '🏠', subtitle: 'Personal intelligence briefing & headlines', keywords: 'home dashboard news' },
    { id: 'search', title: 'Search & News Discovery Intelligence', scope: 'menu', href: 'search.html', icon: '🔍', subtitle: 'Global catalog search, boolean operators & story clustering', keywords: 'search discovery intelligence catalog filter boolean' },
    { id: 'feed-search', title: 'Feed Search', scope: 'menu', href: 'feed-search.html', icon: '🔎', subtitle: 'Discover RSS feeds with preview, follow, and copy URL', keywords: 'feed search find feeds preview follow discover rss sources' },
    { id: 'top-stories', title: 'Top Stories (Live Fusion)', scope: 'menu', href: 'top-stories.html', icon: '🔥', subtitle: 'Live breaking multi-feed stream', keywords: 'top stories breaking news stream' },
    { id: 'starred', title: 'Starred Articles', scope: 'saved', href: 'starred.html', icon: '⭐', subtitle: 'Favorite bookmarked stories', keywords: 'starred bookmarks favorites' },
    { id: 'readlater', title: 'Read Later Queue', scope: 'saved', href: 'read-later.html', icon: '🔖', subtitle: 'Reading queue for later consumption', keywords: 'read later saved queue' },
    { id: 'watchlists', title: 'Watchlists & Folders', scope: 'folders', href: 'watchlists.html', icon: '📁', subtitle: 'Custom folder collections & feeds', keywords: 'watchlists folders feeds collections' },
    { id: 'read-rss', title: 'Focused 2-Pane Reader', scope: 'menu', href: 'read-rss.html', icon: '📡', subtitle: 'Focused split stream and reading view', keywords: 'reader rss view split' },
    { id: 'find-sources', title: 'Discover & Catalog Sources', scope: 'menu', href: 'find-sources.html', icon: '🔍', subtitle: 'Curated directory of 1,500+ RSS feeds', keywords: 'discover sources catalog nexus' },
    { id: 'add-source', title: 'Add Custom RSS Feed', scope: 'menu', href: 'add-source.html', icon: '➕', subtitle: 'Subscribe to any RSS/Atom link', keywords: 'add custom rss feed subscribe' },
    { id: 'integrations', title: 'Integrations & API Marketplace', scope: 'menu', href: 'integrations.html', icon: '🔌', subtitle: 'Connect Slack, Microsoft Teams, Discord & Zapier', keywords: 'integrations marketplace slack teams microsoft discord zapier make n8n webhooks api' },
    { id: 'account', title: 'Account & OPML 2.0 Portability', scope: 'menu', href: 'account.html', icon: '👤', subtitle: 'User profile, OPML 2.0 import/export & backup', keywords: 'account profile opml export import data subscriptions settings' },
    { id: 'settings', title: 'Settings & Identity', scope: 'menu', href: 'settings.html', icon: '⚙️', subtitle: 'Manage profile, security, connected accounts & preferences', keywords: 'account profile security password devices preferences settings' }
  ];

  const state = {
    isOpen: false,
    query: '',
    scope: 'all', // 'all' | 'menu' | 'articles' | 'saved'
    selectedIndex: 0,
    results: []
  };

  function getDynamicIndex() {
    const list = [...STATIC_MENU_INDEX];

    // Read live articles from active iframe if accessible
    try {
      const frame = document.getElementById('rv-shell-frame');
      if (frame && frame.contentWindow) {
        const frameArts = frame.contentWindow._allArticles || frame.contentWindow._articles || [];
        if (Array.isArray(frameArts)) {
          frameArts.forEach(a => {
            if (!a || !a.title) return;
            list.push({
              id: a.id || a.link,
              title: a.title,
              subtitle: (a.source ? a.source.title : 'Live Feed') + (a.published ? ` • ${new Date(a.published).toLocaleDateString()}` : ''),
              scope: 'articles',
              href: a.link || 'top-stories.html',
              icon: '📰',
              keywords: `article headline ${a.title} ${a.summary || ''} ${a.source ? a.source.title : ''}`
            });
          });
        }
      }
    } catch (e) {}

    return list;
  }

  function executeSearch(query, scope = 'all') {
    const allItems = getDynamicIndex();
    if (!query || !query.trim()) {
      return allItems.slice(0, 10);
    }

    const filteredByScope = scope === 'all' 
      ? allItems 
      : allItems.filter(item => item.scope === scope);

    // Use BooleanParser AST evaluator
    if (global.BooleanParser) {
      return global.BooleanParser.filter(query, filteredByScope, item => {
        return `${item.title} ${item.subtitle || ''} ${item.keywords || ''}`;
      });
    }

    // Fallback standard search
    const q = query.toLowerCase();
    return filteredByScope.filter(item => 
      item.title.toLowerCase().includes(q) || 
      (item.keywords && item.keywords.toLowerCase().includes(q))
    );
  }

  function mergeRemoteArticles(query) {
    const q = (query || '').trim();
    if (q.length < 2) return;
    const api = (global.FEEDOMETER_API_BASE || 'https://feedometer-api.feedometer.workers.dev').replace(/\/$/, '');
    fetch(api + '/api/search?q=' + encodeURIComponent(q) + '&limit=8').then((r) => r.json()).then((json) => {
      const extras = (json.items || []).map((a) => ({
        id: a.id,
        title: a.title,
        scope: 'articles',
        href: a.url || a.link,
        icon: '📰',
        subtitle: (a.source && a.source.title) || '',
        keywords: ''
      }));
      const seen = new Set(state.results.map((r) => r.href));
      extras.forEach((e) => { if (e.href && !seen.has(e.href)) state.results.push(e); });
      renderResults();
    }).catch(() => {});
  }

  function renderResults() {
    const container = document.getElementById('feedo-search-results-list');
    if (!container) return;

    if (state.results.length === 0) {
      container.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
          No matching results for "${state.query}"
        </div>
      `;
      return;
    }

    let html = '';
    state.results.slice(0, 15).forEach((res, idx) => {
      const isSelected = idx === state.selectedIndex;
      html += `
        <div class="feedo-search-result-item ${isSelected ? 'selected' : ''}" data-index="${idx}" data-href="${res.href}">
          <div class="result-item-main">
            <span class="result-item-icon">${res.icon || '📄'}</span>
            <div class="result-item-text">
              <span class="result-item-title">${res.title}</span>
              ${res.subtitle ? `<span class="result-item-sub">${res.subtitle}</span>` : ''}
            </div>
          </div>
          <span class="result-item-badge">${res.scope}</span>
        </div>
      `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.feedo-search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const href = el.getAttribute('data-href');
        selectResult(href);
      });
    });
  }

  function selectResult(href) {
    if (!href) return;
    closeSearch();

    if (href.startsWith('settings.html')) {
      const tab = href.includes('tab=') ? href.split('tab=')[1].split('&')[0] : 'profile';
      if (typeof window.openSettingsModal === 'function') {
        window.openSettingsModal(tab);
        return;
      }
    }

    if (href.startsWith('http://') || href.startsWith('https://')) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }

    const frame = document.getElementById('rv-shell-frame');
    if (frame) {
      frame.src = href;
      try {
        window.history.pushState(null, '', `?view=${encodeURIComponent(href)}`);
      } catch (e) {}
    } else {
      window.location.href = href;
    }
  }

  function openSearch(initialQuery = '') {
    state.isOpen = true;
    state.query = initialQuery;
    state.selectedIndex = 0;
    state.results = executeSearch(state.query, state.scope);

    const backdrop = document.getElementById('feedo-search-backdrop');
    const input = document.getElementById('feedo-search-modal-input');

    if (backdrop) backdrop.classList.add('open');
    if (input) {
      input.value = initialQuery;
      setTimeout(() => input.focus(), 50);
    }
    renderResults();
  }

  function closeSearch() {
    state.isOpen = false;
    const backdrop = document.getElementById('feedo-search-backdrop');
    if (backdrop) backdrop.classList.remove('open');
  }

  function init() {
    const backdrop = document.getElementById('feedo-search-backdrop');
    const input = document.getElementById('feedo-search-modal-input');

    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeSearch();
      });
    }

    if (input) {
      input.addEventListener('input', (e) => {
        state.query = e.target.value;
        state.selectedIndex = 0;
        state.results = executeSearch(state.query, state.scope);
        renderResults();
        mergeRemoteArticles(state.query);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          state.selectedIndex = Math.min(state.selectedIndex + 1, Math.min(state.results.length - 1, 14));
          renderResults();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
          renderResults();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const selected = state.results[state.selectedIndex];
          if (selected) selectResult(selected.href);
        } else if (e.key === 'Escape') {
          closeSearch();
        }
      });
    }

    // Topbar Search Input Trigger
    const topbarInput = document.getElementById('feedo-topbar-search-trigger');
    if (topbarInput) {
      topbarInput.addEventListener('focus', () => {
        const val = topbarInput.value;
        topbarInput.value = '';
        openSearch(val);
      });
      topbarInput.addEventListener('click', () => openSearch(topbarInput.value));
    }

    // Scope Pills
    document.querySelectorAll('[data-search-scope]').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('[data-search-scope]').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.scope = pill.getAttribute('data-search-scope');
        state.results = executeSearch(state.query, state.scope);
        renderResults();
        mergeRemoteArticles(state.query);
      });
    });

    // Global Keydown: Ctrl+K / Cmd+K
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (state.isOpen) closeSearch();
        else openSearch();
      }
    });
  }

  global.FeedOmeterSearch = {
    open: openSearch,
    close: closeSearch,
    search: executeSearch
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
