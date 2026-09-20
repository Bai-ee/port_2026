'use client';

// Invoice Studio rail — Line items card. Prints as "Line items" (render.js's
// buildLineItems -> block('invoice-line-items-section', 'Line items', ...)):
// categories -> items -> sub-items. Row rendering is ItemFieldsEditor
// (shared with StandaloneItemsCard); this file owns the category shell
// (add/remove/rename category, add item) and wires each item's derived-total
// mutator to `draft.updateItem` — see ItemFieldsEditor's header comment for
// why qty/unitPrice bypass `applyFieldEdit`.
//
// Q2/Lane C addition (design-layer plan §4, L12/L15): a per-category "Saved
// items" picker, backed by ../book.js. Picking a saved item builds a fully-
// formed draft item (book.js's toDraftItem()) and appends it to that
// category's items array via ONE `draft.updateCategory(catId, {items:[...]})`
// call — not `draft.addItem()` followed by a separate `draft.updateItem()`,
// which would race two setState calls across two event handlers (addItem
// doesn't return the new row's id today, so there's nothing safe to target
// in a same-tick follow-up call). A single atomic patch has no such race and
// needs no post-add lookup/effect. Verified in the browser (see this lane's
// report).

import React, { useEffect, useState } from 'react';
import { ListOrdered } from 'lucide-react';
import SectionCard from './SectionCard';
import { ui } from '../../components/rail-ui';
import { RailTextInput, RailAddButton, railFieldStyle } from './rail-field-controls';
import ItemFieldsEditor from './ItemFieldsEditor';
import { parseValue } from '../invoice-fields';
import { listItems, toDraftItem, BOOK_CHANGE_EVENT } from '../book';

export default function LineItemsCard({ draft, open, onToggle }) {
  const { invoice } = draft;
  const itemCount = invoice.categories.reduce((sum, c) => sum + c.items.length, 0);

  // Saved items live in a separate localStorage key from the draft (see
  // ../book.js) — loaded on mount, then re-read on book.js's
  // BOOK_CHANGE_EVENT (fired after every save/delete, from THIS card's own
  // ItemFieldsEditor rows or from StandaloneItemsCard's — see that event's
  // doc comment for why a plain mount-only load isn't enough).
  const [savedItems, setSavedItems] = useState([]);
  useEffect(() => {
    const refresh = () => setSavedItems(listItems());
    refresh();
    window.addEventListener(BOOK_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(BOOK_CHANGE_EVENT, refresh);
  }, []);

  const addSavedItemToCategory = (catId, savedId) => {
    const saved = savedItems.find((it) => it.id === savedId);
    if (!saved) return;
    const cat = invoice.categories.find((c) => c.id === catId);
    if (!cat) return;
    draft.updateCategory(catId, { items: [...cat.items, toDraftItem(saved)] });
  };

  return (
    <SectionCard
      sectionId="lineItems" id="invoice-rail-line-items-card" icon={<ListOrdered size={18} strokeWidth={2} />} title="Line items"
      subtitle={`${invoice.categories.length} categor${invoice.categories.length === 1 ? 'y' : 'ies'} · ${itemCount} item${itemCount === 1 ? '' : 's'}`}
      color="#8b5cf6" open={open} onToggle={onToggle} draft={draft}
    >
      {invoice.categories.map((cat, catIdx) => (
        <div
          key={cat.id}
          id={`invoice-rail-line-items-category-${cat.id}`}
          style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.35)' }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <RailTextInput
                path={`categories[${cat.id}].name`} label="Category name" value={cat.name}
                placeholder={`Category ${catIdx + 1}`}
                onChange={(v) => draft.applyFieldEdit(`categories[${cat.id}].name`, parseValue('text', v), 'rail')}
              />
            </div>
            <button
              type="button"
              onClick={() => draft.removeCategory(cat.id)}
              disabled={invoice.categories.length <= 1}
              style={{ ...ui.btn(false), height: 38, opacity: invoice.categories.length <= 1 ? 0.4 : 1, color: '#dc2626', borderColor: 'rgba(220,38,38,0.35)' }}
            >
              Remove
            </button>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {cat.items.map((item) => (
              <ItemFieldsEditor
                key={item.id}
                item={item}
                draft={draft}
                pathPrefix={`categories[${cat.id}].items[${item.id}]`}
                domId={`invoice-rail-line-item-${item.id}`}
                onQtyPriceChange={(patch) => draft.updateItem(cat.id, item.id, patch)}
                onRemove={() => draft.removeItem(cat.id, item.id)}
                onAddSubItem={() => draft.addSubItem('category', cat.id, item.id)}
                onRemoveSubItem={(idx) => draft.removeSubItem('category', cat.id, item.id, idx)}
              />
            ))}
          </div>

          {savedItems.length > 0 && (
            <label id={`invoice-rail-line-items-category-${cat.id}-saved-items-row`} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={railFieldStyle.label}>Saved items</span>
              <select
                value=""
                onChange={(e) => addSavedItemToCategory(cat.id, e.target.value)}
                style={railFieldStyle.input}
              >
                <option value="">Add a saved item…</option>
                {savedItems.map((it) => (
                  <option key={it.id} value={it.id}>{it.name}</option>
                ))}
              </select>
            </label>
          )}

          <RailAddButton onClick={() => draft.addItem(cat.id)}>Add item</RailAddButton>
        </div>
      ))}
      <RailAddButton full onClick={draft.addCategory}>Add category</RailAddButton>
    </SectionCard>
  );
}
