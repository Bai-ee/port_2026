// Content tracks — the shared contract for the multi-benchmark plan (docs/plans/CONTENT-TRACKS-PROMOTION-MASTER-PLAN.md §4.1).
// A track owns a set of content engines, its own benchmark handles, a share of authored originals and its
// promotions. Benchmarks are never averaged across tracks. `plan.benchmarkPrimary` still sets overall pace.
// Pure: no I/O. Other modules import this file and never redefine these shapes.

import { ENGINE_IDS } from '../x-content-inventory/engines.js';

export const MAX_TRACKS = 6;
export const MAX_BENCHMARKS_PER_TRACK = 3;
export const MAX_DISTINCT_BENCHMARKS = 8;
export const MAX_PROMOTIONS_PER_TRACK = 4;
const SHARE_EPSILON = 0.001;

/** @typedef {{id:string,label:string,engine:'ue'|'record'|'client'|'identity',url:string|null,weeklyTarget:number}} Promotion */
/** @typedef {{id:string,label:string,engines:string[],benchmarks:string[],share:number,promotions:Promotion[],topics:string[]}} ContentTrack */

export const DEFAULT_TRACKS = Object.freeze([
  Object.freeze({
    id: 'design', label: 'Design & client work', engines: Object.freeze(['client', 'identity']),
    benchmarks: Object.freeze(['seb__design']), share: 0.5, topics: Object.freeze([]),
    promotions: Object.freeze([Object.freeze({ id: 'client', label: 'Client work', engine: 'client', url: null, weeklyTarget: 2 })]),
  }),
  Object.freeze({
    id: 'music', label: 'Music (UE mixes, Discogs)', engines: Object.freeze(['ue', 'record']),
    benchmarks: Object.freeze([]), share: 0.5, topics: Object.freeze([]),
    promotions: Object.freeze([
      Object.freeze({ id: 'ue', label: 'Underground Existence', engine: 'ue', url: null, weeklyTarget: 3 }),
      Object.freeze({ id: 'discogs', label: 'Discogs store', engine: 'record', url: null, weeklyTarget: 3 }),
    ]),
  }),
]);

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function cloneDefaults() {
  return DEFAULT_TRACKS.map((t) => ({
    ...t, engines: [...t.engines], benchmarks: [...t.benchmarks], topics: [...t.topics],
    promotions: t.promotions.map((p) => ({ ...p })),
  }));
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

/**
 * Validate a full contentTracks list. Throws 400. Rules: 1..MAX_TRACKS tracks; unique ids; every engine in
 * exactly one track (disjoint + complete); ≤MAX_BENCHMARKS_PER_TRACK handles per track and
 * ≤`maxDistinctBenchmarks` distinct overall; shares ≥0 and normalized to sum 1.
 */
export function normalizeContentTracks(input, { maxDistinctBenchmarks = MAX_DISTINCT_BENCHMARKS } = {}) {
  if (!Array.isArray(input) || input.length === 0) throw bad('contentTracks must be a non-empty array.');
  if (input.length > MAX_TRACKS) throw bad(`At most ${MAX_TRACKS} tracks.`);
  const ids = new Set();
  const engineOwner = new Map();
  const distinct = new Set();
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
    const benchmarks = [...new Set((Array.isArray(raw?.benchmarks) ? raw.benchmarks : []).map(normalizeHandle))];
    if (benchmarks.length > MAX_BENCHMARKS_PER_TRACK) throw bad(`Track ${id}: at most ${MAX_BENCHMARKS_PER_TRACK} benchmarks.`);
    benchmarks.forEach((h) => distinct.add(h));
    const share = Number(raw?.share);
    if (!Number.isFinite(share) || share < 0 || share > 1) throw bad(`Track ${id} share must be 0–1.`);
    const topics = [...new Set((Array.isArray(raw?.topics) ? raw.topics : []).map((t) => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
    const promotions = normalizePromotions(raw?.promotions ?? [], engines);
    return { id, label, engines, benchmarks, share, promotions, topics };
  });
  const missing = ENGINE_IDS.filter((e) => !engineOwner.has(e));
  if (missing.length) throw bad(`Every engine must belong to a track; missing: ${missing.join(', ')}.`);
  if (distinct.size > maxDistinctBenchmarks) throw bad(`At most ${maxDistinctBenchmarks} distinct benchmarks across tracks.`);
  const total = tracks.reduce((s, t) => s + t.share, 0);
  if (total <= 0) throw bad('Track shares must sum above 0.');
  if (Math.abs(total - 1) > SHARE_EPSILON) tracks.forEach((t) => { t.share = t.share / total; });
  return tracks;
}

/** Tracks from a plan doc or plan; absent or invalid ⇒ the defaults (back-compat: old plans keep working). */
export function tracksOf(planOrDoc, opts) {
  const plan = planOrDoc?.plan && typeof planOrDoc.plan === 'object' ? planOrDoc.plan : planOrDoc;
  if (!Array.isArray(plan?.contentTracks)) return cloneDefaults();
  try {
    return normalizeContentTracks(plan.contentTracks, opts);
  } catch {
    return cloneDefaults();
  }
}

/** The track that owns an engine, or null. */
export function trackForEngine(tracks, engine) {
  return (tracks || []).find((t) => t.engines.includes(engine)) || null;
}

/** All promotions across tracks, each tagged with its `trackId`. */
export function allPromotions(tracks) {
  return (tracks || []).flatMap((t) => t.promotions.map((p) => ({ ...p, trackId: t.id })));
}
