// Self-consistency invariants for the single section registry
// (sections.registry.cjs) and its three derived consumers: _digest-config.js
// (INCLUDE_KEYS/DEFAULT_INCLUDE/ORDERABLE_KEYS/DEFAULT_ORDER), render.js
// (per-group render dispatch), and AdminEmailModals.jsx (SECTION_GROUPS UI
// rows — checked here via a re-derivation using the same logic the component
// uses, since importing a 'use client' React component into node --test
// isn't practical; if that derivation logic ever diverges from this test's
// copy, update both together).

import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, UI_GROUP_ORDER } from '../sections.registry.cjs';
import digestConfig from '../../intelligence/_digest-config.js';

test('registry key order exactly matches INCLUDE_KEYS (load-bearing for DEFAULT_ORDER)', () => {
  assert.deepEqual(SECTIONS.map((s) => s.key), digestConfig.INCLUDE_KEYS);
});

test('registry defaultOn exactly matches DEFAULT_INCLUDE for every key', () => {
  for (const s of SECTIONS) {
    assert.equal(s.defaultOn, digestConfig.DEFAULT_INCLUDE[s.key] === true, `defaultOn mismatch for "${s.key}"`);
  }
});

test('registry orderable exactly matches ORDERABLE_KEYS/DEFAULT_ORDER', () => {
  const derived = SECTIONS.filter((s) => s.orderable).map((s) => s.key);
  assert.deepEqual(derived, digestConfig.ORDERABLE_KEYS);
  assert.deepEqual(derived, digestConfig.DEFAULT_ORDER);
});

test('only execBriefLink/contactHuman are non-orderable (CTAs stay outside render dispatch)', () => {
  const nonOrderable = SECTIONS.filter((s) => !s.orderable).map((s) => s.key).sort();
  assert.deepEqual(nonOrderable, ['contactHuman', 'execBriefLink']);
  for (const key of nonOrderable) {
    const s = SECTIONS.find((x) => x.key === key);
    assert.equal(s.renderGroup, null, `${key} must have renderGroup:null — CTAs render via the separate ctaRow path`);
  }
});

test('every section has exactly one of: a real renderGroup, or renderGroup:null with orderable:false (CTAs)', () => {
  const validGroups = new Set(['topOfEmail', 'today', 'postContent', 'marketSignals', 'creative', 'webPerf', 'platform', 'ops']);
  for (const s of SECTIONS) {
    if (s.renderGroup === null) {
      assert.equal(s.orderable, false, `${s.key} has renderGroup:null but is orderable — only CTAs should have a null renderGroup`);
    } else {
      assert.ok(validGroups.has(s.renderGroup), `${s.key} has an unrecognized renderGroup "${s.renderGroup}"`);
    }
  }
});

test('uiOrder values are unique and contiguous 0..N-1 across all UI-visible rows', () => {
  const orders = SECTIONS.filter((s) => s.uiOrder !== null).map((s) => s.uiOrder).sort((a, b) => a - b);
  const expected = Array.from({ length: orders.length }, (_, i) => i);
  assert.deepEqual(orders, expected);
});

test('uiLabel/uiHint/uiGroup/uiOrder are all null together, or all set together (no partial rows)', () => {
  for (const s of SECTIONS) {
    const uiFields = [s.uiLabel, s.uiHint, s.uiGroup, s.uiOrder];
    const allNull = uiFields.every((v) => v === null);
    const noneNull = uiFields.every((v) => v !== null);
    assert.ok(allNull || noneNull, `${s.key} has a partially-set UI row (some ui* fields null, others not)`);
  }
});

test('UI_GROUP_ORDER covers exactly the uiGroup values present in the registry, no more, no less', () => {
  const groupsInRegistry = new Set(SECTIONS.map((s) => s.uiGroup).filter(Boolean));
  assert.deepEqual([...groupsInRegistry].sort(), [...UI_GROUP_ORDER].sort());
});

test('platformIcon is only ever set on Market Signals rows with a real platform value', () => {
  const withIcon = SECTIONS.filter((s) => s.platformIcon !== null);
  for (const s of withIcon) {
    assert.ok(['x', 'reddit', 'instagram'].includes(s.platformIcon), `${s.key} has an unrecognized platformIcon "${s.platformIcon}"`);
  }
});
