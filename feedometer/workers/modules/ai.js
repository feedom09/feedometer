import { verifySessionToken } from '../lib/session.js';
import { jsonResponse, errorResponse } from '../lib/response.js';
import { getArticleSummary } from '../services/ai-phase6.js';
export async function handleAiSummary(request, env) {
  const session=await verifySessionToken(request,env); if(!session)return errorResponse('Unauthorized',401,'UNAUTHORIZED');
  const body=await request.json(); const id=String(body.article_id||'').trim(); if(!id)return errorResponse('article_id is required',400);
  const article=await env.DB.prepare('SELECT id,title,url,snippet,source_id,published_at FROM articles WHERE id=?').bind(id).first(); if(!article)return errorResponse('Article not found',404);
  return jsonResponse(await getArticleSummary(env,article));
}
