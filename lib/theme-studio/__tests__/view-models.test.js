import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBaseline, buildReport, resolveTheme, resolveBoth, setLocked, setMasterHue, setRoleCustom, isRoleId, ROLE_IDS,
} from '../../theme/index.js';
import {
  modeStatus, presetLabel, a11yByRole, roleA11y, badgeFor, summarizeModeReport, filterResults, suggestionView,
  applySuggestion, filterRoleGroups, roleRowModel, groupLinkState, resetRoles, countLockedRoles, PALETTE_GROUPS,
} from '../view-models.js';
import { applyRoleAction } from '../role-state.js';
import { ROLE_DEFS } from '../../theme/index.js';

const def = () => createBaseline();

test('editing and previewing are separate, labelled statements', () => {
  const same = modeStatus('light', 'light');
  assert.equal(same.editing, 'Light palette');
  assert.equal(same.previewing, 'Light mode on this page');
  assert.equal(same.differs, false);
  const diff = modeStatus('dark', 'light');
  assert.equal(diff.differs, true);
  assert.match(diff.hint, /editing the dark palette while the page shows light/);
  assert.equal(modeStatus('light', null).previewing, 'Your own setting');
  assert.equal(modeStatus('light', 'system').previewing, 'System mode on this page');
  assert.equal(modeStatus('light', 'system').differs, false);
});

test('preset label: baseline / production / draft / imported', () => {
  const b = def();
  assert.equal(presetLabel({ draft: null, production: b }).key, 'none');
  assert.equal(presetLabel({ draft: b, production: b }).key, 'baseline');
  const edited = setMasterHue(b, 10);
  assert.equal(presetLabel({ draft: edited, production: b, origin: 'production' }).key, 'draft');
  assert.equal(presetLabel({ draft: edited, production: b, origin: 'imported' }).key, 'imported');
  const renamed = { ...b, meta: { ...b.meta, id: 'brand-v2' } };
  assert.equal(presetLabel({ draft: renamed, production: renamed }).key, 'production');
});

test('contrast results map onto roles, beside each row', () => {
  const rep = buildReport(def());
  const map = a11yByRole(rep.modes.light);
  const muted = roleA11y(map, 'text-muted');
  assert.equal(muted.status, 'advisory');
  assert.match(muted.text, /^Advisory 3\.30:1, needs 4\.5$/);
  const onSolid = roleA11y(map, 'on-solid');
  assert.equal(onSolid.status, 'fail');
  assert.match(onSolid.text, /^Fail 2\.21:1, needs 4\.5$/);
  assert.equal(roleA11y(map, 'text').status, 'pass');
  assert.equal(roleA11y(map, 'deco-1').status, 'none');
  assert.equal(roleA11y(new Map(), 'text').status, 'none');
  assert.equal(roleA11y(map, 'warning-solid').via, 'foreground');
  assert.equal(roleA11y(map, 'overlay').via, 'background');
  assert.equal(badgeFor({ pass: true, ratio: 7, min: 4.5, required: true }).text, 'Pass 7.00:1');
});

test('every badge states its meaning in text, not colour alone', () => {
  const rep = buildReport(def());
  const map = a11yByRole(rep.modes.light);
  for (const id of ROLE_IDS) {
    const a = roleA11y(map, id);
    assert.ok(a.text.length > 3, id);
    if (a.status === 'fail') assert.match(a.text, /^Fail/);
    if (a.status === 'advisory') assert.match(a.text, /^Advisory/);
  }
});

test('summaries and the failing-first filter', () => {
  const rep = buildReport(def());
  const s = summarizeModeReport(rep.modes.light);
  assert.equal(s.pass + s.fail + s.advisory, rep.modes.light.results.length);
  const failing = filterResults(rep.modes.light, 'failing');
  assert.ok(failing.every((r) => !r.pass));
  assert.equal(failing[0].required, true, 'required failures sort first');
  assert.equal(filterResults(rep.modes.light, 'all').length, rep.modes.light.results.length);
  assert.deepEqual(filterResults(null, 'all'), []);
});

test('suggestions: described, explicit, and never applied to locked roles', () => {
  const d0 = def();
  const rep = buildReport(d0);
  const res = rep.modes.light.results.find((r) => r.id === 'on-overlay@overlay');
  const view = suggestionView(res, d0, 'light');
  assert.equal(view.canApply, true);
  assert.match(view.text, /^Set on-overlay lightness to 0\.324 \(becomes 4\.58:1\)\.$/);
  assert.match(view.reason, /Custom/);

  const resolved = resolveTheme(d0, 'light');
  const d1 = applySuggestion(d0, resolved, 'light', res.suggestion);
  assert.equal(d1.modes.light.roles['on-overlay'].link, 'custom');
  const after = buildReport(d1).modes.light.results.find((r) => r.id === 'on-overlay@overlay');
  assert.equal(after.pass, true);

  const locked = setLocked(d0, 'light', 'on-overlay', true);
  assert.equal(applySuggestion(locked, resolveTheme(locked, 'light'), 'light', res.suggestion), locked, 'locked role untouched');
  const lv = suggestionView({ ...res, suggestion: { ...res.suggestion } }, locked, 'light');
  assert.equal(lv.canApply, false);
  assert.match(lv.reason, /on-overlay is locked/);
  assert.equal(applySuggestion(d0, resolved, 'light', { ...res.suggestion, blockedByLock: true }), d0);
  assert.equal(applySuggestion(d0, resolved, 'light', null), d0);
});

test('applying a suggestion never changes any other locked role', () => {
  let d = def();
  d = setLocked(d, 'light', 'accent', true);
  d = setLocked(d, 'light', 'page', true);
  const rep = buildReport(d);
  const resolved = resolveTheme(d, 'light');
  const lockedBefore = JSON.stringify(['accent', 'page'].map((id) => d.modes.light.roles[id]));
  for (const r of rep.modes.light.results) {
    if (!r.suggestion) continue;
    const next = applySuggestion(d, resolved, 'light', r.suggestion);
    assert.equal(JSON.stringify(['accent', 'page'].map((id) => next.modes.light.roles[id])), lockedBefore, r.id);
  }
});

test('a missing suggestion explains itself, including when a lock is involved', () => {
  const v = suggestionView({ id: 'x', fgLocked: false, bgLocked: false }, def(), 'light');
  assert.equal(v.has, false);
  assert.equal(v.canApply, false);
  assert.equal(v.reason, null);
  const lv = suggestionView({ id: 'x', fgLocked: true, bgLocked: false }, def(), 'light');
  assert.match(lv.reason, /locked/);
});

test('role filter groups: query, custom-only, failing-only', () => {
  const d0 = def();
  const map = a11yByRole(buildReport(d0).modes.light);
  const all = filterRoleGroups(d0, 'light', { query: '', onlyCustom: false, onlyFailing: false }, map);
  assert.equal(all.reduce((n, g) => n + g.roles.length, 0), ROLE_DEFS.length);
  const q = filterRoleGroups(d0, 'light', { query: 'accent', onlyCustom: false, onlyFailing: false }, map);
  assert.ok(q.length >= 1 && q.every((g) => g.roles.every((r) => r.id.includes('accent') || r.usage.toLowerCase().includes('accent'))));
  const custom = filterRoleGroups(d0, 'light', { query: '', onlyCustom: true, onlyFailing: false }, map);
  assert.ok(custom.every((g) => g.roles.every((r) => d0.modes.light.roles[r.id].link === 'custom')));
  const failing = filterRoleGroups(d0, 'light', { query: '', onlyCustom: false, onlyFailing: true }, map);
  const ids = failing.flatMap((g) => g.roles.map((r) => r.id));
  assert.ok(ids.includes('on-solid') && ids.includes('text-muted') && !ids.includes('text'));
});

test('role rows describe links and carry their resolved colour', () => {
  const d0 = def();
  const resolved = resolveTheme(d0, 'light');
  const map = a11yByRole(buildReport(d0).modes.light);
  const row = roleRowModel({ def: d0, resolved, mode: 'light', roleDef: ROLE_DEFS.find((r) => r.id === 'support-1'), a11yMap: map });
  assert.equal(row.kind, 'linked');
  assert.equal(row.kindLabel, 'Linked');
  assert.match(row.linkText, /follows master hue \+86/);
  assert.equal(row.hex, resolved.roles['support-1'].hex);
  assert.equal(row.otherMode, 'dark');
  const hov = roleRowModel({ def: d0, resolved, mode: 'light', roleDef: ROLE_DEFS.find((r) => r.id === 'accent-hover'), a11yMap: map });
  assert.match(hov.linkText, /linked to accent/);
  const danger = roleRowModel({ def: d0, resolved, mode: 'light', roleDef: ROLE_DEFS.find((r) => r.id === 'danger'), a11yMap: map });
  assert.equal(danger.fixedMeaning, true);
});

test('palette groups only reference real roles; group badges and group reset', () => {
  for (const g of PALETTE_GROUPS) for (const id of g.ids) assert.ok(isRoleId(id), id);
  const ids = PALETTE_GROUPS.find((g) => g.id === 'supporting').ids;
  let d = def();
  assert.equal(groupLinkState(d, 'light', ids).state, 'linked');
  assert.equal(groupLinkState(d, 'light', ids).resettable, false);
  d = setRoleCustom(d, 'light', 'support-1', { l: 0.6, c: 0.1, h: 10, a: 1 });
  const mixed = groupLinkState(d, 'light', ids);
  assert.equal(mixed.state, 'mixed');
  assert.match(mixed.label, /Mixed \(2 linked, 1 custom\)/);
  assert.equal(mixed.resettable, true);
  d = applyRoleAction(d, 'light', 'support-2', 'lock');
  const reset = resetRoles(d, 'light', ids);
  assert.equal(reset.modes.light.roles['support-1'].link, 'auto');
  assert.equal(reset.modes.light.roles['support-2'].locked, true, 'group reset skips locked roles');
  assert.equal(resetRoles(d, 'light', ids, { skipLocked: false }).modes.light.roles['support-2'].locked, undefined);
  assert.equal(countLockedRoles(d, 'light'), 1);
  assert.equal(countLockedRoles(d, 'dark'), 0);
  const allCustom = ids.reduce((acc, id) => setRoleCustom(acc, 'dark', id, { l: 0.7, c: 0.1, h: 0, a: 1 }), def());
  assert.equal(groupLinkState(allCustom, 'dark', ids).state, 'custom');
});

test('master hue moves never alter custom or locked roles seen through the view-model', () => {
  let d = setRoleCustom(def(), 'light', 'accent', { l: 0.7, c: 0.1, h: 10, a: 1 });
  d = setLocked(d, 'light', 'support-1', true);
  const moved = setMasterHue(d, 300);
  const a = resolveBoth(d).light.roles;
  const b = resolveBoth(moved).light.roles;
  assert.equal(a.accent.hex, b.accent.hex);
  assert.equal(a['support-1'].hex, b['support-1'].hex);
  assert.notEqual(a['accent-bright'].hex, b['accent-bright'].hex);
});

test('when a pair has a locked member the suggestion targets an unlocked role and says so', () => {
  const d0 = setLocked(def(), 'light', 'on-solid', true);
  const rep = buildReport(d0);
  const res = rep.modes.light.results.find((r) => r.id === 'on-solid@success-solid');
  const v = suggestionView(res, d0, 'light');
  assert.equal(res.fgLocked, true);
  assert.equal(v.role, 'success-solid');
  assert.equal(v.canApply, true);
  assert.match(v.reason, /locked role in this pair stays unchanged/);
  const next = applySuggestion(d0, resolveTheme(d0, 'light'), 'light', res.suggestion);
  assert.deepEqual(next.modes.light.roles['on-solid'], d0.modes.light.roles['on-solid']);
});
