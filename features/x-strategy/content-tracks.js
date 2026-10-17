// Content tracks — the shared contract for the multi-benchmark plan (docs/plans/CONTENT-TRACKS-PROMOTION-MASTER-PLAN.md §4.1).
// Since 2026-10-16 every track is one Content Center bucket (features/x-strategy/bucket-tracks.js keeps them in step):
// the track lists that bucket (which wins over engines when deciding which track a library item belongs to) and owns
// the engine of the same id when the bucket is a built-in one. It has its own benchmark handles, a share of authored
// originals and its promotions. Benchmarks are never averaged across tracks. `plan.benchmarkPrimary` still sets overall pace.
// Pure: no I/O. Other modules import this file and never redefine these shapes.

import { ENGINE_IDS, resolveEngine } from '../x-content-inventory/engines.js';

export const MAX_TRACKS = 12;
export const MAX_BUCKETS_PER_TRACK = 8;
const BUCKET_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const isBucketId = (v) => BUCKET_ID_RE.test(String(v ?? ''));
export const MAX_BENCHMARKS_PER_TRACK = 3;
export const MAX_DISTINCT_BENCHMARKS = 8;
export const MAX_LISTS_PER_TRACK = 3;
export const MAX_DISTINCT_LISTS = 8;
export const MAX_PROMOTIONS_PER_TRACK = 4;
const SHARE_EPSILON = 0.001;

/** @typedef {{id:string,label:string,engine:'ue'|'record'|'client'|'identity',url:string|null,weeklyTarget:number}} Promotion */
/** @typedef {{id:string,label:string}} TrackList */
/** @typedef {{id:string,label:string,engines:string[],buckets:string[],benchmarks:string[],lists:TrackList[],share:number,promotions:Promotion[],topics:string[]}} ContentTrack */

// No code-default tracks: a client with no saved contentTracks has no tracks (and no track targets). The home client's
// former two tracks live in its own plan doc (seeded by scripts/x-content/seed-home-priors.mjs), never here.
export const DEFAULT_TRACKS = Object.freeze([]);

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function normalizeUrl(value) {
  if (value == null || String(value).trim() === '') return null;
  let u;
  try { u = new URL(String(value).trim()); } catch { throw bad(`Promotion link is not a valid URL: ${value}`); }
  if (u.protocol !== 'https:') throw bad('Promotion links must start with https://');
  return u.toString();
}

/** Validate one track's promotions. `allowedEngines` (optional) restricts promotion.engine. Throws 400. */
export function normalizePromotions(input, allowedEngines = null) {
  if (!Array.isArray(input)) throw bad('promotions must be an array.');
  if (input.length > MAX_PROMOTIONS_PER_TRACK) throw bad(`At most ${MAX_PROMOTIONS_PER_TRACK} promotions per track.`);
  const seen = new Set();
  return input.map((raw) => {
    const id = String(raw?.id || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{1,32}$/.test(id)) throw bad(`Bad promotion id: ${raw?.id}`);
    if (seen.has(id)) throw bad(`Duplicate promotion id: ${id}`);
    seen.add(id);
    const engine = String(raw?.engine || '').trim();
    if (!ENGINE_IDS.includes(engine)) throw bad(`Promotion ${id} has an unknown engine: ${engine}`);
    if (allowedEngines && !allowedEngines.includes(engine)) throw bad(`Promotion ${id} engine ${engine} is not in its track.`);
    const label = String(raw?.label || '').trim().slice(0, 60);
    if (!label) throw bad(`Promotion ${id} needs a label.`);
    const weeklyTarget = Number(raw?.weeklyTarget ?? 0);
    if (!Number.isInteger(weeklyTarget) || weeklyTarget < 0 || weeklyTarget > 14) throw bad(`Promotion ${id} weeklyTarget must be 0–14.`);
    return { id, label, engine, url: normalizeUrl(raw?.url), weeklyTarget };
  });
}

function normalizeHandle(h) {
  const v = String(h || '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(v)) throw bad(`Bad benchmark handle: ${h}`);
  return v;
}

/** X list id from `https://x.com/i/lists/<digits>` (or twitter.com), or bare digits. Digits string or null. */
export function parseListId(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const m = v.match(/^(?:https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/i\/lists\/)?(\d{1,25})\/?(?:[?#].*)?$/i);
  return m ? m[1] : null;
}

/** List label safe for a Brain row: no `| ; , =` or newlines, max 40 chars. */
export function sanitizeListLabel(value) {
  return String(value ?? '').replace(/[|;,=\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
}

function normalizeLists(input, trackId) {
  const arr = Array.isArray(input) ? input : [];
  const seen = new Map();
  for (const raw of arr) {
    const rawId = raw && typeof raw === 'object' ? raw.id : raw;
    const id = parseListId(rawId);
    if (!id) throw bad(`Bad list id: ${rawId}`);
    if (seen.has(id)) continue;
    const label = sanitizeListLabel(raw && typeof raw === 'object' ? raw.label : '') || `List ${id}`;
    seen.set(id, { id, label });
  }
  if (seen.size > MAX_LISTS_PER_TRACK) throw bad(`Track ${trackId}: at most ${MAX_LISTS_PER_TRACK} lists.`);
  return [...seen.values()];
}

// Content Center bucket ids (content_buckets/{clientId}/buckets) this track draws its library items from.
function normalizeBuckets(input, trackId) {
  const ids = [...new Set((Array.isArray(input) ? input : []).map((b) => String(b ?? '').trim().toLowerCase()).filter(Boolean))];
  for (const id of ids) if (!BUCKET_ID_RE.test(id)) throw bad(`Track ${trackId} has a bad bucket id: ${id}`);
  if (ids.length > MAX_BUCKETS_PER_TRACK) throw bad(`Track ${trackId}: at most ${MAX_BUCKETS_PER_TRACK} buckets.`);
  return ids;
}

/**
 * Validate a full contentTracks list. Throws 400. An empty list is valid (no tracks => no track targets) and returns [].
 * Rules for a non-empty list: ≤MAX_TRACKS tracks; unique ids; every engine in exactly one track (disjoint + complete);
 * ≤MAX_BENCHMARKS_PER_TRACK handles per track and ≤`maxDistinctBenchmarks` distinct overall; optional `lists`
 * (≤MAX_LISTS_PER_TRACK per track, ≤MAX_DISTINCT_LISTS distinct ids overall; always returned, [] when absent);
 * optional `buckets` (bucket ids, each in at most one track; always returned, [] when absent);
 * shares ≥0 and normalized to sum 1.
 */
export function normalizeContentTracks(input, { maxDistinctBenchmarks = MAX_DISTINCT_BENCHMARKS } = {}) {
  if (!Array.isArray(input)) throw bad('contentTracks must be an array.');
  if (input.length === 0) return [];
  if (input.length > MAX_TRACKS) throw bad(`At most ${MAX_TRACKS} tracks.`);
  const ids = new Set();
  const engineOwner = new Map();
  const bucketOwner = new Map();
  const distinct = new Set();
  const distinctLists = new Set();
  const tracks = input.map((raw) => {
    const id = String(raw?.id || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{1,32}$/.test(id)) throw bad(`Bad track id: ${raw?.id}`);
    if (ids.has(id)) throw bad(`Duplicate track id: ${id}`);
    ids.add(id);
    const label = String(raw?.label || '').trim().slice(0, 60);
    if (!label) throw bad(`Track ${id} needs a label.`);
    const engines = [...new Set((Array.isArray(raw?.engines) ? raw.engines : []).map(String))];
    for (const e of engines) {
      if (!ENGINE_IDS.includes(e)) throw bad(`Track ${id} has an unknown engine: ${e}`);
      if (engineOwner.has(e)) throw bad(`Engine ${e} is in both ${engineOwner.get(e)} and ${id}.`);
      engineOwner.set(e, id);
    }
    const buckets = normalizeBuckets(raw?.buckets, id);
    for (const b of buckets) {
      if (bucketOwner.has(b)) throw bad(`Bucket ${b} is in both ${bucketOwner.get(b)} and ${id}.`);
      bucketOwner.set(b, id);
    }
    const benchmarks = [...new Set((Array.isArray(raw?.benchmarks) ? raw.benchmarks : []).map(normalizeHandle))];
    if (benchmarks.length > MAX_BENCHMARKS_PER_TRACK) throw bad(`Track ${id}: at most ${MAX_BENCHMARKS_PER_TRACK} benchmarks.`);
    benchmarks.forEach((h) => distinct.add(h));
    const lists = normalizeLists(raw?.lists, id);
    lists.forEach((l) => distinctLists.add(l.id));
    const share = Number(raw?.share);
    if (!Number.isFinite(share) || share < 0 || share > 1) throw bad(`Track ${id} share must be 0–1.`);
    const topics = [...new Set((Array.isArray(raw?.topics) ? raw.topics : []).map((t) => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
    const promotions = normalizePromotions(raw?.promotions ?? [], engines);
    return { id, label, engines, buckets, benchmarks, lists, share, promotions, topics };
  });
  const missing = ENGINE_IDS.filter((e) => !engineOwner.has(e));
  if (missing.length) throw bad(`Every engine must belong to a track; missing: ${missing.join(', ')}.`);
  if (distinct.size > maxDistinctBenchmarks) throw bad(`At most ${maxDistinctBenchmarks} distinct benchmarks across tracks.`);
  if (distinctLists.size > MAX_DISTINCT_LISTS) throw bad(`At most ${MAX_DISTINCT_LISTS} distinct lists across tracks.`);
  const total = tracks.reduce((s, t) => s + t.share, 0);
  if (total <= 0) throw bad('Track shares must sum above 0.');
  if (Math.abs(total - 1) > SHARE_EPSILON) tracks.forEach((t) => { t.share = t.share / total; });
  return tracks;
}

/** Tracks from a plan doc or plan; absent or invalid ⇒ [] (no tracks). */
export function tracksOf(planOrDoc, opts) {
  const plan = planOrDoc?.plan && typeof planOrDoc.plan === 'object' ? planOrDoc.plan : planOrDoc;
  if (!Array.isArray(plan?.contentTracks)) return [];
  try {
    return normalizeContentTracks(plan.contentTracks, opts);
  } catch {
    return [];
  }
}

/** The track that owns an engine, or null. */
export function trackForEngine(tracks, engine) {
  return (tracks || []).find((t) => t.engines.includes(engine)) || null;
}

/** The bucket a package belongs to: its own `bucketId`, else its engine (default bucket ids equal engine ids). */
export function bucketOfPackage(pkg) {
  const own = String(pkg?.bucketId ?? '').trim();
  return BUCKET_ID_RE.test(own) ? own : resolveEngine(pkg);
}

/** The track that owns a package (or post): the track listing its bucket, else the track owning its engine, else null. */
export function trackForPackage(tracks, pkg) {
  const bucket = bucketOfPackage(pkg);
  return (tracks || []).find((t) => (t.buckets || []).includes(bucket)) || trackForEngine(tracks, resolveEngine(pkg));
}

/** All promotions across tracks, each tagged with its `trackId`. */
export function allPromotions(tracks) {
  return (tracks || []).flatMap((t) => t.promotions.map((p) => ({ ...p, trackId: t.id })));
}
