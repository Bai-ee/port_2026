// Loop Studio <-> loopcore engine client (local Python service, port 8766 —
// see services/loopcore/README.md). All calls are best-effort: a down engine
// must degrade to manual mode, never break the browser-only workflow.
//
// Covers the full grid-editing round trip: `detectGrid` (upload + analyze),
// `updateGrid` (manual phase/offset/bpm correction), `sliceTrack`,
// `verifyLoops`, and `repairLoop`. Every sample offset/index returned by the
// engine (`offset_samples`, `start_sample`, `end_sample`, ...) is in the
// SOURCE file's sample rate, not the browser AudioContext's — convert before
// applying to a decoded AudioBuffer, which may be decoded at a different
// device rate. `repairLoop`'s `audio_url` (and any other engine-relative
// URL) must go through `engineUrl()` — or `fetchEngineAudioBuffer()`
// directly — before use; it is relative to the engine's own base URL, not
// the page's origin.

const BASE = 'http://127.0.0.1:8766';

async function readJson(res, label) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${label} failed (${res.status})`);
  return data;
}

/**
 * Upload a File to the engine and run full grid analysis on it.
 * Resolves to the engine's analysis payload: `bpm_final`, `bpm_candidates`
 * (ranked, with corroboration flags), `offset_samples` + `sample_rate`
 * (SOURCE rate — convert before applying to a browser AudioBuffer, which may
 * be decoded at a different device rate), `downbeat_grid` provenance,
 * `classification`, `warnings`.
 */
export async function detectGrid(file) {
  const upRes = await fetch(`${BASE}/api/upload?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    body: file,
  });
  const up = await readJson(upRes, 'engine upload');
  const anRes = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: up.path }),
  });
  const analysis = await readJson(anRes, 'engine analyze');
  analysis.uploaded = up;
  return analysis;
}

/**
 * List candidate source tracks the engine already knows about on disk
 * (`public/` + its own `inputs/` directory) — backs the Source card's
 * "known tracks" dropdown, which runs the engine flow directly (no upload)
 * when the engine is online.
 */
export async function listEngineTracks() {
  const res = await fetch(`${BASE}/api/tracks`);
  const data = await readJson(res, 'engine tracks');
  return Array.isArray(data.tracks) ? data.tracks : [];
}

/**
 * Analyze a track the engine already has on disk (an entry from
 * `listEngineTracks()`, or a path reused from a prior `detectGrid`), with
 * no upload step. Same response shape as `detectGrid`.
 */
export async function analyzeExisting(path) {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  return readJson(res, 'engine analyze');
}

/**
 * Best-effort engine reachability probe for the rail header's health dot —
 * resolves `true`/`false`, never rejects. A short timeout (`timeoutMs`,
 * default 1500) keeps a hung/offline engine from stalling the caller.
 */
export async function checkEngineHealth(timeoutMs = 1500) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${BASE}/api/tracks`, controller ? { signal: controller.signal } : undefined);
    return res.ok;
  } catch (err) {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Push a manual grid correction to the engine and get back the updated
 * analysis (same shape as `detectGrid`'s result). `bpmOverride` must be a
 * number in [20, 400] or `null`/omitted to restore the recorded
 * `bpm_detected` server-side.
 */
export async function updateGrid({ phaseOverride = null, offsetNudgeSamples = 0, bpmOverride = null, barsPerLoop }) {
  const res = await fetch(`${BASE}/api/update_grid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phase_override: phaseOverride,
      offset_nudge_samples: offsetNudgeSamples,
      bpm_override: bpmOverride,
      bars_per_loop: barsPerLoop,
    }),
  });
  return readJson(res, 'engine update_grid');
}

/**
 * Slice `path` (an engine-side path, from `detectGrid`'s upload) into
 * `barsPerLoop`-bar loops. Resolves to the manifest: `loops[]` with
 * `index`/`path`/`start_sample`/`end_sample`/`duration_seconds` — sample
 * boundaries are in the SOURCE sample rate, same caveat as `detectGrid`.
 * Each loop's `path` is an ABSOLUTE engine-side filesystem path to the WAV
 * the engine actually wrote (true source PCM, never resampled) — fetch it
 * via `engineUrl()`/`fetchEngineAudioBytes()`, same as `repairLoop`'s
 * `audio_url`.
 */
export async function sliceTrack(path, barsPerLoop) {
  const res = await fetch(`${BASE}/api/slice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, bars_per_loop: barsPerLoop }),
  });
  return readJson(res, 'engine slice');
}

/**
 * Verify loop-point quality by auditioning `selectLoop` repeated
 * `repeatCount` times. Resolves to the verification report: `loops[]` with
 * `index`, `verdict` (`'pass' | 'warn' | 'fail'`),
 * `end_to_start_jump_zscore`, `verdict_reasons[]`, `recommended_repair`, and
 * a `summary` of `{ total, pass, warn, fail }` counts.
 */
export async function verifyLoops(selectLoop = 0, repeatCount = 4) {
  const res = await fetch(`${BASE}/api/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ select_loop: selectLoop, repeat_count: repeatCount }),
  });
  return readJson(res, 'engine verify');
}

/**
 * Repair a flagged loop point with `strategy`
 * (`'zero_cross_snap' | 'microfade' | 'equal_power_crossfade' | 'silence_trim'`).
 * `opts` is spread into the request body as-is (e.g. `{ fade_ms, search_window }`).
 * Resolves to the engine's before/after scores plus `audio_url` — an
 * engine-relative URL; pass it through `engineUrl()` before fetching.
 */
export async function repairLoop(loopIndex, strategy, opts = {}) {
  const res = await fetch(`${BASE}/api/repair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loop_index: loopIndex, strategy, ...opts }),
  });
  return readJson(res, 'engine repair');
}

/**
 * Resolve either an engine-relative URL (one of the engine's OWN routes —
 * always prefixed `/api/...`, e.g. the `audio_url` from `repairLoop`/
 * `detectGrid`/`updateGrid`) or a bare engine-side file path (relative OR
 * absolute — e.g. a `sliceTrack` manifest loop's `path`, which the engine
 * always returns as an absolute filesystem path) into a full
 * `GET /api/audio` URL against `BASE`.
 *
 * Only an `/api/`-prefixed value is treated as an already-built route: an
 * absolute filesystem path also starts with `/` (e.g.
 * `/Users/you/repo/services/loopcore/outputs/loops/loop_0000.wav`) but is
 * NOT a route, so it must fall through to the `path=` query-param branch
 * below — appending it straight onto `BASE` would build a broken URL.
 */
export function engineUrl(relativeOrPath) {
  const value = String(relativeOrPath || '');
  if (value.startsWith('/api/')) return `${BASE}${value}`;
  return `${BASE}/api/audio?path=${encodeURIComponent(value)}`;
}

/**
 * Fetch engine-hosted audio (a relative `audio_url` or a bare path) and
 * decode it into an AudioBuffer via the caller's AudioContext.
 */
export async function fetchEngineAudioBuffer(relativeOrPath, audioCtx) {
  const res = await fetch(engineUrl(relativeOrPath));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `engine audio fetch failed (${res.status})`);
  }
  return audioCtx.decodeAudioData(await res.arrayBuffer());
}

/**
 * Fetch engine-hosted audio bytes AS-IS (a relative `audio_url`, or a bare
 * engine-side file path such as a `sliceTrack` manifest loop's `path`) —
 * no `decodeAudioData` involved, so this returns the engine's own PCM WAV
 * bytes untouched. Used by the "download the engine's verified cut instead
 * of re-encoding the browser's decoded floats" export path.
 */
export async function fetchEngineAudioBytes(relativeOrPath) {
  const res = await fetch(engineUrl(relativeOrPath));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `engine audio fetch failed (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** True when an error means "engine not running", not a real analysis failure. */
export function isEngineOffline(err) {
  return err instanceof TypeError
    || /failed to fetch|networkerror|load failed/i.test(String(err?.message || err));
}
