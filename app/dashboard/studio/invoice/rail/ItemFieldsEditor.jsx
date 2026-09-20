'use client';

// Invoice Studio rail — one line item's fields (lane D). Shared by
// LineItemsCard (categorized) and StandaloneItemsCard for the same reason
// InvoiceBuilderCard.jsx shared a single `ItemEditor` between its section 02
// and 03: the row shape (name/note/qty/unitPrice/costLabel/subItems) is
// identical, only where the row lives in the draft differs.
//
// ⚠️ qty/unitPrice do NOT go through `draft.applyFieldEdit` — useInvoiceDraft
// already recomputes `total` centrally on any qty/unitPrice patch
// (updateItem/updateStandaloneItem, see its header comment), so this editor
// calls `onQtyPriceChange(patch)` (bound by the parent card to the correct
// mutator) instead of duplicating `round2(qty * unitPrice)` here. Every
// other field on the row (name/note/costLabel/subItems) has no derived
// value, so those go through `draft.applyFieldEdit(path, value, 'rail')`
// directly, same as everywhere else in the rail.
//
// Q2/Lane C addition: a per-row "Save this item" action (design-layer plan
// §4, L12/L15) — reads this row's own name/note/qty/unitPrice/costLabel and
// upserts them into the browser-local book (../book.js). It's on the row
// itself (not the parent card) because this is the one component both
// LineItemsCard and StandaloneItemsCard already share, so one place covers
// both item lists. No callback prop needed to refresh a picker — book.js's
// saveItem() fires BOOK_CHANGE_EVENT on success, which both cards' own
// "Saved items" pickers already subscribe to (see their header comments).

import React from 'react';
import { ui } from '../../components/rail-ui';
import { RailTextInput, RailNumberInput, RailIconButton, RailAddButton, RailRow } from './rail-field-controls';
import { parseValue } from '../invoice-fields';
import { saveItem } from '../book';

export default function ItemFieldsEditor({
  item, pathPrefix, domId, draft,
  onQtyPriceChange, onRemove, onAddSubItem, onRemoveSubItem,
}) {
  const editField = (field, type, raw) => draft.applyFieldEdit(`${pathPrefix}.${field}`, parseValue(type, raw), 'rail');
  const displayTotal = item.costLabel || item.total || 0;
  const canSaveItem = Boolean(String(item.name ?? '').trim());
  const handleSaveItem = () => {
    if (!canSaveItem) return;
    saveItem({ name: item.name, note: item.note, qty: item.qty, unitPrice: item.unitPrice, costLabel: item.costLabel });
  };

  return (
    <RailRow id={domId}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 140px', minWidth: 0 }}>
          <RailTextInput path={`${pathPrefix}.name`} label="Item name" value={item.name} onChange={(v) => editField('name', 'text', v)} />
        </div>
        <div style={{ flex: '1 1 60px', minWidth: 60 }}>
          <RailNumberInput path={`${pathPrefix}.qty`} label="Qty" value={item.qty} step="1" min="0" onChange={(v) => onQtyPriceChange({ qty: parseValue('number', v) })} />
        </div>
        <div style={{ flex: '1 1 80px', minWidth: 80 }}>
          <RailNumberInput path={`${pathPrefix}.unitPrice`} label="Unit price" value={item.unitPrice} onChange={(v) => onQtyPriceChange({ unitPrice: parseValue('number', v) })} />
        </div>
        <div style={{ flex: '1 1 80px', minWidth: 80 }}>
          {/* Derived, not user-editable — item.total is kept in sync by
              useInvoiceDraft's updateItem/updateStandaloneItem, never set
              here. No data-inv-rail-field: it's not in invoice-fields.js's
              FIELD_PATHS (derived values aren't addressable field paths —
              see that file's fieldMeta comment), so the focus seam has
              nothing to map it to either. */}
          <RailTextInput label="Total" value={displayTotal} onChange={() => {}} readOnly />
        </div>
      </div>

      <RailTextInput
        path={`${pathPrefix}.costLabel`} label="Cost label"
        value={item.costLabel} placeholder="Leave blank to show qty × unit price"
        onChange={(v) => editField('costLabel', 'text', v)}
      />
      <RailTextInput
        path={`${pathPrefix}.note`} label="Note" value={item.note} placeholder="Optional description line"
        onChange={(v) => editField('note', 'text', v)}
      />

      <div style={{ display: 'grid', gap: 6 }}>
        <span style={{ ...ui.label }}>Sub-items</span>
        {item.subItems.map((sub, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <RailTextInput path={`${pathPrefix}.subItems[${idx}].name`} value={sub.name} placeholder="Sub-item name" onChange={(v) => editField(`subItems[${idx}].name`, 'text', v)} />
            </div>
            <div style={{ flex: 1, minWidth: 60 }}>
              <RailTextInput path={`${pathPrefix}.subItems[${idx}].cost`} value={sub.cost} placeholder="Cost" onChange={(v) => editField(`subItems[${idx}].cost`, 'text', v)} />
            </div>
            <RailIconButton onClick={() => onRemoveSubItem(idx)} label={`Remove sub-item ${idx + 1}`} danger />
          </div>
        ))}
        <RailAddButton onClick={onAddSubItem}>Add sub-item</RailAddButton>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          id={`${domId}-save-item-button`}
          onClick={handleSaveItem}
          disabled={!canSaveItem}
          title={canSaveItem ? 'Save this item for reuse on future invoices' : 'Enter an item name first'}
          style={{ ...ui.btn(false), gap: 6, opacity: canSaveItem ? 1 : 0.4, cursor: canSaveItem ? 'pointer' : 'not-allowed' }}
        >
          Save this item
        </button>
        <button
          type="button"
          onClick={onRemove}
          style={{ ...ui.btn(false), justifySelf: 'start', gap: 6, color: '#dc2626', borderColor: 'rgba(220,38,38,0.35)' }}
        >
          Remove item
        </button>
      </div>
    </RailRow>
  );
}
