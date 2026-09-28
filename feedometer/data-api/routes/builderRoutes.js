const express = require('express');
const router = express.Router();
const BuilderService = require('../services/BuilderService');
const PlanEntitlementService = require('../services/PlanEntitlementService');
const { requireAuth } = require('../middleware/authMiddleware');
const { previewWebsite } = require('../services/WebsitePreviewService');
const { isPublicHttpUrl } = require('../discovery/feedValidator');

function buildInspectorScript(targetUrl) {
  return `
<style id="__feedometer_inspector_styles">
  .__fom_hover {
    outline: 2px dashed #0284c7 !important;
    outline-offset: 2px !important;
    cursor: pointer !important;
  }
  .__fom_selected, .article-card.__fom_selected {
    outline: 3px solid #059669 !important;
    outline-offset: 2px !important;
    background-color: rgba(5, 150, 105, 0.08) !important;
  }
  .__fom_badge {
    position: fixed;
    bottom: 12px;
    right: 12px;
    background: #0f172a;
    color: #38bdf8;
    padding: 6px 12px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 12px;
    font-weight: 600;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    z-index: 2147483647;
    pointer-events: none;
  }
</style>
<script id="__feedometer_inspector_script">
(function() {
  let activeTargetField = 'container';
  let hoveredEl = null;

  const badge = document.createElement('div');
  badge.className = '__fom_badge';
  badge.textContent = 'FeedOmeter Visual Inspector Active';
  if (document.body) {
    document.body.appendChild(badge);
  } else {
    document.documentElement.appendChild(badge);
  }

  function getOptimalSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.split(/\\s+/)
        .filter(c => c && !c.startsWith('__fom_') && !c.includes(':') && c.length > 2 && c.length < 35);
      if (classes.length) {
        const classSel = '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
        if (document.querySelectorAll(classSel).length < 60) return classSel;
      }
    }

    const tag = el.tagName.toLowerCase();
    if (el.parentElement && el.parentElement !== document.body) {
      const parentSel = getOptimalSelector(el.parentElement);
      if (parentSel) return parentSel + ' > ' + tag;
    }
    return tag;
  }

  function extractCardData(cardEl) {
    const titleEl = cardEl.querySelector('h1, h2, h3, h4, h5, .title, [class*="title"], [class*="headline"]') || cardEl;
    const linkEl = cardEl.querySelector('a[href]') || (cardEl.tagName === 'A' ? cardEl : null);
    const imgEl = cardEl.querySelector('img[src], img[data-src]');
    const descEl = cardEl.querySelector('p, .desc, .summary, [class*="desc"], [class*="snippet"]');
    const timeEl = cardEl.querySelector('time, .date, [class*="date"], [class*="time"]');

    let link = linkEl ? linkEl.getAttribute('href') : '';
    if (link && !link.startsWith('http')) {
      try { link = new URL(link, window.location.href).href; } catch (_) {}
    }

    let image = '';
    if (imgEl) {
      image = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
      if (image && !image.startsWith('http')) {
        try { image = new URL(image, window.location.href).href; } catch (_) {}
      }
    }

    return {
      title: (titleEl ? titleEl.textContent : '').replace(/\\s+/g, ' ').trim() || 'Untitled Article',
      link: link || window.location.href,
      description: (descEl ? descEl.textContent : '').replace(/\\s+/g, ' ').trim(),
      image: image,
      pubDate: (timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent) : new Date().toISOString()).trim()
    };
  }

  document.addEventListener('mouseover', function(e) {
    if (hoveredEl && hoveredEl !== e.target) {
      hoveredEl.classList.remove('__fom_hover');
    }
    hoveredEl = e.target;
    if (hoveredEl && hoveredEl !== document.body && hoveredEl !== document.documentElement && !hoveredEl.classList.contains('__fom_badge')) {
      hoveredEl.classList.add('__fom_hover');
    }
  }, true);

  document.addEventListener('mouseout', function(e) {
    if (hoveredEl) {
      hoveredEl.classList.remove('__fom_hover');
      hoveredEl = null;
    }
  }, true);

  document.addEventListener('click', function(e) {
    const target = e.target;
    if (!target || target === document.body || target.classList.contains('__fom_badge')) return;

    e.preventDefault();
    e.stopPropagation();

    let container = target.closest('article, [class*="card"], [class*="item"], [class*="post"], [class*="story"], li') || target;
    const selector = getOptimalSelector(container);
    const count = selector ? document.querySelectorAll(selector).length : 1;
    const article = extractCardData(container);

    if (e.ctrlKey || e.metaKey) {
      container.classList.toggle('__fom_selected');
    } else {
      document.querySelectorAll('.__fom_selected').forEach(el => el.classList.remove('__fom_selected'));
      container.classList.add('__fom_selected');
    }

    const payload = {
      type: 'FEEDOMETER_ELEMENT_SELECTED',
      selector: selector,
      targetField: activeTargetField,
      field: activeTargetField,
      count: count,
      matchCount: count,
      ctrlKey: Boolean(e.ctrlKey || e.metaKey),
      article: article,
      articles: [article],
      titleSelector: getOptimalSelector(container.querySelector('h1, h2, h3, h4, h5, .title, a')),
      linkSelector: 'a[href]',
      imageSelector: 'img',
      dateSelector: 'time, .date',
      descriptionSelector: 'p'
    };

    window.parent.postMessage(payload, '*');
    window.parent.postMessage({
      type: 'FEEDOMETER_ARTICLE_CARD_SELECTED_V2',
      article: article,
      count: count,
      ctrlKey: Boolean(e.ctrlKey || e.metaKey)
    }, '*');
  }, true);

  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'SET_ACTIVE_FIELD' || e.data.type === 'set_target_field') {
      activeTargetField = e.data.field || 'container';
      badge.textContent = 'Targeting: ' + activeTargetField.toUpperCase();
    } else if (e.data.type === 'FEEDOMETER_DESELECT_ALL') {
      document.querySelectorAll('.__fom_selected').forEach(el => el.classList.remove('__fom_selected'));
    } else if (e.data.type === 'FEEDOMETER_RESELECT_BY_LINK') {
      const link = e.data.link;
      if (link) {
        document.querySelectorAll('a[href*="' + CSS.escape(link) + '"]').forEach(a => {
          const card = a.closest('article, [class*="card"], [class*="item"], [class*="post"], li') || a;
          card.classList.add('__fom_selected');
        });
      }
    }
  });
})();
</script>
`;
}

// Visual Builder Proxy Endpoint
router.get('/builder/proxy', async (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).send('<html><body><h3>Error: A valid HTTP(S) URL is required for preview.</h3></body></html>');
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 FeedOmeter/2.1',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow'
    });

    if (!response.ok) {
      return res.status(response.status).send(`<html><body><h3>Preview Error: Target site returned HTTP ${response.status}</h3></body></html>`);
    }

    let html = await response.text();
    const finalUrl = response.url || targetUrl;

    // Remove CSP meta tags that block scripting/iframing
    html = html.replace(/<meta\b[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');

    // Inject base href so relative assets load properly
    const baseTag = `<base href="${finalUrl}">`;
    const inspector = buildInspectorScript(finalUrl);

    if (/<head\b[^>]*>/i.test(html)) {
      html = html.replace(/<head\b[^>]*>/i, `$&${baseTag}`);
    } else {
      html = `${baseTag}${html}`;
    }

    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${inspector}</body>`);
    } else {
      html = `${html}${inspector}`;
    }

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('[Builder Proxy] Fetch error:', err.message);
    res.status(502).send(`<html><body><h3>Could not load preview for ${targetUrl}: ${err.message}</h3></body></html>`);
  }
});

// Live Selector Evaluation Endpoint
router.post('/builder/evaluate', async (req, res) => {
  const { url, selectors = {} } = req.body || {};
  const targetUrl = url || req.body.targetUrl;

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ ok: false, success: false, error: 'A valid target URL is required.' });
  }

  try {
    const previewResult = await previewWebsite(targetUrl, { limit: 30 });
    const items = previewResult.articles || [];
    const health = {
      score: items.length > 0 ? Math.min(100, 40 + items.length * 5) : 0,
      grade: items.length >= 10 ? 'A' : (items.length >= 5 ? 'B' : (items.length > 0 ? 'C' : 'F')),
      status: items.length > 0 ? 'optimal' : 'failing'
    };

    res.json({
      ok: true,
      success: true,
      count: items.length,
      matchCount: items.length,
      items,
      health
    });
  } catch (err) {
    console.error('[Builder Evaluate] Evaluation failed:', err.message);
    res.status(500).json({ ok: false, success: false, error: err.message, items: [], matchCount: 0 });
  }
});

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

// Build RSS feed generator (/api/build?url=...)
router.get('/build', async (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ ok: false, success: false, error: 'A valid target URL is required.' });
  }

  try {
    const previewResult = await previewWebsite(targetUrl, { limit: 30 });
    const items = previewResult.articles || [];
    let hostname = 'Website';
    try { hostname = new URL(targetUrl).hostname; } catch (_) {}

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n  <channel>\n    <title>${escapeXml(hostname)} Feed</title>\n    <link>${escapeXml(targetUrl)}</link>\n    <description>Live RSS feed generated by FeedOmeter 2.1</description>\n    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n`;

    for (const a of items) {
      const safeLink = escapeXml(a.link || a.url || targetUrl);
      const safeTitle = String(a.title || 'Untitled Article').replace(/]]>/g, ']]&gt;');
      const safeDesc = String(a.description || '').replace(/]]>/g, ']]&gt;');
      xml += `    <item>\n      <title><![CDATA[${safeTitle}]]></title>\n      <link>${safeLink}</link>\n      <guid isPermaLink="true">${safeLink}</guid>\n      <description><![CDATA[${safeDesc}]]></description>\n      <pubDate>${escapeXml(a.pubDate || a.publishedAt || new Date().toUTCString())}</pubDate>\n`;
      if (a.image) xml += `      <enclosure url="${escapeXml(a.image)}" type="image/jpeg" length="0"/>\n`;
      xml += `    </item>\n`;
    }

    xml += `  </channel>\n</rss>`;

    const acceptsXmlOnly = req.query.format === 'xml' || (req.headers.accept && req.headers.accept.includes('xml') && !req.headers.accept.includes('json') && !req.headers.accept.includes('*/*'));

    if (acceptsXmlOnly) {
      res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
      return res.send(xml);
    }

    res.json({
      ok: true,
      success: true,
      xml,
      items,
      articles: items,
      count: items.length,
      health: { score: items.length ? 95 : 0, grade: items.length ? 'A' : 'F', status: items.length ? 'optimal' : 'failing' }
    });
  } catch (err) {
    console.error('[Build Feed Error]', err.message);
    res.status(500).json({ ok: false, success: false, error: err.message });
  }
});

// Get builder recipes
router.get('/builder/configs', requireAuth, async (req, res) => {
  try {
    const configs = await BuilderService.getUserConfigs(req.user.id);
    res.json({ success: true, configs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save builder recipe
router.post('/builder/configs', requireAuth, async (req, res) => {
  try {
    const entitlement = await PlanEntitlementService.checkEntitlement(req.user.id, 'builder');
    if (!entitlement.allowed) {
      return res.status(403).json({
        success: false,
        error: `Custom builder recipes limit reached (${entitlement.current}/${entitlement.max}) for your ${entitlement.plan} plan.`
      });
    }

    const { id, name, targetUrl, selectors, paginationType } = req.body;
    if (!name || !targetUrl) return res.status(400).json({ success: false, error: 'name and targetUrl required.' });
    const result = await BuilderService.saveConfig(req.user.id, { id, name, targetUrl, selectors, paginationType });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete builder recipe
router.delete('/builder/configs/:id', requireAuth, async (req, res) => {
  try {
    const result = await BuilderService.deleteConfig(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get domain patterns
router.get('/builder/patterns', async (req, res) => {
  try {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ success: false, error: 'domain is required.' });
    const patterns = await BuilderService.getDomainPatterns(domain);
    res.json({ success: true, patterns });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
