/**
 * Visual RSS Studio — Point-and-Click Cluster Studio Controller
 * Flow: Load Website → Click any card on preview → Auto Detects all sibling cards & fields → Lists matching entries → Create Feed for the selected group.
 */
(function () {
  'use strict';

  function apiBase() {
    // This project deliberately uses the deployed Cloudflare Worker for both
    // Pages and localhost frontend testing. A static local HTTP server has no
    // /api routes, so it must never replace the configured Worker endpoint.
    if (window.FEEDOMETER_CONFIG) {
      const u =
        window.FEEDOMETER_CONFIG.WORKER_URL ||
        window.FEEDOMETER_CONFIG.apiBaseUrl ||
        window.FEEDOMETER_CONFIG.API_BASE_URL;
      if (u) return String(u).replace(/\/$/, '');
    }
    if (window.FEEDOMETER_API_BASE) return String(window.FEEDOMETER_API_BASE).replace(/\/$/, '');
    return 'https://feedometer-api.feedometer.workers.dev';
  }

  const FIELD_ORDER = ['container', 'title', 'link', 'description', 'image', 'date'];

  const els = {
    url: document.getElementById('vb-url'),
    loadBtn: document.getElementById('vb-load'),
    iframe: document.getElementById('vb-iframe'),
    iframeWrap: document.getElementById('vb-iframe-wrap'),
    badge: document.getElementById('vb-badge'),
    contentType: document.getElementById('vb-content-type'),
    renderMode: document.getElementById('vb-render-mode'),
    matchCount: document.getElementById('vb-match-count'),
    matchingBox: document.getElementById('vb-matching-box'),
    matchingList: document.getElementById('vb-matching-list'),
    createBtn: document.getElementById('vb-create'),
    status: document.getElementById('vb-status'),
    result: document.getElementById('vb-result'),
    articlesGrid: document.getElementById('vb-articles-grid'),
    feedUrl: document.getElementById('vb-feed-url'),
    feedXml: document.getElementById('vb-feed-xml'),
    toast: document.getElementById('vb-toast'),
    sel: {
      container: document.getElementById('vb-sel-container'),
      title: document.getElementById('vb-sel-title'),
      link: document.getElementById('vb-sel-link'),
      description: document.getElementById('vb-sel-description'),
      image: document.getElementById('vb-sel-image'),
      date: document.getElementById('vb-sel-date')
    }
  };

  const state = {
    siteUrl: '',
    activeField: 'container',
    mode: 'auto',
    loadGen: 0,
    items: []
  };

  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add('is-show');
    setTimeout(() => els.toast.classList.remove('is-show'), 2800);
  }

  function setStatus(msg, kind) {
    if (!els.status) return;
    els.status.textContent = msg || '';
    els.status.className = 'vb-status' + (kind ? ' is-' + kind : '');
  }

  function setLoading(on) {
    if (els.iframeWrap) els.iframeWrap.classList.toggle('is-loading', on);
    if (els.loadBtn) {
      els.loadBtn.disabled = on;
      els.loadBtn.textContent = on ? 'Loading…' : 'Load Website';
    }
  }

  function setBadge(engine) {
    if (!els.badge) return;
    els.badge.hidden = false;
    els.badge.className = 'vb-badge';
    if (engine === 'browser') {
      els.badge.textContent = 'Browser rendered';
      els.badge.classList.add('is-ok');
    } else if (engine === 'blocked') {
      els.badge.textContent = 'Site access protected';
      els.badge.classList.add('is-err');
    } else if (engine === 'static') {
      els.badge.textContent = 'HTML preview';
      els.badge.classList.add('is-static');
    } else {
      els.badge.textContent = engine || '';
    }
  }

  function normalizeUrl(raw) {
    let u = String(raw || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }

  function isBadSelector(sel) {
    const s = String(sel || '').trim();
    return !s || s === '.' || s === '*' || s === '#' || /^>\s*$/.test(s);
  }

  function getSelectors() {
    const out = {};
    Object.keys(els.sel).forEach((k) => {
      const v = els.sel[k] && els.sel[k].value.trim();
      if (v && !isBadSelector(v)) out[k] = v;
    });
    return out;
  }

  function markBound(field, value) {
    const input = els.sel[field];
    if (!input) return;
    const clean = isBadSelector(value) ? '' : String(value || '').trim();
    input.value = clean;
    const row = input.closest('[data-field]');
    if (row) {
      const tag = row.querySelector('.vb-bound');
      if (tag) {
        tag.textContent = clean ? 'Bound' : '—';
        tag.classList.toggle('is-on', Boolean(clean));
      }
    }
  }

  function clearSelectors() {
    FIELD_ORDER.forEach((f) => markBound(f, ''));
    state.items = [];
    if (els.matchCount) els.matchCount.textContent = '0';
    if (els.matchingBox) els.matchingBox.hidden = true;
    if (els.matchingList) els.matchingList.innerHTML = '';
    if (els.createBtn) els.createBtn.disabled = true;
  }

  function highlightActiveField() {
    document.querySelectorAll('.vb-field').forEach((el) => {
      el.classList.toggle('is-active', el.getAttribute('data-field') === state.activeField);
    });
    syncInspectorField();
  }

  function syncInspectorField() {
    if (els.iframe && els.iframe.contentWindow) {
      try {
        els.iframe.contentWindow.postMessage(
          { type: 'SET_ACTIVE_FIELD', field: state.activeField },
          '*'
        );
      } catch (_) {}
    }
  }

  function advanceManualField() {
    for (const f of FIELD_ORDER) {
      if (!els.sel[f] || !els.sel[f].value.trim()) {
        state.activeField = f;
        highlightActiveField();
        return;
      }
    }
  }

  function renderMatchingList(items) {
    if (!els.matchingBox || !els.matchingList) return;
    if (!items || !items.length) {
      els.matchingBox.hidden = true;
      els.matchingList.innerHTML = '';
      if (els.createBtn) els.createBtn.disabled = true;
      return;
    }

    els.matchingBox.hidden = false;
    els.matchingList.innerHTML = '';
    if (els.matchCount) els.matchCount.textContent = String(items.length);
    if (els.createBtn) els.createBtn.disabled = false;

    items.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = 'vb-matching-item';
      li.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:6px;">
          <span style="flex-shrink:0;font-size:0.68rem;font-weight:800;background:#6b21a8;color:#fff;border-radius:999px;padding:2px 7px;margin-top:2px;">#${idx + 1}</span>
          <div style="flex:1;min-width:0;">
            <div class="vb-matching-item-title">${escapeXml(item.title || 'Untitled Article')}</div>
            <div class="vb-matching-item-link">${escapeXml(item.link || '')}</div>
          </div>
          <button type="button" class="vb-remove-item-btn" title="Remove this article" style="flex-shrink:0;border:none;background:none;cursor:pointer;color:#ef4444;font-size:1rem;padding:0 2px;line-height:1;" data-idx="${idx}">✕</button>
        </div>
      `;

      // Remove button handler — deselects this article and syncs iframe highlights
      li.querySelector('.vb-remove-item-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        state.items = state.items.filter((_, i) => i !== idx);
        renderMatchingList(state.items);
        // Tell iframe to clear all highlights and re-highlight remaining
        if (els.iframe && els.iframe.contentWindow) {
          try {
            els.iframe.contentWindow.postMessage({
              type: 'FEEDOMETER_DESELECT_ALL'
            }, '*');
            // Re-highlight remaining by link
            state.items.forEach(a => {
              els.iframe.contentWindow.postMessage({
                type: 'FEEDOMETER_RESELECT_BY_LINK',
                link: a.link
              }, '*');
            });
          } catch (_) {}
        }
        setStatus(`✓ ${state.items.length} article(s) selected.`, 'ok');
        if (!state.items.length) setStatus('Click an article card to select it.', '');
        toast(`✕ Removed article #${idx + 1}`);
      });

      li.addEventListener('mouseenter', () => {
        if (els.iframe && els.iframe.contentWindow) {
          try {
            els.iframe.contentWindow.postMessage({ type: 'HIGHLIGHT_MATCH_INDEX', index: idx }, '*');
          } catch (_) {}
        }
      });

      li.addEventListener('mouseleave', () => {
        if (els.iframe && els.iframe.contentWindow) {
          try {
            els.iframe.contentWindow.postMessage({ type: 'HIGHLIGHT_MATCH_INDEX', index: -1 }, '*');
          } catch (_) {}
        }
      });

      els.matchingList.appendChild(li);
    });
  }

  /**
   * The localhost proxy and this studio share an origin. Bind an explicit
   * interaction bridge for its RSS card preview so a browser policy or an
   * injected-script failure cannot leave the preview looking clickable while
   * doing nothing. Production cross-origin previews retain the postMessage
   * inspector path below.
   */
  function bindLocalPreviewInteractions() {
    // The Worker proxy is intentionally cross-origin from Pages. Its own
    // versioned inspector is authoritative. Do not attach this legacy DOM
    // fallback during a cross-origin navigation: it can race the inspector and
    // turn a real card into the iframe's fallback document selection.
    try {
      if (!els.iframe || new URL(els.iframe.src, window.location.href).origin !== window.location.origin) return;
    } catch (_) {
      return;
    }

    let doc;
    try {
      doc = els.iframe && els.iframe.contentDocument;
    } catch (_) {
      return;
    }
    if (!doc || doc.__feedometerStudioBridgeBound) return;
    doc.__feedometerStudioBridgeBound = true;

    doc.addEventListener('click', (event) => {
      const target = event.target && event.target.closest
        ? event.target.closest('.tab-btn, [data-tab], .article-card')
        : null;
      if (!target) return;

      if (target.matches('.tab-btn, [data-tab]')) {
        const tab = target.getAttribute('data-tab');
        if (tab === null) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        doc.querySelectorAll('.tab-btn').forEach((button) => button.classList.remove('active'));
        doc.querySelectorAll('.tab-panel').forEach((panel) => {
          panel.classList.remove('active');
          panel.style.setProperty('display', 'none', 'important');
        });
        target.classList.add('active');
        const panel = doc.querySelector('.tab-panel[data-panel="' + CSS.escape(tab) + '"]');
        if (panel) {
          panel.classList.add('active');
          panel.style.setProperty('display', 'grid', 'important');
        }
        setStatus('Showing ' + (target.textContent || 'selected') .replace(/\s+/g, ' ').trim() + ' articles. Click a card to select it.', 'ok');
        return;
      }

      const card = target.closest('.article-card');
      if (!card) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const item = {
        title: card.getAttribute('data-title') || (card.querySelector('.card-title') || {}).textContent || 'Untitled Article',
        link: card.getAttribute('data-link') || '',
        image: card.getAttribute('data-image') || (card.querySelector('img') || {}).currentSrc || '',
        description: card.getAttribute('data-desc') || (card.querySelector('.card-desc') || {}).textContent || '',
        pubDate: card.getAttribute('data-date') || (card.querySelector('.card-date') || {}).textContent || ''
      };
      item.title = String(item.title).replace(/\s+/g, ' ').trim();
      item.description = String(item.description).replace(/\s+/g, ' ').trim();

      const ctrl = Boolean(event.ctrlKey || event.metaKey);
      if (ctrl) {
        const existing = state.items.findIndex((entry) => entry.link === item.link);
        if (existing >= 0) {
          state.items.splice(existing, 1);
          card.classList.remove('__fom_selected');
        } else {
          state.items.push(item);
          card.classList.add('__fom_selected');
        }
      } else {
        doc.querySelectorAll('.article-card.__fom_selected').forEach((entry) => entry.classList.remove('__fom_selected'));
        state.items = [item];
        card.classList.add('__fom_selected');
      }

      markBound('container', '.article-card');
      markBound('title', '.card-title');
      markBound('link', '[data-link]');
      markBound('description', '.card-desc');
      markBound('image', 'img');
      markBound('date', '.card-date');
      renderMatchingList(state.items);
      setStatus(
        state.items.length
          ? '✓ ' + state.items.length + ' article(s) selected. Create Feed is ready.'
          : 'No articles selected. Click a card to select it.',
        'ok'
      );
    }, true);
  }


  function updateNavAutoBuilder(url) {
    const navAuto = document.getElementById('vb-nav-auto-builder');
    if (navAuto) {
      const target = url ? 'builder.html?url=' + encodeURIComponent(url) : 'builder.html';
      navAuto.href = target;
      navAuto.onclick = function(e) {
        if (window.top && typeof window.top.loadView === 'function') {
          e.preventDefault();
          window.top.loadView(target);
        } else if (window.parent && typeof window.parent.loadView === 'function') {
          e.preventDefault();
          window.parent.loadView(target);
        }
      };
    }
  }

  function loadWebsite() {
    const url = normalizeUrl(els.url && els.url.value);
    if (!url) {
      setStatus('Enter a website URL first.', 'err');
      return;
    }
    state.siteUrl = url;
    if (els.url) els.url.value = url;
    updateNavAutoBuilder(url);
    clearSelectors();
    state.activeField = 'container';
    highlightActiveField();

    const gen = ++state.loadGen;
    const renderMode = (els.renderMode && els.renderMode.value) || 'auto';
    const proxy =
      apiBase() +
      '/api/builder/proxy?url=' +
      encodeURIComponent(url) +
      '&render_mode=' +
      encodeURIComponent(renderMode);

    setLoading(true);
    setStatus('Loading website preview…');
    setBadge('');

    const watchdog = setTimeout(() => {
      if (gen !== state.loadGen) return;
      setLoading(false);
      setStatus('Preview loaded — click any article card on the page to build your feed.', 'ok');
    }, 45000);

    els.iframe.onload = () => {
      if (gen !== state.loadGen) return;
      clearTimeout(watchdog);
      setLoading(false);
      try {
        const doc = els.iframe.contentDocument;
        const bodyText = doc && doc.body ? doc.body.innerText.slice(0, 400) : '';
        // A syndicated RSS card preview explains that the original website is
        // protected, but it is itself a successful, selectable preview.
        const hasArticleCards = Boolean(doc && doc.querySelector('.article-card'));
        if (!hasArticleCards && /This website blocked the preview|Access Denied|Protected/i.test(bodyText)) {
          setBadge('blocked');
          setStatus(
            'This site requires interactive verification. Try BBC, TechCrunch, The Verge or use Auto Feed Generator.',
            'err'
          );
          return;
        }
      } catch (_) {}
      // Every proxy preview, including local static Pages testing, now uses the
      // Worker-served inspector. Keeping a second DOM click bridge here would
      // create a race with that one authoritative selection contract.
      setBadge(renderMode === 'browser' ? 'browser' : 'static');
      setStatus(
        '👉 Click any article card on the website preview. Feedometer will auto-detect similar articles in that cluster.',
        'ok'
      );
      highlightActiveField();
    };

    els.iframe.onerror = () => {
      if (gen !== state.loadGen) return;
      clearTimeout(watchdog);
      setLoading(false);
      setStatus('Preview failed to load.', 'err');
    };

    els.iframe.removeAttribute('srcdoc');
    els.iframe.src = proxy;
  }

  function escapeXml(s) {
    return String(s || '').replace(/[<>&'"]/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])
    );
  }

  function buildRssXml(items, siteUrl) {
    let host = siteUrl;
    try {
      host = new URL(siteUrl).hostname;
    } catch (_) {}
    let xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">\n';
    xml += '  <channel>\n';
    xml += '    <title>' + escapeXml(host) + ' Feed</title>\n';
    xml += '    <link>' + escapeXml(siteUrl) + '</link>\n';
    xml += '    <description>Live RSS feed generated by Feedometer Visual Studio</description>\n';
    xml += '    <lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\n';
    (items || []).forEach((a) => {
      xml += '    <item>\n';
      xml += '      <title>' + escapeXml(a.title || 'Untitled Article') + '</title>\n';
      xml += '      <link>' + escapeXml(a.link || siteUrl) + '</link>\n';
      xml += '      <guid isPermaLink="true">' + escapeXml(a.link || siteUrl) + '</guid>\n';
      if (a.description) xml += '      <description>' + escapeXml(a.description) + '</description>\n';
      if (a.pubDate) xml += '      <pubDate>' + escapeXml(a.pubDate) + '</pubDate>\n';
      if (a.image) {
        xml += '      <enclosure url="' + escapeXml(a.image) + '" type="image/jpeg" length="0"/>\n';
        xml += '      <media:content url="' + escapeXml(a.image) + '" medium="image"/>\n';
        xml += '      <media:thumbnail url="' + escapeXml(a.image) + '"/>\n';
      }
      xml += '    </item>\n';
    });
    xml += '  </channel>\n</rss>';
    return xml;
  }

  function renderArticlesGrid(items, feedUrl) {
    if (!els.articlesGrid) return;
    els.articlesGrid.innerHTML = '';
    if (!items || !items.length) {
      els.articlesGrid.innerHTML = '<p style="color:#64748b;font-size:0.85rem;">No article items extracted.</p>';
      return;
    }

    // Show a prominent feed URL row at the top of the preview section if we have a saved URL
    if (feedUrl) {
      const urlRow = document.createElement('div');
      urlRow.className = 'vb-preview-feed-url-row';
      urlRow.innerHTML = `
        <label style="font-size:0.78rem;font-weight:700;color:#6b21a8;margin-bottom:4px;display:block;">📡 Your Feed URL (contains only selected articles)</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="vb-preview-feed-url" readonly value="${escapeXml(feedUrl)}"
            style="flex:1;font-size:0.78rem;padding:6px 10px;border:1.5px solid #a21caf;border-radius:6px;background:#fdf4ff;color:#4a044e;font-family:monospace;outline:none;">
          <button type="button" id="vb-preview-copy-btn"
            style="padding:6px 14px;background:#a21caf;color:#fff;border:none;border-radius:6px;font-size:0.8rem;font-weight:700;cursor:pointer;white-space:nowrap;">
            📋 Copy
          </button>
          <a id="vb-preview-widget-btn" href="widgets.html?feed=${encodeURIComponent(feedUrl)}" target="_blank"
            style="padding:6px 14px;background:#0ea5e9;color:#fff;border-radius:6px;font-size:0.8rem;font-weight:700;text-decoration:none;white-space:nowrap;">
            🎨 Widget Studio
          </a>
          <a id="vb-preview-reader-btn" href="rss-reader.html?feed=${encodeURIComponent(feedUrl)}" target="_blank"
            style="padding:6px 14px;background:#16a34a;color:#fff;border-radius:6px;font-size:0.8rem;font-weight:700;text-decoration:none;white-space:nowrap;">
            📖 Open in Reader
          </a>
        </div>
      `;
      els.articlesGrid.appendChild(urlRow);

      // Also update the top URL input to the correct saved URL
      if (els.feedUrl) els.feedUrl.value = feedUrl;

      // Wire up copy button
      setTimeout(() => {
        const copyBtn = document.getElementById('vb-preview-copy-btn');
        if (copyBtn) {
          copyBtn.addEventListener('click', () => {
            try { navigator.clipboard.writeText(feedUrl); } catch(_) {}
            const inp = document.getElementById('vb-preview-feed-url');
            if (inp) { inp.select(); try { document.execCommand('copy'); } catch(_) {} }
            copyBtn.textContent = '✓ Copied!';
            setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
          });
        }
      }, 50);
    }

    items.slice(0, 30).forEach((item) => {
      const card = document.createElement('article');
      card.className = 'vb-article-card';

      const mediaHtml = item.image
        ? `<div class="vb-article-media"><img src="${escapeXml(item.image)}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`
        : '';

      card.innerHTML = `
        ${mediaHtml}
        <div class="vb-article-body">
          <h4 class="vb-article-heading">
            <a href="${escapeXml(item.link || '#')}" target="_blank" rel="noopener noreferrer">${escapeXml(item.title || 'Untitled Article')}</a>
          </h4>
          ${item.pubDate ? `<div class="vb-article-date">📅 ${escapeXml(item.pubDate)}</div>` : ''}
        </div>
      `;
      els.articlesGrid.appendChild(card);
    });
  }

  async function handleFollowFeed() {
    const btn = document.getElementById('vb-btn-follow');
    const feedUrl = els.feedUrl && els.feedUrl.value;
    if (!btn || !feedUrl) return;

    let host = state.siteUrl;
    try {
      host = new URL(state.siteUrl).hostname.replace(/^www\./i, '');
    } catch (_) {}
    const title = host + ' (Visual Feed)';

    const guestFollowObj = {
      id: 'guest_' + Date.now(),
      feed_name: title,
      feed_url: feedUrl,
      website_url: state.siteUrl,
      category: 'General',
      icon_url: 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(state.siteUrl) + '&sz=32',
      description: 'Syndication feed for ' + title,
      subscribers: 1,
      velocity: 5,
      is_verified: 0,
      last_updated: Date.now(),
      followed_at: Date.now()
    };

    try {
      let follows = [];
      const raw =
        localStorage.getItem('feedometer_guest_subscriptions') ||
        sessionStorage.getItem('feedometer_guest_subscriptions');
      if (raw) follows = JSON.parse(raw);
      if (!Array.isArray(follows)) follows = [];
      const norm = feedUrl.trim().toLowerCase();
      if (!follows.some((f) => (f.feed_url || '').trim().toLowerCase() === norm)) {
        follows.unshift(guestFollowObj);
        localStorage.setItem('feedometer_guest_subscriptions', JSON.stringify(follows));
        sessionStorage.setItem('feedometer_guest_subscriptions', JSON.stringify(follows));
      }
      if (window.FeedOmeterAuth && typeof window.FeedOmeterAuth.setGuestFollows === 'function') {
        window.FeedOmeterAuth.setGuestFollows(follows);
      }
      if (window.parent && window.parent !== window && window.parent.FeedOmeterAuth && typeof window.parent.FeedOmeterAuth.setGuestFollows === 'function') {
        window.parent.FeedOmeterAuth.setGuestFollows(follows);
      }
    } catch (_) {}

    if (window.FeedOmeterAuth && window.FeedOmeterAuth.isAuthenticated()) {
      try {
        btn.disabled = true;
        btn.innerHTML = '<span>Following…</span>';
        await window.FeedOmeterAuth.followFeed({
          feed_url: feedUrl,
          title: title,
          website_url: state.siteUrl
        });
      } catch (err) {
        console.warn('Authenticated follow error:', err);
      }
    }

    btn.disabled = false;
    btn.classList.add('is-following');
    btn.innerHTML = '<span>✓ Following</span> <span class="follow-heart-icon">💖</span>';
    toast('✓ Following ' + title);
  }

  async function createFeed() {
    const selectors = getSelectors();
    if (!state.siteUrl) {
      setStatus('Load a website URL first.', 'err');
      return;
    }

    if (!selectors.container) {
      setStatus('Click an article card on the preview to select a cluster first.', 'err');
      return;
    }

    els.createBtn.disabled = true;
    els.createBtn.textContent = 'Creating Feed…';
    setStatus('Building custom RSS 2.0 XML from selected items…');

    let items = state.items.slice();

    if (!items.length) {
      items = [
        {
          title: (els.sel.title && els.sel.title.value) || 'Feed Item',
          link: state.siteUrl,
          pubDate: new Date().toUTCString()
        }
      ];
    }

    const xml = buildRssXml(items, state.siteUrl);

    // Save the EXACT selected-articles XML so the live URL always returns only these articles
    let live = apiBase() + '/api/builder/feed?url=' + encodeURIComponent(state.siteUrl);
    try {
      const saveRes = await fetch(apiBase() + '/api/builder/save-feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: xml
      });
      if (saveRes.ok) {
        const saved = await saveRes.json();
        if (saved.feedUrl) live = saved.feedUrl;
      }
    } catch (_) {}

    if (els.feedUrl) els.feedUrl.value = live;
    if (els.feedXml) els.feedXml.textContent = xml;

    // Render Preview Articles Grid — pass `live` so the URL shows inside the card
    renderArticlesGrid(items, live);

    // Connect Action Buttons
    const btnWidget = document.getElementById('vb-btn-widget-studio');
    if (btnWidget) {
      btnWidget.href = 'widgets.html?feed=' + encodeURIComponent(live);
    }
    const btnReader = document.getElementById('vb-btn-reader');
    if (btnReader) {
      btnReader.href = 'reader.html?feed=' + encodeURIComponent(live);
    }
    const btnFollow = document.getElementById('vb-btn-follow');
    if (btnFollow) {
      btnFollow.classList.remove('is-following');
      btnFollow.innerHTML = '<span>+ Follow Feed</span> <span class="follow-heart-icon">💖</span>';
    }

    if (els.result) {
      els.result.hidden = false;
      els.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    setStatus(`🎉 Feed created with ${items.length} articles! Copy the live feed URL below.`, 'ok');
    toast(`🎉 Feed created (${items.length} items)`);
    els.createBtn.disabled = false;
    els.createBtn.textContent = '⚡ Create Feed from Selections';
  }

  function onMessage(event) {
    let data = event.data;
    if (!data || typeof data !== 'object') return;
    let type = data.type || '';
    const isVersionedArticleCardSelection = type === 'FEEDOMETER_ARTICLE_CARD_SELECTED_V2' && Boolean(data.article);

    // Normalize the versioned article-card event into the existing selection
    // path. This keeps one parent-side source of truth for all feed creation.
    if (isVersionedArticleCardSelection) {
      data = {
        ...data,
        type: 'FEEDOMETER_ELEMENT_SELECTED',
        selectionProtocol: 'preview-inspector-v2',
        articles: [data.article]
      };
      type = data.type;
    }

    if (type === 'FEEDOMETER_ELEMENT_SELECTED' || type === 'element_selected') {
      let selector = String(data.selector || '').trim();
      // The cross-origin Worker preview may contain third-party or legacy page
      // scripts. Its only allowed selection contract is the V2 card event.
      // Generic selector events remain usable for same-origin/local Manual
      // previews but cannot alter the Worker-backed feed selection state.
      const isWorkerPreview = Boolean(els.iframe && event.source === els.iframe.contentWindow) &&
        (() => { try { return new URL(els.iframe.src, window.location.href).origin !== window.location.origin; } catch (_) { return true; } })();
      if (isWorkerPreview && !isVersionedArticleCardSelection) return;
      // Feed-browser cards are owned by the versioned preview inspector. A
      // generic legacy event can still serve Manual selector picking, but it
      // must never overwrite a concrete card chosen by the user.
      if (selector === '.article-card' && data.selectionProtocol !== 'preview-inspector-v2') return;
      if (isBadSelector(selector)) {
        toast('Click an article card or headline to select');
        return;
      }

      markBound('container', data.selector || selector);
      markBound('title', data.titleSelector || 'h1, h2, h3, h4, a');
      markBound('link', data.linkSelector || 'a[href]');
      markBound('image', data.imageSelector || 'img, picture');
      markBound('date', data.dateSelector || 'time, .date');
      markBound('description', data.descriptionSelector || 'p, .summary');

      const incoming = data.articles || [];

      if (data.ctrlKey) {
        // Ctrl+click: toggle — add if not present, remove if already selected
        const incoming = data.articles || [];
        const incomingLink = incoming[0] && incoming[0].link;
        const alreadyIdx = (state.items || []).findIndex(a => a.link === incomingLink);
        if (alreadyIdx !== -1) {
          // Toggle OFF — remove this article
          state.items = state.items.filter((_, i) => i !== alreadyIdx);
          // Tell iframe to clear all and re-highlight remaining
          if (els.iframe && els.iframe.contentWindow) {
            try {
              els.iframe.contentWindow.postMessage({ type: 'FEEDOMETER_DESELECT_ALL' }, '*');
              state.items.forEach(a => {
                els.iframe.contentWindow.postMessage({ type: 'FEEDOMETER_RESELECT_BY_LINK', link: a.link }, '*');
              });
            } catch (_) {}
          }
          toast(`✕ Deselected — ${state.items.length} article(s) remaining`);
        } else {
          // Toggle ON — add this article
          state.items = (state.items || []).concat(incoming);
          toast(`✓ Added — ${state.items.length} article(s) selected (Ctrl+click to add more)`);
        }
      } else {
        // Normal click: replace entire selection with just this article
        state.items = incoming;
        toast(`✓ 1 article selected — Ctrl+click to add more`);
      }


      renderMatchingList(state.items);

      setStatus(
        `✓ Detected ${state.items.length} matching article(s). Click "⚡ Create Feed from Selections" below.`,
        'ok'
      );
    } else if (type === 'FEEDOMETER_INSPECTOR_READY' || type === 'inspector_ready') {
      highlightActiveField();
    }
  }

  function init() {
    try {
      if (window.self !== window.top || window.location.search.includes('in_shell=1') || window.name === 'feedo-shell-frame') {
        document.body.classList.add('in-shell');
      }
    } catch (_) {
      document.body.classList.add('in-shell');
    }

    if (!els.iframe || !els.loadBtn) return;

    els.loadBtn.addEventListener('click', loadWebsite);
    if (els.url) {
      els.url.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loadWebsite();
      });
      els.url.addEventListener('input', () => {
        updateNavAutoBuilder(els.url.value);
      });
    }

    document.querySelectorAll('[data-vb-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-vb-mode]').forEach((b) => b.classList.remove('is-on'));
        btn.classList.add('is-on');
        state.mode = btn.getAttribute('data-vb-mode') || 'auto';
        if (state.mode === 'manual') {
          state.activeField = 'container';
          highlightActiveField();
          setStatus('Manual Mode: click a selector field on the left, then click that element on the preview.', 'ok');
        } else {
          setStatus('Auto Cluster: click one article card on the preview to select all matching articles.', 'ok');
        }
      });
    });

    document.querySelectorAll('.vb-field').forEach((row) => {
      row.addEventListener('click', () => {
        state.activeField = row.getAttribute('data-field') || 'container';
        highlightActiveField();
        toast('Now click the ' + state.activeField + ' on the preview');
      });
      const input = row.querySelector('input');
      if (input) {
        input.addEventListener('focus', () => {
          state.activeField = row.getAttribute('data-field') || 'container';
          highlightActiveField();
        });
      }
    });

    if (els.createBtn) els.createBtn.addEventListener('click', createFeed);

    const btnFollow = document.getElementById('vb-btn-follow');
    if (btnFollow) {
      btnFollow.addEventListener('click', handleFollowFeed);
    }

    document.querySelectorAll('[data-copy-feed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = els.feedUrl && els.feedUrl.value;
        if (!v) return;
        navigator.clipboard.writeText(v).then(() => toast('✓ Feed URL copied')).catch(() => toast(v));
      });
    });

    document.querySelectorAll('[data-sample]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const u = btn.getAttribute('data-sample');
        if (els.url) els.url.value = u;
        loadWebsite();
      });
    });

    window.addEventListener('message', onMessage);

    const params = new URLSearchParams(window.location.search);
    const site = params.get('url') || params.get('site');
    if (site) {
      if (els.url) els.url.value = site;
      loadWebsite();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
