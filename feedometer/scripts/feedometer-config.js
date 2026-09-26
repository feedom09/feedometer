/**
 * FeedOmeter 2.1 — Central Platform Configuration
 * Single Source of Truth for API routing, edge endpoints, and OAuth credentials.
 */
(function (global) {
  'use strict';

  var PRODUCTION_API = 'https://feedom.feedom-8f1.workers.dev';
  var LOCAL_API = 'http://127.0.0.1:8787';
  var host = global.location && global.location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';

  // Route to local Data API on localhost, and to Cloudflare Worker on Pages / production
  global.FEEDOMETER_API_BASE = (isLocal ? LOCAL_API : PRODUCTION_API).replace(/\/$/, '');
  global.FEEDOMETER_LOCAL_API = LOCAL_API;
  global.FEEDOMETER_GOOGLE_CLIENT_ID = '519822758554-s2qeq1aoscvgeqbio297v1akdrasnj4s.apps.googleusercontent.com';

  global.FeedOmeterConfig = {
    API_BASE_URL: global.FEEDOMETER_API_BASE,
    WORKER_URL: PRODUCTION_API,
    apiBaseUrl: global.FEEDOMETER_API_BASE,
    GOOGLE_CLIENT_ID: global.FEEDOMETER_GOOGLE_CLIENT_ID
  };
  global.FEEDOMETER_CONFIG = global.FeedOmeterConfig;
})(typeof window !== 'undefined' ? window : this);
