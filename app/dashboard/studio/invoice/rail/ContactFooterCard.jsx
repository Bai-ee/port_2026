'use client';

// Invoice Studio rail — Contact footer card. Prints no heading of its own
// (render.js's buildContactFooter() emits a bare <footer>, not a labelled
// block() section — mirrors buildCover(), see CoverCard.jsx's header
// comment). It owns no fields either: it reprints the `from.*` block
// (name/legal name/address/email/phone/site/tax ID) that InvoiceMetaCard
// already owns, plus the admin-only brand signature mark (never
// user-editable). This card exists so "Contact footer" still has a place
// in the rail to toggle/reorder, with an honest note pointing at where its
// fields actually live.

import React from 'react';
import { Mail } from 'lucide-react';
import SectionCard from './SectionCard';
import { RailEmptyHint } from './rail-field-controls';

export default function ContactFooterCard({ draft, open, onToggle }) {
  return (
    <SectionCard
      sectionId="contactFooter" id="invoice-rail-contact-footer-card" title="Contact footer"
      icon={<Mail size={18} strokeWidth={2} />} color="#f59e0b"
      open={open} onToggle={onToggle} draft={draft}
    >
      <div id="invoice-rail-contact-footer-note">
        <RailEmptyHint>
          Reprints the From name, address, and contact details from Invoice details. No fields here.
        </RailEmptyHint>
      </div>
    </SectionCard>
  );
}
