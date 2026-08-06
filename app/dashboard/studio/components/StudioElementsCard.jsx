'use client';

// ELEMENTS rail card — docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md.
// Lists the scene's element instances: the registered Glass Petal Sphere,
// any data-only duplicates of it, and (Phase 2) any real multi-instance-
// capable elements — added fresh or duplicated — that genuinely render.
// Visibility/lock toggles, add/duplicate/remove, seeded randomize/reset,
// undo/redo, a performance-budget meter, a PLACEMENT CHECK selector (drives
// per-format default placement + bounding-sphere-aware safe-zone validation
// — elements/placement.js — but does NOT touch the live canvas's camera or
// export crop; it's named for what it actually does, a validation frame, not
// an output format), and an element PREVIEW QUALITY selector (drives factory
// geometry detail — elements/quality.js; Ultra 4K is intentionally absent,
// see the tier button's own title). Flag-gated in ClothStudio.jsx — inert
// unless NEXT_PUBLIC_STUDIO_ELEMENTS_V1 or (admin AND ?elements=1) is on.

import React from 'react';
import { Boxes, Eye, EyeOff, Lock, Unlock, Shuffle, RotateCcw, Undo2, Redo2, Copy, Trash2, TriangleAlert, Info } from 'lucide-react';
import { GLASS, ui, RailCard } from './rail-ui';
import { getElementDefinition } from '../elements/catalog';
import { getCapabilityLabel } from '../elements/capability';
import { isRenderableInstance } from '../elements/scene-elements';

export default function StudioElementsCard({
  open, onToggle,
  instances, selectedId, onSelect, primaryElementId,
  onToggleVisible, onToggleLock,
  seed, budget, costDetail,
  onRandomizeSelected, onResetSelected, canRandomizeSelected,
  onRandomizeAll, canRandomizeAll,
  intensityTiers, intensityMeta, intensity, onIntensityChange,
  randomizeReport,
  onDuplicateSelected, onRemoveSelected, canDuplicateSelected, canRemoveSelected,
  addableElementTypes, onAddElement, canAddElement,
  canUndo, canRedo, onUndo, onRedo,
  formats, formatId, onFormatChange,
  previewTiers, qualityTier, onQualityTierChange,
  placementWarnings,
  heroWarnings,
}) {
  const selected = instances.find((i) => i.id === selectedId) || null;
  // "Active" reflects what actually renders — a glass duplicate can't render
  // regardless of its own enabled flag, so it counts toward neither the
  // numerator nor the denominator here (matches elementBudget in
  // ClothStudio.jsx, which is scoped the same way via isRenderableInstance).
  const renderedInstances = instances.filter((i) => isRenderableInstance(i, primaryElementId));
  const enabledCount = renderedInstances.filter((i) => i.enabled).length;
  // 'intentional-overlap' (kinetic-rings/glass — by design) is deliberately
  // NOT counted here: it's not something the user needs to fix, so it
  // shouldn't read as a problem count. Only 'outside-frame'/'overlaps-artwork'
  // (accidental) count.
  const warningCount = renderedInstances.filter((i) => i.enabled && placementWarnings?.[i.id] && placementWarnings[i.id].code !== 'intentional-overlap').length;

  return (
    <RailCard
      id="cloth-elements-panel" icon={<Boxes size={18} strokeWidth={2} />} title="Elements"
      subtitle={`${enabledCount}/${renderedInstances.length} active · seed ${seed}${warningCount ? ` · ${warningCount} placement warning${warningCount > 1 ? 's' : ''}` : ''}`}
      color="#f59e0b" open={open} onToggle={onToggle}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={ui.label}>PLACEMENT CHECK</span>
        <div style={{ display: 'flex', gap: 5 }}>
          {Object.values(formats || {}).map((fmt) => (
            <button key={fmt.id} style={{ ...ui.btn(formatId === fmt.id), height: 28, padding: '0 10px', fontSize: 10, flex: 1 }} onClick={() => onFormatChange(fmt.id)}>
              {fmt.label}
            </button>
          ))}
        </div>
        <span style={{ fontFamily: GLASS.sans, fontSize: 10, lineHeight: 1.4, color: GLASS.inkMute }}>
          Checks framing and artwork clearance; does not change the current canvas or export crop.
        </span>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={ui.label}>ELEMENT PREVIEW QUALITY</span>
        <div style={{ display: 'flex', gap: 5 }}>
          {(previewTiers || []).map((tierId) => (
            <button key={tierId} style={{ ...ui.btn(qualityTier === tierId), height: 28, padding: '0 8px', fontSize: 10, flex: 1, textTransform: 'capitalize' }} onClick={() => onQualityTierChange(tierId)}>
              {tierId}
            </button>
          ))}
          <button
            disabled
            title="Ultra 4K stays unavailable in live preview until the final Cloud Run renderer supports these elements (later phase)"
            style={{ ...ui.btn(false), height: 28, padding: '0 8px', fontSize: 10, flex: 1, opacity: 0.35, cursor: 'not-allowed' }}
          >
            Ultra
          </button>
        </div>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={ui.label}>ADD ELEMENT</span>
        <select
          value=""
          disabled={!canAddElement}
          onChange={(e) => { if (e.target.value) onAddElement(e.target.value); }}
          style={{ ...ui.btn(), appearance: 'none', width: '100%', opacity: canAddElement ? 1 : 0.4 }}
        >
          <option value="">{canAddElement ? 'Choose a type…' : `Scene element cap reached`}</option>
          {(addableElementTypes || []).map((def) => (
            <option key={def.type} value={def.type}>{def.label}</option>
          ))}
        </select>
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {instances.map((inst) => {
          const isSelected = inst.id === selectedId;
          const isPrimary = inst.id === primaryElementId;
          const renders = isRenderableInstance(inst, primaryElementId);
          const capabilityLabel = getCapabilityLabel(getElementDefinition(inst.type));
          const warning = inst.enabled ? placementWarnings?.[inst.id] : null;
          // 'intentional-overlap' (kinetic-rings/glass — by design, elements/
          // catalog.js intentionalOverlap) is NOT an accidental warning — it
          // reads as neutral info, not amber, so it never looks like
          // something the user needs to fix.
          const isAccidentalWarning = warning && warning.code !== 'intentional-overlap';
          return (
            <div
              key={inst.id}
              onClick={() => onSelect(inst.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                background: isSelected ? 'rgba(0,0,0,0.06)' : 'transparent',
                border: '1px solid ' + (isSelected ? GLASS.ink : (isAccidentalWarning ? '#f59e0b' : 'transparent')),
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 1 }}>
                <span style={{ fontFamily: GLASS.sans, fontSize: 12, fontWeight: 600, color: GLASS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {inst.name}
                </span>
                {!renders ? (
                  <span style={{ ...ui.label, fontSize: 8, color: '#dc2626' }}>NOT RENDERED · DUPLICATE</span>
                ) : null}
              </span>
              {isAccidentalWarning ? (
                <span title={warning.message} style={{ display: 'inline-flex', color: '#f59e0b' }}>
                  <TriangleAlert size={13} strokeWidth={2.5} />
                </span>
              ) : warning ? (
                <span title={`${warning.message} — this is expected, not something to fix`} style={{ display: 'inline-flex', color: GLASS.inkMute }}>
                  <Info size={13} strokeWidth={2.5} />
                </span>
              ) : null}
              {heroWarnings?.[inst.id] ? (
                <span title="No duplicate hero elements — this is one of 2+ enabled hero-depth elements sharing the frame" style={{ display: 'inline-flex', color: '#f59e0b' }}>
                  <TriangleAlert size={13} strokeWidth={2.5} />
                </span>
              ) : null}
              {capabilityLabel ? (
                <span style={{ ...ui.label, fontSize: 8, color: GLASS.inkMute }}>{capabilityLabel}</span>
              ) : null}
              <button
                type="button"
                title={renders ? (inst.enabled ? 'Hide' : 'Show') : 'Duplicates of a single-mesh element don’t render — there’s nothing to show or hide'}
                disabled={!renders}
                onClick={(e) => { e.stopPropagation(); if (renders) onToggleVisible(inst.id); }}
                style={{
                  display: 'inline-flex', border: 'none', background: 'none', padding: 4,
                  cursor: renders ? 'pointer' : 'default',
                  opacity: renders ? 1 : 0.35,
                  color: renders && inst.enabled ? GLASS.ink : GLASS.inkMute,
                }}
              >
                {renders && inst.enabled ? <Eye size={14} strokeWidth={2.5} /> : <EyeOff size={14} strokeWidth={2.5} />}
              </button>
              <button
                type="button"
                title={inst.random.locked ? 'Unlock' : 'Lock'}
                onClick={(e) => { e.stopPropagation(); onToggleLock(inst.id); }}
                style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: inst.random.locked ? '#f59e0b' : GLASS.inkMute, padding: 4 }}
              >
                {inst.random.locked ? <Lock size={14} strokeWidth={2.5} /> : <Unlock size={14} strokeWidth={2.5} />}
              </button>
            </div>
          );
        })}
      </div>

      <span style={{ ...ui.label, display: 'flex', justifyContent: 'space-between', color: budget.overBudget ? '#dc2626' : GLASS.inkMute }}>
        PERFORMANCE BUDGET
        <span>{budget.cost} / {budget.max}{budget.overBudget ? ' · OVER' : ''}</span>
      </span>
      {costDetail?.transmission > 0 ? (
        <span style={{ fontFamily: GLASS.sans, fontSize: 10, lineHeight: 1.4, color: GLASS.inkMute }} title="Transmissive (glass-category) materials cost more to render than their flat budget number alone implies.">
          Includes +{costDetail.transmission} transmission surcharge (glass-category materials)
        </span>
      ) : null}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          title={canDuplicateSelected ? 'Duplicate the selected element' : 'Select an element first, or the scene element cap is reached'}
          style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, opacity: canDuplicateSelected ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          disabled={!canDuplicateSelected}
          onClick={onDuplicateSelected}
        >
          <Copy size={12} strokeWidth={2.5} /> Duplicate
        </button>
        <button
          title={canRemoveSelected ? 'Remove' : 'The rendered Glass Petal Sphere can’t be removed — use the visibility toggle to hide it instead'}
          style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, opacity: canRemoveSelected ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          disabled={!canRemoveSelected}
          onClick={onRemoveSelected}
        >
          <Trash2 size={12} strokeWidth={2.5} /> Remove
        </button>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={ui.label}>RANDOMIZE INTENSITY</span>
        <div style={{ display: 'flex', gap: 5 }}>
          {(intensityTiers || []).map((tier) => (
            <button
              key={tier}
              title={intensityMeta?.[tier]?.description}
              style={{ ...ui.btn(intensity === tier), height: 28, padding: '0 6px', fontSize: 10, flex: 1 }}
              onClick={() => onIntensityChange(tier)}
            >
              {intensityMeta?.[tier]?.label || tier}
            </button>
          ))}
        </div>
      </label>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          title={canRandomizeSelected ? 'Randomize the selected element' : 'This element has nothing to randomize (locked, or a non-rendering duplicate)'}
          style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, opacity: canRandomizeSelected ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          disabled={!canRandomizeSelected}
          onClick={onRandomizeSelected}
        >
          <Shuffle size={12} strokeWidth={2.5} /> Randomize
        </button>
        <button
          title={canRandomizeAll ? 'Randomize every unlocked element at once ("Elements only" scope) — one undo step' : 'No unlocked, rendering elements to randomize'}
          style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, opacity: canRandomizeAll ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          disabled={!canRandomizeAll}
          onClick={onRandomizeAll}
        >
          <Shuffle size={12} strokeWidth={2.5} /> All
        </button>
        <button
          style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, opacity: selected ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          disabled={!selected}
          onClick={onResetSelected}
        >
          <RotateCcw size={12} strokeWidth={2.5} /> Reset
        </button>
      </div>
      {selected && randomizeReport?.[selected.id]?.length ? (
        <span style={{ ...ui.label, color: GLASS.inkMute }}>Changed: {randomizeReport[selected.id].join(', ')}</span>
      ) : null}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, opacity: canUndo ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 size={12} strokeWidth={2.5} /> Undo
        </button>
        <button
          style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, opacity: canRedo ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 size={12} strokeWidth={2.5} /> Redo
        </button>
      </div>
      <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
        The Glass Petal Sphere is the one existing element; its duplicates persist as data only and never render. Everything added via ADD ELEMENT genuinely renders, placed with a deliberate per-format default sized to clear the artwork and stay framed. Kinetic Rings (and Glass) intentionally overlap the artwork by design — shown as a neutral notice, not a warning. Randomize Intensity applies to both Randomize and All. Per-parameter-group locks are in the Inspector below (select an element with material/motion/appearance ranges). The Randomize card above covers the other scopes — Lighting/Camera/Motion/Colors only, Entire set, and Unlocked values only.
      </span>
    </RailCard>
  );
}
