/**
 * scripts/feedometer-integrations.js — FeedOmeter Integrations Marketplace Controller
 */
(function (global) {
  'use strict';

  const DEFAULT_CATALOG = [
    { id: 'int_slack', code: 'slack', name: 'Slack', category: 'communication', icon: '💬', description: 'Deliver real-time breaking alerts and scheduled daily briefings natively into your Slack channels using Block Kit cards.', badge: 'Popular', setup_type: 'webhook', available: true },
    { id: 'int_teams', code: 'teams', name: 'Microsoft Teams', category: 'communication', icon: '🟣', description: 'Send interactive Adaptive Cards to your Microsoft Teams channels via Power Automate Workflow webhooks.', badge: 'Popular', setup_type: 'webhook', available: true },
    { id: 'int_discord', code: 'discord', name: 'Discord', category: 'communication', icon: '🎮', description: 'Post rich news embeds directly into community servers and announcement channels.', badge: 'Coming Soon', setup_type: 'webhook', available: false },
    { id: 'int_telegram', code: 'telegram', name: 'Telegram', category: 'communication', icon: '✈️', description: 'Broadcast filtered feed matches and executive summaries to Telegram channels and bots.', badge: 'Coming Soon', setup_type: 'bot', available: false },
    { id: 'int_zapier', code: 'zapier', name: 'Zapier', category: 'automation', icon: '⚡', description: 'Connect FeedOmeter triggers to 5,000+ apps and trigger multi-step Zaps on new stories.', badge: 'Coming Soon', setup_type: 'api_key', available: false },
    { id: 'int_make', code: 'make', name: 'Make (Integromat)', category: 'automation', icon: '🟣', description: 'Build visual automation scenarios connecting FeedOmeter syndicated articles to your CRM or data lake.', badge: 'Coming Soon', setup_type: 'api_key', available: false },
    { id: 'int_n8n', code: 'n8n', name: 'n8n', category: 'automation', icon: '🔄', description: 'Fair-code workflow automation tool. Ingest FeedOmeter payloads into self-hosted nodes.', badge: 'Coming Soon', setup_type: 'webhook', available: false },
    { id: 'int_notion', code: 'notion', name: 'Notion', category: 'productivity', icon: '📝', description: 'Automatically append matched intelligence articles and summaries into your team Notion databases.', badge: 'Coming Soon', setup_type: 'oauth', available: false },
    { id: 'int_airtable', code: 'airtable', name: 'Airtable', category: 'productivity', icon: '📊', description: 'Sync structured feed records, sentiment tags, and metadata into Airtable bases.', badge: 'Coming Soon', setup_type: 'api_key', available: false },
    { id: 'int_webhook', code: 'webhook', name: 'Custom Webhook', category: 'developer', icon: '⚡', description: 'Deliver signed HMAC-SHA256 JSON payloads directly to your custom HTTP POST backend endpoints.', badge: 'Developer', setup_type: 'webhook', available: true },
    { id: 'int_api', code: 'api', name: 'FeedOmeter REST API', category: 'developer', icon: '🔑', description: 'Full REST API access to search catalog, poll sources, and fetch structured articles programmatically.', badge: 'Developer', setup_type: 'api_key', available: true }
  ];

  const state = {
    catalog: [...DEFAULT_CATALOG],
    connections: [],
    activeTab: 'marketplace',
    activeIntCode: 'slack'
  };

  const INTEGRATION_ICONS = {
    slack: '<svg viewBox="0 0 128 128" width="28" height="28" fill="none"><path d="M26.7 80.8a13.3 13.3 0 1 1-13.4-13.3h13.4v13.3zm6.8 0a13.3 13.3 0 0 1 26.6 0v33.4a13.3 13.3 0 0 1-26.6 0V80.8z" fill="#E01E5A"/><path d="M47.2 26.7a13.3 13.3 0 1 1 13.3-13.4v13.4H47.2zm0 6.8a13.3 13.3 0 0 1 0 26.6H13.8a13.3 13.3 0 0 1 0-26.6h33.4z" fill="#36C5F0"/><path d="M101.3 47.2a13.3 13.3 0 1 1 13.4 13.3h-13.4V47.2zm-6.8 0a13.3 13.3 0 0 1-26.6 0V13.8a13.3 13.3 0 0 1 26.6 0v33.4z" fill="#2EB67D"/><path d="M80.8 101.3a13.3 13.3 0 1 1-13.3 13.4v-13.4h13.3zm0-6.8a13.3 13.3 0 0 1 0-26.6h33.4a13.3 13.3 0 0 1 0 26.6H80.8z" fill="#ECB22E"/></svg>',
    teams: '<svg viewBox="0 0 48 48" width="28" height="28" fill="none"><circle cx="34" cy="14" r="5" fill="#505AC9"/><path d="M29 20h10a3 3 0 0 1 3 3v11h-13V20z" fill="#505AC9"/><circle cx="20" cy="11" r="6.5" fill="#7B83EB"/><path d="M6 20a3 3 0 0 1 3-3h22a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V20z" fill="#7B83EB"/><path d="M14 24h12v3.5h-4.2V35h-3.6V27.5H14V24z" fill="#FFFFFF"/></svg>',
    discord: '<svg viewBox="0 0 127.14 96.36" width="28" height="28" fill="#5865F2"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1,105.25,105.25,0,0,0,32.19-16.14c2.64-27.38-4.51-51.11-18.85-72.15ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>',
    telegram: '<svg viewBox="0 0 240 240" width="28" height="28"><circle cx="120" cy="120" r="120" fill="#229ED9"/><path d="M178.6 67.2L42.5 119.7c-9.3 3.7-9.2 8.9-1.7 11.2l34.9 10.9 80.8-51c3.8-2.3 7.3-1.1 4.4 1.5l-65.5 59.1-2.4 36.3c3.6 0 5.2-1.6 7.2-3.6l17.3-16.8 36 26.6c6.6 3.7 11.4 1.8 13.1-6.1l23.7-111.7c2.4-9.8-3.7-14.2-11.7-11z" fill="#ffffff"/></svg>',
    zapier: '<svg viewBox="0 0 100 100" width="28" height="28"><rect width="100" height="100" rx="20" fill="#FF4F00"/><path d="M50 18v64M18 50h64M27.4 27.4l45.2 45.2M27.4 72.6l45.2-45.2" stroke="#ffffff" stroke-width="12" stroke-linecap="round"/></svg>',
    make: '<svg viewBox="0 0 100 100" width="28" height="28"><rect width="100" height="100" rx="20" fill="#6D00CC"/><path d="M22 68V32l16 20 16-20v36M78 68V32L62 52" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
    n8n: '<svg viewBox="0 0 100 100" width="28" height="28"><rect width="100" height="100" rx="20" fill="#EA4B71"/><circle cx="28" cy="38" r="8" fill="#ffffff"/><circle cx="72" cy="38" r="8" fill="#ffffff"/><circle cx="50" cy="66" r="8" fill="#ffffff"/><path d="M33 42l13 20M67 42L54 62M36 38h28" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/></svg>',
    notion: '<svg viewBox="0 0 100 100" width="28" height="28"><rect width="100" height="100" rx="20" fill="#000000"/><path fill="#ffffff" d="M26 24l43.5 5.5c2.5.3 3.5 1.5 3.5 3.8v40c0 2.2-1.2 3.4-3.5 3.4L26 73.5c-2.4 0-3.5-1.2-3.5-3.4V27.4c0-2.2 1.1-3.4 3.5-3.4zm9 12.2v29.5h5.8V49.2l17.8 17.7h5.8V37.4h-5.8v18.2L39.8 36.2H35z"/></svg>',
    airtable: '<svg viewBox="0 0 100 100" width="28" height="28"><rect width="100" height="100" rx="20" fill="#F8FAFC"/><path d="M48 20L20 34c-1.1.5-1.1 2.1 0 2.6L48 50c.6.3 1.4.3 2 0l28-13.4c1.1-.5 1.1-2.1 0-2.6L50 20c-.6-.3-1.4-.3-2 0z" fill="#FCB400"/><path d="M53 54l25-12.7c.9-.5 2 .2 2 1.2v25.2c0 .8-.5 1.6-1.2 1.9L53.8 82c-.9.4-1.8-.2-1.8-1.1V55.2c0-.6.4-1.1 1-1.2z" fill="#18BFFF"/><path d="M45 54v26.9c0 .9-.9 1.5-1.8 1.1L18.2 69.6c-.7-.3-1.2-1.1-1.2-1.9V42.5c0-1 1.1-1.7 2-1.2l25 12.7c.6 0 1 .5 1 1z" fill="#F82B60"/></svg>',
    webhook: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c0-2.21 1.79-4 4-4h1"/><path d="M6 7.02h5.99c1.1 0 1.95-.94 2.48-1.9A4 4 0 0 1 22 7c0 2.21-1.79 4-4 4h-1"/><circle cx="6" cy="17" r="2.5" fill="#0ea5e9"/><circle cx="18" cy="7" r="2.5" fill="#0ea5e9"/></svg>',
    api: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="4" stroke="#10b981" fill="#ecfdf5" fill-opacity="0.6"/><path d="M7 10l3 3-3 3M13 16h4"/></svg>'
  };

  function getIntegrationIcon(code, fallback = '🔌') {
    return INTEGRATION_ICONS[code] || fallback;
  }

  function getApiBase() {
    return (global.FEEDOMETER_CONFIG && global.FEEDOMETER_CONFIG.API_BASE) || 'https://feedometer-api.feedometer.workers.dev';
  }

  function getAuthHeader() {
    const token = global.FeedOmeterAuth ? global.FeedOmeterAuth.getToken() : null;
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  function showToast(msg, isError = false) {
    const toast = document.getElementById('int-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = isError ? 'show toast-error' : 'show';
    setTimeout(() => {
      toast.className = '';
    }, 3500);
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(`${getApiBase()}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
        ...(options.headers || {})
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'API request failed');
    return data;
  }

  async function init() {
    setupTabs();
    setupModal();
    setupWebhookDevModal();
    setupRestApiModal();
    renderCatalog();
    await loadAllData();
  }

  function setupTabs() {
    document.querySelectorAll('.pill-tab[data-tab]').forEach(tabBtn => {
      tabBtn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        state.activeTab = tab;
        document.querySelectorAll('.pill-tab[data-tab]').forEach(b => b.classList.toggle('active', b === e.currentTarget));
        const marketPane = document.getElementById('tab-marketplace');
        const connPane = document.getElementById('tab-connected');
        if (marketPane) marketPane.style.display = tab === 'marketplace' ? 'block' : 'none';
        if (connPane) connPane.style.display = tab === 'connected' ? 'block' : 'none';
      });
    });
  }

  function setupModal() {
    const modal = document.getElementById('modal-connect');
    const btnClose = document.getElementById('btn-close-modal');
    const btnCancel = document.getElementById('btn-cancel-modal');
    const form = document.getElementById('form-connect');
    const btnPing = document.getElementById('btn-ping-test');

    const closeModal = () => {
      if (modal) modal.hidden = true;
      if (form) form.reset();
    };

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    // Live Test Ping in Modal
    if (btnPing) {
      btnPing.addEventListener('click', async () => {
        const code = document.getElementById('form-int-code').value;
        const url = document.getElementById('int-url').value.trim();
        const channel = document.getElementById('int-channel').value.trim();

        if (!url) {
          showToast('Please enter a valid Webhook URL to test', true);
          return;
        }

        btnPing.disabled = true;
        btnPing.textContent = 'Sending Card...';

        try {
          const res = await apiFetch('/api/integrations/test-direct', {
            method: 'POST',
            body: JSON.stringify({
              integration_code: code,
              webhookUrl: url,
              channel: channel || 'Test Channel'
            })
          });

          const r = res.result;
          if (r.ok) {
            showToast(`✅ Test card delivered to ${code.toUpperCase()} in ${r.durationMs}ms!`);
          } else {
            showToast(`⚠️ Delivery error HTTP ${r.status} (${r.statusText})`, true);
          }
        } catch (err) {
          showToast(`Ping failed: ${err.message}`, true);
        } finally {
          btnPing.disabled = false;
          btnPing.textContent = '⚡ Send Test Card to Channel';
        }
      });
    }

    // Submit Connection Form
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('form-int-code').value;
        const name = document.getElementById('int-name').value.trim();
        const url = document.getElementById('int-url').value.trim();
        const channel = document.getElementById('int-channel').value.trim();
        const keywords = document.getElementById('int-keywords').value.trim();

        const btnSave = document.getElementById('btn-save-conn');
        if (btnSave) {
          btnSave.disabled = true;
          btnSave.textContent = 'Connecting...';
        }

        try {
          await apiFetch('/api/integrations', {
            method: 'POST',
            body: JSON.stringify({
              integration_code: code,
              name,
              config: {
                webhookUrl: url,
                channel,
                keywords: keywords ? keywords.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : []
              }
            })
          });

          showToast(`🎉 ${name} connected successfully!`);
          closeModal();
          await loadAllData();
        } catch (err) {
          showToast(err.message, true);
        } finally {
          if (btnSave) {
            btnSave.disabled = false;
            btnSave.textContent = 'Save & Activate';
          }
        }
      });
    }
  }

  // --- CUSTOM WEBHOOK DEVELOPER MODAL ---
  let currentWhSecret = '';
  let currentWhLang = 'python';

  function setupWebhookDevModal() {
    const modal = document.getElementById('modal-webhook-dev');
    const btnClose = document.getElementById('btn-close-webhook-modal');
    const btnCancel = document.getElementById('btn-cancel-webhook-modal');
    const btnCopySecret = document.getElementById('btn-copy-wh-secret');
    const btnPing = document.getElementById('btn-ping-webhook-test');
    const form = document.getElementById('form-webhook-dev');

    const closeModal = () => { if (modal) modal.hidden = true; };
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    if (btnCopySecret) {
      btnCopySecret.addEventListener('click', () => {
        if (!currentWhSecret) {
          showToast('Save the webhook first to receive its signing secret.', true);
          return;
        }
        navigator.clipboard.writeText(currentWhSecret).then(() => {
          showToast('📋 Webhook secret copied to clipboard!');
        });
      });
    }

    document.querySelectorAll('[data-wh-lang]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        currentWhLang = e.currentTarget.getAttribute('data-wh-lang');
        document.querySelectorAll('[data-wh-lang]').forEach(b => b.classList.toggle('active', b === e.currentTarget));
        updateWebhookCodeSnippet();
      });
    });

    if (btnPing) {
      btnPing.addEventListener('click', async () => {
        const url = document.getElementById('wh-url').value.trim();
        const badge = document.getElementById('wh-ping-status-badge');
        if (!url) {
          showToast('Please enter an endpoint URL to test', true);
          return;
        }

        btnPing.disabled = true;
        btnPing.textContent = 'Testing Endpoint...';
        if (badge) { badge.textContent = 'Pinging...'; badge.style.background = '#e2e8f0'; }

        try {
          const res = await apiFetch('/api/webhooks/test', {
            method: 'POST',
            body: JSON.stringify({
              target_url: url
            })
          });

          const r = res.result || {};
          if (r.ok) {
            showToast(`✅ Webhook delivered (HTTP ${r.status}) in ${r.durationMs}ms!`);
            if (badge) {
              badge.textContent = `200 OK (${r.durationMs}ms)`;
              badge.style.background = '#ecfdf5';
              badge.style.color = '#047857';
            }
          } else {
            showToast(`⚠️ Delivery returned HTTP ${r.status}`, true);
            if (badge) {
              badge.textContent = `HTTP ${r.status} Error`;
              badge.style.background = '#fef2f2';
              badge.style.color = '#b91c1c';
            }
          }
        } catch (err) {
          showToast(`Ping failed: ${err.message}`, true);
          if (badge) {
            badge.textContent = 'Failed';
            badge.style.background = '#fef2f2';
            badge.style.color = '#b91c1c';
          }
        } finally {
          btnPing.disabled = false;
          btnPing.textContent = '⚡ Test Endpoint Delivery';
        }
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('wh-name').value.trim();
        const url = document.getElementById('wh-url').value.trim();
        const btnSave = document.getElementById('btn-save-webhook-conn');

        btnSave.disabled = true;
        btnSave.textContent = 'Saving...';

        try {
          const res = await apiFetch('/api/webhooks', {
            method: 'POST',
            body: JSON.stringify({
              name,
              target_url: url,
              cadence: 'realtime'
            })
          });

          currentWhSecret = res.webhook && res.webhook.secret_key ? res.webhook.secret_key : '';
          const secretField = document.getElementById('wh-secret');
          const reveal = document.getElementById('wh-secret-reveal');
          if (secretField && currentWhSecret) secretField.value = currentWhSecret;
          if (reveal) reveal.hidden = !currentWhSecret;
          updateWebhookCodeSnippet();
          showToast(`Webhook '${name}' saved. Copy the signing secret now.`);
          await loadAllData();
        } catch (err) {
          showToast(err.message, true);
        } finally {
          btnSave.disabled = false;
          btnSave.textContent = 'Save Webhook';
        }
      });
    }
  }

  function updateWebhookCodeSnippet() {
    const el = document.getElementById('wh-code-snippet');
    if (!el) return;

    if (currentWhLang === 'python') {
      el.textContent = `import hmac, hashlib

def verify_feedometer_signature(payload_bytes, signature_header):
    secret = "${currentWhSecret}"
    expected = hmac.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)`;
    } else {
      el.textContent = `const crypto = require('crypto');

function verifyFeedometerSignature(rawBodyBuffer, signatureHeader) {
  const secret = '${currentWhSecret}';
  const expected = crypto.createHmac('sha256', secret).update(rawBodyBuffer).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}`;
    }
  }

  function openCustomWebhookModal(item) {
    const modal = document.getElementById('modal-webhook-dev');
    if (!modal) return;
    currentWhSecret = '';
    const secretField = document.getElementById('wh-secret');
    const reveal = document.getElementById('wh-secret-reveal');
    if (secretField) secretField.value = '';
    if (reveal) reveal.hidden = true;
    document.getElementById('wh-name').value = 'Custom HTTP Endpoint';
    document.getElementById('wh-url').value = '';
    const badge = document.getElementById('wh-ping-status-badge');
    if (badge) { badge.textContent = 'Ready'; badge.style.background = '#e2e8f0'; badge.style.color = '#475569'; }
    updateWebhookCodeSnippet();
    modal.hidden = false;
  }

  // --- REST API DEVELOPER MODAL & EXPLORER ---
  let userApiKeys = [];
  let currentSnippetLang = 'curl';
  let currentSnippetEndpoint = 'articles';

  function setupRestApiModal() {
    const modal = document.getElementById('modal-api-dev');
    const btnClose = document.getElementById('btn-close-api-modal');
    const btnCloseFooter = document.getElementById('btn-close-api-modal-footer');
    const btnShowCreate = document.getElementById('btn-show-create-key');
    const btnCancelCreate = document.getElementById('btn-cancel-create-key');
    const btnSubmitCreate = document.getElementById('btn-submit-create-key');
    const btnCopyRevealed = document.getElementById('btn-copy-revealed-key');
    const btnCopySnippet = document.getElementById('btn-copy-api-snippet');
    const btnRunExplorer = document.getElementById('btn-run-explorer');
    const endpointSelect = document.getElementById('snippet-endpoint-select');

    const closeModal = () => { if (modal) modal.hidden = true; };
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeModal);

    // API Modal Tabs
    document.querySelectorAll('[data-api-tab]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-api-tab');
        document.querySelectorAll('[data-api-tab]').forEach(b => b.classList.toggle('active', b === e.currentTarget));
        document.getElementById('api-pane-keys').style.display = tab === 'keys' ? 'block' : 'none';
        document.getElementById('api-pane-snippets').style.display = tab === 'snippets' ? 'block' : 'none';
        document.getElementById('api-pane-explorer').style.display = tab === 'explorer' ? 'block' : 'none';
      });
    });

    if (btnShowCreate) {
      btnShowCreate.addEventListener('click', () => {
        document.getElementById('box-create-key').style.display = 'block';
        document.getElementById('new-key-name').focus();
      });
    }

    if (btnCancelCreate) {
      btnCancelCreate.addEventListener('click', () => {
        document.getElementById('box-create-key').style.display = 'none';
      });
    }

    if (btnSubmitCreate) {
      btnSubmitCreate.addEventListener('click', async () => {
        const name = document.getElementById('new-key-name').value.trim() || 'API Key';
        const expiryDays = parseInt(document.getElementById('new-key-expiry').value, 10);

        btnSubmitCreate.disabled = true;
        btnSubmitCreate.textContent = 'Generating...';

        try {
          const res = await apiFetch('/api/developer/keys', {
            method: 'POST',
            body: JSON.stringify({
              name,
              expires_in_days: expiryDays > 0 ? expiryDays : null
            })
          });

          showToast('🎉 API Key generated successfully!');
          document.getElementById('box-create-key').style.display = 'none';
          document.getElementById('new-key-name').value = '';

          // Reveal token
          const revealBox = document.getElementById('box-key-reveal');
          const revealInput = document.getElementById('revealed-key-value');
          if (revealBox && revealInput) {
            revealInput.value = res.key.secret_token;
            revealBox.style.display = 'block';
          }

          await loadApiKeys();
          updateApiCodeSnippet();
        } catch (err) {
          showToast(`Key creation failed: ${err.message}`, true);
        } finally {
          btnSubmitCreate.disabled = false;
          btnSubmitCreate.textContent = 'Generate Key';
        }
      });
    }

    if (btnCopyRevealed) {
      btnCopyRevealed.addEventListener('click', () => {
        const val = document.getElementById('revealed-key-value').value;
        navigator.clipboard.writeText(val).then(() => {
          showToast('📋 Secret API Key copied to clipboard!');
        });
      });
    }

    // Snippet Selectors
    if (endpointSelect) {
      endpointSelect.addEventListener('change', (e) => {
        currentSnippetEndpoint = e.target.value;
        updateApiCodeSnippet();
      });
    }

    document.querySelectorAll('[data-snip-lang]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        currentSnippetLang = e.currentTarget.getAttribute('data-snip-lang');
        document.querySelectorAll('[data-snip-lang]').forEach(b => b.classList.toggle('active', b === e.currentTarget));
        updateApiCodeSnippet();
      });
    });

    if (btnCopySnippet) {
      btnCopySnippet.addEventListener('click', () => {
        const code = document.getElementById('api-code-snippet').textContent;
        navigator.clipboard.writeText(code).then(() => {
          showToast('📋 Code snippet copied to clipboard!');
        });
      });
    }

    // Live Explorer
    if (btnRunExplorer) {
      btnRunExplorer.addEventListener('click', async () => {
        const path = document.getElementById('explorer-path').value.trim();
        const outputEl = document.getElementById('explorer-output');
        const badge = document.getElementById('explorer-status-badge');

        btnRunExplorer.disabled = true;
        btnRunExplorer.textContent = 'Executing...';
        if (badge) { badge.textContent = 'Running...'; badge.style.background = '#e2e8f0'; }

        const startTime = Date.now();
        try {
          const res = await apiFetch(path);
          const duration = Date.now() - startTime;
          outputEl.textContent = JSON.stringify(res, null, 2);
          if (badge) {
            badge.textContent = `200 OK (${duration}ms)`;
            badge.style.background = '#ecfdf5';
            badge.style.color = '#047857';
          }
        } catch (err) {
          const duration = Date.now() - startTime;
          outputEl.textContent = JSON.stringify({ error: err.message }, null, 2);
          if (badge) {
            badge.textContent = `Error (${duration}ms)`;
            badge.style.background = '#fef2f2';
            badge.style.color = '#b91c1c';
          }
        } finally {
          btnRunExplorer.disabled = false;
          btnRunExplorer.textContent = '▶ Run Query';
        }
      });
    }
  }

  async function loadApiKeys() {
    const listEl = document.getElementById('api-keys-list');
    if (!listEl) return;

    try {
      const res = await apiFetch('/api/developer/keys');
      userApiKeys = res.keys || [];

      if (userApiKeys.length === 0) {
        listEl.innerHTML = `
          <div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;padding:1.5rem;text-align:center;color:#64748b;font-size:0.85rem;">
            No API keys created yet. Click "+ Create API Key" above to generate your first key.
          </div>
        `;
        return;
      }

      listEl.innerHTML = userApiKeys.map(k => {
        const expiryLabel = k.expires_at ? (k.is_expired ? 'Expired' : `Expires ${new Date(k.expires_at).toLocaleDateString()}`) : 'Never expires';
        return `
          <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:0.85rem 1rem;margin-bottom:0.6rem;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:750;font-size:0.9rem;color:#0f172a;margin-bottom:0.15rem;">${k.name}</div>
              <div style="font-family:monospace;font-size:0.82rem;color:#475569;">${k.masked_key}</div>
              <div style="font-size:0.75rem;color:#94a3b8;margin-top:0.25rem;">
                Created on ${new Date(k.created_at).toLocaleDateString()} • <span style="${k.is_expired ? 'color:#dc2626;font-weight:700;' : ''}">${expiryLabel}</span>
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-danger btn-revoke-key" data-key-id="${k.id}">
              <span>Revoke</span>
            </button>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.btn-revoke-key').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-key-id');
          if (confirm('Are you sure you want to revoke this API key? Any applications using it will immediately lose access.')) {
            try {
              await apiFetch(`/api/developer/keys/${id}`, { method: 'DELETE' });
              showToast('API Key revoked');
              await loadApiKeys();
              updateApiCodeSnippet();
            } catch (err) {
              showToast(`Revocation error: ${err.message}`, true);
            }
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = `<div style="color:#dc2626;font-size:0.85rem;">Failed to load API keys: ${err.message}</div>`;
    }
  }

  function updateApiCodeSnippet() {
    const el = document.getElementById('api-code-snippet');
    if (!el) return;

    const keyToken = userApiKeys.length > 0 ? `${userApiKeys[0].key_prefix}...${userApiKeys[0].key_suffix}` : 'fom_live_your_api_key_here';
    const baseUrl = getApiBase();

    let endpointPath = '/api/v1/articles?limit=10';
    if (currentSnippetEndpoint === 'search') endpointPath = '/api/v1/search?q=artificial+intelligence&limit=10';
    if (currentSnippetEndpoint === 'sources') endpointPath = '/api/v1/sources?category=technology';
    if (currentSnippetEndpoint === 'subscriptions') endpointPath = '/api/v1/me/subscriptions';
    if (currentSnippetEndpoint === 'opml') endpointPath = '/api/v1/me/opml';

    if (currentSnippetLang === 'curl') {
      el.textContent = `curl -X GET "${baseUrl}${endpointPath}" \\
  -H "Authorization: Bearer ${keyToken}" \\
  -H "Accept: application/json"`;
    } else if (currentSnippetLang === 'python') {
      el.textContent = `import requests

url = "${baseUrl}${endpointPath}"
headers = {
    "Authorization": "Bearer ${keyToken}",
    "Accept": "application/json"
}

response = requests.get(url, headers=headers)
data = response.json()
print(f"Status: {response.status_code}")
print(data)`;
    } else {
      el.textContent = `const url = '${baseUrl}${endpointPath}';

const response = await fetch(url, {
  headers: {
    'Authorization': 'Bearer ${keyToken}',
    'Accept': 'application/json'
  }
});

const data = await response.json();
console.log(data);`;
    }
  }

  function openRestApiModal(item) {
    const modal = document.getElementById('modal-api-dev');
    if (!modal) return;
    modal.hidden = false;
    loadApiKeys();
    updateApiCodeSnippet();
  }

  function openConnectModal(item) {
    if (item.available !== true) {
      showToast(`${item.name} is not available yet.`, true);
      return;
    }
    if (item.code === 'webhook') {
      openCustomWebhookModal(item);
      return;
    }
    if (item.code === 'api') {
      openRestApiModal(item);
      return;
    }

    const modal = document.getElementById('modal-connect');
    const titleEl = document.getElementById('modal-int-title');
    const codeEl = document.getElementById('form-int-code');
    const nameInput = document.getElementById('int-name');
    const urlInput = document.getElementById('int-url');
    const lblUrl = document.getElementById('lbl-webhook-url');
    const hintUrl = document.getElementById('hint-webhook-url');

    codeEl.value = item.code;
    nameInput.value = `${item.name} Channel`;
    const iconSvg = getIntegrationIcon(item.code, item.icon || '🔌');
    titleEl.innerHTML = `<span style="display:inline-flex;align-items:center;margin-right:0.35rem;">${iconSvg}</span> Connect ${item.name}`;

    if (item.code === 'teams') {
      lblUrl.textContent = 'Power Automate / Workflow URL';
      urlInput.placeholder = 'https://prod-XX.logic.azure.com:443/workflows/...';
      hintUrl.textContent = 'Paste your Microsoft Teams incoming webhook workflow URL.';
    } else if (item.code === 'slack') {
      lblUrl.textContent = 'Slack Incoming Webhook URL';
      urlInput.placeholder = 'https://hooks.slack.com/services/...';
      hintUrl.textContent = 'Create an Incoming Webhook in your Slack App and paste URL here.';
    } else {
      lblUrl.textContent = 'HTTP POST Webhook Endpoint';
      urlInput.placeholder = 'https://api.domain.com/webhook';
      hintUrl.textContent = 'Target endpoint will receive signed HMAC-SHA256 JSON payloads.';
    }

    modal.hidden = false;
  }

  async function loadAllData() {
    try {
      const [catRes, conRes] = await Promise.all([
        apiFetch('/api/integrations/catalog').catch(() => ({ catalog: [] })),
        apiFetch('/api/integrations').catch(() => ({ connections: [] }))
      ]);

      state.catalog = (catRes.catalog && catRes.catalog.length > 0) ? catRes.catalog : DEFAULT_CATALOG;
      state.connections = conRes.connections || [];

      renderCatalog();
      renderConnected();
    } catch (err) {
      state.catalog = DEFAULT_CATALOG;
      renderCatalog();
      renderConnected();
      console.warn('Fallback to default catalog:', err.message);
    }
  }

  function renderCatalog() {
    const categoryContainers = {
      communication: document.getElementById('grid-communication'),
      automation: document.getElementById('grid-automation'),
      productivity: document.getElementById('grid-productivity'),
      developer: document.getElementById('grid-developer')
    };

    // Group catalog items by category
    const grouped = {};
    state.catalog.forEach(item => {
      const cat = item.category || 'developer';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    });

    // Check connected items map
    const connectedCodes = new Set(state.connections.map(c => c.integration_code));

    for (const [cat, container] of Object.entries(categoryContainers)) {
      if (!container) continue;
      const items = grouped[cat] || [];
      if (items.length === 0) {
        container.innerHTML = '<div style="color:#94a3b8;font-size:0.85rem;">No integrations available in this category.</div>';
        continue;
      }

      container.innerHTML = items.map(item => {
        const isConnected = connectedCodes.has(item.code);
        let badgeHtml = '';
        if (isConnected) {
          badgeHtml = `<span class="badge-tag badge-connected">Connected</span>`;
        } else if (item.badge === 'Popular') {
          badgeHtml = `<span class="badge-tag badge-popular">Popular</span>`;
        } else if (item.badge === 'Coming Soon') {
          badgeHtml = `<span class="badge-tag badge-soon">Coming Soon</span>`;
        } else if (item.badge) {
          badgeHtml = `<span class="badge-tag badge-dev">${item.badge}</span>`;
        }

        const isReady = item.available === true;
        const iconSvg = getIntegrationIcon(item.code, item.icon || '🔌');

        return `
          <div class="market-card">
            <div>
              <div class="market-card-head">
                <div class="market-card-icon">${iconSvg}</div>
                <div class="market-card-title-group">
                  <div class="market-card-title">
                    <span>${item.name}</span>
                    ${badgeHtml}
                  </div>
                  <div class="market-card-desc">${item.description}</div>
                </div>
              </div>
            </div>
            <div class="market-card-meta">
              <span style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;font-weight:700;">${item.setup_type}</span>
              ${isReady
                ? `<button type="button" class="btn btn-sm ${isConnected ? '' : 'btn-primary'} btn-connect-item" data-code="${item.code}">
                     <span>${isConnected ? '⚙️ Add Another' : '+ Connect'}</span>
                   </button>`
                : `<button type="button" class="btn btn-sm" disabled style="opacity:0.6;cursor:not-allowed;">Coming Soon</button>`
              }
            </div>
          </div>
        `;
      }).join('');

      container.querySelectorAll('.btn-connect-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const code = e.currentTarget.getAttribute('data-code');
          const item = state.catalog.find(c => c.code === code);
          if (item) openConnectModal(item);
        });
      });
    }
  }

  function renderConnected() {
    const listEl = document.getElementById('connected-list');
    const badgeEl = document.getElementById('connected-count-badge');
    if (badgeEl) badgeEl.textContent = state.connections.length;

    if (!listEl) return;

    if (state.connections.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🔌</div>
          <h3 style="color:#0f172a;font-weight:750;margin-bottom:0.35rem;">No Integrations Connected Yet</h3>
          <p style="font-size:0.9rem;">Browse the marketplace catalog to connect Slack channels, Microsoft Teams, or custom webhooks.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = state.connections.map(conn => {
      const channel = conn.config.channel || 'Default Channel';
      const iconSvg = getIntegrationIcon(conn.integration_code, conn.integration_icon || '🔌');
      return `
        <div class="market-card">
          <div>
            <div class="market-card-head">
              <div class="market-card-icon">${iconSvg}</div>
              <div class="market-card-title-group">
                <div class="market-card-title">
                  <span>${conn.name}</span>
                  <span class="badge-tag badge-connected">Active</span>
                </div>
                <div style="font-size:0.82rem;color:#475569;margin-top:0.3rem;">
                  <strong>${conn.integration_name}</strong> • ${channel}
                </div>
                <div style="font-size:0.78rem;color:#94a3b8;margin-top:0.2rem;">
                  Connected on ${new Date(conn.connected_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          </div>
          <div class="market-card-meta">
            <button type="button" class="btn btn-sm btn-ping-conn" data-id="${conn.id}">
              <span>⚡</span> <span>Test Ping</span>
            </button>
            <button type="button" class="btn btn-sm btn-danger btn-disconnect-conn" data-id="${conn.id}">
              <span>🗑️</span> <span>Disconnect</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach listeners
    listEl.querySelectorAll('.btn-ping-conn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        btn.textContent = 'Pinging...';
        btn.disabled = true;
        try {
          const res = await apiFetch(`/api/integrations/${id}/test`, { method: 'POST' });
          if (res.result && res.result.ok) {
            showToast(`✅ Test card delivered in ${res.result.durationMs}ms!`);
          } else {
            showToast(`⚠️ Ping returned HTTP ${res.result?.status || 500}`, true);
          }
        } catch (err) {
          showToast('Ping error: ' + err.message, true);
        } finally {
          btn.textContent = '⚡ Test Ping';
          btn.disabled = false;
        }
      });
    });

    listEl.querySelectorAll('.btn-disconnect-conn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Are you sure you want to disconnect this integration?')) {
          try {
            await apiFetch(`/api/integrations/${id}`, { method: 'DELETE' });
            showToast('Integration disconnected');
            await loadAllData();
          } catch (err) {
            showToast('Disconnect error: ' + err.message, true);
          }
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(typeof window !== 'undefined' ? window : this);
