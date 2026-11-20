import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');
const { authorHowtoRequest, authorPostBrief, authorToolSchema, needsAuthoring, authorKey } = await import('../brief-author.js');
const { catalogCheck, catalogHash, loadHowtoCatalog } = await import('../howto-catalog/index.js');
const { mergeVideoBrief, creativeOf, videoBriefView, panelBriefBlocksRender, isPanelBriefPending } = await import('../brief-fields.js');
const { planAttach } = await import('../attach.js');
const { briefHash } = await import('../brief.js');

const CLIENT = 'paradice-dbBQCHUX';
const { catalog, campaign } = loadHowtoCatalog();
const CREATIVE = 'Creative ID: CQ-S3-1119\nTitle: Before the Titans\nHost: none\nNarration: off\nShots:\n1. SELECT A RESOURCE';
const NOW = Date.parse('2026-11-19T15:00:00Z');

const step = (panel, action, extra = {}) => ({ panel, clicks: [{ target: 't', action }], caption: 'X', seconds: 4, ...extra });
const goodInput = () => ({
  unsupported: [],
  request: {
    type: 'how-to', skeleton: 'cursor', host: { name: 'none' }, goal: 'g', audience: 'a', hook: 'Before the Titans.', banner: 'GATHER FIRST', label: 'CURRENT GAMEPLAY', narration: false,
    establish: { caption: 'GATHER FIRST', seconds: 3 },
    steps: [step('spotTile', 'selectSpot'), step('critterSelection', 'selectCritter'), step('critterSelection', 'send', { later: true }), step('spotClaimReward', 'claim', { seconds: 3 })],
    end: { caption: 'TOMORROW: SEASON 3 FIRST LOOK', cta: 'Return tomorrow for the Season 3 reveal.', seconds: 3, art: { src: 'art/posters/s3-first-look.jpg' } },
  },
});
const resp = (input, id = 'tu_1') => ({ model: 'claude-sonnet-4-6', content: [{ type: 'tool_use', id, name: 'author_request', input }] });
const mockLlm = (...inputs) => { const calls = []; const f = async (p) => { calls.push(p); return resp(inputs[Math.min(calls.length - 1, inputs.length - 1)]); }; f.calls = calls; return f; };
const post = (over = {}) => ({ id: 'social_abc12345', clientId: CLIENT, status: 'draft', reviewOn: '2026-11-19', revision: 3, content: 'Before the Titans: your first gathering run.', ...over });

let ctx;
beforeEach(() => { ctx = makeFakeContext(); });
const db = () => ctx.adminDb;
const seed = async (p) => { await db().collection('social_posts').doc(p.id).set(p); return p; };
const panelPost = (over = {}) => post({ videoBrief: CREATIVE, videoBriefMeta: { creative: CREATIVE, creativeRev: 1, status: 'approved' }, ...over });
const raw = (id) => db()._raw('social_posts', id);

test('catalogCheck: stable reason strings', () => {
  const r = (steps, extra = {}) => catalogCheck({ steps, ...extra }, catalog);
  assert.deepEqual(r([step('spotTile', 'selectSpot', { preset: 'idle' })]), []);
  assert.deepEqual(r([step('nope', 'x')]), ['unknown-panel:1:nope']);
  assert.deepEqual(r([step('spotTile', 'selectSpot'), step('spotInfo', 'fly')]), ['unknown-action:2:fly']);
  assert.deepEqual(r([step('spotTile', 'selectSpot', { preset: 'weird' })]), ['unknown-preset:1:weird']);
  assert.deepEqual(r([], { host: { name: 'wizard' } }), ['unknown-host:wizard']);
  assert.deepEqual(r([], { skeleton: 'cursor', host: { name: 'none' } }), []);
  assert.deepEqual(catalogCheck({ end: { art: { src: 'art/posters/nope.jpg' } } }, catalog), ['art-missing:art/posters/nope.jpg']);
  assert.deepEqual(catalogCheck({ end: { art: { src: 'art/posters/s3-first-look.jpg' } } }, catalog), []);
  assert.match(catalogHash(catalog, campaign), /^[0-9a-f]{16}$/);
});

test('tool schema: panel/preset/action are enums from the catalog; steps are one branch per panel', () => {
  const s = authorToolSchema(catalog).properties.request.properties.steps.items.anyOf.filter((b) => b.properties.panel); // plus one scene-block branch
  assert.deepEqual(s.map((b) => b.properties.panel.enum[0]).sort(), Object.keys(catalog.panels).sort());
  const claim = s.find((b) => b.properties.panel.enum[0] === 'spotClaimReward');
  assert.deepEqual(claim.properties.clicks.items.properties.action.enum, catalog.panels.spotClaimReward.actions);
  assert.deepEqual(claim.properties.preset.enum, catalog.panels.spotClaimReward.presets);
});

test('author: valid on the first try (one call, forced tool, brief in a data block, server-set fields)', async () => {
  const llm = mockLlm(goodInput());
  const out = await authorHowtoRequest({ post: post(), creative: CREATIVE, catalog, campaign, llm, rev: 2 });
  assert.equal(out.ok, true);
  assert.equal(llm.calls.length, 1);
  const p = llm.calls[0];
  assert.deepEqual(p.tool_choice, { type: 'tool', name: 'author_request' });
  assert.match(p.messages[0].content, /<creative_brief>[\s\S]*Creative ID: CQ-S3-1119[\s\S]*<\/creative_brief>/);
  assert.match(p.system, /never invent a different topic/i);
  assert.equal(out.request.id, 'cb-abc12345-r2');
  assert.equal(out.request.review_on, '2026-11-19');
  assert.equal(out.request.public_copy, 'Before the Titans: your first gathering run.');
  assert.equal(out.request.request_version, 3.3);
  assert.equal(out.request.skeleton, 'cursor');
});

test('author: invalid first output is repaired once with the errors sent back', async () => {
  const bad = goodInput(); bad.request.steps[1] = step('critterSelection', 'fly');
  const llm = mockLlm(bad, goodInput());
  const out = await authorHowtoRequest({ post: post(), creative: CREATIVE, catalog, campaign, llm });
  assert.equal(out.ok, true);
  assert.equal(llm.calls.length, 2);
  const back = llm.calls[1].messages.at(-1).content[0];
  assert.equal(back.type, 'tool_result'); assert.equal(back.is_error, true);
  assert.match(back.content, /unknown-action:2:fly/);
});

test('author: still invalid after the retry returns reasons; never a third call', async () => {
  const bad = goodInput(); bad.request.steps[0] = step('nope', 'x');
  const llm = mockLlm(bad);
  const out = await authorHowtoRequest({ post: post(), creative: CREATIVE, catalog, campaign, llm });
  assert.equal(out.ok, false);
  assert.ok(out.reasons.includes('unknown-panel:1:nope'));
  assert.equal(llm.calls.length, 2);
});

test('author: unsupported shot returns structured reasons without a retry', async () => {
  const llm = mockLlm({ unsupported: [{ shot: 'shot 3', what: 'trading screen' }] });
  const out = await authorHowtoRequest({ post: post(), creative: CREATIVE, catalog, campaign, llm });
  assert.deepEqual(out, { ok: false, reasons: ['unsupported:shot 3:trading screen'] });
  assert.equal(llm.calls.length, 1);
});

test('authorPostBrief: submits (auto-approved), sets howto line + authored meta; re-approve makes no call', async () => {
  await seed(panelPost());
  const llm = mockLlm(goodInput());
  const out = await authorPostBrief({ db: db(), clientId: CLIENT, postId: 'social_abc12345', llm, now: NOW, by: 'o@x.com' });
  assert.equal(out.ok, true); assert.equal(out.authored, true);
  const row = raw('social_abc12345');
  assert.equal(row.videoBrief, 'howto=cb-abc12345-r1');
  assert.equal(row.videoBriefHash, briefHash('howto=cb-abc12345-r1'));
  assert.equal(row.videoBriefMeta.creative, CREATIVE);
  assert.equal(row.videoBriefMeta.authored.requestId, 'cb-abc12345-r1');
  assert.equal(row.videoBriefMeta.authored.key, authorKey({ ...panelPost() }));
  assert.equal(row.videoBriefMeta.status, 'approved');
  assert.equal(raw('social_abc12345').revision, 4);
  const stored = db()._raw('howto_requests', 'cb-abc12345-r1');
  assert.equal(stored.status, 'approved'); assert.equal(stored.autoApproved, true);
  const again = await authorPostBrief({ db: db(), clientId: CLIENT, postId: 'social_abc12345', llm, now: NOW });
  assert.equal(again.ok, true); assert.equal(again.skipped, 'not-applicable');
  assert.equal(llm.calls.length, 1);
});

test('authorPostBrief: matching authored key reuses the request id without a call even if videoBrief was reset', async () => {
  const p = panelPost();
  await seed({ ...p, videoBriefMeta: { ...p.videoBriefMeta, authored: { key: authorKey(p), requestId: 'cb-old-r1' } } });
  const llm = mockLlm(goodInput());
  const out = await authorPostBrief({ db: db(), clientId: CLIENT, postId: p.id, llm, now: NOW });
  assert.equal(out.skipped, 'reused');
  assert.equal(raw(p.id).videoBrief, 'howto=cb-old-r1');
  assert.equal(llm.calls.length, 0);
});

test('authorPostBrief: daily cap -> author-cap reason, authorError stored, brief untouched', async () => {
  await seed(panelPost());
  const llm = mockLlm(goodInput());
  const env = { BRIEF_AUTHOR_DAILY_CALLS: '1' };
  await db().collection('brief_author_usage').doc('2026-11-19').set({ day: '2026-11-19', count: 1 });
  const out = await authorPostBrief({ db: db(), clientId: CLIENT, postId: 'social_abc12345', llm, now: NOW, env });
  assert.equal(out.ok, false); assert.equal(out.status, 409);
  assert.deepEqual(out.reasons, ['author-cap']);
  assert.equal(llm.calls.length, 0);
  assert.deepEqual(raw('social_abc12345').videoBriefMeta.authorError.reasons, ['author-cap']);
  assert.equal(raw('social_abc12345').videoBrief, CREATIVE);
});

test('authorPostBrief: counts one cap unit per model call (repair = 2)', async () => {
  await seed(panelPost());
  const bad = goodInput(); bad.request.steps[1] = step('critterSelection', 'fly');
  await authorPostBrief({ db: db(), clientId: CLIENT, postId: 'social_abc12345', llm: mockLlm(bad, goodInput()), now: NOW });
  assert.equal(db()._raw('brief_author_usage', '2026-11-19').count, 2);
});

test('authorPostBrief: unsupported -> reasons stored as authorError; non-CQ clients and free-text briefs are skipped', async () => {
  await seed(panelPost());
  const out = await authorPostBrief({ db: db(), clientId: CLIENT, postId: 'social_abc12345', llm: mockLlm({ unsupported: [{ shot: 's2', what: 'trading' }] }), now: NOW });
  assert.deepEqual(out.reasons, ['unsupported:s2:trading']);
  assert.deepEqual(raw('social_abc12345').videoBriefMeta.authorError.reasons, ['unsupported:s2:trading']);
  assert.equal(needsAuthoring(panelPost({ videoBrief: 'Short art teaser.', videoBriefMeta: { creative: 'Short art teaser.', status: 'approved' } }), CLIENT), false);
  assert.equal(needsAuthoring(panelPost(), 'other-client'), false);
});

test('field split: creative lives in meta; videoBrief keeps the machine line; edits reset it and send approved back to ready', () => {
  const a = mergeVideoBrief({}, { template: CREATIVE }, { now: 'n' });
  assert.equal(a.videoBriefMeta.creative, CREATIVE); assert.equal(a.videoBrief, CREATIVE);
  const authored = { videoBrief: 'howto=cb-x-r1', videoBriefMeta: { ...a.videoBriefMeta, status: 'approved', authored: { key: 'k', requestId: 'cb-x-r1' } } };
  const same = mergeVideoBrief(authored, { shots: 'more' });
  assert.equal(same.videoBrief, 'howto=cb-x-r1'); assert.equal(same.videoBriefMeta.status, 'approved'); assert.equal(same.videoBriefMeta.creativeRev, 1);
  const edited = mergeVideoBrief(authored, { template: `${CREATIVE}\nmore` });
  assert.equal(edited.videoBriefMeta.status, 'ready'); assert.equal(edited.videoBrief, `${CREATIVE}\nmore`); assert.equal(edited.videoBriefMeta.creativeRev, 2);
  assert.equal(videoBriefView({ ...authored }).template, CREATIVE);
  assert.equal(videoBriefView({ ...authored }).videoBrief, 'howto=cb-x-r1');
});

test('field split back-compat: meta without .creative treats videoBrief as the creative', () => {
  const legacy = { videoBrief: 'Shot 1: hero.', videoBriefMeta: { status: 'approved', assets: [] } };
  assert.equal(creativeOf(legacy), 'Shot 1: hero.');
  const kept = mergeVideoBrief(legacy, { captions: 'C' });
  assert.equal(kept.videoBriefMeta.creative, 'Shot 1: hero.'); assert.equal(kept.videoBriefMeta.status, 'approved'); assert.equal(kept.videoBrief, 'Shot 1: hero.');
  assert.equal(mergeVideoBrief(legacy, { template: 'Shot 1: hero.' }).videoBriefMeta.status, 'approved');
  assert.equal(panelBriefBlocksRender({ ...legacy, videoBriefMeta: { status: 'ready' } }), true);
  assert.equal(isPanelBriefPending(legacy), true);
});

test('attach keeps the creative and the authored meta', () => {
  const p = panelPost({ videoBrief: 'howto=cb-abc12345-r1', videoBriefMeta: { creative: CREATIVE, status: 'approved', authored: { key: 'k', requestId: 'cb-abc12345-r1' } } });
  const job = { clientId: CLIENT, briefHash: briefHash('howto=cb-abc12345-r1'), kind: 'cq-howto', downloadUrl: 'https://v.mp4', posterUrl: 'https://p.jpg', jobId: 'bv_1' };
  const r = planAttach(p, job, { now: 'n' });
  assert.equal(r.ok, true);
  assert.equal(r.updated.videoBriefMeta.creative, CREATIVE);
  assert.equal(r.updated.videoBriefMeta.authored.requestId, 'cb-abc12345-r1');
  assert.equal(r.updated.videoBriefMeta.status, 'rendered');
  assert.equal(r.updated.videoBrief, 'howto=cb-abc12345-r1');
});

test('template doc lists every vendored catalog panel', () => {
  const doc = fs.readFileSync(new URL('../../../docs/source-of-truth/CQ-CREATIVE-BRIEF-TEMPLATE.md', import.meta.url), 'utf8');
  for (const panel of Object.keys(catalog.panels)) assert.ok(doc.includes(panel), `doc misses ${panel}`);
  for (const a of Object.values(catalog.panels).flatMap((p) => [...p.actions, ...p.presets])) assert.ok(doc.includes(a), `doc misses ${a}`);
});

test('scene blocks: tool schema enums, prompt block list and rules, exclude enforced with repair', async () => {
  const { authorSystemPrompt, blockListText } = await import('../brief-author.js');
  const schema = authorToolSchema(catalog);
  const props = schema.properties.request.properties;
  assert.deepEqual(props.exclude.items.enum, ['money', 'S3', 'realPlayers']);
  assert.ok(props.establish.properties.scene.enum.includes('gravitax.target'));
  assert.ok(!props.establish.properties.scene.enum.includes('gravitax.squad'), 'establish enum lists only establish-role blocks');
  const sceneBranch = props.steps.items.anyOf.find((b) => b.properties.scene);
  assert.ok(sceneBranch.properties.scene.enum.includes('gravitax.squad'));
  const prompt = authorSystemPrompt(catalog, campaign);
  assert.match(prompt, /- gravitax\.squad \| 2\.9s \| .+ \| shows: squad-pick/);
  assert.match(prompt, /Map each brief shot to a `shows` tag first/);
  assert.match(prompt, /\["money"\] unless the brief explicitly shows rewards/);
  assert.ok(blockListText(catalog).split('\n').length === Object.keys(catalog.scenes).length);

  const sceneInput = (scene2) => ({ unsupported: [], request: { ...goodInput().request, exclude: ['money'], establish: { caption: 'WHICH FIGHT FIRST?', seconds: 3, scene: 'gravitax.target' }, steps: [{ scene: 'gravitax.target', caption: 'CHECK THE TARGET', seconds: 2.5 }, { scene: scene2, caption: 'BUILD THE SQUAD', seconds: 3 }], end: { seconds: 3 } } });
  const ok = await authorHowtoRequest({ post: post(), creative: CREATIVE, catalog, campaign, llm: mockLlm(sceneInput('gravitax.squad')) });
  assert.equal(ok.ok, true, JSON.stringify(ok.reasons));
  const llm = mockLlm(sceneInput('raid.send'), sceneInput('gravitax.squad'));
  const fixed = await authorHowtoRequest({ post: post(), creative: CREATIVE, catalog, campaign, llm });
  assert.equal(fixed.ok, true);
  assert.equal(llm.calls.length, 2);
  assert.match(JSON.stringify(llm.calls[1].messages), /excluded-scene:2:raid\.send:money/);
});

test('variety: block ids in signature, recent list in the prompt, repeat-scene warning, one jobs read', async () => {
  const { sceneSignature, blocksOf, recentBlockLists, repeatSceneWarnings, similarRecentWarnings } = await import('../brief-author.js');
  const mk = (id, ...blocks) => ({ id, establish: { scene: blocks[0] }, steps: blocks.slice(1).map((b) => { const [scene, variant] = b.split('#'); return { scene, ...(variant ? { variant } : {}) }; }) });
  const a = mk('a', 'gravitax.target', 'gravitax.target', 'gravitax.squad');
  assert.deepEqual(sceneSignature(a), ['establish|scene|gravitax.target|', 'scene|gravitax.target|', 'scene|gravitax.squad|']);
  assert.notDeepEqual(sceneSignature(mk('b', 'raid.target', 'raid.march')), sceneSignature(a));
  assert.deepEqual(blocksOf(mk('p', 'leaderboard.poster', 'leaderboard.podium#number-one')), ['leaderboard.poster', 'leaderboard.podium#number-one']);
  const jobs = ['raid.target', 'titans.wake', 'shards.cracks', 'gravitax.map', 'raid.march'].map((b, i) => ({ postId: `p${i}`, status: 'done', request: mk(`r${i}`, b), createdAt: `2026-11-1${i}T10:00:00Z` }));
  jobs.push({ postId: 'q', status: 'queued', request: mk('q', 'leaderboard.poster'), createdAt: '2026-11-18T10:00:00Z' });
  assert.deepEqual(recentBlockLists(jobs)[0], ['raid.march'], 'newest finished first, queued skipped');
  // previous 3 = raid.march, gravitax.map, shards.cracks
  assert.deepEqual(repeatSceneWarnings(mk('n', 'gravitax.map', 'raid.target'), jobs), ['repeat-scene:gravitax.map']);
  let reads = 0;
  const db = { collection: () => ({ where: () => ({ get: async () => { reads += 1; return { docs: jobs.map((j) => ({ data: () => j })) }; } }) }) };
  const out = await similarRecentWarnings(db, { clientId: CLIENT, request: mk('n', 'gravitax.map', 'raid.target'), postId: 'self', now: Date.parse('2026-11-19T12:00:00Z') });
  assert.deepEqual(out.warnings, ['repeat-scene:gravitax.map']);
  assert.equal(reads, 1);
  // the recent list reaches the user prompt
  const llm = mockLlm(goodInput());
  await authorHowtoRequest({ post: post(), creative: CREATIVE, catalog, campaign, llm, recent: recentBlockLists(jobs) });
  assert.match(llm.calls[0].messages[0].content, /Recent videos, newest first[\s\S]*1\. raid\.march/);
});

test('money exclusion is enforced in code; only "Show money: yes" in the brief opts out', async () => {
  const noEx = (scene2) => { const i = { unsupported: [], request: { ...goodInput().request, establish: { caption: 'RAID', seconds: 3, scene: 'raid.target' }, steps: [{ scene: 'raid.march', caption: 'MARCH', seconds: 3 }, { scene: scene2, caption: 'SEND', seconds: 3 }], end: { seconds: 3 } } }; return i; };
  // model omits exclude and picks a money block: rejected, then repaired
  const llm = mockLlm(noEx('raid.send'), noEx('raid.warning'));
  const out = await authorHowtoRequest({ post: post(), creative: CREATIVE, catalog, campaign, llm });
  assert.equal(out.ok, true, JSON.stringify(out.reasons));
  assert.equal(llm.calls.length, 2);
  assert.match(JSON.stringify(llm.calls[1].messages), /excluded-scene:2:raid\.send:money/);
  assert.deepEqual(out.request.exclude, ['money']);
  // brief says Show money: yes -> the money block is allowed
  const llm2 = mockLlm(noEx('raid.send'));
  const yes = await authorHowtoRequest({ post: post(), creative: `${CREATIVE}\nShow money: yes`, catalog, campaign, llm: llm2 });
  assert.equal(yes.ok, true, JSON.stringify(yes.reasons));
  assert.equal(llm2.calls.length, 1);
  assert.ok(!yes.request.exclude.includes('money'));
});
