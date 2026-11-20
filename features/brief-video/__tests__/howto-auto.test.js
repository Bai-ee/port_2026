import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const { requestHash, effectiveNarration, howtoReadiness } = await import('../howto.js');
const { validateHowtoRequest, submitHowtoRequest, getHowtoRequest } = await import('../howto-request.js');
const { howtoRequestJobId, newJobDoc, JOB_ID_RE } = await import('../jobs.js');
const { parseBrief } = await import('../brief.js');
const { planAttach, attachJobToPost } = await import('../attach.js');
const { runTick, renderNow, attachIfDone } = await import('../worker.js');

const CLIENT = 'paradice-dbBQCHUX';
const NOW = Date.parse('2026-11-18T15:00:00Z'); // 2026-11-18 CT
const ENV = { CQ_HOWTO_ENABLED: 'true', DAILY_BRIEF_VIDEO_ENABLED: 'true', SHOWCASE_RENDER_URL: 'https://r.test', SHOWCASE_RENDER_SECRET: 's' };
const PUBLIC = 'How to catch your first critter.';
const content = (brief) => `${PUBLIC}\n\nINTERNAL VIDEO BRIEF: ${brief}`;
const draft = (id, reviewOn, brief, extra = {}) => ({ id, clientId: CLIENT, platform: 'x', status: 'draft', reviewOn, content: content(brief), revision: 1, ...extra });
const good32 = () => ({
  request_version: 3.2, season: 1, id: 'gather-first-decision', review_on: '2026-11-18', type: 'how-to', game_commit: '3d70fa48f',
  goal: 'g', audience: 'new player', public_copy: 'The first decision in Critters Quest.', hook: 'What do you gather first?', banner: 'GATHER NOW',
  host: { name: 'mayor' }, arrival: { say: 'Let me show you.' },
  steps: [
    { say: 'Tap a spot, then the axe.', panel: 'spotTile', surface: 'canvas', clicks: [{ action: 'selectSpot' }] },
    { say: 'Pick a critter and send it.', panel: 'critterSelection', surface: 'card', clicks: [{ action: 'openTools', target: 'GO', handler: 'C.tsx:1' }] },
  ],
  payoff: { say: 'Every haul stocks your town!', spot_art: 'images/Sapling.png', town: { name: 'Maple Hollow', level: 3 } },
});

let ctx;
let pokes;
const fetchImpl = async (url, init) => { pokes.push(JSON.parse(init.body).jobId); return { ok: true }; };
beforeEach(() => { ctx = makeFakeContext(); pokes = []; });
const db = () => ctx.adminDb;
const submit = (request) => submitHowtoRequest(db(), { clientId: CLIENT, request, by: 'o', now: () => '2026-11-18T10:00:00Z' });
const seed = (p) => db().collection('social_posts').doc(p.id).set(p);
const rec = () => db()._raw('howto_requests', 'gather-first-decision');

test('requestHash fixture (same expected value as the hub)', () => {
  assert.equal(requestHash({ b: 1, a: { d: [2, 1], c: 'x' } }), '9ad173b6e2b1e6b4');
  assert.equal(requestHash({ a: { c: 'x', d: [2, 1] }, b: 1 }), '9ad173b6e2b1e6b4');
  assert.notEqual(requestHash({ a: [1, 2] }), requestHash({ a: [2, 1] }));
});

test('validate 3.2: click.action required and shaped; narration default true for 3.2 only', () => {
  assert.deepEqual(validateHowtoRequest(good32()), { errors: [], warnings: [] });
  const bad = (mut) => { const r = good32(); mut(r); return validateHowtoRequest(r).errors.join('|'); };
  assert.match(bad((r) => { delete r.steps[0].clicks[0].action; }), /clicks\[0\]\.action/);
  assert.match(bad((r) => { r.steps[0].clicks[0].action = '1bad'; }), /clicks\[0\]\.action/);
  assert.match(bad((r) => { r.steps[0].clicks[0].action = 'a b'; }), /clicks\[0\]\.action/);
  assert.match(bad((r) => { r.request_version = 3.4; }), /request_version/);
  assert.equal(effectiveNarration(good32()), true);
  assert.equal(effectiveNarration({ ...good32(), narration: false }), false);
  assert.equal(effectiveNarration({ request_version: 3.1 }), false);
  assert.equal(effectiveNarration({ request_version: 3.1, narration: true }), true);
  // <=3.1 still needs target + handler, not action
  const old = good32(); old.request_version = 3.1;
  assert.match(validateHowtoRequest(old).errors.join('|'), /target is required/);
});

test('submit 3.2: auto-approved with requestHash; overwrite while autoApproved, locked once owner-approved', async () => {
  const out = await submit(good32());
  assert.deepEqual([out.ok, out.status, out.autoApproved, out.narration], [true, 'approved', true, true]);
  const r = rec();
  assert.deepEqual([r.status, r.autoApproved, r.approvedBy, r.requestVersion, r.requestHash], ['approved', true, 'auto', 3.2, requestHash(good32())]);
  assert.equal(r.specHash, undefined);
  const again = good32(); again.hook = 'Another hook?';
  assert.equal((await submit(again)).ok, true);
  assert.equal(rec().requestHash, requestHash(again));
  assert.equal(rec().submittedAt, '2026-11-18T10:00:00Z');
  await db().collection('howto_requests').doc('gather-first-decision').set({ ...rec(), autoApproved: false, approvedBy: 'owner-script', specHash: 'x' });
  const locked = await submit(good32());
  assert.deepEqual([locked.ok, locked.error, locked.status], [false, 'request-locked:approved', 409]);
  const g = await getHowtoRequest(db(), { clientId: CLIENT, id: 'gather-first-decision' });
  assert.equal(g.autoApproved, false);
});

test('submit <=3.1 keeps the submitted flow', async () => {
  const r = { ...good32(), request_version: 3.1 }; r.steps = r.steps.map((s) => ({ ...s, clicks: [{ target: 't', handler: 'h' }] }));
  const out = await submit(r);
  assert.equal(out.status, 'submitted');
  assert.equal(rec().autoApproved, undefined);
  assert.equal(rec().requestVersion, 3);
});

test('howtoReadiness: auto-approved request is ready (hash checked); legacy specHash unchanged', async () => {
  await submit(good32());
  const r = await howtoReadiness(db(), { howtoId: 'gather-first-decision', clientId: CLIENT, reviewOn: '2026-11-18' });
  assert.deepEqual([r.ready, r.specHash, r.requestHash, r.narration], [true, null, requestHash(good32()), true]);
  await db().collection('howto_requests').doc('gather-first-decision').set({ ...rec(), requestHash: 'deadbeefdeadbeef' });
  const bad = await howtoReadiness(db(), { howtoId: 'gather-first-decision', clientId: CLIENT, reviewOn: '2026-11-18' });
  assert.deepEqual([bad.ready, bad.reason], [false, 'request-hash-mismatch']);
});

test('job id and doc for a request job', () => {
  const a = howtoRequestJobId({ postId: 'p', briefHash: 'h', requestHash: 'r', narration: true, attempt: 1 });
  assert.match(a, JOB_ID_RE);
  assert.notEqual(a, howtoRequestJobId({ postId: 'p', briefHash: 'h', requestHash: 'r', narration: false, attempt: 1 }));
  assert.notEqual(a, howtoRequestJobId({ postId: 'p', briefHash: 'h', requestHash: 'r2', narration: true, attempt: 1 }));
  const job = newJobDoc({ post: { id: 'p', clientId: CLIENT, reviewOn: '2026-11-18' }, parsed: parseBrief(content('howto=abc-123')), attempt: 1, now: NOW, request: good32(), requestHash: 'r', narration: true, renderNow: true });
  assert.deepEqual([job.kind, job.howtoId, job.requestHash, job.narration, job.renderNow, job.templateVersion, job.specHash], ['cq-howto', 'abc-123', 'r', true, true, 'cq-howto-1', undefined]);
  assert.deepEqual(job.request, good32());
});

test('cron: auto-approved request becomes a request job (narration default true)', async () => {
  await submit(good32());
  await seed(draft('h', '2026-11-18', 'howto=gather-first-decision'));
  const r = await runTick({ db: db(), now: NOW, env: ENV, fetchImpl });
  assert.ok(r.started);
  const job = db()._raw('brief_video_jobs', r.started.jobId);
  assert.deepEqual([job.kind, job.requestHash, job.narration, job.renderNow, job.specHash], ['cq-howto', requestHash(good32()), true, false, undefined]);
  assert.deepEqual(job.request, good32());
  // idempotent: next tick does not start a second job for the same request
  const r2 = await runTick({ db: db(), now: NOW + 1000, env: ENV, fetchImpl });
  assert.equal(r2.started, null);
});

test('renderNow: howto draft, no window, own cap, pokes service, narration override', async () => {
  await submit(good32());
  await seed(draft('far', '2026-12-10', 'howto=gather-first-decision')); // outside the 7-day window
  const out = await renderNow({ db: db(), clientId: CLIENT, postId: 'far', narration: false, now: NOW, env: ENV, fetchImpl });
  assert.deepEqual([out.ok, out.status], [true, 'queued']);
  const job = db()._raw('brief_video_jobs', out.jobId);
  assert.deepEqual([job.renderNow, job.narration, job.requestHash], [true, false, requestHash(good32())]);
  assert.deepEqual(pokes, [out.jobId]);
  assert.equal(db()._raw('brief_video_usage', '2026-11-18').count, 1);
  assert.equal(db()._store.get('showcase_state'), undefined); // cron counter untouched
  // second call returns the live job, no second job / usage
  const again = await renderNow({ db: db(), clientId: CLIENT, postId: 'far', now: NOW, env: ENV, fetchImpl });
  assert.deepEqual([again.jobId, again.existing], [out.jobId, true]);
  assert.equal(db()._raw('brief_video_usage', '2026-11-18').count, 1);
});

test('renderNow: freetext draft works; refusals', async () => {
  await seed(draft('f', '2026-12-30', 'Show a catch'));
  const ok = await renderNow({ db: db(), clientId: CLIENT, postId: 'f', now: NOW, env: ENV, fetchImpl });
  assert.equal(db()._raw('brief_video_jobs', ok.jobId).kind, 'cq-brief');
  assert.equal(db()._raw('brief_video_jobs', ok.jobId).renderNow, true);
  const t = (postId, o = {}) => renderNow({ db: db(), clientId: CLIENT, postId, now: NOW, env: ENV, fetchImpl, ...o });
  await seed(draft('media', '2026-11-18', 'Show a catch', { mediaUrl: 'm' }));
  await seed(draft('hold', '2026-11-18', 'Show a catch HOLD'));
  await seed(draft('sched', '2026-11-18', 'Show a catch', { status: 'scheduled' }));
  await seed(draft('inv', '2026-11-18', 'howto: x'));
  await seed(draft('late', '2026-12-30', 'howto=gather-first-decision'));
  await seed(draft('nohow', '2026-11-18', 'howto=missing-one'));
  await seed({ id: 'nobrief', clientId: CLIENT, status: 'draft', content: 'plain', reviewOn: '2026-11-18' });
  await submit(good32());
  const code = async (p, o) => (await t(p, o)).error;
  assert.equal(await code('media'), 'has-media');
  assert.equal(await code('hold'), 'hold');
  assert.equal(await code('sched'), 'not-draft');
  assert.equal(await code('inv'), 'invalid-brief:malformed-howto-line');
  assert.equal(await code('late'), 'after-campaign');
  assert.equal(await code('nohow'), 'request-missing');
  assert.equal(await code('nobrief'), 'no-brief');
  assert.equal(await code('ghost'), 'post-not-found');
  assert.equal(await code('f', { env: { ...ENV, DAILY_BRIEF_VIDEO_ENABLED: 'false' } }), 'video-disabled');
  assert.equal(await code('late', { env: { DAILY_BRIEF_VIDEO_ENABLED: 'true' } }), 'howto-disabled');
  assert.equal((await t('f', { narration: 'yes' })).status, 400);
  assert.equal((await renderNow({ db: db(), clientId: 'other', postId: 'f', now: NOW, env: ENV })).status, 403);
});

test('renderNow: daily cap of 5 per CT day, counter shared across posts', async () => {
  for (let i = 0; i < 6; i += 1) await seed(draft(`p${i}`, '2026-11-18', `Show a catch ${i}`));
  const res = [];
  for (let i = 0; i < 6; i += 1) res.push(await renderNow({ db: db(), clientId: CLIENT, postId: `p${i}`, now: NOW, env: ENV, fetchImpl }));
  assert.deepEqual(res.map((r) => r.ok), [true, true, true, true, true, false]);
  assert.deepEqual([res[5].status, res[5].error], [429, 'daily-cap']);
  assert.equal(db()._store.get('brief_video_jobs').size, 5);
});

test('tick: finished renderNow jobs attach first, up to 3, outside the one-per-tick attach', async () => {
  const done = (id, extra = {}) => ({ v: 1, jobId: `bv_${id}`, clientId: CLIENT, postId: id, briefHash: parseBrief(content(`b ${id}`)).briefHash, kind: 'cq-brief', status: 'done', createdAt: `2026-11-18T0${id.length}:00:00Z`, downloadUrl: 'https://v/m.mp4', posterUrl: 'https://v/p.jpg', templateVersion: 'cq-briefcut-1', attempt: 1, ...extra });
  for (const id of ['r1', 'r2', 'r3', 'r4', 'n1']) await seed(draft(id, '2026-12-30', `b ${id}`));
  for (const id of ['r1', 'r2', 'r3', 'r4']) await db().collection('brief_video_jobs').doc(`bv_${id}`).set(done(id, { renderNow: true }));
  await db().collection('brief_video_jobs').doc('bv_n1').set(done('n1'));
  const r = await runTick({ db: db(), now: NOW, env: ENV, fetchImpl });
  assert.equal(r.attachedRenderNow.length, 3);
  assert.ok(r.attachedRenderNow.every((x) => x.attached));
  assert.equal(r.attached.jobId, 'bv_n1');
  assert.equal(r.attached.attached, true);
  assert.equal(db()._raw('brief_video_jobs', 'bv_r4').attachedAt, undefined);
  const r2 = await runTick({ db: db(), now: NOW + 1000, env: ENV, fetchImpl });
  assert.equal(r2.attachedRenderNow.length, 1);
});

const hubLocalJob = (extra = {}) => ({ v: 1, jobId: 'bv_local_abc123def456', kind: 'cq-howto', source: 'local', replaceDraftMedia: true, clientId: CLIENT, videoClient: 'critters-quest', postId: 'h', reviewOn: '2026-11-18', status: 'done', templateVersion: 'cq-howto-1', outputPath: 'clients/c/brief-videos/x.mp4', downloadUrl: 'https://v/m.mp4', posterUrl: 'https://v/p.jpg', width: 1080, height: 1080, durationInFrames: 900, ...extra });

test('planAttach: hub-shaped local takeover job (no briefHash/howtoId) replaces brief-job media on a draft only', () => {
  const job = hubLocalJob();
  const withBrief = draft('h', '2026-11-18', 'howto=abc', { mediaUrl: 'old', mediaJobId: 'bv_old1' });
  const ok = planAttach(withBrief, job, { now: 'T' });
  assert.equal(ok.ok, true);
  assert.equal(ok.updated.content, PUBLIC);
  assert.equal(ok.updated.mediaUrl, job.downloadUrl);
  assert.equal(ok.updated.mediaJobId, job.jobId);
  assert.equal(ok.updated.mediaMetadata.source, 'cq-howto');
  // already attached once (brief moved to videoBrief) and no brief at all both work
  assert.equal(planAttach({ ...ok.updated, mediaUrl: 'old', mediaJobId: 'bv_old1' }, job).ok, true);
  const noBrief = planAttach({ id: 'h', clientId: CLIENT, status: 'draft', content: PUBLIC, mediaUrl: 'old', mediaJobId: 'bv_old1' }, job);
  assert.equal(noBrief.ok, true);
  assert.ok(!('videoBrief' in noBrief.updated));
  // never owner-uploaded media, never other media, never non-drafts, never another client
  assert.equal(planAttach({ ...withBrief, mediaJobId: undefined }, job).reason, 'has-media');
  assert.equal(planAttach({ ...withBrief, mediaJobId: 'sc_other' }, job).reason, 'has-media');
  assert.equal(planAttach({ ...withBrief, nasSha: 'x' }, job).reason, 'has-media');
  assert.equal(planAttach({ ...withBrief, status: 'approved' }, job).reason, 'not-draft');
  assert.equal(planAttach({ ...withBrief, status: 'scheduled' }, job).reason, 'not-draft');
  assert.equal(planAttach({ ...withBrief, clientId: 'x' }, job).reason, 'client-mismatch');
  // a normal (non-local) replaceDraftMedia-less job still needs the brief hash
  assert.equal(planAttach(withBrief, { ...job, source: undefined, replaceDraftMedia: false, briefHash: 'nope' }).reason, 'has-media');
  assert.equal(planAttach(draft('h', '2026-11-18', 'howto=abc'), { ...job, source: undefined, replaceDraftMedia: false, briefHash: 'nope' }).reason, 'brief-changed');
});

test('tick attaches a hub-shaped local takeover job through the attach transaction', async () => {
  await seed(draft('h', '2026-12-30', 'howto=abc', { mediaUrl: 'old', mediaJobId: 'bv_old1' }));
  await db().collection('brief_video_jobs').doc('bv_local_abc123def456').set({ ...hubLocalJob(), createdAt: '2026-11-18T01:00:00Z' });
  const r = await runTick({ db: db(), now: NOW, env: ENV, fetchImpl });
  assert.equal(r.attached.attached, true);
  const post = db()._raw('social_posts', 'h');
  assert.deepEqual([post.mediaUrl, post.mediaJobId, post.status, post.content], ['https://v/m.mp4', 'bv_local_abc123def456', 'draft', PUBLIC]);
  assert.ok(db()._raw('brief_video_jobs', 'bv_local_abc123def456').attachedAt);
  // approved post: skipped, never replaced
  await seed(draft('a', '2026-12-30', 'howto=abc', { status: 'approved', mediaUrl: 'old', mediaJobId: 'bv_old1' }));
  const res = await attachJobToPost({ ...hubLocalJob({ jobId: 'bv_local_zzz', postId: 'a' }) }, { db: db() });
  assert.equal(res.reason, 'job-not-done'); // not stored: transaction refuses
});

test('finished jobs keep matching their source (service rewrites specHash): no re-pick, no render-now 409', async () => {
  await submit(good32());
  await seed(draft('h', '2026-11-18', 'howto=gather-first-decision'));
  const r = await runTick({ db: db(), now: NOW, env: ENV, fetchImpl });
  const jobRef = db().collection('brief_video_jobs').doc(r.started.jobId);
  // service finished it and wrote a specHash, but the attach is skipped (attachSkipped) so the draft stays a candidate
  await jobRef.set({ status: 'done', specHash: 'aaaabbbbccccdddd', attachSkipped: 'brief-changed', downloadUrl: 'u', posterUrl: 'p' }, { merge: true });
  const again = await runTick({ db: db(), now: NOW + 1000, env: ENV, fetchImpl });
  assert.equal(again.started, null);
  assert.equal(again.skipped, 'no-candidate');
  const rn = await renderNow({ db: db(), clientId: CLIENT, postId: 'h', now: NOW, env: ENV, fetchImpl });
  assert.equal(rn.ok, true); // attachSkipped job is not "live": a new attempt is created, not a 409
  assert.notEqual(rn.jobId, r.started.jobId);
  // a live finished job (done, not skipped) is returned as existing
  const rn2 = await renderNow({ db: db(), clientId: CLIENT, postId: 'h', now: NOW, env: ENV, fetchImpl });
  assert.equal(rn2.existing, true);
});

test('free-text jobs: an 8-hex specHash written by the service does not break matching', async () => {
  await seed(draft('f', '2026-11-18', 'Show a catch'));
  const r = await runTick({ db: db(), now: NOW, env: ENV, fetchImpl });
  await db().collection('brief_video_jobs').doc(r.started.jobId).set({ status: 'done', specHash: 'a1b2c3d4', attachSkipped: 'x' }, { merge: true });
  const again = await runTick({ db: db(), now: NOW + 1000, env: ENV, fetchImpl });
  assert.equal(again.skipped, 'no-candidate');
  const rn = await renderNow({ db: db(), clientId: CLIENT, postId: 'f', now: NOW, env: ENV, fetchImpl });
  assert.equal(rn.ok, true);
});

test('validate 3.2: season integer, 1-3 clicks per step, 2-4 steps, town level 1-15', () => {
  const bad = (mut) => { const r = good32(); mut(r); return validateHowtoRequest(r).errors.join('|'); };
  assert.match(bad((r) => { delete r.season; }), /season must be an integer/);
  assert.match(bad((r) => { r.season = '1'; }), /season/);
  assert.match(bad((r) => { r.season = 1.5; }), /season/);
  assert.match(bad((r) => { r.steps[0].clicks = []; }), /at least 1 click/);
  assert.match(bad((r) => { r.steps[0].clicks = Array(4).fill({ action: 'selectSpot' }); }), /at most 3/);
  assert.equal(bad((r) => { r.steps[0].clicks = Array(3).fill({ action: 'selectSpot' }); }), '');
  assert.match(bad((r) => { r.steps = [r.steps[0]]; }), /2 to 4/);
  assert.match(bad((r) => { r.steps = Array(5).fill(r.steps[0]); }), /2 to 4/);
  assert.match(bad((r) => { r.payoff.town.level = 0; }), /1-15/);
  assert.match(bad((r) => { r.payoff.town.level = 2.5; }), /1-15/);
  // <=3.1 does not require season
  const old = { ...good32(), request_version: 3.1 }; delete old.season;
  assert.doesNotMatch(validateHowtoRequest(old).errors.join('|'), /season/);
});

test('3.2: game_commit is optional (provenance only); a given value must be a hex hash; <=3.1 still requires it', async () => {
  const { validateHowtoRequest } = await import('../howto-request.js');
  const base = { request_version: 3.2, season: 3, id: 'gather-auto-test', review_on: '2026-12-06', type: 'how-to', narration: false, goal: 'g', audience: 'new player', public_copy: 'p', hook: 'What do you gather first?', banner: 'GATHER NOW', host: { name: 'mayor' }, arrival: { say: 'Let me show you.' },
    steps: [{ say: 'Tap a spot, then the axe.', panel: 'spotTile', surface: 'canvas', clicks: [{ action: 'selectSpot' }, { action: 'openTools' }] }, { say: 'Pick a critter and send it out.', panel: 'critterSelection', surface: 'card', clicks: [{ action: 'selectCritter' }] }],
    payoff: { say: 'Every haul stocks your town!', spot_art: 'images/game/atlases/spots/Sapling.png', town: { name: 'Maple Hollow', level: 5 } } };
  assert.deepEqual(validateHowtoRequest(base).errors, []);
  assert.deepEqual(validateHowtoRequest({ ...base, game_commit: '3d70fa48f' }).errors, []);
  assert.deepEqual(validateHowtoRequest({ ...base, game_commit: 'latest' }).errors, ['game_commit, when given, must be a 7-40 character hex git hash']);
  const old = validateHowtoRequest({ ...base, request_version: 3.1, steps: base.steps.map((s) => ({ ...s, clicks: s.clicks.map((c) => ({ ...c, target: 't', handler: 'h' })) })) });
  assert.ok(old.errors.includes('game_commit is required'));
});

test('3.2: host.name and surface optional; non-empty new_panels rejected; type errors say what was got', async () => {
  const { validateHowtoRequest } = await import('../howto-request.js');
  const base = { request_version: 3.2, season: 3, id: 'gather-auto-test', review_on: '2026-12-06', type: 'how-to', goal: 'g', audience: 'a', public_copy: 'p', hook: 'h', banner: 'GATHER NOW', arrival: { say: 'Let me show you.' },
    steps: [{ say: 'Tap a spot, then the axe.', panel: 'spotTile', clicks: [{ action: 'selectSpot' }] }, { say: 'Pick a critter and send it out.', panel: 'critterSelection', clicks: [{ action: 'send' }] }],
    payoff: { say: 'Every haul stocks your town!', spot_art: 'x.png', town: { name: 'T', level: 5 } } };
  assert.deepEqual(validateHowtoRequest(base).errors, []);
  assert.deepEqual(validateHowtoRequest({ ...base, new_panels: [] }).errors, []);
  assert.deepEqual(validateHowtoRequest({ ...base, new_panels: [{ name: null, component: null, children: [] }] }).errors, []);
  assert.match(validateHowtoRequest({ ...base, new_panels: [{ name: 'reward modal' }] }).errors.join(), /new_panels must be empty/);
  assert.match(validateHowtoRequest({ ...base, season: '3' }).errors.join(), /got "3"/);
  assert.match(validateHowtoRequest({ ...base, request_version: '3.2' }).errors.join(), /got "3.2"/);
});

test('attachIfDone: a finished panel-brief video attaches on demand; second call is a no-op', async () => {
  const { briefHash } = await import('../brief.js');
  await seed({ id: 'p', clientId: CLIENT, platform: 'x', status: 'draft', reviewOn: '2026-11-18', content: 'Clean copy.', revision: 3, videoBrief: 'Shot 1', videoBriefMeta: { status: 'approved' } });
  await db().collection('brief_video_jobs').doc('bv_p1').set({ jobId: 'bv_p1', postId: 'p', clientId: CLIENT, status: 'done', briefHash: briefHash('Shot 1'), downloadUrl: 'https://v/p.mp4', posterUrl: 'https://v/p.jpg', createdAt: '2026-11-18T14:00:00Z', kind: 'cq-brief' });
  const r = await attachIfDone({ db: db(), clientId: CLIENT, postId: 'p', now: NOW, env: ENV });
  assert.equal(r.ok, true);
  assert.equal(r.attached.attached, true);
  assert.equal(r.post.mediaUrl, 'https://v/p.mp4');
  assert.equal(r.post.videoBriefMeta.status, 'rendered');
  assert.equal(r.videoProcessing.state, 'attached');
  const again = await attachIfDone({ db: db(), clientId: CLIENT, postId: 'p', now: NOW, env: ENV });
  assert.equal(again.attached, null);
  assert.equal((await attachIfDone({ db: db(), clientId: 'other', postId: 'p', now: NOW, env: ENV })).status, 404);
});
