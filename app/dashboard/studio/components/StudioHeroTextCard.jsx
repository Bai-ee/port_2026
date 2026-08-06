'use client';

// HERO TEXT rail card — docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-HANDOFF.md
// Phase 1 ("UI: new components/StudioHeroTextCard.jsx"). Layer list
// (add/remove/duplicate/show-hide) + a full field editor for the selected
// layer, driven entirely by text-layers.js's exported schema/catalog.
//
// This component owns ZERO field state — every edit round-trips through
// onLayerChange(layerId, partialFields), the single mutation path named in
// the contract, so ClothStudio.jsx's SETTINGS_KEY blob (run through
// sanitizeTextLayers there) stays the one source of truth. Same
// "controlled from parent" discipline as StudioElementInspector's generic
// branch — no local state for any field value, only pure-UI concerns (there
// are none needed here yet).

import React from 'react';
import { Type, Eye, EyeOff, Plus, Copy, Trash2, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { GLASS, ui, RailCard, Slider } from './rail-ui';
import {
  GOOGLE_FONT_CATALOG, MAX_TEXT_LAYERS, fontById, TEXT_ANIM_INS, TEXT_ANIM_OUTS, TEXT_ANIM_EASES,
  TEXT_BACKDROPS, HERO_LAYOUT_PRESETS,
} from '../text-layers';

const ALIGN_OPTIONS = [
  { id: 'left', Icon: AlignLeft },
  { id: 'center', Icon: AlignCenter },
  { id: 'right', Icon: AlignRight },
];

// First ~14 chars of the layer's own text, else a positional fallback —
// keeps the layer-list pill readable without truncation logic living twice.
function layerLabel(layer, index) {
  const text = String(layer?.text || '').trim();
  if (!text) return `Layer ${index + 1}`;
  return text.length > 14 ? `${text.slice(0, 14)}…` : text;
}

// Selected-layer field editor — split out of the default export purely to
// keep the layer-list/add/remove logic above readable, matching
// StudioElementInspector's LockGroupsRow/PlacementWarningBanner split.
function SelectedLayerFields({ layer, font, fontStatusValue, onLayerChange, onPreviewAnim }) {
  const set = (partial) => onLayerChange(layer.id, partial);

  // Subtle status note next to the font picker (Locked Design Decision #5 —
  // never block on font load, but don't hide that a Google Font is still
  // loading or fell back to the system font while offline).
  const statusNote = fontStatusValue === 'loading' ? 'loading' : fontStatusValue === 'error' ? 'offline fallback' : '';

  const fontsByCategory = GOOGLE_FONT_CATALOG.reduce((acc, entry) => {
    (acc[entry.category] = acc[entry.category] || []).push(entry);
    return acc;
  }, {});

  return (
    <React.Fragment>
      <div id="hero-text-typography-section" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={ui.label}>TEXT</span>
          <textarea
            id="hero-text-input"
            value={layer.text}
            onChange={(e) => set({ text: e.target.value })}
            rows={3}
            style={{
              width: '100%', resize: 'vertical', fontFamily: GLASS.mono, fontSize: 12,
              color: '#fff', background: '#1a1a1a', border: '1px solid ' + GLASS.hair,
              borderRadius: 8, padding: '8px 10px', lineHeight: 1.4, boxSizing: 'border-box',
            }}
          />
        </label>

        <div style={{ display: 'flex', gap: 6 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
            <span style={ui.label}>
              FONT{statusNote ? <span style={{ color: statusNote === 'loading' ? GLASS.inkMute : '#dc2626' }}> · {statusNote}</span> : null}
            </span>
            <select
              value={layer.fontId}
              onChange={(e) => set({ fontId: e.target.value })}
              style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
            >
              {Object.entries(fontsByCategory).map(([category, entries]) => (
                <optgroup key={category} label={category.toUpperCase()}>
                  {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 84, flexShrink: 0 }}>
            <span style={ui.label}>WEIGHT</span>
            <select
              value={layer.weight}
              onChange={(e) => set({ weight: Number(e.target.value) })}
              style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
            >
              {(font?.weights || [400]).map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
        </div>

        <Slider label="SIZE" min={1} max={60} step={1} value={layer.sizePct} fmt={(v) => `${Math.round(v)}%`} onChange={(v) => set({ sizePct: v })} />
        <Slider label="LEADING" min={0.7} max={2.5} step={0.01} value={layer.leading} fmt={(v) => `${v.toFixed(2)}x`} onChange={(v) => set({ leading: v })} />
        <Slider label="TRACKING" min={-0.1} max={0.5} step={0.01} value={layer.tracking} fmt={(v) => `${v.toFixed(2)}em`} onChange={(v) => set({ tracking: v })} />
        <Slider label="OPACITY" min={0} max={1} step={0.01} value={layer.opacity} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ opacity: v })} />

        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={ui.label}>ALIGN</span>
          <div style={{ display: 'flex', gap: 5 }}>
            {ALIGN_OPTIONS.map(({ id, Icon }) => (
              <button
                key={id} type="button" title={id}
                style={{ ...ui.btn(layer.align === id), height: 30, flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => set({ align: id })}
              >
                <Icon size={14} strokeWidth={2.5} />
              </button>
            ))}
          </div>
        </label>
      </div>

      <div id="hero-text-position-section" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
        <span style={ui.label}>POSITION</span>
        {/* PLACEMENT — Overlay pins the text to the frame (always on top,
            camera-independent); In Scene mounts it INSIDE the 3D world, so
            it orbits with the camera, sits at DEPTH, and gets occluded. */}
        <label id="hero-text-placement-row" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={ui.label}>PLACEMENT</span>
          <div style={{ display: 'flex', gap: 5 }}>
            {[['overlay', 'Overlay'], ['scene', 'In Scene']].map(([id, label]) => (
              <button
                key={id} type="button"
                style={{ ...ui.btn((layer.placement || 'overlay') === id), height: 30, flex: 1, fontSize: 10 }}
                onClick={() => set({ placement: id })}
              >
                {label}
              </button>
            ))}
          </div>
          <span style={{ fontFamily: GLASS.sans, fontSize: 10, lineHeight: 1.4, color: GLASS.inkMute }}>
            {(layer.placement || 'overlay') === 'scene'
              ? 'Lives inside the 3D scene — orbits with the camera, can pass behind the device, and rides camera-move keyframes.'
              : 'Pinned to the frame on top of the render — never moves with the camera.'}
          </span>
        </label>
        {(layer.placement || 'overlay') === 'scene' ? (
          <Slider label="DEPTH (Z)" min={-1.5} max={1.5} step={0.02} value={layer.posZ} fmt={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`} onChange={(v) => set({ posZ: v })} />
        ) : null}
        <Slider label="ANCHOR X" min={0} max={1} step={0.01} value={layer.anchorX} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ anchorX: v })} />
        <Slider label="ANCHOR Y" min={0} max={1} step={0.01} value={layer.anchorY} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ anchorY: v })} />
        <Slider label="MAX WIDTH" min={10} max={100} step={1} value={layer.maxWidthPct} fmt={(v) => `${Math.round(v)}%`} onChange={(v) => set({ maxWidthPct: v })} />
      </div>

      <div id="hero-text-rotation-section" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
        <span style={ui.label}>ROTATION</span>
        <Slider label="ROT X" min={-80} max={80} step={1} value={layer.rotX} fmt={(v) => `${Math.round(v)}°`} onChange={(v) => set({ rotX: v })} />
        <Slider label="ROT Y" min={-80} max={80} step={1} value={layer.rotY} fmt={(v) => `${Math.round(v)}°`} onChange={(v) => set({ rotY: v })} />
        <Slider label="ROT Z" min={-180} max={180} step={1} value={layer.rotZ} fmt={(v) => `${Math.round(v)}°`} onChange={(v) => set({ rotZ: v })} />
      </div>

      <div id="hero-text-animation-section" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
        <span style={ui.label}>ANIMATION</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
            <span style={ui.label}>IN</span>
            <select
              value={layer.anim.in}
              onChange={(e) => set({ anim: { ...layer.anim, in: e.target.value } })}
              style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
            >
              {TEXT_ANIM_INS.map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
            <span style={ui.label}>OUT</span>
            <select
              value={layer.anim.out}
              onChange={(e) => set({ anim: { ...layer.anim, out: e.target.value } })}
              style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
            >
              {TEXT_ANIM_OUTS.map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}
            </select>
          </label>
        </div>
        <Slider label="IN DUR" min={0.1} max={5} step={0.1} value={layer.anim.inDur} fmt={(v) => `${v.toFixed(1)}s`} onChange={(v) => set({ anim: { ...layer.anim, inDur: v } })} />
        <Slider label="OUT DUR" min={0.1} max={5} step={0.1} value={layer.anim.outDur} fmt={(v) => `${v.toFixed(1)}s`} onChange={(v) => set({ anim: { ...layer.anim, outDur: v } })} />
        <Slider label="DELAY" min={0} max={10} step={0.1} value={layer.anim.delay} fmt={(v) => `${v.toFixed(1)}s`} onChange={(v) => set({ anim: { ...layer.anim, delay: v } })} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={ui.label}>EASE</span>
          <select
            value={layer.anim.ease}
            onChange={(e) => set({ anim: { ...layer.anim, ease: e.target.value } })}
            style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
          >
            {TEXT_ANIM_EASES.map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}
          </select>
        </label>
        <button
          type="button"
          title="Play this layer's in/out timing once, live"
          style={{ ...ui.btn(), height: 30, width: '100%', fontSize: 10 }}
          onClick={onPreviewAnim}
        >
          Preview in/out
        </button>
      </div>

      <div id="hero-text-color-row" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
        <input
          type="color" value={layer.color}
          onChange={(e) => set({ color: e.target.value })}
          style={{ width: 44, height: 28, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }}
        />
        <span style={ui.label}>COLOR</span>
        <span style={{ fontFamily: GLASS.mono, fontSize: 11, color: GLASS.inkSoft, textTransform: 'uppercase' }}>{layer.color}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button" title={layer.uppercase ? 'Uppercase on' : 'Uppercase off'}
          style={{ ...ui.btn(layer.uppercase), height: 28, width: 36, padding: 0, fontSize: 11, fontWeight: 800 }}
          onClick={() => set({ uppercase: !layer.uppercase })}
        >
          AA
        </button>
      </div>

      <div id="hero-text-backdrop-row" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
        <span style={ui.label}>BACKDROP</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            value={layer.backdrop}
            onChange={(e) => set({ backdrop: e.target.value })}
            style={{ ...ui.btn(), appearance: 'none', flex: 1 }}
          >
            {TEXT_BACKDROPS.map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}
          </select>
          <input
            type="color" value={layer.backdropColor}
            onChange={(e) => set({ backdropColor: e.target.value })}
            disabled={layer.backdrop === 'none'}
            style={{
              width: 44, height: 28, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', padding: 0,
              cursor: layer.backdrop === 'none' ? 'default' : 'pointer', opacity: layer.backdrop === 'none' ? 0.4 : 1,
            }}
          />
        </div>
        <Slider
          label="OPACITY" min={0} max={1} step={0.01} value={layer.backdropOpacity} disabled={layer.backdrop === 'none'}
          fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ backdropOpacity: v })}
        />
        <Slider
          label="PADDING" min={0} max={30} step={1} value={layer.backdropPadPct} disabled={layer.backdrop === 'none'}
          fmt={(v) => `${Math.round(v)}%`} onChange={(v) => set({ backdropPadPct: v })}
        />
      </div>
    </React.Fragment>
  );
}

export default function StudioHeroTextCard({
  open, onToggle,
  layers,
  selectedLayerId, onSelectLayer,
  onAddLayer, canAddLayer,
  onRemoveLayer, onDuplicateLayer,
  onLayerChange,
  onApplyLayoutPreset,
  fontStatus,
  onPreviewAnim,
}) {
  const layerList = layers || [];
  const selected = layerList.find((l) => l.id === selectedLayerId) || null;
  const selectedFont = selected ? fontById(selected.fontId) : null;

  return (
    <RailCard
      id="studio-hero-text-card" icon={<Type size={18} strokeWidth={2} />} title="Hero Text"
      subtitle={`${layerList.length}/${MAX_TEXT_LAYERS} layers`}
      color="#22d3ee" open={open} onToggle={onToggle}
    >
      {/* Phase 2 — LAYOUTS. Always shown (above the layer list/empty state
          below) — applying one is a valid way to START a headline from
          scratch, not just to restyle an existing one. REPLACES every
          current layer; see HERO_LAYOUT_PRESETS' own header in
          text-layers.js for why that's deliberate. */}
      <div id="hero-text-layouts-row" style={{ display: 'flex', gap: 6 }}>
        {HERO_LAYOUT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={`Replace all layers with the "${preset.label}" layout`}
            style={{ ...ui.btn(), height: 28, padding: '0 6px', fontSize: 9, flex: 1 }}
            onClick={() => onApplyLayoutPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {layerList.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>
            No headline yet — add one to overlay text on the scene.
          </span>
          <button
            style={{ ...ui.btn(), height: 30, padding: '0 12px', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={onAddLayer}
          >
            <Plus size={12} strokeWidth={2.5} /> Add Headline
          </button>
        </div>
      ) : (
        <React.Fragment>
          <div id="hero-text-layer-list-row" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {layerList.map((layer, i) => {
              const isSelected = layer.id === selectedLayerId;
              return (
                <div
                  key={layer.id}
                  onClick={() => onSelectLayer(layer.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                    background: isSelected ? 'rgba(0,0,0,0.06)' : 'transparent',
                    border: '1px solid ' + (isSelected ? GLASS.ink : 'transparent'),
                  }}
                >
                  <span style={{ fontFamily: GLASS.sans, fontSize: 12, fontWeight: 600, color: GLASS.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {layerLabel(layer, i)}
                  </span>
                  <button
                    type="button"
                    title={layer.on ? 'Hide' : 'Show'}
                    onClick={(e) => { e.stopPropagation(); onLayerChange(layer.id, { on: !layer.on }); }}
                    style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: layer.on ? GLASS.ink : GLASS.inkMute }}
                  >
                    {layer.on ? <Eye size={14} strokeWidth={2.5} /> : <EyeOff size={14} strokeWidth={2.5} />}
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              title={canAddLayer ? 'Add a new headline layer' : `Max ${MAX_TEXT_LAYERS} layers reached`}
              style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, opacity: canAddLayer ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              disabled={!canAddLayer}
              onClick={onAddLayer}
            >
              <Plus size={12} strokeWidth={2.5} /> Add
            </button>
            <button
              type="button"
              // Duplicating adds a layer against the same MAX_TEXT_LAYERS cap
              // as Add — the contract has no separate canDuplicateLayer flag,
              // so canAddLayer is the correct gate (never lets a duplicate
              // silently no-op past the cap).
              title={selected ? (canAddLayer ? 'Duplicate the selected layer' : `Max ${MAX_TEXT_LAYERS} layers reached`) : 'Select a layer first'}
              style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, opacity: selected && canAddLayer ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              disabled={!selected || !canAddLayer}
              onClick={() => onDuplicateLayer(selected.id)}
            >
              <Copy size={12} strokeWidth={2.5} /> Duplicate
            </button>
            <button
              type="button"
              title={selected ? 'Remove the selected layer' : 'Select a layer first'}
              style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, opacity: selected ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              disabled={!selected}
              onClick={() => onRemoveLayer(selected.id)}
            >
              <Trash2 size={12} strokeWidth={2.5} /> Remove
            </button>
          </div>

          {selected ? (
            <SelectedLayerFields
              layer={selected}
              font={selectedFont}
              fontStatusValue={fontStatus?.[selected.fontId]}
              onLayerChange={onLayerChange}
              onPreviewAnim={onPreviewAnim}
            />
          ) : null}
        </React.Fragment>
      )}
    </RailCard>
  );
}
