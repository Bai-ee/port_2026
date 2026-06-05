'use client';
import React, { useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';

const AppCanvas = dynamic(() => import('../../../ox.jsx'), { ssr: false });

const DEFAULT_PARAMS = {
  scale: 200,
  chaos: 0,
  flow: 0.37,
  particleCount: 25000,
  particleSize: 0.2,
  speedMult: 0.44,
  bloomThreshold: 0.8,
  bloomStrength: 0,
  bloomRadius: 1,
  hueOffset: 0.36,
  hueSpeed: 0.02,
  waveAmplitude: 7,
  saturation: 0.75,
  lightness: 0.4,
  torusMajorRadius: 0.5,
  torusTubeRadius: 0.1,
  torusSegments: 100,
  torusSegmentsDepth: 50,
  rotationX: -2.14159265358979,
  rotationY: -2.14159265358979,
  rotationZ: -3.14159265358979,
  tireSpinAxis: 'z',
  tireSpinSpeed: 0,
  animationSpeed: 2.4,
  opacity: 0.23,
};

const CONTROLS = [
  { group: 'SHAPE', items: [
    { key: 'scale',           label: 'Scale',        min: 5,    max: 150,      step: 1     },
    { key: 'torusMajorRadius',label: 'Major R',      min: 0.1,  max: 5,        step: 0.05  },
    { key: 'torusTubeRadius', label: 'Tube R',       min: 0.01, max: 2,        step: 0.01  },
    { key: 'torusPulse',      label: 'Pulse',        min: 0,    max: 1,        step: 0.01  },
  ]},
  { group: 'PARTICLES', items: [
    { key: 'particleCount',   label: 'Count',        min: 500,  max: 50000,    step: 500   },
    { key: 'particleSize',    label: 'Size',         min: 0.05, max: 3,        step: 0.05  },
    { key: 'opacity',         label: 'Opacity',      min: 0,    max: 1,        step: 0.01  },
  ]},
  { group: 'MOTION', items: [
    { key: 'animationSpeed',  label: 'Speed',        min: 0,    max: 4,        step: 0.05  },
    { key: 'speedMult',       label: 'Speed Mult',   min: 0,    max: 1,        step: 0.01  },
    { key: 'flow',            label: 'Flow',         min: 0,    max: 2,        step: 0.01  },
    { key: 'tireSpinSpeed',   label: 'Spin',         min: 0,    max: 5,        step: 0.05  },
  ]},
  { group: 'TURBULENCE', items: [
    { key: 'chaos',           label: 'Chaos',        min: 0,    max: 3,        step: 0.01  },
    { key: 'waveAmplitude',   label: 'Wave Amp',     min: 0,    max: 15,       step: 0.1   },
  ]},
  { group: 'COLOR', items: [
    { key: 'hueOffset',       label: 'Hue Offset',   min: 0,    max: 1,        step: 0.01  },
    { key: 'hueSpeed',        label: 'Hue Speed',    min: 0,    max: 0.2,      step: 0.001 },
    { key: 'saturation',      label: 'Saturation',   min: 0,    max: 1,        step: 0.01  },
    { key: 'lightness',       label: 'Lightness',    min: 0,    max: 1,        step: 0.01  },
  ]},
  { group: 'ROTATION', items: [
    { key: 'rotationX',       label: 'Tilt X',       min: -Math.PI, max: Math.PI, step: 0.05 },
    { key: 'rotationY',       label: 'Tilt Y',       min: -Math.PI, max: Math.PI, step: 0.05 },
    { key: 'rotationZ',       label: 'Tilt Z',       min: -Math.PI, max: Math.PI, step: 0.05 },
  ]},
];

const SPIN_AXES = ['x', 'y', 'z']; // default matches homepage: 'z'
const BG_PRESETS = ['#000000', '#0a0a0a', '#ffffff', '#f5f1df', '#1a1a2e', '#0d1117'];

const fmt = (v) => Number(v ?? 0).toFixed(3);

export default function CanvasPlayground() {
  const [params, setParams] = useState({ ...DEFAULT_PARAMS });
  const [bg, setBg] = useState('#ffffff');
  const [panelOpen, setPanelOpen] = useState(true);
  const liveParamsRef = useRef({ ...DEFAULT_PARAMS });

  const handleChange = useCallback((key, raw) => {
    const v = parseFloat(raw);
    setParams(prev => {
      const next = { ...prev, [key]: v };
      liveParamsRef.current = next;
      return next;
    });
  }, []);

  const handleSelect = useCallback((key, val) => {
    setParams(prev => {
      const next = { ...prev, [key]: val };
      liveParamsRef.current = next;
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setParams({ ...DEFAULT_PARAMS });
    liveParamsRef.current = { ...DEFAULT_PARAMS };
  }, []);

  return (
    <div id="canvas-playground-root" style={{ position: 'fixed', inset: 0, background: bg, overflow: 'hidden' }}>
      <style>{`
        @keyframes heroGradientDrift {
          0%   { transform: translate3d(0, 0, 0) scale(1); }
          100% { transform: translate3d(1.5%, -1.2%, 0) scale(1.04); }
        }
      `}</style>

      {/* hero gradient overlay — matches homepage exactly */}
      <div
        id="canvas-playground-gradient"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          pointerEvents: 'none',
          background: [
            'radial-gradient(72% 68% at 18% 22%, rgba(196, 124, 86, 0.22) 0%, rgba(196, 124, 86, 0) 62%)',
            'radial-gradient(82% 78% at 78% 70%, rgba(102, 184, 164, 0.18) 0%, rgba(102, 184, 164, 0) 66%)',
            'linear-gradient(135deg, rgba(214, 191, 123, 0.14) 0%, rgba(255, 255, 255, 0) 38%, rgba(171, 148, 218, 0.12) 100%)',
          ].join(', '),
          mixBlendMode: 'multiply',
          filter: 'blur(6px) saturate(1.04)',
          transformOrigin: '50% 50%',
          animation: 'heroGradientDrift 18s ease-in-out infinite alternate',
        }}
      />

      <AppCanvas params={params} liveParamsRef={liveParamsRef} backgroundColor={bg} />

      {/* toggle button */}
      <button
        id="canvas-playground-toggle"
        onClick={() => setPanelOpen(o => !o)}
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 500,
          padding: '6px 14px',
          background: 'rgba(255,255,255,0.12)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 8,
          color: '#fff',
          fontSize: 13,
          fontFamily: "'Space Mono', monospace",
          cursor: 'pointer',
          letterSpacing: '0.06em',
        }}
      >
        {panelOpen ? 'HIDE' : 'CONTROLS'}
      </button>

      {/* controls panel */}
      {panelOpen && (
        <div
          id="canvas-playground-panel"
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 400,
            width: 'clamp(240px, 22vw, 300px)',
            overflowY: 'auto',
            background: 'rgba(0,0,0,0.72)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderLeft: '1px solid rgba(255,255,255,0.1)',
            padding: '56px 16px 24px',
            fontFamily: "'Space Mono', monospace",
            color: '#fff',
            boxSizing: 'border-box',
          }}
        >
          {/* background */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ margin: '0 0 8px', fontSize: 10, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>BACKGROUND</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {BG_PRESETS.map(c => (
                <button
                  key={c}
                  onClick={() => setBg(c)}
                  style={{
                    width: 22, height: 22,
                    borderRadius: 4,
                    background: c,
                    border: bg === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              ))}
              <input
                type="color"
                value={bg}
                onChange={e => setBg(e.target.value)}
                style={{ width: 22, height: 22, border: 'none', borderRadius: 4, cursor: 'pointer', padding: 0, background: 'none' }}
              />
            </div>
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', marginBottom: 16 }} />

          {/* spin axis */}
          <div style={{ marginBottom: 16 }}>
            <p style={{ margin: '0 0 8px', fontSize: 10, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>SPIN AXIS</p>
            <div style={{ display: 'flex', gap: 6 }}>
              {SPIN_AXES.map(ax => (
                <button
                  key={ax}
                  onClick={() => handleSelect('tireSpinAxis', ax)}
                  style={{
                    flex: 1,
                    padding: '4px 0',
                    background: params.tireSpinAxis === ax ? 'rgba(255,255,255,0.2)' : 'transparent',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 4,
                    color: '#fff',
                    fontSize: 12,
                    cursor: 'pointer',
                    fontFamily: "'Space Mono', monospace",
                    textTransform: 'uppercase',
                  }}
                >
                  {ax}
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', marginBottom: 16 }} />

          {/* sliders */}
          {CONTROLS.map((group, gi) => (
            <div key={group.group} style={{ marginBottom: 16 }}>
              <p style={{ margin: '0 0 8px', fontSize: 10, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{group.group}</p>
              {group.items.map(ctrl => (
                <div key={ctrl.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', minWidth: 72, flexShrink: 0 }}>{ctrl.label}</span>
                  <input
                    type="range"
                    min={ctrl.min}
                    max={ctrl.max}
                    step={ctrl.step}
                    value={params[ctrl.key] ?? ctrl.min}
                    onChange={e => handleChange(ctrl.key, e.target.value)}
                    style={{ flex: 1, accentColor: '#fff', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', minWidth: 40, textAlign: 'right' }}>{fmt(params[ctrl.key])}</span>
                </div>
              ))}
              {gi < CONTROLS.length - 1 && (
                <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', marginTop: 8 }} />
              )}
            </div>
          ))}

          <button
            onClick={handleReset}
            style={{
              width: '100%',
              marginTop: 8,
              padding: '8px 0',
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
              color: 'rgba(255,255,255,0.5)',
              fontSize: 11,
              fontFamily: "'Space Mono', monospace",
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Reset All
          </button>
        </div>
      )}
    </div>
  );
}
