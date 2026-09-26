/**
 * scripts/feedometer-auth.js — Client Authentication & Identity Management Library
 * FeedOmeter 2.1 — 7-Domain Enterprise Identity Architecture
 */
(function (global) {
  'use strict';

  const TOKEN_KEY = 'feedometer_session_token';
  const USER_KEY = 'feedometer_user_profile';
  const GUEST_KEY = 'feedometer_guest_mode';
  const GUEST_FOLLOWS_KEY = 'feedometer_guest_subscriptions';

  function getApiBase() {
    if (window.FEEDOMETER_CONFIG && window.FEEDOMETER_CONFIG.apiBaseUrl) {
      return window.FEEDOMETER_CONFIG.apiBaseUrl.replace(/\/$/, '');
    }
    if (window.FEEDOMETER_API_BASE) {
      return window.FEEDOMETER_API_BASE.replace(/\/$/, '');
    }
    return (typeof window !== 'undefined' && window.FEEDOMETER_API_BASE) ? window.FEEDOMETER_API_BASE : '';
  }

  function normalizeUser(u) {
    if (!u) return null;
    const pic = u.avatar_url || u.picture || u.picture_url || '';
    const name = u.display_name || u.first_name || u.name || (u.email ? u.email.split('@')[0] : 'User');
    return Object.assign({}, u, {
      name: name,
      display_name: u.display_name || name,
      avatar_url: pic,
      picture: pic
    });
  }

  const FeedOmeterAuth = {
    isGuest: function () {
      try {
        return !this.isAuthenticated() && localStorage.getItem(GUEST_KEY) === 'true';
      } catch (e) {
        return false;
      }
    },

    setGuestMode: function (enabled) {
      try {
        if (enabled) {
          localStorage.setItem(GUEST_KEY, 'true');
        } else {
          localStorage.removeItem(GUEST_KEY);
        }
      } catch (e) {}
      this._notifyStateChange(null);
    },

    getToken: function () {
      try {
        return localStorage.getItem(TOKEN_KEY) || '';
      } catch (e) {
        return '';
      }
    },

    getUser: function () {
      try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? normalizeUser(JSON.parse(raw)) : null;
      } catch (e) {
        return null;
      }
    },

    isAuthenticated: function () {
      return Boolean(this.getUser() && this.getToken());
    },

    getAuthHeaders: function () {
      const token = this.getToken();
      return token ? {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      } : {
        'Content-Type': 'application/json'
      };
    },

    register: async function (email, password, extra) {
      extra = extra || {};
      const payload = Object.assign({ email: email, password: password }, extra);
      const res = await fetch(getApiBase() + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Registration failed');
      }
      const normalized = normalizeUser(data.user);
      this._setSession(data.token, normalized);
      this.clearGuestDemo();
      return normalized;
    },

    login: async function (email, password) {
      const res = await fetch(getApiBase() + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Login failed');
      }
      const normalized = normalizeUser(data.user);
      this._setSession(data.token, normalized);
      this.clearGuestDemo();
      return normalized;
    },

    loginWithGoogle: async function (profile) {
      const payload = (profile && profile.access_token)
        ? { access_token: profile.access_token }
        : profile;
      const res = await fetch(getApiBase() + '/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Google authentication failed');
      }
      const normalized = normalizeUser(data.user);
      this._setSession(data.token, normalized);
      this.clearGuestDemo();
      return normalized;
    },

    logout: async function () {
      const token = this.getToken();
      this._clearSession();
      if (token) {
        try {
          fetch(getApiBase() + '/api/auth/logout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            }
          }).catch(function () {});
        } catch (e) {}
      }
    },

    checkSession: async function () {
      const token = this.getToken();
      if (!token) return null;

      try {
        const res = await fetch(getApiBase() + '/api/auth/me', {
          headers: this.getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'success' && data.user) {
            const existing = this.getUser() || {};
            const rawMerged = Object.assign({}, existing, data.user, {
              providers: data.providers || [],
              preferences: data.preferences || {},
              has_password: data.has_password
            });
            const normalized = normalizeUser(rawMerged);
            localStorage.setItem(USER_KEY, JSON.stringify(normalized));
            const prevId = existing ? (existing.id || existing.email) : null;
            const nextId = normalized ? (normalized.id || normalized.email) : null;
            if (prevId !== nextId) {
              this._notifyStateChange(normalized);
            }
            return normalized;
          }
        }
      } catch (e) {}

      this._clearSession();
      return null;
    },

    updateProfile: async function (profileData) {
      const res = await fetch(getApiBase() + '/api/auth/profile', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(profileData)
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to update profile');
      }
      const existing = this.getUser() || {};
      const normalized = normalizeUser(Object.assign({}, existing, data.user));
      localStorage.setItem(USER_KEY, JSON.stringify(normalized));
      this._notifyStateChange(normalized);
      return normalized;
    },

    changePassword: async function (currentPassword, newPassword) {
      const res = await fetch(getApiBase() + '/api/auth/password', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to change password');
      }
      return data;
    },

    forgotPassword: async function (email) {
      const res = await fetch(getApiBase() + '/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to request password reset');
      }
      return data;
    },

    verifyEmail: async function (token) {
      const res = await fetch(getApiBase() + '/api/auth/verify-email?token=' + encodeURIComponent(token));
      const data = await res.json();
      if (!res.ok || data.status !== 'success') throw new Error(data.message || 'Email verification failed');
      return data;
    },

    verifyResetToken: async function (token) {
      const res = await fetch(getApiBase() + '/api/auth/reset-password?token=' + encodeURIComponent(token));
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Invalid or expired reset token');
      }
      return data;
    },

    resetPassword: async function (token, newPassword) {
      const res = await fetch(getApiBase() + '/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, new_password: newPassword })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to reset password');
      }
      if (data.token && data.user) {
        const normalized = normalizeUser(data.user);
        this._setSession(data.token, normalized);
      }
      return data;
    },

    getSessions: async function () {
      const res = await fetch(getApiBase() + '/api/auth/sessions', {
        headers: this.getAuthHeaders()
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to list active sessions');
      }
      return data.sessions || [];
    },

    revokeSession: async function (sessionId) {
      const res = await fetch(getApiBase() + '/api/auth/sessions/' + encodeURIComponent(sessionId), {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to revoke session');
      }
      return data;
    },

    revokeOtherSessions: async function () {
      const res = await fetch(getApiBase() + '/api/auth/sessions/other', {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to revoke other sessions');
      }
      return data;
    },

    getPreferences: async function () {
      const res = await fetch(getApiBase() + '/api/auth/preferences', {
        headers: this.getAuthHeaders()
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to get preferences');
      }
      return data.preferences || {};
    },

    updatePreferences: async function (preferencesData) {
      const res = await fetch(getApiBase() + '/api/auth/preferences', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(preferencesData)
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to update preferences');
      }
      return data.preferences;
    },

    buildArticlePayload: function (article) {
      article = article || {};
      const image = article.image_url || article.image || article.thumbnail || '';
      return {
        url: article.url || article.link || '',
        link: article.url || article.link || '',
        title: article.title || '',
        snippet: article.snippet || article.summary || article.description || '',
        image: image,
        image_url: image,
        published: article.published || article.pubDate || article.published_at,
        content: article.content || '',
        source_id: article.source_id || (article.source && article.source.id) || '',
        source_title: article.sourceTitle || article.source_title || (article.source && article.source.title) || '',
        article_data: article
      };
    },

    starArticle: async function (articleData) {
      const res = await fetch(getApiBase() + '/api/articles/star', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(articleData)
      });
      const data = await res.json();
      if (!res.ok || data.status === 'error') throw new Error(data.message || 'Failed to star article');
      return data;
    },

    unstarArticle: async function (articleId, url, extra) {
      const res = await fetch(getApiBase() + '/api/articles/unstar', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(Object.assign({ article_id: articleId, url: url }, extra || {}))
      });
      const data = await res.json();
      if (!res.ok || data.status === 'error') throw new Error(data.message || 'Failed to unstar article');
      return data;
    },

    saveArticle: async function (articleData) {
      const res = await fetch(getApiBase() + '/api/articles/save', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(articleData)
      });
      const data = await res.json();
      if (!res.ok || data.status === 'error') throw new Error(data.message || 'Failed to save article');
      return data;
    },

    unsaveArticle: async function (articleId, url, extra) {
      const res = await fetch(getApiBase() + '/api/articles/unsave', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(Object.assign({ article_id: articleId, url: url }, extra || {}))
      });
      const data = await res.json();
      if (!res.ok || data.status === 'error') throw new Error(data.message || 'Failed to unsave article');
      return data;
    },

    markArticleRead: async function (articleData) {
      const res = await fetch(getApiBase() + '/api/articles/read', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(articleData)
      });
      return await res.json();
    },

    getStarredArticles: async function () {
      const res = await fetch(getApiBase() + '/api/articles/starred', {
        headers: this.getAuthHeaders()
      });
      return await res.json();
    },

    getSavedArticles: async function () {
      const res = await fetch(getApiBase() + '/api/articles/saved', {
        headers: this.getAuthHeaders()
      });
      return await res.json();
    },

    getStream: async function (options) {
      options = options || {};
      const params = new URLSearchParams();
      if (options.limit) params.set('limit', String(options.limit));
      if (options.folderId) params.set('folder_id', options.folderId);
      if (options.cursor) params.set('cursor', options.cursor);
      if (options.channel) params.set('channel', options.channel);
      if (options.urls) params.set('urls', options.urls);
      const res = await fetch(getApiBase() + '/api/stream?' + params.toString(), {
        headers: this.getAuthHeaders()
      });
      return await res.json();
    },

    getCatalog: async function () {
      const res = await fetch(getApiBase() + '/api/catalog', {
        headers: this.getAuthHeaders()
      });
      return await res.json();
    },

    followFeed: async function (payload) {
      const res = await fetch(getApiBase() + '/api/subscriptions', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to follow feed');
      }
      return data;
    },

    getSubscriptions: async function () {
      const res = await fetch(getApiBase() + '/api/subscriptions', {
        headers: this.getAuthHeaders()
      });
      return await res.json();
    },

    unfollowFeed: async function (id) {
      const res = await fetch(getApiBase() + '/api/subscriptions/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });
      return await res.json();
    },

    getFolders: async function () {
      const res = await fetch(getApiBase() + '/api/folders', {
        headers: this.getAuthHeaders()
      });
      return await res.json();
    },

    createFolder: async function (payload) {
      const res = await fetch(getApiBase() + '/api/folders', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to create folder');
      }
      return data;
    },

    assignFeedToFolder: async function (folderId, sourceId) {
      const res = await fetch(getApiBase() + '/api/folders/' + encodeURIComponent(folderId) + '/feeds', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ source_id: sourceId, feed_id: sourceId })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to assign feed');
      }
      return data;
    },

    starArticle: async function (payload) {
      const res = await fetch(getApiBase() + '/api/articles/star', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload || {})
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to star article');
      }
      return data;
    },

    clearGuestDemo: function () {
      try { sessionStorage.removeItem(GUEST_FOLLOWS_KEY); } catch (e) {}
      try { localStorage.removeItem(GUEST_FOLLOWS_KEY); } catch (e) {}
    },

    getGuestFollows: function () {
      if (this.isAuthenticated()) return [];
      try {
        let raw = localStorage.getItem(GUEST_FOLLOWS_KEY);
        if (!raw) raw = sessionStorage.getItem(GUEST_FOLLOWS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
      } catch (e) {
        return [];
      }
    },

    setGuestFollows: function (list) {
      if (this.isAuthenticated()) {
        this.clearGuestDemo();
        return;
      }
      try {
        const json = JSON.stringify(Array.isArray(list) ? list : []);
        localStorage.setItem(GUEST_FOLLOWS_KEY, json);
        sessionStorage.setItem(GUEST_FOLLOWS_KEY, json);
      } catch (e) {}
    },

    mergeGuestSubscriptions: async function () {
      this.clearGuestDemo();
    },

    deleteAccount: async function (email) {
      const res = await fetch(getApiBase() + '/api/auth/account', {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ email: email })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to delete account');
      }
      this._clearSession();
      return data;
    },

    _setSession: function (token, user) {
      try {
        localStorage.removeItem(GUEST_KEY);
        this.clearGuestDemo();
        if (token) localStorage.setItem(TOKEN_KEY, token);
        const normalized = normalizeUser(user);
        if (normalized) {
          localStorage.setItem(USER_KEY, JSON.stringify(normalized));
        }
        this._notifyStateChange(normalized);
        return;
      } catch (e) {}
      this._notifyStateChange(user);
    },

    _clearSession: function () {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(GUEST_KEY);
        this.clearGuestDemo();
      } catch (e) {}
      this._notifyStateChange(null);
    },

    _notifyStateChange: function (user) {
      const normalized = normalizeUser(user);
      const event = new CustomEvent('feedometer:auth_change', { detail: { user: normalized } });
      window.dispatchEvent(event);
      try {
        if (window.parent && window.parent !== window) {
          window.parent.dispatchEvent(new CustomEvent('feedometer:auth_change', { detail: { user: normalized } }));
        }
      } catch (e) {}
      try {
        const frame = document.getElementById('rv-shell-frame');
        if (frame && frame.contentWindow) {
          frame.contentWindow.dispatchEvent(new CustomEvent('feedometer:auth_change', { detail: { user: normalized } }));
        }
      } catch (e) {}
    }
  };

  global.FeedOmeterAuth = FeedOmeterAuth;

  window.addEventListener('storage', function (e) {
    if (e.key === USER_KEY || e.key === TOKEN_KEY) {
      const user = FeedOmeterAuth.getUser();
      FeedOmeterAuth._notifyStateChange(user);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    FeedOmeterAuth.checkSession();
  });
})(typeof window !== 'undefined' ? window : this);
