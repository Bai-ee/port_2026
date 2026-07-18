'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
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

// ── Homepage hero scroll morph, replayable without scrolling ──
// Mirrors HERO_PARAMS_END / getScrollBase / interpolateHeroParams in
// HomePage.jsx (the ScrollTrigger scrub over #hero-section). Keep in sync
// with HomePage.jsx when the hero animation range changes.
const HERO_MORPH_END = {
  scale: 190,
  chaos: 1.55,
  flow: 0,
  particleSize: 1,
  speedMult: 0.43,
  bloomThreshold: 1,
  hueOffset: 0.5,
  waveAmplitude: 0.5,
  saturation: 1,
  lightness: 0.55,
  torusMajorRadius: 0.7,
  torusTubeRadius: 2,
  animationSpeed: 3.4,
  opacity: 0.18,
};

// Params outside the morph range (rotation, spin, pulse…) stay at the user's
// panel values for the whole morph — same rule as the homepage scroll.
function morphParamsAt(baseParams, progress) {
  const next = { ...baseParams };
  Object.keys(HERO_MORPH_END).forEach((key) => {
    const startValue = baseParams[key];
    const endValue = HERO_MORPH_END[key];
    if (typeof startValue === 'number' && typeof endValue === 'number') {
      next[key] = startValue + (endValue - startValue) * progress;
      return;
    }
    next[key] = progress < 0.5 ? startValue : endValue;
  });
  return next;
}

const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

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

// Interpolate the keyframe timeline at position t (0..1). Numeric params lerp
// with a per-segment smoothstep (gentle in/out at every keyframe); non-numeric
// (tireSpinAxis) step over at the segment midpoint.
function sampleTimeline(keyframes, t) {
  if (!keyframes.length) return null;
  if (t <= keyframes[0].t) return { ...keyframes[0].params };
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return { ...last.params };
  let a = keyframes[0];
  let b = last;
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    if (t >= keyframes[i].t && t <= keyframes[i + 1].t) { a = keyframes[i]; b = keyframes[i + 1]; break; }
  }
  const raw = (t - a.t) / ((b.t - a.t) || 1);
  const s = raw * raw * (3 - 2 * raw);
  const next = { ...a.params };
  new Set([...Object.keys(a.params), ...Object.keys(b.params)]).forEach((key) => {
    const av = a.params[key];
    const bv = b.params[key];
    if (typeof av === 'number' && typeof bv === 'number') next[key] = av + (bv - av) * s;
    else next[key] = s < 0.5 ? av : bv;
  });
  return next;
}

const defaultKeyframes = () => [
  { t: 0, params: { ...DEFAULT_PARAMS } },
  // Out-of-box end pose = the homepage hero's scrolled-out look.
  { t: 1, params: morphParamsAt(DEFAULT_PARAMS, 1) },
];

export default function CapturePage() {
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [bg, setBg] = useState('#f5f5f0');
  const [panelOpen, setPanelOpen] = useState(true);
  const liveParamsRef = useRef(DEFAULT_PARAMS);
  // Keyframe timeline rig: scrub anywhere, sculpt params, "Set keyframe" pins
  // the current look at that position; Play yoyo-loops through the keyframes.
  // liveParamsRef is read per-frame by the canvas, so playback mutates it
  // directly at 60fps.
  const [keyframes, setKeyframes] = useState(defaultKeyframes);
  const keyframesRef = useRef(null);
  if (keyframesRef.current === null) keyframesRef.current = defaultKeyframes();
  const rafRef = useRef(0);
  const [timelineT, setTimelineT] = useState(0);
  const [duration, setDuration] = useState(4);
  const [playing, setPlaying] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false); // sliders touched since last sample/commit

  const applyTimeline = useCallback((t) => {
    const next = sampleTimeline(keyframesRef.current, t);
    if (!next) return;
    liveParamsRef.current = next;
    setParams(next);
    setTimelineT(t);
    setDraftDirty(false);
  }, []);

  const stopPlayback = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  }, []);

  // Yoyo playback: 0→1→0 forever, eased at the turnarounds for a smooth flow.
  const playTimeline = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setPlaying(true);
    const durationMs = Math.max(0.5, duration) * 1000;
    const startedAt = performance.now();
    const tick = (now) => {
      const cycle = ((now - startedAt) % (durationMs * 2)) / durationMs;
      const linear = cycle <= 1 ? cycle : 2 - cycle;
      applyTimeline(easeInOutQuad(linear));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [applyTimeline, duration]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Pin the current live look as a keyframe at the playhead (replaces any
  // keyframe within 2% of it).
  const setKeyframeAtPlayhead = useCallback(() => {
    const snapshot = { t: timelineT, params: { ...liveParamsRef.current } };
    const next = keyframesRef.current
      .filter((kf) => Math.abs(kf.t - timelineT) > 0.02)
      .concat(snapshot)
      .sort((a, b) => a.t - b.t);
    keyframesRef.current = next;
    setKeyframes(next);
    setDraftDirty(false);
  }, [timelineT]);

  const deleteKeyframe = useCallback((t) => {
    const next = keyframesRef.current.filter((kf) => kf.t !== t);
    keyframesRef.current = next;
    setKeyframes(next);
  }, []);

  // Slider edits sculpt a draft at the playhead — pin with "Set keyframe".
  const updateParam = useCallback((key, value) => {
    const next = { ...liveParamsRef.current, [key]: value };
    liveParamsRef.current = next;
    setParams(next);
    setDraftDirty(true);
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

        {/* Keyframe timeline — scrub, sculpt, pin, then yoyo-play the flow */}
        <div id="capture-timeline-section" style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', margin: '0 0 10px' }}>
            Timeline · {keyframes.length} keyframes
          </p>

          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <label style={{ fontSize: 11, color: '#aaa' }}>Playhead</label>
              <span style={{ fontSize: 11, color: draftDirty ? '#e8c46a' : '#ccc' }}>
                {Math.round(timelineT * 100)}%{draftDirty ? ' · edited' : ''}
              </span>
            </div>
            {/* Keyframe tick marks over the scrub bar */}
            <div style={{ position: 'relative', height: 6, margin: '0 2px 2px' }}>
              {keyframes.map((kf) => (
                <span
                  key={kf.t}
                  style={{
                    position: 'absolute',
                    left: `${kf.t * 100}%`,
                    transform: 'translateX(-50%)',
                    width: 4, height: 6, borderRadius: 1,
                    background: Math.abs(kf.t - timelineT) <= 0.02 ? '#e8c46a' : '#7eb8a8',
                  }}
                />
              ))}
            </div>
            <input
              type="range"
              min={0} max={1} step={0.005}
              value={timelineT}
              onChange={(e) => { stopPlayback(); applyTimeline(parseFloat(e.target.value)); }}
              style={{ width: '100%', accentColor: '#7eb8a8' }}
            />
          </div>

          {/* Pin / clear at the playhead */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              onClick={setKeyframeAtPlayhead}
              style={{
                flex: 2,
                padding: '6px 0',
                fontSize: 11,
                fontFamily: 'monospace',
                background: draftDirty ? 'rgba(232,196,106,0.3)' : 'rgba(255,255,255,0.06)',
                color: draftDirty ? '#e8c46a' : '#aaa',
                border: `1px solid ${draftDirty ? 'rgba(232,196,106,0.5)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              ● Set keyframe at {Math.round(timelineT * 100)}%
            </button>
            {keyframes.some((kf) => Math.abs(kf.t - timelineT) <= 0.02) && keyframes.length > 1 ? (
              <button
                onClick={() => deleteKeyframe(keyframes.find((kf) => Math.abs(kf.t - timelineT) <= 0.02).t)}
                style={{ flex: 1, padding: '6px 0', fontSize: 11, fontFamily: 'monospace', background: 'rgba(159,31,23,0.18)', color: '#e08a84', border: '1px solid rgba(159,31,23,0.4)', borderRadius: 4, cursor: 'pointer' }}
              >
                ✕ Remove
              </button>
            ) : null}
          </div>

          {/* Keyframe chips — click to jump */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
            {keyframes.map((kf) => (
              <button
                key={kf.t}
                onClick={() => { stopPlayback(); applyTimeline(kf.t); }}
                style={{
                  padding: '3px 8px',
                  fontSize: 10,
                  fontFamily: 'monospace',
                  background: Math.abs(kf.t - timelineT) <= 0.02 ? 'rgba(126,184,168,0.35)' : 'rgba(255,255,255,0.06)',
                  color: Math.abs(kf.t - timelineT) <= 0.02 ? '#7eb8a8' : '#aaa',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 999,
                  cursor: 'pointer',
                }}
              >
                {Math.round(kf.t * 100)}%
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: '#aaa' }}>One way</label>
            <input
              type="number"
              min={0.5} max={60} step={0.5}
              value={duration}
              onChange={(e) => setDuration(parseFloat(e.target.value) || 4)}
              style={{ width: 56, background: 'rgba(255,255,255,0.08)', color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '3px 6px', fontSize: 11, fontFamily: 'monospace' }}
            />
            <span style={{ fontSize: 11, color: '#888' }}>sec · loop {(duration * 2).toFixed(1)}s</span>
          </div>

          <button
            onClick={() => (playing ? stopPlayback() : playTimeline())}
            style={{
              width: '100%',
              padding: '8px 0',
              fontSize: 12,
              fontFamily: 'monospace',
              background: playing ? 'rgba(126,184,168,0.35)' : 'rgba(255,255,255,0.06)',
              color: playing ? '#7eb8a8' : '#ccc',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 5,
              cursor: 'pointer',
              letterSpacing: '0.06em',
            }}
          >
            {playing ? '■ Stop' : '▶ Play · loop back & forth'}
          </button>
          <div style={{ fontSize: 10, color: '#7eb8a8', marginTop: 6 }}>
            Scrub → tweak sliders → Set keyframe. Play glides through every keyframe 0→100→0 on repeat.
          </div>
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
            stopPlayback();
            const fresh = defaultKeyframes();
            keyframesRef.current = fresh;
            setKeyframes(fresh);
            liveParamsRef.current = { ...DEFAULT_PARAMS };
            setParams({ ...DEFAULT_PARAMS });
            setTimelineT(0);
            setDraftDirty(false);
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
