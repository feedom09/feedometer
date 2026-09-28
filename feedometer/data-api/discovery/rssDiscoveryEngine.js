const { prepareSearchQueries, matchesPreparedQuery } = require('./query');
const { candidateCorpus, deduplicateCandidates } = require('./normalizer');
const { topicGraphCandidates } = require('./topicGraph');
const repository = require('./sqlDiscoveryRepository');
const { searchFeedlyDirectory } = require('./providers/feedly');
const { searchWebCandidates } = require('./providers/serper');
const { validateFeedCandidate, discoverFeedFromWebsite } = require('./feedValidator');

function scoreCandidate(candidate, prepared) {
  const corpus = candidateCorpus(candidate); const terms = prepared.normalized.split(' ').filter((term) => term.length > 1);
  const matches = terms.filter((term) => corpus.includes(term)).length; const relevance = terms.length ? matches / terms.length : 0;
  const subscriberScore = Math.min(Math.log10(Number(candidate.subscribers || 0) + 1) / 6, 1);
  const activityScore = Math.min(Number(candidate.velocity || 0) / 20, 1);
  return Math.round((0.65 * relevance + 0.2 * subscriberScore + 0.1 * activityScore + 0.05) * 1000) / 1000;
}
async function settleWithConcurrency(items, work, concurrency = 5) {
  const output = []; let cursor = 0;
  async function worker() { while (cursor < items.length) { const item = items[cursor++]; const result = await work(item).catch(() => null); if (Array.isArray(result)) output.push(...result.filter(Boolean)); else if (result) output.push(result); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker)); return output;
}
async function findFeeds({ query, category = 'all', language = 'all', limit = 50 }) {
  const startedAt = Date.now(); const prepared = prepareSearchQueries(query);
  if (!prepared.normalized) return { status: 'success', success: true, feeds: [], total: 0, execution_ms: 0 };
  const cached = await repository.readCache(prepared.normalized);
  if (cached) return { ...cached, cached: true, execution_ms: Date.now() - startedAt };
  const variantLimit = 50;
  const [feedlyGroups, sqlCandidates, webGroups] = await Promise.all([
    Promise.all(prepared.variants.map((variant) => searchFeedlyDirectory(variant, variantLimit))),
    repository.searchCatalog(prepared.variants, 250),
    Promise.all(prepared.variants.slice(0, 2).map((variant) => searchWebCandidates(variant, 20)))
  ]);
  const topicCandidates = prepared.variants.flatMap(topicGraphCandidates);
  const knownSqlCandidates = sqlCandidates.map((candidate) => ({ ...candidate, canonical_feed_url: candidate.feed_url, validated_at: Date.now(), feed_health_pct: 100 }));
  const unvalidatedCandidates = deduplicateCandidates([...feedlyGroups.flat(), ...topicCandidates])
    .sort((a, b) => scoreCandidate(b, prepared) - scoreCandidate(a, prepared));
  const validated = await settleWithConcurrency(unvalidatedCandidates, (candidate) => validateFeedCandidate(candidate, 3500), 8);
  const webCandidates = webGroups.flat().slice(0, 40);
  const discoveredFromWeb = await settleWithConcurrency(webCandidates, discoverFeedFromWebsite, 3);
  let feeds = deduplicateCandidates([...knownSqlCandidates, ...validated, ...discoveredFromWeb])
    .filter((candidate) => matchesPreparedQuery(prepared, candidateCorpus(candidate)))
    .filter((candidate) => category === 'all' || String(candidate.category || '').toLowerCase().includes(String(category).toLowerCase()))
    .filter((candidate) => language === 'all' || String(candidate.language || 'en').toLowerCase() === String(language).toLowerCase())
    .map((candidate) => ({ ...candidate, discovery_score: scoreCandidate(candidate, prepared), source_engines: candidate.source_engines || [candidate.source_engine] }))
    .sort((a, b) => b.discovery_score - a.discovery_score)
    .slice(0, Math.min(Math.max(Number(limit) || 500, 1), 500));
  await Promise.all(feeds.map((candidate) => repository.saveCandidate(prepared.normalized, candidate)));
  const response = { status: 'success', success: true, query: prepared.original, feeds, sources: feeds, total: feeds.length, execution_ms: Date.now() - startedAt, cached: false };
  await repository.writeCache(prepared.normalized, response); return response;
}
module.exports = { findFeeds, scoreCandidate };
