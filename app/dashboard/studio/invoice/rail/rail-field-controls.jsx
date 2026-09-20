'use client';

// Invoice Studio rail — shared field-control primitives (lane D,
// docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md P4).
//
// Every card in this directory renders its inputs through these small
// presentational wrappers instead of hand-rolling `<input>` markup per field
// — the admin card's `.vrk-scope` CSS (`field`, `label`, `field-grid`) does
// not exist in the Studio shell (rail-ui.jsx's GLASS/ui tokens are the
// Studio's own idiom), so this file is the one place that translation
// happens. Deliberately dumb: no card calls `invoice-fields.js` from in
// here — each field control receives an already-resolved `value` and an
// `onChange(rawText)` callback, and the OWNING CARD decides how to turn that
// into a committed draft write (usually `draft.applyFieldEdit(path,
// parseValue(type, raw), 'rail')`; qty/unitPrice go through
// `updateItem`/`updateStandaloneItem` instead — see LineItemsCard's header
// comment for why).
//
// `data-inv-rail-field="<path>"` on every control is the focus seam
// (§4.2 / handoff requirement #4): InvoiceRail's `focusField(path)` ref
// method finds a control by this attribute, opens its owning RailCard, and
// focuses it. It is NOT wired to anything yet — lane E's bridge is the only
// planned caller.

import React from 'react';
import { GLASS, ui } from '../../components/rail-ui';
import { X as XIcon, Plus as PlusIcon } from 'lucide-react';

export const railFieldStyle = {
  label: { ...ui.label, display: 'block', marginBottom: 6 },
  input: {
    width: '100%', height: 38, borderRadius: 9, border: '1px solid ' + GLASS.hair,
    padding: '0 12px', fontFamily: GLASS.sans, fontSize: 12.5, color: GLASS.ink,
    background: 'rgba(255,255,255,0.7)', boxSizing: 'border-box',
  },
  textarea: {
    width: '100%', borderRadius: 9, border: '1px solid ' + GLASS.hair,
    padding: '10px 12px', fontFamily: GLASS.sans, fontSize: 12.5, color: GLASS.ink,
    background: 'rgba(255,255,255,0.7)', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5,
  },
};

// Two-column responsive field row — the rail-idiom translation of the
// admin card's `.field-grid` CSS class.
export function RailFieldGrid({ children, minColWidth = 130 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${minColWidth}px, 1fr))`, gap: 10 }}>
      {children}
    </div>
  );
}

export function RailField({ label, children, style }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, ...style }}>
      {label ? <span style={railFieldStyle.label}>{label}</span> : null}
      {children}
    </label>
  );
}

// Plain text — value/onChange pass raw strings straight through; the owning
// card is what calls parseValue('text'|'multiline', raw) (an identity op
// today, see invoice-fields.js) before committing.
export function RailTextInput({ path, label, value, onChange, placeholder, maxLength, readOnly = false }) {
  return (
    <RailField label={label}>
      <input
        type="text"
        data-inv-rail-field={path}
        value={value ?? ''}
        maxLength={maxLength}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...railFieldStyle.input, ...(readOnly ? { opacity: 0.65, cursor: 'default' } : null) }}
      />
    </RailField>
  );
}

export function RailTextArea({ path, label, value, onChange, placeholder, rows = 3 }) {
  return (
    <RailField label={label}>
      <textarea
        data-inv-rail-field={path}
        rows={rows}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={railFieldStyle.textarea}
      />
    </RailField>
  );
}

// Native number input — reads/writes the raw draft number directly (§4.2:
// "native rail widgets that want a specific wire format ... read/write the
// draft value directly"), not a money-formatted display string.
export function RailNumberInput({ path, label, value, onChange, step = '0.01', min = undefined, placeholder }) {
  return (
    <RailField label={label}>
      <input
        type="number"
        data-inv-rail-field={path}
        value={Number.isFinite(Number(value)) ? value : 0}
        step={step}
        min={min}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={railFieldStyle.input}
      />
    </RailField>
  );
}

// Native date input — ISO in, ISO out; no pretty-formatting round trip.
export function RailDateInput({ path, label, value, onChange }) {
  return (
    <RailField label={label}>
      <input
        type="date"
        data-inv-rail-field={path}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={railFieldStyle.input}
      />
    </RailField>
  );
}

// Segmented control — status, the amount-due heading presets, etc.
export function RailSegmented({ label, options, value, onSelect, path }) {
  return (
    <RailField label={label}>
      <div
        data-inv-rail-field={path || undefined}
        tabIndex={path ? -1 : undefined}
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
        role="group"
        aria-label={label}
      >
        {options.map((opt) => {
          const optValue = typeof opt === 'string' ? opt : opt.value;
          const optLabel = typeof opt === 'string' ? opt : opt.label;
          return (
            <button
              key={optValue}
              type="button"
              onClick={() => onSelect(optValue)}
              style={{ ...ui.btn(value === optValue), height: 34, padding: '0 14px', fontSize: 11.5 }}
            >
              {optLabel}
            </button>
          );
        })}
      </div>
    </RailField>
  );
}

// Small round icon button — remove-row idiom shared by every repeatable
// list (sub-items, terms, chips, flow steps, categories, items).
export function RailIconButton({ onClick, label, danger = false, icon, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      style={{
        ...ui.btn(false), width: 30, height: 30, padding: 0, flexShrink: 0,
        opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
        color: danger ? '#dc2626' : GLASS.ink, borderColor: danger ? 'rgba(220,38,38,0.35)' : GLASS.hair,
      }}
    >
      {icon || <XIcon size={13} strokeWidth={2.5} />}
    </button>
  );
}

export function RailAddButton({ onClick, children, full = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...ui.btn(false), gap: 6, justifyContent: 'center', width: full ? '100%' : 'auto', alignSelf: 'flex-start' }}
    >
      <PlusIcon size={13} strokeWidth={2.5} />{children}
    </button>
  );
}

// Repeatable-row shell — a bordered block used by items/flow steps, with a
// stable DOM id per row so future tuning can target one row precisely.
export function RailRow({ id, children }) {
  return (
    <div id={id} style={{
      display: 'grid', gap: 10, padding: 12, borderRadius: 10,
      border: '1px solid ' + GLASS.hair, background: 'rgba(255,255,255,0.5)',
    }}>
      {children}
    </div>
  );
}

export function RailEmptyHint({ children }) {
  return (
    <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute, lineHeight: 1.4, display: 'block' }}>
      {children}
    </span>
  );
}
