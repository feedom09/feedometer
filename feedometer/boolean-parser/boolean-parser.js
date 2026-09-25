/**
 * boolean-parser/boolean-parser.js — FeedOmeter 2.1 Universal Boolean Query Parser
 * Zero-dependency, High-Performance AST Boolean Evaluation Engine
 * 
 * Supports:
 * - Grouping: Parentheses ( ... ) with arbitrary nested depth
 * - Exact Phrases: Quoted strings "apple intelligence", 'gpt 5'
 * - Negation / Exclusion: NOT term, -term, !"phrase"
 * - Conjunction: AND, +, or implicit whitespace / comma
 * - Disjunction: OR, |
 * - Auto-healing: Unclosed quotes, unmatched parens
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.BooleanParser = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  const TOKEN_TERM = 'TERM';
  const TOKEN_PHRASE = 'PHRASE';
  const TOKEN_AND = 'AND';
  const TOKEN_OR = 'OR';
  const TOKEN_NOT = 'NOT';
  const TOKEN_LPAREN = 'LPAREN';
  const TOKEN_RPAREN = 'RPAREN';

  function hasExplicitBooleanOperators(query) {
    if (!query || typeof query !== 'string') return false;
    return /\b(AND|OR|NOT)\b|[()"'!|+]/.test(query) || /(?:^|\s)-[a-zA-Z0-9]/.test(query);
  }

  function normalizeQuery(query) {
    if (!query || typeof query !== 'string') return '';
    const q = query.trim();
    if (!q) return '';
    if (hasExplicitBooleanOperators(q)) {
      return q;
    }
    // Convert implicit terms to AND conjunction
    const clean = q.replace(/,/g, ' ');
    const terms = clean.split(/\s+/).filter(Boolean);
    return terms.join(' AND ');
  }

  function tokenize(query) {
    if (!query || typeof query !== 'string') return [];
    const q = normalizeQuery(query);
    const tokens = [];
    let i = 0;
    const len = q.length;

    while (i < len) {
      const ch = q[i];

      if (/\s/.test(ch) || ch === ',') {
        i++;
        continue;
      }

      if (ch === '(') {
        tokens.push({ type: TOKEN_LPAREN, val: '(' });
        i++;
        continue;
      }
      if (ch === ')') {
        tokens.push({ type: TOKEN_RPAREN, val: ')' });
        i++;
        continue;
      }

      // Quoted Exact Phrases ("phrase" or 'phrase')
      if (ch === '"' || ch === "'") {
        const quoteChar = ch;
        i++;
        let phrase = '';
        while (i < len && q[i] !== quoteChar) {
          phrase += q[i];
          i++;
        }
        if (i < len && q[i] === quoteChar) i++; // consume closing quote
        tokens.push({ type: TOKEN_PHRASE, val: phrase.toLowerCase() });
        continue;
      }

      // Operators: OR, AND, NOT, +, |, !, -
      if (ch === '|') {
        tokens.push({ type: TOKEN_OR, val: 'OR' });
        i++;
        continue;
      }
      if (ch === '+') {
        tokens.push({ type: TOKEN_AND, val: 'AND' });
        i++;
        continue;
      }
      if (ch === '!') {
        tokens.push({ type: TOKEN_NOT, val: 'NOT' });
        i++;
        continue;
      }
      if (ch === '-' && i + 1 < len && !/\s/.test(q[i + 1])) {
        tokens.push({ type: TOKEN_NOT, val: 'NOT' });
        i++;
        continue;
      }

      // Read Word / Token
      let word = '';
      while (i < len && !/[\s,()"'!|+]/.test(q[i])) {
        word += q[i];
        i++;
      }

      const upper = word.toUpperCase();
      if (upper === 'AND') {
        tokens.push({ type: TOKEN_AND, val: 'AND' });
      } else if (upper === 'OR') {
        tokens.push({ type: TOKEN_OR, val: 'OR' });
      } else if (upper === 'NOT') {
        tokens.push({ type: TOKEN_NOT, val: 'NOT' });
      } else if (word) {
        tokens.push({ type: TOKEN_TERM, val: word.toLowerCase() });
      }
    }

    return tokens;
  }

  // Recursive Descent Parser -> AST
  function parseAST(tokens) {
    let pos = 0;

    function peek() {
      return tokens[pos] || null;
    }

    function consume(expectedType) {
      const tok = peek();
      if (!tok) return null;
      if (expectedType && tok.type !== expectedType) return null;
      pos++;
      return tok;
    }

    // Expression: Term (OR Term)*
    function parseOrExpr() {
      let left = parseAndExpr();
      while (peek() && peek().type === TOKEN_OR) {
        consume(TOKEN_OR);
        const right = parseAndExpr();
        left = { type: 'OR', left, right };
      }
      return left;
    }

    // Term: Factor (AND Factor)*
    function parseAndExpr() {
      let left = parseNotExpr();
      while (peek() && (peek().type === TOKEN_AND || peek().type === TOKEN_TERM || peek().type === TOKEN_PHRASE || peek().type === TOKEN_LPAREN || peek().type === TOKEN_NOT)) {
        if (peek().type === TOKEN_AND) consume(TOKEN_AND);
        const right = parseNotExpr();
        if (right) {
          left = { type: 'AND', left, right };
        }
      }
      return left;
    }

    // Not Expression: NOT Factor
    function parseNotExpr() {
      if (peek() && peek().type === TOKEN_NOT) {
        consume(TOKEN_NOT);
        const operand = parsePrimary();
        return { type: 'NOT', operand };
      }
      return parsePrimary();
    }

    // Primary: TERM | PHRASE | ( Expr )
    function parsePrimary() {
      const tok = peek();
      if (!tok) return null;

      if (tok.type === TOKEN_LPAREN) {
        consume(TOKEN_LPAREN);
        const expr = parseOrExpr();
        if (peek() && peek().type === TOKEN_RPAREN) consume(TOKEN_RPAREN);
        return expr;
      }

      if (tok.type === TOKEN_TERM) {
        consume(TOKEN_TERM);
        return { type: 'TERM', value: tok.val };
      }

      if (tok.type === TOKEN_PHRASE) {
        consume(TOKEN_PHRASE);
        return { type: 'PHRASE', value: tok.val };
      }

      // Unknown fallback
      pos++;
      return null;
    }

    return parseOrExpr();
  }

  // Evaluates AST against target text
  function evaluateAST(ast, targetText) {
    if (!ast) return true;
    const text = (targetText || '').toLowerCase();

    switch (ast.type) {
      case 'TERM':
        return text.includes(ast.value);
      case 'PHRASE':
        return text.includes(ast.value);
      case 'AND':
        return evaluateAST(ast.left, text) && evaluateAST(ast.right, text);
      case 'OR':
        return evaluateAST(ast.left, text) || evaluateAST(ast.right, text);
      case 'NOT':
        return !evaluateAST(ast.operand, text);
      default:
        return true;
    }
  }

  return {
    tokenize,
    parse(query) {
      const tokens = tokenize(query);
      return parseAST(tokens);
    },
    matches(query, targetTextOrFields) {
      if (!query || !query.trim()) return true;
      let text = '';
      if (typeof targetTextOrFields === 'string') {
        text = targetTextOrFields;
      } else if (Array.isArray(targetTextOrFields)) {
        text = targetTextOrFields.filter(Boolean).join(' ');
      } else if (typeof targetTextOrFields === 'object' && targetTextOrFields !== null) {
        text = Object.values(targetTextOrFields).filter(v => typeof v === 'string').join(' ');
      }
      const ast = this.parse(query);
      return evaluateAST(ast, text);
    },
    filter(query, items, textExtractor) {
      if (!query || !query.trim()) return items;
      const ast = this.parse(query);
      return items.filter(item => {
        const text = textExtractor ? textExtractor(item) : JSON.stringify(item);
        return evaluateAST(ast, text);
      });
    }
  };

  return BooleanParser;
}));

// Worker services import the parser as an ES module. Browser pages load this
// same file with type="module", while the UMD wrapper also exposes
// globalThis.BooleanParser for legacy browser consumers.
export default (typeof BooleanParser !== 'undefined' ? BooleanParser : globalThis.BooleanParser);
