/**
 * workers/integrations/connectors/teams.js — Microsoft Teams Connector
 * Native Adaptive Card 1.5 generation for Power Automate Workflow webhooks.
 */

export class TeamsConnector {
  /**
   * Builds Teams Adaptive Card 1.5 for an instant alert
   */
  static buildAlertPayload(article, ruleName = 'Keyword Match') {
    const title = article.title || 'Untitled Article';
    const url = article.url || article.link || 'https://feedometer.com';
    const source = article.source_name || article.source || article.domain || 'FeedOmeter Intelligence';
    const snippet = (article.snippet || article.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 240);
    const img = article.lead_image_url || article.image_url || article.image || '';
    const pubDate = article.published_at ? new Date(article.published_at).toLocaleString() : new Date().toLocaleString();

    const cardBody = [
      {
        type: 'TextBlock',
        text: `⚡ Feed Alert: ${ruleName}`,
        weight: 'Bolder',
        size: 'Medium',
        color: 'Accent'
      },
      {
        type: 'TextBlock',
        text: title,
        weight: 'Bolder',
        size: 'Large',
        wrap: true
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Source:', value: source },
          { title: 'Published:', value: pubDate }
        ]
      }
    ];

    if (snippet) {
      cardBody.push({
        type: 'TextBlock',
        text: snippet,
        wrap: true,
        spacing: 'Small'
      });
    }

    if (img && (img.startsWith('http://') || img.startsWith('https://'))) {
      cardBody.push({
        type: 'Image',
        url: img,
        size: 'Large',
        altText: 'article thumbnail'
      });
    }

    const adaptiveCard = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.5',
            body: cardBody,
            actions: [
              {
                type: 'Action.OpenUrl',
                title: '📖 Read Full Story',
                url: url
              }
            ]
          }
        }
      ]
    };

    return adaptiveCard;
  }

  /**
   * Builds Teams Adaptive Card 1.5 for a scheduled digest batch
   */
  static buildDigestPayload(articles, digestName = 'Daily Intelligence Briefing', scheduleLabel = 'Daily Digest') {
    const count = articles.length;
    const cardBody = [
      {
        type: 'TextBlock',
        text: `📰 ${digestName}`,
        weight: 'Bolder',
        size: 'Large',
        color: 'Accent'
      },
      {
        type: 'TextBlock',
        text: `Schedule: ${scheduleLabel} • ${count} articles curated by FeedOmeter`,
        isSubtle: true,
        size: 'Small',
        spacing: 'None'
      }
    ];

    if (count === 0) {
      cardBody.push({
        type: 'TextBlock',
        text: '_No new matching articles syndicated during this digest period._',
        isSubtle: true,
        wrap: true,
        spacing: 'Medium'
      });
    } else {
      // Top 8 articles for Teams card height optimization
      const displayList = articles.slice(0, 8);
      displayList.forEach((art, idx) => {
        const title = art.title || 'Untitled Article';
        const url = art.url || art.link || 'https://feedometer.com';
        const source = art.source_name || art.source || art.domain || 'Feed';
        const snippet = (art.description || art.snippet || '').replace(/<[^>]+>/g, '').trim().slice(0, 120);

        cardBody.push({
          type: 'Container',
          separator: true,
          spacing: 'Medium',
          items: [
            {
              type: 'TextBlock',
              text: `**${idx + 1}. [${title}](${url})**`,
              wrap: true,
              size: 'Medium'
            },
            {
              type: 'TextBlock',
              text: `${source} • ${snippet ? `${snippet}...` : ''}`,
              isSubtle: true,
              wrap: true,
              size: 'Small',
              spacing: 'None'
            }
          ]
        });
      });

      if (articles.length > 8) {
        cardBody.push({
          type: 'TextBlock',
          text: `_...and ${articles.length - 8} more articles matching your filters._`,
          isSubtle: true,
          wrap: true,
          spacing: 'Small'
        });
      }
    }

    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.5',
            body: cardBody,
            actions: [
              {
                type: 'Action.OpenUrl',
                title: '⚡ Open FeedOmeter Dashboard',
                url: 'https://feedometer.com'
              }
            ]
          }
        }
      ]
    };
  }

  /**
   * Dispatches payload to target Teams webhook URL
   */
  static async send(webhookUrl, payload) {
    const startTime = Date.now();
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
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
