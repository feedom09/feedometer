/**
 * workers/modules/streams.js — Stream Engine
 *
 * Builds a list of RSS sources, fuses them, then stamps channel tags.
 * Feed URLs and keyword rules live in services/channel-catalog.js — not in HTML.
 *
 * Query params:
 *   urls       = comma-separated feed URLs (public reader: one site)
 *   channel    = Tech | Finance | World | Science | Crypto | all
 *   folder_id  = personal folder stream (signed-in)
 *   limit, cursor
 */
import { verifySessionToken } from '../lib/session.js';
import { fuseFeedStreams } from '../services/feed-fusion.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import {
  getChannelSources,
  applyChannelTags,
  filterStreamByChannel,
  normalizeChannelId
} from '../services/channel-catalog.js';
import { applyRulesToStream, loadUserFilterRules } from '../services/user-filters.js';

/**
 * Personal follows, else the public five-desk catalog.
 * Never pad a short personal library with public channel feeds.
 */
export function chooseStreamSources({ hasSession, folderId, folderSources, personalSources, publicSources }) {
  const publicList = publicSources || [];
  if (folderId) {
    return { sources: folderSources || [], scope: 'folder' };
  }
  if (hasSession) {
    return { sources: personalSources || [], scope: 'personal' };
  }
  return { sources: publicList, scope: 'public' };
}

async function resolveSources(request, env, folderId) {
  const session = await verifySessionToken(request, env);
  const publicSources = getChannelSources('all');

  let folderSources = [];
  let personalSources = [];

  if (session && env.DB) {
    if (folderId) {
      const rows = await env.DB.prepare(`
        WITH RECURSIVE SubFolders AS (
          SELECT id FROM folders WHERE id = ? AND user_id = ?
          UNION ALL
          SELECT f.id FROM folders f
          JOIN SubFolders sf ON f.parent_folder_id = sf.id
          WHERE f.user_id = ?
        )
        SELECT DISTINCT s.id, s.title, s.feed_url, s.website_url, s.category, s.logo_url
        FROM sources s
        JOIN user_feed_assignments ufa ON s.id = ufa.feed_id
        JOIN SubFolders sf ON ufa.folder_id = sf.id
        WHERE ufa.user_id = ? AND s.status = 'active'
      `).bind(folderId, session.userId, session.userId, session.userId).all();
      folderSources = (rows && rows.results) || [];
    } else {
      const rows = await env.DB.prepare(`
        SELECT s.id, s.title, s.feed_url, s.website_url, s.category, s.logo_url
        FROM sources s
        JOIN user_feeds uf ON s.id = uf.source_id
        WHERE uf.user_id = ? AND s.status = 'active'
        ORDER BY uf.followed_at DESC
      `).bind(session.userId).all();
      personalSources = (rows && rows.results) || [];
    }
  }

  const chosen = chooseStreamSources({
    hasSession: !!session,
    folderId,
    folderSources,
    personalSources,
    publicSources
  });
  return chosen;
}

function stampCatalogIds(streamResult) {
  if (!streamResult || !Array.isArray(streamResult.items)) return streamResult;
  streamResult.items = streamResult.items.map((item) => {
    const hash = item.id && String(item.id).length === 64 ? item.id : null;
    return Object.assign({}, item, {
      article_id: item.article_id || (hash ? `art_${hash}` : item.id)
    });
  });
  return streamResult;
}

export async function handleStream(request, url, env, ctx) {
  const folderId = url.searchParams.get('folder_id');
  const rawUrls = url.searchParams.get('urls');
  const channel = normalizeChannelId(url.searchParams.get('channel'));
  const limit = url.searchParams.get('limit') || 50;
  const cursor = url.searchParams.get('cursor') || null;

  let scope = 'public';

  try {
    let sources = [];

    if (rawUrls) {
      const urlsList = rawUrls.split(/,(?=https?:\/\/)/i).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 20);
      sources = urlsList.map((feedUrl, idx) => ({
        id: `src_custom_${idx}`,
        title: 'Feed Source',
        feed_url: feedUrl
      }));
      scope = 'urls';
    } else {
      const resolved = await resolveSources(request, env, folderId);
      sources = resolved.sources;
      scope = resolved.scope;
    }

    let streamResult = await fuseFeedStreams(sources, env, ctx, { limit, cursor });
    streamResult = applyChannelTags(streamResult);
    streamResult = filterStreamByChannel(streamResult, channel);
    streamResult = stampCatalogIds(streamResult);
    streamResult.channel = channel;
    streamResult.stream_scope = scope;
    try {
      const session = await verifySessionToken(request, env);
      if (session) {
        const rules = await loadUserFilterRules(env, session.userId);
        streamResult = applyRulesToStream(streamResult, rules);
      }
    } catch (e) {}
    return jsonResponse(streamResult);
  } catch (err) {
    console.error('Stream generation failed:', err.message);
    if (scope === 'personal' || scope === 'folder' || scope === 'urls') {
      return jsonResponse({
        status: 'error',
        count: 0,
        total_sources: 0,
        items: [],
        channel,
        stream_scope: scope,
        message: err.message || 'Failed to generate stream'
      }, 500);
    }
    try {
      let streamResult = await fuseFeedStreams(getChannelSources('all'), env, ctx, { limit, cursor });
      streamResult = applyChannelTags(streamResult);
      streamResult = filterStreamByChannel(streamResult, channel);
      streamResult = stampCatalogIds(streamResult);
      streamResult.channel = channel;
      streamResult.stream_scope = 'public';
      return jsonResponse(streamResult);
    } catch (e2) {
      return errorResponse('Failed to generate stream', 500);
    }
  }
}
