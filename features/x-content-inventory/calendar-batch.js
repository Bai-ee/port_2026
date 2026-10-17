// calendar-batch.js — bulk-load library items onto the calendar as REVIEW DRAFTS (docs/source-of-truth/CONTENT-TRACKS.md
// § Calendar batch). One spec = which items (a track, a bucket, a search and/or ids) + how to date them
// (`anniversary` = the next time the item's event date comes round, at most `perDay` per date; `spread` = `perDay` a
// day from a start date).
// Each item becomes one `social_posts` draft (status 'draft', scheduledAt null, `reviewOn` = its date) through the
// existing create-once path, so nothing here can approve, schedule or publish. A draft with no owner memory keeps the
// "[add your memory]" placeholder and needsStory, which the approval gate and the publish sweep both refuse.
//
// planCalendarBatch is pure (no I/O, no clock); createCalendarBatch takes the draft writer as a dependency.

import { trackForPackage, bucketOfPackage, isBucketId } from '../x-strategy/content-tracks.js';
import { resolveEngine } from './engines.js';
import { hasPlaceholderStory } from './match.js';

export const MAX_BATCH = 366; // one a day for a year
const WRITE_CONCURRENCY = 10;
export const MAX_PER_DAY = 6;
export const MEMORY_PLACEHOLDER = '[add your memory]';
const DATE_RULES = ['anniversary', 'spread'];
const POST_MAX = 280;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_DAY_RE = /^(\d{2})-(\d{2})$/;
const SKIP_EXAMPLES = 20;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Validate a batch spec from the owner, the agent or a route body. Never throws.
 * @returns {{ok:true, spec:object}|{ok:false, errors:string[]}}
 */
export function normalizeBatchSpec(raw) {
  const errors = [];
  if (!isPlain(raw)) return { ok: false, errors: ['spec must be an object'] };
  const sel = isPlain(raw.select) ? raw.select : {};
  const select = {};
  if (sel.track !== undefined && text(sel.track, 60)) select.track = text(sel.track, 60);
  if (sel.bucketId !== undefined) {
    const b = String(sel.bucketId ?? '').trim().toLowerCase();
    if (!isBucketId(b)) errors.push('select.bucketId is not a bucket id');
    else select.bucketId = b;
  }
  if (sel.query !== undefined && text(sel.query, 120)) select.query = text(sel.query, 120);
  if (sel.ids !== undefined) {
    const ids = Array.isArray(sel.ids) ? [...new Set(sel.ids.map((x) => String(x ?? '').trim()).filter(Boolean))] : null;
    if (!ids) errors.push('select.ids must be an array');
    else if (ids.length > MAX_BATCH) errors.push(`select.ids: at most ${MAX_BATCH}`);
    else if (ids.length) select.ids = ids;
  }
  if (!Object.keys(select).length) errors.push('select needs at least one of track, bucketId, query, ids');

  const rule = isPlain(raw.dateRule) ? raw.dateRule : {};
  const kind = String(rule.kind ?? '').trim();
  const dateRule = { kind };
  if (!DATE_RULES.includes(kind)) errors.push(`dateRule.kind must be one of ${DATE_RULES.join(', ')}`);
  if (kind === 'spread' || kind === 'anniversary') {
    const perDay = rule.perDay === undefined ? 1 : Number(rule.perDay);
    if (!Number.isInteger(perDay) || perDay < 1 || perDay > MAX_PER_DAY) errors.push(`dateRule.perDay must be 1-${MAX_PER_DAY}`);
    else dateRule.perDay = perDay;
  }
  if (kind === 'spread') {
    if (rule.startDate !== undefined && rule.startDate !== null && rule.startDate !== '') {
      if (!DAY_RE.test(String(rule.startDate)) || Number.isNaN(Date.parse(`${rule.startDate}T00:00:00Z`))) errors.push('dateRule.startDate must be YYYY-MM-DD');
      else dateRule.startDate = String(rule.startDate);
    }
  }
  const limit = raw.limit === undefined ? MAX_BATCH : Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) errors.push(`limit must be 1-${MAX_BATCH}`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, spec: { select, dateRule, limit } };
}

// ---- dates (plain calendar dates, YYYY-MM-DD; no time zones in here) ----------------------------------------
const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);
const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d, n) => fmtDay(dayMs(d) + n * 86_400_000);
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** An item's event month-day ("MM-DD"): owner edits first, then facets, then the item itself (eventMonthDay, else eventDate). */
export function eventMonthDay(pkg) {
  for (const src of [pkg?.humanEdits, pkg?.facets, pkg]) {
    const md = String(src?.eventMonthDay ?? '').trim();
    if (MONTH_DAY_RE.test(md)) return md;
    const full = String(src?.eventDate ?? '').trim();
    if (DAY_RE.test(full)) return full.slice(5);
  }
  return null;
}

/** The next date (>= today) on which month-day `md` falls; Feb 29 lands on Feb 28 in other years. */
export function nextAnniversary(md, today) {
  const m = MONTH_DAY_RE.exec(md || '');
  if (!m || !DAY_RE.test(today)) return null;
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    const dd = m[1] === '02' && m[2] === '29' && !isLeap(y) ? '28' : m[2];
    const d = `${y}-${m[1]}-${dd}`;
    if (Number.isNaN(dayMs(d)) || fmtDay(dayMs(d)) !== d) return null; // e.g. 04-31
    if (d >= today) return d;
  }
  return null;
}

/** "Dec 17, 2014" / "Dec 17" for the draft's first line, or ''. */
function dateLabel(pkg) {
  const full = String(pkg?.humanEdits?.eventDate ?? pkg?.facets?.eventDate ?? pkg?.eventDate ?? '').trim();
  const md = eventMonthDay(pkg);
  if (!md) return '';
  const [mm, dd] = md.split('-').map(Number);
  const year = DAY_RE.test(full) ? full.slice(0, 4) : '';
  return `${MONTHS[mm - 1]} ${dd}${year ? `, ${year}` : ''}`;
}

// The owner's own words: an owner-edited story. A generated story ("X was born …. Source: <url>") is facts, not memory.
const ownerStory = (pkg) => String(pkg?.humanEdits?.story ?? '').trim();
// Facts from a generated story, without the source line or links (links belong in the self-reply, not the post).
const storyFacts = (pkg) => (hasPlaceholderStory(pkg) ? '' : String(pkg?.story ?? '')
  .replace(/\s*source:.*$/is, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim());

/**
 * Draft text: date · title, where, the item's facts, then the owner's story or the memory placeholder (a batch draft
 * always waits for the owner's own line unless they already wrote one). Always <= 280 chars.
 */
export function draftTextFor(pkg) {
  const facets = pkg?.facets || {};
  const title = text(pkg?.title || (Array.isArray(facets.partyNames) ? facets.partyNames[0] : '') || pkg?.id, 120);
  const where = [Array.isArray(facets.venues) ? facets.venues[0] : '', Array.isArray(facets.cities) && !facets.venues?.length ? facets.cities[0] : '']
    .map((x) => text(x, 60)).filter((x) => x && !title.toLowerCase().includes(x.toLowerCase())).join(', ');
  const own = ownerStory(pkg);
  const head = [[dateLabel(pkg), title].filter(Boolean).join(' · '), where, own ? '' : storyFacts(pkg)].filter(Boolean).join('\n');
  const tail = own || MEMORY_PLACEHOLDER;
  const room = POST_MAX - tail.length - 2;
  if (room < 20) return tail.slice(0, POST_MAX);
  const h = head.length > room ? `${head.slice(0, room - 1).trimEnd()}…` : head;
  return h ? `${h}\n\n${tail}` : tail;
}

function selector(spec, tracks) {
  const { track, bucketId, query, ids } = spec.select;
  let trackId = null;
  if (track) {
    const want = track.toLowerCase();
    const t = (tracks || []).find((x) => x.id === want || String(x.label).toLowerCase() === want);
    if (!t) return { error: `unknown track "${track}"` };
    trackId = t.id;
  }
  const idSet = ids ? new Set(ids) : null;
  const tokens = query ? query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8) : [];
  return {
    match: (p) => {
      if (idSet && !idSet.has(p.id)) return false;
      if (bucketId && bucketOfPackage(p) !== bucketId) return false;
      if (trackId && trackForPackage(tracks, p)?.id !== trackId) return false;
      if (tokens.length) {
        const hay = `${p.id} ${p.title ?? ''} ${p.story ?? ''} ${(p.searchTokens || []).join(' ')} ${JSON.stringify(p.facets ?? {})} ${JSON.stringify(p.humanEdits ?? {})}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    },
  };
}

/**
 * Pure plan for one batch. `today` = YYYY-MM-DD in the client's time zone; `openPackageIds` = items that already have
 * an open post (they are skipped, never duplicated). Returns {ok, rows, skipped, counts} or {ok:false, error}.
 */
export function planCalendarBatch({ packages = [], tracks = [], spec, today, openPackageIds = new Set() } = {}) {
  if (!DAY_RE.test(String(today || ''))) return { ok: false, error: 'today must be YYYY-MM-DD' };
  const sel = selector(spec, tracks);
  if (sel.error) return { ok: false, error: sel.error };
  const picked = (packages || []).filter((p) => p?.id && sel.match(p));
  const skipped = [];
  const candidates = [];
  for (const p of picked) {
    if (openPackageIds.has(p.id)) { skipped.push({ packageId: p.id, title: p.title ?? null, reason: 'already-queued' }); continue; }
    if (spec.dateRule.kind === 'anniversary') {
      const reviewOn = nextAnniversary(eventMonthDay(p), today);
      if (!reviewOn) { skipped.push({ packageId: p.id, title: p.title ?? null, reason: 'no-date' }); continue; }
      candidates.push({ p, reviewOn });
    } else {
      candidates.push({ p, reviewOn: null });
    }
  }
  if (spec.dateRule.kind === 'anniversary') {
    // Per date, the best items first (owner story, then a full printed date, then a title); extras beyond perDay skip.
    const rank = (p) => (ownerStory(p) ? 0 : 4) + (DAY_RE.test(String(p.humanEdits?.eventDate ?? p.facets?.eventDate ?? '')) ? 0 : 2) + (p.title ? 0 : 1);
    candidates.sort((a, b) => a.reviewOn.localeCompare(b.reviewOn) || rank(a.p) - rank(b.p) || String(a.p.id).localeCompare(String(b.p.id)));
    const perDate = new Map();
    const kept = [];
    for (const c of candidates) {
      const n = perDate.get(c.reviewOn) || 0;
      if (n >= spec.dateRule.perDay) { skipped.push({ packageId: c.p.id, title: c.p.title ?? null, reason: 'day-full' }); continue; }
      perDate.set(c.reviewOn, n + 1);
      kept.push(c);
    }
    candidates.length = 0;
    candidates.push(...kept);
  } else {
    candidates.sort((a, b) => String(a.p.title ?? '').localeCompare(String(b.p.title ?? '')) || String(a.p.id).localeCompare(String(b.p.id)));
    const start = spec.dateRule.startDate && spec.dateRule.startDate > today ? spec.dateRule.startDate : addDays(today, 1);
    candidates.forEach((c, i) => { c.reviewOn = addDays(start, Math.floor(i / spec.dateRule.perDay)); });
  }
  const kept = candidates.slice(0, spec.limit);
  for (const c of candidates.slice(spec.limit)) skipped.push({ packageId: c.p.id, title: c.p.title ?? null, reason: 'over-limit' });
  const rows = kept.map(({ p, reviewOn }) => ({
    packageId: p.id,
    title: p.title ?? null,
    reviewOn,
    content: draftTextFor(p),
    needsStory: !ownerStory(p),
    engine: resolveEngine(p),
    bucketId: bucketOfPackage(p),
    nasSha: typeof p.nas?.sha256 === 'string' ? p.nas.sha256 : null,
    track: trackForPackage(tracks, p)?.id ?? null,
  }));
  const byReason = {};
  for (const s of skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1;
  return {
    ok: true,
    rows,
    skipped: skipped.slice(0, SKIP_EXAMPLES),
    counts: { matched: picked.length, drafts: rows.length, needsMemory: rows.filter((r) => r.needsStory).length, skipped: byReason },
    firstDate: rows[0]?.reviewOn ?? null,
    lastDate: rows.length ? rows.map((r) => r.reviewOn).sort().at(-1) : null,
  };
}

/**
 * Write a planned batch. `ensureDraft(clientId, payload)` = twitter-service ensureDraftPost (one draft per
 * idempotency key; a re-run returns the existing row). `mediaFor(packageId)` -> media fields or null (optional). Returns {created, existing, failed:[{packageId,error}]}.
 */
export async function createCalendarBatch(clientId, plan, { ensureDraft, mediaFor = null, batchId = null } = {}) {
  if (typeof ensureDraft !== 'function') throw new Error('createCalendarBatch: ensureDraft is required');
  const out = { created: 0, existing: 0, failed: [] };
  const rows = [...(plan?.rows || [])];
  const worker = async () => {
    for (let r = rows.shift(); r; r = rows.shift()) {
      try {
        // The item's own video/image (signed like create-draft-from-item); a media failure never blocks the draft.
        const media = typeof mediaFor === 'function' ? await Promise.resolve(mediaFor(r.packageId)).catch(() => null) : null;
        const res = await ensureDraft(clientId, {
          ...(media || {}),
          idempotencyKey: `calendar-batch:${r.packageId}`,
          content: r.content, source: 'calendar-batch', packageId: r.packageId, engine: r.engine, bucketId: r.bucketId,
          needsStory: r.needsStory, reviewOn: r.reviewOn, ...(batchId ? { runId: batchId } : {}),
        });
        if (res?.existing) out.existing += 1; else out.created += 1;
      } catch (err) {
        out.failed.push({ packageId: r.packageId, error: String(err?.message || err).slice(0, 160) });
      }
    }
  };
  await Promise.all(Array.from({ length: WRITE_CONCURRENCY }, worker));
  return out;
}
