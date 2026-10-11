// Ranks conversations against owned content and picks up to MAX_SUGGESTIONS
// (no copy yet): content match, contribution type, snapshots, proposed slots.
// Decides what to suggest and why; never writes copy, schedules, or touches I/O.
// Pure; depends on every analysis module upstream.

import { DEFAULT_WINDOW_HOURS } from '../../x-quote-targets/rank.js';
import { MAX_SUGGESTIONS, DEFAULT_TIMEZONE, MIN_BRAND_FIT, CONVERSATION_MAX_AGE_HOURS, REPLY_WINDOW_HOURS, SLOT_TIMES } from './config.js';
import { phraseHits, tokenize, WEAK_TERMS, packageTerms, packagePhrases, isRealStory } from './text.js';
import { contentBasis, packageEligibility, INELIGIBLE_REASONS } from './content-basis.js';
import { buildBrandProfile, brandFit } from './brand.js';
import { groupNarratives } from './conversations.js';
import { performanceEvidence } from './evidence.js';
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

/**
 * Rank conversations and choose up to `max` suggestions (no copy yet). Pure.
 * rank = 0.35 momentum + 0.35 brand fit + 0.20 owned-content fit + 0.10 own history
 */
export function selectSuggestions({
  clientId, localDate, timezone = DEFAULT_TIMEZONE, now = Date.now(),
  conversationPosts = [], packages = [], brain = null, strategy, ownSummary = null, max = MAX_SUGGESTIONS,
} = {}) {
  const limit = Math.max(0, Math.min(MAX_SUGGESTIONS, Number(max) || MAX_SUGGESTIONS));
  const gaps = [...(strategy?.gaps || [])];
  const decisions = strategy?.decisions || { maxQuotes: limit, includeShowcase: false };

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
  const termsById = new Map(eligible.map((p) => [p.id, packageTerms(p)]));
  const phrasesById = new Map(eligible.map((p) => [p.id, packagePhrases(p)]));
  const narratives = groupNarratives(conversationPosts, { now });
  if (!conversationPosts.length) gaps.push({ code: 'no-conversations', message: 'No saved scan or search results — nothing to join.' });
  else if (!narratives.length) gaps.push({ code: 'no-live-conversations', message: `No scanned post is under ${CONVERSATION_MAX_AGE_HOURS}h old with enough engagement.` });

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

  const used = new Set();
  const suggestions = [];
  let quotesUsed = 0;
  const scored = ranked.map((r) => {
    const provisional = performanceEvidence({ narrative: r.n, type: 'quote', ownSummary });
    return { ...r, rank: 0.35 * r.n.momentum.score + 0.35 * r.fit.score + 0.2 * r.contentScore + 0.1 * (provisional.score || 0) };
  }).sort((a, b) => b.rank - a.rank);

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
        brain: brain?.status === 'approved' ? 'voice from the approved Client Brain' : `Client Brain is ${brain?.status || 'missing'} — not used`,
        strategy: strategy?.plan?.active ? 'today is covered by the saved strategy plan' : 'no current strategy plan — benchmark type evidence only',
        content: `"${r.best.pkg.title}" — ${r.best.m.tier === 'specific' ? `named in the conversation (${r.best.m.phrases.join(', ')})` : `genre-level match only (${r.best.m.phrases.join(', ')}) — the conversation does not name this item`}; grounded in ${basis.kind === 'story' ? 'your own story' : `verifiable facts (${basis.facts.map((f) => f.provenance).filter((v, i, a) => a.indexOf(v) === i).join('; ')})`}`,
        history: evidence,
      },
      scores: { momentum: r.n.momentum.score, brandFit: r.fit.score, contentFit: Number(r.contentScore.toFixed(3)), history: evidence.score ?? 0 },
      match: { tier: r.best.m.tier, terms: r.best.m.terms, phrases: r.best.m.phrases, score: r.best.m.score },
    });
  }

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
          brain: brain?.status === 'approved' ? 'voice from the approved Client Brain' : `Client Brain is ${brain?.status || 'missing'} — not used`,
          strategy: strategy?.plan?.active ? 'today is covered by the saved strategy plan' : 'no current strategy plan — benchmark type evidence only',
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
    brandProfile: { sources: profile.sources, topPhrases: [...profile.phrases.entries()].sort((a, b) => b[1].items - a[1].items || b[1].weight - a[1].weight).slice(0, 15).map(([p]) => p) },
    shortlist: scored.slice(0, 6).map((r) => ({ id: r.n.id, label: r.n.label, anchor: r.n.anchor.url, rank: Number(r.rank.toFixed(3)), brandFit: r.fit.score, content: r.best.pkg.id })),
    stats: {
      packages: packages.length,
      eligible: eligible.length,
      eligibleByBasis: byBasis,
      ineligible,
      conversationPosts: conversationPosts.length,
      narratives: narratives.length,
      onBrandWithContent: ranked.length,
      offBrand: offBrand.length,
      withoutContent: noContent.length,
    },
  };
}
