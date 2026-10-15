import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplier, DRAFT_STYLE_ID } from '../applier.js';
import { createBaseline } from '../../theme/baseline.js';
import { setMasterHue } from '../../theme/edit.js';
import { DRAFT_CSS_MARKER } from '../../theme/constants.js';
import { createFakeDocument, createManualScheduler, createFakeSceneBridge } from './helpers.js';

function make() {
  const doc = createFakeDocument();
  const scheduler = createManualScheduler();
  const bridge = createFakeSceneBridge();
  const applied = [];
  const applier = createApplier({ document: doc, scheduler, getSceneBridge: () => bridge, onApplied: (r) => applied.push(r) });
  return { doc, scheduler, bridge, applier, applied };
}

test('N schedule() calls inside one frame produce exactly one apply, with the LAST definition', () => {
  const { applier, scheduler, applied, doc } = make();
  const base = createBaseline();
  for (let hue = 10; hue <= 100; hue += 10) applier.schedule(setMasterHue(base, hue));
  assert.equal(applier.applyCount, 0);
  assert.equal(scheduler.pendingFrames, 1, 'a single rAF is outstanding');
  scheduler.frame();
  assert.equal(applier.applyCount, 1);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].definition.master.hue, 100);
  const el = doc.getElementById(DRAFT_STYLE_ID);
  assert.ok(el, 'style element created');
  assert.ok(el.textContent.startsWith(DRAFT_CSS_MARKER), 'persistable CSS starts with the bootstrap marker');
  assert.match(el.textContent, /--t-page:/);
});

test('each apply pushes scenes to the bridge and dispatches theme:tokens-changed', () => {
  const { applier, scheduler, bridge, doc } = make();
  applier.schedule(setMasterHue(createBaseline(), 30));
  scheduler.frame();
  const setDraft = bridge.calls.filter((c) => c[0] === 'setDraft');
  assert.equal(setDraft.length, 1);
  assert.ok(setDraft[0][1].light && setDraft[0][1].dark);
  assert.equal(typeof setDraft[0][1].light.hueShift, 'number');
  assert.equal(doc._events.length, 1);
});

test('the style element is reused across applies (never duplicated)', () => {
  const { applier, scheduler, doc } = make();
  applier.schedule(setMasterHue(createBaseline(), 30)); scheduler.frame();
  applier.schedule(setMasterHue(createBaseline(), 60)); scheduler.frame();
  assert.equal(doc.head.children.filter((c) => c.id === DRAFT_STYLE_ID).length, 1);
});

test('a bootstrap-injected style element is adopted, not duplicated', () => {
  const { applier, scheduler, doc } = make();
  const pre = doc.createElement('style'); pre.id = DRAFT_STYLE_ID; pre.textContent = `${DRAFT_CSS_MARKER}old */`;
  doc.head.appendChild(pre);
  applier.schedule(setMasterHue(createBaseline(), 77)); scheduler.frame();
  assert.equal(doc.head.children.length, 1);
  assert.notEqual(pre.textContent, `${DRAFT_CSS_MARKER}old */`);
});

test('transition suppression: set at drag start, cleared two frames after the drag ends', () => {
  const { applier, scheduler, doc } = make();
  const root = doc.documentElement;
  assert.equal(root.hasAttribute('data-theme-switching'), false);
  applier.beginSwitching();
  assert.equal(root.hasAttribute('data-theme-switching'), true);
  scheduler.frame(); scheduler.frame(); scheduler.frame();
  assert.equal(root.hasAttribute('data-theme-switching'), true, 'still held while the drag is open');
  applier.endSwitching();
  assert.equal(root.hasAttribute('data-theme-switching'), true, 'held right after release');
  scheduler.frame();
  assert.equal(root.hasAttribute('data-theme-switching'), true, 'held after 1 frame');
  scheduler.frame();
  assert.equal(root.hasAttribute('data-theme-switching'), false, 'cleared after 2 frames');
});

test('beginSwitching is idempotent and endSwitching without begin is harmless', () => {
  const { applier, scheduler, doc } = make();
  applier.endSwitching();
  applier.beginSwitching(); applier.beginSwitching();
  applier.endSwitching();
  scheduler.frame(); scheduler.frame();
  assert.equal(doc.documentElement.hasAttribute('data-theme-switching'), false);
});

test('flush() applies a pending request synchronously and cancels the frame', () => {
  const { applier, scheduler } = make();
  applier.schedule(setMasterHue(createBaseline(), 40));
  const r = applier.flush();
  assert.equal(applier.applyCount, 1);
  assert.equal(r.definition.master.hue, 40);
  scheduler.frame();
  assert.equal(applier.applyCount, 1, 'the cancelled frame does not apply again');
});

test('visible:false resolves but shows production (style removed, bridge draft cleared)', () => {
  const { applier, scheduler, doc, bridge } = make();
  applier.schedule(setMasterHue(createBaseline(), 40)); scheduler.frame();
  assert.ok(doc.getElementById(DRAFT_STYLE_ID));
  applier.schedule(setMasterHue(createBaseline(), 50), false); scheduler.frame();
  assert.equal(doc.getElementById(DRAFT_STYLE_ID), null);
  assert.equal(bridge.draft, null);
  assert.equal(applier.last.pair.light.meta.masterHue, 50, 'still resolved for the Studio');
});

test('clear() removes the draft from the page and from the bridge', () => {
  const { applier, scheduler, doc, bridge } = make();
  applier.schedule(setMasterHue(createBaseline(), 40)); scheduler.frame();
  applier.schedule(setMasterHue(createBaseline(), 41));
  applier.clear();
  scheduler.frame();
  assert.equal(doc.getElementById(DRAFT_STYLE_ID), null);
  assert.equal(bridge.draft, null);
  assert.equal(applier.applyCount, 1, 'the pending request was cancelled');
});

test('works with no scene bridge registered (WS4 bridge optional in tests)', () => {
  const doc = createFakeDocument();
  const scheduler = createManualScheduler();
  const applier = createApplier({ document: doc, scheduler, getSceneBridge: () => null });
  applier.schedule(createBaseline());
  assert.doesNotThrow(() => scheduler.frame());
  assert.equal(applier.applyCount, 1);
});
