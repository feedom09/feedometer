/**
 * workers/services/feed-fusion.js — Multi-Feed Fusion, Cross-Feed Deduplication & Cursor Pagination
 */
import { fetchFeedWithCache } from './cache-manager.js';

export async function fuseFeedStreams(sources, env, ctx, options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), 100);
  const cursor = options.cursor || null;

  if (!Array.isArray(sources) || sources.length === 0) {
    return {
      status: 'success',
      count: 0,
      total_sources: 0,
      next_cursor: null,
      has_more: false,
      items: []
    };
  }

  // 1. Concurrent Edge Ingestion across sources
  const fetchPromises = sources.map(src => fetchFeedWithCache(src, env, ctx));
  const settledResults = await Promise.allSettled(fetchPromises);

  // 2. Aggregate all items & Cross-Feed Deduplication
  const seenHashes = new Set();
  const seenTitleKeys = new Set();
  const rawMergedItems = [];

  for (const res of settledResults) {
    if (res.status === 'fulfilled' && res.value && Array.isArray(res.value.items)) {
      const srcMeta = res.value.source || {};
      for (const item of res.value.items) {
        const stamped = Object.assign({}, item, {
          source_id: srcMeta.id || item.source_id || (item.source && item.source.id) || '',
          feed_url: srcMeta.feed_url || item.feed_url || (item.source && item.source.feed_url) || '',
          source: Object.assign({}, item.source || {}, {
            id: srcMeta.id || (item.source && item.source.id) || '',
            title: srcMeta.title || (item.source && item.source.title) || 'Feed Source',
            feed_url: srcMeta.feed_url || (item.source && item.source.feed_url) || '',
            website_url: srcMeta.website_url || (item.source && item.source.website_url) || ''
          })
        });
        if (stamped.id && seenHashes.has(stamped.id)) continue;

        const simplifiedTitle = (stamped.title || '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 40);

        if (simplifiedTitle && seenTitleKeys.has(simplifiedTitle)) continue;

        if (stamped.id) seenHashes.add(stamped.id);
        if (simplifiedTitle) seenTitleKeys.add(simplifiedTitle);

        rawMergedItems.push(stamped);
      }
    }
  }

  // 3. Chronological Sorting (Newest to Oldest)
  rawMergedItems.sort((a, b) => {
    const timeA = new Date(a.published).getTime() || 0;
    const timeB = new Date(b.published).getTime() || 0;
    return timeB - timeA;
  });

  // 4. Cursor Pagination Processing
  let startIndex = 0;
  if (cursor) {
    const [cursorEpochStr, cursorHash] = cursor.split('_');
    const cursorEpoch = parseInt(cursorEpochStr, 10);

    const matchIdx = rawMergedItems.findIndex(item => {
      const itemEpoch = new Date(item.published).getTime() || 0;
      if (cursorEpoch && itemEpoch < cursorEpoch) return true;
      if (cursorHash && item.id === cursorHash) return true;
      return false;
    });

    if (matchIdx !== -1) {
      startIndex = matchIdx;
    }
  }

  const pagedItems = rawMergedItems.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < rawMergedItems.length;

  let nextCursor = null;
  if (hasMore && pagedItems.length > 0) {
    const lastItem = pagedItems[pagedItems.length - 1];
    const lastEpoch = new Date(lastItem.published).getTime() || Date.now();
    nextCursor = `${lastEpoch}_${lastItem.id}`;
  }

  return {
    status: 'success',
    count: pagedItems.length,
    total_sources: sources.length,
    next_cursor: nextCursor,
    has_more: hasMore,
    items: pagedItems
  };
}
