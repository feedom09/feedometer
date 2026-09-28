/** Canonical candidate handling shared by all discovery providers. */
const TRACKING_PARAMETER = /^(?:utm_|fbclid$|gclid$|mc_[ce]id$|ref$|source$)/i;
function canonicalFeedUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    url.protocol = 'https:'; url.hostname = url.hostname.toLowerCase().replace(/^www\./, ''); url.hash = '';
    [...url.searchParams.keys()].forEach((key) => { if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key); });
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'; return url.toString().replace(/\/$/, '');
  } catch (_) { return String(value).trim().toLowerCase().replace(/\/$/, ''); }
}
function candidateCorpus(candidate) { return [candidate.feed_name, candidate.title, candidate.description, candidate.category, ...(candidate.topics || []), candidate.website_url, candidate.feed_url].join(' ').toLowerCase(); }
function mergeCandidate(existing, incoming) {
  const winner = Number(incoming.discovery_score || 0) > Number(existing.discovery_score || 0) ? incoming : existing;
  const other = winner === incoming ? existing : incoming;
  return { ...other, ...winner, feed_url: winner.feed_url || other.feed_url, website_url: winner.website_url || other.website_url,
    description: String(winner.description || '').length >= String(other.description || '').length ? winner.description : other.description,
    subscribers: Math.max(Number(existing.subscribers || 0), Number(incoming.subscribers || 0)),
    source_engines: [...new Set([...(existing.source_engines || [existing.source_engine]).filter(Boolean), ...(incoming.source_engines || [incoming.source_engine]).filter(Boolean)])] };
}
function deduplicateCandidates(candidates) {
  const byFeed = new Map();
  for (const candidate of candidates || []) { const canonical = canonicalFeedUrl(candidate.canonical_feed_url || candidate.feed_url || candidate.self_url); if (!canonical) continue;
    const normalized = { ...candidate, feed_url: canonical, canonical_feed_url: canonical }; byFeed.set(canonical, byFeed.has(canonical) ? mergeCandidate(byFeed.get(canonical), normalized) : normalized); }
  return [...byFeed.values()];
}
module.exports = { canonicalFeedUrl, candidateCorpus, deduplicateCandidates };
