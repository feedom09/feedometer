/**
 * FeedO+ (RSS+) — Community Intelligence Plugin Logic
 * Self-contained module for top-left community feed discovery
 */
(function () {
  'use strict';

  function initFeedOPlus() {
    const wrap = document.getElementById('feedoplus-wrap');
    if (!wrap) return;

    const data = window.FEEDOPLUS_DATA || { categories: [] };
    const categories = data.categories || [];

    // Build internal HTML structure
    wrap.innerHTML = `
      <button id="btn-feedoplus" class="feedoplus-trigger-btn" title="Explore Community Discussions (FeedO+)" aria-label="Explore Community Discussions" aria-haspopup="true" aria-expanded="false">
        <span class="feedoplus-icon">💬</span>
        <span class="feedoplus-label">FeedO+</span>
        <span class="feedoplus-badge">HOT</span>
      </button>

      <div id="feedoplus-dropdown" class="feedoplus-dropdown" role="menu" aria-label="Community Feeds">
        <div class="feedoplus-banner">
          <span class="feedoplus-banner-title">💬 Community Hubs</span>
          <span class="feedoplus-banner-tag">Reddit RSS</span>
        </div>

        <div class="feedoplus-search-container">
          <input type="text" id="feedoplus-search" class="feedoplus-search-input" placeholder="Search communities (e.g., AI, Python)..." autocomplete="off">
        </div>

        <div class="feedoplus-scroll-area" id="feedoplus-scroll-area">
          ${categories.map(cat => `
            <div class="feedoplus-group" data-group="${cat.id}">
              <button type="button" class="feedoplus-parent-item" aria-expanded="false">
                <span class="feedoplus-parent-left">
                  <span class="feedoplus-parent-icon">${cat.icon}</span>
                  <span class="feedoplus-parent-name">${cat.name}</span>
                  <span class="feedoplus-parent-count">(${cat.items.length})</span>
                </span>
                <span class="feedoplus-chevron">▶</span>
              </button>
              <div class="feedoplus-submenu">
                ${cat.items.map(item => `
                  <button type="button" class="feedoplus-item" data-url="${item.url}" title="Subscribe to ${item.name}">
                    <div class="feedoplus-item-title-row">
                      <span class="feedoplus-item-bullet">•</span>
                      <span class="feedoplus-item-name">${item.name}</span>
                    </div>
                    <span class="feedoplus-item-desc">${item.desc}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          `).join('')}
          <div id="feedoplus-empty" class="feedoplus-empty" style="display: none;">
            No matching communities found
          </div>
        </div>
      </div>
    `;

    const btn = document.getElementById('btn-feedoplus');
    const dropdown = document.getElementById('feedoplus-dropdown');
    const searchInput = document.getElementById('feedoplus-search');
    const groups = wrap.querySelectorAll('.feedoplus-group');
    const items = wrap.querySelectorAll('.feedoplus-item');
    const emptyMsg = document.getElementById('feedoplus-empty');
    const scrollArea = document.getElementById('feedoplus-scroll-area');

    function resetToDefaultState() {
      groups.forEach(group => {
        group.classList.remove('open');
        group.style.display = '';
        const parentBtn = group.querySelector('.feedoplus-parent-item');
        if (parentBtn) parentBtn.setAttribute('aria-expanded', 'false');
        group.querySelectorAll('.feedoplus-item').forEach(it => it.style.display = 'flex');
      });
      if (emptyMsg) emptyMsg.style.display = 'none';
      if (searchInput) searchInput.value = '';
      if (scrollArea) scrollArea.scrollTop = 0;
    }

    function openDropdown() {
      resetToDefaultState();
      
      // Close other header popups cleanly
      const navDropdown = document.getElementById('feed-navigator-dropdown');
      if (navDropdown && navDropdown.classList.contains('active')) {
        navDropdown.classList.remove('active');
        const navBtn = document.getElementById('btn-feed-navigator');
        if (navBtn) navBtn.setAttribute('aria-expanded', 'false');
      }
      const bgPopup = document.getElementById('bg-color-popup');
      if (bgPopup && bgPopup.classList.contains('active')) {
        bgPopup.classList.remove('active');
      }

      dropdown.classList.add('active');
      btn.setAttribute('aria-expanded', 'true');
      if (searchInput) setTimeout(() => searchInput.focus(), 80);
    }

    function closeDropdown() {
      if (!dropdown) return;
      dropdown.classList.remove('active');
      btn.setAttribute('aria-expanded', 'false');
    }

    function toggleDropdown(e) {
      if (e) e.stopPropagation();
      if (dropdown.classList.contains('active')) {
        closeDropdown();
      } else {
        openDropdown();
      }
    }

    btn.addEventListener('click', toggleDropdown);

    // Parent accordion click
    groups.forEach(group => {
      const parentBtn = group.querySelector('.feedoplus-parent-item');
      if (!parentBtn) return;
      parentBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = group.classList.contains('open');
        // Accordion behavior: close others
        groups.forEach(g => {
          if (g !== group) {
            g.classList.remove('open');
            const pb = g.querySelector('.feedoplus-parent-item');
            if (pb) pb.setAttribute('aria-expanded', 'false');
          }
        });
        if (isOpen) {
          group.classList.remove('open');
          parentBtn.setAttribute('aria-expanded', 'false');
        } else {
          group.classList.add('open');
          parentBtn.setAttribute('aria-expanded', 'true');
        }
      });
    });

    // Submenu item click — trigger reader fetch
    items.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = item.getAttribute('data-url');
        closeDropdown();
        if (url) {
          const feedUrlInput = document.getElementById('feed-url-input');
          const btnFetchFeed = document.getElementById('btn-fetch-feed');
          if (feedUrlInput) {
            feedUrlInput.value = url;
            feedUrlInput.focus();
          }
          if (btnFetchFeed) {
            btnFetchFeed.click();
          }
        }
      });
    });

    // Live search filter
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        let totalVisible = 0;

        if (!query) {
          groups.forEach(group => {
            group.style.display = '';
            group.classList.remove('open');
            group.querySelectorAll('.feedoplus-item').forEach(it => it.style.display = 'flex');
          });
          if (emptyMsg) emptyMsg.style.display = 'none';
          return;
        }

        groups.forEach(group => {
          const catName = (group.querySelector('.feedoplus-parent-name')?.textContent || '').toLowerCase();
          const subItems = group.querySelectorAll('.feedoplus-item');
          let groupHasMatch = false;

          subItems.forEach(it => {
            const name = (it.querySelector('.feedoplus-item-name')?.textContent || '').toLowerCase();
            const desc = (it.querySelector('.feedoplus-item-desc')?.textContent || '').toLowerCase();
            const isMatch = name.includes(query) || desc.includes(query) || catName.includes(query);
            it.style.display = isMatch ? 'flex' : 'none';
            if (isMatch) groupHasMatch = true;
          });

          if (groupHasMatch) {
            group.style.display = '';
            group.classList.add('open'); // Expand group so matching items are visible
            totalVisible++;
          } else {
            group.style.display = 'none';
            group.classList.remove('open');
          }
        });

        if (emptyMsg) {
          emptyMsg.style.display = totalVisible === 0 ? 'block' : 'none';
        }
      });

      searchInput.addEventListener('click', (e) => e.stopPropagation());
    }

    // Dismiss on click outside
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) {
        closeDropdown();
      }
    });

    // Dismiss on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdown.classList.contains('active')) {
        closeDropdown();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeedOPlus);
  } else {
    initFeedOPlus();
  }
})();
