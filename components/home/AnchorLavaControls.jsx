'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LAVA_BRAND_CSS,
  LAVA_BRAND_STOPS,
  LAVA_CUSTOM_PALETTE,
  LAVA_DEFAULTS,
  LAVA_ENUMS,
  LAVA_PALETTES,
  LAVA_PRESETS,
  applyLavaPreset,
  createLavaEngine,
  matchLavaPalette,
} from './lavaShaderEngine';

/*
 * Tuning panel for the anchor-band lava shader. Opened with `?lava=1` (see
 * AnchorLavaShader.jsx) and code-split, so it never ships to a normal visitor.
 *
 * Portaled to <body> on purpose: the band lives inside the scroll-driven stacked
 * card section, whose transforms would make a `position: fixed` panel position
 * itself against the card instead of the viewport.
 *
 * The preview strip runs a SECOND instance of the same engine at the band's real
 * 810x68 aspect, so what you tune here is exactly what the band renders — no
 * separate preview code path to drift out of sync.
 *
 * Slider maxima are deliberately far past tasteful. The defaults are the
 * restrained look; the top of each range is the overdrive, because you cannot
 * find a look inside a range that was already narrowed for you.
 */

const GROUPS = [
  {
    id: 'look',
    label: '01 · Surface',
    open: true,
    rows: [
      { key: 'look', label: 'Look', type: 'enum' },
      { key: 'fieldScale', label: 'Scale / density', min: 0.05, max: 10, step: 0.01 },
      { key: 'fieldSharpness', label: 'Sharpness', min: 0.2, max: 24, step: 0.05 },
      { key: 'fieldDetail', label: 'Detail / size', min: 0.02, max: 24, step: 0.02 },
      { key: 'fieldSpeed', label: 'Speed', min: 0, max: 6, step: 0.01 },
    ],
    note: 'Scale/Sharpness/Detail/Speed drive the procedural looks; lava uses group 03.',
  },
  {
    id: 'colour',
    label: '02 · Colour ramp',
    open: true,
    note: 'Palette sets all three stops at once — brand is the default. Every preset keeps whatever palette you pick.',
    rows: [
      // Not a stored param — writes the three stops below. See matchLavaPalette.
      { key: 'palette', label: 'Palette', type: 'palette' },
      { key: 'colorA', label: 'Stop 1 (left)', type: 'color' },
      { key: 'colorB', label: 'Stop 2 (mid)', type: 'color' },
      { key: 'colorC', label: 'Stop 3 (right)', type: 'color' },
      { key: 'rampAngle', label: 'Angle', min: 0, max: 360, step: 1, unit: '°' },
      { key: 'rampMid', label: 'Mid stop position', min: 0.05, max: 0.95, step: 0.01 },
      { key: 'rampBreathe', label: 'Ramp wobble', min: 0, max: 0.5, step: 0.002 },
      { key: 'rampBreatheRate', label: 'Ramp wobble rate', min: 0, max: 2, step: 0.01 },
      { key: 'bgColor', label: 'Background', type: 'color' },
      { key: 'bgMix', label: 'Background mix', min: 0, max: 1, step: 0.01, note: '0 = use the ramp' },
    ],
  },
  {
    id: 'blobs',
    label: '03 · Lava blobs',
    open: true,
    rows: [
      { key: 'blobCount', label: 'Count', min: 1, max: 24, step: 1, note: 'device-capped' },
      { key: 'radiusBase', label: 'Radius (band-heights)', min: 0.1, max: 4, step: 0.01 },
      { key: 'radiusSpread', label: 'Radius variation', min: 0, max: 3, step: 0.01 },
      { key: 'breatheAmount', label: 'Breathe depth', min: 0, max: 0.95, step: 0.01, note: 'capped: 1.0 zeroes the radius' },
      { key: 'breatheRate', label: 'Breathe rate', min: 0, max: 3, step: 0.01 },
      { key: 'seed', label: 'Arrangement seed', min: 0, max: 1, step: 0.001 },
      { key: 'kernelPower', label: 'Falloff power', min: 0.4, max: 6, step: 0.05, note: 'low = puffy' },
    ],
  },
  {
    id: 'motion',
    label: '04 · Lava motion',
    open: true,
    rows: [
      { key: 'flowMode', label: 'Animation type', type: 'enum' },
      { key: 'flowSpeed', label: 'Flow speed', min: 0, max: 8, step: 0.01 },
      { key: 'swayAmount', label: 'Sway distance', min: 0, max: 8, step: 0.01 },
      { key: 'swayRate', label: 'Sway rate', min: 0, max: 8, step: 0.01 },
      { key: 'spread', label: 'Spread across band', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    id: 'field',
    label: '05 · Shared shaping',
    open: true,
    rows: [
      { key: 'fieldLo', label: 'Edge threshold', min: 0, max: 1, step: 0.005 },
      { key: 'fieldHi', label: 'Core threshold', min: 0.02, max: 3, step: 0.01 },
      { key: 'warpAmount', label: 'Warp (melt)', min: 0, max: 2, step: 0.01 },
      { key: 'warpScale', label: 'Warp scale', min: 0.05, max: 3, step: 0.01 },
      { key: 'warpSpeed', label: 'Warp speed', min: 0, max: 4, step: 0.01 },
    ],
  },
  {
    id: 'response',
    label: '06 · Colour response',
    open: true,
    rows: [
      { key: 'intensity', label: 'Master intensity', min: 0, max: 3, step: 0.01 },
      { key: 'hueShift', label: 'Hue slide', min: 0, max: 2, step: 0.01 },
      { key: 'valueDepth', label: 'Gap darkness', min: 0, max: 1, step: 0.01 },
      { key: 'satDepth', label: 'Gap flatness', min: 0, max: 1.5, step: 0.01 },
      { key: 'glow', label: 'Core glow', min: 0, max: 1, step: 0.01, note: 'clips past ~0.15' },
      { key: 'rim', label: 'Edge rim', min: 0, max: 2, step: 0.01 },
      { key: 'bias', label: 'Neutral point', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    id: 'pointer',
    label: '07 · Pointer interaction',
    open: true,
    note: 'repel pushes the surface away · bulge is a lens with a calm centre · pinch contracts inward · ripple sends rings out.',
    rows: [
      { key: 'repelMode', label: 'Interaction type', type: 'enum' },
      { key: 'repelRadius', label: 'Reach', min: 0, max: 12, step: 0.05 },
      { key: 'repelPush', label: 'Force', min: 0, max: 14, step: 0.05 },
      { key: 'repelSoftness', label: 'Falloff', min: 0.2, max: 4, step: 0.01, note: 'low = wide' },
      { key: 'repelFreq', label: 'Ripple frequency', min: 0.2, max: 14, step: 0.05 },
      { key: 'repelThin', label: 'Thin / fatten', min: -1, max: 1, step: 0.01, note: 'lava only' },
      { key: 'attackMs', label: 'Ease in', min: 20, max: 3000, step: 10, unit: 'ms' },
      { key: 'releaseMs', label: 'Ease out', min: 20, max: 4000, step: 10, unit: 'ms' },
    ],
  },
  {
    id: 'render',
    label: '08 · Render',
    open: false,
    rows: [
      { key: 'fps', label: 'Frame cap', min: 10, max: 120, step: 1, unit: 'fps' },
      { key: 'dprCap', label: 'Pixel ratio cap', min: 1, max: 3, step: 0.5 },
      { key: 'dither', label: 'Dither', min: 0, max: 1, step: 1, note: '0 = off' },
    ],
  },
];

// Randomise stays inside the middle of each range: the extremes are reachable by
// hand but almost never a usable look, so rolling them just wastes rolls.
// Randomise keeps the current surface: rolling `look` too would mean the other
// rolled values belong to a look you are no longer viewing.
const RANDOM_SKIP = new Set(['fps', 'dprCap', 'dither', 'blobCount', 'rampMid', 'look']);

const PANEL_W = 348;

function shell(dragging) {
  return {
    position: 'fixed',
    top: 16,
    right: 16,
    zIndex: 2147483000,
    width: PANEL_W,
    maxHeight: 'calc(100vh - 32px)',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(14, 14, 18, 0.94)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    borderRadius: 12,
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.55)',
    color: 'rgba(255, 255, 255, 0.92)',
    fontFamily: "'Space Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    userSelect: dragging ? 'none' : 'auto',
    overflow: 'hidden',
  };
}

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '9px 10px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
  cursor: 'grab',
  touchAction: 'none',
  flexShrink: 0,
};

const btn = (accent) => ({
  appearance: 'none',
  border: `1px solid ${accent ? 'rgba(29, 219, 237, 0.55)' : 'rgba(255, 255, 255, 0.18)'}`,
  background: accent ? 'rgba(29, 219, 237, 0.14)' : 'rgba(255, 255, 255, 0.06)',
  color: accent ? '#8ef0fb' : 'rgba(255, 255, 255, 0.8)',
  borderRadius: 6,
  padding: '5px 8px',
  fontSize: 10,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
});

const rowStyle = { display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, marginBottom: 9 };
const labelStyle = { display: 'flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.62)' };
const numStyle = {
  width: 58,
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 4,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 10,
  padding: '2px 4px',
  textAlign: 'right',
};
const rangeStyle = { gridColumn: '1 / -1', width: '100%', accentColor: LAVA_BRAND_STOPS[0], margin: 0, height: 16 };

function AnchorLavaControls({ params, baseParams, onChange, onReset, onClose }) {
  const previewRef = useRef(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const getParams = useCallback(() => paramsRef.current, []);

  const [mounted, setMounted] = useState(false);
  // Read off the preview engine, not the band's: the preview is pinned in the
  // viewport and always running, so the readout is live even before you have
  // scrolled the real band into view.
  const [stats, setStats] = useState(null);
  const [tall, setTall] = useState(false);
  const [copied, setCopied] = useState('');
  const [pos, setPos] = useState(null); // {x, y} once dragged
  const [dragging, setDragging] = useState(false);
  const [openGroups, setOpenGroups] = useState(() =>
    GROUPS.reduce((acc, g) => ({ ...acc, [g.id]: g.open }), {})
  );

  useEffect(() => setMounted(true), []);

  // Second engine instance on the preview strip — same code path as the band.
  useEffect(() => {
    if (!mounted) return undefined;
    const canvas = previewRef.current;
    if (!canvas) return undefined;
    const engine = createLavaEngine({
      canvas,
      getParams,
      pointerTarget: canvas, // hover the preview strip to test the interaction
      onStats: setStats,
    });
    return () => engine?.destroy();
  }, [mounted, getParams]);

  const set = useCallback(
    (key, value) => {
      onChange({ ...paramsRef.current, [key]: value });
    },
    [onChange]
  );

  // Writes all three stops in ONE update — setting them one at a time would flash
  // two intermediate gradients through the live preview.
  const setPalette = useCallback(
    (name) => {
      const stops = LAVA_PALETTES[name];
      if (!stops) return;
      onChange({ ...paramsRef.current, colorA: stops[0], colorB: stops[1], colorC: stops[2] });
    },
    [onChange]
  );

  const randomise = useCallback(() => {
    const next = { ...paramsRef.current };
    for (const group of GROUPS) {
      for (const row of group.rows) {
        if (RANDOM_SKIP.has(row.key) || row.type === 'palette') continue;
        if (row.type === 'color') {
          // Stay on a vivid, saturated ring — muddy random RGB reads as a bug.
          const h = Math.floor(Math.random() * 360);
          next[row.key] = hslToHex(h, 82 + Math.random() * 14, 50 + Math.random() * 14);
        } else if (row.type === 'enum') {
          const opts = LAVA_ENUMS[row.key];
          next[row.key] = opts[Math.floor(Math.random() * opts.length)];
        } else {
          const lo = row.min + (row.max - row.min) * 0.12;
          const hi = row.min + (row.max - row.min) * 0.72;
          const v = lo + Math.random() * (hi - lo);
          next[row.key] = row.step >= 1 ? Math.round(v) : Number(v.toFixed(3));
        }
      }
    }
    onChange(next);
  }, [onChange]);

  const copy = useCallback((kind) => {
    const p = paramsRef.current;
    const text =
      kind === 'defaults'
        ? Object.keys(LAVA_DEFAULTS)
            .map((k) => `  ${k}: ${typeof p[k] === 'string' ? `'${p[k]}'` : p[k]},`)
            .join('\n')
        : JSON.stringify(p, null, 2);
    try {
      navigator.clipboard?.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(''), 1400);
    } catch {
      /* clipboard blocked — the console copy below is the fallback */
    }
    console.log('[AnchorLavaShader] tuned values:\n' + text);
  }, []);

  // Drag by the header. Pointer capture so a fast drag cannot lose the pointer.
  const onHeaderDown = useCallback((event) => {
    if (event.target.closest('button')) return;
    const panel = event.currentTarget.parentElement;
    const rect = panel.getBoundingClientRect();
    const offX = event.clientX - rect.left;
    const offY = event.clientY - rect.top;
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const move = (e) => {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 80, e.clientX - offX)),
        y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - offY)),
      });
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  const style = useMemo(() => {
    const s = shell(dragging);
    if (pos) {
      s.top = pos.y;
      s.left = pos.x;
      s.right = 'auto';
      // Recompute the cap from wherever it was dragged to, or dragging the panel
      // downward pushes its bottom (and the scroll container) off-screen.
      s.maxHeight = `calc(100vh - ${Math.round(pos.y)}px - 16px)`;
    }
    return s;
  }, [dragging, pos]);

  const changedKeys = useMemo(
    () => Object.keys(LAVA_DEFAULTS).filter((k) => params[k] !== baseParams[k]),
    [params, baseParams]
  );

  if (!mounted) return null;

  return createPortal(
    <div id="lava-controls-panel" style={style}>
      <div id="lava-controls-header" style={headerStyle} onPointerDown={onHeaderDown}>
        <div>
          <div style={{ letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 10 }}>
            Anchor lava
          </div>
          <div style={{ color: 'rgba(255,255,255,0.42)', fontSize: 9, marginTop: 2 }}>
            {stats ? `${stats.fps} fps · max ${stats.blobLimit} blobs` : 'starting…'}
            {changedKeys.length ? ` · ${changedKeys.length} changed` : ' · defaults'}
          </div>
        </div>
        <button type="button" style={btn(false)} onClick={onClose}>
          ×
        </button>
      </div>

      {/* minHeight: 0 is load-bearing. A flex item defaults to min-height:auto,
          which refuses to shrink below its content — so overflowY never engaged
          and the lower groups were simply clipped by the shell instead of
          scrolling. Do not remove it. */}
      <div
        id="lava-controls-scroll"
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
        }}
      >
        {/* Preview at the band's real 810x68 aspect so nothing reads differently
            here than it does on the card. Sticky rather than pinned outside the
            scroller, so a short viewport scrolls it away instead of leaving the
            controls no room at all. */}
        <div
          id="lava-controls-preview-shell"
          style={{
            padding: 10,
            position: 'sticky',
            top: 0,
            zIndex: 1,
            background: 'rgba(14, 14, 18, 0.97)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <canvas
            ref={previewRef}
            id="lava-controls-preview-canvas"
            style={{
              display: 'block',
              width: '100%',
              aspectRatio: tall ? '810 / 136' : '810 / 68',
              borderRadius: 6,
              // Shows for the instant before the preview engine's first frame.
              background: LAVA_BRAND_CSS,
            }}
          />
          <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
            <button type="button" style={btn(false)} onClick={() => setTall((v) => !v)}>
              {tall ? '1× height' : '2× height'}
            </button>
            <button type="button" style={btn(false)} onClick={randomise}>
              Randomise
            </button>
            <button type="button" style={btn(false)} onClick={onReset}>
              Reset defaults
            </button>
          </div>
          <div
            id="lava-controls-preset-row"
            style={{
              display: 'flex',
              gap: 4,
              marginTop: 8,
              flexWrap: 'wrap',
              paddingTop: 8,
              borderTop: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            {Object.keys(LAVA_PRESETS).map((name) => (
              <button
                key={name}
                type="button"
                style={{
                  ...btn(false),
                  fontSize: 9,
                  padding: '4px 7px',
                  textTransform: 'none',
                  letterSpacing: 0,
                  borderColor:
                    params.look === LAVA_PRESETS[name].look
                      ? 'rgba(29,219,237,0.45)'
                      : 'rgba(255,255,255,0.18)',
                }}
                onClick={() => onChange(applyLavaPreset(paramsRef.current, name))}
              >
                {name}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" style={btn(true)} onClick={() => copy('defaults')}>
              {copied === 'defaults' ? 'Copied ✓' : 'Copy as defaults'}
            </button>
            <button type="button" style={btn(false)} onClick={() => copy('json')}>
              {copied === 'json' ? 'Copied ✓' : 'Copy JSON'}
            </button>
          </div>
        </div>

      <div id="lava-controls-body" style={{ padding: '10px 10px 12px' }}>
        {GROUPS.map((group) => (
          <section key={group.id} style={{ marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setOpenGroups((o) => ({ ...o, [group.id]: !o[group.id] }))}
              style={{
                width: '100%',
                textAlign: 'left',
                appearance: 'none',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                color: 'rgba(255,255,255,0.78)',
                padding: '5px 7px',
                marginBottom: 8,
                fontFamily: 'inherit',
                fontSize: 10,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {openGroups[group.id] ? '▾' : '▸'} {group.label}
            </button>
            {openGroups[group.id] && group.note ? (
              <p style={{ color: 'rgba(255,255,255,0.34)', margin: '-2px 0 8px', lineHeight: 1.45 }}>
                {group.note}
              </p>
            ) : null}
            {openGroups[group.id]
              ? group.rows.map((row) => (
                  <Row
                    key={row.key}
                    palette={row.type === 'palette' ? matchLavaPalette(params) : undefined}
                    onSetPalette={setPalette}
                    // The blob array size is a shader uniform array, so the real
                    // ceiling is whatever this GPU reports — not the slider max.
                    row={
                      row.key === 'blobCount' && stats?.blobLimit
                        ? { ...row, max: stats.blobLimit }
                        : row
                    }
                    value={params[row.key]}
                    isDefault={params[row.key] === LAVA_DEFAULTS[row.key]}
                    onSet={set}
                  />
                ))
              : null}
          </section>
        ))}
        <p style={{ color: 'rgba(255,255,255,0.34)', lineHeight: 1.5, margin: '2px 0 0' }}>
          Values persist in localStorage while <code>?lava=1</code> is on. A normal page load always
          renders the committed defaults — use “Copy as defaults” and paste into
          <code> LAVA_DEFAULTS</code> in <code>lavaShaderEngine.js</code> to commit a look.
        </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Row({ row, value, isDefault, onSet, palette, onSetPalette }) {
  const dot = (
    <span
      aria-hidden="true"
      style={{
        width: 4,
        height: 4,
        borderRadius: 4,
        flexShrink: 0,
        background: isDefault ? 'rgba(255,255,255,0.16)' : LAVA_BRAND_STOPS[0],
      }}
    />
  );

  if (row.type === 'palette') {
    const isCustom = palette === LAVA_CUSTOM_PALETTE;
    return (
      <div style={rowStyle}>
        <span style={labelStyle}>
          <span
            aria-hidden="true"
            style={{
              width: 4,
              height: 4,
              borderRadius: 4,
              flexShrink: 0,
              background: isCustom ? LAVA_BRAND_STOPS[0] : 'rgba(255,255,255,0.16)',
            }}
          />
          {row.label}
        </span>
        <select
          value={palette}
          onChange={(e) => onSetPalette(e.target.value)}
          style={{ ...numStyle, width: 96, textAlign: 'left' }}
        >
          {isCustom ? (
            // Only offered while it IS the live state — picking it would be a no-op.
            <option value={LAVA_CUSTOM_PALETTE} style={{ color: '#000' }}>
              custom
            </option>
          ) : null}
          {Object.keys(LAVA_PALETTES).map((name) => (
            <option key={name} value={name} style={{ color: '#000' }}>
              {name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (row.type === 'color') {
    return (
      <div style={rowStyle}>
        <span style={labelStyle}>
          {dot}
          {row.label}
        </span>
        <span style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            value={value}
            onChange={(e) => onSet(row.key, e.target.value)}
            style={{ ...numStyle, width: 68, textAlign: 'left' }}
          />
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
            onChange={(e) => onSet(row.key, e.target.value)}
            style={{
              width: 24,
              height: 20,
              padding: 0,
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 4,
              background: 'none',
              cursor: 'pointer',
            }}
          />
        </span>
      </div>
    );
  }

  if (row.type === 'enum') {
    return (
      <div style={rowStyle}>
        <span style={labelStyle}>
          {dot}
          {row.label}
        </span>
        <select
          value={value}
          onChange={(e) => onSet(row.key, e.target.value)}
          style={{ ...numStyle, width: 96, textAlign: 'left' }}
        >
          {LAVA_ENUMS[row.key].map((o) => (
            <option key={o} value={o} style={{ color: '#000' }}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const clamp = (n) => Math.max(row.min, Math.min(row.max, n));
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>
        {dot}
        {row.label}
        {row.note ? (
          <em style={{ color: 'rgba(255,255,255,0.3)', fontStyle: 'normal' }}>({row.note})</em>
        ) : null}
      </span>
      <input
        type="number"
        value={value}
        min={row.min}
        max={row.max}
        step={row.step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onSet(row.key, clamp(n));
        }}
        style={numStyle}
      />
      <input
        type="range"
        min={row.min}
        max={row.max}
        step={row.step}
        value={value}
        onChange={(e) => onSet(row.key, Number(e.target.value))}
        style={rangeStyle}
      />
    </div>
  );
}

// Random colours are generated in HSL so they land vivid rather than muddy.
function hslToHex(h, s, l) {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = L - c / 2;
  const seg = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(hp) % 6];
  return (
    '#' +
    seg
      .map((v) =>
        Math.round((v + m) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

export default AnchorLavaControls;
