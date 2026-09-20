'use client';

// Invoice Studio rail — Bill to card. Prints as "Bill to" (render.js's
// buildBillTo -> block('invoice-bill-to-section', 'Bill to', ...)). Owns
// exactly billTo.{name,contact,email,address} — the fields that section
// builder reads. Ported from the old PartiesCard's "Bill to" panel, split
// off so it gets its own eye/reorder like every other printed section.
//
// Q2/Lane C addition (design-layer plan §4, L12/L15): a browser-local saved
// clients picker + "Save this client" action, backed by ../book.js. No
// network, no new top-level card — the picker/save button live inside this
// card's own body, same as every other contextual control in the rail.

import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import SectionCard from './SectionCard';
import { ui } from '../../components/rail-ui';
import { RailFieldGrid, RailTextInput, RailTextArea, railFieldStyle } from './rail-field-controls';
import { parseValue } from '../invoice-fields';
import { listClients, saveClient, BOOK_CHANGE_EVENT } from '../book';

export default function BillToCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const edit = (path, type, raw) => draft.applyFieldEdit(path, parseValue(type, raw), 'rail');

  // Saved clients live in a separate localStorage key from the draft
  // (invoice-studio-book-v1 — see ../book.js), so this card owns its own
  // small bit of state for the picker list: load on mount, then re-read on
  // book.js's BOOK_CHANGE_EVENT (fired after every save/delete, including
  // ones this card's own "Save this client" button triggers) — see that
  // event's own doc comment for why this can't just be "refresh after my
  // own click" (there's currently only one saved-clients surface, but the
  // event keeps this consistent with the item pickers for free).
  const [savedClients, setSavedClients] = useState([]);
  useEffect(() => {
    const refresh = () => setSavedClients(listClients());
    refresh();
    window.addEventListener(BOOK_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(BOOK_CHANGE_EVENT, refresh);
  }, []);

  const applySavedClient = (id) => {
    const found = savedClients.find((c) => c.id === id);
    if (!found) return;
    // One shallow-merge write for all four fields — updateBillTo (exposed
    // by useInvoiceDraft.js) instead of four separate applyFieldEdit calls.
    draft.updateBillTo({ name: found.name, contact: found.contact, email: found.email, address: found.address });
  };

  const canSaveClient = Boolean(String(invoice.billTo?.name ?? '').trim());
  const handleSaveClient = () => {
    if (!canSaveClient) return;
    // No need to setSavedClients() here — saveClient() fires
    // BOOK_CHANGE_EVENT on success, which the effect above already listens
    // for and reacts to.
    saveClient({
      name: invoice.billTo.name,
      contact: invoice.billTo.contact,
      email: invoice.billTo.email,
      address: invoice.billTo.address,
    });
  };

  return (
    <SectionCard
      sectionId="billTo" id="invoice-rail-bill-to-card" title="Bill to"
      icon={<Users size={18} strokeWidth={2} />} color="#0ea5e9"
      subtitle={invoice.billTo?.name || 'Bill to —'} open={open} onToggle={onToggle} draft={draft}
    >
      {savedClients.length > 0 && (
        <label id="invoice-rail-bill-to-saved-clients-row" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={railFieldStyle.label}>Saved clients</span>
          <select
            id="invoice-rail-bill-to-saved-client-select"
            value=""
            onChange={(e) => applySavedClient(e.target.value)}
            style={railFieldStyle.input}
          >
            <option value="">Choose a saved client to autofill…</option>
            {savedClients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}

      <RailFieldGrid>
        <RailTextInput path="billTo.name" label="Client name" value={invoice.billTo.name} onChange={(v) => edit('billTo.name', 'text', v)} />
        <RailTextInput path="billTo.contact" label="Contact" value={invoice.billTo.contact} onChange={(v) => edit('billTo.contact', 'text', v)} />
        <RailTextInput path="billTo.email" label="Email" value={invoice.billTo.email} onChange={(v) => edit('billTo.email', 'text', v)} />
      </RailFieldGrid>
      <RailTextArea path="billTo.address" label="Address" rows={2} value={invoice.billTo.address} onChange={(v) => edit('billTo.address', 'multiline', v)} />

      <button
        type="button"
        id="invoice-rail-bill-to-save-client-button"
        onClick={handleSaveClient}
        disabled={!canSaveClient}
        title={canSaveClient ? 'Save this client for reuse on future invoices' : 'Enter a client name first'}
        style={{ ...ui.btn(false), justifySelf: 'start', opacity: canSaveClient ? 1 : 0.4, cursor: canSaveClient ? 'pointer' : 'not-allowed' }}
      >
        Save this client
      </button>
    </SectionCard>
  );
}
