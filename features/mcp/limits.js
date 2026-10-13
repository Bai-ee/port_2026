// limits.js - per-user rate limit, audit rows and the atomic daily cap for paid syncs.
// Pure with injected stores; Firestore implementations at the bottom.

import { redactValue, redactString } from './redact.js';
import { sha256hex } from './oauth.js';

export const RATE_LIMIT = Object.freeze({ calls: 120, windowMs: 10 * 60 * 1000 });
export const DAILY_PAID_CAP = 10;

export class LimitError extends Error {
  constructor(message, code, status = 429) { super(message); this.name = 'LimitError'; this.code = code; this.status = status; this.expose = true; }
}

/** What one JSON-RPC body costs against the rate limit: every tools/call counts (a batch of 20 counts 20), anything else 1. */
export function rpcCost(body) {
  const msgs = Array.isArray(body) ? body : [body];
  const calls = msgs.filter((m) => m && typeof m === 'object' && m.method === 'tools/call').length;
  return Math.max(1, calls);
}

/** Fixed-window counter. counters.incr(id, expiresAtMs, by = 1) -> new count. `cost` counts several calls at once. */
export async function checkRateLimit(counters, key, { limit = RATE_LIMIT.calls, windowMs = RATE_LIMIT.windowMs, now, cost = 1 }) {
  const bucket = Math.floor(now / windowMs);
  const count = await counters.incr(`${sha256hex(key).slice(0, 32)}_${bucket}`, (bucket + 2) * windowMs, Math.max(1, Math.floor(cost)));
  return { allowed: count <= limit, count, limit, retryAfterSec: Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000)) };
}

export const utcDay = (now) => new Date(now).toISOString().slice(0, 10);

// ---- audit -------------------------------------------------------------------------------------------------

export function auditEntry({ now, email, tool, args, ok, ms }) {
  let a;
  try { a = JSON.stringify(redactValue(args ?? {})); } catch { a = '{}'; }
  a = redactString(a);
  if (a.length > 1000) a = `${a.slice(0, 1000)}...`;
  return { at: new Date(now).toISOString(), email: String(email || '').toLowerCase(), tool: String(tool).slice(0, 80), args: a, ok: Boolean(ok), ms: Math.round(ms) || 0 };
}

// ---- daily cap for paid syncs ------------------------------------------------------------------------------
// Paid syncs run only when the owner presses Confirm on a proposal card. The cap is enforced in the executor, and the
// read + increment happen atomically (counters.reserve), so two concurrent confirms cannot both squeeze under it.

export const dailyPaidKey = (now) => `paid_sync_${utcDay(now)}`;

/** Take one slot of today's paid-sync budget. Throws LimitError('daily-cap') when none is left. */
export async function reserveDailyPaidSlot(counters, { now, cap = DAILY_PAID_CAP }) {
  const r = await counters.reserve(dailyPaidKey(now), cap, now + 2 * 86400000);
  if (!r.ok) throw new LimitError(`Daily limit reached: ${cap} paid syncs per day. It resets at 00:00 UTC.`, 'daily-cap');
  return r;
}

// ---- memory stores (tests) ---------------------------------------------------------------------------------

export function createMemoryCounters() {
  const m = new Map();
  return {
    incr: async (id, _exp, by = 1) => { const n = (m.get(id) || 0) + by; m.set(id, n); return n; },
    get: async (id) => m.get(id) || 0,
    reserve: async (id, cap) => { const n = m.get(id) || 0; if (n >= cap) return { ok: false, count: n }; m.set(id, n + 1); return { ok: true, count: n + 1 }; },
    _raw: m,
  };
}

// ---- firestore stores --------------------------------------------------------------------------------------

export function createFirestoreCounters(db) {
  const col = () => db.collection('mcp_rate_limits');
  return {
    incr: (id, expiresAt, by = 1) => db.runTransaction(async (tx) => {
      const ref = col().doc(id);
      const snap = await tx.get(ref);
      const n = (snap.exists ? snap.data().count || 0 : 0) + by;
      tx.set(ref, { count: n, expiresAt });
      return n;
    }),
    // Read + check + increment in ONE transaction (the daily paid-sync cap).
    reserve: (id, cap, expiresAt) => db.runTransaction(async (tx) => {
      const ref = col().doc(id);
      const snap = await tx.get(ref);
      const n = snap.exists ? snap.data().count || 0 : 0;
      if (n >= cap) return { ok: false, count: n };
      tx.set(ref, { count: n + 1, expiresAt });
      return { ok: true, count: n + 1 };
    }),
    get: async (id) => { const s = await col().doc(id).get(); return s.exists ? s.data().count || 0 : 0; },
  };
}

export function createFirestoreAudit(db) {
  return { write: async (entry) => { await db.collection('mcp_audit').add(entry); } };
}
