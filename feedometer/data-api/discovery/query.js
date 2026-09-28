/** SQL-backed feed discovery: query understanding (no provider calls). */
function normalizeQuery(query) { return String(query || '').toLowerCase().replace(/[!?.,;:]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function hasExplicitBooleanOperators(query) { const value = String(query || ''); return /\b(AND|OR|NOT)\b|[()"'!|+]/i.test(value) || /(?:^|\s)-[a-zA-Z0-9]/.test(value); }
function generateQueryVariants(query) {
  const normalized = normalizeQuery(query); if (!normalized) return [];
  const variants = [normalized]; const words = normalized.split(' ').filter(Boolean);
  if (words.length === 2) variants.push(words.join(''));
  else if (words.length > 2 && words.length <= 5) for (let i = 0; i < words.length - 1; i += 1) {
    if (words[i].length < 3 || words[i + 1].length < 3) continue;
    const combined = words.slice(); combined.splice(i, 2, words[i] + words[i + 1]); variants.push(combined.join(' '));
  }
  return [...new Set(variants)].slice(0, 5);
}
function prepareSearchQueries(rawQuery) {
  const original = String(rawQuery || '').trim(); const normalized = normalizeQuery(original); const useBoolean = hasExplicitBooleanOperators(original);
  return { original, normalized, useBoolean, variants: normalized ? (useBoolean ? [normalized] : generateQueryVariants(normalized)) : [] };
}
function matchesBooleanQuery(rawQuery, text) {
  const normalizedText = normalizeQuery(text); const expression = String(rawQuery || '').trim(); if (!expression) return true;
  if (!hasExplicitBooleanOperators(expression)) return normalizeQuery(expression).split(' ').every((term) => normalizedText.includes(term));
  return expression.split(/\s+(?:OR|\|)\s+/i).some((group) => group.split(/\s+(?:AND|\+)\s+/i).every((part) => {
    const term = part.trim(); if (!term) return true; const negated = /^(?:NOT\s+|!|-)/i.test(term);
    const clean = normalizeQuery(term.replace(/^(?:NOT\s+|!|-)/i, '').replace(/[()"']/g, '')); const found = clean ? normalizedText.includes(clean) : true;
    return negated ? !found : found;
  }));
}
// Ordinary multi-word searches must be relevant too.  For example, users may
// write "basket ball" while a source calls the sport "basketball".  Treat the
// generated normalised forms as alternatives, while retaining exact Boolean
// semantics whenever the user deliberately supplied Boolean operators.
function matchesPreparedQuery(prepared, text) {
  if (!prepared || !prepared.normalized) return true;
  if (prepared.useBoolean) return matchesBooleanQuery(prepared.original, text);
  return (prepared.variants || [prepared.normalized]).some((variant) => matchesBooleanQuery(variant, text));
}
module.exports = { normalizeQuery, hasExplicitBooleanOperators, generateQueryVariants, prepareSearchQueries, matchesBooleanQuery, matchesPreparedQuery };
