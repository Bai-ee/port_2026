'use client';

// Dev tuning panel for the radial lens blur on ox.jsx's particle swarm. Mutates
// `paramsRef.current` directly — the same ref LooperLandingPage.jsx already
// passes into <AppCanvas liveParamsRef={paramsRef}> — so ox.jsx's per-frame
// smoothing loop picks up changes with no extra plumbing. Ranges are
// deliberately wide/extreme (not "sane defaults") so the effect is
// unmistakable while dialing in real values; narrow them once settled.
//
// Page-local to /looper only — not mounted on the homepage.

import React, { useState } from 'react';

const FIELDS = [
  { key: 'diffuseOriginX', label: 'Origin X', min: -400, max: 400, step: 1 },
  { key: 'diffuseOriginY', label: 'Origin Y', min: -400, max: 400, step: 1 },
  { key: 'diffuseOriginZ', label: 'Origin Z', min: -400, max: 400, step: 1 },
  { key: 'diffuseStrength', label: 'Blur radius', min: 0, max: 40, step: 0.5 },
  { key: 'diffuseFalloff', label: 'Edge falloff', min: 0, max: 0.05, step: 0.001 },
];

const panelStyle = {
  position: 'fixed',
  top: 84,
  right: 16,
  zIndex: 40,
  width: 240,
  padding: '12px 14px 14px',
  borderRadius: 10,
  background: 'rgba(20,18,16,0.82)',
  color: '#fff',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontSize: 12,
  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
  backdropFilter: 'blur(6px)',
};

const rowStyle = { marginBottom: 10 };
const labelRowStyle = { display: 'flex', justifyContent: 'space-between', marginBottom: 2, opacity: 0.85 };
const sliderStyle = { width: '100%' };

const DiffusionControls = ({ paramsRef }) => {
  const [values, setValues] = useState(() => {
    const initial = {};
    FIELDS.forEach(({ key, min }) => {
      initial[key] = paramsRef?.current?.[key] ?? min;
    });
    return initial;
  });

  const handleChange = (key) => (event) => {
    const next = Number(event.target.value);
    setValues((prev) => ({ ...prev, [key]: next }));
    if (paramsRef?.current) paramsRef.current[key] = next;
  };

  return (
    <div id="looper-diffusion-controls-panel" style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 10, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: 11 }}>
        Lens diffusion
      </div>
      {FIELDS.map(({ key, label, min, max, step }) => (
        <div key={key} style={rowStyle}>
          <div style={labelRowStyle}>
            <span>{label}</span>
            <span>{values[key]}</span>
          </div>
          <input
            id={`looper-diffusion-${key}-slider`}
            type="range"
            min={min}
            max={max}
            step={step}
            value={values[key]}
            onChange={handleChange(key)}
            style={sliderStyle}
          />
        </div>
      ))}
    </div>
  );
};

export default DiffusionControls;
