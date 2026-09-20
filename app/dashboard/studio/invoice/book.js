// Invoice Studio — local "book" of saved clients/items (Lane C, design-layer
// plan §3.5 / L12: browser-local only, no account sync, no API route, no
// Firestore collection, no network calls of any kind). Pure localStorage
// read/write, no React — the same "never throws, quota/private-window
// degrades to a silent no-op" idiom useInvoiceDraft.js already uses for its
// own draft persistence (see that file's readStoredDraft/writeStoredDraft/
// clearStoredDraft: every access wrapped in try/catch, missing/blocked
// storage treated as "nothing saved" rather than an error).
//
// Nothing outside invoice/rail/{BillToCard,LineItemsCard,StandaloneItemsCard,
// ItemFieldsEditor}.jsx calls into this file — Lane C owns the whole
// contract end to end (controlling plan §4, Q2/Lane C), so the exact
// function names/shapes below are this lane's own design choice, not a
// cross-lane contract (unlike Lane B's reserveNextNumber, which the
// orchestrator calls directly).
//
// Storage shape (design-layer plan §3.5, verbatim):
//   invoice-studio-book-v1 = {
//     v: 1,
//     clients: [{ id, name, contact, email, address, updatedAt }],
//     items: [{ id, name, note, qty, unitPrice, costLabel, updatedAt }],
//   }
//
// Dedupe key: `name`, case-insensitive + trimmed, for BOTH clients and
// items. Saving over an existing name updates that record in place (same
// id, fresh updatedAt) instead of forking a duplicate. Items deliberately do
// NOT fold unitPrice/qty into the key — "Save this item" is meant to let an
// operator re-save the same named item after correcting its rate/qty/note
// and have that replace the old entry, not create a second "Consulting" row
// every time the price changes. A blank/whitespace-only name never matches
// (or creates) anything — see dedupeKey()/saveClient()/saveItem() below.

const STORAGE_KEY = 'invoice-studio-book-v1';
const BOOK_VERSION = 1;

// Fired on `window` after any successful write (save/delete, either
// collection). BillToCard/LineItemsCard/StandaloneItemsCard are separate
// component instances that each load their own saved-clients/saved-items
// list once on mount — without this, a client saved from BillToCard or an
// item saved from LineItemsCard would not appear in StandaloneItemsCard's
// picker (or vice versa) until a full page reload, even though the write
// itself succeeded immediately. Every card subscribes to this event and
// re-reads its list, so a save/delete anywhere is reflected everywhere in
// the same session — no cross-file contract beyond "listen for this event
// name", and no framework/library needed (a plain DOM Event is enough; this
// is same-document, so the native `storage` event, which only fires in
// OTHER tabs, would not do the job here).
export const BOOK_CHANGE_EVENT = 'invoice-studio-book:changed';

function notifyBookChanged() {
  try {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new Event(BOOK_CHANGE_EVENT));
  } catch {
    // A notification failure must never break the save/delete that triggered it.
  }
}

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function dedupeKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

function emptyBook() {
  return { clients: [], items: [] };
}

// ── localStorage (best-effort; never throws) ────────────────────────────
function readBookRaw() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return emptyBook();
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyBook();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.v !== BOOK_VERSION) return emptyBook();
    return {
      clients: Array.isArray(parsed.clients) ? parsed.clients : [],
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    // Corrupt JSON / private window / blocked site data — behave as an
    // empty book rather than throwing; the tool must still render.
    return emptyBook();
  }
}

function writeBookRaw(book) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: BOOK_VERSION,
      clients: Array.isArray(book?.clients) ? book.clients : [],
      items: Array.isArray(book?.items) ? book.items : [],
    }));
  } catch {
    // Quota exceeded / blocked storage — best-effort, never fatal. The
    // caller's in-memory return value still reflects the attempted save;
    // it just won't survive a reload this time.
  }
}

function sortByUpdatedDesc(list) {
  return [...list].sort((a, b) => (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0));
}

function upsert(list, fields, shape) {
  const key = dedupeKey(fields.name);
  const now = Date.now();
  const existingIdx = key ? list.findIndex((row) => dedupeKey(row?.name) === key) : -1;
  if (existingIdx >= 0) {
    const updated = { ...shape(fields), id: list[existingIdx].id, updatedAt: now };
    const nextList = list.slice();
    nextList[existingIdx] = updated;
    return { list: nextList, record: updated };
  }
  const record = { id: makeId('bookrow'), ...shape(fields), updatedAt: now };
  return { list: [...list, record], record };
}

// ── Public read API ───────────────────────────────────────────────────────

/** Read the full book. Never throws; always `{clients:[], items:[]}` even
 * with no window/localStorage, corrupt JSON, or an unrecognized version. */
export function readBook() {
  return readBookRaw();
}

/** Saved clients, most-recently-updated first. */
export function listClients() {
  return sortByUpdatedDesc(readBookRaw().clients);
}

/** Saved items, most-recently-updated first. */
export function listItems() {
  return sortByUpdatedDesc(readBookRaw().items);
}

// ── Public write API ─────────────────────────────────────────────────────

/** Upsert a client by case-insensitive-trimmed name. Returns the saved
 * record (new or updated, always carrying `id`/`updatedAt`), or `null` if
 * `name` is blank — never throws even under a storage failure. */
export function saveClient({ name, contact = '', email = '', address = '' } = {}) {
  if (!String(name ?? '').trim()) return null;
  const book = readBookRaw();
  const { list, record } = upsert(book.clients, { name, contact, email, address }, (f) => ({
    name: String(f.name ?? ''),
    contact: String(f.contact ?? ''),
    email: String(f.email ?? ''),
    address: String(f.address ?? ''),
  }));
  writeBookRaw({ ...book, clients: list });
  notifyBookChanged();
  return record;
}

/** Upsert an item by case-insensitive-trimmed name. Returns the saved
 * record, or `null` if `name` is blank — never throws. */
export function saveItem({ name, note = '', qty = 1, unitPrice = 0, costLabel = '' } = {}) {
  if (!String(name ?? '').trim()) return null;
  const book = readBookRaw();
  const { list, record } = upsert(book.items, { name, note, qty, unitPrice, costLabel }, (f) => ({
    name: String(f.name ?? ''),
    note: String(f.note ?? ''),
    qty: Number.isFinite(Number(f.qty)) ? Number(f.qty) : 0,
    unitPrice: Number.isFinite(Number(f.unitPrice)) ? Number(f.unitPrice) : 0,
    costLabel: String(f.costLabel ?? ''),
  }));
  writeBookRaw({ ...book, items: list });
  notifyBookChanged();
  return record;
}

/** Remove a saved client by id. No-op (never throws) if it doesn't exist or
 * storage is unavailable. */
export function deleteClient(id) {
  const book = readBookRaw();
  writeBookRaw({ ...book, clients: book.clients.filter((c) => c?.id !== id) });
  notifyBookChanged();
}

/** Remove a saved item by id. Same contract as deleteClient(). */
export function deleteItem(id) {
  const book = readBookRaw();
  writeBookRaw({ ...book, items: book.items.filter((it) => it?.id !== id) });
  notifyBookChanged();
}

// ── Draft-shape helper ──────────────────────────────────────────────────
// Builds a fresh draft-shaped item — id, name, note, qty, unitPrice, total,
// costLabel, subItems — matching useInvoiceDraft.js's own emptyItem()/
// normalizeItemShape() row shape exactly. Exported so LineItemsCard /
// StandaloneItemsCard (the only callers) can insert a saved item via ONE
// atomic `draft.updateCategory(catId, {items:[...]})` /
// `draft.updateInvoiceField({standaloneItems:[...]})` patch — appending this
// fully-formed row to the current items array in a single functional
// update — instead of the two-step `draft.addItem()` then
// `draft.updateItem()` race the design-layer handoff flagged (`addItem`
// doesn't return the new row's id today, and two setState calls across two
// event handlers aren't guaranteed to observe each other's result before
// the next render). `total` is computed the same way
// useInvoiceDraft.updateItem()/updateStandaloneItem() would on a qty/price
// patch: qty * unitPrice, unless costLabel overrides the display.
export function toDraftItem(saved) {
  const qty = Number.isFinite(Number(saved?.qty)) ? Number(saved.qty) : 0;
  const unitPrice = Number.isFinite(Number(saved?.unitPrice)) ? Number(saved.unitPrice) : 0;
  const costLabel = String(saved?.costLabel ?? '');
  return {
    id: makeId('item'),
    name: String(saved?.name ?? ''),
    note: String(saved?.note ?? ''),
    qty,
    unitPrice,
    total: costLabel ? 0 : round2(qty * unitPrice),
    costLabel,
    subItems: [],
  };
}
