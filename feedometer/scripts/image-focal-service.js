/**
 * On-demand image focal service for the Intelligence Briefing.
 *
 * This module is intentionally independent of feed retrieval and SQL Server.
 * It only changes object-position after a user chooses Better Images. Results
 * are cached in this browser by normalized image URL, and can later be backed
 * by a server-side vision provider without changing the page integration.
 */
(function (global) {
  'use strict';

  var CACHE_KEY = 'feedometer_image_focal_v1';
  var CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 21;
  var CACHE_LIMIT = 300;
  var detector = null;

  try {
    if (typeof global.FaceDetector === 'function') {
      detector = new global.FaceDetector({ fastMode: true, maxDetectedFaces: 8 });
    }
  } catch (_) { detector = null; }

  function normaliseUrl(url) {
    try {
      var parsed = new URL(String(url || ''), global.location.href);
      parsed.hash = '';
      return parsed.href;
    } catch (_) { return String(url || ''); }
  }

  function loadCache() {
    try { return JSON.parse(global.localStorage.getItem(CACHE_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function saveCache(cache) {
    try {
      var keys = Object.keys(cache).sort(function (a, b) { return cache[b].savedAt - cache[a].savedAt; });
      keys.slice(CACHE_LIMIT).forEach(function (key) { delete cache[key]; });
      global.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (_) { /* Browser storage is an optimisation, never a requirement. */ }
  }

  function cachedResult(url) {
    var item = loadCache()[normaliseUrl(url)];
    return item && item.savedAt && Date.now() - item.savedAt < CACHE_TTL_MS ? item : null;
  }

  function remember(url, result) {
    var cache = loadCache();
    cache[normaliseUrl(url)] = Object.assign({}, result, { savedAt: Date.now() });
    saveCache(cache);
  }

  function clamp(value) { return Math.max(10, Math.min(90, Math.round(value))); }

  function defaultFocal(img) {
    var ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
    return { x: 50, y: ratio < 1.35 ? 24 : 50, strategy: ratio < 1.35 ? 'portrait-safe' : 'center-safe', confidence: 0.2 };
  }

  function analyseFaces(img) {
    if (!detector || !img.naturalWidth || !img.naturalHeight) return Promise.resolve(null);
    return detector.detect(img).then(function (faces) {
      if (!faces || !faces.length) return null;
      var weightedX = 0, weightedY = 0, totalArea = 0;
      faces.forEach(function (face) {
        var box = face.boundingBox || {};
        var area = Math.max(1, (box.width || 0) * (box.height || 0));
        weightedX += (box.x + box.width / 2) * area;
        weightedY += (box.y + box.height / 2) * area;
        totalArea += area;
      });
      var x = clamp((weightedX / totalArea) / img.naturalWidth * 100);
      var y = clamp((weightedY / totalArea) / img.naturalHeight * 100);
      return {
        x: x,
        y: y,
        strategy: faces.length > 1 ? 'face-group' : 'face',
        confidence: faces.length > 1 ? 0.88 : 0.96
      };
    }).catch(function () { return null; });
  }

  function analyse(img) {
    var cached = cachedResult(img.currentSrc || img.src);
    if (cached) return Promise.resolve(Object.assign({}, cached, { fromCache: true }));
    return analyseFaces(img).then(function (faceResult) {
      var result = faceResult || defaultFocal(img);
      remember(img.currentSrc || img.src, result);
      return result;
    });
  }

  function apply(img, result) {
    if (!img || !result) return;
    img.style.setProperty('object-position', result.x + '% ' + result.y + '%', 'important');
    img.dataset.imageFocalStrategy = result.strategy;
    img.dataset.imageFocalConfidence = String(result.confidence);
  }

  function waitForImage(img) {
    if (img.complete && img.naturalWidth) return Promise.resolve(img);
    return new Promise(function (resolve) {
      var done = function () { resolve(img.naturalWidth ? img : null); };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', function () { resolve(null); }, { once: true });
    });
  }

  function process(container, options) {
    options = options || {};
    var images = Array.prototype.slice.call((container || document).querySelectorAll('.article-card-img'));
    var completed = 0;
    var improved = 0;
    var fallback = 0;

    function progress() {
      if (typeof options.onProgress === 'function') options.onProgress(completed, images.length, improved, fallback);
    }

    function processOne(img) {
      return waitForImage(img).then(function (ready) {
        if (!ready) return null;
        return analyse(ready).then(function (result) {
          apply(ready, result);
          if (result.strategy === 'face' || result.strategy === 'face-group') improved++;
          else fallback++;
          return result;
        });
      }).catch(function () { fallback++; return null; }).then(function (result) {
        completed++;
        progress();
        return result;
      });
    }

    // Small worker pool keeps the page responsive and avoids a sudden burst of
    // browser face-detection work on a large Trending grid.
    var cursor = 0;
    function worker() {
      if (cursor >= images.length) return Promise.resolve();
      var image = images[cursor++];
      return processOne(image).then(worker);
    }
    var workers = [];
    for (var i = 0; i < Math.min(3, images.length); i++) workers.push(worker());
    return Promise.all(workers).then(function () {
      return { total: images.length, improved: improved, fallback: fallback };
    });
  }

  global.ImageFocalService = {
    process: process,
    // Provider boundary retained for a later local/cloud vision adapter.
    provider: { name: detector ? 'native-face-detector' : 'safe-focal-fallback', version: 1 }
  };
})(typeof window !== 'undefined' ? window : this);
