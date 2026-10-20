// next_post: slot logic, candidate picking, rule checks. Pure fixtures, no I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planNextPost, ruleCheckDraft, slotKind, RECORD_LINE_RE } from '../next-post.js';
import { parseDailySlots } from '../daily-slots.js';
import { runReadTool, READ_TOOL_NAMES } from '../agent/tools.js';
import { ctWallToMs } from '../../x-content-inventory/month-calendar.js';

const FORMATS = `- Daily slot baseline (Chicago time):
  - 07:00 Graphic Design: quote-react (after the 06:30 quote scan).
  - 09:00 Design & Dev: showcase video.
  - 11:00 Graphic Design: quote-react.
  - 16:00 Dj Mix Videos: UE mix video.
  - 18:00 Record Collection Videos: Discogs record video; throwback replaces on anniversaries.
  - All day: 5+ replies.`;
const TRACKS = [
  { id: 'design', label: 'Graphic Design' }, { id: 'dev', label: 'Design & Dev' }, { id: 'mixes', label: 'Dj Mix Videos' }, { id: 'records', label: 'Record Collection Videos' },
];
const { slots } = parseDailySlots(FORMATS, { tracks: TRACKS });
const NOW = ctWallToMs('2026-10-19', 20 * 60 + 54); // Oct 19, 20:54 CT: the 18:00 slot has passed

const GOOD = 'Found this one in my dad\'s crate.\n\nBraxton Holmes / Dewey B. – The Adventures Of A Full Figured Woman E.P. [Black Vinyl, 1997]';
const post = (id, over = {}) => ({
  kind: 'post', id, status: 'draft', date: '2026-10-19', reviewOn: '2026-10-19', bucketId: 'records', revision: 3,
  content: GOOD, mediaUrl: 'https://m/x.mp4', mediaType: 'video/mp4', selfReply: { text: 'https://www.discogs.com/release/1' }, ...over,
});

test('slot passed today: the next occurrence of the track\'s slot is tomorrow, and it says so', () => {
  const r = planNextPost({ now: NOW, slots, rows: [post('a')], track: 'discogs' });
  assert.equal(r.available, true);
  assert.equal(r.target.date, '2026-10-20');
  assert.equal(r.target.timeCT, '18:00');
  assert.equal(r.target.kind, 'record');
  assert.equal(r.target.isToday, false);
  assert.deepEqual(r.target.passedToday, ['18:00']);
  assert.match(r.target.why, /already passed/);
  assert.equal(r.now.timeCT, '20:54');
});

test('no track given: the next open slot of any track (07:00 tomorrow after 20:54)', () => {
  const r = planNextPost({ now: NOW, slots, rows: [] });
  assert.equal(r.target.date, '2026-10-20');
  assert.equal(r.target.timeCT, '07:00');
  assert.equal(r.target.kind, 'quote-react');
});

test('two drafts for the same track and day: one pick, the other is the surplus to pass', () => {
  const rows = [
    post('weezie'),
    post('bob', { content: 'Bob Sinclar – Love Generation [Yellow Productions, 2005]', mediaUrl: null, mediaType: null, selfReply: null }),
  ];
  const r = planNextPost({ now: NOW, slots, rows, track: 'discogs' });
  assert.equal(r.pick.id, 'weezie');
  assert.deepEqual(r.passSurplus.ids, ['bob']);
  assert.equal(r.move.card, 'propose_queue_bulk');
  assert.deepEqual(r.move.args, { action: 'set-review-date', postIds: ['weezie'], date: '2026-10-20' });
  assert.deepEqual(r.passCard, { card: 'propose_calendar_decide', items: [{ decision: 'pass', item: { kind: 'post', postId: 'bob', expectedRevision: 3 } }] });
  assert.equal(r.candidates[0].failing.length, 0);
  assert.ok(r.candidates[1].failing.includes('media-present'));
});

test('a placeholder draft is flagged and loses to a clean one', () => {
  const rows = [
    post('holes', { content: 'Alone in the booth.\n\nArtist – Title [Label, 1999]\n[add your memory]' }),
    post('clean'),
  ];
  const r = planNextPost({ now: NOW, slots, rows, track: 'record' });
  assert.equal(r.pick.id, 'clean');
  const holes = r.candidates.find((c) => c.id === 'holes');
  assert.ok(holes.failing.includes('no-placeholder'));
  assert.match(holes.checks.find((c) => c.code === 'no-placeholder').fix, /memory/);
});

test('rule checks: link in the main post, link missing from the self-reply, hashtags, image instead of video, record format', () => {
  const bad = ruleCheckDraft(post('x', { content: 'Look https://www.discogs.com/release/1 #a #b #c', mediaType: 'image/png', mediaUrl: 'https://m/x.png', selfReply: null }), 'record');
  const failing = bad.filter((c) => !c.ok).map((c) => c.code);
  for (const code of ['video', 'no-link-in-main-post', 'link-in-self-reply', 'hashtags', 'record-format']) assert.ok(failing.includes(code), code);
  const ok = ruleCheckDraft(post('y'), 'record');
  assert.equal(ok.every((c) => c.ok), true);
  assert.ok(ruleCheckDraft(post('z', { content: 'a design post #ui' }), 'showcase').some((c) => c.code === 'hashtags' && !c.ok), 'design lane: no hashtags');
});

test('a slot already filled by an approved/scheduled post (+-60 min) is skipped', () => {
  const filled = { kind: 'post', id: 's', status: 'scheduled', date: '2026-10-20', scheduledAt: new Date(ctWallToMs('2026-10-20', 18 * 60 + 30)).toISOString(), bucketId: 'records', content: 'x' };
  const r = planNextPost({ now: NOW, slots, rows: [filled, post('a')], track: 'discogs' });
  assert.equal(r.target.date, '2026-10-21');
  assert.equal(r.move.reviewOn, '2026-10-21');
  const sched = planNextPost({ now: NOW, slots, rows: [post('b', { status: 'scheduled', scheduledAt: new Date(ctWallToMs('2026-10-19', 23 * 60)).toISOString(), reviewOn: null })], track: 'discogs' });
  assert.equal(sched.move.card, 'propose_post_edit');
  assert.equal(sched.move.args.scheduledAt, new Date(ctWallToMs('2026-10-20', 18 * 60)).toISOString());
});

test('drafts on other tracks or in the past are not candidates; no draft says so', () => {
  const rows = [post('mix', { bucketId: 'mixes', content: 'mix' }), post('old', { reviewOn: '2026-10-10', date: '2026-10-10' })];
  const r = planNextPost({ now: NOW, slots, rows, track: 'discogs' });
  assert.equal(r.pick, null);
  assert.equal(r.move, null);
  assert.match(r.note, /propose_daily_fill/);
});

test('unknown track / no slots: unavailable with a reason, never a guess', () => {
  assert.equal(planNextPost({ now: NOW, slots, rows: [], track: 'podcast' }).available, false);
  assert.match(planNextPost({ now: NOW, slots: [], rows: [] }).reason, /confirmed/);
  assert.equal(slotKind({ track: 'Record Collection Videos', note: '' }), 'record');
  assert.ok(RECORD_LINE_RE.test(GOOD));
});

test('next_post tool: registered, reads the confirmed doc + calendar through deps', async () => {
  assert.ok(READ_TOOL_NAMES.includes('next_post'));
  const doc = { confirmed: true, sections: { formats: FORMATS } };
  const deps = {
    now: () => NOW, getStrategyDoc: async () => doc, getPlan: async () => ({ plan: { contentTracks: TRACKS.map((t) => ({ ...t, share: 0.2, buckets: [t.id], benchmarks: [] })) } }),
    readCalendar: async ({ from }) => [{ date: '2026-10-19', posts: [post('a')] }, { date: from, posts: [] }],
  };
  const r = await runReadTool('next_post', { track: 'discogs' }, deps);
  assert.equal(r.target.timeCT, '18:00');
  assert.equal(r.pick.id, 'a');
  const draftDoc = await runReadTool('next_post', {}, { ...deps, getStrategyDoc: async () => ({ confirmed: false, sections: { formats: FORMATS } }) });
  assert.equal(draftDoc.available, false);
});

test('next_post: a Formats section cut off at the cap (header, no slot lines) says so instead of guessing', async () => {
  const cut = `${'- Design track: showcase video.\n'.repeat(60)}`.slice(0, 1960) + '\n- Daily slot baseline (Chicago time; 2h apart; after 2026-11-02 the sa';
  const r = await runReadTool('next_post', { track: 'discogs' }, {
    now: () => NOW, getStrategyDoc: async () => ({ confirmed: true, sections: { formats: cut } }), getPlan: async () => null, readCalendar: async () => [],
  });
  assert.equal(r.available, false);
  assert.match(r.reason, /cut off by the section cap/);
  assert.match(r.reason, /do not invent slots/);
});
