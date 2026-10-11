import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHandoffBundle, parseLocalTime, localToMs, localTime, inQuietHours, quietHoursEnd, statusLabel, tomorrowSameTime,
} from '../handoff.js';
import { makePost, T0, MIN } from './helpers/fakes.js';

const TZ = 'America/Chicago';
const ids = (post, extra = {}) => buildHandoffBundle({ post, handle: 'bai_ee', tz: TZ, now: T0, ...extra }).actions.map((a) => a.action);

test('copyText is the exact post content; metaHtml escapes and carries handle, local time, tz, status, revision', () => {
  const post = makePost();
  const b = buildHandoffBundle({ post, handle: '@bai_ee', tz: TZ, now: T0, mode: 'handoff' });
  assert.equal(b.copyText, post.content);
  assert.match(b.metaHtml, /@bai_ee/);
  assert.match(b.metaHtml, /America\/Chicago/);
  assert.match(b.metaHtml, /3:20\s?PM/);
  assert.match(b.metaHtml, /Draft \(not approved\)/);
  assert.match(b.metaHtml, /Revision 1/);
  assert.ok(!b.metaHtml.includes('<b>Exact'), 'user content must be HTML-escaped');
  assert.match(b.metaHtml, /&lt;b&gt;/);
});

test('unapproved draft: full action set with exact approve labels including local time', () => {
  const labels = buildHandoffBundle({ post: makePost(), tz: TZ, now: T0 }).actions;
  assert.deepEqual(labels.map((a) => a.action), ['post-myself', 'revise', 'approve-schedule', 'approve-post-now', 'reschedule', 'skip']);
  assert.match(labels.find((a) => a.action === 'approve-schedule').label, /^Approve & schedule .*3:20\s?PM/);
  assert.equal(labels.find((a) => a.action === 'approve-post-now').label, 'Approve & post now');
  assert.equal(labels.find((a) => a.action === 'approve-schedule').params.scheduledAt, makePost().scheduledAt);
});

test('approve-schedule is omitted when there is no future target time', () => {
  assert.ok(!ids(makePost({ scheduledAt: null })).includes('approve-schedule'));
  assert.ok(!ids(makePost({ scheduledAt: new Date(T0 - MIN).toISOString() })).includes('approve-schedule'));
});

test('approved + scheduled gets a status reminder with no approve button', () => {
  const a = ids(makePost({ status: 'scheduled', lifecycleVersion: 2 }), { mode: 'reminder' });
  assert.deepEqual(a, ['post-myself', 'reschedule', 'revise']);
  // Legacy scheduled rows keep their schedule on edit, so no in-chat revise for them.
  assert.deepEqual(ids(makePost({ status: 'scheduled' }), { mode: 'reminder' }), ['post-myself', 'reschedule']);
  const b = buildHandoffBundle({ post: makePost({ status: 'scheduled' }), tz: TZ, now: T0, mode: 'reminder' });
  assert.match(b.metaHtml, /no action needed/);
  assert.equal(b.actions[0].label, 'Post myself (take over)');
});

test('manual state offers posted-it, send-assets, release', () => {
  assert.deepEqual(ids(makePost({ status: 'manual' })), ['posted-it', 'send-assets', 'release']);
});

test('reply rows never get approve/schedule buttons and show the target', () => {
  const reply = makePost({ replyTo: { url: 'https://x.com/a/status/9', author: 'a' } });
  assert.deepEqual(ids(reply), ['post-myself', 'posted-it']);
  assert.match(buildHandoffBundle({ post: reply, tz: TZ, now: T0 }).metaHtml, /Reply target: https:\/\/x\.com\/a\/status\/9/);
  assert.deepEqual(ids({ ...reply, status: 'manual' }), ['posted-it', 'send-assets', 'release']);
});

test('posted, rejected and needs_review rows have no actions', () => {
  for (const status of ['posted', 'rejected', 'needs_review', 'posting']) assert.deepEqual(ids(makePost({ status })), []);
});

test('media: video vs photo, none for text-only', () => {
  assert.deepEqual(buildHandoffBundle({ post: makePost({ mediaUrl: 'https://m/v.mp4', mediaType: 'video' }), tz: TZ, now: T0 }).media, { type: 'video', url: 'https://m/v.mp4' });
  assert.equal(buildHandoffBundle({ post: makePost({ mediaUrl: 'https://m/i.png', mediaType: 'image' }), tz: TZ, now: T0 }).media.type, 'photo');
  assert.equal(buildHandoffBundle({ post: makePost(), tz: TZ, now: T0 }).media, null);
});

test('status labels follow the display map', () => {
  assert.equal(statusLabel({ status: 'manual' }), 'Posting manually');
  assert.equal(statusLabel({ status: 'posted', deliveryMode: 'manual' }), 'Posted (you reported)');
  assert.equal(statusLabel({ status: 'posted', twitterId: '1' }), 'Posted (verified)');
});

test('parseLocalTime: HH:MM today and full date use the settings timezone (CDT and CST)', () => {
  const r = parseLocalTime('15:30', TZ, T0);
  assert.equal(r.iso, '2026-10-14T20:30:00.000Z'); // CDT = UTC-5
  assert.equal(parseLocalTime('2026-12-01 15:30', TZ, T0).iso, '2026-12-01T21:30:00.000Z'); // CST = UTC-6
  assert.equal(parseLocalTime('2026-10-14 15:30', 'Asia/Tokyo', T0).ok, false); // already past in Tokyo terms
});

test('parseLocalTime: DST gap is rejected, fall-back picks a real instant, past and junk rejected', () => {
  const gap = parseLocalTime('2027-03-14 02:30', TZ, T0); // 2027 spring-forward day in the US
  assert.equal(gap.ok, false);
  assert.match(gap.error, /does not exist/);
  const fall = parseLocalTime('2026-11-01 01:30', TZ, T0);
  assert.equal(fall.ok, true);
  assert.equal(localTime(fall.ms, TZ).includes('1:30'), true);
  assert.match(parseLocalTime('14:00', TZ, T0).error, /already passed/);
  assert.equal(parseLocalTime('banana', TZ, T0).ok, false);
  assert.equal(parseLocalTime('25:00', TZ, T0).ok, false);
});

test('tomorrowSameTime keeps the wall clock across a DST change', () => {
  const sat = localToMs({ year: 2026, month: 10, day: 31, hour: 15, minute: 0 }, TZ); // CDT
  const sun = tomorrowSameTime(sat, TZ); // Nov 1: clocks fall back at 2am
  assert.equal(sun - sat, 25 * 3600000);
  assert.equal(new Date(sun).toISOString(), '2026-11-01T21:00:00.000Z');
});

test('quiet hours: overnight window and end calculation', () => {
  const q = { enabled: true, start: 22, end: 7 };
  const at = (h) => localToMs({ year: 2026, month: 10, day: 14, hour: h, minute: 0 }, TZ);
  assert.equal(inQuietHours(at(23), TZ, q), true);
  assert.equal(inQuietHours(at(3), TZ, q), true);
  assert.equal(inQuietHours(at(12), TZ, q), false);
  assert.equal(inQuietHours(at(23), TZ, { ...q, enabled: false }), false);
  assert.equal(quietHoursEnd(at(23), TZ, q), localToMs({ year: 2026, month: 10, day: 15, hour: 7, minute: 0 }, TZ));
  assert.equal(quietHoursEnd(at(3), TZ, q), at(7));
});
