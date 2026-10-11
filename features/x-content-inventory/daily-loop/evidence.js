// Evidence behind a suggestion: what the owner's own history earned on a topic/type,
// and what saved strategy/benchmark say about today's selection.
// Decides evidence rows and selection limits; never ranks conversations or writes copy.
// Depends on config and text only.

import { tagTopics, UNTAGGED } from '../../x-benchmark/taxonomy.js';
import { MIN_EVIDENCE_N, MAX_SUGGESTIONS } from './config.js';
import { tokenize } from './text.js';

/** What the owner's own history says about this topic and contribution type. */
export function performanceEvidence({ narrative, type, ownSummary }) {
  if (!ownSummary) return { available: false, note: 'No own-account corpus loaded — no performance evidence.', topics: [], type: null };
  const topics = tagTopics(narrative.text).filter((t) => t !== UNTAGGED);
  const typeKey = type === 'quote' ? 'quote-react' : type === 'reply' ? 'reply' : 'original-showcase';
  const row = (b) => (b ? { n: b.n, lift: b.lift, weak: b.n < MIN_EVIDENCE_N } : null);
  const topicRows = topics.map((t) => ({ topic: t, ...(row(ownSummary.byTopic?.[t]) || { n: 0, lift: null, weak: true }) }));
  const typeRow = row(ownSummary.byType?.[typeKey]);
  const strong = topicRows.filter((t) => !t.weak && t.lift != null);
  const best = strong.sort((a, b) => b.lift - a.lift)[0];
  return {
    available: true,
    range: ownSummary.range || null,
    topics: topicRows,
    type: typeRow ? { key: typeKey, ...typeRow } : { key: typeKey, n: 0, lift: null, weak: true },
    score: best ? Math.min(1, best.lift / 2) : 0,
    note: !topics.length
      ? 'Conversation does not map to any topic in the shared taxonomy — no topic evidence.'
      : strong.length ? null : 'Topic evidence is thin (n < 10) — treat as untested, not as a finding.',
  };
}

// --- strategy --------------------------------------------------------------------

/**
 * Selection decisions from saved strategy. The benchmark report is measured
 * evidence about post TYPES for this account — not an instruction to copy the
 * benchmark's identity. A Strategy Builder plan that does not cover today is
 * reported and ignored, never followed.
 */
export function deriveStrategy({ benchmark = null, strategyPlan = null, localDate, max = MAX_SUGGESTIONS } = {}) {
  const notes = [];
  const gaps = [];
  const types = {};
  for (const g of benchmark?.gaps || []) {
    if (typeof g.id === 'string' && g.id.startsWith('type-mix:')) types[g.id.slice(9)] = { direction: g.direction || null, lift: g.lift ?? null };
  }
  let maxQuotes = max;
  if (['quote-react', 'quote-commentary'].some((t) => types[t]?.direction === 'decrease')) {
    maxQuotes = 1;
    notes.push('benchmark: long quote captions under-perform for this account — at most one quote, kept to a short reaction');
  }
  const showcase = types['original-showcase'];
  const includeShowcase = !!showcase && ['hold', 'increase'].includes(showcase.direction) && (showcase.lift ?? 0) >= 1;
  if (includeShowcase) notes.push(`benchmark: original-showcase earns ${showcase.lift}× this account's average`);
  if (!benchmark) gaps.push({ code: 'no-benchmark', message: 'No benchmark report — selection used defaults.' });

  let plan = { active: false, terms: [] };
  if (strategyPlan) {
    const dates = new Set();
    if (strategyPlan.today?.date) dates.add(strategyPlan.today.date);
    for (const it of strategyPlan.items || []) if (typeof it.scheduledAt === 'string') dates.add(it.scheduledAt.slice(0, 10));
    const sorted = [...dates].sort();
    plan = { active: false, terms: [], generatedAt: strategyPlan.generatedAt || null, from: sorted[0] || null, to: sorted[sorted.length - 1] || null };
    if (strategyPlan.excluded) {
      gaps.push({ code: 'strategy-excluded', message: `Strategy Builder plan excluded: ${strategyPlan.excluded}` });
    } else if (dates.has(localDate)) {
      const items = (strategyPlan.items || []).filter((it) => String(it.scheduledAt || '').slice(0, 10) === localDate);
      plan = { ...plan, active: true, terms: [...new Set(tokenize(items.map((i) => i.content).join(' ')))].slice(0, 40) };
      notes.push(`strategy plan: ${items.length} planned item(s) today`);
    } else {
      gaps.push({ code: 'strategy-stale', message: `Strategy Builder plan covers ${plan.from || '?'} → ${plan.to || '?'}, not ${localDate}; ignored.` });
    }
  } else {
    gaps.push({ code: 'no-strategy-plan', message: 'No usable Strategy Builder plan.' });
  }
  return { decisions: { maxQuotes, includeShowcase }, typeDirections: types, plan, notes, gaps };
}
