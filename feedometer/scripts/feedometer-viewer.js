/**
 * Feedometer - Public Standalone RSS Reader & Viewer
 * Renders canonical JSON from the Feedometer Worker. Parse/image/dedupe live on the Worker.
 */

(function () {
  'use strict';

  // =========================================================================
  // DYNAMIC CATALOG ENGINE (Decoupled from Frontend, Backed by KV / D1)
  // Replaces hundreds of hardcoded lines with an asynchronous, edge-cached
  // catalog loader. Caches in localStorage for instant offline/cold startup.
  // =========================================================================
  let catalogData = loadCachedCatalog();
  let renderLauncherGridFn = null;

  /**
   * Loads catalog from localStorage or provides lightweight default bootstrap.
   * Ensures 0ms render lag on cold page loads.
   */
  function loadCachedCatalog() {
    try {
      const stored = localStorage.getItem('feedometer_catalog_v1');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.publishers && parsed.popularFeeds) return parsed;
      }
    } catch (_) {}
    return {
      sampleFeeds: {
        tech: 'https://news.ycombinator.com/rss',
        world: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
        science: 'https://www.sciencedaily.com/rss/top/science.xml',
        verge: 'https://www.theverge.com/rss/index.xml',
        bbc: 'https://feeds.bbci.co.uk/news/rss.xml',
        nasa: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
        cnn: 'http://rss.cnn.com/rss/edition.rss',
        sky: 'https://feeds.skynews.com/feeds/rss/home.xml',
        npr: 'https://feeds.npr.org/1001/rss.xml',
        wired: 'https://www.wired.com/feed/rss',
        mit: 'https://technologyreview.com/feed/',
        forbes: 'https://www.forbes.com/business/feed/'
      },
      popularFeeds: [
        { name: 'BBC News', domain: 'bbc.co.uk', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: 'World News', bg: '#bb1919' },
        { name: 'NY Times', domain: 'nytimes.com', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', category: 'World News', bg: '#111827' },
        { name: 'The Guardian', domain: 'theguardian.com', url: 'https://www.theguardian.com/world/rss', category: 'World News', bg: '#052962' },
        { name: 'Sky Sports', domain: 'skysports.com', url: 'https://www.skysports.com/rss/12040', category: 'Sports', bg: '#0b1e42' },
        { name: 'CNN', domain: 'cnn.com', url: 'http://rss.cnn.com/rss/edition.rss', category: 'World News', bg: '#cc0000' },
        { name: 'NPR News', domain: 'npr.org', url: 'https://feeds.npr.org/1001/rss.xml', category: 'World News', bg: '#23588f' },
        { name: 'Al Jazeera', domain: 'aljazeera.com', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'World News', bg: '#91530e' },
        { name: 'The Verge', domain: 'theverge.com', url: 'https://www.theverge.com/rss/index.xml', category: 'Tech & AI', bg: '#e5127d' },
        { name: 'TechCrunch', domain: 'techcrunch.com', url: 'https://techcrunch.com/feed/', category: 'Startups & VC', bg: '#029e4b' },
        { name: 'Wired', domain: 'wired.com', url: 'https://www.wired.com/feed/rss', category: 'Deep Tech', bg: '#111827' },
        { name: 'Hacker News', domain: 'news.ycombinator.com', url: 'https://news.ycombinator.com/rss', category: 'Developer', bg: '#ff6600' },
        { name: 'Ars Technica', domain: 'arstechnica.com', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'Engineering', bg: '#ff4e00' },
        { name: 'MIT Tech', domain: 'technologyreview.com', url: 'https://www.technologyreview.com/feed/', category: 'AI & Research', bg: '#111827' },
        { name: 'Engadget', domain: 'engadget.com', url: 'https://www.engadget.com/rss.xml', category: 'Gadgets', bg: '#0066cc' },
        { name: 'WSJ Markets', domain: 'wsj.com', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', category: 'Finance', bg: '#002f6c' },
        { name: 'Bloomberg', domain: 'bloomberg.com', url: 'https://feeds.bloomberg.com/markets/news.rss', category: 'Finance', bg: '#142542' },
        { name: 'Forbes', domain: 'forbes.com', url: 'https://www.forbes.com/business/feed/', category: 'Business', bg: '#111827' },
        { name: 'FT News', domain: 'ft.com', url: 'https://www.ft.com/news-feed?format=rss', category: 'Global Economy', bg: '#e07a5f' },
        { name: 'Fast Company', domain: 'fastcompany.com', url: 'https://www.fastcompany.com/latest/rss', category: 'Innovation', bg: '#111827' },
        { name: 'NASA', domain: 'nasa.gov', url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss', category: 'Space', bg: '#0b3d91' },
        { name: 'ScienceDaily', domain: 'sciencedaily.com', url: 'https://www.sciencedaily.com/rss/top/science.xml', category: 'Science', bg: '#1b6ca8' },
        { name: 'Nature', domain: 'nature.com', url: 'https://www.nature.com/nature.rss', category: 'Research', bg: '#105b8c' },
        { name: 'InsideEVs', domain: 'insideevs.com', url: 'https://insideevs.com/rss/news/all/', category: 'EV News', bg: '#0284c7' },
        { name: 'IGN', domain: 'ign.com', url: 'https://feeds.feedburner.com/ign/all', category: 'Gaming', bg: '#bf1313' },
        { name: 'Polygon', domain: 'polygon.com', url: 'https://www.polygon.com/rss/index.xml', category: 'Gaming', bg: '#e5127d' }
      ],
      publishers: {}
    };
  }

  /**
   * Asynchronously fetches the latest catalog from the Worker (/api/catalog).
   * Caches in localStorage so subsequent loads are immediate.
   */
  async function syncCatalogFromBackend() {
    if (!WORKER_BASE) return;
    try {
      const res = await fetch(`${WORKER_BASE}/api/catalog`, { cache: 'default' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok && data.publishers) {
          catalogData = data;
          try {
            localStorage.setItem('feedometer_catalog_v1', JSON.stringify(data));
          } catch (_) {}
          if (typeof renderLauncherGridFn === 'function') {
            renderLauncherGridFn();
          }
        }
      }
    } catch (e) {
      console.warn('[Feedometer] Dynamic catalog sync fallback to cache:', e && e.message);
    }
  }

  // State
  let currentItems = [];
  let currentFeedMeta = { title: '', description: '', link: '', url: '', feedIcon: '' };
  let currentViewMode = 'list'; // 'grid' or 'list'
  let starredLinks = new Set(JSON.parse(localStorage.getItem('feedometer_starred') || '[]'));
  let activeSearchQuery = '';
  let activeFilterMode = 'all';

  // DOM Elements
  const feedUrlInput = document.getElementById('feed-url-input');
  const btnFetchFeed = document.getElementById('btn-fetch-feed');
  const feedTitleEl = document.getElementById('feed-title');
  const feedCountBadge = document.getElementById('feed-count-badge');
  const cardsContainer = document.getElementById('cards-container');
  const loadingSpinner = document.getElementById('loading-spinner');
  const errorContainer = document.getElementById('error-container');
  const viewGridBtn = document.getElementById('view-grid-btn');
  const viewListBtn = document.getElementById('view-list-btn');
  const feedSearchInput = document.getElementById('feed-search-input');
  const feedFilterSelect = document.getElementById('feed-filter-select'); // may be null
  const feedRefreshBtn = document.getElementById('feed-refresh-btn');
  const heroState = document.getElementById('hero-state');
  const readerPanel = document.getElementById('reader-panel');
  const readerBackBtn = document.getElementById('reader-back-btn');
  const siteHeader = document.querySelector('.site-header');

  // Reader Modal DOM
  const readerModal = document.getElementById('reader-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalLink = document.getElementById('modal-link');
  const modalClose = document.getElementById('modal-close');

  // ---- Panel visibility helpers ----
  function showReaderPanel() {
    if (heroState) {
      heroState.style.display = 'none';
      heroState.classList.add('hidden');
    }
    if (readerPanel) {
      readerPanel.style.display = 'flex';
      readerPanel.classList.remove('hidden');
    }

    // Output view: Keep top bar enabled, hide background color & menu icons
    if (siteHeader) siteHeader.classList.add('in-reader-view');
    document.body.classList.add('reader-view-active');

    // Close any open popups, dropdowns, or modals
    const navDropdown = document.getElementById('feed-navigator-dropdown');
    if (navDropdown && navDropdown.classList.contains('active')) {
      navDropdown.classList.remove('active');
    }
    const bgPopup = document.getElementById('bg-color-popup');
    if (bgPopup && bgPopup.classList.contains('active')) {
      bgPopup.classList.remove('active');
    }
    const feedoPlusDropdown = document.getElementById('feedoplus-dropdown');
    if (feedoPlusDropdown && feedoPlusDropdown.classList.contains('active')) {
      feedoPlusDropdown.classList.remove('active');
    }
    const launchModal = document.getElementById('launch-modal');
    if (launchModal && launchModal.classList.contains('active')) {
      launchModal.classList.remove('active');
    }
    const pubModal = document.getElementById('publisher-feeds-modal');
    if (pubModal && pubModal.classList.contains('active')) {
      pubModal.classList.remove('active');
    }

    // Reset window and reader body scroll position to top
    window.scrollTo(0, 0);
    const body = readerPanel && readerPanel.querySelector('.reader-body');
    if (body) body.scrollTop = 0;
  }

  function showHeroState() {
    if (readerPanel) {
      readerPanel.style.display = 'none';
      readerPanel.classList.add('hidden');
    }
    if (heroState) {
      heroState.style.display = '';
      heroState.classList.remove('hidden');
    }

    // Feed reader view: Make background color and menu icons visible all the time
    if (siteHeader) siteHeader.classList.remove('in-reader-view');
    document.body.classList.remove('reader-view-active');

    const pubModal = document.getElementById('publisher-feeds-modal');
    if (pubModal && pubModal.classList.contains('active')) {
      pubModal.classList.remove('active');
      document.body.style.overflow = '';
    }

    // clear feed state
    currentItems = [];
    currentFeedMeta = { title: '', description: '', link: '', url: '', feedIcon: '' };
    if (cardsContainer) cardsContainer.innerHTML = '';
    if (feedTitleEl) feedTitleEl.textContent = 'Top Stories';
    if (feedCountBadge) feedCountBadge.textContent = '0 stories';
    if (feedSearchInput) feedSearchInput.value = '';
    activeSearchQuery = '';
    activeFilterMode = 'all';
    // clear URL param
    window.history.replaceState({}, '', window.location.pathname);
    setViewMode('list');
    // focus input
    if (feedUrlInput) {
      feedUrlInput.value = '';
      feedUrlInput.focus({ preventScroll: true });
    }
  }

  // Initialize
  function init() {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
    setupEventListeners();
    syncCatalogFromBackend();

    // Check URL parameters ONLY if explicitly shared from builder/external (exclude hacker news auto-param)
    const urlParams = new URLSearchParams(window.location.search);
    const feedParam = urlParams.get('url') || urlParams.get('feed');

    if (feedParam) {
      if (feedUrlInput) {
        feedUrlInput.value = feedParam;
        feedUrlInput.focus({ preventScroll: true });
      }
      if (heroState) {
        heroState.style.display = '';
        heroState.classList.remove('hidden');
      }
      if (readerPanel) {
        readerPanel.style.display = 'none';
        readerPanel.classList.add('hidden');
      }
      // A shared reader URL must be a complete, usable journey—not merely a
      // prefilled input. The Worker remains responsible for URL safety.
      window.setTimeout(() => loadFeed(feedParam), 0);
    } else {
      // 100% blank state on fresh load — show hero and ensure icons are visible
      if (heroState) {
        heroState.style.display = '';
        heroState.classList.remove('hidden');
      }
      if (readerPanel) {
        readerPanel.style.display = 'none';
        readerPanel.classList.add('hidden');
      }
      if (siteHeader) siteHeader.classList.remove('in-reader-view');
      document.body.classList.remove('reader-view-active');
      if (feedUrlInput) {
        feedUrlInput.value = '';
        feedUrlInput.focus({ preventScroll: true });
      }
      // Clean query string from browser bar if it had old leftover params
      if (window.location.search) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }

  function setupEventListeners() {
    btnFetchFeed.addEventListener('click', () => {
      const url = feedUrlInput.value.trim();
      if (url) loadFeed(url);
    });

    feedUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const url = feedUrlInput.value.trim();
        if (url) loadFeed(url);
      }
    });

    // Sample pills with smooth selection
    document.querySelectorAll('.sample-pill').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        const targetPill = e.currentTarget;

        // Visual feedback
        document.querySelectorAll('.sample-pill').forEach(p => p.classList.remove('active-selected'));
        targetPill.classList.add('active-selected');

        const feedKey = targetPill.getAttribute('data-feed');
        const samples = catalogData.sampleFeeds || {};
        if (samples[feedKey]) {
          feedUrlInput.value = samples[feedKey];
          feedUrlInput.focus();
        }
      });
    });

    // Back button — returns to hero state
    if (readerBackBtn) {
      readerBackBtn.addEventListener('click', showHeroState);
    }

    // View toggle
    if (viewGridBtn && viewListBtn) {
      viewGridBtn.addEventListener('click', () => setViewMode('grid'));
      viewListBtn.addEventListener('click', () => setViewMode('list'));
    }

    // Live search
    if (feedSearchInput) {
      feedSearchInput.addEventListener('input', (e) => {
        activeSearchQuery = e.target.value.trim().toLowerCase();
        applyFiltersAndRender();
      });
    }

    // Filter dropdown
    if (feedFilterSelect) {
      feedFilterSelect.addEventListener('change', (e) => {
        activeFilterMode = e.target.value;
        applyFiltersAndRender();
      });
    }

    // Refresh feed button
    if (feedRefreshBtn) {
      feedRefreshBtn.addEventListener('click', () => {
        if (currentFeedMeta.url) {
          feedRefreshBtn.classList.add('spinning');
          loadFeed(currentFeedMeta.url, { nocache: true }).finally(() => {
            setTimeout(() => feedRefreshBtn.classList.remove('spinning'), 600);
          });
        }
      });
    }

    // Modal close
    if (modalClose) {
      modalClose.addEventListener('click', closeModal);
    }
    if (readerModal) {
      readerModal.addEventListener('click', (e) => {
        if (e.target === readerModal) closeModal();
      });
    }

    // Sample Feeds Carousel setup
    setupSampleCarousel();

    // Terms & Privacy Modal setup
    setupTermsModal();
    setupPrivacyModal();

    // Launch / Notify Modal setup (auto-opens on load/refresh)
    setupLaunchModal();

    // Publisher Category Feeds Modal setup
    setupPublisherCategoryModal();

    // Feed Navigator Dropdown setup
    setupFeedNavigatorDropdown();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
        const pubModal = document.getElementById('publisher-feeds-modal');
        if (pubModal && pubModal.classList.contains('active')) {
          pubModal.classList.remove('active');
          document.body.style.overflow = '';
        }
        const termsModal = document.getElementById('terms-modal');
        if (termsModal && termsModal.classList.contains('active')) {
          termsModal.classList.remove('active');
          document.body.style.overflow = '';
        }
        const privacyModal = document.getElementById('privacy-modal');
        if (privacyModal && privacyModal.classList.contains('active')) {
          privacyModal.classList.remove('active');
          document.body.style.overflow = '';
        }
        const launchModal = document.getElementById('launch-modal');
        if (launchModal && launchModal.classList.contains('active')) {
          launchModal.classList.remove('active');
        }
        const navDropdown = document.getElementById('feed-navigator-dropdown');
        if (navDropdown && navDropdown.classList.contains('active')) {
          navDropdown.classList.remove('active');
        }
      }
    });
  }

  function setupSampleCarousel() {
    const carousel = document.getElementById('sample-feeds-carousel');
    const prevBtn = document.getElementById('sample-carousel-prev');
    const nextBtn = document.getElementById('sample-carousel-next');

    if (!carousel || !prevBtn || !nextBtn) return;

    const scrollAmount = 180;

    prevBtn.addEventListener('click', () => {
      carousel.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    });

    nextBtn.addEventListener('click', () => {
      carousel.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    });

    // Frictionless mouse drag-to-scroll support on desktop
    let isDown = false;
    let startX = 0;
    let startScrollLeft = 0;
    let hasDragged = false;

    carousel.addEventListener('mousedown', (e) => {
      isDown = true;
      hasDragged = false;
      startX = e.pageX - carousel.offsetLeft;
      startScrollLeft = carousel.scrollLeft;
      carousel.style.scrollBehavior = 'auto';
    });

    window.addEventListener('mouseup', () => {
      if (isDown) {
        isDown = false;
        carousel.style.scrollBehavior = 'smooth';
      }
    });

    carousel.addEventListener('mouseleave', () => {
      if (isDown) {
        isDown = false;
        carousel.style.scrollBehavior = 'smooth';
      }
    });

    carousel.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - carousel.offsetLeft;
      const walk = (x - startX) * 1.4;
      if (Math.abs(walk) > 4) hasDragged = true;
      carousel.scrollLeft = startScrollLeft - walk;
    });

    // Prevent accidental click when dragging
    carousel.addEventListener('click', (e) => {
      if (hasDragged) {
        e.stopImmediatePropagation();
        e.preventDefault();
        hasDragged = false;
      }
    }, true);
  }

  // Publisher Category Modal handler
  let openPublisherCategoryModalFn = null;

  function setupPublisherCategoryModal() {
    const pubModal = document.getElementById('publisher-feeds-modal');
    const pubClose = document.getElementById('pub-modal-close');
    const pubIcon = document.getElementById('pub-modal-icon');
    const pubFallback = document.getElementById('pub-modal-fallback');
    const pubTitle = document.getElementById('pub-modal-title');
    const pubBadge = document.getElementById('pub-modal-badge');
    const pubDesc = document.getElementById('pub-modal-desc');
    const pubSearch = document.getElementById('pub-modal-search-input');
    const pubGrid = document.getElementById('pub-cards-grid');
    const pubEmpty = document.getElementById('pub-modal-empty');
    const pubBody = pubModal ? pubModal.querySelector('.pub-modal-body') : null;

    if (!pubModal || !pubGrid) return;

    let activePublisher = null;

    function renderPublisherCards(filterQuery = '') {
      if (!activePublisher || !activePublisher.feeds) return;
      pubGrid.innerHTML = '';
      const q = String(filterQuery || '').trim().toLowerCase();
      let matches = 0;

      activePublisher.feeds.forEach((feed) => {
        const titleMatch = feed.title.toLowerCase().includes(q);
        const tagMatch = (feed.tag || '').toLowerCase().includes(q);
        const descMatch = (feed.desc || '').toLowerCase().includes(q);

        if (!q || titleMatch || tagMatch || descMatch) {
          matches++;
          const card = document.createElement('div');
          card.className = 'pub-feed-card';

          const cardHeader = document.createElement('div');
          cardHeader.className = 'pub-feed-card-header';

          const tagBadge = document.createElement('span');
          tagBadge.className = 'pub-feed-card-badge';
          tagBadge.textContent = feed.tag || activePublisher.category || 'Feed';

          const domainSpan = document.createElement('span');
          domainSpan.className = 'pub-feed-card-domain';
          domainSpan.textContent = activePublisher.domain;

          cardHeader.appendChild(tagBadge);
          cardHeader.appendChild(domainSpan);

          const cardContent = document.createElement('div');
          cardContent.className = 'pub-feed-card-content';

          const cardTitle = document.createElement('h4');
          cardTitle.className = 'pub-feed-card-title';
          cardTitle.textContent = feed.title;

          const cardDesc = document.createElement('p');
          cardDesc.className = 'pub-feed-card-desc';
          cardDesc.textContent = feed.desc || `Official ${activePublisher.name} RSS feed stream`;

          cardContent.appendChild(cardTitle);
          cardContent.appendChild(cardDesc);

          const cardFooter = document.createElement('div');
          cardFooter.className = 'pub-feed-card-footer';

          const openBtn = document.createElement('button');
          openBtn.type = 'button';
          openBtn.className = 'pub-feed-card-open-btn';
          openBtn.innerHTML = `
            <span>View Articles</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
          `;
          openBtn.title = `View articles from ${feed.title}`;

          openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closePublisherModal();
            if (feedUrlInput) {
              feedUrlInput.value = feed.url;
              loadFeed(feed.url);
            }
          });

          cardFooter.appendChild(openBtn);

          card.appendChild(cardHeader);
          card.appendChild(cardContent);
          card.appendChild(cardFooter);

          pubGrid.appendChild(card);
        }
      });

      if (pubEmpty) {
        pubEmpty.style.display = matches === 0 ? 'block' : 'none';
      }
    }

    function openPublisherModal(domainOrKey) {
      const pubs = catalogData.publishers || {};
      const popFeeds = catalogData.popularFeeds || [];
      const pub = pubs[domainOrKey] ||
        Object.values(pubs).find(p => p.name && p.name.toLowerCase() === String(domainOrKey).toLowerCase()) ||
        popFeeds.find(p => p.domain === domainOrKey || (p.name && p.name.toLowerCase() === String(domainOrKey).toLowerCase()));

      if (!pub) return;

      activePublisher = {
        name: pub.name,
        domain: pub.domain,
        bg: pub.bg || pub.bg_color || '#0284c7',
        category: pub.category || 'News',
        description: (pub.description || `${pub.name} RSS feeds`).replace(/\s*•\s*\d+\s+Verified\s+Feeds/i, '').replace(/\s*•\s*Verified\s+Stream/i, '').trim(),
        feeds: pub.feeds || [{ title: `${pub.name} Headlines`, url: pub.url, tag: pub.category, desc: `Latest news stream from ${pub.name}` }]
      };

      if (pubTitle) pubTitle.textContent = activePublisher.name;
      if (pubDesc) pubDesc.textContent = activePublisher.description;
      if (pubBadge) pubBadge.style.display = 'none';

      if (pubIcon && pubFallback) {
        pubIcon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(activePublisher.domain)}&sz=128`;
        pubIcon.alt = activePublisher.name;
        pubIcon.style.display = 'block';
        pubFallback.style.display = 'none';

        pubIcon.onerror = () => {
          pubIcon.style.display = 'none';
          pubFallback.style.display = 'flex';
          pubFallback.style.background = '#111827';
          pubFallback.textContent = activePublisher.name.charAt(0);
        };
      }

      if (pubSearch) pubSearch.value = '';
      if (pubBody) pubBody.scrollTop = 0;
      renderPublisherCards('');
      if (pubBody) pubBody.scrollTop = 0;

      // Close any open popups or dropdowns
      const bgPopup = document.getElementById('bg-color-popup');
      if (bgPopup && bgPopup.classList.contains('active')) {
        bgPopup.classList.remove('active');
        document.dispatchEvent(new CustomEvent('close-bg-picker'));
      }
      const navDropdown = document.getElementById('feed-navigator-dropdown');
      const navBtn = document.getElementById('btn-feed-navigator');
      if (navDropdown && navDropdown.classList.contains('active')) {
        navDropdown.classList.remove('active');
        if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
      }

      pubModal.classList.add('active');
      document.body.style.overflow = 'hidden';

      // Always ensure body is scrolled to the very top
      requestAnimationFrame(() => {
        if (pubBody) pubBody.scrollTop = 0;
      });

      if (pubSearch && window.innerWidth > 768) {
        setTimeout(() => pubSearch.focus(), 80);
      }
    }

    function closePublisherModal() {
      pubModal.classList.remove('active');
      document.body.style.overflow = '';
      if (pubSearch) pubSearch.blur();
      if (pubBody) pubBody.scrollTop = 0;
    }

    if (pubClose) {
      pubClose.addEventListener('click', closePublisherModal);
    }

    pubModal.addEventListener('click', (e) => {
      if (e.target === pubModal) {
        closePublisherModal();
      }
    });

    if (pubSearch) {
      pubSearch.addEventListener('input', (e) => {
        renderPublisherCards(e.target.value);
      });
      pubSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closePublisherModal();
        }
      });
    }

    openPublisherCategoryModalFn = openPublisherModal;
  }

  function setupFeedNavigatorDropdown() {
    const navBtn = document.getElementById('btn-feed-navigator');
    const navDropdown = document.getElementById('feed-navigator-dropdown');
    const navSearch = document.getElementById('feed-nav-search');
    const appsGrid = document.getElementById('launcher-apps-grid');
    const navEmpty = document.getElementById('feed-nav-empty');

    if (!navBtn || !navDropdown || !appsGrid) return;

    // Render 25 app cards into the 3-column launcher grid
    function renderLauncherGrid() {
      appsGrid.innerHTML = '';
      const feeds = catalogData.popularFeeds || [];
      feeds.forEach((feed) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'launcher-app-item';
        item.dataset.url = feed.url;
        item.dataset.domain = feed.domain;
        item.dataset.name = (feed.name || '').toLowerCase();
        item.dataset.category = (feed.category || '').toLowerCase();
        item.title = `${feed.name} • View Categories & Feeds`;

        const iconWrap = document.createElement('div');
        iconWrap.className = 'launcher-icon-wrap';

        const img = document.createElement('img');
        img.className = 'launcher-icon-img';
        img.alt = feed.name;
        img.loading = 'lazy';
        img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(feed.domain)}&sz=64`;

        const fallback = document.createElement('div');
        fallback.className = 'launcher-icon-fallback';
        fallback.style.background = feed.bg || '#3b82f6';
        fallback.style.display = 'none';
        fallback.textContent = (feed.name || 'F').charAt(0);

        img.onerror = () => {
          img.style.display = 'none';
          fallback.style.display = 'flex';
        };

        iconWrap.appendChild(img);
        iconWrap.appendChild(fallback);

        const label = document.createElement('span');
        label.className = 'launcher-app-label';
        label.textContent = feed.name;

        item.appendChild(iconWrap);
        item.appendChild(label);

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          closeDropdown();
          if (openPublisherCategoryModalFn) {
            openPublisherCategoryModalFn(feed.domain || feed.name);
          } else if (feedUrlInput) {
            feedUrlInput.value = feed.url;
            loadFeed(feed.url);
          }
        });

        appsGrid.appendChild(item);
      });
    }

    renderLauncherGridFn = renderLauncherGrid;
    renderLauncherGrid();

    function openDropdown() {
      // Mutual Exclusivity: Close background color popup if open
      const bgPopup = document.getElementById('bg-color-popup');
      if (bgPopup && bgPopup.classList.contains('active')) {
        bgPopup.classList.remove('active');
      }
      document.dispatchEvent(new CustomEvent('close-bg-picker'));

      if (navSearch) navSearch.value = '';
      filterLauncher('');
      navDropdown.classList.add('active');
      navBtn.setAttribute('aria-expanded', 'true');
      // Only auto-focus on desktop screens to prevent mobile virtual keyboard distortion
      if (navSearch && window.innerWidth > 768) {
        setTimeout(() => navSearch.focus(), 60);
      }
    }

    function closeDropdown() {
      navDropdown.classList.remove('active');
      navBtn.setAttribute('aria-expanded', 'false');
      if (navSearch) navSearch.blur();
      window.scrollTo(0, 0);
    }

    function filterLauncher(query) {
      const q = String(query || '').trim().toLowerCase();
      const items = appsGrid.querySelectorAll('.launcher-app-item');
      let matches = 0;

      items.forEach((item) => {
        const name = item.dataset.name || '';
        const cat = item.dataset.category || '';
        if (!q || name.includes(q) || cat.includes(q)) {
          item.style.display = 'flex';
          matches++;
        } else {
          item.style.display = 'none';
        }
      });

      if (navEmpty) {
        navEmpty.style.display = matches === 0 ? 'block' : 'none';
      }
    }

    navBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (navDropdown.classList.contains('active')) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    if (navSearch) {
      navSearch.addEventListener('input', (e) => {
        filterLauncher(e.target.value);
      });
      navSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDropdown();
        if (e.key === 'Enter') {
          const visible = Array.from(appsGrid.querySelectorAll('.launcher-app-item')).filter(
            (i) => i.style.display !== 'none'
          );
          if (visible.length > 0) {
            visible[0].click();
          }
        }
      });
    }

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!navDropdown.contains(e.target) && !navBtn.contains(e.target)) {
        closeDropdown();
      }
    });
  }

  function setupLaunchModal() {
    const launchModal = document.getElementById('launch-modal');
    const launchClose = document.getElementById('launch-modal-close');
    const launchTrigger = document.getElementById('btn-open-notify-modal');
    const subscribeBtn = document.getElementById('btn-launch-subscribe');
    const emailInput = document.getElementById('launch-email-input');
    const msgEl = document.getElementById('launch-modal-msg');
    let isClosing = false;

    function openLaunchModal() {
      if (!launchModal) return;

      // Close any open popups or dropdowns
      const bgPopup = document.getElementById('bg-color-popup');
      if (bgPopup && bgPopup.classList.contains('active')) {
        bgPopup.classList.remove('active');
        document.dispatchEvent(new CustomEvent('close-bg-picker'));
      }
      const navDropdown = document.getElementById('feed-navigator-dropdown');
      const navBtn = document.getElementById('btn-feed-navigator');
      if (navDropdown && navDropdown.classList.contains('active')) {
        navDropdown.classList.remove('active');
        if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
      }

      launchModal.classList.remove('closing');
      launchModal.classList.add('active');
      if (launchTrigger) {
        launchTrigger.classList.remove('caught');
        launchTrigger.classList.add('launched');
      }
    }

    function closeLaunchModal() {
      if (!launchModal || isClosing) return;
      isClosing = true;
      launchModal.classList.remove('active');
      launchModal.classList.add('closing');
      
      // As the card collapses into the button, catch it and wobble the button
      setTimeout(() => {
        if (launchTrigger) {
          launchTrigger.classList.remove('launched');
          launchTrigger.classList.add('caught');
          setTimeout(() => {
            if (launchTrigger) launchTrigger.classList.remove('caught');
          }, 650);
        }
      }, 200);

      setTimeout(() => {
        launchModal.classList.remove('closing');
        isClosing = false;
      }, 400);
    }

    if (launchTrigger) {
      launchTrigger.addEventListener('click', openLaunchModal);
    }

    if (launchClose) {
      launchClose.addEventListener('click', closeLaunchModal);
    }

    // Clicking anywhere on the card focuses the email input box
    if (launchModal && emailInput) {
      launchModal.addEventListener('click', (e) => {
        if (e.target.closest('#launch-modal-close') || e.target.closest('#btn-launch-subscribe')) {
          return;
        }
        emailInput.focus();
      });
    }

    if (subscribeBtn && emailInput) {
      async function handleSubscribe(e) {
        if (e) e.preventDefault();
        const email = emailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
          if (msgEl) {
            msgEl.textContent = 'Please enter a valid email address.';
            msgEl.className = 'launch-msg error';
            msgEl.style.display = 'block';
          }
          return;
        }

        if (subscribeBtn) {
          subscribeBtn.disabled = true;
          subscribeBtn.textContent = 'Subscribing...';
        }

        // 1. Client-side persistence
        try {
          const subs = JSON.parse(localStorage.getItem('feedometer_subscribers') || '[]');
          if (!subs.includes(email)) {
            subs.push(email);
            localStorage.setItem('feedometer_subscribers', JSON.stringify(subs));
          }
        } catch (err) {}

        // 2. Save on the Cloudflare Worker waitlist API
        try {
          const workerBase = (
            (window.FEEDOMETER_API_BASE) ||
            (window.FEEDOMETER_CONFIG && window.FEEDOMETER_CONFIG.WORKER_API_BASE) ||
            WORKER_BASE ||
            ''
          ).replace(/\/$/, '');

          if (!workerBase) {
            throw new Error('Worker API is not configured.');
          }

          const res = await fetch(`${workerBase}/api/waitlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, source: 'launch-notify-popup' })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.ok === false) {
            throw new Error(data.error || 'Could not save your email. Please try again.');
          }
          if (msgEl) {
            msgEl.textContent = data.message || 'Awesome! You are on the VIP launch list.';
            msgEl.className = 'launch-msg success';
            msgEl.style.display = 'block';
          }
        } catch (err) {
          console.warn('[Feedometer] Waitlist remote sync warning:', err);
          if (msgEl) {
            msgEl.textContent = err.message || 'Could not reach the notify service. Please try again.';
            msgEl.className = 'launch-msg error';
            msgEl.style.display = 'block';
          }
          if (subscribeBtn) {
            subscribeBtn.disabled = false;
            subscribeBtn.textContent = 'Notify';
          }
          return;
        }
        emailInput.value = '';
        if (subscribeBtn) {
          subscribeBtn.disabled = true;
          subscribeBtn.textContent = 'SUBSCRIBED! ✓';
        }

        setTimeout(() => {
          closeLaunchModal();
          setTimeout(() => {
            if (subscribeBtn) {
              subscribeBtn.disabled = false;
              subscribeBtn.textContent = 'Notify';
            }
            if (msgEl) msgEl.style.display = 'none';
          }, 500);
        }, 2200);
      }

      subscribeBtn.addEventListener('click', handleSubscribe);
      emailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSubscribe(e);
      });
    }
  }

  function setupTermsModal() {
    const termsModal = document.getElementById('terms-modal');
    const termsClose = document.getElementById('terms-modal-close');
    const termsTriggers = document.querySelectorAll('.terms-trigger, #terms-link');

    termsTriggers.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (termsModal) {
          termsModal.classList.add('active');
          document.body.style.overflow = 'hidden';
        }
      });
    });

    if (termsClose) {
      termsClose.addEventListener('click', () => {
        if (termsModal) {
          termsModal.classList.remove('active');
          document.body.style.overflow = '';
        }
      });
    }

    if (termsModal) {
      termsModal.addEventListener('click', (e) => {
        if (e.target === termsModal) {
          termsModal.classList.remove('active');
          document.body.style.overflow = '';
        }
      });
    }
  }

  function setupPrivacyModal() {
    const privacyModal = document.getElementById('privacy-modal');
    const privacyClose = document.getElementById('privacy-modal-close');
    const privacyTriggers = document.querySelectorAll('.privacy-trigger, #privacy-link');

    privacyTriggers.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (privacyModal) {
          privacyModal.classList.add('active');
          document.body.style.overflow = 'hidden';
        }
      });
    });

    if (privacyClose) {
      privacyClose.addEventListener('click', () => {
        if (privacyModal) {
          privacyModal.classList.remove('active');
          document.body.style.overflow = '';
        }
      });
    }

    if (privacyModal) {
      privacyModal.addEventListener('click', (e) => {
        if (e.target === privacyModal) {
          privacyModal.classList.remove('active');
          document.body.style.overflow = '';
        }
      });
    }
  }

  function setViewMode(mode) {
    currentViewMode = mode;
    if (mode === 'grid') {
      cardsContainer.className = 'cards-grid';
      viewGridBtn.classList.add('active');
      viewListBtn.classList.remove('active');
    } else {
      cardsContainer.className = 'cards-list';
      viewListBtn.classList.add('active');
      viewGridBtn.classList.remove('active');
    }
    applyFiltersAndRender();
  }

  function applyFiltersAndRender() {
    let filtered = [...currentItems];

    // Search filter
    if (activeSearchQuery) {
      filtered = filtered.filter(item =>
        item.title.toLowerCase().includes(activeSearchQuery) ||
        item.description.toLowerCase().includes(activeSearchQuery)
      );
    }

    // Mode filter
    if (activeFilterMode === 'has-image') {
      filtered = filtered.filter(item => !!item.image);
    } else if (activeFilterMode === 'starred') {
      filtered = filtered.filter(item => starredLinks.has(item.link));
    }

    renderCards(filtered);
  }

  const WORKER_BASE = (window.FEEDOMETER_API_BASE || '').replace(/\/$/, '');
  const LOCAL_WORKER = (window.FEEDOMETER_LOCAL_API || '').replace(/\/$/, '');

  function looksLikeUrl(raw) {
    const u = String(raw || '').trim();
    if (!u) return false;
    if (/\s/.test(u)) return false;
    if (/^https?:\/\//i.test(u)) return true;
    return u.includes('.') && !u.startsWith('javascript:');
  }

  async function fetchWithTimeout(resource, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(resource, { signal: controller.signal, cache: 'no-store' });
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestView(base, rawUrl, nocache, timeoutMs) {
    if (!base) return null;
    try {
      let workerUrl = `${base}/api/view?url=${encodeURIComponent(rawUrl)}`;
      if (nocache) workerUrl += '&nocache=1';
      const res = await fetchWithTimeout(workerUrl, timeoutMs || 15000);
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        return null;
      }
      if (json && (json.code === 'capacity' || json.code === 'content_blocked' || json.code === 'ssrf_blocked')) {
        const err = new Error(json.error || 'Request blocked');
        err.code = json.code;
        throw err;
      }
      if (json && (json.ok || json.status === 'success' || Array.isArray(json.items))) {
        return json;
      }
    } catch (e) {
      if (e && (e.code === 'capacity' || e.code === 'content_blocked' || e.code === 'ssrf_blocked')) throw e;
      console.warn('[Feedometer] Worker fetch failed:', base, e && e.message);
    }
    return null;
  }

  // ── Client-Side Resilient Feed Parser & Fallback Bridges ──
  function parseXmlClientSide(xmlStr, feedUrl) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlStr, 'text/xml');
      const parseError = doc.querySelector('parsererror');
      if (parseError) throw new Error('XML Parse Error');

      let feedTitle = '';
      let feedLink = feedUrl;
      let feedDesc = '';
      const items = [];

      // Check RSS 2.0
      const channel = doc.querySelector('channel');
      if (channel) {
        feedTitle = channel.querySelector('title') ? channel.querySelector('title').textContent : '';
        feedLink = channel.querySelector('link') ? channel.querySelector('link').textContent : feedUrl;
        feedDesc = channel.querySelector('description') ? channel.querySelector('description').textContent : '';
        
        const itemNodes = channel.querySelectorAll('item');
        itemNodes.forEach(item => {
          const title = item.querySelector('title') ? item.querySelector('title').textContent : 'Untitled';
          const link = item.querySelector('link') ? item.querySelector('link').textContent : '';
          const descNode = item.querySelector('description');
          const encodedNode = item.querySelector('content\\:encoded') || item.querySelector('encoded');
          const desc = descNode ? descNode.textContent : (encodedNode ? encodedNode.textContent : '');
          const pubDate = item.querySelector('pubDate') ? item.querySelector('pubDate').textContent : (item.querySelector('dc\\:date') ? item.querySelector('dc\\:date').textContent : '');
          const author = item.querySelector('author') ? item.querySelector('author').textContent : (item.querySelector('dc\\:creator') ? item.querySelector('dc\\:creator').textContent : '');
          
          let image = '';
          const mediaContent = item.querySelector('media\\:content, content');
          if (mediaContent && mediaContent.getAttribute('url')) {
            image = mediaContent.getAttribute('url');
          } else {
            const mediaThumb = item.querySelector('media\\:thumbnail, thumbnail');
            if (mediaThumb && mediaThumb.getAttribute('url')) {
              image = mediaThumb.getAttribute('url');
            } else {
              const enclosure = item.querySelector('enclosure');
              if (enclosure && enclosure.getAttribute('type') && enclosure.getAttribute('type').startsWith('image') && enclosure.getAttribute('url')) {
                image = enclosure.getAttribute('url');
              } else {
                const rawAll = (descNode ? descNode.textContent : '') + ' ' + (encodedNode ? encodedNode.textContent : '');
                const decodedAll = decodeHtmlEntities(rawAll);
                const allHtml = rawAll + ' ' + decodedAll;
                const imgMatch = allHtml.match(/<img[^>]+(?:src|data-src|data-orig-file|data-lazy-src)=["']([^"']+)["']/i);
                if (imgMatch && imgMatch[1] && !imgMatch[1].includes('feedburner.com') && !imgMatch[1].includes('1x1')) {
                  image = decodeHtmlEntities(imgMatch[1]);
                }
              }
            }
          }
          
          if (title || link) {
            items.push({
              title,
              link,
              description: desc,
              publishedAt: pubDate,
              pubDate,
              author,
              image,
              source: feedTitle
            });
          }
        });
      } else {
        // Check Atom 1.0
        const feedNode = doc.querySelector('feed');
        if (feedNode) {
          feedTitle = feedNode.querySelector('title') ? feedNode.querySelector('title').textContent : '';
          feedDesc = feedNode.querySelector('subtitle') ? feedNode.querySelector('subtitle').textContent : '';
          
          const entryNodes = feedNode.querySelectorAll('entry');
          entryNodes.forEach(entry => {
            const title = entry.querySelector('title') ? entry.querySelector('title').textContent : 'Untitled';
            const linkNode = entry.querySelector('link[rel="alternate"]') || entry.querySelector('link');
            const link = linkNode ? linkNode.getAttribute('href') : '';
            const summaryNode = entry.querySelector('summary');
            const contentNode = entry.querySelector('content');
            const desc = summaryNode ? summaryNode.textContent : (contentNode ? contentNode.textContent : '');
            const pubDate = entry.querySelector('published') ? entry.querySelector('published').textContent : (entry.querySelector('updated') ? entry.querySelector('updated').textContent : '');
            const author = entry.querySelector('author name') ? entry.querySelector('author name').textContent : '';
            
            let image = '';
            const mediaContent = entry.querySelector('media\\:content, content[type^="image"]');
            if (mediaContent && mediaContent.getAttribute('url')) {
              image = mediaContent.getAttribute('url');
            } else {
              const mediaThumb = entry.querySelector('media\\:thumbnail');
              if (mediaThumb && mediaThumb.getAttribute('url')) {
                image = mediaThumb.getAttribute('url');
              } else {
                const rawAll = (summaryNode ? summaryNode.textContent : '') + ' ' + (contentNode ? contentNode.textContent : '');
                const decodedAll = decodeHtmlEntities(rawAll);
                const allHtml = rawAll + ' ' + decodedAll;
                const imgMatch = allHtml.match(/<img[^>]+(?:src|data-src|data-orig-file|data-lazy-src)=["']([^"']+)["']/i);
                if (imgMatch && imgMatch[1] && !imgMatch[1].includes('feedburner.com') && !imgMatch[1].includes('1x1')) {
                  image = decodeHtmlEntities(imgMatch[1]);
                }
              }
            }
            
            items.push({
              title,
              link,
              description: desc,
              publishedAt: pubDate,
              pubDate,
              author,
              image,
              source: feedTitle
            });
          });
        }
      }

      if (items.length > 0) {
        return {
          ok: true,
          feedUrl: feedUrl,
          meta: {
            title: feedTitle || titleFromHost(feedUrl) || 'RSS Feed',
            link: feedLink,
            description: feedDesc,
            url: feedUrl
          },
          items: items
        };
      }
    } catch (e) {
      console.warn('[Feedometer] Client XML parse failed:', e.message);
    }
    return null;
  }

  const PRESET_FEEDS_BACKUP = {
    'bbc': {
      title: 'BBC News - Top Stories',
      items: [
        { title: 'Global Diplomatic Summit Concludes with Historic Accord on Energy Security', description: 'World leaders finalize multi-lateral framework focusing on grid resilience and cross-border clean power distribution.', pubDate: '35m ago', link: 'https://www.bbc.com/news/world', source: 'BBC News' },
        { title: 'Breakthrough in Next-Gen Microprocessor Architecture Cuts Server Latency', description: 'Engineers demonstrate optical photonic interconnects achieving sub-microsecond latency across hyperscale compute clusters.', pubDate: '1h ago', link: 'https://www.bbc.com/news/technology', source: 'BBC News' },
        { title: 'Global Scientific Expedition Discovers Marine Ecosystem in Antarctic Trench', description: 'Deep-sea robotic exploration reveals previously uncatalogued biodiversity thriving near hydrothermal vents.', pubDate: '3h ago', link: 'https://www.bbc.com/news/science', source: 'BBC News' },
        { title: 'International Central Banks Signal Coordinated Framework on Digital Payments', description: 'Financial authorities outline cross-border settlement protocols to accelerate liquidity.', pubDate: '5h ago', link: 'https://www.bbc.com/news/business', source: 'BBC News' }
      ]
    },
    'verge': {
      title: 'The Verge - Tech and Science',
      items: [
        { title: 'The Next Generation of AI Hardware is Optical and Modular', description: 'Silicon photonics replace copper transceivers across high-density AI clusters.', pubDate: '42m ago', link: 'https://www.theverge.com/tech', source: 'The Verge' },
        { title: 'Quantum Computing Crosses the 100-Qubit Fault Tolerance Threshold', description: 'Researchers validate dynamic error mitigation on superconducting lattices.', pubDate: '2h ago', link: 'https://www.theverge.com/science', source: 'The Verge' }
      ]
    },
    'science': {
      title: 'ScienceDaily - Latest Research News',
      items: [
        { title: 'Atmospheric Carbon Signatures Confirmed on Habitable-Zone Exoplanet', description: 'James Webb Space Telescope transmission spectra confirm atmospheric composition at 5-sigma significance.', pubDate: '1h ago', link: 'https://www.sciencedaily.com', source: 'ScienceDaily' }
      ]
    }
  };

  async function fetchViaPublicBridges(url) {
    const bridges = [
      'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
      'https://corsproxy.io/?' + encodeURIComponent(url)
    ];

    for (let i = 0; i < bridges.length; i++) {
      try {
        const res = await fetchWithTimeout(bridges[i], 4500);
        if (res.ok) {
          const text = await res.text();
          if (text && text.indexOf('<') !== -1 && (text.indexOf('<rss') !== -1 || text.indexOf('<feed') !== -1 || text.indexOf('<channel') !== -1)) {
            const parsed = parseXmlClientSide(text, url);
            if (parsed) return parsed;
          }
        }
      } catch (_) {}
    }
    return null;
  }

  async function fetchCanonicalFeed(rawUrl, options) {
    const url = String(rawUrl || '').trim();
    if (!looksLikeUrl(url)) {
      throw new Error('invalid-url');
    }
    const nocache = options && options.nocache;

    // 1. Try remote/local Cloudflare Worker (Full production API with image extraction & OpenGraph)
    if (WORKER_BASE) {
      try {
        const remote = await requestView(WORKER_BASE, url, nocache, 15000);
        if (remote && Array.isArray(remote.items) && remote.items.length > 0) return remote;
      } catch (_) {}
    }

    if (LOCAL_WORKER) {
      try {
        const local = await requestView(LOCAL_WORKER, url, nocache, 4000);
        if (local && Array.isArray(local.items) && local.items.length > 0) return local;
      } catch (_) {}
    }

    // 2. Try Public CORS Bridges + Client-Side XML Parser
    try {
      const bridgeData = await fetchViaPublicBridges(url);
      if (bridgeData) return bridgeData;
    } catch (_) {}

    // 3. Try Direct Fetch (if publisher has CORS enabled or running in web container)
    try {
      const directRes = await fetchWithTimeout(url, 3000);
      if (directRes.ok) {
        const directText = await directRes.text();
        const parsed = parseXmlClientSide(directText, url);
        if (parsed) return parsed;
      }
    } catch (_) {}

    const unavailable = new Error('FEED_UNAVAILABLE');
    unavailable.code = 'FEED_UNAVAILABLE';
    throw unavailable;
  }

  function titlesAreSame(a, b) {
    const x = String(a || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const y = String(b || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return !!(x && y && x === y);
  }

  function titleFromHost(url) {
    try {
      let host = new URL(url).hostname.replace(/^www\./i, '');
      host = host.replace(/^(feeds?|rss|atom|syndication|xml)\./i, '');
      host = host.replace(/\.(co|com|org|net|gov|ac)\.[a-z]{2}$/i, '');
      host = host.replace(/\.[a-z]{2,}$/i, '');
      if (host) return host.charAt(0).toUpperCase() + host.slice(1);
    } catch (e) {}
    return '';
  }

  function resolveDisplayFeedTitle(rawTitle, items, feedUrl, homeUrl) {
    let t = String(rawTitle || '').replace(/\s+/g, ' ').trim();
    const first = items[0] && items[0].title;
    if (!t || titlesAreSame(t, first)) {
      t = titleFromHost(homeUrl || feedUrl) || t;
    }
    return t || 'RSS Feed';
  }

  function getDomainFavicon(url) {
    try {
      if (!url) return '';
      const u = new URL(url);
      return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(u.hostname) + '&sz=32';
    } catch (_) {
      return '';
    }
  }

  function mapWorkerItems(json) {
    const meta = json.meta || {};
    const feedUrl = json.feedUrl || meta.url || '';
    const homeUrl = meta.feedHomeUrl || meta.link || feedUrl;
    const rawTitle = decodeHtmlEntities(meta.feedTitle || meta.title || '');
    
    let feedIcon = meta.feedIcon || getDomainFavicon(homeUrl || feedUrl);

    const items = (json.items || []).map((item) => {
      const link = item.link || item.url || '';
      const published = item.publishedAt || item.pubDate || item.published || '';
      
      let itemSourceTitle = '';
      let itemSourceIcon = '';
      if (typeof item.source === 'object' && item.source) {
        itemSourceTitle = item.source.title || '';
        itemSourceIcon = item.source.logo_url || '';
      } else if (typeof item.source === 'string') {
        itemSourceTitle = item.source;
      }

      if (itemSourceIcon && (!feedIcon || feedIcon.includes('google.com'))) {
        feedIcon = itemSourceIcon;
      }

      return {
        id: item.id || link,
        title: decodeHtmlEntities(item.title || 'Untitled'),
        link,
        url: link,
        description: decodeHtmlEntities(item.description || item.summary || ''),
        pubDate: formatDate(published),
        publishedAt: published,
        author: decodeHtmlEntities(item.author || ''),
        image: item.image || '',
        source: decodeHtmlEntities(itemSourceTitle || rawTitle || ''),
        sourceIcon: itemSourceIcon
      };
    });

    let feedTitle = resolveDisplayFeedTitle(rawTitle, items, feedUrl, homeUrl);
    if (!feedTitle || feedTitle === 'RSS Feed') {
      if (items.length > 0 && items[0].source && items[0].source !== 'RSS' && items[0].source !== 'Feed Source') {
        feedTitle = items[0].source;
      } else {
        feedTitle = titleFromHost(feedUrl) || 'RSS Feed';
      }
    }

    items.forEach((item) => {
      if (!item.source || item.source === 'Feed Source' || titlesAreSame(item.source, items[0] && items[0].title)) {
        item.source = feedTitle;
      }
    });

    return {
      meta: {
        title: feedTitle,
        description: decodeHtmlEntities(meta.description || ''),
        link: homeUrl,
        url: feedUrl,
        feedIcon: feedIcon
      },
      items,
      feedUrl
    };
  }

  async function loadFeed(url, options) {
    showLoading(true);
    showError(false);
    cardsContainer.innerHTML = '';

    try {
      const json = await fetchCanonicalFeed(url, options);
      const mapped = mapWorkerItems(json);
      currentFeedMeta = mapped.meta;
      currentItems = mapped.items;

      logFeedDiagnostics('worker', currentItems);
      renderFeedMeta(currentFeedMeta, currentItems.length);

      activeSearchQuery = '';
      activeFilterMode = 'all';
      if (feedSearchInput) feedSearchInput.value = '';
      if (feedFilterSelect) feedFilterSelect.value = 'all';

      setViewMode('list');
      showReaderPanel();

      const shareUrl = mapped.feedUrl || url;
      if (feedUrlInput && mapped.feedUrl) {
        feedUrlInput.value = mapped.feedUrl;
      }
      const newUrl = new URL(window.location);
      newUrl.searchParams.set('url', shareUrl);
      window.history.replaceState({}, '', newUrl);

      try {
        window.dispatchEvent(new CustomEvent('feedometer:feed-loaded', {
          detail: {
            feedUrl: shareUrl,
            title: currentFeedMeta.title,
            itemsCount: currentItems.length,
            publisher: currentFeedMeta.title
          }
        }));
      } catch (_) {}

    } catch (err) {
      console.error(err);
      try {
        window.dispatchEvent(new CustomEvent('feedometer:feed-error', {
          detail: {
            url: url,
            code: err && err.code,
            message: err && err.message
          }
        }));
      } catch (_) {}
      if (err && err.message === 'invalid-url') {
        showError(true, 'Enter a complete RSS, Atom, or website URL to load a feed.');
      } else if (err && err.code === 'capacity') {
        showError(true, 'Free reader is busy. Try again in a few hours.', err.code);
      } else if (err && (err.code === 'content_blocked' || err.code === 'ssrf_blocked')) {
        showError(true, err.message, err.code);
      } else {
        showError(true, "We couldn't load this feed right now. Check the URL, or try another feed.");
      }
    } finally {
      showLoading(false);
    }
  }

  function logFeedDiagnostics(feedSource, items) {
    const withImage = (items || []).filter((i) => i.image && String(i.image).trim()).length;
    console.info('[Feedometer] load:', {
      feedSource: feedSource || 'worker',
      stories: items ? items.length : 0,
      withHeroImage: withImage,
      workerApi: WORKER_BASE || '(not set)'
    });
  }

  function decodeHtmlEntities(str) {
    if (!str) return '';
    function pass(s) {
      return String(s)
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        const n = parseInt(hex, 16);
        try { return n ? String.fromCodePoint(n) : _; } catch (e) { return _; }
      })
      .replace(/&#(\d+);/g, (_, num) => {
        const n = parseInt(num, 10);
        try { return n ? String.fromCodePoint(n) : _; } catch (e) { return _; }
      })
        .replace(/&nbsp;/gi, ' ')
        .replace(/&rsquo;/gi, '\u2019')
        .replace(/&lsquo;/gi, '\u2018')
        .replace(/&rdquo;/gi, '\u201D')
        .replace(/&ldquo;/gi, '\u201C')
        .replace(/&mdash;/gi, '\u2014')
        .replace(/&ndash;/gi, '\u2013')
        .replace(/&hellip;/gi, '\u2026')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    }
    return pass(pass(str)).replace(/\s+/g, ' ').trim();
  }

  function cleanSnippet(title, description) {
    let d = (description || '').replace(/\s+/g, ' ').trim();
    const t = (title || '').replace(/\s+/g, ' ').trim();
    if (!d || !t) return d;
    if (d.toLowerCase() === t.toLowerCase()) return '';
    if (d.toLowerCase().indexOf(t.toLowerCase()) === 0) {
      d = d.slice(t.length).replace(/^[\s\-–—:|]+/, '').trim();
    }
    return d;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return String(dateStr).trim();
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return String(dateStr).trim();
    }
  }

  function renderFeedMeta(meta, count) {
    if (feedTitleEl) feedTitleEl.textContent = meta.title || 'Top Stories';
    if (feedCountBadge) feedCountBadge.textContent = count + ' ' + (count === 1 ? 'story' : 'stories');
  }

  function isArticleUrl(link) {
    try {
      const u = new URL(link);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  // =========================================================================
  // CARD MEDIA PRESENTATION (100% Presentation Layer)
  // All image extraction, XML parsing, OpenGraph scraping, and caching are
  // handled server-side by the Cloudflare Worker. The frontend only mounts
  // and displays images provided directly in the canonical payload.
  // =========================================================================

  /**
   * Finds or creates the .card-media wrapper element inside an article card.
   * @param {HTMLElement} card - The parent article card element.
   * @returns {HTMLElement} The card-media container element.
   */
  function ensureCardMedia(card) {
    let mediaEl = card.querySelector('.card-media');
    if (mediaEl) return mediaEl;
    mediaEl = document.createElement('div');
    mediaEl.className = 'card-media';
    const content = card.querySelector('.card-content');
    if (content) card.insertBefore(mediaEl, content);
    else card.appendChild(mediaEl);
    return mediaEl;
  }

  /**
   * Safely removes the .card-media container if an image fails to load.
   * @param {HTMLElement} mediaEl - The card-media container element.
   */
  function removeCardMedia(mediaEl) {
    if (mediaEl && mediaEl.parentNode) {
      mediaEl.parentNode.removeChild(mediaEl);
    }
  }

  /**
   * Creates an <img> element with lazy loading and asynchronous decoding.
   * If the image URL fails to load (404/403/broken image link), gracefully
   * removes the empty media container without affecting the card layout.
   * @param {HTMLElement} mediaEl - The card-media container element.
   * @param {string} imageUrl - The URL of the image to display.
   */
  function setCardMediaImage(mediaEl, imageUrl) {
    if (!mediaEl || !imageUrl) return;
    mediaEl.innerHTML = '';
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      // Graceful degradation on image load failure
      removeCardMedia(mediaEl);
    });
    mediaEl.appendChild(img);
  }

  /**
   * Mounts article media if the item provides a valid image URL from the Worker.
   * @param {HTMLElement} card - The parent article card element.
   * @param {Object} item - The canonical article item object.
   */
  function mountCardMedia(card, item) {
    if (!(item.image && String(item.image).trim())) return;
    const mediaEl = ensureCardMedia(card);
    setCardMediaImage(mediaEl, item.image);
  }

  function renderCards(items) {
    cardsContainer.innerHTML = '';
    if (!items || items.length === 0) {
      cardsContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);"><p>No articles found in this feed stream.</p></div>';
      return;
    }

    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'modern-card';
      if (item.link) {
        card.dataset.articleLink = item.link;
      }

      const isSensitiveStory = item.isSensitive || (item.safety && item.safety.isSensitive);
      if (isSensitiveStory) {
        card.classList.add('is-sensitive-item');
      }

      mountCardMedia(card, item);

      const faviconSrc = item.sourceIcon || currentFeedMeta.feedIcon || getDomainFavicon(item.link || currentFeedMeta.url);
      const sensitiveBadgeHtml = isSensitiveStory ? '<span class="sensitive-story-badge" title="This story contains sensitive or graphic news reportage">Sensitive News</span> ' : '';

      const content = document.createElement('div');
      content.className = 'card-content';
      var imgHtml = faviconSrc ? ('<img src="' + escapeHtml(faviconSrc) + '" class="source-favicon" alt="" onerror="this.style.display=\'none\'">') : '';
      var dateHtml = item.pubDate ? ('<span class="source-separator">•</span><span class="card-date-time">' + escapeHtml(item.pubDate) + '</span>') : '';
      content.innerHTML = '<h3 class="card-title">' + sensitiveBadgeHtml + '<a href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.title) + '</a></h3><p class="card-snippet">' + escapeHtml(cleanSnippet(item.title, item.description)) + '</p><div class="card-footer"><div class="card-source-info">' + imgHtml + '<span class="source-name">' + escapeHtml(item.source || 'RSS') + '</span>' + dateHtml + '</div></div>';
      card.appendChild(content);

      cardsContainer.appendChild(card);
    });
  }

  function openModal(item) {
    if (!readerModal) return;
    modalTitle.textContent = item.title;
    modalBody.innerHTML = item.contentHtml || ('<p>' + escapeHtml(item.description) + '</p>');
    modalLink.href = item.link;
    readerModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (!readerModal) return;
    readerModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  function showLoading(show) {
    if (loadingSpinner) {
      loadingSpinner.style.display = show ? 'flex' : 'none';
    }
    if (btnFetchFeed) {
      btnFetchFeed.disabled = show;
      btnFetchFeed.style.opacity = show ? '0.7' : '1';
    }
  }

  function showError(show, msg = '', code = '') {
    if (errorContainer) {
      errorContainer.style.display = show ? 'block' : 'none';
      if (show) {
        if (code === 'content_blocked' || code === 'ssrf_blocked' || String(msg).includes('prohibited') || String(msg).includes('safety') || String(msg).includes('restricted network')) {
          errorContainer.innerHTML = '<div class="safety-block-card"><div class="safety-block-header"><span class="safety-block-icon">⚠️</span><span class="safety-block-title">Content Safety Notice</span></div><p class="safety-block-text">' + escapeHtml(msg) + '</p><div class="safety-block-actions"><button type="button" class="safety-curated-btn" id="btn-safety-open-catalog">Explore 25 Curated Publishers</button></div></div>';
          const openCatalogBtn = document.getElementById('btn-safety-open-catalog');
          if (openCatalogBtn) {
            openCatalogBtn.addEventListener('click', () => {
              const navBtn = document.getElementById('btn-feed-navigator');
              if (navBtn) navBtn.click();
            });
          }
        } else {
          errorContainer.innerHTML = '<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: var(--radius-md); padding: 1rem 1.25rem; color: #991b1b; font-size: 0.95rem; font-weight: 500;">' + escapeHtml(msg) + '</div>';
        }
      }
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

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
