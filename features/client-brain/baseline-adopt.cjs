'use strict';

// Server side of "adopt the baseline strategy into the Brain" (pure mapping = baseline-strategy.cjs).
// Takes a resolved clientId only (the route resolves it from the session / ?as=); never a model-supplied id.
// Writes through the same versioned Brain Markdown path as the route's markdownSource save (compile + version
// reason 'baseline') and then runs the same onBrainStatusChanged sync, so an approved Brain flows into the
// plan/doc exactly as an injected Brain does. Never changes the Brain's approval status.

const fb = require('../../api/_lib/firebase-admin.cjs');
const store = require('./store.cjs');
const { onBrainStatusChanged } = require('./brain-sync.cjs');
const { buildBaselineStrategy, applyBaselineToMarkdown } = require('./baseline-strategy.cjs');

async function readState(clientId) {
  const [brain, snap] = await Promise.all([
    store.readClientBrainDoc(clientId),
    fb.adminDb.collection('dashboard_state').doc(clientId).get(),
  ]);
  return { brain, dashboardState: snap.exists ? (snap.data() || {}) : {} };
}

const NO_BRAIN = 'This client has no Client Brain yet; create one before adopting a baseline strategy.';

// Tracks follow Content Center buckets (bucket-tracks.js), so a Brain track without a same-named bucket never reaches
// the plan. Buckets are created by the agent's own buckets.upsert afterwards (its sync then reads the Brain targets);
// this only reports which are missing. Owner's call, not automatic: a Brain may have parked bucket decisions.
async function missingBuckets(clientId, trackLabels = []) {
  if (!trackLabels.length) return [];
  try {
    const { listBuckets } = await import('../x-content-inventory/bucket-store.js');
    const have = new Set((await listBuckets(clientId)).map((b) => String(b?.name || '').trim().toLowerCase()));
    return trackLabels.filter((l) => !have.has(String(l).trim().toLowerCase()));
  } catch { return trackLabels; }
}

const BUCKETS_NEXT = 'Content Tracks reach the plan and calendar only through same-named Content Center buckets: if the owner wants them, create each name in bucketsToCreate with buckets.upsert after adopting.';

/** Read-only. { ok, available, draft?, brainStatus, bucketsToCreate, reason? } */
async function previewBaseline(clientId, { tracks = null } = {}) {
  const { brain, dashboardState } = await readState(clientId);
  if (!brain?.markdownSource) return { ok: true, available: false, brainStatus: brain?.status || null, reason: NO_BRAIN };
  const draft = buildBaselineStrategy({ brainMarkdown: brain.markdownSource, dashboardState, tracks });
  if (!draft) return { ok: true, available: false, brainStatus: brain.status || null, reason: 'Nothing to adopt: there is no baseline strategy, or the Brain sections it would fill already have content.' };
  const { fields, ...shown } = draft;
  return {
    ok: true, available: true, brainStatus: brain.status || null, ...shown,
    bucketsToCreate: await missingBuckets(clientId, draft.trackLabels),
    next: `Run brain.strategy.adopt-baseline (same tracks, if any) to put up a confirm card. Confirming writes only these empty sections into the Brain (a new Brain version). ${BUCKETS_NEXT}`,
  };
}

/** Writes the draft. Throws {status} on a missing Brain; returns { ok, adopted:[...], bucketsToCreate, brainSync }. */
async function adoptBaseline(clientId, { byUid = null, tracks = null } = {}) {
  const { brain: prior, dashboardState } = await readState(clientId);
  if (!prior?.markdownSource) { const e = new Error(NO_BRAIN); e.status = 409; throw e; }
  const draft = buildBaselineStrategy({ brainMarkdown: prior.markdownSource, dashboardState, tracks });
  if (!draft) { const e = new Error('Nothing to adopt: no baseline strategy, or the Brain sections are already filled.'); e.status = 409; throw e; }
  const markdown = applyBaselineToMarkdown(prior.markdownSource, draft);
  let brain = await store.compileAndSaveClientBrainMarkdown(clientId, markdown, { reason: 'baseline', byUid });
  if (prior.status && brain?.status !== prior.status) brain = await store.saveClientBrain(clientId, { status: prior.status }) || brain;
  let brainSync = null;
  try { brainSync = await onBrainStatusChanged(clientId, brain); } catch (err) { brainSync = { error: err.message }; }
  const bucketsToCreate = await missingBuckets(clientId, draft.trackLabels);
  return { ok: true, clientId, adopted: draft.onlyEmpty, source: draft.source, notes: draft.notes, bucketsToCreate, ...(bucketsToCreate.length ? { next: BUCKETS_NEXT } : {}), brainSync };
}

/** Small state line for the chat prompt: { brainStatus, baselineAvailable }. Never throws. */
async function brainBaselineState(clientId) {
  try {
    const { brain, dashboardState } = await readState(clientId);
    return {
      brainStatus: brain ? (brain.status || 'draft') : 'missing',
      baselineAvailable: Boolean(brain?.markdownSource && buildBaselineStrategy({ brainMarkdown: brain.markdownSource, dashboardState })),
    };
  } catch { return null; }
}

module.exports = { previewBaseline, adoptBaseline, brainBaselineState };
