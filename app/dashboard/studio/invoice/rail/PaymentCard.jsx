'use client';

// Invoice Studio rail — Payment card. Prints as "Payment" (render.js's
// buildPayment -> block('invoice-payment-section', 'Payment', ...)). Owns
// payment.{method,instructions,link} — split out of the old combined
// TermsPaymentNotesCard so it matches render.js's separate buildTerms()/
// buildPayment()/buildNotes() sections. No payment.handle / payment.qr
// field here — the admin card never exposed either (handle/qr are
// seed-only, see features/invoices/default-draft.js and payment-qr.js;
// render.js's as-built note confirms payment.handle is rendered read-only,
// deliberately unannotated for editing). Adding one would be new scope
// beyond this rework.

import React from 'react';
import { CreditCard } from 'lucide-react';
import SectionCard from './SectionCard';
import { RailFieldGrid, RailTextInput, RailTextArea } from './rail-field-controls';
import { parseValue } from '../invoice-fields';

export default function PaymentCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');

  return (
    <SectionCard
      sectionId="payment" id="invoice-rail-payment-card" icon={<CreditCard size={18} strokeWidth={2} />} title="Payment"
      subtitle={invoice.payment.method} color="#64748b" open={open} onToggle={onToggle} draft={draft}
    >
      <RailFieldGrid>
        <RailTextInput path="payment.method" label="Payment method" value={invoice.payment.method} onChange={(v) => edit('payment.method', 'text', v)} />
        <RailTextInput path="payment.link" label="Payment link" value={invoice.payment.link} onChange={(v) => edit('payment.link', 'text', v)} />
      </RailFieldGrid>
      <RailTextArea path="payment.instructions" label="Payment instructions" rows={3} value={invoice.payment.instructions} onChange={(v) => edit('payment.instructions', 'multiline', v)} />
    </SectionCard>
  );
}
