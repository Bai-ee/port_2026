'use client';
import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import {
  DEFAULT_HERO_TYPE,
  HERO_BLENDS,
  HERO_FONTS,
  HERO_INKS,
  HERO_MAX_LINES,
  getHeroType,
  resetHeroType,
  setHeroType,
} from '../../lib/hero-type/store';

/**
 * Dev-only live tuner for the hero headline + subheadline type (HeroHeadline.jsx).
 * Opened from the homepage's dev editor row (#dev-type-editor-button). Every edit
 * is applied live and kept as a browser-local draft (lib/hero-type/store.js), so
 * it survives a reload. Templates are named snapshots in localStorage. "Copy
 * JSON" is how a tuned look gets back into DEFAULT_HERO_TYPE for everyone.
 * Colours are theme tokens: the actual palette stays in Theme Studio.
 */
const GROUPS = [
  {
    id: 'headline',
    label: 'Headline',
    text: { key: 'headlineLines', label: `Lines (one per row, max ${HERO_MAX_LINES})`, rows: HERO_MAX_LINES },
    font: 'headlineFont',
    sliders: [
      { key: 'headlineWeight',     label: 'Weight',   min: 100,   max: 900,  step: 100 },
      { key: 'headlineStrokeEm',   label: 'Stroke',   min: 0,     max: 0.12, step: 0.005 },
      { key: 'headlineTrackingEm', label: 'Tracking', min: -0.1,  max: 0.2,  step: 0.005 },
      { key: 'headlineLineHeight', label: 'Leading',  min: 0.6,   max: 1.4,  step: 0.01 },
    ],
    selects: [
      { key: 'headlineBlend', label: 'Blend', options: HERO_BLENDS.map((b) => ({ value: b, label: b })) },
      { key: 'headlineInk',   label: 'Ink',   options: HERO_INKS },
      { key: 'accentInk',     label: 'Last line', options: [{ value: '', label: 'Same as ink' }, ...HERO_INKS] },
    ],
  },
  {
    id: 'subheadline',
    label: 'Subheadline',
    text: { key: 'subPhrases', label: 'Phrases it cycles (one per row)', rows: 3 },
    font: 'subFont',
    sliders: [
      { key: 'subWeight',     label: 'Weight',   min: 100,  max: 900, step: 100 },
      { key: 'subScale',      label: 'Size',     min: 0.4,  max: 2,   step: 0.05 },
      { key: 'subOpacity',    label: 'Opacity',  min: 0,    max: 1,   step: 0.01 },
      { key: 'subTrackingEm', label: 'Tracking', min: -0.1, max: 0.2, step: 0.005 },
    ],
    selects: [
      { key: 'subInk', label: 'Ink', options: [{ value: '', label: 'Same as headline' }, ...HERO_INKS] },
    ],
  },
];

const FONT_OPTIONS = Object.entries(HERO_FONTS).map(([value, f]) => ({ value, label: f.label }));

const TEMPLATES_STORAGE_KEY = 'hero-type:templates:v1';
const MAX_TEMPLATES = 30;

function readTemplates() {
  try {
    const list = JSON.parse(window.localStorage.getItem(TEMPLATES_STORAGE_KEY) || '[]');
    return Array.isArray(list) ? list.filter((t) => t && typeof t.name === 'string' && t.type && typeof t.type === 'object') : [];
  } catch {
    return [];
  }
}

function writeTemplates(list) {
  try {
    window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

const fmt = (v, step) => {
  const n = Number(v ?? 0);
  return step >= 1 ? String(Math.round(n)) : n.toFixed(step < 0.01 ? 3 : 2);
};

const monoLabel = {
  fontFamily: "'Space Mono', monospace",
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const smallBtn = {
  padding: '0.3rem 0.55rem',
  background: 'var(--t-inset)',
  border: '1px solid var(--t-border-subtle)',
  borderRadius: '0.4rem',
  cursor: 'pointer',
  fontSize: '0.85rem',
  color: 'var(--t-text-secondary)',
  ...monoLabel,
};

const fieldStyle = {
  flex: 1,
  minWidth: 0,
  padding: '0.35rem 0.45rem',
  fontSize: '1rem',
  color: 'var(--t-text)',
  background: 'var(--t-surface)',
  border: '1px solid var(--t-control-border)',
  borderRadius: '0.4rem',
};

const rowLabel = { fontSize: '1.05rem', fontWeight: 500, color: 'var(--t-text-secondary)', minWidth: '4.8rem' };
const groupLabel = { ...monoLabel, margin: '0 0 0.36rem', fontSize: '0.86rem', color: 'var(--t-text-faint)' };
const divider = { height: '1px', background: 'var(--t-border-faint)', margin: '0.55rem 0' };

const HeroTypePanel = ({ onClose }) => {
  const panelRef = useRef(null);
  const [type, setType] = useState(getHeroType);
  // Raw textarea text, kept separately so typing a blank row isn't stripped mid-edit.
  const [drafts, setDrafts] = useState(() => ({
    headlineLines: getHeroType().headlineLines.join('\n'),
    subPhrases: getHeroType().subPhrases.join('\n'),
  }));
  const [copied, setCopied] = useState(false);
  const [templates, setTemplates] = useState(readTemplates);
  const [selected, setSelected] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateNote, setTemplateNote] = useState('');

  useEffect(() => {
    gsap.fromTo(
      panelRef.current,
      { autoAlpha: 0, y: -6, scale: 0.97 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.22, ease: 'power2.out' }
    );
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const apply = (next) => {
    setHeroType(next);
    setType(getHeroType());
  };

  const loadAll = (next) => {
    apply(next);
    const t = getHeroType();
    setDrafts({ headlineLines: t.headlineLines.join('\n'), subPhrases: t.subPhrases.join('\n') });
  };

  const update = (key, value) => apply({ ...type, [key]: value });

  const updateText = (key, raw) => {
    setDrafts((prev) => ({ ...prev, [key]: raw }));
    const list = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    if (list.length) update(key, list);
  };

  // Clears the browser draft entirely, back to the committed DEFAULT_HERO_TYPE.
  const handleReset = () => {
    setSelected('');
    resetHeroType();
    const t = getHeroType();
    setType(t);
    setDrafts({ headlineLines: t.headlineLines.join('\n'), subPhrases: t.subPhrases.join('\n') });
  };

  const handleSelectTemplate = (value) => {
    setSelected(value);
    setTemplateNote('');
    if (value === 'default') return loadAll(DEFAULT_HERO_TYPE);
    const t = templates.find((x) => x.name === value);
    if (t) loadAll(t.type);
  };

  const handleSaveTemplate = () => {
    const name = templateName.trim().slice(0, 40);
    if (!name) return setTemplateNote('Name it first.');
    if (name.toLowerCase() === 'default') return setTemplateNote('"Default" is built in; pick another name.');
    const rest = templates.filter((t) => t.name !== name);
    if (rest.length >= MAX_TEMPLATES) return setTemplateNote(`Limit is ${MAX_TEMPLATES}; delete one first.`);
    const next = [...rest, { name, type: { ...type }, savedAt: new Date().toISOString() }];
    if (!writeTemplates(next)) return setTemplateNote('Could not save (browser storage blocked).');
    setTemplates(next);
    setSelected(name);
    setTemplateName('');
    setTemplateNote(rest.length < templates.length ? `Updated "${name}".` : `Saved "${name}".`);
  };

  const handleDeleteTemplate = () => {
    const next = templates.filter((t) => t.name !== selected);
    if (!writeTemplates(next)) return setTemplateNote('Could not delete (browser storage blocked).');
    setTemplates(next);
    setTemplateNote(`Deleted "${selected}".`);
    setSelected('');
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(JSON.stringify(type, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }, () => {});
  };

  return (
    <>
      <style>{`
        #hero-type-panel input[type=range] {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          border-radius: 99px;
          background: var(--t-control-border);
          outline: none;
          cursor: pointer;
          flex: 1;
          min-width: 0;
        }
        #hero-type-panel input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: var(--t-text);
          cursor: pointer;
          border: 2px solid var(--t-surface);
          box-shadow: var(--t-shadow-sm);
        }
        @media (max-width: 768px) {
          #hero-type-panel {
            right: auto !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            width: min(92vw, 340px) !important;
          }
        }
      `}</style>

      <div
        id="hero-type-panel"
        ref={panelRef}
        role="dialog"
        aria-label="Hero type tuner"
        style={{
          position: 'fixed',
          top: '74px',
          right: 'max(4vw, 16px)',
          zIndex: 300,
          width: 'clamp(280px, 26vw, 340px)',
          maxHeight: 'calc(100dvh - 140px)',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          background: 'var(--t-glass-strong)',
          backdropFilter: 'blur(44px)',
          WebkitBackdropFilter: 'blur(44px)',
          border: '1px solid var(--t-glass-border)',
          borderRadius: '1rem',
          boxShadow: 'var(--t-shadow-lg)',
          padding: '0.8rem 0.9rem',
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          color: 'var(--t-text)',
        }}
      >
        <div id="hero-type-header-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <span style={{ ...monoLabel, fontSize: '0.95rem', color: 'var(--t-text-muted)' }}>Type</span>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <button id="hero-type-copy-button" type="button" onClick={handleCopy} style={smallBtn} title="Copy the current type settings as JSON">
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
            <button
              id="hero-type-close-button"
              type="button"
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-text-muted)', fontSize: '1.6rem', lineHeight: 1, padding: '0 0.1rem' }}
              aria-label="Close"
            >×</button>
          </div>
        </div>

        <div id="hero-type-templates-row" style={{ marginBottom: '0.7rem' }}>
          <p style={groupLabel}>Template</p>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.4rem' }}>
            <select
              id="hero-type-template-select"
              aria-label="Type template"
              value={selected}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              style={fieldStyle}
            >
              <option value="" disabled>Current draft</option>
              <option value="default">Default</option>
              {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            {selected && selected !== 'default' && (
              <button id="hero-type-template-delete-button" type="button" onClick={handleDeleteTemplate} style={smallBtn} title="Delete this saved template">
                Delete
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              id="hero-type-template-name-input"
              type="text"
              placeholder="Name current settings"
              aria-label="Template name"
              maxLength={40}
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTemplate(); }}
              style={fieldStyle}
            />
            <button id="hero-type-template-save-button" type="button" onClick={handleSaveTemplate} style={smallBtn}>
              Save
            </button>
          </div>
          {templateNote && (
            <p id="hero-type-template-note" role="status" style={{ margin: '0.35rem 0 0', fontSize: '0.9rem', color: 'var(--t-text-muted)' }}>{templateNote}</p>
          )}
          <div style={{ ...divider, margin: '0.65rem 0 0.55rem' }} />
        </div>

        {GROUPS.map((group, gi) => (
          <div key={group.id} id={`hero-type-group-${group.id}`}>
            <p style={groupLabel}>{group.label}</p>

            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              <span style={{ display: 'block', fontSize: '0.9rem', color: 'var(--t-text-muted)', marginBottom: '0.25rem' }}>{group.text.label}</span>
              <textarea
                id={`hero-type-${group.text.key}-input`}
                rows={group.text.rows}
                value={drafts[group.text.key]}
                onChange={(e) => updateText(group.text.key, e.target.value)}
                spellCheck={false}
                style={{ ...fieldStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: "'Space Mono', monospace", fontSize: '0.95rem', lineHeight: 1.35 }}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.42rem' }}>
              <span style={rowLabel}>Font</span>
              <select id={`hero-type-${group.font}-select`} value={type[group.font]} onChange={(e) => update(group.font, e.target.value)} style={fieldStyle}>
                {FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>

            {group.sliders.map((ctrl) => (
              <label key={ctrl.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.42rem' }}>
                <span style={rowLabel}>{ctrl.label}</span>
                <input
                  id={`hero-type-${ctrl.key}-slider`}
                  type="range"
                  min={ctrl.min}
                  max={ctrl.max}
                  step={ctrl.step}
                  value={type[ctrl.key] ?? 0}
                  onChange={(e) => update(ctrl.key, parseFloat(e.target.value))}
                />
                <span style={{ fontSize: '0.9rem', fontFamily: "'Space Mono', monospace", color: 'var(--t-text-muted)', minWidth: '3.2rem', textAlign: 'right' }}>
                  {fmt(type[ctrl.key], ctrl.step)}
                </span>
              </label>
            ))}

            {group.selects.map((ctrl) => (
              <label key={ctrl.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.42rem' }}>
                <span style={rowLabel}>{ctrl.label}</span>
                <select id={`hero-type-${ctrl.key}-select`} value={type[ctrl.key]} onChange={(e) => update(ctrl.key, e.target.value)} style={fieldStyle}>
                  {ctrl.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ))}

            {gi < GROUPS.length - 1 && <div style={divider} />}
          </div>
        ))}

        <button
          id="hero-type-reset-button"
          type="button"
          onClick={handleReset}
          style={{ ...smallBtn, marginTop: '0.75rem', width: '100%', padding: '0.5rem', fontSize: '1rem' }}
        >
          Reset to default
        </button>
      </div>
    </>
  );
};

export default HeroTypePanel;
