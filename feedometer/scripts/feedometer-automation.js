/**
 * scripts/feedometer-automation.js — FeedOmeter 2.1 Automation Studio Controller
 * Manages Outbound Webhooks, Real-Time Keyword Alerts, Web Push Subscriptions & Scheduled Digests
 */
(function (window, document) {
  'use strict';

  function getApiBase() {
    if (window.FEEDOMETER_API_BASE) return window.FEEDOMETER_API_BASE.replace(/\/+$/, '');
    if (window.FeedOmeterConfig && window.FeedOmeterConfig.API_BASE_URL) return window.FeedOmeterConfig.API_BASE_URL.replace(/\/+$/, '');
    if (window.FEEDOMETER_CONFIG && window.FEEDOMETER_CONFIG.API_BASE) return window.FEEDOMETER_CONFIG.API_BASE.replace(/\/+$/, '');
    return (typeof window !== 'undefined' && window.FEEDOMETER_API_BASE) ? window.FEEDOMETER_API_BASE : '';
  }

  function getAuthToken() {
    if (window.FeedOmeterAuth && typeof window.FeedOmeterAuth.getToken === 'function') {
      const tok = window.FeedOmeterAuth.getToken();
      if (tok) return tok;
    }
    try {
      if (window.parent && window.parent !== window && window.parent.FeedOmeterAuth && typeof window.parent.FeedOmeterAuth.getToken === 'function') {
        const pTok = window.parent.FeedOmeterAuth.getToken();
        if (pTok) return pTok;
      }
    } catch (_) {}
    return localStorage.getItem('feedometer_session_token') || 
           localStorage.getItem('feedometer_auth_token') || 
           localStorage.getItem('feedometer_token') || 
           sessionStorage.getItem('feedometer_session_token') || 
           sessionStorage.getItem('feedometer_auth_token') || '';
  }

  async function apiFetch(endpoint, options = {}) {
    const token = getAuthToken();
    const headers = Object.assign({
      'Content-Type': 'application/json'
    }, options.headers || {});

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(getApiBase() + endpoint, Object.assign({}, options, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  // State
  const state = {
    activeTab: 'webhooks', // 'webhooks' | 'alerts' | 'digests'
    webhooks: [],
    alerts: [],
    digests: [],
    notifications: []
  };

  // Toast helper
  function showToast(msg, isError = false) {
    let toast = document.getElementById('auto-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'auto-toast';
      toast.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;z-index:99999;transition:all 0.3s;box-shadow:0 10px 25px rgba(0,0,0,0.15);';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.background = isError ? '#ef4444' : '#10b981';
    toast.style.color = '#ffffff';
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
    }, 3500);
  }

  async function init() {
    setupTabs();
    setupModals();
    setupForms();
    await loadAllData();
  }

  function setupTabs() {
    document.querySelectorAll('.auto-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        if (tab) {
          state.activeTab = tab;
          document.querySelectorAll('.auto-tab-btn').forEach(b => b.classList.toggle('active', b === e.currentTarget));
          document.querySelectorAll('.auto-tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
        }
      });
    });
  }

  function setupModals() {
    // Close modal on click of backdrop or close buttons
    document.querySelectorAll('.modal-close-trigger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.currentTarget.closest('.auto-modal');
        if (modal) modal.hidden = true;
      });
    });
  }

  function setupForms() {
    // 1. Webhook Create Form
    const btnNewWebhook = document.getElementById('btn-new-webhook');
    const modalWebhook = document.getElementById('modal-webhook');
    const formWebhook = document.getElementById('form-webhook');
    if (btnNewWebhook && modalWebhook) {
      btnNewWebhook.addEventListener('click', () => {
        formWebhook.reset();
        const schedSettings = document.getElementById('wh-scheduled-settings');
        if (schedSettings) schedSettings.style.display = 'none';
        const dayWrap = document.getElementById('wh-schedule-day-wrap');
        if (dayWrap) dayWrap.style.display = 'none';
        modalWebhook.hidden = false;
      });
    }

    // Cadence radio change listener
    document.querySelectorAll('input[name="wh-cadence-radio"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const schedSettings = document.getElementById('wh-scheduled-settings');
        if (schedSettings) {
          schedSettings.style.display = e.target.value === 'scheduled' ? 'block' : 'none';
        }
      });
    });

    // Schedule frequency dropdown change listener
    const whFreqSelect = document.getElementById('wh-schedule-freq');
    if (whFreqSelect) {
      whFreqSelect.addEventListener('change', (e) => {
        const dayWrap = document.getElementById('wh-schedule-day-wrap');
        if (dayWrap) {
          dayWrap.style.display = e.target.value === 'weekly' ? 'block' : 'none';
        }
      });
    }

    if (formWebhook) {
      formWebhook.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('wh-name').value.trim();
        const url = document.getElementById('wh-url').value.trim();
        const keywords = document.getElementById('wh-keywords').value.trim();
        const domains = document.getElementById('wh-domains').value.trim();
        const cadence = document.querySelector('input[name="wh-cadence-radio"]:checked')?.value || 'realtime';
        const formatType = document.getElementById('wh-format-type')?.value || 'standard';
        const scheduleFreq = document.getElementById('wh-schedule-freq')?.value || 'daily';
        const scheduleTime = document.getElementById('wh-schedule-time')?.value || '17:00';
        const scheduleDay = document.getElementById('wh-schedule-day')?.value || 'monday';

        try {
          await apiFetch('/api/webhooks', {
            method: 'POST',
            body: JSON.stringify({
              name,
              target_url: url,
              cadence,
              format_type: formatType,
              schedule_time: cadence === 'scheduled' ? scheduleTime : null,
              schedule_day: cadence === 'scheduled' && scheduleFreq === 'weekly' ? scheduleDay : null,
              config: {
                includeKeywords: keywords ? keywords.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [],
                includeDomains: domains ? domains.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : []
              }
            })
          });
          showToast('Webhook registered successfully!');
          modalWebhook.hidden = true;
          await loadWebhooks();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }

    // Direct Webhook Test Ping Button in Form
    const btnDirectTest = document.getElementById('btn-test-direct-webhook');
    if (btnDirectTest) {
      btnDirectTest.addEventListener('click', async () => {
        const url = document.getElementById('wh-url').value.trim();
        if (!url) {
          showToast('Please enter a target URL to test', true);
          return;
        }
        btnDirectTest.textContent = 'Pinging...';
        btnDirectTest.disabled = true;
        try {
          const res = await apiFetch('/api/webhooks/test', {
            method: 'POST',
            body: JSON.stringify({ target_url: url })
          });
          const result = res.result;
          if (result.ok) {
            showToast(`Success! Endpoint responded HTTP ${result.status} in ${result.durationMs}ms`);
          } else {
            showToast(`Endpoint Error: HTTP ${result.status} (${result.statusText})`, true);
          }
        } catch (err) {
          showToast('Ping failed: ' + err.message, true);
        } finally {
          btnDirectTest.textContent = 'Test Ping Endpoint';
          btnDirectTest.disabled = false;
        }
      });
    }

    // 2. Alert Create Form
    const btnNewAlert = document.getElementById('btn-new-alert');
    const modalAlert = document.getElementById('modal-alert');
    const formAlert = document.getElementById('form-alert');
    if (btnNewAlert && modalAlert) {
      btnNewAlert.addEventListener('click', () => {
        formAlert.reset();
        modalAlert.hidden = false;
      });
    }

    if (formAlert) {
      formAlert.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('alt-name').value.trim();
        const keywords = document.getElementById('alt-keywords').value.trim();
        const exclude = document.getElementById('alt-exclude').value.trim();
        const booleanQuery = document.getElementById('alt-boolean').value.trim();
        const chInApp = document.getElementById('alt-ch-inapp').checked;
        const chEmail = document.getElementById('alt-ch-email').checked;
        const chPush = document.getElementById('alt-ch-push').checked;

        const channels = [];
        if (chInApp) channels.push('in_app');
        if (chEmail) channels.push('email');
        if (chPush) channels.push('push');

        try {
          await apiFetch('/api/alerts', {
            method: 'POST',
            body: JSON.stringify({
              name,
              alert_type: booleanQuery ? 'saved_search' : 'keyword',
              delivery_channels: channels,
              config: {
                includeKeywords: keywords ? keywords.split(/[\n,]+/).map(s => s.trim()) : [],
                excludeKeywords: exclude ? exclude.split(/[\n,]+/).map(s => s.trim()) : [],
                booleanQuery: booleanQuery || undefined
              }
            })
          });
          showToast('Alert created successfully!');
          modalAlert.hidden = true;
          await loadAlerts();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }

    // Live Test Alert Rule Button in Modal
    const btnTestAlertRule = document.getElementById('btn-test-alert-rule');
    const alertTestResults = document.getElementById('alert-test-results');
    if (btnTestAlertRule) {
      btnTestAlertRule.addEventListener('click', async () => {
        const keywords = document.getElementById('alt-keywords').value.trim();
        const exclude = document.getElementById('alt-exclude').value.trim();
        const booleanQuery = document.getElementById('alt-boolean').value.trim();

        btnTestAlertRule.textContent = 'Evaluating...';
        btnTestAlertRule.disabled = true;
        try {
          const res = await apiFetch('/api/alerts/test', {
            method: 'POST',
            body: JSON.stringify({
              config: {
                includeKeywords: keywords ? keywords.split(/[\n,]+/).map(s => s.trim()) : [],
                excludeKeywords: exclude ? exclude.split(/[\n,]+/).map(s => s.trim()) : [],
                booleanQuery: booleanQuery || undefined
              }
            })
          });
          const matchResult = res.result;
          alertTestResults.hidden = false;
          alertTestResults.innerHTML = `
            <div style="font-weight:700;margin-bottom:6px;color:#0f172a;">Matched ${matchResult.matchedCount} of ${matchResult.totalChecked} recent articles:</div>
            <ul style="margin:0;padding-left:18px;font-size:12px;color:#475569;">
              ${(matchResult.matches || []).slice(0, 4).map(m => `<li><strong>${m.title}</strong> (${m.matchedKeywords.join(', ') || 'matched'})</li>`).join('') || '<li>No matches found in latest batch.</li>'}
            </ul>
          `;
        } catch (err) {
          showToast('Test failed: ' + err.message, true);
        } finally {
          btnTestAlertRule.textContent = 'Evaluate Against Recent Articles';
          btnTestAlertRule.disabled = false;
        }
      });
    }

    // 3. Digest Create Form
    const btnNewDigest = document.getElementById('btn-new-digest');
    const modalDigest = document.getElementById('modal-digest');
    const formDigest = document.getElementById('form-digest');
    if (btnNewDigest && modalDigest) {
      btnNewDigest.addEventListener('click', () => {
        formDigest.reset();
        modalDigest.hidden = false;
      });
    }

    if (formDigest) {
      formDigest.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('dgs-name').value.trim();
        const schedule = document.getElementById('dgs-schedule').value;
        const channel = document.getElementById('dgs-channel').value;
        const keywords = document.getElementById('dgs-keywords').value.trim();

        try {
          await apiFetch('/api/digests', {
            method: 'POST',
            body: JSON.stringify({
              name,
              schedule_type: schedule,
              delivery_channel: channel,
              config: {
                includeKeywords: keywords ? keywords.split(/[\n,]+/).map(s => s.trim()) : []
              }
            })
          });
          showToast('Digest scheduled successfully!');
          modalDigest.hidden = true;
          await loadDigests();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }

    // Push Enable Button
    const btnEnablePush = document.getElementById('btn-enable-push');
    if (btnEnablePush) {
      btnEnablePush.addEventListener('click', async () => {
        if (!('Notification' in window)) {
          showToast('Browser notifications are not supported in this browser', true);
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          showToast('Browser permission was granted, but server Web Push delivery is not configured yet.', true);
        } else {
          showToast('Notification permission was denied', true);
        }
      });
    }
  }

  async function loadAllData() {
    await Promise.allSettled([
      loadWebhooks(),
      loadAlerts(),
      loadDigests()
    ]);
  }

  async function loadWebhooks() {
    const listEl = document.getElementById('webhooks-list');
    if (!listEl) return;
    try {
      const res = await apiFetch('/api/webhooks');
      state.webhooks = res.webhooks || [];
      renderWebhooks();
    } catch (err) {
      listEl.innerHTML = `<div class="auto-empty"><div class="auto-empty-icon">⚠️</div><h3>Could not load webhooks</h3><p>${err.message}</p></div>`;
    }
  }

  function renderWebhooks() {
    const listEl = document.getElementById('webhooks-list');
    if (!listEl) return;
    if (state.webhooks.length === 0) {
      listEl.innerHTML = `
        <div class="auto-empty">
          <div class="auto-empty-icon">⚡</div>
          <h3>No Webhooks Configured</h3>
          <p>Deliver real-time JSON payloads to your servers, Slack, or Zapier whenever new articles match your filters.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = state.webhooks.map(w => {
      const stats = w.stats || {};
      const isScheduled = w.cadence === 'scheduled';
      let cadenceBadgeText = '⚡ Real-time';
      let cadenceBadgeClass = 'badge-green';
      if (isScheduled) {
        cadenceBadgeClass = 'badge-blue';
        if (w.schedule_day) {
          cadenceBadgeText = `📅 Weekly ${w.schedule_day.toUpperCase().slice(0,3)} ${w.schedule_time || '09:00'}`;
        } else {
          cadenceBadgeText = `📅 Daily ${w.schedule_time || '17:00'}`;
        }
      }

      const formatBadge = w.format_type === 'slack'
        ? `<span class="auto-badge" style="background:#e0f2fe;color:#0284c7;border:1px solid #bae6fd;">Slack Blocks</span>`
        : `<span class="auto-badge badge-gray">Standard JSON</span>`;

      return `
        <div class="auto-card">
          <div class="auto-card-head">
            <div>
              <div class="auto-card-title">${w.name}</div>
              <div class="auto-card-url">${w.target_url}</div>
            </div>
            <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
              <span class="auto-badge ${cadenceBadgeClass}">${cadenceBadgeText}</span>
              ${formatBadge}
              <span class="auto-badge ${w.is_active ? 'badge-green' : 'badge-gray'}">${w.is_active ? 'Active' : 'Paused'}</span>
            </div>
          </div>
          <div class="auto-card-secret">
            <span>Signing Secret:</span> <code>${w.secret_key}</code>
          </div>
          <div class="auto-card-meta">
            <span>Total Deliveries: <strong>${stats.total || 0}</strong></span>
            <span>Success: <strong>${stats.successful || 0}</strong></span>
            ${isScheduled && w.next_run_at ? `<span>Next Scheduled Run: <strong>${new Date(w.next_run_at).toLocaleString()}</strong></span>` : ''}
            <span>Created: ${new Date(w.created_at).toLocaleDateString()}</span>
          </div>
          <div class="auto-card-actions">
            <button type="button" class="btn btn-sm btn-ping" data-id="${w.id}"><span>⚡</span><span>Test Ping</span></button>
            <button type="button" class="btn btn-sm btn-logs" data-id="${w.id}"><span>📋</span><span>View Logs</span></button>
            <button type="button" class="btn btn-sm btn-danger btn-delete" data-id="${w.id}"><span>🗑️</span><span>Delete</span></button>
          </div>
        </div>
      `;
    }).join('');

    // Attach actions
    listEl.querySelectorAll('.btn-ping').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        btn.textContent = 'Pinging...';
        btn.disabled = true;
        try {
          const res = await apiFetch(`/api/webhooks/${id}/test`, { method: 'POST' });
          const r = res.result;
          if (r.ok) showToast(`Ping OK! HTTP ${r.status} (${r.durationMs}ms)`);
          else showToast(`Ping Failed: HTTP ${r.status} (${r.statusText})`, true);
        } catch (err) {
          showToast('Ping error: ' + err.message, true);
        } finally {
          btn.textContent = '⚡ Test Ping';
          btn.disabled = false;
        }
      });
    });

    listEl.querySelectorAll('.btn-logs').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        try {
          const res = await apiFetch(`/api/webhooks/${id}/logs`);
          openLogsModal(res.logs || []);
        } catch (err) {
          showToast('Error loading logs: ' + err.message, true);
        }
      });
    });

    listEl.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Are you sure you want to delete this webhook?')) {
          try {
            await apiFetch(`/api/webhooks/${id}`, { method: 'DELETE' });
            showToast('Webhook deleted');
            await loadWebhooks();
          } catch (err) {
            showToast('Error deleting webhook: ' + err.message, true);
          }
        }
      });
    });
  }

  function openLogsModal(logs) {
    const modal = document.getElementById('modal-logs');
    const body = document.getElementById('logs-modal-body');
    if (!modal || !body) return;

    if (logs.length === 0) {
      body.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b;">No delivery attempts logged yet.</div>';
    } else {
      body.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="border-bottom:2px solid #e2e8f0;text-align:left;color:#475569;">
              <th style="padding:8px;">Status</th>
              <th style="padding:8px;">Code</th>
              <th style="padding:8px;">Latency</th>
              <th style="padding:8px;">Article</th>
              <th style="padding:8px;">Delivered At</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map(l => `
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:8px;"><span class="auto-badge ${l.status === 'delivered' ? 'badge-green' : 'badge-red'}">${l.status}</span></td>
                <td style="padding:8px;font-weight:700;">${l.response_code || '—'}</td>
                <td style="padding:8px;">${l.duration_ms ? l.duration_ms + 'ms' : '—'}</td>
                <td style="padding:8px;">${l.article_title ? l.article_title.slice(0, 35) + '...' : 'Direct Ping'}</td>
                <td style="padding:8px;color:#64748b;">${l.created_at ? new Date(l.created_at).toLocaleTimeString() : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
    modal.hidden = false;
  }

  async function loadAlerts() {
    const listEl = document.getElementById('alerts-list');
    if (!listEl) return;
    try {
      const res = await apiFetch('/api/alerts');
      state.alerts = res.alerts || [];
      renderAlerts();
    } catch (err) {
      listEl.innerHTML = `<div class="auto-empty"><div class="auto-empty-icon">⚠️</div><h3>Could not load alerts</h3><p>${err.message}</p></div>`;
    }
  }

  function renderAlerts() {
    const listEl = document.getElementById('alerts-list');
    if (!listEl) return;
    if (state.alerts.length === 0) {
      listEl.innerHTML = `
        <div class="auto-empty">
          <div class="auto-empty-icon">🔔</div>
          <h3>No Alerts Configured</h3>
          <p>Get notified the instant breaking news on your target companies, topics, or keywords is syndicated.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = state.alerts.map(a => {
      const config = a.config || {};
      const kw = (config.includeKeywords || []).join(', ') || config.booleanQuery || 'Any Article';
      const exclude = (config.excludeKeywords || []).join(', ');
      return `
        <div class="auto-card">
          <div class="auto-card-head">
            <div>
              <div class="auto-card-title">${a.name}</div>
              <div class="auto-card-url">Keywords: <strong>${kw}</strong> ${exclude ? `| Exclude: <span style="color:#ef4444;">${exclude}</span>` : ''}</div>
            </div>
            <span class="auto-badge badge-green">Active</span>
          </div>
          <div class="auto-card-meta">
            <span>Channels: <strong>${(a.delivery_channels || []).join(', ')}</strong></span>
            <span>Notifications: <strong>${a.stats ? a.stats.total_notifications : 0}</strong></span>
            <span>Created: ${new Date(a.created_at).toLocaleDateString()}</span>
          </div>
          <div class="auto-card-actions">
            <button type="button" class="btn btn-sm btn-danger btn-delete-alert" data-id="${a.id}"><span>🗑️</span><span>Delete</span></button>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.btn-delete-alert').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Delete this alert?')) {
          try {
            await apiFetch(`/api/alerts/${id}`, { method: 'DELETE' });
            showToast('Alert deleted');
            await loadAlerts();
          } catch (err) {
            showToast('Error deleting alert: ' + err.message, true);
          }
        }
      });
    });
  }

  async function loadDigests() {
    const listEl = document.getElementById('digests-list');
    if (!listEl) return;
    try {
      const res = await apiFetch('/api/digests');
      state.digests = res.digests || [];
      renderDigests();
    } catch (err) {
      listEl.innerHTML = `<div class="auto-empty"><div class="auto-empty-icon">📰</div><h3>Could not load digests</h3><p>${err.message}</p></div>`;
    }
  }

  function renderDigests() {
    const listEl = document.getElementById('digests-list');
    if (!listEl) return;
    if (state.digests.length === 0) {
      listEl.innerHTML = `
        <div class="auto-empty">
          <div class="auto-empty-icon">📰</div>
          <h3>No Scheduled Digests</h3>
          <p>Receive scheduled morning or weekly executive summaries compiling the highest-ranked stories from your feeds.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = state.digests.map(d => {
      const nextRun = d.next_run_at ? new Date(d.next_run_at).toLocaleString() : 'Soon';
      return `
        <div class="auto-card">
          <div class="auto-card-head">
            <div>
              <div class="auto-card-title">${d.name}</div>
              <div class="auto-card-url">Frequency: <strong>${d.schedule_type.toUpperCase()}</strong> • Target: <strong>${d.delivery_channel}</strong></div>
            </div>
            <span class="auto-badge badge-green">Scheduled</span>
          </div>
          <div class="auto-card-meta">
            <span>Next Briefing: <strong>${nextRun}</strong></span>
            <span>Total Runs: <strong>${d.stats ? d.stats.total_runs : 0}</strong></span>
          </div>
          <div class="auto-card-actions">
            <button type="button" class="btn btn-sm btn-preview-digest" data-name="${d.name}"><span>👁️</span><span>Live Preview</span></button>
            <button type="button" class="btn btn-sm btn-danger btn-delete-digest" data-id="${d.id}"><span>🗑️</span><span>Delete</span></button>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.btn-preview-digest').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const name = e.currentTarget.getAttribute('data-name');
        try {
          const res = await apiFetch('/api/digests/preview', {
            method: 'POST',
            body: JSON.stringify({ name })
          });
          openDigestPreviewModal(res.html);
        } catch (err) {
          showToast('Preview error: ' + err.message, true);
        }
      });
    });

    listEl.querySelectorAll('.btn-delete-digest').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Delete this scheduled digest?')) {
          try {
            await apiFetch(`/api/digests/${id}`, { method: 'DELETE' });
            showToast('Digest deleted');
            await loadDigests();
          } catch (err) {
            showToast('Error deleting digest: ' + err.message, true);
          }
        }
      });
    });
  }

  function openDigestPreviewModal(html) {
    const modal = document.getElementById('modal-digest-preview');
    const iframe = document.getElementById('digest-preview-iframe');
    if (!modal || !iframe) return;
    iframe.srcdoc = html;
    modal.hidden = false;
  }

  window.addEventListener('feedometer:auth_change', () => {
    loadAllData();
  });

  window.addEventListener('DOMContentLoaded', init);

})(window, document);
