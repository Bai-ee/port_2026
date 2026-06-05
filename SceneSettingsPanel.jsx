'use client';
import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

const GROUPS = [
  {
    label: 'ROTATION',
    controls: [
      { key: 'rotationX', label: 'X', min: -Math.PI, max: Math.PI, step: 0.05 },
      { key: 'rotationY', label: 'Y', min: -Math.PI, max: Math.PI, step: 0.05 },
      { key: 'rotationZ', label: 'Z', min: -Math.PI, max: Math.PI, step: 0.05 },
    ],
  },
  {
    label: 'TURBULENCE',
    controls: [
      { key: 'chaos',         label: 'Chaos', min: 0, max: 3,  step: 0.01 },
      { key: 'waveAmplitude', label: 'Wave',  min: 0, max: 15, step: 0.1  },
    ],
  },
];

const fmt = (v) => Number(v ?? 0).toFixed(2);

const SceneSettingsPanel = ({ initialParams, liveParamsRef, onParamsChange, defaultParams, onClose }) => {
  const panelRef = useRef(null);
  const [local, setLocal] = useState(initialParams);

  useEffect(() => {
    gsap.fromTo(
      panelRef.current,
      { autoAlpha: 0, y: -6, scale: 0.97 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.22, ease: 'power2.out' }
    );

    const handleDown = (e) => {
      if (!panelRef.current?.contains(e.target)) {
        const btn = document.getElementById('nav-scroll-top');
        if (!btn?.contains(e.target)) onClose();
      }
    };
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const handleChange = (key, rawVal) => {
    const v = parseFloat(rawVal);
    setLocal((prev) => ({ ...prev, [key]: v }));
    if (liveParamsRef) {
      liveParamsRef.current = { ...liveParamsRef.current, [key]: v };
    }
  };

  const handleCommit = (key, rawVal) => {
    const v = parseFloat(rawVal);
    onParamsChange((prev) => ({ ...prev, [key]: v }));
  };

  const handleReset = () => {
    setLocal(defaultParams);
    if (liveParamsRef) liveParamsRef.current = { ...defaultParams };
    onParamsChange(defaultParams);
  };

  return (
    <>
      <style>{`
        #scene-settings-panel input[type=range] {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          border-radius: 99px;
          background: rgba(42,36,32,0.14);
          outline: none;
          cursor: pointer;
          flex: 1;
        }
        #scene-settings-panel input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: #2a2420;
          cursor: pointer;
          border: 2px solid rgba(245,241,223,0.9);
          box-shadow: 0 1px 4px rgba(42,36,32,0.22);
        }
        #scene-settings-panel input[type=range]::-moz-range-thumb {
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: #2a2420;
          cursor: pointer;
          border: 2px solid rgba(245,241,223,0.9);
          box-shadow: 0 1px 4px rgba(42,36,32,0.22);
        }

        /* Mobile: center the panel */
        @media (max-width: 768px) {
          #scene-settings-panel {
            right: auto !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            width: min(85vw, 310px) !important;
          }
        }
      `}</style>

      <div
        id="scene-settings-panel"
        ref={panelRef}
        style={{
          position: 'fixed',
          top: '74px',
          right: 'max(4vw, 16px)',
          zIndex: 300,
          width: 'clamp(240px, 25vw, 295px)',
          /* pageSurfaceSystem glass tokens — deeper blur, more transparent */
          background: 'rgba(255, 255, 255, 0.45)',
          backdropFilter: 'blur(44px)',
          WebkitBackdropFilter: 'blur(44px)',
          border: '1px solid rgba(212, 196, 171, 0.82)',
          borderRadius: '1rem',
          boxShadow: [
            'inset 0 1px 0 rgba(255,255,255,0.75)',
            'inset 0 0 0 1px rgba(255,255,255,0.32)',
            '0 1px 0 rgba(255,255,255,0.65)',
            '0 12px 48px rgba(42,36,32,0.13)',
          ].join(', '),
          padding: '0.8rem 0.9rem',
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          color: '#2a2420',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'Space Mono', monospace", color: 'rgba(42,36,32,0.4)' }}>Scene</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(42,36,32,0.4)', fontSize: '1.6rem', lineHeight: 1, padding: '0 0.1rem' }}
            aria-label="Close"
          >×</button>
        </div>

        {GROUPS.map((group, gi) => (
          <div key={group.label}>
            <p style={{ margin: '0 0 0.36rem', fontSize: '0.86rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'Space Mono', monospace", color: 'rgba(42,36,32,0.3)' }}>
              {group.label}
            </p>
            {group.controls.map((ctrl) => (
              <div key={ctrl.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.42rem' }}>
                <span style={{ fontSize: '1.15rem', fontWeight: 500, color: 'rgba(42,36,32,0.6)', minWidth: '4.8rem' }}>{ctrl.label}</span>
                <input
                  type="range"
                  min={ctrl.min}
                  max={ctrl.max}
                  step={ctrl.step}
                  value={local[ctrl.key] ?? 0}
                  onChange={(e) => handleChange(ctrl.key, e.target.value)}
                  onPointerUp={(e) => handleCommit(ctrl.key, e.target.value)}
                />
                <span style={{ fontSize: '0.95rem', fontFamily: "'Space Mono', monospace", color: 'rgba(42,36,32,0.38)', minWidth: '3rem', textAlign: 'right' }}>
                  {fmt(local[ctrl.key])}
                </span>
              </div>
            ))}
            {gi < GROUPS.length - 1 && (
              <div style={{ height: '1px', background: 'rgba(42,36,32,0.07)', margin: '0.55rem 0' }} />
            )}
          </div>
        ))}

        <button
          onClick={handleReset}
          style={{
            marginTop: '0.75rem',
            width: '100%',
            padding: '0.5rem',
            background: 'rgba(42,36,32,0.05)',
            border: '1px solid rgba(42,36,32,0.1)',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            fontSize: '1.05rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'rgba(42,36,32,0.45)',
            fontFamily: "'Space Mono', monospace",
          }}
        >
          Reset
        </button>
      </div>
    </>
  );
};

export default React.memo(SceneSettingsPanel);
