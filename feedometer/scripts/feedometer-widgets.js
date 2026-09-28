/**
 * scripts/feedometer-widgets.js — FeedOmeter 2.1 Widget Studio Controller
 * Live Canvas Engine, 6 Layouts, Real-time Theme/Color/Typography Customization, Pagination & Embed Exporter
 */

(function (window, document) {
  'use strict';

  function getApiBase() {
    if (window.FEEDOMETER_API_BASE) {
      return window.FEEDOMETER_API_BASE.replace(/\/+$/, '');
    }
    if (window.FeedOmeterConfig && (window.FeedOmeterConfig.apiBaseUrl || window.FeedOmeterConfig.API_BASE_URL)) {
      return (window.FeedOmeterConfig.apiBaseUrl || window.FeedOmeterConfig.API_BASE_URL).replace(/\/+$/, '');
    }
    if (window.FEEDOMETER_CONFIG && (window.FEEDOMETER_CONFIG.apiBaseUrl || window.FEEDOMETER_CONFIG.API_BASE_URL || window.FEEDOMETER_CONFIG.API_BASE)) {
      return (window.FEEDOMETER_CONFIG.apiBaseUrl || window.FEEDOMETER_CONFIG.API_BASE_URL || window.FEEDOMETER_CONFIG.API_BASE).replace(/\/+$/, '');
    }
    return '';
  }

  function decodeEntities(str) {
    if (!str) return '';
    try {
      const txt = document.createElement('textarea');
      txt.innerHTML = String(str);
      return txt.value || txt.textContent || String(str);
    } catch (_) {
      return String(str);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      const now = new Date();
      const diffMs = now - d;
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (_) {
      return '';
    }
  }

  // Default Widget State
  const widgetState = {
    title: 'Live News Feed',
    feedUrl: '',
    layout: 'news-wall',
    theme: 'light',
    accentColor: '#10b981',
    radius: '12px',
    font: "'Inter', sans-serif",
    shadow: 'soft',
    titleClamp: 2,
    showHeader: true,
    headerAlign: 'left',
    linkTarget: '_blank',
    tickerSpeed: 20,
    itemsPerPage: 6,
    currentPage: 1,
    showThumbnails: true,
    showDescriptions: true,
    showDate: true,
    viewport: 'desktop',
    filterRules: {
      enabled: true,
      noImage: false,
      noDescription: false,
      noSecureLink: false,
      dupTitle: false,
      similarTitle: false,
      oldPosts: false,
      oldDays: 3,
      includeKeywords: '',
      excludeKeywords: '',
      language: 'all'
    },
    rawArticles: [],
    articles: []
  };

  // Sample seed articles if no URL loaded yet
  const sampleArticles = [
    {
      title: 'Global Tech & AI Summit Unveils Next-Gen Neural Acceleration Chips',
      link: '#',
      description: 'Industry leaders gather to showcase breakthrough neural processing architectures delivering 10x compute efficiency.',
      image: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=600&auto=format&fit=crop&q=80',
      source: 'TechPulse',
      pubDate: new Date().toISOString()
    },
    {
      title: 'Clean Energy Transition Accelerates Across Coastal Power Grids',
      link: '#',
      description: 'Offshore wind developments surpass quarterly generation projections with innovative storage integration.',
      image: 'https://images.unsplash.com/photo-1509391365360-2e959784a276?w=600&auto=format&fit=crop&q=80',
      source: 'GreenWire',
      pubDate: new Date().toISOString()
    },
    {
      title: 'Space Exploration Agency Schedules Autonomous Rover Lunar Deployment',
      link: '#',
      description: 'New landing system completes extreme environmental stress tests ahead of scheduled launch.',
      image: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&auto=format&fit=crop&q=80',
      source: 'Cosmos News',
      pubDate: new Date().toISOString()
    },
    {
      title: 'Global Financial Markets Rally on Positive Manufacturing Indicators',
      link: '#',
      description: 'Supply chain index rebound powers broad-based international equity advances.',
      image: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&auto=format&fit=crop&q=80',
      source: 'MarketSphere',
      pubDate: new Date().toISOString()
    },
    {
      title: 'Biotech Breakthrough: Rapid Molecular Screening Accelerates Therapeutics',
      link: '#',
      description: 'Computational modeling identifies key peptide candidates for targeted cellular repair.',
      image: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=600&auto=format&fit=crop&q=80',
      source: 'BioTech Daily',
      pubDate: new Date().toISOString()
    },
    {
      title: 'Autonomous Transportation Systems Complete Million-Mile Safety Trial',
      link: '#',
      description: 'Next-generation sensor fusion and real-time mapping pass rigorous urban safety audits.',
      image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
      source: 'AutoDrive',
      pubDate: new Date().toISOString()
    }
  ];

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

  function applyWidgetFilters() {
    const rawList = widgetState.rawArticles && widgetState.rawArticles.length
      ? widgetState.rawArticles
      : sampleArticles;
    const rules = widgetState.filterRules;

    if (!rules || !rules.enabled) {
      widgetState.articles = rawList;
      updateFilterPill();
      renderLiveCanvas();
      return;
    }

    const seenTitles = new Set();
    const processedTokens = [];
    const visible = [];

    rawList.forEach((art) => {
      let hide = false;

      // Quality: Image
      if (rules.noImage) {
        const hasImg = Boolean(art.image || art.image_url || art.thumbnail || art.ogImage || art.hero_image || (art.enclosure && art.enclosure.url));
        if (!hasImg) hide = true;
      }

      // Quality: Description
      if (rules.noDescription) {
        const hasDesc = Boolean(art.description || art.summary || art.snippet);
        if (!hasDesc) hide = true;
      }

      // Quality: Secure link
      if (rules.noSecureLink) {
        const isSecure = String(art.link || '').startsWith('https://');
        if (!isSecure) hide = true;
      }

      // Duplicate: Exact Title
      const cleanTitle = (art.title || '').trim().toLowerCase();
      if (rules.dupTitle) {
        if (seenTitles.has(cleanTitle)) {
          hide = true;
        }
      }
      seenTitles.add(cleanTitle);

      // Duplicate: Similar Title (>= 74% Jaccard similarity)
      const tokens = getTokens(art.title);
      if (rules.similarTitle) {
        let isSimilar = false;
        for (const prevTokens of processedTokens) {
          if (jaccardSimilarity(tokens, prevTokens) >= 0.74) {
            isSimilar = true;
            break;
          }
        }
        if (isSimilar) hide = true;
      }
      processedTokens.push(tokens);

      // Freshness: Age in Days
      if (rules.oldPosts && art.pubDate) {
        const ageDays = (Date.now() - new Date(art.pubDate).getTime()) / (86400000);
        if (ageDays > (rules.oldDays || 3)) hide = true;
      }

      // Keywords: Include
      if (rules.includeKeywords) {
        const inc = rules.includeKeywords.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        const textTarget = (cleanTitle + ' ' + (art.description || '')).toLowerCase();
        if (inc.length && !inc.some(k => textTarget.includes(k))) hide = true;
      }

      // Keywords: Exclude
      if (rules.excludeKeywords) {
        const exc = rules.excludeKeywords.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        const textTarget = (cleanTitle + ' ' + (art.description || '')).toLowerCase();
        if (exc.some(k => textTarget.includes(k))) hide = true;
      }

      // Language filter
      if (rules.language && rules.language !== 'all') {
        const itemLang = (art.language || art.lang || '').toLowerCase();
        if (itemLang && itemLang !== rules.language.toLowerCase() && !itemLang.startsWith(rules.language.toLowerCase())) {
          hide = true;
        }
      }

      if (!hide) visible.push(art);
    });

    widgetState.articles = visible;
    updateFilterPill();
    renderLiveCanvas();
  }

  function updateFilterPill() {
    const pill = document.getElementById('ws-filter-active-pill');
    if (!pill) return;
    const rules = widgetState.filterRules;
    const isFiltered = rules && rules.enabled && (
      rules.noImage || rules.noDescription || rules.noSecureLink ||
      rules.dupTitle || rules.similarTitle || rules.oldPosts ||
      rules.includeKeywords || rules.excludeKeywords || (rules.language && rules.language !== 'all')
    );
    if (isFiltered) {
      const activeCount = widgetState.articles.length;
      pill.textContent = `⚡ ${activeCount} items (Filtered)`;
      pill.style.background = 'rgba(255, 255, 255, 0.9)';
      pill.style.color = '#047857';
      pill.style.border = '1px solid rgba(16, 185, 129, 0.3)';
    } else {
      pill.textContent = 'No filters';
      pill.style.background = 'rgba(255, 255, 255, 0.55)';
      pill.style.color = '#475569';
      pill.style.border = '1px solid rgba(0, 0, 0, 0.08)';
    }
  }

  function updateStatusBadge() {
    const statusText = document.getElementById('ws-live-status');
    if (statusText) {
      const filtered = (widgetState.articles && widgetState.articles.length) || 0;
      const total = (widgetState.rawArticles && widgetState.rawArticles.length) || filtered;
      statusText.textContent = `${filtered} / ${total}`;
    }
  }

  function init() {
    loadSavedPreferences();
    populateFontSelect();
    updateFilterPill();
    updateStatusBadge();
    setupEventListeners();
    handleUrlParams();
  }

  /** Populate from the shared, whitelist-backed catalogue rather than a small hardcoded list. */
  function populateFontSelect() {
    const fontSelect = document.getElementById('ws-font-select');
    const catalogue = window.FeedOmeterWidgetFonts;
    if (!fontSelect || !catalogue) return;
    fontSelect.innerHTML = catalogue.all.map((font) =>
      `<option value="${escapeHtml(font.value)}">${escapeHtml(font.label)}</option>`
    ).join('');
    const selected = catalogue.find(widgetState.font);
    widgetState.font = selected.value;
    fontSelect.value = selected.value;
    catalogue.load(selected.value);
  }

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

  let widgetPollTimer = null;
  let widgetPreviewJobId = '';

  function pollWidgetPreview() {
    if (!widgetPreviewJobId) return;
    window.clearTimeout(widgetPollTimer);
    widgetPollTimer = window.setTimeout(async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/feed-preview/${encodeURIComponent(widgetPreviewJobId)}`);
        if (!res.ok) { widgetPreviewJobId = ''; return; }
        const data = await res.json();
        if (data.articles && data.articles.length > widgetState.rawArticles.length) {
          widgetState.rawArticles = data.articles;
          applyWidgetFilters();
          const statusText = document.getElementById('ws-live-status');
          if (statusText) statusText.textContent = `Loaded ${data.articles.length} live items`;
        }
        if (data.progress && !data.progress.complete) {
          pollWidgetPreview();
        } else {
          widgetPreviewJobId = '';
        }
      } catch (_) {
        pollWidgetPreview();
      }
    }, 1200);
  }

  function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const feed = params.get('feed') || params.get('url');

    // 1. Try reading transferred feed & filter rules from Filter Studio
    const isFromFilters = params.get('from') === 'filters';
    if (isFromFilters) {
      try {
        const transferRaw = localStorage.getItem('feedometer_filter_transfer') || sessionStorage.getItem('feedometer_filter_transfer');
        if (transferRaw) {
          const transfer = JSON.parse(transferRaw);
          if (Array.isArray(transfer.articles) && transfer.articles.length > 0) {
            if (transfer.filterRules) Object.assign(widgetState.filterRules, transfer.filterRules);
            widgetState.articles = transfer.articles;
            widgetState.rawArticles = (transfer.rawArticles && transfer.rawArticles.length) ? transfer.rawArticles : transfer.articles;
            widgetState.feedUrl = transfer.feedUrl || feed || '';
            widgetState.title = transfer.title || 'Live Feed';
            widgetState.currentPage = 1;

            const urlInput = document.getElementById('ws-feed-url');
            if (urlInput) urlInput.value = widgetState.feedUrl;

            const titleInput = document.getElementById('ws-widget-title');
            if (titleInput) titleInput.value = widgetState.title;

            const statusText = document.getElementById('ws-live-status');
            if (statusText) statusText.textContent = `✨ Loaded ${transfer.articles.length} filtered items (${widgetState.rawArticles.length} total)`;

            updateFilterPill();
            saveState();
            renderLiveCanvas();
            return;
          }
        }
      } catch (_) {}
    }

    // When NOT coming from filters, ensure default clean rules with no filters blocking items
    widgetState.filterRules = {
      enabled: true,
      noImage: false,
      noDescription: false,
      noSecureLink: false,
      dupTitle: false,
      similarTitle: false,
      oldPosts: false,
      oldDays: 3,
      includeKeywords: '',
      excludeKeywords: '',
      language: 'all'
    };

    // 2. Try reading recent preview from Add Source in localStorage or sessionStorage
    let usedSessionCache = false;
    try {
      const cachedRaw = localStorage.getItem('feedometer_last_preview') || sessionStorage.getItem('feedometer_last_preview');
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        const isRecent = cached.timestamp && (Date.now() - cached.timestamp < 2 * 3600 * 1000);
        const isUrlMatch = !feed || urlsMatch(cached.feedUrl, feed) || urlsMatch(cached.rawUrl, feed);

        if (isRecent && isUrlMatch && Array.isArray(cached.articles) && cached.articles.length > 0) {
          widgetState.rawArticles = cached.articles;
          widgetState.title = cached.title || cached.name || 'Live Feed';
          widgetState.feedUrl = cached.feedUrl || cached.rawUrl || feed || '';
          widgetState.currentPage = 1;

          const urlInput = document.getElementById('ws-feed-url');
          if (urlInput) urlInput.value = widgetState.feedUrl;

          const titleInput = document.getElementById('ws-widget-title');
          if (titleInput) titleInput.value = widgetState.title;

          const statusText = document.getElementById('ws-live-status');
          if (statusText) statusText.textContent = `Loaded ${cached.articles.length} live items`;

          saveState();
          applyWidgetFilters();
          usedSessionCache = true;
        }
      }
    } catch (_) {}

    if (usedSessionCache) return;

    if (feed) {
      widgetState.feedUrl = feed;
      widgetState.currentPage = 1;
      const urlInput = document.getElementById('ws-feed-url');
      if (urlInput) urlInput.value = feed;

      loadNewFeed(feed, { fallbackToSample: true });
    } else {
      loadLivePublicStream();
    }
  }

  function loadSavedPreferences() {
    try {
      const raw = localStorage.getItem('feedometer_widget_state');
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.layout) widgetState.layout = saved.layout;
        if (saved.theme) widgetState.theme = saved.theme;
        if (saved.accentColor) widgetState.accentColor = saved.accentColor;
        if (saved.radius) widgetState.radius = saved.radius;
        if (saved.font) widgetState.font = saved.font;
        if (saved.shadow) widgetState.shadow = saved.shadow;
        if (saved.titleClamp) widgetState.titleClamp = parseInt(saved.titleClamp, 10) || 2;
        if (typeof saved.showHeader === 'boolean') widgetState.showHeader = saved.showHeader;
        if (saved.headerAlign) widgetState.headerAlign = saved.headerAlign;
        if (saved.linkTarget) widgetState.linkTarget = saved.linkTarget;
        if (typeof saved.tickerSpeed !== 'undefined') {
          const s = parseInt(saved.tickerSpeed, 10);
          widgetState.tickerSpeed = isNaN(s) ? 20 : Math.max(0, Math.min(100, s));
        }
        if (saved.itemsPerPage) widgetState.itemsPerPage = saved.itemsPerPage;
        if (typeof saved.showThumbnails === 'boolean') widgetState.showThumbnails = saved.showThumbnails;
        if (typeof saved.showDescriptions === 'boolean') widgetState.showDescriptions = saved.showDescriptions;
        if (typeof saved.showDate === 'boolean') widgetState.showDate = saved.showDate;
        if (saved.filterRules && typeof saved.filterRules === 'object') {
          Object.assign(widgetState.filterRules, saved.filterRules);
        }
      }
    } catch (_) {}
  }

  function saveState() {
    try {
      localStorage.setItem('feedometer_widget_state', JSON.stringify({
        title: widgetState.title,
        layout: widgetState.layout,
        theme: widgetState.theme,
        accentColor: widgetState.accentColor,
        radius: widgetState.radius,
        font: widgetState.font,
        shadow: widgetState.shadow,
        titleClamp: widgetState.titleClamp,
        showHeader: widgetState.showHeader,
        headerAlign: widgetState.headerAlign,
        linkTarget: widgetState.linkTarget,
        tickerSpeed: widgetState.tickerSpeed,
        itemsPerPage: widgetState.itemsPerPage,
        showThumbnails: widgetState.showThumbnails,
        showDescriptions: widgetState.showDescriptions,
        showDate: widgetState.showDate,
        filterRules: widgetState.filterRules
      }));
    } catch (_) {}
  }

  /** Normalize user-pasted feed URLs before asking the existing Worker loader. */
  function normalizeFeedUrl(value) {
    const input = String(value || '').trim();
    if (!input) throw new Error('Paste an RSS or Atom feed URL first.');
    const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const parsed = new URL(candidate);
    if (!/^https?:$/i.test(parsed.protocol)) throw new Error('Use an http:// or https:// feed URL.');
    return parsed.toString();
  }

  function setFeedLoading(isLoading) {
    const input = document.getElementById('ws-feed-url');
    const button = document.getElementById('ws-btn-load-feed');
    if (input) input.disabled = isLoading;
    if (button) {
      button.disabled = isLoading;
      button.setAttribute('aria-busy', String(isLoading));
      button.title = isLoading ? 'Loading feed…' : 'Load RSS or Atom feed';
    }
  }

  function updateBrowserFeedState(feedUrl) {
    try {
      const current = new URL(window.location.href);
      current.searchParams.set('feed', feedUrl);
      window.history.replaceState(null, '', current.toString());
    } catch (_) {}
  }

  /**
   * Shared entry point for a direct Widget Studio paste and the Add Source
   * handoff. It deliberately keeps the last successful preview intact when a
   * new URL cannot be loaded.
   */
  async function loadNewFeed(rawFeedUrl, options = {}) {
    const statusText = document.getElementById('ws-live-status');
    const input = document.getElementById('ws-feed-url');
    const previous = {
      articles: widgetState.articles,
      title: widgetState.title,
      feedUrl: widgetState.feedUrl,
      currentPage: widgetState.currentPage
    };
    let feedUrl;
    try {
      feedUrl = normalizeFeedUrl(rawFeedUrl);
    } catch (error) {
      if (statusText) statusText.textContent = error.message;
      if (input) input.focus();
      return false;
    }

    if (input) input.value = feedUrl;
    setFeedLoading(true);
    if (statusText) statusText.textContent = 'Loading feed…';
    renderSkeletonCanvas();

    try {
      const loaded = await loadFeedData(feedUrl);
      if (loaded) {
        updateBrowserFeedState(feedUrl);
        return true;
      }

      widgetState.articles = previous.articles;
      widgetState.title = previous.title;
      widgetState.feedUrl = previous.feedUrl;
      widgetState.currentPage = previous.currentPage;
      if (input) input.value = previous.feedUrl || feedUrl;
      if (options.fallbackToSample && !previous.articles.length) {
        widgetState.articles = sampleArticles;
        if (statusText) statusText.textContent = 'Could not load this feed; showing sample preview data';
      } else if (statusText) {
        statusText.textContent = 'Could not load this feed; your previous preview is unchanged';
      }
      renderLiveCanvas();
      return false;
    } finally {
      setFeedLoading(false);
    }
  }

  function setupEventListeners() {
    // Title Input
    const titleInput = document.getElementById('ws-widget-title');
    if (titleInput) {
      titleInput.value = widgetState.title;
      titleInput.addEventListener('input', (e) => {
        widgetState.title = e.target.value;
        saveState();
        renderLiveCanvas();
      });
    }

    // Feed Search & Load
    const feedInput = document.getElementById('ws-feed-url');
    const btnLoadFeed = document.getElementById('ws-btn-load-feed');
    if (feedInput && btnLoadFeed) {
      const triggerLoad = () => loadNewFeed(feedInput.value);
      btnLoadFeed.addEventListener('click', triggerLoad);
      feedInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerLoad();
        }
      });
    }

    // Layout Pickers
    document.querySelectorAll('.ws-layout-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const layout = e.currentTarget.getAttribute('data-layout');
        if (layout) {
          widgetState.layout = layout;
          document.querySelectorAll('.ws-layout-card').forEach(c => c.classList.toggle('is-active', c === card));
          saveState();
          renderLiveCanvas();
        }
      });
    });

    // Theme Preset Select
    const themeSelect = document.getElementById('ws-theme-select');
    if (themeSelect) {
      themeSelect.value = widgetState.theme;
      themeSelect.addEventListener('change', (e) => {
        widgetState.theme = e.target.value;
        saveState();
        renderLiveCanvas();
      });
    }

    // Accent Color Picker
    const colorInput = document.getElementById('ws-color-accent');
    if (colorInput) {
      colorInput.value = widgetState.accentColor;
      colorInput.addEventListener('input', (e) => {
        widgetState.accentColor = e.target.value;
        saveState();
        renderLiveCanvas();
      });
    }

    // Radius Select
    const radiusSelect = document.getElementById('ws-radius-select');
    if (radiusSelect) {
      radiusSelect.value = widgetState.radius;
      radiusSelect.addEventListener('change', (e) => {
        widgetState.radius = e.target.value;
        saveState();
        renderLiveCanvas();
      });
    }

    // Font Select
    const fontSelect = document.getElementById('ws-font-select');
    if (fontSelect) {
      fontSelect.value = widgetState.font;
      fontSelect.addEventListener('change', (e) => {
        widgetState.font = e.target.value;
        if (window.FeedOmeterWidgetFonts) window.FeedOmeterWidgetFonts.load(widgetState.font);
        saveState();
        renderLiveCanvas();
      });
    }

    // Items Per Page Slider
    const itemsSlider = document.getElementById('ws-items-slider');
    const itemsCountLabel = document.getElementById('ws-items-count-label');
    if (itemsSlider) {
      itemsSlider.value = widgetState.itemsPerPage;
      if (itemsCountLabel) itemsCountLabel.textContent = widgetState.itemsPerPage;
      itemsSlider.addEventListener('input', (e) => {
        widgetState.itemsPerPage = parseInt(e.target.value, 10);
        widgetState.currentPage = 1;
        if (itemsCountLabel) itemsCountLabel.textContent = widgetState.itemsPerPage;
        saveState();
        renderLiveCanvas();
      });
    }

    // Header Toggle & Alignment
    const toggleHeader = document.getElementById('ws-toggle-header');
    if (toggleHeader) {
      toggleHeader.checked = widgetState.showHeader;
      toggleHeader.addEventListener('change', (e) => {
        widgetState.showHeader = e.target.checked;
        saveState();
        renderLiveCanvas();
      });
    }

    const headerAlignSelect = document.getElementById('ws-header-align');
    if (headerAlignSelect) {
      headerAlignSelect.value = widgetState.headerAlign;
      headerAlignSelect.addEventListener('change', (e) => {
        widgetState.headerAlign = e.target.value;
        saveState();
        renderLiveCanvas();
      });
    }

    // Shadow Select
    const shadowSelect = document.getElementById('ws-shadow-select');
    if (shadowSelect) {
      shadowSelect.value = widgetState.shadow;
      shadowSelect.addEventListener('change', (e) => {
        widgetState.shadow = e.target.value;
        saveState();
        renderLiveCanvas();
      });
    }

    // Title Clamp Select
    const titleClampSelect = document.getElementById('ws-title-clamp');
    if (titleClampSelect) {
      titleClampSelect.value = String(widgetState.titleClamp);
      titleClampSelect.addEventListener('change', (e) => {
        widgetState.titleClamp = parseInt(e.target.value, 10) || 2;
        saveState();
        renderLiveCanvas();
      });
    }

    // Target Select
    const targetSelect = document.getElementById('ws-target-select');
    if (targetSelect) {
      targetSelect.value = widgetState.linkTarget;
      targetSelect.addEventListener('change', (e) => {
        widgetState.linkTarget = e.target.value;
        saveState();
        renderLiveCanvas();
      });
    }

    // Ticker Speed Controls (Slider 0-100 + Select Presets)
    const tickerSlider = document.getElementById('ws-ticker-speed-slider');
    const tickerSelect = document.getElementById('ws-ticker-speed-select');
    const tickerValLabel = document.getElementById('ws-ticker-speed-val');

    function updateSpeedUi(speedNum) {
      const num = Math.max(0, Math.min(100, parseInt(speedNum, 10) || 0));
      widgetState.tickerSpeed = num;

      if (tickerSlider) tickerSlider.value = num;
      if (tickerSelect) {
        // If exact match with preset option, select it; otherwise keep or select closest
        const hasOpt = Array.from(tickerSelect.options).some(o => o.value === String(num));
        if (hasOpt) tickerSelect.value = String(num);
      }
      if (tickerValLabel) {
        if (num === 0) tickerValLabel.textContent = '0 (Stopped)';
        else if (num <= 12) tickerValLabel.textContent = `${num} (Ultra Slow)`;
        else if (num <= 25) tickerValLabel.textContent = `${num} (Slow & Clear)`;
        else if (num <= 45) tickerValLabel.textContent = `${num} (Comfortable)`;
        else if (num <= 70) tickerValLabel.textContent = `${num} (Medium)`;
        else tickerValLabel.textContent = `${num} (Fast)`;
      }

      applyTickerSpeedToDom(num);
      saveState();
    }

    if (tickerSlider) {
      tickerSlider.value = widgetState.tickerSpeed;
      tickerSlider.addEventListener('input', (e) => updateSpeedUi(e.target.value));
    }
    if (tickerSelect) {
      tickerSelect.value = String(widgetState.tickerSpeed);
      tickerSelect.addEventListener('change', (e) => updateSpeedUi(e.target.value));
    }
    updateSpeedUi(widgetState.tickerSpeed);

    // Toggles
    const toggleThumb = document.getElementById('ws-toggle-thumbnails');
    if (toggleThumb) {
      toggleThumb.checked = widgetState.showThumbnails;
      toggleThumb.addEventListener('change', (e) => {
        widgetState.showThumbnails = e.target.checked;
        saveState();
        renderLiveCanvas();
      });
    }

    const toggleDesc = document.getElementById('ws-toggle-desc');
    if (toggleDesc) {
      toggleDesc.checked = widgetState.showDescriptions;
      toggleDesc.addEventListener('change', (e) => {
        widgetState.showDescriptions = e.target.checked;
        saveState();
        renderLiveCanvas();
      });
    }

    const toggleDate = document.getElementById('ws-toggle-date');
    if (toggleDate) {
      toggleDate.checked = widgetState.showDate;
      toggleDate.addEventListener('change', (e) => {
        widgetState.showDate = e.target.checked;
        saveState();
        renderLiveCanvas();
      });
    }

    // Viewport Switchers
    document.querySelectorAll('.ws-viewport-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const vp = e.currentTarget.getAttribute('data-viewport');
        if (vp) {
          widgetState.viewport = vp;
          document.querySelectorAll('.ws-viewport-btn').forEach(b => b.classList.toggle('is-active', b === btn));
          const canvas = document.getElementById('ws-preview-canvas');
          if (canvas) {
            canvas.className = 'ws-preview-canvas view-' + vp;
          }
        }
      });
    });

    // Section 6: Apply Filters Button
    const btnApplyFilters = document.getElementById('ws-btn-apply-filters');
    if (btnApplyFilters) {
      btnApplyFilters.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          const workspaceData = {
            feedUrl: widgetState.feedUrl,
            title: widgetState.title,
            rules: widgetState.filterRules,
            articles: (widgetState.rawArticles && widgetState.rawArticles.length) ? widgetState.rawArticles : widgetState.articles,
            returnTo: 'widgets',
            timestamp: Date.now()
          };
          localStorage.setItem('feedometer_filter_workspace', JSON.stringify(workspaceData));
          sessionStorage.setItem('feedometer_filter_workspace', JSON.stringify(workspaceData));
        } catch (_) {}
        const params = new URLSearchParams();
        if (widgetState.feedUrl) params.set('feed', widgetState.feedUrl);
        if (widgetState.title && widgetState.title !== 'Live News Feed') params.set('title', widgetState.title);
        params.set('from', 'widgets');
        window.location.href = `filters.html?${params.toString()}`;
      });
    }

    // Embed Code Modal
    const btnGetCode = document.getElementById('ws-btn-get-code');
    const modalEmbed = document.getElementById('ws-modal-embed');
    const btnCloseEmbed = document.getElementById('ws-modal-close-embed');
    if (btnGetCode && modalEmbed) {
      btnGetCode.addEventListener('click', () => {
        generateEmbedCode();
        modalEmbed.hidden = false;
      });
    }
    if (btnCloseEmbed && modalEmbed) {
      btnCloseEmbed.addEventListener('click', () => { modalEmbed.hidden = true; });
    }

    // Analytics Modal
    const btnAnalytics = document.getElementById('ws-btn-analytics');
    const modalAnalytics = document.getElementById('ws-modal-analytics');
    const btnCloseAnalytics = document.getElementById('ws-modal-close-analytics');
    if (btnAnalytics && modalAnalytics) {
      btnAnalytics.addEventListener('click', () => { modalAnalytics.hidden = false; });
    }
    if (btnCloseAnalytics && modalAnalytics) {
      btnCloseAnalytics.addEventListener('click', () => { modalAnalytics.hidden = true; });
    }
  }

  async function loadLivePublicStream() {
    const statusText = document.getElementById('ws-live-status');
    try {
      const res = await fetch(getApiBase() + '/api/stream?limit=25');
      const data = await res.json();
      if (data.items && data.items.length) {
        widgetState.rawArticles = data.items.map((i) => ({
          title: i.title,
          link: i.link || i.url,
          description: i.summary || i.snippet || '',
          image: i.image || i.image_url || '',
          source: (i.source && i.source.title) || 'Feed',
          pubDate: i.published
        }));
        if (statusText) statusText.textContent = 'Live public stream (' + widgetState.rawArticles.length + ' items)';
        applyWidgetFilters();
        return;
      }
    } catch (e) {}
    if (statusText) statusText.textContent = 'Sample preview (not live)';
    widgetState.rawArticles = sampleArticles;
    applyWidgetFilters();
  }

  async function loadFeedData(rawFeedUrl) {
    const statusText = document.getElementById('ws-live-status');
    if (statusText) statusText.textContent = 'Loading live feed items...';

    // Extract target if it's an API view URL
    let target = rawFeedUrl;
    try {
      if (rawFeedUrl.includes('/api/view')) {
        const parsed = new URL(rawFeedUrl, window.location.origin);
        target = parsed.searchParams.get('url') || parsed.searchParams.get('q') || rawFeedUrl;
      }
    } catch (_) {}

    // ── LOCAL RSS FETCH: for localhost/saved-feed URLs, parse RSS XML directly ──
    const isLocalUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(target);
    const isXmlFeed = /\/(saved-feed|rss|feed|atom)(\/|\.xml|$)/i.test(target);
    if (isLocalUrl || isXmlFeed) {
      try {
        const res = await fetch(target);
        if (res.ok) {
          const xml = await res.text();
          const isRss = xml.includes('<rss') || xml.includes('<feed') || xml.includes('<item') || xml.includes('<entry');
          if (isRss) {
            const articles = parseRssXml(xml, target);
            if (articles.length > 0) {
              widgetState.rawArticles = articles;
              widgetState.feedUrl = rawFeedUrl;
              widgetState.currentPage = 1;
              // Extract title from feed
              const chanTitle = (xml.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1] || '';
              const feedTitle = chanTitle.replace(/<[^>]+>/g, '').trim() || 'Live Feed';
              widgetState.title = feedTitle;
              const titleIn = document.getElementById('ws-widget-title');
              if (titleIn) titleIn.value = feedTitle;
              if (statusText) statusText.textContent = `✓ Loaded ${articles.length} article(s) from your feed`;
              saveState();
              applyWidgetFilters();
              return true;
            }
          }
        }
      } catch (_) {}
    }

    try {
      const res = await fetch(getApiBase() + '/api/feed-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target, limit: 250, enrichOg: true })
      });

      const data = await res.json();
      if (res.ok && data.articles && data.articles.length > 0) {
        widgetState.rawArticles = data.articles;
        widgetState.feedUrl = rawFeedUrl;
        widgetState.currentPage = 1;

        // Always update title to match the incoming feed
        const freshTitle = (data.meta && data.meta.title) || data.name || 'Live Feed';
        widgetState.title = freshTitle;
        const titleIn = document.getElementById('ws-widget-title');
        if (titleIn) titleIn.value = freshTitle;

        if (statusText) statusText.textContent = `Loaded ${data.articles.length} live items`;
        saveState();
        applyWidgetFilters();

        if (data.job_id && data.progress && !data.progress.complete) {
          widgetPreviewJobId = data.job_id;
          pollWidgetPreview();
        }
        return true;
      } else {
        return false;
      }
    } catch (_) { return false; }
  }

  // ── Parse RSS/Atom XML into article objects ──
  function parseRssXml(xml, sourceUrl) {
    const articles = [];
    const itemBlocks = xml.match(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/gi) || [];
    for (const block of itemBlocks) {
      const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const linkMatch =
        block.match(/<link[^>]*href=["']([^"']+)["']/i) ||
        block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
      const descMatch =
        block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) ||
        block.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i);
      const imgMatch =
        block.match(/<enclosure[^>]+url=["']([^"']+)["']/i) ||
        block.match(/<media:content[^>]+url=["']([^"']+)["']/i) ||
        block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
      const dateMatch =
        block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
        block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);

      const rawImg = imgMatch ? (imgMatch[1] || '') : '';
      const image = (window.FeedImaging && typeof window.FeedImaging.upgradeUrl === 'function')
        ? window.FeedImaging.upgradeUrl(rawImg)
        : rawImg;
      const pubDate = (dateMatch ? dateMatch[1] : '').trim();
      let source = 'Feed';
      try { source = new URL(link || sourceUrl).hostname.replace(/^www\./i, ''); } catch(_) {}

      if (!title && !link) continue;
      articles.push({ title: title || 'Untitled', link: link || sourceUrl, description, image, image_url: image, source, pubDate });
    }
    return articles;
  }



  function renderSkeletonCanvas() {
    const canvas = document.getElementById('ws-preview-canvas');
    if (!canvas) return;

    let skeletonCards = '';
    for (let i = 0; i < 6; i++) {
      skeletonCards += `
        <div class="widget-card" style="opacity: 0.6; pointer-events: none;">
          <div class="widget-card-media" style="background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%); background-size: 200% 100%; animation: wsPulse 1.5s infinite; height: 140px;"></div>
          <div class="widget-card-body">
            <div style="height: 12px; width: 40%; background: #e2e8f0; border-radius: 4px; margin-bottom: 8px;"></div>
            <div style="height: 16px; width: 90%; background: #e2e8f0; border-radius: 4px; margin-bottom: 6px;"></div>
            <div style="height: 12px; width: 70%; background: #f1f5f9; border-radius: 4px;"></div>
          </div>
        </div>
      `;
    }

    canvas.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1.25rem;">
        <h3 style="margin:0; font-size:1.15rem; font-weight:800; color:#0f172a;">Loading live feed...</h3>
        <span style="font-size:0.75rem; font-weight:700; color:#10b981; text-transform:uppercase;">● Live Widget</span>
      </div>
      <div class="widget-layout-${widgetState.layout}">
        ${skeletonCards}
      </div>
    `;
  }

  function applyTickerSpeedToDom(speedNum) {
    const track = document.querySelector('.ticker-track');
    if (!track) return;
    const num = Math.max(0, Math.min(100, parseInt(speedNum, 10) || 0));
    if (num === 0) {
      track.style.animationPlayState = 'paused';
      return;
    }
    track.style.animationPlayState = 'running';
    // Calibrated comfortable velocity: from 5 px/sec (at 1) to 95 px/sec (at 100)
    // At 20 (Slow & Clear): 5 + (20 * 0.9) = 23 px/sec
    const pxPerSec = Math.max(5, 5 + (num * 0.9));
    const halfWidth = (track.scrollWidth / 2) || 4000;
    const durationSec = Math.max(8, (halfWidth / pxPerSec)).toFixed(1);
    track.style.animationDuration = durationSec + 's';
  }

  function renderLiveCanvas() {
    const canvas = document.getElementById('ws-preview-canvas');
    if (!canvas) return;

    // Apply Theme Colors
    let bg = '#ffffff';
    let cardBg = '#ffffff';
    let border = '#e2e8f0';
    let text = '#0f172a';
    let textMuted = '#64748b';

    if (widgetState.theme === 'dark') {
      bg = '#0f172a';
      cardBg = '#1e293b';
      border = '#334155';
      text = '#f8fafc';
      textMuted = '#94a3b8';
    } else if (widgetState.theme === 'slate') {
      bg = '#f1f5f9';
      cardBg = '#ffffff';
      border = '#cbd5e1';
      text = '#1e293b';
      textMuted = '#64748b';
    } else if (widgetState.theme === 'glass') {
      bg = 'rgba(255, 255, 255, 0.7)';
      cardBg = 'rgba(255, 255, 255, 0.85)';
      border = 'rgba(255, 255, 255, 0.4)';
      text = '#0f172a';
      textMuted = '#475569';
    } else if (widgetState.theme === 'transparent') {
      bg = 'transparent';
      cardBg = 'transparent';
      border = '#e2e8f0';
      text = '#0f172a';
      textMuted = '#64748b';
    }

    canvas.style.backgroundColor = bg;
    canvas.style.fontFamily = widgetState.font;
    canvas.style.setProperty('--w-card-bg', cardBg);
    canvas.style.setProperty('--w-card-border', border);
    canvas.style.setProperty('--w-card-radius', widgetState.radius);
    canvas.style.setProperty('--w-accent', widgetState.accentColor);
    canvas.style.setProperty('--w-text', text);
    canvas.style.setProperty('--w-text-muted', textMuted);

    updateStatusBadge();

    const totalArticles = widgetState.articles.length;
    const itemsPerPage = Math.max(1, widgetState.itemsPerPage || 6);
    const totalPages = Math.max(1, Math.ceil(totalArticles / itemsPerPage));

    if (widgetState.currentPage > totalPages) widgetState.currentPage = totalPages;
    if (widgetState.currentPage < 1) widgetState.currentPage = 1;

    const startIndex = (widgetState.currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalArticles);
    const pageItems = widgetState.articles.slice(startIndex, endIndex);

    const headerClass = widgetState.headerAlign === 'center' ? 'ws-header-center' : 'ws-header-left';
    const headerHtml = widgetState.showHeader
      ? `<div class="${headerClass}">
          <h3 style="margin:0; font-size:1.15rem; font-weight:800; color:${text};">${widgetState.title}</h3>
          <span style="font-size:0.75rem; font-weight:700; color:${widgetState.accentColor}; text-transform:uppercase;">● Live Widget</span>
        </div>`
      : '';

    let html = '';

    if (widgetState.layout === 'ticker') {
      // ── Continuous Floating Headlines Marquee ──
      const tickerItems = (widgetState.articles && widgetState.articles.length > 0)
        ? widgetState.articles
        : sampleArticles;

      const buildTickerItemHtml = (art) => {
        let host = 'SOURCE';
        if (art.link) {
          try { host = new URL(art.link).hostname.replace(/^www\./i, ''); } catch (_) {}
        } else if (art.source) {
          host = typeof art.source === 'string' ? art.source : (art.source.title || 'SOURCE');
        }
        const cleanTitle = decodeEntities(art.title) || 'Breaking News Headline';
        const linkTarget = widgetState.linkTarget || '_blank';
        return `
          <a class="ticker-item" href="${art.link || '#'}" target="${linkTarget}" rel="noopener noreferrer">
            <span class="ticker-source">${escapeHtml(host)}</span>
            <span class="ticker-title">${escapeHtml(cleanTitle)}</span>
            <span class="ticker-sep">●</span>
          </a>
        `;
      };

      const trackItemsHtml = tickerItems.map(buildTickerItemHtml).join('');
      // Duplicate track to create seamless infinite loop
      const duplicatedTrackHtml = trackItemsHtml + trackItemsHtml;

      html = `
        ${headerHtml}
        <div class="widget-layout-ticker">
          <div class="ticker-badge" style="background:${widgetState.accentColor};">
            <span>⚡ LIVE</span>
          </div>
          <div class="ticker-track-wrap">
            <div class="ticker-track" style="animation-duration: ${widgetState.tickerSpeed || '65s'};">
              ${duplicatedTrackHtml}
            </div>
          </div>
        </div>
      `;

      canvas.innerHTML = html;
      requestAnimationFrame(() => applyTickerSpeedToDom(widgetState.tickerSpeed));
      return;
    }

    html = `
      ${headerHtml}
      <div class="widget-layout-${widgetState.layout}">
    `;

    pageItems.forEach(article => {
      const rawImg = article.image || article.image_url || article.thumbnail || article.ogImage || article.hero_image || (article.enclosure && article.enclosure.url) || '';
      const img = (window.FeedImaging && typeof window.FeedImaging.upgradeUrl === 'function')
        ? window.FeedImaging.upgradeUrl(rawImg)
        : rawImg;
      let mediaHtml = '';
      if (widgetState.showThumbnails) {
        if (img) {
          mediaHtml = `
            <div class="widget-card-media">
              <img src="${img}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentElement.innerHTML='<div class=\\'widget-card-placeholder\\'><span>📰</span></div>';" />
            </div>
          `;
        } else {
          mediaHtml = `
            <div class="widget-card-media">
              <div class="widget-card-placeholder"><span>📰</span></div>
            </div>
          `;
        }
      }

      let host = 'SOURCE';
      if (article.link) {
        try { host = new URL(article.link).hostname.replace(/^www\./i, ''); } catch (_) {}
      } else if (article.source) {
        host = typeof article.source === 'string' ? article.source : (article.source.title || 'SOURCE');
      }

      const cleanTitle = decodeEntities(article.title) || 'Untitled Article';
      const cleanSnippet = decodeEntities(article.description || article.summary || article.snippet || '').replace(/<[^>]+>/g, '').trim().slice(0, 140);

      const metaHtml = widgetState.showDate
        ? `<div class="widget-card-meta"><span class="widget-card-domain">${host}</span></div>`
        : '';

      const descHtml = (widgetState.showDescriptions && cleanSnippet)
        ? `<p class="widget-card-desc">${cleanSnippet}...</p>`
        : '';

      const shadowClass = `shadow-${widgetState.shadow || 'soft'}`;
      const clampClass = `clamp-${widgetState.titleClamp || 2}`;
      const linkTarget = widgetState.linkTarget || '_blank';

      html += `
        <a class="widget-card ${shadowClass}" href="${article.link || '#'}" target="${linkTarget}" rel="noopener noreferrer" title="${cleanTitle}">
          ${mediaHtml}
          <div class="widget-card-body">
            ${metaHtml}
            <div class="widget-card-title ${clampClass}">${cleanTitle}</div>
            ${descHtml}
          </div>
        </a>
      `;
    });

    html += '</div>';

    // Render Pagination Bar when total articles exceeds itemsPerPage
    if (totalPages > 1) {
      let pageButtons = '';
      for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || (p >= widgetState.currentPage - 1 && p <= widgetState.currentPage + 1)) {
          pageButtons += `<button type="button" class="ws-page-btn ${p === widgetState.currentPage ? 'is-active' : ''}" data-page="${p}">${p}</button>`;
        } else if (p === widgetState.currentPage - 2 || p === widgetState.currentPage + 2) {
          pageButtons += `<span style="padding:0 4px; color:${textMuted}; font-weight:700;">...</span>`;
        }
      }

      html += `
        <div class="ws-pagination-bar">
          <span class="ws-pagination-info">Showing ${startIndex + 1}–${endIndex} of ${totalArticles} items</span>
          <div class="ws-pagination-actions">
            <button type="button" class="ws-page-btn" data-page="${widgetState.currentPage - 1}" ${widgetState.currentPage === 1 ? 'disabled' : ''}>‹ Prev</button>
            ${pageButtons}
            <button type="button" class="ws-page-btn" data-page="${widgetState.currentPage + 1}" ${widgetState.currentPage === totalPages ? 'disabled' : ''}>Next ›</button>
          </div>
        </div>
      `;
    }

    canvas.innerHTML = html;

    if (window.FeedImaging && typeof window.FeedImaging.enhanceImages === 'function') {
      window.FeedImaging.enhanceImages(canvas);
    } else if (window.SmartCrop && typeof window.SmartCrop.applyAll === 'function') {
      window.SmartCrop.applyAll(canvas);
    }

    // Attach Pagination Click Handlers
    canvas.querySelectorAll('.ws-page-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetPage = parseInt(e.currentTarget.getAttribute('data-page'), 10);
        if (targetPage >= 1 && targetPage <= totalPages && targetPage !== widgetState.currentPage) {
          widgetState.currentPage = targetPage;
          renderLiveCanvas();
          const wrap = document.querySelector('.ws-preview-canvas-wrap');
          if (wrap) wrap.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  function generateEmbedCode() {
    // Keep localhost embeds local for a truthful Studio → embed manual test.
    // File:// previews have no usable origin, so they use the live Pages host.
    const origin = (window.location.origin && /^https?:$/i.test(window.location.protocol))
      ? window.location.origin
      : 'https://feedometer-4vg.pages.dev';

    const params = new URLSearchParams();
    if (widgetState.feedUrl) params.set('feed', widgetState.feedUrl);
    if (widgetState.title && widgetState.title !== 'Live News Feed') params.set('title', widgetState.title);
    if (widgetState.layout && widgetState.layout !== 'news-wall') params.set('layout', widgetState.layout);
    if (widgetState.theme && widgetState.theme !== 'light') params.set('theme', widgetState.theme);
    if (widgetState.accentColor && widgetState.accentColor !== '#10b981') params.set('accent', widgetState.accentColor);
    if (widgetState.radius && widgetState.radius !== '12px') params.set('radius', widgetState.radius);
    if (widgetState.font && widgetState.font !== "'Inter', sans-serif") params.set('font', widgetState.font);
    if (widgetState.shadow && widgetState.shadow !== 'soft') params.set('shadow', widgetState.shadow);
    if (widgetState.titleClamp && widgetState.titleClamp !== 2) params.set('clamp', widgetState.titleClamp);
    if (!widgetState.showHeader) params.set('header', '0');
    if (widgetState.headerAlign && widgetState.headerAlign !== 'left') params.set('align', widgetState.headerAlign);
    if (widgetState.itemsPerPage && widgetState.itemsPerPage !== 6) params.set('items', widgetState.itemsPerPage);
    if (!widgetState.showThumbnails) params.set('thumbs', '0');
    if (!widgetState.showDescriptions) params.set('desc', '0');
    if (!widgetState.showDate) params.set('date', '0');
    if (widgetState.linkTarget && widgetState.linkTarget !== '_blank') params.set('target', widgetState.linkTarget);
    if (widgetState.layout === 'ticker' && widgetState.tickerSpeed && widgetState.tickerSpeed !== '65s') params.set('speed', widgetState.tickerSpeed);

    // Active Filter Parameters
    if (widgetState.filterRules && widgetState.filterRules.enabled) {
      if (widgetState.filterRules.noImage) params.set('no_img', '1');
      if (widgetState.filterRules.noDescription) params.set('no_desc', '1');
      if (widgetState.filterRules.noSecureLink) params.set('no_insecure', '1');
      if (widgetState.filterRules.dupTitle) params.set('dedupe', '1');
      if (widgetState.filterRules.similarTitle) params.set('sim_title', '1');
      if (widgetState.filterRules.oldPosts && widgetState.filterRules.oldDays) params.set('max_days', widgetState.filterRules.oldDays);
      if (widgetState.filterRules.includeKeywords) params.set('kw_inc', widgetState.filterRules.includeKeywords);
      if (widgetState.filterRules.excludeKeywords) params.set('kw_exc', widgetState.filterRules.excludeKeywords);
      if (widgetState.filterRules.language && widgetState.filterRules.language !== 'all') params.set('lang', widgetState.filterRules.language);
    }

    const queryStr = params.toString() ? '?' + params.toString() : '';
    const embedUrl = `${origin}/embed.html${queryStr}`;

    const height = widgetState.layout === 'ticker' ? '70' : (widgetState.layout === 'list' ? '480' : '620');
    const iframeCode = `<iframe src="${embedUrl}" width="100%" height="${height}" frameborder="0" style="border:none; border-radius:${widgetState.radius}; overflow:hidden;" loading="lazy"></iframe>`;

    const scriptCode = `<div data-feedometer-widget data-src="${embedUrl}" data-height="${height}"></div>\n<script async src="${origin}/scripts/feedometer-widget-embed.js"><\/script>`;

    const iframeBox = document.getElementById('ws-embed-iframe-code');
    const scriptBox = document.getElementById('ws-embed-script-code');
    const directUrlInput = document.getElementById('ws-embed-direct-url');
    const previewLink = document.getElementById('ws-embed-preview-link');

    if (iframeBox) iframeBox.value = iframeCode;
    if (scriptBox) scriptBox.value = scriptCode;
    if (directUrlInput) directUrlInput.value = embedUrl;
    if (previewLink) previewLink.href = embedUrl;
  }

  // Standalone auto-mount support if included via script tag on external page
  function autoMountExternalWidget() {
    const mountPoint = document.getElementById('feedometer-widget');
    if (mountPoint && !document.getElementById('ws-studio-container') && !mountPoint.querySelector('iframe')) {
      const src = mountPoint.getAttribute('data-src') || 'https://feedometer.pages.dev/embed.html';
      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.width = '100%';
      iframe.height = '600';
      iframe.style.border = 'none';
      iframe.style.overflow = 'hidden';
      iframe.loading = 'lazy';
      mountPoint.appendChild(iframe);
    }
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
      init();
      autoMountExternalWidget();
    });
  } else {
    init();
    autoMountExternalWidget();
  }

})(window, document);
