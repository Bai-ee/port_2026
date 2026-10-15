'use client';

import React, { useMemo } from 'react';
import Section from '../controls/Section.jsx';
import RoleRow from '../controls/RoleRow.jsx';
import ModeSwitch from '../controls/ModeSwitch.jsx';
import { Toggle, Check } from '../controls/Toggle.jsx';
import Icon from '../Icon.jsx';
import {
  useStudio, useDraft, useEditingMode, useResolvedPair, useReport,
} from '../StudioContext.jsx';
import { setFeatures, setViewerPreference } from '../../../lib/theme/index.js';
import {
  a11yByRole, filterRoleGroups, roleRowModel, MODE_LABEL,
} from '../../../lib/theme-studio/view-models.js';

export default function AdvancedSection() {
  const { ui, dispatch, edit } = useStudio();
  const draft = useDraft();
  const mode = useEditingMode();
  const pair = useResolvedPair();
  const report = useReport();

  const a11yMap = useMemo(() => a11yByRole(report && report.modes[mode]), [report, mode]);
  const groups = useMemo(
    () => (draft ? filterRoleGroups(draft, mode, ui.roleFilter, a11yMap) : []),
    [draft, mode, ui.roleFilter, a11yMap],
  );
  if (!draft || !pair) return null;
  const resolved = pair[mode];
  const other = mode === 'light' ? 'dark' : 'light';
  const filtering = !!(ui.roleFilter.query || ui.roleFilter.onlyCustom || ui.roleFilter.onlyFailing);
  const total = groups.reduce((n, g) => n + g.roles.length, 0);

  return (
    <Section id="advanced" num="05" title="Advanced roles" summary={`${MODE_LABEL[mode]}, ${total} roles`}>
      <div className="ts-stack" id="theme-studio-features-block">
        <p className="ts-sub">Features</p>
        <Toggle
          id="theme-studio-feature-focus-ring"
          label="Visible keyboard focus ring"
          description="Adds a 2px outline in the focus color to anything focused by keyboard. Changes how the whole site looks when tabbing; an owner decision."
          checked={draft.features.focusRing}
          onChange={(v) => edit((d) => setFeatures(d, { focusRing: v }), { kind: 'set', label: 'Focus ring feature' })}
        />
        <Toggle
          id="theme-studio-feature-selection"
          label="Themed text selection"
          description="Selected text uses the selection colors instead of the browser default."
          checked={draft.features.selection}
          onChange={(v) => edit((d) => setFeatures(d, { selection: v }), { kind: 'set', label: 'Selection feature' })}
        />
        <div className="ts-field">
          <span className="ts-label" id="theme-studio-viewer-pref-label">Default for new visitors</span>
          <ModeSwitch
            id="theme-studio-viewer-pref"
            label="Default viewer preference"
            value={draft.defaults.viewerPreference}
            block
            onChange={(v) => edit((d) => setViewerPreference(d, v), { kind: 'set', label: 'Default viewer preference' })}
            options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]}
          />
          <p className="ts-hint">Baseline is Light because the site is light only today. Review the Dark palette before changing this.</p>
        </div>
      </div>

      <div className="ts-filterbar" id="theme-studio-role-filterbar">
        <p className="ts-sub">{MODE_LABEL[mode]} palette roles</p>
        <label className="ts-label" htmlFor="theme-studio-role-search">Find a role</label>
        <input
          id="theme-studio-role-search"
          type="search"
          className="ts-input"
          placeholder="Name or usage, for example border"
          autoComplete="off"
          value={ui.roleFilter.query}
          onChange={(e) => dispatch({ type: 'filter/set', patch: { query: e.target.value } })}
        />
        <div className="ts-filterbar-row">
          <Check id="theme-studio-filter-custom" label="Custom or locked only" checked={ui.roleFilter.onlyCustom} onChange={(v) => dispatch({ type: 'filter/set', patch: { onlyCustom: v } })} />
          <Check id="theme-studio-filter-failing" label="With contrast findings" checked={ui.roleFilter.onlyFailing} onChange={(v) => dispatch({ type: 'filter/set', patch: { onlyFailing: v } })} />
        </div>
        <p className="ts-hint" aria-live="polite">
          {filtering ? `${total} ${total === 1 ? 'role matches' : 'roles match'}.` : 'Rows show the color in this palette and, smaller, in the other one.'}
        </p>
      </div>

      <div className="ts-stack" id="theme-studio-role-groups">
        {groups.map((g) => {
          const open = filtering || !!ui.openGroups[g.id];
          return (
            <div key={g.id} id={`theme-studio-group-${g.id}`}>
              <button
                type="button"
                className="ts-group-head"
                aria-expanded={open ? 'true' : 'false'}
                aria-controls={`theme-studio-group-${g.id}-list`}
                onClick={() => dispatch({ type: 'group/toggle', id: g.id, open: !open })}
              >
                <Icon name="chevron" className="ts-chev" />
                {g.label}
                <span className="ts-group-count">{g.roles.length}</span>
              </button>
              {open ? (
                <ul className="ts-role-list" id={`theme-studio-group-${g.id}-list`} style={{ marginTop: 8 }}>
                  {g.roles.map((rd) => (
                    <RoleRow
                      key={rd.id}
                      row={roleRowModel({ def: draft, resolved, mode, roleDef: rd, a11yMap })}
                      def={draft}
                      mode={mode}
                      resolvedMode={resolved}
                      resolvedOther={pair[other]}
                      a11yEntry={a11yMap.get(rd.id)}
                      expanded={!!ui.expandedRoles[rd.id]}
                      autoFocus={ui.focusRole === rd.id}
                      onToggle={() => dispatch({ type: 'role/toggle', id: rd.id })}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
        {groups.length === 0 ? <p className="ts-p">No roles match. Clear the filters to see all of them.</p> : null}
      </div>
    </Section>
  );
}
