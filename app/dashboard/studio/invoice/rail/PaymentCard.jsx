'use client';

// Invoice Studio rail — Payment card. Prints as "Payment" (render.js's
// buildPayment -> block('invoice-payment-section', 'Payment', ...)). Owns
// payment.{method,instructions,link} and payment.bank.* — split out of the
// old combined TermsPaymentNotesCard so it matches render.js's separate
// buildTerms()/buildPayment()/buildNotes() sections. No payment.handle /
// payment.qr field here — the admin card never exposed either (handle/qr are
// seed-only, see features/invoices/default-draft.js and payment-qr.js;
// render.js's as-built note confirms payment.handle is rendered read-only,
// deliberately unannotated for editing).
//
// Bank transfer (payment.bank.*) is opt-in: hidden behind "Add bank transfer"
// until clicked or until any bank field already has a value; renders above
// the method/QR rows on the document.

import React, { useState } from 'react';
import { CreditCard } from 'lucide-react';
import SectionCard from './SectionCard';
import { RailFieldGrid, RailTextInput, RailTextArea, RailAddButton, RailEmptyHint } from './rail-field-controls';
import { parseValue } from '../invoice-fields';
import { GLASS, ui } from '../../components/rail-ui';

const BANK_FIELDS = [
  { key: 'bankName', label: 'Bank name', placeholder: 'e.g. Bank of America' },
  { key: 'accountNumber', label: 'Account number' },
  { key: 'routingAch', label: 'Routing (ACH / direct deposit)' },
  { key: 'routingWire', label: 'Routing (wire)' },
];

export default function PaymentCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');
  const bank = invoice.payment.bank || {};
  const hasBank = BANK_FIELDS.some((f) => bank[f.key]);
  const [bankOpen, setBankOpen] = useState(false);
  const showBank = hasBank || bankOpen;

  const removeBank = () => {
    draft.updatePayment({ bank: { bankName: '', accountNumber: '', routingAch: '', routingWire: '' } });
    setBankOpen(false);
  };

  return (
    <SectionCard
      sectionId="payment" id="invoice-rail-payment-card" icon={<CreditCard size={18} strokeWidth={2} />} title="Payment"
      subtitle={[hasBank ? 'Bank transfer' : '', invoice.payment.method].filter(Boolean).join(' · ')} color="#64748b" open={open} onToggle={onToggle} draft={draft}
    >
      <div id="invoice-rail-payment-bank-group" style={{ display: 'grid', gap: 8 }}>
        {showBank ? (
          <>
            <span style={{ ...ui.label, color: GLASS.inkMute }}>Bank transfer</span>
            <RailEmptyHint>Shown above the other payment details. Anyone with the invoice link can read these.</RailEmptyHint>
            <RailFieldGrid>
              {BANK_FIELDS.map((f) => (
                <RailTextInput
                  key={f.key} path={`payment.bank.${f.key}`} label={f.label} placeholder={f.placeholder}
                  value={bank[f.key] || ''} onChange={(v) => edit(`payment.bank.${f.key}`, 'text', v)}
                />
              ))}
            </RailFieldGrid>
            <button type="button" onClick={removeBank} style={{ ...ui.btn(false), height: 28, fontSize: 10.5, marginTop: 6 }}>Remove bank transfer</button>
          </>
        ) : (
          <RailAddButton full onClick={() => setBankOpen(true)}>Add bank transfer</RailAddButton>
        )}
      </div>
      <RailFieldGrid>
        <RailTextInput path="payment.method" label="Payment method" value={invoice.payment.method} onChange={(v) => edit('payment.method', 'text', v)} />
        <RailTextInput path="payment.link" label="Payment link" value={invoice.payment.link} onChange={(v) => edit('payment.link', 'text', v)} />
      </RailFieldGrid>
      <RailTextArea path="payment.instructions" label="Payment instructions" rows={3} value={invoice.payment.instructions} onChange={(v) => edit('payment.instructions', 'multiline', v)} />
    </SectionCard>
  );
}
