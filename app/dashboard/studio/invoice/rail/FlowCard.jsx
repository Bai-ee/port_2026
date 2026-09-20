'use client';

// Invoice Studio rail — How it works card. Prints as "How it works"
// (render.js's buildFlow -> block('invoice-flow-section', 'How it works',
// ...)). Owns flowSteps[] — split out of the old combined
// RecommendationFlowCard so it matches render.js's separate
// buildRecommendation()/buildFlow() sections (see RecommendationCard.jsx for
// the recommendation half). Flow steps are index-keyed (no row id in the
// draft shape), so `data-inv-rail-field` uses the plain array index,
// matching `renderedIndexToDraftIndex`'s 'flowSteps' kind.

import React from 'react';
import { Workflow } from 'lucide-react';
import SectionCard from './SectionCard';
import { RailTextInput, RailIconButton, RailAddButton } from './rail-field-controls';
import { parseValue } from '../invoice-fields';

export default function FlowCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');

  return (
    <SectionCard
      sectionId="flow" id="invoice-rail-flow-card" icon={<Workflow size={18} strokeWidth={2} />} title="How it works"
      subtitle={`${invoice.flowSteps.length} step${invoice.flowSteps.length === 1 ? '' : 's'}`}
      color="#f97316" open={open} onToggle={onToggle} draft={draft}
    >
      {invoice.flowSteps.map((step, idx) => (
        <div
          key={idx}
          id={`invoice-rail-flow-step-${idx}`}
          style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.4)' }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <div style={{ flex: '1 1 100px', minWidth: 0 }}>
              <RailTextInput path={`flowSteps[${idx}].platform`} value={step.platform} placeholder="Platform" onChange={(v) => edit(`flowSteps[${idx}].platform`, 'text', v)} />
            </div>
            <div style={{ flex: '1 1 80px', minWidth: 0 }}>
              <RailTextInput path={`flowSteps[${idx}].color`} value={step.color} placeholder="Color" onChange={(v) => edit(`flowSteps[${idx}].color`, 'text', v)} />
            </div>
            <div style={{ flex: '2 1 140px', minWidth: 0 }}>
              <RailTextInput path={`flowSteps[${idx}].label`} value={step.label} placeholder="Label" onChange={(v) => edit(`flowSteps[${idx}].label`, 'text', v)} />
            </div>
            <div style={{ flex: '1 1 100px', minWidth: 0 }}>
              <RailTextInput path={`flowSteps[${idx}].tech`} value={step.tech} placeholder="Tech" onChange={(v) => edit(`flowSteps[${idx}].tech`, 'text', v)} />
            </div>
            <RailIconButton onClick={() => draft.removeFlowStep(idx)} label={`Remove step ${idx + 1}`} danger />
          </div>
        </div>
      ))}
      <RailAddButton onClick={draft.addFlowStep}>Add step</RailAddButton>
    </SectionCard>
  );
}
