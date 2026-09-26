import { buildAiEnrichmentRequest } from './ai-enrichment-contract.js';
export async function getArticleSummary(env, article) {
  const now=Date.now(); const cached=env.DB ? await env.DB.prepare('SELECT summary_json FROM ai_article_summaries WHERE article_id=? AND expires_at>?').bind(article.id,now).first() : null;
  if(cached) return { status:'cached', summary:JSON.parse(cached.summary_json) };
  if(!env.AI || typeof env.AI.run!=='function') return { status:'unavailable', message:'Workers AI is not configured in this environment.' };
  const request=buildAiEnrichmentRequest({article,task:'summarize'});
  const result=await env.AI.run('@cf/meta/llama-3.1-8b-instruct',{messages:[{role:'system',content:'Return two concise factual bullet points. Do not invent facts.'},{role:'user',content:`Title: ${request.article.title}\nSummary: ${request.article.summary}`}]});
  const summary={bullets:String(result.response||'').split(/\n+/).filter(Boolean).slice(0,2)};
  if(env.DB) await env.DB.prepare('INSERT OR REPLACE INTO ai_article_summaries (article_id,model,summary_json,created_at,expires_at) VALUES (?,?,?,?,?)').bind(article.id,'@cf/meta/llama-3.1-8b-instruct',JSON.stringify(summary),now,now+86400000).run();
  return {status:'generated',summary};
}
