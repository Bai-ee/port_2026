// Loop Studio — pure pipeline/stage-machine helpers (mirrors the slice_track
// workbench's core/state.js `stage` field + panels/pipeline.js's per-step
// state derivation, minus all DOM/React — every export here is a plain
// function of primitive/plain-object arguments, directly testable under
// node:test).
//
// ── Why this differs from the workbench's own stage machine ────────────────
// The workbench has NO local grid math at all — the engine is the sole
// source of truth for BPM/downbeat/bars, so its `runSlice` action never
// re-pushes the grid before slicing (grid edits are a wholly separate
// "Apply grid" round trip). Loop Studio keeps a LOCAL grid (bpm/bars/offset/
// meter) as the primary, always-available, engine-independent source of
// truth — that local-first grid is the whole point of this tool degrading to
// full manual/offline mode when the engine is down. So here the Pipeline
// card's "Slice" step is a compound action (LoopStudio.jsx's
// runSlicePipeline): push the current local grid to the engine (the same
// round trip the Grid card's own "Apply grid" button runs), THEN slice.
// That's a deliberate, documented deviation from the workbench's stricter
// push/slice separation, not an oversight.

export const STAGE_ORDER = ['idle', 'analyzed', 'sliced', 'verified'];

export const PIPELINE_STEPS = [
  { id: 'analyze', name: 'Analyze', hint: 'detect bpm + downbeat grid' },
  { id: 'slice', name: 'Slice', hint: 'cut bar-accurate loops' },
  { id: 'verify', name: 'Verify', hint: 'score loopability' },
  { id: 'export', name: 'Export', hint: 'save verification report' },
];

/** Index of `stage` within STAGE_ORDER; -1 for an unrecognized value. */
export function stageIndex(stage) {
  return STAGE_ORDER.indexOf(stage);
}

/**
 * Derives the overall pipeline stage from each engine round trip's own
 * completion flag, read furthest-along-first (a later step's `true` implies
 * every earlier one completed too), so a stale/idle earlier flag left behind
 * by a downstream-only reset never regresses the readout. `hasAudio` false
 * always yields `'idle'` — there's no pipeline without a loaded track.
 */
export function computeStage({
  hasAudio, detectionDone, sliceDone, verifyDone,
}) {
  if (!hasAudio) return 'idle';
  if (verifyDone) return 'verified';
  if (sliceDone) return 'sliced';
  if (detectionDone) return 'analyzed';
  return 'idle';
}

/**
 * Per-step render state for the Pipeline card, ported 1:1 from the
 * workbench's `panels/pipeline.js` `render()` body (stepState/disabled/
 * noCompleteLoops derivation) — see the module docstring above for why this
 * file's `stage` slices differently from the workbench's.
 *
 * Returns `{ state: 'busy'|'blocked'|'done'|'ready', disabled: boolean }`.
 */
export function computeStepState({
  stepId, stepIndex, stage, busyStep, noCompleteLoops = false,
}) {
  const idx = stageIndex(stage);
  const busy = busyStep === stepId;
  const blocked = idx < stepIndex;
  const anyBusy = busyStep !== null && busyStep !== undefined;
  const state = busy ? 'busy' : blocked ? 'blocked' : idx > stepIndex ? 'done' : 'ready';
  const blockedByCount = stepId === 'slice' && noCompleteLoops;
  const disabled = blocked || blockedByCount || (anyBusy && !busy);
  return { state, disabled };
}

/** "stage N of 4" readout text. An unrecognized stage clamps to 1 rather than going to 0/negative. */
export function stageReadoutText(stage) {
  const idx = stageIndex(stage);
  const n = Math.max(1, Math.min(idx + 1, PIPELINE_STEPS.length));
  return `stage ${n} of ${PIPELINE_STEPS.length}`;
}
