// Chooses up to MAX_SUGGESTIONS (no copy yet). selectForSlots walks today's strategy
// slots in order and calls each slot's filler; selectSuggestions is the older
// conversation-first ranking, used when no slots are given.
// Decides what to suggest and why; never writes copy, schedules, or touches I/O.
// Pure; depends on every analysis module upstream.

import { DEFAULT_WINDOW_HOURS } from '../../x-quote-targets/rank.js';
import { MAX_SUGGESTIONS, DEFAULT_TIMEZONE, MIN_BRAND_FIT, CONVERSATION_MAX_AGE_HOURS, REPLY_WINDOW_HOURS, SLOT_TIMES } from './config.js';
import { phraseHits, tokenize, WEAK_TERMS, packageTerms, packagePhrases, isRealStory } from './text.js';
import { contentBasis, packageEligibility, INELIGIBLE_REASONS } from './content-basis.js';
import { buildBrandProfile, brandFit, brandFitApplies } from './brand.js';
import { groupNarratives } from './conversations.js';
import { performanceEvidence } from './evidence.js';
import { fillQuoteSlot, QUOTE_WINDOW_HOURS } from './fill-quote.js';
import { fillShowcaseSlot, fillTextSlot, fillSelfQuoteSlot } from './fill-original.js';
import { fillReplySlot } from './fill-reply.js';
import { suggestionIdFor, zonedTimeToIso } from './time-ids.js';

// --- content match -------------------------------------------------------------

export function matchScore(text, pkg = {}, pkgTerms = packageTerms(pkg), pkgPhrases = packagePhrases(pkg)) {
  const phrases = phraseHits(text, pkgPhrases);
  const terms = [];
  let score = phrases.reduce((n, p) => n + p.weight, 0);
  for (const t of new Set(tokenize(text))) {
    const w = pkgTerms.get(t);
    if (w && !WEAK_TERMS.has(t)) { terms.push(t); score += w; }
  }
  // Only a specific name (anchor phrase) — or two independent phrases — ties a
  // conversation to THIS item. A shared genre phrase alone is a weaker,
  // clearly labelled genre-level match.
  const specific = phrases.some((p) => p.anchor) || phrases.length >= 2;
  const genre = !specific && phrases.some((p) => p.kind === 'genre');
  if (!specific && !genre) return null;
  return { score, tier: specific ? 'specific' : 'genre', terms: terms.sort(), phrases: phrases.map((p) => p.phrase) };
}

// --- selection -------------------------------------------------------------------

function packageSnapshot(pkg, basis) {
  return {
    id: pkg.id,
    title: pkg.title || '',
    series: pkg.series || null,
    pillar: pkg.pillar || null,
    sourceKind: pkg.source?.kind || 'manual',
    sourceUrl: pkg.source?.url || null,
    mediaState: pkg.mediaState || 'none',
    rights: pkg.rights,
    basis: basis.kind,
    story: basis.story.slice(0, 600),
    facts: basis.facts,
    assetRefs: Array.isArray(pkg.assetRefs) ? pkg.assetRefs.slice(0, 4) : [],
    thumbRef: pkg.thumbRef || null,
    engine: pkg.engine || null,
  };
}

function conversationSnapshot(n) {
  return {
    id: n.id,
    label: n.label,
    momentum: n.momentum,
    sources: n.sources,
    posts: n.posts.slice(0, 4).map((p) => ({
      id: p.id, url: p.url, author: p.author, text: p.text.slice(0, 280), createdAt: p.createdAt,
      ageHours: p.m.ageHours, likes: p.likes, reposts: p.reposts, replies: p.replies, source: p.source,
    })),
  };
}

function pickContributionType(n, { quotesUsed, maxQuotes }) {
  const age = n.momentum.ageHours;
  const anchor = n.anchor;
  const conversational = /\?/.test(anchor.text) || anchor.replies >= 3;
  if (age <= REPLY_WINDOW_HOURS && conversational) return { type: 'reply', why: `thread is ${age}h old and active — a reply joins it directly` };
  if (age <= DEFAULT_WINDOW_HOURS && quotesUsed < maxQuotes) return { type: 'quote', why: `${age}h old, still being read (quote window ${DEFAULT_WINDOW_HOURS}h) — a quote borrows that audience` };
  if (age <= REPLY_WINDOW_HOURS) return { type: 'reply', why: `${age}h old — quote budget used, reply instead` };
  return { type: 'original', why: `${age}h old — past the quote window; contribute an original on the same topic instead` };
}

const brainLine = (brain) => (brain?.status === 'approved' ? 'voice from the approved Client Brain' : `Client Brain is ${brain?.status || 'missing'} — not used`);
const strategyLine = (strategy) => (strategy?.plan?.active ? 'today is covered by the saved strategy plan' : 'no current strategy plan — benchmark type evidence only');

/** Eligible library, brand profile and live narratives: the part both selectors share. */
function prepare({ packages, brain, conversationPosts, now, strategy }) {
  const gaps = [...(strategy?.gaps || [])];
  const eligible = [];
  const ineligible = {};
  const byBasis = { story: 0, facts: 0 };
  for (const pkg of packages) {
    const e = packageEligibility(pkg, { now });
    if (e.ok) { eligible.push(pkg); byBasis[e.basis] += 1; } else ineligible[e.reason] = (ineligible[e.reason] || 0) + 1;
  }
  for (const [reason, count] of Object.entries(ineligible)) {
    gaps.push({ code: `ineligible-${reason}`, count, message: `${count} item(s) skipped: ${INELIGIBLE_REASONS[reason] || reason}.` });
  }
  if (!eligible.length) gaps.push({ code: 'no-eligible-content', message: 'No library item passes the rights and grounding gates.' });

  const profile = buildBrandProfile({ packages: eligible, brain });
  const narratives = groupNarratives(conversationPosts, { now });
  if (!conversationPosts.length) gaps.push({ code: 'no-conversations', message: 'No saved scan or search results — nothing to join.' });
  else if (!narratives.length) gaps.push({ code: 'no-live-conversations', message: `No scanned post is under ${CONVERSATION_MAX_AGE_HOURS}h old with enough engagement.` });
  return { gaps, eligible, ineligible, byBasis, profile, narratives };
}

/**
 * Brand fit + owned-content match for each narrative. `ranked` can be joined with
 * owned content; `offBrand` and `noContent` are kept so a skip is a shown decision.
 * rank = 0.35 momentum + 0.35 brand fit + 0.20 owned-content fit + 0.10 own history
 */
function rankNarratives({ narratives, eligible, profile, ownSummary }) {
  const termsById = new Map(eligible.map((p) => [p.id, packageTerms(p)]));
  const phrasesById = new Map(eligible.map((p) => [p.id, packagePhrases(p)]));
  const ranked = [];
  const offBrand = [];
  const noContent = [];
  for (const n of narratives) {
    const fit = brandFit(n, profile);
    if (fit.blockedLane || fit.score < MIN_BRAND_FIT) { offBrand.push({ n, fit }); continue; }
    const candidates = [];
    for (const pkg of eligible) {
      const m = matchScore(n.text, pkg, termsById.get(pkg.id), phrasesById.get(pkg.id));
      if (m) candidates.push({ pkg, m });
    }
    if (!candidates.length) { noContent.push({ n, fit }); continue; }
    // Specific names first; genre-level ties prefer items with media.
    candidates.sort((a, b) => (a.m.tier === b.m.tier ? 0 : a.m.tier === 'specific' ? -1 : 1)
      || b.m.score - a.m.score
      || Number(b.pkg.mediaState === 'video') - Number(a.pkg.mediaState === 'video')
      || String(a.pkg.id).localeCompare(String(b.pkg.id)));
    const best = candidates[0];
    const contentScore = Math.min(1, best.m.score / 6) * (best.m.tier === 'genre' ? 0.5 : 1);
    ranked.push({ n, fit, best, candidates, contentScore });
  }
  const scored = ranked.map((r) => {
    const provisional = performanceEvidence({ narrative: r.n, type: 'quote', ownSummary });
    return { ...r, rank: 0.35 * r.n.momentum.score + 0.35 * r.fit.score + 0.2 * r.contentScore + 0.1 * (provisional.score || 0) };
  }).sort((a, b) => b.rank - a.rank);
  return { scored, offBrand, noContent };
}

/** Offbrand / no-content gap rows and the shortlist, identical for both selectors. */
function skippedGaps({ offBrand, noContent }) {
  const gaps = [];
  if (offBrand.length) {
    gaps.push({
      code: 'off-brand-conversations',
      count: offBrand.length,
      message: `${offBrand.length} active conversation(s) skipped as off-brand or out of lane (e.g. ${offBrand.slice(0, 3).map(({ n, fit }) => `@${n.anchor.author} — ${fit.reason || 'weak overlap'}`).join('; ')}).`,
    });
  }
  if (noContent.length) {
    gaps.push({
      code: 'conversations-without-content',
      count: noContent.length,
      message: `${noContent.length} on-brand conversation(s) had no owned item to ground a contribution — left as gaps, not forced (e.g. ${noContent.slice(0, 2).map(({ n }) => n.label.join(' ')).join('; ')}).`,
      conversations: noContent.slice(0, 3).map(({ n }) => conversationSnapshot(n)),
    });
  }
  return gaps;
}

function shortlistOf({ scored, offBrand, noContent }) {
  return [
    ...scored.slice(0, 6).map((r) => ({ id: r.n.id, label: r.n.label, anchor: r.n.anchor.url, rank: Number(r.rank.toFixed(3)), brandFit: r.fit.score, content: r.best.pkg.id })),
    // Skipped conversations stay visible with the reason, so a rejected viral
    // post is a shown decision, not a silent drop. `skipped` marks them.
    ...[...offBrand.map((x) => ({ ...x, skipped: 'off-brand', reason: x.fit.reason || 'weak overlap' })),
      ...noContent.map((x) => ({ ...x, skipped: 'no-content', reason: 'on-brand, but no owned item to ground it' }))]
      .sort((a, b) => b.n.momentum.score - a.n.momentum.score).slice(0, 6)
      .map((x) => ({ id: x.n.id, label: x.n.label.length ? x.n.label : ['image only'], anchor: x.n.anchor.url, rank: 0, brandFit: x.fit.score, content: null, skipped: x.skipped, reason: x.reason })),
  ];
}

function brandProfileOf(profile) {
  return { sources: profile.sources, topPhrases: [...profile.phrases.entries()].sort((a, b) => b[1].items - a[1].items || b[1].weight - a[1].weight).slice(0, 15).map(([p]) => p) };
}

function statsOf({ packages, eligible, byBasis, ineligible, conversationPosts, narratives, scored, offBrand, noContent }) {
  return {
    packages: packages.length,
    eligible: eligible.length,
    eligibleByBasis: byBasis,
    ineligible,
    conversationPosts: conversationPosts.length,
    narratives: narratives.length,
    onBrandWithContent: scored.length,
    offBrand: offBrand.length,
    withoutContent: noContent.length,
  };
}

/**
 * Rank conversations and choose up to `max` suggestions (no copy yet). Pure.
 * With `slots` (slots.js planSlots output) this delegates to selectForSlots.
 */
export function selectSuggestions(input = {}) {
  if (Array.isArray(input.slots)) return selectForSlots(input);
  const {
    clientId, localDate, timezone = DEFAULT_TIMEZONE, now = Date.now(),
    conversationPosts = [], packages = [], brain = null, strategy, ownSummary = null, max = MAX_SUGGESTIONS,
  } = input;
  const limit = Math.max(0, Math.min(MAX_SUGGESTIONS, Number(max) || MAX_SUGGESTIONS));
  const decisions = strategy?.decisions || { maxQuotes: limit, includeShowcase: false };

  const { gaps, eligible, ineligible, byBasis, profile, narratives } = prepare({ packages, brain, conversationPosts, now, strategy });
  const { scored, offBrand, noContent } = rankNarratives({ narratives, eligible, profile, ownSummary });

  const used = new Set();
  const suggestions = [];
  let quotesUsed = 0;

  for (const r of scored) {
    if (suggestions.length >= limit) break;
    const pick = r.candidates.find((c) => !used.has(c.pkg.id) && c.m.tier === r.best.m.tier);
    if (!pick) continue;
    r.best = pick;
    const contribution = pickContributionType(r.n, { quotesUsed, maxQuotes: decisions.maxQuotes });
    if (contribution.type === 'quote') quotesUsed += 1;
    used.add(r.best.pkg.id);
    const basis = contentBasis(r.best.pkg);
    const evidence = performanceEvidence({ narrative: r.n, type: contribution.type, ownSummary });
    suggestions.push({
      id: suggestionIdFor({ clientId, localDate, opportunityId: r.n.anchor.id, packageId: r.best.pkg.id }),
      type: contribution.type,
      rank: Number(r.rank.toFixed(3)),
      conversation: conversationSnapshot(r.n),
      opportunity: { id: r.n.anchor.id, url: r.n.anchor.url, author: r.n.anchor.author, text: r.n.anchor.text },
      package: packageSnapshot(r.best.pkg, basis),
      why: {
        now: `${r.n.momentum.reasons.join(', ') || 'active'}; ${r.n.momentum.engagement} engagements across ${r.n.momentum.posts} post(s); ${contribution.why}`,
        brand: `${r.fit.phrases.length ? `names ${r.fit.phrases.slice(0, 4).join(', ')} from your library` : `shares distinctive library terms ${r.fit.terms.slice(0, 5).map((t) => `"${t}"`).join(', ')}`}; guard lane: ${r.fit.lane} (${r.fit.laneConfidence})`,
        brain: brainLine(brain),
        strategy: strategyLine(strategy),
        content: `"${r.best.pkg.title}" — ${r.best.m.tier === 'specific' ? `named in the conversation (${r.best.m.phrases.join(', ')})` : `genre-level match only (${r.best.m.phrases.join(', ')}) — the conversation does not name this item`}; grounded in ${basis.kind === 'story' ? 'your own story' : `verifiable facts (${basis.facts.map((f) => f.provenance).filter((v, i, a) => a.indexOf(v) === i).join('; ')})`}`,
        history: evidence,
      },
      scores: { momentum: r.n.momentum.score, brandFit: r.fit.score, contentFit: Number(r.contentScore.toFixed(3)), history: evidence.score ?? 0 },
      match: { tier: r.best.m.tier, terms: r.best.m.terms, phrases: r.best.m.phrases, score: r.best.m.score },
    });
  }

  gaps.push(...skippedGaps({ offBrand, noContent }));

  // An original from owned content when no conversation qualified, or when
  // the benchmark says showcase originals are this account's strength.
  if ((suggestions.length === 0 || decisions.includeShowcase) && suggestions.length < limit) {
    const pool = eligible.filter((p) => !used.has(p.id))
      .sort((a, b) => Number(!(a.mediaState === 'video' || a.mediaState === 'still')) - Number(!(b.mediaState === 'video' || b.mediaState === 'still'))
        || Number(!isRealStory(a.story)) - Number(!isRealStory(b.story))
        || String(a.id).localeCompare(String(b.id)));
    const pkg = pool[0];
    if (pkg) {
      const basis = contentBasis(pkg);
      const showcase = pkg.mediaState === 'video' || pkg.mediaState === 'still';
      const evidence = performanceEvidence({ narrative: { text: `${pkg.title} ${basis.story}` }, type: 'original', ownSummary });
      suggestions.push({
        id: suggestionIdFor({ clientId, localDate, opportunityId: null, packageId: pkg.id }),
        type: 'original',
        rank: null,
        conversation: null,
        opportunity: null,
        package: packageSnapshot(pkg, basis),
        why: {
          now: suggestions.length === 0 ? 'no current conversation qualified — an original keeps the day from being empty' : 'benchmark favours showcase originals for this account',
          brand: 'your own content',
          brain: brainLine(brain),
          strategy: strategyLine(strategy),
          content: `"${pkg.title}"${showcase ? ' (has media)' : ''}; grounded in ${basis.kind === 'story' ? 'your own story' : 'verifiable facts'}`,
          history: evidence,
        },
        scores: { momentum: null, brandFit: null, contentFit: null, history: evidence.score ?? 0 },
        match: { terms: [], score: null },
      });
    }
  }

  suggestions.forEach((s, i) => {
    const localTime = SLOT_TIMES[i] || SLOT_TIMES[SLOT_TIMES.length - 1];
    s.proposedSlot = { localDate, localTime, timezone, iso: zonedTimeToIso(localDate, localTime, timezone), note: 'suggestion only — not scheduled' };
  });

  return {
    suggestions,
    gaps,
    brandProfile: brandProfileOf(profile),
    shortlist: shortlistOf({ scored, offBrand, noContent }),
    stats: statsOf({ packages, eligible, byBasis, ineligible, conversationPosts, narratives, scored, offBrand, noContent }),
  };
}

// --- slot orchestration ----------------------------------------------------------------

const slotView = (slot, fillReason) => ({
  letter: slot.letter, timeCT: slot.timeCT ?? null, startsAt: slot.startsAt ?? null,
  type: slot.type, lane: slot.lane ?? null, pillar: slot.pillar ?? null, fillReason,
});

const proposedSlotOf = (slot, localDate, timezone) => ({
  localDate,
  // The daily reply minimum has no clock time; it goes out when a thread is live.
  localTime: slot.timeCT || 'anytime',
  timezone,
  iso: slot.startsAt ?? null,
  note: 'suggestion only — not scheduled',
});

/** Quote-react: the target post is the opportunity; there is no owned item (package null). */
function quoteSuggestion({ r, slot, ids, brain, strategy, ownSummary }) {
  const p = r.post;
  const evidence = performanceEvidence({ narrative: { text: p.text }, type: 'quote', ownSummary });
  const engagement = (Number(p.likes) || 0) + (Number(p.reposts) || 0) + (Number(p.replies) || 0);
  return {
    id: suggestionIdFor({ ...ids, slotType: slot.type, opportunityId: p.id, packageId: null }),
    type: 'quote',
    rank: Number.isFinite(p.score) ? Number(p.score.toFixed(3)) : null,
    conversation: null,
    opportunity: { id: p.id, url: p.url, author: p.author, text: p.text },
    package: null,
    ...(r.related ? { related: r.related } : {}),
    why: {
      now: `${p.ageHours}h old, ${engagement} engagements; quote window ${QUOTE_WINDOW_HOURS}h`,
      brand: `${r.fit.reason}; guard lane: ${r.fit.lane}`,
      brain: brainLine(brain),
      strategy: strategyLine(strategy),
      content: 'none required — reaction slot',
      history: evidence,
    },
    scores: { momentum: null, brandFit: null, contentFit: null, history: evidence.score ?? 0 },
    match: { terms: [], score: null },
  };
}

function ownedSuggestion({ slot, ids, pkg, brain, strategy, ownSummary }) {
  const basis = contentBasis(pkg);
  const showcase = pkg.mediaState === 'video' || pkg.mediaState === 'still';
  const evidence = performanceEvidence({ narrative: { text: `${pkg.title} ${basis.story}` }, type: 'original', ownSummary });
  return {
    id: suggestionIdFor({ ...ids, slotType: slot.type, opportunityId: null, packageId: pkg.id }),
    type: 'original',
    rank: null,
    conversation: null,
    opportunity: null,
    package: packageSnapshot(pkg, basis),
    why: {
      now: `${slot.type} slot ${slot.letter}${slot.timeCT ? ` at ${slot.timeCT} CT` : ''}`,
      brand: 'your own content',
      brain: brainLine(brain),
      strategy: strategyLine(strategy),
      content: `"${pkg.title}"${showcase ? ' (has media)' : ''}; grounded in ${basis.kind === 'story' ? 'your own story' : 'verifiable facts'}`,
      history: evidence,
    },
    scores: { momentum: null, brandFit: null, contentFit: null, history: evidence.score ?? 0 },
    match: { terms: [], score: null },
  };
}

/**
 * Walk today's slots in the order given (strategy order) and fill each with its
 * own filler until MAX_SUGGESTIONS are chosen. A slot that cannot fill, or comes
 * after the cap, becomes a `slot-unfilled:<letter>` gap with the reason. Pure.
 *
 * `slots` = slots.js output; `matchedSlots` = buildDayPlan().slots (packageId per letter);
 * `candidates` = normalized scan posts for quote slots (default: conversationPosts);
 * `conversationPosts` feed reply narratives; `ownPosts` + `ownHandle` feed self-quote.
 */
export function selectForSlots({
  clientId, localDate, timezone = DEFAULT_TIMEZONE, now = Date.now(), slots = [], matchedSlots = [],
  candidates, conversationPosts = [], packages = [], brain = null, strategy, ownSummary = null,
  ownPosts = [], ownHandle = null, max = MAX_SUGGESTIONS,
} = {}) {
  const limit = Math.max(0, Math.min(MAX_SUGGESTIONS, Number(max) || MAX_SUGGESTIONS));
  const ids = { clientId, localDate };
  const { gaps, eligible, ineligible, byBasis, profile, narratives } = prepare({ packages, brain, conversationPosts, now, strategy });
  const ranking = rankNarratives({ narratives, eligible, profile, ownSummary });
  const matchedByLetter = new Map(matchedSlots.map((m) => [m.slot, m]));
  const quotePool = Array.isArray(candidates) ? candidates : conversationPosts;

  const usedPosts = [];
  const usedPackages = [];
  const suggestions = [];
  const rejected = {};
  const gapFor = (slot, reason) => gaps.push({ code: `slot-unfilled:${slot.letter}`, message: `Slot ${slot.letter} (${slot.type}) not filled: ${reason}.`, slot: slotView(slot, reason) });
  const take = (slot, suggestion, fillReason) => {
    suggestions.push({ ...suggestion, slot: slotView(slot, fillReason), proposedSlot: proposedSlotOf(slot, localDate, timezone) });
  };

  for (const slot of slots) {
    if (slot.manual) { gapFor(slot, 'manual slot — retweets are done by hand'); continue; }
    if (suggestions.length >= limit) { gapFor(slot, `daily cap of ${limit} reached`); continue; }

    if (slot.type === 'quote-react' || slot.type === 'quote-commentary') {
      const r = fillQuoteSlot({ slot, candidates: quotePool, now, usedIds: usedPosts, related: eligible });
      rejected[slot.letter] = r.rejected;
      if (r.gap) { gapFor(slot, r.gap.reason); continue; }
      usedPosts.push(r.post.id);
      take(slot, quoteSuggestion({ r, slot, ids, brain, strategy, ownSummary }), r.fit.reason);
    } else if (slot.type === 'original-showcase') {
      const matched = matchedByLetter.get(slot.letter);
      const pkg0 = matched?.packageId ? packages.find((p) => p.id === matched.packageId) : null;
      // Optional note: a live conversation that names this very item. It never changes the pick.
      const named = pkg0 && narratives.find((n) => matchScore(n.text, pkg0)?.tier === 'specific');
      const r = fillShowcaseSlot({ slot, matchedSlot: matched, packages, now, whyNow: named ? `a live conversation names it (${named.label.join(' ')})` : null });
      if (r.gap) { gapFor(slot, r.gap.reason); continue; }
      usedPackages.push(r.packageId);
      take(slot, ownedSuggestion({ slot, ids, pkg: r.package, brain, strategy, ownSummary }), [r.matchReason, r.whyNow].filter(Boolean).join(' · ') || 'matched owned media');
    } else if (slot.type === 'original-text') {
      const r = fillTextSlot({ slot, packages, now, usedIds: usedPackages });
      if (r.gap) { gapFor(slot, r.gap.reason); continue; }
      usedPackages.push(r.packageId);
      take(slot, ownedSuggestion({ slot, ids, pkg: r.package, brain, strategy, ownSummary }), r.matchReason || r.basis);
    } else if (slot.type === 'reply') {
      // Library-vocabulary fit applies to replies only; each pooled narrative also needs an unused owned item.
      const pool = brandFitApplies('reply')
        ? ranking.scored.filter((x) => !usedPosts.includes(x.n.anchor.id) && x.candidates.some((c) => !usedPackages.includes(c.pkg.id) && c.m.tier === x.best.m.tier))
        : [];
      const r = fillReplySlot({ slot, narratives: pool.map((x) => x.n), now });
      if (r.gap) { gapFor(slot, narratives.length && !pool.length ? 'no on-brand conversation with an unused owned item' : r.gap.reason); continue; }
      const x = pool.find((y) => y.n.id === r.narrative.id);
      const pick = x.candidates.find((c) => !usedPackages.includes(c.pkg.id) && c.m.tier === x.best.m.tier);
      usedPosts.push(r.anchor.id);
      usedPackages.push(pick.pkg.id);
      const basis = contentBasis(pick.pkg);
      const evidence = performanceEvidence({ narrative: x.n, type: 'reply', ownSummary });
      take(slot, {
        id: suggestionIdFor({ ...ids, slotType: slot.type, opportunityId: x.n.anchor.id, packageId: pick.pkg.id }),
        type: 'reply',
        rank: Number(x.rank.toFixed(3)),
        conversation: conversationSnapshot(x.n),
        opportunity: { id: x.n.anchor.id, url: x.n.anchor.url, author: x.n.anchor.author, text: x.n.anchor.text },
        package: packageSnapshot(pick.pkg, basis),
        why: {
          now: `${x.n.momentum.reasons.join(', ') || 'active'}; ${x.n.momentum.engagement} engagements across ${x.n.momentum.posts} post(s); ${r.matchReason}`,
          brand: `${x.fit.phrases.length ? `names ${x.fit.phrases.slice(0, 4).join(', ')} from your library` : `shares distinctive library terms ${x.fit.terms.slice(0, 5).map((t) => `"${t}"`).join(', ')}`}; guard lane: ${x.fit.lane} (${x.fit.laneConfidence})`,
          brain: brainLine(brain),
          strategy: strategyLine(strategy),
          content: `"${pick.pkg.title}" — ${pick.m.tier === 'specific' ? `named in the conversation (${pick.m.phrases.join(', ')})` : `genre-level match only (${pick.m.phrases.join(', ')}) — the conversation does not name this item`}; grounded in ${basis.kind === 'story' ? 'your own story' : `verifiable facts (${basis.facts.map((f) => f.provenance).filter((v, i, a) => a.indexOf(v) === i).join('; ')})`}`,
          history: evidence,
        },
        scores: { momentum: x.n.momentum.score, brandFit: x.fit.score, contentFit: Number(x.contentScore.toFixed(3)), history: evidence.score ?? 0 },
        match: { tier: pick.m.tier, terms: pick.m.terms, phrases: pick.m.phrases, score: pick.m.score },
      }, r.matchReason);
    } else if (slot.type === 'self-quote') {
      const r = fillSelfQuoteSlot({ slot, ownPosts, ownHandle, now });
      if (r.gap) { gapFor(slot, r.gap.reason); continue; }
      const q = r.quotedPost;
      const evidence = performanceEvidence({ narrative: { text: q.text || '' }, type: 'quote', ownSummary });
      take(slot, {
        id: suggestionIdFor({ ...ids, slotType: slot.type, opportunityId: q.id || q.url || null, packageId: null }),
        type: 'quote',
        rank: null,
        conversation: null,
        opportunity: { id: q.id || q.url || null, url: q.url || null, author: String(ownHandle).replace(/^@/, ''), text: q.text || '' },
        package: null,
        why: {
          now: `own post from ${r.ageDays} days ago, past the resurrection cooldown`,
          brand: 'your own past winner',
          brain: brainLine(brain),
          strategy: strategyLine(strategy),
          content: 'none required — self-quote of your own post',
          history: evidence,
        },
        scores: { momentum: null, brandFit: null, contentFit: null, history: evidence.score ?? 0 },
        match: { terms: [], score: r.matchScore },
      }, r.matchReason);
    } else {
      gapFor(slot, `no filler for slot type ${slot.type}`);
    }
  }

  gaps.push(...skippedGaps(ranking));

  return {
    suggestions,
    gaps,
    brandProfile: brandProfileOf(profile),
    shortlist: shortlistOf(ranking),
    stats: { ...statsOf({ packages, eligible, byBasis, ineligible, conversationPosts, narratives, scored: ranking.scored, offBrand: ranking.offBrand, noContent: ranking.noContent }), quoteRejected: rejected },
  };
}
