/**
 * workers/services/digest-generator.js — FeedOmeter Email & In-App Digest Engine
 * Cursor-Driven Article Ingestion (last_article_at), Responsive HTML Compiler & Run Ledger
 */
import { generateRandomHex } from '../lib/crypto.js';
import { evaluateArticleAgainstRule } from './rule-engine.js';
import { sendTransactionalEmail } from './email-service.js';

/**
 * Compiles a responsive, modern HTML email template for a feed digest
 */
export function renderDigestHtml(digestName, articles, userName = 'FeedOmeter Reader') {
  const count = (articles || []).length;
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  let articleCardsHtml = '';
  if (count === 0) {
    articleCardsHtml = `
      <tr>
        <td style="padding: 24px; text-align: center; color: #64748b; font-size: 14px;">
          No new articles since your last digest. Check back in the next scheduled cycle!
        </td>
      </tr>
    `;
  } else {
    articles.forEach((art, idx) => {
      const title = art.title || 'Untitled Article';
      const snippet = (art.snippet || art.summary || art.description || '').slice(0, 180);
      const url = art.url || art.link || '#';
      const img = art.image_url || art.image;
      const pubDate = art.published_at ? new Date(art.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const source = art.source_title || 'Feed';

      let imgHtml = '';
      if (img) {
        imgHtml = `
          <td width="110" valign="top" style="padding-right: 16px;">
            <img src="${img}" alt="" width="110" height="74" style="border-radius: 8px; object-fit: cover; display: block;" />
          </td>
        `;
      }

      articleCardsHtml += `
        <tr>
          <td style="padding: 18px 0; border-bottom: 1px solid #f1f5f9;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                ${imgHtml}
                <td valign="top">
                  <div style="font-size: 11px; font-weight: 700; color: #10b981; text-transform: uppercase; margin-bottom: 4px;">
                    ${source} ${pubDate ? `• ${pubDate}` : ''}
                  </div>
                  <a href="${url}" target="_blank" style="font-size: 16px; font-weight: 700; color: #0f172a; text-decoration: none; line-height: 1.35; display: block; margin-bottom: 6px;">
                    ${title}
                  </a>
                  ${snippet ? `<p style="font-size: 13px; color: #475569; margin: 0 0 8px 0; line-height: 1.45;">${snippet}...</p>` : ''}
                  <a href="${url}" target="_blank" style="font-size: 12px; font-weight: 700; color: #0284c7; text-decoration: none;">
                    Read full article →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `;
    });
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${digestName} — FeedOmeter</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <div style="font-size: 11px; font-weight: 800; color: #10b981; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px;">
                      FEEDOMETER BRIEFING
                    </div>
                    <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin: 0 0 6px 0;">
                      ${digestName}
                    </h1>
                    <div style="color: #94a3b8; font-size: 13px;">
                      ${dateStr} • Curated for ${userName} (${count} stories)
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content List -->
          <tr>
            <td style="padding: 12px 32px 28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${articleCardsHtml}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f1f5f9; padding: 20px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748b; font-weight: 600;">
                You received this digest because you subscribed via FeedOmeter.
              </p>
              <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                FeedOmeter 2.1 • Fast, Clean Feed Intelligence Platform
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Compiles a specific digest record and updates cursor timestamps
 */
export async function executeDigestRun(env, digest) {
  const now = Date.now();
  let filterConfig = {};
  let collectionIds = [];
  try { filterConfig = JSON.parse(digest.config_json || '{}'); } catch (_) {}
  try { collectionIds = JSON.parse(digest.collection_ids || '[]'); } catch (_) {}

  // Lookback timestamp: use cursor last_article_at, or fallback to 24h / 7d
  const fallbackLookback = digest.schedule_type === 'weekly' ? now - (7 * 86400000) : now - 86400000;
  const cursorTime = digest.last_article_at && digest.last_article_at > 0 
    ? digest.last_article_at 
    : fallbackLookback;

  let query = `
    SELECT a.id, a.title, a.url, a.snippet, a.image_url, a.published_at, a.source_id,
           s.title as source_title
    FROM articles a
    LEFT JOIN sources s ON s.id = a.source_id
    WHERE a.published_at > ?
  `;
  const params = [cursorTime];

  if (collectionIds.length > 0) {
    const placeholders = collectionIds.map(() => '?').join(',');
    query += ` AND a.source_id IN (
      SELECT feed_id FROM user_feed_assignments WHERE folder_id IN (${placeholders})
    )`;
    params.push(...collectionIds);
  }

  query += ` ORDER BY a.published_at DESC LIMIT 50`;

  const articlesRes = await env.DB.prepare(query).bind(...params).all();
  let candidateArticles = articlesRes.results || [];

  // Filter against any keyword/domain rules
  if (Object.keys(filterConfig).length > 0) {
    candidateArticles = candidateArticles.filter(art => {
      const item = {
        id: art.id,
        title: art.title,
        url: art.url,
        summary: art.snippet,
        source_id: art.source_id
      };
      return evaluateArticleAgainstRule(item, filterConfig).matched;
    });
  }

  const runId = `dgr_${generateRandomHex(12)}`;
  const htmlContent = renderDigestHtml(digest.name, candidateArticles);
  let sentTo = digest.delivery_channel || 'in_app';
  let runStatus = 'completed';
  if (digest.delivery_channel === 'email') {
    const recipient = await env.DB.prepare(`SELECT u.email, u.display_name, p.email_notifications FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id WHERE u.id = ?`).bind(digest.user_id).first();
    if (!recipient || recipient.email_notifications === 0) {
      sentTo = 'email skipped (notifications disabled)';
    } else {
      const delivery = await sendTransactionalEmail(env, { to: recipient.email, subject: `${digest.name} — FeedOmeter`, text: `${digest.name}: ${candidateArticles.length} new stories.`, html: renderDigestHtml(digest.name, candidateArticles, recipient.display_name || 'FeedOmeter Reader') });
      sentTo = recipient.email;
      if (!delivery.ok) runStatus = 'failed';
    }
  }

  // Compute next run time
  const intervalMs = digest.schedule_type === 'weekly' ? 7 * 86400000 : 86400000;
  const nextRunAt = now + intervalMs;
  const latestArticleTime = candidateArticles.length > 0 
    ? Math.max(...candidateArticles.map(a => Number(a.published_at) || 0))
    : (digest.last_article_at || now);

  // Record digest run log
  await env.DB.prepare(`
    INSERT INTO digest_runs (id, digest_id, article_count, status, sent_to, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(runId, digest.id, candidateArticles.length, runStatus, sentTo, now, Date.now()).run();

  // Advance cursor & next_run_at
  await env.DB.prepare(`
    UPDATE user_digests 
    SET last_article_at = ?, last_run_at = ?, next_run_at = ?
    WHERE id = ?
  `).bind(latestArticleTime, now, nextRunAt, digest.id).run();

  return {
    runId,
    articleCount: candidateArticles.length,
    html: htmlContent
  };
}

/**
 * Process all due digests in batch
 */
export async function processDueDigests(env) {
  if (!env.DB) return { processed: 0 };
  const now = Date.now();

  try {
    const dueDigests = await env.DB.prepare(`
      SELECT id, user_id, name, schedule_type, delivery_channel, collection_ids, config_json, last_article_at, next_run_at
      FROM user_digests
      WHERE is_active = 1 AND next_run_at <= ?
      ORDER BY next_run_at ASC
      LIMIT 10
    `).bind(now).all();

    const rows = dueDigests.results || [];
    if (rows.length === 0) return { processed: 0 };

    for (const d of rows) {
      try {
        await executeDigestRun(env, d);
      } catch (err) {
        console.error(`Error running digest ${d.id}:`, err.message);
      }
    }

    return { processed: rows.length };
  } catch (err) {
    console.error('Error processing due digests:', err.message);
    return { processed: 0, error: err.message };
  }
}
