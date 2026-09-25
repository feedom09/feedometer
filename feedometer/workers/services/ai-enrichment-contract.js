/**
 * Provider-neutral boundary for a future AI enrichment adapter. It builds a
 * safe request only; this module never selects a provider or performs a fetch.
 */
export const AI_ENRICHMENT_VERSION = '1.0';

function clean(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function buildAiEnrichmentRequest({ article = {}, task = 'summarize' } = {}) {
  const allowedTasks = new Set(['summarize', 'classify', 'extract_topics']);
  const url = clean(article.url || article.link, 2048);
  if (!article.id || !url) throw new Error('article id and URL are required');
  if (!allowedTasks.has(task)) throw new Error('unsupported AI enrichment task');

  return {
    version: AI_ENRICHMENT_VERSION,
    task,
    article: {
      id: String(article.id),
      title: clean(article.title, 500),
      url,
      summary: clean(article.summary || article.snippet || article.description, 3000),
      source: clean(article.source || article.source_name, 200),
      published_at: article.published_at || article.publishedAt || null
    },
    constraints: {
      provider: null,
      network_access: false,
      include_full_article_content: false,
      include_credentials: false
    }
  };
}
