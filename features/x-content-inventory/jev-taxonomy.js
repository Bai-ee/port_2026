// The questions Jev answers about an archive asset.
//
// WHY THIS EXISTS: `JevDecisionService.decide(assetState, question, choices)`
// in the Archive worker takes the question AND the candidate answers from its
// caller, and nobody had defined them. That makes the taxonomy free to shape —
// so it is shaped here, to emit this engine's vocabulary directly. A processed
// asset then arrives as a half-built ContentPackage instead of as a pile of
// observations somebody has to interpret later.
//
// The choices are DERIVED from categories.js rather than retyped, so the
// archive's vocabulary and the posting engine's cannot drift apart. That
// drift is not hypothetical: the first two X corpora were tagged by two
// hand-written taggers and shared 1 topic label out of 28, which made every
// benchmark topic read as "0% of your output".
//
// ⚠️ CROSS-REPO NOTE. The worker is TypeScript in `Bai-ee/assetManager` and
// cannot import this file. `scripts/x-content/export-jev-taxonomy.mjs` emits
// a plain JSON artifact for it to vendor. THIS module is the source; the JSON
// is a build output; the worker's copy is a vendored artifact. Regenerate on
// every vocabulary change or the two sides silently disagree.
//
// Pure data + pure helpers.

import { PILLARS, SERIES } from './categories.js';

/** Archive review bands, mirrored from the worker (`lib/archive/jev/service.ts`).
 * Duplicated deliberately: this module must be readable without the worker
 * present, and the numbers are a contract, not an implementation detail. */
export const REVIEW_BANDS = {
  AUTO_CONFIRM: 0.90,      // > 0.90
  QUICK_REVIEW: 0.60,      // 0.60 – 0.90
  // < 0.60 => IDENTIFICATION_REQUIRED
};

const DECADES = ['pre-1985', '1985-1989', '1990-1994', '1995-1999', '2000-2004', '2005-2009', '2010-2019', '2020-present', 'unknown'];

/**
 * @typedef {object} JevQuestion
 * @property {string} id
 * @property {string} question   asked verbatim by the worker
 * @property {string[]} choices  the candidate answers
 * @property {string} fills      the ContentPackage field it populates
 * @property {boolean} [gate]    a gate answer is never auto-applied (see below)
 */

/** @type {JevQuestion[]} */
export const QUESTIONS = [
  {
    id: 'pillar',
    question: 'Which content pillar does this artifact belong to?',
    choices: Object.keys(PILLARS),
    fills: 'pillar',
    note: 'Drives lane and topics through resolveLabels — one mapping, no second taxonomy.',
  },
  {
    id: 'series',
    question: 'Which posting series could publish this artifact?',
    choices: Object.keys(SERIES),
    fills: 'series',
    note: 'A wrong answer here is cheap: the matcher re-checks slot type and media before it proposes anything.',
  },
  {
    id: 'era',
    question: 'What era is this artifact from?',
    choices: DECADES,
    fills: 'eraYear',
    note: 'File mtime is evidence, not truth — a 1994 flyer scanned in 2019 has a 2019 mtime. Jev sees the artifact; the filesystem sees the scan.',
  },
  {
    id: 'clientWork',
    question: 'Is this client work, or work made for someone else?',
    choices: ['yes', 'no', 'unclear'],
    fills: 'rights',
    gate: true,
    note: '⚠️ GATE. `yes` or `unclear` => client-approval-needed, ALWAYS, whatever the confidence. A high-confidence "no" is still only a default to `owned`, never a clearance. Automating the wrong asset once costs a client relationship.',
  },
  {
    id: 'postability',
    question: 'Could this artifact carry a post on its own, or is it supporting material?',
    choices: ['stands-alone', 'supporting', 'internal-only'],
    fills: 'status',
    note: 'Most of a 1 TB archive is supporting material. Without this, the inventory fills with rows nobody would ever post and the matcher spends its time rejecting them.',
  },
  {
    id: 'entities',
    question: 'Which people, venues, labels, releases or events are named in this artifact?',
    choices: [],
    fills: 'entities',
    openEnded: true,
    blocked: 'no entity table exists in the worker schema yet — see ARCHIVE-X-CONTENT-ENGINE-PLAN.md §4b',
    note: 'The highest-value question and the only blocked one. Four of the strongest triggers key off entities.',
  },
];

/** Where a decision goes based on its confidence. Gate questions never
 * auto-apply, whatever the band says. */
export function routeDecision({ questionId, confidence } = {}) {
  const q = QUESTIONS.find((x) => x.id === questionId);
  if (!q) return { action: 'reject', reason: `unknown question: ${questionId}` };
  if (q.gate) {
    return { action: 'review', reason: 'gate question — a model answer is evidence, never permission' };
  }
  if (!(Number.isFinite(confidence))) return { action: 'review', reason: 'no confidence returned' };
  if (confidence > REVIEW_BANDS.AUTO_CONFIRM) return { action: 'apply', reason: 'AUTO_CONFIRM' };
  if (confidence >= REVIEW_BANDS.QUICK_REVIEW) return { action: 'review', reason: 'QUICK_REVIEW' };
  return { action: 'identify', reason: 'IDENTIFICATION_REQUIRED' };
}

/**
 * Turn a set of answered Jev decisions into a draft ContentPackage.
 *
 * Deliberately produces `status: 'idea'` and never anything further: a model
 * proposing a post is not a post, and the Archive's existing three-band human
 * review is where that decision already happens.
 *
 * @param {object} input
 * @param {string} input.sha256
 * @param {string} [input.mediaType]  from AssetState
 * @param {Array<{questionId:string,value:string,confidence:number}>} input.decisions
 */
export function draftPackageFromDecisions({ sha256, mediaType, decisions = [] } = {}) {
  const pick = (id) => decisions.find((d) => d.questionId === id);
  const applied = {};
  const needsReview = [];

  for (const d of decisions) {
    const route = routeDecision(d);
    if (route.action === 'apply') applied[d.questionId] = d.value;
    else needsReview.push({ questionId: d.questionId, value: d.value, confidence: d.confidence, why: route.reason });
  }

  const client = pick('clientWork')?.value;

  return {
    id: sha256 ? `asset-${String(sha256).slice(0, 12)}` : null,
    assetRefs: sha256 ? [sha256] : [],
    pillar: applied.pillar ?? null,
    series: applied.series ?? null,
    eraYear: applied.era ?? null,
    // Media type is a fact about the bytes, so it maps directly — but note a
    // video asset is not automatically a postable video (length, quality,
    // whether it is even watchable). Effort stays unknown until a human looks.
    mediaState: mediaType === 'video' ? 'video' : mediaType === 'image' ? 'still' : mediaType === 'audio' ? 'audio' : 'none',
    // ⚠️ Rights is pessimistic by construction: anything but an explicit "no"
    // is treated as needing clearance.
    rights: client === 'no' ? 'owned' : 'client-approval-needed',
    effort: 'needs-edit',
    // The field no provider can produce. Left empty on purpose so it shows up
    // as a gap in validatePackage rather than being filled with a summary that
    // reads like a caption but contains no memory.
    story: '',
    title: '',
    status: 'idea',
    entities: [],
    platforms: ['x'],
    cta: null,
    eventDate: null,
    lastPostedAt: null,
    postCount: 0,
    _needsReview: needsReview,
  };
}

/** The plain-JSON form the TypeScript worker vendors. */
export function exportForWorker() {
  return {
    generatedAt: new Date().toISOString(),
    source: 'features/x-content-inventory/jev-taxonomy.js',
    reviewBands: REVIEW_BANDS,
    questions: QUESTIONS.map(({ id, question, choices, fills, gate, openEnded, blocked }) => ({
      id, question, choices, fills, gate: !!gate, openEnded: !!openEnded, blocked: blocked ?? null,
    })),
  };
}
