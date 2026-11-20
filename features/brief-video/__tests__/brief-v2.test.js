import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeVideoBrief, panelBriefBlocksRender, panelBriefNeedsAuthoring, videoBriefView, isV2Brief } from '../brief-fields.js';
import { normalizeV2, v2Missing, renderV2Text, applyStoryboardSet, applyStoryboardReview, v2TotalSeconds } from '../brief-v2.js';
import { selectCandidates } from '../jobs.js';
import { classifyVideoProcessing } from '../videoStatus.js';
import { renderNow } from '../worker.js';
import { getAction, validateAction } from '../../x-strategy/agent/action-registry.js';

const CQ = 'paradice-dbBQCHUX';
const beat = (n) => ({ purpose: `purpose ${n}`, screen: `Valdara lava map, state ${n}`, camera: 'push in', cursor: 'click the castle', response: 'the window opens', caption: `CAPTION ${n}`, transition: 'continuous push', seconds: 5 });
const full = (over = {}) => ({
  format: 'feature', angle: 'Readiness, not the fight.', poster: { idea: 'Gravitax left', banner: 'WHICH FIGHT FIRST?', dateLine: 'TITANS LAND DEC 18', bubble: 'Is your squad ready?' },
  hero: 'The ready squad is picked.', theme: 'Check before you swing.', beats: [beat(1), beat(2), beat(3), beat(4)],
  payoff: 'The bar drops.', end: 'standard campaign end card', mustNot: 'pool values as subject', voiceMode: 'narrated',
  narrationLines: ['Pick the ready squad.'], needs: [], postCopy: 'Get a ready squad in.', ...over,
});
const NOW = '2026-11-19T10:00:00.000Z';
const m = (post, input, o = {}) => mergeVideoBrief(post, input, { now: NOW, by: 'o@x', ...o });
const rowOf = (r) => ({ clientId: CQ, status: 'draft', reviewOn: '2026-11-20', content: 'Copy.', ...r });

test('v2 save: sets briefVersion 2, renders creative text, keeps v1 fields working', () => {
  const r = m({}, { v2: full() });
  assert.equal(r.videoBriefMeta.briefVersion, 2);
  assert.equal(r.videoBriefMeta.status, 'draft');
  assert.equal(r.videoBriefMeta.v2.format, 'feature');
  assert.equal(r.videoBrief, r.videoBriefMeta.creative);
  assert.match(r.videoBriefMeta.creative, /^CREATIVE BRIEF v2\nFORMAT: feature/);
  assert.equal(r.videoBriefMeta.creative.split('\n').filter((l) => /^\d+\. purpose/.test(l)).length, 4, 'one line per beat');
  assert.match(r.videoBriefMeta.creative, /BEATS \(20 s\):/);
  const view = videoBriefView(rowOf({ id: 'p', videoBrief: r.videoBrief, videoBriefMeta: r.videoBriefMeta }));
  assert.equal(view.briefVersion, 2); assert.equal(view.v2.hero, 'The ready squad is picked.'); assert.equal(view.template, r.videoBriefMeta.creative);
  assert.equal(videoBriefView(rowOf({ videoBrief: 'T' })).briefVersion, 1);
});

test('v2 with template: the template stays the creative; rendering is deterministic', () => {
  const r = m({}, { v2: full(), template: 'My own text' });
  assert.equal(r.videoBriefMeta.creative, 'My own text');
  assert.equal(renderV2Text(normalizeV2(full())), renderV2Text(normalizeV2(full())));
});

test('v2 validation: enums, caps, beats count, seconds, total, lists', () => {
  assert.throws(() => normalizeV2(full({ format: 'trailer' })), /format/);
  assert.throws(() => normalizeV2(full({ voiceMode: 'loud' })), /voiceMode/);
  assert.throws(() => normalizeV2(full({ angle: 'x'.repeat(401) })), /angle/);
  assert.throws(() => normalizeV2(full({ beats: [] })), /beats/);
  assert.throws(() => normalizeV2(full({ beats: Array.from({ length: 7 }, (_, i) => beat(i)) })), /1 to 6/);
  assert.throws(() => normalizeV2(full({ beats: [{ ...beat(1), screen: 'x'.repeat(161) }] })), /beats\[1\]\.screen/);
  assert.throws(() => normalizeV2(full({ beats: [{ ...beat(1), seconds: 0 }] })), /seconds/);
  assert.throws(() => normalizeV2(full({ beats: [{ ...beat(1), seconds: 16 }] })), /seconds/);
  assert.throws(() => normalizeV2(full({ beats: [{ ...beat(1), seconds: 12 }, { ...beat(2), seconds: 12 }, { ...beat(3), seconds: 12 }] })), /36 s/);
  assert.throws(() => normalizeV2(full({ narrationLines: Array(9).fill('x') })), /narrationLines/);
  assert.throws(() => normalizeV2(full({ postCopy: 'x'.repeat(281) })), /postCopy/);
  assert.throws(() => normalizeV2('no'), /object/);
  assert.equal(normalizeV2(full({ beats: [{ ...beat(1), seconds: '2.5' }] })).beats[0].seconds, 2.5);
  assert.equal(v2TotalSeconds(normalizeV2(full())), 20);
});

test('ready gating: a draft may be incomplete, ready / approved are refused with the missing list', () => {
  const sparse = { format: '', beats: [{ purpose: '', screen: '', camera: '', cursor: '', response: '', caption: '', transition: '', seconds: 3 }], poster: {} };
  const d = m({}, { v2: sparse, status: 'draft' });
  assert.equal(d.videoBriefMeta.status, 'draft');
  assert.throws(() => m({}, { v2: sparse, status: 'ready' }), (e) => e.status === 400 && /Missing: .*format.*angle.*poster\.banner.*hero.*theme.*beats \(at least 3.*payoff.*end.*voiceMode/.test(e.message) && Array.isArray(e.missing));
  assert.throws(() => m({}, { v2: sparse, status: 'approved' }), /Missing/);
  assert.ok(v2Missing(normalizeV2(full({ beats: [beat(1), { ...beat(2), screen: '' }, { ...beat(3), cursor: '', response: '' }, { ...beat(4), caption: '' }] }))).join().includes('beats[2].screen'));
  assert.deepEqual(v2Missing(normalizeV2(full())), []);
  assert.ok(v2Missing(normalizeV2(full({ voiceMode: 'narrated', narrationLines: [] }))).some((x) => /narrationLines/.test(x)));
  assert.ok(v2Missing(normalizeV2(full({ format: 'guide' }))).includes('lesson'));
  assert.equal(m({}, { v2: full(), status: 'ready' }).videoBriefMeta.status, 'ready');
});

test('editing a ready v2 brief into an incomplete one drops it to draft; a complete edit sends approved back to ready', () => {
  const ready = m({}, { v2: full(), status: 'ready' });
  const post = rowOf({ videoBrief: ready.videoBrief, videoBriefMeta: ready.videoBriefMeta });
  assert.equal(m(post, { v2: full({ hero: '' }) }).videoBriefMeta.status, 'draft');
  const appr = m(post, { status: 'approved' });
  const post2 = rowOf({ videoBrief: appr.videoBrief, videoBriefMeta: appr.videoBriefMeta });
  assert.equal(m(post2, { v2: full({ theme: 'New theme.' }) }).videoBriefMeta.status, 'ready');
});

test('approve on v2 creates a pending storyboard; a v2 change sends the storyboard back to pending', () => {
  const ready = m({}, { v2: full(), status: 'ready' });
  const approved = m(rowOf({ videoBrief: ready.videoBrief, videoBriefMeta: ready.videoBriefMeta }), { status: 'approved' });
  assert.equal(approved.videoBriefMeta.status, 'approved');
  assert.equal(approved.videoBriefMeta.storyboard.status, 'pending');
  const withSb = { ...approved.videoBriefMeta, storyboard: { status: 'approved', frames: [], updatedAt: NOW, updatedBy: 'x' } };
  const changed = m(rowOf({ videoBrief: approved.videoBrief, videoBriefMeta: withSb }), { v2: full({ hero: 'A different hero moment.' }) });
  assert.equal(changed.videoBriefMeta.storyboard.status, 'pending');
  assert.equal(changed.videoBriefMeta.status, 'ready');
  const same = m(rowOf({ videoBrief: approved.videoBrief, videoBriefMeta: withSb }), { captions: 'c' });
  assert.equal(same.videoBriefMeta.storyboard.status, 'approved', 'unrelated saves leave the storyboard alone');
});

test('v1 briefs are untouched by the v2 code', () => {
  const a = m({}, { template: 'T', shots: 's' });
  assert.equal(a.videoBriefMeta.briefVersion, undefined);
  assert.equal(a.videoBriefMeta.v2, undefined);
  assert.equal(a.videoBriefMeta.storyboard, undefined);
  assert.equal(isV2Brief(rowOf({ videoBrief: 'T', videoBriefMeta: a.videoBriefMeta })), false);
  assert.equal(m({}, { template: 'T', status: 'approved' }).videoBriefMeta.storyboard, undefined);
});

const approvedMeta = () => {
  const ready = m({}, { v2: full(), status: 'ready' });
  return m(rowOf({ videoBrief: ready.videoBrief, videoBriefMeta: ready.videoBriefMeta }), { status: 'approved' }).videoBriefMeta;
};

test('storyboard set: validation, status ready, needs an approved v2 brief', () => {
  const meta = approvedMeta();
  const out = applyStoryboardSet(meta, { outline: 'Beat 1 ...', frames: [{ label: 'Poster', url: 'https://x.test/a.png', note: 'n' }, { label: 'Squads', url: 'https://x.test/b.png' }], notes: 'nb' }, { by: 'dir', now: NOW });
  assert.equal(out.storyboard.status, 'ready');
  assert.equal(out.storyboard.frames.length, 2);
  assert.equal(out.storyboard.updatedBy, 'dir');
  assert.equal(out.status, 'approved');
  assert.throws(() => applyStoryboardSet(meta, { frames: [{ label: 'a', url: 'http://x.test/a.png' }] }), /https/);
  assert.throws(() => applyStoryboardSet(meta, { frames: [{ label: 'a', url: 'javascript:alert(1)' }] }), /https/);
  assert.throws(() => applyStoryboardSet(meta, { frames: Array.from({ length: 9 }, () => ({ label: 'a', url: 'https://x.test/a.png' })) }), /at most 8/);
  assert.throws(() => applyStoryboardSet(meta, { outline: 'x'.repeat(6001) }), /6000/);
  assert.throws(() => applyStoryboardSet(meta, {}), /outline or at least one frame/);
  assert.throws(() => applyStoryboardSet({ ...meta, status: 'ready' }, { outline: 'o' }), (e) => e.status === 409);
  assert.throws(() => applyStoryboardSet({ creative: 'v1', status: 'approved' }, { outline: 'o' }), (e) => e.status === 409 && e.code === 'not-v2');
});

test('storyboard review: approve / changes, frame notes, only when ready', () => {
  const meta = applyStoryboardSet(approvedMeta(), { outline: 'o', frames: [{ label: 'A', url: 'https://x.test/a.png' }, { label: 'B', url: 'https://x.test/b.png' }] }, { now: NOW });
  const ok = applyStoryboardReview(meta, { decision: 'approve' }, { by: 'owner', now: NOW });
  assert.equal(ok.storyboard.status, 'approved');
  const ch = applyStoryboardReview(meta, { decision: 'changes', notes: 'Slower', frameNotes: { 1: 'Bigger cards' } }, { by: 'owner', now: NOW });
  assert.equal(ch.storyboard.status, 'changes');
  assert.equal(ch.storyboard.frames[1].note, 'Bigger cards');
  assert.equal(ch.storyboard.notes, 'Slower');
  assert.throws(() => applyStoryboardReview(meta, { decision: 'changes' }), /what should change/);
  assert.throws(() => applyStoryboardReview(meta, { decision: 'maybe' }), /decision/);
  assert.throws(() => applyStoryboardReview(meta, { decision: 'changes', frameNotes: { 5: 'x' } }), /no frame 5/);
  assert.throws(() => applyStoryboardReview(ok, { decision: 'approve' }), (e) => e.status === 409);
  assert.throws(() => applyStoryboardReview(approvedMeta(), { decision: 'approve' }), (e) => e.status === 409, 'pending storyboard cannot be reviewed');
});

test('worker and cron skip v2 briefs (even approved); directorRequestId hook is documented only', () => {
  const meta = approvedMeta();
  const post = rowOf({ id: 'v2p', videoBrief: 'x', videoBriefMeta: meta });
  assert.equal(meta.status, 'approved');
  assert.equal(panelBriefBlocksRender(post), true);
  assert.equal(panelBriefNeedsAuthoring(post), false, 'v2 never goes to the clip author');
  assert.deepEqual(selectCandidates([post], { today: '2026-11-19', clients: { [CQ]: {} } }), []);
  assert.equal(classifyVideoProcessing(post, [], { today: '2026-11-19' }).state, 'brief-not-approved');
  assert.equal(panelBriefBlocksRender({ ...post, videoBriefMeta: { ...meta, directorRequestId: 'r1' } }), true, 'hook not implemented yet');
  const v1 = rowOf({ id: 'v1p', videoBrief: 'Shot 1', videoBriefMeta: { status: 'approved' } });
  assert.equal(panelBriefBlocksRender(v1), false, 'v1 approved briefs still render');
});

test('renderNow refuses a v2 brief with no job', async () => {
  const meta = approvedMeta();
  const post = rowOf({ videoBrief: 'x', videoBriefMeta: meta });
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => post }) }) }) };
  const r = await renderNow({ db, clientId: CQ, postId: 'p1', env: { DAILY_BRIEF_VIDEO_ENABLED: 'true' } });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'brief-not-approved');
});

test('route: v2 approve and render return before the clip author / render start; storyboard actions exist', () => {
  const src = fs.readFileSync(new URL('../../../app/api/social-posting/route.js', import.meta.url), 'utf8');
  const approveV2 = src.indexOf("approve && isV2Brief(post)");
  assert.ok(approveV2 > 0 && approveV2 < src.indexOf('await authorCreativeBrief(context.clientId, body.postId, decoded, post)'));
  const renderV2 = src.indexOf('isV2Brief(row)', src.indexOf("action === 'video-brief-render'"));
  assert.ok(renderV2 > 0 && renderV2 < src.indexOf('await authorCreativeBrief(context.clientId, body.postId, decoded, row)'));
  assert.ok(renderV2 < src.indexOf('renderNow'), 'v2 returns before any render');
  assert.match(src, /'video-brief-storyboard-set'/);
  assert.match(src, /'video-brief-storyboard-review'/);
  assert.match(src, /'v2'\]\.filter/);
});

test('MCP: queue.post.video-brief.save carries the v2 schema', () => {
  const a = getAction('queue.post.video-brief.save');
  assert.deepEqual(validateAction(a), []);
  const v2 = a.args.properties.v2;
  assert.equal(v2.type, 'object');
  assert.deepEqual(v2.properties.format.enum, ['feature', 'guide', 'promo']);
  assert.deepEqual(v2.properties.treatment.enum, ['faceOff', 'mapConverge', 'hostPoster', 'heroRise', 'statCard']);
  assert.equal(v2.properties.bubbles.maxItems, 3);
  assert.deepEqual(v2.properties.voiceMode.enum, ['narrated', 'caption-only', 'music']);
  const b = v2.properties.beats;
  assert.equal(b.type, 'array'); assert.equal(b.maxItems, 6);
  assert.deepEqual(Object.keys(b.items.properties), ['purpose', 'screen', 'camera', 'cursor', 'response', 'caption', 'transition', 'seconds']);
  assert.equal(b.items.properties.seconds.maximum, 15);
  assert.equal(v2.properties.narrationLines.maxItems, 8);
  assert.match(a.args.properties.template.description, /v1 \/ optional for v2/);
  assert.match(getAction('queue.post.video-brief.get').description, /v2/);
  assert.match(getAction('queue.post.video-brief.get').description, /storyboard/);
  assert.ok(!a.args.required.includes('template'));
  // every v2 schema key is one normalizeV2 reads back
  const n = normalizeV2(full({ lesson: 'L', host: 'mayor', focus: 'f', treatment: 'faceOff', cast: ['A'], bubbles: ['b'] }));
  for (const k of Object.keys(v2.properties)) assert.ok(k in n, `normalizeV2 drops ${k}`);
});

test('template doc: the worked example validates, is ready, and the field table names every v2 key', () => {
  const doc = fs.readFileSync(new URL('../../../docs/source-of-truth/CQ-CREATIVE-BRIEF-TEMPLATE.md', import.meta.url), 'utf8');
  const m = /```json v2-example\n([\s\S]*?)\n```/.exec(doc);
  assert.ok(m, 'doc has the v2-example block');
  const v2 = normalizeV2(JSON.parse(m[1]));
  assert.deepEqual(v2Missing(v2), []);
  assert.ok(v2TotalSeconds(v2) <= 30);
  const props = getAction('queue.post.video-brief.save').args.properties.v2.properties;
  for (const k of Object.keys(props)) assert.ok(doc.includes(`\`${k}`), `doc misses v2 field ${k}`);
  for (const k of Object.keys(props.beats.items.properties)) assert.ok(doc.includes(`\`${k}\``), `doc misses beat key ${k}`);
});

test('promo format: treatment, cast, bubbles, 1-3 beats, 15-23 s, own ready rule', () => {
  const promo = (o = {}) => ({ format: 'promo', treatment: 'faceOff', cast: ['Gravitax', 'Axiom'], bubbles: ['Ready?', 'Always.'], poster: { idea: 'clash', banner: 'WHO WINS' }, theme: 't', beats: [{ ...beat(1), cursor: 'none', seconds: 9 }, { ...beat(2), cursor: 'none', seconds: 8 }], end: 'none', voiceMode: 'music', ...o });
  const n = normalizeV2(promo());
  assert.deepEqual(v2Missing(n), []);
  assert.equal(n.treatment, 'faceOff'); assert.deepEqual(n.bubbles, ['Ready?', 'Always.']);
  assert.match(renderV2Text(n), /TREATMENT: faceOff\nCAST: Gravitax, Axiom\nBUBBLES: Ready\? \| Always\./);
  assert.throws(() => normalizeV2(promo({ treatment: 'spin' })), /treatment/);
  assert.throws(() => normalizeV2(promo({ bubbles: ['a', 'b', 'c', 'd'] })), /bubbles/);
  assert.throws(() => normalizeV2(promo({ beats: [beat(1), beat(2), beat(3), beat(4)].map((b) => ({ ...b, seconds: 2 })) })), /1 to 3/);
  assert.throws(() => normalizeV2(promo({ beats: [{ ...beat(1), seconds: 12 }, { ...beat(2), seconds: 12 }] })), /23 s/);
  const short = v2Missing(normalizeV2(promo({ beats: [{ ...beat(1), seconds: 5 }] }))).join();
  assert.match(short, /15-23/);
  const bare = v2Missing(normalizeV2({ format: 'promo', poster: {}, beats: [{ ...beat(1), seconds: 15 }] })).join();
  assert.match(bare, /treatment.*cast.*poster\.banner.*bubbles or hero.*theme.*end.*voiceMode/);
  assert.doesNotMatch(bare, /angle|payoff/);
  assert.throws(() => m({}, { v2: { format: 'promo', poster: {}, beats: [beat(1)] }, status: 'ready' }), /Missing: .*treatment/);
  assert.equal(m({}, { v2: promo(), status: 'ready' }).videoBriefMeta.status, 'ready');
});

test('template doc: the promo example validates and is ready', () => {
  const doc = fs.readFileSync(new URL('../../../docs/source-of-truth/CQ-CREATIVE-BRIEF-TEMPLATE.md', import.meta.url), 'utf8');
  const x = /```json v2-promo-example\n([\s\S]*?)\n```/.exec(doc);
  assert.ok(x);
  assert.deepEqual(v2Missing(normalizeV2(JSON.parse(x[1]))), []);
  for (const t of ['faceOff', 'mapConverge', 'hostPoster', 'heroRise', 'statCard']) assert.ok(doc.includes(`\`${t}\``));
});

import { buildBriefContext, buildRecentEpisodes, loadLibrary, readTemplateDoc, RECENT_POSTS_READ } from '../brief-context.js';

test('cq-library.json parses and has formats / scenes / lessons / rules (and the three formats)', () => {
  const lib = loadLibrary();
  for (const k of ['formats', 'scenes', 'lessons', 'rules', 'campaign', 'hosts', 'promoTreatments']) assert.ok(lib[k], `library misses ${k}`);
  assert.deepEqual(Object.keys(lib.formats).sort(), ['feature', 'guide', 'promo']);
  assert.equal(JSON.parse(fs.readFileSync(new URL('../howto-catalog/cq-library.json', import.meta.url), 'utf8')).schema, lib.schema);
});

test('brief context: catalog entry is a tier-0 read with a call-first description', () => {
  const a = getAction('queue.post.video-brief.context');
  assert.deepEqual(validateAction(a), []);
  assert.equal(a.tier, 0); assert.equal(a.action, 'video-brief-context'); assert.deepEqual(a.args.required, []);
  assert.match(a.description, /Call before writing or rewriting any Critters Quest Creative Brief/);
  const ins = fs.readFileSync(new URL('../../mcp/instructions.js', import.meta.url), 'utf8');
  assert.match(ins, /call queue\.post\.video-brief\.context \(with the postId\) FIRST/);
  assert.match(ins, /Never approve/);
  assert.match(fs.readFileSync(new URL('../../../next.config.mjs', import.meta.url), 'utf8'), /CQ-CREATIVE-BRIEF-TEMPLATE\.md/);
});

test('brief context: template doc is readable, recent episodes bounded newest-first, no postId works, unknown postId 404s', async () => {
  assert.match(readTemplateDoc(), /^# CQ Creative Brief template \(v2\)/);
  const ready = m({}, { v2: full(), status: 'ready' }).videoBriefMeta;
  const mk = (i, over = {}) => ({ id: `p${i}`, clientId: CQ, reviewOn: `2026-11-${String(10 + i).padStart(2, '0')}`, videoBrief: 'x', videoBriefMeta: ready, ...over });
  const posts = [...Array.from({ length: 14 }, (_, i) => mk(i)), { id: 'plain', reviewOn: '2026-12-01', content: 'no brief' }];
  const calls = [];
  const io = { readPost: async (c, id) => (id === 'p3' ? { ...mk(3), content: 'Post copy' } : null), readPosts: async (c, n) => { calls.push(['posts', c, n]); return posts; }, readJobs: async (c, n) => { calls.push(['jobs', c, n]); return []; } };
  const none = await buildBriefContext({ clientId: CQ, ...io });
  assert.equal(none.ok, true); assert.equal(none.post, undefined);
  assert.equal(none.recentEpisodes.length, 10);
  assert.equal(none.recentEpisodes[0].date, '2026-11-23', 'newest first');
  assert.ok(none.recentEpisodes.every((e) => e.briefVersion === 2 && e.hero && e.angle && e.scenes.length));
  assert.ok(!none.recentEpisodes.some((e) => e.postId === 'plain'));
  assert.match(none.templateDoc, /Creative Brief v2|CQ Creative Brief template/);
  assert.ok(none.library.scenes && none.use);
  assert.deepEqual(calls, [['posts', CQ, RECENT_POSTS_READ], ['jobs', CQ, 40]], 'bounded reads');
  const withPost = await buildBriefContext({ clientId: CQ, postId: 'p3', ...io });
  assert.equal(withPost.post.id, 'p3'); assert.equal(withPost.post.content, 'Post copy'); assert.equal(withPost.post.brief.briefVersion, 2);
  assert.ok(!withPost.recentEpisodes.some((e) => e.postId === 'p3'), 'the post itself is not a recent episode');
  await assert.rejects(() => buildBriefContext({ clientId: CQ, postId: 'nope', ...io }), (e) => e.status === 404);
  assert.deepEqual(buildRecentEpisodes({ posts: [], jobs: [] }), []);
  const v1 = buildRecentEpisodes({ posts: [{ id: 'a', reviewOn: '2026-11-01', videoBriefMeta: { status: 'rendered', captions: 'ONE | TWO' } }] });
  assert.deepEqual(v1[0].captions, ['ONE', 'TWO']); assert.equal(v1[0].briefVersion, 1);
});

test('route wires video-brief-context', () => {
  const src = fs.readFileSync(new URL('../../../app/api/social-posting/route.js', import.meta.url), 'utf8');
  assert.match(src, /action === 'video-brief-context'/);
  assert.match(src, /readRecentBriefJobs/);
});
