'use client';

// Invoice Studio rail — Invoice details card. Prints as "Invoice details"
// (render.js's buildInvoiceMeta -> block('invoice-meta-section', 'Invoice
// details', ...)). Owns every field that section builder reads: the
// invoice-identity fields (invoiceNumber/status/issueDate/dueDate/
// paymentTerms/poNumber/servicePeriod/currency) AND the issuer block
// (`from.*`) — buildInvoiceMeta renders both in its two-up layout, so both
// live on one rail card rather than split across two (the old admin card's
// section 01 + the old PartiesCard's "From" panel).
//
// design-layer plan L15/Q2 Lane B additions: this card also owns locale,
// document numbering (pattern + reserve-next-number + duplicate warning),
// and editable-label overrides — three new subsections below the existing
// fields, none of which disturb the invoiceNumber/status/dates/etc. fields
// above.

import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import SectionCard from './SectionCard';
import { RailFieldGrid, RailTextInput, RailTextArea, RailDateInput, RailSegmented, RailEmptyHint } from './rail-field-controls';
import { GLASS, ui } from '../../components/rail-ui';
import { parseValue } from '../invoice-fields';
import {
  resolveInvoiceLabels, INVOICE_LABEL_KEYS, NUMBER_PATTERN_TOKEN_RE, DEFAULT_NUMBER_PATTERN,
} from '../../../../../features/invoices/model.js';
import { formatNumberFromPattern, isDuplicateNumber } from '../identity/numbering.js';

const STATUS_OPTIONS = ['draft', 'sent', 'paid'];

const LOCALE_OPTIONS = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'de-DE', label: 'German' },
  { value: 'fr-FR', label: 'French' },
  { value: 'es-ES', label: 'Spanish' },
];

// The six overrides an operator is most likely to actually want to rename —
// always visible. Every other INVOICE_LABEL_KEYS entry is reachable via the
// "Show all label overrides" expando below rather than crowding the card by
// default (the handoff explicitly leaves this choice to judgment).
const PRIMARY_LABEL_KEYS = ['title', 'invoiceDetails', 'billToLabel', 'dueLabel', 'paymentDueLabel', 'totalLabel'];
const MORE_LABEL_KEYS = INVOICE_LABEL_KEYS.filter((key) => !PRIMARY_LABEL_KEYS.includes(key));

// 'billToLabel' -> 'Bill To Label' -> 'Bill To'; 'title' -> 'Title'.
function humanizeLabelKey(key) {
  const spaced = String(key).replace(/([A-Z])/g, ' $1').trim();
  const capitalized = spaced.charAt(0).toUpperCase() + spaced.slice(1);
  return capitalized.replace(/\sLabel$/, '');
}

// Mirrors model.js's normalizeNumberPattern() shape check (same imported
// regex, no drift risk) but only reports validity — it never mutates what
// the operator typed, so the input never fights their keystrokes.
function patternIsValid(pattern) {
  const text = String(pattern ?? '').trim();
  if (!text) return true; // empty falls back to the default silently, not an error state
  const stripped = text.replace(NUMBER_PATTERN_TOKEN_RE, '');
  return !/[{}]/.test(stripped);
}

function LabelOverrideInput({ draft, resolved, labelKey }) {
  const { invoice } = draft;
  return (
    <RailTextInput
      path={`labels.${labelKey}`}
      label={humanizeLabelKey(labelKey)}
      value={invoice.labels?.[labelKey] || ''}
      placeholder={`Using the default: ${resolved[labelKey]}`}
      onChange={(v) => draft.applyFieldEdit(`labels.${labelKey}`, v, 'rail')}
    />
  );
}

export default function InvoiceMetaCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');
  const [showAllLabels, setShowAllLabels] = useState(false);

  const resolvedLabels = resolveInvoiceLabels(invoice);
  const patternValid = patternIsValid(invoice.numberPattern);
  const previewPattern = patternValid && String(invoice.numberPattern ?? '').trim()
    ? invoice.numberPattern
    : DEFAULT_NUMBER_PATTERN;
  const previewNumber = formatNumberFromPattern(previewPattern, 1);
  const duplicate = isDuplicateNumber(invoice.invoiceNumber);

  return (
    <SectionCard
      sectionId="invoiceMeta" id="invoice-rail-invoice-meta-card" title="Invoice details"
      icon={<FileText size={18} strokeWidth={2} />} color="#f59e0b"
      subtitle={invoice.invoiceNumber} open={open} onToggle={onToggle} draft={draft}
    >
      <RailFieldGrid>
        <RailTextInput path="invoiceNumber" label="Invoice #" value={invoice.invoiceNumber} onChange={(v) => edit('invoiceNumber', 'text', v)} />
        <RailTextInput
          path="currency" label="Currency" value={invoice.currency} maxLength={3}
          onChange={(v) => edit('currency', 'text', v.toUpperCase().slice(0, 3))}
        />
      </RailFieldGrid>
      {duplicate ? (
        <span id="invoice-rail-invoice-meta-number-duplicate-warning" role="alert" style={{ fontSize: 11.5, color: '#b45309', lineHeight: 1.5 }}>
          This number matches an earlier reservation in this browser. Reserve a new one below.
        </span>
      ) : null}

      <RailSegmented
        path="status" label="Status" options={STATUS_OPTIONS} value={invoice.status}
        onSelect={(v) => edit('status', 'enum', v)}
      />

      <RailFieldGrid>
        <RailDateInput path="issueDate" label="Issue date" value={invoice.issueDate} onChange={(v) => edit('issueDate', 'date', v)} />
        <RailDateInput path="dueDate" label="Due date" value={invoice.dueDate} onChange={(v) => edit('dueDate', 'date', v)} />
      </RailFieldGrid>

      <RailFieldGrid>
        <RailTextInput path="paymentTerms" label="Payment terms" value={invoice.paymentTerms} placeholder="Net 14" onChange={(v) => edit('paymentTerms', 'text', v)} />
        <RailTextInput path="poNumber" label="PO number" value={invoice.poNumber} placeholder="Client's own reference" onChange={(v) => edit('poNumber', 'text', v)} />
        <RailDateInput path="servicePeriod.start" label="Service period start" value={invoice.servicePeriod?.start} onChange={(v) => edit('servicePeriod.start', 'date', v)} />
        <RailDateInput path="servicePeriod.end" label="Service period end" value={invoice.servicePeriod?.end} onChange={(v) => edit('servicePeriod.end', 'date', v)} />
      </RailFieldGrid>

      <div id="invoice-rail-invoice-meta-from-panel" style={{ display: 'grid', gap: 10, marginTop: 6 }}>
        <RailFieldGrid>
          <RailTextInput path="from.name" label="From — name" value={invoice.from.name} onChange={(v) => edit('from.name', 'text', v)} />
          <RailTextInput path="from.email" label="From — email" value={invoice.from.email} onChange={(v) => edit('from.email', 'text', v)} />
          <RailTextInput path="from.phone" label="From — phone" value={invoice.from.phone} onChange={(v) => edit('from.phone', 'text', v)} />
          <RailTextInput path="from.site" label="From — site" value={invoice.from.site} onChange={(v) => edit('from.site', 'text', v)} />
          <RailTextInput path="from.legalName" label="From — legal name" value={invoice.from.legalName} placeholder="If payment is made out to an entity" onChange={(v) => edit('from.legalName', 'text', v)} />
          <RailTextInput path="from.taxId" label="From — tax ID / EIN" value={invoice.from.taxId} placeholder="For the client's 1099 / W-9" onChange={(v) => edit('from.taxId', 'text', v)} />
        </RailFieldGrid>
        <RailTextArea path="from.address" label="From — address" rows={2} value={invoice.from.address} onChange={(v) => edit('from.address', 'multiline', v)} />
      </div>

      <div id="invoice-rail-invoice-meta-locale-section" style={{ marginTop: 16 }}>
        <RailSegmented
          path="locale" label="Locale (dates & currency)" options={LOCALE_OPTIONS} value={invoice.locale}
          onSelect={(v) => draft.applyFieldEdit('locale', v, 'rail')}
        />
      </div>

      <div id="invoice-rail-invoice-meta-numbering-section" style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        <RailTextInput
          path="numberPattern" label="Numbering pattern" value={invoice.numberPattern}
          placeholder={DEFAULT_NUMBER_PATTERN}
          onChange={(v) => draft.applyFieldEdit('numberPattern', v, 'rail')}
        />
        {patternValid ? (
          <RailEmptyHint>Example: {previewNumber}. Tokens: {'{YYYY} {YY} {MM} {seq:N}'} (N is 1–6). This preview doesn&apos;t reserve a number.</RailEmptyHint>
        ) : (
          <span role="alert" style={{ fontSize: 11.5, color: '#dc2626', lineHeight: 1.5 }}>
            Unrecognized token — falling back to {DEFAULT_NUMBER_PATTERN} until fixed. Supported tokens: {'{YYYY}'}, {'{YY}'}, {'{MM}'}, {'{seq:1}'}–{'{seq:6}'}.
          </span>
        )}
        <RailEmptyHint>Numbers reserve only when you start a New Document. Editing the pattern here doesn&apos;t renumber this draft, only future ones.</RailEmptyHint>
      </div>

      <div id="invoice-rail-invoice-meta-labels-section" style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        <span style={{ ...ui.label }}>Label overrides</span>
        {PRIMARY_LABEL_KEYS.map((key) => (
          <LabelOverrideInput key={key} draft={draft} resolved={resolvedLabels} labelKey={key} />
        ))}
        <button
          type="button"
          onClick={() => setShowAllLabels((prev) => !prev)}
          style={{ ...ui.btn(false), alignSelf: 'flex-start', fontSize: 11 }}
        >
          {showAllLabels ? 'Hide other label overrides' : 'Show all label overrides'}
        </button>
        {showAllLabels ? (
          <div
            id="invoice-rail-invoice-meta-labels-more-list"
            style={{
              display: 'grid', gap: 8, maxHeight: 320, overflowY: 'auto',
              padding: 8, borderRadius: 8, border: '1px solid ' + GLASS.hair, background: 'rgba(255,255,255,0.4)',
            }}
          >
            {MORE_LABEL_KEYS.map((key) => (
              <LabelOverrideInput key={key} draft={draft} resolved={resolvedLabels} labelKey={key} />
            ))}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
