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
    return (typeof window !== 'undefined' && window.FEEDOMETER_API_BASE) ? window.FEEDOMETER_API_BASE : '';
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
    searchQuery: '',
    foldersExpanded: false
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

  // Update Starred and Read Later counts in the sidebar
  async function updateSidebarCounts() {
    const starredBadge = document.getElementById('badge-starred-count');
    const savedBadge = document.getElementById('badge-saved-count');

    // 1. Check cached / user profile values immediately for instant feedback
    try {
      const user = global.FeedOmeterAuth ? global.FeedOmeterAuth.getUser() : null;
      let starredCount = localStorage.getItem('feedometer_cached_starred_count');
      if (starredCount === null && user && (user.starred_count != null || user.starredCount != null)) {
        starredCount = user.starred_count != null ? user.starred_count : user.starredCount;
      }
      if (starredCount !== null && starredBadge) {
        starredBadge.textContent = String(starredCount);
      }

      let savedCount = localStorage.getItem('feedometer_cached_read_later_count');
      if (savedCount === null && user && (user.saved_count != null || user.savedCount != null)) {
        savedCount = user.saved_count != null ? user.saved_count : user.savedCount;
      }
      if (savedCount !== null && savedBadge) {
        savedBadge.textContent = String(savedCount);
      }
    } catch (e) {}

    // 2. Fetch fresh counts if authenticated
    if (global.FeedOmeterAuth && typeof global.FeedOmeterAuth.isAuthenticated === 'function' && global.FeedOmeterAuth.isAuthenticated()) {
      if (typeof global.FeedOmeterAuth.getStarredArticles === 'function') {
        global.FeedOmeterAuth.getStarredArticles().then(d => {
          if (d) {
            const count = (d.total != null ? d.total : (d.count != null ? d.count : (Array.isArray(d.items) ? d.items.length : (Array.isArray(d.articles) ? d.articles.length : null))));
            if (count != null) {
              localStorage.setItem('feedometer_cached_starred_count', String(count));
              if (starredBadge) starredBadge.textContent = String(count);
            }
          }
        }).catch(() => {});
      }

      if (typeof global.FeedOmeterAuth.getSavedArticles === 'function') {
        global.FeedOmeterAuth.getSavedArticles().then(d => {
          if (d) {
            const count = (d.total != null ? d.total : (d.count != null ? d.count : (Array.isArray(d.items) ? d.items.length : (Array.isArray(d.articles) ? d.articles.length : null))));
            if (count != null) {
              localStorage.setItem('feedometer_cached_read_later_count', String(count));
              if (savedBadge) savedBadge.textContent = String(count);
            }
          }
        }).catch(() => {});
      }
    }
  }

  // Initialize
  async function init() {
    setupEventListeners();
    setupKeyboardShortcuts();
    updateSidebarCounts();

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
      updateSidebarCounts();
    });

    window.addEventListener('feedometer:starred-changed', updateSidebarCounts);
    window.addEventListener('feedometer:saved-changed', updateSidebarCounts);

    // Reactive Watchlists / Folders event listeners
    document.addEventListener('watchlists-changed', () => loadFolders());
    document.addEventListener('rss-feeds-updated', () => loadFolders());
    window.addEventListener('message', (e) => {
      if (e.data && (e.data.type === 'watchlists-changed' || e.data.type === 'rss-feeds-updated')) {
        loadFolders();
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
    updateSidebarCounts();
    
    // Check if user arrived targeting a specific folder (?folder=id)
    const urlParams = new URLSearchParams(window.location.search);
    const folderParam = urlParams.get('folder');
    if (folderParam) {
      if (window.WatchlistsAPI) {
        window.WatchlistsAPI.getFolder(folderParam).then(f => {
          if (f) switchStreamContext('folder', f.id, f.name);
          else switchStreamContext('folder', folderParam, 'Folder');
        }).catch(() => {
          switchStreamContext('folder', folderParam, 'Folder');
        });
      } else {
        switchStreamContext('folder', folderParam, 'Folder');
      }
    } else {
      loadStream(true);
    }

    // Pre-warm Starred & Saved caches 2s after login so tab switches are instant
    setTimeout(prewarmStreamCache, 2000);
  }

  function handleUnauthenticated() {
    state.user = null;
    state.articles = [];
    state.folders = [];
    state.folderTree = [];
    state.selectedArticle = null;
    renderSidebarTree();
    renderStreamCards();
    renderArticleDetail(null);
    showAuthModal('login');
  }

  // ── 1. Folders & Subscriptions ──
  async function loadFolders() {
    if (window.WatchlistsAPI) {
      try {
        const tree = await window.WatchlistsAPI.loadFolderTree();
        state.folderTree = tree || [];
        state.folders = await window.WatchlistsAPI.loadFolders();
        renderSidebarTree();
        return;
      } catch (e) {
        console.warn('WatchlistsAPI loadFolders error, falling back to backend API', e);
      }
    }
    const res = await api('/api/folders');
    if (res.ok && res.data.folders) {
      state.folders = res.data.folders;
      state.folderTree = res.data.folders;
      renderSidebarTree();
    }
  }

  async function loadSubscriptions() {
    const res = await api('/api/feeds/subscriptions');
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
    let clean = String(summary).replace(/<[^>]*>/g, ' ');
    clean = decodeEntities(clean);
    clean = clean.replace(/\s+/g, ' ').trim();
    if (title) {
      const cleanTitle = String(title).replace(/\s+/g, ' ').trim();
      if (clean.toLowerCase() === cleanTitle.toLowerCase()) return '';
      if (clean.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
        clean = clean.substring(cleanTitle.length).replace(/^[\s\-–—:|]+/, '').trim();
      }
    }
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

  function toggleFoldersCollapse(forcedState) {
    state.foldersExpanded = typeof forcedState === 'boolean' ? forcedState : !state.foldersExpanded;
    const coll = document.getElementById('sidebar-folders-collapsible');
    const chevron = document.getElementById('folders-chevron');
    if (coll) coll.style.display = state.foldersExpanded ? 'block' : 'none';
    if (chevron) {
      chevron.style.transform = state.foldersExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
    }
  }

  function flattenFolders(nodes, depth, list) {
    if (typeof depth !== 'number') depth = 0;
    if (!list) list = [];
    if (!Array.isArray(nodes)) return list;
    nodes.forEach(node => {
      if (node.type === 'folder' || !node.type) {
        list.push({ id: node.id, name: node.name, depth: depth });
        if (node.children && node.children.length > 0) {
          const childFolders = node.children.filter(c => c.type === 'folder');
          flattenFolders(childFolders, depth + 1, list);
        }
      }
    });
    return list;
  }

  function showInlineFolderCreator(preselectedParentId) {
    // Ensure folders section is expanded when creating a folder
    toggleFoldersCollapse(true);

    const container = document.getElementById('sidebar-inline-folder-container');
    if (!container) return;

    if (container.style.display !== 'none' && !preselectedParentId) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    const flat = flattenFolders(state.folderTree || state.folders || []);
    const isSub = Boolean(preselectedParentId);

    container.innerHTML = `
      <div class="sidebar-inline-folder-box">
        <input type="text" id="sidebar-inline-folder-input" class="sidebar-inline-input" placeholder="${isSub ? 'Subfolder name...' : 'New folder name...'}" maxlength="50" autocomplete="off">
        <div class="sidebar-inline-actions">
          <select id="sidebar-inline-parent-select" class="sidebar-inline-select" title="Select Parent (Optional for Subfolder)">
            <option value="">(Top Level Folder)</option>
            ${flat.map(f => {
              const prefix = f.depth > 0 ? '&nbsp;&nbsp;'.repeat(f.depth) + '↳ ' : '';
              return `<option value="${escapeHtml(f.id)}" ${f.id === preselectedParentId ? 'selected' : ''}>${prefix}${escapeHtml(f.name)}</option>`;
            }).join('')}
          </select>
          <button type="button" id="sidebar-inline-confirm-btn" class="sidebar-inline-btn confirm" title="Create Folder">✓</button>
          <button type="button" id="sidebar-inline-cancel-btn" class="sidebar-inline-btn cancel" title="Cancel">✕</button>
        </div>
      </div>
    `;

    container.style.display = 'block';

    const input = document.getElementById('sidebar-inline-folder-input');
    const select = document.getElementById('sidebar-inline-parent-select');
    const btnConfirm = document.getElementById('sidebar-inline-confirm-btn');
    const btnCancel = document.getElementById('sidebar-inline-cancel-btn');

    if (input) {
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doCreate();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          container.style.display = 'none';
          container.innerHTML = '';
        }
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        container.style.display = 'none';
        container.innerHTML = '';
      });
    }

    async function doCreate() {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      const parentId = select.value || null;
      if (btnConfirm) { btnConfirm.disabled = true; btnConfirm.textContent = '...'; }

      if (window.WatchlistsAPI) {
        try {
          await window.WatchlistsAPI.createFolder(name, parentId);
          container.style.display = 'none';
          container.innerHTML = '';
          await loadFolders();
          return;
        } catch (e) {
          console.warn('WatchlistsAPI createFolder error', e);
        }
      }

      const res = await api('/api/folders', {
        method: 'POST',
        body: JSON.stringify({ name: name, icon: '📁', parent_folder_id: parentId })
      });

      container.style.display = 'none';
      container.innerHTML = '';
      if (res.ok) {
        await loadFolders();
      } else {
        alert(res.data.message || 'Failed to create folder');
      }
    }

    if (btnConfirm) {
      btnConfirm.addEventListener('click', doCreate);
    }
  }

  function renderSidebarTree() {
    const container = document.getElementById('sidebar-folder-tree');
    if (!container) return;

    // Sync collapsible display
    toggleFoldersCollapse(state.foldersExpanded);

    const tree = (state.folderTree && state.folderTree.length > 0) ? state.folderTree : (state.folders || []);

    function renderNodes(nodes, depth) {
      if (typeof depth !== 'number') depth = 0;
      let html = '';
      nodes.forEach(node => {
        if (node.type === 'folder' || !node.type) {
          const isActive = (state.currentTab === 'watchlists-folder' || state.currentTab === 'folder') && state.activeFolderId === node.id;
          const count = node.totalFeedCount !== undefined ? node.totalFeedCount : (node.directFeedCount !== undefined ? node.directFeedCount : (node.feedCount || 0));
          const paddingLeft = depth > 0 ? `${0.55 + depth * 0.85}rem` : '0.55rem';
          html += `
            <div class="sidebar-folder-item ${isActive ? 'active' : ''}" data-folder-id="${escapeHtml(node.id)}" data-folder-name="${escapeHtml(node.name)}" style="padding-left: ${paddingLeft};">
              <div class="folder-label-group">
                <span class="folder-icon">📁</span>
                <span class="folder-name-text">${escapeHtml(node.name)}</span>
              </div>
              <span class="sidebar-folder-add-sub" data-add-sub="${escapeHtml(node.id)}" title="Add Subfolder inside ${escapeHtml(node.name)}">+</span>
              <span class="nav-badge">${count}</span>
            </div>
          `;
          if (node.children && node.children.length > 0) {
            const childFolders = node.children.filter(c => c.type === 'folder');
            if (childFolders.length > 0) {
              html += renderNodes(childFolders, depth + 1);
            }
          }
        }
      });
      return html;
    }

    let innerHtml = '';
    if (tree && tree.length > 0) {
      innerHtml += renderNodes(tree, 0);
    }

    // Always render the "+ New Folder" button at the bottom
    innerHtml += `
      <button type="button" class="sidebar-new-folder-btn" id="btn-sidebar-new-folder" title="Create New Folder">
        <span style="font-weight: 700; font-size: 13px;">+</span>
        <span>New Folder</span>
      </button>
    `;

    container.innerHTML = innerHtml;

    // Attach folder row click handlers -> switches to watchlists-folder view
    container.querySelectorAll('.sidebar-folder-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-add-sub]')) return;
        const id = el.getAttribute('data-folder-id');
        const name = el.getAttribute('data-folder-name') || 'Folder';
        switchStreamContext('watchlists-folder', id, name);
      });
    });

    // Attach Add Subfolder "+" button handlers
    container.querySelectorAll('[data-add-sub]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const parentFolderId = btn.getAttribute('data-add-sub');
        showInlineFolderCreator(parentFolderId);
      });
    });

    // Attach "+ New Folder" bottom button handler
    const btnNewFolder = document.getElementById('btn-sidebar-new-folder');
    if (btnNewFolder) {
      btnNewFolder.addEventListener('click', (e) => {
        e.stopPropagation();
        showInlineFolderCreator(null);
      });
    }
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

  // ── Standalone RSS Feed Reader Engine (Embedded in One Stop Reader) ──
  const SAMPLE_FEEDS = {
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
  };

  const PRESET_FEEDS_BACKUP = {
    verge: {
      title: 'The Verge',
      items: [
        { id: 'v1', title: 'OpenAI announces next-generation reasoning model architecture', link: 'https://www.theverge.com', summary: 'New algorithmic improvements push benchmark scores to new heights in software engineering and logic.', published: new Date().toISOString(), source_title: 'The Verge', image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600' },
        { id: 'v2', title: 'The next era of web performance and distributed edge computing', link: 'https://www.theverge.com', summary: 'Global edge clusters offer sub-millisecond cold starts for serverless worker functions.', published: new Date().toISOString(), source_title: 'The Verge', image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600' }
      ]
    },
    bbc: {
      title: 'BBC News',
      items: [
        { id: 'b1', title: 'Global Climate Summit announces landmark clean energy pact', link: 'https://www.bbc.com/news', summary: 'Over 80 nations commit to doubling renewable investments over the next decade.', published: new Date().toISOString(), source_title: 'BBC News', image: 'https://images.unsplash.com/photo-1509391365360-2e959784a276?w=600' },
        { id: 'b2', title: 'Deep ocean exploration discovers new hydrothermal ecosystems', link: 'https://www.bbc.com/news', summary: 'Marine scientists document unique lifeforms thriving near volcanic seafloor vents.', published: new Date().toISOString(), source_title: 'BBC News', image: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600' }
      ]
    },
    science: {
      title: 'ScienceDaily',
      items: [
        { id: 's1', title: 'Quantum sensors achieve atomic precision in room temperature tests', link: 'https://www.sciencedaily.com', summary: 'Physicists develop synthetic diamond defect sensors capable of measuring nanotesla fields.', published: new Date().toISOString(), source_title: 'ScienceDaily', image: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=600' }
      ]
    },
    nasa: {
      title: 'NASA Breaking News',
      items: [
        { id: 'n1', title: 'James Webb Telescope observes ancient stellar nurseries in deep space', link: 'https://www.nasa.gov', summary: 'Infrared surveys capture the earliest stages of galaxy cluster formation.', published: new Date().toISOString(), source_title: 'NASA', image: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600' }
      ]
    }
  };

  function parseClientSideXml(xmlStr, feedUrl) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlStr, 'text/xml');
      const parseError = doc.querySelector('parsererror');
      if (parseError) return null;

      let feedTitle = '';
      const items = [];

      const channel = doc.querySelector('channel');
      if (channel) {
        feedTitle = channel.querySelector('title') ? channel.querySelector('title').textContent : '';
        const itemNodes = channel.querySelectorAll('item');
        itemNodes.forEach(item => {
          const title = item.querySelector('title') ? item.querySelector('title').textContent : 'Untitled';
          const link = item.querySelector('link') ? item.querySelector('link').textContent : '';
          const descNode = item.querySelector('description');
          const encodedNode = item.querySelector('content\\:encoded') || item.querySelector('encoded');
          const desc = descNode ? descNode.textContent : (encodedNode ? encodedNode.textContent : '');
          const pubDate = item.querySelector('pubDate') ? item.querySelector('pubDate').textContent : (item.querySelector('dc\\:date') ? item.querySelector('dc\\:date').textContent : '');
          let image = '';
          if (window.FeedImaging && typeof window.FeedImaging.extractImage === 'function') {
            image = window.FeedImaging.extractImage(item, link, desc);
          } else {
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
                }
              }
            }
          }
          if (image && window.FeedImaging && typeof window.FeedImaging.upgradeUrl === 'function') {
            image = window.FeedImaging.upgradeUrl(image);
          }
          if (title || link) {
            items.push({
              id: link || String(Math.random()),
              title: decodeEntities(title),
              link,
              url: link,
              summary: desc,
              description: desc,
              published: pubDate,
              pubDate,
              image,
              image_url: image,
              source_title: feedTitle
            });
          }
        });
      } else {
        const feedNode = doc.querySelector('feed');
        if (feedNode) {
          feedTitle = feedNode.querySelector('title') ? feedNode.querySelector('title').textContent : '';
          const entryNodes = feedNode.querySelectorAll('entry');
          entryNodes.forEach(entry => {
            const title = entry.querySelector('title') ? entry.querySelector('title').textContent : 'Untitled';
            const linkNode = entry.querySelector('link[rel="alternate"]') || entry.querySelector('link');
            const link = linkNode ? linkNode.getAttribute('href') : '';
            const summaryNode = entry.querySelector('summary') || entry.querySelector('content');
            const desc = summaryNode ? summaryNode.textContent : '';
            const pubDate = entry.querySelector('published') ? entry.querySelector('published').textContent : (entry.querySelector('updated') ? entry.querySelector('updated').textContent : '');
            let image = '';
            if (window.FeedImaging && typeof window.FeedImaging.extractImage === 'function') {
              image = window.FeedImaging.extractImage(entry, link, desc);
            } else {
              const mediaContent = entry.querySelector('media\\:content');
              if (mediaContent && mediaContent.getAttribute('url')) {
                image = mediaContent.getAttribute('url');
              }
            }
            if (image && window.FeedImaging && typeof window.FeedImaging.upgradeUrl === 'function') {
              image = window.FeedImaging.upgradeUrl(image);
            }
            if (title || link) {
              items.push({
                id: link || String(Math.random()),
                title: decodeEntities(title),
                link,
                url: link,
                summary: desc,
                description: desc,
                published: pubDate,
                pubDate,
                image,
                image_url: image,
                source_title: feedTitle
              });
            }
          });
        }
      }

      if (items.length > 0) {
        return {
          feedTitle: feedTitle || 'RSS Feed',
          items
        };
      }
    } catch (_) {}
    return null;
  }

  // Global helper for capsule selection
  global.selectRssSampleFeed = function(feedKey) {
    const url = SAMPLE_FEEDS[feedKey];
    const input = document.getElementById('rss-feed-url-input');
    if (input && url) {
      input.value = url;
      input.focus();
    }
    document.querySelectorAll('#rss-sample-feeds-carousel .sample-pill').forEach(p => {
      p.classList.toggle('active-selected', p.getAttribute('data-feed') === feedKey);
    });
  };

  let rssCurrentItems = [];
  let rssViewMode = 'list';
  let rssSearchQuery = '';

  function showRssHeroState() {
    const heroState = document.getElementById('rss-hero-state');
    const readerPanel = document.getElementById('rss-reader-panel');
    const spinner = document.getElementById('rss-loading-spinner');
    const errEl = document.getElementById('rss-error-container');
    if (heroState) heroState.style.display = 'flex';
    if (readerPanel) readerPanel.style.display = 'none';
    if (spinner) spinner.style.display = 'none';
    if (errEl) errEl.style.display = 'none';
  }

  function showRssReaderPanel() {
    const heroState = document.getElementById('rss-hero-state');
    const readerPanel = document.getElementById('rss-reader-panel');
    const spinner = document.getElementById('rss-loading-spinner');
    if (heroState) heroState.style.display = 'none';
    if (readerPanel) readerPanel.style.display = 'flex';
    if (spinner) spinner.style.display = 'none';
  }

  function setRssViewMode(mode) {
    rssViewMode = mode;
    const btnList = document.getElementById('rss-view-list-btn');
    const btnGrid = document.getElementById('rss-view-grid-btn');
    const container = document.getElementById('rss-cards-container');
    if (btnList && btnGrid && container) {
      btnList.classList.toggle('active', mode === 'list');
      btnGrid.classList.toggle('active', mode === 'grid');
      container.className = mode === 'grid' ? 'cards-grid' : 'cards-list';
    }
    renderRssCards();
  }

  function renderRssCards() {
    const container = document.getElementById('rss-cards-container');
    if (!container) return;

    let items = [...rssCurrentItems];
    if (rssSearchQuery) {
      const q = rssSearchQuery.toLowerCase();
      items = items.filter(a => 
        (a.title && a.title.toLowerCase().includes(q)) ||
        (a.snippet && a.snippet.toLowerCase().includes(q)) ||
        (a.summary && a.summary.toLowerCase().includes(q)) ||
        (a.source_title && a.source_title.toLowerCase().includes(q))
      );
    }

    if (items.length === 0) {
      container.innerHTML = `
        <div class="reader-empty-state" style="grid-column: 1 / -1; padding: 3rem 1.5rem; text-align: center; color: #64748b;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">📭</div>
          <p style="font-weight: 700; color: #0f172a; font-size: 1rem;">No matching stories found</p>
          <p style="font-size: 0.85rem; color: #64748b; margin-top: 0.25rem;">Try adjusting your headline search query.</p>
        </div>
      `;
      return;
    }

    const isGrid = rssViewMode === 'grid';
    container.className = isGrid ? 'cards-grid' : 'cards-list';

    let html = '';
    items.forEach((art, idx) => {
      const isStarred = Boolean(art.is_starred);
      const isSaved = Boolean(art.is_saved);
      const link = art.link || art.url || '#';
      const title = art.title || 'Untitled Article';
      const snippet = cleanSnippet(title, art.summary || art.description || art.snippet || '');
      const sourceName = art.source?.title || art.source_title || (typeof art.source === 'string' ? art.source : 'RSS');
      const sourceIcon = art.source?.logo_url || art.sourceIcon || (link && link !== '#' ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(link)}&sz=32` : '');
      const dateStr = formatArticleDate(art.published || art.pubDate);
      const rawImg = art.image || art.image_url || art.thumbnail || '';
      const image = (window.FeedImaging && typeof window.FeedImaging.upgradeUrl === 'function')
        ? window.FeedImaging.upgradeUrl(rawImg)
        : rawImg;

      if (isGrid) {
        const mediaHtml = (window.FeedImaging && typeof window.FeedImaging.renderMedia === 'function')
          ? window.FeedImaging.renderMedia(art, { className: 'article-card-img', fallbackClass: 'article-card-fallback' })
          : (image ? `<img class="article-card-img" src="${escapeHtml(image)}" alt="" loading="lazy" onerror="this.parentNode.innerHTML='<div class=\\'article-card-fallback\\'>${escapeHtml(sourceName.charAt(0).toUpperCase() || 'N')}</div>'" />` : `<div class="article-card-fallback">${escapeHtml(sourceName.charAt(0).toUpperCase() || 'N')}</div>`);

        html += `
          <div class="article-card" data-article-id="${escapeHtml(art.id)}" data-index="${idx}">
            <div class="article-card-media">
              ${mediaHtml}
            </div>
            <div class="article-source-row">
              <span class="article-source-badge">
                ${sourceIcon ? `<img src="${escapeHtml(sourceIcon)}" class="source-favicon" alt="" onerror="this.style.display='none'">` : ''}
                ${escapeHtml(sourceName)}
              </span>
              <span>${escapeHtml(dateStr)}</span>
            </div>
            <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" class="article-title">${escapeHtml(title)}</a>
            ${snippet ? `<p class="article-snippet">${escapeHtml(snippet)}</p>` : ''}
            <div class="article-card-actions">
              <div style="display: flex; gap: 0.25rem;">
                <button type="button" class="action-icon-btn ${isStarred ? 'active-star' : ''}" data-rss-action="star" data-index="${idx}" title="${isStarred ? 'Unstar' : 'Star'}">${isStarred ? '★' : '☆'}</button>
                <button type="button" class="action-icon-btn ${isSaved ? 'active-bookmark' : ''}" data-rss-action="save" data-index="${idx}" title="${isSaved ? 'Saved' : 'Read Later'}">${isSaved ? '🔖' : '📑'}</button>
              </div>
              <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" class="action-icon-btn" title="Open Original">↗</a>
            </div>
          </div>
        `;
      } else {
        html += `
          <article class="modern-card" data-article-id="${escapeHtml(art.id)}" data-index="${idx}">
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
                  <button type="button" class="card-icon-btn ${isStarred ? 'active-star' : ''}" data-rss-action="star" data-index="${idx}" title="${isStarred ? 'Unstar' : 'Star'}">
                    ${isStarred ? '⭐' : '☆'}
                  </button>
                  <button type="button" class="card-icon-btn ${isSaved ? 'active-save' : ''}" data-rss-action="save" data-index="${idx}" title="${isSaved ? 'Saved' : 'Read Later'}">
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

    container.innerHTML = html;

    if (window.FeedImaging && typeof window.FeedImaging.enhanceImages === 'function') {
      window.FeedImaging.enhanceImages(container);
    } else if (window.SmartCrop && typeof window.SmartCrop.applyAll === 'function') {
      window.SmartCrop.applyAll(container);
    }

    // Attach card clicks to open Reading Modal
    container.querySelectorAll('.article-card, .modern-card').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-rss-action]') || e.target.closest('a')) return;
        const idx = Number(el.getAttribute('data-index'));
        const art = items[idx];
        if (art) openReadingModal(art);
      });
    });

    // Star & Save actions
    container.querySelectorAll('[data-rss-action="star"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-index'));
        const art = items[idx];
        if (art) {
          art.is_starred = !art.is_starred;
          renderRssCards();
        }
      });
    });

    container.querySelectorAll('[data-rss-action="save"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-index'));
        const art = items[idx];
        if (art) {
          art.is_saved = !art.is_saved;
          renderRssCards();
        }
      });
    });
  }

  // Fetch RSS Feed from API with multi-stage resilient fallbacks
  async function fetchRssFeed(rawUrl, sampleKey = null) {
    let url = String(rawUrl || '').trim();
    if (!url && sampleKey && SAMPLE_FEEDS[sampleKey]) {
      url = SAMPLE_FEEDS[sampleKey];
    }
    if (!url) return;

    // Update input UI
    const inputEl = document.getElementById('rss-feed-url-input');
    if (inputEl) inputEl.value = url;

    // Highlight sample pill if matching
    document.querySelectorAll('#rss-sample-feeds-carousel .sample-pill').forEach(pill => {
      const pKey = pill.getAttribute('data-feed');
      const pUrl = SAMPLE_FEEDS[pKey];
      const isMatch = (sampleKey && pKey === sampleKey) || (pUrl && pUrl.toLowerCase() === url.toLowerCase());
      pill.classList.toggle('active-selected', Boolean(isMatch));
    });

    const spinner = document.getElementById('rss-loading-spinner');
    const errEl = document.getElementById('rss-error-container');
    if (spinner) spinner.style.display = 'flex';
    if (errEl) errEl.style.display = 'none';

    let feedTitle = 'RSS Feed';
    let items = [];

    // Stage 1: Call /api/view?url=...
    try {
      const res = await api(`/api/view?url=${encodeURIComponent(url)}`);
      if (res.ok && res.data && Array.isArray(res.data.items) && res.data.items.length > 0) {
        feedTitle = res.data.meta?.title || res.data.title || 'RSS Feed';
        items = res.data.items.map(normalizeStreamItem);
      }
    } catch (_) {}

    // Stage 2: Direct public CORS bridges if local API was unreachable
    if (items.length === 0) {
      const bridges = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`
      ];
      for (const bridge of bridges) {
        try {
          const bRes = await fetch(bridge, { signal: AbortSignal.timeout(6000) });
          if (bRes.ok) {
            const bText = await bRes.text();
            const parsed = parseClientSideXml(bText, url);
            if (parsed && parsed.items.length > 0) {
              feedTitle = parsed.feedTitle;
              items = parsed.items;
              break;
            }
          }
        } catch (_) {}
      }
    }

    // Stage 3: Backup presets for offline / instant demo
    if (items.length === 0) {
      const backupKey = sampleKey || Object.keys(SAMPLE_FEEDS).find(k => SAMPLE_FEEDS[k] === url);
      if (backupKey && PRESET_FEEDS_BACKUP[backupKey]) {
        const backup = PRESET_FEEDS_BACKUP[backupKey];
        feedTitle = backup.title;
        items = backup.items.map(normalizeStreamItem);
      }
    }

    if (spinner) spinner.style.display = 'none';

    if (items.length > 0) {
      items.forEach(it => {
        if (!it.source_title || it.source_title === 'RSS') it.source_title = feedTitle;
        if (it.source && (!it.source.title || it.source.title === 'RSS')) it.source.title = feedTitle;
      });

      rssCurrentItems = items;
      rssSearchQuery = '';

      const titleEl = document.getElementById('rss-feed-title');
      const countEl = document.getElementById('rss-feed-count-badge');
      const searchInput = document.getElementById('rss-feed-search-input');
      if (titleEl) titleEl.textContent = feedTitle;
      if (countEl) countEl.textContent = `${items.length} stories`;
      if (searchInput) searchInput.value = '';

      showRssReaderPanel();
      renderRssCards();
    } else {
      if (errEl) {
        errEl.textContent = 'Could not load or parse the specified RSS feed. Please check the URL.';
        errEl.style.display = 'block';
      }
    }
  }

  // ── 2. Stream Engine & Feed Fusion (Standard Stream Tabs) ──
  async function loadFolderArticles(folderId) {
    if (!window.WatchlistsAPI) return [];
    try {
      const feeds = await window.WatchlistsAPI.getFolderFeeds(folderId);
      if (!feeds || feeds.length === 0) return [];

      const fetchPromises = feeds.slice(0, 15).map(async (f) => {
        try {
          const url = f.feedUrl || f.url;
          if (!url) return [];
          const res = await api(`/api/view?url=${encodeURIComponent(url)}`);
          if (res.ok && res.data && Array.isArray(res.data.items)) {
            return res.data.items.map(it => {
              const norm = normalizeStreamItem(it);
              if (!norm.source_title || norm.source_title === 'RSS') {
                norm.source_title = f.title || norm.source_title;
              }
              return norm;
            });
          }
        } catch (_) {}
        return [];
      });

      const results = await Promise.allSettled(fetchPromises);
      let allItems = [];
      results.forEach(r => {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
          allItems = allItems.concat(r.value);
        }
      });

      const seen = new Set();
      const deduped = [];
      allItems.forEach(item => {
        const key = item.link || item.url || item.id;
        if (key && !seen.has(key)) {
          seen.add(key);
          deduped.push(item);
        }
      });

      deduped.sort((a, b) => {
        const tA = a.published ? new Date(a.published).getTime() : 0;
        const tB = b.published ? new Date(b.published).getTime() : 0;
        return tB - tA;
      });

      return deduped;
    } catch (e) {
      console.warn('loadFolderArticles error', e);
      return [];
    }
  }

  async function loadStream(reset = false, options = {}) {
    if (state.currentTab === 'rss-reader') {
      return;
    }

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

    // Direct folder loading via WatchlistsAPI feeds
    if (state.currentTab === 'folder' && state.activeFolderId && window.WatchlistsAPI) {
      try {
        const folderArticles = await loadFolderArticles(state.activeFolderId);
        if (!silent) {
          state.isLoading = false;
          renderStreamLoading(false);
        }
        const snapshot = {
          articles: folderArticles,
          cursor: null,
          hasMore: false
        };
        writeStreamCache(requestKey, snapshot);
        if (fetchGen !== streamFetchGen && silent) return;
        if (streamCacheKey() !== requestKey) return;
        applyStreamSnapshot(snapshot, { selectFirst: reset && !silent });
        if (!silent && container) {
          requestAnimationFrame(() => container.classList.remove('is-switching'));
        }
        return;
      } catch (err) {
        console.warn('loadFolderArticles error, falling back to stream endpoint', err);
      }
    }

    let endpoint = '/api/stream?limit=25';
    if (state.currentTab === 'folder' && state.activeFolderId) {
      endpoint = `/api/stream?folder_id=${state.activeFolderId}&limit=25`;
    }

    if (state.cursor && !reset) {
      endpoint += `&cursor=${encodeURIComponent(state.cursor)}`;
    }

    try {
      const res = await api(endpoint);
      if (!silent) {
        state.isLoading = false;
        renderStreamLoading(false);
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

  // ── Dedicated Starred Articles Page View Logic ──
  let starredListArticles = [];

  async function loadStarredView() {
    const grid = document.getElementById('starred-grid');
    if (!grid) return;
    if (!global.FeedOmeterAuth || !global.FeedOmeterAuth.isAuthenticated()) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #64748b;">Sign in to see starred articles.</div>';
      return;
    }
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #64748b;">Loading your bookmarks...</div>';
    try {
      const json = await global.FeedOmeterAuth.getStarredArticles();
      const raw = json.items || [];
      starredListArticles = raw.map(function (a) {
        return {
          id: a.id,
          title: a.title || 'Untitled Bookmark',
          url: a.url || a.link || '#',
          snippet: a.snippet || a.summary || a.description || '',
          content: a.content || '',
          sourceTitle: a.source_title || (a.source && a.source.title) || 'Feed',
          published: a.published_at || a.published || a.pubDate,
          image: a.image_url || a.image || a.thumbnail || '',
          image_url: a.image_url || a.image || a.thumbnail || ''
        };
      });
      renderStarredView();
      const sbEl = document.getElementById('badge-starred-count');
      if (sbEl) sbEl.textContent = String(starredListArticles.length);
      try { localStorage.setItem('feedometer_cached_starred_count', String(starredListArticles.length)); } catch (_) {}
    } catch (e) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #ef4444;">Failed to load bookmarks.</div>';
    }
  }

  function renderStarredView() {
    const grid = document.getElementById('starred-grid');
    if (!grid) return;
    if (starredListArticles.length === 0) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #64748b;">No starred bookmarks found. Star any story using the ★ button!</div>';
      return;
    }

    grid.innerHTML = starredListArticles.map((a) => {
      const title = a.title || 'Untitled Bookmark';
      const snippet = a.snippet || a.summary || a.description || '';
      const source = a.sourceTitle || 'Feed';
      const dateStr = a.published ? new Date(a.published).toLocaleDateString() : '';

      const mediaHtml = (window.FeedImaging && typeof window.FeedImaging.renderMedia === 'function')
        ? window.FeedImaging.renderMedia(a, { className: 'article-card-img', fallbackClass: 'article-card-fallback' })
        : (a.image ? `<img class="article-card-img" src="${escapeHtml(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<div class="article-card-fallback">${escapeHtml(source.charAt(0).toUpperCase() || 'F')}</div>`);

      return `
        <div class="article-card" data-article-id="${escapeHtml(a.id)}">
          <div class="article-card-media">
            ${mediaHtml}
          </div>
          <div class="article-source-row">
            <span class="article-source-badge">${escapeHtml(source)}</span>
            <span>${escapeHtml(dateStr)}</span>
          </div>
          <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer" class="article-title">${escapeHtml(title)}</a>
          <p class="article-snippet">${escapeHtml(snippet)}</p>
          <div class="article-card-actions">
            <button type="button" class="dedicated-btn-danger" onclick="window.removeStarredArticle && window.removeStarredArticle('${escapeHtml(a.id)}')">
              Remove Star
            </button>
            <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer" class="action-icon-btn" title="Open Article">↗</a>
          </div>
        </div>
      `;
    }).join('');

    if (window.SmartCrop && typeof window.SmartCrop.applyAll === 'function') {
      window.SmartCrop.applyAll(grid);
    }
  }

  async function removeStarredArticle(id) {
    const article = starredListArticles.find(a => a.id === id);
    try {
      if (global.FeedOmeterAuth) {
        await global.FeedOmeterAuth.unstarArticle(id, article && article.url);
      }
      starredListArticles = starredListArticles.filter(a => a.id !== id);
      renderStarredView();
      const sbEl = document.getElementById('badge-starred-count');
      if (sbEl) sbEl.textContent = String(starredListArticles.length);
      try { localStorage.setItem('feedometer_cached_starred_count', String(starredListArticles.length)); } catch (_) {}
    } catch (e) {
      alert(e.message || 'Could not remove star');
    }
  }

  function exportStarredArticles() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(starredListArticles, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "feedometer_bookmarks.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  // ── Dedicated Read Later Queue Page View Logic ──
  let queueListArticles = [];

  async function loadReadLaterView() {
    const grid = document.getElementById('read-later-grid');
    if (!grid) return;
    if (!global.FeedOmeterAuth || !global.FeedOmeterAuth.isAuthenticated()) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #64748b;">Sign in to see your reading queue.</div>';
      return;
    }
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #64748b;">🔖 Loading your reading queue...</div>';
    try {
      const json = await global.FeedOmeterAuth.getSavedArticles();
      const raw = json.items || [];
      queueListArticles = raw.map(function (a) {
        return {
          id: a.id,
          title: a.title || 'Untitled Queue Item',
          url: a.url || a.link || '#',
          snippet: a.snippet || a.summary || a.description || '',
          sourceTitle: a.source_title || (a.source && a.source.title) || 'Feed',
          content: a.content || '',
          image: a.image_url || a.image || a.thumbnail || '',
          image_url: a.image_url || a.image || a.thumbnail || '',
          published: a.published_at || a.published || a.pubDate
        };
      });
      renderReadLaterView();
      const rbEl = document.getElementById('badge-saved-count');
      if (rbEl) rbEl.textContent = String(queueListArticles.length);
      try { localStorage.setItem('feedometer_cached_read_later_count', String(queueListArticles.length)); } catch (_) {}
    } catch (e) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #64748b;">Your reading queue is empty. Save articles for later with the 🔖 icon!</div>';
    }
  }

  function renderReadLaterView() {
    const grid = document.getElementById('read-later-grid');
    if (!grid) return;
    if (queueListArticles.length === 0) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #64748b;">Your reading queue is empty. Save articles for later with the 🔖 icon!</div>';
      return;
    }

    grid.innerHTML = queueListArticles.map((a) => {
      const title = a.title || 'Untitled Queue Item';
      const snippet = a.snippet || a.summary || a.description || '';
      const source = a.sourceTitle || 'Feed';

      const mediaHtml = (window.FeedImaging && typeof window.FeedImaging.renderMedia === 'function')
        ? window.FeedImaging.renderMedia(a, { className: 'article-card-img', fallbackClass: 'article-card-fallback' })
        : (a.image ? `<img class="article-card-img" src="${escapeHtml(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<div class="article-card-fallback">${escapeHtml(source.charAt(0).toUpperCase() || 'F')}</div>`);

      return `
        <div class="article-card" data-article-id="${escapeHtml(a.id)}">
          <div class="article-card-media">
            ${mediaHtml}
          </div>
          <div class="article-source-row">
            <span class="article-source-badge">🔖 ${escapeHtml(source)}</span>
          </div>
          <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer" class="article-title">${escapeHtml(title)}</a>
          <p class="article-snippet">${escapeHtml(snippet)}</p>
          <div class="article-card-actions">
            <button type="button" class="dedicated-btn-read" onclick="window.markReadLaterArticle && window.markReadLaterArticle('${escapeHtml(a.id)}')">
              ✓ Mark Read
            </button>
            <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer" class="dedicated-btn dedicated-btn-primary" style="padding: 0.25rem 0.65rem; font-size: 0.78rem;">Read Now ↗</a>
          </div>
        </div>
      `;
    }).join('');

    if (window.SmartCrop && typeof window.SmartCrop.applyAll === 'function') {
      window.SmartCrop.applyAll(grid);
    }
  }

  async function markReadLaterArticle(id) {
    const article = queueListArticles.find(a => a.id === id);
    try {
      if (global.FeedOmeterAuth) {
        await global.FeedOmeterAuth.markArticleRead({
          article_id: id,
          url: article && article.url,
          article_data: article || { id: id }
        });
        await global.FeedOmeterAuth.unsaveArticle(id, article && article.url);
      }
      queueListArticles = queueListArticles.filter(a => a.id !== id);
      renderReadLaterView();
      const rbEl = document.getElementById('badge-saved-count');
      if (rbEl) rbEl.textContent = String(queueListArticles.length);
      try { localStorage.setItem('feedometer_cached_read_later_count', String(queueListArticles.length)); } catch (_) {}
    } catch (e) {
      alert(e.message || 'Could not mark read');
    }
  }

  // Export dedicated handlers globally
  global.loadStarredView = loadStarredView;
  global.removeStarredArticle = removeStarredArticle;
  global.exportStarredArticles = exportStarredArticles;
  global.loadReadLaterView = loadReadLaterView;
  global.markReadLaterArticle = markReadLaterArticle;

  function switchStreamContext(tab, folderId = null, folderName = 'All Feeds') {
    // Persist the view we are leaving so returning is instant (skip if still mid-fetch)
    if (!state.isLoading && (state.currentTab === 'all' || state.currentTab === 'folder')) {
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

    const stdView = document.getElementById('standard-stream-view');
    const starredView = document.getElementById('starred-view');
    const readLaterView = document.getElementById('read-later-view');
    const rssView = document.getElementById('rss-reader-view');
    const watchlistsView = document.getElementById('watchlists-view');

    // Update active nav styling
    document.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.sidebar-folder-item').forEach(el => el.classList.remove('active'));
    const foldersHeader = document.getElementById('sidebar-folders-header');

    if (tab === 'watchlists-all') {
      if (foldersHeader) foldersHeader.classList.add('active');
    } else if (tab === 'watchlists-folder' || tab === 'folder') {
      const folderEl = document.querySelector(`[data-folder-id="${folderId}"]`);
      if (folderEl) folderEl.classList.add('active');
    } else {
      const tabEl = document.querySelector(`[data-nav-tab="${tab}"]`);
      if (tabEl) tabEl.classList.add('active');
    }

    if (tab === 'starred') {
      if (stdView) stdView.style.display = 'none';
      if (readLaterView) readLaterView.style.display = 'none';
      if (rssView) rssView.style.display = 'none';
      if (watchlistsView) watchlistsView.style.display = 'none';
      if (starredView) starredView.style.display = 'flex';
      loadStarredView();
      return;
    }

    if (tab === 'saved') {
      if (stdView) stdView.style.display = 'none';
      if (starredView) starredView.style.display = 'none';
      if (rssView) rssView.style.display = 'none';
      if (watchlistsView) watchlistsView.style.display = 'none';
      if (readLaterView) readLaterView.style.display = 'flex';
      loadReadLaterView();
      return;
    }

    if (tab === 'rss-reader') {
      if (stdView) stdView.style.display = 'none';
      if (starredView) starredView.style.display = 'none';
      if (readLaterView) readLaterView.style.display = 'none';
      if (watchlistsView) watchlistsView.style.display = 'none';
      if (rssView) rssView.style.display = 'flex';
      showRssHeroState();
      return;
    }

    if (tab === 'watchlists-all' || tab === 'watchlists-folder') {
      if (stdView) stdView.style.display = 'none';
      if (starredView) starredView.style.display = 'none';
      if (readLaterView) readLaterView.style.display = 'none';
      if (rssView) rssView.style.display = 'none';
      if (watchlistsView) watchlistsView.style.display = 'flex';
      loadWatchlistsView(folderId, folderName);
      return;
    }

    // Standard Stream Tabs (all, folder)
    if (starredView) starredView.style.display = 'none';
    if (readLaterView) readLaterView.style.display = 'none';
    if (rssView) rssView.style.display = 'none';
    if (watchlistsView) watchlistsView.style.display = 'none';
    if (stdView) stdView.style.display = 'flex';

    // Update Header
    const titleEl = document.getElementById('stream-context-title');
    const subtitleEl = document.getElementById('stream-context-subtitle');
    if (titleEl) {
      if (tab === 'folder') {
        titleEl.innerHTML = `<span>📁</span> <span>${escapeHtml(folderName)}</span>`;
      } else {
        titleEl.innerHTML = `<span>📰</span> <span>All Feeds</span>`;
      }
    }
    if (subtitleEl) {
      if (tab === 'folder') {
        subtitleEl.textContent = 'Watchlist Folder Stream • Instant intelligence from followed feeds';
      } else {
        subtitleEl.textContent = 'Unified chronological intelligence stream';
      }
    }

    loadStream(true);
  }

  // ── Watchlists & Folders Organizer Right Pane Engine ──
  let watchlistCurrentFeeds = [];
  let movingWatchlistFeedId = null;

  async function loadWatchlistsView(folderId = null, folderName = 'All Feeds') {
    const headingEl = document.getElementById('wf-heading');
    const breadcrumbsEl = document.getElementById('wf-breadcrumbs');
    const searchInput = document.getElementById('wf-search-input');
    const feedList = document.getElementById('wf-feed-list');
    const emptyEl = document.getElementById('wf-empty');

    if (headingEl) headingEl.textContent = folderName || 'All Feeds';
    if (searchInput) searchInput.value = '';

    // Update breadcrumbs
    if (breadcrumbsEl) {
      if (folderId && window.WatchlistsAPI && typeof window.WatchlistsAPI.getFolderPath === 'function') {
        try {
          const path = await window.WatchlistsAPI.getFolderPath(folderId);
          if (path && path.length > 1) {
            breadcrumbsEl.hidden = false;
            breadcrumbsEl.innerHTML = '';

            const allSpan = document.createElement('span');
            allSpan.className = 'wf-crumb-link';
            allSpan.textContent = 'All Feeds';
            allSpan.addEventListener('click', () => switchStreamContext('watchlists-all', null, 'All Feeds'));
            breadcrumbsEl.appendChild(allSpan);

            path.forEach((step, idx) => {
              const sep = document.createElement('span');
              sep.textContent = ' › ';
              sep.style.color = '#94a3b8';
              breadcrumbsEl.appendChild(sep);

              if (idx === path.length - 1) {
                const curr = document.createElement('span');
                curr.style.color = '#0f172a';
                curr.style.fontWeight = '700';
                curr.textContent = step.name;
                breadcrumbsEl.appendChild(curr);
              } else {
                const link = document.createElement('span');
                link.className = 'wf-crumb-link';
                link.textContent = step.name;
                link.addEventListener('click', () => switchStreamContext('watchlists-folder', step.id, step.name));
                breadcrumbsEl.appendChild(link);
              }
            });
          } else {
            breadcrumbsEl.hidden = true;
          }
        } catch (_) {
          breadcrumbsEl.hidden = true;
        }
      } else {
        breadcrumbsEl.hidden = true;
      }
    }

    // Load feeds
    if (window.WatchlistsAPI) {
      try {
        if (!folderId) {
          watchlistCurrentFeeds = await window.WatchlistsAPI.load();
        } else {
          watchlistCurrentFeeds = await window.WatchlistsAPI.getFolderFeeds(folderId);
        }
      } catch (e) {
        watchlistCurrentFeeds = [];
      }
    } else {
      watchlistCurrentFeeds = [];
    }

    renderWatchlistsFeeds();
  }

  function renderWatchlistsFeeds() {
    const feedList = document.getElementById('wf-feed-list');
    const emptyEl = document.getElementById('wf-empty');
    const searchInput = document.getElementById('wf-search-input');
    if (!feedList || !emptyEl) return;

    let list = [...watchlistCurrentFeeds];
    const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (q) {
      list = list.filter(f => 
        (f.title && f.title.toLowerCase().includes(q)) ||
        (f.name && f.name.toLowerCase().includes(q)) ||
        (f.feedUrl && f.feedUrl.toLowerCase().includes(q)) ||
        (f.siteUrl && f.siteUrl.toLowerCase().includes(q))
      );
    }

    if (list.length === 0) {
      feedList.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';
    feedList.innerHTML = '';

    list.forEach(feed => {
      const li = document.createElement('li');
      li.className = 'pf-card' + (feed.starred ? ' starred' : '');
      
      let domain = '';
      try {
        const u = new URL(feed.siteUrl || feed.feedUrl || '');
        domain = u.hostname.replace(/^www\./, '');
      } catch (_) {
        domain = (feed.feedUrl || '').slice(0, 35);
      }
      const favicon = feed.icon || `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(domain || 'google.com')}`;

      const folder = (state.folders || []).find(f => f.id === feed.folderId);
      const folderLabel = folder ? folder.name : (!feed.folderId ? 'Uncategorised' : '');
      const title = feed.title || feed.name || 'Feed';

      li.innerHTML = `
        <img src="${escapeHtml(favicon)}" class="pf-card-favicon" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
        <div class="pf-card-favicon-fallback" style="display:none;">📰</div>
        <div class="pf-card-body">
          <div class="pf-card-title-row">
            <h3 class="pf-card-title">${escapeHtml(title)}</h3>
            <button type="button" class="pf-star-btn" title="${feed.starred ? 'Unstar' : 'Star'}">${feed.starred ? '★' : '☆'}</button>
          </div>
          <span class="pf-card-domain">${escapeHtml(domain)}</span>
          <div class="pf-card-tags">
            ${folderLabel ? `<span class="pf-tag folder-tag">📁 ${escapeHtml(folderLabel)}</span>` : ''}
            ${feed.itemCount != null ? `<span class="pf-tag">${feed.itemCount} articles</span>` : ''}
            ${feed.savedAt ? `<span class="pf-tag">Saved ${new Date(feed.savedAt).toLocaleDateString()}</span>` : ''}
          </div>
        </div>
        <div class="pf-card-actions">
          <button type="button" class="pf-btn pf-btn-primary pf-read-btn" title="Read feed stories">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <span>Read</span>
          </button>
          <div class="pf-menu-wrap">
            <button type="button" class="pf-menu-btn" title="More options">⋯</button>
            <div class="pf-dropdown">
              <button type="button" class="pf-dropdown-item pf-move-action">📁 Move to folder</button>
              <div class="pf-dropdown-divider"></div>
              <button type="button" class="pf-dropdown-item danger pf-delete-action">🗑 Remove</button>
            </div>
          </div>
        </div>
      `;

      // Star toggle
      li.querySelector('.pf-star-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (window.WatchlistsAPI) {
          await window.WatchlistsAPI.setStarred(feed.id, !feed.starred);
          loadWatchlistsView(state.activeFolderId, state.activeFolderName);
        }
      });

      // Read feed action
      li.querySelector('.pf-read-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const feedUrl = feed.feedUrl || feed.url;
        if (feedUrl) {
          switchStreamContext('rss-reader');
          fetchRssFeed(feedUrl);
        }
      });

      // Dropdown toggle
      const menuBtn = li.querySelector('.pf-menu-btn');
      const dropdown = li.querySelector('.pf-dropdown');
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.pf-dropdown.is-open').forEach(d => { if (d !== dropdown) d.classList.remove('is-open'); });
        dropdown.classList.toggle('is-open');
      });

      // Move action
      li.querySelector('.pf-move-action').addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.remove('is-open');
        openWatchlistMoveModal(feed.id);
      });

      // Delete action
      li.querySelector('.pf-delete-action').addEventListener('click', async (e) => {
        e.stopPropagation();
        dropdown.classList.remove('is-open');
        if (!confirm(`Remove "${title}"?`)) return;
        if (window.WatchlistsAPI) {
          await window.WatchlistsAPI.remove(feed.id);
          loadFolders();
          loadWatchlistsView(state.activeFolderId, state.activeFolderName);
        }
      });

      feedList.appendChild(li);
    });
  }

  function openWatchlistMoveModal(feedId) {
    movingWatchlistFeedId = feedId;
    const modal = document.getElementById('wf-move-modal');
    const list = document.getElementById('wf-move-folder-list');
    if (!modal || !list) return;

    const flat = flattenFolders(state.folderTree || state.folders || []);
    list.innerHTML = `
      <li class="pf-modal-folder-item" data-folder-id="" style="padding: 9px 12px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.82rem;">(Uncategorised / Top level)</li>
      ${flat.map(f => `
        <li class="pf-modal-folder-item" data-folder-id="${escapeHtml(f.id)}" style="padding: 9px 12px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.82rem; padding-left: ${0.75 + f.depth * 0.8}rem;">
          📁 ${escapeHtml(f.name)}
        </li>
      `).join('')}
    `;

    list.querySelectorAll('.pf-modal-folder-item').forEach(item => {
      item.addEventListener('click', async () => {
        const targetFolderId = item.getAttribute('data-folder-id') || null;
        if (window.WatchlistsAPI && movingWatchlistFeedId) {
          await window.WatchlistsAPI.moveToFolder(movingWatchlistFeedId, targetFolderId);
          modal.style.display = 'none';
          loadFolders();
          loadWatchlistsView(state.activeFolderId, state.activeFolderName);
        }
      });
    });

    modal.style.display = 'flex';
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
      if (state.currentTab === 'folder') {
        container.innerHTML = `
          <div class="reader-empty-state" style="grid-column: 1 / -1; padding: 3rem 1.5rem; text-align: center; color: #64748b;">
            <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📁</div>
            <p style="font-weight: 700; color: #0f172a; font-size: 1.05rem;">Folder &ldquo;${escapeHtml(state.activeFolderName)}&rdquo; is empty</p>
            <p style="font-size: 0.85rem; color: #64748b; margin-top: 0.25rem;">Follow RSS feeds into this folder from <a href="find-sources.html" style="color: #0284c7; font-weight: 600; text-decoration: underline;">Browse Sources</a> or organize them in <a href="watchlists.html" style="color: #0284c7; font-weight: 600; text-decoration: underline;">Watchlists</a>.</p>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="reader-empty-state" style="grid-column: 1 / -1;">
            <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📭</div>
            <p style="font-weight: 700; color: #0f172a; font-size: 1.05rem;">No stories found</p>
            <p style="font-size: 0.85rem; color: #64748b; margin-top: 0.25rem;">Follow more RSS sources or adjust your search filter.</p>
          </div>
        `;
      }
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
      const rawImage = art.image || art.image_url || art.thumbnail || art.hero_image || art.enclosure?.url || (art.enclosures && art.enclosures[0]?.url) || '';
      const image = (window.FeedImaging && typeof window.FeedImaging.upgradeUrl === 'function')
        ? window.FeedImaging.upgradeUrl(rawImage)
        : rawImage;

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

    // Apply smart cropping and image enhancements
    if (window.FeedImaging && typeof window.FeedImaging.enhanceImages === 'function') {
      window.FeedImaging.enhanceImages(container);
    } else if (window.SmartCrop && typeof window.SmartCrop.applyAll === 'function') {
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
      if (global.FeedOmeterAuth && typeof global.FeedOmeterAuth.starArticle === 'function') {
        try {
          await global.FeedOmeterAuth.starArticle(global.FeedOmeterAuth.buildArticlePayload ? global.FeedOmeterAuth.buildArticlePayload(article) : article);
        } catch (_) {}
      } else {
        await api('/api/articles/star', {
          method: 'POST',
          body: JSON.stringify({
            article_hash: article.id,
            article_data: article
          })
        });
        try { window.dispatchEvent(new CustomEvent('feedometer:starred-changed')); } catch (e) {}
      }
    } else {
      if (global.FeedOmeterAuth && typeof global.FeedOmeterAuth.unstarArticle === 'function') {
        try {
          await global.FeedOmeterAuth.unstarArticle(article.id, article.link || article.url);
        } catch (_) {}
      } else {
        await api('/api/articles/unstar', {
          method: 'POST',
          body: JSON.stringify({ article_hash: article.id })
        });
        try { window.dispatchEvent(new CustomEvent('feedometer:starred-changed')); } catch (e) {}
      }
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
      if (global.FeedOmeterAuth && typeof global.FeedOmeterAuth.saveArticle === 'function') {
        try {
          await global.FeedOmeterAuth.saveArticle(global.FeedOmeterAuth.buildArticlePayload ? global.FeedOmeterAuth.buildArticlePayload(article) : article);
        } catch (_) {}
      } else {
        await api('/api/articles/save', {
          method: 'POST',
          body: JSON.stringify({
            article_hash: article.id,
            article_data: article
          })
        });
        try { window.dispatchEvent(new CustomEvent('feedometer:saved-changed')); } catch (e) {}
      }
    } else {
      if (global.FeedOmeterAuth && typeof global.FeedOmeterAuth.unsaveArticle === 'function') {
        try {
          await global.FeedOmeterAuth.unsaveArticle(article.id, article.link || article.url);
        } catch (_) {}
      } else {
        await api('/api/articles/unsave', {
          method: 'POST',
          body: JSON.stringify({ article_hash: article.id })
        });
        try { window.dispatchEvent(new CustomEvent('feedometer:saved-changed')); } catch (e) {}
      }
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

    // FOLDERS header click to toggle collapse/uncollapse and open All Feeds in watchlists view
    const foldersHeader = document.getElementById('sidebar-folders-header');
    if (foldersHeader) {
      foldersHeader.addEventListener('click', (e) => {
        if (e.target.closest('.section-subtext')) return;
        toggleFoldersCollapse();
        switchStreamContext('watchlists-all', null, 'All Feeds');
      });
    }

    // Watchlists & Folders Pane Actions
    const wfSearchInput = document.getElementById('wf-search-input');
    if (wfSearchInput) {
      wfSearchInput.addEventListener('input', renderWatchlistsFeeds);
    }

    const wfExportBtn = document.getElementById('wf-export-btn');
    if (wfExportBtn) {
      wfExportBtn.addEventListener('click', async () => {
        if (window.WatchlistsAPI) {
          const jsonStr = await window.WatchlistsAPI.exportJson();
          const a = document.createElement('a');
          a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(jsonStr);
          a.download = 'feedread_watchlists_backup.json';
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      });
    }

    const wfImportBtn = document.getElementById('wf-import-btn');
    const wfImportFile = document.getElementById('wf-import-file');
    if (wfImportBtn && wfImportFile) {
      wfImportBtn.addEventListener('click', () => wfImportFile.click());
      wfImportFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            if (window.WatchlistsAPI) {
              const res = await window.WatchlistsAPI.importFeeds(ev.target.result);
              if (res.ok) {
                await loadFolders();
                loadWatchlistsView(state.activeFolderId, state.activeFolderName);
              } else {
                alert(res.message || 'Import failed');
              }
            }
          } catch (_) {
            alert('Invalid JSON file');
          }
        };
        reader.readAsText(file);
      });
    }

    const wfNewFeedBtn = document.getElementById('wf-new-feed-btn');
    if (wfNewFeedBtn) {
      wfNewFeedBtn.addEventListener('click', () => {
        if (window.FollowFolderModal && typeof window.FollowFolderModal.open === 'function') {
          window.FollowFolderModal.open({
            folderId: state.activeFolderId
          });
        } else {
          showAddFeedModal();
        }
      });
    }

    const wfMoveClose = document.getElementById('wf-move-modal-close');
    if (wfMoveClose) {
      wfMoveClose.addEventListener('click', () => {
        const modal = document.getElementById('wf-move-modal');
        if (modal) modal.style.display = 'none';
      });
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.pf-menu-wrap')) {
        document.querySelectorAll('.pf-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
      }
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

    // Embedded RSS Feed Reader interactions (Hero State)
    const btnRssFetch = document.getElementById('btn-rss-fetch-feed');
    const rssUrlInput = document.getElementById('rss-feed-url-input');
    if (btnRssFetch && rssUrlInput) {
      btnRssFetch.addEventListener('click', (e) => {
        e.preventDefault();
        const url = rssUrlInput.value.trim();
        if (url) fetchRssFeed(url);
      });

      rssUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const url = rssUrlInput.value.trim();
          if (url) fetchRssFeed(url);
        }
      });
    }

    // Sample pills in hero state - Click to paste URL into input box
    const rssCarouselEl = document.getElementById('rss-sample-feeds-carousel');
    if (rssCarouselEl) {
      rssCarouselEl.addEventListener('click', (e) => {
        const pill = e.target.closest('.sample-pill');
        if (!pill) return;
        e.preventDefault();
        e.stopPropagation();

        document.querySelectorAll('#rss-sample-feeds-carousel .sample-pill').forEach(p => p.classList.remove('active-selected'));
        pill.classList.add('active-selected');

        const feedKey = pill.getAttribute('data-feed');
        if (feedKey && SAMPLE_FEEDS[feedKey] && rssUrlInput) {
          rssUrlInput.value = SAMPLE_FEEDS[feedKey];
          rssUrlInput.focus();
        }
      });
    }

    // Sample carousel navigation buttons
    const rssCarousel = document.getElementById('rss-sample-feeds-carousel');
    const rssPrev = document.getElementById('rss-sample-carousel-prev');
    const rssNext = document.getElementById('rss-sample-carousel-next');
    if (rssCarousel && rssPrev && rssNext) {
      rssPrev.addEventListener('click', () => {
        rssCarousel.scrollBy({ left: -180, behavior: 'smooth' });
      });
      rssNext.addEventListener('click', () => {
        rssCarousel.scrollBy({ left: 180, behavior: 'smooth' });
      });
    }

    // Reader Panel Back button (Screenshot 3 -> Screenshot 2)
    const rssBackBtn = document.getElementById('rss-reader-back-btn');
    if (rssBackBtn) {
      rssBackBtn.addEventListener('click', showRssHeroState);
    }

    // Reader Panel View Toggle (List / Grid)
    const rssViewListBtn = document.getElementById('rss-view-list-btn');
    const rssViewGridBtn = document.getElementById('rss-view-grid-btn');
    if (rssViewListBtn && rssViewGridBtn) {
      rssViewListBtn.addEventListener('click', () => setRssViewMode('list'));
      rssViewGridBtn.addEventListener('click', () => setRssViewMode('grid'));
    }

    // Reader Panel Headline Search
    const rssHeadlineSearch = document.getElementById('rss-feed-search-input');
    if (rssHeadlineSearch) {
      rssHeadlineSearch.addEventListener('input', (e) => {
        rssSearchQuery = e.target.value.trim();
        renderRssCards();
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

        if (window.WatchlistsAPI) {
          try {
            await window.WatchlistsAPI.saveFeed({
              title: title,
              feedUrl: feedUrl,
              folderId: folderId
            });
            document.getElementById('add-feed-modal').style.display = 'none';
            addFeedForm.reset();
            loadFolders();
            loadStream(true);
            return;
          } catch (_) {}
        }

        const res = await api('/api/feeds/subscriptions', {
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

        if (window.WatchlistsAPI) {
          try {
            await window.WatchlistsAPI.createFolder(name, parentId);
            document.getElementById('add-folder-modal').style.display = 'none';
            addFolderForm.reset();
            loadFolders();
            return;
          } catch (_) {}
        }

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
