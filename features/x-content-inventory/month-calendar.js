// Month calendar over social_posts — the Content Engine's Calendar tab.
//
// Pure: rows in, grid out. No Firestore, no clock (`now` is injected). The
// route reads the rows; the card renders this shape and re-derives nothing.
//
// Days are America/Chicago dates (the account's posting timezone), same as
// week-calendar.js, whose formatters this reuses so the two can never drift.
//
// PROPOSALS. A draft with no time still belongs on a day, so the reviewer sees
// the month as it would actually run. Undated drafts are placed into the next
// open slot from today forward (authored target/day, per-engine max/day, min
// spacing). A proposal is DISPLAY ONLY: nothing is written until the reviewer
// approves it, and approving is what turns the proposed time into a real
// schedule. Placement is deterministic (oldest draft first, earliest open
// slot), so every month view proposes the same slot for the same draft.
//
// REVIEW DAYS. A draft carrying `reviewOn` (calendar-batch.js) belongs on THAT
// date, even when it still needs its story: it is placed there first (earliest
// open time that day, else the end of the window), never moved to another day,
// and marked with `reviewOn`. A review day that has passed falls back to the
// normal undated handling above.

import { DEFAULT_ENGINE_CONFIG } from './engine-quota.js';
import { isEngine } from './engines.js';
import { bucketColorMap, bucketOfPost, NEUTRAL_BUCKET_COLOR } from './bucket-colors.js';
import { CALENDAR_TZ, COUNTED_STATUSES } from './week-calendar.js';

// Local copies of week-calendar.js's private helpers (not exported on this
// branch; same formatters/timezone so the two views cannot drift).
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const ctDate = (ms) => dateFmt.format(new Date(ms));
export const ctTime = (ms) => timeFmt.format(new Date(ms));
export function excerpt(text, max = 110) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Shown on the grid. `failed` is shown (it needs attention) but never counted. */
export const DISPLAY_STATUSES = [...new Set([...COUNTED_STATUSES, 'awaiting_approval', 'needs_review', 'failed'])];

/** status -> the one visual state the card renders. */
export const STATE_BY_STATUS = {
  draft: 'pending',
  awaiting_approval: 'awaiting',
  needs_review: 'held',
  approved: 'approved',
  scheduled: 'scheduled',
  queued: 'scheduled',
  posting: 'scheduled',
  manual: 'manual',
  posted: 'posted',
  failed: 'failed',
};

/** state -> the uniform `approval` mark every row carries (the card draws one indicator from it). */
export const APPROVAL_BY_STATE = {
  pending: 'unapproved',
  awaiting: 'unapproved',
  held: 'held',
  failed: 'held',
  approved: 'approved',
  scheduled: 'scheduled',
  manual: 'scheduled',
  posted: 'posted',
  suggested: 'suggested',
};

/** Quote window for a requote suggestion (same measured 36h as rank.js / daily-fill). */
export const REQUOTE_WINDOW_HOURS = 36;
const STATUS_URL_RE = /^https:\/\/(?:x|twitter)\.com\/\w+\/status\/(\d+)/i;
const statusIdOf = (url) => STATUS_URL_RE.exec(String(url ?? ''))?.[1] ?? null;

/** Local copy of twitter-service AMBIGUOUS_CLASSES (that module is server-only). */
const AMBIGUOUS_CLASSES = new Set(['server-error-ambiguous', 'network-ambiguous', 'unknown']);

const HELD_BY_CLASS = {
  'reply-threading-unsupported': ['Replies cannot be scheduled yet.', 'Post it manually on X or reject it.'],
  'approval-stale': ['Edited after approval.', 'Approve again.'],
  'clearance-revoked': ['The content is no longer cleared.', 'Reject it, or re-clear the source and approve again.'],
  'clearance-unverifiable': ['Clearance could not be verified at delivery time.', 'Check the source, then reject it or approve again.'],
  'opportunity-expired': ['The timing window closed.', 'Reject it, or replace it with a fresh recommendation.'],
  'package-already-pending': ['Another post from this package is already pending.', 'Wait for it to finish, or reject this one.'],
  'plan-spacing': ['It would break the plan spacing rule.', 'Pick another time, or approve with an owner override.'],
  'plan-day-cap': ['It would exceed the plan limit for that day.', 'Pick another day, or approve with an owner override.'],
  'plan-engine-cap': ['It would exceed the plan limit for that engine.', 'Pick another day, or approve with an owner override.'],
  'revision-conflict': ['It changed while another action was running.', 'Reload to see the latest version.'],
  'needs-review-reconcile': ['The publish outcome is unknown.', 'Check X, then mark it Posted or Not posted.'],
};

/**
 * Plain-words explanation for a held (needs_review) row.
 * @returns {{ reason: string, next: string, ambiguous: boolean }}
 */
export function reasonText(errorClass) {
  const key = errorClass == null ? '' : String(errorClass);
  if (AMBIGUOUS_CLASSES.has(key)) {
    return { reason: 'The publish outcome is unknown.', next: 'May already be live on X: check, then mark Posted or Not posted.', ambiguous: true };
  }
  if (key === 'needs-review-reconcile') {
    return { reason: HELD_BY_CLASS[key][0], next: HELD_BY_CLASS[key][1], ambiguous: true };
  }
  const hit = HELD_BY_CLASS[key];
  if (hit) return { reason: hit[0], next: hit[1], ambiguous: false };
  return { reason: 'Held for review.', next: 'Review it, then reject it or reconcile it.', ambiguous: false };
}

/** Handler result -> 'ok' | 'conflict' | 'plan' | 'error'. false = server conflict; {ok:false, errorClass} = typed rejection. */
export function classifyResult(res) {
  if (res === false) return { kind: 'conflict' };
  if (res && typeof res === 'object' && res.ok === false) {
    const code = String(res.errorClass || res.code || '');
    if (code === 'revision-conflict') return { kind: 'conflict' };
    if (code.startsWith('plan-')) return { kind: 'plan', code, message: res.error || res.message || null };
    return { kind: 'error', code, message: res.error || res.message || null };
  }
  return { kind: 'ok' };
}

/** Badge text for a media task row. */
export const TASK_BADGE = { film: 'To film', 'find-media': 'Find media' };

/** Proposal window in CT wall time, and the minimum lead before a proposed slot. */
export const PROPOSAL_WINDOW = { startMin: 7 * 60, endMin: 21 * 60, stepMin: 30, leadMin: 30 };

const DAY_MS = 86_400_000;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const REVIEWABLE = new Set(['draft', 'approved', 'awaiting_approval']);

/** YYYY-MM-DD plus n days. Noon-UTC stepping keeps DST safe. */
export function addDays(date, n) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Epoch ms of a CT wall-clock time on a CT date (DST-correct, no library). */
export function ctWallToMs(date, minutes) {
  const [y, m, d] = date.split('-').map(Number);
  const want = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let guess = want;
  for (let i = 0; i < 2; i += 1) {
    const [gd, gt] = [ctDate(guess), ctTime(guess)];
    const [gy, gm, gday] = gd.split('-').map(Number);
    const [gh, gmin] = gt.split(':').map(Number);
    guess -= Date.UTC(gy, gm - 1, gday, gh, gmin) - want;
  }
  return guess;
}

/** The dates of the month grid: whole weeks covering `month` (YYYY-MM). */
export function monthGridDates(month, { weekStartsOn = 0 } = {}) {
  const match = MONTH_RE.exec(String(month ?? ''));
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error('month must be YYYY-MM');
  const first = `${month}-01`;
  const dow = new Date(`${first}T12:00:00Z`).getUTCDay();
  const start = addDays(first, -((dow - weekStartsOn + 7) % 7));
  const nextMonth = addDays(`${month}-28`, 4).slice(0, 7);
  const last = addDays(`${nextMonth}-01`, -1);
  const lastDow = new Date(`${last}T12:00:00Z`).getUTCDay();
  const end = addDays(last, (weekStartsOn + 6 - lastDow + 7) % 7);
  const dates = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  return dates;
}

function slotMs(post) {
  const iso = post?.scheduledAt || post?.postedAt || null;
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function toRow(p, colors = null) {
  const bucketId = bucketOfPost(p);
  const held = p.status === 'needs_review' ? reasonText(p.errorClass) : null;
  const state = STATE_BY_STATUS[p.status] || 'pending';
  return {
    kind: 'post',
    approval: APPROVAL_BY_STATE[state] || 'unapproved',
    id: p.id ?? null,
    status: p.status,
    state,
    engine: isEngine(p.engine) ? p.engine : null,
    packageId: p.packageId ?? null,
    title: excerpt(p.title || p.content, 80),
    content: typeof p.content === 'string' ? p.content : '',
    scheduledAt: p.scheduledAt ?? null,
    postedAt: p.postedAt ?? null,
    reviewedAt: p.reviewedAt ?? null,
    needsStory: p.needsStory === true,
    mediaUrl: p.mediaUrl ?? null,
    mediaType: p.mediaType ?? null,
    posterUrl: p.posterUrl ?? null,
    twitterId: p.twitterId ?? null,
    deliveryMode: p.deliveryMode ?? null,
    selfReported: p.status === 'posted' && p.deliveryMode === 'manual' && !p.twitterId,
    permalink: p.permalink ?? null,
    error: p.status === 'failed' || p.status === 'needs_review' ? (p.error ?? null) : null,
    errorClass: p.status === 'failed' || p.status === 'needs_review' ? (p.errorClass ?? null) : null,
    heldReason: held ? held.reason : null,
    heldNext: held ? held.next : null,
    heldAmbiguous: held ? held.ambiguous : false,
    revision: Number.isFinite(p.revision) ? p.revision : (p.revision ?? null),
    expiresAt: p.expiresAt ?? null,
    fillKind: typeof p.fillKind === 'string' ? p.fillKind : null,
    source: typeof p.source === 'string' ? p.source : null,
    fillSource: p.fillSource && typeof p.fillSource === 'object' ? { type: p.fillSource.type ?? null, id: p.fillSource.id ?? null, asOf: p.fillSource.asOf ?? null } : null,
    reviewOn: DAY_RE.test(String(p.reviewOn ?? '')) ? p.reviewOn : null,
    // Approval locks these in (lifecycle contentHash), so the editor must see the full objects, not booleans.
    // Always present (null when absent) so "unknown" and "none" stay distinguishable. Read-only.
    selfReply: isPlainObject(p.selfReply) ? p.selfReply : null,
    mediaVariants: isPlainObject(p.mediaVariants) ? p.mediaVariants : null,
    replyTo: isPlainObject(p.replyTo) ? p.replyTo : null,
    // Networks (features/social-posting/cross-post.js; absent = X only) and the Instagram leg's outcome. Always present,
    // so the editor's Post-to checkboxes never fall back to a stale answer after a row refresh.
    targets: { x: p.targets?.x !== false, instagram: p.targets?.instagram === true },
    instagramDelivery: isPlainObject(p.instagramDelivery) ? p.instagramDelivery : null,
    bucketId: colors && colors[bucketId] ? bucketId : null,
    bucketColor: colors ? (colors[bucketId] || NEUTRAL_BUCKET_COLOR) : null,
    proposed: false,
  };
}

/**
 * @param {object} input
 * @param {object[]} input.posts   social_posts rows (any window; filtered here)
 * @param {string} input.month     YYYY-MM (CT)
 * @param {number} input.now       epoch ms (injected so the builder stays pure)
 * @param {object} [input.config]  engine config (defaults to DEFAULT_ENGINE_CONFIG)
 * @param {number} [input.weekStartsOn] 0 = Sunday (default), 1 = Monday
 * @param {object[]} [input.buckets] Content Center buckets (listBuckets rows); given => rows carry bucketId/bucketColor and a legend is returned
 * @param {object[]} [input.suggestions] unsaved daily-run suggestions ({id,date,slot?,type,text,runId,expiresAt?}); each lands on its date as a `suggestion` row
 * @param {object[]} [input.quoteTargets] open quote candidates ({id,url,handle,text,createdAt}); each lands on every day its 36h window covers (from today) as a `requote` row
 * @param {object[]} [input.tasks] content_tasks rows ({id,kind,title,dueOn,status,postId,packageId}); each lands on its dueOn day as a task row ("To film")
 */
export function buildMonthCalendar({ posts = [], month, now, config = DEFAULT_ENGINE_CONFIG, weekStartsOn = 0, buckets = null, tasks = [], suggestions = [], quoteTargets = [] } = {}) {
  const colors = Array.isArray(buckets) ? bucketColorMap(buckets) : null;
  if (!Number.isFinite(now)) throw new Error('now (epoch ms) is required');
  const dates = monthGridDates(month, { weekStartsOn });
  const gridStart = dates[0];
  const gridEnd = dates[dates.length - 1];
  const today = ctDate(now);
  const cfg = config?.authored && config?.engines ? config : DEFAULT_ENGINE_CONFIG;
  const target = cfg.authored.targetPerDay ?? cfg.authored.capPerDay;
  const spacingMs = (cfg.authored.minSpacingMin ?? 0) * 60_000;

  // Every dated row by CT date, across ALL dates — proposals for a future
  // month must see the days between today and that month too.
  const byDate = new Map();
  const reviewDated = [];
  const undated = [];
  const manualUndated = [];
  for (const p of Array.isArray(posts) ? posts : []) {
    if (!p || !DISPLAY_STATUSES.includes(p.status)) continue;
    if (p.replyTo) continue; // replies sit outside the authored cap
    const ms = slotMs(p);
    const row = toRow(p, colors);
    if (ms == null && row.reviewOn && row.reviewOn >= today && REVIEWABLE.has(p.status)) {
      reviewDated.push(row);
      continue;
    }
    if (ms == null) {
      // A manual takeover with no live slot: the owner is posting it, so it is never re-proposed into a slot.
      if (p.status === 'manual') { manualUndated.push({ ...row, reason: 'manual' }); continue; }
      if (p.status === 'draft' || p.status === 'needs_review' || p.status === 'approved' || p.status === 'awaiting_approval') {
        undated.push({ row, createdAt: Date.parse(p.createdAt) || 0 });
      }
      continue;
    }
    const date = ctDate(ms);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({ ...row, ms, time: ctTime(ms) });
  }

  // ── Review days (placed before proposals, so proposals see them) ─────────
  reviewDated.sort((a, b) => a.reviewOn.localeCompare(b.reviewOn) || String(a.id).localeCompare(String(b.id)));
  for (const row of reviewDated) {
    const date = row.reviewOn;
    if (!byDate.has(date)) byDate.set(date, []);
    const slots = byDate.get(date).filter((r) => r.state !== 'failed');
    let ms = null;
    for (let m = PROPOSAL_WINDOW.startMin; m <= PROPOSAL_WINDOW.endMin && ms == null; m += PROPOSAL_WINDOW.stepMin) {
      const at = ctWallToMs(date, m);
      if (at < now + PROPOSAL_WINDOW.leadMin * 60_000) continue;
      if (slots.some((s) => Math.abs(s.ms - at) < spacingMs)) continue;
      ms = at;
    }
    if (ms == null) ms = ctWallToMs(date, PROPOSAL_WINDOW.endMin); // a full (or past-window) day: still shown on its day
    byDate.get(date).push({ ...row, ms, time: ctTime(ms), proposed: true, proposedAt: new Date(ms).toISOString() });
  }

  // ── Proposals ────────────────────────────────────────────────────────────
  const occupying = (date) => (byDate.get(date) || []).filter((r) => r.state !== 'failed');
  const unplaced = [...manualUndated];
  const queue = undated
    .sort((a, b) => a.createdAt - b.createdAt || String(a.row.id).localeCompare(String(b.row.id)))
    .map((u) => u.row);

  for (const row of queue) {
    if (row.needsStory) { unplaced.push({ ...row, reason: 'needs-story' }); continue; }
    if (row.status === 'needs_review') { unplaced.push({ ...row, reason: 'held' }); continue; }
    const expiresMs = row.expiresAt ? Date.parse(row.expiresAt) : NaN;
    let placed = false;
    let closed = false;
    for (let date = today; date <= gridEnd && !placed; date = addDays(date, 1)) {
      const slots = occupying(date);
      if (slots.length >= target) continue;
      const engineMax = row.engine ? cfg.engines[row.engine]?.maxPerDay : null;
      if (engineMax != null && slots.filter((s) => s.engine === row.engine).length >= engineMax) continue;
      for (let m = PROPOSAL_WINDOW.startMin; m <= PROPOSAL_WINDOW.endMin; m += PROPOSAL_WINDOW.stepMin) {
        const ms = ctWallToMs(date, m);
        if (ms < now + PROPOSAL_WINDOW.leadMin * 60_000) continue;
        if (Number.isFinite(expiresMs) && ms > expiresMs) { closed = true; break; }
        if (slots.some((s) => Math.abs(s.ms - ms) < spacingMs)) continue;
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date).push({ ...row, ms, time: ctTime(ms), proposed: true, proposedAt: new Date(ms).toISOString() });
        placed = true;
        break;
      }
      if (closed) break; // every later slot is later still
    }
    // A past month has no open days to propose into; say so rather than "full".
    if (!placed) unplaced.push({ ...row, reason: closed ? 'window-closed' : gridEnd < today ? 'out-of-range' : 'no-slot' });
  }

  // ── Suggestions + requotes (display only; never placed, never counted as posts) ──
  const extraByDate = new Map();
  const addExtra = (date, row) => {
    if (date < gridStart || date > gridEnd) return;
    if (!extraByDate.has(date)) extraByDate.set(date, []);
    extraByDate.get(date).push(row);
  };
  // Anything already saved shows only as its post: dedupe by quoted status id (sourceRef / fillSource / URL in the text).
  const savedQuoteIds = new Set();
  const savedSuggestionIds = new Set();
  for (const p of Array.isArray(posts) ? posts : []) {
    if (!p || p.status === 'rejected') continue;
    const ref = p.sourceRef && typeof p.sourceRef === 'object' ? p.sourceRef : null;
    if (ref?.kind === 'quote-target') { if (ref.id != null) savedQuoteIds.add(String(ref.id)); const u = statusIdOf(ref.url); if (u) savedQuoteIds.add(u); }
    if (p.fillSource?.type === 'quote-target' && p.fillSource.id != null) savedQuoteIds.add(String(p.fillSource.id));
    for (const m of String(p.content ?? '').matchAll(/https:\/\/(?:x|twitter)\.com\/\w+\/status\/(\d+)/gi)) savedQuoteIds.add(m[1]);
    if (ref?.suggestionId) savedSuggestionIds.add(String(ref.suggestionId));
    if (p.suggestionId) savedSuggestionIds.add(String(p.suggestionId));
  }
  const slotMinutes = (sg) => {
    const m = /(\d{1,2}):(\d{2})\s*([ap]m)?/i.exec(String(sg?.slot?.timeCT ?? sg?.slot ?? sg?.proposedSlot?.localTime ?? ''));
    if (!m) return null;
    let h = Number(m[1]);
    if (m[3]) h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
    return h * 60 + Number(m[2]);
  };
  for (const sg of Array.isArray(suggestions) ? suggestions : []) {
    if (!sg || sg.id == null || !DAY_RE.test(String(sg.date ?? ''))) continue;
    const text = String(sg.text ?? '').trim();
    if (!text || savedSuggestionIds.has(String(sg.id))) continue;
    const mins = slotMinutes(sg);
    const ms = ctWallToMs(sg.date, mins ?? 12 * 60);
    addExtra(sg.date, {
      kind: 'suggestion', state: 'suggested', approval: 'suggested', id: `suggestion:${sg.id}`, suggestionId: String(sg.id), runId: sg.runId ?? null,
      date: sg.date, ms, time: ctTime(ms), suggestionType: sg.type ?? null, slot: sg.slot && typeof sg.slot === 'object' ? { letter: sg.slot.letter ?? null, timeCT: sg.slot.timeCT ?? null } : null,
      title: excerpt(text, 80), content: text, text, expiresAt: sg.expiresAt ?? null, windowOpen: sg.expiresAt ? Date.parse(sg.expiresAt) > now : true,
      status: 'suggested', needsStory: false, bucketId: null, bucketColor: null, proposed: false, quotedUrl: null,
    });
  }
  for (const t of Array.isArray(quoteTargets) ? quoteTargets : []) {
    const url = String(t?.url ?? '');
    const sid = statusIdOf(url);
    const id = String(t?.id ?? sid ?? '');
    const created = Date.parse(t?.createdAt ?? '');
    if (!sid || !id || !Number.isFinite(created)) continue;
    if (savedQuoteIds.has(id) || savedQuoteIds.has(sid)) continue;
    const expiresMs = created + (Number(t?.windowHours) > 0 ? Number(t.windowHours) : REQUOTE_WINDOW_HOURS) * 3_600_000;
    if (expiresMs <= now) continue; // window closed
    const handle = String(t?.handle ?? t?.author?.username ?? (typeof t?.author === 'string' ? t.author : '') ?? '').replace(/^@/, '') || null;
    const first = ctDate(Math.max(now, created));
    const last = ctDate(expiresMs);
    for (let date = first < today ? today : first; date <= last; date = addDays(date, 1)) {
      const ms = date === today ? now : ctWallToMs(date, 0);
      addExtra(date, {
        kind: 'requote', state: 'suggested', approval: 'suggested', id: `requote:${id}`, quoteTargetId: id, date, ms, time: date === today ? (t?.slotTime ?? '') : '', slotKind: t?.slotKind ?? null, quotesLeftToday: t?.quotesLeftToday ?? null, hot: t?.hot ?? null,
        handle, quotedUrl: url, title: excerpt(t?.text, 80), content: String(t?.text ?? ''), text: String(t?.text ?? ''), quotedHandle: handle, quotedText: String(t?.text ?? ''), quotedAuthorName: t?.authorName ?? null, quotedHasMedia: t?.hasMedia === true, quotedMediaUrl: t?.mediaUrl ?? null, createdAt: new Date(created).toISOString(),
        expiresAt: new Date(expiresMs).toISOString(), windowOpen: true, trackId: t?.trackId ?? null,
        status: 'suggested', needsStory: false, bucketId: null, bucketColor: null, proposed: false,
      });
    }
  }

  // ── Grid ─────────────────────────────────────────────────────────────────
  const emptyCounts = () => ({ pending: 0, awaiting: 0, held: 0, approved: 0, scheduled: 0, manual: 0, posted: 0, failed: 0, suggested: 0, requote: 0 });
  const totals = { ...emptyCounts(), suggested: 0, requote: 0, proposed: 0, review: 0, needsMemory: 0, tasksOpen: 0 };
  const tasksByDay = new Map();
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!t || !DAY_RE.test(String(t.dueOn ?? ''))) continue;
    if (!tasksByDay.has(t.dueOn)) tasksByDay.set(t.dueOn, []);
    tasksByDay.get(t.dueOn).push({ id: t.id, kind: t.kind === 'find-media' ? 'find-media' : 'film', badge: TASK_BADGE[t.kind] || TASK_BADGE.film, title: excerpt(t.title, 80), status: t.status === 'done' ? 'done' : 'open', dueOn: t.dueOn, postId: t.postId ?? null, packageId: t.packageId ?? null });
  }
  const reviewQueue = [];

  const days = dates.map((date) => {
    const inMonth = date.slice(0, 7) === month;
    const rows = [...(byDate.get(date) || []), ...(extraByDate.get(date) || [])].sort((a, b) => a.ms - b.ms);
    const counts = emptyCounts();
    for (const r of rows) {
      const bucket = r.kind === 'requote' ? 'requote' : r.state; // requote rows share state 'suggested' but count apart
      counts[bucket] += 1;
      if (inMonth) {
        totals[bucket] += 1;
        if (r.proposed) totals.proposed += 1;
        if (r.reviewOn) totals.review += 1;
        if (r.reviewOn && r.needsStory) totals.needsMemory += 1;
        if (r.state === 'pending' || r.state === 'awaiting' || r.state === 'held') reviewQueue.push(r.id);
      }
    }
    const dayTasks = (tasksByDay.get(date) || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (inMonth) totals.tasksOpen += dayTasks.filter((t) => t.status === 'open').length;
    const live = rows.filter((r) => r.kind === 'post' && r.state !== 'failed' && !r.proposed);
    const flags = [];
    for (let i = 1; i < live.length; i += 1) {
      const gapMin = Math.round((live[i].ms - live[i - 1].ms) / 60000);
      if (gapMin < cfg.authored.minSpacingMin) {
        flags.push({ kind: 'spacing', date, message: `${live[i - 1].time} and ${live[i].time} are ${gapMin} min apart (min ${cfg.authored.minSpacingMin})` });
      }
    }
    if (live.length > cfg.authored.capPerDay) {
      flags.push({ kind: 'over-cap', date, message: `${live.length} authored posts (cap ${cfg.authored.capPerDay})` });
    }
    return {
      date,
      inMonth,
      isToday: date === today,
      isPast: date < today,
      counts,
      flags,
      posts: rows.map(({ ms, ...r }) => r),
      tasks: dayTasks,
    };
  });

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  // Legend: every active bucket (plus any inactive one that still has posts this month), in bucket order.
  const inMonthRows = days.filter((d) => d.inMonth).flatMap((d) => d.posts).filter((r) => r.kind === 'post');
  const legend = colors ? [...buckets].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .map((b) => ({ id: b.id, name: b.name || b.id, color: colors[b.id], count: inMonthRows.filter((r) => r.bucketId === b.id).length, active: b.active !== false }))
    .filter((b) => b.color && (b.active || b.count > 0)) : [];
  const unbucketed = colors ? inMonthRows.filter((r) => !r.bucketId).length : 0;
  if (unbucketed) legend.push({ id: 'none', name: 'No bucket', color: NEUTRAL_BUCKET_COLOR, count: unbucketed, active: true });

  return {
    month,
    start: gridStart,
    end: gridEnd,
    today,
    tz: CALENDAR_TZ,
    weekStartsOn,
    config: { authored: cfg.authored },
    weeks,
    totals,
    reviewQueue,
    unplaced,
    legend,
  };
}
