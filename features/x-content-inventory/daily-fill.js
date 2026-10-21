// daily-fill.js — fill the calendar day by day with REVIEW DRAFTS (docs/source-of-truth/CONTENT-TRACKS.md § Daily fill).
// Four kinds, all `social_posts` drafts (status 'draft', scheduledAt null, `reviewOn` = the day). Nothing here can
// approve, schedule or publish:
//   baseline    each content track's posts/day target, picked from that track's library items
//   quote       one same-day draft per open quote target (TODAY only; expires 36h after the target was posted)
//   narrative   up to one a day (today, tomorrow) from the Market Signals topics
//   client-work the client-work tracks' baseline slots (kind 'client-work'; never added on top of the baseline count)
// Quote and narrative drafts carry the "[add your take]" placeholder and needsStory, so they cannot be approved unfilled.
// Library drafts follow calendar-batch.js (facts + "[add your memory]" unless the owner already wrote a story).
//
// planDailyFill is pure (no I/O, no clock); runDailyFill takes its readers and the draft writer as dependencies.

import { trackForPackage, bucketOfPackage } from '../x-strategy/content-tracks.js';
import { resolveEngine } from './engines.js';
import { mergeEngineConfig } from './engine-quota.js';
import { addDays, draftTextFor, eventMonthDay } from './calendar-batch.js';
import { TAKE_PLACEHOLDER } from '../social-posting/self-reply.js';
import { mediaOf } from './item-media.js';

export const FILL_KINDS = Object.freeze(['baseline', 'quotes', 'narratives', 'client-work']);
export const MAX_FILL_DAYS = 31;
export const DEFAULT_FILL_DAYS = 7;
export const QUOTE_WINDOW_HOURS = 36; // same as x-quote-targets/rank.js DEFAULT_WINDOW_HOURS (measured, not the 6h reply window)
export const REPEAT_GAP_DAYS = 30;
const MAX_PER_TRACK_PER_DAY = 3;
const MAX_QUOTES = 10;
const MAX_NARRATIVES = 2; // today + tomorrow
const SKIP_EXAMPLES = 30;
// Auto-caption titles that describe a broken/unreadable frame, not the content: never worth a calendar slot.
const JUNK_TITLE_RE = /\b(corrupted|low[- ]quality (video|image|frame)|unreadable|cannot be determined|unable to (identify|determine))\b/i;
const WRITE_CONCURRENCY = 10;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const POST_MAX = 280;
const MAX_EXCLUDE_IDS = 200;
const CLIENT_WORK_LABEL_RE = /video editing|graphic design|client work/i;

// A kind in `include` maps to the row kinds it allows.
const ROW_KIND_OF = { baseline: 'baseline', quotes: 'quote', narratives: 'narrative', 'client-work': 'client-work' };

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clip = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const dayNumber = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
const slug = (v) => clip(v, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const ownerStory = (pkg) => String(pkg?.humanEdits?.story ?? '').trim();

/** Validate a fill spec from the owner, the agent or a route body. Never throws. */
export function normalizeFillSpec(raw, { today } = {}) {
  const errors = [];
  const r = isPlain(raw) ? raw : {};
  let from = today && DAY_RE.test(today) ? today : null;
  if (r.from !== undefined && r.from !== null && r.from !== '') {
    if (!DAY_RE.test(String(r.from)) || Number.isNaN(Date.parse(`${r.from}T00:00:00Z`))) errors.push('from must be YYYY-MM-DD');
    else from = String(r.from);
  }
  if (!from) errors.push('from is required');
  else if (today && from < today) from = today; // never plan into the past
  const days = r.days === undefined ? DEFAULT_FILL_DAYS : Number(r.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_FILL_DAYS) errors.push(`days must be 1-${MAX_FILL_DAYS}`);
  let include = [...FILL_KINDS];
  if (r.include !== undefined) {
    if (!Array.isArray(r.include)) errors.push('include must be an array');
    else {
      const bad = r.include.filter((k) => !FILL_KINDS.includes(k));
      if (bad.length) errors.push(`include: unknown kind ${bad.join(', ')} (allowed ${FILL_KINDS.join(', ')})`);
      include = FILL_KINDS.filter((k) => r.include.includes(k));
      if (!include.length && !bad.length) errors.push('include must name at least one kind');
    }
  }
  // Replace-one-item options (calendar-decide.js): omitted => the spec is exactly what it was before.
  let excludePackageIds;
  if (r.excludePackageIds !== undefined) {
    if (!Array.isArray(r.excludePackageIds) || r.excludePackageIds.length > MAX_EXCLUDE_IDS || r.excludePackageIds.some((x) => typeof x !== 'string' || !x || x.length > 200)) {
      errors.push(`excludePackageIds must be an array of up to ${MAX_EXCLUDE_IDS} package ids`);
    } else excludePackageIds = [...new Set(r.excludePackageIds)];
  }
  let replace;
  if (r.replace !== undefined && r.replace !== null) {
    if (!isPlain(r.replace) || (r.replace.bucketId != null && typeof r.replace.bucketId !== 'string')) errors.push('replace must be {bucketId?: string}');
    else replace = { bucketId: r.replace.bucketId ? clip(r.replace.bucketId, 80) : null };
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, spec: { from, days, include, ...(excludePackageIds ? { excludePackageIds } : {}), ...(replace ? { replace } : {}) } };
}

/** A track's posts/day target: its engines' targets summed (daily target, else weekly minimum / 7), the same rule as the
 *  Insights target; a track with none gets 1/day when it has a share, else 0. Capped per day in the planner. */
export function trackPostsPerDay(track, engineTargets) {
  const cfg = mergeEngineConfig(isPlain(engineTargets) ? engineTargets : {});
  const perDay = (track?.engines || []).reduce((s, e) => {
    const c = cfg.engines[e] ?? {};
    return s + (c.targetPerDay > 0 ? c.targetPerDay : c.weeklyMin > 0 ? c.weeklyMin / 7 : 0);
  }, 0);
  if (perDay > 0) return perDay;
  return Number(track?.share) > 0 ? 1 : 0;
}

/** Whole posts for one date from a fractional daily target, spread evenly and stable across re-runs (keyed on the date). */
const slotsOn = (perDay, date) => {
  const n = dayNumber(date);
  return Math.min(MAX_PER_TRACK_PER_DAY, Math.floor(perDay * (n + 1) + 1e-9) - Math.floor(perDay * n + 1e-9));
};

export const isClientWorkTrack = (track) => (track?.engines || []).includes('client') || CLIENT_WORK_LABEL_RE.test(String(track?.label ?? ''));

const mediaReady = (p) => (p?.mediaState === 'video' || p?.mediaState === 'still') && p?.effort === 'ready';

// Throwback track (Throwback Content): the track that lists the 'nas' bucket. It only ever posts a NAS archive item dated
// to that day (anniversary) that links to a real asset on the drive; no dated item with media => nothing that day.
export const isThrowbackTrack = (track) => (track?.buckets || []).includes('nas');
const BLOCKED_RIGHTS = new Set(['never-public', 'client-approval-needed']);
/** A NAS item that resolves to a real asset (sha + path + source) and is a video/still the owner may post. Staging is
 *  not required: the draft carries the link (packageId + nasSha) and the file is pulled when the owner schedules it. */
export const hasNasMediaLink = (p) => !!(p?.nas?.sha256 && p.nas.relativePath && p.nas.sourceId)
  && (p.mediaState === 'video' || p.mediaState === 'still') && !BLOCKED_RIGHTS.has(p.rights);
const throwbackOk = (p, md) => !!p && eventMonthDay(p) === md && hasNasMediaLink(p);
// Video first, then items already staged or thumbnailed (instant preview), then never used / least recently used, then id.
const throwbackRank = (a, b) => (a.p.mediaState === 'video' ? 0 : 1) - (b.p.mediaState === 'video' ? 0 : 1)
  || (mediaOf(a.p).kind || a.p.thumbRef ? 0 : 1) - (mediaOf(b.p).kind || b.p.thumbRef ? 0 : 1)
  || (a.prior ? 1 : 0) - (b.prior ? 1 : 0) || (a.prior || '').localeCompare(b.prior || '')
  || String(a.p.id).localeCompare(String(b.p.id));

function daysBetween(a, b) { return Math.abs(dayNumber(a) - dayNumber(b)); }

// trackRules (daily-mix-rule.js): a rule applies to the track that lists its bucket.
const ruleForTrack = (track, rules) => {
  if (!isPlain(rules)) return null;
  const hit = (track?.buckets || []).map((b) => rules[b]).find((r) => isPlain(r) && Number(r.perDay) >= 0);
  return hit ? { ...hit, perDay: Number(hit.perDay) } : null;
};
const matchesRule = (p, rule) => {
  const artists = Array.isArray(rule.artists) ? rule.artists.map((a) => String(a).toLowerCase()) : [];
  if (!artists.length) return true;
  if (p?.status === 'retired' || p?.mediaState !== 'video') return false;
  return (p.entities || []).some((e) => artists.includes(String(e).toLowerCase()));
};
// Never-used first, newest render first (the morning's render leads); then least recently used, oldest use first.
const newestUnusedFirst = (a, b) => (a.prior ? 1 : 0) - (b.prior ? 1 : 0)
  || (a.prior
    ? a.prior.localeCompare(b.prior)
    : String(b.p.renderedAt || '').localeCompare(String(a.p.renderedAt || '')))
  || String(a.p.id).localeCompare(String(b.p.id));

/**
 * Pure plan. `today` = YYYY-MM-DD in the client's time zone; `nowMs` (default = midnight UTC of today) only dates quote
 * windows. Inputs:
 *   tracks, engineTargets      plan.contentTracks / plan.engineTargets
 *   packages, clientWork       library items (clientWork = optional explicit pool for the client-work tracks)
 *   openPosts                  Map packageId -> {postId,status,scheduledAt,reviewOn} (or a Set): open posts; a bare draft
 *                              with no review day is PLACED (row.existingPostId), the rest are skipped
 *   fillPosts                  [{postId,status,reviewOn,fillKind,bucketId,idempotencyKey,packageId?}] earlier daily-fill drafts
 *                              (re-runs); a throwback fill counts only when its item is dated to that day and has media
 *   lastUsed                   Map packageId -> 'YYYY-MM-DD' last posted / dated day (the 30-day spread)
 *   quoteTargets               [{id,url,text,author|handle,createdAt,trackId?}] open quote candidates; asOf.quotes
 *   marketSignals              shapeMarketSignals output (topics/opportunities); asOf.signals
 *   trackRules                 { [bucketId]: {perDay, artists?, newestFirst?, sameDay?} } overrides for a bucket's track (daily-mix-rule.js):
 *                              perDay replaces the engine target; artists limits the pool to non-retired videos by those
 *                              artists; newestFirst ranks never-used items newest render first, then least recently used;
 *                              sameDay plans that track for `today` only (never days ahead) and, when a render newer than
 *                              every draft already holding today has arrived, adds it as today's draft anyway
 *   excludePackageIds          package ids that are never picked (the item the owner just replaced)
 *   replace                    {bucketId} replace-one-item mode: only the track(s) listing that bucket are filled, rejected earlier
 *                              fills no longer hold their slot, and at most ONE row is planned. Normal fills leave this unset.
 * @returns {{ok:true, from, days, rows, skipped, counts}|{ok:false, error}}
 */
export function planDailyFill({
  tracks = [], engineTargets = {}, packages = [], clientWork = null, openPosts = new Set(), fillPosts = [], lastUsed = new Map(),
  quoteTargets = [], marketSignals = null, asOf = {}, from, days = DEFAULT_FILL_DAYS, today, nowMs, include = FILL_KINDS,
  trackRules = {}, excludePackageIds = [], replace = null,
} = {}) {
  if (!DAY_RE.test(String(today || ''))) return { ok: false, error: 'today must be YYYY-MM-DD' };
  if (!DAY_RE.test(String(from || ''))) return { ok: false, error: 'from must be YYYY-MM-DD' };
  const want = new Set((Array.isArray(include) ? include : FILL_KINDS).map((k) => ROW_KIND_OF[k]).filter(Boolean));
  const dates = Array.from({ length: Math.max(1, Math.min(MAX_FILL_DAYS, Number(days) || DEFAULT_FILL_DAYS)) }, (_, i) => addDays(from, i));
  const rows = [];
  const skipped = [];
  const skip = (s) => skipped.push(s);
  const used = new Set(excludePackageIds || []);
  const now = Number.isFinite(nowMs) ? nowMs : Date.parse(`${today}T00:00:00Z`);
  const fills = Array.isArray(fillPosts) ? fillPosts : [];
  const lastOf = (id) => (lastUsed instanceof Map ? lastUsed.get(id) : lastUsed?.[id]) || null;
  const openOf = (id) => (openPosts instanceof Map ? openPosts.get(id) : openPosts?.has?.(id) ? true : null) || null;

  // ---- baseline + client-work: per track, per date ----------------------------------------------------------
  const clientWorkDay = new Map(); // date -> client-work rows placed (cap 1 a day across tracks)
  const ruleTitles = new Set(); // titles placed by a trackRules track in this window
  const titleKey = (p) => String(p?.title ?? p?.id).toLowerCase().trim();
  for (const track of tracks || []) {
    const kind = isClientWorkTrack(track) ? 'client-work' : 'baseline';
    if (!want.has(kind)) continue;
    if (replace?.bucketId && !(track.buckets || []).includes(replace.bucketId)) continue;
    const rule = ruleForTrack(track, trackRules);
    const perDay = rule ? rule.perDay : trackPostsPerDay(track, engineTargets);
    if (perDay <= 0) continue;
    const pool = (kind === 'client-work' && Array.isArray(clientWork) ? clientWork : packages)
      .filter((p) => p?.id && trackForPackage(tracks, p)?.id === track.id && (!rule || matchesRule(p, rule)));
    const buckets = new Set(track.buckets || []);
    const throwback = isThrowbackTrack(track);
    const pkgById = throwback ? new Map((packages || []).filter((p) => p?.id).map((p) => [p.id, p])) : null;
    // sameDay rule (daily mix): today only, never days ahead, so each morning's render leads that day's draft.
    const sameDay = !!rule?.sameDay;
    const renderedOf = (id) => String(pool.find((p) => p.id === id)?.renderedAt || '');
    for (const date of sameDay ? dates.filter((d) => d === today) : dates) {
      let slots = slotsOn(perDay, date);
      const md = date.slice(5);
      // Re-runs: drafts an earlier fill already put on this day for this track count toward its target. A throwback
      // draft without a dated, media-linked item does not hold the day (it is left alone, never deleted).
      const holding = fills.filter((f) => !(replace && f.status === 'rejected') && f.reviewOn === date && (f.fillKind === 'baseline' || f.fillKind === 'client-work') && buckets.has(f.bucketId)
        && (!throwback || throwbackOk(pkgById.get(f.packageId), md)));
      slots -= holding.length;
      if (kind === 'client-work') slots = Math.min(slots, 1 - (clientWorkDay.get(date) || 0));
      // sameDay: a newer render than every (non-rejected) draft holding today gets its own draft; the older drafts stay
      // for the owner to pass or delete. A rerun sees the new render already queued and adds nothing.
      if (sameDay && slots <= 0) {
        const heldAt = holding.filter((f) => f.status !== 'rejected').map((f) => renderedOf(f.packageId));
        const newest = pool.filter((p) => !used.has(p.id) && !lastOf(p.id) && !openOf(p.id)).map((p) => String(p.renderedAt || '')).sort().pop() || '';
        if (newest && heldAt.every((r) => r < newest)) slots = 1;
      }
      if (slots <= 0) continue;
      const ranked = [];
      for (const p of pool) {
        if (used.has(p.id) || /^example/i.test(p.id) || /^todo\b/i.test(String(p.title ?? '')) || JUNK_TITLE_RE.test(String(p.title ?? ''))) continue; // seed/example rows and junk auto-captions are never picked
        const dated = eventMonthDay(p);
        if (dated && dated !== md) continue; // an anniversary item belongs on its own day only
        if (throwback && !throwbackOk(p, md)) continue; // never an undated item or one without a media link
        const prior = lastOf(p.id);
        if (prior && daysBetween(prior, date) < REPEAT_GAP_DAYS) continue;
        const open = openOf(p.id);
        const placeable = open && typeof open === 'object' && open.status === 'draft' && !open.scheduledAt && !open.reviewOn && open.postId;
        if (open && !placeable) { skip({ date, packageId: p.id, reason: 'already-queued' }); continue; }
        const tier = dated ? 0 : mediaReady(p) ? 1 : 2;
        ranked.push({ p, dated: !!dated, tier, prior, existingPostId: placeable ? open.postId : null });
      }
      if (throwback) ranked.sort(throwbackRank);
      else if (rule?.newestFirst) ranked.sort(newestUnusedFirst);
      else ranked.sort((a, b) => a.tier - b.tier || (a.prior || '').localeCompare(b.prior || '') || String(a.p.id).localeCompare(String(b.p.id)));
      // A rule track holds many renders of the same mix: one title per fill window, so days don't repeat a mix.
      const picks = rule ? ranked.filter((c) => !ruleTitles.has(titleKey(c.p))) : ranked;
      for (const c of picks.slice(0, slots)) {
        used.add(c.p.id);
        if (rule) ruleTitles.add(titleKey(c.p));
        if (kind === 'client-work') clientWorkDay.set(date, (clientWorkDay.get(date) || 0) + 1);
        rows.push({
          date, kind, trackId: track.id, bucketId: bucketOfPackage(c.p), packageId: c.p.id, title: c.p.title ?? null,
          text: draftTextFor(c.p), needsStory: !ownerStory(c.p), engine: resolveEngine(c.p),
          nasSha: typeof c.p.nas?.sha256 === 'string' ? c.p.nas.sha256 : null,
          reason: c.dated ? `event date ${md} falls on this day`
            : `${c.tier === 1 ? 'media ready' : 'library item'}; ${c.prior ? `last used ${c.prior}` : 'not used before'}`,
          source: { type: 'library-item', id: c.p.id, asOf: today },
          ...(c.existingPostId ? { existingPostId: c.existingPostId } : {}),
        });
      }
      if (ranked.length < slots && !ranked.length) skip({ date, trackId: track.id, reason: throwback ? 'no-dated-media' : 'no-eligible-item' });
    }
  }

  // ---- quotes: today only ---------------------------------------------------------------------------------------
  if (want.has('quote') && dates.includes(today)) {
    const sourceAsOf = asOf?.quotes || today;
    let n = 0;
    for (const t of Array.isArray(quoteTargets) ? quoteTargets : []) {
      const id = clip(t?.id || t?.url, 120);
      const url = clip(t?.url, 300);
      if (!id || !/^https:\/\/(x|twitter)\.com\/\w+\/status\/\d+/.test(url)) { skip({ kind: 'quote', targetId: id || null, reason: 'no-url' }); continue; }
      const created = Date.parse(t?.createdAt || '');
      if (!Number.isFinite(created)) { skip({ kind: 'quote', targetId: id, reason: 'no-timestamp' }); continue; }
      const windowH = Number(t?.windowHours) > 0 ? Number(t.windowHours) : QUOTE_WINDOW_HOURS;
      const expiresMs = created + windowH * 3_600_000;
      if (expiresMs <= now) { skip({ kind: 'quote', targetId: id, reason: 'window-closed' }); continue; }
      const key = `daily-fill:${today}:quote:${id}`;
      if (fills.some((f) => f.idempotencyKey === key)) { skip({ kind: 'quote', targetId: id, reason: 'already-filled' }); continue; }
      if (n >= MAX_QUOTES) { skip({ kind: 'quote', targetId: id, reason: 'over-limit' }); continue; }
      n += 1;
      const handle = clip(t?.handle || t?.author?.username || (typeof t?.author === 'string' ? t.author : ''), 40).replace(/^@/, '');
      const ageH = Math.max(0, Math.round(((now - created) / 3_600_000) * 10) / 10);
      const caption = `${handle ? `@${handle} on this: ` : ''}${TAKE_PLACEHOLDER}`;
      const track = t?.trackId ? (tracks || []).find((x) => x.id === t.trackId) : null;
      rows.push({
        date: today, kind: 'quote', trackId: track?.id ?? t?.trackId ?? null, bucketId: track?.buckets?.[0] ?? null,
        quoteTarget: { id, url, handle: handle || null, text: clip(t?.text, 200) },
        // A hot pick carries no caption: the owner writes the comment himself.
        text: (t?.hot ? url : `${caption}\n\n${url}`).slice(0, POST_MAX), needsStory: !t?.hot,
        reason: `open quote window: posted ${ageH}h ago, closes after ${windowH}h`,
        source: { type: 'quote-target', id, asOf: sourceAsOf }, expiresAt: new Date(expiresMs).toISOString(),
      });
    }
  }

  // ---- narratives: today + tomorrow, one a day ---------------------------------------------------------------------
  if (want.has('narrative') && marketSignals && typeof marketSignals === 'object') {
    const topics = [
      ...(Array.isArray(marketSignals.topics) ? marketSignals.topics.map((x) => ({ topic: x?.topic, detail: x?.detail })) : []),
      ...(Array.isArray(marketSignals.opportunities) ? marketSignals.opportunities.map((x) => ({ topic: x?.topic, detail: x?.angle })) : []),
    ].filter((x) => clip(x.topic, 90));
    const signalsAsOf = asOf?.signals || marketSignals.generatedAt || today;
    const days2 = [today, addDays(today, 1)].filter((d) => dates.includes(d)).slice(0, MAX_NARRATIVES);
    let i = 0;
    for (const date of days2) {
      // Re-run: a narrative already filled for this day (any topic) counts as the day's one.
      if (fills.some((f) => f.fillKind === 'narrative' && f.reviewOn === date)) { skip({ date, kind: 'narrative', reason: 'already-filled' }); continue; }
      const t = topics[i]; i += 1;
      if (!t) { skip({ date, kind: 'narrative', reason: 'no-signal' }); continue; }
      const topic = clip(t.topic, 90);
      const head = `${topic}${clip(t.detail, 140) ? `: ${clip(t.detail, 140)}` : ''}`;
      const tail = `Where it shows up in my work: ${TAKE_PLACEHOLDER}`;
      const room = POST_MAX - tail.length - 2;
      rows.push({
        date, kind: 'narrative', trackId: null, bucketId: null,
        text: `${head.length > room ? `${head.slice(0, room - 1).trimEnd()}…` : head}\n\n${tail}`, needsStory: true,
        reason: `Market Signals topic: ${topic}`,
        source: { type: 'market-signal', id: slug(topic) || 'signal', asOf: signalsAsOf },
      });
    }
  }

  if (replace && rows.length > 1) rows.length = 1; // replace-one-item: never more than one new row (first in plan order)
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || String(a.packageId || a.quoteTarget?.id || '').localeCompare(String(b.packageId || b.quoteTarget?.id || '')));
  const byKind = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  const byReason = {};
  for (const s of skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1;
  return {
    ok: true, from, days: dates.length, rows, skipped: skipped.slice(0, SKIP_EXAMPLES),
    counts: { drafts: rows.length, byKind, placesExisting: rows.filter((r) => r.existingPostId).length, skipped: byReason },
  };
}

/** Idempotency key of a planned row: one draft per day, kind and item/target. */
export const fillKeyOf = (r) => `daily-fill:${r.date}:${r.kind}:${r.packageId || r.quoteTarget?.id || r.source?.id}`;

/**
 * Plan (and with `execute` write) a fill. deps:
 *   loadInputs(clientId) -> the planDailyFill inputs (tracks, packages, openPosts, ... today, nowMs)
 *   ensureDraft(clientId, payload) -> {post, existing}   twitter-service ensureDraftPost (one draft per idempotency key)
 *   placeDraft(clientId, postId, {reviewOn, bucketId, media}) -> bool   (optional) dates an existing bare draft
 *   mediaFor(clientId, packageId) -> media fields | null   (optional) the item's own video/image
 * Returns {ok, preview, spec, counts, skipped, rows, created, existing, placed, failed}. A media failure never blocks a draft.
 */
export async function runDailyFill(clientId, { from, days, include, excludePackageIds, replace, execute = false, batchId = null, deps = {} } = {}) {
  if (typeof deps.loadInputs !== 'function') throw new Error('runDailyFill: deps.loadInputs is required');
  const inputs = await deps.loadInputs(clientId);
  const norm = normalizeFillSpec({ from, days, include, excludePackageIds, replace }, { today: inputs.today });
  if (!norm.ok) return { ok: false, status: 400, error: norm.errors.join('; ') };
  const plan = planDailyFill({ ...inputs, ...norm.spec });
  if (!plan.ok) return { ok: false, status: 400, error: plan.error };
  const base = { ok: true, spec: norm.spec, counts: plan.counts, skipped: plan.skipped, rows: plan.rows };
  if (!execute) return { ...base, preview: true };
  if (typeof deps.ensureDraft !== 'function') return { ok: false, status: 503, error: 'Creating drafts is not available on this deployment.' };
  const out = { created: 0, existing: 0, placed: 0, failed: [], posts: [] }; // posts: [{postId,date,kind,packageId}] the fill wrote or placed
  const queue = [...plan.rows];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const label = r.packageId || r.quoteTarget?.id || r.source?.id;
      try {
        const media = r.packageId && typeof deps.mediaFor === 'function' ? await Promise.resolve(deps.mediaFor(clientId, r.packageId)).catch(() => null) : null;
        if (r.existingPostId) {
          if (typeof deps.placeDraft !== 'function') throw new Error('placing existing drafts is not available');
          const placed = await deps.placeDraft(clientId, r.existingPostId, { reviewOn: r.date, bucketId: r.bucketId, media });
          if (placed) { out.placed += 1; out.posts.push({ postId: r.existingPostId, date: r.date, kind: r.kind, packageId: r.packageId || null }); } else out.failed.push({ date: r.date, kind: r.kind, id: label, error: 'draft changed; not placed' });
          continue;
        }
        const res = await deps.ensureDraft(clientId, {
          ...(media || {}),
          idempotencyKey: fillKeyOf(r),
          content: r.text, source: 'daily-fill', fillKind: r.kind, fillSource: r.source, reviewOn: r.date,
          needsStory: r.needsStory, ...(r.bucketId ? { bucketId: r.bucketId } : {}),
          ...(r.packageId ? { packageId: r.packageId, engine: r.engine } : {}),
          ...(r.nasSha ? { nasSha: r.nasSha } : {}), // the NAS asset link: the draft has media even before it is staged
          ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}),
          ...(r.quoteTarget ? { sourceRef: { kind: 'quote-target', url: r.quoteTarget.url, id: r.quoteTarget.id, handle: r.quoteTarget.handle } } : {}),
          ...(batchId ? { runId: batchId } : {}),
        });
        if (res?.existing) out.existing += 1; else out.created += 1;
        const pid = res?.post?.id ?? res?.post?.postId;
        if (pid) out.posts.push({ postId: pid, date: r.date, kind: r.kind, packageId: r.packageId || null });
      } catch (err) {
        out.failed.push({ date: r.date, kind: r.kind, id: label, error: String(err?.message || err).slice(0, 160) });
      }
    }
  };
  await Promise.all(Array.from({ length: WRITE_CONCURRENCY }, worker));
  return { ...base, preview: false, ...out };
}

/** The daily cron's fill: today + the next 6 days, every kind, drafts only. `deps` as runDailyFill. Never throws on a
 *  plan problem; the caller wraps it in try/catch (a fill failure must not fail the daily loop). */
export async function runDailyFillForCron(clientId, { today, deps } = {}) {
  const wrapped = typeof deps?.loadInputs === 'function' && today
    ? { ...deps, loadInputs: async (id) => ({ ...(await deps.loadInputs(id)), today }) }
    : deps;
  return runDailyFill(clientId, { from: today, days: DEFAULT_FILL_DAYS, include: [...FILL_KINDS], execute: true, batchId: today ? `daily-fill-${today}` : null, deps: wrapped });
}

/** Posts that count as "an earlier fill" for re-run accounting (open or settled; deleted rows are gone). */
export const isFillPost = (r) => r?.source === 'daily-fill' && typeof r.reviewOn === 'string';
