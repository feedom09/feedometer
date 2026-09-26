export function matchTrackedEntities(article = {}, entities = []) {
  const text=`${article.title||''} ${article.snippet||article.summary||''}`.toLowerCase();
  return (Array.isArray(entities)?entities:[]).map(e=>String(e).trim()).filter(Boolean).filter(e=>text.includes(e.toLowerCase()));
}
export function buildResearchRequest({ question = '', articleIds = [] } = {}) {
  const q=String(question).trim().slice(0,500); if(!q) throw new Error('question is required');
  return { version:'1.0', question:q, article_ids:[...new Set(articleIds.map(String))].slice(0,25), constraints:{ provider:null, network_access:false, require_article_citations:true, include_credentials:false } };
}
