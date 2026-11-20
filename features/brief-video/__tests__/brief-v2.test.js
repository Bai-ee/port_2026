import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeVideoBrief, panelBriefBlocksRender, panelBriefNeedsAuthoring, videoBriefView, isV2Brief } from '../brief-fields.js';
import { normalizeV2, v2Missing, postCopyDrift, renderV2Text, applyStoryboardSet, applyStoryboardReview, v2TotalSeconds } from '../brief-v2.js';
import { selectCandidates } from '../jobs.js';
import { classifyVideoProcessing } from '../videoStatus.js';
import { renderNow } from '../worker.js';
import { getAction, validateAction } from '../../x-strategy/agent/action-registry.js';

const CQ = 'paradice-dbBQCHUX';
const beat = (n) => ({ purpose: `purpose ${n}`, screen: `Valdara lava map, state ${n}`, camera: 'push in', cursor: 'click the castle', response: 'the window opens', caption: `CAPTION ${n}`, transition: 'continuous push', seconds: 5 });
const full = (over = {}) => ({
  format: 'feature', angle: 'Readiness, not the fight.', poster: { idea: 'Gravitax left', hero: 'gravitax, lava map, idle, facing camera', banner: 'WHICH FIGHT FIRST?', dateLine: 'TITANS LAND DEC 18', bubble: 'Is your squad ready?' },
  hero: 'The ready squad is picked.', theme: 'Check before you swing.', beats: [beat(1), beat(2), beat(3), beat(4)],
  payoff: 'The bar drops.', end: 'standard campaign end card', mustNot: 'pool values as subject', voiceMode: 'narrated',
  narrationLines: ['Which fight first?', 'Check the squads.', 'Pick the ready one.', 'Then... swing.', 'Critters Quest. Play now!'], needs: [], postCopy: 'Get a ready squad in.', ...over,
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
  assert.deepEqual(v2.properties.format.enum, ['feature', 'guide', 'promo', 'chapter']);
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
  assert.deepEqual(Object.keys(lib.formats).sort(), ['chapterStory', 'feature', 'guide', 'promo']);
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

// ── READY gate hardening (2026-11-20): the brief writer cannot dodge the episode rules ─────────────────────────────────────
const gate = (v2, opts) => v2Missing(normalizeV2(v2), opts).join(' | ');
const promoOf = (o = {}) => ({ format: 'promo', treatment: 'heroRise', cast: ['Axiom'], bubbles: ['Ready?'], poster: { idea: 'Axiom rises', banner: 'TITANS RISE' }, hero: 'Axiom rises', theme: 't', beats: [{ ...beat(1), screen: 'Axiom background with the wordmark', cursor: 'none', response: 'Axiom rises from below', seconds: 9 }, { ...beat(2), screen: 'same background, date banner', cursor: 'none', seconds: 8 }], end: 'none', voiceMode: 'music', ...o });

test('gate 1: every beat needs camera, transition, cursor or response; poster.idea required (all formats)', () => {
  assert.deepEqual(v2Missing(normalizeV2(full())), []);
  assert.match(gate(full({ beats: [{ ...beat(1), camera: '' }, beat(2), beat(3), beat(4)] })), /beats\[1\]\.camera is empty/);
  assert.match(gate(full({ beats: [beat(1), { ...beat(2), transition: '' }, beat(3), beat(4)] })), /beats\[2\]\.transition is empty/);
  assert.match(gate(full({ beats: [beat(1), beat(2), { ...beat(3), cursor: '', response: '' }, beat(4)] })), /beats\[3\] needs a cursor or a response/);
  assert.match(gate(full({ poster: { banner: 'X' } })), /poster\.idea/);
  assert.match(gate(promoOf({ poster: { banner: 'X' } })), /poster\.idea/);
  assert.match(gate(promoOf({ beats: [{ ...promoOf().beats[0], camera: '', transition: '' }, promoOf().beats[1]] })), /beats\[1\]\.camera is empty.*beats\[1\]\.transition is empty/);
  assert.deepEqual(v2Missing(normalizeV2(promoOf())), []);
  // a draft may stay incomplete
  assert.equal(m({}, { v2: full({ poster: { banner: 'X' } }), status: 'draft' }).videoBriefMeta.status, 'draft');
  assert.throws(() => m({}, { v2: full({ poster: { banner: 'X' } }), status: 'ready' }), /poster\.idea/);
});

test('gate 2: feature/guide need 20-30 s, 2+ real cursor actions, no hold-only beat', () => {
  const b = (n, o = {}) => ({ ...beat(n), seconds: 6, ...o });
  assert.deepEqual(v2Missing(normalizeV2(full({ beats: [b(1), b(2), b(3), b(4)] }))), []); // 24 s
  assert.match(gate(full({ beats: [b(1), b(2), b(3)].map((x) => ({ ...x, seconds: 5 })) })), /20-30 s in total, 15 s given/);
  assert.match(gate(full({ beats: [b(1, { cursor: 'none' }), b(2, { cursor: 'no cursor' }), b(3, { cursor: 'none' }), b(4)] })), /at least 2 beats with a real cursor action.*1 given/);
  assert.match(gate(full({ beats: [b(1, { cursor: '' }), b(2, { cursor: 'none' }), b(3, { cursor: '' }), b(4)] })), /at least 2 beats with a real cursor action/);
  // hold / glide only (no cursor, no action verb)
  assert.match(gate(full({ beats: [b(1), b(2), b(3), b(4, { cursor: '', response: 'camera glides over the map' })] })), /beats\[4\] is only a hold or glide/);
  assert.match(gate(full({ format: 'guide', lesson: 'The Town Hall', beats: [b(1), b(2), b(3), b(4, { cursor: 'none', response: 'the map holds' })] })), /beats\[4\] is only a hold or glide/);
  // a glide WITH an action verb passes, and a hold with a real cursor passes
  assert.doesNotMatch(gate(full({ beats: [b(1), b(2), b(3), b(4, { cursor: '', response: 'camera glides as the bar drops' })] })), /hold or glide/);
  assert.doesNotMatch(gate(full({ beats: [b(1), b(2), b(3), b(4, { response: 'holds on the window' })] })), /hold or glide/);
  // promo is exempt from rule 2
  assert.deepEqual(v2Missing(normalizeV2(promoOf({ beats: [{ ...promoOf().beats[0], response: 'the poster glides' }, promoOf().beats[1]] }))), []);
});

test('gate 3: promo treatment, cast characters, faceOff 2, mapConverge World Bank, no episode scene ids', () => {
  assert.match(gate(promoOf({ cast: ['Vault'] })), /cast for heroRise must be game characters.*"Vault" is not a character/);
  assert.match(gate(promoOf({ treatment: 'hostPoster', cast: ['Town Hall'] })), /cast for hostPoster must be game characters/);
  assert.deepEqual(v2Missing(normalizeV2(promoOf({ treatment: 'hostPoster', cast: ['Mayor'] }))), []);
  assert.deepEqual(v2Missing(normalizeV2(promoOf({ cast: ['Necrothis'] }))), []);
  assert.deepEqual(v2Missing(normalizeV2(promoOf({ treatment: 'faceOff', cast: ['Gravitax', 'Axiom'] }))), []);
  assert.match(gate(promoOf({ treatment: 'faceOff', cast: ['Gravitax'] })), /faceOff needs exactly 2/);
  assert.match(gate(promoOf({ treatment: 'faceOff', cast: ['Gravitax', 'Axiom', 'Mayor'] })), /faceOff needs exactly 2/);
  assert.deepEqual(v2Missing(normalizeV2(promoOf({ treatment: 'mapConverge', cast: ['World Bank'] }))), []);
  assert.match(gate(promoOf({ treatment: 'mapConverge', cast: ['Vault'] })), /mapConverge target must be "World Bank"/);
  assert.match(gate(promoOf({ beats: [{ ...promoOf().beats[0], screen: 'titans.mayor-dock the Mayor on his dock' }, promoOf().beats[1]] })), /feature\/guide scene "titans\.mayor-dock"/);
  assert.match(gate(promoOf({ beats: [{ ...promoOf().beats[0], screen: 'titans.wake-on-map' }, promoOf().beats[1]] })), /titans\.wake-on-map/);
  assert.deepEqual(v2Missing(normalizeV2(promoOf({ treatment: 'statCard', cast: ['Vault'] }))), [], 'statCard has no character rule');
});

test('gate 4: a beat screen naming a needs-build scene blocks ready', () => {
  const lib = JSON.parse(fs.readFileSync(new URL('../howto-catalog/cq-library.json', import.meta.url), 'utf8'));
  assert.ok(lib.scenes.some((x) => x.id === 'shards.cracks' && x.status === 'needs-build'));
  const withScreen = (screen) => full({ beats: [beat(1), { ...beat(2), screen }, beat(3), beat(4)] });
  assert.match(gate(withScreen('shards.cracks: the Vault dome cracks')), /beats\[2\]\.screen names "shards\.cracks": this scene isn't built yet: keep the topic and put it in needs, or choose a ready scene/);
  assert.match(gate(withScreen('Vault Shards approved dome/crack scene, shards cracks open')), /isn't built yet/);
  assert.doesNotMatch(gate(withScreen('Valdara lava map, full HUD')), /isn't built yet/);
  assert.doesNotMatch(gate(withScreen('town.upgrade-panel: the UPGRADE TOWN panel')), /isn't built yet/);
});

test('gate 5: post copy that reads as how-to cannot be a promo; save never touches the post copy; postCopy drift warns', () => {
  const howto = 'Here is how to upgrade your town: before and after.';
  assert.match(gate(promoOf(), { postContent: howto }), /format "promo" does not fit this post.*guide or feature/);
  assert.match(gate(promoOf(), { postContent: 'What changed in the town upgrade panel' }), /does not fit this post/);
  assert.deepEqual(v2Missing(normalizeV2(promoOf()), { postContent: 'The Titans arrive December 18th.' }), []);
  assert.deepEqual(v2Missing(normalizeV2(full()), { postContent: howto }), []);
  assert.deepEqual(v2Missing(normalizeV2(full({ format: 'guide', lesson: 'The Town Hall' })), { postContent: howto }), []);
  // through the save merge: the row's own content feeds the check
  assert.throws(() => m(rowOf({ content: howto }), { v2: promoOf(), status: 'ready' }), /does not fit this post/);
  assert.equal(m(rowOf({ content: howto }), { v2: full(), status: 'ready' }).videoBriefMeta.status, 'ready');
  assert.equal(m(rowOf({ content: howto }), { v2: promoOf(), status: 'draft' }).videoBriefMeta.status, 'draft');
  // the merge result carries only the brief fields: the post's content is never written
  const out = m(rowOf({ content: howto }), { v2: full({ postCopy: 'Totally different words about the Vault.' }), status: 'ready' });
  assert.deepEqual(Object.keys(out).sort(), ['videoBrief', 'videoBriefMeta']);
  assert.ok(!('content' in out));
  // soft warning, not a block
  assert.match(postCopyDrift({ postCopy: 'Totally different words about the Vault.' }, howto), /postCopy differs from the post; the post's topic is fixed - don't change it/);
  assert.equal(postCopyDrift({ postCopy: 'Here is how to upgrade your town' }, howto), '');
  assert.equal(postCopyDrift({}, howto), '');
});

test('gate 6: the context `use` text, MCP save description and template doc state the rules', async () => {
  const { buildBriefContext } = await import('../brief-context.js');
  const ctx = await buildBriefContext({ clientId: CQ, readTemplateDoc: () => 'doc', readPosts: async () => [], readJobs: async () => [] });
  const { QUEUE_ACTIONS } = await import('../../x-strategy/agent/catalog/queue.js');
  const saveAction = QUEUE_ACTIONS.find((a) => a.id === 'queue.post.video-brief.save');
  const save = saveAction.args.properties.v2.description; // the full rules ride on the v2 argument (action descriptions are capped at 200 chars)
  assert.match(saveAction.description, /READY rules/);
  const doc = fs.readFileSync(new URL('../../../docs/source-of-truth/CQ-CREATIVE-BRIEF-TEMPLATE.md', import.meta.url), 'utf8');
  for (const text of [ctx.use, save]) {
    assert.match(text, /town upgrade panel \(town\.upgrade-panel\), the incoming-raid warning \(raids\.incoming-warning\) and the Town Defense screen \(raids\.defense-tab\) are REAL, owner-approved game UI rebuilt from the game code, not fake UI\./);
    assert.match(text, /Promo is for announcements\/hype only; how-to and "what changed" posts are guide or feature episodes\./);
    assert.match(text, /camera, transition/);
  }
  assert.match(doc, /are REAL, owner-approved game UI rebuilt from the game code, not fake UI\./);
  assert.match(doc, /Promo is for announcements\/hype only; how-to and "what changed" posts are guide or feature episodes\./);
  assert.match(doc, /## Ready rules/);
});

// ── First-time-right lock on every format; chapter is just an allowed format value (owner 2026-11-20) ──────────────────────
import { V2_FORMATS, v2Warnings } from '../brief-v2.js';
import { FIRST_TIME_RIGHT, loadBriefStandard } from '../brief-context.js';
import { formFromV2, toV2Body, formWarnings } from '../../../components/dashboard/x-content/video-brief-v2-model.js';
import { QUEUE_ACTIONS } from '../../x-strategy/agent/catalog/queue.js';
import { buildInstructions } from '../../mcp/instructions.js';

test('chapter is an accepted format (34 s cap) with no recipe-specific gate', () => {
  assert.ok(V2_FORMATS.includes('chapter'));
  const five = (sec) => [1, 2, 3, 4, 5].map((i) => ({ ...beat(i), seconds: sec }));
  assert.equal(normalizeV2(full({ format: 'chapter', beats: five(6.8) })).format, 'chapter');
  assert.throws(() => normalizeV2(full({ format: 'chapter', beats: five(7) })), /34 s at most/);
  assert.throws(() => normalizeV2(full({ beats: five(7) })), /30 s at most/, 'other formats keep 30 s');
  assert.deepEqual(v2Missing(normalizeV2(full({ format: 'chapter', narrationLines: ['a', 'b', 'c', 'd', 'e'] }))), []);
});

test('ready gate on all non-promo formats: poster.hero and narration count (beats + 1)', () => {
  for (const format of ['feature', 'chapter']) {
    assert.deepEqual(v2Missing(normalizeV2(full({ format }))), [], `${format} passes`);
    const noHero = v2Missing(normalizeV2(full({ format, poster: { idea: 'x', banner: 'y' } })));
    assert.ok(noHero.some((x) => x.startsWith('poster.hero')), noHero.join(' | '));
    const short = v2Missing(normalizeV2(full({ format, narrationLines: ['one', 'two', 'three', 'four'] })));
    assert.ok(short.some((x) => x.startsWith('narrationLines') && x.includes('5 needed')), short.join(' | '));
  }
  assert.deepEqual(v2Missing(normalizeV2(full({ voiceMode: 'caption-only', narrationLines: [] }))), [], 'count applies when narrated only');
  assert.ok(v2Missing(normalizeV2(full({ end: '' }))).includes('end'));
  assert.ok(v2Missing(normalizeV2(full({ beats: [beat(1), beat(2), { ...beat(3), screen: '' }, beat(4)] }))).includes('beats[3].screen'));
});

test('CTA and promo hero/narration are warnings, never errors', () => {
  assert.deepEqual(v2Warnings(normalizeV2(full())), []);
  const noCta = full({ narrationLines: ['One.', 'Two.', 'Three.', 'Four.', 'The end.'] });
  assert.equal(v2Warnings(normalizeV2(noCta)).length, 1);
  assert.deepEqual(v2Missing(normalizeV2(noCta)), []);
  const promo = { format: 'promo', treatment: 'heroRise', cast: ['Axiom'], poster: { idea: 'Axiom rises', banner: 'DEC 18' }, hero: 'rise', theme: 't', beats: [{ ...beat(1), screen: 'poster art', cursor: 'none', response: 'Axiom rises', seconds: 8 }, { ...beat(2), screen: 'poster art', cursor: 'none', response: 'the date slides in', seconds: 8 }], end: 'standard', voiceMode: 'narrated', narrationLines: ['Axiom rises.'] };
  const n = normalizeV2(promo);
  assert.deepEqual(v2Missing(n), []);
  assert.ok(v2Warnings(n).some((x) => x.startsWith('poster.hero is empty')));
});

test('poster.hero round-trips (normalize, merge, render, editor form)', () => {
  const n = normalizeV2(full());
  assert.equal(n.poster.hero, 'gravitax, lava map, idle, facing camera');
  assert.throws(() => normalizeV2(full({ poster: { idea: 'x', banner: 'y', hero: 'h'.repeat(81) } })), /poster.hero must be 80/);
  const r = m({}, { v2: full() });
  assert.equal(r.videoBriefMeta.v2.poster.hero, n.poster.hero);
  assert.match(r.videoBriefMeta.creative, /POSTER HERO: gravitax/);
  assert.equal(toV2Body(formFromV2(n)).poster.hero, n.poster.hero);
  assert.equal(normalizeV2(full({ poster: { idea: 'x', banner: 'y' } })).poster.hero, undefined, 'omitted when empty');
  assert.equal(formWarnings({ format: 'promo', posterHero: '', beats: [], voiceMode: '', narrationLines: '' }).length, 1);
});

test('library loads with the new keys; context tool + MCP instructions + save tool carry the standard', async () => {
  const lib = loadLibrary();
  assert.ok(lib.formats.chapterStory && lib.posterHeroes.length);
  const ids = (lib.scenes || []).map((x) => x.id);
  for (const id of ['monsters.fight', 'town.inside', 'chapter.banner']) assert.ok(ids.includes(id), id);
  const ctx = await buildBriefContext({ clientId: CQ, readTemplateDoc: () => 'T', readPosts: async () => [], readJobs: async () => [] });
  assert.ok(ctx.briefStandard.includes('GOLD EXAMPLE') && ctx.briefStandard.includes('Keeps moving') && ctx.briefStandard.includes('NARRATION'));
  assert.ok(!ctx.briefStandard.includes('STANDARD LOADED'));
  assert.equal(ctx.briefStandard, loadBriefStandard());
  assert.ok(ctx.library.formats.chapterStory && ctx.library.posterHeroes.length && ctx.library.scenes.length);
  assert.ok(ctx.use.includes(FIRST_TIME_RIGHT) && /PLAY NOW/.test(ctx.use));
  assert.ok(buildInstructions().includes(FIRST_TIME_RIGHT) && /briefStandard/.test(buildInstructions()));
  const save = QUEUE_ACTIONS.find((a) => a.id === 'queue.post.video-brief.save');
  assert.match(save.description, /video-brief\.context first; a brief is saved READY only when all six items are locked/);
  const props = save.args.properties.v2.properties;
  assert.ok(props.format.enum.includes('chapter') && props.poster.properties.hero);
});
