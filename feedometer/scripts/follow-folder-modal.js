/**
 * scripts/follow-folder-modal.js — Follow & Watchlists Folder Selection Modal
 * Displays an inline folder selector when following a feed, supports on-the-fly folder creation,
 * and commits the feed directly into the chosen Watchlist folder without page redirects.
 */
(function (w) {
  'use strict';

  var currentFeed = null;
  var currentOptions = null;
  var selectedFolderId = 'pff_uncategorised';
  var isInitialized = false;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getApi() {
    return w.BLINK_WATCHLISTS || w.WatchlistsAPI || (w.parent && (w.parent.BLINK_WATCHLISTS || w.parent.WatchlistsAPI)) || null;
  }

  function showToast(msg) {
    if (typeof w.showToast === 'function') {
      w.showToast(msg);
      return;
    }
    var t = document.createElement('div');
    t.className = 'ffm-toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:700;z-index:9999999;box-shadow:0 10px 25px rgba(0,0,0,0.3);animation:ffmFadeIn 0.2s;pointer-events:none;';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      t.style.transition = 'opacity 0.25s ease';
      setTimeout(function () { t.remove(); }, 260);
    }, 2400);
  }

  function ensureModalStyles() {
    if ($('ffm-styles-link')) return;
    var link = document.createElement('link');
    link.id = 'ffm-styles-link';
    link.rel = 'stylesheet';
    link.href = 'styles/follow-folder-modal.css';
    document.head.appendChild(link);
  }

  function createModalDom() {
    ensureModalStyles();
    if ($('ffm-backdrop')) return;

    var backdrop = document.createElement('div');
    backdrop.id = 'ffm-backdrop';
    backdrop.className = 'ffm-backdrop';
    backdrop.setAttribute('hidden', '');
    backdrop.innerHTML = [
      '<div class="ffm-modal" role="dialog" aria-modal="true" aria-labelledby="ffm-title">',
      '  <div class="ffm-header">',
      '    <div class="ffm-title-wrap">',
      '      <div class="ffm-title-icon">',
      '        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
      '      </div>',
      '      <h3 class="ffm-title" id="ffm-title">Follow Feed</h3>',
      '    </div>',
      '    <button type="button" class="ffm-close-btn" id="ffm-close-btn" aria-label="Close modal">&times;</button>',
      '  </div>',
      '',
      '  <div class="ffm-feed-preview" id="ffm-feed-preview">',
      '    <div class="ffm-feed-avatar" id="ffm-feed-avatar">📰</div>',
      '    <div class="ffm-feed-info">',
      '      <div class="ffm-feed-name" id="ffm-feed-name">Feed Title</div>',
      '      <div class="ffm-feed-meta" id="ffm-feed-meta">https://example.com/feed</div>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="ffm-body">',
      '    <div class="ffm-section-label">',
      '      <span>Select Watchlist Folder</span>',
      '    </div>',
      '    <div class="ffm-folder-list" id="ffm-folder-list">',
      '      <!-- Rendered dynamically -->',
      '    </div>',
      '',
      '    <div class="ffm-new-folder-wrap">',
      '      <button type="button" class="ffm-new-folder-trigger" id="ffm-new-folder-trigger">',
      '        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
      '        <span>+ Create New Folder</span>',
      '      </button>',
      '      <form class="ffm-new-folder-form" id="ffm-new-folder-form" style="display:none;" onsubmit="return false;">',
      '        <input type="text" class="ffm-new-folder-input" id="ffm-new-folder-input" placeholder="Enter folder name..." maxlength="40" autocomplete="off"/>',
      '        <button type="button" class="ffm-new-folder-cancel-btn" id="ffm-new-folder-cancel">Cancel</button>',
      '        <button type="submit" class="ffm-new-folder-create-btn" id="ffm-new-folder-submit">Create</button>',
      '      </form>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="ffm-footer">',
      '    <button type="button" class="ffm-btn-cancel" id="ffm-cancel-btn">Cancel</button>',
      '    <button type="button" class="ffm-btn-confirm" id="ffm-confirm-btn">',
      '      <span>Follow &amp; Save</span>',
      '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>',
      '    </button>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(backdrop);
    bindModalEvents();
  }

  function bindModalEvents() {
    var backdrop = $('ffm-backdrop');
    var closeBtn = $('ffm-close-btn');
    var cancelBtn = $('ffm-cancel-btn');
    var confirmBtn = $('ffm-confirm-btn');
    var newFolderTrigger = $('ffm-new-folder-trigger');
    var newFolderForm = $('ffm-new-folder-form');
    var newFolderInput = $('ffm-new-folder-input');
    var newFolderCancel = $('ffm-new-folder-cancel');
    var newFolderSubmit = $('ffm-new-folder-submit');

    function close() {
      if (backdrop) backdrop.setAttribute('hidden', '');
      if (currentOptions && typeof currentOptions.onCancel === 'function') {
        currentOptions.onCancel();
      }
      currentFeed = null;
      currentOptions = null;
    }

    if (closeBtn) closeBtn.onclick = close;
    if (cancelBtn) cancelBtn.onclick = close;

    if (backdrop) {
      backdrop.onclick = function (e) {
        if (e.target === backdrop) close();
      };
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && backdrop && !backdrop.hasAttribute('hidden')) {
        close();
      }
    });

    if (newFolderTrigger && newFolderForm) {
      newFolderTrigger.onclick = function () {
        newFolderTrigger.style.display = 'none';
        newFolderForm.style.display = 'flex';
        newFolderInput.value = '';
        newFolderInput.focus();
      };
    }

    if (newFolderCancel && newFolderTrigger && newFolderForm) {
      newFolderCancel.onclick = function () {
        newFolderForm.style.display = 'none';
        newFolderTrigger.style.display = 'flex';
      };
    }

    function handleCreateFolder() {
      var name = (newFolderInput ? newFolderInput.value : '').trim();
      if (!name) return;

      var api = getApi();
      if (api && typeof api.createFolder === 'function') {
        api.createFolder(name).then(function (res) {
          if (res && res.folder) {
            selectedFolderId = res.folder.id;
            try { localStorage.setItem('feedometer_last_selected_folder', selectedFolderId); } catch(e) {}
            renderFolders();
            newFolderForm.style.display = 'none';
            newFolderTrigger.style.display = 'flex';
            showToast('Created folder "' + name + '"');
          }
        }).catch(function (err) {
          console.error('[FollowModal] Folder create failed:', err);
          showToast('Could not create folder');
        });
      } else {
        var tempId = 'pff_' + Date.now().toString(36);
        selectedFolderId = tempId;
        newFolderForm.style.display = 'none';
        newFolderTrigger.style.display = 'flex';
        renderFolders();
      }
    }

    if (newFolderSubmit) newFolderSubmit.onclick = handleCreateFolder;
    if (newFolderForm) {
      newFolderForm.onsubmit = function (e) {
        e.preventDefault();
        handleCreateFolder();
      };
    }

    if (confirmBtn) {
      confirmBtn.onclick = function () {
        if (!currentFeed) {
          close();
          return;
        }

        var api = getApi();
        var feedObj = Object.assign({}, currentFeed, {
          folderId: (selectedFolderId === 'pff_uncategorised' ? null : selectedFolderId),
          savedAt: new Date().toISOString()
        });

        if (api && typeof api.add === 'function') {
          confirmBtn.disabled = true;
          confirmBtn.innerHTML = '<span>Saving...</span>';

          api.add(feedObj).then(function (res) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<span>Follow &amp; Save</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
            
            var saved = (res && res.feed) ? res.feed : feedObj;
            try { localStorage.setItem('feedometer_last_selected_folder', selectedFolderId); } catch(e) {}

            var chosenFolderName = getFolderName(selectedFolderId);
            showToast('✓ Followed "' + (feedObj.title || 'Feed') + '" in ' + chosenFolderName);

            try { document.dispatchEvent(new CustomEvent('watchlists-changed')); } catch(e) {}
            try { document.dispatchEvent(new CustomEvent('rss-feeds-updated')); } catch(e) {}
            try {
              if (w.parent && w.parent !== w) {
                w.parent.postMessage({ type: 'watchlists-changed' }, '*');
                w.parent.postMessage({ type: 'rss-feeds-updated' }, '*');
              }
            } catch(e) {}

            if (currentOptions && typeof currentOptions.onFollow === 'function') {
              currentOptions.onFollow(saved, { id: selectedFolderId, name: chosenFolderName });
            }

            if (backdrop) backdrop.setAttribute('hidden', '');
            currentFeed = null;
            currentOptions = null;
          }).catch(function (err) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<span>Follow &amp; Save</span>';
            console.error('[FollowModal] Save feed failed:', err);
            showToast('Error saving feed to folder');
          });
        } else {
          showToast('✓ Followed ' + (feedObj.title || 'Feed'));
          if (currentOptions && typeof currentOptions.onFollow === 'function') {
            currentOptions.onFollow(feedObj, { id: selectedFolderId, name: getFolderName(selectedFolderId) });
          }
          if (backdrop) backdrop.setAttribute('hidden', '');
        }
      };
    }
  }

  var cachedFolders = [];

  function getFolderName(folderId) {
    if (!folderId || folderId === 'pff_uncategorised') return 'Uncategorised';
    var found = cachedFolders.find(function (f) { return f.id === folderId; });
    return found ? found.name : 'Folder';
  }

  function renderFolders() {
    var container = $('ffm-folder-list');
    if (!container) return;

    var api = getApi();
    var treePromise = (api && typeof api.loadFolderTree === 'function')
      ? api.loadFolderTree()
      : (api && typeof api.loadFolders === 'function' ? api.loadFolders() : Promise.resolve([]));

    var flatPromise = (api && typeof api.loadFolders === 'function')
      ? api.loadFolders()
      : Promise.resolve([]);

    Promise.all([treePromise, flatPromise]).then(function (results) {
      var folderTree = results[0] || [];
      cachedFolders = results[1] || [];
      var html = [];

      // 1. Uncategorised (Root) option
      var isUncat = (selectedFolderId === 'pff_uncategorised' || !selectedFolderId);
      html.push(
        '<div class="ffm-folder-item' + (isUncat ? ' selected' : '') + '" data-folder-id="pff_uncategorised">',
        '  <div class="ffm-folder-radio"></div>',
        '  <span class="ffm-folder-ic">📁</span>',
        '  <span class="ffm-folder-name">Uncategorised / All Watchlists</span>',
        '  <span class="ffm-folder-count">Root</span>',
        '</div>'
      );

      // Recursive render helper
      function renderFolderNodeHtml(folder, indent) {
        indent = indent || 0;
        var isSel = (folder.id === selectedFolderId);
        var count = folder.totalFeedCount !== undefined ? folder.totalFeedCount : (folder.directFeedCount || 0);
        var padStyle = indent > 0 ? ' style="padding-left: ' + (14 + indent * 18) + 'px;"' : '';
        var prefix = indent > 0 ? '<span style="color:var(--muted);margin-right:4px;">└─</span> ' : '';
        html.push(
          '<div class="ffm-folder-item' + (isSel ? ' selected' : '') + '" data-folder-id="' + escapeHtml(folder.id) + '"' + padStyle + '>',
          '  <div class="ffm-folder-radio"></div>',
          '  <span class="ffm-folder-ic">📁</span>',
          '  <span class="ffm-folder-name">' + prefix + escapeHtml(folder.name) + '</span>',
          '  <span class="ffm-folder-count">' + count + ' feed' + (count === 1 ? '' : 's') + '</span>',
          '</div>'
        );
        if (folder.children && folder.children.length) {
          folder.children.forEach(function (child) {
            renderFolderNodeHtml(child, indent + 1);
          });
        }
      }

      // 2. Custom Folders & Subfolders
      if (folderTree.length) {
        folderTree.forEach(function (folder) {
          renderFolderNodeHtml(folder, 0);
        });
      } else {
        cachedFolders.forEach(function (folder) {
          renderFolderNodeHtml(folder, 0);
        });
      }

      container.innerHTML = html.join('\n');

      // Bind selection clicks
      container.querySelectorAll('.ffm-folder-item').forEach(function (item) {
        item.onclick = function () {
          var fid = item.getAttribute('data-folder-id');
          selectedFolderId = fid;
          try { localStorage.setItem('feedometer_last_selected_folder', selectedFolderId); } catch(e) {}
          container.querySelectorAll('.ffm-folder-item').forEach(function (it) {
            it.classList.toggle('selected', it === item);
          });
          updateConfirmBtnLabel();
        };
      });

      updateConfirmBtnLabel();
    }).catch(function (err) {
      console.error('[FollowModal] Load folders error:', err);
    });
  }

  function updateConfirmBtnLabel() {
    var confirmBtn = $('ffm-confirm-btn');
    if (!confirmBtn) return;
    var name = getFolderName(selectedFolderId);
    confirmBtn.innerHTML = '<span>Save to ' + escapeHtml(name) + '</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  /* ── Public API ─────────────────────────────────────────────────── */
  var FollowFolderModal = {
    open: function (feedData, options) {
      createModalDom();
      currentFeed = feedData || {};
      currentOptions = options || {};

      try {
        var last = localStorage.getItem('feedometer_last_selected_folder');
        if (last) selectedFolderId = last;
      } catch(e) {}

      // Update feed preview info
      var nameEl = $('ffm-feed-name');
      var metaEl = $('ffm-feed-meta');
      var avEl = $('ffm-feed-avatar');

      if (nameEl) nameEl.textContent = currentFeed.title || currentFeed.name || 'Untitled Feed';
      if (metaEl) metaEl.textContent = currentFeed.feedUrl || currentFeed.siteUrl || currentFeed.url || 'Live RSS Feed';
      
      if (avEl) {
        if (currentFeed.icon || currentFeed.visualUrl) {
          var iconSrc = currentFeed.icon || currentFeed.visualUrl;
          avEl.innerHTML = '<img src="' + escapeHtml(iconSrc) + '" style="width:100%;height:100%;border-radius:8px;object-fit:cover;" onerror="this.parentElement.textContent=\'📰\'"/>';
        } else {
          var initial = (currentFeed.title || currentFeed.name || 'F').charAt(0).toUpperCase();
          avEl.textContent = initial;
        }
      }

      // Hide new folder form if open
      var form = $('ffm-new-folder-form');
      var trig = $('ffm-new-folder-trigger');
      if (form) form.style.display = 'none';
      if (trig) trig.style.display = 'flex';

      renderFolders();

      var backdrop = $('ffm-backdrop');
      if (backdrop) backdrop.removeAttribute('hidden');
    },

    unfollow: function (feedIdOrUrl, feedTitle, options) {
      var api = getApi();
      if (api && typeof api.remove === 'function') {
        return api.remove(feedIdOrUrl).then(function () {
          showToast('Removed ' + (feedTitle || 'feed') + ' from watchlists');
          try { document.dispatchEvent(new CustomEvent('watchlists-changed')); } catch(e) {}
          try { document.dispatchEvent(new CustomEvent('rss-feeds-updated')); } catch(e) {}
          try {
            if (w.parent && w.parent !== w) {
              w.parent.postMessage({ type: 'watchlists-changed' }, '*');
              w.parent.postMessage({ type: 'rss-feeds-updated' }, '*');
            }
          } catch(e) {}
          if (options && typeof options.onUnfollow === 'function') {
            options.onUnfollow();
          }
        });
      } else {
        showToast('Removed ' + (feedTitle || 'feed'));
        if (options && typeof options.onUnfollow === 'function') {
          options.onUnfollow();
        }
        return Promise.resolve();
      }
    }
  };

  w.FollowFolderModal = FollowFolderModal;

})(window);
