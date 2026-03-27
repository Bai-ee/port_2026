import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ParticlesSwarm } from './ParticlesSwarm';

const SWARM_DEFAULTS = {
  speed: 0.1,
  radius: 25,
  chaos: 10,
  bgColor: '#ffffff',
  bgAlpha: 0,
};

const SWARM_SLIDERS = [
  { key: 'speed',   label: 'Warp Speed',      min: 0.05, max: 2.0, step: 0.05 },
  { key: 'radius',  label: 'Event Horizon',   min: 2,    max: 60,  step: 1    },
  { key: 'chaos',   label: 'Dimensional Fold', min: 0,   max: 10,  step: 0.1  },
  { key: 'bgAlpha', label: 'BG Alpha',         min: 0,   max: 1,   step: 0.01 },
];

const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const PaperSwarmWindow = ({ style }) => {
  const mountRef               = useRef(null);
  const swarmRef               = useRef(null);
  const [params, setParams]    = useState(SWARM_DEFAULTS);
  const [panelOpen, setPanelOpen] = useState(false);

  // Sync swarm whenever params change
  useEffect(() => {
    const s = swarmRef.current;
    if (!s) return;
    s.updateParams(params);
    s.setBackground(params.bgColor, params.bgAlpha);
  }, [params]);

  // Mount swarm once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const swarm = new ParticlesSwarm(container, 20000);
    swarm.updateParams(SWARM_DEFAULTS);
    swarm.setBackground(SWARM_DEFAULTS.bgColor, SWARM_DEFAULTS.bgAlpha);
    swarmRef.current = swarm;

    Object.assign(swarm.renderer.domElement.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
    });

    const w = container.clientWidth || 300;
    const h = container.clientHeight || 200;
    swarm.setSize(w, h);

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) swarm.setSize(Math.round(width), Math.round(height));
    });

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => { entry.isIntersecting ? swarm.start() : swarm.pause(); },
      { threshold: 0, rootMargin: '100px 0px' }
    );

    const onVisibility = () => { document.hidden ? swarm.pause() : swarm.start(); };

    resizeObserver.observe(container);
    intersectionObserver.observe(container);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      swarm.dispose();
      swarmRef.current = null;
    };
  }, []);

  const panel = panelOpen && createPortal(
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <span style={panelTitleStyle}>Swarm Settings</span>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            type="button"
            style={smallBtnStyle}
            onClick={() => setParams(SWARM_DEFAULTS)}
          >
            Reset
          </button>
          <button type="button" style={smallBtnStyle} onClick={() => setPanelOpen(false)}>✕</button>
        </div>
      </div>

      <div style={slidersStyle}>
        {/* Background color picker */}
        <div style={sliderRowStyle}>
          <div style={sliderLabelRowStyle}>
            <span style={sliderLabelStyle}>BG Color</span>
            <span style={sliderValueStyle}>{params.bgColor}</span>
          </div>
          <input
            type="color"
            value={params.bgColor}
            onChange={(e) => setParams(prev => ({ ...prev, bgColor: e.target.value }))}
            style={colorInputStyle}
          />
        </div>

        {/* Sliders */}
        {SWARM_SLIDERS.map(({ key, label, min, max, step }) => (
          <div key={key} style={sliderRowStyle}>
            <div style={sliderLabelRowStyle}>
              <span style={sliderLabelStyle}>{label}</span>
              <span style={sliderValueStyle}>{params[key]}</span>
            </div>
            <input
              type="range"
              min={min} max={max} step={step}
              value={params[key]}
              onChange={(e) => setParams(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
              style={rangeStyle}
            />
          </div>
        ))}
      </div>
    </div>,
    document.body
  );

  return (
    <>
      <div
        ref={mountRef}
        style={{
          ...style,
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: hexToRgba(params.bgColor, params.bgAlpha),
        }}
      >
        {/* Gear toggle — inside thumbnail, top-right */}
        <button
          type="button"
          onClick={() => setPanelOpen(o => !o)}
          style={gearBtnStyle}
          title="Swarm settings"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>

      {panel}
    </>
  );
};

const gearBtnStyle = {
  position: 'absolute',
  top: '0.5rem',
  right: '0.5rem',
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.75rem',
  height: '1.75rem',
  background: 'rgba(0,0,0,0.45)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '0.4rem',
  color: 'rgba(255,255,255,0.75)',
  cursor: 'pointer',
  backdropFilter: 'blur(6px)',
};

const panelStyle = {
  position: 'fixed',
  bottom: '1.25rem',
  left: '1.25rem',
  zIndex: 10000,
  width: '240px',
  background: 'rgba(10, 8, 6, 0.96)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '0.875rem',
  boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
  backdropFilter: 'blur(16px)',
  color: '#f5f1df',
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: '0.78rem',
  overflow: 'hidden',
};

const panelHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.65rem 1rem',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
};

const panelTitleStyle = {
  fontSize: '0.68rem',
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'rgba(245,241,223,0.55)',
};

const smallBtnStyle = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '0.3rem',
  color: 'rgba(245,241,223,0.65)',
  fontSize: '0.65rem',
  padding: '0.18rem 0.5rem',
  cursor: 'pointer',
};

const slidersStyle = {
  padding: '0.5rem 1rem 0.85rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.1rem',
};

const sliderRowStyle  = { paddingTop: '0.5rem' };

const sliderLabelRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '0.2rem',
};

const sliderLabelStyle  = { fontSize: '0.7rem',  color: 'rgba(245,241,223,0.6)'  };
const sliderValueStyle  = { fontSize: '0.68rem', fontVariantNumeric: 'tabular-nums', color: 'rgba(245,241,223,0.38)' };
const rangeStyle        = { width: '100%', accentColor: '#f5f1df', cursor: 'pointer' };
const colorInputStyle   = { width: '100%', height: '1.6rem', border: 'none', borderRadius: '0.35rem', cursor: 'pointer', padding: 0 };

export default PaperSwarmWindow;
