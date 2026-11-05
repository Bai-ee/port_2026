'use client';

// Invoice Studio rail — Total due card. The second stand-alone amount box,
// printed by render.js's buildTotalDue() in the same shape as Deposit so a
// deposit and the full total can each be stated separately. Owns
// totals.totalDue (hand-set money — deliberately NOT derived from
// totals.total) and totals.totalDueLabel (the printed heading, preset
// shortcuts + free text, same pattern as DepositCard). Section is OFF by
// default (registry.js) and the block prints only when the amount is > 0.

import React from 'react';
import { Receipt } from 'lucide-react';
import SectionCard from './SectionCard';
import { RailFieldGrid, RailTextInput, RailNumberInput, RailSegmented } from './rail-field-controls';
import { parseValue, formatValue } from '../invoice-fields';

const DUE_HEADINGS = ['Total due', 'Balance due', 'Final payment'];

export default function TotalDueCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const totals = invoice.totals;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');
  const title = totals.totalDueLabel || 'Total due';

  return (
    <SectionCard
      sectionId="totalDue" id="invoice-rail-total-due-card" icon={<Receipt size={18} strokeWidth={2} />} title={title}
      subtitle={formatValue('money', totals.totalDue, invoice.currency)} color="#22c55e" open={open} onToggle={onToggle} draft={draft}
    >
      <RailFieldGrid>
        <RailNumberInput path="totals.totalDue" label="Amount" value={totals.totalDue} onChange={(v) => edit('totals.totalDue', 'money', v)} />
      </RailFieldGrid>
      <div id="invoice-rail-total-due-heading-field">
        {/* Preset shortcut for the same value the text input below sets —
            no data-inv-rail-field here, same reason as DepositCard. */}
        <RailSegmented
          label="Heading" options={DUE_HEADINGS}
          value={totals.totalDueLabel} onSelect={(v) => edit('totals.totalDueLabel', 'text', v)}
        />
        <div style={{ marginTop: 6 }}>
          <RailTextInput path="totals.totalDueLabel" value={totals.totalDueLabel} placeholder="Total due" onChange={(v) => edit('totals.totalDueLabel', 'text', v)} />
        </div>
      </div>
    </SectionCard>
  );
}
