/**
 * FeedOmeter Telemetry & Engagement Tracker (Bolt-On Module)
 * 
 * Standalone, zero-coupling engagement & metrics collector.
 * Can be safely disabled or deleted at any time without impacting core reader functionality.
 * 
 * Features:
 * - Unique session ID generation (privacy-preserving, no cookies)
 * - Feeds viewed per session tracking
 * - Active reading dwell time engine (smart pause on hidden tab or 60s idle)
 * - Curated publisher & story link engagement metrics
 * - Browser console inspector: `FeedOmeterTelemetry.getStats()`
 * - Non-blocking beacon dispatch to Worker edge (/api/telemetry)
 * 
 * Master Kill-Switch:
 *   window.FEEDOMETER_TRACKING = false;
 */

(function () {
  'use strict';

  // Check master kill-switch
  if (window.FEEDOMETER_TRACKING === false) {
    return;
  }

  // --- Session & State Management ---
  const SESSION_STORAGE_KEY = 'feedometer_telemetry_sess';
  const IDLE_TIMEOUT_MS = 60000; // 60 seconds inactivity pauses active reading timer

  function generateSessionId() {
    const rand = Math.random().toString(36).substring(2, 10);
    const ts = Date.now().toString(36);
    return `sess_${ts}_${rand}`;
  }

  function loadSessionData() {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {}

    return {
      sessionId: generateSessionId(),
      startedAt: new Date().toISOString(),
      feedsLoadedCount: 0,
      feedsHistory: [],
      publishers: [],
      storiesClicked: 0,
      storiesList: [],
      activeReadingSeconds: 0,
      errorsCount: 0,
      themeChangesCount: 0
    };
  }

  const session = loadSessionData();

  function saveSessionData() {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch (e) {}
  }

  // --- Active Reading Time Engine ---
  let isTabActive = document.visibilityState === 'visible';
  let lastUserActivity = Date.now();
  let timerInterval = null;

  function onUserActivity() {
    lastUserActivity = Date.now();
  }

  function startActiveReadingTimer() {
    if (timerInterval) return;
    timerInterval = setInterval(() => {
      const now = Date.now();
      const isNotIdle = (now - lastUserActivity) < IDLE_TIMEOUT_MS;
      if (isTabActive && isNotIdle) {
        session.activeReadingSeconds += 1;
        // Save periodically every 10s to avoid high storage writes
        if (session.activeReadingSeconds % 10 === 0) {
          saveSessionData();
        }
      }
    }, 1000);
  }

  function stopActiveReadingTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // Visibility & Focus handlers
  document.addEventListener('visibilitychange', () => {
    isTabActive = document.visibilityState === 'visible';
    if (isTabActive) {
      onUserActivity();
    } else {
      saveSessionData();
      dispatchBeacon('visibility_hidden');
    }
  });

  window.addEventListener('focus', () => {
    isTabActive = true;
    onUserActivity();
  });

  window.addEventListener('blur', () => {
    isTabActive = false;
    saveSessionData();
  });

  // User activity listeners (mouse move, keydown, touch, scroll)
  ['mousemove', 'keydown', 'touchstart', 'scroll'].forEach((evt) => {
    window.addEventListener(evt, onUserActivity, { passive: true });
  });

  startActiveReadingTimer();

  // --- Event Tracking Hooks ---

  // 1. Feed Loaded Event
  function onFeedLoaded(e) {
    const detail = (e && e.detail) || {};
    const feedUrl = detail.feedUrl || detail.url || '';
    const publisher = detail.publisher || detail.title || 'Unknown Feed';

    session.feedsLoadedCount += 1;
    if (feedUrl && !session.feedsHistory.includes(feedUrl)) {
      session.feedsHistory.push(feedUrl);
    }
    if (publisher && !session.publishers.includes(publisher)) {
      session.publishers.push(publisher);
    }

    saveSessionData();
    dispatchBeacon('feed_loaded', { feedUrl, publisher, totalFeeds: session.feedsLoadedCount });
  }

  // 2. Feed Error Event
  function onFeedError(e) {
    session.errorsCount += 1;
    saveSessionData();
    const detail = (e && e.detail) || {};
    dispatchBeacon('feed_error', { url: detail.url, code: detail.code });
  }

  // 3. Story Link / Read Event
  function onStoryClicked(e) {
    const detail = (e && e.detail) || {};
    session.storiesClicked += 1;
    if (detail.title && !session.storiesList.includes(detail.title)) {
      session.storiesList.push(detail.title);
    }
    saveSessionData();
    dispatchBeacon('story_click', { title: detail.title, link: detail.link });
  }

  // Listen to custom DOM events emitted by the viewer
  window.addEventListener('feedometer:feed-loaded', onFeedLoaded);
  window.addEventListener('feedometer:feed-error', onFeedError);
  window.addEventListener('feedometer:story-clicked', onStoryClicked);

  // Passive click delegator for outbound links & theme buttons
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;

    // Story external links or card title links
    const linkEl = target.closest('a[target="_blank"]') || target.closest('.card-title a') || target.closest('.modal-link');
    if (linkEl && linkEl.href) {
      const card = linkEl.closest('.card');
      const titleEl = card ? card.querySelector('.card-title') : null;
      const title = titleEl ? titleEl.textContent.trim() : linkEl.textContent.trim();
      onStoryClicked({ detail: { title, link: linkEl.href } });
    }

    // Background theme picker buttons
    if (target.closest('.color-swatch-btn') || target.closest('.color-preset-item')) {
      session.themeChangesCount += 1;
      saveSessionData();
    }
  }, { passive: true });

  // --- Worker Edge Beacon Dispatcher ---
  function getWorkerBaseUrl() {
    if (window.FEEDOMETER_API_BASE) return window.FEEDOMETER_API_BASE.replace(/\/$/, '');
    if (window.FeedOmeterConfig && window.FeedOmeterConfig.API_BASE_URL) {
      return window.FeedOmeterConfig.API_BASE_URL.replace(/\/$/, '');
    }
    if (window.FEEDOMETER_CONFIG && window.FEEDOMETER_CONFIG.WORKER_API_BASE) {
      return window.FEEDOMETER_CONFIG.WORKER_API_BASE.replace(/\/$/, '');
    }
    return 'https://feedometer-api.feedometer.workers.dev';
  }

  function dispatchBeacon(eventType, extraData = {}) {
    const base = getWorkerBaseUrl();
    if (!base) return;

    const payload = {
      sessionId: session.sessionId,
      eventType,
      feedsLoaded: session.feedsLoadedCount,
      activeReadingSeconds: session.activeReadingSeconds,
      publishers: session.publishers.slice(0, 10),
      storiesClicked: session.storiesClicked,
      referrer: document.referrer || '',
      screen: `${window.innerWidth}x${window.innerHeight}`,
      language: navigator.language || '',
      timestamp: new Date().toISOString(),
      ...extraData
    };

    try {
      const url = `${base}/api/telemetry`;
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });

      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, {
          method: 'POST',
          body: blob,
          keepalive: true,
          mode: 'cors'
        }).catch(() => {});
      }
    } catch (err) {
      // Telemetry should never throw or break user workflow
    }
  }

  // Page lifecycle teardown beacon
  window.addEventListener('pagehide', () => {
    saveSessionData();
    dispatchBeacon('session_summary');
  });

  // --- Public Global Inspection API ---
  window.FeedOmeterTelemetry = {
    /**
     * Inspect live telemetry stats in the browser console
     * Usage: FeedOmeterTelemetry.getStats()
     */
    getStats: function () {
      return {
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        feedsLoadedCount: session.feedsLoadedCount,
        activeReadingTime: `${session.activeReadingSeconds}s (${(session.activeReadingSeconds / 60).toFixed(1)} mins)`,
        activeReadingSeconds: session.activeReadingSeconds,
        publishersOpened: session.publishers,
        storiesClickedCount: session.storiesClicked,
        themeChanges: session.themeChangesCount,
        errorsCount: session.errorsCount,
        status: 'Active (Bolt-On Mode)'
      };
    },

    /**
     * Manually record a custom event
     */
    track: function (eventName, data) {
      dispatchBeacon(eventName, data);
    },

    /**
     * Reset current session counters
     */
    reset: function () {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      const fresh = loadSessionData();
      Object.assign(session, fresh);
      console.info('[FeedOmeter Telemetry] Session metrics reset.');
    }
  };

  console.info('[FeedOmeter] Bolt-On Telemetry Tracker initialized. Type `FeedOmeterTelemetry.getStats()` in console to view live session metrics.');

})();
