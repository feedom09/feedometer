/**
 * Feedometer API base URL (Cloudflare Worker).
 * Always prefer the deployed Worker so local file/Pages preview can fetch RSS.
 * For an explicit local Worker test, open a localhost page with `?api=local`.
 */
(function (global) {
  'use strict';

  var PRODUCTION_API = 'https://feedom.feedom-8f1.workers.dev';
  var host = global.location && global.location.hostname;
  var wantsLocalApi = Boolean(
    (host === 'localhost' || host === '127.0.0.1') &&
    global.location && new URLSearchParams(global.location.search).get('api') === 'local'
  );
  var LOCAL_API = 'http://127.0.0.1:8787';

  // Do not silently redirect normal localhost browsing to an unavailable local
  // Worker. The opt-in query parameter makes a local test deterministic.
  global.FEEDOMETER_API_BASE = (wantsLocalApi ? LOCAL_API : PRODUCTION_API).replace(/\/$/, '');
  global.FEEDOMETER_LOCAL_API = (host === 'localhost' || host === '127.0.0.1')
    ? LOCAL_API
    : '';
  global.FEEDOMETER_GOOGLE_CLIENT_ID = '519822758554-19n3plblqq2nqago9r619kg5bi265674.apps.googleusercontent.com';
  global.FeedOmeterConfig = {
    API_BASE_URL: global.FEEDOMETER_API_BASE,
    WORKER_URL: global.FEEDOMETER_API_BASE,
    apiBaseUrl: global.FEEDOMETER_API_BASE,
    GOOGLE_CLIENT_ID: global.FEEDOMETER_GOOGLE_CLIENT_ID
  };
  global.FEEDOMETER_CONFIG = global.FeedOmeterConfig;
})(typeof window !== 'undefined' ? window : this);
