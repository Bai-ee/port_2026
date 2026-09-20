// Invoice Studio design-layer plan Q2, Lane B — browser-local sequential
// numbering (§3.5 storage contract, L11). No account, no API route, no
// Firestore — everything here lives in localStorage, best-effort across
// tabs (a `storage` event listener is a nice-to-have this module does not
// itself need to provide — see the header note on cross-tab behavior below).
//
// A number is RESERVED (counter incremented, persisted) only when a caller
// invokes reserveNextNumber() — never as a side effect of rendering or
// normalizing an invoice. The orchestrator wires the one call site that
// matters (useInvoiceDraft.js's startNewInvoice()) after this lane lands;
// this module has no opinion about when it's called, only that calling it
// is correct, idempotent-safe (two back-to-back calls always mint two
// DIFFERENT numbers, never a repeat), and well tested.
//
// Client-safe on purpose: only imports features/invoices/model.js's pure
// grammar exports (NUMBER_PATTERN_TOKEN_RE, normalizeNumberPattern,
// DOC_KINDS) — no createRequire, no .cjs, matching every other file in this
// directory (see invoice-fields.js's own header comment for why that
// matters for the client bundle).

import { DOC_KINDS, normalizeNumberPattern, NUMBER_PATTERN_TOKEN_RE } from '../../../../../features/invoices/model.js';

export const NUMBERING_STORAGE_KEY = 'invoice-studio-numbering-v1';
const NUMBERING_VERSION = 1;
// Unbounded growth of `recent` would eventually hit localStorage's quota on
// a long-lived browser profile — cap it generously (every entry is three
// short fields) rather than never trimming.
const MAX_RECENT = 200;

function safeWindow() {
  return typeof window !== 'undefined' && window.localStorage ? window : null;
}

function emptyStore() {
  return { v: NUMBERING_VERSION, counters: {}, recent: [] };
}

/** Best-effort read — never throws (private window / blocked site data /
 * corrupt JSON all fall back to an empty store, same contract as
 * useInvoiceDraft.js's readStoredDraft()). Exported so the rail UI (or a
 * test) can inspect the store without duplicating this parsing. */
export function readNumberingStore() {
  try {
    const win = safeWindow();
    if (!win) return emptyStore();
    const raw = win.localStorage.getItem(NUMBERING_STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyStore();
    return {
      v: NUMBERING_VERSION,
      counters: parsed.counters && typeof parsed.counters === 'object' ? parsed.counters : {},
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeNumberingStore(store) {
  try {
    const win = safeWindow();
    if (!win) return;
    win.localStorage.setItem(NUMBERING_STORAGE_KEY, JSON.stringify({
      v: NUMBERING_VERSION,
      counters: store.counters,
      recent: store.recent,
    }));
  } catch {
    // Quota exceeded / blocked storage — reservation still returns a valid
    // number to the caller; only persistence (and therefore future
    // duplicate-detection/counter continuity) is best-effort.
  }
}

/** The counters map key for a docKind + already-normalized pattern pair —
 * §3.5: `docKind + ':' + normalizedPattern`. Exported so a caller that wants
 * to inspect a specific bucket's current counter doesn't have to reproduce
 * the join. */
export function bucketKey(docKind, normalizedPattern) {
  return `${docKind}:${normalizedPattern}`;
}

function normalizeDocKindForBucket(docKind) {
  return DOC_KINDS.includes(docKind) ? docKind : 'invoice';
}

/** Render a normalized pattern with a concrete sequence number. Pure/no I/O
 * — also used by the rail UI to show a non-committing "example" preview of
 * what a pattern will produce before the operator reserves anything. Any
 * token outside the grammar model.js's normalizeNumberPattern() already
 * validated away is left as literal text (defensive; normalizeNumberPattern
 * guarantees this never actually happens for a pattern that passed through
 * it). */
export function formatNumberFromPattern(pattern, seq) {
  const now = new Date();
  const YYYY = String(now.getFullYear());
  const YY = YYYY.slice(-2);
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const seqNum = Number.isFinite(Number(seq)) ? Math.max(0, Math.trunc(Number(seq))) : 0;
  return String(pattern).replace(NUMBER_PATTERN_TOKEN_RE, (match, token) => {
    if (token === 'YYYY') return YYYY;
    if (token === 'YY') return YY;
    if (token === 'MM') return MM;
    const seqMatch = /^seq:(\d)$/.exec(token);
    if (seqMatch) return String(seqNum).padStart(Number(seqMatch[1]), '0');
    return match;
  });
}

/** Required exact export/contract — see the Lane B handoff. Reserves the
 * next sequential number for `docKind:normalizedPattern`, persists the
 * incremented counter + a `recent` entry, and returns the formatted number
 * string synchronously (localStorage is sync, no promise needed).
 *
 * Idempotent-safe against double-invocation: two calls in a row (even the
 * exact same tick) always read-increment-write in order and mint two
 * different numbers, because each call re-reads the current counter value
 * from storage rather than closing over a stale one. */
export function reserveNextNumber(docKind, pattern) {
  const kind = normalizeDocKindForBucket(docKind);
  const normalizedPattern = normalizeNumberPattern(pattern);
  const key = bucketKey(kind, normalizedPattern);
  const store = readNumberingStore();
  const nextSeq = (Number(store.counters[key]) || 0) + 1;
  const number = formatNumberFromPattern(normalizedPattern, nextSeq);
  const counters = { ...store.counters, [key]: nextSeq };
  const recent = [{ number, docKind: kind, createdAt: Date.now() }, ...store.recent].slice(0, MAX_RECENT);
  writeNumberingStore({ counters, recent });
  return number;
}

/** The `recent` list, most-recent first. Exported for the rail's
 * duplicate-warning UI (and tests). */
export function getRecentNumbers() {
  return readNumberingStore().recent;
}

// ── Duplicate detection ─────────────────────────────────────────────────
// Rule (simple and honest, per the Lane B handoff's own framing): a number
// is flagged as a duplicate when it appears in `recent` MORE THAN ONCE, or
// when it appears exactly once but that one occurrence is NOT the single
// most-recent reservation (recent[0]). The second clause is what makes
// "just reserved this number" read as clean rather than a false-positive
// self-collision: right after reserveNextNumber() runs, recent[0].number
// equals the invoice's own invoiceNumber by construction. If the operator
// then hand-types a number matching an OLDER entry (recent[1..]) — or a
// stale/imported invoice happens to carry a number that collides with this
// browser's own numbering history — that reads as a genuine duplicate.
export function isDuplicateNumber(number) {
  const value = String(number ?? '').trim();
  if (!value) return false;
  const recent = getRecentNumbers();
  const matches = recent.filter((entry) => entry && entry.number === value);
  if (matches.length === 0) return false;
  if (matches.length > 1) return true;
  return recent[0]?.number !== value;
}

export default reserveNextNumber;
