// calendar-reader.js - the ONE reader of the unified calendar (saved posts of every status + today's unsaved
// daily-run suggestions + open requotes/quote targets + "to film" tasks), shared by the dashboard Month route
// and the strategy agent / MCP `get_calendar` tool. SERVER ONLY (Firestore). Read-only; no thumbnails (the route
// adds those). Every Firestore-touching dependency is overridable through `deps` so it is testable.

import { readSocialQueue } from '../social-posting/twitter-service.js';
import { buildMonthCalendar, ctDate, addDays } from './month-calendar.js';
import { createContentTaskStore } from './content-tasks.js';
import * as bucketStore from './bucket-store.js';
import { bucketOfPost } from './bucket-colors.js';
import { createFirestoreRunStore } from './daily-run-store.js';
import { localDateOf, LOOP_VERSION } from './daily-loop.js';
import { createFirestorePlanStore } from '../x-strategy/plan-store.js';
import { resolveCalendarEngineConfig } from '../content-context/load-content-context.js';
import { createFirestoreStrategyDocStore } from '../x-strategy/strategy-doc-store.js';
import { baselineSlotsOf } from '../x-strategy/daily-slots.js';
import { hotPicksToTargets, quoteSlotTimes, quotesLeftToday, assignQuoteSlots } from '../x-quote-targets/hot-calendar.js';
import { tracksOf } from '../x-strategy/content-tracks.js';

export const PKG_COLLECTION = 'x_content_packages';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_RANGE_DAYS = 31;

/** One dashboard_state read: the RAW stored quoteTargets, the track-list signals and the hot-scan picks (the calendar reads only `hotQuotes`). */
export async function readQuoteState(db, clientId) {
  const snap = await db.collection('dashboard_state').doc(clientId).get();
  if (!snap.exists) return { rawQuoteTargets: null, listSignals: null, hotQuotes: null };
  const brief = snap.data()?.marketingBrief;
  return { rawQuoteTargets: brief?.quoteTargets ?? null, listSignals: brief?.listSignals ?? null, hotQuotes: brief?.hotQuotes ?? null };
}

/** Saved quote posts that count against today's allowance (CT day): a quote draft that went to the queue and was not rejected/failed/still a bare draft. */
const COUNTED_QUOTE_STATUSES = new Set(['approved', 'scheduled', 'queued', 'posting', 'posted', 'published', 'manual']);
export function quotePostsOnDay(posts, day) {
  return (Array.isArray(posts) ? posts : []).filter((p) => p && COUNTED_QUOTE_STATUSES.has(p.status)
    && (p.fillKind === 'quote' || p.sourceRef?.kind === 'quote-target')
    && (p.reviewOn === day || (typeof p.scheduledAt === 'string' && ctDate(Date.parse(p.scheduledAt)) === day))).length;
}

/** Latest daily run for today (same key the runner and the dashboard use). */
export function latestDailyRun(store, clientId) {
  return store.latest({ clientId, localDate: localDateOf(Date.now()), channel: 'x', version: LOOP_VERSION });
}

/** Bulk stored library docs by id (no seed overlay), via Firestore getAll in chunks. */
export async function readStoredPackages(db, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map((id) => db.collection(PKG_COLLECTION).doc(id));
    const snaps = refs.length ? await db.getAll(...refs) : [];
    for (const snap of snaps) if (snap.exists) out.set(snap.id, { id: snap.id, ...(snap.data() || {}) });
  }
  return out;
}

/** Today's (and any later) daily-run suggestions that are still unsaved: [{id,date,slot,type,text,runId,expiresAt}]. */
export async function readCalendarSuggestions(db, clientId, now, deps = {}) {
  const today = ctDate(now);
  const store = deps.runStore || createFirestoreRunStore(db);
  const run = await latestDailyRun(store, clientId);
  if (!run || !(run.localDate >= today)) return [];
  const runId = `${clientId}__${run.localDate}__${run.channel || 'x'}__v${run.version}`;
  return (Array.isArray(run.suggestions) ? run.suggestions : [])
    .filter((s) => s && typeof s.id === 'string' && !s.socialPostId && s.reviewState !== 'dismissed' && s.reviewState !== 'saved')
    .map((s) => ({ id: s.id, date: run.localDate, slot: s.slot || null, proposedSlot: s.proposedSlot || null, type: s.type || null, runId,
      text: String(s.edit?.text || s.draft?.text || ''), expiresAt: s.expiresAt || s.package?.expiresAt || null }));
}

/**
 * Open quote candidates on the calendar = the latest hot-scan picks ONLY (not passed, window open), best first:
 * [{id,url,handle,text,createdAt,windowHours,hot:{lane,momentum,fit,angle,why},...}]. The legacy watchlist quoteTargets feed is not read here.
 */
export async function readCalendarQuoteTargets(db, clientId, deps = {}) {
  const { hotQuotes } = await (deps.readQuoteState ? deps.readQuoteState(clientId) : readQuoteState(db, clientId));
  return hotPicksToTargets(hotQuotes, { now: deps.now ? deps.now() : Date.now() });
}

/** Months (YYYY-MM) touched by a closed date range. */
function monthsOf(from, to) {
  const out = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addDays(`${m}-28`, 4).slice(0, 7)) out.push(m);
  return out;
}

async function loadInputs(db, clientId, now, deps) {
  let overrides = null;
  try {
    const snap = await db.collection('content_system_config').doc('x').get();
    overrides = snap.exists ? snap.data() : null;
  } catch {
    // Config is advisory; defaults keep the calendar usable.
  }
  const planDoc = await (deps.readPlanDoc ? deps.readPlanDoc(clientId) : createFirestorePlanStore(db).get(clientId)).catch(() => null);
  const config = resolveCalendarEngineConfig({ planDoc, legacyOverrides: overrides });
  const posts = await (deps.readQueue || readSocialQueue)(clientId);
  const buckets = await (deps.listBuckets ? deps.listBuckets(clientId) : bucketStore.listBuckets(clientId, { db })).catch(() => null);
  const ids = [...new Set(posts.map((p) => p.packageId).filter(Boolean))];
  const pkgs = await (deps.readPackages ? deps.readPackages(ids) : readStoredPackages(db, ids)).catch(() => new Map());
  // Posts without their own bucketId take it from their library item (bucket colors).
  const withBuckets = posts.map((p) => (p.bucketId || !pkgs.has(p.packageId) ? p : { ...p, bucketId: bucketOfPost(p, pkgs.get(p.packageId)) }));
  // "To film" reminders (content_tasks): advisory read; a failure never blocks the calendar.
  const tasks = await (deps.listTasks ? deps.listTasks(clientId) : createContentTaskStore(db).list(clientId)).catch(() => []);
  // Unsaved daily-run suggestions + open quote targets ride the same grid (display only). Advisory reads.
  const [suggestions, quoteState] = await Promise.all([
    (deps.readSuggestions ? deps.readSuggestions(clientId, now) : readCalendarSuggestions(db, clientId, now)).catch(() => []),
    (deps.readQuoteState ? deps.readQuoteState(clientId) : readQuoteState(db, clientId)).catch(() => ({ hotQuotes: null })),
  ]);
  const hotQuotes = quoteState?.hotQuotes ?? null;
  const openTargets = deps.readQuoteTargets ? await deps.readQuoteTargets(clientId).catch(() => []) : hotPicksToTargets(hotQuotes, { now });
  // Daily baseline slots from the CONFIRMED strategy doc (awareness markers only; a draft or missing doc has none).
  const strategyDoc = await (deps.readStrategyDoc ? deps.readStrategyDoc(clientId) : createFirestoreStrategyDocStore(db).get(clientId)).catch(() => null);
  const baselineSlots = baselineSlotsOf(strategyDoc, { tracks: tracksOf(planDoc) });
  // Hot picks go to the next open baseline quote slot (07:00 / 11:00 CT) or show as extra; "quotes left today" rides along.
  const today = ctDate(now);
  const quotePostsToday = quotePostsOnDay(posts, today);
  const left = quotesLeftToday(hotQuotes, { quotePostsToday, now });
  const quoteTargets = assignQuoteSlots(openTargets, { slotTimes: quoteSlotTimes(baselineSlots), quotesPostedToday: quotePostsToday, left });
  const quoteBudget = { left, postedToday: quotePostsToday, scannedAt: hotQuotes?.scannedAt ?? null };
  return { config, posts: withBuckets, buckets, tasks, suggestions, quoteTargets, quoteBudget, pkgs, baselineSlots };
}

/**
 * The unified calendar. Two shapes:
 *  - { month }           -> { calendar, pkgs, baselineSlots }  (exactly what the dashboard Month handler builds, minus thumbnails)
 *  - { from, to }        -> { days, pkgs, baselineSlots }      (the grid days inside the closed range, deduped by date, max 31 days)
 * `baselineSlots` = daily-slots.js parseDailySlots shape ({slots, replies, notes}); the same for every day.
 * `now` (epoch ms) is injectable. `deps` overrides any reader (tests).
 */
export async function readUnifiedCalendar(db, clientId, { month, from, to, now = Date.now(), deps = {} } = {}) {
  const inputs = await loadInputs(db, clientId, now, deps);
  const build = (m) => buildMonthCalendar({ posts: inputs.posts, month: m, now, config: inputs.config, buckets: inputs.buckets, tasks: inputs.tasks, suggestions: inputs.suggestions, quoteTargets: inputs.quoteTargets });
  if (from || to) {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(from ?? '')) ? from : ctDate(now);
    let end = /^\d{4}-\d{2}-\d{2}$/.test(String(to ?? '')) ? to : addDays(start, 6);
    if (end < start) end = start;
    if (end > addDays(start, MAX_RANGE_DAYS - 1)) end = addDays(start, MAX_RANGE_DAYS - 1);
    const byDate = new Map();
    for (const m of monthsOf(start, end)) {
      for (const d of build(m).weeks.flat()) {
        // Prefer the copy from the month the day belongs to (its in-month grid copy is the authoritative one).
        if (d.date >= start && d.date <= end && (!byDate.has(d.date) || d.inMonth)) byDate.set(d.date, d);
      }
    }
    const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { days, from: start, to: end, pkgs: inputs.pkgs, baselineSlots: inputs.baselineSlots, quoteBudget: inputs.quoteBudget };
  }
  const valid = typeof month === 'string' && MONTH_RE.test(month.trim()) ? month.trim() : ctDate(now).slice(0, 7);
  return { calendar: build(valid), pkgs: inputs.pkgs, baselineSlots: inputs.baselineSlots, quoteBudget: inputs.quoteBudget };
}
