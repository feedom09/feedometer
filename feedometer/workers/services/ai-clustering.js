export function clusterArticlesLocally(articles = []) {
  const groups=new Map(); for(const article of articles){const words=String(article.title||'').toLowerCase().match(/[a-z0-9]{4,}/g)||[];const key=[...new Set(words)].sort().slice(0,3).join('|')||String(article.id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(article);} return [...groups.values()].map(items=>({label:items[0].title,articleIds:items.map(a=>a.id),count:items.length,method:'lexical-fallback'}));
}
