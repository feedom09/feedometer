/**
 * navbar/navbar.js — FeedOmeter 2.1 Sleek Royal Blue Navigation Drawer
 * Light royal blue gradient, non-bold sleek typography, floating rounded corners,
 * and #FFEA99 signout button matching the reference design.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY_FAVS = 'feedometer_navbar_favs';
  const STORAGE_KEY_RECENTS = 'feedometer_navbar_recents';

  // Master Navigation Tree with organized Discover, Library, Automation & Studio sections
  const NAV_TREE = {
    id: 'root',
    title: 'Menu',
    children: [
      {
        id: 'discover',
        title: 'Discover',
        sectionHeader: 'DISCOVER',
        children: [
          { id: 'trending', title: "Today's Digest", href: 'home.html', icon: '🔥' },
          { id: 'browse-sources', title: 'Browse Sources & Follow', href: 'find-sources.html', icon: '🌐' },
          { id: '1stop-reader', title: 'One Stop Reader', href: 'reader.html', icon: '📰' },
          { id: 'rss-reader', title: 'Feed Viewer', href: 'rss-reader.html', icon: '📖' },
          { id: 'feed-search', title: 'Feed Search & Follow', href: 'feed-search.html', icon: '🔎' }
        ]
      },
      {
        id: 'library',
        title: 'My Library',
        sectionHeader: 'MY LIBRARY',
        sectionMeta: '+ New',
        sectionMetaHref: 'watchlists.html',
        metaClass: 'meta-blue',
        children: [
          { id: 'watchlists', title: 'Watchlists', href: 'watchlists.html', icon: '📁' },
          { id: 'following', title: 'Following', href: 'following.html', icon: '⭐', badge: '' },
          { id: 'starred', title: 'Starred', href: 'starred.html', icon: '★' },
          { id: 'read-later', title: 'Read Later', href: 'read-later.html', icon: '⏳' }
        ]
      },
      {
        id: 'feed-studio',
        title: 'Feed Studio',
        sectionHeader: 'FEED STUDIO',
        children: [
          { id: 'add-source', title: 'Add Feed', href: 'add-source.html', icon: '➕' },
          { id: 'auto-feed-generator', title: 'Auto Feed Generator', href: 'builder.html', icon: '⚡' },
          {
            id: 'visual-rss-builder',
            title: 'Visual RSS Studio',
            href: 'visual-builder.html',
            icon: '🎯'
          }
        ]
      },
      {
        id: 'automation-dev',
        title: 'Automation & Developer',
        sectionHeader: 'AUTOMATION & DEVELOPER',
        children: [
          { id: 'automation-studio', title: 'Alerts & Automation', href: 'automation.html', icon: '⚡' },
          { id: 'integrations', title: 'Integrations & Webhooks', href: 'integrations.html', icon: '🔌' },
          { id: 'feed-filters', title: 'Filters & Rules', href: 'filters.html', icon: '⚗️' },
          { id: 'widget-studio', title: 'Embeddable Widgets', href: 'widgets.html', icon: '🧩' },
          { id: 'admin-metrics', title: 'Cloudflare Reads Admin', href: 'admin-metrics.html', icon: '📊' }
        ]
      },
      {
        id: 'account',
        title: 'Account & Preferences',
        sectionHeader: 'ACCOUNT & PREFERENCES',
        children: [
          { id: 'account-page', title: 'Account & OPML 2.0', href: 'account.html', icon: '📦', badge: '' },
          { id: 'profile-settings', title: 'Profile & Settings', href: 'settings.html', icon: '⚙️', badge: '' }
        ]
      },
      {
        id: 'misc',
        title: 'Misc Items',
        sectionHeader: 'MISC ITEMS',
        children: [
          { id: 'search', title: 'Search Articles', href: 'search.html', icon: '🔍' },
          { id: 'find-feeds', title: 'Explore Feeds', href: 'find-feeds.html', icon: '📡' }
        ]
      }
    ]
  };

  function getScopedKey(baseKey) {
    const user = global.FeedOmeterAuth ? global.FeedOmeterAuth.getUser() : null;
    const uId = user && user.id ? user.id : 'guest';
    return `${baseKey}_${uId}`;
  }

  const state = {
    isOpen: false,
    activeTab: 'navigator', // 'navigator' | 'favorites' | 'recents'
    pathStack: ['root'],
    favorites: [],
    recents: []
  };

  function getCurrentActiveHref() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const currentView = urlParams.get('view') || '';
      if (currentView) return currentView;
      const path = window.location.pathname.split('/').pop();
      return path || 'home.html';
    } catch (e) {
      return 'home.html';
    }
  }

  function isItemActive(href) {
    if (!href) return false;
    const curr = getCurrentActiveHref();
    if (curr === href) return true;
    if (curr.startsWith(href) || href.startsWith(curr)) return true;
    return false;
  }

  function loadUserStorage() {
    try {
      const storedFavs = JSON.parse(localStorage.getItem(getScopedKey(STORAGE_KEY_FAVS)));
      state.favorites = Array.isArray(storedFavs) && storedFavs.length
        ? storedFavs
        : [
            { id: 'trending', title: "Today's Digest", href: 'home.html', icon: '🔥' },
            { id: '1stop-reader', title: 'One Stop Reader', href: 'reader.html', icon: '📰' },
            { id: 'rss-reader', title: 'Feed Viewer', href: 'rss-reader.html', icon: '📖' },
            { id: 'search', title: 'Search', href: 'search.html', icon: '🔍' },
            { id: 'feed-search', title: 'Feed Search & Follow', href: 'feed-search.html', icon: '🔎' },
            { id: 'find-feeds', title: 'Find Feeds', href: 'find-feeds.html', icon: '📡' }
          ];

      // One-time: surface Feed Search for users with an older favorites list
      if (!state.favorites.some((f) => f && (f.id === 'feed-search' || f.href === 'feed-search.html'))) {
        const afterSearch = state.favorites.findIndex((f) => f && (f.id === 'search' || f.href === 'search.html'));
        const insertAt = afterSearch >= 0 ? afterSearch + 1 : state.favorites.length;
        state.favorites.splice(insertAt, 0, {
          id: 'feed-search',
          title: 'Feed Search & Follow',
          href: 'feed-search.html',
          icon: '🔎'
        });
        saveFavorites();
      }

      state.recents = JSON.parse(localStorage.getItem(getScopedKey(STORAGE_KEY_RECENTS))) || [];
    } catch (e) {
      state.favorites = [];
      state.recents = [];
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(getScopedKey(STORAGE_KEY_FAVS), JSON.stringify(state.favorites));
    } catch (e) {}
  }

  function addRecent(item) {
    if (!item || !item.href) return;
    state.recents = state.recents.filter(r => r.href !== item.href);
    state.recents.unshift({
      id: item.id || item.title,
      title: item.title,
      href: item.href,
      icon: item.icon || '📄',
      badge: item.badge || '',
      visitedAt: Date.now()
    });
    if (state.recents.length > 15) state.recents.pop();
    try {
      localStorage.setItem(getScopedKey(STORAGE_KEY_RECENTS), JSON.stringify(state.recents));
    } catch (e) {}
  }

  function getCurrentNode() {
    let curr = NAV_TREE;
    for (let i = 1; i < state.pathStack.length; i++) {
      const targetId = state.pathStack[i];
      if (curr.children) {
        const found = curr.children.find(c => c.id === targetId);
        if (found) curr = found;
      }
    }
    return curr;
  }

  function renderDrawer() {
    fetchLibraryCounts();
    const bodyEl = document.getElementById('feedo-nav-drawer-body');
    const userEmailEl = document.getElementById('feedo-nav-user-email');
    const userAvatarEl = document.getElementById('feedo-nav-user-avatar');
    const signoutBtn = document.getElementById('feedo-signout-btn');

    const user = global.FeedOmeterAuth ? global.FeedOmeterAuth.getUser() : null;
    const isGuest = global.FeedOmeterAuth ? global.FeedOmeterAuth.isGuest() : (localStorage.getItem('feedometer_guest_mode') === 'true');
    const initial = user && (user.name || user.email) ? (user.name || user.email)[0].toUpperCase() : 'G';
    const pic = user ? (user.picture || user.picture_url) : null;

    if (userEmailEl) userEmailEl.style.display = 'none';
    if (userAvatarEl) {
      if (pic) {
        userAvatarEl.innerHTML = `<img src="${pic}" referrerpolicy="no-referrer" alt="User" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;" onerror="this.parentElement.textContent='${initial}';" />`;
      } else {
        userAvatarEl.innerHTML = '';
        userAvatarEl.textContent = initial;
      }
      userAvatarEl.style.cursor = 'pointer';
      userAvatarEl.title = 'Account & Profile';
      userAvatarEl.onclick = function (e) {
        if (e) e.stopPropagation();
        navigateToView('account.html', 'Account & Profile', '👤');
      };
    }

    const userInfoEl = document.querySelector('.nav-drawer-user-info');
    if (userInfoEl) {
      userInfoEl.onclick = null;
    }

    if (signoutBtn) {
      if (!user && isGuest) {
        signoutBtn.innerHTML = '<span class="nav-signout-icon" aria-hidden="true">✨</span> <span>Sign In</span>';
        signoutBtn.className = 'nav-drawer-signout-btn';
        signoutBtn.onclick = function (e) {
          if (e) e.preventDefault();
          closeDrawer();
          if (typeof window.showAuthModal === 'function') window.showAuthModal();
        };
      } else {
        signoutBtn.innerHTML =
          '<span class="nav-signout-icon nav-signout-icon--3d" aria-hidden="true">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
              '<path d="M10 3.5H6.5A2.5 2.5 0 0 0 4 6v12a2.5 2.5 0 0 0 2.5 2.5H10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
              '<path d="M14 8l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="M18 12H9.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
            '</svg>' +
          '</span> <span>Sign Out</span>';
        signoutBtn.className = 'nav-drawer-signout-btn';
        signoutBtn.onclick = function (e) {
          if (typeof window.executeSignOut === 'function') window.executeSignOut(e);
        };
      }
    }

    if (!bodyEl) return;

    if (state.activeTab === 'navigator') {
      renderNavigatorTab(bodyEl);
    } else if (state.activeTab === 'favorites') {
      renderFavoritesTab(bodyEl);
    } else if (state.activeTab === 'recents') {
      renderRecentsTab(bodyEl);
    }
  }

  function findNodeInTree(node, id) {
    if (node.id === id) return node;
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const found = findNodeInTree(node.children[i], id);
        if (found) return found;
      }
    }
    return null;
  }

  function updateNavBadges() {
    const bodyEl = document.getElementById('feedo-nav-drawer-body');
    if (!bodyEl) return;
    bodyEl.querySelectorAll('.nav-menu-item').forEach(function (itemEl) {
      const nodeId = itemEl.getAttribute('data-node-id');
      if (!nodeId) return;
      const targetNode = findNodeInTree(NAV_TREE, nodeId);
      if (targetNode) {
        const badgeText = getEffectiveBadge(targetNode);
        const rightEl = itemEl.querySelector('.nav-item-right');
        if (rightEl) {
          let badgeEl = rightEl.querySelector('.nav-badge');
          if (badgeText !== '') {
            if (!badgeEl) {
              badgeEl = document.createElement('span');
              badgeEl.className = 'nav-badge';
              rightEl.prepend(badgeEl);
            }
            badgeEl.textContent = badgeText;
          } else if (badgeEl) {
            badgeEl.remove();
          }
        }
      }
    });
  }

  function getEffectiveBadge(item) {
    if (item.id === 'following') {
      try {
        const cached = localStorage.getItem('feedometer_cached_subscriptions_count');
        if (cached !== null && parseInt(cached, 10) >= 0) return String(cached);
        const user = global.FeedOmeterAuth ? global.FeedOmeterAuth.getUser() : null;
        if (user && user.feed_count != null && parseInt(user.feed_count, 10) >= 0) return String(user.feed_count);
        const guestList = (global.FeedOmeterAuth && global.FeedOmeterAuth.getGuestFollows)
          ? global.FeedOmeterAuth.getGuestFollows()
          : JSON.parse(sessionStorage.getItem('feedometer_guest_subscriptions') || '[]');
        if (guestList && guestList.length > 0) return String(guestList.length);
      } catch (e) {}
    }
    if (item.id === 'watchlists') {
      try {
        const n = localStorage.getItem('feedometer_cached_folders_count');
        if (n !== null && parseInt(n, 10) >= 0) return String(n);
      } catch (e) {}
    }
    if (item.id === 'starred') {
      try {
        const cached = localStorage.getItem('feedometer_cached_starred_count');
        if (cached !== null && parseInt(cached, 10) >= 0) return String(cached);
      } catch (e) {}
      try {
        const user = global.FeedOmeterAuth ? global.FeedOmeterAuth.getUser() : null;
        if (user && (user.starred_count != null || user.starredCount != null)) {
          const sc = user.starred_count != null ? user.starred_count : user.starredCount;
          return String(sc);
        }
      } catch (e) {}
      try {
        const arr = JSON.parse(localStorage.getItem('feedometer_starred') || sessionStorage.getItem('feedometer_starred') || '[]');
        if (Array.isArray(arr) && arr.length > 0) return String(arr.length);
      } catch (e) {}
    }
    if (item.id === 'read-later') {
      try {
        const cached = localStorage.getItem('feedometer_cached_read_later_count');
        if (cached !== null && parseInt(cached, 10) >= 0) return String(cached);
      } catch (e) {}
      try {
        const user = global.FeedOmeterAuth ? global.FeedOmeterAuth.getUser() : null;
        if (user && (user.saved_count != null || user.savedCount != null)) {
          const sc = user.saved_count != null ? user.saved_count : user.savedCount;
          return String(sc);
        }
      } catch (e) {}
      try {
        const arr = JSON.parse(localStorage.getItem('feedometer_saved') || localStorage.getItem('feedometer_read_later') || sessionStorage.getItem('feedometer_saved') || '[]');
        if (Array.isArray(arr) && arr.length > 0) return String(arr.length);
      } catch (e) {}
    }
    return item.badge || '';
  }

  // Fetch starred + read-later counts and cache locally so badges stay fresh
  function fetchLibraryCounts() {
    // 1. Sync from user profile if present
    try {
      const user = global.FeedOmeterAuth ? global.FeedOmeterAuth.getUser() : null;
      if (user) {
        if (user.starred_count != null) localStorage.setItem('feedometer_cached_starred_count', String(user.starred_count));
        if (user.saved_count != null) localStorage.setItem('feedometer_cached_read_later_count', String(user.saved_count));
        if (user.feed_count != null) localStorage.setItem('feedometer_cached_subscriptions_count', String(user.feed_count));
      }
    } catch (e) {}

    // 2. Fetch Starred & Read Later via FeedOmeterAuth
    if (global.FeedOmeterAuth) {
      if (typeof global.FeedOmeterAuth.getStarredArticles === 'function') {
        global.FeedOmeterAuth.getStarredArticles()
          .then(function (d) {
            if (d) {
              const count = (d.total != null ? d.total : (d.count != null ? d.count : (Array.isArray(d.items) ? d.items.length : (Array.isArray(d.articles) ? d.articles.length : null))));
              if (count != null) {
                localStorage.setItem('feedometer_cached_starred_count', String(count));
                updateNavBadges();
              }
            }
          })
          .catch(function () {});
      }

      if (typeof global.FeedOmeterAuth.getSavedArticles === 'function') {
        global.FeedOmeterAuth.getSavedArticles()
          .then(function (d) {
            if (d) {
              const count = (d.total != null ? d.total : (d.count != null ? d.count : (Array.isArray(d.items) ? d.items.length : (Array.isArray(d.articles) ? d.articles.length : null))));
              if (count != null) {
                localStorage.setItem('feedometer_cached_read_later_count', String(count));
                updateNavBadges();
              }
            }
          })
          .catch(function () {});
      }
    }

    // 3. Folders count via WatchlistsAPI
    if (window.WatchlistsAPI && typeof window.WatchlistsAPI.loadFolders === 'function') {
      window.WatchlistsAPI.loadFolders().then(function (folders) {
        if (Array.isArray(folders)) {
          localStorage.setItem('feedometer_cached_folders_count', String(folders.length));
          updateNavBadges();
        }
      }).catch(function () {});
    }
  }

  function renderNavigatorTab(container) {
    const node = getCurrentNode();
    const isRoot = state.pathStack.length === 1;

    let html = '';

    if (!isRoot) {
      html += `
        <div class="nav-breadcrumb-bar">
          <button id="feedo-nav-back-btn" class="nav-back-btn">
            ← Back
          </button>
          <span class="nav-current-title">${node.title}</span>
        </div>
      `;

      if (node.children && node.children.length > 0) {
        node.children.forEach(child => {
          const isLeaf = Boolean(child.href);
          const badgeClass = child.badgeType === 'new' ? 'badge-new' : (child.badgeType === 'alert' ? 'badge-alert' : '');
          const activeClass = isLeaf && isItemActive(child.href) ? 'active' : '';
          const badgeText = getEffectiveBadge(child);

          html += `
            <div class="nav-menu-item ${activeClass}" data-node-id="${child.id}" data-href="${child.href || ''}" data-is-leaf="${isLeaf}">
              <div class="nav-item-left">
                <span class="nav-item-icon">${child.icon || '📁'}</span>
                <span class="nav-item-title">${child.title}</span>
              </div>
              <div class="nav-item-right">
                ${badgeText ? `<span class="nav-badge ${badgeClass}">${badgeText}</span>` : ''}
                ${!isLeaf ? `<span class="nav-item-arrow">›</span>` : ''}
              </div>
            </div>
          `;
        });
      }
    } else {
      // Root view: Render sections DISCOVER, WORKSPACES, ALERTS matching mockup
      node.children.forEach(section => {
        html += `
          <div class="nav-section-header">
            <span class="nav-section-title">${section.sectionHeader || section.title}</span>
            ${section.sectionMeta ? `<button type="button" class="nav-section-meta ${section.metaClass || ''}" data-section-href="${section.sectionMetaHref || ''}">${section.sectionMeta}</button>` : ''}
          </div>
        `;

        if (section.children) {
          section.children.forEach((child) => {
            const isLeaf = Boolean(child.href);
            const badgeClass = child.badgeType === 'new' ? 'badge-new' : (child.badgeType === 'alert' ? 'badge-alert' : '');
            const activeClass = isLeaf && isItemActive(child.href) ? 'active' : '';
            const badgeText = getEffectiveBadge(child);

            html += `
              <div class="nav-menu-item ${activeClass}" data-node-id="${child.id}" data-href="${child.href || ''}" data-is-leaf="${isLeaf}">
                <div class="nav-item-left">
                  <span class="nav-item-icon">${child.icon || '📁'}</span>
                  <span class="nav-item-title">${child.title}</span>
                </div>
                <div class="nav-item-right">
                  ${badgeText ? `<span class="nav-badge ${badgeClass}">${badgeText}</span>` : ''}
                  ${!isLeaf ? `<span class="nav-item-arrow">›</span>` : ''}
                </div>
              </div>
            `;
          });
        }
      });
    }

    container.innerHTML = html;

    // Attach listeners
    const backBtn = document.getElementById('feedo-nav-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        state.pathStack.pop();
        renderDrawer();
      });
    }

    container.querySelectorAll('[data-section-href]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const href = btn.getAttribute('data-section-href');
        if (href) navigateToView(href, btn.textContent, '➕');
      });
    });

    container.querySelectorAll('.nav-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const isLeaf = item.getAttribute('data-is-leaf') === 'true';
        const nodeId = item.getAttribute('data-node-id');
        const href = item.getAttribute('data-href');

        if (isLeaf && href) {
          navigateToView(href, item.querySelector('.nav-item-title').textContent, item.querySelector('.nav-item-icon').textContent);
        } else {
          state.pathStack.push(nodeId);
          renderDrawer();
        }
      });
    });
  }

  function renderFavoritesTab(container) {
    if (state.favorites.length === 0) {
      container.innerHTML = '<div style="padding: 2.5rem 1rem; text-align: center; color: rgba(255,255,255,0.6); font-size: 0.85rem;">No pinned favorites yet.</div>';
      return;
    }

    let html = '<div class="nav-breadcrumb-bar"><span class="nav-current-title">Favorites</span></div>';
    state.favorites.forEach(fav => {
      const badgeClass = fav.badgeType === 'new' ? 'badge-new' : (fav.badgeType === 'alert' ? 'badge-alert' : '');
      const activeClass = isItemActive(fav.href) ? 'active' : '';
      html += `
        <div class="nav-menu-item ${activeClass}" data-href="${fav.href}">
          <div class="nav-item-left">
            <span class="nav-item-icon">${fav.icon || '⭐'}</span>
            <span class="nav-item-title">${fav.title}</span>
          </div>
          <div class="nav-item-right">
            ${fav.badge ? `<span class="nav-badge ${badgeClass}">${fav.badge}</span>` : ''}
            <button class="nav-fav-pin-btn pinned" data-remove-fav="${fav.href}" title="Remove">✕</button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.nav-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.nav-fav-pin-btn')) return;
        const href = item.getAttribute('data-href');
        navigateToView(href);
      });
    });

    container.querySelectorAll('[data-remove-fav]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const href = btn.getAttribute('data-remove-fav');
        state.favorites = state.favorites.filter(f => f.href !== href);
        saveFavorites();
        renderDrawer();
      });
    });
  }

  function renderRecentsTab(container) {
    if (state.recents.length === 0) {
      container.innerHTML = '<div style="padding: 2.5rem 1rem; text-align: center; color: rgba(255,255,255,0.6); font-size: 0.85rem;">No recent history yet.</div>';
      return;
    }

    let html = '<div class="nav-breadcrumb-bar"><span class="nav-current-title">Recent Pages</span></div>';
    state.recents.forEach(rec => {
      const activeClass = isItemActive(rec.href) ? 'active' : '';
      html += `
        <div class="nav-menu-item ${activeClass}" data-href="${rec.href}">
          <div class="nav-item-left">
            <span class="nav-item-icon">${rec.icon || '🕒'}</span>
            <span class="nav-item-title">${rec.title}</span>
          </div>
          <span class="nav-item-arrow">↗</span>
        </div>
      `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.nav-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const href = item.getAttribute('data-href');
        navigateToView(href);
      });
    });
  }

  function toggleFavorite(nodeId) {
    let found = null;
    function search(node) {
      if (node.id === nodeId && node.href) found = node;
      if (node.children) node.children.forEach(search);
    }
    search(NAV_TREE);

    if (!found) return;

    const existsIdx = state.favorites.findIndex(f => f.href === found.href);
    if (existsIdx !== -1) {
      state.favorites.splice(existsIdx, 1);
    } else {
      state.favorites.push({ id: found.id, title: found.title, href: found.href, icon: found.icon || '⭐', badge: found.badge || '' });
    }
    saveFavorites();
    renderDrawer();
  }

  function navigateToView(href, title, icon) {
    addRecent({ id: href, title: title || href, href, icon: icon || '📄' });
    closeDrawer();

    const isAuth = global.FeedOmeterAuth && global.FeedOmeterAuth.isAuthenticated();
    const isGuest = global.FeedOmeterAuth ? global.FeedOmeterAuth.isGuest() : (localStorage.getItem('feedometer_guest_mode') === 'true');

    // Protect auth-only routes in guest mode
    const authOnlyPages = ['settings.html', 'starred.html', 'read-later.html', 'watchlists.html'];
    const requiresAccount = authOnlyPages.some(function (p) { return href.startsWith(p); });

    if (isGuest && requiresAccount && !isAuth) {
      if (typeof window.showAuthModal === 'function') {
        window.showAuthModal();
      } else if (window.parent && typeof window.parent.showAuthModal === 'function') {
        window.parent.showAuthModal();
      }
      return;
    }

    if (href.startsWith('settings.html')) {
      const tab = href.includes('tab=') ? href.split('tab=')[1].split('&')[0] : 'profile';
      if (typeof window.openSettingsModal === 'function') {
        window.openSettingsModal(tab);
        return;
      }
    }

    if (typeof window.loadView === 'function') {
      window.loadView(href);
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

  function openDrawer() {
    state.isOpen = true;
    loadUserStorage();
    renderDrawer();
    const drawer = document.getElementById('feedo-nav-drawer');
    const backdrop = document.getElementById('feedo-nav-backdrop');
    if (drawer) drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
  }

  function closeDrawer() {
    state.isOpen = false;
    const drawer = document.getElementById('feedo-nav-drawer');
    const backdrop = document.getElementById('feedo-nav-backdrop');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }

  // Init
  function init() {
    loadUserStorage();

    const triggerBtn = document.getElementById('feedo-navbar-trigger-btn');
    if (triggerBtn) {
      triggerBtn.addEventListener('click', openDrawer);
    }

    const closeBtn = document.getElementById('feedo-nav-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

    const backdrop = document.getElementById('feedo-nav-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeDrawer);

    // Tab buttons
    document.querySelectorAll('[data-nav-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-nav-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeTab = btn.getAttribute('data-nav-tab');
        renderDrawer();
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.isOpen) {
        closeDrawer();
      }
    });

    window.addEventListener('feedometer:auth_change', () => {
      loadUserStorage();
      renderDrawer();
    });

    window.addEventListener('feedometer:starred-changed', () => {
      fetchLibraryCounts();
      updateNavBadges();
    });

    window.addEventListener('feedometer:saved-changed', () => {
      fetchLibraryCounts();
      updateNavBadges();
    });

    window.addEventListener('feedometer:subscriptions-changed', () => {
      fetchLibraryCounts();
      updateNavBadges();
    });

    window.addEventListener('watchlists-changed', () => {
      fetchLibraryCounts();
      updateNavBadges();
    });
  }

  global.FeedOmeterNavBar = {
    open: openDrawer,
    close: closeDrawer,
    navigate: navigateToView
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
