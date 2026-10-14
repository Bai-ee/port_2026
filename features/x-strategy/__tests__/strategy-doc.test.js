import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTION_KEYS, SECTION_MAX, DOC_HISTORY_CAP, normalizeSections, validateEdits, applyDocEdit, revertDoc,
  sectionsAtVersion, renderDocText, describeDocChange, draftDoc, withLastReview,
} from '../strategy-doc.js';
import { SEED_STRATEGY_SECTIONS } from '../strategy-doc-seed.js';
import { HOME_STRATEGY_SECTIONS } from '../../../scripts/x-content/seed-home-priors.mjs';
import { createMemoryStrategyDocStore, StrategyDocError } from '../strategy-doc-store.js';

const NOW = '2026-10-12T12:00:00.000Z';
const edit = (doc, sections, extra = {}) => applyDocEdit(doc, { sections, by: 'owner@x', source: 'manual', expectedVersion: doc?.version ?? 0, now: NOW, ...extra });

test('code seed is blank for every section (no inherited strategy)', () => {
  assert.deepEqual(Object.keys(SEED_STRATEGY_SECTIONS), [...SECTION_KEYS]);
  for (const k of SECTION_KEYS) assert.equal(SEED_STRATEGY_SECTIONS[k], '', `seed ${k}`);
  assert.equal(renderDocText(draftDoc(SEED_STRATEGY_SECTIONS)), '', 'a blank draft renders nothing');
});

test('home seed text (moved to the seed script) covers every section within the cap', () => {
  for (const k of SECTION_KEYS) {
    assert.ok(HOME_STRATEGY_SECTIONS[k], `home ${k}`);
    assert.ok(HOME_STRATEGY_SECTIONS[k].length <= SECTION_MAX, `home ${k} length`);
  }
});

test('normalizeSections fills missing keys and drops unknown ones', () => {
  const s = normalizeSections({ thesis: '  a  \r\nb ', bogus: 'x' });
  assert.deepEqual(Object.keys(s), [...SECTION_KEYS]);
  assert.equal(s.thesis, 'a\nb');
  assert.equal(s.rules, '');
});

test('validateEdits rejects unknown keys, non-strings and oversize text', () => {
  assert.equal(validateEdits({}).ok, false);
  assert.match(validateEdits({ nope: 'x' }).errors[0], /unknown section/);
  assert.match(validateEdits({ rules: 3 }).errors[0], /string/);
  assert.match(validateEdits({ rules: 'x'.repeat(SECTION_MAX + 1) }).errors[0], /at most/);
  assert.deepEqual(validateEdits({ rules: ' keep ' }).edits, { rules: 'keep' });
});

test('first manual save from the draft keeps other drafted sections and confirms', () => {
  const doc = applyDocEdit(null, { sections: { rules: 'No hashtags.' }, by: 'owner@x', source: 'manual', expectedVersion: 0, now: NOW, base: SEED_STRATEGY_SECTIONS });
  assert.equal(doc.version, 1);
  assert.equal(doc.confirmed, true);
  assert.equal(doc.sections.rules, 'No hashtags.');
  assert.equal(doc.sections.thesis, SEED_STRATEGY_SECTIONS.thesis);
  assert.deepEqual(doc.history[0].changed, ['rules']);
  assert.equal(doc.history[0].before.rules, SEED_STRATEGY_SECTIONS.rules);
});

test('saving an unchanged draft confirms it; an unchanged confirmed doc is a noop', () => {
  const draft = draftDoc(SEED_STRATEGY_SECTIONS);
  const doc = applyDocEdit(null, { sections: { thesis: SEED_STRATEGY_SECTIONS.thesis }, by: 'o', source: 'manual', expectedVersion: 0, now: NOW, base: draft.sections });
  assert.equal(doc.version, 1);
  assert.equal(doc.confirmed, true);
  assert.deepEqual(doc.history[0].changed, []);
  assert.equal(doc.history[0].confirmed, true);
  assert.match(describeDocChange(doc.history[0]), /confirmed/);
  assert.deepEqual(edit(doc, { thesis: SEED_STRATEGY_SECTIONS.thesis }), { error: 'noop' });
});

test('a chat edit on an unconfirmed doc does not confirm it', () => {
  const doc = applyDocEdit(null, { sections: { open: 'q?' }, by: 'agent', source: 'chat', expectedVersion: 0, now: NOW, base: SEED_STRATEGY_SECTIONS, proposalId: 'p1' });
  assert.equal(doc.confirmed, false);
  assert.equal(doc.history[0].proposalId, 'p1');
  assert.match(describeDocChange(doc.history[0]), /Open questions edited from chat/);
});

test('version conflict and invalid requests', () => {
  const doc = edit(null, { thesis: 'a' });
  assert.deepEqual(edit(doc, { thesis: 'b' }, { expectedVersion: 0 }), { error: 'version-conflict', currentVersion: 1 });
  assert.equal(edit(doc, { thesis: 'b' }, { source: 'robot' }).error, 'invalid');
  assert.equal(edit(doc, { thesis: 'b' }, { by: '' }).error, 'invalid');
});

test('history is capped and restore walks back through retained versions', () => {
  let doc = edit(null, { thesis: 'v1' });
  for (let i = 2; i <= DOC_HISTORY_CAP + 5; i += 1) doc = edit(doc, { thesis: `v${i}`, ...(i === 10 ? { rules: 'r10' } : {}) });
  assert.equal(doc.history.length, DOC_HISTORY_CAP);
  assert.equal(sectionsAtVersion(doc, 1), null, 'version 1 fell out of history');
  const at12 = sectionsAtVersion(doc, 12);
  assert.equal(at12.thesis, 'v12');
  assert.equal(at12.rules, 'r10');
  const restored = revertDoc(doc, 12, { by: 'o', now: NOW });
  assert.equal(restored.version, doc.version + 1);
  assert.equal(restored.sections.thesis, 'v12');
  assert.equal(restored.history.at(-1).reason, 'restore v12');
  assert.deepEqual(revertDoc(doc, 1, { by: 'o' }), { error: 'version-unavailable' });
});

test('renderDocText labels drafts, skips empty sections and caps length', () => {
  const draft = draftDoc(HOME_STRATEGY_SECTIONS);
  assert.match(renderDocText(draft), /^STRATEGY DOCUMENT \(DRAFT/);
  const doc = edit(null, { rules: 'R', thesis: '' }, { base: {} });
  const text = renderDocText(doc);
  assert.match(text, /^STRATEGY DOCUMENT v1 \(confirmed/);
  assert.match(text, /## Rules\nR/);
  assert.doesNotMatch(text, /## Thesis/);
  assert.equal(renderDocText(doc, { only: ['thesis'] }), '');
  assert.ok(renderDocText(draft, { maxChars: 200 }).length <= 200);
});

test('withLastReview stamps without a version bump', () => {
  const doc = edit(null, { thesis: 'a' });
  const r = withLastReview(doc, { at: NOW, docVersion: 1 });
  assert.equal(r.version, 1);
  assert.equal(r.lastReview.docVersion, 1);
  assert.equal(withLastReview(null, {}), null);
});

test('memory store: apply, conflict, revert, markReviewed', async () => {
  const store = createMemoryStrategyDocStore();
  assert.equal(await store.get('c1'), null);
  const a = await store.apply('c1', { sections: { thesis: 'x' }, by: 'o', source: 'manual', expectedVersion: 0, now: NOW, base: SEED_STRATEGY_SECTIONS });
  assert.equal(a.changed, true);
  await assert.rejects(store.apply('c1', { sections: { thesis: 'y' }, by: 'o', source: 'manual', expectedVersion: 0 }), (e) => e instanceof StrategyDocError && e.status === 409);
  await store.apply('c1', { sections: { thesis: 'y' }, by: 'o', source: 'manual', expectedVersion: 1, now: NOW });
  const r = await store.revert('c1', 1, { by: 'o', now: NOW });
  assert.equal(r.doc.sections.thesis, 'x');
  await store.markReviewed('c1', { at: NOW });
  assert.equal((await store.get('c1')).lastReview.at, NOW);
  assert.equal((await store.markReviewed('c2', { at: NOW })).changed, false);
  await assert.rejects(store.revert('c2', 1, { by: 'o' }), (e) => e.code === 'not-found');
});

test('strategyGuidance: only a confirmed doc, only rules + formats, capped', async () => {
  const { strategyGuidance, GUIDANCE_MAX } = await import('../strategy-doc.js');
  assert.equal(strategyGuidance(null), '');
  assert.equal(strategyGuidance(draftDoc(SEED_STRATEGY_SECTIONS)), '');
  const doc = edit(null, { rules: 'No hashtags.', formats: 'Video showcases.', thesis: 'secret thesis' }, { base: {} });
  const g = strategyGuidance(doc);
  assert.match(g, /confirmed strategy \(v1\)/);
  assert.match(g, /Rules:\nNo hashtags\./);
  assert.match(g, /Formats:\nVideo showcases\./);
  assert.doesNotMatch(g, /secret thesis/);
  const big = edit(null, { rules: 'r'.repeat(SECTION_MAX), formats: 'f'.repeat(SECTION_MAX) }, { base: {} });
  assert.ok(strategyGuidance(big).length <= GUIDANCE_MAX);
});

test('daily loop: a confirmed doc joins the fingerprint; a draft or missing doc does not', async () => {
  const { inputFingerprint } = await import('../../x-content-inventory/daily-loop/run.js');
  const base = { scan: null, search: null, packages: [], brain: {}, strategyPlan: null, strategySource: null, benchmark: null, max: 5 };
  const none = inputFingerprint(base);
  assert.equal(inputFingerprint({ ...base, strategyDoc: draftDoc(SEED_STRATEGY_SECTIONS) }), none);
  const v1 = edit(null, { rules: 'a' }, { base: {} });
  const v2 = edit(v1, { rules: 'b' });
  assert.notEqual(inputFingerprint({ ...base, strategyDoc: v1 }), none);
  assert.notEqual(inputFingerprint({ ...base, strategyDoc: v1 }), inputFingerprint({ ...base, strategyDoc: v2 }));
});

test('content context lists the strategy document only when wired', async () => {
  const { describeContentInputs } = await import('../../content-context/load-content-context.js');
  const args = { raw: { brain: {}, packages: [] }, planDoc: null, planInputs: { source: 'default', authoredPerDay: null, planVersion: null }, now: Date.parse(NOW) };
  const ids = (list) => list.map((i) => i.id);
  assert.ok(!ids(describeContentInputs(args)).includes('strategy-doc'));
  const missing = describeContentInputs({ ...args, strategyDoc: null }).find((i) => i.id === 'strategy-doc');
  assert.equal(missing.usable, false);
  assert.match(missing.caveats[0], /No strategy document/);
  const draft = describeContentInputs({ ...args, strategyDoc: applyDocEdit(null, { sections: { open: 'q' }, by: 'a', source: 'chat', expectedVersion: 0, now: NOW }) }).find((i) => i.id === 'strategy-doc');
  assert.equal(draft.usable, false);
  assert.match(draft.caveats[0], /draft/);
  const ok = describeContentInputs({ ...args, strategyDoc: edit(null, { rules: 'a' }) }).find((i) => i.id === 'strategy-doc');
  assert.equal(ok.usable, true);
  assert.equal(ok.version, 1);
});
