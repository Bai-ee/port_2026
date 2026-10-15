import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readToken, onTokensChanged, emitTokensChanged, bumpTokensEpoch, getTokensEpoch, TOKENS_CHANGED_EVENT } from '../read-token.js';
import { createSelectorGetter, shallowEqual } from '../select.js';
import { useThemePreference, useResolvedMode, useThemeSelector } from '../hooks.js';
import { createFakeDocument } from './helpers.js';

function installDom(values) {
  const reads = [];
  const doc = createFakeDocument();
  globalThis.document = doc;
  globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => { reads.push(n); return `  ${values[n] ?? ''}  `; } });
  return { doc, reads, restore() { delete globalThis.document; delete globalThis.getComputedStyle; } };
}

test('readToken trims, memoises per epoch, and re-reads after theme:tokens-changed', () => {
  const values = { '--t-page': '#ffffff' };
  const d = installDom(values);
  try {
    bumpTokensEpoch();
    assert.equal(readToken('--t-page'), '#ffffff');
    assert.equal(readToken('--t-page'), '#ffffff');
    assert.equal(d.reads.length, 1, 'second read is memoised');
    values['--t-page'] = '#0f0e0a';
    assert.equal(readToken('--t-page'), '#ffffff', 'still cached within the epoch');
    emitTokensChanged(d.doc);
    assert.equal(readToken('--t-page'), '#0f0e0a');
    assert.equal(readToken('--t-missing'), '');
  } finally { d.restore(); }
});

test('readToken with an explicit element is not memoised', () => {
  const d = installDom({ '--t-page': '#fff' });
  try {
    readToken('--t-page', {}); readToken('--t-page', {});
    assert.equal(d.reads.length, 2);
  } finally { d.restore(); }
});

test('readToken returns "" without a DOM (SSR)', () => {
  assert.equal(readToken('--t-page'), '');
});

test('onTokensChanged / emitTokensChanged: event name, epoch bump, unsubscribe', () => {
  const d = installDom({});
  try {
    let n = 0;
    const off = onTokensChanged(() => { n += 1; });
    const e0 = getTokensEpoch();
    emitTokensChanged();
    assert.equal(n, 1);
    assert.equal(getTokensEpoch(), e0 + 1);
    off();
    emitTokensChanged();
    assert.equal(n, 1);
    assert.equal(TOKENS_CHANGED_EVENT, 'theme:tokens-changed');
  } finally { d.restore(); }
});

test('selector getter: same reference while the selected value is unchanged', () => {
  let snap = { preference: 'light', systemMode: 'light', resolvedMode: 'light', storageAvailable: true };
  const get = createSelectorGetter(() => snap);
  const selMode = (s) => s.resolvedMode;
  const a = get(selMode);
  // unrelated field changes => new snapshot, same selected value
  snap = { ...snap, storageAvailable: false };
  assert.equal(get(selMode), a);
  snap = { ...snap, resolvedMode: 'dark' };
  assert.equal(get(selMode), 'dark');
});

test('selector getter with an object selector: Object.is would churn, shallowEqual keeps identity', () => {
  let snap = { a: 1, b: 2 };
  const pick = (s) => ({ a: s.a });
  const strict = createSelectorGetter(() => snap);
  const shallow = createSelectorGetter(() => snap, shallowEqual);
  const s1 = strict(pick); const h1 = shallow(pick);
  snap = { a: 1, b: 3 };
  assert.notEqual(strict(pick), s1);
  assert.equal(shallow(pick), h1, 'unrelated change does not produce a new object');
  snap = { a: 2, b: 3 };
  assert.notEqual(shallow(pick), h1);
});

test('selector getter does not recompute for the same snapshot + selector', () => {
  let calls = 0;
  const snap = { x: 1 };
  const get = createSelectorGetter(() => snap);
  const sel = (s) => { calls += 1; return s.x; };
  get(sel); get(sel); get(sel);
  assert.equal(calls, 1);
});

function Probe() {
  const { preference } = useThemePreference();
  const mode = useResolvedMode();
  const custom = useThemeSelector((s) => `${s.systemMode}:${s.storageAvailable}`);
  return createElement('i', null, `${preference}|${mode}|${custom}`);
}

test('hooks render on the server using the constant server snapshot (hydration-safe)', () => {
  assert.equal(renderToString(createElement(Probe)), '<i>light|light|light:true</i>');
});
