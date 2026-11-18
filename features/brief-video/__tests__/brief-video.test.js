import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const { parseBrief, stripBrief, hasInternalBrief, briefHash } = await import('../brief.js');
const { briefJobId, selectCandidates, JOB_ID_RE } = await import('../jobs.js');
const { planAttach } = await import('../attach.js');
const { runTick, dryRun, ctToday } = await import('../worker.js');
const { DAILY_BRIEF_VIDEO_CLIENTS } = await import('../clients.js');

const CLIENT = 'paradice-dbBQCHUX';
const BRIEF = 'Capture map → select a resource node → gather → show the inventory change; 15s, label the resource and hold on the result.';
const PUBLIC = 'The first decision in Critters Quest: what do you gather first?';
const content = (pub = PUBLIC, brief = BRIEF) => `${pub}\n\nINTERNAL VIDEO BRIEF: ${brief}`;
const NOW = Date.parse('2026-11-18T15:00:00Z'); // 09:00 CT, 2026-11-18

const draft = (id, reviewOn, extra = {}) => ({ id, clientId: CLIENT, platform: 'x', status: 'draft', reviewOn, content: content(PUBLIC, `${BRIEF} #${id}`), revision: 3, ...extra });

let ctx;
beforeEach(() => { ctx = makeFakeContext(); });
const seed = async (p) => ctx.adminDb.collection('social_posts').doc(p.id).set(p);
const jobsRaw = (id) => ctx.adminDb._raw('brief_video_jobs', id);
const noFetch = async () => ({ ok: true });

test('parseBrief and strip regex', () => {
  const p = parseBrief(content());
  assert.equal(p.brief, BRIEF);
  assert.equal(p.hook, 'The first decision in Critters Quest: what do you gather first?');
  assert.equal(p.briefHash, briefHash(`  ${BRIEF}  `));
  assert.equal(p.briefHash.length, 16);
  assert.equal(stripBrief(content()), PUBLIC);
  assert.equal(stripBrief('plain copy'), 'plain copy');
  assert.equal(parseBrief('no marker here'), null);
  assert.equal(parseBrief('copy\n\nINTERNAL VIDEO BRIEF:   '), null);
  assert.equal(stripBrief('copy\r\n\r\nINTERNAL VIDEO BRIEF: line1\nline2'), 'copy');
  assert.equal(stripBrief('copy\n\ninternal video brief: lower'), 'copy');
  assert.ok(hasInternalBrief('x INTERNAL VIDEO BRIEF y'));
  assert.ok(!hasInternalBrief('a normal post'));
  assert.equal(parseBrief('One. Two.\n\nINTERNAL VIDEO BRIEF: b').hook, 'One.');
});

test('job ids are idempotent and well formed', () => {
  const a = briefJobId({ postId: 'p1', briefHash: 'h', attempt: 1 });
  assert.equal(a, briefJobId({ postId: 'p1', briefHash: 'h', attempt: 1 }));
  assert.notEqual(a, briefJobId({ postId: 'p1', briefHash: 'h', attempt: 2 }));
  assert.notEqual(a, briefJobId({ postId: 'p2', briefHash: 'h', attempt: 1 }));
  assert.notEqual(a, briefJobId({ postId: 'p1', briefHash: 'h2', attempt: 1 }));
  assert.notEqual(a, briefJobId({ postId: 'p1', briefHash: 'h', attempt: 1, templateVersion: 'v9' }));
  assert.match(a, JOB_ID_RE);
  assert.equal(a.length, 3 + 20);
});

test('selectCandidates: window, allowlist, status, media, brief, order', () => {
  const posts = [
    draft('late', '2026-11-30'),
    draft('today2', '2026-11-18'),
    draft('a-today', '2026-11-18'),
    draft('edge', '2026-11-25'),
    draft('past', '2026-11-17'),
    draft('beyond', '2026-11-26'),
    draft('media', '2026-11-19', { mediaUrl: 'https://x/y.mp4' }),
    draft('posted', '2026-11-19', { status: 'posted' }),
    draft('nobrief', '2026-11-19', { content: 'just copy' }),
    draft('nodate', null),
    { ...draft('other', '2026-11-19'), clientId: 'someone-else' },
  ];
  const ids = selectCandidates(posts, { today: '2026-11-18' }).map((c) => c.post.id);
  assert.deepEqual(ids, ['a-today', 'today2', 'edge']);
  assert.equal(ctToday(NOW), '2026-11-18');
});

test('planAttach preconditions', () => {
  const p = parseBrief(draft('p', '2026-11-18').content);
  const job = { jobId: 'bv_abc123', clientId: CLIENT, postId: 'p', briefHash: p.briefHash, status: 'done', downloadUrl: 'https://v/mp4', posterUrl: 'https://v/jpg', outputPath: 'clients/c/brief-videos/a.mp4', templateVersion: 'cq-briefcut-1', width: 1080, height: 1080, durationInFrames: 450 };
  const post = draft('p', '2026-11-18');
  const ok = planAttach(post, job, { now: 'T' });
  assert.ok(ok.ok);
  const u = ok.updated;
  assert.equal(u.content, 'The first decision in Critters Quest: what do you gather first?');
  assert.ok(!/INTERNAL VIDEO BRIEF/i.test(u.content));
  assert.equal(u.videoBrief, post.content.split('INTERNAL VIDEO BRIEF:')[1].trim());
  assert.equal(u.videoBriefHash, p.briefHash);
  assert.equal(u.mediaUrl, job.downloadUrl);
  assert.equal(u.mediaType, 'video');
  assert.equal(u.mediaContentType, 'video/mp4');
  assert.equal(u.mediaStoragePath, job.outputPath);
  assert.equal(u.mediaJobId, 'bv_abc123');
  assert.equal(u.posterUrl, job.posterUrl);
  assert.deepEqual(u.mediaMetadata, { source: 'cq-briefcut', templateVersion: 'cq-briefcut-1', width: 1080, height: 1080, durationInFrames: 450 });
  assert.deepEqual(u.agents.mediaGenerator, { status: 'complete', note: u.agents.mediaGenerator.note, mediaUrl: job.downloadUrl, jobId: 'bv_abc123' });
  assert.equal(u.revision, 4);
  assert.equal(u.updatedAt, 'T');
  assert.equal(u.status, 'draft');

  assert.equal(planAttach(null, job).reason, 'post-missing');
  assert.equal(planAttach({ ...post, clientId: 'x' }, job).reason, 'client-mismatch');
  assert.equal(planAttach({ ...post, status: 'approved' }, job).reason, 'not-draft');
  assert.equal(planAttach({ ...post, mediaUrl: 'https://m' }, job).reason, 'has-media');
  assert.equal(planAttach({ ...post, content: content(PUBLIC, 'edited brief') }, job).reason, 'brief-changed');
  assert.equal(planAttach({ ...post, content: 'brief removed' }, job).reason, 'no-brief');
  assert.equal(planAttach(post, { ...job, posterUrl: null }).reason, 'job-incomplete');
  // after a first attach the brief lives in videoBrief; the hash still matches, a re-attach needs force + a bv_ job
  assert.equal(planAttach(u, job).reason, 'has-media');
  assert.equal(planAttach(u, job, { force: true }).ok, true);
  assert.equal(planAttach({ ...u, mediaJobId: 'sc_other' }, job, { force: true }).reason, 'has-media');
  assert.equal(planAttach({ ...u, videoBriefHash: 'different' }, job, { force: true }).reason, 'brief-changed');
});

test('runTick: dry-run writes nothing and lists every brief', async () => {
  await seed(draft('a', '2026-11-18'));
  await seed(draft('b', '2026-12-30'));
  await seed(draft('c', '2026-11-19', { content: 'no brief' }));
  const out = await dryRun({ db: ctx.adminDb, now: NOW });
  const c = out.clients[CLIENT];
  assert.equal(c.briefCount, 2);
  assert.deepEqual(c.candidates, ['a']);
  assert.ok(c.briefs.every((b) => b.briefHash.length === 16 && b.brief));
  assert.equal(ctx.adminDb._store.get('brief_video_jobs'), undefined);
});

test('runTick: starts one job, pokes the service, and is idempotent', async () => {
  await seed(draft('a', '2026-11-18'));
  await seed(draft('b', '2026-11-19'));
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, secret: opts.headers['x-render-secret'], body: opts.body }); return { ok: true }; };
  const env = { SHOWCASE_RENDER_URL: 'https://svc.example/', SHOWCASE_RENDER_SECRET: 's3' };
  const r1 = await runTick({ db: ctx.adminDb, now: NOW, env, fetchImpl });
  assert.equal(r1.started.postId, 'a');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://svc.example/render');
  assert.equal(calls[0].secret, 's3');
  const job = jobsRaw(r1.started.jobId);
  assert.equal(job.status, 'queued');
  assert.equal(job.kind, 'cq-brief');
  assert.equal(job.videoClient, 'critters-quest');
  assert.equal(job.attempt, 1);
  assert.equal(job.reviewOn, '2026-11-18');
  assert.equal(job.hook, PUBLIC);
  assert.match(job.jobId, JOB_ID_RE);
  assert.equal(ctx.adminDb._raw('showcase_state', `briefvideo_${CLIENT}`).count, 1);
  // second tick a minute later: job active -> nothing new, and a queued job past 60 s is re-poked
  const r2 = await runTick({ db: ctx.adminDb, now: NOW + 2 * 60 * 1000, env, fetchImpl });
  assert.equal(r2.started, null);
  assert.equal(r2.skipped, 'active-job');
  assert.equal(r2.repoked.jobId, job.jobId);
  assert.equal(calls.length, 2);
});

test('runTick: no env -> job still created, poke swallowed', async () => {
  await seed(draft('a', '2026-11-18'));
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: async () => { throw new Error('boom'); } });
  assert.ok(r.started);
});

test('runTick: attaches a done job, strips the brief, stamps attachedAt, then starts the next', async () => {
  await seed(draft('a', '2026-11-18'));
  await seed(draft('b', '2026-11-19'));
  const r1 = await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: noFetch });
  const id = r1.started.jobId;
  ctx.adminDb._patch('brief_video_jobs', id, { status: 'done', downloadUrl: 'https://v/a.mp4', posterUrl: 'https://v/a.jpg', outputPath: 'p/a.mp4', width: 1080, height: 1080, durationInFrames: 450 });
  const r2 = await runTick({ db: ctx.adminDb, now: NOW + 60_000, env: {}, fetchImpl: noFetch });
  assert.equal(r2.attached.attached, true);
  const post = ctx.adminDb._raw('social_posts', 'a');
  assert.ok(!/INTERNAL VIDEO BRIEF/i.test(post.content));
  assert.equal(post.mediaJobId, id);
  assert.equal(post.revision, 4);
  assert.ok(jobsRaw(id).attachedAt);
  assert.equal(r2.started.postId, 'b'); // nothing active any more
  // done + stamped job is not attached twice
  const r3 = await runTick({ db: ctx.adminDb, now: NOW + 120_000, env: {}, fetchImpl: noFetch });
  assert.equal(r3.attached, null);
});

test('runTick: attach skipped when the brief changed or media exists', async () => {
  await seed(draft('a', '2026-11-18'));
  const r1 = await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: noFetch });
  const id = r1.started.jobId;
  ctx.adminDb._patch('brief_video_jobs', id, { status: 'done', downloadUrl: 'u', posterUrl: 'p' });
  ctx.adminDb._patch('social_posts', 'a', { content: content(PUBLIC, 'a different brief') });
  const r2 = await runTick({ db: ctx.adminDb, now: NOW + 60_000, env: {}, fetchImpl: noFetch });
  assert.equal(r2.attached.reason, 'brief-changed');
  assert.equal(jobsRaw(id).attachSkipped, 'brief-changed');
  assert.equal(ctx.adminDb._raw('social_posts', 'a').mediaUrl, undefined);
});

test('runTick: fails a job older than 20 min, retries once, then stops at 2 attempts', async () => {
  await seed(draft('a', '2026-11-18'));
  const r1 = await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: noFetch });
  const later = NOW + 61 * 60 * 1000; // queued: times out on createdAt after 60 min
  const r2a = await runTick({ db: ctx.adminDb, now: later, env: {}, fetchImpl: noFetch });
  assert.equal(r2a.failed.jobId, r1.started.jobId);
  assert.equal(jobsRaw(r1.started.jobId).status, 'failed');
  assert.equal(r2a.started, null); // a tick that failed a job never starts one
  const r2 = await runTick({ db: ctx.adminDb, now: later + 60_000, env: {}, fetchImpl: noFetch });
  assert.equal(r2.started.attempt, 2);
  const much = later + 60_000 + 61 * 60 * 1000;
  const r3 = await runTick({ db: ctx.adminDb, now: much, env: {}, fetchImpl: noFetch });
  assert.equal(r3.failed.jobId, r2.started.jobId);
  assert.equal(r3.started, null);
  assert.equal(r3.skipped, 'failed-this-tick');
  const r4 = await runTick({ db: ctx.adminDb, now: much + 60_000, env: {}, fetchImpl: noFetch });
  assert.equal(r4.skipped, 'no-candidate');
});

test('runTick: daily cap of 10 per CT day', async () => {
  await seed(draft('a', '2026-11-18'));
  await seed(draft('b', '2026-11-25'));
  ctx.adminDb._patch('showcase_state', `briefvideo_${CLIENT}`, { day: '2026-11-18', count: 10 });
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: noFetch });
  assert.equal(r.skipped, 'daily-cap');
  assert.equal(ctx.adminDb._store.get('brief_video_jobs')?.size ?? 0, 0);
  // a new CT day resets the counter
  const r2 = await runTick({ db: ctx.adminDb, now: NOW + 24 * 3600 * 1000, env: {}, fetchImpl: noFetch });
  assert.ok(r2.started);
});

test('runTick: force re-render only for a draft whose media came from a bv_ job', async () => {
  await seed(draft('a', '2026-11-18', { mediaUrl: 'u', mediaJobId: 'sc_x', videoBrief: BRIEF, content: PUBLIC }));
  assert.equal((await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: noFetch, postId: 'a', force: true })).skipped, 'force-not-eligible');
  assert.equal((await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: noFetch, postId: 'a' })).skipped, 'postId-needs-force');
  ctx.adminDb._patch('social_posts', 'a', { mediaJobId: 'bv_old123' });
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: noFetch, postId: 'a', force: true });
  assert.ok(r.started);
  assert.equal(jobsRaw(r.started.jobId).replace, true);
  ctx.adminDb._patch('brief_video_jobs', r.started.jobId, { status: 'done', downloadUrl: 'new', posterUrl: 'newp' });
  const r2 = await runTick({ db: ctx.adminDb, now: NOW + 60_000, env: {}, fetchImpl: noFetch });
  assert.equal(r2.attached.attached, true);
  assert.equal(ctx.adminDb._raw('social_posts', 'a').mediaUrl, 'new');
});

test('allowlist constant', () => {
  assert.deepEqual({ ...DAILY_BRIEF_VIDEO_CLIENTS }, { 'paradice-dbBQCHUX': 'critters-quest' });
});

test('HOLD briefs are never candidates and dryRun flags them', async () => {
  const hold = draft('hold', '2026-11-18', { content: content(PUBLIC, 'HOLD until launch and login are verified. 20s: capture it') });
  await seed(hold);
  await seed(draft('ok', '2026-11-19'));
  assert.deepEqual(selectCandidates([hold, draft('ok', '2026-11-19')], { today: '2026-11-18' }).map((c) => c.post.id), ['ok']);
  const out = await dryRun({ db: ctx.adminDb, now: NOW });
  const b = out.clients[CLIENT].briefs;
  assert.equal(b.find((x) => x.postId === 'hold').skipReason, 'hold');
  assert.equal(b.find((x) => x.postId === 'ok').skipReason, undefined);
  assert.deepEqual(out.clients[CLIENT].candidates, ['ok']);
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: noFetch });
  assert.equal(r.started.postId, 'ok');
});

test('rendering jobs time out on startedAt (20 min), not createdAt; queued jobs wait up to 60 min', async () => {
  await seed(draft('a', '2026-11-18'));
  const r1 = await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: noFetch });
  const id = r1.started.jobId;
  // queued 30 min behind a busy service: still active, re-poked, not failed
  const q = await runTick({ db: ctx.adminDb, now: NOW + 30 * 60 * 1000, env: {}, fetchImpl: noFetch });
  assert.equal(q.failed, null);
  assert.equal(q.skipped, 'active-job');
  assert.equal(q.repoked.jobId, id);
  // claimed just now, so 25 min after createdAt but 5 min after startedAt: not timed out
  const start = NOW + 20 * 60 * 1000;
  ctx.adminDb._patch('brief_video_jobs', id, { status: 'rendering', startedAt: new Date(start).toISOString() });
  const ok = await runTick({ db: ctx.adminDb, now: NOW + 25 * 60 * 1000, env: {}, fetchImpl: noFetch });
  assert.equal(ok.failed, null);
  assert.equal(ok.skipped, 'active-job');
  const late = await runTick({ db: ctx.adminDb, now: start + 21 * 60 * 1000, env: {}, fetchImpl: noFetch });
  assert.equal(late.failed.jobId, id);
});

test('planAttach refuses empty or over-280 public copy and other media', () => {
  const brief = 'Capture map; 15s.';
  const base = { id: 'p', clientId: CLIENT, status: 'draft', revision: 1 };
  const job = (b) => ({ jobId: 'bv_x12345', clientId: CLIENT, briefHash: briefHash(b), downloadUrl: 'u', posterUrl: 'p' });
  assert.equal(planAttach({ ...base, content: `\n\nINTERNAL VIDEO BRIEF: ${brief}` }, job(brief)).reason, 'empty-public-copy');
  assert.equal(planAttach({ ...base, content: `${'x'.repeat(281)}\n\nINTERNAL VIDEO BRIEF: ${brief}` }, job(brief)).reason, 'public-copy-too-long');
  assert.equal(planAttach({ ...base, content: `${'x'.repeat(280)}\n\nINTERNAL VIDEO BRIEF: ${brief}` }, job(brief)).ok, true);
  assert.equal(planAttach({ ...base, content: `ok\n\nINTERNAL VIDEO BRIEF: ${brief}`, mediaVariants: [{ a: 1 }] }, job(brief)).reason, 'has-media');
  assert.equal(planAttach({ ...base, content: `ok\n\nINTERNAL VIDEO BRIEF: ${brief}`, nasSha: 'abc' }, job(brief)).reason, 'has-media');
});

test('force respects the HOLD skip', async () => {
  await seed(draft('h', '2026-11-18', { mediaUrl: 'u', mediaJobId: 'bv_old123', content: PUBLIC, videoBrief: 'HOLD until verified; 20s' }));
  const r = await runTick({ db: ctx.adminDb, now: NOW, env: {}, fetchImpl: noFetch, postId: 'h', force: true });
  assert.equal(r.skipped, 'hold');
});
