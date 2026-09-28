/**
 * scripts/watchlists-api.js
 * User-based hierarchical Watchlists & Folders storage engine for FeedOmeter.
 * Handles folder trees, feeds, subfolders, imports/exports, and reactive change broadcasts.
 */
(function (w) {
  'use strict';

  var UNCATEGORISED_ID = 'pff_uncategorised';
  var _treeCache = null;

  /* ── Helper: User identity scoped key ────────────────────────── */
  function getLocalTreeKey() {
    if (typeof w.getUserKey === 'function') {
      return w.getUserKey('feedometer_watchlists_tree_v1');
    }
    try {
      var u = (w.FeedOmeterAuth && typeof w.FeedOmeterAuth.getUser === 'function') ? w.FeedOmeterAuth.getUser() : null;
      if (!u) {
        var raw = localStorage.getItem('feedometer_user_profile');
        if (raw) u = JSON.parse(raw);
      }
      if (u && (u.id || u.user_id || u.email)) {
        var uid = String(u.id || u.user_id || u.email).replace(/[^a-zA-Z0-9_-]/g, '_');
        return 'feedometer_watchlists_tree_u_' + uid;
      }
    } catch (e) {}
    return 'feedometer_watchlists_tree_guest';
  }

  function getBase() {
    if (w.FEEDOMETER_CONFIG && w.FEEDOMETER_CONFIG.apiBaseUrl) {
      return String(w.FEEDOMETER_CONFIG.apiBaseUrl).replace(/\/+$/, '');
    }
    if (w.FEEDOMETER_API_BASE) {
      return String(w.FEEDOMETER_API_BASE).replace(/\/+$/, '');
    }
    return '';
  }

  function getToken() {
    try {
      return localStorage.getItem('feedometer_session_token') ||
             localStorage.getItem('rss_spider_session_token') || '';
    } catch (e) {
      return '';
    }
  }

  function apiFetch(path, method, body) {
    var base = getBase();
    if (!base) return Promise.reject(new Error('No API base configured'));
    var headers = { 'Accept': 'application/json' };
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(base + path, {
      method: method || 'GET',
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || d.message || 'HTTP ' + r.status);
        return d;
      });
    });
  }

  function notify() {
    try { document.dispatchEvent(new CustomEvent('watchlists-changed')); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('rss-feeds-updated')); } catch (e) {}
    try {
      if (w.parent && w.parent !== w) {
        w.parent.postMessage({ type: 'watchlists-changed' }, '*');
        w.parent.postMessage({ type: 'rss-feeds-updated' }, '*');
      }
    } catch (e) {}
  }

  /* Zero hardcoded/pre-seeded folders — starts clean for every user */
  function getDefaultTree() {
    return {
      version: '1.0',
      tree: []
    };
  }

  function fetchTree(force) {
    if (_treeCache && !force) return Promise.resolve(_treeCache);
    var key = getLocalTreeKey();

    return apiFetch('/api/user/subscriptions')
      .then(function (data) {
        _treeCache = data.subscriptions || getDefaultTree();
        if (!_treeCache.tree || !Array.isArray(_treeCache.tree)) _treeCache = getDefaultTree();
        try { localStorage.setItem(key, JSON.stringify(_treeCache)); } catch (e) {}
        return _treeCache;
      })
      .catch(function () {
        try {
          var raw = localStorage.getItem(key);
          if (raw) {
            _treeCache = JSON.parse(raw);
            if (_treeCache && Array.isArray(_treeCache.tree)) {
              return _treeCache;
            }
          }
        } catch (e) {}

        _treeCache = getDefaultTree();
        try { localStorage.setItem(key, JSON.stringify(_treeCache)); } catch (e) {}
        return _treeCache;
      });
  }

  function commitTree() {
    if (!_treeCache) return Promise.resolve({ ok: false });
    var key = getLocalTreeKey();
    try { localStorage.setItem(key, JSON.stringify(_treeCache)); } catch (e) {}

    return apiFetch('/api/user/subscriptions', 'PUT', _treeCache)
      .then(function () {
        notify();
        return { ok: true };
      })
      .catch(function () {
        notify();
        return { ok: true };
      });
  }

  function findInTree(tree, predicate) {
    for (var i = 0; i < tree.length; i++) {
      if (predicate(tree[i])) return tree[i];
      if (tree[i].type === 'folder' && tree[i].children) {
        var found = findInTree(tree[i].children, predicate);
        if (found) return found;
      }
    }
    return null;
  }

  function removeFromTree(tree, idOrPredicate) {
    var isFn = typeof idOrPredicate === 'function';
    for (var i = 0; i < tree.length; i++) {
      var match = isFn ? idOrPredicate(tree[i]) : (tree[i].id === idOrPredicate);
      if (match) {
        tree.splice(i, 1);
        return true;
      }
      if (tree[i].type === 'folder' && tree[i].children) {
        if (removeFromTree(tree[i].children, idOrPredicate)) return true;
      }
    }
    return false;
  }

  function flattenFeeds(tree, folderId) {
    var feeds = [];
    (tree || []).forEach(function (item) {
      if (item.type === 'feed') {
        feeds.push(Object.assign({}, item, { folderId: folderId || item.folderId || null }));
      } else if (item.type === 'folder' && item.children) {
        feeds = feeds.concat(flattenFeeds(item.children, item.id));
      }
    });
    return feeds;
  }

  function buildFolderTree(nodes, parentId, level) {
    var result = [];
    level = level || 0;
    (nodes || []).forEach(function (item) {
      if (item.type === 'folder') {
        var directFeeds = (item.children || []).filter(function(c) { return c.type === 'feed'; });
        var childFolders = (item.children || []).filter(function(c) { return c.type === 'folder'; });
        var allDescendantFeeds = flattenFeeds(item.children || [], item.id);
        result.push({
          id: item.id,
          name: item.name,
          type: 'folder',
          parentId: parentId || item.parentId || null,
          level: level,
          directFeedCount: directFeeds.length,
          totalFeedCount: allDescendantFeeds.length,
          children: buildFolderTree(childFolders, item.id, level + 1),
          createdAt: item.createdAt
        });
      }
    });
    return result;
  }

  function flattenFolderTree(folderTree) {
    var flat = [];
    (folderTree || []).forEach(function (f) {
      flat.push(f);
      if (f.children && f.children.length) {
        flat = flat.concat(flattenFolderTree(f.children));
      }
    });
    return flat;
  }

  function loadFolderTree() {
    return fetchTree().then(function (data) {
      return buildFolderTree(data.tree, null, 0);
    });
  }

  function findPathInTree(tree, targetId, currentPath) {
    currentPath = currentPath || [];
    for (var i = 0; i < tree.length; i++) {
      var item = tree[i];
      if (item.type === 'folder') {
        var newPath = currentPath.concat([{ id: item.id, name: item.name }]);
        if (item.id === targetId) return newPath;
        if (item.children && item.children.length) {
          var found = findPathInTree(item.children, targetId, newPath);
          if (found) return found;
        }
      }
    }
    return null;
  }

  function getFolderPath(folderId) {
    return fetchTree().then(function (data) {
      if (!folderId || folderId === UNCATEGORISED_ID) return [];
      return findPathInTree(data.tree, folderId, []) || [];
    });
  }

  function loadFolders() {
    return loadFolderTree().then(function (tree) {
      return flattenFolderTree(tree);
    });
  }

  function createFolder(name, parentId) {
    return fetchTree().then(function (data) {
      var trimmedName = String(name || '').trim();
      if (!trimmedName) return { ok: false, message: 'Folder name cannot be empty.' };

      var RESERVED_NAMES = ['uncategorised', 'all feeds', 'all'];
      if (RESERVED_NAMES.indexOf(trimmedName.toLowerCase()) !== -1) {
        return { ok: false, message: '"' + trimmedName + '" is a reserved name. Please choose a different folder name.' };
      }

      var scopeContainer = data.tree;
      if (parentId) {
        var parent = findInTree(data.tree, function (i) { return i.id === parentId; });
        if (parent && parent.type === 'folder') {
          if (!parent.children) parent.children = [];
          scopeContainer = parent.children;
        }
      }

      var duplicate = scopeContainer.find(function (i) {
        return i.type === 'folder' && String(i.name || '').trim().toLowerCase() === trimmedName.toLowerCase();
      });
      if (duplicate) {
        return { ok: true, folder: duplicate, reused: true };
      }

      var id = 'pff_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      var newFolder = {
        type: 'folder',
        id: id,
        name: trimmedName,
        parentId: parentId || null,
        children: [],
        createdAt: new Date().toISOString()
      };

      scopeContainer.push(newFolder);
      return commitTree().then(function (res) {
        return { ok: res.ok, folder: newFolder, created: true };
      });
    });
  }

  function deleteFolder(id, forceDelete) {
    return fetchTree().then(function (data) {
      var folder = findInTree(data.tree, function (i) { return i.id === id; });
      if (!folder) return { ok: false, message: 'Folder not found' };

      var orphanFeeds = flattenFeeds(folder.children || [], null);

      if (orphanFeeds.length && !forceDelete) {
        return {
          ok: false, warn: true,
          message: 'Folder "' + folder.name + '" has ' + orphanFeeds.length + ' feed(s). They will be moved to Uncategorised. Continue?'
        };
      }

      removeFromTree(data.tree, id);

      orphanFeeds.forEach(function (feed) {
        feed.folderId = null;
        data.tree.unshift(feed);
      });

      return commitTree();
    });
  }

  function loadFeeds() {
    return fetchTree().then(function (data) {
      var feeds = flattenFeeds(data.tree);
      return feeds.sort(function (a, b) {
        if (a.starred && !b.starred) return -1;
        if (!a.starred && b.starred) return 1;
        return String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
      });
    });
  }

  function saveFeed(entry) {
    return fetchTree().then(function (data) {
      var folderId = entry.folderId || null;
      var newFeed = Object.assign({}, entry, {
        type: 'feed',
        id: entry.id || ('sf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7)),
        folderId: folderId,
        savedAt: entry.savedAt || new Date().toISOString()
      });

      // Dedupe by URL
      removeFromTree(data.tree, function (item) {
        return item.type === 'feed' && (
          (item.feedUrl && item.feedUrl === newFeed.feedUrl) ||
          (item.id && item.id === newFeed.id)
        );
      });

      var targetContainer = data.tree;
      if (folderId && folderId !== UNCATEGORISED_ID) {
        var folder = findInTree(data.tree, function (i) { return i.id === folderId; });
        if (folder && folder.type === 'folder') {
          if (!folder.children) folder.children = [];
          targetContainer = folder.children;
        }
      }
      targetContainer.unshift(newFeed);

      return commitTree().then(function (res) {
        return { ok: res.ok, feed: newFeed };
      });
    });
  }

  function deleteFeed(id) {
    return fetchTree().then(function (data) {
      removeFromTree(data.tree, id);
      return commitTree();
    });
  }

  function starFeed(id, starred) {
    return fetchTree().then(function (data) {
      var feed = findInTree(data.tree, function (i) { return i.id === id; });
      if (feed) {
        feed.starred = !!starred;
        return commitTree();
      }
      return { ok: false, message: 'Feed not found' };
    });
  }

  function moveFeed(feedId, folderId) {
    return fetchTree().then(function (data) {
      var feed = findInTree(data.tree, function (i) { return i.id === feedId; });
      if (!feed) return { ok: false, message: 'Feed not found' };

      removeFromTree(data.tree, feedId);

      feed.folderId = (folderId === UNCATEGORISED_ID ? null : (folderId || null));

      var targetContainer = data.tree;
      if (folderId && folderId !== UNCATEGORISED_ID) {
        var folder = findInTree(data.tree, function (i) { return i.id === folderId; });
        if (folder && folder.type === 'folder') {
          if (!folder.children) folder.children = [];
          targetContainer = folder.children;
        }
      }
      targetContainer.unshift(feed);

      return commitTree().then(function (res) {
        return { ok: res.ok, feed: feed };
      });
    });
  }

  function exportJson() {
    return fetchTree().then(function (data) {
      return JSON.stringify(data, null, 2);
    });
  }

  function importJson(jsonStr) {
    var data;
    try {
      data = JSON.parse(jsonStr);
      if (data.tree && Array.isArray(data.tree)) {
        _treeCache = data;
        return commitTree();
      }
    } catch (e) {
      return Promise.resolve({ ok: false, message: 'Invalid JSON' });
    }
    return Promise.resolve({ ok: false, message: 'Format not supported for direct import' });
  }

  /* ── Public API Definition ─────────────────────────────────────── */
  var apiInstance = {
    UNCATEGORISED_ID: UNCATEGORISED_ID,

    /* Folders */
    loadFolders: loadFolders,
    loadFolderTree: loadFolderTree,
    getFolderPath: getFolderPath,
    createFolder: createFolder,
    deleteFolder: deleteFolder,
    renameFolder: function (id, name) {
      return fetchTree().then(function (data) {
        var folder = findInTree(data.tree, function (i) { return i.id === id; });
        if (folder) {
          folder.name = String(name || '').trim();
          return commitTree().then(function (res) { return { ok: res.ok, folder: folder }; });
        }
        return { ok: false, message: 'Folder not found' };
      });
    },

    /* Feeds */
    load: loadFeeds,
    getFeed: function (idOrUrl) {
      return fetchTree().then(function (data) {
        if (!idOrUrl) return null;
        return findInTree(data.tree, function (i) {
          return i.type === 'feed' && (i.id === idOrUrl || i.feedUrl === idOrUrl);
        }) || null;
      });
    },
    getFolder: function (id) {
      return fetchTree().then(function (data) {
        if (!id) return null;
        return findInTree(data.tree, function (i) { return i.id === id && i.type === 'folder'; }) || null;
      });
    },
    getFolderFeeds: function (folderId) {
      return fetchTree().then(function (data) {
        if (!folderId) {
          return loadFeeds();
        }
        if (folderId === UNCATEGORISED_ID) {
          var all = flattenFeeds(data.tree);
          return all.filter(function (f) {
            return !f.folderId || f.folderId === UNCATEGORISED_ID;
          });
        }
        var folder = findInTree(data.tree, function (i) { return i.id === folderId && i.type === 'folder'; });
        if (!folder) return [];
        return flattenFeeds(folder.children || [], folder.id);
      });
    },
    add: saveFeed,
    saveFeed: saveFeed,
    remove: deleteFeed,
    setStarred: starFeed,
    moveToFolder: moveFeed,

    /* Backup */
    exportJson: exportJson,
    importFeeds: importJson,

    /* Cache */
    clearCache: function () { _treeCache = null; }
  };

  w.BLINK_WATCHLISTS = apiInstance;
  w.WatchlistsAPI = apiInstance;

  if (w.FeedOmeterAuth && typeof w.FeedOmeterAuth.onChange === 'function') {
    w.FeedOmeterAuth.onChange(function () {
      _treeCache = null;
    });
  }

})(window);
