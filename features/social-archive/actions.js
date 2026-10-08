// Timeline read actions for the content engine card (CONTRACT.md "Server + UI").
// Pure routing + input validation; all I/O goes through the injected `store`
// (features/social-archive/timeline-store.js), so tests run on a fake.
import { PLATFORMS, isIsoDay } from './schema.js';

export const TIMELINE_ACTIONS = ['timeline-day', 'timeline-days', 'timeline-search', 'timeline-archives'];
export const SEARCH_LIMIT_DEFAULT = 100;
export const SEARCH_LIMIT_MAX = 300;
export const DAYS_LIMIT_MAX = 800;
const Q_MAX = 200;

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const str = (v) => (typeof v === 'string' ? v.trim() : '');

function optDay(v, name) {
  const s = str(v);
  if (!s) return undefined;
  if (!isIsoDay(s)) throw bad(`${name} must be YYYY-MM-DD.`);
  return s;
}

function optPlatform(v) {
  const s = str(v).toLowerCase();
  if (!s) return undefined;
  if (!PLATFORMS.includes(s)) throw bad(`platform must be one of ${PLATFORMS.join(', ')}.`);
  return s;
}

function range(body) {
  const from = optDay(body?.from, 'from');
  const to = optDay(body?.to, 'to');
  if (from && to && from > to) throw bad('from must not be after to.');
  return { from, to };
}

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** @param {{db: object, clientId: string, store: object}} deps */
export async function handleTimelineAction({ db, clientId, store }, action, body = {}) {
  if (!store) throw bad('Timeline store unavailable.', 500);
  switch (action) {
    case 'timeline-day': {
      const day = str(body?.day);
      if (!isIsoDay(day)) throw bad('day must be YYYY-MM-DD.');
      const res = await store.getDay(db, clientId, day);
      return { ok: true, ...res, day };
    }
    case 'timeline-days': {
      const { from, to } = range(body);
      const n = Number(body?.limit);
      const limit = Number.isInteger(n) && n > 0 ? Math.min(n, DAYS_LIMIT_MAX) : undefined;
      const days = await store.listDays(db, clientId, defined({ from, to, limit }));
      return { ok: true, days };
    }
    case 'timeline-search': {
      const q = str(body?.q).slice(0, Q_MAX);
      const n = Number(body?.limit);
      const limit = Number.isInteger(n) && n > 0 ? Math.min(n, SEARCH_LIMIT_MAX) : SEARCH_LIMIT_DEFAULT;
      const account = str(body?.account).slice(0, 80) || undefined;
      const entries = await store.searchEntries(db, clientId, defined({ q, platform: optPlatform(body?.platform), account, ...range(body), limit }));
      return { ok: true, entries };
    }
    case 'timeline-archives': {
      const archives = await store.listArchives(db, clientId);
      return { ok: true, archives };
    }
    default:
      throw bad(`Unknown timeline action: ${action}`);
  }
}
