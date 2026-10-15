// RoleRow state machine: linked <-> custom <-> locked, built only from the WS1
// edit helpers so the locking guarantees (contract 1) hold by construction.
//
//   linked  = link 'auto' or a link spec; follows master / tint / another role
//   custom  = explicit value; ignores master moves
//   locked  = custom + locked; also protected from copy / reset-mode / suggestions

import {
  BASELINE_DEFINITION, copyMode, getRoleDef, linkModes, resetRole, setLocked, setRoleLink,
} from '../theme/index.js';

export function roleKind(state) {
  if (!state) return 'linked';
  if (state.locked) return 'locked';
  if (state.link === 'custom') return 'custom';
  return 'linked';
}

export const KIND_LABEL = Object.freeze({ linked: 'Linked', custom: 'Custom', locked: 'Locked' });

/** Status roles keep their meaning-bearing hue: only lightness and chroma are editable. */
export function isFixedMeaning(roleId) {
  const rd = getRoleDef(roleId);
  return !!rd && rd.group === 'status';
}

export function roleActions(state, roleId) {
  const kind = roleKind(state);
  return {
    kind,
    canMakeCustom: kind === 'linked',
    canTuneBase: kind === 'linked' && state.link === 'auto',
    canEditCustom: kind === 'custom' || kind === 'locked',
    canLock: kind !== 'locked',
    canUnlock: kind === 'locked',
    hueEditable: !isFixedMeaning(roleId),
    resetLabel: kind === 'linked' ? 'Reset' : 'Reset to linked',
  };
}

/** Does the role differ from its baseline state (is there anything to reset)? */
export function isResettable(def, mode, roleId) {
  const cur = def.modes[mode].roles[roleId];
  const base = BASELINE_DEFINITION.modes[mode].roles[roleId];
  return JSON.stringify(cur) !== JSON.stringify(base);
}

const other = (mode) => (mode === 'light' ? 'dark' : 'light');

/**
 * Pure transition. actions: make-custom | reset | lock | unlock | copy-to-other | link-to-other.
 * Returns the SAME definition when the action is not allowed or changes nothing.
 */
export function applyRoleAction(def, mode, roleId, action) {
  switch (action) {
    case 'make-custom': return setRoleLink(def, mode, roleId, 'custom');
    case 'reset': return resetRole(def, mode, roleId);
    case 'lock': return setLocked(def, mode, roleId, true);
    case 'unlock': return setLocked(def, mode, roleId, false);
    case 'copy-to-other': return copyMode(def, mode, other(mode), { roleIds: [roleId] });
    case 'link-to-other': return linkModes(def, other(mode), mode, [roleId]);
    default: return def;
  }
}
