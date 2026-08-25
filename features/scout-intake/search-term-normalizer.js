'use strict';

// search-term-normalizer.js — one place that turns messy term input (LLM
// output, textarea strings, arrays that were stringified somewhere upstream)
// into a clean list of short search terms.
//
// WHY (2026-08-20, clairecalls incident): the scout config generator accepted
// the LLM's categoryTerms array with no per-term validation, and the Market
// Signals save route's splitTerms did `String(input).split(/[\n,]+/)` — so an
// ARRAY input was comma-joined then re-split, shredding a prose paragraph into
// fragments ("walking", "or commuting checking in on a parent…") while keeping
// a 40-word blob as one "term". Reddit/Instagram searches built from that
// vocabulary returned zero results, the relevance filter had no usable
// category terms, and the client's email sections rendered empty. A search
// term is 1–4 short words; anything longer is prose and must be dropped, not
// searched.

const MAX_TERM_CHARS = 40;
const MAX_TERM_WORDS = 4;

/**
 * @param {string|string[]} input - array of terms, or a newline/comma-joined string
 * @param {object} [opts]
 * @param {number} [opts.max=12]       - cap on returned terms
 * @param {number} [opts.maxWords=4]   - terms with more words are prose → dropped
 * @param {number} [opts.maxChars=40]  - terms longer than this are prose → dropped
 * @returns {string[]} trimmed, deduped (case-insensitive), prose-free terms
 */
function normalizeSearchTerms(input, { max = 12, maxWords = MAX_TERM_WORDS, maxChars = MAX_TERM_CHARS } = {}) {
  const rawPieces = (Array.isArray(input) ? input : [input])
    // Split every piece on newlines/commas/semicolons — even array entries:
    // an entry containing separators is itself a joined list, never one term.
    .flatMap((piece) => String(piece ?? '').split(/[\n,;]+/));

  const seen = new Set();
  const out = [];
  for (const raw of rawPieces) {
    const term = raw
      .replace(/\s+/g, ' ')
      .trim()
      // A leading conjunction/article is a splitting artifact ("or commuting…"),
      // never the start of a deliberate search term.
      .replace(/^(?:and|or|the|a|an)\s+/i, '')
      .trim();
    if (!term) continue;
    if (term.length > maxChars) continue;             // prose, not a term
    if (term.split(' ').length > maxWords) continue;  // prose, not a term
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

module.exports = { normalizeSearchTerms, MAX_TERM_CHARS, MAX_TERM_WORDS };
