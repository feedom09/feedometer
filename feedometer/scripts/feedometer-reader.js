/**
 * scripts/feedometer-reader.js — FeedOmeter 2.1 3-Pane Reader & Personal Dashboard Controller
 */
(function (global) {
  'use strict';

  function getApiBase() {
    if (window.FEEDOMETER_CONFIG && window.FEEDOMETER_CONFIG.apiBaseUrl) {
      return window.FEEDOMETER_CONFIG.apiBaseUrl.replace(/\/$/, '');
    }
    if (window.FEEDOMETER_API_BASE) {
      return window.FEEDOMETER_API_BASE.replace(/\/$/, '');
    }
    return 'https://feedometer-api.feedometer.workers.dev';
  }

  // App State
  const state = {
    user: null,
    currentTab: 'all', // 'all' | 'starred' | 'saved' | 'history' | 'folder'
    activeFolderId: null,
    activeFolderName: 'All Feeds',
    viewMode: localStorage.getItem('feedometer_reader_view') || 'list', // 'list' | 'cards'
    sortBy: 'newest', // 'newest' | 'oldest' | 'source' | 'title'
    articles: [],
    folders: [],
    subscriptions: [],
    selectedArticle: null,
    cursor: null,
    hasMore: false,
    isLoading: false,
    fontSize: 17,
    isSerif: false,
    filterUnreadOnly: false,
    searchQuery: ''
  };

  // In-memory stream cache so sidebar switches paint instantly (no DB round-trip flash)
  const STREAM_CACHE_TTL_MS = 90 * 1000;
  const streamCache = new Map();
  let streamFetchGen = 0;

  function streamCacheKey(tab = state.currentTab, folderId = state.activeFolderId) {
    if (tab === 'folder' && folderId) return `folder:${folderId}`;
    return String(tab || 'all');
  }

  function writeStreamCache(key, snapshot) {
    streamCache.set(key, {
      articles: snapshot.articles || [],
      cursor: snapshot.cursor || null,
      hasMore: Boolean(snapshot.hasMore),
      fetchedAt: Date.now()
    });
  }

  function readStreamCache(key) {
    return streamCache.get(key) || null;
  }

  function isStreamCacheFresh(entry) {
    return Boolean(entry && (Date.now() - entry.fetchedAt) < STREAM_CACHE_TTL_MS);
  }

  function invalidateStreamCache(key) {
    if (!key) {
      streamCache.clear();
      return;
    }
    streamCache.delete(key);
  }

  function applyStreamSnapshot(snapshot, { selectFirst = false } = {}) {
    state.articles = Array.isArray(snapshot.articles) ? snapshot.articles.slice() : [];
    state.cursor = snapshot.cursor || null;
    state.hasMore = Boolean(snapshot.hasMore);
    renderStreamCards();
    if (selectFirst && state.articles.length > 0 && !state.selectedArticle) {
      state.selectedArticle = state.articles[0];
    }
  }

  // Helper for API Requests
  async function api(path, options = {}) {
    const authHeaders = global.FeedOmeterAuth ? global.FeedOmeterAuth.getAuthHeaders() : {};
    const headers = {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options.headers || {})
    };
    const res = await fetch(`${getApiBase()}${path}`, { ...options, headers });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data: json };
  }

  // Timeago helper
  function timeAgo(dateString) {
    if (!dateString) return '';
    const now = Date.now();
    const epoch = new Date(dateString).getTime();
    if (isNaN(epoch)) return '';
    const diffSec = Math.floor((now - epoch) / 1000);

    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return new Date(dateString).toLocaleDateString();
  }

  // Initialize
  async function init() {
    setupEventListeners();
    setupKeyboardShortcuts();

    // Check if user arrived via a password reset link (?reset_token=... or ?token=...)
    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('reset_token') || urlParams.get('token');
    if (resetToken) {
      showAuthModal('login');
      try {
        const verifyData = await global.FeedOmeterAuth.verifyResetToken(resetToken);
        if (verifyData && verifyData.valid) {
          switchAuthMode('reset', { token: resetToken, email: verifyData.email });
        }
      } catch (err) {
        switchAuthMode('login');
        const errEl = document.getElementById('auth-error-msg');
        if (errEl) {
          errEl.textContent = err.message || 'Password reset link is invalid or has expired.';
          errEl.style.display = 'block';
        }
      }
      return;
    }

    const user = global.FeedOmeterAuth ? global.FeedOmeterAuth.getUser() : null;
    if (user) {
      handleAuthenticated(user);
    } else {
      showAuthModal('login');
    }

    window.addEventListener('feedometer:auth_change', (e) => {
      if (e.detail.user) {
        handleAuthenticated(e.detail.user);
      } else {
        handleUnauthenticated();
      }
    });
  }

  async function prewarmStreamCache() {
    const tabs = [
      { key: 'starred', endpoint: '/api/articles/starred' },
      { key: 'saved',   endpoint: '/api/articles/saved' }
    ];
    for (const { key, endpoint } of tabs) {
      if (readStreamCache(key)) continue; // already warm, skip
      try {
        const res = await api(endpoint);
        if (!res.ok) continue;
        const items = (res.data.items || []).map(normalizeStreamItem);
        writeStreamCache(key, { articles: items, cursor: null, hasMore: false });
      } catch (_) {}
      // Small gap between requests
      await new Promise(r => setTimeout(r, 400));
    }
  }

  function handleAuthenticated(user) {
    state.user = user;
    hideAuthModal();
    renderUserProfile(user);
    loadFolders();
    loadSubscriptions();
    loadStream(true);
    // Pre-warm Starred & Saved caches 2s after login so tab switches are instant
    setTimeout(prewarmStreamCache, 2000);
  }

  function handleUnauthenticated() {
    state.user = null;
    state.articles = [];
    state.folders = [];
    state.selectedArticle = null;
    renderSidebarTree();
    renderStreamCards();
    renderArticleDetail(null);
    showAuthModal('login');
  }

  // ── 1. Sidebar & Folder Management ──
  async function loadFolders() {
    const res = await api('/api/folders');
    if (res.ok && res.data.folders) {
      state.folders = res.data.folders;
      renderSidebarTree();
    }
  }

  async function loadSubscriptions() {
    const res = await api('/api/subscriptions');
    if (res.ok && res.data.subscriptions) {
      state.subscriptions = res.data.subscriptions;
    }
  }

  function renderUserProfile(user) {
    if (!user) return;
    const nameEl = document.getElementById('user-display-name');
    const emailEl = document.getElementById('user-display-email');
    const avatarImg = document.getElementById('user-display-avatar-img');
    const avatarText = document.getElementById('user-display-avatar-text');

    const displayName = user.display_name || user.name || (user.email ? user.email.split('@')[0] : 'User');
    if (nameEl) nameEl.textContent = displayName;
    if (emailEl) emailEl.textContent = user.email || '';

    const pic = user.avatar_url || user.picture || user.picture_url || '';
    if (pic && avatarImg && avatarText) {
      avatarImg.src = pic;
      avatarImg.style.display = 'block';
      avatarText.style.display = 'none';
      avatarImg.onerror = () => {
        avatarImg.style.display = 'none';
        avatarText.style.display = 'inline';
      };
    } else if (avatarText) {
      if (avatarImg) avatarImg.style.display = 'none';
      avatarText.style.display = 'inline';
      avatarText.textContent = (displayName ? displayName[0] : (user.email ? user.email[0] : 'U')).toUpperCase();
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

  function decodeEntities(str) {
    if (!str) return '';
    const txt = document.createElement('textarea');
    txt.innerHTML = str;
    return txt.value;
  }

  function cleanSnippet(title, summary) {
    if (!summary) return '';
    // 1. Strip all HTML tags including images, links, scripts
    let clean = String(summary).replace(/<[^>]*>/g, ' ');
    // 2. Decode entities
    clean = decodeEntities(clean);
    // 3. Collapse multiple whitespace/newlines
    clean = clean.replace(/\s+/g, ' ').trim();
    // 4. If summary starts with the title, remove duplicate title
    if (title) {
      const cleanTitle = String(title).replace(/\s+/g, ' ').trim();
      if (clean.toLowerCase() === cleanTitle.toLowerCase()) return '';
      if (clean.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
        clean = clean.substring(cleanTitle.length).replace(/^[\s\-–—:|]+/, '').trim();
      }
    }
    // 5. Cap length so long multi-paragraph descriptions do not blow up card layout
    if (clean.length > 220) {
      clean = clean.substring(0, 220).replace(/\s+\S*$/, '') + '...';
    }
    return clean;
  }

  function formatArticleDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  function renderSidebarTree() {
    const folderListEl = document.getElementById('sidebar-folder-tree');
    if (!folderListEl) return;

    if (state.folders.length === 0) {
      folderListEl.innerHTML = '<div style="padding: 0.4rem 0.65rem; font-size: 0.82rem; color: rgba(0,0,0,0.55); font-weight: 400;">No folders created yet</div>';
      return;
    }

    let html = '';
    state.folders.forEach(folder => {
      const isActive = state.currentTab === 'folder' && state.activeFolderId === folder.id;
      html += `
        <div class="sidebar-nav-item ${isActive ? 'active' : ''}" data-folder-id="${folder.id}" data-folder-name="${folder.name}">
          <div class="nav-icon-label">
            <span>${folder.icon || '📁'}</span>
            <span>${folder.name}</span>
          </div>
          <span class="nav-badge">${folder.feed_count || 0}</span>
        </div>
      `;
    });
    folderListEl.innerHTML = html;

    // Attach click handlers
    folderListEl.querySelectorAll('.sidebar-nav-item').forEach(el => {
      el.addEventListener('click', () => {
        const folderId = el.getAttribute('data-folder-id');
        const folderName = el.getAttribute('data-folder-name');
        switchStreamContext('folder', folderId, folderName);
      });
    });
  }

  function normalizeStreamItem(item) {
    if (!item || typeof item !== 'object') return item;
    const summary = item.summary || item.snippet || item.description || '';
    const image = item.image || item.image_url || item.thumbnail || '';
    const link = item.link || item.url || '#';
    const published = item.published || item.published_at || item.pubDate || '';
    const sourceTitle = (item.source && item.source.title) || item.source_title || 'Feed';
    return Object.assign({}, item, {
      summary,
      description: item.description || summary,
      snippet: item.snippet || summary,
      image,
      image_url: item.image_url || image,
      link,
      url: item.url || link,
      published,
      pubDate: item.pubDate || published,
      source: Object.assign({}, item.source || {}, {
        title: sourceTitle,
        logo_url: (item.source && item.source.logo_url) || item.source_logo || ''
      }),
      source_title: sourceTitle
    });
  }

  // ── 2. Stream Engine & Feed Fusion ──
  async function loadStream(reset = false, options = {}) {
    const silent = Boolean(options.silent);
    const forceNetwork = Boolean(options.force);
    const requestKey = streamCacheKey();

    // Instant paint from memory when switching menus
    if (reset && !forceNetwork && !silent) {
      const cached = readStreamCache(requestKey);
      if (cached && Array.isArray(cached.articles)) {
        applyStreamSnapshot(cached);
        if (!isStreamCacheFresh(cached)) {
          // Stale-while-revalidate in background
          loadStream(true, { silent: true, force: true });
        }
        return;
      }
    }

    if (state.isLoading && !silent) return;
    if (!silent) state.isLoading = true;

    const fetchGen = ++streamFetchGen;
    const container = document.getElementById('stream-cards-list');
    const hasCachedView = Boolean(readStreamCache(requestKey));

    if (reset && !silent) {
      state.cursor = null;
      // Dim current content whenever switching to an uncached tab (no flash)
      if (!hasCachedView && container) {
        container.classList.add('is-switching');
      }
      if (!hasCachedView) renderStreamLoading(true);
    }

    let endpoint = '/api/stream?limit=25';
    if (state.currentTab === 'folder' && state.activeFolderId) {
      endpoint = `/api/stream?folder_id=${state.activeFolderId}&limit=25`;
    } else if (state.currentTab === 'starred') {
      endpoint = '/api/articles/starred';
    } else if (state.currentTab === 'saved') {
      endpoint = '/api/articles/saved';
    }

    const pagedTabs = state.currentTab !== 'starred' && state.currentTab !== 'saved';
    if (state.cursor && pagedTabs && !reset) {
      endpoint += `&cursor=${encodeURIComponent(state.cursor)}`;
    }

    try {
      const res = await api(endpoint);
      if (!silent) {
        state.isLoading = false;
        renderStreamLoading(false);
        // NOTE: intentionally NOT removing is-switching here —
        // we keep the dim until new content is painted below (smooth fade-in)
      }

      if (!res.ok) {
        if (!silent) {
          if (container) container.classList.remove('is-switching');
          if (streamCacheKey() === requestKey) {
            renderStreamError(res.data.message || 'Failed to load feed stream');
          }
        }
        return;
      }

      const items = (res.data.items || []).map(normalizeStreamItem);
      let nextArticles;
      if (reset) {
        nextArticles = items;
      } else if (streamCacheKey() === requestKey) {
        nextArticles = [...state.articles, ...items];
      } else {
        nextArticles = items;
      }

      const snapshot = {
        articles: nextArticles,
        cursor: res.data.next_cursor || null,
        hasMore: res.data.has_more || false
      };
      writeStreamCache(requestKey, snapshot);

      // Ignore late responses if the user already switched menus
      if (fetchGen !== streamFetchGen && silent) return;
      if (streamCacheKey() !== requestKey) return;

      applyStreamSnapshot(snapshot, { selectFirst: reset && !silent });

      // Remove dim AFTER new content is in the DOM → CSS opacity transition gives smooth fade-in
      if (!silent && container) {
        requestAnimationFrame(() => container.classList.remove('is-switching'));
      }

    } catch (err) {
      if (!silent) {
        state.isLoading = false;
        renderStreamLoading(false);
        if (container) container.classList.remove('is-switching');
        if (streamCacheKey() === requestKey) {
          renderStreamError(err.message || 'Failed to load feed stream');
        }
      }
    }
  }

  function switchStreamContext(tab, folderId = null, folderName = 'All Feeds') {
    // Persist the view we are leaving so returning is instant (skip if still mid-fetch)
    if (!state.isLoading) {
      writeStreamCache(streamCacheKey(), {
        articles: state.articles,
        cursor: state.cursor,
        hasMore: state.hasMore
      });
    }

    state.currentTab = tab;
    state.activeFolderId = folderId;
    state.activeFolderName = folderName;
    state.selectedArticle = null;

    // Update active nav styling
    document.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));
    if (tab === 'folder') {
      const folderEl = document.querySelector(`[data-folder-id="${folderId}"]`);
      if (folderEl) folderEl.classList.add('active');
    } else {
      const tabEl = document.querySelector(`[data-nav-tab="${tab}"]`);
      if (tabEl) tabEl.classList.add('active');
    }

    // Update Header
    const titleEl = document.getElementById('stream-context-title');
    if (titleEl) titleEl.textContent = folderName;

    loadStream(true);
  }

  function getSortedAndFilteredArticles() {
    let list = [...state.articles];
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      list = list.filter(a => 
        (a.title && a.title.toLowerCase().includes(q)) || 
        (a.summary && a.summary.toLowerCase().includes(q)) ||
        (a.source && a.source.title && a.source.title.toLowerCase().includes(q))
      );
    }

    if (state.sortBy === 'newest') {
      list.sort((a, b) => {
        const timeA = a.published ? new Date(a.published).getTime() : 0;
        const timeB = b.published ? new Date(b.published).getTime() : 0;
        return timeB - timeA;
      });
    } else if (state.sortBy === 'oldest') {
      list.sort((a, b) => {
        const timeA = a.published ? new Date(a.published).getTime() : 0;
        const timeB = b.published ? new Date(b.published).getTime() : 0;
        return timeA - timeB;
      });
    } else if (state.sortBy === 'source') {
      list.sort((a, b) => {
        const nameA = (a.source && a.source.title) || '';
        const nameB = (b.source && b.source.title) || '';
        return nameA.localeCompare(nameB);
      });
    } else if (state.sortBy === 'title') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    }

    return list;
  }

  function renderStreamCards() {
    const container = document.getElementById('stream-cards-list');
    if (!container) return;

    const filtered = getSortedAndFilteredArticles();

    const isCardsMode = state.viewMode === 'cards';
    container.className = isCardsMode
      ? 'stream-scroll-area card-grid'
      : 'stream-scroll-area cards-list';

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="reader-empty-state" style="grid-column: 1 / -1;">
          <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📭</div>
          <p style="font-weight: 700; color: #0f172a; font-size: 1.05rem;">No stories found</p>
          <p style="font-size: 0.85rem; color: #64748b; margin-top: 0.25rem;">Follow more RSS sources or adjust your search filter.</p>
        </div>
      `;
      return;
    }

    let html = '';

    filtered.forEach((art, idx) => {
      const isStarred = Boolean(art.is_starred);
      const isSaved = Boolean(art.is_saved);
      const link = art.link || art.url || '#';
      const title = art.title || 'Untitled Article';
      const snippet = cleanSnippet(title, art.summary || art.description || art.snippet || '');
      const sourceName = art.source?.title || art.source_title || (typeof art.source === 'string' ? art.source : 'RSS');
      const sourceIcon = art.source?.icon || art.source?.logo_url || art.sourceIcon || art.source_icon || (link && link !== '#' ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(link)}&sz=32` : '');
      const dateStr = formatArticleDate(art.published || art.pubDate || art.created_at);
      const timeStr = art.published ? new Date(art.published).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (art.pubDate ? new Date(art.pubDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
      const image = art.image || art.image_url || art.thumbnail || art.hero_image || art.enclosure?.url || (art.enclosures && art.enclosures[0]?.url) || '';

      if (isCardsMode) {
        // Exact Card Option matching Trending / home.html (Screenshot 1)
        const mediaHtml = (window.FeedImaging && typeof window.FeedImaging.renderMedia === 'function')
          ? window.FeedImaging.renderMedia(art, { className: 'article-card-img', fallbackClass: 'article-card-fallback' })
          : (image
            ? `<img class="article-card-img" src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.innerHTML='<div class=\\'article-card-fallback\\'>${escapeHtml(sourceName.charAt(0).toUpperCase() || 'N')}</div>'" />`
            : `<div class="article-card-fallback">${escapeHtml(sourceName.charAt(0).toUpperCase() || 'N')}</div>`);

        html += `
          <div class="article-card ${art.is_read ? 'is-read' : ''}" data-article-id="${escapeHtml(art.id)}" data-article-link="${escapeHtml(link)}" data-index="${idx}">
            <div class="article-card-media">
              ${mediaHtml}
            </div>
            <div class="article-source-row">
              <span class="article-source-badge">
                ${sourceIcon ? `<img src="${escapeHtml(sourceIcon)}" class="source-favicon" alt="" onerror="this.style.display='none'">` : ''}
                ${escapeHtml(sourceName)}
              </span>
              <span>${escapeHtml(timeStr || dateStr)}</span>
            </div>
            <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" class="article-title">${escapeHtml(title)}</a>
            ${snippet ? `<p class="article-snippet">${escapeHtml(snippet)}</p>` : ''}
            <div class="article-card-actions">
              <div style="display: flex; gap: 0.25rem;">
                <button type="button" class="action-icon-btn ${isStarred ? 'active-star' : ''}" data-action="star" data-article-id="${escapeHtml(art.id)}" title="${isStarred ? 'Unstar Article' : 'Star Article'}">${isStarred ? '★' : '☆'}</button>
                <button type="button" class="action-icon-btn ${isSaved ? 'active-bookmark' : ''}" data-action="save" data-article-id="${escapeHtml(art.id)}" title="${isSaved ? 'Saved' : 'Read Later'}">${isSaved ? '🔖' : '📑'}</button>
              </div>
              <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" class="action-icon-btn" title="Open Original">↗</a>
            </div>
          </div>
        `;
      } else {
        // List View Option (Screenshot 5)
        html += `
          <article class="modern-card ${art.is_read ? 'is-read' : ''}" data-article-id="${escapeHtml(art.id)}" data-article-link="${escapeHtml(link)}" data-index="${idx}">
            <div class="card-content">
              <h3 class="card-title">
                <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>
              </h3>
              ${snippet ? `<p class="card-snippet">${escapeHtml(snippet)}</p>` : ''}
              <div class="card-footer">
                <div class="card-source-info">
                  ${sourceIcon ? `<img src="${escapeHtml(sourceIcon)}" class="source-favicon" alt="" onerror="this.style.display='none'">` : ''}
                  <span class="source-name">${escapeHtml(sourceName)}</span>
                  ${dateStr ? `<span class="source-separator">•</span><span class="card-date-time">${escapeHtml(dateStr)}</span>` : ''}
                </div>
                <div class="card-actions">
                  <button type="button" class="card-icon-btn ${isStarred ? 'active-star' : ''}" data-action="star" data-article-id="${escapeHtml(art.id)}" title="${isStarred ? 'Unstar' : 'Star'}">
                    ${isStarred ? '⭐' : '☆'}
                  </button>
                  <button type="button" class="card-icon-btn ${isSaved ? 'active-save' : ''}" data-action="save" data-article-id="${escapeHtml(art.id)}" title="${isSaved ? 'Saved' : 'Read Later'}">
                    ${isSaved ? '⏳ Saved' : '⏳'}
                  </button>
                  <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" class="card-icon-btn" title="Open Original">↗</a>
                </div>
              </div>
            </div>
            ${image ? `
              <div class="card-media">
                <img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" onerror="this.parentElement.style.display='none'" />
              </div>
            ` : ''}
          </article>
        `;
      }
    });

    if (state.hasMore) {
      html += `
        <div style="grid-column: 1 / -1; width: 100%; padding-top: 0.75rem;">
          <button id="stream-load-more-btn" class="btn-secondary" style="width: 100%; padding: 0.65rem; border-radius: 9px; font-weight: 650; cursor: pointer; background: #ffffff; border: 1px solid #cbd5e1;">
            Load More Stories
          </button>
        </div>
      `;
    }

    container.innerHTML = html;

    // Apply smart cropping on images
    if (window.SmartCrop && typeof window.SmartCrop.applyAll === 'function') {
      window.SmartCrop.applyAll(container);
    }

    // Attach item clicks to open Reading Modal when not clicking link or action button
    container.querySelectorAll('.article-card, .modern-card').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]') || e.target.closest('a')) return;
        const id = el.getAttribute('data-article-id');
        const art = state.articles.find(a => a.id === id);
        if (art) openReadingModal(art);
      });
    });

    // Action buttons
    container.querySelectorAll('[data-action="star"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-article-id');
        toggleStar(id);
      });
    });

    container.querySelectorAll('[data-action="save"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-article-id');
        toggleSave(id);
      });
    });

    const loadMoreBtn = document.getElementById('stream-load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => loadStream(false));
    }
  }

  function renderStreamLoading(isLoading) {
    const loader = document.getElementById('stream-loader');
    if (loader) loader.style.display = isLoading ? 'block' : 'none';
  }

  function renderStreamError(msg) {
    const container = document.getElementById('stream-cards-list');
    if (container) {
      container.innerHTML = `
        <div class="reader-empty-state">
          <div style="font-size: 2rem; color: #dc2626; margin-bottom: 0.5rem;">⚠️</div>
          <p style="font-weight: 700; color: #dc2626;">${msg}</p>
        </div>
      `;
    }
  }

  // ── 3. Distraction-Free Reading Modal ──
  function openReadingModal(article) {
    state.selectedArticle = article;
    article.is_read = true;

    // Record read in DB
    api('/api/articles/read', {
      method: 'POST',
      body: JSON.stringify({ article_hash: article.id })
    });

    const modal = document.getElementById('reading-modal');
    const badgeEl = document.getElementById('reading-source-badge');
    const timeEl = document.getElementById('reading-time-ago');
    const origLink = document.getElementById('reading-orig-link');
    const titleEl = document.getElementById('reading-article-title');
    const metaEl = document.getElementById('reading-article-meta');
    const heroImg = document.getElementById('reading-hero-img');
    const audioEl = document.getElementById('reading-audio-player');
    const proseEl = document.getElementById('reading-prose');

    if (badgeEl) badgeEl.textContent = article.source ? article.source.title : 'Feed Source';
    if (timeEl) timeEl.textContent = timeAgo(article.published);
    if (origLink) origLink.href = article.link || '#';
    if (titleEl) titleEl.textContent = article.title || 'Untitled Article';

    if (metaEl) {
      metaEl.innerHTML = `
        <span>By <strong>${article.author || (article.source ? article.source.title : 'FeedOmeter')}</strong></span>
        <span>•</span>
        <span>${new Date(article.published || Date.now()).toLocaleString()}</span>
      `;
    }

    if (heroImg) {
      if (article.image) {
        heroImg.src = article.image;
        heroImg.style.display = 'block';
      } else {
        heroImg.style.display = 'none';
      }
    }

    if (audioEl) {
      if (article.audio && article.audio.url) {
        audioEl.src = article.audio.url;
        audioEl.style.display = 'block';
      } else {
        audioEl.style.display = 'none';
      }
    }

    if (proseEl) {
      proseEl.style.fontSize = `${state.fontSize}px`;
      proseEl.className = state.isSerif ? 'reading-prose serif' : 'reading-prose';
      proseEl.innerHTML = `<p>${article.summary || 'No summary content available for this entry.'}</p>`;
    }

    if (modal) modal.style.display = 'flex';
  }

  function closeReadingModal() {
    const modal = document.getElementById('reading-modal');
    if (modal) modal.style.display = 'none';
  }

  // ── 4. Star & Save Article Actions ──
  async function toggleStar(articleId) {
    const article = state.articles.find(a => a.id === articleId);
    if (!article) return;

    article.is_starred = !article.is_starred;
    invalidateStreamCache('starred');
    writeStreamCache(streamCacheKey(), {
      articles: state.articles,
      cursor: state.cursor,
      hasMore: state.hasMore
    });
    renderStreamCards();

    if (article.is_starred) {
      await api('/api/articles/star', {
        method: 'POST',
        body: JSON.stringify({
          article_hash: article.id,
          article_data: article
        })
      });
    } else {
      await api('/api/articles/unstar', {
        method: 'POST',
        body: JSON.stringify({ article_hash: article.id })
      });
    }
  }

  async function toggleSave(articleId) {
    const article = state.articles.find(a => a.id === articleId);
    if (!article) return;

    article.is_saved = !article.is_saved;
    invalidateStreamCache('saved');
    writeStreamCache(streamCacheKey(), {
      articles: state.articles,
      cursor: state.cursor,
      hasMore: state.hasMore
    });
    renderStreamCards();

    if (article.is_saved) {
      await api('/api/articles/save', {
        method: 'POST',
        body: JSON.stringify({
          article_hash: article.id,
          article_data: article
        })
      });
    } else {
      await api('/api/articles/unsave', {
        method: 'POST',
        body: JSON.stringify({ article_hash: article.id })
      });
    }
  }

  // ── 5. Modals & Controls ──
  function showAuthModal(tab = 'login') {
    const modal = document.getElementById('auth-modal');
    if (modal) {
      modal.style.display = 'flex';
      switchAuthMode(tab);
    }
  }

  function hideAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'none';
  }

  function switchAuthMode(mode, data = {}) {
    const isLogin = mode === 'login';
    const isRegister = mode === 'register';
    const isForgot = mode === 'forgot';
    const isReset = mode === 'reset';

    const loginTab = document.getElementById('auth-tab-login');
    const regTab = document.getElementById('auth-tab-register');
    const tabsRow = document.getElementById('auth-tabs-row');
    const authForm = document.getElementById('auth-form');
    const forgotPanel = document.getElementById('auth-forgot-panel');
    const resetPanel = document.getElementById('auth-reset-panel');
    const submitBtn = document.getElementById('auth-submit-btn');
    const titleEl = document.getElementById('auth-modal-title');
    const nameRow = document.getElementById('auth-name-row');
    const errEl = document.getElementById('auth-error-msg');
    const succEl = document.getElementById('auth-success-msg');

    if (errEl) errEl.style.display = 'none';
    if (succEl) succEl.style.display = 'none';

    if (tabsRow) tabsRow.style.display = (isLogin || isRegister) ? 'flex' : 'none';
    if (authForm) authForm.style.display = (isLogin || isRegister) ? 'flex' : 'none';
    if (forgotPanel) forgotPanel.style.display = isForgot ? 'flex' : 'none';
    if (resetPanel) resetPanel.style.display = isReset ? 'flex' : 'none';

    if (nameRow) nameRow.style.display = isRegister ? 'block' : 'none';
    if (loginTab) loginTab.classList.toggle('active', isLogin);
    if (regTab) regTab.classList.toggle('active', isRegister);

    if (authForm) authForm.setAttribute('data-mode', mode);

    if (titleEl) {
      if (isLogin) titleEl.textContent = 'Sign In to FeedOmeter';
      else if (isRegister) titleEl.textContent = 'Create FeedOmeter Account';
      else if (isForgot) titleEl.textContent = 'Reset Your Password';
      else if (isReset) titleEl.textContent = 'Set New Password';
    }

    if (submitBtn) {
      submitBtn.textContent = isLogin ? 'Sign In' : 'Create Account';
    }

    if (isReset && data.token) {
      const tokenInput = document.getElementById('reset-token-val');
      if (tokenInput) tokenInput.value = data.token;
      const emailDisplay = document.getElementById('reset-account-email');
      if (emailDisplay && data.email) emailDisplay.textContent = data.email;
    }
  }

  global.switchAuthMode = switchAuthMode;
  global.switchAuthTab = switchAuthMode;

  function showAddFeedModal() {
    const modal = document.getElementById('add-feed-modal');
    if (!modal) return;

    const folderSelect = document.getElementById('feed-folder-select');
    if (folderSelect) {
      folderSelect.innerHTML = '<option value="">(No folder / Top level)</option>' +
        state.folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
    }
    modal.style.display = 'flex';
  }

  function showAddFolderModal() {
    const modal = document.getElementById('add-folder-modal');
    if (!modal) return;

    const parentSelect = document.getElementById('folder-parent-select');
    if (parentSelect) {
      parentSelect.innerHTML = '<option value="">(None - Top Level Folder)</option>' +
        state.folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
    }
    modal.style.display = 'flex';
  }

  // ── 6. Event Listeners & Keyboard Shortcuts ──
  function setupEventListeners() {
    // System Nav items
    document.querySelectorAll('[data-nav-tab]').forEach(el => {
      el.addEventListener('click', () => {
        const tab = el.getAttribute('data-nav-tab');
        const title = el.querySelector('.nav-icon-label span:last-child').textContent;
        switchStreamContext(tab, null, title);
      });
    });

    // View Mode Switcher
    const btnList = document.getElementById('btn-view-list');
    const btnCards = document.getElementById('btn-view-cards');
    if (btnList && btnCards) {
      btnList.classList.toggle('active', state.viewMode === 'list');
      btnCards.classList.toggle('active', state.viewMode === 'cards');

      btnList.addEventListener('click', () => {
        state.viewMode = 'list';
        localStorage.setItem('feedometer_reader_view', 'list');
        btnList.classList.add('active');
        btnCards.classList.remove('active');
        renderStreamCards();
      });

      btnCards.addEventListener('click', () => {
        state.viewMode = 'cards';
        localStorage.setItem('feedometer_reader_view', 'cards');
        btnCards.classList.add('active');
        btnList.classList.remove('active');
        renderStreamCards();
      });
    }

    // Sort By Selector
    const sortSelect = document.getElementById('stream-sort-select');
    if (sortSelect) {
      sortSelect.value = state.sortBy;
      sortSelect.addEventListener('change', (e) => {
        state.sortBy = e.target.value;
        renderStreamCards();
      });
    }

    // Add Feed & Add Folder buttons (Sidebar + Header)
    const addFeedBtn = document.getElementById('sidebar-add-feed-btn');
    if (addFeedBtn) addFeedBtn.addEventListener('click', showAddFeedModal);

    const addFolderBtn = document.getElementById('sidebar-add-folder-btn');
    if (addFolderBtn) addFolderBtn.addEventListener('click', showAddFolderModal);

    const hAddFeed = document.getElementById('header-add-feed-btn');
    if (hAddFeed) hAddFeed.addEventListener('click', showAddFeedModal);

    const hAddFolder = document.getElementById('header-add-folder-btn');
    if (hAddFolder) hAddFolder.addEventListener('click', showAddFolderModal);

    // Logout
    const logoutBtn = document.getElementById('sidebar-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (global.FeedOmeterAuth) global.FeedOmeterAuth.logout();
      });
    }

    // Reading Modal Controls
    const btnCloseReading = document.getElementById('btn-close-reading-modal');
    if (btnCloseReading) btnCloseReading.addEventListener('click', closeReadingModal);

    const btnReadingSmaller = document.getElementById('btn-reading-smaller');
    const btnReadingBigger = document.getElementById('btn-reading-bigger');
    const btnReadingSerif = document.getElementById('btn-reading-serif');
    const readingProse = document.getElementById('reading-prose');

    if (btnReadingSmaller) {
      btnReadingSmaller.addEventListener('click', () => {
        state.fontSize = Math.max(13, state.fontSize - 1);
        if (readingProse) readingProse.style.fontSize = `${state.fontSize}px`;
      });
    }
    if (btnReadingBigger) {
      btnReadingBigger.addEventListener('click', () => {
        state.fontSize = Math.min(26, state.fontSize + 1);
        if (readingProse) readingProse.style.fontSize = `${state.fontSize}px`;
      });
    }
    if (btnReadingSerif) {
      btnReadingSerif.addEventListener('click', () => {
        state.isSerif = !state.isSerif;
        btnReadingSerif.classList.toggle('active', state.isSerif);
        if (readingProse) {
          readingProse.className = state.isSerif ? 'reading-prose serif' : 'reading-prose';
        }
      });
    }

    const readingModal = document.getElementById('reading-modal');
    if (readingModal) {
      readingModal.addEventListener('click', (e) => {
        if (e.target === readingModal) closeReadingModal();
      });
    }

    // Search Input
    const searchInput = document.getElementById('stream-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim();
        renderStreamCards();
      });
    }

    // Modal Close buttons
    document.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.reader-modal-backdrop');
        if (modal && modal.id !== 'auth-modal') modal.style.display = 'none';
      });
    });

    // Auth Form
    const authForm = document.getElementById('auth-form');
    if (authForm) {
      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const mode = authForm.getAttribute('data-mode') || 'login';
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const errEl = document.getElementById('auth-error-msg');
        if (errEl) errEl.style.display = 'none';

        try {
          if (mode === 'login') {
            await global.FeedOmeterAuth.login(email, password);
          } else {
            await global.FeedOmeterAuth.register(email, password);
          }
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message;
            errEl.style.display = 'block';
          }
        }
      });
    }

    // Forgot Password Form Submit
    const forgotForm = document.getElementById('forgot-form');
    if (forgotForm) {
      forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value.trim();
        const errEl = document.getElementById('auth-error-msg');
        const succEl = document.getElementById('auth-success-msg');
        const submitBtn = document.getElementById('forgot-submit-btn');

        if (errEl) errEl.style.display = 'none';
        if (succEl) succEl.style.display = 'none';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Processing...'; }

        try {
          const res = await global.FeedOmeterAuth.forgotPassword(email);
          if (succEl) {
            let msg = res.message || 'Password reset link prepared.';
            if (res.reset_token) {
              msg += '<br><a href="#" id="btn-simulate-reset" style="color: #0284c7; font-weight: 700; text-decoration: underline; margin-top: 0.35rem; display: inline-block;">Click here to set new password now →</a>';
            }
            succEl.innerHTML = msg;
            succEl.style.display = 'block';

            if (res.reset_token) {
              setTimeout(() => {
                const simBtn = document.getElementById('btn-simulate-reset');
                if (simBtn) {
                  simBtn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    switchAuthMode('reset', { token: res.reset_token, email: email });
                  });
                }
              }, 50);
            }
          }
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message;
            errEl.style.display = 'block';
          }
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Request Password Reset'; }
        }
      });
    }

    // Reset Password Form Submit
    const resetForm = document.getElementById('reset-form');
    if (resetForm) {
      resetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = document.getElementById('reset-token-val').value.trim();
        const newPass = document.getElementById('reset-password-input').value;
        const confirmPass = document.getElementById('reset-password-confirm').value;
        const errEl = document.getElementById('auth-error-msg');
        const succEl = document.getElementById('auth-success-msg');
        const submitBtn = document.getElementById('reset-submit-btn');

        if (errEl) errEl.style.display = 'none';
        if (succEl) succEl.style.display = 'none';

        if (newPass !== confirmPass) {
          if (errEl) {
            errEl.textContent = 'Passwords do not match.';
            errEl.style.display = 'block';
          }
          return;
        }

        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Updating...'; }

        try {
          const res = await global.FeedOmeterAuth.resetPassword(token, newPass);
          if (succEl) {
            succEl.textContent = 'Password reset successfully! Signing in...';
            succEl.style.display = 'block';
          }
          setTimeout(() => {
            hideAuthModal();
          }, 600);
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message;
            errEl.style.display = 'block';
          }
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Update Password & Sign In'; }
        }
      });
    }

    // Add Feed Form
    const addFeedForm = document.getElementById('add-feed-form');
    if (addFeedForm) {
      addFeedForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const feedUrl = document.getElementById('feed-url-input').value.trim();
        const title = document.getElementById('feed-title-input').value.trim() || 'Feed';
        const category = document.getElementById('feed-category-input').value.trim() || 'general';
        const folderId = document.getElementById('feed-folder-select').value || null;

        const res = await api('/api/subscriptions', {
          method: 'POST',
          body: JSON.stringify({ feed_url: feedUrl, title, category, folder_id: folderId })
        });

        if (res.ok) {
          document.getElementById('add-feed-modal').style.display = 'none';
          addFeedForm.reset();
          loadFolders();
          loadStream(true);
        } else {
          alert(res.data.message || 'Failed to add feed');
        }
      });
    }

    // Add Folder Form
    const addFolderForm = document.getElementById('add-folder-form');
    if (addFolderForm) {
      addFolderForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('folder-name-input').value.trim();
        const icon = document.getElementById('folder-icon-input').value.trim() || '📁';
        const parentId = document.getElementById('folder-parent-select').value || null;

        const res = await api('/api/folders', {
          method: 'POST',
          body: JSON.stringify({ name, icon, parent_folder_id: parentId })
        });

        if (res.ok) {
          document.getElementById('add-folder-modal').style.display = 'none';
          addFolderForm.reset();
          loadFolders();
        } else {
          alert(res.data.message || 'Failed to create folder');
        }
      });
    }
  }

  function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if (e.key === 'Escape') {
        closeReadingModal();
        return;
      }

      const filtered = getSortedAndFilteredArticles();
      if (filtered.length === 0) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        navigateArticle(1, filtered);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        navigateArticle(-1, filtered);
      } else if (e.key === 's' && state.selectedArticle) {
        toggleStar(state.selectedArticle.id);
      } else if (e.key === 'o' && state.selectedArticle && state.selectedArticle.link) {
        window.open(state.selectedArticle.link, '_blank', 'noopener,noreferrer');
      }
    });
  }

  function navigateArticle(direction, list) {
    const articlesList = list || getSortedAndFilteredArticles();
    if (articlesList.length === 0) return;
    let currIdx = state.selectedArticle ? articlesList.findIndex(a => a.id === state.selectedArticle.id) : -1;
    let nextIdx = currIdx + direction;
    if (nextIdx >= 0 && nextIdx < articlesList.length) {
      openReadingModal(articlesList[nextIdx]);
      const cardEl = document.querySelector(`[data-index="${nextIdx}"]`);
      if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // Self Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(typeof window !== 'undefined' ? window : this);
