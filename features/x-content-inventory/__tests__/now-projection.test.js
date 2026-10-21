import test from 'node:test';
import assert from 'node:assert/strict';
import { projectNow } from '../now-projection.js';
import { slotMs } from '../../telegram/slot-alerts.js';

const DATE = '2026-10-21'; // CDT
const T = (hhmm) => slotMs(DATE, hhmm);
const baselineSlots = { slots: [
  { time: '07:00', track: 'Quote react', note: 'quote slot' },
  { time: '11:00', track: 'Dj Mix Videos', note: '' },
  { time: '14:00', track: 'UE', note: '' },
  { time: '16:00', track: 'Design', note: '' },
  { time: '20:00', track: 'Music', note: '' },
] };
const row = (extra) => ({ kind: 'post', state: 'pending', status: 'draft', revision: 2, ...extra });
const day = { date: DATE, posts: [
  { kind: 'requote', id: 'requote:q1', quoteTargetId: 'q1', quotedUrl: 'https://x.com/a/status/1', quotedText: 'hot take', time: '07:00', ms: T('07:00') },
  { kind: 'requote', id: 'requote:q2', quoteTargetId: 'q2', quotedUrl: 'https://x.com/b/status/2', quotedText: 'other', time: '', ms: T('07:00') },
  row({ id: 'p-posted', state: 'posted', status: 'posted', ms: T('11:00'), title: 'mix' }),
  row({ id: 'p-draft', ms: T('14:05'), title: 'ue draft' }),
] };
const fresh = { postsAt: '2026-10-21T10:00:00Z', hotPicksAt: '2026-10-21T10:00:00Z', quoteTargetsAt: '2026-10-21T10:00:00Z' };

test('empty quote slot with picks -> pick state and headline', () => {
  const p = projectNow({ day, baselineSlots, now: T('06:30'), freshness: fresh });
  assert.equal(p.slots[0].state, 'pick');
  assert.equal(p.slots[0].action.kind, 'pick-quote');
  assert.equal(p.headline, '07:00 quote slot empty — pick from 2 hot picks');
  assert.equal(p.current, 0); // inside the 45 min lead window
  assert.equal(p.next, 0);
});

test('posted slot, draft ue slot, empty slots', () => {
  const p = projectNow({ day, baselineSlots, now: T('12:00'), freshness: fresh });
  assert.deepEqual(p.slots.map((s) => s.state), ['pick', 'posted', 'draft', 'empty', 'empty']);
  assert.equal(p.current, 1);
  assert.equal(p.next, 2);
  assert.equal(p.focus, 2); // the past quote slot (window over) is skipped, posted is covered
  assert.equal(p.headline, '14:00 UE — draft ready, approve it');
  assert.deepEqual(p.action, { label: 'Approve', kind: 'approve', ref: { postId: 'p-draft', expectedRevision: 2 } });
});

test('day boundary: before first slot and after last slot', () => {
  const early = projectNow({ day, baselineSlots, now: T('00:10'), freshness: fresh });
  assert.equal(early.current, null);
  assert.equal(early.next, 0);
  const late = projectNow({ day, baselineSlots, now: T('23:30'), freshness: fresh });
  assert.equal(late.current, null);
  assert.equal(late.next, null);
  assert.equal(late.headline, 'No more slots today');
});

test('all remaining covered -> All slots covered', () => {
  const d = { date: DATE, posts: [row({ id: 'a', state: 'scheduled', status: 'scheduled', ms: T('20:00') })] };
  const p = projectNow({ day: d, baselineSlots: { slots: [baselineSlots.slots[4]] }, now: T('19:00'), freshness: fresh });
  assert.equal(p.headline, 'All slots covered');
  assert.equal(p.action, null);
});

test('precedence: posted beats draft near one slot; suggestion shows as suggested', () => {
  const d = { date: DATE, posts: [row({ id: 'd', ms: T('16:00') }), row({ id: 'p', state: 'posted', status: 'posted', ms: T('16:10') }),
    { kind: 'suggestion', id: 'suggestion:s1', suggestionId: 's1', title: 'idea', ms: T('20:00'), slot: { timeCT: '20:00' } }] };
  const p = projectNow({ day: d, baselineSlots, now: T('15:00'), freshness: fresh });
  assert.equal(p.slots[3].state, 'posted');
  assert.equal(p.slots[4].state, 'suggested');
});

test('stale / missing freshness', () => {
  const p = projectNow({ day, baselineSlots, now: T('12:00'), freshness: { postsAt: '2026-10-19T10:00:00Z', hotPicksAt: null, quoteTargetsAt: '2026-10-21T10:00:00Z' } });
  const by = Object.fromEntries(p.freshness.map((f) => [f.id, f]));
  assert.equal(by.posts.stale, true);
  assert.equal(by['hot-picks'].stale, true);
  assert.equal(by['hot-picks'].asOf, null);
  assert.equal(by['quote-targets'].stale, false);
  assert.equal(by.bookmarks.stale, true); // no bookmarksAt => stale
  assert.equal(by.bookmarks.asOf, null);
  const ok = projectNow({ day, baselineSlots, now: T('12:00'), freshness: { bookmarksAt: '2026-10-21T10:00:00Z' } });
  assert.equal(ok.freshness.find((f) => f.id === 'bookmarks').stale, false);
});
