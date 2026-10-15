// View-models: everything the Studio shows, derived from a definition, its
// resolved themes and the report. Pure, so it is unit-tested without React.

import {
  GROUPS, ROLE_DEFS, describeLink, hashDefinition, resetRole, setRoleCustom,
} from '../theme/index.js';
import { roleKind, KIND_LABEL, isFixedMeaning, isResettable } from './role-state.js';
import { formatRatio, signedNumber, formatNumber } from './format.js';

export const MODE_LABEL = Object.freeze({ light: 'Light', dark: 'Dark' });
export const PREVIEW_LABEL = Object.freeze({ light: 'Light', dark: 'Dark', system: 'System' });

// Roles grouped the way a designer thinks about them (Palette section).
export const PALETTE_GROUPS = Object.freeze([
  { id: 'accent', label: 'Accent', note: 'Follows the master hue.', ids: ['accent', 'accent-hover', 'accent-pressed', 'accent-soft', 'accent-soft-border', 'accent-text'] },
  { id: 'supporting', label: 'Supporting', note: 'Spread around the master hue by the offsets below.', ids: ['accent-bright', 'support-1', 'support-2'] },
  { id: 'neutral', label: 'Neutral tint', note: 'Page, surfaces and ink carry a slight warm tint.', ids: ['page', 'surface', 'raised', 'inset', 'text-default', 'text-strong', 'text-body', 'text', 'text-eyebrow'] },
]);

// ---------- editing vs previewing ----------

export function modeStatus(editingMode, previewMode) {
  const editing = `${MODE_LABEL[editingMode] || 'Light'} palette`;
  let previewing;
  if (previewMode === 'light' || previewMode === 'dark') previewing = `${MODE_LABEL[previewMode]} mode on this page`;
  else if (previewMode === 'system') previewing = 'System mode on this page';
  else previewing = 'Your own setting';
  const differs = previewMode === 'light' || previewMode === 'dark' ? previewMode !== editingMode : false;
  return {
    editing,
    previewing,
    differs,
    hint: differs
      ? `You are editing the ${editingMode} palette while the page shows ${previewMode}. Changes will not be visible here until you switch.`
      : 'The controls write to the palette named under Editing. Previewing only changes what this page shows.',
  };
}

// ---------- preset / origin ----------

export function presetLabel({ draft, production, origin }) {
  if (!draft) return { key: 'none', label: 'No draft yet', detail: 'Start from the production theme.' };
  const same = production && hashDefinition(draft) === hashDefinition(production);
  if (same) {
    return draft.meta.id === 'baseline'
      ? { key: 'baseline', label: 'Baseline', detail: 'Identical to the production default.' }
      : { key: 'production', label: 'Production default', detail: 'Identical to what visitors see.' };
  }
  if (origin === 'imported') return { key: 'imported', label: 'Imported', detail: 'Loaded from a theme file; edits are yours.' };
  return { key: 'draft', label: 'Draft', detail: 'Differs from the production default.' };
}

// ---------- accessibility results, per role ----------

/** Map roleId -> { fg: result[], bg: result[] } for one mode's contrast report. */
export function a11yByRole(modeReport) {
  const map = new Map();
  const add = (id, slot, r) => {
    let e = map.get(id);
    if (!e) { e = { fg: [], bg: [] }; map.set(id, e); }
    e[slot].push(r);
  };
  if (!modeReport) return map;
  for (const r of modeReport.results) {
    add(r.fg, 'fg', r);
    for (const b of r.bg) add(b, 'bg', r);
  }
  return map;
}

const severity = (r) => (r.pass ? 0 : r.required ? 2 : 1);
const margin = (r) => r.ratio / r.min;

/**
 * The single badge for a role row: the worst result where the role is the
 * foreground (text color), else where it is a background. Always carries text.
 */
export function roleA11y(map, roleId) {
  const e = map.get(roleId);
  if (!e) return { status: 'none', text: 'No contrast check', ratio: null, min: null, via: null, failing: 0 };
  const pool = e.fg.length ? e.fg : e.bg;
  const via = e.fg.length ? 'foreground' : 'background';
  const worst = [...pool].sort((a, b) => severity(b) - severity(a) || margin(a) - margin(b))[0];
  const failing = pool.filter((r) => !r.pass).length;
  return { ...badgeFor(worst), via, failing, result: worst };
}

export function badgeFor(r) {
  const ratio = formatRatio(r.ratio);
  const min = r.min === 4.5 ? '4.5' : '3';
  if (r.pass) return { status: 'pass', text: `Pass ${ratio}`, ratio: r.ratio, min: r.min };
  if (r.required) return { status: 'fail', text: `Fail ${ratio}, needs ${min}`, ratio: r.ratio, min: r.min };
  return { status: 'advisory', text: `Advisory ${ratio}, needs ${min}`, ratio: r.ratio, min: r.min };
}

export function summarizeModeReport(modeReport) {
  const out = { pass: 0, fail: 0, advisory: 0, excluded: modeReport ? modeReport.excluded.length : 0 };
  if (!modeReport) return out;
  for (const r of modeReport.results) {
    if (r.pass) out.pass += 1;
    else if (r.required) out.fail += 1;
    else out.advisory += 1;
  }
  return out;
}

export function filterResults(modeReport, filter) {
  if (!modeReport) return [];
  const rows = filter === 'all' ? modeReport.results : modeReport.results.filter((r) => !r.pass);
  return [...rows].sort((a, b) => severity(b) - severity(a) || margin(a) - margin(b));
}

// ---------- suggestions ----------

export function suggestionView(result, def, mode) {
  const s = result && result.suggestion;
  if (!s) {
    const lockedInvolved = !!(result && (result.fgLocked || result.bgLocked));
    return {
      has: false,
      canApply: false,
      text: 'No automatic suggestion. Adjust the colors by hand.',
      reason: lockedInvolved ? 'A locked role is involved; locked roles are never changed automatically.' : null,
    };
  }
  const role = def.modes[mode].roles[s.role];
  const locked = !!(s.blockedByLock || (role && role.locked));
  const bits = [];
  if (s.set.l !== undefined) bits.push(`lightness to ${formatNumber(s.set.l, 3)}`);
  if (s.set.c !== undefined) bits.push(`chroma to ${formatNumber(s.set.c, 3)}`);
  if (s.set.a !== undefined) bits.push(`opacity to ${formatNumber(s.set.a, 3)}`);
  return {
    has: true,
    role: s.role,
    set: s.set,
    canApply: !locked,
    text: `Set ${s.role} ${bits.join(' and ')} (becomes ${formatRatio(s.resultingRatio)}).`,
    reason: locked
      ? `Suggestion not applied: ${s.role} is locked.`
      : (result.fgLocked || result.bgLocked)
        ? `A locked role in this pair stays unchanged; this changes ${s.role} instead and makes it Custom.`
        : 'Applying makes this role Custom, so it stops following the master hue.',
  };
}

/**
 * Apply a suggestion as an explicit user action. The role becomes Custom with
 * the suggested values. Locked roles are NEVER touched: the same definition is returned.
 */
export function applySuggestion(def, resolvedMode, mode, suggestion) {
  if (!suggestion || !suggestion.role || suggestion.blockedByLock) return def;
  const role = def.modes[mode].roles[suggestion.role];
  const cur = resolvedMode && resolvedMode.roles[suggestion.role];
  if (!role || role.locked || !cur) return def;
  const set = suggestion.set || {};
  return setRoleCustom(def, mode, suggestion.role, {
    l: set.l !== undefined ? set.l : cur.oklch.l,
    c: set.c !== undefined ? set.c : cur.oklch.c,
    h: cur.oklch.h,
    a: set.a !== undefined ? set.a : cur.oklch.a,
  });
}

// ---------- role rows (Advanced) ----------

const DEFS_BY_GROUP = GROUPS.map((g) => ({ ...g, roles: ROLE_DEFS.filter((d) => d.group === g.id) }));

/** Groups with their roles after the text / custom / failing filters. */
export function filterRoleGroups(def, mode, filter, a11yMap) {
  const q = String(filter.query || '').trim().toLowerCase();
  return DEFS_BY_GROUP.map((g) => ({
    ...g,
    roles: g.roles.filter((rd) => {
      if (q && !(rd.id.includes(q) || rd.usage.toLowerCase().includes(q))) return false;
      const state = def.modes[mode].roles[rd.id];
      if (filter.onlyCustom && roleKind(state) === 'linked') return false;
      if (filter.onlyFailing) {
        const a = roleA11y(a11yMap, rd.id);
        if (a.status !== 'fail' && a.status !== 'advisory') return false;
      }
      return true;
    }),
  })).filter((g) => g.roles.length > 0);
}

export function roleRowModel({
  def, resolved, mode, roleDef, a11yMap,
}) {
  const state = def.modes[mode].roles[roleDef.id];
  const r = resolved.roles[roleDef.id];
  const kind = roleKind(state);
  const other = mode === 'light' ? 'dark' : 'light';
  return {
    id: roleDef.id,
    css: roleDef.css,
    usage: roleDef.usage,
    group: roleDef.group,
    kind,
    kindLabel: KIND_LABEL[kind],
    linkText: kind === 'linked' ? describeLink(def, mode, roleDef.id) : null,
    fixedMeaning: isFixedMeaning(roleDef.id),
    resettable: isResettable(def, mode, roleDef.id),
    hex: r.hex,
    value: r.value,
    oklch: r.oklch,
    alpha: r.oklch.a,
    mapped: r.gamut.mapped,
    base: state.base,
    otherMode: other,
    a11y: roleA11y(a11yMap, roleDef.id),
  };
}

// ---------- palette group badge ----------

export function groupLinkState(def, mode, ids) {
  const counts = { linked: 0, custom: 0, locked: 0 };
  for (const id of ids) counts[roleKind(def.modes[mode].roles[id])] += 1;
  const total = ids.length;
  let state = 'mixed';
  if (counts.linked === total) state = 'linked';
  else if (counts.custom === total) state = 'custom';
  else if (counts.locked === total) state = 'locked';
  const label = state === 'mixed'
    ? `Mixed (${counts.linked} linked, ${counts.custom + counts.locked} custom)`
    : KIND_LABEL[state];
  return { state, label, counts, resettable: ids.some((id) => isResettable(def, mode, id)) };
}

/** Reset several roles to the baseline. Locked roles are skipped unless told otherwise. */
export function resetRoles(def, mode, ids, { skipLocked = true } = {}) {
  let out = def;
  for (const id of ids) {
    if (skipLocked && out.modes[mode].roles[id].locked) continue;
    out = resetRole(out, mode, id);
  }
  return out;
}

export function countLockedRoles(def, mode) {
  let n = 0;
  for (const rd of ROLE_DEFS) if (def.modes[mode].roles[rd.id].locked) n += 1;
  return n;
}

// ---------- small strings ----------

export function offsetLabel(key) {
  return { accentBright: 'Bright accent offset', support1: 'Supporting 1 offset', support2: 'Supporting 2 offset' }[key] || key;
}

export function neutralHueLabel(hueSource) {
  return hueSource === 'master' ? 'Tint hue offset from master' : 'Tint hue';
}

export function describeScenePreview(scene) {
  if (!scene) return '';
  return `${scene.source === 'custom' ? 'Custom palette' : 'Follows theme'}; ${signedNumber(scene.hueShift * 360, 0)} degrees of hue shift.`;
}
