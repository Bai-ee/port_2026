'use client';

import React, { useLayoutEffect, useRef } from 'react';
import { emptyRow, isOverLimit, parseListText, rowKeyMeta } from './value-utils.js';

export function toDomId(key) {
  return String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
}

function AutoTextarea({ value, onChange, minRows = 2, ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} rows={minRows} className="bb-textarea" value={value} onChange={onChange} {...rest} />;
}

function Guidance({ field, domId, open, onToggle }) {
  const g = field.guidance || {};
  const panelId = `${domId}-guidance`;
  return (
    <>
      <button type="button" className="bb-guidance-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span className="bb-caret" aria-hidden="true">▸</span>
        {open ? 'Hide guidance' : 'Why this matters / How to fill it'}
      </button>
      {open ? (
        <dl id={panelId} className="bb-guidance">
          {g.why ? <div><dt>Why this matters</dt><dd>{g.why}</dd></div> : null}
          {g.how ? <div><dt>How to fill it</dt><dd>{g.how}</dd></div> : null}
          {g.example ? <div><dt>Example</dt><dd>{g.example}</dd></div> : null}
          {Array.isArray(g.usedBy) && g.usedBy.length ? (
            <div>
              <dt>Used by</dt>
              <dd className="bb-used-by">{g.usedBy.map((u) => <span key={u} className="bb-chip">{u}</span>)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </>
  );
}

function RowsEditor({ field, domId, value, onChange }) {
  const rows = Array.isArray(value) ? value : [];
  const keys = (field.rowKeys || []).map(rowKeyMeta);
  const setCell = (index, key, next) => onChange(rows.map((r, i) => (i === index ? { ...r, [key]: next } : r)));
  return (
    <div className="bb-rows">
      {rows.map((row, index) => (
        <div className="bb-row" key={index} id={`${domId}-row-${index + 1}`}>
          <div className="bb-row-head">
            <span className="bb-row-title">{field.heading} {index + 1}</span>
            <button type="button" className="bb-link-btn" onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove</button>
          </div>
          <div className="bb-row-grid">
            {keys.map(({ key, label }, k) => {
              const cellId = `${domId}-row-${index + 1}-${toDomId(key)}`;
              // Long-form keys span the row; short ones pair up.
              const wide = keys.length === 1 || /quote|description|result|story|summary|text|note/i.test(key) || (keys.length % 2 === 1 && k === keys.length - 1);
              return (
                <div className="bb-row-cell" data-wide={wide ? 'true' : undefined} key={key}>
                  <label htmlFor={cellId}>{label}</label>
                  {wide ? (
                    <AutoTextarea id={cellId} minRows={2} value={row[key] ?? ''} onChange={(e) => setCell(index, key, e.target.value)} />
                  ) : (
                    <input id={cellId} className="bb-input" type="text" value={row[key] ?? ''} onChange={(e) => setCell(index, key, e.target.value)} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {field.maxRows && rows.length >= field.maxRows ? (
        <span className="bb-meta-row">Maximum of {field.maxRows} rows.</span>
      ) : (
        <button type="button" className="bb-btn bb-add-row" onClick={() => onChange([...rows, emptyRow(field.rowKeys || [])])}>
          + Add {rows.length ? 'another' : 'a'} row
        </button>
      )}
    </div>
  );
}

export default function FieldBlock({ field, value, onChange, guidanceOpen, onToggleGuidance, serverError }) {
  const domId = `brain-builder-field-${toDomId(field.key)}`;
  const inputId = `${domId}-input`;
  const over = isOverLimit(field, value);
  const len = String(value ?? '').length;
  const showCounter = !!field.maxLen && (field.kind === 'text' || field.kind === 'textarea');
  const describedBy = `${domId}-meta`;

  let control = null;
  if (field.kind === 'text') {
    control = (
      <input id={inputId} className="bb-input" type="text" value={value ?? ''} placeholder={field.placeholder || ''}
        aria-invalid={over || undefined} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
    );
  } else if (field.kind === 'textarea') {
    control = (
      <AutoTextarea id={inputId} minRows={3} value={value ?? ''} placeholder={field.placeholder || ''}
        aria-invalid={over || undefined} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
    );
  } else if (field.kind === 'list') {
    const items = parseListText(value);
    control = (
      <>
        <AutoTextarea id={inputId} minRows={3} value={value ?? ''} placeholder={field.placeholder || 'One item per line'}
          aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
        {items.length ? (
          <div className="bb-chips" aria-label={`${field.heading} preview`}>
            {items.map((item, i) => <span key={`${i}-${item}`} className="bb-chip">{item}</span>)}
          </div>
        ) : null}
      </>
    );
  } else if (field.kind === 'rows') {
    control = <RowsEditor field={field} domId={domId} value={value} onChange={onChange} />;
  }

  const hint = field.kind === 'list' ? 'One item per line' : '';
  return (
    <div className="bb-field" id={domId} data-section="brain-builder-field">
      {field.kind === 'rows' ? (
        <span className="bb-field-label" id={`${domId}-label`}>
          {field.heading}
          {field.required ? <span className="bb-required" title="Required" aria-label="required">*</span> : <span className="bb-optional">Optional</span>}
        </span>
      ) : (
        <label className="bb-field-label" htmlFor={inputId}>
          {field.heading}
          {field.required ? <span className="bb-required" title="Required" aria-label="required">*</span> : <span className="bb-optional">Optional</span>}
        </label>
      )}
      <Guidance field={field} domId={domId} open={guidanceOpen} onToggle={onToggleGuidance} />
      <div role={field.kind === 'rows' ? 'group' : undefined} aria-labelledby={field.kind === 'rows' ? `${domId}-label` : undefined} style={{ display: 'grid', gap: 8, minWidth: 0 }}>
        {control}
      </div>
      <div className="bb-meta-row" id={describedBy}>
        <span>{hint}</span>
        {showCounter ? <span className="bb-counter bb-mono" data-over={over ? 'true' : undefined}>{len}/{field.maxLen}</span> : null}
      </div>
      {over ? <div className="bb-notice bb-notice-error" role="alert" style={{ margin: 0 }}>Over the {field.maxLen}-character limit by {len - field.maxLen}.</div> : null}
      {serverError ? <div className="bb-notice bb-notice-error" role="alert" style={{ margin: 0 }}>{serverError}</div> : null}
    </div>
  );
}
