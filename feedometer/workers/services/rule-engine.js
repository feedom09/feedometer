/**
 * workers/services/rule-engine.js — FeedOmeter Universal Shared Rule Engine
 * Evaluates articles against configured rule filters (Keywords, Boolean AST, Domains, Sources, Quality)
 */
import BooleanParser from '../../boolean-parser/boolean-parser.js';

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map(s => String(s).trim().toLowerCase()).filter(Boolean);
  }
  return String(value || '')
    .split(/[\n,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Universal evaluation of an article against a rule configuration.
 * @param {Object} item - Article object { id, title, summary, snippet, description, content, url, link, source_id, image, published, ... }
 * @param {Object} ruleConfig - Rule config { keywords, includeKeywords, excludeKeywords, includeDomains, excludeDomains, sourceIds, booleanQuery, noImage, noDescription, noSecureLink, oldPosts, oldDays, enabled }
 * @returns {{ matched: boolean, reason?: string, matchedKeywords: string[] }}
 */
export function evaluateArticleAgainstRule(item, ruleConfig) {
  if (!item || !ruleConfig || ruleConfig.enabled === false || ruleConfig.is_active === 0) {
    return { matched: true, matchedKeywords: [] };
  }

  const title = String(item.title || '').toLowerCase();
  const snippet = String(item.summary || item.snippet || item.description || item.content || '').toLowerCase();
  const textHaystack = (title + ' ' + snippet).trim();
  const url = String(item.url || item.link || '').toLowerCase();
  
  let host = '';
  try {
    host = new URL(url || 'https://invalid.local').hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) {}

  const matchedKeywords = [];

  // 1. Source ID Whitelist (if specified)
  const sourceIds = parseList(ruleConfig.sourceIds || ruleConfig.source_ids);
  if (sourceIds.length > 0) {
    const itemSourceId = String(item.source_id || item.sourceId || (item.source && item.source.id) || '').toLowerCase();
    if (!itemSourceId || !sourceIds.includes(itemSourceId)) {
      return { matched: false, reason: 'SOURCE_MISMATCH', matchedKeywords: [] };
    }
  }

  // 2. Domain Whitelist & Blacklist
  const includeDom = parseList(ruleConfig.includeDomains || ruleConfig.include_domains || ruleConfig.domains);
  if (includeDom.length > 0) {
    const matchesDomain = includeDom.some(d => host.includes(d) || url.includes(d));
    if (!matchesDomain) {
      return { matched: false, reason: 'DOMAIN_NOT_WHITELISTED', matchedKeywords: [] };
    }
  }

  const excludeDom = parseList(ruleConfig.excludeDomains || ruleConfig.exclude_domains);
  if (excludeDom.some(d => host.includes(d) || url.includes(d))) {
    return { matched: false, reason: 'DOMAIN_BLACKLISTED', matchedKeywords: [] };
  }

  // 3. Keyword Blacklist (Exclude)
  const excludeKw = parseList(ruleConfig.excludeKeywords || ruleConfig.exclude_keywords || ruleConfig.exclude);
  if (excludeKw.length > 0) {
    for (const kw of excludeKw) {
      if (textHaystack.includes(kw)) {
        return { matched: false, reason: `EXCLUDE_KEYWORD_MATCHED: ${kw}`, matchedKeywords: [] };
      }
    }
  }

  // 4. Keyword Whitelist (Include)
  const includeKw = parseList(ruleConfig.includeKeywords || ruleConfig.include_keywords || ruleConfig.keywords || ruleConfig.keyword);
  if (includeKw.length > 0) {
    let foundMatch = false;
    for (const kw of includeKw) {
      if (textHaystack.includes(kw)) {
        matchedKeywords.push(kw);
        foundMatch = true;
      }
    }
    if (!foundMatch) {
      return { matched: false, reason: 'NO_INCLUDE_KEYWORDS_MATCHED', matchedKeywords: [] };
    }
  }

  // 5. Advanced Boolean AST Expression (e.g. "AI AND (OpenAI OR Claude) NOT Crypto")
  const boolQuery = ruleConfig.booleanQuery || ruleConfig.boolean_query || ruleConfig.query;
  if (boolQuery && typeof boolQuery === 'string' && boolQuery.trim()) {
    const matchesBool = BooleanParser.matches(boolQuery, { title, snippet });
    if (!matchesBool) {
      return { matched: false, reason: 'BOOLEAN_AST_MISMATCH', matchedKeywords: [] };
    }
  }

  // 6. Quality & Freshness Guards
  if (ruleConfig.noImage && !(item.image || item.image_url || item.ogImage)) {
    return { matched: false, reason: 'NO_IMAGE', matchedKeywords: [] };
  }
  if (ruleConfig.noDescription && !snippet.trim()) {
    return { matched: false, reason: 'NO_DESCRIPTION', matchedKeywords: [] };
  }
  if (ruleConfig.noSecureLink && url && !url.startsWith('https://')) {
    return { matched: false, reason: 'INSECURE_LINK', matchedKeywords: [] };
  }
  if (ruleConfig.oldPosts) {
    const days = Number(ruleConfig.oldDays || ruleConfig.days) || 3;
    const published = new Date(item.published || item.published_at || item.pubDate || 0).getTime();
    if (published && (Date.now() - published) > days * 86400000) {
      return { matched: false, reason: 'STALE_ARTICLE', matchedKeywords: [] };
    }
  }

  return { matched: true, matchedKeywords };
}

/**
 * Filter an array of articles with a rule configuration
 */
export function filterArticlesByRule(articles, ruleConfig) {
  if (!Array.isArray(articles)) return [];
  return articles.filter(art => evaluateArticleAgainstRule(art, ruleConfig).matched);
}
