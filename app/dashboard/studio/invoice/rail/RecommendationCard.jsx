'use client';

// Invoice Studio rail — Recommendation card. Prints as "Recommendation"
// (render.js's buildRecommendation -> block('invoice-recommendation-section',
// 'Recommendation', ...)). Owns recommendation.{name,body} and
// recommendation.chips[] — split out of the old combined
// RecommendationFlowCard so it matches render.js's separate
// buildRecommendation()/buildFlow() sections (see FlowCard.jsx for the
// flow-steps half). Chips are index-keyed (no row id in the draft shape —
// see invoice-fields.js's path-grammar comment), so `data-inv-rail-field`
// uses the plain array index, matching `renderedIndexToDraftIndex`'s
// 'chips' kind that the canvas bridge (lane E) will need later.

import React from 'react';
import { Sparkles } from 'lucide-react';
import SectionCard from './SectionCard';
import { ui } from '../../components/rail-ui';
import { RailTextInput, RailTextArea, RailIconButton, RailAddButton } from './rail-field-controls';
import { parseValue } from '../invoice-fields';

export default function RecommendationCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const rec = invoice.recommendation;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');

  return (
    <SectionCard
      sectionId="recommendation" id="invoice-rail-recommendation-card" icon={<Sparkles size={18} strokeWidth={2} />} title="Recommendation"
      subtitle={rec.name} color="#f97316" open={open} onToggle={onToggle} draft={draft}
    >
      <RailTextInput path="recommendation.name" label="Package name" value={rec.name} onChange={(v) => edit('recommendation.name', 'text', v)} />
      <RailTextArea path="recommendation.body" label="Body" rows={3} value={rec.body} onChange={(v) => edit('recommendation.body', 'multiline', v)} />
      <div style={{ display: 'grid', gap: 6 }}>
        <span style={ui.label}>Highlight chips</span>
        {rec.chips.map((chip, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <RailTextInput path={`recommendation.chips[${idx}]`} value={chip} onChange={(v) => edit(`recommendation.chips[${idx}]`, 'text', v)} />
            </div>
            <RailIconButton onClick={() => draft.removeChip(idx)} label={`Remove chip ${idx + 1}`} danger />
          </div>
        ))}
        <RailAddButton onClick={draft.addChip}>Add chip</RailAddButton>
      </div>
    </SectionCard>
  );
}
