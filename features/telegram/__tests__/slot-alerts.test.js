import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../store.js';
import { runDispatch } from '../scheduler.js';
import { dueSlotAlerts, isQuoteSlot, quotePickFor, slotMs, suggestionFor, slotAlertHtml } from '../slot-alerts.js';
import { resolveCreativeMedia } from '../creative.js';
import { makeHarness, makePost, T0, MIN } from './helpers/fakes.js';

// T0 = Wed 2026-10-14 15:00 CDT. Slots in the lead window (30 min): 15:20. Outside: 16:00.
const DATE = '2026-10-14';
const SLOTS = [
  { time: '15:20', track: 'Graphic Design', trackId: 'design', note: 'craft clip' },
  { time: '15:25', track: 'Graphic Design', trackId: 'design', note: 'quote-react' },
  { time: '16:00', track: 'Music', trackId: 'music', note: 'record' },
];
const REQUOTE = {
  kind: 'requote', quoteTargetId: '99', quotedUrl: 'https://x.com/a/status/99', quotedHandle: 'a', quotedText: 'Big post', time: '15:25',
  hot: { momentum: 'climbing', why: 'craft vs AI' }, quotesLeftToday: 3, ms: T0,
};

test('slotMs is Chicago wall time', () => {
  assert.equal(slotMs(DATE, '15:00'), T0);
});

test('dueSlotAlerts: only slots inside the lead window, one dedup key per client/date/slot', () => {
  const out = dueSlotAlerts({ clientId: 'c1', day: { date: DATE, posts: [] }, slots: SLOTS, now: T0, leadMinutes: 30 });
  assert.deepEqual(out.map((a) => a.dedupKey), ['slot:c1:2026-10-14:1520', 'slot:c1:2026-10-14:1525']);
  assert.deepEqual(out.map((a) => a.quote), [false, true]);
});

test('dueSlotAlerts: a post within 45 min fills the slot; suggestions, requotes and rejected posts do not', () => {
  const day = { date: DATE, posts: [
    { kind: 'suggestion', ms: slotMs(DATE, '15:20') }, REQUOTE, { id: 'r', status: 'rejected', ms: slotMs(DATE, '15:20') },
  ] };
  assert.equal(dueSlotAlerts({ clientId: 'c1', day, slots: SLOTS.slice(0, 1), now: T0, leadMinutes: 30 }).length, 1);
  day.posts.push({ id: 'p', status: 'draft', ms: slotMs(DATE, '15:50') });
  assert.equal(dueSlotAlerts({ clientId: 'c1', day, slots: SLOTS.slice(0, 1), now: T0, leadMinutes: 30 }).length, 0);
});

test('quote slot detection, pick and suggestion matching', () => {
  assert.equal(isQuoteSlot(SLOTS[1]), true);
  assert.equal(isQuoteSlot(SLOTS[0]), false);
  assert.equal(quotePickFor({ posts: [REQUOTE] }, SLOTS[1]).url, 'https://x.com/a/status/99');
  assert.equal(quotePickFor({ posts: [] }, SLOTS[1]), null);
  const sugg = [{ id: 's1', state: 'saved', track: 'design' }, { id: 's2', state: 'open', track: 'other', trackLabel: 'graphic design' }];
  assert.equal(suggestionFor(sugg, SLOTS[0]).id, 's2');
  assert.match(slotAlertHtml({ time: '15:25', track: 'Graphic Design', note: 'quote-react', quote: true }, { pick: null }), /No open hot picks/);
});

async function setup({ day = { date: DATE, posts: [] }, slots = SLOTS.slice(0, 2), settings = {}, suggestions = null } = {}) {
  const h = await makeHarness();
  await S.saveSettings(h.db, 'c1', { briefingEnabled: false, quietHours: { enabled: false, start: 22, end: 7 }, ...settings }, { now: T0 });
  h.readModels.loadSlotDay = async () => ({ day, slots });
  if (suggestions) h.services.listTodaySuggestions = async () => suggestions;
  h.services.creative = { thumbMedia: async (id) => ({ type: 'photo', url: `https://cdn/thumbs/${id}.jpg` }) };
  h.run = (at = T0) => { h.clock.t = at; return runDispatch(h.ctx, { now: at }); };
  return h;
}

test('dispatch: empty slots get one "Time to post" each; a rerun never repeats', async () => {
  const h = await setup({ day: { date: DATE, posts: [REQUOTE] } });
  const c = await h.run();
  assert.equal(c.slots, 2);
  const texts = h.sent().map((x) => x.args[1]);
  assert.ok(texts.some((t) => /Time to post: 3:20 PM CT/.test(t) && /Nothing drafted/.test(t)));
  const quote = texts.find((t) => /3:25 PM/.test(t));
  assert.match(quote, /Quote @a \(climbing\): https:\/\/x\.com\/a\/status\/99/);
  assert.match(quote, /Quotes left today: 3/);
  assert.equal((await h.run(T0 + 5 * MIN)).slots, 0);
  assert.equal(h.sent().length, 2);
});

test('dispatch: slot alerts off sends nothing', async () => {
  const h = await setup({ settings: { slotAlerts: false } });
  assert.equal((await h.run()).slots, 0);
  assert.equal(h.sent().length, 0);
});

test('a post placed on the slot after queueing drops the alert at send time', async () => {
  const day = { date: DATE, posts: [] };
  const h = await setup({ day, slots: SLOTS.slice(0, 1), settings: { notificationsPaused: false } });
  await S.saveSettings(h.db, 'c1', { quietHours: { enabled: true, start: 14, end: 16 } }, { now: T0 }); // queued, held by quiet hours
  assert.equal((await h.run()).slots, 1);
  day.posts.push({ id: 'p9', status: 'draft', ms: slotMs(DATE, '15:20') });
  await S.saveSettings(h.db, 'c1', { quietHours: { enabled: false, start: 22, end: 7 } }, { now: T0 });
  await h.run(T0 + 6 * MIN);
  assert.equal(h.sent().filter((x) => /Time to post/.test(x.args[1])).length, 0);
});

test('a NAS suggestion for the slot comes with its library thumbnail and a Stage from NAS button', async () => {
  const suggestions = { runKey: 'run1', suggestions: [{ id: 's1', state: 'open', track: 'design', trackLabel: 'Graphic Design', needsStaging: true, packageId: 'nas-abc', text: 'Throwback', rev: 'r1' }] };
  const h = await setup({ slots: SLOTS.slice(0, 1), suggestions });
  await h.run();
  const photo = h.sent('sendPhoto').at(-1);
  assert.equal(photo.args[1], 'https://cdn/thumbs/nas-abc.jpg');
  assert.ok(h.button(/Stage from NAS/));
  assert.ok(h.sent().some((x) => x.args[1] === 'Throwback'));
});

test('handoff card for an unstaged NAS draft sends the thumbnail preview', async () => {
  const h = await makeHarness();
  h.services.creative = { thumbMedia: async () => ({ type: 'photo', url: 'https://cdn/thumbs/k.jpg' }) };
  h.services.add(makePost({ packageId: 'k', mediaUrl: null }));
  await h.card('p1', { withMedia: true });
  const photo = h.sent('sendPhoto').at(-1);
  assert.equal(photo.args[1], 'https://cdn/thumbs/k.jpg');
  assert.match(photo.args[2].caption, /original is on the NAS/);
});

test('Copy + high-res on a NAS draft with no media stages its own original', async () => {
  const calls = [];
  const deps = {
    findHires: async () => ({ ok: true, target: { isThumbnail: false }, bestId: 'k', candidates: [{ id: 'k', self: true, staged: false }] }),
    useHires: async (a) => { calls.push(a); return { status: 'staging', workerOnline: true }; },
    candidateMedia: async () => null,
  };
  const r = await resolveCreativeMedia(deps, { id: 'p1', packageId: 'k' }, { clientId: 'c1' });
  assert.equal(r.state, 'staging');
  assert.equal(calls[0].candidateId, 'k');
});
