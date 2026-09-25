/**
 * workers/lib/search-query.js — Server-side query understanding
 * Used by Find Feeds, article search, and other Worker search routes.
 * Not shipped to the browser.
 */

export function hasExplicitBooleanOperators(query) {
  if (!query || typeof query !== 'string') return false;
  return /\b(AND|OR|NOT)\b|[()"'!|+]/.test(query) || /(?:^|\s)-[a-zA-Z0-9]/.test(query);
}

export function normalizeSearchQuery(query) {
  if (!query || typeof query !== 'string') return '';
  return query
    .toLowerCase()
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Everyday variants: original + closed-compound join for two tokens.
 * Three-or-more words: join each adjacent pair into the phrase (not one megaword).
 */
export function generateQueryVariants(query) {
  const normalized = normalizeSearchQuery(query);
  const variants = [];
  const seen = new Set();

  function add(v) {
    const s = String(v || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    variants.push(s);
  }

  if (!normalized) return variants;
  add(normalized);

  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 2) {
    add(words.join(''));
  } else if (words.length > 2 && words.length <= 5) {
    for (let i = 0; i < words.length - 1; i++) {
      const a = words[i];
      const b = words[i + 1];
      if (a.length < 3 || b.length < 3) continue;
      const copy = words.slice();
      copy.splice(i, 2, a + b);
      add(copy.join(' '));
    }
  }

  return variants.slice(0, 5);
}

export function variantBoost(variant, originalNormalized) {
  if (!variant) return 0.5;
  if (variant === originalNormalized) return 1;
  return 0.85;
}

/**
 * Single entry point for all Worker search routes.
 */
export function prepareSearchQueries(rawQuery) {
  const original = String(rawQuery || '').trim();
  const normalized = normalizeSearchQuery(original);
  const useBoolean = hasExplicitBooleanOperators(original);

  if (!normalized) {
    return {
      original,
      normalized: '',
      useBoolean: false,
      variants: []
    };
  }

  if (useBoolean) {
    return {
      original,
      normalized,
      useBoolean: true,
      variants: [normalized]
    };
  }

  return {
    original,
    normalized,
    useBoolean: false,
    variants: generateQueryVariants(normalized)
  };
}
