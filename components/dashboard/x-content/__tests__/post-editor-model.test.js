import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CHARS, charCount, isOverLimit, formatInZone, zonedWallToMs, whenToIso, initialWhen, isFutureEnough, resolveTimeZone,
  statusPill, boundFields, boundFieldsGate, dirtyState, actionState, buildApproveRequest, buildApproveScheduleRequest,
  buildSaveRequest, buildSuggestionApproveRequest, classifyError, approvalVoided, mergeServerPost, moreItems, OWNER_ONLY_MESSAGE,
} from '../post-editor-model.js';

const FULL = { selfReply: null, mediaVariants: null, replyTo: null };
const draft = (over = {}) => ({ id: 'p1', status: 'draft', state: 'pending', content: 'hello', revision: 3, scheduledAt: null, ...FULL, ...over });
const NOW = Date.parse('2026-10-18T15:00:00Z');
const TZ = 'America/Chicago';

test('char count and over-limit boundary', () => {
  assert.equal(charCount('abc'), 3);
  assert.equal(charCount(null), 0);
  assert.equal(isOverLimit('x'.repeat(MAX_CHARS)), false);
  assert.equal(isOverLimit('x'.repeat(MAX_CHARS + 1)), true);
});

test('timezone: format, parse and round trip (CDT and CST)', () => {
  // 2026-10-18 is CDT (UTC-5); 2026-12-01 is CST (UTC-6)
  assert.deepEqual(formatInZone(Date.parse('2026-10-18T15:00:00Z'), TZ), { date: '2026-10-18', time: '10:00' });
  assert.deepEqual(formatInZone(Date.parse('2026-12-01T15:00:00Z'), TZ), { date: '2026-12-01', time: '09:00' });
  assert.equal(whenToIso({ date: '2026-10-18', time: '10:00' }, TZ), '2026-10-18T15:00:00.000Z');
  assert.equal(whenToIso({ date: '2026-12-01', time: '09:00' }, TZ), '2026-12-01T15:00:00.000Z');
  assert.equal(whenToIso({ date: '2026-10-18', time: '10:00' }, 'Europe/London'), '2026-10-18T09:00:00.000Z');
  assert.equal(whenToIso({ date: '2026-10-18', time: '10:00' }, 'Asia/Tokyo'), '2026-10-18T01:00:00.000Z');
  const ms = Date.parse('2026-03-08T20:30:00Z');
  const w = formatInZone(ms, TZ);
  assert.equal(zonedWallToMs(w.date, w.time, TZ), ms);
});

test('timezone: bad input and unknown zone fall back safely', () => {
  assert.equal(whenToIso({ date: '', time: '' }, TZ), null);
  assert.equal(whenToIso({ date: '2026-13-40', time: '10:00' }, TZ), null);
  assert.equal(whenToIso({ date: '2026-10-18', time: '25:00' }, TZ), null);
  assert.equal(resolveTimeZone('Not/AZone'), 'America/Chicago');
  assert.equal(resolveTimeZone(undefined), 'America/Chicago');
  assert.deepEqual(initialWhen({ scheduledAt: 'nope' }, TZ), { date: '', time: '' });
  assert.deepEqual(initialWhen({ scheduledAt: '2026-10-18T15:00:00Z' }, 'America/New_York'), { date: '2026-10-18', time: '11:00' });
});

test('future check needs a one minute lead', () => {
  assert.equal(isFutureEnough(new Date(NOW + 59_000).toISOString(), NOW), false);
  assert.equal(isFutureEnough(new Date(NOW + 60_000).toISOString(), NOW), true);
  assert.equal(isFutureEnough(new Date(NOW - 1000).toISOString(), NOW), false);
  assert.equal(isFutureEnough(null, NOW), false);
});

test('approve needs no time; approve & schedule needs a future time', () => {
  const row = draft();
  const noTime = actionState({ row, content: 'hello', when: { date: '', time: '' }, tz: TZ, now: NOW });
  assert.equal(noTime.canApprove, true);
  assert.equal(noTime.canApproveSchedule, false);
  assert.match(noTime.scheduleBlockedReason, /date and time/);

  const past = actionState({ row, content: 'hello', when: { date: '2026-10-18', time: '09:00' }, tz: TZ, now: NOW });
  assert.equal(past.canApprove, true);
  assert.equal(past.canApproveSchedule, false);
  assert.match(past.scheduleBlockedReason, /a minute/);

  const future = actionState({ row, content: 'hello', when: { date: '2026-10-19', time: '09:00' }, tz: TZ, now: NOW });
  assert.equal(future.canApproveSchedule, true);
  assert.equal(future.iso, '2026-10-19T14:00:00.000Z');
});

test('over limit, empty and busy disable approve and save', () => {
  const when = { date: '2026-10-19', time: '09:00' };
  for (const content of ['x'.repeat(281), '   ']) {
    const s = actionState({ row: draft(), content, when, tz: TZ, now: NOW });
    assert.equal(s.canApprove, false);
    assert.equal(s.canApproveSchedule, false);
    assert.equal(s.canSave, false);
  }
  const busy = actionState({ row: draft(), content: 'hello there', when, tz: TZ, now: NOW, busy: true });
  assert.equal(busy.canApprove, false);
  assert.equal(busy.canSave, false);
});

test('approved row: approve disabled until the copy changes; locked rows never approve', () => {
  const when = { date: '2026-10-19', time: '09:00' };
  const approved = draft({ status: 'approved', state: 'approved' });
  assert.equal(actionState({ row: approved, content: 'hello', when, tz: TZ, now: NOW }).canApprove, false);
  assert.equal(actionState({ row: approved, content: 'hello edited', when, tz: TZ, now: NOW }).canApprove, true);
  for (const status of ['posted', 'failed', 'needs_review']) {
    const s = actionState({ row: draft({ status }), content: 'hello', when, tz: TZ, now: NOW });
    assert.equal(s.canApprove, false, status);
    assert.equal(s.canSave, false, status);
  }
});

test('save: only when dirty; a moved time on a scheduled post must be future', () => {
  const sched = draft({ status: 'scheduled', state: 'scheduled', scheduledAt: '2026-10-19T14:00:00.000Z' });
  const same = initialWhen(sched, TZ);
  assert.equal(actionState({ row: sched, content: 'hello', when: same, tz: TZ, now: NOW }).canSave, false);
  assert.equal(actionState({ row: sched, content: 'hello!', when: same, tz: TZ, now: NOW }).canSave, true);
  assert.equal(actionState({ row: sched, content: 'hello', when: { date: '2026-10-17', time: '09:00' }, tz: TZ, now: NOW }).canSave, false);
  assert.equal(actionState({ row: sched, content: 'hello', when: { date: '2026-10-20', time: '09:00' }, tz: TZ, now: NOW }).canSave, true);
});

test('dirty tracking: content and time, ignoring identical values', () => {
  const row = draft({ scheduledAt: '2026-10-19T14:00:00.000Z' });
  const when = initialWhen(row, TZ);
  assert.deepEqual(dirtyState({ row, content: 'hello', when, tz: TZ }), { contentDirty: false, timeDirty: false, dirty: false });
  assert.equal(dirtyState({ row, content: 'hello ', when, tz: TZ }).contentDirty, true);
  assert.equal(dirtyState({ row, content: 'hello', when: { ...when, time: '10:05' }, tz: TZ }).timeDirty, true);
  const none = draft();
  assert.equal(dirtyState({ row: none, content: 'hello', when: { date: '', time: '' }, tz: TZ }).dirty, false);
});

test('bound-field gate: unknown fields hide, so approve stays disabled', () => {
  const calendarRow = { id: 'p1', status: 'draft', state: 'pending', content: 'hello', revision: 1 }; // projection lacks the bound fields
  const gate = boundFieldsGate(calendarRow);
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.hidden, ['Self-reply', 'Media variants', 'Reply / quote target']);
  const when = { date: '2026-10-19', time: '09:00' };
  const s = actionState({ row: calendarRow, content: 'hello', when, tz: TZ, now: NOW });
  assert.equal(s.canApprove, false);
  assert.equal(s.canApproveSchedule, false);
  assert.match(s.approveBlockedReason, /Reload the full post/);
  assert.equal(boundFieldsGate(draft()).ok, true);
});

test('bound fields present are surfaced', () => {
  const row = draft({ selfReply: { text: 'link in thread' }, mediaVariants: { video: { '1x1': { url: 'u' } } }, replyTo: { url: 'https://x.com/a/status/1' } });
  const present = boundFields(row).filter((f) => f.present).map((f) => f.key);
  assert.deepEqual(present, ['selfReply', 'mediaVariants', 'replyTo']);
  assert.equal(boundFieldsGate(row).ok, true);
  assert.equal(actionState({ row, content: 'hello', when: { date: '', time: '' }, tz: TZ, now: NOW }).canApprove, true);
  // an empty object is "no value", but a known field
  assert.equal(boundFields(draft({ mediaVariants: {} })).find((f) => f.key === 'mediaVariants').present, false);
});

test('a boolean replyTo (post-status projection) is still a hidden target', () => {
  assert.deepEqual(boundFieldsGate(draft({ replyTo: true })).hidden, ['Reply / quote target']);
  assert.equal(boundFieldsGate(draft({ replyTo: false })).hidden.length, 1);
});

test('suggestions: approve via calendar-suggestion-approve with text, never schedule', () => {
  const sug = { id: 'suggestion:abc', kind: 'suggestion', state: 'suggested', suggestionId: 'abc', text: 'idea', date: '2026-10-19' };
  const s = actionState({ row: sug, content: 'idea', when: { date: '2026-10-20', time: '09:00' }, tz: TZ, now: NOW });
  assert.equal(s.canApprove, true);
  assert.equal(s.canApproveSchedule, false);
  assert.equal(s.canSave, false);
  assert.deepEqual(buildSuggestionApproveRequest({ row: sug, content: 'edited idea' }), {
    endpoint: 'content', action: 'calendar-suggestion-approve', body: { kind: 'suggestion', id: 'abc', date: '2026-10-19', text: 'edited idea' },
  });
  const rq = { id: 'requote:77', kind: 'requote', state: 'suggested', quoteTargetId: '77', windowOpen: false };
  assert.equal(actionState({ row: rq, content: 'quote', when: { date: '', time: '' }, tz: TZ, now: NOW }).canApprove, false);
  assert.equal(buildSuggestionApproveRequest({ row: rq, content: 'q' }).body.kind, 'requote');
  assert.equal(boundFieldsGate(sug).ok, true);
});

test('request builders carry content and expectedRevision', () => {
  const row = draft();
  assert.deepEqual(buildApproveRequest({ row, content: 'c' }), { endpoint: 'content', action: 'calendar-approve', body: { postId: 'p1', content: 'c', expectedRevision: 3 } });
  const sch = buildApproveScheduleRequest({ row, content: 'c', iso: '2026-10-19T14:00:00.000Z' });
  assert.equal(sch.body.action, 'approve-and-schedule');
  assert.equal(sch.body.expectedRevision, 3);
  assert.equal(sch.body.scheduledAt, '2026-10-19T14:00:00.000Z');
  const save = buildSaveRequest({ row, content: 'c', iso: 'x', scheduledTimeChanged: false });
  assert.equal(save.body.action, 'update');
  assert.equal('scheduledAt' in save.body, false);
  assert.equal(buildSaveRequest({ row, content: 'c', iso: 'x', scheduledTimeChanged: true }).body.scheduledAt, 'x');
});

test('error classification: conflict, owner-only 403, plan', () => {
  assert.equal(classifyError(Object.assign(new Error('x'), { code: 'revision-conflict' })).kind, 'conflict');
  assert.equal(classifyError(Object.assign(new Error('x'), { status: 409, data: { code: 'revision-conflict' } })).kind, 'conflict');
  const owner = classifyError(Object.assign(new Error('nope'), { status: 403 }));
  assert.equal(owner.kind, 'forbidden');
  assert.equal(owner.message, OWNER_ONLY_MESSAGE);
  assert.equal(classifyError(Object.assign(new Error('nope'), { code: 'pilot-not-owner' })).kind, 'forbidden');
  assert.equal(classifyError(Object.assign(new Error('blocked'), { code: 'plan-cap' })).kind, 'plan');
  assert.equal(classifyError(new Error('boom')).kind, 'error');
});

test('approval voided after a media change; merge makes bound fields known', () => {
  const before = draft({ status: 'scheduled', state: 'scheduled', mediaUrl: 'a' });
  const after = { ...before, status: 'draft', mediaUrl: 'b' };
  assert.equal(approvalVoided(before, after), true);
  assert.equal(approvalVoided(draft(), after), false);
  const lean = { id: 'p1', status: 'draft', state: 'pending', content: 'hi', revision: 1 };
  const merged = mergeServerPost(lean, { post: { status: 'approved', revision: 2, selfReply: null, mediaVariants: null, replyTo: null } });
  assert.equal(merged.status, 'approved');
  assert.equal(merged.revision, 2);
  assert.equal(merged.approval, 'approved');
  assert.equal(boundFieldsGate(merged).ok, true);
});

test('status pill and More items', () => {
  assert.equal(statusPill(draft()).label, 'Draft');
  assert.equal(statusPill(draft({ status: 'approved' })).label, 'Approved');
  assert.equal(statusPill(draft({ status: 'scheduled' })).label, 'Scheduled');
  assert.equal(statusPill(draft({ status: 'needs_review' })).label, 'Needs review');
  const items = (row) => Object.fromEntries(moreItems(row).map((i) => [i.id, i.enabled]));
  assert.deepEqual(items(draft({ status: 'scheduled' })), { reject: true, unschedule: true, reconcile: false, hires: false, unapprove: false });
  assert.equal(items(draft({ status: 'approved' })).unapprove, true);
  assert.equal(items(draft({ status: 'needs_review', state: 'held' })).reconcile, true);
  assert.equal(items(draft({ packageId: 'nas-1' })).hires, true);
  assert.deepEqual(moreItems({ kind: 'suggestion' }), []);
});
