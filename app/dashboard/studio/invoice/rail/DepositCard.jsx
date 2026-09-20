'use client';

// Invoice Studio rail — Deposit card. ⚠️ Its printed title is DYNAMIC:
// render.js's buildDeposit() uses `totals.depositLabel || 'Payment due'` as
// the section heading itself (block('invoice-deposit-section',
// totals.depositLabel || 'Payment due', ..., depositLabelField) — the
// heading is also independently annotated editable, since the block()
// helper's `labelField` param overrides the plain label). This card's own
// title tracks that live so the rail retitles as the operator edits the
// field — "Payment due" by default, "Deposit due" via the preset, or
// whatever free text is typed.
//
// Owns totals.deposit + totals.depositLabel (the two-preset + free-text
// control). ⚠️ totals.{monthlyLabel,monthlyValue,oneTimeLabel,oneTimeValue}
// are in the model (and in invoice-fields.js's FIELD_PATHS, typed 'text' —
// see that file's comment on why) but render.js's buildDeposit() never
// prints them anywhere — kept editable here with that fact stated plainly
// rather than silently dropped, same treatment as ProjectSummaryCard's
// projectTitle/projectSubtitle note.

import React from 'react';
import { Wallet } from 'lucide-react';
import SectionCard from './SectionCard';
import { RailFieldGrid, RailTextInput, RailNumberInput, RailSegmented, RailEmptyHint } from './rail-field-controls';
import { parseValue, formatValue } from '../invoice-fields';
import { resolveDepositHeading } from '../../../../../features/invoices/model.js';

const DUE_HEADINGS = ['Payment due', 'Deposit due'];

export default function DepositCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const totals = invoice.totals;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');
  // The same resolver render.js's buildDeposit() prints from — the rail
  // title and the printed heading can never disagree.
  const title = resolveDepositHeading(invoice);

  return (
    <SectionCard
      sectionId="deposit" id="invoice-rail-deposit-card" icon={<Wallet size={18} strokeWidth={2} />} title={title}
      subtitle={formatValue('money', totals.deposit, invoice.currency)} color="#22c55e" open={open} onToggle={onToggle} draft={draft}
    >
      <RailFieldGrid>
        <RailNumberInput path="totals.deposit" label="Amount due now" value={totals.deposit} onChange={(v) => edit('totals.deposit', 'money', v)} />
      </RailFieldGrid>
      <div id="invoice-rail-deposit-heading-field">
        {/* No data-inv-rail-field here — it's a two-click preset shortcut
            for the same value the text input below sets; a duplicate
            attribute on two DOM nodes would break the focus-seam's
            path -> single-node lookup. */}
        <RailSegmented
          label="Heading" options={DUE_HEADINGS}
          value={totals.depositLabel} onSelect={(v) => edit('totals.depositLabel', 'text', v)}
        />
        <div style={{ marginTop: 6 }}>
          <RailTextInput path="totals.depositLabel" value={totals.depositLabel} placeholder="Payment due" onChange={(v) => edit('totals.depositLabel', 'text', v)} />
        </div>
      </div>

      <RailEmptyHint>
        Monthly/one-time fields below are saved but not printed in this layout.
      </RailEmptyHint>
      <RailFieldGrid>
        <RailTextInput path="totals.monthlyLabel" label="Monthly label" value={totals.monthlyLabel} placeholder="e.g. Monthly retainer" onChange={(v) => edit('totals.monthlyLabel', 'text', v)} />
        <RailTextInput path="totals.monthlyValue" label="Monthly value" value={totals.monthlyValue} placeholder="e.g. 199 or $199/mo" onChange={(v) => edit('totals.monthlyValue', 'text', v)} />
        <RailTextInput path="totals.oneTimeLabel" label="One-time label" value={totals.oneTimeLabel} placeholder="e.g. Setup fee" onChange={(v) => edit('totals.oneTimeLabel', 'text', v)} />
        <RailTextInput path="totals.oneTimeValue" label="One-time value" value={totals.oneTimeValue} placeholder="e.g. 500" onChange={(v) => edit('totals.oneTimeValue', 'text', v)} />
      </RailFieldGrid>
    </SectionCard>
  );
}
