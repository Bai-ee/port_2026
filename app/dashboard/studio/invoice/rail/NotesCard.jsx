'use client';

// Invoice Studio rail — Notes card. Prints as "Notes" (render.js's
// buildNotes -> block('invoice-notes-section', 'Notes', ...)). Owns the
// `notes` field — split out of the old combined TermsPaymentNotesCard so it
// matches render.js's separate buildTerms()/buildPayment()/buildNotes()
// sections.

import React from 'react';
import { StickyNote } from 'lucide-react';
import SectionCard from './SectionCard';
import { RailTextArea } from './rail-field-controls';
import { parseValue } from '../invoice-fields';

export default function NotesCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');

  return (
    <SectionCard
      sectionId="notes" id="invoice-rail-notes-card" icon={<StickyNote size={18} strokeWidth={2} />} title="Notes"
      open={open} onToggle={onToggle} draft={draft}
    >
      <RailTextArea path="notes" label="Notes" rows={3} value={invoice.notes} onChange={(v) => edit('notes', 'multiline', v)} />
    </SectionCard>
  );
}
