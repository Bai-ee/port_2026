'use client';

// Invoice Studio rail — Terms card. Prints as "Terms" (render.js's
// buildTerms -> block('invoice-terms-section', 'Terms', ...)). Owns the
// terms[] list — split out of the old combined TermsPaymentNotesCard so it
// matches render.js's separate buildTerms()/buildPayment()/buildNotes()
// sections (see PaymentCard.jsx and NotesCard.jsx for the other two).
// Terms are index-keyed (no row id in the draft shape).

import React from 'react';
import { ScrollText } from 'lucide-react';
import SectionCard from './SectionCard';
import { ui } from '../../components/rail-ui';
import { RailTextInput, RailIconButton, RailAddButton } from './rail-field-controls';
import { parseValue } from '../invoice-fields';

export default function TermsCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');

  return (
    <SectionCard
      sectionId="terms" id="invoice-rail-terms-card" icon={<ScrollText size={18} strokeWidth={2} />} title="Terms"
      subtitle={`${invoice.terms.length} term${invoice.terms.length === 1 ? '' : 's'}`} color="#64748b" open={open} onToggle={onToggle} draft={draft}
    >
      {invoice.terms.map((term, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ ...ui.label, minWidth: 18 }}>{idx + 1}.</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <RailTextInput path={`terms[${idx}]`} value={term} onChange={(v) => edit(`terms[${idx}]`, 'text', v)} />
          </div>
          <RailIconButton onClick={() => draft.removeTerm(idx)} label={`Remove term ${idx + 1}`} danger />
        </div>
      ))}
      <RailAddButton onClick={draft.addTerm}>Add term</RailAddButton>
    </SectionCard>
  );
}
