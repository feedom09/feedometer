/**
 * scripts/feed-imaging.js — Browser display helper ONLY
 *
 * Thumbnail picking (junk URLs, CDN upscale, YouTube posters) now runs on the
 * Worker: workers/services/feed-imaging.js. This file only draws an <img>
 * when the API already sent image / image_url, or a letter fallback.
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

  function imageFromApi(article) {
    if (!article) return '';
    return article.image_url || article.image || '';
  }

  function renderMedia(article, opts) {
    opts = opts || {};
    var className = opts.className || 'card-img';
    var fallbackClass = opts.fallbackClass || 'card-fallback';
    var img = imageFromApi(article);
    var sourceTitle = article.sourceTitle || (article.source && article.source.title) || article.source_title || 'Feed';
    var initial = esc(sourceTitle.trim().charAt(0).toUpperCase() || 'N');

    if (img) {
      return '<img class="' + esc(className) + '" src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.innerHTML=\'<div class=' + esc(fallbackClass) + '>' + initial + '</div>\';" />';
    }
    return '<div class="' + esc(fallbackClass) + '">' + initial + '</div>';
  }

  function smartCropAll(container) {
    if (global.SmartCrop && typeof global.SmartCrop.applyAll === 'function') {
      global.SmartCrop.applyAll(container);
    }
  }

  global.FeedImaging = {
    renderMedia: renderMedia,
    smartCropAll: smartCropAll
  };
})(typeof window !== 'undefined' ? window : this);
