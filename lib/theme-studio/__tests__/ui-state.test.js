import test from 'node:test';
import assert from 'node:assert/strict';
import { initialUiState, uiReducer, topPopover } from '../ui-state.js';

test('sections and groups toggle, and no-ops keep identity', () => {
  let s = initialUiState();
  assert.equal(s.openSections.palette, false);
  s = uiReducer(s, { type: 'section/toggle', id: 'palette' });
  assert.equal(s.openSections.palette, true);
  const same = uiReducer(s, { type: 'section/toggle', id: 'palette', open: true });
  assert.equal(same, s);
  assert.equal(uiReducer(s, { type: 'unknown' }), s);
});

test('Escape order: popovers close top-first', () => {
  let s = initialUiState();
  s = uiReducer(s, { type: 'popover/open', id: 'confirm-reset-draft' });
  s = uiReducer(s, { type: 'popover/open', id: 'confirm-copy' });
  assert.equal(topPopover(s), 'confirm-copy');
  s = uiReducer(s, { type: 'popover/closeTop' });
  assert.equal(topPopover(s), 'confirm-reset-draft');
  s = uiReducer(s, { type: 'popover/closeTop' });
  assert.equal(topPopover(s), null);
  assert.equal(uiReducer(s, { type: 'popover/closeTop' }), s);
  assert.equal(uiReducer(s, { type: 'popover/close', id: 'nope' }), s);
});

test('revealing a role opens advanced, its group and the row, and clears the search', () => {
  let s = initialUiState();
  s = uiReducer(s, { type: 'filter/set', patch: { query: 'xyz' } });
  s = uiReducer(s, { type: 'role/reveal', id: 'accent', group: 'accent' });
  assert.equal(s.openSections.advanced, true);
  assert.equal(s.openGroups.accent, true);
  assert.equal(s.expandedRoles.accent, true);
  assert.equal(s.focusRole, 'accent');
  assert.equal(s.roleFilter.query, '');
  s = uiReducer(s, { type: 'role/focused' });
  assert.equal(s.focusRole, null);
});

test('import text edit clears the previous result', () => {
  let s = initialUiState();
  s = uiReducer(s, { type: 'import/result', result: { ok: true } });
  s = uiReducer(s, { type: 'import/text', text: '{}' });
  assert.equal(s.importResult, null);
  assert.equal(s.importText, '{}');
});
