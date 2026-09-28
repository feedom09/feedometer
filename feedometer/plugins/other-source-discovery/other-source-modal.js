/* Detachable Other-than-RSS Source Discovery client. It is loaded only by Feed Search. */
(function (global) {
  'use strict';
  const FALLBACK_TYPES = [
    { id: 'youtube', label: 'YouTube channels and relevant recent videos' },
    { id: 'blogs', label: 'Blogs and publisher websites that do not expose an RSS feed' },
    { id: 'news', label: 'Recent news articles' },
    { id: 'newsletters', label: 'Newsletters/Substacks' },
    { id: 'research', label: 'Research papers or institutional sources' },
    { id: 'podcasts', label: 'Podcasts, where applicable' }
  ];
  const state = { query: '', types: FALLBACK_TYPES, activeType: '', loaded: new Map(), enabled: false };
  function apiBase() { return (global.FEEDOMETER_API_BASE || (global.FeedOmeterConfig && global.FeedOmeterConfig.API_BASE_URL) || (global.FEEDOMETER_CONFIG && global.FEEDOMETER_CONFIG.apiBaseUrl) || '').replace(/\/$/, ''); }
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }
  function overlay() { return document.getElementById('osd-overlay'); }
  function close() { const node = overlay(); if (node) node.classList.remove('is-open'); document.body.style.overflow = ''; }
  async function loadPreference() { if (!global.FeedOmeterAuth || typeof global.FeedOmeterAuth.getPreferences !== 'function') { state.enabled = false; return false; } try { const prefs = await global.FeedOmeterAuth.getPreferences(); state.enabled = prefs.other_source_discovery_enabled !== false; return state.enabled; } catch (_) { state.enabled = false; return false; } }
  function showPlaceholder(message) { const host = document.getElementById('osd-results'); host.innerHTML = ''; host.appendChild(el('div', 'osd-placeholder', message)); }
  function renderMenu() { const host = document.getElementById('osd-menu'); host.innerHTML = ''; state.types.forEach((type) => { const button = el('button', type.id === state.activeType ? 'is-active' : '', type.label); button.type = 'button'; button.addEventListener('click', () => selectType(type.id)); host.appendChild(button); }); }
  function renderResults(results, type, message) { const host = document.getElementById('osd-results'); host.innerHTML = ''; if (!results.length) { host.appendChild(el('div', 'osd-placeholder', message || `No ${type.label.toLowerCase()} are available for this search yet.`)); return; }
    const list = el('div', 'osd-results-list'); results.forEach((result) => { const card = el('article', 'osd-card'); card.appendChild(el('h3', '', result.title || 'Untitled source')); if (result.description) card.appendChild(el('p', '', result.description)); const meta = [result.publisher, result.published_at, result.provider].filter(Boolean).join(' · '); if (meta) card.appendChild(el('div', 'osd-meta', meta)); const link = el('a', 'osd-open', 'Open source ↗'); link.href = result.url; link.target = '_blank'; link.rel = 'noopener'; card.appendChild(link); list.appendChild(card); }); host.appendChild(list); }
  async function selectType(typeId) { const type = state.types.find((item) => item.id === typeId); if (!type || !state.query) return; state.activeType = typeId; renderMenu(); showPlaceholder(`Loading ${type.label.toLowerCase()}…`); const key = `${state.query}::${typeId}`;
    try { let payload = state.loaded.get(key); if (!payload) { const response = await fetch(`${apiBase()}/api/discovery/other-sources/search?query=${encodeURIComponent(state.query)}&type=${encodeURIComponent(typeId)}`); payload = await response.json(); if (!response.ok || !payload.success) throw new Error(payload.message || 'Unable to load sources'); state.loaded.set(key, payload); } renderResults(payload.results || [], type, payload.message); }
    catch (error) { showPlaceholder(error.message || 'Unable to load this source type.'); }
  }
  async function open() { if (!state.query) return; const node = overlay(); node.classList.add('is-open'); document.body.style.overflow = 'hidden'; showPlaceholder('Choose a source category from the left.');
    try { const response = await fetch(`${apiBase()}/api/discovery/other-sources/types`); const payload = await response.json(); if (response.ok && payload.enabled && Array.isArray(payload.types)) state.types = payload.types; renderMenu(); }
    catch (_) { renderMenu(); }
  }
  function install() { const anchor = document.getElementById('other-sources-anchor'); if (!anchor || document.getElementById('osd-trigger-wrap')) return; const wrap = el('div', 'osd-trigger-wrap'); wrap.id = 'osd-trigger-wrap'; wrap.hidden = true; const trigger = el('button', 'osd-trigger', 'Other than RSS sources'); trigger.type = 'button'; trigger.addEventListener('click', open); wrap.appendChild(trigger); anchor.appendChild(wrap);
    const node = el('div', 'osd-overlay'); node.id = 'osd-overlay'; node.setAttribute('role', 'dialog'); node.setAttribute('aria-modal', 'true'); const modal = el('div', 'osd-modal'); const header = el('div', 'osd-header'); const titleWrap = document.createElement('div'); titleWrap.appendChild(el('h2', '', 'Other sources')); titleWrap.appendChild(el('p', '', 'Additional discovery results for your RSS search.')); const closeButton = el('button', 'osd-close', '×'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Close other sources'); closeButton.addEventListener('click', close); header.append(titleWrap, closeButton); const body = el('div', 'osd-body'); const menu = el('nav', 'osd-menu'); menu.id = 'osd-menu'; const results = el('section', 'osd-results'); results.id = 'osd-results'; body.append(menu, results); modal.append(header, body); node.appendChild(modal); node.addEventListener('click', (event) => { if (event.target === node) close(); }); document.body.appendChild(node);
    global.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); }); global.addEventListener('feedometer:rss-discovery-started', async (event) => { const detail = event.detail || {}; state.query = String(detail.query || '').trim(); state.loaded.clear(); await loadPreference(); wrap.hidden = !state.enabled || !state.query; }); global.addEventListener('feedometer:rss-discovery-complete', async (event) => { const detail = event.detail || {}; state.query = String(detail.query || '').trim(); state.loaded.clear(); await loadPreference(); wrap.hidden = !state.enabled || !state.query; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})(window);
