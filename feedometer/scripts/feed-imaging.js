/**
 * scripts/feed-imaging.js — Global Feed Imaging & Refinement Library
 *
 * Provides central, reusable high-resolution image processing, CDN upscaling,
 * junk filtering, smart focal point centering, and robust media rendering
 * for all FeedOmeter pages (Reader, Add Source / Overview, Widget Studio,
 * Filters, Intelligence Briefing, Starred, Read Later, etc.).
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeUrl(raw) {
    if (!raw) return '';
    var val = String(raw).trim()
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '')
      .replace(/&#39;|&apos;/gi, "'");
    if (val.indexOf('//') === 0) val = 'https:' + val;
    return val;
  }

  function isUsableImage(raw) {
    var val = normalizeUrl(raw);
    if (!val || !/^https?:\/\//i.test(val)) return false;
    var lower = val.toLowerCase();
    // Filter tracking pixels, beacons, icons, gravatar default badges
    if (/favicon|sprite|gravatar|doubleclick|scorecardresearch|pixel\.(gif|png|jpe?g)|spacer|tracking|quantserve|beacon|feedburner\.com\/~r\//.test(lower)) {
      return false;
    }
    // Filter tiny dimensions
    if (/\/(1|2|8|16|24|32)x\1\b/.test(lower)) return false;
    if (/[?&](?:w|width|h|height)=([1-9]|[12][0-9])\b/.test(lower)) return false;
    return true;
  }

  /**
   * Upgrades low-res thumbnails and CDN constrained URLs to crisp, high-res images.
   */
  function upgradeUrl(raw) {
    var val = normalizeUrl(raw);
    if (!val || !/^https?:\/\//i.test(val)) return val;

    // Do not modify cryptographic signatures / tokens
    if (/[?&](?:s|sig|signature|token|hmac|auth|hash)=/i.test(val)) {
      return val;
    }

    try {
      // 1. BBC News CDN (ichef.bbci.co.uk)
      if (/ichef\.bbci\.co\.uk/i.test(val)) {
        val = val.replace(/\/news\/\d+\//i, '/news/1024/');
        val = val.replace(/\/ace\/standard\/\d+\//i, '/ace/standard/1024/');
        val = val.replace(/\/ace\/ws\/\d+\//i, '/ace/ws/1024/');
        val = val.replace(/\/cpsprodpb\/\d+\//i, '/cpsprodpb/1024/');
        val = val.replace(/_(\d{2,3}|\d{3}x\d{3})\.(jpg|jpeg|png|webp)/i, '_1024.$2');
        return val;
      }

      // 2. YouTube Posters & Thumbnails
      if (/(?:ytimg\.com|youtube\.com)/i.test(val)) {
        val = val.replace(/\/(?:default|mqdefault|sddefault)\.jpg/i, '/hqdefault.jpg');
        return val;
      }

      // 3. WordPress / Jetpack / Photon CDN (i0.wp.com, i1.wp.com, *.files.wordpress.com, etc.)
      if (/(?:\.wp\.com|wp-content|wordpress)/i.test(val)) {
        val = val.replace(/([?&])(?:w|width)=\d+/ig, '$1w=1200');
        val = val.replace(/([?&])(?:h|height)=\d+/ig, '$1h=800');
        val = val.replace(/([?&])(?:resize|fit)=\d+(?:,\d+)?/ig, '$1resize=1200,800');
        val = val.replace(/([?&])(?:zoom)=\d+/ig, '');
        val = val.replace(/-(?:150x150|240x135|300x\d+|400x\d+|600x\d+)\.(jpg|jpeg|png|webp)/i, '.$1');
        return val.replace(/[?&]$/, '').replace(/\?&/, '?');
      }

      // 4. The Guardian
      if (/i\.guim\.co\.uk/i.test(val)) {
        val = val.replace(/([?&])w=\d+/ig, '$1w=1200');
        val = val.replace(/([?&])q=\d+/ig, '$1q=85');
        return val;
      }

      // 5. New York Times
      if (/(?:nytimes\.com|nyt\.com)/i.test(val)) {
        val = val.replace(/-(?:thumbStandard|thumbLarge|mediumThreeByTwo210|mediumThreeByTwo440)\.(jpg|jpeg|png|webp)/i, '-superJumbo.$1');
        return val;
      }

      // 6. Medium & Substack
      if (/miro\.medium\.com/i.test(val)) {
        val = val.replace(/\/max\/\d+\//i, '/max/1400/');
        return val;
      }
      if (/substack/i.test(val) || /amazonaws\.com\/public\/images/i.test(val)) {
        val = val.replace(/\/w_\d+,c_limit/i, '/w_1200,c_limit');
        return val;
      }

      // 7. Unsplash / Imgix / Cloudinary / Fastly
      if (/(?:unsplash\.com|imgix\.net|cloudinary\.com|fastly\.net|cdn-images)/i.test(val)) {
        val = val.replace(/([?&])(?:w|width)=\d+/ig, '$1w=1200');
        val = val.replace(/([?&])(?:h|height)=\d+/ig, '$1h=800');
        val = val.replace(/([?&])(?:q|quality)=\d+/ig, '$1q=85');
        return val;
      }

      // 8. Generic small width/height dimensional queries
      val = val.replace(/([?&])(?:w|width)=([1-5]\d\d|\d{1,2})(?:&|$)/ig, '$1w=1200&');
      val = val.replace(/([?&])(?:h|height)=([1-4]\d\d|\d{1,2})(?:&|$)/ig, '$1h=800&');
      val = val.replace(/&$/, '');
    } catch (_) {}

    return val;
  }

  /**
   * Helper to extract YouTube poster from a YouTube article URL
   */
  function youtubePoster(articleUrl) {
    if (!articleUrl) return '';
    var match = String(articleUrl).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
    return match ? 'https://img.youtube.com/vi/' + match[1] + '/hqdefault.jpg' : '';
  }

  /**
   * Extracts the first usable high-res image from an HTML snippet or RSS text.
   */
  function firstHtmlImage(html) {
    if (!html) return '';
    var match = String(html).match(/<img[^>]+(?:src|data-src|data-orig-file|data-lazy-src)=["']([^"']+)["']/i);
    return match && isUsableImage(match[1]) ? upgradeUrl(match[1]) : '';
  }

  /**
   * Comprehensive image extractor from any RSS/Atom entry node, object, or text.
   */
  function extractImage(entryOrArticle, articleUrl, htmlContent) {
    if (!entryOrArticle) return '';

    // If string URL passed directly
    if (typeof entryOrArticle === 'string') {
      if (/^https?:\/\//i.test(entryOrArticle)) {
        return isUsableImage(entryOrArticle) ? upgradeUrl(entryOrArticle) : '';
      }
      return firstHtmlImage(entryOrArticle);
    }

    // If article object with image fields
    var directImg = entryOrArticle.image_url || entryOrArticle.image || entryOrArticle.thumbnail || entryOrArticle.ogImage || entryOrArticle.hero_image;
    if (directImg && isUsableImage(directImg)) {
      return upgradeUrl(directImg);
    }

    // If DOM / XML Node
    if (entryOrArticle.querySelector) {
      try {
        var mediaContent = entryOrArticle.querySelector('media\\:content, content');
        if (mediaContent && mediaContent.getAttribute('url') && isUsableImage(mediaContent.getAttribute('url'))) {
          return upgradeUrl(mediaContent.getAttribute('url'));
        }
        var mediaThumb = entryOrArticle.querySelector('media\\:thumbnail, thumbnail');
        if (mediaThumb && mediaThumb.getAttribute('url') && isUsableImage(mediaThumb.getAttribute('url'))) {
          return upgradeUrl(mediaThumb.getAttribute('url'));
        }
        var enclosure = entryOrArticle.querySelector('enclosure');
        if (enclosure && enclosure.getAttribute('url') && isUsableImage(enclosure.getAttribute('url'))) {
          var type = enclosure.getAttribute('type') || '';
          if (!type || type.indexOf('image') === 0) {
            return upgradeUrl(enclosure.getAttribute('url'));
          }
        }
        var itunesImg = entryOrArticle.querySelector('itunes\\:image');
        if (itunesImg && (itunesImg.getAttribute('href') || itunesImg.getAttribute('url'))) {
          var itunesUrl = itunesImg.getAttribute('href') || itunesImg.getAttribute('url');
          if (isUsableImage(itunesUrl)) return upgradeUrl(itunesUrl);
        }
      } catch (_) {}
    }

    // Check YouTube URL
    var targetUrl = articleUrl || entryOrArticle.url || entryOrArticle.link || '';
    var yt = youtubePoster(targetUrl);
    if (yt) return yt;

    // Check HTML content
    var contentHtml = htmlContent || entryOrArticle.content || entryOrArticle.summary || entryOrArticle.description || entryOrArticle.snippet || '';
    return firstHtmlImage(contentHtml);
  }

  /**
   * Renders standard responsive media HTML container with high-res image and error fallback.
   */
  function renderMedia(article, opts) {
    opts = opts || {};
    var className = opts.className || 'article-card-img';
    var fallbackClass = opts.fallbackClass || 'article-card-fallback';
    var rawImg = extractImage(article);
    var img = rawImg ? upgradeUrl(rawImg) : '';
    var sourceTitle = article && (article.sourceTitle || (article.source && article.source.title) || article.source_title || (typeof article.source === 'string' ? article.source : 'Feed'));
    sourceTitle = String(sourceTitle || 'Feed').trim();
    var initial = esc(sourceTitle.charAt(0).toUpperCase() || 'F');

    if (img) {
      return '<img class="' + esc(className) + '" src="' + esc(img) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="width:100% !important;height:100% !important;min-height:0 !important;max-height:none !important;object-fit:cover !important;position:absolute !important;inset:0 !important;" onerror="this.parentNode.innerHTML=\'<div class=\\\'' + esc(fallbackClass) + '\\\'>' + initial + '</div>\';" />';
    }
    return '<div class="' + esc(fallbackClass) + '">' + initial + '</div>';
  }

  /**
   * Smart face-centering and focal alignment for a single image element.
   */
  function applySmartCrop(img) {
    if (!img || img.tagName !== 'IMG') return;
    if (global.SmartCrop && typeof global.SmartCrop.apply === 'function') {
      global.SmartCrop.apply(img);
      return;
    }
    // Fallback safe crop calculation
    function calc() {
      if (!img.naturalWidth || !img.naturalHeight) return;
      var ratio = img.naturalWidth / img.naturalHeight;
      var defaultPos = ratio < 1.35 ? '50% 24%' : '50% 50%';
      img.style.setProperty('object-position', defaultPos, 'important');
    }
    if (img.complete && img.naturalWidth) calc();
    else img.addEventListener('load', calc, { once: true });
  }

  /**
   * Enhances and unblurs all image elements inside a container:
   * 1. Upgrades low-res CDN URLs to high-res.
   * 2. Adds lazy loading and decode attributes.
   * 3. Applies face-centering & focal smart-cropping.
   */
  function enhanceImages(container) {
    var root = container || document;
    if (!root || !root.querySelectorAll) return;

    var imgs = root.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.dataset.feedImagingEnhanced === 'true') continue;
      img.dataset.feedImagingEnhanced = 'true';

      var current = img.getAttribute('src');
      if (current && !current.startsWith('data:')) {
        var upgraded = upgradeUrl(current);
        if (upgraded && upgraded !== current) {
          img.setAttribute('src', upgraded);
        }
      }
      applySmartCrop(img);
    }
  }

  function smartCropAll(container) {
    if (global.SmartCrop && typeof global.SmartCrop.applyAll === 'function') {
      global.SmartCrop.applyAll(container);
    } else {
      enhanceImages(container);
    }
  }

  // Define API Object
  var FeedImaging = {
    normalizeUrl: normalizeUrl,
    isUsableImage: isUsableImage,
    upgradeUrl: upgradeUrl,
    upgradeImageUrl: upgradeUrl,
    youtubePoster: youtubePoster,
    firstHtmlImage: firstHtmlImage,
    extractImage: extractImage,
    extractArticleImage: extractImage,
    renderMedia: renderMedia,
    applySmartCrop: applySmartCrop,
    smartCropAll: smartCropAll,
    enhanceImages: enhanceImages
  };

  // Export to global scope & window helpers
  global.FeedImaging = FeedImaging;
  global.upgradeImageUrl = upgradeUrl;
  global.upgradeImage = upgradeUrl;
  global.enhanceImages = enhanceImages;
  global.extractArticleImage = extractImage;
  global.isUsableImage = isUsableImage;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FeedImaging;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
