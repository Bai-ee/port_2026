import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MatterSwarm } from './MatterSwarm';

const DEFAULTS = { speed: 1, bgColor: '#000000', bgAlpha: 0 };

const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const MatterSwarmWindow = ({ style }) => {
  const mountRef               = useRef(null);
  const swarmRef               = useRef(null);
  const [params, setParams]    = useState(DEFAULTS);
  const [panelOpen, setPanelOpen] = useState(false);

  // Sync params to swarm without reinit
  useEffect(() => {
    const s = swarmRef.current;
    if (!s) return;
    s.speedMult = params.speed;
    s.setBackground(params.bgColor, params.bgAlpha);
  }, [params]);

  // Mount once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const swarm = new MatterSwarm(container, 20000);
    swarm.speedMult = DEFAULTS.speed;
    swarm.setBackground(DEFAULTS.bgColor, DEFAULTS.bgAlpha);
    swarmRef.current = swarm;

    Object.assign(swarm.renderer.domElement.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
    });

    swarm.setSize(container.clientWidth || 300, container.clientHeight || 200);

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
        <span style={panelTitleStyle}>Matter Settings</span>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button type="button" style={smallBtnStyle} onClick={() => setParams(DEFAULTS)}>Reset</button>
          <button type="button" style={smallBtnStyle} onClick={() => setPanelOpen(false)}>✕</button>
        </div>
      </div>

      <div style={slidersStyle}>
        {/* Phase label */}
        <div style={phaseInfoStyle}>
          Cycle: 0–3s solid · 3–6s liquid · 6–10s gas
        </div>

        {/* Speed */}
        <div style={sliderRowStyle}>
          <div style={sliderLabelRowStyle}>
            <span style={sliderLabelStyle}>Cycle Speed</span>
            <span style={sliderValueStyle}>{params.speed}</span>
          </div>
          <input
            type="range" min={0.1} max={4} step={0.05}
            value={params.speed}
            onChange={(e) => setParams(p => ({ ...p, speed: parseFloat(e.target.value) }))}
            style={rangeStyle}
          />
        </div>

        {/* BG Color */}
        <div style={sliderRowStyle}>
          <div style={sliderLabelRowStyle}>
            <span style={sliderLabelStyle}>BG Color</span>
            <span style={sliderValueStyle}>{params.bgColor}</span>
          </div>
          <input
            type="color" value={params.bgColor}
            onChange={(e) => setParams(p => ({ ...p, bgColor: e.target.value }))}
            style={colorInputStyle}
          />
        </div>

        {/* BG Alpha */}
        <div style={sliderRowStyle}>
          <div style={sliderLabelRowStyle}>
            <span style={sliderLabelStyle}>BG Alpha</span>
            <span style={sliderValueStyle}>{params.bgAlpha}</span>
          </div>
          <input
            type="range" min={0} max={1} step={0.01}
            value={params.bgAlpha}
            onChange={(e) => setParams(p => ({ ...p, bgAlpha: parseFloat(e.target.value) }))}
            style={rangeStyle}
          />
        </div>
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
        <button type="button" onClick={() => setPanelOpen(o => !o)} style={gearBtnStyle} title="Matter settings">
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
  position: 'absolute', top: '0.5rem', right: '0.5rem', zIndex: 10,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '1.75rem', height: '1.75rem',
  background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '0.4rem', color: 'rgba(255,255,255,0.75)',
  cursor: 'pointer', backdropFilter: 'blur(6px)',
};

const panelStyle = {
  position: 'fixed', bottom: '1.25rem', left: '1.25rem', zIndex: 10000,
  width: '240px',
  background: 'rgba(10, 8, 6, 0.96)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '0.875rem', boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
  backdropFilter: 'blur(16px)', color: '#f5f1df',
  fontFamily: "system-ui, -apple-system, sans-serif", fontSize: '0.78rem',
  overflow: 'hidden',
};

const panelHeaderStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0.65rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.07)',
};

const panelTitleStyle = {
  fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.07em',
  textTransform: 'uppercase', color: 'rgba(245,241,223,0.55)',
};

const smallBtnStyle = {
  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '0.3rem', color: 'rgba(245,241,223,0.65)',
  fontSize: '0.65rem', padding: '0.18rem 0.5rem', cursor: 'pointer',
};

const slidersStyle   = { padding: '0.5rem 1rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.1rem' };
const sliderRowStyle = { paddingTop: '0.5rem' };
const sliderLabelRowStyle = { display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' };
const sliderLabelStyle    = { fontSize: '0.7rem', color: 'rgba(245,241,223,0.6)' };
const sliderValueStyle    = { fontSize: '0.68rem', fontVariantNumeric: 'tabular-nums', color: 'rgba(245,241,223,0.38)' };
const rangeStyle          = { width: '100%', accentColor: '#f5f1df', cursor: 'pointer' };
const colorInputStyle     = { width: '100%', height: '1.6rem', border: 'none', borderRadius: '0.35rem', cursor: 'pointer', padding: 0 };
const phaseInfoStyle      = {
  fontSize: '0.62rem', color: 'rgba(245,241,223,0.3)',
  paddingTop: '0.4rem', letterSpacing: '0.02em',
};

export default MatterSwarmWindow;
