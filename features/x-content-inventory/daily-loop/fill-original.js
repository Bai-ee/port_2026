// Fillers for the owner's own posts: showcase (owned media from matchDay), text
// (story/facts items) and self-quote (the owner's OWN best recent post).
// Decides what goes in the slot or why it cannot; never writes copy or calls a model.
// Pure; depends on content-basis, match (scoreMatch), ledger (reused window/winner logic).

import { contentBasis, packageEligibility } from './content-basis.js';
import { scoreMatch } from '../match.js';
import { buildPostLedger, pickResurrectionCandidates } from '../ledger.js';

const gap = (slot, reason) => ({ slot, gap: { code: `slot-unfilled:${slot.letter}`, reason } });

/**
 * Showcase: the media comes from matchDay's pick for this slot. `whyNow` is an
 * optional note when a live conversation fits; it never changes the pick.
 */
export function fillShowcaseSlot({ slot, matchedSlot, packages = [], whyNow = null, now }) {
  const pkg = matchedSlot?.packageId ? packages.find((p) => p.id === matchedSlot.packageId) : null;
  if (!pkg) return gap(slot, matchedSlot?.matchReason || 'no eligible package');
  // matchDay checks rights/readiness, not whether there is anything honest to say about the asset.
  const ok = packageEligibility(pkg, { now });
  if (!ok.ok) return gap(slot, `matched package ${pkg.id} is not usable: ${ok.reason}`);
  return {
    slot, package: pkg, packageId: pkg.id, basis: ok.basis,
    matchScore: matchedSlot.matchScore ?? null, matchReason: matchedSlot.matchReason ?? null,
    whyNow: whyNow || null,
  };
}

/**
 * Text: an eligible item the owner can speak to. A real story outranks facts-only
 * (facts say what the thing IS; the copy step must not invent memories from them).
 * `usedIds` keeps it off the package the showcase slot already took.
 */
export function fillTextSlot({ slot, packages = [], now, usedIds = [] }) {
  const used = new Set(usedIds);
  const ranked = packages
    .filter((p) => !used.has(p.id))
    .map((pkg) => {
      const ok = packageEligibility(pkg, { now });
      const m = ok.ok ? scoreMatch(pkg, slot, { today: now }) : null;
      return m ? { pkg, basis: ok.basis, m } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.basis === 'story') - (a.basis === 'story') || b.m.score - a.m.score || String(a.pkg.id).localeCompare(String(b.pkg.id)));
  const best = ranked[0];
  if (!best) return gap(slot, 'no story/facts for this slot');
  return {
    slot, package: best.pkg, packageId: best.pkg.id, basis: best.basis,
    facts: contentBasis(best.pkg).facts,
    matchScore: best.m.score, matchReason: best.m.reasons.join(' · '),
  };
}

const handleOf = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();

/** Corpus rows carry only a url; a saved/normalized post may carry `author`. Unknown author = not provably the owner's. */
function authorOf(post) {
  const a = post?.author?.username || post?.author;
  if (a) return handleOf(a);
  return handleOf(/(?:x|twitter)\.com\/([^/]+)\/status\//i.exec(post?.url || '')?.[1]);
}

/**
 * Self-quote: only ever the owner's own corpus. Outside posts are dropped BEFORE
 * ranking, so a higher-scoring outsider can never win. Window, winner threshold,
 * type exclusions and cooldown are the ledger's (pickResurrectionCandidates);
 * `windowDays` can only narrow the maximum age, never widen it.
 */
export function fillSelfQuoteSlot({ slot, ownPosts = [], ownHandle, now, windowDays, resurrected = {} }) {
  const owner = handleOf(ownHandle);
  if (!owner) return gap(slot, 'owner handle not provided');
  const mine = ownPosts.filter((p) => authorOf(p) === owner);
  if (!mine.length) return gap(slot, 'no own posts available for a self-quote');
  const picks = pickResurrectionCandidates(buildPostLedger(mine), { today: now, resurrected, limit: 50 })
    .filter((c) => windowDays == null || c.ageDays <= windowDays);
  const best = picks[0];
  if (!best) return gap(slot, 'no own post in the self-quote window beat the winner threshold');
  return {
    slot, quotedPost: best.post, ageDays: best.ageDays, basis: best.basis, value: best.value,
    matchScore: best.score, matchReason: best.reason,
  };
}
