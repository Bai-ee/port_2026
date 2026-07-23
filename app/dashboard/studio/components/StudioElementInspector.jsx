'use client';

// Selected-element inspector — docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-
// PLAN.md. glass-petal-sphere keeps its own hand-written branch (untouched
// since Phase 1 — it maps onto the pre-existing `glass` state, not a generic
// instance shape). Every other type renders through a GENERIC, catalog-
// `controls`-driven renderer (bucket/key pairs — see catalog.js) added in
// Phase 2 once there was a second, third, fourth, and fifth type to
// generalize against.
//
// Two independent "is this control real" checks gate what renders:
//   - capability (per TYPE, from catalog previewSupported/finalRenderSupported):
//     an unknown/unsupported type shows an explicit UNSUPPORTED IN PREVIEW
//     state with no controls at all — never a control that silently does
//     nothing.
//   - bound (per INSTANCE, glass branch only, `isBound` prop): only the one
//     primary instance actually drives world.glassMesh; a glass duplicate is
//     real, editable data, but every control is disabled with an
//     explanatory banner. Every OTHER type's instances (added or duplicated
//     alike) genuinely render — see catalog.js `singleInstanceRenderer` /
//     elements/factories.js — so the generic branch only disables on
//     `!instance.enabled`, matching its own Show/Hide toggle.

import React from 'react';
import { SlidersHorizontal, TriangleAlert, Info } from 'lucide-react';
import { GLASS, ui, RailCard, Slider } from './rail-ui';
import { getCapabilityState, getCapabilityLabel, CAPABILITY_STATES } from '../elements/capability';
import GlbAssetControl from './GlbAssetControl';

const withAxis = (vec3, axis, value) => {
  const next = [...(vec3 || [0, 0, 0])];
  next[axis] = value;
  return next;
};

// 'intentional-overlap' (kinetic-rings/glass — elements/catalog.js
// intentionalOverlap) renders as neutral info, never amber — it's expected
// behavior, not something the selected element's controls need to fix.
function PlacementWarningBanner({ placementWarning }) {
  if (!placementWarning) return null;
  const isIntentional = placementWarning.code === 'intentional-overlap';
  return (
    <span style={{ ...ui.label, color: isIntentional ? GLASS.inkMute : '#f59e0b', lineHeight: 1.5, textTransform: 'none', fontSize: 11, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
      {isIntentional ? (
        <Info size={13} strokeWidth={2.5} style={{ flexShrink: 0, marginTop: 1 }} />
      ) : (
        <TriangleAlert size={13} strokeWidth={2.5} style={{ flexShrink: 0, marginTop: 1 }} />
      )}
      {placementWarning.message} for the selected placement check.
    </span>
  );
}

function GenericControl({ ctrl, instance, disabled, onChange, authedFetch, glbAssets, onRefreshGlbAssets }) {
  const value = instance[ctrl.bucket]?.[ctrl.key];
  // A motion.rotate=false toggle gates its sibling speed control, same as
  // the glass branch's ROTATE/ROTATE SPEED relationship — generalized by
  // bucket/key convention rather than hardcoded per type.
  const motionGated = ctrl.bucket === 'motion' && ctrl.key !== 'rotate'
    && typeof instance.motion?.rotate === 'boolean' && !instance.motion.rotate;
  const fieldDisabled = disabled || motionGated;

  if (ctrl.kind === 'glb-asset') {
    return (
      <GlbAssetControl
        instance={instance} disabled={disabled} onChange={onChange}
        authedFetch={authedFetch} glbAssets={glbAssets} onRefreshGlbAssets={onRefreshGlbAssets}
      />
    );
  }
  if (ctrl.kind === 'vec3') {
    const fmt = ctrl.unit === 'deg' ? (v) => `${Math.round(v)}°` : (v) => v.toFixed(2);
    return (
      <React.Fragment>
        <span style={ui.label}>{ctrl.label}</span>
        {['X', 'Y', 'Z'].map((axisLabel, axis) => (
          <Slider
            key={axis} label={axisLabel} min={ctrl.min} max={ctrl.max} step={ctrl.step}
            value={value[axis]} fmt={fmt} disabled={fieldDisabled}
            onChange={(v) => onChange(ctrl.bucket, ctrl.key, withAxis(value, axis, v))}
          />
        ))}
      </React.Fragment>
    );
  }
  if (ctrl.kind === 'uniform-scale') {
    return (
      <Slider
        label={ctrl.label} min={ctrl.min} max={ctrl.max} step={ctrl.step}
        value={value[0]} fmt={(v) => `${v.toFixed(2)}x`} disabled={fieldDisabled}
        onChange={(v) => onChange(ctrl.bucket, ctrl.key, [v, v, v])}
      />
    );
  }
  if (ctrl.kind === 'toggle') {
    return (
      <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: fieldDisabled ? 0.4 : 1 }}>
        {ctrl.label}
        <button style={{ ...ui.btn(value), height: 28, padding: '0 12px', fontSize: 10 }} disabled={fieldDisabled} onClick={() => onChange(ctrl.bucket, ctrl.key, !value)}>
          {value ? 'On' : 'Off'}
        </button>
      </span>
    );
  }
  if (ctrl.kind === 'color') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: fieldDisabled ? 0.4 : 1 }}>
        <input type="color" value={value} disabled={fieldDisabled} onChange={(e) => onChange(ctrl.bucket, ctrl.key, e.target.value)} style={{ width: 44, height: 28, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }} />
        <span style={ui.label}>{ctrl.label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: GLASS.mono, fontSize: 11, color: GLASS.inkSoft, textTransform: 'uppercase' }}>{value}</span>
      </label>
    );
  }
  // 'slider' (the default numeric control kind)
  return (
    <Slider
      label={ctrl.label} min={ctrl.min} max={ctrl.max} step={ctrl.step}
      value={value} fmt={(v) => (ctrl.step >= 1 ? String(Math.round(v)) : v.toFixed(2))} disabled={fieldDisabled}
      onChange={(v) => onChange(ctrl.bucket, ctrl.key, v)}
    />
  );
}

export default function StudioElementInspector({
  open, onToggle, instance, definition, isBound, onFieldChange, onGenericFieldChange, onApplyPreset, placementWarning,
  authedFetch, glbAssets, onRefreshGlbAssets,
}) {
  if (!instance) {
    return (
      <RailCard id="cloth-element-inspector-panel" icon={<SlidersHorizontal size={18} strokeWidth={2} />} title="Inspector" subtitle="No selection" color="#f59e0b" open={open} onToggle={onToggle}>
        <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>Select an element above.</span>
      </RailCard>
    );
  }

  const capabilityState = getCapabilityState(definition);
  if (instance.unsupported || capabilityState === CAPABILITY_STATES.UNSUPPORTED_IN_PREVIEW) {
    return (
      <RailCard id="cloth-element-inspector-panel" icon={<SlidersHorizontal size={18} strokeWidth={2} />} title="Inspector" subtitle={instance.name} color="#f59e0b" open={open} onToggle={onToggle}>
        <span style={{ ...ui.label, color: '#dc2626' }}>UNSUPPORTED IN PREVIEW</span>
        <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>This element type doesn&apos;t render in the Studio preview yet — no controls are shown so nothing here can look like it&apos;s working when it isn&apos;t.</span>
      </RailCard>
    );
  }

  const capabilityLabel = getCapabilityLabel(definition); // 'PREVIEW ONLY' for every Studio element today

  // ── Generic branch — every type EXCEPT glass-petal-sphere. Any instance
  // that reaches here genuinely renders (added or duplicated alike — only
  // glass-petal-sphere is singleInstanceRenderer, and that type always takes
  // the branch below instead), so the only disabled condition is its own
  // Show/Hide state. ──
  if (instance.type !== 'glass-petal-sphere') {
    const disabled = !instance.enabled;
    return (
      <RailCard
        id="cloth-element-inspector-panel" icon={<SlidersHorizontal size={18} strokeWidth={2} />} title="Inspector"
        subtitle={instance.name} color="#f59e0b" open={open} onToggle={onToggle}
      >
        {capabilityLabel ? <span style={{ ...ui.label, color: GLASS.inkMute }}>{capabilityLabel} — exports don&apos;t include this element yet</span> : null}
        {disabled ? (
          <span style={{ ...ui.label, color: GLASS.inkMute, lineHeight: 1.5, textTransform: 'none', fontSize: 11 }}>
            Hidden — turn on Show above to preview changes live.
          </span>
        ) : null}
        {!disabled ? <PlacementWarningBanner placementWarning={placementWarning} /> : null}

        {definition?.presets?.length ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: disabled ? 0.4 : 1 }}>
            <span style={ui.label}>PRESET</span>
            <select
              defaultValue=""
              disabled={disabled}
              onChange={(e) => { if (e.target.value) { onApplyPreset(e.target.value); e.target.value = ''; } }}
              style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
            >
              <option value="">Apply preset…</option>
              {definition.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
        ) : null}

        {(definition?.controls || []).map((ctrl) => (
          <GenericControl
            key={`${ctrl.bucket}.${ctrl.key}`} ctrl={ctrl} instance={instance} disabled={disabled} onChange={onGenericFieldChange}
            authedFetch={authedFetch} glbAssets={glbAssets} onRefreshGlbAssets={onRefreshGlbAssets}
          />
        ))}
      </RailCard>
    );
  }

  // ── Glass branch — special-cased since Phase 1, mirrors the existing
  // Glass rail card's own state (`glass`/`setGlassKey`), untouched. ──
  const disabled = !instance.enabled || !isBound;
  const pos = instance.transform.position;
  const rot = instance.transform.rotation;

  return (
    <RailCard
      id="cloth-element-inspector-panel" icon={<SlidersHorizontal size={18} strokeWidth={2} />} title="Inspector"
      subtitle={instance.name} color="#f59e0b" open={open} onToggle={onToggle}
    >
      {capabilityLabel ? <span style={{ ...ui.label, color: GLASS.inkMute }}>{capabilityLabel} — exports don&apos;t include this element yet</span> : null}
      {!isBound ? (
        <span style={{ ...ui.label, color: '#dc2626', lineHeight: 1.5, textTransform: 'none', fontSize: 11 }}>
          Not rendered — this is a duplicate. Its values persist with your Studio settings (including across reload), but nothing on screen reflects them until multi-instance rendering ships. Controls are disabled to avoid implying otherwise.
        </span>
      ) : null}
      {!disabled ? <PlacementWarningBanner placementWarning={placementWarning} /> : null}

      {definition?.presets?.length ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: isBound ? 1 : 0.4 }}>
          <span style={ui.label}>PRESET</span>
          <select
            defaultValue=""
            disabled={!isBound}
            onChange={(e) => { if (e.target.value) { onApplyPreset(e.target.value); e.target.value = ''; } }}
            style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
          >
            <option value="">Apply preset…</option>
            {definition.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      ) : null}

      <span style={ui.label}>POSITION</span>
      <Slider label="X" min={-1.5} max={1.5} step={0.05} value={pos[0]} onChange={(v) => onFieldChange('position', withAxis(pos, 0, v))} fmt={(v) => v.toFixed(2)} disabled={disabled} />
      <Slider label="Y" min={-1.5} max={1.5} step={0.05} value={pos[1]} onChange={(v) => onFieldChange('position', withAxis(pos, 1, v))} fmt={(v) => v.toFixed(2)} disabled={disabled} />
      <Slider label="Z" min={-1.5} max={1.5} step={0.05} value={pos[2]} onChange={(v) => onFieldChange('position', withAxis(pos, 2, v))} fmt={(v) => v.toFixed(2)} disabled={disabled} />

      <span style={ui.label}>ROTATION (DEG)</span>
      <Slider label="X" min={-180} max={180} step={5} value={rot[0]} onChange={(v) => onFieldChange('rotationOffset', withAxis(rot, 0, v))} fmt={(v) => `${Math.round(v)}°`} disabled={disabled} />
      <Slider label="Y" min={-180} max={180} step={5} value={rot[1]} onChange={(v) => onFieldChange('rotationOffset', withAxis(rot, 1, v))} fmt={(v) => `${Math.round(v)}°`} disabled={disabled} />
      <Slider label="Z" min={-180} max={180} step={5} value={rot[2]} onChange={(v) => onFieldChange('rotationOffset', withAxis(rot, 2, v))} fmt={(v) => `${Math.round(v)}°`} disabled={disabled} />

      {/* Scale is uniform-only — the schema stores it as a vec3 (per-axis-
          ready) but this control always sets all three components equally;
          per-axis scale UI is deferred to a later phase. */}
      <Slider label="SCALE (UNIFORM)" min={0.4} max={2.2} step={0.02} value={instance.transform.scale[0]} onChange={(v) => onFieldChange('scale', v)} fmt={(v) => `${v.toFixed(2)}x`} disabled={disabled} />
      <span style={{ ...ui.label, color: GLASS.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: disabled ? 0.4 : 1 }}>
        ROTATE
        <button style={{ ...ui.btn(instance.motion.rotate), height: 28, padding: '0 12px', fontSize: 10 }} disabled={disabled} onClick={() => onFieldChange('rotate', !instance.motion.rotate)}>
          {instance.motion.rotate ? 'On' : 'Off'}
        </button>
      </span>
      <Slider label="ROTATE SPEED" min={0.05} max={2} step={0.05} value={instance.motion.rotSpeed} onChange={(v) => onFieldChange('rotSpeed', v)} fmt={(v) => `${v.toFixed(2)}x`} disabled={disabled || !instance.motion.rotate} />
      <Slider label="CLARITY" min={0} max={0.4} step={0.01} value={instance.material.clarity} onChange={(v) => onFieldChange('clarity', v)} fmt={(v) => v.toFixed(2)} disabled={disabled} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: disabled ? 0.4 : 1 }}>
        <input type="color" value={instance.material.tint} disabled={disabled} onChange={(e) => onFieldChange('tint', e.target.value)} style={{ width: 44, height: 28, border: '1px solid ' + GLASS.hair, borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }} />
        <span style={ui.label}>TINT</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: GLASS.mono, fontSize: 11, color: GLASS.inkSoft, textTransform: 'uppercase' }}>{instance.material.tint}</span>
      </label>
      {isBound ? (
        <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
          Mirrors the Glass card below — both edit the same state during this migration phase.
        </span>
      ) : null}
    </RailCard>
  );
}
