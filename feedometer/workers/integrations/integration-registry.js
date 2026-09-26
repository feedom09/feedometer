/**
 * workers/integrations/integration-registry.js — FeedOmeter Integrations Factory Registry
 */
import { SlackConnector } from './connectors/slack.js';
import { TeamsConnector } from './connectors/teams.js';
import { GenericWebhookConnector } from './connectors/generic-webhook.js';

export const CONNECTORS = {
  slack: SlackConnector,
  teams: TeamsConnector,
  webhook: GenericWebhookConnector,
  discord: GenericWebhookConnector,
  zapier: GenericWebhookConnector,
  make: GenericWebhookConnector,
  n8n: GenericWebhookConnector
};

// These are the only connection types with a truthful configuration and
// delivery path today. Other catalog entries remain visible as future ideas,
// but cannot be connected until their provider-specific setup exists.
export const SUPPORTED_INTEGRATION_CODES = new Set(['slack', 'teams', 'webhook']);

export function isSupportedIntegration(integrationCode) {
  return SUPPORTED_INTEGRATION_CODES.has(String(integrationCode || '').toLowerCase());
}

export function getConnector(integrationCode = 'slack') {
  return CONNECTORS[integrationCode.toLowerCase()] || GenericWebhookConnector;
}

/**
 * Dispatches an alert through an integration connection
 */
export async function dispatchIntegrationAlert(connection, article, ruleName = 'Keyword Match') {
  const config = typeof connection.config_json === 'string' ? JSON.parse(connection.config_json || '{}') : (connection.config_json || {});
  const webhookUrl = config.webhookUrl || config.target_url || config.url;
  if (!webhookUrl) throw new Error('Missing webhook URL in integration configuration');

  const connector = getConnector(connection.integration_code || connection.code || 'slack');
  const payload = connector.buildAlertPayload(article, ruleName);
  return await connector.send(webhookUrl, payload, config.secretKey || '');
}

/**
 * Dispatches a digest batch through an integration connection
 */
export async function dispatchIntegrationDigest(connection, articles, digestName = 'Daily Briefing', scheduleLabel = 'Daily Digest') {
  const config = typeof connection.config_json === 'string' ? JSON.parse(connection.config_json || '{}') : (connection.config_json || {});
  const webhookUrl = config.webhookUrl || config.target_url || config.url;
  if (!webhookUrl) throw new Error('Missing webhook URL in integration configuration');

  const connector = getConnector(connection.integration_code || connection.code || 'slack');
  const payload = connector.buildDigestPayload(articles, digestName, scheduleLabel);
  return await connector.send(webhookUrl, payload, config.secretKey || '');
}

/**
 * Sends a live test ping payload through an integration connection
 */
export async function dispatchIntegrationTestPing(integrationCode, webhookUrl, connectionName = 'Test Channel') {
  const sampleArticle = {
    id: 'sample-001',
    title: 'FeedOmeter Integration Connected Successfully! 🎉',
    url: 'https://feedometer.com',
    source_name: 'FeedOmeter Intelligence',
    snippet: `Your FeedOmeter integration with ${connectionName} is active and verified. Real-time alerts and scheduled digests will be delivered here automatically.`,
    lead_image_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop',
    published_at: Date.now()
  };

  const connector = getConnector(integrationCode);
  const payload = connector.buildAlertPayload(sampleArticle, 'Connection Test');
  return await connector.send(webhookUrl, payload);
}
