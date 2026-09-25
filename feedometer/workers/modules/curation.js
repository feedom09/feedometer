import { verifySessionToken } from '../lib/session.js';
import { generateRandomHex } from '../lib/crypto.js';
import { jsonResponse, errorResponse } from '../lib/response.js';

export async function handleTags(request, env, url) {
  const session = await verifySessionToken(request, env); if (!session) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED');
  if (request.method === 'GET') { const articleId=url && url.searchParams.get('article_id'); const sql=articleId ? 'SELECT t.id,t.name,t.color,t.created_at FROM user_article_tags t JOIN article_tag_assignments a ON a.tag_id=t.id WHERE t.user_id=? AND a.article_id=? ORDER BY t.name' : 'SELECT id,name,color,created_at FROM user_article_tags WHERE user_id=? ORDER BY name'; const r=articleId ? await env.DB.prepare(sql).bind(session.userId,articleId).all() : await env.DB.prepare(sql).bind(session.userId).all(); return jsonResponse({ status:'success', tags:r.results||[] }); }
  if (request.method === 'POST') { const b=await request.json(); const name=String(b.name||'').trim().slice(0,60); if(!name) return errorResponse('Tag name is required',400); const id=`tag_${generateRandomHex(10)}`; await env.DB.prepare('INSERT INTO user_article_tags (id,user_id,name,color,created_at) VALUES (?,?,?,?,?)').bind(id,session.userId,name,String(b.color||'').slice(0,20),Date.now()).run(); return jsonResponse({status:'success',tag:{id,name}},201); }
  return errorResponse('Method Not Allowed',405);
}
export async function handleTagAssignments(request, env) {
  const session=await verifySessionToken(request,env); if(!session) return errorResponse('Unauthorized',401,'UNAUTHORIZED');
  const b=await request.json(); const articleId=String(b.article_id||'').trim(), tagId=String(b.tag_id||'').trim();
  if(!articleId||!tagId)return errorResponse('article_id and tag_id are required',400);
  const owns=await env.DB.prepare('SELECT id FROM user_article_tags WHERE id=? AND user_id=?').bind(tagId,session.userId).first(); if(!owns)return errorResponse('Tag not found',404);
  if(request.method==='POST'){await env.DB.prepare('INSERT OR IGNORE INTO article_tag_assignments (user_id,article_id,tag_id,created_at) VALUES (?,?,?,?)').bind(session.userId,articleId,tagId,Date.now()).run();return jsonResponse({status:'success'});}
  if(request.method==='DELETE'){await env.DB.prepare('DELETE FROM article_tag_assignments WHERE user_id=? AND article_id=? AND tag_id=?').bind(session.userId,articleId,tagId).run();return jsonResponse({status:'success'});}
  return errorResponse('Method Not Allowed',405);
}
export async function handleCollections(request, url, env) {
  const session=await verifySessionToken(request,env); if(!session) return errorResponse('Unauthorized',401,'UNAUTHORIZED');
  if(request.method==='GET'){const r=await env.DB.prepare('SELECT id,name,description,share_token,is_public,created_at FROM user_collections WHERE user_id=? ORDER BY created_at DESC').bind(session.userId).all();return jsonResponse({status:'success',collections:r.results||[]});}
  if(request.method==='POST'){const b=await request.json();const name=String(b.name||'').trim().slice(0,120);if(!name)return errorResponse('Collection name is required',400);const id=`col_${generateRandomHex(10)}`,token=Boolean(b.is_public)?`pub_${generateRandomHex(16)}`:null,now=Date.now();await env.DB.prepare('INSERT INTO user_collections (id,user_id,name,description,share_token,is_public,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,session.userId,name,String(b.description||'').slice(0,500),token,token?1:0,now,now).run();return jsonResponse({status:'success',collection:{id,name,share_token:token,is_public:Boolean(token)}},201);}
  return errorResponse('Method Not Allowed',405);
}
export async function handleFeedHealth(request, env) {
  const session=await verifySessionToken(request,env); if(!session) return errorResponse('Unauthorized',401,'UNAUTHORIZED');
  const rows=await env.DB.prepare(`SELECT s.id,s.title,s.url,s.last_fetched_at,s.last_error_at,s.last_error_message,
    h.health_score,h.last_item_count,h.recorded_at FROM sources s
    JOIN user_subscriptions us ON us.source_id=s.id LEFT JOIN feed_health_metrics h ON h.source_id=s.id
    WHERE us.user_id=? ORDER BY COALESCE(h.health_score,0) ASC, s.title ASC LIMIT 100`).bind(session.userId).all();
  return jsonResponse({status:'success',sources:rows.results||[]});
}
