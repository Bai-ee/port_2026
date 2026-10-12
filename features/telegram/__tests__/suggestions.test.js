import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../store.js';
import { createMemoryRunStore } from '../../x-content-inventory/daily-loop/run-store.js';
import { LOOP_VERSION } from '../../x-content-inventory/daily-loop/config.js';
import { createReadModels } from '../read-models.js';
import { formatWhatsHappening, formatToday } from '../briefing.js';
import { runDispatch } from '../scheduler.js';
import { makeHarness, makePost, T0, MIN } from './helpers/fakes.js';

const KEY = { clientId: 'c1', localDate: '2026-10-14', channel: 'x', version: LOOP_VERSION };
const sug = (id, over = {}) => ({
  id, track: 'design', promotion: { id: 'p', label: 'Studio', url: 'https://x.test/p' },
  package: { id: `pk-${id}`, media: { kind: 'video', ref: `https://cdn/${id}.mp4` } },
  draft: { text: `Copy ${id} <exact> & more`, selfReply: 'Link: https://x.test/p' }, why: 'fits the week', kind: 'original', reviewState: 'pending', ...over,
});
const runDoc = (suggestions, fp = 'fp1') => ({ ...KEY, status: 'complete', inputFingerprint: fp, generatedAt: '2026-10-14T11:00:00Z', suggestions });

async function setup(suggestions) {
  const h = await makeHarness();
  await S.saveSettings(h.db, 'c1', { briefingEnabled: false, quietHours: { enabled: false, start: 22, end: 7 } }, { now: T0 });
  const runStore = createMemoryRunStore();
  runStore.docs.set('c1__2026-10-14__x__v' + LOOP_VERSION, runDoc(suggestions));
  const rm = createReadModels({ runStore, now: () => T0 });
  h.runStore = runStore;
  h.readModels.todaySuggestions = rm.todaySuggestions;
  h.writes = [];
  h.services.listTodaySuggestions = (c) => rm.todaySuggestions(c, { now: T0 });
  h.services.saveSuggestion = async ({ suggestionId }) => {
    h.writes.push(['save', suggestionId]);
    const s = runStore.docs.get('c1__2026-10-14__x__v' + LOOP_VERSION).suggestions.find((x) => x.id === suggestionId);
    if (!s.socialPostId) { s.socialPostId = `post-${suggestionId}`; s.reviewState = 'saved'; h.services.add(makePost({ id: s.socialPostId, content: s.draft.text })); }
    return { draftId: s.socialPostId, post: await h.services.getSocialPost('c1', s.socialPostId) };
  };
  h.services.dismissSuggestion = async ({ suggestionId }) => {
    h.writes.push(['dismiss', suggestionId]);
    runStore.docs.get('c1__2026-10-14__x__v' + LOOP_VERSION).suggestions.find((x) => x.id === suggestionId).reviewState = 'dismissed';
  };
  h.services.stageSuggestion = async ({ suggestionId }) => { h.writes.push(['stage', suggestionId]); return h.stageResult || { ok: true, status: 'queued' }; };
  return h;
}

test('read model: today run, normalised, empty when absent', async () => {
  const runStore = createMemoryRunStore();
  const rm = createReadModels({ runStore, now: () => T0 });
  assert.deepEqual((await rm.todaySuggestions('c1')).suggestions, []);
  runStore.docs.set('c1__2026-10-14__x__v' + LOOP_VERSION, runDoc([sug('a'), sug('b', { reviewState: 'dismissed' }), sug('c', { socialPostId: 'pp' })]));
  const r = await rm.todaySuggestions('c1');
  assert.deepEqual(r.suggestions.map((s) => s.state), ['open', 'dismissed', 'saved']);
  assert.equal(r.runKey, `c1__2026-10-14__x__v${LOOP_VERSION}`);
});

test('briefing: grouped count with needs-staging apart; Today lists unsaved', () => {
  const mk = (id, track, over) => ({ id, track, trackLabel: track, state: 'open', text: `t ${id}`, ...over });
  const b = { suggestions: [mk('1', 'design'), mk('2', 'design'), mk('3', 'music'), mk('4', 'music', { needsStaging: true })], queue: {} };
  const { overview } = formatWhatsHappening(b, { now: T0 });
  assert.match(overview, /3 suggestions ready — design 2 · music 1 · 1 needs staging/);
  assert.match(formatToday({ today: '2026-10-14', week: [{ date: '2026-10-14', posts: [] }] }, { now: T0, suggestions: b.suggestions }), /Unsaved suggestions[\s\S]*t 1/);
});

test('card: media, exact copy, meta line, Save + Dismiss; Save creates draft once and sends handoff card', async () => {
  const h = await setup([sug('a')]);
  await h.msg("Today's posts");
  await h.pressLabel(/Design: Copy a|design: Copy a/i);
  assert.equal(h.sent('sendVideo').length, 1);
  assert.ok(h.sent().some((c) => c.args[1] === 'Copy a <exact> & more'));
  assert.match(h.lastText(), /design · Studio · fits the week/);
  const save = h.button(/Save draft/);
  await h.press(save.ticket);
  await h.press(save.ticket); // replay
  assert.deepEqual(h.writes, [['save', 'a']]);
  assert.ok(h.button(/Post myself/) && h.button(/Approve & post now/));
  assert.match(h.lastText(), /Draft saved/);
  // a second Save ticket for the already-saved suggestion makes no second write
  const s2 = (await h.services.listTodaySuggestions('c1')).suggestions[0];
  assert.equal(s2.state, 'saved');
});

test('Dismiss hides it and later Save does nothing', async () => {
  const h = await setup([sug('a')]);
  await h.msg("What's happening?");
  await h.pressLabel(/Review suggestions \(1\)/);
  const save = h.button(/Save draft/); const dis = h.button(/Dismiss/);
  await h.press(dis.ticket);
  await h.press(save.ticket);
  assert.deepEqual(h.writes, [['dismiss', 'a']]);
  assert.match(h.answers().at(-1), /dismissed/i);
  assert.equal((await h.readModels.todaySuggestions('c1')).suggestions[0].state, 'dismissed');
});

test('stale ticket after regenerate: out of date, no write', async () => {
  const h = await setup([sug('a')]);
  await h.msg("Today's posts");
  await h.pressLabel(/design: Copy a/i);
  const save = h.button(/Save draft/);
  h.runStore.docs.get(`c1__2026-10-14__x__v${LOOP_VERSION}`).inputFingerprint = 'fp2';
  await h.press(save.ticket);
  assert.match(h.answers().at(-1), /out of date/i);
  assert.deepEqual(h.writes, []);
});

test('needs-staging: Stage (no Save); stage calls service once; offline reported; staged shows Save', async () => {
  const h = await setup([sug('a', { package: { id: 'pk', media: { status: 'needs-staging' } } })]);
  await h.msg("Today's posts");
  await h.pressLabel(/design: Copy a/i);
  assert.ok(h.button(/Stage from NAS/));
  assert.equal(h.button(/Save draft/), undefined);
  assert.match(h.lastText(), /Mac analyzer must be online/);
  h.stageResult = { ok: false, status: 'offline', message: 'x' };
  const st = h.button(/Stage from NAS/);
  await h.press(st.ticket);
  await h.press(st.ticket);
  assert.deepEqual(h.writes, [['stage', 'a']]);
  assert.match(h.lastText(), /offline/i);
  // staged: media ref arrives (same text, so rev is unchanged unless the run regenerates)
  const run = h.runStore.docs.get(`c1__2026-10-14__x__v${LOOP_VERSION}`);
  run.suggestions[0].package.media = { kind: 'video', ref: 'https://cdn/a.mp4' };
  run.inputFingerprint = 'fp3';
  await h.msg("Today's posts");
  await h.pressLabel(/design: Copy a/i);
  assert.ok(h.button(/Save draft/));
  assert.equal(h.button(/Stage from NAS/).ticket, st.ticket);
});

test('stale stage ticket: no write', async () => {
  const h = await setup([sug('a', { package: { id: 'pk', media: { status: 'needs-staging' } } })]);
  await h.msg("Today's posts");
  await h.pressLabel(/design: Copy a/i);
  const st = h.button(/Stage from NAS/);
  h.runStore.docs.get(`c1__2026-10-14__x__v${LOOP_VERSION}`).inputFingerprint = 'new';
  await h.press(st.ticket);
  assert.match(h.answers().at(-1), /out of date/i);
  assert.deepEqual(h.writes, []);
});

test('large video: poster + link, not sent by URL', async () => {
  const h = await setup([sug('a', { package: { id: 'pk', media: { kind: 'video', ref: 'https://cdn/big.mp4', bytes: 30e6, posterUrl: 'https://cdn/p.jpg' } } })]);
  await h.msg("Today's posts");
  await h.pressLabel(/design: Copy a/i);
  assert.equal(h.sent('sendVideo').length, 0);
  assert.equal(h.sent('sendPhoto').length, 1);
  assert.match(h.lastText(), /Open video: https:\/\/cdn\/big\.mp4/);
});

test('scheduler: one notice per run, deduped by run key; paused sends none', async () => {
  const h = await setup([sug('a'), sug('b')]);
  h.run = (at) => { h.clock.t = at; return runDispatch(h.ctx, { now: at }); };
  const c1 = await h.run(T0);
  assert.equal(c1.suggestions, 1);
  assert.match(h.lastText(), /2 suggestions ready — design 2/);
  const c2 = await h.run(T0 + 10 * MIN);
  assert.equal(c2.suggestions || 0, 0);
  assert.equal(h.sent().length, 1);
});

test('scheduler: notifications paused => no suggestion notice', async () => {
  const h = await setup([sug('a')]);
  await S.saveSettings(h.db, 'c1', { notificationsPaused: true }, { now: T0 });
  await runDispatch(h.ctx, { now: T0 });
  assert.equal(h.sent().length, 0);
});
