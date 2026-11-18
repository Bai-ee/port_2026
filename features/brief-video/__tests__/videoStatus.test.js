import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const { classifyVideoProcessing, readVideoProcessing, withVideoProcessing, hasVideoBrief } = await import('../videoStatus.js');
const { parseBrief, briefHash } = await import('../brief.js');

const CLIENT = 'paradice-dbBQCHUX';
const TODAY = '2026-11-18';
const NOW = Date.parse('2026-11-18T18:00:00Z');
const draft = (o = {}) => ({ id: 'p1', clientId: CLIENT, status: 'draft', reviewOn: '2026-11-20', content: 'Copy here.\n\nINTERNAL VIDEO BRIEF: show the gather screen', ...o });
const hashOf = (post) => parseBrief(post.content).briefHash;
const job = (post, o = {}) => ({ jobId: 'bv_aaa111', postId: post.id, clientId: post.clientId, briefHash: hashOf(post), status: 'queued', attempt: 1, createdAt: '2026-11-18T10:00:00Z', ...o });
const cls = (post, jobs = [], o = {}) => classifyVideoProcessing(post, jobs, { today: TODAY, ...o });

test('no brief -> null', () => {
  assert.equal(cls({ id: 'x', clientId: CLIENT, status: 'draft', content: 'plain' }), null);
  assert.equal(hasVideoBrief({ content: 'plain' }), false);
});

test('attached, with source detail', () => {
  const p = { ...draft(), content: 'Copy', videoBrief: 'b', mediaJobId: 'bv_abc', mediaUrl: 'https://m/x.mp4', mediaMetadata: { source: 'cq-howto' } };
  assert.deepEqual(cls(p), { state: 'attached', label: 'Video attached', detail: 'how-to', jobId: 'bv_abc' });
  assert.equal(cls({ ...p, mediaMetadata: { source: 'cq-briefcut' } }).detail, 'brief cut');
});

test('job states: queued, rendering, rendered, skipped, attached-by-job', () => {
  const p = draft();
  assert.equal(cls(p, [job(p)]).label, 'Queued');
  assert.equal(cls(p, [job(p, { status: 'rendering' })]).state, 'rendering');
  assert.equal(cls(p, [job(p, { status: 'done' })]).label, 'Rendered, attaching on next tick');
  assert.equal(cls(p, [job(p, { status: 'done', attachSkipped: 'has-media' })]).label, 'Not attached: has-media');
  assert.equal(cls(p, [job(p, { status: 'done', attachedAt: 'x' })]).state, 'attached');
});

test('failed shows stage, message and attempt; newest job wins; stale-brief jobs ignored', () => {
  const p = draft();
  const failed = job(p, { status: 'failed', attempt: 1, error: { stage: 'render', message: 'chrome crashed' } });
  const r = cls(p, [failed]);
  assert.equal(r.state, 'failed');
  assert.equal(r.label, 'Render failed: render chrome crashed');
  assert.equal(r.detail, 'attempt 1/2');
  assert.equal(cls(p, [failed, job(p, { attempt: 2, jobId: 'bv_bbb222' })]).state, 'queued');
  assert.equal(cls(p, [{ ...failed, briefHash: 'other' }]).state, 'pending');
});

test('videoBriefStatus when there is no job', () => {
  assert.equal(cls(draft({ videoBriefStatus: 'waiting_howto', videoBriefReason: 'request-submitted' })).label, 'Waiting: request-submitted');
  assert.equal(cls(draft({ videoBriefStatus: 'invalid_brief', videoBriefReason: 'after-campaign' })).label, 'Brief not valid: after-campaign');
});

test('no job: hold, later, howto off, invalid, pending', () => {
  assert.equal(cls(draft({ content: 'C\n\nINTERNAL VIDEO BRIEF: HOLD until legal' })).label, 'On hold (HOLD in brief)');
  assert.equal(cls(draft({ reviewOn: '2026-12-10' })).label, 'Renders when within 7 days of 2026-12-10');
  const howto = draft({ content: 'C\n\nINTERNAL VIDEO BRIEF: howto=gather-first' });
  assert.equal(cls(howto).label, 'How-to videos are off');
  assert.equal(cls(howto, [], { howto: true }).label, 'Waiting for the next render tick');
  assert.equal(cls(draft({ content: 'C\n\nINTERNAL VIDEO BRIEF: howtoo=x' })).label, 'Brief not valid: malformed-howto-line');
  assert.equal(cls(draft()).label, 'Waiting for the next render tick');
  assert.equal(cls(draft({ reviewOn: '2026-11-10' })).state, 'skipped');
  assert.equal(cls(draft({ status: 'posted' })), null);
});

const seedJobs = (ctx, jobs) => { for (const j of jobs) ctx.adminDb.collection('brief_video_jobs').doc(j.jobId).set(j); };

test('readVideoProcessing: allowlisted clients only, brief posts only, no cross-client jobs', async () => {
  const ctx = makeFakeContext();
  const mine = draft();
  const other = draft({ id: 'p2', clientId: 'someone-else' });
  const plain = draft({ id: 'p3', content: 'no brief' });
  await seedJobs(ctx, [job(mine, { jobId: 'bv_mine01', status: 'rendering' }), { ...job(other, { jobId: 'bv_oth001' }) }, { ...job(mine, { jobId: 'bv_leak01', clientId: 'someone-else', status: 'failed', attempt: 2 }) }]);
  const map = await readVideoProcessing(ctx.adminDb, [mine, other, plain], { now: NOW, env: {} });
  assert.deepEqual([...map.keys()], ['p1']);
  assert.equal(map.get('p1').state, 'rendering');
});

test('readVideoProcessing: one query per 30 posts, attached posts need none', async () => {
  let queries = 0;
  const db = { collection: () => ({ where() { return this; }, async get() { queries += 1; return { docs: [] }; } }) };
  const many = Array.from({ length: 65 }, (_, i) => draft({ id: `p${i}` }));
  const attached = { ...draft({ id: 'att' }), content: 'x', videoBrief: 'b', mediaJobId: 'bv_x', mediaUrl: 'u' };
  const map = await readVideoProcessing(db, [...many, attached], { now: NOW, env: {} });
  assert.equal(queries, 3);
  assert.equal(map.size, 66);
});

test('withVideoProcessing attaches without mutating, and never throws', async () => {
  const ctx = makeFakeContext();
  const p = draft();
  const posts = [p, { id: 'z', clientId: CLIENT, status: 'draft', content: 'plain' }];
  const res = await withVideoProcessing(ctx.adminDb, posts, { now: NOW, env: {} });
  assert.equal(res[0].videoProcessing.state, 'pending');
  assert.equal(res[1].videoProcessing, undefined);
  assert.equal(p.videoProcessing, undefined);
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a);
  let broken;
  try { broken = await withVideoProcessing({ collection() { throw new Error('boom'); } }, posts, { now: NOW }); } finally { console.warn = origWarn; }
  assert.equal(broken, posts);
  assert.equal(warns.length, 1);
  assert.equal(warns[0][0], '[video-status] lookup failed');
  assert.equal(warns[0][2], 'boom');
});

test('readVideoProcessing: job lookups only for drafts; non-drafts classified without a query', async () => {
  const run = async (posts) => {
    let queries = 0;
    const db = { collection: () => ({ where() { return this; }, async get() { queries += 1; return { docs: [] }; } }) };
    const map = await readVideoProcessing(db, posts, { now: NOW, env: {} });
    return { queries, map };
  };
  const drafts = [draft({ id: 'd1' }), draft({ id: 'd2' })];
  const history = Array.from({ length: 100 }, (_, i) => draft({ id: `h${i}`, status: 'posted' }));
  assert.equal((await run(drafts)).queries, 1);
  const r = await run([...drafts, ...history]);
  assert.equal(r.queries, 1);
  assert.equal(r.map.has('h0'), false);
  assert.equal((await run(history)).queries, 0);
});

test('briefHash helper agrees with parseBrief', () => {
  assert.equal(hashOf(draft()), briefHash('show the gather screen'));
});
