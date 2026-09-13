// store.js — Firestore persistence for the X Monitor card.
//
// Layout (one root doc per monitored X account, keyed by the immutable X user id):
//
//   x_monitor/{accountId}                     profile + last-sync meta
//   x_monitor/{accountId}/snapshots/{YYYY-MM-DD}   daily counter snapshot (UTC)
//   x_monitor/{accountId}/posts/{tweetId}          post + capped metric history
//   x_monitor/{accountId}/roster/{chunk-000}       follower roster, chunked
//   x_monitor/{accountId}/audience_events/{auto}   gained / lost follower events
//
// Every query here is single-field ordered or a plain collection read — no
// composite indexes, deliberately (they have to be hand-created in the console
// and a missing one fails in production only).

import { createRequire } from 'node:module';
import { ROSTER_CHUNK_SIZE, chunkUsers, flattenRoster, snapshotDayKey } from './audience-diff.js';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');

const ROOT = 'x_monitor';
const BATCH_LIMIT = 450; // Firestore caps a batch at 500 writes; leave headroom.
const POST_HISTORY_MAX = 40;
const EVENT_WRITE_MAX = 2000; // A runaway diff must not write forever.

function accountRef(accountId) {
  return fb.adminDb.collection(ROOT).doc(String(accountId));
}

async function commitInBatches(operations) {
  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const batch = fb.adminDb.batch();
    for (const op of operations.slice(i, i + BATCH_LIMIT)) op(batch);
    await batch.commit();
  }
}

// ── Account + snapshots ──────────────────────────────────────────────────────

export async function readAccount(accountId) {
  const snap = await accountRef(accountId).get();
  return snap.exists ? snap.data() : null;
}

export async function saveProfile(accountId, profile) {
  const now = Date.now();
  await accountRef(accountId).set(
    { accountId: String(accountId), profile, profileUpdatedAt: now, updatedAt: now },
    { merge: true },
  );
  return profile;
}

export async function saveSyncMeta(accountId, patch = {}) {
  await accountRef(accountId).set({ sync: patch, updatedAt: Date.now() }, { merge: true });
}

/**
 * Upsert today's snapshot. Re-syncing the same day overwrites the counters
 * (latest wins) but keeps the day's first observation timestamp.
 */
export async function saveSnapshot(accountId, counters, at = Date.now()) {
  const date = snapshotDayKey(at);
  const ref = accountRef(accountId).collection('snapshots').doc(date);
  const existing = await ref.get();
  const payload = {
    date,
    followers: Number(counters.followers) || 0,
    following: Number(counters.following) || 0,
    posts: Number(counters.posts) || 0,
    listed: Number(counters.listed) || 0,
    likesGiven: Number(counters.likesGiven) || 0,
    source: counters.source || 'x-api',
    firstAt: existing.exists ? existing.data().firstAt || at : at,
    updatedAt: at,
  };
  await ref.set(payload, { merge: true });
  return payload;
}

export async function listSnapshots(accountId, limit = 365) {
  const snap = await accountRef(accountId)
    .collection('snapshots')
    .orderBy('date', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data()).reverse();
}

// ── Follower roster ──────────────────────────────────────────────────────────

export async function readRoster(accountId) {
  const snap = await accountRef(accountId).collection('roster').orderBy('index').get();
  const chunks = snap.docs.map((d) => d.data());
  return {
    byId: flattenRoster(chunks),
    complete: chunks.length ? chunks.every((c) => c.complete !== false) : false,
    chunkCount: chunks.length,
    capturedAt: chunks[0]?.capturedAt || null,
  };
}

/** Replace the stored roster wholesale, deleting any now-surplus chunks. */
export async function writeRoster(accountId, users, { complete = true, at = Date.now() } = {}) {
  const collection = accountRef(accountId).collection('roster');
  const chunks = chunkUsers(users, ROSTER_CHUNK_SIZE);
  const existing = await collection.get();

  const ops = [];
  for (const chunk of chunks) {
    const ref = collection.doc(`chunk-${String(chunk.index).padStart(3, '0')}`);
    ops.push((batch) => batch.set(ref, { ...chunk, complete, capturedAt: at }));
  }
  for (const doc of existing.docs) {
    const index = Number(doc.data()?.index);
    if (!Number.isFinite(index) || index >= chunks.length) ops.push((batch) => batch.delete(doc.ref));
  }
  await commitInBatches(ops);
  return { chunkCount: chunks.length, size: users.length, complete };
}

// ── Audience events ──────────────────────────────────────────────────────────

export async function writeAudienceEvents(accountId, events = []) {
  const collection = accountRef(accountId).collection('audience_events');
  const capped = events.slice(0, EVENT_WRITE_MAX);
  const ops = capped.map((event) => (batch) => batch.set(collection.doc(), event));
  await commitInBatches(ops);
  return { written: capped.length, dropped: events.length - capped.length };
}

export async function listAudienceEvents(accountId, limit = 300) {
  const snap = await accountRef(accountId)
    .collection('audience_events')
    .orderBy('detectedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── Posts ────────────────────────────────────────────────────────────────────

export async function listPosts(accountId, limit = 300) {
  const snap = await accountRef(accountId).collection('posts').limit(limit).get();
  return snap.docs.map((d) => d.data());
}

/**
 * Upsert posts, appending one capped history entry per post so growth in an
 * individual post's metrics is visible between syncs. Metric keys that came
 * back undefined (public-only sync) are not written, so an earlier impressions
 * reading is never overwritten with a null.
 */
export async function writePosts(accountId, posts = [], at = Date.now()) {
  if (!posts.length) return { written: 0 };
  const collection = accountRef(accountId).collection('posts');
  const existingDocs = await collection.get();
  const existing = new Map(existingDocs.docs.map((d) => [d.id, d.data()]));

  const ops = posts.map((post) => (batch) => {
    const prior = existing.get(post.id) || {};
    const metrics = { ...(prior.metrics || {}), ...stripUndefined(post.metrics) };
    const entry = { at, ...metrics };
    const history = [...(prior.history || []), entry].slice(-POST_HISTORY_MAX);
    batch.set(collection.doc(post.id), {
      id: post.id,
      text: post.text,
      url: post.url,
      createdAt: post.createdAt,
      kind: post.kind,
      metrics,
      metricsSource: post.metricsSource,
      history,
      updatedAt: at,
    });
  });
  await commitInBatches(ops);
  return { written: posts.length };
}

function stripUndefined(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}
