import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDateKey, todayInZone, safeTimeZone, normalizeState, parseStageParams,
  serializeStageParams, backTarget, transition, levelTitle, stateKey,
} from '../calendar-stage-model.js';

test('isValidDateKey rejects impossible dates', () => {
  assert.equal(isValidDateKey('2026-10-18'), true);
  assert.equal(isValidDateKey('2026-02-30'), false);
  assert.equal(isValidDateKey('2026-1-1'), false);
  assert.equal(isValidDateKey(null), false);
});

test('todayInZone follows the client zone, not UTC', () => {
  const now = new Date('2026-10-18T02:30:00Z');
  assert.equal(todayInZone('America/Chicago', now), '2026-10-17');
  assert.equal(todayInZone('Asia/Tokyo', now), '2026-10-18');
  assert.equal(todayInZone('Not/AZone', now), '2026-10-17'); // Central fallback
  assert.equal(safeTimeZone(''), 'America/Chicago');
});

test('normalizeState never yields an impossible level', () => {
  assert.deepEqual(normalizeState({ level: 'post', date: '2026-10-18' }), { level: 'day', date: '2026-10-18', postId: null });
  assert.deepEqual(normalizeState({ level: 'day' }), { level: 'month', date: null, postId: null });
  assert.deepEqual(normalizeState({ level: 'post', postId: 'p1' }), { level: 'post', date: null, postId: 'p1' });
  assert.deepEqual(normalizeState(undefined), { level: 'month', date: null, postId: null });
});

test('parse/serialize round-trips and keeps unrelated params', () => {
  const s = { level: 'post', date: '2026-10-18', postId: 'abc 1' };
  const q = serializeStageParams('?client=home&x=1', s);
  assert.deepEqual(parseStageParams(q), s);
  assert.match(q, /client=home/);
  assert.equal(serializeStageParams(q, null), '?client=home&x=1');
  assert.equal(serializeStageParams('?cal=day&d=2026-10-18', null), '');
});

test('parseStageParams: no cal param or junk returns null; bad day downgrades', () => {
  assert.equal(parseStageParams('?foo=1'), null);
  assert.equal(parseStageParams('?cal=nope'), null);
  assert.deepEqual(parseStageParams('?cal=day&d=garbage'), { level: 'month', date: null, postId: null });
  assert.deepEqual(parseStageParams('?cal=post&d=2026-10-18'), { level: 'day', date: '2026-10-18', postId: null });
});

test('back steps post -> day -> month -> exit', () => {
  const s = { level: 'post', date: '2026-10-18', postId: 'p1' };
  let r = transition(s, { type: 'back' });
  assert.equal(r.state.level, 'day');
  assert.equal(r.exit, false);
  r = transition(r.state, { type: 'back' });
  assert.equal(r.state.level, 'month');
  assert.equal(r.exit, false);
  r = transition(r.state, { type: 'back' });
  assert.equal(r.exit, true);
  assert.equal(backTarget({ level: 'month' }), null);
});

test('post without a date backs to month', () => {
  assert.equal(backTarget({ level: 'post', postId: 'p1' }).level, 'month');
});

test('openDay / openPost / close', () => {
  const m = { level: 'month', date: null, postId: null };
  assert.equal(transition(m, { type: 'openDay', date: 'bad' }).state.level, 'month');
  const d = transition(m, { type: 'openDay', date: '2026-10-18' }).state;
  assert.equal(stateKey(d), 'day|2026-10-18|');
  const p = transition(d, { type: 'openPost', postId: 'p9' }).state;
  assert.deepEqual(p, { level: 'post', date: '2026-10-18', postId: 'p9' });
  assert.equal(transition(p, { type: 'openPost' }).state.postId, 'p9');
  assert.equal(transition(p, { type: 'close' }).exit, true);
});

test('levelTitle', () => {
  const now = new Date('2026-10-18T15:00:00Z');
  const opts = { timeZone: 'America/Chicago', now };
  assert.equal(levelTitle({ level: 'month', date: '2026-10-05' }, opts), 'October 2026');
  assert.equal(levelTitle({ level: 'day', date: '2026-10-18' }, opts), 'Today · Sun Oct 18');
  assert.equal(levelTitle({ level: 'day', date: '2026-10-19' }, opts), 'Mon Oct 19');
  assert.equal(levelTitle({ level: 'post', postId: 'p' }, opts), 'Edit post');
});

test('openPost with replace (post carousel) keeps the date and lands on the new post; Back still targets the day', () => {
  const p1 = transition({ level: 'day', date: '2026-10-18' }, { type: 'openPost', postId: 'p1' }).state;
  const p2 = transition(p1, { type: 'openPost', postId: 'p2', replace: true }).state;
  assert.deepEqual(p2, { level: 'post', date: '2026-10-18', postId: 'p2' });
  assert.deepEqual(backTarget(p2), { level: 'day', date: '2026-10-18', postId: null });
  assert.equal(serializeStageParams('', p2), '?cal=post&d=2026-10-18&p=p2');
});
