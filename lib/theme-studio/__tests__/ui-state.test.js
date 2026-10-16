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

// --- Studio v2 / P2: Full range + colour picker ---------------------------
import { COLOR_PICKER_POPOVER, isColorPickerOpen } from '../ui-state.js';

test('full range defaults off, toggles, and no-ops keep identity', () => {
  let s = initialUiState();
  assert.equal(s.fullRange, false);
  s = uiReducer(s, { type: 'fullRange/set', value: true });
  assert.equal(s.fullRange, true);
  assert.equal(uiReducer(s, { type: 'fullRange/set', value: true }), s);
  s = uiReducer(s, { type: 'fullRange/set' });
  assert.equal(s.fullRange, false);
  assert.equal(initialUiState({ fullRange: true }).fullRange, true);
});

test('colour picker opens through the shared popover stack so Escape closes it', () => {
  let s = initialUiState();
  s = uiReducer(s, { type: 'colorPicker/open', roleId: 'accent', mode: 'light' });
  assert.equal(topPopover(s), COLOR_PICKER_POPOVER);
  assert.equal(isColorPickerOpen(s, 'accent', 'light'), true);
  assert.equal(isColorPickerOpen(s, 'accent', 'dark'), false);
  assert.equal(uiReducer(s, { type: 'colorPicker/open', roleId: 'accent', mode: 'light' }), s);
  const escaped = uiReducer(s, { type: 'popover/closeTop' });
  assert.equal(isColorPickerOpen(escaped, 'accent', 'light'), false);
  const closed = uiReducer(s, { type: 'colorPicker/close' });
  assert.equal(closed.colorPicker, null);
  assert.equal(closed.popovers.includes(COLOR_PICKER_POPOVER), false);
  assert.equal(uiReducer(closed, { type: 'colorPicker/close' }), closed);
  // switching roles keeps a single popover entry
  const moved = uiReducer(s, { type: 'colorPicker/open', roleId: 'text', mode: 'light' });
  assert.equal(moved.popovers.filter((p) => p === COLOR_PICKER_POPOVER).length, 1);
  assert.equal(isColorPickerOpen(moved, 'text', 'light'), true);
});
