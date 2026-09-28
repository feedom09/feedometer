/**
 * scripts/watchlists-page.js
 * Manages the Watchlists / Organizer page in FeedOmeter.
 * Hierarchical folder sidebar, breadcrumbs, card list, inline folder creation/rename, move modal.
 */
(function (w) {
  'use strict';

  var _folders = [];
  var _folderTree = [];
  var _feeds = [];
  var _activeId = null;
  var _collapsedFolderIds = {};

  var UNCATEGORISED_ID = 'pff_uncategorised';
  var _movingFeedId = null;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showStatus(type, text) {
    var el = $('pf-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'pf-status' + (type === 'error' ? ' is-error' : type === 'ok' ? ' is-ok' : '');
    el.hidden = !text;
    if (text && type !== 'error') {
      clearTimeout(el._timer);
      el._timer = setTimeout(function () { if (el) el.hidden = true; }, 4000);
    }
  }

  /* ── Breadcrumb update ──────────────────────────────────────────────── */
  function updateBreadcrumbs(folderId) {
    var bc = $('pf-breadcrumbs');
    if (!bc) return;
    if (!folderId || folderId === UNCATEGORISED_ID) {
      bc.hidden = true;
      bc.innerHTML = '';
      return;
    }
    var api = w.BLINK_WATCHLISTS || w.WatchlistsAPI;
    if (api && typeof api.getFolderPath === 'function') {
      api.getFolderPath(folderId).then(function (path) {
        if (!path || path.length <= 1) {
          bc.hidden = true;
          bc.innerHTML = '';
          return;
        }
        bc.hidden = false;
        bc.innerHTML = '';

        var allSpan = document.createElement('span');
        allSpan.className = 'pf-crumb-link';
        allSpan.textContent = 'All Feeds';
        allSpan.addEventListener('click', function () { activateFolder(null); });
        bc.appendChild(allSpan);

        path.forEach(function (step, idx) {
          var sep = document.createElement('span');
          sep.className = 'pf-crumb-sep';
          sep.textContent = '›';
          bc.appendChild(sep);

          if (idx === path.length - 1) {
            var curr = document.createElement('span');
            curr.className = 'pf-crumb-current';
            curr.textContent = step.name;
            bc.appendChild(curr);
          } else {
            var link = document.createElement('span');
            link.className = 'pf-crumb-link';
            link.textContent = step.name;
            link.addEventListener('click', function () { activateFolder(step.id); });
            bc.appendChild(link);
          }
        });
      });
    } else {
      bc.hidden = true;
      bc.innerHTML = '';
    }
  }

  /* ── Inline Subfolder creation ──────────────────────────────────────── */
  function promptInlineSubfolder(parentFolder, parentLi) {
    if (!parentLi) return;
    delete _collapsedFolderIds[parentFolder.id];

    var existingInput = document.getElementById('pf-subfolder-input-li');
    if (existingInput) existingInput.remove();

    var childUl = parentLi.querySelector('.pf-folder-children');
    if (!childUl) {
      childUl = document.createElement('ul');
      childUl.className = 'pf-folder-children';
      parentLi.appendChild(childUl);
    }
    childUl.classList.remove('is-collapsed');

    var inputLi = document.createElement('li');
    inputLi.id = 'pf-subfolder-input-li';
    inputLi.style.cssText = 'display:flex;gap:4px;padding:4px 4px 4px 8px;margin-top:2px;';

    var inp = document.createElement('input');
    inp.id = 'pf-subfolder-name-input';
    inp.type = 'text';
    inp.placeholder = 'Subfolder name…';
    inp.maxLength = 60;
    inp.style.cssText = 'flex:1;padding:5px 8px;border-radius:6px;border:1px solid #00BF63;font:500 13px/1 var(--sans,system-ui);min-width:0;outline:none;background:var(--paper,#fff);color:var(--ink,#111);';

    var confirmBtn = document.createElement('button');
    confirmBtn.textContent = '✓';
    confirmBtn.title = 'Create subfolder';
    confirmBtn.style.cssText = 'padding:5px 8px;border-radius:6px;border:none;background:#00BF63;color:#fff;font-weight:700;cursor:pointer;flex-shrink:0;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕';
    cancelBtn.title = 'Cancel';
    cancelBtn.style.cssText = 'padding:5px 8px;border-radius:6px;border:1px solid var(--line,#e5e7eb);background:transparent;cursor:pointer;flex-shrink:0;';

    function removeInput() {
      if (inputLi) inputLi.remove();
    }

    function doCreate() {
      var name = inp.value.trim();
      if (!name) { inp.focus(); return; }
      removeInput();
      var api = w.BLINK_WATCHLISTS || w.WatchlistsAPI;
      if (!api) return;
      api.createFolder(name, parentFolder.id)
        .then(function (r) {
          if (!r.ok && !r.reused) { showStatus('error', r.message || 'Could not create subfolder.'); return; }
          if (!r.folder) { showStatus('error', 'Could not create subfolder.'); return; }
          if (r.reused) { showStatus('error', '"' + name + '" already exists in this folder.'); return; }
          showStatus('ok', 'Subfolder "' + name + '" created!');
          loadAll();
          activateFolder(r.folder.id);
        })
        .catch(function (e) { showStatus('error', e.message || 'Could not create subfolder.'); });
    }

    confirmBtn.addEventListener('click', doCreate);
    cancelBtn.addEventListener('click', removeInput);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doCreate();
      if (e.key === 'Escape') removeInput();
    });

    inputLi.appendChild(inp);
    inputLi.appendChild(confirmBtn);
    inputLi.appendChild(cancelBtn);
    childUl.insertBefore(inputLi, childUl.firstChild);
    inp.focus();
  }

  /* ── Recursive Folder Node Render ───────────────────────────────────── */
  function renderFolderNode(folderNode, parentContainer) {
    var li = document.createElement('li');
    li.className = 'pf-folder-item';
    li.setAttribute('data-folder-id', folderNode.id);

    var isAct = _activeId === folderNode.id;
    var hasChildren = folderNode.children && folderNode.children.length > 0;
    var isCollapsed = !!_collapsedFolderIds[folderNode.id];

    var btn = document.createElement('button');
    btn.className = 'pf-folder-btn' + (isAct ? ' is-active' : '');
    btn.setAttribute('data-folder-id', folderNode.id);

    var toggleHtml = '';
    if (hasChildren) {
      toggleHtml = '<span class="pf-folder-toggle-btn' + (isCollapsed ? ' is-collapsed' : '') + '" title="' + (isCollapsed ? 'Expand' : 'Collapse') + '">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</span>';
    }

    var totalCount = folderNode.totalFeedCount !== undefined
      ? folderNode.totalFeedCount
      : (_feeds || []).filter(function(f){ return f.folderId === folderNode.id; }).length;

    btn.innerHTML = [
      toggleHtml,
      '<span class="pf-folder-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></span>',
      '<span class="pf-folder-name">' + esc(folderNode.name) + '</span>',
      '<span class="pf-folder-badge">' + totalCount + '</span>',
      '<span class="pf-folder-actions">',
      '  <span class="pf-folder-action-btn add-sub" title="Add subfolder" aria-label="Add subfolder under ' + esc(folderNode.name) + '">',
      '    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg>',
      '  </span>',
      '  <span class="pf-folder-action-btn ren" title="Rename folder" aria-label="Rename folder ' + esc(folderNode.name) + '">',
      '    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
      '  </span>',
      '  <span class="pf-folder-action-btn del" title="Delete folder" aria-label="Delete folder ' + esc(folderNode.name) + '">',
      '    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
      '  </span>',
      '</span>'
    ].join('');

    var toggleBtn = btn.querySelector('.pf-folder-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _collapsedFolderIds[folderNode.id] = !_collapsedFolderIds[folderNode.id];
        renderFolderList();
      });
    }

    btn.addEventListener('click', function (e) {
      if (e.target.closest('.pf-folder-action-btn') || e.target.closest('.pf-folder-toggle-btn')) return;
      activateFolder(folderNode.id);
    });

    var addSubBtn = btn.querySelector('.pf-folder-action-btn.add-sub');
    if (addSubBtn) {
      addSubBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        promptInlineSubfolder(folderNode, li);
      });
    }

    var renBtn = btn.querySelector('.pf-folder-action-btn.ren');
    if (renBtn) {
      renBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        handleRenameFolder(folderNode);
      });
    }

    var delBtn = btn.querySelector('.pf-folder-action-btn.del');
    if (delBtn) {
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        handleDeleteFolder(folderNode);
      });
    }

    li.appendChild(btn);

    if (hasChildren) {
      var childUl = document.createElement('ul');
      childUl.className = 'pf-folder-children' + (isCollapsed ? ' is-collapsed' : '');
      folderNode.children.forEach(function (child) {
        renderFolderNode(child, childUl);
      });
      li.appendChild(childUl);
    }

    parentContainer.appendChild(li);
  }

  /* ── Folder sidebar render ───────────────────────────────────────── */
  function renderFolderList() {
    var sidebar = $('pf-folder-nav');
    if (!sidebar) return;
    sidebar.innerHTML = '';

    /* "All Feeds" entry */
    var totalFeedsCount = (_feeds || []).length;
    var allLi = document.createElement('li');
    allLi.className = 'pf-folder-item';
    var allBtn = document.createElement('button');
    allBtn.className = 'pf-folder-btn' + (_activeId === null ? ' is-active' : '');
    allBtn.setAttribute('data-folder-id', '');
    allBtn.innerHTML = [
      '<span class="pf-folder-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></span>',
      '<span class="pf-folder-name">All Feeds</span>',
      '<span class="pf-folder-badge">' + totalFeedsCount + '</span>'
    ].join('');
    allBtn.addEventListener('click', function () { activateFolder(null); });
    allLi.appendChild(allBtn);
    sidebar.appendChild(allLi);

    /* Uncategorised entry if any feeds lack a folder */
    var uncatFeeds = (_feeds || []).filter(function(f){ return !f.folderId || f.folderId === UNCATEGORISED_ID; });
    if (uncatFeeds.length) {
      var uncatLi = document.createElement('li');
      uncatLi.className = 'pf-folder-item';
      var uncatBtn = document.createElement('button');
      uncatBtn.className = 'pf-folder-btn' + (_activeId === UNCATEGORISED_ID ? ' is-active' : '');
      uncatBtn.setAttribute('data-folder-id', UNCATEGORISED_ID);
      uncatBtn.innerHTML = [
        '<span class="pf-folder-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></span>',
        '<span class="pf-folder-name">Uncategorised</span>',
        '<span class="pf-folder-badge">' + uncatFeeds.length + '</span>'
      ].join('');
      uncatBtn.addEventListener('click', function () { activateFolder(UNCATEGORISED_ID); });
      uncatLi.appendChild(uncatBtn);
      sidebar.appendChild(uncatLi);
    }

    /* User created folders hierarchy */
    var treeToRender = (_folderTree && _folderTree.length) ? _folderTree : _folders;
    treeToRender.forEach(function (folder) {
      renderFolderNode(folder, sidebar);
    });
  }

  function getDescendantFolderIds(folderId, tree) {
    var ids = [folderId];
    function traverse(nodes) {
      (nodes || []).forEach(function(node) {
        if (node.id === folderId) {
          collectChildrenIds(node.children || []);
        } else if (node.children && node.children.length) {
          traverse(node.children);
        }
      });
    }
    function collectChildrenIds(children) {
      (children || []).forEach(function(child) {
        ids.push(child.id);
        if (child.children && child.children.length) {
          collectChildrenIds(child.children);
        }
      });
    }
    traverse(tree || _folderTree || []);
    return ids;
  }

  /* ── Domain extractor & Favicon ─────────────────────────────────── */
  function cleanDomain(feed) {
    var url = feed.siteUrl || feed.feedUrl || feed.url || '';
    try {
      var parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch (e) {
      return url.slice(0, 40);
    }
  }

  function faviconUrl(feed) {
    var domain = cleanDomain(feed);
    return 'https://www.google.com/s2/favicons?sz=32&domain=' + encodeURIComponent(domain || 'google.com');
  }

  /* ── Build Feed Card Element ────────────────────────────────────── */
  function buildCard(feed) {
    var li = document.createElement('li');
    li.className = 'pf-card' + (feed.starred ? ' starred' : '');
    li.setAttribute('data-id', feed.id);
    li.setAttribute('data-title', (feed.title || feed.name || '').toLowerCase());
    li.setAttribute('data-domain', cleanDomain(feed).toLowerCase());

    var folder = _folders.find(function (f) { return f.id === feed.folderId; });
    var folderLabel = folder ? folder.name
      : (feed.folderId === UNCATEGORISED_ID || !feed.folderId) ? 'Uncategorised' : '';

    var savedDate = '';
    if (feed.savedAt) {
      try { savedDate = new Date(feed.savedAt).toLocaleDateString(); } catch (e) {}
    }

    var domain = cleanDomain(feed);
    var favUrl = feed.icon || faviconUrl(feed);
    var readHref = 'reader.html?url=' + encodeURIComponent(feed.feedUrl || '')
      + '&title=' + encodeURIComponent(feed.title || feed.name || '')
      + '&folder=' + encodeURIComponent(feed.folderId || '');
    var editHref = 'add-source.html?url=' + encodeURIComponent(feed.feedUrl || '');

    var favImg = document.createElement('img');
    favImg.className = 'pf-card-favicon';
    favImg.alt = '';
    favImg.loading = 'lazy';
    favImg.src = favUrl;
    var favFallback = document.createElement('div');
    favFallback.className = 'pf-card-favicon-fallback';
    favFallback.style.display = 'none';
    favFallback.textContent = '📰';
    favImg.addEventListener('error', function () {
      favImg.style.display = 'none';
      favFallback.style.display = 'flex';
    });
    li.appendChild(favImg);
    li.appendChild(favFallback);

    var cardRest = document.createElement('div');
    cardRest.style.cssText = 'display:contents';
    cardRest.innerHTML =
      '<div class="pf-card-body">' +
        '<div class="pf-card-title-row">' +
          '<h3 class="pf-card-title">' + esc(feed.title || feed.name || 'Feed') + '</h3>' +
          '<button class="pf-star-btn" title="' + (feed.starred ? 'Unstar' : 'Star') + '" aria-label="' + (feed.starred ? 'Unstar' : 'Star') + '">' + (feed.starred ? '★' : '☆') + '</button>' +
        '</div>' +
        '<span class="pf-card-domain">' + esc(domain) + '</span>' +
        '<div class="pf-card-tags">' +
          (folderLabel ? '<span class="pf-tag folder-tag">📁 ' + esc(folderLabel) + '</span>' : '') +
          (feed.itemCount != null ? '<span class="pf-tag">' + feed.itemCount + ' articles</span>' : '') +
          (savedDate ? '<span class="pf-tag">Saved ' + savedDate + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="pf-card-actions">' +
        '<a href="' + readHref + '" class="pf-btn pf-btn-primary pf-read-btn" style="text-decoration:none;white-space:nowrap;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" style="color:#00BF63;"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Read</span></a>' +
        '<div class="pf-menu-wrap">' +
          '<button class="pf-menu-btn" title="More options" aria-label="More options" aria-haspopup="true">⋯</button>' +
          '<div class="pf-dropdown" role="menu">' +
            '<a href="' + editHref + '" class="pf-dropdown-item" role="menuitem">✏️ Edit feed</a>' +
            '<button class="pf-dropdown-item pf-move-item" role="menuitem">📁 Move to folder</button>' +
            '<div class="pf-dropdown-divider"></div>' +
            '<button class="pf-dropdown-item danger pf-remove-item" role="menuitem">🗑 Remove</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    li.appendChild(cardRest);

    // Wire events
    li.querySelector('.pf-star-btn').addEventListener('click', function () {
      var api = w.BLINK_WATCHLISTS || w.WatchlistsAPI;
      if (!api) return;
      api.setStarred(feed.id, !feed.starred)
        .then(function () { loadFeeds(); })
        .catch(function (e) { showStatus('error', e.message || 'Could not update star.'); });
    });

    var menuBtn = li.querySelector('.pf-menu-btn');
    var dropdown = li.querySelector('.pf-dropdown');
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      document.querySelectorAll('.pf-dropdown.is-open').forEach(function (d) {
        if (d !== dropdown) d.classList.remove('is-open');
      });
      dropdown.classList.toggle('is-open');
    });

    li.querySelector('.pf-move-item').addEventListener('click', function () {
      dropdown.classList.remove('is-open');
      openMoveModal(feed.id);
    });

    li.querySelector('.pf-remove-item').addEventListener('click', function () {
      dropdown.classList.remove('is-open');
      if (!confirm('Remove "' + (feed.title || feed.name || 'this feed') + '"?')) return;
      var api = w.BLINK_WATCHLISTS || w.WatchlistsAPI;
      if (!api) return;
      api.remove(feed.id)
        .then(function () { loadAll(); })
        .catch(function (e) { showStatus('error', e.message || 'Could not remove.'); });
    });

    return li;
  }

  /* ── Feed list render ───────────────────────────────────────────── */
  function renderFeedList() {
    var container = $('pf-feed-list');
    var emptyEl   = $('pf-empty');
    var heading   = $('pf-heading');
    if (!container) return;

    var allowedFolderIds = _activeId === null
      ? null
      : (_activeId === UNCATEGORISED_ID ? [UNCATEGORISED_ID, null, ''] : getDescendantFolderIds(_activeId, _folderTree));

    var list = allowedFolderIds === null
      ? (_feeds || []).slice()
      : (_feeds || []).filter(function (f) {
          var fId = f.folderId || UNCATEGORISED_ID;
          return allowedFolderIds.indexOf(fId) !== -1 || (_activeId === UNCATEGORISED_ID && !f.folderId);
        });

    list.sort(function (a, b) {
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      return String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
    });

    if (heading) {
      var readBtn = $('pf-read-folder-stream-btn');
      var targetUrls = list.map(function(f){ return f.feedUrl; }).filter(Boolean);
      if (readBtn) {
        var folderTitle = (_activeId === null) ? 'All Feeds' : ((_folders.find(function(x){ return x.id === _activeId; }) || {}).name || 'Watchlists');
        if (targetUrls.length) {
          readBtn.href = 'reader.html?folder=' + encodeURIComponent(_activeId || 'all') + '&title=' + encodeURIComponent(folderTitle);
          readBtn.style.display = '';
        } else {
          readBtn.style.display = 'none';
        }
      }
      if (_activeId === null) {
        heading.textContent = 'All Feeds' + (_feeds.length ? ' (' + _feeds.length + ')' : '');
        if (readBtn) {
          readBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg><span>Read All Feeds (' + targetUrls.length + ')</span>';
        }
      } else {
        var f = _folders.find(function (x) { return x.id === _activeId; });
        var folderTitle = f ? f.name : 'Watchlists';
        heading.textContent = folderTitle + ' (' + list.length + ')';
        if (readBtn) {
          readBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg><span>Read "' + esc(folderTitle) + '"</span>';
        }
      }
    }

    container.innerHTML = '';

    if (!list.length) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    list.forEach(function (feed) {
      container.appendChild(buildCard(feed));
    });
  }

  /* ── Folder activation ──────────────────────────────────────────── */
  function activateFolder(folderId) {
    _activeId = folderId;

    try {
      var newUrl = folderId
        ? (window.location.pathname + '?folder=' + encodeURIComponent(folderId))
        : window.location.pathname;
      history.replaceState(null, '', newUrl);
    } catch (e) {}

    try { document.dispatchEvent(new CustomEvent('pf-folder-changed')); } catch (e) {}

    updateBreadcrumbs(folderId);
    renderFolderList();
    renderFeedList();
  }

  /* ── Move-to-folder modal ───────────────────────────────────────── */
  function renderMoveTree(nodes, list, indent) {
    indent = indent || 0;
    (nodes || []).forEach(function (node) {
      var li = document.createElement('li');
      li.className = 'pf-modal-folder-item';
      li.style.paddingLeft = (12 + indent * 16) + 'px';
      li.textContent = (indent > 0 ? '└─ ' : '📁 ') + node.name;
      li.addEventListener('click', function () { doMove(node.id); });
      list.appendChild(li);
      if (node.children && node.children.length) {
        renderMoveTree(node.children, list, indent + 1);
      }
    });
  }

  function openMoveModal(feedId) {
    _movingFeedId = feedId;
    var modal = $('pf-move-modal');
    var list = $('pf-move-folder-list');
    if (!modal || !list) return;

    list.innerHTML = '';

    var uncatLi = document.createElement('li');
    uncatLi.className = 'pf-modal-folder-item';
    uncatLi.textContent = '📂 Uncategorised';
    uncatLi.addEventListener('click', function () { doMove(null); });
    list.appendChild(uncatLi);

    if (_folderTree && _folderTree.length) {
      renderMoveTree(_folderTree, list, 0);
    } else {
      _folders.forEach(function (folder) {
        var li = document.createElement('li');
        li.className = 'pf-modal-folder-item';
        li.textContent = '📁 ' + folder.name;
        li.addEventListener('click', function () { doMove(folder.id); });
        list.appendChild(li);
      });
    }

    modal.classList.add('is-open');
  }

  function doMove(targetFolderId) {
    var modal = $('pf-move-modal');
    if (modal) modal.classList.remove('is-open');
    if (!_movingFeedId) return;
    var api = w.BLINK_WATCHLISTS || w.WatchlistsAPI;
    if (!api) return;
    api.moveToFolder(_movingFeedId, targetFolderId)
      .then(function () {
        showStatus('ok', 'Feed moved.');
        _movingFeedId = null;
        loadAll();
      })
      .catch(function (e) {
        showStatus('error', e.message || 'Could not move feed.');
        _movingFeedId = null;
      });
  }

  /* ── Rename Folder ──────────────────────────────────────────────── */
  function handleRenameFolder(folder) {
    var sidebar = $('pf-folder-nav');
    if (!sidebar) return;
    var li = sidebar.querySelector('[data-folder-id="' + folder.id + '"]');
    if (!li) return;
    var parentLi = li.closest('li');
    if (!parentLi) return;

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = folder.name;
    inp.maxLength = 60;
    inp.style.cssText = 'flex:1;padding:5px 8px;border-radius:6px;border:1px solid #00BF63;font:500 13px/1 var(--sans,system-ui);min-width:0;outline:none;width:100%;';

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;padding:4px 4px 4px 8px;';

    var okBtn = document.createElement('button');
    okBtn.textContent = '✓';
    okBtn.style.cssText = 'padding:5px 8px;border-radius:6px;border:none;background:#00BF63;color:#fff;font-weight:700;cursor:pointer;';
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕';
    cancelBtn.style.cssText = 'padding:5px 8px;border-radius:6px;border:1px solid var(--line,#e5e7eb);background:transparent;cursor:pointer;';

    function restore() { parentLi.innerHTML = ''; parentLi.appendChild(li.cloneNode(true)); renderFolderList(); }

    function doRename() {
      var newName = inp.value.trim();
      if (!newName || newName === folder.name) { restore(); return; }
      var RESERVED = ['uncategorised', 'all feeds', 'all'];
      if (RESERVED.indexOf(newName.toLowerCase()) !== -1) {
        showStatus('error', '"' + newName + '" is a reserved name.');
        return;
      }
      var api = w.BLINK_WATCHLISTS || w.WatchlistsAPI;
      if (!api) return;
      api.renameFolder(folder.id, newName)
        .then(function (r) {
          if (!r.ok) { showStatus('error', r.message || 'Could not rename folder.'); restore(); return; }
          showStatus('ok', 'Folder renamed to "' + newName + '".');
          loadAll();
        })
        .catch(function (e) { showStatus('error', e.message || 'Could not rename folder.'); restore(); });
    }

    okBtn.addEventListener('click', doRename);
    cancelBtn.addEventListener('click', restore);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doRename();
      if (e.key === 'Escape') restore();
    });

    row.appendChild(inp);
    row.appendChild(okBtn);
    row.appendChild(cancelBtn);
    parentLi.innerHTML = '';
    parentLi.appendChild(row);
    inp.focus();
    inp.select();
  }

  /* ── Delete Folder ──────────────────────────────────────────────── */
  function handleDeleteFolder(folder) {
    var api = w.BLINK_WATCHLISTS || w.WatchlistsAPI;
    if (!api) return;
    api.deleteFolder(folder.id, false)
      .then(function (d) {
        if (d.ok) { if (_activeId === folder.id) activateFolder(null); loadAll(); return; }
        if (d.warn) {
          if (!confirm(d.message || 'Delete "' + folder.name + '" and its feeds?')) return;
          return api.deleteFolder(folder.id, true)
            .then(function () {
              if (_activeId === folder.id) activateFolder(null);
              loadAll();
            });
        }
      })
      .catch(function (e) { showStatus('error', e.message || 'Could not delete folder.'); });
  }

  /* ── Data loading ───────────────────────────────────────────────── */
  function loadFolders() {
    var api = w.BLINK_WATCHLISTS || w.WatchlistsAPI;
    if (!api) return;
    var loadTreePromise = (typeof api.loadFolderTree === 'function')
      ? api.loadFolderTree()
      : Promise.resolve([]);

    loadTreePromise.then(function (tree) {
      _folderTree = tree || [];
      return api.loadFolders();
    }).then(function (folders) {
      _folders = folders || [];
      updateBreadcrumbs(_activeId);
      renderFolderList();
      renderFeedList();
    }).catch(function (e) {
      showStatus('error', 'Folders: ' + (e.message || 'load failed'));
    });
  }

  function loadFeeds() {
    var api = w.BLINK_WATCHLISTS || w.WatchlistsAPI;
    if (!api) return;
    api.load()
      .then(function (feeds) {
        _feeds = feeds || [];
        renderFeedList();
      })
      .catch(function (e) {
        showStatus('error', 'Feeds: ' + (e.message || 'load failed'));
      });
  }

  function loadAll() {
    loadFolders();
    loadFeeds();
  }

  /* ── Bootstrap ──────────────────────────────────────────────────── */
  function initPage() {
    try {
      var urlFolder = new URLSearchParams(window.location.search).get('folder');
      if (urlFolder) {
        _activeId = urlFolder;
      }
    } catch (e) {}

    /* New Folder button */
    var newFolderBtn = $('pf-new-folder-btn');
    if (newFolderBtn) {
      newFolderBtn.addEventListener('click', function () {
        var sidebar = $('pf-folder-nav');
        if (!sidebar) return;
        if (document.getElementById('pf-folder-name-input')) return;

        var inputLi = document.createElement('li');
        inputLi.id = 'pf-folder-name-input-li';
        inputLi.style.cssText = 'display:flex;gap:4px;padding:4px 4px 4px 8px;';
        var inp = document.createElement('input');
        inp.id = 'pf-folder-name-input';
        inp.type = 'text';
        inp.placeholder = 'Folder name…';
        inp.maxLength = 60;
        inp.style.cssText = 'flex:1;padding:5px 8px;border-radius:6px;border:1px solid #00BF63;font:500 13px/1 var(--sans,system-ui);min-width:0;outline:none;';
        var confirmBtn = document.createElement('button');
        confirmBtn.textContent = '✓';
        confirmBtn.title = 'Create folder';
        confirmBtn.style.cssText = 'padding:5px 8px;border-radius:6px;border:none;background:#00BF63;color:#fff;font-weight:700;cursor:pointer;flex-shrink:0;';
        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = '✕';
        cancelBtn.title = 'Cancel';
        cancelBtn.style.cssText = 'padding:5px 8px;border-radius:6px;border:1px solid var(--line,#e5e7eb);background:transparent;cursor:pointer;flex-shrink:0;';

        function removeInput() {
          var li = document.getElementById('pf-folder-name-input-li');
          if (li) li.remove();
        }

        function doCreate() {
          var name = inp.value.trim();
          if (!name) { inp.focus(); return; }
          removeInput();
          var api = w.BLINK_WATCHLISTS || w.WatchlistsAPI;
          if (!api) return;
          api.createFolder(name, null)
            .then(function (r) {
              if (!r.ok && !r.reused) { showStatus('error', r.message || 'Could not create folder.'); return; }
              if (!r.folder) { showStatus('error', 'Could not create folder.'); return; }
              if (r.reused) { showStatus('error', '"' + name + '" already exists.'); return; }
              showStatus('ok', 'Folder "' + name + '" created!');
              loadAll();
            })
            .catch(function (e) { showStatus('error', e.message || 'Could not create folder.'); });
        }

        confirmBtn.addEventListener('click', doCreate);
        cancelBtn.addEventListener('click', removeInput);
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') doCreate();
          if (e.key === 'Escape') removeInput();
        });

        inputLi.appendChild(inp);
        inputLi.appendChild(confirmBtn);
        inputLi.appendChild(cancelBtn);
        sidebar.appendChild(inputLi);
        inp.focus();
      });
    }

    /* Export JSON */
    var exportBtn = $('pf-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        var api = w.BLINK_WATCHLISTS || w.WatchlistsAPI;
        if (!api) return;
        api.exportJson().then(function (jsonStr) {
          var blob = new Blob([jsonStr], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'feedometer-watchlists-' + new Date().toISOString().slice(0, 10) + '.json';
          a.click();
          URL.revokeObjectURL(url);
          showStatus('ok', 'Watchlists exported successfully.');
        });
      });
    }

    /* Import JSON */
    var importBtn = $('pf-import-btn');
    var importFile = $('pf-import-file');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', function () {
        importFile.click();
      });
      importFile.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (evt) {
          var api = w.BLINK_WATCHLISTS || w.WatchlistsAPI;
          if (!api) return;
          api.importFeeds(evt.target.result).then(function (res) {
            if (res && res.ok) {
              showStatus('ok', 'Watchlists imported successfully!');
              loadAll();
            } else {
              showStatus('error', (res && res.message) || 'Import failed.');
            }
          });
        };
        reader.readAsText(file);
      });
    }

    /* Move Modal Cancel */
    var moveCancel = $('pf-move-cancel');
    var moveModal = $('pf-move-modal');
    if (moveCancel && moveModal) {
      moveCancel.addEventListener('click', function () {
        moveModal.classList.remove('is-open');
        _movingFeedId = null;
      });
      moveModal.addEventListener('click', function (e) {
        if (e.target === moveModal) {
          moveModal.classList.remove('is-open');
          _movingFeedId = null;
        }
      });
    }

    /* Close dropdowns on outside click */
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.pf-menu-wrap')) {
        document.querySelectorAll('.pf-dropdown.is-open').forEach(function (d) {
          d.classList.remove('is-open');
        });
      }
    });

    /* Search bar input */
    var searchInput = $('pf-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var q = (searchInput.value || '').trim().toLowerCase();
        var cards = document.querySelectorAll('#pf-feed-list > li');
        var visCount = 0;
        cards.forEach(function (card) {
          var title = (card.getAttribute('data-title') || '');
          var domain = (card.getAttribute('data-domain') || '');
          var match = !q || title.indexOf(q) !== -1 || domain.indexOf(q) !== -1;
          card.style.display = match ? '' : 'none';
          if (match) visCount++;
        });
        var emptyEl = $('pf-empty');
        if (emptyEl) emptyEl.hidden = (visCount > 0) || !q;
      });

      document.addEventListener('pf-folder-changed', function () {
        if (searchInput) searchInput.value = '';
      });
    }

    /* Listeners for live changes */
    document.addEventListener('watchlists-changed', loadAll);
    document.addEventListener('rss-feeds-updated', loadAll);

    // Initial load
    loadAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
  } else {
    initPage();
  }

})(window);
