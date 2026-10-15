import test from 'node:test';
import assert from 'node:assert/strict';
import { createBaseline, resolveTheme, setRoleCustom, setMasterHue } from '../../theme/index.js';
import {
  roleKind, roleActions, applyRoleAction, isResettable, isFixedMeaning, KIND_LABEL,
} from '../role-state.js';

const base = () => createBaseline();
const state = (d, id, mode = 'light') => d.modes[mode].roles[id];

test('kinds map from the definition', () => {
  const d = base();
  assert.equal(roleKind(state(d, 'accent')), 'linked');
  assert.equal(roleKind(state(d, 'accent-hover')), 'linked');
  assert.equal(roleKind(state(d, 'dash-accent')), 'custom');
  assert.equal(KIND_LABEL.locked, 'Locked');
});

test('linked -> custom keeps the visible colour (no jump), then ignores master moves', () => {
  const d0 = base();
  const before = resolveTheme(d0, 'light').roles.accent.hex;
  const d1 = applyRoleAction(d0, 'light', 'accent', 'make-custom');
  assert.equal(roleKind(state(d1, 'accent')), 'custom');
  assert.equal(resolveTheme(d1, 'light').roles.accent.hex, before);
  const d2 = setMasterHue(d1, 20);
  assert.equal(resolveTheme(d2, 'light').roles.accent.hex, before);
  assert.notEqual(resolveTheme(d2, 'light').roles['support-1'].hex, resolveTheme(d1, 'light').roles['support-1'].hex);
});

test('custom -> locked -> unlock, and reset returns to linked', () => {
  let d = applyRoleAction(base(), 'light', 'accent', 'make-custom');
  d = applyRoleAction(d, 'light', 'accent', 'lock');
  assert.equal(roleKind(state(d, 'accent')), 'locked');
  assert.equal(applyRoleAction(d, 'light', 'accent', 'make-custom'), d, 'locked stays custom');
  d = applyRoleAction(d, 'light', 'accent', 'unlock');
  assert.equal(roleKind(state(d, 'accent')), 'custom');
  d = applyRoleAction(d, 'light', 'accent', 'reset');
  assert.equal(roleKind(state(d, 'accent')), 'linked');
  assert.equal(isResettable(d, 'light', 'accent'), false);
});

test('locking a linked role freezes it as custom first; locked reset is an explicit unlock', () => {
  let d = applyRoleAction(base(), 'dark', 'support-1', 'lock');
  assert.equal(roleKind(state(d, 'support-1', 'dark')), 'locked');
  assert.equal(state(d, 'support-1', 'dark').link, 'custom');
  d = applyRoleAction(d, 'dark', 'support-1', 'reset');
  assert.equal(roleKind(state(d, 'support-1', 'dark')), 'linked');
});

test('actions available per kind', () => {
  const d = applyRoleAction(base(), 'light', 'accent', 'make-custom');
  assert.deepEqual(
    [roleActions(state(base(), 'accent'), 'accent').canMakeCustom, roleActions(state(base(), 'accent'), 'accent').canTuneBase],
    [true, true],
  );
  assert.equal(roleActions(state(base(), 'accent-hover'), 'accent-hover').canTuneBase, false, 'link specs are not tuned in place');
  const c = roleActions(state(d, 'accent'), 'accent');
  assert.deepEqual([c.canMakeCustom, c.canEditCustom, c.canLock, c.canUnlock], [false, true, true, false]);
  const l = roleActions(state(applyRoleAction(d, 'light', 'accent', 'lock'), 'accent'), 'accent');
  assert.deepEqual([l.canLock, l.canUnlock, l.canEditCustom], [false, true, true]);
  assert.equal(roleActions(state(base(), 'accent'), 'accent').resetLabel, 'Reset');
  assert.equal(c.resetLabel, 'Reset to linked');
});

test('status roles are locked by meaning: hue not editable', () => {
  assert.equal(isFixedMeaning('danger'), true);
  assert.equal(isFixedMeaning('accent'), false);
  assert.equal(roleActions(state(base(), 'danger'), 'danger').hueEditable, false);
  assert.equal(roleActions(state(base(), 'accent'), 'accent').hueEditable, true);
});

test('copy and link to the other mode; copy skips a locked destination', () => {
  let d = setRoleCustom(base(), 'light', 'support-2', { l: 0.6, c: 0.1, h: 30, a: 1 });
  const copied = applyRoleAction(d, 'light', 'support-2', 'copy-to-other');
  assert.deepEqual(state(copied, 'support-2', 'dark').custom, { l: 0.6, c: 0.1, h: 30, a: 1 });
  const lockedDark = applyRoleAction(d, 'dark', 'support-2', 'lock');
  const skipped = applyRoleAction(lockedDark, 'light', 'support-2', 'copy-to-other');
  assert.equal(state(skipped, 'support-2', 'dark').locked, true);
  assert.deepEqual(state(skipped, 'support-2', 'dark'), state(lockedDark, 'support-2', 'dark'));
  const linked = applyRoleAction(base(), 'dark', 'accent', 'link-to-other');
  assert.deepEqual(state(linked, 'accent', 'dark').link, { to: 'accent', mode: 'light' });
  assert.equal(applyRoleAction(d, 'light', 'accent', 'bogus'), d);
});
