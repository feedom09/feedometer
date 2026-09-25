/**
 * workers/feedometer-worker.js — Feedometer API & Edge Worker
 * Unified Modular Cloudflare Worker for FeedOmeter Personal Feed Intelligence Platform
 * Phase 2 — 7-Domain Enterprise Identity Architecture & Normalized Content Platform
 *
 * Folder map (this file only routes; it does not pick thumbnails itself):
 *   lib/       shared helpers (crypto, JSON responses)
 *   modules/   HTTP handlers (auth, stream, folders, articles)
 *   services/  RSS parse, cache, fusion, thumbnail picking, channel catalog
 */

import { handleOptions, jsonResponse, errorResponse } from './lib/response.js';
import previewInspectorScript from './assets/preview-inspector.js.txt';
import {
  handleRegister,
  handleLogin,
  handleLogout,
  handleForgotPassword,
  handleVerifyEmail,
  handleVerifyResetToken,
  handleResetPassword,
  handleMe,
  handleGoogleAuth,
  handleProfileUpdate,
  handlePasswordChange,
  handleListSessions,
  handleRevokeSession,
  handleRevokeOtherSessions,
  handleGetPreferences,
  handleUpdatePreferences,
  handleDeleteAccount
} from './modules/auth.js';
import { handleStream } from './modules/streams.js';
import { handleListSubscriptions, handleCreateSubscription, handleDeleteSubscription } from './modules/subscriptions.js';
import { handleListFolders, handleCreateFolder, handleDeleteFolder, handleAssignFeed, handleUnassignFeed } from './modules/folders.js';
import {
  handleStarArticle,
  handleUnstarArticle,
  handleSaveArticle,
  handleUnsaveArticle,
  handleReadArticle,
  handleListStarred,
  handleListSaved
} from './modules/articles.js';
import {
  handleSearch,
  handleSuggestions,
  handleSavedSearches,
  handleKeywordAlerts,
  handleRecordClick
} from './modules/search.js';
import { discoverFeedsAndArticles, findFeedsUnified } from './services/feed-discovery-engine.js';
import { buildRssFromUrl } from './services/web-to-rss.js';
import { discoverFeedFromUrl } from './services/feed-discovery-pipeline.js';
import { generateKeywordFeed } from './services/keyword-feed-engine.js';
import { fetchFeedWithCache } from './services/cache-manager.js';
import { dueSourcesQuery } from './services/refresh-scheduler.js';
import { handleGetFilters, handleSaveFilters } from './services/user-filters.js';
import { handleTags, handleTagAssignments, handleCollections, handleFeedHealth } from './modules/curation.js';
import {
  handleListWebhooks,
  handleCreateWebhook,
  handleUpdateWebhook,
  handleDeleteWebhook,
  handleTestWebhook,
  handleGetWebhookLogs
} from './modules/webhooks.js';
import {
  handleListAlerts,
  handleCreateAlert,
  handleDeleteAlert,
  handleTestAlert,
  handleListNotifications,
  handleSubscribePush
} from './modules/alerts.js';
import {
  handleListDigests,
  handleCreateDigest,
  handleDeleteDigest,
  handlePreviewDigest
} from './modules/digests.js';
import { handleExportOpml, handleImportOpml } from './modules/opml.js';
import {
  handleListCatalog,
  handleListUserIntegrations,
  handleCreateUserIntegration,
  handleTestDirectIntegration,
  handleTestUserIntegration,
  handleDeleteUserIntegration
} from './modules/integrations.js';
import {
  handleBuilderProxy,
  handleBuilderFeed,
  handleBuilderEvaluate,
  handleBuilderSaveConfig,
  handleBuilderGetHealth
} from './modules/builder-api.js';
import {
  handleGetArticles,
  handleSearchArticles,
  handleGetSources,
  handleGetMeSubscriptions,
  handlePostMeSubscriptions,
  handleGetMeFolders,
  handleGetMeOpml
} from './modules/rest-api-v1.js';
import {
  handleListApiKeys,
  handleCreateApiKey,
  handleRevokeApiKey
} from './modules/developer-keys.js';
import { processFeedEventQueue } from './services/event-matcher.js';
import { dispatchWebhookBatch, processScheduledWebhooks } from './services/webhook-dispatcher.js';
import { dispatchPendingAlerts, dispatchLegacyKeywordAlertEmails } from './services/alert-dispatcher.js';
import { processDueDigests } from './services/digest-generator.js';
import { handleAiSummary } from './modules/ai.js';

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // ------------------------------------------------------------------------
      // 1. Enterprise Identity & User Management Routes (7 Domains)
      // ------------------------------------------------------------------------
      if (pathname === '/api/auth/register' && request.method === 'POST') {
        return await handleRegister(request, env);
      }
      if (pathname === '/api/ai/summary' && request.method === 'POST') return await handleAiSummary(request, env);
      if (pathname === '/api/auth/login' && request.method === 'POST') {
        return await handleLogin(request, env);
      }
      if (pathname === '/api/auth/forgot-password' && request.method === 'POST') {
        return await handleForgotPassword(request, env);
      }
      if (pathname === '/api/auth/verify-email' && request.method === 'GET') {
        return await handleVerifyEmail(request, env);
      }
      if (pathname === '/api/auth/reset-password' && request.method === 'GET') {
        return await handleVerifyResetToken(request, env);
      }
      if (pathname === '/api/auth/reset-password' && request.method === 'POST') {
        return await handleResetPassword(request, env);
      }
      if (pathname === '/api/auth/google' && request.method === 'POST') {
        return await handleGoogleAuth(request, env);
      }
      if (pathname === '/api/auth/logout' && request.method === 'POST') {
        return await handleLogout(request, env);
      }
      if (pathname === '/api/auth/me' && request.method === 'GET') {
        return await handleMe(request, env);
      }
      if (pathname === '/api/auth/profile' && (request.method === 'POST' || request.method === 'PUT')) {
        return await handleProfileUpdate(request, env);
      }
      if ((pathname === '/api/auth/password' || pathname === '/api/auth/change-password') && request.method === 'POST') {
        return await handlePasswordChange(request, env);
      }
      if (pathname === '/api/auth/sessions' && request.method === 'GET') {
        return await handleListSessions(request, env);
      }
      if ((pathname === '/api/auth/sessions/other' || pathname === '/api/auth/sessions/revoke-others') && (request.method === 'DELETE' || request.method === 'POST')) {
        return await handleRevokeOtherSessions(request, env);
      }
      if (pathname.startsWith('/api/auth/sessions/') && request.method === 'DELETE') {
        const sessId = pathname.replace('/api/auth/sessions/', '');
        return await handleRevokeSession(request, sessId, env);
      }
      if (pathname === '/api/auth/sessions/revoke' && request.method === 'POST') {
        try {
          const body = await request.json();
          return await handleRevokeSession(request, body.session_id, env);
        } catch (e) {
          return errorResponse('Invalid JSON body', 400);
        }
      }
      if (pathname === '/api/auth/preferences' && request.method === 'GET') {
        return await handleGetPreferences(request, env);
      }
      if (pathname === '/api/auth/preferences' && (request.method === 'POST' || request.method === 'PUT')) {
        return await handleUpdatePreferences(request, env);
      }
      if ((pathname === '/api/auth/account' || pathname === '/api/auth/delete') && request.method === 'DELETE') {
        return await handleDeleteAccount(request, env);
      }
      if (pathname === '/api/auth/delete' && request.method === 'POST') {
        return await handleDeleteAccount(request, env);
      }

      // ------------------------------------------------------------------------
      // 2. Subscriptions Routes (Phase 2 [P2-02])
      // ------------------------------------------------------------------------
      if (pathname === '/api/subscriptions' && request.method === 'GET') {
        return await handleListSubscriptions(request, env);
      }
      if (pathname === '/api/subscriptions' && request.method === 'POST') {
        return await handleCreateSubscription(request, env);
      }
      if (pathname.startsWith('/api/subscriptions/') && request.method === 'DELETE') {
        const id = pathname.replace('/api/subscriptions/', '');
        return await handleDeleteSubscription(request, id, env);
      }

      // ------------------------------------------------------------------------
      // 3. Hierarchical Folders Routes (Phase 2 [P2-02])
      // ------------------------------------------------------------------------
      if (pathname === '/api/folders' && request.method === 'GET') {
        return await handleListFolders(request, env);
      }
      if (pathname === '/api/folders' && request.method === 'POST') {
        return await handleCreateFolder(request, env);
      }
      if (pathname.startsWith('/api/folders/') && pathname.endsWith('/feeds') && request.method === 'POST') {
        const folderId = pathname.replace('/api/folders/', '').replace('/feeds', '');
        return await handleAssignFeed(request, folderId, env);
      }
      if (pathname.startsWith('/api/folders/') && request.method === 'DELETE') {
        const parts = pathname.replace('/api/folders/', '').split('/');
        if (parts.length === 3 && parts[1] === 'feeds') {
          return await handleUnassignFeed(request, parts[0], parts[2], env);
        }
        return await handleDeleteFolder(request, parts[0], env);
      }

      // ------------------------------------------------------------------------
      // 3.1 OPML 2.0 Import & Export Routes
      // ------------------------------------------------------------------------
      if (pathname === '/api/opml/export' && request.method === 'GET') {
        return await handleExportOpml(request, env);
      }
      if (pathname === '/api/opml/import' && request.method === 'POST') {
        return await handleImportOpml(request, env);
      }

      // ------------------------------------------------------------------------
      // 4. Normalized Articles Interaction & State Routes
      // ------------------------------------------------------------------------
      if (pathname === '/api/articles/star' && request.method === 'POST') {
        return await handleStarArticle(request, env);
      }
      if (pathname === '/api/articles/unstar' && request.method === 'POST') {
        return await handleUnstarArticle(request, env);
      }
      if (pathname === '/api/articles/save' && request.method === 'POST') {
        return await handleSaveArticle(request, env);
      }
      if (pathname === '/api/articles/unsave' && request.method === 'POST') {
        return await handleUnsaveArticle(request, env);
      }
      if (pathname === '/api/articles/read' && request.method === 'POST') {
        return await handleReadArticle(request, env);
      }
      if (pathname === '/api/articles/starred' && request.method === 'GET') {
        return await handleListStarred(request, env);
      }
      if (pathname === '/api/articles/saved' && request.method === 'GET') {
        return await handleListSaved(request, env);
      }

// ------------------------------------------------------------------------
      // 5. Search & News Discovery Intelligence Routes
      // ------------------------------------------------------------------------
      if ((pathname === '/api/feeds/find' || pathname === '/api/search/feeds') && request.method === 'GET') {
        const q = url.searchParams.get('q') || '';
        const category = url.searchParams.get('cat') || url.searchParams.get('category') || 'all';
        const language = url.searchParams.get('lang') || url.searchParams.get('language') || 'all';
        const country = url.searchParams.get('country') || 'all';
        const sort = url.searchParams.get('sort') || 'relevance';
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));

        // ── KV Cache: serve search results from edge, 10-minute TTL ──
        const kvKey = `feedsearch:${q.toLowerCase().trim()}:${category}:${language}:${country}:${sort}:${limit}`;
        if (env.FEEDS_KV) {
          try {
            const kvHit = await env.FEEDS_KV.get(kvKey, 'json');
            if (kvHit) return jsonResponse(Object.assign({}, kvHit, { cached: true }));
          } catch (_) {}
        }

        const result = await findFeedsUnified({ query: q, category, language, country, sort, limit, env });

        // Store result in KV for 10 minutes
        if (env.FEEDS_KV && result && result.feeds && result.feeds.length > 0) {
          try {
            await env.FEEDS_KV.put(kvKey, JSON.stringify(result), { expirationTtl: 600 });
          } catch (_) {}
        }

        return jsonResponse(result);
      }

      if (pathname === '/api/search' && request.method === 'GET') {
        return await handleSearch(request, url, env);
      }
      if (pathname === '/api/search/discover' && request.method === 'GET') {
        const q = url.searchParams.get('q') || '';
        const result = await discoverFeedsAndArticles(q);
        return jsonResponse(result);
      }
      if (pathname === '/api/search/suggest' && request.method === 'GET') {
        return await handleSuggestions(request, url, env);
      }
      if (pathname.startsWith('/api/search/saved')) {
        return await handleSavedSearches(request, url, env);
      }
      if (pathname.startsWith('/api/search/alerts')) {
        return await handleKeywordAlerts(request, url, env);
      }
      if (pathname === '/api/curation/tags') return await handleTags(request, env, url);
      if (pathname === '/api/curation/tag-assignments') return await handleTagAssignments(request, env);
      if (pathname === '/api/curation/collections') return await handleCollections(request, url, env);
      if (pathname === '/api/feed-health' && request.method === 'GET') return await handleFeedHealth(request, env);
      if (pathname === '/api/search/click' && request.method === 'POST') {
        return await handleRecordClick(request, env);
      }

      // ------------------------------------------------------------------------
      // 6. Stream Engine Route (Multi-Feed Fusion)
      // ------------------------------------------------------------------------
      if (pathname === '/api/stream' && request.method === 'GET') {
        return await handleStream(request, url, env, ctx);
      }

      if (pathname === '/api/filters' && request.method === 'GET') {
        return await handleGetFilters(request, env);
      }
      if (pathname === '/api/filters' && (request.method === 'POST' || request.method === 'PUT')) {
        return await handleSaveFilters(request, env);
      }
      if (pathname === '/api/telemetry' && request.method === 'POST') {
        return jsonResponse({ status: 'accepted' });
      }

      // ------------------------------------------------------------------------
      // Visual RSS Builder & Proxy Routes (Phase 8)
      // ------------------------------------------------------------------------
      if (pathname === '/api/builder/proxy' && request.method === 'GET') {
        return await handleBuilderProxy(request, env);
      }
      if (pathname === '/api/builder/preview-inspector.js' && request.method === 'GET') {
        return new Response(previewInspectorScript, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
          // This small control script governs click behavior in an embedded
          // preview. Never let a browser retain an older behavior after a
          // Worker deployment; the Worker itself remains the single source.
          'Cache-Control': 'no-store'
          }
        });
      }
      if (pathname === '/api/builder/evaluate' && request.method === 'POST') {
        return await handleBuilderEvaluate(request, env);
      }
      if (pathname === '/api/builder/save-config' && request.method === 'POST') {
        return await handleBuilderSaveConfig(request, env);
      }
      if (pathname === '/api/builder/feed' && request.method === 'GET') {
        return await handleBuilderFeed(request, env);
      }
      if (pathname === '/api/builder/health' && request.method === 'GET') {
        return await handleBuilderGetHealth(request, env);
      }

      // ------------------------------------------------------------------------
      // 7. Phase 5 Automation Engine Routes (Alerts, Webhooks, Digests & Push)
      // ------------------------------------------------------------------------
      // Webhooks
      if (pathname === '/api/webhooks' && request.method === 'GET') {
        return await handleListWebhooks(request, env);
      }
      if (pathname === '/api/webhooks' && request.method === 'POST') {
        return await handleCreateWebhook(request, env);
      }
      if (pathname === '/api/webhooks/test' && request.method === 'POST') {
        return await handleTestWebhook(request, 'direct', env);
      }
      if (pathname.startsWith('/api/webhooks/') && pathname.endsWith('/test') && request.method === 'POST') {
        const id = pathname.replace('/api/webhooks/', '').replace('/test', '');
        return await handleTestWebhook(request, id, env);
      }
      if (pathname.startsWith('/api/webhooks/') && pathname.endsWith('/logs') && request.method === 'GET') {
        const id = pathname.replace('/api/webhooks/', '').replace('/logs', '');
        return await handleGetWebhookLogs(request, id, env);
      }
      if (pathname.startsWith('/api/webhooks/') && (request.method === 'PUT' || request.method === 'POST')) {
        const id = pathname.replace('/api/webhooks/', '');
        return await handleUpdateWebhook(request, id, env);
      }
      if (pathname.startsWith('/api/webhooks/') && request.method === 'DELETE') {
        const id = pathname.replace('/api/webhooks/', '');
        return await handleDeleteWebhook(request, id, env);
      }

      // Alerts & Notifications
      if (pathname === '/api/alerts' && request.method === 'GET') {
        return await handleListAlerts(request, env);
      }
      if (pathname === '/api/alerts' && request.method === 'POST') {
        return await handleCreateAlert(request, env);
      }
      if (pathname === '/api/alerts/test' && request.method === 'POST') {
        return await handleTestAlert(request, env);
      }
      if (pathname === '/api/alerts/notifications' && request.method === 'GET') {
        return await handleListNotifications(request, env);
      }
      if (pathname.startsWith('/api/alerts/') && request.method === 'DELETE') {
        const id = pathname.replace('/api/alerts/', '');
        return await handleDeleteAlert(request, id, env);
      }

      // Web Push
      if (pathname === '/api/push/subscribe' && request.method === 'POST') {
        return await handleSubscribePush(request, env);
      }

      // Digests
      if (pathname === '/api/digests' && request.method === 'GET') {
        return await handleListDigests(request, env);
      }
      if (pathname === '/api/digests' && request.method === 'POST') {
        return await handleCreateDigest(request, env);
      }
      if (pathname === '/api/digests/preview' && request.method === 'POST') {
        return await handlePreviewDigest(request, env);
      }
      if (pathname.startsWith('/api/digests/') && request.method === 'DELETE') {
        const id = pathname.replace('/api/digests/', '');
        return await handleDeleteDigest(request, id, env);
      }

      // OPML 2.0 Import & Export
      if (pathname === '/api/opml/export' && request.method === 'GET') {
        return await handleExportOpml(request, env);
      }
      if (pathname === '/api/opml/import' && request.method === 'POST') {
        return await handleImportOpml(request, env);
      }

      // ------------------------------------------------------------------------
      // 8. Integrations Marketplace Routes (Slack, Microsoft Teams, Webhooks, API)
      // ------------------------------------------------------------------------
      if (pathname === '/api/integrations/catalog' && request.method === 'GET') {
        return await handleListCatalog(request, env);
      }
      if (pathname === '/api/integrations' && request.method === 'GET') {
        return await handleListUserIntegrations(request, env);
      }
      if (pathname === '/api/integrations' && request.method === 'POST') {
        return await handleCreateUserIntegration(request, env);
      }
      if (pathname === '/api/integrations/test-direct' && request.method === 'POST') {
        return await handleTestDirectIntegration(request, env);
      }
      if (pathname.startsWith('/api/integrations/') && pathname.endsWith('/test') && request.method === 'POST') {
        const id = pathname.replace('/api/integrations/', '').replace('/test', '');
        return await handleTestUserIntegration(request, env, id);
      }
      if (pathname.startsWith('/api/integrations/') && request.method === 'DELETE') {
        const id = pathname.replace('/api/integrations/', '');
        return await handleDeleteUserIntegration(request, env, id);
      }

      // ------------------------------------------------------------------------
      // 9. Developer REST API v1 Routes (Public & User-Scoped)
      // ------------------------------------------------------------------------
      if (pathname === '/api/v1/articles' && request.method === 'GET') {
        return await handleGetArticles(request, env);
      }
      if (pathname === '/api/v1/search' && request.method === 'GET') {
        return await handleSearchArticles(request, env);
      }
      if (pathname === '/api/v1/sources' && request.method === 'GET') {
        return await handleGetSources(request, env);
      }
      if (pathname === '/api/v1/me/subscriptions' && request.method === 'GET') {
        return await handleGetMeSubscriptions(request, env);
      }
      if (pathname === '/api/v1/me/subscriptions' && request.method === 'POST') {
        return await handlePostMeSubscriptions(request, env);
      }
      if (pathname === '/api/v1/me/folders' && request.method === 'GET') {
        return await handleGetMeFolders(request, env);
      }
      if (pathname === '/api/v1/me/opml' && request.method === 'GET') {
        return await handleGetMeOpml(request, env);
      }

      // Developer API Key Management (Dashboard Session Auth)
      if (pathname === '/api/developer/keys' && request.method === 'GET') {
        return await handleListApiKeys(request, env);
      }
      if (pathname === '/api/developer/keys' && request.method === 'POST') {
        return await handleCreateApiKey(request, env);
      }
      if (pathname.startsWith('/api/developer/keys/') && request.method === 'DELETE') {
        const id = pathname.replace('/api/developer/keys/', '');
        return await handleRevokeApiKey(request, env, id);
      }

      // ------------------------------------------------------------------------
      // 6. Public Feed View & Dynamic RSS Route (Phase 2 Enhanced)
      // ------------------------------------------------------------------------
      if (pathname === '/api/view' && request.method === 'GET') {
        const topicQuery = url.searchParams.get('q') || url.searchParams.get('topic');
        const targetUrl = url.searchParams.get('url') || url.searchParams.get('feed');
        const format = url.searchParams.get('format') || '';
        const wantsXml = format === 'xml' || format === 'rss' || (request.headers.get('accept') || '').includes('xml');

        if (topicQuery) {
          const kwResult = await generateKeywordFeed(topicQuery, env);
          if (wantsXml || !format) {
            return new Response(kwResult.xml, {
              headers: {
                'Content-Type': 'application/rss+xml; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=900'
              }
            });
          }
          return jsonResponse(kwResult);
        }

        if (!targetUrl) return errorResponse('Missing url or q parameter', 400);

        if (wantsXml) {
          try {
            // Public links must reproduce Add Source's feed-first result. Using
            // the legacy scraper here made a preview and its shared RSS URL
            // disagree for protected publisher homepages.
            const buildResult = await discoverFeedFromUrl(targetUrl, env);
            return new Response(buildResult.xml, {
              headers: {
                'Content-Type': 'application/rss+xml; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=900'
              }
            });
          } catch (e) {
            return errorResponse(e.message || 'Failed to render feed XML', 422);
          }
        }

        return await handleStream(request, new URL(url.origin + '/api/stream?urls=' + encodeURIComponent(targetUrl)), env, ctx);
      }

      // ------------------------------------------------------------------------
      // 7. Feed Preview & Web-to-RSS Routes (Phase 2 Enhanced)
      // ------------------------------------------------------------------------
      if ((pathname === '/api/feed-preview' || pathname === '/api/test-feed') && request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (_) {}
        const targetUrl = body.url || body.site;
        if (!targetUrl) return errorResponse('Missing url parameter', 400);

        try {
          // Add Source is feed-first: official feeds and feed links are safer
          // than scraping a homepage which may block Worker-origin traffic.
          const buildResult = await discoverFeedFromUrl(targetUrl, env);
          return jsonResponse({
            success: true,
            status: 'success',
            url: buildResult.siteUrl || targetUrl,
            name: (buildResult.meta && buildResult.meta.title) || body.name || 'Feed',
            articles: buildResult.items || [],
            count: (buildResult.items || []).length,
            xml: buildResult.xml || '',
            meta: buildResult.meta || {},
            discovery: buildResult.discovery || null
          });
        } catch (prevErr) {
          return jsonResponse({
            success: false,
            status: 'error',
            url: targetUrl,
            name: body.name || 'Feed',
            articles: [],
            count: 0,
            message: prevErr.message || 'Preview failed',
            recovery: prevErr.recovery || null
          }, 422);
        }
      }

      if ((pathname === '/api/build' || pathname === '/api/web-to-rss') && (request.method === 'GET' || request.method === 'POST')) {
        let targetUrl = url.searchParams.get('url') || url.searchParams.get('site');
        if (!targetUrl && request.method === 'POST') {
          try {
            const body = await request.json();
            targetUrl = body.url || body.site;
          } catch (_) {}
        }
        if (!targetUrl) return errorResponse('Missing url or site parameter', 400);

        try {
          const buildResult = await buildRssFromUrl(targetUrl, env);
          return jsonResponse(buildResult);
        } catch (buildErr) {
          return errorResponse(buildErr.message || 'Failed to build RSS feed', 422);
        }
      }

      // ------------------------------------------------------------------------
      // 8. Catalog Discovery Route (Phase 1 Baseline)
      // ------------------------------------------------------------------------
      if (pathname === '/api/catalog' || pathname === '/api/publishers') {
        if (env.DB) {
          try {
            const rows = await env.DB.prepare(`
              SELECT s.id, s.title, s.feed_url, s.category, s.status, s.is_verified,
                     sh.response_ms, sh.last_http_status, sh.last_success_at, sh.consecutive_failures
              FROM sources s
              LEFT JOIN source_health sh ON sh.source_id = s.id
              WHERE s.status = 'active'
              ORDER BY s.is_verified DESC, s.title ASC
              LIMIT 100
            `).all();
            if (rows.results && rows.results.length > 0) {
              return jsonResponse({ status: 'success', publishers: rows.results, sources: rows.results });
            }
          } catch (e) {
            console.warn('D1 sources read error:', e.message);
          }
        }
        return jsonResponse({ status: 'success', publishers: [] });
      }

      // ------------------------------------------------------------------------
      // 8. Waitlist Signup Route
      // ------------------------------------------------------------------------
      if (pathname === '/api/waitlist' && request.method === 'POST') {
        try {
          const body = await request.json();
          const email = (body.email || '').trim().toLowerCase();
          if (!email || !email.includes('@')) return errorResponse('Invalid email address');
          if (env.DB) {
            await env.DB.prepare('INSERT OR IGNORE INTO notify_signups (email, joined_at, synced_at) VALUES (?, ?, ?)')
              .bind(email, new Date().toISOString(), new Date().toISOString()).run();
          }
          return jsonResponse({ status: 'success', message: 'Subscribed to launch updates' });
        } catch (e) {
          return errorResponse('Failed to record signup');
        }
      }

      // ------------------------------------------------------------------------
      // 8.5. Admin Reads & Cloudflare Telemetry Route
      // ------------------------------------------------------------------------
      if (pathname === '/api/admin/metrics' && request.method === 'GET') {
        let stats = { total_users: 0, total_articles: 0, total_sources: 0, active_sessions: 0, total_events: 0 };
        let writes = {
          today: 0,
          yesterday: 0,
          this_month: 0,
          breakdown: {
            articles: { today: 0, yesterday: 0, this_month: 0 },
            events: { today: 0, yesterday: 0, this_month: 0 },
            sessions: { today: 0, yesterday: 0, this_month: 0 },
            audit_logs: { today: 0, yesterday: 0, this_month: 0 }
          }
        };

        if (env.DB) {
          try {
            const now = Date.now();
            const startOfToday = new Date(new Date().setUTCHours(0, 0, 0, 0)).getTime();
            const startOfYesterday = startOfToday - 86400000;
            const startOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).getTime();

            const [
              uCount, aCount, sCount, sessCount,
              artToday, artYest, artMonth,
              evToday, evYest, evMonth,
              sessToday, sessYest, sessMonth,
              auditToday, auditYest, auditMonth
            ] = await Promise.all([
              env.DB.prepare('SELECT COUNT(*) as c FROM users').first().catch(() => ({ c: 0 })),
              env.DB.prepare('SELECT COUNT(*) as c FROM articles').first().catch(() => ({ c: 0 })),
              env.DB.prepare('SELECT COUNT(*) as c FROM sources WHERE status = "active"').first().catch(() => ({ c: 0 })),
              env.DB.prepare('SELECT COUNT(*) as c FROM user_sessions WHERE expires_at > ?').bind(now).first().catch(() => ({ c: 0 })),

              env.DB.prepare('SELECT COUNT(*) as c FROM articles WHERE ingested_at >= ?').bind(startOfToday).first().catch(() => ({ c: 0 })),
              env.DB.prepare('SELECT COUNT(*) as c FROM articles WHERE ingested_at >= ? AND ingested_at < ?').bind(startOfYesterday, startOfToday).first().catch(() => ({ c: 0 })),
              env.DB.prepare('SELECT COUNT(*) as c FROM articles WHERE ingested_at >= ?').bind(startOfMonth).first().catch(() => ({ c: 0 })),

              env.DB.prepare('SELECT COUNT(*) as c FROM article_events WHERE created_at >= ?').bind(startOfToday).first().catch(() => ({ c: 0 })),
              env.DB.prepare('SELECT COUNT(*) as c FROM article_events WHERE created_at >= ? AND created_at < ?').bind(startOfYesterday, startOfToday).first().catch(() => ({ c: 0 })),
              env.DB.prepare('SELECT COUNT(*) as c FROM article_events WHERE created_at >= ?').bind(startOfMonth).first().catch(() => ({ c: 0 })),

              env.DB.prepare('SELECT COUNT(*) as c FROM user_sessions WHERE created_at >= ?').bind(startOfToday).first().catch(() => ({ c: 0 })),
              env.DB.prepare('SELECT COUNT(*) as c FROM user_sessions WHERE created_at >= ? AND created_at < ?').bind(startOfYesterday, startOfToday).first().catch(() => ({ c: 0 })),
              env.DB.prepare('SELECT COUNT(*) as c FROM user_sessions WHERE created_at >= ?').bind(startOfMonth).first().catch(() => ({ c: 0 })),

              env.DB.prepare('SELECT COUNT(*) as c FROM user_audit_logs WHERE created_at >= ?').bind(startOfToday).first().catch(() => ({ c: 0 })),
              env.DB.prepare('SELECT COUNT(*) as c FROM user_audit_logs WHERE created_at >= ? AND created_at < ?').bind(startOfYesterday, startOfToday).first().catch(() => ({ c: 0 })),
              env.DB.prepare('SELECT COUNT(*) as c FROM user_audit_logs WHERE created_at >= ?').bind(startOfMonth).first().catch(() => ({ c: 0 }))
            ]);

            stats.total_users = uCount?.c || 0;
            stats.total_articles = aCount?.c || 0;
            stats.total_sources = sCount?.c || 0;
            stats.active_sessions = sessCount?.c || 0;

            const artT = artToday?.c || 0, artY = artYest?.c || 0, artM = artMonth?.c || 0;
            const evT = evToday?.c || 0, evY = evYest?.c || 0, evM = evMonth?.c || 0;
            const sT = sessToday?.c || 0, sY = sessYest?.c || 0, sM = sessMonth?.c || 0;
            const audT = auditToday?.c || 0, audY = auditYest?.c || 0, audM = auditMonth?.c || 0;

            writes.breakdown.articles = { today: artT, yesterday: artY, this_month: artM };
            writes.breakdown.events = { today: evT, yesterday: evY, this_month: evM };
            writes.breakdown.sessions = { today: sT, yesterday: sY, this_month: sM };
            writes.breakdown.audit_logs = { today: audT, yesterday: audY, this_month: audM };

            writes.today = artT + evT + sT + audT;
            writes.yesterday = artY + evY + sY + audY;
            writes.this_month = artM + evM + sM + audM;

          } catch (_) {}
        }

        return jsonResponse({
          status: 'success',
          platform: 'FeedOmeter 2.1',
          environment: env.ENVIRONMENT || 'production',
          database_id: 'ca5fb7fa-600e-456a-b904-080229328089',
          account_id: 'f77f476d7ae23ede65d465856c3b29a4',
          stats,
          writes,
          timestamp: Date.now()
        });
      }

      // ------------------------------------------------------------------------
      // 9. Root / Health Check
      // ------------------------------------------------------------------------
      if (pathname === '/' || pathname === '/api/health') {
        let database = 'unavailable';
        if (env.DB) {
          try {
            await env.DB.prepare('SELECT 1 AS ok').first();
            database = 'ok';
          } catch (healthError) {
            console.warn('Health check database error:', healthError.message);
            database = 'error';
          }
        }
        return jsonResponse({
          status: database === 'ok' ? 'online' : 'degraded',
          service: 'feedometer-api',
          version: '2.1.0',
          dependencies: {
            database,
            cache: env.FEEDS_KV ? 'configured' : 'unavailable',
            browser_rendering: env.BROWSER ? 'configured' : 'unavailable'
          },
          timestamp: Date.now()
        });
      }

      return errorResponse('Not Found', 404, 'NOT_FOUND');

    } catch (err) {
      console.error('Unhandled Worker error:', err.stack || err.message);
      return errorResponse('Internal Server Error', 500, 'INTERNAL_SERVER_ERROR');
    }
  },

  // Automated Cron Triggers (Phase 5 Consolidated Multi-Stage Engine)
  async scheduled(event, env, ctx) {
    console.log('Scheduled cron triggered at:', new Date().toISOString());
    if (!env.DB) return;

    // Stage 1: Ingest active feeds into D1
    try {
      const hotFeeds = await env.DB.prepare(dueSourcesQuery()).bind(Date.now(), 100).all();
      for (const src of (hotFeeds.results || [])) {
        ctx.waitUntil(
          // Edge cache keeps reads fast and absorbs repeat requests.
          fetchFeedWithCache(src, env, ctx, 3600).catch((err) => {
            console.warn('Cron ingest failed for ' + src.title + ': ' + err.message);
          })
        );
      }
    } catch (e) {
      console.warn('Cron ingest error:', e.message);
    }

    // Stage 2: Process Event Ingestion Queue (Claim & Match active user rules)
    ctx.waitUntil((async () => {
      try {
        await processFeedEventQueue(env, 25);
      } catch (e) {
        console.warn('Cron event queue error:', e.message);
      }

      // Stage 3: Dispatch Pending Outbound Webhooks (Real-time & Scheduled Batches)
      try {
        await dispatchWebhookBatch(env, 15);
        await processScheduledWebhooks(env);
      } catch (e) {
        console.warn('Cron webhook batch error:', e.message);
      }

      // Stage 4: Dispatch Pending Alerts & Push (Max 20 subrequests)
      try {
        await dispatchPendingAlerts(env, 20);
        await dispatchLegacyKeywordAlertEmails(env, 20);
      } catch (e) {
        console.warn('Cron alert dispatch error:', e.message);
      }

      // Stage 5: Compile & Dispatch Due Scheduled Digests
      try {
        await processDueDigests(env);
      } catch (e) {
        console.warn('Cron digest runner error:', e.message);
      }

      // Legacy keyword_alerts in-app statistics sync. Email delivery is handled
      // above by dispatchLegacyKeywordAlertEmails using its durable cursor.
      try {
        const alerts = await env.DB.prepare('SELECT id, user_id, keyword FROM keyword_alerts WHERE is_active = 1').all();
        const list = alerts.results || [];
        if (list.length > 0) {
          const recent = await env.DB.prepare('SELECT title, snippet FROM articles WHERE ingested_at > ? LIMIT 200')
            .bind(Date.now() - 24 * 3600 * 1000).all();
          const articles = recent.results || [];
          for (const alert of list) {
            const kw = String(alert.keyword || '').toLowerCase();
            if (!kw) continue;
            const hits = articles.filter((a) => ((a.title || '') + ' ' + (a.snippet || '')).toLowerCase().includes(kw)).length;
            if (hits > 0) {
              await env.DB.prepare('UPDATE keyword_alerts SET match_count = match_count + ?, last_notified_at = ? WHERE id = ?')
                .bind(hits, Date.now(), alert.id).run();
            }
          }
        }
      } catch (e) {}
    })());
  }
};
