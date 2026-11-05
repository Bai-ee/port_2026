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
import { RailFieldGrid, RailTextInput, RailNumberInput, RailEmptyHint } from './rail-field-controls';
import { parseValue, formatValue } from '../invoice-fields';
import { allPricedItemCount, computeTotals, resolveInvoiceLabels } from '../../../../../features/invoices/model.js';

export default function TotalsCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const totals = invoice.totals;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');
  // computeTotals() (model.js) sums the subtotal from priced items and only
  // honours a typed subtotal when there are none; total is always
  // subtotal − discount + tax. The rail says so instead of offering inputs
  // that the next recompute would silently overwrite. The derived figures
  // are computed live here (draft.invoice.totals.total only refreshes on
  // Recalculate — the canvas patches its own derived nodes from the same
  // function, so this keeps rail and canvas in agreement).
  const pricedCount = allPricedItemCount(invoice);
  const derived = computeTotals(invoice);
  const resolvedLabels = resolveInvoiceLabels(invoice);

  return (
    <SectionCard
      sectionId="totals" id="invoice-rail-totals-card" icon={<Calculator size={18} strokeWidth={2} />} title="Totals"
      subtitle={formatValue('money', derived.total, invoice.currency)} color="#22c55e" open={open} onToggle={onToggle} draft={draft}
    >
      <div id="invoice-rail-totals-heading-fields">
        <RailFieldGrid>
          <RailTextInput
            path="labels.totalsLabel" label="Section heading"
            value={invoice.labels?.totalsLabel || ''}
            placeholder={`Using the default: ${resolvedLabels.totalsLabel}`}
            onChange={(v) => draft.applyFieldEdit('labels.totalsLabel', v, 'rail')}
          />
          <RailTextInput
            path="labels.totalLabel" label="Total row label"
            value={invoice.labels?.totalLabel || ''}
            placeholder={`Using the default: ${resolvedLabels.totalLabel}`}
            onChange={(v) => draft.applyFieldEdit('labels.totalLabel', v, 'rail')}
          />
        </RailFieldGrid>
      </div>
      <RailEmptyHint>
        {pricedCount > 0
          ? `Subtotal is summed from ${pricedCount} priced item${pricedCount === 1 ? '' : 's'}; total = subtotal − discount + tax.`
          : 'No priced items (all amounts are text), so type the subtotal here; total = subtotal − discount + tax.'}
      </RailEmptyHint>
      <RailFieldGrid>
        {pricedCount > 0
          ? <RailTextInput path="totals.subtotal" label="Subtotal (from items)" value={formatValue('money', derived.subtotal, invoice.currency)} readOnly onChange={() => {}} />
          : <RailNumberInput path="totals.subtotal" label="Subtotal" value={totals.subtotal} onChange={(v) => edit('totals.subtotal', 'money', v)} />}
        <RailTextInput path="totals.total" label="Total (computed)" value={formatValue('money', derived.total, invoice.currency)} readOnly onChange={() => {}} />
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
