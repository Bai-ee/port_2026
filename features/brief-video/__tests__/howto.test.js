import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const { classifyBrief, parseBrief } = await import('../brief.js');
const { howtoSpecHash } = await import('../howto.js');
const { howtoJobId, briefJobId, selectCandidates, JOB_ID_RE } = await import('../jobs.js');
const jobsMod = await import('../jobs.js');
const { planAttach } = await import('../attach.js');
const { runTick, dryRun } = await import('../worker.js');

const CLIENT = 'paradice-dbBQCHUX';
const NOW = Date.parse('2026-11-18T15:00:00Z');
const PUBLIC = 'How to catch your first critter.';
const content = (brief) => `${PUBLIC}\n\nINTERNAL VIDEO BRIEF: ${brief}`;
const draft = (id, reviewOn, brief, extra = {}) => ({ id, clientId: CLIENT, platform: 'x', status: 'draft', reviewOn, content: content(brief), revision: 3, ...extra });
const ON = { CQ_HOWTO_ENABLED: 'true' };
const noFetch = async () => ({ ok: true });
const approved = (id, extra = {}) => ({ id, clientId: CLIENT, requestVersion: 3, status: 'approved', specHash: 'abcdef0123456789', ...extra });

let ctx;
beforeEach(() => { ctx = makeFakeContext(); });
const seed = (p) => ctx.adminDb.collection('social_posts').doc(p.id).set(p);
const seedReq = (r) => ctx.adminDb.collection('howto_requests').doc(r.id).set(r);
const jobsStore = () => ctx.adminDb._store.get('brief_video_jobs');
const post = (id) => ctx.adminDb._raw('social_posts', id);

test('classifyBrief', () => {
  assert.deepEqual(classifyBrief('howto=catch-first-critter'), { kind: 'howto', howtoId: 'catch-first-critter' });
  assert.deepEqual(classifyBrief('  howto=abc  '), { kind: 'howto', howtoId: 'abc' });
  for (const t of ['howto=AB', 'howto=Upper-case', 'HowTo=abc', 'howto: abc', 'howto=abc extra', 'howto=abc\nmore', 'howto=a_b_c', `howto=${'a'.repeat(49)}`, 'howto']) {
    assert.deepEqual(classifyBrief(t), { kind: 'invalid', reason: 'malformed-howto-line' }, t);
  }
  assert.equal(classifyBrief('howto=abc\nrequest_version: 3').reason, 'yaml-in-brief');
  assert.equal(classifyBrief('Capture the map. REQUEST_VERSION: 3').reason, 'yaml-in-brief');
  assert.deepEqual(classifyBrief('Capture the map; 15s.'), { kind: 'freetext' });
  assert.deepEqual(classifyBrief('A howto video for kids'), { kind: 'freetext' });
});

test('parseBrief keeps its shape and adds briefKind', () => {
  const f = parseBrief(content('Capture map; 15s.'));
  assert.equal(f.briefKind, 'freetext');
  assert.equal(f.howtoId, undefined);
  const h = parseBrief(content('howto=abc-123'));
  assert.equal(h.briefKind, 'howto');
  assert.equal(h.howtoId, 'abc-123');
  assert.equal(parseBrief(content('howto: nope')).invalidReason, 'malformed-howto-line');
  // free-text job ids are unchanged
  assert.equal(briefJobId({ postId: 'p1', briefHash: 'h', attempt: 1 }), briefJobId({ postId: 'p1', briefHash: 'h', attempt: 1, templateVersion: 'cq-briefcut-1' }));
});

test('howtoSpecHash fixture', () => {
  assert.equal(howtoSpecHash({ b: 1, a: { d: [2, 1], c: 'x' }, mode: 'review' }), '425dfb03e8ca3441');
  assert.equal(howtoSpecHash({ mode: 'final', a: { c: 'x', d: [2, 1] }, b: 1 }), howtoSpecHash({ b: 1, a: { d: [2, 1], c: 'x' }, mode: 'review' }));
  assert.notEqual(howtoSpecHash({ a: [1, 2] }), howtoSpecHash({ a: [2, 1] }));
});

test('howtoJobId is idempotent, hashes the specHash, differs from the cq-brief id', () => {
  const a = howtoJobId({ postId: 'p', briefHash: 'h', specHash: 's1', attempt: 1 });
  assert.match(a, JOB_ID_RE);
  assert.equal(a, howtoJobId({ postId: 'p', briefHash: 'h', specHash: 's1', attempt: 1 }));
  assert.notEqual(a, howtoJobId({ postId: 'p', briefHash: 'h', specHash: 's2', attempt: 1 }));
  assert.notEqual(a, howtoJobId({ postId: 'p', briefHash: 'h', specHash: 's1', attempt: 2 }));
  assert.notEqual(a, briefJobId({ postId: 'p', briefHash: 'h', attempt: 1 }));
});

test('selectCandidates drops howto/invalid unless includeHowto', () => {
  const posts = [draft('f', '2026-11-18', 'free text'), draft('h', '2026-11-18', 'howto=abc'), draft('i', '2026-11-18', 'howto: x')];
  assert.deepEqual(selectCandidates(posts, { today: '2026-11-18' }).map((c) => c.post.id), ['f']);
  assert.deepEqual(selectCandidates(posts, { today: '2026-11-18', includeHowto: true }).map((c) => c.post.id), ['f', 'h', 'i']);
});

test('flag off: howto and invalid briefs never create a job and never touch the draft', async () => {
  await seed(draft('h', '2026-11-18', 'howto=abc'));
  await seed(draft('i', '2026-11-19', 'howto: abc'));
  await seedReq(approved('abc'));
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: noFetch });
  assert.equal(r.started, null);
  assert.equal(r.skipped, 'no-candidate');
  assert.equal(jobsStore(), undefined);
  assert.equal(post('h').videoBriefStatus, undefined);
  assert.equal(post('i').videoBriefStatus, undefined);
});

test('flag off: a free-text draft after a howto draft still renders as cq-brief', async () => {
  await seed(draft('h', '2026-11-18', 'howto=abc'));
  await seed(draft('f', '2026-11-19', 'free text brief'));
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: noFetch });
  assert.equal(r.started.postId, 'f');
  assert.equal(ctx.adminDb._raw('brief_video_jobs', r.started.jobId).kind, 'cq-brief');
});

test('flag on, approved request: cq-howto job with specHash and its own id', async () => {
  await seed(draft('h', '2026-11-18', 'howto=abc-123'));
  await seedReq(approved('abc-123'));
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: ON, fetchImpl: noFetch });
  assert.ok(r.started);
  const job = ctx.adminDb._raw('brief_video_jobs', r.started.jobId);
  assert.equal(job.kind, 'cq-howto');
  assert.equal(job.howtoId, 'abc-123');
  assert.equal(job.specHash, 'abcdef0123456789');
  assert.equal(job.templateVersion, 'cq-howto-1');
  assert.equal(job.brief, 'howto=abc-123');
  assert.equal(job.attempt, 1);
  assert.equal(job.jobId, howtoJobId({ postId: 'h', briefHash: job.briefHash, specHash: 'abcdef0123456789', attempt: 1 }));
  assert.equal(post('h').videoBriefStatus, undefined); // nothing to clear, no write
  assert.equal(ctx.adminDb._raw('showcase_state', `briefvideo_${CLIENT}`).count, 1);
});

test('flag on, not ready: no job, no attempt, visible status written once', async () => {
  await seed(draft('m', '2026-11-18', 'howto=missing-one'));
  await seed(draft('s', '2026-11-19', 'howto=sub-one'));
  await seed(draft('a', '2026-11-20', 'howto=wrong-client'));
  await seed(draft('c', '2026-12-18', 'howto=late-one')); // outside the 7-day window: not a candidate
  await seedReq(approved('sub-one', { status: 'submitted' }));
  await seedReq(approved('wrong-client', { clientId: 'other' }));
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: ON, fetchImpl: noFetch });
  assert.equal(r.started, null);
  assert.equal(r.skipped, 'no-candidate');
  assert.equal(jobsStore(), undefined);
  assert.deepEqual([post('m').videoBriefStatus, post('m').videoBriefReason], ['waiting_howto', 'request-missing']);
  assert.deepEqual([post('s').videoBriefStatus, post('s').videoBriefReason], ['waiting_howto', 'request-submitted']);
  assert.deepEqual([post('a').videoBriefStatus, post('a').videoBriefReason], ['invalid_brief', 'client-mismatch']);
  assert.equal(post('c').videoBriefStatus, undefined);
  assert.equal(post('m').content, content('howto=missing-one')); // content untouched
  assert.equal(post('m').revision, 3);
  assert.equal(r.statusWrites.length, 3);
  const again = await runTick({ db: ctx.adminDb, now: NOW + 60_000, env: ON, fetchImpl: noFetch });
  assert.equal(again.statusWrites, undefined); // unchanged -> no writes
});

test('flag on: invalid brief gets invalid_brief, never a job; status clears once renderable', async () => {
  await seed(draft('i', '2026-11-18', 'howto=abc\nrequest_version: 3'));
  await seed(draft('w', '2026-11-19', 'howto=later-one'));
  await runTick({ db: ctx.adminDb, now: NOW, env: ON, fetchImpl: noFetch });
  assert.deepEqual([post('i').videoBriefStatus, post('i').videoBriefReason], ['invalid_brief', 'yaml-in-brief']);
  assert.equal(jobsStore(), undefined);
  await seedReq(approved('later-one'));
  const r = await runTick({ db: ctx.adminDb, now: NOW + 60_000, env: ON, fetchImpl: noFetch });
  assert.equal(r.started.postId, 'w');
  assert.deepEqual([post('w').videoBriefStatus, post('w').videoBriefReason], [null, null]);
});

test('flag on: after-campaign and status never written on non-draft posts', async () => {
  const farOut = '2026-12-18';
  await seedReq(approved('abc'));
  await seed(draft('x', farOut, 'howto=abc'));
  // after-campaign needs reviewOn inside the window: use a clock close to the campaign end
  const late = Date.parse('2026-12-16T15:00:00Z');
  const r = await runTick({ db: ctx.adminDb, now: late, env: ON, fetchImpl: noFetch });
  assert.equal(r.started, null);
  assert.deepEqual([post('x').videoBriefStatus, post('x').videoBriefReason], ['invalid_brief', 'after-campaign']);
  await seed(draft('np', '2026-12-16', 'howto=nothing-here', { status: 'approved' }));
  await runTick({ db: ctx.adminDb, now: late, env: ON, fetchImpl: noFetch });
  assert.equal(post('np').videoBriefStatus, undefined);
});

test('flag on: status writes are capped per tick', async () => {
  for (let i = 0; i < 8; i += 1) await seed(draft(`p${i}`, '2026-11-18', `howto=missing-${i}`));
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: ON, fetchImpl: noFetch });
  assert.equal(r.statusWrites.length, 5);
  const r2 = await runTick({ db: ctx.adminDb, now: NOW + 60_000, env: ON, fetchImpl: noFetch });
  assert.equal(r2.statusWrites.length, 3);
});

test('flag on: daily cap and attempts rules apply to howto jobs', async () => {
  await seed(draft('h', '2026-11-18', 'howto=abc'));
  await seedReq(approved('abc'));
  ctx.adminDb._patch('showcase_state', `briefvideo_${CLIENT}`, { day: '2026-11-18', count: 10 });
  assert.equal((await runTick({ db: ctx.adminDb, now: NOW, env: ON, fetchImpl: noFetch })).skipped, 'daily-cap');
  ctx.adminDb._patch('showcase_state', `briefvideo_${CLIENT}`, { day: '2026-11-18', count: 0 });
  const r1 = await runTick({ db: ctx.adminDb, now: NOW, env: ON, fetchImpl: noFetch });
  assert.equal(r1.started.attempt, 1);
  ctx.adminDb._patch('brief_video_jobs', r1.started.jobId, { status: 'failed' });
  const r2 = await runTick({ db: ctx.adminDb, now: NOW + 60_000, env: ON, fetchImpl: noFetch });
  assert.equal(r2.started.attempt, 2);
  ctx.adminDb._patch('brief_video_jobs', r2.started.jobId, { status: 'failed' });
  assert.equal((await runTick({ db: ctx.adminDb, now: NOW + 120_000, env: ON, fetchImpl: noFetch })).skipped, 'no-candidate');
});

test('force re-render never applies to howto briefs', async () => {
  await seed(draft('h', '2026-11-18', 'howto=abc', { mediaUrl: 'u', mediaJobId: 'bv_old123', content: PUBLIC, videoBrief: 'howto=abc' }));
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: ON, fetchImpl: noFetch, postId: 'h', force: true });
  assert.equal(r.skipped, 'howto-force-unsupported');
});

test('planAttach: cq-howto metadata, clears visible status; cq-brief unchanged', () => {
  const p = parseBrief(draft('h', '2026-11-18', 'howto=abc').content);
  const job = { jobId: 'bv_abc123', kind: 'cq-howto', howtoId: 'abc', specHash: 'sh', clientId: CLIENT, postId: 'h', briefHash: p.briefHash, status: 'done', downloadUrl: 'https://v/mp4', posterUrl: 'https://v/jpg', templateVersion: 'cq-howto-1', width: 1080, height: 1080, durationInFrames: 900 };
  const waiting = draft('h', '2026-11-18', 'howto=abc', { videoBriefStatus: 'waiting_howto', videoBriefReason: 'request-submitted' });
  const ok = planAttach(waiting, job, { now: 'T' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.updated.mediaMetadata, { source: 'cq-howto', templateVersion: 'cq-howto-1', howtoId: 'abc', specHash: 'sh', width: 1080, height: 1080, durationInFrames: 900 });
  assert.equal(ok.updated.videoBriefStatus, null);
  assert.equal(ok.updated.videoBriefReason, null);
  assert.equal(ok.updated.videoBrief, 'howto=abc');
  assert.equal(planAttach(waiting, job).ok, true);
  assert.equal(planAttach({ ...waiting, status: 'approved' }, job).reason, 'not-draft');
  assert.equal(planAttach({ ...waiting, mediaUrl: 'm' }, job).reason, 'has-media');
  // a plain cq-brief attach does not grow status fields
  const free = planAttach(draft('f', '2026-11-18', 'free'), { ...job, kind: 'cq-brief', briefHash: parseBrief(content('free')).briefHash, templateVersion: 'cq-briefcut-1' });
  assert.equal(free.updated.mediaMetadata.source, 'cq-briefcut');
  assert.ok(!('videoBriefStatus' in free.updated));
});

test('dryRun: briefKind and reasons, writes nothing', async () => {
  await seed(draft('f', '2026-11-18', 'free text'));
  await seed(draft('h', '2026-11-18', 'howto=abc'));
  await seed(draft('w', '2026-11-19', 'howto=waiting-one'));
  await seed(draft('i', '2026-11-19', 'howto: bad'));
  await seedReq(approved('abc'));
  const by = (o) => Object.fromEntries(o.clients[CLIENT].briefs.map((b) => [b.postId, b]));
  const off = await dryRun({ db: ctx.adminDb, now: NOW, env: {} });
  assert.equal(by(off).h.briefKind, 'howto');
  assert.equal(by(off).h.howtoId, 'abc');
  assert.equal(by(off).h.skipReason, 'howto-disabled');
  assert.equal(by(off).i.skipReason, 'malformed-howto-line');
  assert.equal(by(off).f.briefKind, 'freetext');
  assert.deepEqual(off.clients[CLIENT].candidates, ['f']);
  const on = await dryRun({ db: ctx.adminDb, now: NOW, env: ON });
  assert.equal(by(on).h.skipReason, undefined);
  assert.equal(by(on).w.waitingReason, 'request-missing');
  assert.deepEqual(on.clients[CLIENT].candidates.sort(), ['f', 'h']);
  assert.equal(jobsStore(), undefined);
  assert.equal(post('w').videoBriefStatus, undefined);
});

test('newJobDoc fails closed: invalid / howto without specHash throw, freetext unchanged', () => {
  const { newJobDoc } = jobsMod;
  const p = { id: 'h', clientId: CLIENT, reviewOn: '2026-11-18' };
  assert.throws(() => newJobDoc({ post: p, parsed: parseBrief(content('howto=abc\nrequest_version: 3')), attempt: 1, now: NOW }));
  const howto = parseBrief(content('howto=abc'));
  assert.throws(() => newJobDoc({ post: p, parsed: howto, attempt: 1, now: NOW }));
  assert.equal(newJobDoc({ post: p, parsed: howto, attempt: 1, now: NOW, specHash: 'abcdef0123456789' }).kind, 'cq-howto');
  assert.equal(newJobDoc({ post: p, parsed: parseBrief(content('Show a catch')), attempt: 1, now: NOW }).kind, 'cq-brief');
});

test('flag on: status sync runs while a job is active; stale status cleared when no longer a candidate', async () => {
  await seed(draft('m', '2026-11-18', 'howto=missing-one'));
  await seed(draft('f', '2026-11-19', 'Show a catch', { videoBriefStatus: 'waiting_howto', videoBriefReason: 'request-missing' }));
  await seed(draft('hold', '2026-11-19', 'HOLD', { videoBriefStatus: 'invalid_brief', videoBriefReason: 'x' }));
  await seed(draft('med', '2026-11-19', 'howto=abc', { mediaUrl: 'https://x/y.mp4', videoBriefStatus: 'waiting_howto', videoBriefReason: 'request-missing' }));
  await seed(draft('out', '2026-12-30', 'howto=abc', { videoBriefStatus: 'waiting_howto', videoBriefReason: 'request-missing' }));
  ctx.adminDb.collection('brief_video_jobs').doc('bv_active').set({ jobId: 'bv_active', clientId: CLIENT, postId: 'zzz', briefHash: 'q', status: 'rendering', attempt: 1, createdAt: new Date(NOW).toISOString(), startedAt: new Date(NOW).toISOString() });
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: ON, fetchImpl: noFetch });
  assert.equal(r.skipped, 'active-job');
  assert.deepEqual([post('m').videoBriefStatus, post('m').videoBriefReason], ['waiting_howto', 'request-missing']);
  for (const id of ['f', 'hold', 'med', 'out']) assert.equal(post(id).videoBriefStatus, null, id);
});

test('flag on: status-write cap is per tick across clients', async () => {
  const other = 'other-client';
  const clients = { [CLIENT]: 'critters-quest', [other]: 'critters-quest' };
  for (let i = 0; i < 4; i += 1) await seed(draft(`a${i}`, '2026-11-18', `howto=missing-${i}`));
  for (let i = 0; i < 4; i += 1) await seed({ ...draft(`b${i}`, '2026-11-18', `howto=missing-b${i}`), clientId: other });
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: ON, fetchImpl: noFetch, clients });
  assert.equal(r.statusWrites.length, 5);
});

test('cq-howto: a re-approved spec (new specHash) gets fresh attempts; cq-brief attempts unchanged', async () => {
  await seed(draft('h', '2026-11-18', 'howto=abc'));
  await seedReq(approved('abc'));
  for (let i = 0; i < 2; i += 1) {
    const r = await runTick({ db: ctx.adminDb, now: NOW + i * 60_000, env: ON, fetchImpl: noFetch });
    if (r.started) ctx.adminDb._patch('brief_video_jobs', r.started.jobId, { status: 'failed' });
  }
  assert.equal((await runTick({ db: ctx.adminDb, now: NOW + 600_000, env: ON, fetchImpl: noFetch })).skipped, 'no-candidate');
  ctx.adminDb._patch('howto_requests', 'abc', { specHash: '1111111111111111' });
  const r = await runTick({ db: ctx.adminDb, now: NOW + 700_000, env: ON, fetchImpl: noFetch });
  assert.equal(r.started.attempt, 1);
});

test('classifyBrief: structured how-to prose is invalid, narrow rule keeps teasers freetext', () => {
  const incident = 'CQ-S3-1119 | Nov 19, 2026\nBefore the Titans: your first gathering run\nType: Gameplay how-to + tomorrow teaser. Season context: 3; footage: CURRENT GAMEPLAY.\nAudience: New and returning CQ players.\nGoal: Teach one gathering run.\nHook: Before the Titans, start with your town.\nBanner: GATHER FIRST.\nHost: None; real UI and cursor guide viewers.\nFormat: 1080x1080 square, 21 seconds; narration OFF.\nCTA: Return tomorrow for the Season 3 reveal.';
  assert.deepEqual(classifyBrief(incident), { kind: 'invalid', reason: 'howto-prose-needs-request' });
  for (const t of [
    '15s: show two real options on the town screen, then follow the one you pick through its first step.',
    'Capture map -> select a resource node -> gather -> show the inventory change; 15s.',
    'Hook: x\nFormat: 15s\nCTA: y',
    'Type: art teaser\nHook: a\nBanner: b',
  ]) assert.equal(classifyBrief(t).kind, 'freetext', t);
});

test('briefWarnings: invalid brief warns, valid brief does not', async () => {
  const { briefWarnings } = await import('../brief.js');
  const bad = briefWarnings({ content: 'copy\n\nINTERNAL VIDEO BRIEF: Type: how-to\nHook: a\nBanner: b' });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /video brief invalid: howto-prose-needs-request/);
  assert.deepEqual(briefWarnings({ content: 'copy\n\nINTERNAL VIDEO BRIEF: howto=abc-123' }), []);
  assert.deepEqual(briefWarnings({ content: 'no brief' }), []);
});
