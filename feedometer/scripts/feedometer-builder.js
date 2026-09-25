/**
 * Feedometer - Visual RSS Studio & Feed Builder Controller
 * Dual-Mode (Auto Discovery + Visual Point-and-Click Selector Studio)
 * Supports iframe postMessage bridge, live evaluation, feed health scoring, and multi-format feeds (RSS 2.0, Atom 1.0, JSON Feed).
 */

(function () {
  'use strict';

  const IS_VISUAL_BUILDER_PAGE = document.body && document.body.classList.contains('feedometer-visual-builder-page');
  function getApiBase() {
    if (typeof window !== 'undefined') {
      if (window.FEEDOMETER_CONFIG && (window.FEEDOMETER_CONFIG.WORKER_URL || window.FEEDOMETER_CONFIG.apiBaseUrl || window.FEEDOMETER_CONFIG.API_BASE_URL)) {
        return (window.FEEDOMETER_CONFIG.WORKER_URL || window.FEEDOMETER_CONFIG.apiBaseUrl || window.FEEDOMETER_CONFIG.API_BASE_URL).replace(/\/$/, '');
      }
      if (window.FeedOmeterConfig && (window.FeedOmeterConfig.API_BASE_URL || window.FeedOmeterConfig.WORKER_URL)) {
        return (window.FeedOmeterConfig.API_BASE_URL || window.FeedOmeterConfig.WORKER_URL).replace(/\/$/, '');
      }
      if (window.FEEDOMETER_API_BASE) {
        return window.FEEDOMETER_API_BASE.replace(/\/$/, '');
      }
    }
    return 'https://feedometer-api.feedometer.workers.dev';
  }

  let localWorkerOnline = null;

  async function isLocalWorkerOnline() {
    if (localWorkerOnline !== null) return localWorkerOnline;
    const localBase = (typeof window !== 'undefined' && window.FEEDOMETER_LOCAL_API)
      ? window.FEEDOMETER_LOCAL_API.replace(/\/$/, '')
      : '';
    if (!localBase) {
      localWorkerOnline = false;
      return false;
    }
    try {
      const probe = await fetch(`${localBase}/api/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(2500)
      });
      localWorkerOnline = probe.ok;
    } catch (_) {
      localWorkerOnline = false;
    }
    return localWorkerOnline;
  }

  async function resolveWorkerBase() {
    const localBase = (typeof window !== 'undefined' && window.FEEDOMETER_LOCAL_API)
      ? window.FEEDOMETER_LOCAL_API.replace(/\/$/, '')
      : '';
    if (localBase && await isLocalWorkerOnline()) {
      return localBase;
    }
    return getApiBase();
  }

  async function fetchWorker(path, options = {}) {
    const prodBase = getApiBase();
    const localBase = (typeof window !== 'undefined' && window.FEEDOMETER_LOCAL_API)
      ? window.FEEDOMETER_LOCAL_API.replace(/\/$/, '')
      : '';

    if (localBase && await isLocalWorkerOnline()) {
      try {
        const localRes = await fetch(`${localBase}${path}`, options);
        if (localRes.ok || (localRes.status !== 404 && localRes.status !== 502 && localRes.status !== 503)) {
          return localRes;
        }
      } catch (_) {
        // Local worker error, fallback to prodBase
      }
    }

    return fetch(`${prodBase}${path}`, options);
  }

  // DOM Elements - Navigation & Modes
  const tabModeAuto = document.getElementById('tab-mode-auto');
  const tabModeManual = document.getElementById('tab-mode-manual');
  const autoModeInputWrap = document.getElementById('auto-mode-input-wrap');
  const visualStudioPanel = document.getElementById('visual-studio-panel');

  // DOM Elements - Auto Generator
  const siteUrlInput = document.getElementById('site-url-input');
  const btnBuildFeed = document.getElementById('btn-build-feed');
  const loadingSpinner = document.getElementById('loading-spinner');
  const errorContainer = document.getElementById('error-container');

  // DOM Elements - Visual Studio Controls
  const studioContentType = document.getElementById('studio-content-type');
  const studioRenderMode = document.getElementById('studio-render-mode');
  const canvasLoadModeBadge = document.getElementById('canvas-load-mode-badge');
  const studioToggleBtns = document.querySelectorAll('.studio-toggle-btn');
  const selectorFieldItems = document.querySelectorAll('.selector-field-item');
  const visualMatchCount = document.getElementById('visual-match-count');
  const studioMatchingList = document.getElementById('studio-matching-list');
  const btnRefineVisualBuilder = document.getElementById('btn-refine-visual-builder');
  const btnGenerateManualFeed = document.getElementById('btn-generate-manual-feed');

  // DOM Elements - Canvas & Webview
  const studioUrlBar = document.getElementById('studio-url-bar');
  const btnReloadCanvas = document.getElementById('btn-reload-canvas');
  const studioIframeWrap = document.getElementById('studio-iframe-wrap');
  const studioPreviewIframe = document.getElementById('studio-preview-iframe');
  const deviceBtns = document.querySelectorAll('.canvas-device-toggles .device-btn');

  // DOM Elements - Selector Inputs
  const selectorInputs = {
    container: document.getElementById('selector-container'),
    title: document.getElementById('selector-title'),
    link: document.getElementById('selector-link'),
    description: document.getElementById('selector-description'),
    image: document.getElementById('selector-image'),
    date: document.getElementById('selector-date')
  };

  const statusTags = {
    container: document.getElementById('status-container'),
    title: document.getElementById('status-title'),
    link: document.getElementById('status-link'),
    description: document.getElementById('status-description'),
    image: document.getElementById('status-image'),
    date: document.getElementById('status-date')
  };

  // DOM Elements - Results Hub
  const builderResult = document.getElementById('builder-result');
  const feedHealthIndicator = document.getElementById('feed-health-indicator');
  const feedHealthSubtext = document.getElementById('feed-health-subtext');
  const shareFeedUrlInput = document.getElementById('share-feed-url-input');
  const xmlOutputBox = document.getElementById('xml-output-box');
  const previewContainer = document.getElementById('preview-container');

  // Action Buttons
  const btnCopyShareUrl = document.getElementById('btn-copy-share-url');
  const btnCopyInlineUrl = document.getElementById('btn-copy-inline-url');
  const btnCopyXml = document.getElementById('btn-copy-xml');
  const btnDownloadXml = document.getElementById('btn-download-xml');
  const btnOpenInViewer = document.getElementById('btn-open-in-viewer');
  const formatTabBtns = document.querySelectorAll('.format-tab-btn');

  // State
  let currentMode = 'auto'; // 'auto' | 'manual'
  let activeField = 'container';
  let inspectorMode = 'auto'; // 'auto' | 'manual'
  let currentTargetUrl = '';
  let activeFormat = 'rss'; // 'rss' | 'atom' | 'json'

  let generatedFeedData = {
    rss: '',
    atom: '',
    json: '',
    items: [],
    meta: {},
    health: { score: 100, grade: 'A', status: 'optimal' }
  };
  let shareableReaderUrl = '';
  let liveFeedUrl = '';
  /** Original website URL (Auto Generator input) — used for selector evaluate / save-config */
  let sourceSiteUrl = '';
  let canvasLoadGeneration = 0;
  let canvasLoadWatchdog = null;
  let lastCanvasRenderEngine = 'static';

  // Initialize
  function init() {
    setupEventListeners();
    setupIframeBridge();

    const urlParams = new URLSearchParams(window.location.search);
    const siteParam = urlParams.get('url') || urlParams.get('site');

    if (IS_VISUAL_BUILDER_PAGE) {
      // This page should use scripts/visual-builder-studio.js instead.
      return;
    }

    // Auto Generator only
    const modeParam = urlParams.get('mode');
    if (modeParam === 'manual') {
      window.location.href = 'visual-builder.html' + (siteParam ? ('?url=' + encodeURIComponent(siteParam)) : '');
      return;
    }

    if (siteParam) {
      siteUrlInput.value = siteParam;
      sourceSiteUrl = siteParam;
      currentTargetUrl = siteParam;
      buildRssFeed(siteParam);
    }
  }

  // Event Listeners
  function setupEventListeners() {
    // Mode Switcher (Auto Generator page only)
    if (!IS_VISUAL_BUILDER_PAGE && tabModeAuto) {
      tabModeAuto.addEventListener('click', () => switchMode('auto'));
    }
    if (!IS_VISUAL_BUILDER_PAGE && tabModeManual) {
      tabModeManual.addEventListener('click', () => switchMode('manual'));
    }

    // Auto Mode Trigger
    if (btnBuildFeed) {
      btnBuildFeed.addEventListener('click', () => {
        const url = siteUrlInput.value.trim();
        if (url) buildRssFeed(url);
      });
    }

    if (siteUrlInput) {
      siteUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const url = siteUrlInput.value.trim();
          if (url) buildRssFeed(url);
        }
      });
    }

    // Sample Pills
    document.querySelectorAll('.sample-pill[data-site]').forEach(pill => {
      pill.addEventListener('click', () => {
        const site = pill.getAttribute('data-site');
        if (site) {
          siteUrlInput.value = site;
          sourceSiteUrl = site;
          currentTargetUrl = site;
          buildRssFeed(site);
        }
      });
    });

    // Visual Studio Field Selection Focus
    selectorFieldItems.forEach(item => {
      item.addEventListener('click', () => {
        const fieldName = item.getAttribute('data-field');
        setActiveField(fieldName);
      });
    });

    // Inspector Mode Toggles
    studioToggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        studioToggleBtns.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        inspectorMode = btn.getAttribute('data-inspector-mode') || 'auto';
        notifyIframeInspectorMode(inspectorMode);
      });
    });

    // Canvas URL Bar
    if (btnReloadCanvas) {
      btnReloadCanvas.addEventListener('click', () => loadWebsiteForBuilder());
    }

    if (studioUrlBar) {
      studioUrlBar.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loadWebsiteForBuilder();
      });
    }

    if (btnRefineVisualBuilder) {
      btnRefineVisualBuilder.addEventListener('click', () => {
        const site = sourceSiteUrl || (siteUrlInput ? siteUrlInput.value.trim() : '');
        if (!site) {
          showToast('Generate a feed first so we know which website to refine.');
          return;
        }
        window.location.href = `visual-builder.html?url=${encodeURIComponent(site)}`;
      });
    }

    // Device Viewport Toggles
    deviceBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        deviceBtns.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const device = btn.getAttribute('data-device');
        if (studioIframeWrap) {
          studioIframeWrap.className = 'studio-iframe-container' + (device === 'tablet' ? ' view-tablet' : (device === 'mobile' ? ' view-mobile' : ''));
        }
      });
    });

    // Manual Selector Inputs onInput -> Update Status & Trigger Evaluation Debounce
    Object.keys(selectorInputs).forEach(field => {
      const input = selectorInputs[field];
      if (input) {
        input.addEventListener('input', () => {
          updateFieldStatusTag(field, input.value.trim());
          debounceEvaluateSelectors();
        });
      }
    });

    // Manual Mode Generate Button
    if (btnGenerateManualFeed) {
      btnGenerateManualFeed.addEventListener('click', () => {
        generateManualFeed();
      });
    }

    // Format Switcher Tabs
    formatTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        formatTabBtns.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        activeFormat = btn.getAttribute('data-format') || 'rss';
        renderFormatOutput();
      });
    });

    // Copy / Download Handlers
    const copyShareLinkAction = () => {
      const shareUrl = shareFeedUrlInput ? shareFeedUrlInput.value : shareableReaderUrl;
      if (!shareUrl) return;
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('Live feed link copied to clipboard!');
      });
    };

    if (btnCopyShareUrl) btnCopyShareUrl.addEventListener('click', copyShareLinkAction);
    if (btnCopyInlineUrl) btnCopyInlineUrl.addEventListener('click', copyShareLinkAction);

    if (btnCopyXml) {
      btnCopyXml.addEventListener('click', () => {
        const text = getActiveFormatContent();
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          showToast(`${activeFormat.toUpperCase()} feed copied to clipboard!`);
        });
      });
    }

    if (btnDownloadXml) {
      btnDownloadXml.addEventListener('click', () => {
        const text = getActiveFormatContent();
        if (!text) return;
        const mime = activeFormat === 'json' ? 'application/json' : 'application/xml';
        const ext = activeFormat === 'json' ? 'json' : 'xml';
        const blob = new Blob([text], { type: `${mime};charset=utf-8` });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `feed.${ext}`;
        link.click();
        showToast(`Downloaded feed.${ext}!`);
      });
    }

    if (btnOpenInViewer) {
      btnOpenInViewer.addEventListener('click', () => {
        if (shareableReaderUrl) {
          window.open(shareableReaderUrl, '_blank');
        }
      });
    }
  }

  // Mode Switcher
  function switchMode(mode, opts) {
    currentMode = mode;
    if (mode === 'auto') {
      if (tabModeAuto) tabModeAuto.classList.add('is-active');
      if (tabModeManual) tabModeManual.classList.remove('is-active');
      if (autoModeInputWrap) autoModeInputWrap.style.display = 'block';
      if (visualStudioPanel) visualStudioPanel.style.display = 'none';
    } else {
      if (tabModeAuto) tabModeAuto.classList.remove('is-active');
      if (tabModeManual) tabModeManual.classList.add('is-active');
      if (autoModeInputWrap) autoModeInputWrap.style.display = 'none';
      if (visualStudioPanel) visualStudioPanel.style.display = 'grid';

      if (opts && opts.skipAutoLoad) return;

      const site = sourceSiteUrl || (siteUrlInput ? siteUrlInput.value.trim() : '') || (studioUrlBar ? studioUrlBar.value.trim() : '');
      if (site) {
        sourceSiteUrl = site;
        currentTargetUrl = site;
        if (studioUrlBar) studioUrlBar.value = site;
        loadWebsiteForBuilder();
      } else {
        showToast('Paste a website URL, then click Load Website.');
      }
    }
  }

  // Active Target Field
  function setActiveField(fieldName) {
    activeField = fieldName;
    selectorFieldItems.forEach(item => {
      if (item.getAttribute('data-field') === fieldName) {
        item.classList.add('is-focused');
        const input = item.querySelector('.field-selector-input');
        if (input) input.focus();
      } else {
        item.classList.remove('is-focused');
      }
    });

    // Notify iframe of active field change
    if (studioPreviewIframe && studioPreviewIframe.contentWindow) {
      studioPreviewIframe.contentWindow.postMessage({
        type: 'SET_ACTIVE_FIELD',
        field: activeField
      }, '*');
      studioPreviewIframe.contentWindow.postMessage({
        type: 'set_target_field',
        field: activeField
      }, '*');
    }
  }

  function advanceToNextUnboundField() {
    const requiredOrder = ['container', 'title', 'link', 'description', 'image', 'date'];
    for (const f of requiredOrder) {
      if (!selectorInputs[f] || !selectorInputs[f].value.trim()) {
        setActiveField(f);
        return;
      }
    }
  }

  function updateFieldStatusTag(fieldName, value) {
    const tag = statusTags[fieldName];
    if (!tag) return;
    if (value) {
      tag.textContent = 'Bound ✓';
      tag.className = 'field-status-tag bound';
    } else {
      const isReq = (fieldName === 'container' || fieldName === 'title' || fieldName === 'link');
      tag.textContent = isReq ? 'Required' : 'Optional';
      tag.className = 'field-status-tag';
    }
  }

  // PostMessage Bridge with Proxy Inspector
  function setupIframeBridge() {
    window.addEventListener('message', (event) => {
      if (!event.data || typeof event.data !== 'object') return;
      const data = event.data;
      const type = data.type || '';
      const selector = data.selector || '';
      const field = data.targetField || data.field || activeField;
      const count = data.matchCount !== undefined ? data.matchCount : (data.count !== undefined ? data.count : 0);

      if (type === 'FEEDOMETER_ELEMENT_SELECTED' || type === 'element_selected') {
        let target = field || activeField || 'container';

        if (inspectorMode === 'auto') {
          applyAutoClusterSelection(selector, data.tagName);
          target = activeField;
        } else if (selectorInputs[target]) {
          selectorInputs[target].value = selector;
          updateFieldStatusTag(target, selector);
          showToast(`Bound [${target}] → ${selector}`);
        }

        if ((target === 'container' || selectorInputs.container?.value) && count > 0) {
          if (visualMatchCount) visualMatchCount.textContent = `${count} entries`;
        }

        if (inspectorMode !== 'auto') {
          advanceToNextUnboundField();
        }
        debounceEvaluateSelectors();
      } else if (type === 'FEEDOMETER_INSPECTOR_READY' || type === 'inspector_ready') {
        notifyIframeInspectorMode(inspectorMode);
        if (studioPreviewIframe && studioPreviewIframe.contentWindow) {
          studioPreviewIframe.contentWindow.postMessage({
            type: 'SET_ACTIVE_FIELD',
            field: activeField
          }, '*');
        }
      }
    });
  }

  /** RSS.app-style Auto Cluster: one click on an article block fills container/title/link heuristics */
  function applyAutoClusterSelection(selector, tagName) {
    if (!selector) return;
    const tag = String(tagName || '').toLowerCase();
    let containerSel = selector;
    if (tag && tag !== 'article' && tag !== 'div' && tag !== 'li' && tag !== 'section') {
      containerSel = selector.split(' > ').slice(0, -1).join(' > ') || selector;
    }
    if (selectorInputs.container) {
      selectorInputs.container.value = containerSel;
      updateFieldStatusTag('container', containerSel);
    }
    const titleSel = 'h1, h2, h3, h4, .headline, .title, a';
    const linkSel = 'a[href]';
    if (selectorInputs.title) {
      selectorInputs.title.value = titleSel;
      updateFieldStatusTag('title', titleSel);
    }
    if (selectorInputs.link) {
      selectorInputs.link.value = linkSel;
      updateFieldStatusTag('link', linkSel);
    }
    setActiveField('description');
    showToast('Auto cluster: matching entries will appear in the sidebar.');
  }

  function notifyIframeInspectorMode(mode) {
    if (studioPreviewIframe && studioPreviewIframe.contentWindow) {
      studioPreviewIframe.contentWindow.postMessage({
        type: 'SET_INSPECTOR_MODE',
        mode: mode
      }, '*');
      studioPreviewIframe.contentWindow.postMessage({
        type: 'set_inspector_mode',
        mode: mode
      }, '*');
    }
  }

  function getStudioRenderMode() {
    if (!studioRenderMode) return 'auto';
    return studioRenderMode.value || 'auto';
  }

  function updateCanvasLoadBadge(renderEngine, browserSkipped) {
    if (!canvasLoadModeBadge) return;
    canvasLoadModeBadge.style.display = 'inline-flex';
    canvasLoadModeBadge.classList.remove('is-browser', 'is-warn', 'is-static', 'is-feed');
    if (renderEngine === 'feed') {
      canvasLoadModeBadge.textContent = 'Generated RSS feed';
      canvasLoadModeBadge.classList.add('is-feed');
    } else if (renderEngine === 'browser') {
      canvasLoadModeBadge.textContent = 'Browser rendered';
      canvasLoadModeBadge.classList.add('is-browser');
    } else if (browserSkipped) {
      canvasLoadModeBadge.textContent = 'HTML only — enable Browser Rendering on worker';
      canvasLoadModeBadge.classList.add('is-warn');
    } else {
      canvasLoadModeBadge.textContent = 'Fast HTML';
      canvasLoadModeBadge.classList.add('is-static');
    }
  }

  function setCanvasLoading(isLoading) {
    if (studioIframeWrap) {
      studioIframeWrap.classList.toggle('is-loading-canvas', isLoading);
    }
    if (btnReloadCanvas) {
      btnReloadCanvas.disabled = isLoading;
      btnReloadCanvas.textContent = isLoading ? 'Loading…' : 'Load Website';
    }
  }

  /** Visual Builder: load the target website into the canvas (RSS.app-style). */
  async function loadWebsiteForBuilder(retryWithProd) {
    let url = studioUrlBar ? studioUrlBar.value.trim() : '';
    if (!url) url = sourceSiteUrl || (siteUrlInput ? siteUrlInput.value.trim() : '');
    if (!url) {
      showError('Paste the website URL you want a feed from, then click Load Website.');
      return;
    }
    if (studioUrlBar) studioUrlBar.value = url;
    if (siteUrlInput) siteUrlInput.value = url;

    if (/skysports\.com|sky\.com|espn\.com/i.test(url) && getStudioRenderMode() === 'auto') {
      updateCanvasLoadBadge('browser', false);
    }

    return loadWebsiteProxy(url, retryWithProd);
  }

  /** Proxy + inspector injection for point-and-click selector binding */
  async function loadWebsiteProxy(url, retryWithProd) {
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    sourceSiteUrl = url;
    currentTargetUrl = url;

    if (!studioPreviewIframe) return;

    const loadGen = ++canvasLoadGeneration;
    const renderMode = getStudioRenderMode();
    const proxyPath = `/api/builder/proxy?url=${encodeURIComponent(url)}&render_mode=${encodeURIComponent(renderMode)}`;
    let hostname = url;
    try { hostname = new URL(url).hostname; } catch (_) {}

    hideError();
    setCanvasLoading(true);
    showToast(
      renderMode === 'browser'
        ? `Loading ${hostname} (browser render, up to ~60s)…`
        : `Loading website preview for ${hostname}…`
    );
    lastCanvasRenderEngine = renderMode === 'browser' ? 'browser' : 'static';
    updateCanvasLoadBadge(lastCanvasRenderEngine, false);

    if (canvasLoadWatchdog) clearTimeout(canvasLoadWatchdog);
    let loadSettled = false;
    const finishCanvasLoad = (opts = {}) => {
      if (loadGen !== canvasLoadGeneration || loadSettled) return;
      loadSettled = true;
      if (canvasLoadWatchdog) clearTimeout(canvasLoadWatchdog);
      setCanvasLoading(false);
      if (opts.error) showError(opts.error);
      else if (opts.toast) showToast(opts.toast);
      if (opts.ready) {
        if (inspectorMode === 'auto') {
          setActiveField('container');
        }
        notifyIframeInspectorMode(inspectorMode);
        setActiveField(activeField);
      }
    };

    canvasLoadWatchdog = setTimeout(() => finishCanvasLoad({ toast: `Site preview opened for ${hostname}.` }), 45000);
    studioPreviewIframe.onload = () => finishCanvasLoad({ toast: `Site preview ready`, ready: true });
    studioPreviewIframe.onerror = () => finishCanvasLoad({ error: `Preview failed for ${hostname}.` });

    try {
      let apiBase = retryWithProd ? getApiBase() : await resolveWorkerBase();
      studioPreviewIframe.removeAttribute('srcdoc');
      studioPreviewIframe.src = `${apiBase}${proxyPath}`;
    } catch (err) {
      if (!retryWithProd) return loadWebsiteProxy(url, true);
      finishCanvasLoad({ error: err.message || 'Preview failed' });
    }
  }

  // Debounced Selector Live Evaluation
  let evalTimeout = null;
  function debounceEvaluateSelectors() {
    clearTimeout(evalTimeout);
    evalTimeout = setTimeout(evaluateSelectorsLive, 400);
  }

  async function evaluateSelectorsLive() {
    const evaluateUrl = sourceSiteUrl || currentTargetUrl;
    if (!evaluateUrl) return;
    const selectors = getActiveSelectors();
    if (!selectors.container) return;

    try {
      const response = await fetchWorker(`/api/builder/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: evaluateUrl,
          selectors: selectors,
          contentType: studioContentType ? studioContentType.value : 'generic',
          render_mode: getStudioRenderMode()
        })
      });

      if (response.ok) {
        const data = await response.json();
        const count = data.matchCount !== undefined ? data.matchCount : (data.items ? data.items.length : 0);
        if (visualMatchCount) {
          visualMatchCount.textContent = `${count} entries`;
        }
        renderMatchingEntriesList(data.items || []);
      }
    } catch (e) {
      console.warn('Live selector evaluation skipped:', e);
    }
  }

  function renderMatchingEntriesList(items) {
    if (!studioMatchingList) return;
    studioMatchingList.innerHTML = '';
    if (!items || !items.length) {
      studioMatchingList.innerHTML = '<li class="studio-match-empty">Click the live site (Auto Cluster) or bind selectors (Manual) to see matches.</li>';
      return;
    }
    items.slice(0, 40).forEach((item) => {
      const li = document.createElement('li');
      li.className = 'studio-match-item';
      const title = escapeHtmlText(item.title || 'Untitled');
      li.innerHTML = `<span class="studio-match-title">${title}</span>`;
      studioMatchingList.appendChild(li);
    });
    if (items.length > 40) {
      const more = document.createElement('li');
      more.className = 'studio-match-more';
      more.textContent = `+ ${items.length - 40} more…`;
      studioMatchingList.appendChild(more);
    }
  }

  function getActiveSelectors() {
    const res = {};
    Object.keys(selectorInputs).forEach(k => {
      const val = selectorInputs[k] ? selectorInputs[k].value.trim() : '';
      if (val) res[k] = val;
    });
    return res;
  }

  // Auto Mode Feed Builder
  async function buildRssFeed(url) {
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
      if (siteUrlInput) siteUrlInput.value = url;
    }
    currentTargetUrl = url;
    sourceSiteUrl = url;

    showLoading(true);
    hideError();
    if (builderResult) builderResult.style.display = 'none';

    try {
      const path = `/api/build?url=${encodeURIComponent(url)}`;
      const response = await fetchWorker(path, {
        headers: { 'Accept': 'application/json, application/xml, text/xml, */*' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Server returned status ${response.status}`);
      }

      let data;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        data = await response.json();
      } else {
        const rawText = await response.text();
        try {
          data = JSON.parse(rawText);
        } catch (_) {
          data = { xml: rawText };
        }
      }

      const liveEndpoint = `${getApiBase()}${path}`;
      processFeedResponse(data, url, liveEndpoint);
    } catch (err) {
      console.error('Build feed error:', err);
      showError(`Failed to generate RSS feed: ${err.message || 'Unknown error'}`);
    } finally {
      showLoading(false);
    }
  }

  // Manual Mode Feed Generator & Persist
  async function generateManualFeed() {
    const url = sourceSiteUrl || currentTargetUrl || (siteUrlInput ? siteUrlInput.value.trim() : '');
    if (!url) {
      showError('Please enter a target URL in the canvas toolbar.');
      return;
    }

    const selectors = getActiveSelectors();
    if (!selectors.container) {
      showError('Please specify or click an Article Container selector.');
      return;
    }
    if (!selectors.title) {
      showError('Please specify or click a Headline / Title selector.');
      return;
    }
    if (!selectors.link) {
      showError('Please specify or click an Article Link selector.');
      return;
    }

    showLoading(true);
    hideError();

    try {
      // 1. Evaluate and build feed
      const response = await fetchWorker(`/api/builder/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          selectors: selectors,
          contentType: studioContentType ? studioContentType.value : 'generic',
          render_mode: getStudioRenderMode(),
          render_js: getStudioRenderMode() === 'browser' || lastCanvasRenderEngine === 'browser' ? 1 : 0
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Failed to evaluate custom selectors.');
      }

      const evalResult = await response.json();

      if (!evalResult.items || evalResult.items.length === 0) {
        throw new Error('No articles matched your selectors. Refine the container/title/link fields or load the page and use point-and-click.');
      }

      // 2. Persist config to D1 when available
      const saveResult = await saveBuilderConfig(
        url,
        selectors,
        studioContentType ? studioContentType.value : 'generic',
        evalResult.health,
        getStudioRenderMode() === 'browser' || lastCanvasRenderEngine === 'browser'
      );

      // 3. Process generated items — live URL uses saved Visual Builder recipe
      const liveEndpoint = `${getApiBase()}/api/builder/feed?url=${encodeURIComponent(url)}`;
      renderEvaluatedFeed(evalResult, url, liveEndpoint);

      if (saveResult && saveResult.ok) {
        showToast('Feed generated and selector recipe saved.');
      } else {
        showToast('Feed preview ready. Live feed URL requires worker storage (save-config).');
      }
    } catch (err) {
      console.error('Manual feed build error:', err);
      showError(err.message || 'Error generating feed from selectors.');
    } finally {
      showLoading(false);
    }
  }

  async function saveBuilderConfig(url, selectors, contentType, health, useBrowserRender) {
    try {
      const renderMode = getStudioRenderMode();
      const response = await fetchWorker(`/api/builder/save-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          selectors: selectors,
          content_type: contentType,
          contentType: contentType,
          health: health,
          extraction_mode: 'manual',
          render_mode: renderMode,
          render_js: useBrowserRender || renderMode === 'browser' ? 1 : 0
        })
      });
      return response;
    } catch (e) {
      console.warn('Auto-save builder config note:', e);
      return null;
    }
  }

  // Feed Response Processing & Render
  function processFeedResponse(data, originalUrl, liveUrl) {
    sourceSiteUrl = originalUrl;
    currentTargetUrl = originalUrl;
    let xmlString = '';
    let atomString = '';
    let jsonString = '';
    let articles = [];
    let health = null;

    if (typeof data === 'string') {
      xmlString = data;
    } else if (data && typeof data === 'object') {
      xmlString = data.xml || (data.formats && data.formats.rss) || '';
      atomString = data.atom || (data.formats && data.formats.atom) || '';
      jsonString = (typeof data.jsonFeed === 'string' ? data.jsonFeed : (data.formats && typeof data.formats.json === 'string' ? data.formats.json : '')) || (data.jsonFeed ? JSON.stringify(data.jsonFeed, null, 2) : '');
      articles = Array.isArray(data.items) ? data.items : [];
      health = data.health || null;
    }

    // Fallback: If articles array not provided, parse from XML string
    if (articles.length === 0 && xmlString) {
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
        const items = xmlDoc.querySelectorAll('item');

        items.forEach(item => {
          const title = item.querySelector('title') ? item.querySelector('title').textContent : 'Untitled Article';
          const link = item.querySelector('link') ? item.querySelector('link').textContent : originalUrl;
          const desc = item.querySelector('description') ? item.querySelector('description').textContent : '';
          const pubDate = item.querySelector('pubDate') ? item.querySelector('pubDate').textContent : '';
          const enclosure = item.querySelector('enclosure');
          const mediaContent = item.querySelector('media\\:content, content');
          let image = '';
          if (enclosure && enclosure.getAttribute('url')) {
            image = enclosure.getAttribute('url');
          } else if (mediaContent && mediaContent.getAttribute('url')) {
            image = mediaContent.getAttribute('url');
          }

          articles.push({ title, link, description: desc, pubDate, image });
        });
      } catch (parseErr) {
        console.warn('XML fallback parsing warning:', parseErr);
      }
    }

    // If XML wasn't provided directly, build it from articles
    if (!xmlString && articles.length > 0) {
      xmlString = buildRssXmlFromArticles(articles, originalUrl);
    }

    if (!atomString && xmlString) {
      atomString = convertRssToAtom(xmlString, originalUrl);
    }
    if (!jsonString && xmlString) {
      jsonString = convertRssToJsonFeed(xmlString, originalUrl);
    }

    if (!health) {
      health = calculateHealth(articles);
    }

    generatedFeedData.rss = xmlString;
    generatedFeedData.atom = atomString;
    generatedFeedData.json = jsonString;
    generatedFeedData.items = articles;
    generatedFeedData.health = health;
    liveFeedUrl = liveUrl;

    if (studioUrlBar && originalUrl) {
      studioUrlBar.value = originalUrl;
    }

    // Set URLs
    shareableReaderUrl = `reader.html?feed=${encodeURIComponent(liveUrl)}`;
    if (shareFeedUrlInput) shareFeedUrlInput.value = liveUrl;

    // Render components
    renderHealthBadge(health);
    renderFormatOutput();
    renderArticleCards(articles, originalUrl);

    if (builderResult) {
      builderResult.style.display = 'flex';
      builderResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderEvaluatedFeed(evalResult, originalUrl, liveUrl) {
    const articles = evalResult.items || [];
    generatedFeedData.items = articles;
    generatedFeedData.rss = buildRssXmlFromArticles(articles, originalUrl);
    generatedFeedData.atom = convertRssToAtom(generatedFeedData.rss, originalUrl);
    generatedFeedData.json = convertRssToJsonFeed(generatedFeedData.rss, originalUrl);
    liveFeedUrl = liveUrl;

    const health = evalResult.health || calculateHealth(articles);
    generatedFeedData.health = health;

    shareableReaderUrl = `reader.html?feed=${encodeURIComponent(liveUrl)}`;
    if (shareFeedUrlInput) shareFeedUrlInput.value = liveUrl;

    renderHealthBadge(health);
    renderFormatOutput();
    renderArticleCards(articles, originalUrl);

    if (builderResult) {
      builderResult.style.display = 'flex';
      builderResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function calculateHealth(items) {
    if (!items || items.length === 0) {
      return { score: 0, healthScore: 0, grade: 'F', status: 'broken' };
    }
    let total = 0;
    const count = items.length;

    // Item count score (up to 30)
    total += Math.min(30, count * 3);

    // Title score (up to 25)
    const withTitle = items.filter(i => i.title && i.title !== 'Untitled Article').length;
    total += Math.round((withTitle / count) * 25);

    // Link score (up to 25)
    const withLink = items.filter(i => i.link && /^https?:\/\//i.test(i.link)).length;
    total += Math.round((withLink / count) * 25);

    // Image/Description/Date enrichment (up to 20)
    const withEnrichment = items.filter(i => i.image || i.description || i.pubDate).length;
    total += Math.round((withEnrichment / count) * 20);

    const score = Math.min(100, Math.max(0, total));
    let grade = 'A';
    let status = 'optimal';
    if (score < 50) { grade = 'F'; status = 'failing'; }
    else if (score < 75) { grade = 'C'; status = 'degraded'; }
    else if (score < 90) { grade = 'B'; status = 'optimal'; }

    return { score, healthScore: score, grade, status };
  }

  function renderHealthBadge(health) {
    if (!feedHealthIndicator) return;
    const score = (health && typeof health.healthScore === 'number') 
      ? health.healthScore 
      : ((health && typeof health.score === 'number') ? health.score : 100);
    
    let icon = '🟢';
    let cssClass = 'feed-health-badge';

    if (score < 50) {
      icon = '🔴';
      cssClass += ' failing';
      if (feedHealthSubtext) feedHealthSubtext.textContent = 'Feed extraction degraded or missing essential metadata.';
    } else if (score < 80) {
      icon = '🟡';
      cssClass += ' degraded';
      if (feedHealthSubtext) feedHealthSubtext.textContent = 'Feed operational with partial fallback selectors.';
    } else {
      icon = '🟢';
      if (feedHealthSubtext) feedHealthSubtext.textContent = 'Extraction verified with 3-tier OpenGraph enrichment & active fallback strategies.';
    }

    const grade = (health && health.grade) || (score >= 90 ? 'A' : (score >= 75 ? 'B' : (score >= 50 ? 'C' : 'F')));
    feedHealthIndicator.className = cssClass;
    feedHealthIndicator.textContent = `${icon} Feed Health: ${score}% (Grade ${grade})`;
  }

  function renderFormatOutput() {
    if (!xmlOutputBox) return;
    xmlOutputBox.textContent = getActiveFormatContent();
  }

  function getActiveFormatContent() {
    if (activeFormat === 'atom') return generatedFeedData.atom || generatedFeedData.rss;
    if (activeFormat === 'json') return generatedFeedData.json || generatedFeedData.rss;
    return generatedFeedData.rss;
  }

  // Multi-Format Generators
  function convertRssToAtom(rssXml, siteUrl) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(rssXml, 'text/xml');
      const title = doc.querySelector('channel > title') ? doc.querySelector('channel > title').textContent : 'Feedometer Feed';
      const items = doc.querySelectorAll('item');

      let atom = `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n`;
      atom += `  <title>${escapeXml(title)}</title>\n`;
      atom += `  <link href="${escapeXml(siteUrl)}" rel="alternate"/>\n`;
      atom += `  <updated>${new Date().toISOString()}</updated>\n`;
      atom += `  <id>${escapeXml(siteUrl)}</id>\n`;

      items.forEach(item => {
        const iTitle = item.querySelector('title') ? item.querySelector('title').textContent : 'Untitled';
        const iLink = item.querySelector('link') ? item.querySelector('link').textContent : siteUrl;
        const iDesc = item.querySelector('description') ? item.querySelector('description').textContent : '';
        const iDate = item.querySelector('pubDate') ? new Date(item.querySelector('pubDate').textContent).toISOString() : new Date().toISOString();

        atom += `  <entry>\n`;
        atom += `    <title>${escapeXml(iTitle)}</title>\n`;
        atom += `    <link href="${escapeXml(iLink)}"/>\n`;
        atom += `    <id>${escapeXml(iLink)}</id>\n`;
        atom += `    <updated>${iDate}</updated>\n`;
        atom += `    <summary>${escapeXml(iDesc)}</summary>\n`;
        atom += `  </entry>\n`;
      });

      atom += `</feed>`;
      return atom;
    } catch (e) {
      return rssXml;
    }
  }

  function convertRssToJsonFeed(rssXml, siteUrl) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(rssXml, 'text/xml');
      const title = doc.querySelector('channel > title') ? doc.querySelector('channel > title').textContent : 'Feedometer Feed';
      const items = doc.querySelectorAll('item');

      const jsonFeed = {
        version: "https://jsonfeed.org/version/1.1",
        title: title,
        home_page_url: siteUrl,
        feed_url: liveFeedUrl || siteUrl,
        items: []
      };

      items.forEach(item => {
        const iTitle = item.querySelector('title') ? item.querySelector('title').textContent : 'Untitled';
        const iLink = item.querySelector('link') ? item.querySelector('link').textContent : siteUrl;
        const iDesc = item.querySelector('description') ? item.querySelector('description').textContent : '';
        const iDate = item.querySelector('pubDate') ? new Date(item.querySelector('pubDate').textContent).toISOString() : new Date().toISOString();
        const enclosure = item.querySelector('enclosure');

        const entry = {
          id: iLink,
          url: iLink,
          title: iTitle,
          content_html: iDesc,
          date_published: iDate
        };
        if (enclosure && enclosure.getAttribute('url')) {
          entry.image = enclosure.getAttribute('url');
        }
        jsonFeed.items.push(entry);
      });

      return JSON.stringify(jsonFeed, null, 2);
    } catch (e) {
      return JSON.stringify({ error: "Failed to convert to JSON feed" });
    }
  }

  function buildRssXmlFromArticles(articles, siteUrl) {
    let hostname = 'Website';
    try { hostname = new URL(siteUrl).hostname; } catch (e) {}

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">\n`;
    xml += `  <channel>\n`;
    xml += `    <title>${escapeXml(hostname)} Feed</title>\n`;
    xml += `    <link>${escapeXml(siteUrl)}</link>\n`;
    xml += `    <description>Live RSS feed generated by Feedometer</description>\n`;
    xml += `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n`;

    articles.forEach(a => {
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

  function escapeXml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe).replace(/[<>&'"]/g, c => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
      }
    });
  }

  function escapeHtmlText(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function convertCardArticleToFeed(article, sourceUrl) {
    if (!article || !article.title) {
      showError('This card is missing a title and cannot be converted to RSS.');
      return;
    }
    if (!article.link || !/^https?:\/\//i.test(article.link)) {
      showError('This card needs a valid article link before it can become an RSS item.');
      return;
    }

    const item = {
      title: article.title,
      link: article.link,
      description: article.description || article.title,
      pubDate: article.pubDate || new Date().toUTCString(),
      image: article.image || ''
    };

    hideError();
    activeFormat = 'rss';
    formatTabBtns.forEach((btn) => {
      btn.classList.toggle('is-active', (btn.getAttribute('data-format') || 'rss') === 'rss');
    });

    generatedFeedData.rss = buildRssXmlFromArticles([item], item.link);
    generatedFeedData.atom = convertRssToAtom(generatedFeedData.rss, item.link);
    generatedFeedData.json = convertRssToJsonFeed(generatedFeedData.rss, item.link);
    generatedFeedData.items = [item];
    generatedFeedData.health = calculateHealth([item]);
    liveFeedUrl = item.link;
    shareableReaderUrl = `reader.html?feed=${encodeURIComponent(item.link)}`;

    if (shareFeedUrlInput) {
      shareFeedUrlInput.value = item.link;
    }

    renderHealthBadge(generatedFeedData.health);
    renderFormatOutput();

    if (builderResult) {
      builderResult.style.display = 'flex';
      builderResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    showToast('Converted to RSS 2.0 feed (1 article). Copy or download below.');
  }

  // Article Cards Grid Preview
  function renderArticleCards(articles, originalUrl) {
    if (!previewContainer) return;
    previewContainer.innerHTML = '';

    const heading = document.createElement('div');
    heading.className = 'articles-preview-heading';
    heading.innerHTML = `
      <span>Live Preview (${articles.length} Articles)</span>
      <span style="font-size: 0.85rem; font-weight: 600; color: #64748b;">Displaying extracted cards</span>
    `;
    previewContainer.appendChild(heading);

    if (articles.length === 0) {
      previewContainer.innerHTML += `
        <div style="text-align: center; padding: 2rem; color: #64748b; background: #f8fafc; border-radius: 12px; border: 1px dashed #cbd5e1;">
          No articles detected on this webpage. Try switching to Visual Builder (Manual Mode) to point and click target elements.
        </div>
      `;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'cards-grid';

    let domain = '';
    try { domain = new URL(originalUrl).hostname; } catch (e) { domain = 'web'; }

    articles.forEach(article => {
      const card = document.createElement('div');
      card.className = 'article-card';

      // Media
      let mediaHtml = '';
      if (article.image) {
        mediaHtml = `
          <div class="article-card-media">
            <img src="${article.image}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'">
          </div>
        `;
      }

      // Date
      const dateText = article.pubDate ? formatDate(article.pubDate) : 'Recent';
      const safeTitle = escapeHtmlText(article.title);
      const safeLink = escapeHtmlText(article.link || '#');
      const excerptHtml = article.description
        ? `<p class="article-card-excerpt">${escapeHtmlText(String(article.description).slice(0, 140))}${String(article.description).length > 140 ? '…' : ''}</p>`
        : '';

      card.innerHTML = `
        ${mediaHtml}
        <div class="article-card-body">
          <div class="article-meta-row">
            <span class="article-source-pill" title="${escapeHtmlText(domain)}">${escapeHtmlText(domain)}</span>
            <span class="article-date-text">${escapeHtmlText(dateText)}</span>
          </div>
          <h4 class="article-card-title">
            <a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeTitle}</a>
          </h4>
          ${excerptHtml}
          <div class="article-card-footer">
            <div class="card-footer-icons-left">
              <button type="button" class="card-icon-action btn-card-star" title="Star item">⭐</button>
              <button type="button" class="card-icon-action btn-card-share" title="Share item">🔗</button>
              <button type="button" class="card-icon-action btn-card-convert-feed" title="Convert into feed" aria-label="Convert into feed">📡</button>
            </div>
            <a href="${safeLink}" target="_blank" rel="noopener noreferrer" style="font-size: 0.78rem; font-weight: 700; color: #0284c7; text-decoration: none;">
              Read →
            </a>
          </div>
        </div>
      `;

      const starBtn = card.querySelector('.btn-card-star');
      const shareBtn = card.querySelector('.btn-card-share');
      const convertBtn = card.querySelector('.btn-card-convert-feed');
      if (starBtn) {
        starBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          starBtn.classList.toggle('starred');
          showToast(starBtn.classList.contains('starred') ? 'Article starred! ⭐' : 'Article unstarred');
        });
      }
      if (shareBtn) {
        shareBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (article.link) {
            navigator.clipboard.writeText(article.link).then(() => {
              showToast('Article link copied! 🔗');
            }).catch(() => {
              showToast('Article link: ' + article.link);
            });
          }
        });
      }
      if (convertBtn) {
        convertBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          convertCardArticleToFeed(article, originalUrl);
        });
      }

      grid.appendChild(card);
    });

    previewContainer.appendChild(grid);
  }

  function formatDate(dStr) {
    try {
      const d = new Date(dStr);
      if (isNaN(d.getTime())) return dStr;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) {
      return dStr;
    }
  }

  // Feedback Helpers
  function showLoading(show) {
    if (loadingSpinner) loadingSpinner.style.display = show ? 'flex' : 'none';
  }

  function showError(msg) {
    if (errorContainer) {
      errorContainer.style.display = 'block';
      errorContainer.innerHTML = `
        <div class="builder-error-box">
          <span style="font-size: 1.25rem;">⚠️</span>
          <div>
            <strong>Feed Construction Notice:</strong>
            <p style="margin-top: 0.25rem; font-size: 0.88rem;">${msg}</p>
          </div>
        </div>
      `;
    }
  }

  function hideError() {
    if (errorContainer) {
      errorContainer.style.display = 'none';
      errorContainer.innerHTML = '';
    }
  }

  function showToast(msg) {
    const toast = document.getElementById('discovery-toast');
    const toastMsg = document.getElementById('toast-message');
    if (toast && toastMsg) {
      toastMsg.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => { toast.classList.remove('show'); }, 2500);
    }
  }

  // Boot on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
