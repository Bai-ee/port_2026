'use client';
import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

/**
 * Live tuner for the homepage hero particle shape (the ox.jsx torus swarm).
 * Opened with `?scene=1` or `#scene` in the URL (see HomePage.jsx); lazy-loaded,
 * so a normal visitor never downloads it. Dragging a slider writes straight into
 * the canvas's per-frame params ref; releasing it commits the value (needed for
 * the params the canvas only reads on rebuild, e.g. particle count).
 * Templates: "Default" (the committed hero look) plus named snapshots saved in
 * this browser's localStorage. "Copy JSON" is how a tuned look gets back into
 * HERO_PARAMS_START (or becomes a built-in template) for everyone.
 */
const GROUPS = [
  {
    label: 'Shape',
    controls: [
      { key: 'scale',            label: 'Scale',      min: 50,   max: 400,   step: 5 },
      { key: 'torusMajorRadius', label: 'Ring',       min: 0.05, max: 2,     step: 0.01 },
      // Keep well below 2: ox.jsx divides by (2 - tube·sin v) — see HERO_PARAMS_END.
      { key: 'torusTubeRadius',  label: 'Tube',       min: 0,    max: 1.8,   step: 0.01 },
      { key: 'particleCount',    label: 'Count',      min: 1000, max: 50000, step: 500 },
      { key: 'particleSize',     label: 'Size',       min: 0.05, max: 3,     step: 0.05 },
    ],
  },
  {
    label: 'Rotation',
    controls: [
      { key: 'rotationX',     label: 'X',     min: -Math.PI, max: Math.PI, step: 0.05 },
      { key: 'rotationY',     label: 'Y',     min: -Math.PI, max: Math.PI, step: 0.05 },
      { key: 'rotationZ',     label: 'Z',     min: -Math.PI, max: Math.PI, step: 0.05 },
      { key: 'tireSpinSpeed', label: 'Spin',  min: 0,        max: 5,       step: 0.05 },
    ],
  },
  {
    label: 'Motion',
    controls: [
      { key: 'chaos',          label: 'Chaos',  min: 0,   max: 3,  step: 0.01 },
      { key: 'waveAmplitude',  label: 'Wave',   min: 0,   max: 15, step: 0.1 },
      { key: 'flow',           label: 'Flow',   min: 0,   max: 1,  step: 0.01 },
      { key: 'speedMult',      label: 'Speed',  min: 0,   max: 2,  step: 0.01 },
      { key: 'animationSpeed', label: 'Anim',   min: 0.1, max: 5,  step: 0.1 },
    ],
  },
  {
    label: 'Color',
    controls: [
      { key: 'hueOffset',  label: 'Hue',       min: 0, max: 1,   step: 0.01 },
      { key: 'hueSpeed',   label: 'Hue speed', min: 0, max: 0.2, step: 0.001 },
      { key: 'saturation', label: 'Sat',       min: 0, max: 1,   step: 0.01 },
      { key: 'lightness',  label: 'Light',     min: 0, max: 1,   step: 0.01 },
      { key: 'opacity',    label: 'Opacity',   min: 0, max: 1,   step: 0.01 },
    ],
  },
  {
    label: 'Bloom',
    controls: [
      { key: 'bloomStrength',  label: 'Strength',  min: 0, max: 3, step: 0.05 },
      { key: 'bloomThreshold', label: 'Threshold', min: 0, max: 1, step: 0.01 },
      { key: 'bloomRadius',    label: 'Radius',    min: 0, max: 2, step: 0.05 },
    ],
  },
];

const TEMPLATES_STORAGE_KEY = 'scene-tuner:templates:v1';
const MAX_TEMPLATES = 30;

function readTemplates() {
  try {
    const list = JSON.parse(window.localStorage.getItem(TEMPLATES_STORAGE_KEY) || '[]');
    return Array.isArray(list) ? list.filter((t) => t && typeof t.name === 'string' && t.params && typeof t.params === 'object') : [];
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

const SceneSettingsPanel = ({ initialParams, liveParamsRef, onParamsChange, defaultParams, onClose }) => {
  const panelRef = useRef(null);
  const [local, setLocal] = useState(initialParams);
  const [copied, setCopied] = useState(false);
  const [templates, setTemplates] = useState(readTemplates);
  const [selected, setSelected] = useState('default');
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

  const handleChange = (key, rawVal) => {
    const v = parseFloat(rawVal);
    setLocal((prev) => ({ ...prev, [key]: v }));
    if (liveParamsRef) liveParamsRef.current = { ...liveParamsRef.current, [key]: v };
  };

  const handleCommit = (key, rawVal) => {
    const v = parseFloat(rawVal);
    onParamsChange((prev) => ({ ...prev, [key]: v }));
  };

  const handleReset = () => {
    setSelected('default');
    applyParams(defaultParams);
  };

  const applyParams = (params) => {
    setLocal(params);
    if (liveParamsRef) liveParamsRef.current = { ...params };
    onParamsChange(params);
  };

  const handleSelectTemplate = (value) => {
    setSelected(value);
    setTemplateNote('');
    if (value === 'default') return applyParams(defaultParams);
    const t = templates.find((x) => x.name === value);
    // Merge over the defaults so a template saved before a new param existed still applies cleanly.
    if (t) applyParams({ ...defaultParams, ...t.params });
  };

  const handleSaveTemplate = () => {
    const name = templateName.trim().slice(0, 40);
    if (!name) return setTemplateNote('Name it first.');
    if (name.toLowerCase() === 'default') return setTemplateNote('"Default" is built in; pick another name.');
    const rest = templates.filter((t) => t.name !== name);
    if (rest.length >= MAX_TEMPLATES) return setTemplateNote(`Limit is ${MAX_TEMPLATES}; delete one first.`);
    const next = [...rest, { name, params: { ...local }, savedAt: new Date().toISOString() }];
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
    setSelected('default');
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(JSON.stringify(local, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }, () => {});
  };

  return (
    <>
      <style>{`
        #scene-settings-panel input[type=range] {
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
        #scene-settings-panel input[type=range]::-webkit-slider-thumb {
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
          #scene-settings-panel {
            right: auto !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            width: min(92vw, 340px) !important;
          }
        }
      `}</style>

      <div
        id="scene-settings-panel"
        ref={panelRef}
        role="dialog"
        aria-label="Scene tuner"
        style={{
          position: 'fixed',
          top: '74px',
          right: 'max(4vw, 16px)',
          zIndex: 300,
          width: 'clamp(260px, 25vw, 320px)',
          maxHeight: 'calc(100dvh - 96px)',
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
        <div id="scene-settings-header-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <span style={{ ...monoLabel, fontSize: '0.95rem', color: 'var(--t-text-muted)' }}>Scene</span>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <button id="scene-settings-copy-button" type="button" onClick={handleCopy} style={smallBtn} title="Copy the current params as JSON">
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
            <button
              id="scene-settings-close-button"
              type="button"
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-text-muted)', fontSize: '1.6rem', lineHeight: 1, padding: '0 0.1rem' }}
              aria-label="Close"
            >×</button>
          </div>
        </div>

        <div id="scene-settings-templates-row" style={{ marginBottom: '0.7rem' }}>
          <p style={{ ...monoLabel, margin: '0 0 0.36rem', fontSize: '0.86rem', color: 'var(--t-text-faint)' }}>Template</p>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.4rem' }}>
            <select
              id="scene-settings-template-select"
              aria-label="Scene template"
              value={selected}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              style={{ flex: 1, minWidth: 0, padding: '0.35rem 0.4rem', fontSize: '1rem', color: 'var(--t-text)', background: 'var(--t-surface)', border: '1px solid var(--t-control-border)', borderRadius: '0.4rem' }}
            >
              <option value="default">Default</option>
              {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            {selected !== 'default' && (
              <button id="scene-settings-template-delete-button" type="button" onClick={handleDeleteTemplate} style={smallBtn} title="Delete this saved template">
                Delete
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              id="scene-settings-template-name-input"
              type="text"
              placeholder="Name current settings"
              aria-label="Template name"
              maxLength={40}
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTemplate(); }}
              style={{ flex: 1, minWidth: 0, padding: '0.35rem 0.45rem', fontSize: '1rem', color: 'var(--t-text)', background: 'var(--t-surface)', border: '1px solid var(--t-control-border)', borderRadius: '0.4rem' }}
            />
            <button id="scene-settings-template-save-button" type="button" onClick={handleSaveTemplate} style={smallBtn}>
              Save
            </button>
          </div>
          {templateNote && (
            <p id="scene-settings-template-note" role="status" style={{ margin: '0.35rem 0 0', fontSize: '0.9rem', color: 'var(--t-text-muted)' }}>{templateNote}</p>
          )}
          <div style={{ height: '1px', background: 'var(--t-border-faint)', margin: '0.65rem 0 0.55rem' }} />
        </div>

        {GROUPS.map((group, gi) => (
          <div key={group.label} id={`scene-settings-group-${group.label.toLowerCase()}`}>
            <p style={{ ...monoLabel, margin: '0 0 0.36rem', fontSize: '0.86rem', color: 'var(--t-text-faint)' }}>
              {group.label}
            </p>
            {group.controls.map((ctrl) => (
              <label key={ctrl.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.42rem' }}>
                <span style={{ fontSize: '1.05rem', fontWeight: 500, color: 'var(--t-text-secondary)', minWidth: '4.8rem' }}>{ctrl.label}</span>
                <input
                  id={`scene-settings-${ctrl.key}-slider`}
                  type="range"
                  min={ctrl.min}
                  max={ctrl.max}
                  step={ctrl.step}
                  value={local[ctrl.key] ?? 0}
                  onChange={(e) => handleChange(ctrl.key, e.target.value)}
                  onPointerUp={(e) => handleCommit(ctrl.key, e.target.value)}
                  onKeyUp={(e) => handleCommit(ctrl.key, e.currentTarget.value)}
                />
                <span style={{ fontSize: '0.9rem', fontFamily: "'Space Mono', monospace", color: 'var(--t-text-muted)', minWidth: '3.2rem', textAlign: 'right' }}>
                  {fmt(local[ctrl.key], ctrl.step)}
                </span>
              </label>
            ))}
            {gi < GROUPS.length - 1 && (
              <div style={{ height: '1px', background: 'var(--t-border-faint)', margin: '0.55rem 0' }} />
            )}
          </div>
        ))}

        <button
          id="scene-settings-reset-button"
          type="button"
          onClick={handleReset}
          style={{ ...smallBtn, marginTop: '0.75rem', width: '100%', padding: '0.5rem', fontSize: '1rem' }}
        >
          Reset
        </button>
      </div>
    </>
  );
};

export default React.memo(SceneSettingsPanel);
