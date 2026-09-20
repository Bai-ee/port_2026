'use client';

// Invoice Studio rail — Additional items card. ⚠️ Titled "Additional items"
// to match what render.js's buildStandaloneItems() actually prints
// (block('invoice-standalone-items-section', 'Additional items', ...)) —
// NOT "Standalone items" (the draft field name / the old admin card's
// label / registry.js's INVOICE_SECTIONS label, which all differ from the
// renderer's own string; see this rework's handoff note on titling from
// render.js, not the registry). Shares ItemFieldsEditor with LineItemsCard
// (see that file's header comment for the qty/unitPrice recompute note).
//
// Q2/Lane C addition (design-layer plan §4, L12/L15): a "Saved items"
// picker, backed by ../book.js. Same atomic-insert approach as
// LineItemsCard (see that file's header comment for why) — here the target
// is the flat `invoice.standaloneItems` array via `draft.updateInvoiceField`
// instead of a per-category `draft.updateCategory`.

import React, { useEffect, useState } from 'react';
import { PackagePlus } from 'lucide-react';
import SectionCard from './SectionCard';
import { RailAddButton, RailEmptyHint, railFieldStyle } from './rail-field-controls';
import ItemFieldsEditor from './ItemFieldsEditor';
import { listItems, toDraftItem, BOOK_CHANGE_EVENT } from '../book';

export default function StandaloneItemsCard({ draft, open, onToggle }) {
  const { invoice } = draft;

  // See LineItemsCard.jsx's matching comment — same book.js-backed picker,
  // same BOOK_CHANGE_EVENT subscription so an item saved from either card
  // (or this one) shows up in both without a page reload.
  const [savedItems, setSavedItems] = useState([]);
  useEffect(() => {
    const refresh = () => setSavedItems(listItems());
    refresh();
    window.addEventListener(BOOK_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(BOOK_CHANGE_EVENT, refresh);
  }, []);

  const addSavedItem = (savedId) => {
    const saved = savedItems.find((it) => it.id === savedId);
    if (!saved) return;
    draft.updateInvoiceField({ standaloneItems: [...invoice.standaloneItems, toDraftItem(saved)] });
  };

  return (
    <SectionCard
      sectionId="standaloneItems" id="invoice-rail-standalone-items-card" icon={<PackagePlus size={18} strokeWidth={2} />} title="Additional items"
      subtitle={`${invoice.standaloneItems.length} item${invoice.standaloneItems.length === 1 ? '' : 's'}`}
      color="#d946ef" open={open} onToggle={onToggle} draft={draft}
    >
      {invoice.standaloneItems.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {invoice.standaloneItems.map((item) => (
            <ItemFieldsEditor
              key={item.id}
              item={item}
              draft={draft}
              pathPrefix={`standaloneItems[${item.id}]`}
              domId={`invoice-rail-standalone-item-${item.id}`}
              onQtyPriceChange={(patch) => draft.updateStandaloneItem(item.id, patch)}
              onRemove={() => draft.removeStandaloneItem(item.id)}
              onAddSubItem={() => draft.addSubItem('standalone', null, item.id)}
              onRemoveSubItem={(idx) => draft.removeSubItem('standalone', null, item.id, idx)}
            />
          ))}
        </div>
      ) : (
        <RailEmptyHint>No additional items yet.</RailEmptyHint>
      )}

      {savedItems.length > 0 && (
        <label id="invoice-rail-standalone-items-saved-items-row" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={railFieldStyle.label}>Saved items</span>
          <select
            value=""
            onChange={(e) => addSavedItem(e.target.value)}
            style={railFieldStyle.input}
          >
            <option value="">Add a saved item…</option>
            {savedItems.map((it) => (
              <option key={it.id} value={it.id}>{it.name}</option>
            ))}
          </select>
        </label>
      )}

      <RailAddButton full onClick={draft.addStandaloneItem}>Add additional item</RailAddButton>
    </SectionCard>
  );
}
