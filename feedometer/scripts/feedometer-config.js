/**
 * FeedOmeter 2.1 — Central Platform Configuration
 * Single Source of Truth for the SQL Server API and OAuth credentials.
 */
(function (global) {
  'use strict';

  var LOCAL_API = 'http://127.0.0.1:8787';
  var host = global.location && global.location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
  // SQL Server is the application API. Cloudflare remains the edge service for
  // KV caching and related worker capabilities, never the data store.
  var configuredApi = String(global.FEEDOMETER_SQL_API_ORIGIN || 'https://api.peopledotsports.com').replace(/\/$/, '');
  var configuredEdge = String(global.FEEDOMETER_EDGE_API_ORIGIN || 'https://feedom.feedom-8f1.workers.dev').replace(/\/$/, '');
  var apiBase = isLocal ? LOCAL_API : configuredApi;

  global.FEEDOMETER_API_BASE = apiBase;
  global.FEEDOMETER_EDGE_API_BASE = configuredEdge;
  global.FEEDOMETER_LOCAL_API = LOCAL_API;
  global.FEEDOMETER_GOOGLE_CLIENT_ID = '519822758554-s2qeq1aoscvgeqbio297v1akdrasnj4s.apps.googleusercontent.com';

  global.FeedOmeterConfig = {
    API_BASE_URL: global.FEEDOMETER_API_BASE,
    EDGE_API_BASE_URL: global.FEEDOMETER_EDGE_API_BASE,
    apiBaseUrl: global.FEEDOMETER_API_BASE,
    GOOGLE_CLIENT_ID: global.FEEDOMETER_GOOGLE_CLIENT_ID
  };
  global.FEEDOMETER_CONFIG = global.FeedOmeterConfig;
})(typeof window !== 'undefined' ? window : this);
