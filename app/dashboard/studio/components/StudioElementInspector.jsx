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
import { SlidersHorizontal, TriangleAlert, Info, Lock, Unlock } from 'lucide-react';
import { GLASS, ui, RailCard, Slider } from './rail-ui';
import { getCapabilityState, getCapabilityLabel, CAPABILITY_STATES } from '../elements/capability';
import GlbAssetControl from './GlbAssetControl';
import LogoArtworkControl from './LogoArtworkControl';
import DeviceScreenControl from './DeviceScreenControl';
import ImageLayerControl from './ImageLayerControl';
import CloudTemplateSection from './CloudTemplateSection';
import { tshirtModelLoadStatusView } from '../elements/tshirt-model-status';

const LOCK_GROUP_LABELS = { material: 'Material', motion: 'Motion', appearance: 'Appearance' };

// Per-parameter-group lock row — docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-
// 4K-PLAN.md "allow the user to lock any element or parameter group". Only
// offers a lock for a bucket the type actually declares randomRanges for —
// locking an empty bucket would toggle state Randomize could never have
// touched anyway. Deliberately NOT gated on the element's own disabled/hidden
// state (matches the always-clickable whole-element Lock icon on the
// Elements card): a lock is a future-randomize preference, not a live preview
// control, so there's no reason hiding the element should block setting it.
function LockGroupsRow({ instance, lockableGroups, onToggleLockGroup }) {
  if (!lockableGroups.length) return null;
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={ui.label}>LOCK GROUPS</span>
      <div style={{ display: 'flex', gap: 5 }}>
        {lockableGroups.map((group) => {
          const locked = Boolean(instance.random?.groups?.[group]);
          const label = LOCK_GROUP_LABELS[group] || group;
          return (
            <button
              key={group}
              type="button"
              title={locked ? `${label} is locked — Randomize won’t touch it` : `Lock ${label} out of Randomize`}
              onClick={() => onToggleLockGroup(instance.id, group)}
              style={{
                height: 28, padding: '0 8px', fontSize: 10, flex: 1,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                borderRadius: 999, cursor: 'pointer',
                fontFamily: GLASS.sans, fontWeight: 600, letterSpacing: '0.01em',
                background: locked ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.6)',
                border: '1px solid ' + (locked ? '#f59e0b' : GLASS.hair),
                color: locked ? '#b45309' : GLASS.ink,
              }}
            >
              {locked ? <Lock size={11} strokeWidth={2.5} /> : <Unlock size={11} strokeWidth={2.5} />}
              {label}
            </button>
          );
        })}
      </div>
      <span style={{ fontFamily: GLASS.sans, fontSize: 10, lineHeight: 1.4, color: GLASS.inkMute }}>
        Locked groups are skipped by both Randomize and All for this element.
      </span>
    </label>
  );
}

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

// tshirt-model's async load state (idle/loading/loaded/error/disposed —
// elements/factories.js tshirtModelApplyInstance), surfaced honestly
// instead of leaving a failed load invisible until the user happens to
// edit the element (Codex P1 review, Part B round 2). The actual view
// decision (what to show, whether Retry appears) lives in the pure,
// independently-tested tshirtModelLoadStatusView — this component only
// renders whatever it returns. While loading, no Retry button exists at
// all (view.showRetry is false), which is what actually prevents repeated
// retry clicks from piling up — not a disabled-button state that could
// still race the click handler.
function LoadStatusBanner({ loadStatus, onRetry }) {
  const view = tshirtModelLoadStatusView(loadStatus);
  if (!view.visible) return null;
  if (view.kind === 'loading') {
    return <span style={{ ...ui.label, color: GLASS.inkMute, textTransform: 'none', fontSize: 11 }}>{view.message}</span>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ ...ui.label, color: '#dc2626', lineHeight: 1.5, textTransform: 'none', fontSize: 11, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <TriangleAlert size={13} strokeWidth={2.5} style={{ flexShrink: 0, marginTop: 1 }} />
        {view.message}
      </span>
      {view.showRetry ? (
        <button type="button" style={{ ...ui.btn(), height: 28, padding: '0 12px', fontSize: 10, alignSelf: 'flex-start' }} onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

function GenericControl({ ctrl, instance, disabled, onChange, authedFetch, glbAssets, onRefreshGlbAssets, logoLibrary, onAddLogo, onDeleteLogo, deviceScreenLibrary, onAddDeviceScreenImage, onDeleteDeviceScreenImage }) {
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
  if (ctrl.kind === 'logo-artwork') {
    return (
      <LogoArtworkControl
        instance={instance} disabled={disabled} onChange={onChange}
        logoLibrary={logoLibrary} onAddLogo={onAddLogo} onDeleteLogo={onDeleteLogo}
      />
    );
  }
  if (ctrl.kind === 'device-screen') {
    return (
      <DeviceScreenControl
        instance={instance} disabled={disabled} onChange={onChange}
        deviceScreenLibrary={deviceScreenLibrary} onAddDeviceScreenImage={onAddDeviceScreenImage} onDeleteDeviceScreenImage={onDeleteDeviceScreenImage}
      />
    );
  }
  if (ctrl.kind === 'layer-image') {
    return (
      <ImageLayerControl
        instance={instance} disabled={disabled} onChange={onChange}
        deviceScreenLibrary={deviceScreenLibrary} onAddDeviceScreenImage={onAddDeviceScreenImage} onDeleteDeviceScreenImage={onDeleteDeviceScreenImage}
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
  // Generic enum dropdown — the ctrl declares `options: [{ value, label }]`
  // matching the fieldSpec's own `values` list (validators.js 'enum' type).
  // First used by device-mockup's DEVICE control.
  if (ctrl.kind === 'select') {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: fieldDisabled ? 0.4 : 1 }}>
        <span style={ui.label}>{ctrl.label}</span>
        <select
          value={value}
          disabled={fieldDisabled}
          onChange={(e) => onChange(ctrl.bucket, ctrl.key, e.target.value)}
          style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
        >
          {(ctrl.options || []).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </label>
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
  loadStatus, onRetryLoad,
  authedFetch, glbAssets, onRefreshGlbAssets, onToggleLockGroup,
  logoLibrary, onAddLogo, onDeleteLogo,
  deviceScreenLibrary, onAddDeviceScreenImage, onDeleteDeviceScreenImage,
  elementPresets, canSaveElementPreset, elementPresetNameDraft, onElementPresetNameDraftChange,
  onSaveElementPreset, onLoadElementPreset, onArchiveElementPreset, elementPresetStatus,
  isAdmin, onCaptureElementPresetRecipe, onLoadElementPresetRecipe,
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
    const lockableGroups = ['material', 'motion', 'appearance'].filter(
      (group) => Object.keys(definition?.randomRanges?.[group] || {}).length > 0
    );
    return (
      <RailCard
        id="cloth-element-inspector-panel" icon={<SlidersHorizontal size={18} strokeWidth={2} />} title="Inspector"
        subtitle={instance.name} color="#f59e0b" open={open} onToggle={onToggle}
      >
        {capabilityLabel ? <span style={{ ...ui.label, color: GLASS.inkMute }}>{capabilityLabel} — not yet in Proof Render (cloud); still included in your browser MP4/WebM export</span> : null}
        <LockGroupsRow instance={instance} lockableGroups={lockableGroups} onToggleLockGroup={onToggleLockGroup} />
        {disabled ? (
          <span style={{ ...ui.label, color: GLASS.inkMute, lineHeight: 1.5, textTransform: 'none', fontSize: 11 }}>
            Hidden — turn on Show above to preview changes live.
          </span>
        ) : null}
        {!disabled ? <PlacementWarningBanner placementWarning={placementWarning} /> : null}
        {!disabled ? <LoadStatusBanner loadStatus={loadStatus} onRetry={() => onRetryLoad(instance.id)} /> : null}

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
            logoLibrary={logoLibrary} onAddLogo={onAddLogo} onDeleteLogo={onDeleteLogo}
            deviceScreenLibrary={deviceScreenLibrary} onAddDeviceScreenImage={onAddDeviceScreenImage} onDeleteDeviceScreenImage={onDeleteDeviceScreenImage}
          />
        ))}

        {/* ELEMENT PRESETS — Slice 2. User-saved, separate from the built-in
            catalog PRESET dropdown above. Captures/restores material/motion/
            appearance only (never transform) — see elements/preset-kinds.js. */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
          <span style={ui.label}>MY ELEMENT PRESETS</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              id="cloth-element-preset-name-input" type="text" placeholder="Name this preset…" value={elementPresetNameDraft}
              onChange={(e) => onElementPresetNameDraftChange(e.target.value)}
              disabled={!canSaveElementPreset}
              style={{ ...ui.btn(), flex: 1, textAlign: 'left', paddingLeft: 10, opacity: canSaveElementPreset ? 1 : 0.4 }}
            />
            <button
              id="cloth-element-preset-save-btn" style={{ ...ui.btn(), padding: '0 12px', opacity: canSaveElementPreset ? 1 : 0.4 }}
              disabled={!canSaveElementPreset} onClick={onSaveElementPreset}
            >
              Save
            </button>
          </div>
          {(() => {
            const matching = (elementPresets || []).filter((p) => p.recipe?.type === instance.type);
            return matching.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {matching.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <button style={{ ...ui.btn(), height: 26, padding: '0 10px', fontSize: 10 }} onClick={() => onLoadElementPreset(p.id)}>Load</button>
                    <button style={{ ...ui.btn(), height: 26, padding: '0 10px', fontSize: 10 }} onClick={() => onArchiveElementPreset(p.id)}>Remove</button>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>No saved presets for this element type yet.</span>
            );
          })()}
          {elementPresetStatus ? <span style={{ ...ui.label, color: GLASS.inkMute }}>{elementPresetStatus}</span> : null}
        </label>

        <CloudTemplateSection
          kind="element" authedFetch={authedFetch} isAdmin={isAdmin}
          onCaptureRecipe={onCaptureElementPresetRecipe} onLoadRecipe={onLoadElementPresetRecipe}
          localEntries={(elementPresets || []).filter((p) => p.recipe?.type === instance.type).map((p) => ({ id: p.id, name: p.name, recipe: p.recipe }))}
          disabled={!canSaveElementPreset}
        />
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
      {capabilityLabel ? <span style={{ ...ui.label, color: GLASS.inkMute }}>{capabilityLabel} — not yet in Proof Render (cloud); still included in your browser MP4/WebM export</span> : null}
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
      {/* TRANSPARENCY (transmission) vs FROST (clarity/roughness) — same
          two independent controls as the Glass rail card; see its own
          comment for why they're separate physical properties. */}
      <Slider label="TRANSPARENCY" min={0} max={1} step={0.02} value={instance.material.transmission} onChange={(v) => onFieldChange('transmission', v)} fmt={(v) => `${Math.round(v * 100)}%`} disabled={disabled} />
      <Slider label="FROST" min={0} max={0.4} step={0.01} value={instance.material.clarity} onChange={(v) => onFieldChange('clarity', v)} fmt={(v) => v.toFixed(2)} disabled={disabled} />
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
