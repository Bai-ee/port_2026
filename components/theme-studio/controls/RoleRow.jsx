'use client';

import React, { useEffect, useRef } from 'react';
import Icon from '../Icon.jsx';
import Swatch from './Swatch.jsx';
import LabeledSlider from './LabeledSlider.jsx';
import OklchEditor from './OklchEditor.jsx';
import LinkToggle, { KindBadge } from './LinkToggle.jsx';
import A11yResultItem from './A11yResultItem.jsx';
import { roleActions, applyRoleAction } from '../../../lib/theme-studio/role-state.js';
import { editRoleHex, editRoleOklch } from '../../../lib/theme-studio/color-fields.js';
import { setRoleBase, setRoleLink } from '../../../lib/theme/index.js';
import { useStudio } from '../StudioContext.jsx';

const PRIOR = { light: 'dark', dark: 'light' };

function A11yBadge({ a11y }) {
  const icon = a11y.status === 'pass' ? 'circleCheck' : a11y.status === 'fail' ? 'circleX' : a11y.status === 'advisory' ? 'alert' : null;
  return (
    <span className={`ts-badge ts-badge--${a11y.status}`}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {a11y.text}
    </span>
  );
}

function RoleEditor({
  row, def, mode, resolvedMode, resolvedOther, a11yEntry,
}) {
  const { edit, endEdit, announce } = useStudio();
  const id = row.id;
  const idBase = `theme-studio-role-${id}`;
  const state = def.modes[mode].roles[id];
  const acts = roleActions(state, id);
  const other = PRIOR[mode];
  const cur = row.oklch;
  const isAlpha = cur.a < 1 || state.base.a < 1;

  const doAction = (action) => {
    edit((d) => applyRoleAction(d, mode, id, action), { kind: 'set', label: `${id}: ${action}` });
    const msg = {
      'make-custom': `${id} is now custom.`,
      reset: `${id} reset.`,
      lock: `${id} locked.`,
      unlock: `${id} unlocked.`,
      'copy-to-other': `${id} copied to the ${other} palette.`,
      'link-to-other': `${id} in the ${mode} palette now follows the ${other} palette.`,
    }[action];
    if (msg) announce(msg);
  };

  let tuning = null;
  if (acts.kind === 'linked' && state.link === 'auto') {
    tuning = (
      <div className="ts-stack">
        <p className="ts-sub">Authored values</p>
        <p className="ts-hint">These stay linked. Hue still follows the rule above.</p>
        <LabeledSlider
          id={`${idBase}-base-l`}
          label="Lightness"
          value={state.base.l}
          min={0}
          max={1}
          step={0.005}
          page={0.05}
          onValue={(v, kind) => edit((d) => setRoleBase(d, mode, id, { l: v }), { kind, label: `${id} lightness`, coalesceKey: `${id}-l` })}
          onEnd={endEdit}
        />
        <LabeledSlider
          id={`${idBase}-base-c`}
          label="Chroma"
          value={state.base.c}
          min={0}
          max={0.4}
          step={0.005}
          page={0.04}
          onValue={(v, kind) => edit((d) => setRoleBase(d, mode, id, { c: v }), { kind, label: `${id} chroma`, coalesceKey: `${id}-c` })}
          onEnd={endEdit}
        />
        {state.base.a < 1 ? (
          <LabeledSlider
            id={`${idBase}-base-a`}
            label="Opacity"
            value={state.base.a}
            min={0}
            max={1}
            step={0.01}
            page={0.1}
            onValue={(v, kind) => edit((d) => setRoleBase(d, mode, id, { a: v }), { kind, label: `${id} opacity`, coalesceKey: `${id}-a` })}
            onEnd={endEdit}
          />
        ) : null}
      </div>
    );
  } else if (acts.kind === 'linked') {
    const spec = state.link;
    const fields = [
      ['dL', 'Lightness offset', -0.3, 0.3, 0.005],
      ['dC', 'Chroma offset', -0.2, 0.2, 0.005],
      ['a', 'Opacity', 0, 1, 0.01],
    ].filter(([k]) => spec[k] !== undefined);
    tuning = fields.length ? (
      <div className="ts-stack">
        <p className="ts-sub">Link settings</p>
        {fields.map(([k, lbl, min, max, step]) => (
          <LabeledSlider
            key={k}
            id={`${idBase}-link-${k}`}
            label={lbl}
            value={spec[k]}
            min={min}
            max={max}
            step={step}
            page={step * 10}
            onValue={(v, kind) => edit((d) => setRoleLink(d, mode, id, { ...d.modes[mode].roles[id].link, [k]: v }), { kind, label: `${id} ${lbl}`, coalesceKey: `${id}-${k}` })}
            onEnd={endEdit}
          />
        ))}
      </div>
    ) : null;
  } else {
    const custom = state.custom;
    tuning = (
      <div className="ts-stack">
        <p className="ts-sub">{acts.kind === 'locked' ? 'Locked value' : 'Custom value'}</p>
        <OklchEditor
          idBase={idBase}
          label={id}
          value={custom}
          hex={row.hex}
          showAlpha={isAlpha}
          hueDisabled={!acts.hueEditable}
          hueNote="Hue is fixed so this color keeps its meaning. Adjust lightness and chroma."
          onPatch={(patch, kind) => edit((d) => editRoleOklch(d, mode, id, patch, d.modes[mode].roles[id].custom || cur), { kind, label: `${id} color`, coalesceKey: `${id}-oklch` })}
          onHex={(hex) => edit((d) => editRoleHex(d, mode, id, hex, d.modes[mode].roles[id].custom || cur), { kind: 'set', label: `${id} hex` })}
          onEnd={endEdit}
        />
      </div>
    );
  }

  const results = a11yEntry ? [...a11yEntry.fg, ...a11yEntry.bg] : [];

  return (
    <div className="ts-role-editor" id={`${idBase}-editor`}>
      <p className="ts-hint">
        {row.linkText
          ? <><strong>{row.linkText.charAt(0).toUpperCase() + row.linkText.slice(1)}.</strong></>
          : acts.kind === 'locked'
            ? <><strong>Locked.</strong> Master moves, copy, reset palette and contrast suggestions leave this color alone.</>
            : <><strong>Custom.</strong> Master hue, intensity and tint no longer change this color.</>}
        {' '}
        {row.usage}.
      </p>
      <LinkToggle actions={acts} resettable={row.resettable} otherMode={other} onAction={doAction} idBase={idBase} />
      {tuning}
      {row.mapped ? (
        <p className="ts-hint">This color was reduced slightly to fit the sRGB screen gamut.</p>
      ) : null}
      {resolvedOther ? (
        <p className="ts-hint">
          {other === 'dark' ? 'Dark' : 'Light'} palette value:
          {' '}
          <code className="ts-code">{resolvedOther.roles[id].hex}</code>
          {resolvedOther.roles[id].oklch.a < 1 ? <> at {Math.round(resolvedOther.roles[id].oklch.a * 100)}% opacity</> : null}
        </p>
      ) : null}
      {results.length ? (
        <div className="ts-stack">
          <p className="ts-sub">Accessibility results</p>
          <ul className="ts-results">
            {results.slice(0, 6).map((r) => (
              <A11yResultItem key={r.id} result={r} def={def} mode={mode} resolvedMode={resolvedMode} compact />
            ))}
          </ul>
          {results.length > 6 ? <p className="ts-hint">{results.length - 6} more in the Accessibility section.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** One role: collapsed summary (swatch, token, state, contrast badge) that opens an editor. */
export default function RoleRow({
  row, def, mode, resolvedMode, resolvedOther, a11yEntry, expanded, onToggle, autoFocus,
}) {
  const btn = useRef(null);
  const { dispatch } = useStudio();
  const id = row.id;
  useEffect(() => {
    if (autoFocus && btn.current) {
      btn.current.scrollIntoView({ block: 'center' });
      btn.current.focus();
      dispatch({ type: 'role/focused' });
    }
  }, [autoFocus, dispatch]);
  const otherHex = resolvedOther ? resolvedOther.roles[id].value : null;
  return (
    <li className="ts-role" id={`theme-studio-role-${id}`} data-role={id}>
      <button
        ref={btn}
        type="button"
        className="ts-role-head"
        id={`theme-studio-role-${id}-head`}
        aria-expanded={expanded ? 'true' : 'false'}
        aria-controls={`theme-studio-role-${id}-editor`}
        onClick={onToggle}
      >
        <span className="ts-role-swatches" aria-hidden="true">
          <Swatch color={row.value} />
          {otherHex ? <Swatch color={otherHex} size="sm" /> : null}
        </span>
        <span className="ts-role-main">
          <span className="ts-role-name">{row.css}</span>
          <span className="ts-role-use">{row.usage}</span>
        </span>
        <span className="ts-role-meta">
          <KindBadge kind={row.kind} label={row.kindLabel} />
          <A11yBadge a11y={row.a11y} />
        </span>
      </button>
      {expanded ? (
        <RoleEditor
          row={row}
          def={def}
          mode={mode}
          resolvedMode={resolvedMode}
          resolvedOther={resolvedOther}
          a11yEntry={a11yEntry}
        />
      ) : null}
    </li>
  );
}

export { A11yBadge };
