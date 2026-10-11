// chat-store.js - bounded chat persistence for the Strategy agent (T4b).
//   x_strategy_chats/{clientId}                  { turns: { 'YYYY-MM-DD': n }, updatedAt }   daily turn counter
//   x_strategy_chats/{clientId}/threads/{id}     { messages[<=60], summaryNote?, proposals{id->proposal}, createdAt, updatedAt }
// I/O is injected (`db` = firebase-admin Firestore). Writes ONLY under x_strategy_chats/{clientId}/**.
// No model call: when a thread passes MAX_MESSAGES the oldest messages are folded into a short,
// deterministic `summaryNote` (first chars of the user questions that were dropped).

import { STRATEGY_COLLECTIONS } from '../contracts.js';

export const MAX_MESSAGES = 60;
export const SUMMARY_NOTE_MAX = 600;
const SUMMARY_QUESTION_CHARS = 80;
export const DEFAULT_DAILY_TURN_CAP = 60;
const TURN_DAYS_KEPT = 14;
const MAX_PROPOSALS_PER_THREAD = 40;
export const THREAD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export class ChatCapError extends Error {
  constructor(used, cap) {
    super(`Daily strategy chat limit reached (${used}/${cap}). It resets tomorrow (UTC).`);
    this.name = 'ChatCapError';
    this.code = 'chat-cap';
    this.status = 429;
    this.used = used;
    this.cap = cap;
  }
}

export class ChatStoreError extends Error {
  /** @param {'invalid'|'not-found'} code */
  constructor(code, message) {
    super(message || code);
    this.name = 'ChatStoreError';
    this.code = code;
    this.status = code === 'not-found' ? 404 : 400;
  }
}

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const toIso = (now) => { const d = new Date(now ?? Date.now()); return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString(); };

/** UTC calendar day key. */
export const dayKey = (now) => toIso(now).slice(0, 10);

/** Cap from an explicit number or env X_STRATEGY_DAILY_TURN_CAP; falls back to 60 on anything not a positive integer. */
export function resolveTurnCap(cap, env = process.env) {
  const raw = cap ?? env?.X_STRATEGY_DAILY_TURN_CAP;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_TURN_CAP;
}

function checkIds(clientId, threadId) {
  if (typeof clientId !== 'string' || !clientId.trim() || clientId.includes('/')) throw new ChatStoreError('invalid', 'clientId is required');
  if (threadId !== undefined && !THREAD_ID_RE.test(String(threadId))) throw new ChatStoreError('invalid', 'threadId is invalid');
}

const oneLine = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function foldInto(summaryNote, dropped) {
  const qs = dropped.filter((m) => m.role === 'user').map((m) => `Q: ${oneLine(m.text, SUMMARY_QUESTION_CHARS)}`);
  if (!qs.length) return summaryNote;
  const joined = [summaryNote, ...qs].filter(Boolean).join(' | ');
  return joined.length <= SUMMARY_NOTE_MAX ? joined : joined.slice(joined.length - SUMMARY_NOTE_MAX); // keep the most recent
}

/** Pure: append a turn to a thread doc (or create it), enforce the bounds. */
export function applyTurn(thread, { threadId, userText, assistantText, proposals = [], usage, now }) {
  const at = toIso(now);
  const base = thread ? clone(thread) : { threadId, messages: [], proposals: {}, createdAt: at };
  const proposalIds = proposals.map((p) => p.id);
  const messages = [
    ...base.messages,
    { role: 'user', text: String(userText ?? ''), at },
    { role: 'assistant', text: String(assistantText ?? ''), at, ...(proposalIds.length ? { proposalIds } : {}), ...(usage ? { usage: clone(usage) } : {}) },
  ];
  let summaryNote = base.summaryNote;
  let kept = messages;
  if (messages.length > MAX_MESSAGES) {
    const cut = messages.length - MAX_MESSAGES;
    summaryNote = foldInto(summaryNote, messages.slice(0, cut));
    kept = messages.slice(cut);
  }
  const map = { ...base.proposals };
  for (const p of proposals) map[p.id] = clone(p);
  // Bound the proposal map: drop DECIDED proposals no kept message references, oldest first, past the cap.
  const refd = new Set(kept.flatMap((m) => m.proposalIds || []));
  const ids = Object.keys(map);
  if (ids.length > MAX_PROPOSALS_PER_THREAD) {
    const droppable = ids
      .filter((id) => map[id].status !== 'pending' && map[id].status !== 'deciding' && !refd.has(id))
      .sort((a, b) => String(map[a].createdAt).localeCompare(String(map[b].createdAt)));
    for (const id of droppable) { if (Object.keys(map).length <= MAX_PROPOSALS_PER_THREAD) break; delete map[id]; }
  }
  const out = { ...base, threadId, messages: kept, proposals: map, updatedAt: at };
  if (summaryNote) out.summaryNote = summaryNote;
  return out;
}

const summarize = (t) => ({
  threadId: t.threadId,
  title: oneLine(t.messages.find((m) => m.role === 'user')?.text ?? t.summaryNote ?? '', 60),
  messageCount: t.messages.length,
  pendingProposals: Object.values(t.proposals || {}).filter((p) => p.status === 'pending').length,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

function prunedTurns(turns, day) {
  const keep = Object.keys(turns || {}).sort().slice(-TURN_DAYS_KEPT);
  const out = {};
  for (const k of keep) out[k] = turns[k];
  out[day] = out[day] ?? 0;
  return out;
}

/**
 * Pure claim logic shared by both stores. A claim persists status 'deciding' and is NEVER auto-reclaimed
 * (no lease/TTL): an executor may legitimately run for minutes, and re-running one is worse than a stuck card.
 * Only releaseProposal (executor never ran) or saveProposal (final status) moves it out of 'deciding'.
 * The returned proposal (when claimed) is the pre-claim pending snapshot, so callers can decide on it.
 */
function claimOn(thread, proposalId, nowMs) {
  const p = thread?.proposals?.[proposalId];
  if (!p) return { claimed: false, proposal: null };
  if (p.status === 'deciding') return { claimed: false, proposal: p, inFlight: true };
  if (p.status !== 'pending') return { claimed: false, proposal: p };
  const snapshot = { ...p };
  p.status = 'deciding';
  p.decidingAt = new Date(nowMs).toISOString();
  return { claimed: true, proposal: snapshot };
}

function makeStore(runTransaction, { cap, env }) {
  const capNow = () => resolveTurnCap(cap, env);
  return {
    get cap() { return capNow(); },

    async usedToday(clientId, now) {
      checkIds(clientId);
      const { counter } = await runTransaction(clientId, null, (c) => ({ out: { counter: c.counter } }));
      return counter?.turns?.[dayKey(now)] ?? 0;
    },

    /** Throws ChatCapError (429 {used,cap}) when today's count has reached the cap. Read-only. */
    async assertTurnAvailable(clientId, now) {
      const used = await this.usedToday(clientId, now);
      const c = capNow();
      if (used >= c) throw new ChatCapError(used, c);
      return { used, cap: c };
    },

    /** Atomic check+increment, taken BEFORE the model runs so a failing turn still counts. Returns the new used count. */
    async reserveTurn(clientId, now) {
      checkIds(clientId);
      const day = dayKey(now);
      const { reserved } = await runTransaction(clientId, null, (c) => {
        const used = c.counter?.turns?.[day] ?? 0;
        const limit = capNow();
        if (used >= limit) throw new ChatCapError(used, limit);
        const turns = prunedTurns(c.counter?.turns, day);
        turns[day] = used + 1;
        return { out: { reserved: used + 1 }, counter: { turns, updatedAt: toIso(now) } };
      });
      return reserved;
    },

    async getThread(clientId, threadId) {
      checkIds(clientId, threadId);
      const { thread } = await runTransaction(clientId, threadId, (c) => ({ out: { thread: clone(c.thread) } }));
      return thread ?? null;
    },

    async listThreads(clientId, limit = 20) {
      checkIds(clientId);
      return (await runTransaction(clientId, null, null, { list: Math.min(Math.max(1, Number(limit) || 20), 50) })).list.map(summarize);
    },

    async appendTurn({ clientId, threadId, userText, assistantText, proposals, usage, now }) {
      checkIds(clientId, threadId);
      const { thread } = await runTransaction(clientId, threadId, (c) => {
        const next = applyTurn(c.thread, { threadId, userText, assistantText, proposals, usage, now });
        return { out: { thread: clone(next) }, thread: next };
      });
      return thread;
    },

    /** Atomically mark a PENDING proposal 'deciding' (persisted, never auto-reclaimed). {claimed:false} => already decided / in flight / unknown. */
    async claimProposal({ clientId, threadId, proposalId, now }) {
      checkIds(clientId, threadId);
      const nowMs = new Date(now ?? Date.now()).getTime();
      const { res } = await runTransaction(clientId, threadId, (c) => {
        if (!c.thread) return { out: { res: { claimed: false, proposal: null, threadMissing: true } } };
        const thread = clone(c.thread);
        const res = claimOn(thread, proposalId, nowMs);
        return { out: { res: clone(res) }, ...(res.claimed ? { thread } : {}) };
      });
      return res;
    },

    /** Put a claimed ('deciding') proposal back to 'pending'. Only for when the executor did NOT run. */
    async releaseProposal({ clientId, threadId, proposalId, now }) {
      checkIds(clientId, threadId);
      const { released } = await runTransaction(clientId, threadId, (c) => {
        const p = c.thread?.proposals?.[proposalId];
        if (!p || p.status !== 'deciding') return { out: { released: false } };
        const next = clone(c.thread);
        next.proposals[proposalId].status = 'pending';
        delete next.proposals[proposalId].decidingAt;
        next.updatedAt = toIso(now);
        return { out: { released: true }, thread: next };
      });
      return released;
    },

    /** Persist a decided proposal (replaces it in the thread; clears the claim marker). */
    async saveProposal({ clientId, threadId, proposal, now }) {
      checkIds(clientId, threadId);
      const { thread } = await runTransaction(clientId, threadId, (c) => {
        if (!c.thread) throw new ChatStoreError('not-found', 'thread not found');
        const next = clone(c.thread);
        const saved = { ...clone(proposal) };
        delete saved.decidingAt;
        next.proposals[proposal.id] = saved;
        next.updatedAt = toIso(now);
        return { out: { thread: clone(next) }, thread: next };
      });
      return thread.proposals[proposal.id];
    },
  };
}

/** @param {object} db firebase-admin Firestore (injected) */
export function createFirestoreChatStore(db, { cap, env = process.env } = {}) {
  const root = (clientId) => db.collection(STRATEGY_COLLECTIONS.chats).doc(clientId);
  const threads = (clientId) => root(clientId).collection('threads');
  const run = (clientId, threadId, fn, opts = {}) => db.runTransaction(async (tx) => {
    if (opts.list) {
      const snap = await tx.get(threads(clientId).orderBy('updatedAt', 'desc').limit(opts.list));
      return { list: snap.docs.map((d) => d.data()) };
    }
    const counterSnap = await tx.get(root(clientId));
    const counter = counterSnap.exists ? counterSnap.data() : null;
    const threadRef = threadId ? threads(clientId).doc(threadId) : null;
    const threadSnap = threadRef ? await tx.get(threadRef) : null;
    const thread = threadSnap?.exists ? threadSnap.data() : null;
    const r = fn({ counter, thread });
    if (r.counter) tx.set(root(clientId), r.counter);
    if (r.thread && threadRef) tx.set(threadRef, r.thread);
    return r.out;
  });
  return makeStore(run, { cap, env });
}

/** In-memory store for tests; same semantics (serialized per call). */
export function createMemoryChatStore({ cap, env = {} } = {}) {
  const counters = new Map();
  const threadDocs = new Map(); // `${clientId}/${threadId}` -> doc
  const run = async (clientId, threadId, fn, opts = {}) => {
    if (opts.list) {
      const rows = [...threadDocs.entries()].filter(([k]) => k.startsWith(`${clientId}/`)).map(([, v]) => clone(v));
      rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return { list: rows.slice(0, opts.list) };
    }
    const key = threadId ? `${clientId}/${threadId}` : null;
    const r = fn({ counter: clone(counters.get(clientId) ?? null), thread: key ? clone(threadDocs.get(key) ?? null) : null });
    if (r.counter) counters.set(clientId, clone(r.counter));
    if (r.thread && key) threadDocs.set(key, clone(r.thread));
    return r.out;
  };
  return makeStore(run, { cap, env });
}
