'use client';

// Invoice Studio rail — Totals card. Prints as "Totals" (render.js's
// buildTotals -> block('invoice-totals-panel', 'Totals', ...)). Owns
// subtotal/discount/discountLabel/tax/taxLabel/total/amountPaid and the
// recalc-from-items button — exactly what that section builder reads.
// `totals.deposit`/`depositLabel` moved to their own DepositCard, matching
// render.js's separate buildDeposit() section/builder.

import React from 'react';
import { Calculator } from 'lucide-react';
import SectionCard from './SectionCard';
import { ui } from '../../components/rail-ui';
import { RailFieldGrid, RailTextInput, RailNumberInput } from './rail-field-controls';
import { parseValue, formatValue } from '../invoice-fields';

export default function TotalsCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const totals = invoice.totals;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');

  return (
    <SectionCard
      sectionId="totals" id="invoice-rail-totals-card" icon={<Calculator size={18} strokeWidth={2} />} title="Totals"
      subtitle={formatValue('money', totals.total, invoice.currency)} color="#22c55e" open={open} onToggle={onToggle} draft={draft}
    >
      <RailFieldGrid>
        <RailNumberInput path="totals.subtotal" label="Subtotal" value={totals.subtotal} onChange={(v) => edit('totals.subtotal', 'money', v)} />
        <RailNumberInput path="totals.total" label="Total" value={totals.total} onChange={(v) => edit('totals.total', 'money', v)} />
        <RailNumberInput path="totals.discount" label="Discount" value={totals.discount} onChange={(v) => edit('totals.discount', 'money', v)} />
        <RailTextInput path="totals.discountLabel" label="Discount label" value={totals.discountLabel} placeholder="e.g. Bundle discount" onChange={(v) => edit('totals.discountLabel', 'text', v)} />
        <RailNumberInput path="totals.tax" label="Tax" value={totals.tax} onChange={(v) => edit('totals.tax', 'money', v)} />
        <RailTextInput path="totals.taxLabel" label="Tax label" value={totals.taxLabel} placeholder="e.g. Sales tax" onChange={(v) => edit('totals.taxLabel', 'text', v)} />
        <RailNumberInput path="totals.amountPaid" label="Amount already paid" value={totals.amountPaid || 0} onChange={(v) => edit('totals.amountPaid', 'money', v)} />
      </RailFieldGrid>

      <button type="button" onClick={draft.recalcTotals} style={{ ...ui.btn(false), alignSelf: 'flex-start' }}>
        Recalculate subtotal/total from items
      </button>
    </SectionCard>
  );
}
