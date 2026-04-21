'use client';

import React, { useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';

const AppCanvas = dynamic(() => import('../../ox.jsx'), { ssr: false });

const PRESETS = {
  dark: '#0a0a0a',
  light: '#f5f5f0',
  midnight: '#050510',
  warm: '#1a1208',
  white: '#ffffff',
};

const DEFAULT_PARAMS = {
  scale: 175,
  chaos: 0,
  flow: 0,
  particleCount: 25000,
  particleSize: 0.2,
  speedMult: 0,
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
  rotationX: 0,
  rotationY: 0.73,
  rotationZ: 0,
  tireSpinAxis: 'x',
  tireSpinSpeed: 1.9,
  torusPulse: 0,
  animationSpeed: 0.1,
  opacity: 0.23,
};

const CONTROLS = [
  { key: 'hueOffset',      label: 'Hue Offset',       min: 0,     max: 1,      step: 0.01 },
  { key: 'saturation',     label: 'Saturation',        min: 0,     max: 1,      step: 0.01 },
  { key: 'lightness',      label: 'Lightness',         min: 0,     max: 1,      step: 0.01 },
  { key: 'opacity',        label: 'Opacity',           min: 0,     max: 1,      step: 0.01 },
  { key: 'hueSpeed',       label: 'Hue Speed',         min: 0,     max: 0.2,    step: 0.001 },
  { key: 'bloomStrength',  label: 'Bloom Strength',    min: 0,     max: 3,      step: 0.05 },
  { key: 'bloomThreshold', label: 'Bloom Threshold',   min: 0,     max: 1,      step: 0.01 },
  { key: 'bloomRadius',    label: 'Bloom Radius',      min: 0,     max: 2,      step: 0.05 },
  { key: 'chaos',          label: 'Chaos',             min: 0,     max: 3,      step: 0.01 },
  { key: 'flow',           label: 'Flow',              min: 0,     max: 1,      step: 0.01 },
  { key: 'waveAmplitude',  label: 'Wave Amplitude',    min: 0,     max: 15,     step: 0.1 },
  { key: 'particleSize',   label: 'Particle Size',     min: 0.05,  max: 3,      step: 0.05 },
  { key: 'speedMult',      label: 'Speed',             min: 0,     max: 2,      step: 0.01 },
  { key: 'animationSpeed', label: 'Animation Speed',   min: 0.1,   max: 5,      step: 0.1 },
  { key: 'particleCount',  label: 'Particle Count',    min: 1000,  max: 50000,  step: 500 },
  { key: 'scale',          label: 'Scale',             min: 50,    max: 400,    step: 5 },
];

export default function CapturePage() {
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [bg, setBg] = useState('#f5f5f0');
  const [panelOpen, setPanelOpen] = useState(true);
  const liveParamsRef = useRef(DEFAULT_PARAMS);

  const updateParam = useCallback((key, value) => {
    const next = { ...liveParamsRef.current, [key]: value };
    liveParamsRef.current = next;
    setParams(next);
  }, []);

  return (
    <div id="capture-root" style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: bg }}>
      {/* Three.js canvas — fullscreen, no overlay copy */}
      <AppCanvas
        params={params}
        liveParamsRef={liveParamsRef}
        backgroundColor={bg}
      />

      {/* Toggle button */}
      <button
        id="capture-panel-toggle"
        onClick={() => setPanelOpen((v) => !v)}
        style={{
          position: 'fixed',
          top: 16,
          right: panelOpen ? 276 : 16,
          zIndex: 100,
          background: 'rgba(0,0,0,0.7)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 6,
          padding: '6px 12px',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'monospace',
          backdropFilter: 'blur(8px)',
          transition: 'right 0.2s ease',
        }}
      >
        {panelOpen ? '✕ Hide' : '⚙ Controls'}
      </button>

      {/* Controls panel */}
      <div
        id="capture-controls-panel"
        style={{
          position: 'fixed',
          top: 0,
          right: panelOpen ? 0 : -280,
          width: 260,
          height: '100dvh',
          background: 'rgba(0,0,0,0.82)',
          backdropFilter: 'blur(12px)',
          borderLeft: '1px solid rgba(255,255,255,0.1)',
          zIndex: 99,
          overflowY: 'auto',
          padding: '16px 14px 32px',
          transition: 'right 0.2s ease',
          boxSizing: 'border-box',
          fontFamily: 'monospace',
          color: '#e0e0e0',
        }}
      >
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', margin: '0 0 14px' }}>
          Capture Controls
        </p>

        {/* Background presets */}
        <div id="capture-bg-section" style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 6 }}>Background</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {Object.entries(PRESETS).map(([name, hex]) => (
              <button
                key={name}
                onClick={() => setBg(hex)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  background: hex,
                  border: bg === hex ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer',
                  title: name,
                }}
                title={name}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={bg}
              onChange={(e) => setBg(e.target.value)}
              style={{ width: 36, height: 28, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
            />
            <span style={{ fontSize: 11, color: '#888' }}>{bg}</span>
          </div>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0 0 14px' }} />

        {/* Rotation section */}
        <div id="capture-rotation-section" style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', margin: '0 0 10px' }}>
            360 Rotation
          </p>

          {/* Spin axis */}
          <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 6 }}>Spin Axis</label>
          <div style={{ display: 'flex', gap: 5, marginBottom: 12 }}>
            {['x', 'y', 'z', 'none'].map((axis) => (
              <button
                key={axis}
                onClick={() => updateParam('tireSpinAxis', axis === 'none' ? 'z' : axis) || (axis === 'none' && updateParam('tireSpinSpeed', 0))}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  background: (axis === 'none' ? params.tireSpinSpeed === 0 : params.tireSpinAxis === axis && params.tireSpinSpeed > 0)
                    ? 'rgba(126,184,168,0.35)' : 'rgba(255,255,255,0.06)',
                  color: (axis === 'none' ? params.tireSpinSpeed === 0 : params.tireSpinAxis === axis && params.tireSpinSpeed > 0)
                    ? '#7eb8a8' : '#aaa',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {axis}
              </button>
            ))}
          </div>

          {/* Stabilize toggle */}
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={() => {
                const stable = params.torusPulse !== 0;
                updateParam('torusPulse', stable ? 0 : 1);
                if (stable) updateParam('chaos', 0);
              }}
              style={{
                width: '100%',
                padding: '6px 0',
                fontSize: 11,
                fontFamily: 'monospace',
                background: params.torusPulse === 0 ? 'rgba(126,184,168,0.35)' : 'rgba(255,255,255,0.06)',
                color: params.torusPulse === 0 ? '#7eb8a8' : '#aaa',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 4,
                cursor: 'pointer',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              {params.torusPulse === 0 ? '✓ Shape Locked' : 'Lock Shape for Capture'}
            </button>
            {params.torusPulse === 0 && (
              <div style={{ fontSize: 10, color: '#7eb8a8', marginTop: 4 }}>
                Pulse + chaos frozen — clean 360 loop
              </div>
            )}
          </div>

          {/* Spin speed */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <label style={{ fontSize: 11, color: '#aaa' }}>Spin Speed</label>
              <span style={{ fontSize: 11, color: '#ccc' }}>{params.tireSpinSpeed.toFixed(3)}</span>
            </div>
            <input
              type="range"
              min={0} max={2} step={0.001}
              value={params.tireSpinSpeed}
              onChange={(e) => updateParam('tireSpinSpeed', parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#7eb8a8' }}
            />
            {params.tireSpinSpeed > 0 && (
              <div style={{ fontSize: 10, color: '#7eb8a8', marginTop: 3, textAlign: 'right' }}>
                loop: {(2 * Math.PI / params.tireSpinSpeed).toFixed(1)}s
              </div>
            )}
          </div>

          {/* Static tilt */}
          {[
            { key: 'rotationX', label: 'Tilt X' },
            { key: 'rotationY', label: 'Tilt Y' },
            { key: 'rotationZ', label: 'Tilt Z' },
          ].map(({ key, label }) => (
            <div key={key} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <label style={{ fontSize: 11, color: '#aaa' }}>{label}</label>
                <span style={{ fontSize: 11, color: '#ccc' }}>{params[key].toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={-Math.PI} max={Math.PI} step={0.01}
                value={params[key]}
                onChange={(e) => updateParam(key, parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#7eb8a8' }}
              />
            </div>
          ))}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0 0 14px' }} />

        {/* Param sliders */}
        <div id="capture-sliders-section">
          {CONTROLS.map(({ key, label, min, max, step }) => (
            <div key={key} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <label style={{ fontSize: 11, color: '#aaa' }}>{label}</label>
                <span style={{ fontSize: 11, color: '#ccc', minWidth: 42, textAlign: 'right' }}>
                  {typeof params[key] === 'number' ? params[key].toFixed(key === 'particleCount' ? 0 : 2) : '—'}
                </span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={params[key] ?? min}
                onChange={(e) => updateParam(key, parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#7eb8a8' }}
              />
            </div>
          ))}
        </div>

        {/* Reset */}
        <button
          id="capture-reset-btn"
          onClick={() => {
            liveParamsRef.current = { ...DEFAULT_PARAMS };
            setParams({ ...DEFAULT_PARAMS });
          }}
          style={{
            marginTop: 8,
            width: '100%',
            padding: '8px 0',
            background: 'rgba(255,255,255,0.06)',
            color: '#ccc',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 5,
            cursor: 'pointer',
            fontSize: 11,
            letterSpacing: '0.06em',
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
