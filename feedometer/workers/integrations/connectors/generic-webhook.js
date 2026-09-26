/**
 * workers/integrations/connectors/generic-webhook.js — Generic Webhook Connector
 * Standard JSON envelope delivery with HMAC-SHA256 signature signing.
 */
import { generateHmacSignature } from '../../services/webhook-dispatcher.js';

export class GenericWebhookConnector {
  static buildAlertPayload(article, ruleName = 'Keyword Match') {
    return {
      event: 'alert.triggered',
      rule_name: ruleName,
      timestamp: new Date().toISOString(),
      article: {
        id: article.id,
        title: article.title,
        url: article.url || article.link,
        source_name: article.source_name || article.source || article.domain || '',
        published_at: article.published_at || new Date().toISOString(),
        snippet: (article.snippet || article.description || '').replace(/<[^>]+>/g, '').trim(),
        image_url: article.lead_image_url || article.image_url || ''
      }
    };
  }

  static buildDigestPayload(articles, digestName = 'Daily Intelligence Briefing', scheduleLabel = 'Daily Digest') {
    return {
      event: 'digest.batch',
      digest_name: digestName,
      schedule_label: scheduleLabel,
      timestamp: new Date().toISOString(),
      total_articles: articles.length,
      articles: articles.map(art => ({
        id: art.id,
        title: art.title,
        url: art.url || art.link,
        source_name: art.source_name || art.source || art.domain || '',
        published_at: art.published_at || new Date().toISOString(),
        snippet: (art.snippet || art.description || '').replace(/<[^>]+>/g, '').trim(),
        image_url: art.lead_image_url || art.image_url || art.image || ''
      }))
    };
  }

  static async send(webhookUrl, payload, secretKey = '') {
    const startTime = Date.now();
    const payloadStr = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'FeedOmeter-Integrations/2.1'
    };

    if (secretKey) {
      try {
        const signature = await generateHmacSignature(secretKey, payloadStr);
        headers['X-FeedOmeter-Signature'] = signature;
      } catch (_) {}
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: payloadStr
    });
    const durationMs = Date.now() - startTime;
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      durationMs
    };
  }
}
