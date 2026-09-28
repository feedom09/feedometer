/**
 * scripts/smart-crop.js — High-Performance Smart Focal Point & Face-Centering Utility
 * Automatically aligns CSS object-position to detected faces or subject focal centroids
 * with zero-lag geometric fast-paths and capped face-detection pools.
 */
(function (global) {
  'use strict';

  var _faceDetector = null;
  if (typeof global.FaceDetector === 'function') {
    try {
      _faceDetector = new global.FaceDetector({ fastMode: true, maxDetectedFaces: 2 });
    } catch (e) {
      _faceDetector = null;
    }
  }

  var _faceDetectCount = 0;
  var MAX_FACE_DETECT_PER_PAGE = 16;

  function detectFacePosition(img, callback) {
    if (!_faceDetector || !img || !img.naturalWidth || !img.naturalHeight || _faceDetectCount >= MAX_FACE_DETECT_PER_PAGE) {
      return callback(null);
    }
    _faceDetectCount++;
    _faceDetector.detect(img)
      .then(function (faces) {
        if (!faces || !faces.length) return callback(null);
        var best = faces.reduce(function (max, f) {
          var area = (f.boundingBox.width || 0) * (f.boundingBox.height || 0);
          var maxArea = (max.boundingBox.width || 0) * (max.boundingBox.height || 0);
          return area > maxArea ? f : max;
        }, faces[0]);

        var box = best.boundingBox;
        if (!box) return callback(null);
        var cx = Math.max(10, Math.min(90, Math.round(((box.x + box.width / 2) / img.naturalWidth) * 100)));
        var cy = Math.max(10, Math.min(90, Math.round(((box.y + box.height / 2) / img.naturalHeight) * 100)));
        callback({ x: cx, y: cy });
      })
      .catch(function () {
        callback(null);
      });
  }

  function calculateSmartPosition(img) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    var nw = img.naturalWidth;
    var nh = img.naturalHeight;
    var ratio = nw / nh;

    // Instant geometric focal anchor:
    // In editorial & news photography, subjects & faces sit in the top 20-25% of the frame.
    var defaultPos = ratio < 1.35 ? '50% 24%' : '50% 50%';
    img.style.setProperty('object-position', defaultPos, 'important');

    // Attempt face detection only for top/hero images to keep rendering instantaneous
    if (_faceDetectCount < MAX_FACE_DETECT_PER_PAGE && _faceDetector) {
      detectFacePosition(img, function (pos) {
        if (pos) {
          img.style.setProperty('object-position', pos.x + '% ' + pos.y + '%', 'important');
        }
      });
    }
  }

  function applySmartCrop(img) {
    if (!img || img.tagName !== 'IMG') return;
    if (img.dataset.smartCropped === 'true') return;
    img.dataset.smartCropped = 'true';

    if (img.complete && img.naturalWidth) {
      calculateSmartPosition(img);
    } else {
      img.addEventListener('load', function () {
        calculateSmartPosition(img);
      }, { once: true });
    }
  }

  function applySmartCropToAll(container) {
    var root = container || document;
    var imgs = root.querySelectorAll ? root.querySelectorAll('img') : [];
    for (var i = 0; i < imgs.length; i++) {
      applySmartCrop(imgs[i]);
    }
  }

  global.SmartCrop = {
    apply: applySmartCrop,
    applyAll: applySmartCropToAll
  };

  global.applySmartCrop = applySmartCrop;
})(typeof window !== 'undefined' ? window : this);
