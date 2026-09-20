import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE_ORDER, PIPELINE_STEPS, stageIndex, computeStage, computeStepState, stageReadoutText,
} from '../stage-machine.js';

// ── stageIndex ───────────────────────────────────────────────────────────

test('stageIndex: index within STAGE_ORDER, -1 for unrecognized', () => {
  assert.equal(stageIndex('idle'), 0);
  assert.equal(stageIndex('analyzed'), 1);
  assert.equal(stageIndex('sliced'), 2);
  assert.equal(stageIndex('verified'), 3);
  assert.equal(stageIndex('bogus'), -1);
});

// ── computeStage ─────────────────────────────────────────────────────────

test('computeStage: no audio -> always idle regardless of other flags', () => {
  assert.equal(computeStage({ hasAudio: false, detectionDone: true, sliceDone: true, verifyDone: true }), 'idle');
});

test('computeStage: reads furthest-along-first (verified > sliced > analyzed > idle)', () => {
  assert.equal(computeStage({ hasAudio: true, detectionDone: false, sliceDone: false, verifyDone: false }), 'idle');
  assert.equal(computeStage({ hasAudio: true, detectionDone: true, sliceDone: false, verifyDone: false }), 'analyzed');
  assert.equal(computeStage({ hasAudio: true, detectionDone: true, sliceDone: true, verifyDone: false }), 'sliced');
  assert.equal(computeStage({ hasAudio: true, detectionDone: true, sliceDone: true, verifyDone: true }), 'verified');
});

test('computeStage: a later true flag wins even if an earlier one is stale/false (no regression)', () => {
  // sliceDone true but detectionDone false (a downstream-only reset left an
  // earlier flag behind) -- still reads as 'sliced', not demoted to 'idle'.
  assert.equal(computeStage({ hasAudio: true, detectionDone: false, sliceDone: true, verifyDone: false }), 'sliced');
  assert.equal(computeStage({ hasAudio: true, detectionDone: false, sliceDone: false, verifyDone: true }), 'verified');
});

// ── computeStepState ─────────────────────────────────────────────────────

test('computeStepState: analyze step is "ready" (not busy/blocked) at stage idle', () => {
  const { state, disabled } = computeStepState({ stepId: 'analyze', stepIndex: 0, stage: 'idle', busyStep: null });
  assert.equal(state, 'ready');
  assert.equal(disabled, false);
});

test('computeStepState: slice is "ready" once analyzed; analyze becomes "done"', () => {
  const analyze = computeStepState({ stepId: 'analyze', stepIndex: 0, stage: 'analyzed', busyStep: null });
  assert.equal(analyze.state, 'done');
  const slice = computeStepState({ stepId: 'slice', stepIndex: 1, stage: 'analyzed', busyStep: null });
  assert.equal(slice.state, 'ready');
  assert.equal(slice.disabled, false);
});

test('computeStepState: a step ahead of the current stage is "blocked" and disabled', () => {
  const verify = computeStepState({ stepId: 'verify', stepIndex: 2, stage: 'analyzed', busyStep: null });
  assert.equal(verify.state, 'blocked');
  assert.equal(verify.disabled, true);
});

test('computeStepState: the active busyStep reports "busy" and stays enabled-in-spirit (disabled reflects OTHER steps, not itself)', () => {
  const slice = computeStepState({ stepId: 'slice', stepIndex: 1, stage: 'analyzed', busyStep: 'slice' });
  assert.equal(slice.state, 'busy');
  assert.equal(slice.disabled, false);
});

test('computeStepState: any OTHER step is disabled while one step is busy', () => {
  const analyze = computeStepState({ stepId: 'analyze', stepIndex: 0, stage: 'analyzed', busyStep: 'slice' });
  assert.equal(analyze.state, 'done');
  assert.equal(analyze.disabled, true, 'a done step should still be disabled while another step is busy');

  const verify = computeStepState({ stepId: 'verify', stepIndex: 2, stage: 'analyzed', busyStep: 'slice' });
  assert.equal(verify.disabled, true);
});

test('computeStepState: slice is disabled (blockedByCount) when there are 0 complete loops, even though "ready"', () => {
  const slice = computeStepState({
    stepId: 'slice', stepIndex: 1, stage: 'analyzed', busyStep: null, noCompleteLoops: true,
  });
  assert.equal(slice.state, 'ready');
  assert.equal(slice.disabled, true);
});

test('computeStepState: noCompleteLoops only affects the slice step, not others', () => {
  const analyze = computeStepState({
    stepId: 'analyze', stepIndex: 0, stage: 'idle', busyStep: null, noCompleteLoops: true,
  });
  assert.equal(analyze.disabled, false);
});

test('computeStepState: export is "ready" only once verified, "blocked" before that', () => {
  const beforeVerify = computeStepState({ stepId: 'export', stepIndex: 3, stage: 'sliced', busyStep: null });
  assert.equal(beforeVerify.state, 'blocked');
  const afterVerify = computeStepState({ stepId: 'export', stepIndex: 3, stage: 'verified', busyStep: null });
  assert.equal(afterVerify.state, 'ready');
});

// ── stageReadoutText ─────────────────────────────────────────────────────

test('stageReadoutText: "stage N of 4"', () => {
  assert.equal(stageReadoutText('idle'), 'stage 1 of 4');
  assert.equal(stageReadoutText('analyzed'), 'stage 2 of 4');
  assert.equal(stageReadoutText('sliced'), 'stage 3 of 4');
  assert.equal(stageReadoutText('verified'), 'stage 4 of 4');
});

test('stageReadoutText: an unrecognized stage clamps to stage 1 rather than going negative', () => {
  assert.equal(stageReadoutText('bogus'), 'stage 1 of 4');
});

// ── shape sanity ─────────────────────────────────────────────────────────

test('PIPELINE_STEPS: 4 fixed steps, ids match STAGE_ORDER progression analyze/slice/verify/export', () => {
  assert.equal(PIPELINE_STEPS.length, 4);
  assert.deepEqual(PIPELINE_STEPS.map((s) => s.id), ['analyze', 'slice', 'verify', 'export']);
  PIPELINE_STEPS.forEach((s) => {
    assert.ok(s.name && typeof s.name === 'string');
    assert.ok(s.hint && typeof s.hint === 'string');
  });
});

test('STAGE_ORDER: idle/analyzed/sliced/verified in order', () => {
  assert.deepEqual(STAGE_ORDER, ['idle', 'analyzed', 'sliced', 'verified']);
});
