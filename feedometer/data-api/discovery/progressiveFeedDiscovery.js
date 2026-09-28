/** Progressive RSS discovery: fast first batch, complete discovery in background. */
const { prepareSearchQueries, matchesPreparedQuery } = require('./query');
const { deduplicateCandidates, candidateCorpus } = require('./normalizer');
const repository = require('./sqlDiscoveryRepository');
const { searchFeedlyDirectory } = require('./providers/feedly');
const { findFeeds, scoreCandidate } = require('./rssDiscoveryEngine');

const jobs = new Map();
function keyFor(prepared, category, language) { return `${prepared.normalized}::${category || 'all'}::${language || 'all'}`; }
function applyFilters(candidates, prepared, category, language) {
  return deduplicateCandidates(candidates)
    .filter((candidate) => matchesPreparedQuery(prepared, candidateCorpus(candidate)))
    .filter((candidate) => category === 'all' || String(candidate.category || '').toLowerCase().includes(String(category).toLowerCase()))
    .filter((candidate) => language === 'all' || String(candidate.language || 'en').toLowerCase() === String(language).toLowerCase())
    .map((candidate) => ({ ...candidate, discovery_score: scoreCandidate(candidate, prepared), source_engines: candidate.source_engines || [candidate.source_engine] }))
    .sort((a, b) => b.discovery_score - a.discovery_score);
}
function page(response, offset, limit, complete, executionMs, cached) {
  const feeds = response.slice(offset, offset + limit);
  return { status: 'success', success: true, feeds, sources: feeds, total: response.length, total_available: response.length, offset, next_offset: offset + feeds.length, discovery_complete: complete, execution_ms: executionMs, cached: Boolean(cached) };
}
async function initialBatch(prepared, category, language) {
  // Run every normalised spelling immediately.  A user entering "basket ball"
  // should see the directory's "basketball" feeds in the first paint rather
  // than wait for the slower validation/discovery pass.
  const [feedlyGroups, sqlCandidates] = await Promise.all([
    Promise.all(prepared.variants.map((variant) => searchFeedlyDirectory(variant, 25, 2500))),
    repository.searchCatalog(prepared.variants, 100)
  ]);
  const known = sqlCandidates.map((candidate) => ({ ...candidate, canonical_feed_url: candidate.feed_url, validated_at: Date.now(), feed_health_pct: 100 }));
  return applyFilters([...known, ...feedlyGroups.flat()], prepared, category, language).slice(0, 20);
}
async function getProgressiveFeeds({ query, category = 'all', language = 'all', offset = 0, limit = 20 }) {
  const startedAt = Date.now(); const prepared = prepareSearchQueries(query); const safeOffset = Math.max(Number(offset) || 0, 0); const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  if (!prepared.normalized) return page([], safeOffset, safeLimit, true, 0, false);
  const cached = await repository.readCache(prepared.normalized);
  if (cached && Array.isArray(cached.feeds)) return { ...page(cached.feeds, safeOffset, safeLimit, true, Date.now() - startedAt, true), query: prepared.original };
  const key = keyFor(prepared, category, language); let job = jobs.get(key);
  if (!job) {
    const first = await initialBatch(prepared, category, language);
    job = { first, complete: false, full: null, startedAt: Date.now(), error: null }; jobs.set(key, job);
    job.promise = findFeeds({ query: prepared.original, category, language, limit: 500 })
      .then((result) => { job.full = result.feeds || []; job.complete = true; })
      .catch((error) => { job.error = error.message; job.complete = true; })
      .finally(() => { const timer = setTimeout(() => jobs.delete(key), 30 * 60 * 1000); if (timer.unref) timer.unref(); });
  }
  const available = job.full || job.first;
  return { ...page(available, safeOffset, safeLimit, job.complete, Date.now() - startedAt, false), query: prepared.original, discovery_error: job.error || undefined };
}
module.exports = { getProgressiveFeeds };
