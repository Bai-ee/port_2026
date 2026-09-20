// The seam: an Archive review record becomes a draft ContentPackage.
//
// This is the join between the two halves of the system. The Archive
// (`Bai-ee/assetManager` worker + the HITLOOP `/archive` control plane) answers
// what an artifact IS. This engine answers what to post. `jev-taxonomy.js`
// already defines the questions Jev asks so the answers arrive in this engine's
// vocabulary — but nothing consumed them, so the inventory stayed at 3 rows
// while everything downstream worked and had nothing to work on.
//
// WHAT THIS READS. One `archive_review` document, in the shape the control
// plane already stores and `/api/archive/approved` already returns:
//
//   { id, sha256, sizeBytes, archiveName, sourcePaths[], sourceId, workerId,
//     collectionJobId, state, decisions[], humanConfirmations{},
//     transactionId?, arweaveUrl? }
//
// It reads that shape and nothing else. It does not reach into the worker, does
// not touch the NAS, and never writes back to the archive — the archive is the
// system of record and this side is a consumer. The boundary documented in
// `assetManager/docs/archive/{AGENT_HANDOFF,CURRENT_STATE}.md` is taken as
// given, not redesigned.
//
// Pure: no fs, no network, no clock.

import { QUESTIONS, draftPackageFromDecisions } from './jev-taxonomy.js';
import { validatePackage } from './schema.js';

/** `archive_review.state` — only a human-confirmed record may become a package.
 * REVIEW_PENDING means a person has not finished answering, and a model's
 * answers are evidence, not a decision (invariant 7). */
export const CONFIRMED_STATE = 'CONFIRMED';

/** The decade choices in `jev-taxonomy.js` are labels; `ContentPackage.eraYear`
 * is documented as a number ("when the artifact is FROM"). A decade maps to the
 * first year it covers. The two open-ended labels have no year at all and stay
 * null rather than being given a fabricated one. */
export function eraYearFromLabel(label) {
  if (typeof label !== 'string') return null;
  const m = label.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

/**
 * The control plane keys `humanConfirmations` by `decision.id || decision.question`
 * (see the PATCH handler in `app/api/archive/review/route.js`). Match that
 * exactly — a different key derivation here silently drops every human
 * correction and republishes the model's guess as though a person had approved it.
 */
export function confirmationKey(decision) {
  const d = decision ?? {};
  return d.id || d.question || null;
}

/** Map one archive decision onto a Jev question id. The archive stores the
 * question it was asked; this engine issued it. Match on id first, then on the
 * verbatim question text. An unrecognized question is skipped, not fatal: the
 * archive is free to ask things this engine did not define. */
export function questionIdFor(decision) {
  const d = decision ?? {};
  if (d.id && QUESTIONS.some((q) => q.id === d.id)) return d.id;
  if (d.questionId && QUESTIONS.some((q) => q.id === d.questionId)) return d.questionId;
  const byText = QUESTIONS.find((q) => q.question === d.question);
  return byText ? byText.id : null;
}

/**
 * Normalize one record's decisions into the `{questionId, value, confidence,
 * humanConfirmed}` form `draftPackageFromDecisions` consumes.
 *
 * The human value WINS over the model's `selectedValue` wherever one exists.
 * The archive keeps the two apart on purpose; collapsing them in the wrong
 * direction is how a correction gets thrown away.
 */
export function normalizeDecisions(record) {
  const r = record ?? {};
  const decisions = Array.isArray(r.decisions) ? r.decisions : [];
  const confirmations = r.humanConfirmations ?? {};
  const out = [];

  for (const d of decisions) {
    const questionId = questionIdFor(d);
    if (!questionId) continue;
    const key = confirmationKey(d);
    const hasHuman = key != null && Object.prototype.hasOwnProperty.call(confirmations, key);
    out.push({
      questionId,
      value: hasHuman ? confirmations[key] : (d ?? {}).selectedValue ?? null,
      confidence: Number.isFinite((d ?? {}).confidence) ? d.confidence : null,
      humanConfirmed: hasHuman,
      modelValue: (d ?? {}).selectedValue ?? null,
    });
  }
  return out;
}

/**
 * One `archive_review` record → one draft ContentPackage.
 *
 * @returns {{ ok: boolean, skipped?: string, package?: object, provenance?: object,
 *             needsReview?: object[], validation?: object }}
 */
export function packageFromReviewRecord(record) {
  const r = record ?? {};
  if (r.state && r.state !== CONFIRMED_STATE) {
    return { ok: false, skipped: `state is ${r.state}, not ${CONFIRMED_STATE}` };
  }
  if (!r.sha256) {
    // Identity is the SHA-256 of the bytes, never the filename (invariant 2).
    // Without it there is nothing stable to point a package at.
    return { ok: false, skipped: 'no sha256 — an archive record without byte identity cannot be referenced' };
  }

  const decisions = normalizeDecisions(r);
  const mediaType = r.mediaType ?? r.assetState?.mediaType ?? null;
  const draft = draftPackageFromDecisions({ sha256: r.sha256, mediaType, decisions });

  const pkg = {
    ...draft,
    eraYear: eraYearFromLabel(draft.eraYear),
    // A permanent Arweave URL is a better reference than a bare hash once one
    // exists, and it is the only form that resolves without the worker. The
    // hash stays alongside it as identity.
    assetRefs: r.arweaveUrl ? [r.arweaveUrl, r.sha256] : [r.sha256],
    // ⚠️ Source paths are NAS paths. They are provenance, and they never travel
    // into a package: "no secrets or private absolute NAS/network details in
    // public metadata". Only the basename the archive already derived is kept,
    // and only as a working title for a human to replace.
    title: '',
    story: '',
  };
  delete pkg._needsReview;

  return {
    ok: true,
    package: pkg,
    provenance: {
      contentAssetId: r.id ?? null,
      sha256: r.sha256,
      archiveName: r.archiveName ?? null,
      collectionJobId: r.collectionJobId ?? null,
      transactionId: r.transactionId ?? null,
      permanent: !!r.transactionId,
      sourcePathCount: Array.isArray(r.sourcePaths) ? r.sourcePaths.length : 0,
      // Which answers a person actually made, as opposed to accepted silently.
      humanConfirmed: decisions.filter((d) => d.humanConfirmed).map((d) => d.questionId),
      // Where the model was overruled — the signal worth watching before anyone
      // trusts a band threshold.
      corrections: decisions
        .filter((d) => d.humanConfirmed && d.modelValue != null && d.modelValue !== d.value)
        .map((d) => ({ questionId: d.questionId, model: d.modelValue, human: d.value })),
    },
    needsReview: draft._needsReview ?? [],
    // Drafts are EXPECTED to fail validation: `title` and `story` are required
    // and deliberately empty, because the story is the one field no provider can
    // produce. The result is reported, never suppressed.
    validation: validatePackage(pkg),
  };
}

/**
 * Ingest a set of records. Existing packages are matched by sha256 so a re-run
 * updates rather than duplicates — a package a human has since written a story
 * into must survive the next ingest untouched.
 *
 * @param {object} input
 * @param {object[]} input.records   archive_review records
 * @param {object[]} [input.existing] the current inventory
 */
export function ingestArchiveRecords(input) {
  const { records, existing } = input ?? {};
  const list = Array.isArray(records) ? records : [];
  const current = Array.isArray(existing) ? existing : [];
  const seen = new Set();
  for (const p of current) {
    for (const ref of (p?.assetRefs ?? [])) seen.add(ref);
  }

  const added = [];
  const skipped = [];
  const needsStory = [];

  for (const rec of list) {
    const res = packageFromReviewRecord(rec);
    if (!res.ok) {
      skipped.push({ id: rec?.id ?? null, reason: res.skipped });
      continue;
    }
    if (seen.has(res.package.assetRefs[res.package.assetRefs.length - 1])) {
      skipped.push({ id: rec?.id ?? null, reason: 'already in the inventory' });
      continue;
    }
    added.push(res);
    if (!res.package.story) needsStory.push(res.package.id);
  }

  return {
    added: added.map((a) => a.package),
    details: added,
    skipped,
    // The number that matters: rows that exist but cannot be posted until a
    // person writes the one thing no model can.
    needsStory,
    counts: {
      read: list.length,
      added: added.length,
      skipped: skipped.length,
      needsStory: needsStory.length,
    },
  };
}
