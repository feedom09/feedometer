/**
 * Stable, provider-neutral event envelope for all outbound Phase 3 behavior.
 * It intentionally contains article metadata only: never webhook secrets,
 * user credentials, session data, or full scraped article content.
 */
export const INTEGRATION_EVENT_VERSION = '1.0';

function text(value, maxLength = 0) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return maxLength > 0 ? normalized.slice(0, maxLength) : normalized;
}

function timestamp(value) {
  const date = new Date(Number(value) || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/** Build the one canonical real-time article match event. */
export function buildArticleMatchedEvent({ deliveryId, webhookId, occurredAt, article = {}, matchedKeywords = [] } = {}) {
  const articleUrl = text(article.url || article.link, 2048);
  if (!deliveryId) throw new Error('deliveryId is required');
  if (!article.id || !articleUrl) throw new Error('article id and URL are required');

  return {
    version: INTEGRATION_EVENT_VERSION,
    id: String(deliveryId),
    type: 'article.matched',
    occurred_at: timestamp(occurredAt),
    delivery: { webhook_id: text(webhookId, 128) },
    data: {
      article: {
        id: String(article.id),
        title: text(article.title, 500),
        url: articleUrl,
        summary: text(article.summary || article.snippet || article.description, 1000),
        image_url: text(article.image_url || article.image, 2048),
        source_id: text(article.source_id || article.sourceId, 128),
        published_at: timestamp(article.published_at || article.publishedAt)
      },
      matched_keywords: Array.from(new Set((matchedKeywords || []).map((keyword) => text(keyword, 100)).filter(Boolean))).slice(0, 50)
    }
  };
}

export function eventTypeFromPayload(payload) {
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return parsed && typeof parsed.type === 'string' ? parsed.type : 'article.matched';
  } catch (_) {
    return 'article.matched';
  }
}
