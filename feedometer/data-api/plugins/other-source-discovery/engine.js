const repository = require('./repository'); const { byId } = require('./types');
const { searchResearch } = require('./providers/openAlex'); const { searchPodcasts } = require('./providers/itunes'); const { searchSerper } = require('./providers/serper');
function enabled() { return process.env.OTHER_SOURCE_DISCOVERY_ENABLED !== 'false'; }
function needsWebSearch(type) { return ['youtube', 'blogs', 'news', 'newsletters'].includes(type); }
async function search(queryText, type, limit = 12) {
  const query = String(queryText || '').trim(); if (!query) throw new Error('query is required'); if (!byId.has(type)) throw new Error('Unknown other-source type');
  if (!enabled()) return { enabled: false, results: [] };
  // These four source types deliberately use a licensed web-search API.  Do
  // not manufacture an empty result set, and do not cache one, if its key has
  // not yet been configured.
  if (needsWebSearch(type) && !process.env.SERPER_API_KEY) {
    return { enabled: true, configured: false, provider: 'Serper', message: 'Live web discovery for this category needs the SERPER_API_KEY server setting.', results: [] };
  }
  const cached = await repository.read(query, type); if (cached) return { enabled: true, cached: true, results: cached };
  const results = type === 'research' ? await searchResearch(query, limit) : type === 'podcasts' ? await searchPodcasts(query, limit) : await searchSerper(query, type, limit);
  await repository.write(query, type, results); await repository.saveResults(query, type, results);
  return { enabled: true, cached: false, results };
}
module.exports = { enabled, search };
