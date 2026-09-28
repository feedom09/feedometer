(function (window, document) {
  'use strict';
  const jobId = new URLSearchParams(window.location.search).get('job');
  const state = {
    sections: [],
    selected: '',
    timer: null,
    activeTab: 'overview',
    publisherName: '',
    targetUrl: '',
    inventory: []
  };

  const ICONS = {
    home: '🏠',
    uk: '🇬🇧',
    world: '🌍',
    sport: '⚽',
    sports: '⚽',
    entertainment: '🎭',
    technology: '💻',
    tech: '💻',
    business: '💼',
    politics: '🏛️',
    science: '🔬',
    health: '🏥',
    ai: '🤖',
    ev: '⚡',
    gaming: '🎮',
    travel: '✈️'
  };

  function getDeskIcon(name) {
    const key = String(name || '').toLowerCase().trim();
    return ICONS[key] || '📰';
  }

  function apiBase() {
    const c = window.FEEDOMETER_API_BASE || (window.FEEDOMETER_CONFIG && (window.FEEDOMETER_CONFIG.API_BASE || window.FEEDOMETER_CONFIG.API_BASE_URL || window.FEEDOMETER_CONFIG.WORKER_URL));
    return String(c || '').replace(/\/+$/, '');
  }

  function safe(value) {
    const node = document.createElement('span');
    node.textContent = String(value || '');
    return node.innerHTML;
  }

  function select(name) {
    state.selected = name;
    render();
  }

  function switchTab(toolName) {
    state.activeTab = toolName;
    document.querySelectorAll('.source-tool-tab').forEach((t) => {
      const isMatch = t.getAttribute('data-tool') === toolName;
      t.classList.toggle('is-active', isMatch);
      t.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });

    document.querySelectorAll('.source-tool-panel').forEach((p) => {
      const isMatch = p.getAttribute('data-panel') === toolName;
      p.hidden = !isMatch;
    });

    if (toolName === 'brief') {
      renderAiBrief();
    } else if (toolName === 'widgets') {
      updateWidgetsLink();
    } else if (toolName === 'filters') {
      updateFiltersLink();
    }
  }

  function getActiveFeedUrl() {
    const section = state.sections.find((item) => item.name === state.selected) || state.sections[0];
    const match = (state.inventory || []).find((f) => f.category === (section && section.name) || f.publisher_section === (section && section.name));
    if (match && match.url) return match.url;
    return state.targetUrl || 'https://www.bbc.com';
  }

  function updateWidgetsLink() {
    const btn = document.getElementById('btn-open-widget-studio');
    if (!btn) return;
    const feedUrl = getActiveFeedUrl();
    const targetHref = `widgets.html?feed=${encodeURIComponent(feedUrl)}`;
    btn.onclick = (e) => {
      e.preventDefault();
      if (window.parent && window.parent !== window && typeof window.parent.loadView === 'function') {
        window.parent.loadView(targetHref);
      } else {
        window.location.href = targetHref;
      }
    };
  }

  function updateFiltersLink() {
    const btn = document.getElementById('btn-open-filters-workspace');
    if (!btn) return;
    const feedUrl = getActiveFeedUrl();
    const targetHref = `filters.html?feed=${encodeURIComponent(feedUrl)}`;
    btn.onclick = (e) => {
      e.preventDefault();
      if (window.parent && window.parent !== window && typeof window.parent.loadView === 'function') {
        window.parent.loadView(targetHref);
      } else {
        window.location.href = targetHref;
      }
    };
  }

  function renderAiBrief() {
    const section = state.sections.find((item) => item.name === state.selected) || state.sections[0];
    const titleEl = document.getElementById('brief-desk-title');
    const timeEl = document.getElementById('brief-timestamp');
    const bodyEl = document.getElementById('ai-brief-content');
    if (!bodyEl) return;

    const deskName = section ? section.name : 'Publisher';
    if (titleEl) titleEl.textContent = `${deskName} Desk — Executive Brief`;
    if (timeEl) timeEl.textContent = `Generated live for ${state.publisherName || 'Publisher'} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const articles = section && section.articles ? section.articles : [];
    if (!articles.length) {
      bodyEl.innerHTML = '<div class="empty">No articles loaded yet to synthesize an AI brief.</div>';
      return;
    }

    const topArticles = articles.slice(0, 6);
    const bullets = topArticles.map((art, idx) => {
      const icons = ['🔥', '📌', '⚡', '📊', '🌐', '💡'];
      const icon = icons[idx % icons.length];
      const desc = (art.description || '').replace(/<[^>]*>/g, '').trim().slice(0, 180);
      return `<li class="brief-bullet-item">
        <span class="brief-bullet-icon">${icon}</span>
        <div class="brief-bullet-text">
          <h4><a href="${safe(art.url || art.link || '#')}" target="_blank" rel="noopener" style="color:#0f172a; text-decoration:none;">${safe(art.title)}</a></h4>
          <p>${safe(desc || 'Click to view full coverage and live updates from this source.')}</p>
        </div>
      </li>`;
    }).join('');

    bodyEl.innerHTML = `
      <p>Here is the synthesized intelligence summary for <strong>${safe(state.publisherName || 'this publisher')} (${safe(deskName)} Desk)</strong> based on ${articles.length} verified articles in this stream:</p>
      <ul class="brief-bullet-list">${bullets}</ul>
    `;
  }

  function render() {
    const section = state.sections.find((item) => item.name === state.selected) || state.sections[0];
    const menu = document.getElementById('desk-menu');
    if (menu) {
      menu.innerHTML = state.sections.map((item) => {
        const isActive = item.name === (section && section.name);
        const icon = getDeskIcon(item.name);
        return `<div class="sidebar-nav-item ${isActive ? 'active' : ''}" data-section="${safe(item.name)}" role="button" tabindex="0">
          <div class="nav-icon-label">
            <span>${icon}</span>
            <span>${safe(item.name)}</span>
          </div>
          <span class="nav-badge">${item.count}</span>
        </div>`;
      }).join('');

      menu.querySelectorAll('[data-section]').forEach((button) => {
        button.addEventListener('click', () => select(button.dataset.section));
        button.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            select(button.dataset.section);
          }
        });
      });
    }

    const titleEl = document.getElementById('desk-title');
    if (titleEl) titleEl.textContent = section ? `${section.name} articles` : 'Articles';

    const totalEl = document.getElementById('desk-total');
    if (totalEl) totalEl.textContent = section ? `${section.count} available · maximum 50` : '';

    const grid = document.getElementById('article-grid');
    if (grid) {
      if (!section || !section.articles.length) {
        grid.innerHTML = '<div class="empty">This category is still loading or has no public RSS articles.</div>';
      } else {
        grid.innerHTML = section.articles.map((article) => {
          const rawImg = article.image || article.ogImage || article.thumbnail;
          const image = (window.FeedImaging && typeof window.FeedImaging.upgradeUrl === 'function')
            ? window.FeedImaging.upgradeUrl(rawImg)
            : rawImg;
          const url = safe(article.url || article.link || '#');
          const origin = String(article.discovery_type || 'rss').replace(/_/g, ' ');
          return `<article class="live-card">
            ${image ? `<a href="${url}" target="_blank" rel="noopener"><img src="${safe(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>` : '<div class="image-empty">📰</div>'}
            <div class="live-card-body">
              <span class="domain">${safe(article.source || section.name)} · ${safe(origin)}</span>
              <a href="${url}" target="_blank" rel="noopener">${safe(article.title || 'Untitled article')}</a>
              <p>${safe(String(article.description || '').replace(/<[^>]*>/g, '').slice(0, 160))}</p>
            </div>
          </article>`;
        }).join('');

        if (window.FeedImaging && typeof window.FeedImaging.enhanceImages === 'function') {
          window.FeedImaging.enhanceImages(grid);
        }
      }
    }

    if (state.activeTab === 'brief') {
      renderAiBrief();
    }
  }

  function merge(data) {
    state.publisherName = data.name || 'Publisher Live View';
    state.targetUrl = data.url || '';
    state.inventory = Array.isArray(data.feed_inventory) ? data.feed_inventory : [];

    const nameEl = document.getElementById('publisher-name');
    if (nameEl) nameEl.textContent = state.publisherName;

    state.sections = Array.isArray(data.sections) ? data.sections : [];
    if (!state.selected || !state.sections.some((section) => section.name === state.selected)) {
      state.selected = (state.sections.find((section) => section.name === 'Home') || state.sections[0] || {}).name || '';
    }

    const progress = data.progress || {};
    const statusEl = document.getElementById('live-status');
    if (statusEl) {
      statusEl.textContent = progress.complete
        ? `${progress.articles_found || 0} unique articles loaded · ${progress.images_resolved || 0} thumbnails resolved`
        : progress.status === 'enriching_images'
          ? `Resolving thumbnails… ${progress.images_resolved || 0} found`
          : `Loading more desks… ${progress.feeds_scanned || 0} feeds checked`;
    }

    render();
    if (!progress.complete) state.timer = window.setTimeout(load, 1100);
  }

  async function load() {
    try {
      const response = await fetch(`${apiBase()}/api/feed-preview/${encodeURIComponent(jobId)}`);
      if (!response.ok) throw new Error('Preview expired');
      merge(await response.json());
    } catch (error) {
      const statusEl = document.getElementById('live-status');
      if (statusEl) statusEl.textContent = error.message || 'Unable to load this publisher preview.';
    }
  }

  function initTabs() {
    document.querySelectorAll('.source-tool-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        const tool = e.currentTarget.getAttribute('data-tool');
        if (tool) switchTab(tool);
      });
    });
  }

  initTabs();

  if (!jobId) {
    const statusEl = document.getElementById('live-status');
    if (statusEl) statusEl.textContent = 'Open this page from a publisher preview.';
  } else {
    load();
  }
})(window, document);
