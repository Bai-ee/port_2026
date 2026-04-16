// contentExtractability.js — Analyzes content structure for AI extractability.
//
// Checks:
//   - Heading structure (H1 presence, H2 coverage, deep nesting)
//   - Answer-first openers (does each H2 section lead with the answer?)
//   - Chunk quality (paragraph focus ratio)
//   - JS-dependency (dual-fetch via playwright; falls back to ratio heuristic)
//
// Public API:
//   analyzeContent({ websiteUrl, html, signal })
//     → { score, headings, answerFirst, chunks, jsDependency }

import * as cheerio from 'cheerio';
import { dualFetch } from './utils/playwrightFetch.js';

// ── Heading analysis ──────────────────────────────────────────────────────────

function analyzeHeadings(html) {
  const $ = cheerio.load(html);

  const h1Count      = $('h1').length;
  const h2Count      = $('h2').length;
  const h3Count      = $('h3').length;
  const h4PlusCount  = $('h4, h5, h6').length;

  const issues = [];
  if (h1Count === 0)                           issues.push('no-h1');
  if (h1Count > 1)                             issues.push('multiple-h1');
  if (h2Count === 0 && h3Count === 0)          issues.push('no-subheadings');
  if (h4PlusCount > 0 && h2Count === 0 && h3Count === 0) issues.push('deep-nesting-without-hierarchy');

  let score = 100;
  if (issues.includes('no-h1'))                         score -= 30;
  if (issues.includes('multiple-h1'))                   score -= 15;
  if (issues.includes('no-subheadings'))                score -= 30;
  if (issues.includes('deep-nesting-without-hierarchy')) score -= 15;

  return {
    score: Math.max(score, 0),
    issues,
    h1Count, h2Count, h3Count, h4PlusCount,
  };
}

// ── Answer-first heuristic ────────────────────────────────────────────────────

const HEDGE_PHRASES = [
  /^in this (section|article|post|guide|piece)/i,
  /^we (will|are going to) (discuss|explore|look at|cover|walk)/i,
  /^this (section|article|guide|post|piece)/i,
  /^(here|below) (we|you|I|are)/i,
  /^today (we|I|you)/i,
  /^let'?s (take a look|explore|discuss|dive)/i,
];

function isHedged(text) {
  return HEDGE_PHRASES.some((re) => re.test(text.trim()));
}

function analyzeAnswerFirst(html) {
  const $ = cheerio.load(html);
  const sections = [];

  $('h2').each((_, h2El) => {
    let next = $(h2El).next();
    // Skip non-content siblings (divs, asides, etc.) until a paragraph or list
    while (next.length && !next.is('p, ul, ol, blockquote')) {
      next = next.next();
    }
    if (!next.length) return;

    const text = next.text().trim();
    if (!text) return;

    sections.push({
      heading:     $(h2El).text().trim(),
      answerFirst: !isHedged(text),
    });
  });

  if (sections.length === 0) return { score: 50, ratio: null, sections };

  const answerFirstCount = sections.filter((s) => s.answerFirst).length;
  const ratio            = answerFirstCount / sections.length;

  // ≥80% → 100; 50–79% → 70; <50% → 30
  const score = ratio >= 0.8 ? 100 : ratio >= 0.5 ? 70 : 30;

  return { score, ratio, sections };
}

// ── Chunk quality ─────────────────────────────────────────────────────────────

function analyzeChunkQuality(html) {
  const $ = cheerio.load(html);
  const paragraphs = [];

  $('p').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 30) paragraphs.push(text);
  });

  if (paragraphs.length === 0) return { score: 30, paragraphCount: 0, focusedCount: 0 };

  // "Focused" = digestible for AI extraction: not too short, not a wall of text
  const focusedCount = paragraphs.filter((p) => p.length >= 50 && p.length <= 700).length;
  const ratio        = focusedCount / paragraphs.length;
  const score        = Math.round(ratio * 100);

  return { score, paragraphCount: paragraphs.length, focusedCount };
}

// ── JS-dependency (dual-fetch with playwright fallback) ───────────────────────

async function analyzeJsDependency({ websiteUrl, html, signal }) {
  try {
    return await dualFetch({ url: websiteUrl, signal });
  } catch (err) {
    // Playwright unavailable or fetch failed — fall back to text/HTML ratio heuristic
    const $ = cheerio.load(html);
    const textLen = $('body').text().trim().length;
    const htmlLen = html.length;
    const ratio   = htmlLen > 0 ? textLen / htmlLen : 0;

    // Higher ratio → more SSR content → less JS-dependent
    const score = ratio > 0.15 ? 80 : ratio > 0.05 ? 50 : 30;

    return { score, jsDepWords: null, wordsOff: null, wordsOn: null, fallback: true, fallbackReason: err.message };
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeContent({ websiteUrl, html, signal }) {
  const headings    = analyzeHeadings(html);
  const answerFirst = analyzeAnswerFirst(html);
  const chunks      = analyzeChunkQuality(html);
  const jsDep       = await analyzeJsDependency({ websiteUrl, html, signal });

  // Composite score: weighted
  const score = Math.round(
    headings.score    * 0.25 +
    answerFirst.score * 0.35 +
    chunks.score      * 0.20 +
    jsDep.score       * 0.20
  );

  return {
    score,
    headings,
    answerFirst,
    chunks,
    jsDependency: jsDep,
  };
}
