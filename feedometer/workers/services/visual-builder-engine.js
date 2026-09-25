/**
 * workers/services/visual-builder-engine.js — FeedOmeter Visual RSS Builder Engine
 * Web Proxy, DOM Element Inspector Injection, CSS Selector Evaluator & Fallback Synthesizer
 */
import { evaluateSelectorConfigDom } from './builder-dom-eval.js';
import { fetchPageHtmlForBuilder, normalizeRenderMode } from './builder-page-fetch.js';
import { getOfficialFeedCandidates } from './official-feed-registry.js';
export { detectLikelyJsShell } from './builder-static-fetch.js';

/**
 * Client inspector script injected into the proxy page for point-and-click element capture
 */
export const INSPECTOR_INJECTION_SCRIPT = `
<script id="feedometer-inspector-script">
(function() {
  if (window.__feedometer_injected) return;
  window.__feedometer_injected = true;

  let activeTargetInput = 'container';
  let hoveredElement = null;
  let currentMatches = [];
  let focusedMatchEl = null;

  const styleEl = document.createElement('style');
  styleEl.textContent = \`
    .__fom_hover {
      outline: 2px dashed #0284c7 !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
      background-color: rgba(2, 132, 199, 0.08) !important;
    }
    .__fom_selected {
      outline: 2px solid #10b981 !important;
      outline-offset: 2px !important;
      background-color: rgba(16, 185, 129, 0.12) !important;
    }
    .__fom_sibling {
      outline: 1.5px dashed #10b981 !important;
      outline-offset: 1px !important;
      background-color: rgba(16, 185, 129, 0.05) !important;
    }
    .__fom_focus_match {
      outline: 3px solid #f59e0b !important;
      outline-offset: 3px !important;
      background-color: rgba(245, 158, 11, 0.18) !important;
      box-shadow: 0 0 16px rgba(245, 158, 11, 0.4) !important;
      transition: outline 0.15s ease, background-color 0.15s ease !important;
      scroll-margin: 60px;
    }
    /* Hide intrusive cookie banners or overlays in iframe preview */
    #onetrust-consent-sdk, .cmp-container, [id*="consent-modal"], [class*="cookie-banner"], [id*="cookieBanner"] {
      display: none !important;
      pointer-events: none !important;
    }
  \`;
  document.head.appendChild(styleEl);

  function getOptimalSelector(el, isSubField) {
    if (!el || el === document.body || el === document.documentElement) return '';

    if (isSubField) {
      var tag = el.tagName.toLowerCase();
      var classes = Array.from(el.classList || [])
        .filter(function(c) {
          return c && !c.startsWith('__fom_') && !/^[a-z0-9_-]{12,}$/i.test(c) && !/^(jsx-|css-|sc-)/.test(c);
        })
        .slice(0, 2);

      if (tag === 'img') {
        if (classes.length) return 'img.' + classes.map(function(c) { return CSS.escape(c); }).join('.');
        return 'img';
      }
      if (tag === 'a') {
        if (classes.length) return 'a.' + classes.map(function(c) { return CSS.escape(c); }).join('.');
        return 'a';
      }
      if (classes.length > 0) {
        return tag + '.' + classes.map(function(c) { return CSS.escape(c); }).join('.');
      }
      if (['h1','h2','h3','h4','h5','h6','time','p','span','figcaption'].indexOf(tag) !== -1) {
        return tag;
      }
      return tag;
    }

    if (el.id && !/\\d{4,}/.test(el.id)) {
      return '#' + CSS.escape(el.id);
    }

    var path = [];
    var curr = el;

    while (curr && curr !== document.body && curr !== document.documentElement && path.length < 6) {
      var tag = curr.tagName.toLowerCase();
      var selector = tag;
      var classes = Array.from(curr.classList || [])
        .filter(function(c) {
          return c && !c.startsWith('__fom_') && !/^[a-z0-9_-]{12,}$/i.test(c) && !/^(jsx-|css-|sc-)/.test(c);
        })
        .slice(0, 2);

      if (classes.length > 0) {
        selector += '.' + classes.map(function(c) { return CSS.escape(c); }).join('.');
      } else {
        var parent = curr.parentElement;
        if (parent) {
          var siblings = Array.from(parent.children).filter(function(s) { return s.tagName === curr.tagName; });
          if (siblings.length > 1) {
            selector += ':nth-of-type(' + (siblings.indexOf(curr) + 1) + ')';
          }
        }
      }

      path.unshift(selector);
      if (curr.id && !/\\d{4,}/.test(curr.id)) {
        path[0] = '#' + CSS.escape(curr.id);
        break;
      }
      // Prefer stopping at repeating card-like nodes
      if (path.length >= 2 && /article|card|story|item|teaser|post/i.test(selector)) {
        break;
      }
      curr = curr.parentElement;
    }

    var out = path.join(' > ');
    if (!out || out === '.' || out === '*' || (/^\\./.test(out) && out.length < 3)) return tag || '';
    return out;
  }

  function highlightMatches(selectorOrElements) {
    document.querySelectorAll('.__fom_selected, .__fom_sibling, .__fom_focus_match').forEach(el => {
      el.classList.remove('__fom_selected', '__fom_sibling', '__fom_focus_match');
    });
    currentMatches = [];
    if (!selectorOrElements) return 0;
    try {
      let matches = [];
      if (Array.isArray(selectorOrElements)) {
        matches = selectorOrElements;
      } else if (typeof selectorOrElements === 'string') {
        matches = Array.from(document.querySelectorAll(selectorOrElements));
      }
      matches = matches.filter(el => {
        return el !== document.body && el !== document.documentElement && el.id !== 'feedometer-proxy-notice';
      });
      currentMatches = matches.slice(0, 80);
      currentMatches.forEach((el, idx) => {
        if (idx === 0) el.classList.add('__fom_selected');
        else el.classList.add('__fom_sibling');
      });
      return currentMatches.length;
    } catch (e) {
      return 0;
    }
  }

  function findClusterInfo(target) {
    let card = target;
    while (card && card !== document.body && card !== document.documentElement) {
      const tag = card.tagName.toLowerCase();
      const cls = typeof card.className === 'string' ? card.className : '';
      if (tag === 'article' || /(card|promo|story|item|teaser|post|tile|entry|grid-item|news)/i.test(cls)) {
        break;
      }
      if (card.parentElement && card.parentElement.children.length >= 2 && (card.querySelector('a[href]') || card.querySelector('h1,h2,h3,h4,h5,h6'))) {
        break;
      }
      card = card.parentElement;
    }
    if (!card || card === document.body) card = target;

    const parent = card.parentElement;
    let containerSelector = '';
    
    const cardClasses = Array.from(card.classList || []).filter(c => 
      c && !c.startsWith('__fom_') && !/^[a-z0-9_-]{16,}$/i.test(c) && !/^(jsx-|css-|sc-)/.test(c)
    );
    
    if (cardClasses.length > 0) {
      for (const cls of cardClasses) {
        const sel = card.tagName.toLowerCase() + '.' + CSS.escape(cls);
        try {
          const testMatches = document.querySelectorAll(sel);
          if (testMatches.length >= 1 && testMatches.length <= 60) {
            containerSelector = sel;
            break;
          }
        } catch (_) {}
      }
    }

    if (!containerSelector && parent && parent !== document.body) {
      const parentClasses = Array.from(parent.classList || []).filter(c => c && !c.startsWith('__fom_') && !/^[a-z0-9_-]{16,}$/i.test(c));
      const tag = card.tagName.toLowerCase();
      if (parentClasses.length > 0) {
        containerSelector = '.' + CSS.escape(parentClasses[0]) + ' > ' + tag;
      } else {
        containerSelector = tag;
      }
    }

    if (!containerSelector) {
      containerSelector = card.tagName.toLowerCase();
    }

    let matches = [];
    try {
      matches = Array.from(document.querySelectorAll(containerSelector)).filter(el => 
        el !== document.body && el !== document.documentElement && el.id !== 'feedometer-proxy-notice'
      );
    } catch (_) {
      matches = [card];
    }

    if (matches.length > 40 && parent && parent !== document.body) {
      const scoped = Array.from(parent.children).filter(el => el.tagName === card.tagName);
      if (scoped.length >= 2) {
        matches = scoped;
      }
    }

    const sampleArticles = [];
    matches.forEach(c => {
      const titleEl = c.querySelector('h1, h2, h3, h4, h5, h6, [class*="headline"], [class*="title"], [class*="heading"]') || 
                      (c.tagName === 'A' ? c : c.querySelector('a')) || c;
      const linkEl = (c.tagName === 'A' ? c : null) || 
                     (titleEl && titleEl.closest ? titleEl.closest('a') : null) || 
                     c.querySelector('a[href]');
      const imgEl = c.querySelector('img, picture source, [style*="background-image"]');
      const dateEl = c.querySelector('time, [itemprop="datePublished"], [data-timestamp], [data-time], [class*="date"], [class*="time"]');
      const descEl = c.querySelector('p, [class*="desc"], [class*="summary"], [class*="excerpt"]');

      const title = (titleEl ? (titleEl.textContent || '') : '').replace(/\s+/g, ' ').trim();
      // Preview links are neutralized to prevent a click from navigating the
      // iframe. Keep using the original destination for the generated feed.
      let link = (linkEl ? (linkEl.getAttribute('data-feedometer-href') || linkEl.getAttribute('href') || '') : '').trim();
      if (link) {
        try { link = new URL(link, window.location.href).href; } catch (_) {}
      }

      if (!title && !link) return;

      let image = '';
      if (imgEl) {
        let rawSrc = imgEl.getAttribute('srcset') || imgEl.getAttribute('data-srcset') || imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
        if (rawSrc && rawSrc.includes(',')) {
          rawSrc = rawSrc.split(',')[0].trim().split(/\s+/)[0];
        }
        if (rawSrc) {
          try { image = new URL(rawSrc, window.location.href).href; } catch (_) { image = rawSrc; }
        }
      }

      let pubDate = '';
      if (dateEl) {
        pubDate = dateEl.getAttribute('datetime') || dateEl.getAttribute('data-datetime') || dateEl.textContent.trim();
      }

      let description = (descEl ? descEl.textContent : '').replace(/\s+/g, ' ').trim();

      sampleArticles.push({
        title: title || 'Untitled Article',
        link: link || window.location.href,
        image: image,
        pubDate: pubDate,
        description: description
      });
    });

    return {
      containerSelector,
      titleSelector: 'h1, h2, h3, h4, [class*="title"], [class*="headline"], a',
      linkSelector: 'a[href]',
      imageSelector: 'img, picture',
      dateSelector: 'time, .date',
      descriptionSelector: 'p, .summary',
      matches,
      articles: sampleArticles
    };
  }

  function setFocusedMatch(index) {
    if (focusedMatchEl) {
      focusedMatchEl.classList.remove('__fom_focus_match');
      focusedMatchEl = null;
    }
    if (index >= 0 && currentMatches && currentMatches[index]) {
      focusedMatchEl = currentMatches[index];
      focusedMatchEl.classList.add('__fom_focus_match');
      try {
        focusedMatchEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (_) {}
    }
  }

  document.addEventListener('mouseover', function(e) {
    const target = e.target.closest('a, img, h1, h2, h3, h4, h5, h6, p, time, span, article, div, li, section') || e.target;
    if (target === document.body || target === document.documentElement) return;
    if (hoveredElement && hoveredElement !== target) {
      hoveredElement.classList.remove('__fom_hover');
    }
    hoveredElement = target;
    hoveredElement.classList.add('__fom_hover');

    if (currentMatches && currentMatches.length > 0) {
      const matchIndex = currentMatches.findIndex(m => m === target || m.contains(target));
      if (matchIndex !== -1) {
        window.parent.postMessage({
          type: 'FEEDOMETER_HOVER_MATCH_INDEX',
          index: matchIndex
        }, '*');
      }
    }
  }, true);

  document.addEventListener('mouseout', function(e) {
    if (hoveredElement) {
      hoveredElement.classList.remove('__fom_hover');
      hoveredElement = null;
    }
  }, true);

  document.addEventListener('click', function(e) {
    // ── Handle tab navigation clicks directly ──
    var tabBtn = e.target.closest('.tab-btn, [data-tab]');
    if (tabBtn) {
      var tabIdx = tabBtn.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p) {
        p.style.setProperty('display', 'none', 'important');
        p.classList.remove('active');
      });
      tabBtn.classList.add('active');
      var activePanel = document.querySelector('.tab-panel[data-panel="' + tabIdx + '"]');
      if (activePanel) {
        activePanel.style.setProperty('display', 'grid', 'important');
        activePanel.classList.add('active');
      }
      return;
    }

    // Find a repeatable article boundary for any preview page. News sites such
    // as BBC commonly use div-based story cards rather than <article> tags.
    var clicked = e.target.closest('a, img, h1, h2, h3, h4, h5, h6, p, time, span, article, div, li, section') || e.target;
    if (clicked === document.body || clicked === document.documentElement) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    e.preventDefault();
    e.stopImmediatePropagation();

    var cluster = findClusterInfo(clicked);
    var card = cluster.matches.find(function(m) {
      return m === clicked || m.contains(clicked) || clicked.contains(m);
    }) || cluster.matches[0] || clicked;

    // ── RSS Feed Browser mode: read embedded data-* attributes directly ──
    var isFeedBrowser = !!card.getAttribute('data-link');
    if (isFeedBrowser) {
      var isCtrl = !!(e.ctrlKey || e.metaKey);
      if (isCtrl) {
        if (card.classList.contains('__fom_selected')) {
          card.classList.remove('__fom_selected', '__fom_sibling', '__fom_focus_match');
          currentMatches = currentMatches.filter(function(m) { return m !== card; });
        } else {
          card.classList.add('__fom_selected');
          if (!currentMatches.includes(card)) currentMatches.push(card);
        }
      } else {
        // Clear previous highlights
        currentMatches.forEach(function(el) {
          el.classList.remove('__fom_selected', '__fom_sibling', '__fom_focus_match');
        });
        document.querySelectorAll('.__fom_selected').forEach(function(el) {
          el.classList.remove('__fom_selected');
        });
        currentMatches = [card];
        card.classList.add('__fom_selected');
      }

      var fbTitle = card.getAttribute('data-title') || (card.querySelector('.card-title,h3,h2') || {}).textContent || 'Untitled';
      var fbLink  = card.getAttribute('data-link')  || window.location.href;
      var fbImgEl = card.querySelector('img');
      var fbImage = card.getAttribute('data-image') || (fbImgEl ? (fbImgEl.currentSrc || fbImgEl.src || fbImgEl.getAttribute('src')) : '') || '';
      var fbDesc  = card.getAttribute('data-desc')  || '';
      var fbDate  = card.getAttribute('data-date')  || '';

      window.parent.postMessage({
        type: 'FEEDOMETER_ELEMENT_SELECTED',
        targetField: activeTargetInput,
        field: activeTargetInput,
        selector: '.article-card',
        titleSelector: '.card-title',
        linkSelector: 'a[href]',
        imageSelector: 'img',
        dateSelector: '.card-date',
        descriptionSelector: '.card-desc',
        matchCount: currentMatches.length || 1,
        count: currentMatches.length || 1,
        ctrlKey: isCtrl,
        textSnippet: fbTitle.slice(0, 100),
        articles: [{ title: fbTitle, link: fbLink, image: fbImage, description: fbDesc, pubDate: fbDate }]
      }, '*');
      return;
    }

    // card is the detected repeatable article boundary above.
    const clickedCard = card;

    var isCtrl = !!(e.ctrlKey || e.metaKey);
    if (isCtrl) {
      if (clickedCard.classList.contains('__fom_selected')) {
        clickedCard.classList.remove('__fom_selected', '__fom_sibling', '__fom_focus_match');
        currentMatches = currentMatches.filter(function(m) { return m !== clickedCard; });
      } else {
        clickedCard.classList.add('__fom_selected');
        if (!currentMatches.includes(clickedCard)) currentMatches.push(clickedCard);
      }
    } else {
      // Highlight only the single clicked card
      currentMatches.forEach(function(el) {
        el.classList.remove('__fom_selected', '__fom_sibling', '__fom_focus_match');
      });
      document.querySelectorAll('.__fom_selected').forEach(function(el) {
        el.classList.remove('__fom_selected');
      });
      currentMatches = [clickedCard];
      clickedCard.classList.add('__fom_selected');
    }

    // Extract data from the clicked card
    var titleEl = clickedCard.querySelector('h1,h2,h3,h4,h5,h6,[class*="headline"],[class*="title"],[class*="heading"]')
                  || (clickedCard.tagName === 'A' ? clickedCard : clickedCard.querySelector('a'))
                  || clickedCard;
    var linkEl = (clickedCard.tagName === 'A' ? clickedCard : null)
                 || (titleEl && titleEl.closest ? titleEl.closest('a') : null)
                 || clickedCard.querySelector('a[href]');
    var title = (titleEl ? (titleEl.textContent || '') : '').replace(/\s+/g, ' ').trim();
    var link = linkEl ? (linkEl.getAttribute('data-feedometer-href') || linkEl.getAttribute('href') || '') : '';
    if (link) {
      try { link = new URL(link, window.location.href).href; } catch (_) {}
    }
    var dateEl = clickedCard.querySelector('time, [itemprop="datePublished"], [data-timestamp], [data-time], [class*="date"], [class*="time"]');
    var descEl = clickedCard.querySelector('p, [class*="desc"], [class*="summary"], [class*="excerpt"]');
    var image = '';
    var searchScopes = [
      clickedCard,
      clickedCard.closest ? clickedCard.closest('article, [class*="card"], [class*="tile"], [class*="story"], [class*="item"], [class*="teaser"], [class*="post"], li, section') : null,
      clickedCard.parentElement,
      clickedCard.parentElement ? clickedCard.parentElement.parentElement : null
    ].filter(Boolean);

    for (var s = 0; s < searchScopes.length; s++) {
      var scope = searchScopes[s];
      if (!scope || scope === document.body || scope === document.documentElement) continue;

      var img = (scope.tagName === 'IMG' ? scope : null) ||
                scope.querySelector('img, picture source, picture img, [data-src], [data-srcset], [data-original]');
      if (img) {
        if (img.currentSrc && !img.currentSrc.startsWith('data:') && !img.currentSrc.includes('blank.gif')) {
          image = img.currentSrc;
          break;
        }
        var srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
        if (srcset) {
          var parts = srcset.split(',').map(function(p) { return p.trim(); }).filter(Boolean);
          if (parts.length > 0) {
            var best = parts[parts.length - 1].split(/\s+/)[0];
            if (best && !best.startsWith('data:')) {
              try { image = new URL(best, window.location.href).href; break; } catch(_) { image = best; break; }
            }
          }
        }
        var attrs = ['src', 'data-src', 'data-original', 'data-hi-res', 'data-lazy-src', 'data-image', 'data-url'];
        for (var a = 0; a < attrs.length; a++) {
          var val = img.getAttribute(attrs[a]);
          if (val && !val.startsWith('data:') && !val.includes('blank.gif') && !val.includes('spacer.gif')) {
            try { image = new URL(val, window.location.href).href; break; } catch(_) { image = val; break; }
          }
        }
        if (image) break;
      }

      var bgEl = scope.querySelector ? scope.querySelector('[style*="background-image"], [style*="background:"]') : null;
      var targetBg = bgEl || ((scope.getAttribute && scope.getAttribute('style') && scope.getAttribute('style').includes('background')) ? scope : null);
      if (targetBg) {
        var styleStr = targetBg.getAttribute('style') || '';
        var bgMatch = styleStr.match(/url\(['"]?(https?:\/\/[^'"\)]+)['"]?\)/i) ||
                      styleStr.match(/url\(['"]?([^'"\)]+)['"]?\)/i);
        if (bgMatch && bgMatch[1] && !bgMatch[1].startsWith('data:')) {
          try { image = new URL(bgMatch[1], window.location.href).href; break; } catch(_) { image = bgMatch[1]; break; }
        }
      }
    }

    var pubDate = '';
    if (dateEl) pubDate = dateEl.getAttribute('datetime') || dateEl.textContent.trim();
    var description = (descEl ? descEl.textContent : '').replace(/\s+/g, ' ').trim();

    var singleArticle = [{
      title: title || 'Untitled Article',
      link: link || window.location.href,
      image: image,
      pubDate: pubDate,
      description: description
    }];

    // Build a unique CSS selector for just this card
    var uniqueSelector = cluster.containerSelector;
    try {
      var idx = Array.from(clickedCard.parentElement.children).indexOf(clickedCard);
      if (idx >= 0 && clickedCard.parentElement !== document.body) {
        uniqueSelector = cluster.containerSelector + ':nth-child(' + (idx + 1) + ')';
      }
    } catch(_) {}

    window.parent.postMessage({
      type: 'FEEDOMETER_ELEMENT_SELECTED',
      targetField: activeTargetInput,
      field: activeTargetInput,
      selector: uniqueSelector,
      titleSelector: cluster.titleSelector,
      linkSelector: cluster.linkSelector,
      imageSelector: cluster.imageSelector,
      dateSelector: cluster.dateSelector,
      descriptionSelector: cluster.descriptionSelector,
      matchCount: currentMatches.length || 1,
      count: currentMatches.length || 1,
      ctrlKey: isCtrl,
      textSnippet: title.slice(0, 100),
      articles: singleArticle
    }, '*');
  }, true);

  // Listen for commands from the parent studio
  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'SET_ACTIVE_FIELD' || e.data.type === 'set_target_field') {
      activeTargetInput = e.data.field || e.data.targetField || 'container';
    }
    if (e.data.type === 'HIGHLIGHT_SELECTOR' || e.data.type === 'highlight_selector') {
      highlightMatches(e.data.selector);
    }
    if (e.data.type === 'HIGHLIGHT_MATCH_INDEX') {
      setFocusedMatch(typeof e.data.index === 'number' ? e.data.index : -1);
    }
    if (e.data.type === 'FEEDOMETER_DESELECT_ALL') {
      currentMatches.forEach(function(el) {
        el.classList.remove('__fom_selected', '__fom_sibling', '__fom_focus_match');
      });
      currentMatches = [];
      document.querySelectorAll('.__fom_selected').forEach(function(el) {
        el.classList.remove('__fom_selected');
      });
    }
    if (e.data.type === 'FEEDOMETER_RESELECT_BY_LINK') {
      var targetLink = e.data.link;
      if (targetLink) {
        var matchedCard = document.querySelector('[data-link="' + CSS.escape(targetLink) + '"]') ||
          Array.from(document.querySelectorAll('article, .article-card')).find(function(c) {
            var a = c.querySelector('a[href]');
            return a && (a.href === targetLink || a.getAttribute('href') === targetLink);
          });
        if (matchedCard) {
          matchedCard.classList.add('__fom_selected');
          if (!currentMatches.includes(matchedCard)) currentMatches.push(matchedCard);
        }
      }
    }
  });

  // Notify parent that inspector is ready
  window.parent.postMessage({ type: 'FEEDOMETER_INSPECTOR_READY' }, '*');
  window.parent.postMessage({ type: 'inspector_ready' }, '*');
})();
</script>
`;

/**
 * Proxies a target website URL, rewriting relative paths and injecting the inspector script.
 */
/** Keep previews small enough for iframe parse without freezing the studio tab */
const MAX_PROXY_HTML_CHARS = 900000;

// The preview inspector is deliberately served as a real Worker-hosted JavaScript
// module instead of being generated inside this HTML string.  Permit HTTPS scripts
// so the browser can load that inspector while retaining the existing preview CSP.
const PREVIEW_CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src https: data: blob:; script-src https: 'unsafe-inline'; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:; connect-src https: data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';">`;

function promoteLazyMediaForPreview(html) {
  let out = String(html || '');
  // Promote picture source tags
  out = out.replace(/<source\b([^>]*?)>/gi, (full, attrs) => {
    const lazy = attrs.match(/\s(?:data-srcset|data-src)\s*=\s*(["'])(.*?)\1/i);
    if (lazy && lazy[2] && !/\ssrcset\s*=/i.test(attrs)) {
      return `<source srcset="${lazy[2]}"${attrs}>`;
    }
    return full;
  });

  // Promote img tags
  out = out.replace(/<img\b([^>]*?)>/gi, (full, attrs) => {
    let updated = attrs;
    const lazySrcset = attrs.match(/\s(?:data-srcset)\s*=\s*(["'])(.*?)\1/i);
    if (lazySrcset && lazySrcset[2] && !/\ssrcset\s*=/i.test(updated)) {
      updated += ` srcset="${lazySrcset[2]}"`;
    }
    const lazySrc = attrs.match(/\s(?:data-src|data-lazy-src|data-original|data-image|data-hi-res)\s*=\s*(["'])(.*?)\1/i);
    if (lazySrc && lazySrc[2] && (!/\ssrc\s*=/i.test(updated) || /\ssrc\s*=\s*["'](?:data:image|blank|\s*)["']/i.test(updated))) {
      const src = lazySrc[2].replace(/"/g, '&quot;');
      return `<img src="${src}"${updated}>`;
    }
    return `<img${updated}>`;
  });
  return out;
}

/**
 * Visual studio only needs DOM for point-and-click — strip site JS/iframes/ad containers so the parent page stays responsive.
 */
export function sanitizeHtmlForStudioPreview(html) {
  let out = String(html || '');

  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<script\b[^>]*\/>/gi, '');
  out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
  out = out.replace(/<iframe\b[^>]*\/>/gi, '');
  out = out.replace(/<meta\s+[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, '');
  out = out.replace(/<link\b[^>]*\bas=["']?(?:script|worker)["']?[^>]*>/gi, '');

  // Strip ad containers and tracking pixel wrappers
  out = out.replace(/<ins\b[^>]*class=["'][^"']*adsbygoogle[^"']*["'][^>]*>[\s\S]*?<\/ins>/gi, '');
  out = out.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');

  return out;
}

/**
 * The studio preview is an inspector, not a browser. Preserve each original
 * destination on a data attribute and make anchors inert before the page is
 * placed in the iframe. This is a defence in depth measure in addition to the
 * capture-phase inspector handler: a missed handler must never navigate away
 * from the recipe being built.
 */
export function neutralizePreviewNavigation(html) {
  return String(html || '').replace(/<a\b([^>]*)>/gi, (full, attributes) => {
    const hrefMatch = attributes.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) return full;

    const href = hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '';
    const escapedHref = href.replace(/[&"<>]/g, (char) => ({
      '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;'
    }[char]));
    const safeAttributes = attributes
      .replace(/\shref\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')
      .replace(/\starget\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
    return `<a${safeAttributes} data-feedometer-href="${escapedHref}" href="#">`;
  });
}

const PROXY_NOTICE_HTML = `
<div id="feedometer-proxy-notice" style="position:sticky;top:0;z-index:2147483646;background:#fffbeb;border-bottom:1px solid #fcd34d;color:#92400e;font:600 12px/1.4 system-ui,sans-serif;padding:8px 12px;">
  Feedometer preview: this site may rely on JavaScript. Switch Page loading to <strong>Full browser render</strong> or use Auto Generator.
</div>`;

const PROXY_BROWSER_OK_HTML = `
<div id="feedometer-proxy-notice" style="position:sticky;top:0;z-index:2147483646;background:#ecfdf5;border-bottom:1px solid #6ee7b7;color:#065f46;font:600 12px/1.4 system-ui,sans-serif;padding:8px 12px;">
  Loaded with Cloudflare Browser Rendering — point-and-click selectors apply to rendered HTML.
</div>`;

export function isSiteAccessBlocked(html) {
  const s = String(html || '');
  if (/Access Denied/i.test(s) && /edgesuite|akamai|Reference\s*#/i.test(s)) return true;
  if (/errors\.edgesuite\.net/i.test(s)) return true;
  if (/You don't have permission to access/i.test(s)) return true;
  if (/Attention Required!|cf-challenge|Just a moment/i.test(s) && s.length < 80000) return true;
  return false;
}

/**
 * Some publishers return a technically successful response while their page is
 * still unusable in a stripped, sandboxed preview (BBC is the primary example).
 * For these sources, their official RSS is a faster and more dependable visual
 * selection surface than an incomplete copy of the live website.
 */
export function shouldPreferSyndicatedPreview(targetUrl) {
  try {
    const hostname = new URL(targetUrl).hostname.replace(/^www\./i, '').toLowerCase();
    return hostname === 'bbc.com' || hostname.endsWith('.bbc.co.uk') || hostname === 'bbc.co.uk';
  } catch (_) {
    return false;
  }
}

function buildBlockedSiteHtml(targetUrl) {
  const safe = String(targetUrl || '').replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])
  );
  const autoUrl = 'builder.html?url=' + encodeURIComponent(targetUrl || '');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Site Protected</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f8fafc;color:#1e293b;padding:2rem;}
.card{max-width:540px;margin:2rem auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:1.75rem;box-shadow:0 4px 16px rgba(0,0,0,0.04);}
h1{font-size:1.15rem;margin:0 0 .5rem;color:#0f172a;}
p{font-size:.88rem;line-height:1.5;color:#475569;}
code{font-size:.8rem;word-break:break-all;background:#f1f5f9;padding:3px 6px;border-radius:6px;color:#0f172a;}
ul{font-size:.85rem;color:#334155;line-height:1.6;margin:0.5rem 0 1.25rem;padding-left:1.2rem;}
.actions{display:flex;gap:0.6rem;flex-wrap:wrap;}
.btn-auto{background:#0284c7;color:#fff;border:none;padding:0.65rem 1.1rem;border-radius:8px;font-weight:700;font-size:0.85rem;display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;transition:background 0.15s ease;}
.btn-auto:hover{background:#0369a1;}
</style>
<script>
function navigateToAuto() {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'NAVIGATE_VIEW', view: '${autoUrl}' }, '*');
    }
  } catch(_) {}
  try {
    if (window.top && typeof window.top.loadView === 'function') {
      window.top.loadView('${autoUrl}');
      return;
    }
  } catch(_) {}
  window.location.href = '${autoUrl}';
}
</script>
</head><body><div class="card">
<h1>🛡️ Website Access Protected</h1>
<p>This website requires interactive browser challenges or blocks cloud proxies (e.g. Akamai/Cloudflare bot protection).</p>
<p><code>${safe}</code></p>
<p><strong>Recommended Next Steps:</strong></p>
<ul>
<li>Try <strong>Auto Feed Generator</strong> which extracts metadata and feeds without needing full iframe rendering.</li>
<li>Or test Visual Studio with open sites like <strong>BBC News, TechCrunch, The Verge, Ars Technica</strong>.</li>
</ul>
<div class="actions">
<button type="button" onclick="navigateToAuto()" class="btn-auto">⚡ Switch to Auto Feed Generator</button>
</div>
</div></body></html>`;
}

export async function tryFetchSyndicatedRssHtml(targetUrl, origin) {
  let hostname = '';
  try {
    hostname = new URL(targetUrl).hostname.replace(/^www\./, '');
  } catch (_) {
    return null;
  }

  const cleanTarget = (targetUrl || '').replace(/\/+$/, '');

  // Shared registry prevents Add Source and Visual Builder from drifting apart.
  const categoryFeeds = getOfficialFeedCandidates(targetUrl);
  if (!categoryFeeds.length) {
    // Generic probe
    categoryFeeds.push({ label: 'Feed', url: cleanTarget + '/feed' });
    categoryFeeds.push({ label: 'Feed', url: cleanTarget + '/rss' });
    categoryFeeds.push({ label: 'Feed', url: cleanTarget + '/rss.xml' });
    categoryFeeds.push({ label: 'Feed', url: cleanTarget + '/atom.xml' });
  }

  // Fetch all categories in parallel
  const fetchCategory = async ({ label, url: feedUrl }) => {
    try {
      const res = await fetch(feedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 FeedOmeter/2.1 RSS Reader',
          'Accept': 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(4500)
      });
      if (!res.ok) return null;
      const xml = await res.text();
      if (!xml || (!xml.includes('<rss') && !xml.includes('<feed') && !xml.includes('<item') && !xml.includes('<entry'))) return null;

      const itemBlocks = xml.match(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/gi) || [];
      if (!itemBlocks.length) return null;

      const items = [];
      for (const block of itemBlocks.slice(0, 20)) {
        const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
        const linkMatch =
          block.match(/<link[^>]*href=["']([^"']+)["']/i) ||
          block.match(/<link[^>]*>((?:<!\[CDATA\[)?)([\s\S]*?)(?:\]\]>)?<\/link>/i);
        const descMatch =
          block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) ||
          block.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i);
        const imgMatch =
          block.match(/<enclosure[^>]+url=["']([^"']+)["']/i) ||
          block.match(/<media:content[^>]+url=["']([^"']+)["']/i) ||
          block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i) ||
          block.match(/<img[^>]+src=["']([^"']+)["']/i);
        const dateMatch =
          block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
          block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);

        const title = (titleMatch ? titleMatch[1] : '').replace(/<[^>]+>/g, '').trim();
        const link = (linkMatch ? (linkMatch[1] || linkMatch[2] || '') : '').trim();
        const rawDesc = (descMatch ? descMatch[1] : '').replace(/<[^>]+>/g, '').trim();
        const desc = rawDesc.slice(0, 160) + (rawDesc.length > 160 ? '…' : '');
        const img = imgMatch ? (imgMatch[1] || '') : '';
        const date = (dateMatch ? dateMatch[1] : '').trim();

        if (!title && !link) continue;
        items.push({ title, link, desc, img, date });
      }
      return items.length ? { label, feedUrl, items } : null;
    } catch (_) {
      return null;
    }
  };

  const results = await Promise.all(categoryFeeds.map(fetchCategory));
  const categories = results.filter(Boolean);

  if (!categories.length) return null;

  // Build tab + article HTML
  const escX = (s) => String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

  const tabButtons = categories.map((cat, i) =>
    `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${i}" type="button">${escX(cat.label)} <span class="tab-count">${cat.items.length}</span></button>`
  ).join('');

  const tabPanels = categories.map((cat, i) => {
    const cards = cat.items.map(item => `
      <article class="article-card" data-fom-category="${escX(cat.label)}" data-title="${escX(item.title)}" data-link="${escX(item.link)}" data-image="${escX(item.img)}" data-desc="${escX(item.desc)}" data-date="${escX(item.date)}">
        ${item.img ? `<div class="card-img"><img src="${escX(item.img)}" alt="${escX(item.title)}" onerror="this.parentElement.style.display='none'" /></div>` : ''}
        <div class="card-body">
          <h3 class="card-title">${escX(item.title || 'Untitled')}</h3>
          ${item.desc ? `<p class="card-desc">${escX(item.desc)}</p>` : ''}
          <div class="card-meta">
            ${item.date ? `<span class="card-date">${escX(item.date)}</span>` : ''}
            <span class="card-source">${escX(hostname)}</span>
          </div>
        </div>
      </article>`).join('');
    return `<div class="tab-panel${i === 0 ? ' active' : ''}" data-panel="${i}">${cards}</div>`;
  }).join('');

  const pageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escX(hostname)} — RSS Feed Browser</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;color:#0f172a}
    .rss-header{background:#fff;border-bottom:1px solid #e2e8f0;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
    .rss-site-name{font-size:1.1rem;font-weight:800;color:#0f172a}
    .rss-badge{font-size:0.7rem;background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:999px;font-weight:700;border:1px solid #fcd34d}
    .rss-info{background:#fffbeb;border-bottom:1px solid #fcd34d;padding:8px 20px;font-size:0.78rem;color:#92400e;line-height:1.4}
    .tab-bar{background:#fff;border-bottom:1px solid #e2e8f0;padding:0 16px;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}
    .tab-bar::-webkit-scrollbar{display:none}
    .tab-btn{padding:10px 14px;border:none;background:none;font-size:0.82rem;font-weight:600;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;transition:all 0.15s}
    .tab-btn.active,.tab-btn:hover{color:#0284c7;border-bottom-color:#0284c7}
    .tab-count{background:#e2e8f0;color:#64748b;border-radius:999px;padding:1px 7px;font-size:0.7rem;margin-left:4px}
    .tab-panel{display:none !important;padding:20px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
    .tab-panel.active{display:grid !important}
    .article-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;box-shadow:0 1px 3px rgba(0,0,0,0.05)}
    .article-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px -4px rgba(0,0,0,0.12)}
    .article-card.__fom_selected{outline:3px solid #0284c7;box-shadow:0 0 0 6px rgba(2,132,199,0.15)}
    .card-img{width:100%;height:170px;overflow:hidden;background:#e2e8f0}
    .card-img img{width:100%;height:100%;object-fit:cover}
    .card-body{padding:14px;display:flex;flex-direction:column;gap:8px}
    .card-title{font-size:0.95rem;font-weight:700;line-height:1.35;color:#0f172a}
    .card-desc{font-size:0.8rem;color:#64748b;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    .card-meta{display:flex;justify-content:space-between;font-size:0.72rem;color:#94a3b8;margin-top:auto;padding-top:8px;border-top:1px solid #f1f5f9}
    .card-source{font-weight:600;color:#0284c7}
  </style>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = btn.getAttribute('data-tab');
          document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
          document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.remove('active'); });
          btn.classList.add('active');
          var panel = document.querySelector('.tab-panel[data-panel="' + idx + '"]');
          if (panel) panel.classList.add('active');
        });
      });
    });
  </script>
</head>
<body>
  <div class="rss-header">
    <div class="rss-site-name">${escX(hostname)}</div>
    <div class="rss-badge">📡 RSS Feed Browser</div>
  </div>
  <div class="rss-info">⚠️ This site's live pages are bot-protected. Showing <strong>${categories.reduce((n,c)=>n+c.items.length,0)} real articles</strong> from their official RSS feeds across ${categories.length} categories. Click any article to select it.</div>
  <nav class="tab-bar">${tabButtons}</nav>
  ${tabPanels}
</body>
</html>`;

  return {
    html: pageHtml,
    feedUrl: categories[0].feedUrl,
    itemsCount: categories.reduce((n, c) => n + c.items.length, 0)
  };
}

function preprocessProxyHtml(html, pageUrl, origin, urlObj) {
  let out = sanitizeHtmlForStudioPreview(html);
  out = promoteLazyMediaForPreview(out);
  out = neutralizePreviewNavigation(out);

  if (out.length > MAX_PROXY_HTML_CHARS) {
    out =
      out.slice(0, MAX_PROXY_HTML_CHARS) +
      '\n<!-- Feedometer: HTML truncated for preview performance -->\n';
  }

  out = out.replace(/<meta\s+[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
  out = out.replace(/<meta\s+[^>]*http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');
  out = out.replace(/<meta\s+[^>]*name=["']?referrer["']?[^>]*>/gi, '');
  out = out.replace(/<script[^>]*>\s*(?:top\.)?location\s*=.*?<\/script>/gi, '');

  const baseTag = `<base href="${origin}${urlObj.pathname}">`;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, `$&\n  ${baseTag}\n  ${PREVIEW_CSP_META}`);
  } else {
    out = `${baseTag}\n${PREVIEW_CSP_META}\n${out}`;
  }

  return out;
}

function injectProxyBodyExtras(html, { jsShell, renderEngine, inspectorScriptUrl }) {
  let out = html;
  let prefix = '';
  if (renderEngine === 'browser') {
    prefix = PROXY_BROWSER_OK_HTML;
  } else if (jsShell) {
    prefix = PROXY_NOTICE_HTML;
  }

  if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body[^>]*>/i, (m) => `${m}\n${prefix}`);
  } else if (prefix) {
    out = prefix + out;
  }

  // The inspector is a normal Worker-served script. The historical inline
  // template string remains unused temporarily for source-history safety, but
  // must never again be executed in a browser preview.
  const inspectorTag = `<script id="feedometer-inspector-script" src="${inspectorScriptUrl}"></script>`;
  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${inspectorTag}\n</body>`);
  } else {
    out += inspectorTag;
  }

  return out;
}

export async function fetchProxyPage(targetUrl, env = null, options = {}) {
  let url = String(targetUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  const urlObj = new URL(url);
  const origin = urlObj.origin;
  const renderMode = normalizeRenderMode(options.renderMode || 'auto');
  const inspectorScriptUrl = options.inspectorScriptUrl || 'https://feedometer-api.feedometer.workers.dev/api/builder/preview-inspector.js';

  // Prefer an official, card-based RSS preview when the publisher is known to
  // render poorly in the isolated visual selector iframe.
  if (shouldPreferSyndicatedPreview(url)) {
    const syndicated = await tryFetchSyndicatedRssHtml(url, origin);
    if (syndicated) {
      let html = preprocessProxyHtml(syndicated.html, url, origin, urlObj);
      html = injectProxyBodyExtras(html, {
        jsShell: false,
        renderEngine: 'syndicated',
        inspectorScriptUrl
      });
      return {
        url,
        html,
        jsShell: false,
        renderEngine: 'syndicated',
        browserSkipped: true,
        renderCached: false,
        blocked: false
      };
    }
  }

  let pageResult = null;
  try {
    pageResult = await fetchPageHtmlForBuilder(env, url, { renderMode });
  } catch (err) {
    pageResult = null;
  }

  if (!pageResult || isSiteAccessBlocked(pageResult.html)) {
    // Attempt syndicated RSS discovery fallback for bot-protected news websites
    const syndicated = await tryFetchSyndicatedRssHtml(url, origin);
    if (syndicated) {
      let html = preprocessProxyHtml(syndicated.html, url, origin, urlObj);
      html = injectProxyBodyExtras(html, {
        jsShell: false,
        renderEngine: 'syndicated',
        inspectorScriptUrl
      });
      return {
        url,
        html,
        jsShell: false,
        renderEngine: 'syndicated',
        browserSkipped: false,
        renderCached: false,
        blocked: false
      };
    }

    return {
      url: (pageResult && pageResult.finalUrl) || url,
      html: buildBlockedSiteHtml(url),
      jsShell: false,
      renderEngine: 'blocked',
      browserSkipped: false,
      renderCached: false,
      blocked: true
    };
  }

  const showJsNotice = pageResult.jsShell && pageResult.renderEngine === 'static';

  let html = preprocessProxyHtml(pageResult.html, url, origin, urlObj);
  html = injectProxyBodyExtras(html, {
    jsShell: showJsNotice,
    renderEngine: pageResult.renderEngine,
    inspectorScriptUrl
  });

  return {
    url: pageResult.finalUrl || url,
    html,
    jsShell: pageResult.jsShell,
    renderEngine: pageResult.renderEngine,
    browserSkipped: Boolean(pageResult.browserSkipped),
    renderCached: Boolean(pageResult.cached),
    blocked: false
  };
}

/**
 * Synthesizes fallback strategies for a given CSS selector
 */
export function generateFallbackChain(cssSelector, fieldType = 'title') {
  const fallbacks = [];
  if (!cssSelector) return { primary: { type: 'css', value: '' }, fallbacks: [] };

  // 1. Tag or general class fallback
  const lastTagMatch = cssSelector.match(/([a-z0-9_-]+)$/i);
  if (lastTagMatch) {
    fallbacks.push({ type: 'css', value: lastTagMatch[1] });
  }

  // 2. XPath fallback
  const xpathValue = '//' + cssSelector.replace(/>/g, '/').replace(/#/g, '*[@id="').replace(/\.([a-z0-9_-]+)/gi, '[@class="$1"]');
  fallbacks.push({ type: 'xpath', value: xpathValue });

  // 3. Semantic fallback descriptor
  const semanticDescriptions = {
    container: 'repeating article card or post boundary element',
    title: 'largest clickable headline or heading tag inside article container',
    link: 'primary destination hyperlink a[href] inside article container',
    description: 'first paragraph or summary excerpt element inside article container',
    image: 'lead visual image thumbnail img[src] or figure inside article container',
    date: 'published timestamp or time tag inside article container',
    author: 'byline or author name span inside article container'
  };

  fallbacks.push({
    type: 'semantic',
    description: semanticDescriptions[fieldType] || `semantic ${fieldType} element`
  });

  return {
    primary: { type: 'css', value: cssSelector },
    fallbacks: fallbacks
  };
}

/**
 * Evaluates custom or auto selector configuration on raw HTML (DOM + CSS selectors)
 */
export function evaluateSelectorConfig(html, pageUrl, config = {}) {
  try {
    return evaluateSelectorConfigDom(html, pageUrl, config);
  } catch (err) {
    console.warn('DOM selector evaluation failed, returning empty set:', err.message);
    return {
      matchCount: 0,
      confidence: { title: 0, link: 0, image: 0, date: 0 },
      items: [],
      error: err.message
    };
  }
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * Builds RSS 2.0 XML from evaluated visual-builder items
 */
export function buildRssXmlFromItems(items, siteUrl) {
  let hostname = 'Website';
  try {
    hostname = new URL(siteUrl).hostname;
  } catch (_) {}

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">\n`;
  xml += `  <channel>\n`;
  xml += `    <title>${escapeXml(hostname)} Feed</title>\n`;
  xml += `    <link>${escapeXml(siteUrl)}</link>\n`;
  xml += `    <description>Live RSS feed generated by Feedometer Visual Builder</description>\n`;
  xml += `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n`;

  (items || []).forEach((a) => {
    xml += `    <item>\n`;
    xml += `      <title>${escapeXml(a.title || 'Untitled')}</title>\n`;
    xml += `      <link>${escapeXml(a.link || siteUrl)}</link>\n`;
    xml += `      <guid isPermaLink="true">${escapeXml(a.link || siteUrl)}</guid>\n`;
    if (a.description) xml += `      <description>${escapeXml(a.description)}</description>\n`;
    if (a.pubDate) xml += `      <pubDate>${escapeXml(a.pubDate)}</pubDate>\n`;
    if (a.image) xml += `      <enclosure url="${escapeXml(a.image)}" type="image/jpeg" length="0"/>\n`;
    xml += `    </item>\n`;
  });

  xml += `  </channel>\n</rss>`;
  return xml;
}
