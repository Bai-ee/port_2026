// today-plan.js - read-only "Today's plan" data for the daily email (and the MCP daily brief).
// ESM, no firebase import: the Firestore handle is injected (`db` = firebase-admin Firestore). No LLM, no writes.
// Every sub-read is non-fatal: a failure yields null/[] for that part, never a throw.
//
// Sources (existing stores only):
//   plan            x_strategy_plans/{clientId}            via createFirestorePlanStore(db).get
//   posts           social_posts where clientId == id      single-field equality query (no composite index);
//                                                           date/status filtering happens in memory
//   proposal cards  x_strategy_chats/{id}/threads          via createFirestoreChatStore(db).listThreads -> pendingProposals

import { createFirestorePlanStore } from '../x-strategy/plan-store.js';
import { createFirestoreChatStore } from '../x-strategy/agent/chat-store.js';
import { tracksOf, trackForPackage } from '../x-strategy/content-tracks.js';

const POSTS_COLLECTION = 'social_posts';
const EXCERPT_MAX = 120;
const NEXT_MAX = 5;
// Counts toward "scheduled today": a slot that is on the calendar or already went out.
const TODAY_COUNTED = new Set(['scheduled', 'queued', 'approved', 'posting', 'posted']);
// Eligible for the "next up" list: not yet published.
const UPCOMING = new Set(['scheduled', 'queued', 'approved', 'awaiting_approval']);

const clip = (t, n = EXCERPT_MAX) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const toMs = (v) => {
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  const ms = typeof v === 'number' ? v : Date.parse(v || '');
  return Number.isFinite(ms) ? ms : null;
};

function dayKey(ms, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Pure shaping step (unit-testable). `raw` = { planDoc, posts, pendingProposals, now, timeZone }.
 * planDoc: x_strategy_plans doc or null. posts: social_posts rows (any order) or null. pendingProposals: number|null.
 * @returns {{tracks:{label:string,targetPerDay:number|null,scheduledToday:number|null}[],
 *            next:{scheduledAt:string,type:string,excerpt:string,status:string}[],
 *            pendingProposals:number|null, generatedAt:string}}
 */
export function shapeTodayPlan(raw = {}) {
  const nowMs = toMs(raw.now) ?? Date.now();
  const timeZone = raw.timeZone || 'UTC';
  const today = dayKey(nowMs, timeZone);
  const posts = Array.isArray(raw.posts) ? raw.posts : null;
  const planDoc = raw.planDoc || null;
  const perDay = Number(planDoc?.plan?.authoredPerDay ?? planDoc?.authoredPerDay);

  const allTracks = planDoc ? tracksOf(planDoc) : [];
  const tracks = planDoc
    ? allTracks.map((t) => {
        const share = Number(t.share);
        const scheduledToday = posts
          ? posts.filter((p) => {
              const ms = toMs(p.scheduledAt);
              return ms != null && dayKey(ms, timeZone) === today && TODAY_COUNTED.has(p.status)
                && Boolean(p.engine || p.bucketId) && trackForPackage(allTracks, p)?.id === t.id;
            }).length
          : null;
        return {
          label: String(t.label || t.id || 'Track'),
          targetPerDay: Number.isFinite(perDay) && Number.isFinite(share) ? round1(perDay * share) : null,
          scheduledToday,
        };
      })
    : [];

  const next = (posts || [])
    .map((p) => ({ p, ms: toMs(p.scheduledAt) }))
    .filter(({ p, ms }) => ms != null && ms >= nowMs && UPCOMING.has(p.status))
    .sort((a, b) => a.ms - b.ms)
    .slice(0, NEXT_MAX)
    .map(({ p, ms }) => ({
      scheduledAt: new Date(ms).toISOString(),
      type: p.replyTo ? 'reply' : String(p.engine || p.source || 'post'),
      excerpt: clip(p.content),
      status: String(p.status || ''),
    }));

  return {
    tracks,
    next,
    pendingProposals: Number.isFinite(raw.pendingProposals) ? raw.pendingProposals : null,
    generatedAt: new Date(nowMs).toISOString(),
  };
}

async function safely(fn) {
  try { return await fn(); } catch { return null; }
}

/**
 * Read + shape today's plan for one client. Read-only, LLM-free, never throws.
 * @param {{db:object, clientId:string, now?:number|string|Date, timeZone?:string}} args
 *   db = firebase-admin Firestore (injected); now = ms epoch | ISO (default Date.now()); timeZone = IANA zone that
 *   defines "today" (default 'UTC').
 */
export async function readTodayPlan({ db, clientId, now = Date.now(), timeZone = 'UTC' } = {}) {
  if (!db || !clientId) return shapeTodayPlan({ now, timeZone });
  const nowMs = toMs(now instanceof Date ? now.getTime() : now) ?? Date.now();
  const [planDoc, posts, pendingProposals] = await Promise.all([
    safely(() => createFirestorePlanStore(db).get(clientId)),
    safely(async () => {
      const snap = await db.collection(POSTS_COLLECTION).where('clientId', '==', clientId).get();
      return snap.docs.map((d) => d.data());
    }),
    safely(async () => {
      const threads = await createFirestoreChatStore(db).listThreads(clientId, 50);
      return threads.reduce((n, t) => n + (t.pendingProposals || 0), 0);
    }),
  ]);
  return shapeTodayPlan({ planDoc, posts, pendingProposals, now: nowMs, timeZone });
}
