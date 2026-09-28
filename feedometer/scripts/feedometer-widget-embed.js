/* FeedOmeter public widget loader. Safe to embed on third-party pages. */
(function (window, document) {
  'use strict';

  function mount(node) {
    if (!node || node.dataset.feedometerMounted === 'true') return;
    const src = node.getAttribute('data-src');
    if (!src) return;
    let url;
    try { url = new URL(src, window.location.href); } catch (_) { return; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

    const iframe = document.createElement('iframe');
    iframe.src = url.href;
    iframe.title = node.getAttribute('data-title') || 'FeedOmeter feed widget';
    iframe.width = '100%';
    iframe.height = node.getAttribute('data-height') || (url.searchParams.get('layout') === 'ticker' ? '70' : '620');
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    // The host renders untrusted publisher content. Keep it in an opaque origin.
    iframe.sandbox = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
    iframe.style.cssText = 'display:block;width:100%;border:0;overflow:hidden;';
    node.replaceChildren(iframe);
    node.dataset.feedometerMounted = 'true';
  }

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || message.type !== 'feedometer:widget-resize') return;
    const height = Number(message.height);
    if (!Number.isFinite(height)) return;
    document.querySelectorAll('[data-feedometer-widget][data-src]').forEach(function (node) {
      const iframe = node.querySelector('iframe');
      if (!iframe || iframe.contentWindow !== event.source) return;
      let expectedOrigin;
      try { expectedOrigin = new URL(node.getAttribute('data-src'), window.location.href).origin; } catch (_) { return; }
      if (event.origin !== expectedOrigin) return;
      iframe.height = String(Math.max(60, Math.min(1600, Math.ceil(height))));
    });
  });

  function boot() {
    document.querySelectorAll('[data-feedometer-widget][data-src]').forEach(mount);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window, document);
