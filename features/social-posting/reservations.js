// Transactional slot + package reservations for social_posts scheduling.
//
// A schedule transition (create scheduled row, reschedule, approve-and-schedule, records scheduler, push)
// runs ONE Firestore transaction over: the post row, the client's CT-day ledger docs (target day and its
// neighbours, so spacing across midnight is checked) and a per-package reservation doc. Two competing
// schedulers therefore cannot both pass the same spacing/cap/package check: Firestore retries the loser's
// transaction against the winner's committed ledger.
//
// Functions here only call tx.get / tx.set (reads first, then writes). External work (package lookups,
// X calls) stays outside. No composite indexes: every read is a doc get by id.
//
// Orphan safety: a crash between transactions cannot strand a reservation, because the post row and the
// reservation are written in the SAME transaction. Releases on cron-side terminal outcomes are best-effort;
// a reservation whose post is no longer pending/at that time is treated as stale (see packageBlock).

import { isPendingRow } from './lifecycle.js';

export const LEDGER_COLLECTION = 'x_schedule_ledger';
export const PACKAGE_COLLECTION = 'x_package_reservations';
export const DEFAULT_TZ = 'America/Chicago';

const DAY_MS = 86_400_000;

const dateFmt = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });

/** CT (or tz) calendar day key for an instant. */
export const dayKeyOf = (ms, tz = DEFAULT_TZ) => dateFmt(tz).format(new Date(ms));

/** Neighbouring day key by calendar arithmetic (noon-UTC stepping keeps DST safe). */
export function shiftDay(day, delta) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

export const ledgerId = (clientId, day) => `${clientId}__${day}`;
export const packageResId = (clientId, packageId) => `${clientId}__${String(packageId).replace(/[/]/g, '_')}`;

const isReplyRow = (p) => Boolean(p?.replyTo) || p?.kind === 'reply';
const engineOf = (p) => (p?.engine === 'record' || p?.source === 'discogs-ingest' ? 'record' : p?.engine || 'untagged');
const slotOf = (p) => ({ ms: Date.parse(p.scheduledAt), engine: engineOf(p) });
// A manual (owner-posting) row keeps the slot it was handed over at, so the plan still counts it.
const hasSlot = (p) => p && (p.status === 'scheduled' || p.status === 'queued' || p.status === 'manual') && Number.isFinite(Date.parse(p.scheduledAt || ''));

function err(code, message, extra = {}) {
  return Object.assign(new Error(message), { status: 409, code, ...extra });
}

/**
 * Pure policy check over the ledger slots read inside the transaction.
 * `slots` = array of {postId, ms, engine} from the target day and its neighbours; `daySlots` = target day only.
 */
export function checkPlan({ slots, daySlots, candidate, config }) {
  const authored = config?.authored || {};
  const spacingMs = (authored.minSpacingMin ?? 0) * 60_000;
  if (spacingMs > 0) {
    const clash = slots.find((s) => Math.abs(s.ms - candidate.ms) < spacingMs);
    if (clash) {
      return { code: 'plan-spacing', message: `Too close to another scheduled post (${authored.minSpacingMin}-minute spacing in the plan).`, conflictPostId: clash.postId };
    }
  }
  if (Number.isFinite(authored.capPerDay) && daySlots.length >= authored.capPerDay) {
    return { code: 'plan-day-cap', message: `That day already has ${daySlots.length} scheduled posts (the plan caps authored posts at ${authored.capPerDay}/day).` };
  }
  const eng = config?.engines?.[candidate.engine];
  if (eng && Number.isFinite(eng.maxPerDay)) {
    const used = daySlots.filter((s) => s.engine === candidate.engine).length;
    if (used >= eng.maxPerDay) {
      return { code: 'plan-engine-cap', message: `The ${candidate.engine} engine is capped at ${eng.maxPerDay}/day in the plan and that day is full.` };
    }
  }
  return null;
}

const slotsFromDoc = (doc) => Object.entries(doc?.slots || {}).map(([postId, s]) => ({ postId, ms: s.ms, engine: s.engine }));

/**
 * Reserve (and release the previous slot of) one post inside a transaction.
 * MUST be called before any tx.set in the same transaction (reads first).
 * @returns {{writes: Array<()=>void>}} deferred writes; the caller runs them after its own reads
 */
export async function reserveInTx(db, tx, { clientId, previous, next, config, tz = DEFAULT_TZ, enforcePlan = false, override = false }) {
  const reads = {};
  const readLedger = async (day) => {
    if (reads[day] !== undefined) return reads[day];
    const ref = db.collection(LEDGER_COLLECTION).doc(ledgerId(clientId, day));
    const snap = await tx.get(ref);
    reads[day] = { ref, doc: snap.exists ? snap.data() : null };
    return reads[day];
  };

  const wantsSlot = hasSlot(next);
  const hadSlot = hasSlot(previous);
  const nextMs = wantsSlot ? Date.parse(next.scheduledAt) : null;
  const nextDay = wantsSlot ? dayKeyOf(nextMs, tz) : null;
  const prevDay = hadSlot ? dayKeyOf(Date.parse(previous.scheduledAt), tz) : null;

  // ---- reads (all before any write) ----
  let pkgRef = null;
  let pkgDoc = null;
  const pkgId = next.packageId || previous?.packageId || null;
  if (pkgId) {
    pkgRef = db.collection(PACKAGE_COLLECTION).doc(packageResId(clientId, pkgId));
    const s = await tx.get(pkgRef);
    pkgDoc = s.exists ? s.data() : null;
  }
  let heldBy = null;
  if (wantsSlot && pkgDoc && pkgDoc.state === 'active' && pkgDoc.postId !== next.id) {
    // The holder is only real if its post still sits pending at that time; otherwise the reservation is stale.
    const holder = await tx.get(db.collection('social_posts').doc(pkgDoc.postId));
    const h = holder.exists ? holder.data() : null;
    if (h && isPendingRow(h) && (h.scheduledAt || null) === (pkgDoc.scheduledAt || null)) heldBy = h;
  }
  if (wantsSlot) {
    for (const d of [shiftDay(nextDay, -1), nextDay, shiftDay(nextDay, 1)]) await readLedger(d);
  }
  if (hadSlot) await readLedger(prevDay);
  // The live queue inside the window also counts (single-field range query, clientId filtered in memory: no
  // composite index). It covers rows scheduled before the ledger existed and posted rows near the slot, so the
  // ledger needs no backfill. Phantom writes into the range conflict with this read and retry the transaction.
  let queueSlots = [];
  if (wantsSlot && enforcePlan && !override) {
    const from = new Date(nextMs - 40 * 3_600_000).toISOString();
    const to = new Date(nextMs + 40 * 3_600_000).toISOString();
    const qs = await tx.get(db.collection('social_posts').where('scheduledAt', '>=', from).where('scheduledAt', '<=', to));
    queueSlots = qs.docs.map((d) => d.data())
      .filter((r) => r.clientId === clientId && r.id !== next.id && ['scheduled', 'queued', 'posting', 'posted', 'manual'].includes(r.status) && !isReplyRow(r))
      .map((r) => ({ postId: r.id, ...slotOf(r) }))
      .filter((r) => Number.isFinite(r.ms));
  }

  // ---- decisions (pure) ----
  if (wantsSlot && heldBy) {
    throw err('package-already-pending', `This package is already ${heldBy.status} as another post (${heldBy.id}). Schedule that one or remove it first.`, { existingPostId: heldBy.id });
  }
  // Keeping the exact slot it already holds (e.g. scheduled -> manual takeover) is not a new scheduling decision.
  const sameSlot = hadSlot && wantsSlot && previous.scheduledAt === next.scheduledAt;
  if (wantsSlot && enforcePlan && !override && !sameSlot && !isReplyRow(next)) {
    const merge = (list) => { const seen = new Set(); return list.filter((x) => (seen.has(x.postId) ? false : (seen.add(x.postId), true))); };
    const around = merge([...[shiftDay(nextDay, -1), nextDay, shiftDay(nextDay, 1)].flatMap((d) => slotsFromDoc(reads[d].doc)), ...queueSlots]).filter((s) => s.postId !== next.id);
    const daySlots = around.filter((x) => dayKeyOf(x.ms, tz) === nextDay);
    const bad = checkPlan({ slots: around, daySlots, candidate: slotOf(next), config });
    if (bad) throw err(bad.code, bad.message, { conflictPostId: bad.conflictPostId });
  }

  // ---- writes (deferred; caller runs them after its own reads) ----
  const nowIso = new Date().toISOString();
  const touched = new Map(); // day -> mutable doc
  const docFor = (day) => {
    if (!touched.has(day)) {
      const cur = reads[day].doc;
      touched.set(day, { ref: reads[day].ref, doc: { clientId, day, slots: { ...(cur?.slots || {}) }, updatedAt: nowIso } });
    }
    return touched.get(day).doc;
  };
  if (hadSlot && enforcePlan) delete docFor(prevDay).slots[previous.id];
  if (wantsSlot && enforcePlan && !isReplyRow(next)) docFor(nextDay).slots[next.id] = slotOf(next);

  const writes = [];
  for (const { ref, doc } of touched.values()) writes.push(() => tx.set(ref, doc));
  if (pkgRef) {
    if (wantsSlot) {
      writes.push(() => tx.set(pkgRef, { clientId, packageId: pkgId, postId: next.id, scheduledAt: next.scheduledAt, state: 'active', updatedAt: nowIso }));
    } else if (pkgDoc && pkgDoc.state === 'active' && pkgDoc.postId === (previous?.id || next.id)) {
      writes.push(() => tx.set(pkgRef, { ...pkgDoc, state: 'released', releasedAt: nowIso, updatedAt: nowIso }));
    }
  }
  return { writes };
}

/** Best-effort release of whatever a (now terminal/unscheduled) post held; never throws into delivery paths. */
export async function releaseReservations(db, { clientId, post, tz = DEFAULT_TZ, enforcePlan = true }) {
  try {
    await db.runTransaction(async (tx) => {
      const { writes } = await reserveInTx(db, tx, {
        clientId,
        previous: post,
        next: { ...post, status: 'released', scheduledAt: null },
        tz,
        enforcePlan,
      });
      writes.forEach((w) => w());
    });
  } catch {
    // Cleanup only: a stale reservation is ignored by packageBlock, an orphan ledger slot is conservative.
  }
}
