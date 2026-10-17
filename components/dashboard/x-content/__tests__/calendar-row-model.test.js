import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rowApproval, rowMark, matchesFilter, canApproveRow, canUnapproveRow, windowLeftLabel, dayRows, withOverride, approveRequest, unapproveRequest, hasBlockingPlaceholder,
} from '../calendar-row-model.js';

test('rowApproval prefers data field, falls back to state', () => {
  assert.equal(rowApproval({ approval: 'approved', state: 'pending' }), 'approved');
  assert.equal(rowApproval({ state: 'awaiting' }), 'unapproved');
  assert.equal(rowApproval({ state: 'scheduled' }), 'scheduled');
  assert.equal(rowApproval({ kind: 'requote', state: 'suggested' }), 'suggested');
});

test('rowMark distinguishes suggestion vs requote', () => {
  assert.equal(rowMark({ kind: 'requote' }), 'requote');
  assert.equal(rowMark({ kind: 'suggestion' }), 'suggestion');
  assert.equal(rowMark({ state: 'posted' }), 'posted');
});

test('filters', () => {
  const rows = [{ state: 'pending' }, { state: 'approved' }, { state: 'scheduled' }, { kind: 'suggestion', state: 'suggested' }, { state: 'posted' }];
  const n = (f) => rows.filter((r) => matchesFilter(r, f)).length;
  assert.deepEqual([n('all'), n('unapproved'), n('approved'), n('suggestions')], [5, 1, 2, 1]);
});

test('approve / unapprove eligibility', () => {
  assert.equal(canApproveRow({ state: 'pending' }), true);
  assert.equal(canApproveRow({ state: 'pending', status: 'needs_review' }), false);
  assert.equal(canApproveRow({ state: 'scheduled' }), false);
  assert.equal(canApproveRow({ kind: 'requote', expiresAt: '2000-01-01T00:00:00Z' }), false);
  assert.equal(canApproveRow({ kind: 'suggestion' }), true);
  assert.equal(canUnapproveRow({ state: 'approved' }), true);
  assert.equal(canUnapproveRow({ state: 'scheduled' }), false);
});

test('windowLeftLabel', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  assert.equal(windowLeftLabel({ expiresAt: '2026-10-17T17:30:00Z' }, now), '5h left');
  assert.equal(windowLeftLabel({ expiresAt: '2026-10-17T12:40:00Z' }, now), '40m left');
  assert.equal(windowLeftLabel({ expiresAt: '2026-10-17T11:00:00Z' }, now), 'closed');
  assert.equal(windowLeftLabel({}, now), '');
});

test('dayRows merges and dedupes', () => {
  assert.deepEqual(dayRows({ posts: [{ id: 'a' }], suggestions: [{ id: 'b' }, { id: 'a' }], requotes: [{ id: 'c' }] }).map((r) => r.id), ['a', 'b', 'c']);
});

test('override and requests', () => {
  assert.equal(withOverride({ id: 'a', state: 'pending' }, { a: 'approved' }).approval, 'approved');
  assert.equal(withOverride({ id: 'a', state: 'approved' }, { a: 'unapproved' }).approval, 'unapproved');
  assert.deepEqual(approveRequest({ id: 'p1', state: 'pending' }), { action: 'calendar-approve', body: { postId: 'p1' } });
  assert.equal(approveRequest({ id: 's1', kind: 'requote', date: '2026-10-17' }).body.kind, 'requote');
  assert.equal(unapproveRequest({ id: 'p1' }).action, 'calendar-unapprove');
  assert.equal(hasBlockingPlaceholder('hi [add your memory]'), true);
  assert.equal(hasBlockingPlaceholder('hi'), false);
});
