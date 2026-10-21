import assert from 'node:assert/strict';
import test from 'node:test';
import { actionNeedsPilot, PILOT_FREE_ACTIONS } from '../pilot-policy.js';
import { STRATEGY_ROUTE_ACTIONS } from '../route-handlers.js';

const KEEP = [
  'calendar-approve', 'calendar-unapprove', 'calendar-suggestion-approve', 'calendar-item-decide', 'approve-package', 'reject-package',
  'upsert-bucket', 'delete-bucket', 'upsert-folder', 'delete-folder', 'move-item', 'update-item-facets', 'set-rights',
  'capture-client-story', 'inventory-save', 'inventory-delete', 'content-task-update', 'media-url', 'media-urls', 'save-thumb',
  'find-hires-media', 'hires-media-use', 'post-attach-item-media', 'sync-rendered-videos', 'refresh-analysis',
  'nas-process', 'nas-stage', 'nas-browse', 'discogs-apply',
  'strategy-proposal-decide', 'strategy-action-undo', 'strategy-autonomy-save', 'x-data-sources-save',
  'strategy-calendar-batch-create-unknown', 'anything-new',
];

test('KEEP actions require the pilot gate (and unknown actions default to it)', () => {
  for (const a of KEEP) assert.equal(actionNeedsPilot(a, {}), true, a);
  assert.equal(actionNeedsPilot('', {}), true);
  assert.equal(actionNeedsPilot(undefined, undefined), true);
});

test('LOOSEN actions skip the gate', () => {
  for (const a of PILOT_FREE_ACTIONS) assert.equal(actionNeedsPilot(a, {}), false, a);
  for (const a of ['strategy-refresh', 'quote-scan-refresh']) assert.equal(actionNeedsPilot(a, {}), false, a);
});

test('paid flags re-engage the gate on otherwise loose actions', () => {
  assert.equal(actionNeedsPilot('strategy-refresh', { confirmPaid: true }), true);
  assert.equal(actionNeedsPilot('quote-scan-refresh', { confirmPaid: true }), true);
  assert.equal(actionNeedsPilot('daily-run-generate', { draftWithModel: true }), true);
  assert.equal(actionNeedsPilot('daily-run-generate', { draftWithModel: false }), false);
  assert.equal(actionNeedsPilot('strategy-refresh', { confirmPaid: 'true' }), false); // only the literal boolean counts, matching the handler
});

test('every strategy route action is classified on purpose', () => {
  const classified = (a) => PILOT_FREE_ACTIONS.has(a) || ['strategy-refresh', 'quote-scan-refresh'].includes(a) || actionNeedsPilot(a, {}) === true;
  for (const a of STRATEGY_ROUTE_ACTIONS) assert.ok(classified(a), a);
  // The owner-only strategy actions stay gated.
  for (const a of ['strategy-proposal-decide', 'strategy-action-undo', 'strategy-autonomy-save', 'x-data-sources-save']) {
    assert.ok(STRATEGY_ROUTE_ACTIONS.includes(a), a);
    assert.equal(actionNeedsPilot(a, {}), true, a);
  }
});
