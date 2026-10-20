// Telegram Firestore store. Every function takes `db` first (admin-compatible).
// No composite indexes: query one field, filter the rest in memory.
// Timestamps are ISO strings; every time-dependent function accepts `now` (ms).

import crypto from 'node:crypto';

const COL = {
  challenges: 'telegram_link_challenges',
  pendingLink: 'telegram_link_pending',
  bindings: 'telegram_bindings',
  updates: 'telegram_updates',
  tickets: 'telegram_tickets',
  outbox: 'telegram_outbox',
  notices: 'telegram_notices',
  settings: 'telegram_settings',
  state: 'telegram_state',
  pending: 'telegram_pending',
};

const MAX_UPDATE_ATTEMPTS = 5;
const MAX_OUTBOX_ATTEMPTS = 5;
const OUTBOX_BACKOFF_MS = [30_000, 120_000, 480_000, 1_200_000];
const TICKET_RECLAIM_MS = 120_000;
const TICKET_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const iso = (ms) => new Date(ms).toISOString();
const ms = (v) => (typeof v === 'number' ? v : Date.parse(v) || 0);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const ref = (db, col, id) => db.collection(col).doc(String(id));

// Firestore rejects `undefined`; strip it from caller-supplied structures.
function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out = {};
    for (const [k, val] of Object.entries(v)) if (val !== undefined) out[k] = clean(val);
    return out;
  }
  return v;
}

const isAlreadyExists = (err) =>
  err?.code === 6 || err?.code === 'already-exists' || /already exists/i.test(err?.message || '');

// doc.create() fails if the doc exists (the dedup primitive). The in-memory fake has no
// create(), so fall back to a serialized transaction doing the same check.
async function createOnce(db, docRef, data) {
  if (typeof docRef.create === 'function') {
    try {
      await docRef.create(data);
      return true;
    } catch (err) {
      if (isAlreadyExists(err)) return false;
      throw err;
    }
  }
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (snap.exists) return false;
    tx.set(docRef, data);
    return true;
  });
}

function fail(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

// ── Link challenges ────────────────────────────────────────────────────────

export async function createLinkChallenge(db, { uid, clientId, now = Date.now(), ttlMs = 600000 }) {
  const code = crypto.randomBytes(24).toString('base64url'); // 32 url-safe chars
  const id = sha256(code);
  const expiresAt = iso(now + ttlMs);
  const pointerRef = ref(db, COL.pendingLink, `${uid}__${clientId}`);
  await db.runTransaction(async (tx) => {
    const prev = await tx.get(pointerRef);
    const prevId = prev.exists ? prev.data().challengeId : null;
    let prevSnap = null;
    if (prevId) prevSnap = await tx.get(ref(db, COL.challenges, prevId));
    // A newer code supersedes any unconfirmed older one for the same (uid, client).
    if (prevSnap?.exists && ['open', 'claimed'].includes(prevSnap.data().status)) {
      tx.set(prevSnap.ref, { status: 'expired' }, { merge: true });
    }
    tx.set(ref(db, COL.challenges, id), {
      uid, clientId, status: 'open', expiresAt, createdAt: iso(now),
      telegramUserId: null, chatId: null, telegramUsername: null, firstName: null,
    });
    tx.set(pointerRef, { challengeId: id });
  });
  return { code, expiresAt };
}

export async function attachTelegramToChallenge(db, { code, telegramUserId, chatId, telegramUsername, firstName, now = Date.now() }) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(code)) return { ok: false, reason: 'unknown' };
  const challengeRef = ref(db, COL.challenges, sha256(code));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(challengeRef);
    if (!snap.exists) return { ok: false, reason: 'unknown' };
    const c = snap.data();
    if (c.status === 'confirmed') return { ok: false, reason: 'used' };
    if (c.status === 'expired' || ms(c.expiresAt) <= now) return { ok: false, reason: 'expired' };
    if (c.status === 'claimed') {
      // Same person re-sending /start is harmless; anyone else must not hijack it.
      if (String(c.telegramUserId) === String(telegramUserId)) return { ok: true, clientId: c.clientId, uid: c.uid };
      return { ok: false, reason: 'used' };
    }
    tx.set(challengeRef, {
      status: 'claimed',
      telegramUserId: String(telegramUserId),
      chatId: String(chatId),
      telegramUsername: telegramUsername || null,
      firstName: firstName || null,
      claimedAt: iso(now),
    }, { merge: true });
    return { ok: true, clientId: c.clientId, uid: c.uid };
  });
}

export async function getPendingLink(db, { uid, clientId, now = Date.now() }) {
  const pointer = await ref(db, COL.pendingLink, `${uid}__${clientId}`).get();
  if (!pointer.exists) return null;
  const snap = await ref(db, COL.challenges, pointer.data().challengeId).get();
  if (!snap.exists) return null;
  const c = snap.data();
  if (c.status !== 'claimed' || ms(c.expiresAt) <= now) return null;
  return { id: snap.id, ...c };
}

export async function confirmLink(db, { uid, clientId, now = Date.now() }) {
  const pointerRef = ref(db, COL.pendingLink, `${uid}__${clientId}`);
  return db.runTransaction(async (tx) => {
    const pointer = await tx.get(pointerRef);
    if (!pointer.exists) throw fail('no-pending-link', 'No pending Telegram link', 404);
    const chRef = ref(db, COL.challenges, pointer.data().challengeId);
    const ch = await tx.get(chRef);
    const c = ch.exists ? ch.data() : null;
    if (!c || c.status !== 'claimed' || ms(c.expiresAt) <= now) {
      throw fail('no-pending-link', 'No pending Telegram link', 404);
    }
    const sameUserRef = ref(db, COL.bindings, c.telegramUserId);
    const sameUser = await tx.get(sameUserRef);
    const clientBindings = await tx.get(db.collection(COL.bindings).where('clientId', '==', clientId));
    const others = clientBindings.docs.filter((d) => d.data().status === 'active' && String(d.id) !== String(c.telegramUserId));

    // bindingVersion only ever grows, so tickets issued against an old binding die.
    let version = sameUser.exists ? sameUser.data().bindingVersion || 0 : 0;
    for (const d of clientBindings.docs) version = Math.max(version, d.data().bindingVersion || 0);
    for (const d of others) {
      tx.set(d.ref, { status: 'revoked', revokedAt: iso(now), bindingVersion: (d.data().bindingVersion || 0) + 1 }, { merge: true });
    }
    const binding = {
      telegramUserId: String(c.telegramUserId),
      chatId: String(c.chatId),
      uid,
      clientId,
      status: 'active',
      bindingVersion: version + 1,
      telegramUsername: c.telegramUsername || null,
      firstName: c.firstName || null,
      linkedAt: iso(now),
      revokedAt: null,
    };
    tx.set(sameUserRef, binding);
    tx.set(chRef, { status: 'confirmed', confirmedAt: iso(now) }, { merge: true });
    return binding;
  });
}

export async function getBinding(db, telegramUserId) {
  const snap = await ref(db, COL.bindings, telegramUserId).get();
  return snap.exists ? snap.data() : null;
}

export async function getActiveBindingForClient(db, clientId) {
  const snap = await db.collection(COL.bindings).where('clientId', '==', clientId).get();
  const hit = snap.docs.find((d) => d.data().status === 'active');
  return hit ? hit.data() : null;
}

export async function listActiveBindings(db) {
  const snap = await db.collection(COL.bindings).where('status', '==', 'active').get();
  return snap.docs.map((d) => d.data());
}

export async function revokeBinding(db, { clientId, uid, now = Date.now() }) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection(COL.bindings).where('clientId', '==', clientId));
    const hit = snap.docs.find((d) => d.data().status === 'active' && (!uid || d.data().uid === uid));
    if (!hit) return null;
    const next = { ...hit.data(), status: 'revoked', revokedAt: iso(now), bindingVersion: (hit.data().bindingVersion || 0) + 1 };
    tx.set(hit.ref, next, { merge: true });
    return next;
  });
}

// ── Update inbox ───────────────────────────────────────────────────────────

const pick = (obj, keys) => {
  if (!obj || typeof obj !== 'object') return undefined;
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};
const sanitizeFile = (f, keys) => (f && typeof f === 'object' ? pick(f, keys) : undefined);

// Whitelist only what the bot reads; raw updates can carry far more personal data than we need.
export function sanitizeUpdate(update) {
  if (!update || typeof update !== 'object') return {};
  const out = { update_id: update.update_id };
  const m = update.message;
  if (m && typeof m === 'object') {
    const msg = {
      message_id: m.message_id,
      chat: pick(m.chat, ['id', 'type']),
      from: pick(m.from, ['id', 'username', 'first_name']),
      text: typeof m.text === 'string' ? m.text.slice(0, 4096) : undefined,
      caption: typeof m.caption === 'string' ? m.caption.slice(0, 1024) : undefined,
      media_group_id: m.media_group_id,
      photo: Array.isArray(m.photo)
        ? m.photo.map((p) => sanitizeFile(p, ['file_id', 'file_unique_id', 'file_size', 'width', 'height']))
        : undefined,
      video: sanitizeFile(m.video, ['file_id', 'file_unique_id', 'file_size', 'mime_type', 'file_name', 'duration']),
      document: sanitizeFile(m.document, ['file_id', 'file_unique_id', 'file_size', 'mime_type', 'file_name', 'duration']),
      reply_to_message: m.reply_to_message ? { message_id: m.reply_to_message.message_id } : undefined,
    };
    out.message = clean(msg);
  }
  const q = update.callback_query;
  if (q && typeof q === 'object') {
    out.callback_query = clean({
      id: q.id,
      from: pick(q.from, ['id']),
      data: q.data,
      message: q.message ? { message_id: q.message.message_id, chat: pick(q.message.chat, ['id']) } : undefined,
    });
  }
  return out;
}

export async function recordUpdate(db, update, { now = Date.now() } = {}) {
  const updateId = update?.update_id;
  if (updateId === undefined || updateId === null) throw fail('bad-update', 'update_id missing');
  const id = String(updateId);
  const payload = sanitizeUpdate(update);
  const kind = payload.callback_query ? 'callback_query' : payload.message ? 'message' : 'other';
  const from = payload.callback_query?.from?.id ?? payload.message?.from?.id;
  const created = await createOnce(db, ref(db, COL.updates, id), {
    updateId, receivedAt: iso(now), status: 'received', attempts: 0, lease: null,
    kind, telegramUserId: from !== undefined ? String(from) : null, payload, error: null,
  });
  return { duplicate: !created, id };
}

export async function claimUpdate(db, id, { workerId, now = Date.now(), leaseMs = 60000 }) {
  const docRef = ref(db, COL.updates, id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return null;
    const d = snap.data();
    if (d.status === 'done' || d.status === 'dead') return null;
    if (d.status === 'processing' && ms(d.lease?.expiresAt) > now) return null;
    // Attempts count claims, so an update that crashes its worker still ends up dead.
    if ((d.attempts || 0) >= MAX_UPDATE_ATTEMPTS) {
      tx.set(docRef, { status: 'dead', lease: null, error: d.error || 'lease expired too many times' }, { merge: true });
      return null;
    }
    const next = { ...d, status: 'processing', attempts: (d.attempts || 0) + 1, lease: { workerId, expiresAt: iso(now + leaseMs) } };
    tx.set(docRef, next);
    return { id: snap.id, ...next };
  });
}

export async function completeUpdate(db, id, { now = Date.now() } = {}) {
  await ref(db, COL.updates, id).set({ status: 'done', lease: null, completedAt: iso(now), error: null }, { merge: true });
}

export async function failUpdate(db, id, { error, now = Date.now() } = {}) {
  const docRef = ref(db, COL.updates, id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return null;
    const attempts = snap.data().attempts || 0;
    const status = attempts >= MAX_UPDATE_ATTEMPTS ? 'dead' : 'received';
    tx.set(docRef, { status, lease: null, failedAt: iso(now), error: String(error?.message || error || 'failed').slice(0, 500) }, { merge: true });
    return { status, attempts };
  });
}

export async function listReclaimableUpdates(db, { now = Date.now(), limit = 20 } = {}) {
  const [received, processing] = await Promise.all([
    db.collection(COL.updates).where('status', '==', 'received').limit(200).get(),
    db.collection(COL.updates).where('status', '==', 'processing').limit(200).get(),
  ]);
  const rows = [
    ...received.docs.map((d) => ({ id: d.id, ...d.data() })),
    ...processing.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => ms(d.lease?.expiresAt) <= now),
  ];
  rows.sort((a, b) => ms(a.receivedAt) - ms(b.receivedAt));
  return rows.slice(0, limit);
}

// ── Tickets (button tokens) ────────────────────────────────────────────────

export async function issueTicket(db, { clientId, postId, revision, action, params, telegramUserId, bindingVersion, ttlMs = TICKET_DEFAULT_TTL_MS, now = Date.now() }) {
  const id = crypto.randomBytes(9).toString('base64url'); // 12 chars; `t:<id>` stays far under 64 bytes
  await createOnce(db, ref(db, COL.tickets, id), clean({
    clientId, postId, revision, action, params: params || {},
    telegramUserId: String(telegramUserId), bindingVersion,
    status: 'open', createdAt: iso(now), expiresAt: iso(now + ttlMs), claimedAt: null, result: null,
  }));
  return id;
}

export async function claimTicket(db, ticketId, { telegramUserId, now = Date.now() }) {
  const docRef = ref(db, COL.tickets, ticketId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return { state: 'unknown' };
    const t = snap.data();
    if (String(t.telegramUserId) !== String(telegramUserId)) return { state: 'forbidden' };
    if (t.status === 'done') return { state: 'replay', ticket: { id: snap.id, ...t }, result: t.result };
    // The ticket rides along so the bot can send a fresh card for the post the dead button belonged to.
    if (t.status === 'superseded') return { state: 'superseded', ticket: { id: snap.id, ...t } };
    if (ms(t.expiresAt) <= now) return { state: 'expired', ticket: { id: snap.id, ...t } };
    if (t.status === 'claimed' && now - ms(t.claimedAt) < TICKET_RECLAIM_MS) return { state: 'in-progress' };
    // Stale claim (worker died): re-run is safe because business calls are revision-checked.
    const next = { ...t, status: 'claimed', claimedAt: iso(now) };
    tx.set(docRef, next);
    return { state: 'claimed', ticket: { id: snap.id, ...next } };
  });
}

export async function settleTicket(db, ticketId, result, { now = Date.now() } = {}) {
  await ref(db, COL.tickets, ticketId).set({ status: 'done', result: clean(result ?? null), settledAt: iso(now) }, { merge: true });
}

export async function supersedeTicketsForPost(db, { clientId, postId, exceptTicketIds = [] }) {
  const snap = await db.collection(COL.tickets).where('postId', '==', postId).get();
  const targets = snap.docs.filter((d) => {
    const t = d.data();
    return t.clientId === clientId && ['open', 'claimed'].includes(t.status) && !exceptTicketIds.includes(d.id);
  });
  let count = 0;
  for (const d of targets) {
    // Re-check inside a transaction so we never clobber a ticket settled in the meantime.
    const changed = await db.runTransaction(async (tx) => {
      const cur = await tx.get(d.ref);
      if (!cur.exists || !['open', 'claimed'].includes(cur.data().status)) return false;
      tx.set(d.ref, { status: 'superseded' }, { merge: true });
      return true;
    });
    if (changed) count += 1;
  }
  return count;
}

// ── Outbox ─────────────────────────────────────────────────────────────────

export async function enqueueMessage(db, { clientId, chatId, dedupKey, kind, payload, revalidate = null, notBefore, now = Date.now() }) {
  const id = sha1(dedupKey);
  const at = notBefore === undefined || notBefore === null ? now : ms(notBefore);
  const created = await createOnce(db, ref(db, COL.outbox, id), clean({
    clientId, chatId: String(chatId), dedupKey, kind, payload,
    status: 'queued', attempts: 0, nextAttemptAt: iso(Math.max(at, 0)), lease: null,
    messageIds: [], error: null, revalidate, createdAt: iso(now),
  }));
  return { duplicate: !created, id };
}

export async function claimOutbox(db, { now = Date.now(), limit = 10, workerId, leaseMs = 60000 } = {}) {
  const [queued, processing] = await Promise.all([
    db.collection(COL.outbox).where('status', '==', 'queued').limit(200).get(),
    db.collection(COL.outbox).where('status', '==', 'processing').limit(200).get(),
  ]);
  const candidates = [
    ...queued.docs.filter((d) => ms(d.data().nextAttemptAt) <= now),
    ...processing.docs.filter((d) => ms(d.data().lease?.expiresAt) <= now),
  ].sort((a, b) => ms(a.data().nextAttemptAt) - ms(b.data().nextAttemptAt));

  const claimed = [];
  for (const c of candidates) {
    if (claimed.length >= limit) break;
    const got = await db.runTransaction(async (tx) => {
      const snap = await tx.get(c.ref);
      if (!snap.exists) return null;
      const d = snap.data();
      const ready = (d.status === 'queued' && ms(d.nextAttemptAt) <= now)
        || (d.status === 'processing' && ms(d.lease?.expiresAt) <= now);
      if (!ready) return null;
      const next = { ...d, status: 'processing', attempts: (d.attempts || 0) + 1, lease: { workerId, expiresAt: iso(now + leaseMs) } };
      tx.set(c.ref, next);
      return { id: snap.id, ...next };
    });
    if (got) claimed.push(got);
  }
  return claimed;
}

export async function completeOutbox(db, id, { messageIds = [], now = Date.now() } = {}) {
  await ref(db, COL.outbox, id).set({ status: 'sent', messageIds, sentAt: iso(now), lease: null, error: null }, { merge: true });
}

export async function retryOutbox(db, id, { retryAfterSec, error, now = Date.now() } = {}) {
  const docRef = ref(db, COL.outbox, id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return null;
    const attempts = snap.data().attempts || 1;
    const errText = String(error?.message || error || 'send failed').slice(0, 500);
    if (attempts >= MAX_OUTBOX_ATTEMPTS) {
      tx.set(docRef, { status: 'failed', lease: null, error: errText, failedAt: iso(now) }, { merge: true });
      return { status: 'failed', attempts };
    }
    const backoff = OUTBOX_BACKOFF_MS[Math.min(attempts, OUTBOX_BACKOFF_MS.length) - 1];
    const delay = Math.max(backoff, (Number(retryAfterSec) || 0) * 1000);
    const nextAttemptAt = iso(now + delay);
    tx.set(docRef, { status: 'queued', lease: null, error: errText, nextAttemptAt }, { merge: true });
    return { status: 'queued', attempts, nextAttemptAt };
  });
}

export async function failOutbox(db, id, { error, now = Date.now() } = {}) {
  await ref(db, COL.outbox, id).set({ status: 'failed', lease: null, error: String(error?.message || error || 'failed').slice(0, 500), failedAt: iso(now) }, { merge: true });
}

export async function supersedeOutbox(db, id, { reason, now = Date.now() } = {}) {
  await ref(db, COL.outbox, id).set({ status: 'superseded', lease: null, error: reason || null, supersededAt: iso(now) }, { merge: true });
}

// ── Notices (which card is live for a post) ────────────────────────────────

export async function getNotice(db, { clientId, postId }) {
  const snap = await ref(db, COL.notices, `${clientId}__${postId}`).get();
  return snap.exists ? snap.data() : null;
}

export async function recordNotice(db, { clientId, postId, ...fields }) {
  await ref(db, COL.notices, `${clientId}__${postId}`).set(clean({ postId, ...fields }), { merge: true });
}

// ── Settings / state / pending ─────────────────────────────────────────────

function defaultSettings(defaultTimezone) {
  return {
    timezone: defaultTimezone || 'America/Chicago',
    leadMinutes: 30,
    briefingEnabled: true,
    briefingHour: 8,
    quietHours: { enabled: true, start: 22, end: 7 },
    notificationsPaused: false,
    notifyFailures: true,
    notifySuccessSummary: false,
    slotAlerts: true,
  };
}

export async function getSettings(db, clientId, { defaultTimezone } = {}) {
  const snap = await ref(db, COL.settings, clientId).get();
  const base = defaultSettings(defaultTimezone);
  if (!snap.exists) return base;
  const s = snap.data();
  return { ...base, ...s, quietHours: { ...base.quietHours, ...(s.quietHours || {}) } };
}

const isHour = (n) => Number.isInteger(n) && n >= 0 && n <= 23;
function validTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export async function saveSettings(db, clientId, patch = {}, { now = Date.now() } = {}) {
  const next = {};
  if ('timezone' in patch) {
    if (!validTimezone(patch.timezone)) throw fail('invalid-settings', 'Unknown timezone');
    next.timezone = patch.timezone;
  }
  if ('leadMinutes' in patch) {
    const n = patch.leadMinutes;
    if (!Number.isInteger(n) || n < 0 || n > 240) throw fail('invalid-settings', 'leadMinutes must be 0-240');
    next.leadMinutes = n;
  }
  if ('briefingHour' in patch) {
    if (!isHour(patch.briefingHour)) throw fail('invalid-settings', 'briefingHour must be 0-23');
    next.briefingHour = patch.briefingHour;
  }
  for (const k of ['briefingEnabled', 'notificationsPaused', 'notifyFailures', 'notifySuccessSummary', 'slotAlerts']) {
    if (k in patch) {
      if (typeof patch[k] !== 'boolean') throw fail('invalid-settings', `${k} must be a boolean`);
      next[k] = patch[k];
    }
  }
  const q = patch.quietHours;
  if (q !== undefined) {
    if (!q || typeof q !== 'object') throw fail('invalid-settings', 'quietHours must be an object');
    if ('enabled' in q && typeof q.enabled !== 'boolean') throw fail('invalid-settings', 'quietHours.enabled must be a boolean');
    if ('start' in q && !isHour(q.start)) throw fail('invalid-settings', 'quietHours.start must be 0-23');
    if ('end' in q && !isHour(q.end)) throw fail('invalid-settings', 'quietHours.end must be 0-23');
    next.quietHours = pick(q, ['enabled', 'start', 'end']);
  }
  const docRef = ref(db, COL.settings, clientId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const base = defaultSettings();
    const cur = snap.exists ? snap.data() : {};
    const merged = {
      ...base, ...cur, ...next,
      quietHours: { ...base.quietHours, ...(cur.quietHours || {}), ...(next.quietHours || {}) },
      updatedAt: iso(now),
    };
    tx.set(docRef, merged);
    return merged;
  });
}

export async function getState(db, clientId) {
  const snap = await ref(db, COL.state, clientId).get();
  return snap.exists ? snap.data() : {};
}

export async function patchState(db, clientId, patch) {
  await ref(db, COL.state, clientId).set(clean(patch), { merge: true });
}

export async function setPending(db, telegramUserId, { kind, clientId, postId, revision, ticketId, ttlMs = 600000, now = Date.now() }) {
  const doc = clean({ kind, clientId, postId, revision, ticketId, createdAt: iso(now), expiresAt: iso(now + ttlMs) });
  await ref(db, COL.pending, telegramUserId).set(doc);
  return doc;
}

export async function getPending(db, telegramUserId, { now = Date.now() } = {}) {
  const snap = await ref(db, COL.pending, telegramUserId).get();
  if (!snap.exists) return null;
  const p = snap.data();
  return ms(p.expiresAt) <= now ? null : p;
}

export async function clearPending(db, telegramUserId) {
  await ref(db, COL.pending, telegramUserId).delete();
}
