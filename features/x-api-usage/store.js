// store.js — persistence for the ledger. Same interface for Firestore and memory (tests).
//   increment(day, delta)        add a nested numeric delta into x_api_usage/{day}
//   readDays(dayKeys)            -> [{day, ...doc}] (missing days omitted)
//   getPricing() / setPricing(o) system_flags/x_api_pricing
//   getMeta() / setMeta(o)       x_api_usage_meta/current (last project usage check)
import { createRequire } from 'node:module';

export const USAGE_COLLECTION = 'x_api_usage';
export const META_COLLECTION = 'x_api_usage_meta';
export const PRICING_FLAG = ['system_flags', 'x_api_pricing'];

function deepAdd(into, delta) {
  for (const [k, v] of Object.entries(delta)) {
    if (v && typeof v === 'object') deepAdd((into[k] ||= {}), v);
    else into[k] = (Number(into[k]) || 0) + (Number(v) || 0);
  }
  return into;
}

export function createMemoryUsageStore() {
  const days = new Map();
  let pricing = null;
  let meta = null;
  return {
    async increment(day, delta) { deepAdd(days.get(day) || days.set(day, { day }).get(day), delta); },
    async readDays(keys) { return keys.filter((k) => days.has(k)).map((k) => JSON.parse(JSON.stringify(days.get(k)))); },
    async getPricing() { return pricing ? { ...pricing } : null; },
    async setPricing(o) { pricing = { ...o }; return pricing; },
    async getMeta() { return meta ? { ...meta } : null; },
    async setMeta(o) { meta = { ...(meta || {}), ...o }; return meta; },
  };
}

function toIncrements(delta, FieldValue) {
  const out = {};
  for (const [k, v] of Object.entries(delta)) out[k] = v && typeof v === 'object' ? toIncrements(v, FieldValue) : FieldValue.increment(v);
  return out;
}

/** Firestore store. db/FieldValue injected; default = the app's firebase-admin (lazy, so tests never touch it). */
export function createFirestoreUsageStore({ db, FieldValue } = {}) {
  const fb = () => {
    if (db && FieldValue) return { db, FieldValue };
    const m = createRequire(import.meta.url)('../../api/_lib/firebase-admin.cjs');
    return { db: db || m.adminDb, FieldValue: FieldValue || m.FieldValue };
  };
  return {
    async increment(day, delta) {
      const { db: d, FieldValue: FV } = fb();
      await d.collection(USAGE_COLLECTION).doc(day).set({ day, ...toIncrements(delta, FV), updatedAt: Date.now() }, { merge: true });
    },
    async readDays(keys) {
      const { db: d } = fb();
      const snaps = await Promise.all(keys.map((k) => d.collection(USAGE_COLLECTION).doc(k).get()));
      return snaps.filter((s) => s.exists).map((s) => ({ day: s.id, ...s.data() }));
    },
    async getPricing() {
      const { db: d } = fb();
      const s = await d.collection(PRICING_FLAG[0]).doc(PRICING_FLAG[1]).get();
      return s.exists ? s.data() : null;
    },
    async setPricing(o) {
      const { db: d } = fb();
      await d.collection(PRICING_FLAG[0]).doc(PRICING_FLAG[1]).set({ ...o, updatedAt: Date.now() });
      return o;
    },
    async getMeta() {
      const { db: d } = fb();
      const s = await d.collection(META_COLLECTION).doc('current').get();
      return s.exists ? s.data() : null;
    },
    async setMeta(o) {
      const { db: d } = fb();
      await d.collection(META_COLLECTION).doc('current').set(o, { merge: true });
      return o;
    },
  };
}
