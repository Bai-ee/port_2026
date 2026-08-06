// art-render.mjs — Slice 4c (Studio Roadmap). Orchestrates a LOCAL, fixed-
// timestep render of one art-scene-v2 recipe: serves art-scene.mjs's
// generated HTML on 127.0.0.1 (no external network), drives it with
// Playwright headless Chromium (no GPU requirement — same software-WebGL
// path Slice 4b's spike already proved deterministic), warms up the
// renderer, captures N frames as real PNG files, encodes them with the
// LOCAL `ffmpeg` binary (H.264 MP4 + a JPEG poster), and validates the
// output with the LOCAL `ffprobe` binary before returning. No Cloud Run, no
// GPU cloud infra, no API route, no job queue, no persistence beyond local
// disk, no billing.
//
// Does not import, and does not modify, recipe.mjs/scene.mjs/render.mjs/
// server.mjs (the live Video Promo pipeline) — see art-scene.mjs's own
// header comment for why this uses Playwright rather than that pipeline's
// raw-CDP mechanism.

import { createServer } from 'node:http';
import { readFile, mkdtemp, cp, rm, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildSceneHtml } from './art-scene.mjs';
import { ArtRenderError, checkCapabilities, validateSceneDimensions, validateRenderParams, LIMITS, isValidHttpUrl } from './art-render-validation.mjs';
import { resolveEffectiveScene, sceneAssetRequirements, resolveFrameRender } from './art-scene-def.mjs';
// Live website frames on the device screen (STUDIO-DETERMINISTIC-FINAL-
// RENDER-SONNET-HANDOFF.md checkpoint) — reuses render.mjs's own proven
// probe/readiness/screencast capture logic (moved to this shared module,
// not reinvented — see that module's own header) to capture a REAL
// scrolling frame sequence for a device scene whose devicePrimary carries a
// live URL. Never Browserless — Playwright's own Chromium, same as every
// other browser this file already launches.
// "Live capture GPU acceleration" checkpoint — chromeGpuLaunchArgs gives the
// capture browser below the SAME GPU-enabling flags render.mjs's own proven
// spawnChrome has always used (see live-site-capture.mjs's own header on
// that function for why: a WebGL-hero live target renders on SwiftShader/
// llvmpipe SOFTWARE WebGL, and is measurably impractical to capture, unless
// explicitly told to use a real GPU backend).
import { captureDeviceLiveFrames as captureDeviceLiveFramesReal, chromeGpuLaunchArgs } from './live-site-capture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THREE_MODULE_SRC = path.resolve(__dirname, '../../node_modules/three/build/three.module.min.js');
// The official three.js examples/jsm addons (Phase 5, environment/IBL
// parity) — see art-scene.mjs's own comment on its RoomEnvironment/
// RGBELoader imports for why these two specific files (not three-stdlib).
const THREE_ROOM_ENVIRONMENT_SRC = path.resolve(__dirname, '../../node_modules/three/examples/jsm/environments/RoomEnvironment.js');
const THREE_RGBE_LOADER_SRC = path.resolve(__dirname, '../../node_modules/three/examples/jsm/loaders/RGBELoader.js');
// BufferGeometryUtils (glass-petal-sphere parity — mergeVertices welds the
// petal geometry's UV-seam vertices): same official-examples pattern; its
// single import is bare 'three', resolved by the page's importmap.
const THREE_BUFFER_GEOMETRY_UTILS_SRC = path.resolve(__dirname, '../../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js');
// RoundedBoxGeometry (Slice F1, device shell — the vendored device factory
// destructures it from ctx.stdlib): same official-examples pattern, imports
// only bare 'three'.
const THREE_ROUNDED_BOX_GEOMETRY_SRC = path.resolve(__dirname, '../../node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js');
// EffectComposer/RenderPass/ShaderPass + their own Pass/MaskPass/CopyShader
// internals (Phase B, Diffusion Camera server parity) — the exact official
// three.js examples/jsm postprocessing addons ClothStudio.jsx's own
// composer chain uses, not a reimplementation. Unlike the single-file
// addons above, these import EACH OTHER via relative paths
// (EffectComposer.js -> '../shaders/CopyShader.js' and './ShaderPass.js';
// ShaderPass.js -> './Pass.js'; RenderPass.js -> './Pass.js') — copied
// preserving the SAME postprocessing/ + shaders/ directory structure
// examples/jsm itself uses (see copyEnvironmentAssets below), so every
// relative import resolves unmodified; never flattened + rewritten. Every
// one of these six files' own imports resolve to bare 'three' or a sibling
// file in this same small closure — nothing reaches further into
// three-stdlib or three's own broader examples tree.
const THREE_POSTPROCESSING_DIR = path.resolve(__dirname, '../../node_modules/three/examples/jsm/postprocessing');
const THREE_SHADERS_DIR = path.resolve(__dirname, '../../node_modules/three/examples/jsm/shaders');
const THREE_EFFECT_COMPOSER_FILES = ['EffectComposer.js', 'RenderPass.js', 'ShaderPass.js', 'Pass.js', 'MaskPass.js'];

// Both allowlisted artworkId values (art-recipe.mjs's BUILTIN_ARTWORK_IDS),
// resolved to the REAL shipped files ClothStudio.jsx itself loads
// (BUILTIN_ARTWORKS' own `url` field) — never a placeholder/synthetic image.
// Local disk only; copied into each render's own temp serving directory
// (see renderArtScene) so loading stays 127.0.0.1-only and deterministic.
//
// Sourced from services/studio-render/assets/artwork/ (a committed copy of
// the real public/img/ files), NOT public/img/ directly — fast-follow fix
// (STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md, post-Environment/
// IBL-parity review): this previously reached `../../public/img/...`,
// unreachable from a `--source .` Dockerfile.proof build the exact same way
// BUILTIN_ENV_HDR_ASSETS did before its own Phase 5 fix — see that
// constant's comment for the full packaging-boundary reasoning (identical
// here). __tests__/container-paths.test.mjs is the regression guard that
// now catches a future reintroduction of this exact class of bug.
const BUILTIN_ARTWORK_ASSETS = {
  brock: path.resolve(__dirname, 'assets/artwork/holocloth-artwork-flyer-2.jpg'),
  'viva-program': path.resolve(__dirname, 'assets/artwork/holocloth-default-artwork.jpg'),
};

// The 4 real-HDR environment presets (Phase 5) — verbatim ClothStudio.jsx
// ENV_PRESETS' own file choice (the 1k variant, not the 2k set the separate
// scene-background/pano system under SCENE_PRESETS uses — two genuinely
// different features that happen to share the same source HDR shoots; see
// art-scene.mjs's ENV_HDR_URLS for the matching filename map). 'room' has
// no entry — the built-in procedural RoomEnvironment needs no file at all.
//
// Sourced from services/studio-render/assets/hdr/ (a committed copy of the
// real public/hdr/ files), NOT public/hdr/ directly — same packaging
// boundary every other cross-directory dependency in this service already
// respects (`--source .` builds from ONLY this directory; see
// scripts/vendor-elements.mjs's own header comment for the full reasoning).
// Plain committed binary copies, not a "vendor script + drift test" pair
// like the source-code closures — these are static assets with one
// canonical source that doesn't get hand-edited, so there's no drift to
// guard against.
//
// A `Map`, not a plain object literal (fast-follow hardening, post-
// Environment/IBL-parity review — "confirm each envId resolves only to its
// allowlisted local HDR asset"): `envId` is already strictly enum-validated
// upstream (art-recipe.mjs's `pickEnum(r.envId, ENV_PRESET_IDS, 'room')`)
// before it ever reaches this file, so a plain `{}[envId]` lookup was never
// actually exploitable in practice — but it WAS a real footgun on its own
// terms: `{}['__proto__']`/`{}['constructor']`/`{}['toString']` all resolve
// to a real (truthy) Object.prototype value via the prototype chain, not
// `undefined`, which would have silently defeated the `if (!hdrSrc) return`
// fallback below for those exact keys. `Map#get` has no prototype-chain
// lookup at all — an absent key is ALWAYS `undefined`, full stop — so this
// is airtight independent of whatever validation happens to exist upstream.
const BUILTIN_ENV_HDR_ASSETS = new Map([
  ['sunset', path.resolve(__dirname, 'assets/hdr/venice_sunset_1k.hdr')],
  ['dusk', path.resolve(__dirname, 'assets/hdr/qwantani_dusk_2_1k.hdr')],
  ['hall', path.resolve(__dirname, 'assets/hdr/dancing_hall_1k.hdr')],
  ['night', path.resolve(__dirname, 'assets/hdr/moonless_golf_1k.hdr')],
]);

const CONTENT_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.hdr': 'image/vnd.radiance', '.webp': 'image/webp' };

// Scene-background assets (Slice B/C) — this service's committed mirror of
// the exact Studio files (public/{hdr,env,tex} → assets/{hdr,env,tex}; the
// scene-presets-vendor test proves every referenceable pano/ground file
// exists here). Resolution goes through sceneAssetRequirements' allowlist
// (SCENE_PANO_IDS / GROUND_TEXTURES), so an arbitrary path can never reach
// this join.
const SCENE_ASSETS_ROOT = path.resolve(__dirname, 'assets');

/**
 * Copies exactly the pano/ground-texture files THIS recipe's composed
 * effective scene needs into the render's serving dir — never all of them
 * (the mirror is ~100MB; one scene needs at most one pano + two tex files).
 * No-op for every non-'scene' bgMode.
 */
async function copySceneBackgroundAssets(recipe, workDir) {
  if (recipe?.bgMode !== 'scene') return;
  const requirements = sceneAssetRequirements(resolveEffectiveScene(recipe));
  const copies = [];
  if (requirements.pano) {
    const src = path.join(SCENE_ASSETS_ROOT, requirements.pano.replace(/^\//, ''));
    copies.push(cp(src, path.join(workDir, path.basename(src))));
  }
  if (requirements.groundTex) {
    for (const file of [requirements.groundTex.map, requirements.groundTex.rough]) {
      const src = path.join(SCENE_ASSETS_ROOT, file.replace(/^\//, ''));
      copies.push(cp(src, path.join(workDir, path.basename(src))));
    }
  }
  await Promise.all(copies);
}

/**
 * Copies the fixed RoomEnvironment.js/RGBELoader.js pair (always — tiny,
 * and 'room' itself needs RoomEnvironment.js) plus, ONLY when this recipe's
 * envIntensity is genuinely non-zero AND envId resolves to a real HDR
 * (BUILTIN_ENV_HDR_ASSETS), that ONE matching .hdr file — never all four,
 * never one that can't possibly be visible (envIntensity:0) — and every
 * OTHER fixed (per-recipe-invariant) addon/vendored file the generated page
 * always statically imports regardless of recipe content: BufferGeometryUtils,
 * RoundedBoxGeometry, the vendored elements/ closure, diffusion-focus.js,
 * timeline.js (Phase C correction), and the EffectComposer/RenderPass/
 * ShaderPass postprocessing/shaders closure (Phase B). Shared by both
 * renderArtScene and inspectScene
 * (buildSceneHtml's generated page always imports every one of these
 * regardless of which branch it ends up using — RoomEnvironment.js has no
 * per-recipe variance and skipping its copy would be a needless special
 * case for a ~1KB file; the same reasoning now covers the composer addons).
 */
async function copyEnvironmentAssets(recipe, workDir) {
  await Promise.all([
    cp(THREE_ROOM_ENVIRONMENT_SRC, path.join(workDir, 'RoomEnvironment.js')),
    cp(THREE_RGBE_LOADER_SRC, path.join(workDir, 'RGBELoader.js')),
    // Always copied (tiny), like RoomEnvironment.js — the page imports it
    // statically regardless of whether this recipe's glass is on.
    cp(THREE_BUFFER_GEOMETRY_UTILS_SRC, path.join(workDir, 'BufferGeometryUtils.js')),
    cp(THREE_ROUNDED_BOX_GEOMETRY_SRC, path.join(workDir, 'RoundedBoxGeometry.js')),
    // The vendored elements closure (Slice E) — the page statically imports
    // the hanging-tshirt factory/mapping/sim from ./elements/ regardless of
    // clothShape (14 small pure-ESM files; relative imports resolve within
    // the copied dir, THREE arrives via the factory ctx, never a bare
    // 'three' import).
    cp(path.resolve(__dirname, 'vendor/elements'), path.join(workDir, 'elements'), { recursive: true }),
    // Diffusion Camera (Phase B) — the vendored, zero-import, pure
    // diffusion-focus.js (focal-target resolution + CoC/blur math), always
    // copied (tiny) like RoomEnvironment.js; the page statically imports it
    // regardless of whether THIS recipe's diffusionCamera is enabled (same
    // "always import, conditionally construct/use" discipline the composer
    // block itself follows — see art-scene.mjs).
    cp(path.resolve(__dirname, 'vendor/diffusion-focus.js'), path.join(workDir, 'diffusion-focus.js')),
    // Timeline (Phase C correction, "exact smoothstep-eased parity") — the
    // vendored, zero-import, pure timeline.js (straddling-pair keyframe
    // resolver — resolveTrackState), always copied (tiny) like
    // diffusion-focus.js above; the page statically imports it regardless
    // of whether THIS recipe carries an active timeline (same "always
    // import, conditionally use" discipline). See scripts/vendor-timeline.mjs.
    cp(path.resolve(__dirname, 'vendor/timeline.js'), path.join(workDir, 'timeline.js')),
    // EffectComposer/RenderPass/ShaderPass + Pass/MaskPass internals, and
    // CopyShader (EffectComposer's own internal copy-pass shader) — see
    // THREE_POSTPROCESSING_DIR's own header comment for why the
    // postprocessing/+shaders/ directory split is preserved rather than
    // flattened. Always copied (tiny, six small files), like every other
    // addon above.
    ...THREE_EFFECT_COMPOSER_FILES.map((file) => cp(
      path.join(THREE_POSTPROCESSING_DIR, file),
      path.join(workDir, 'postprocessing', file),
    )),
    cp(path.join(THREE_SHADERS_DIR, 'CopyShader.js'), path.join(workDir, 'shaders', 'CopyShader.js')),
  ]);
  if (recipe?.envIntensity === 0) return;
  const hdrSrc = BUILTIN_ENV_HDR_ASSETS.get(recipe?.envId);
  if (!hdrSrc) return; // 'room' (or an already-normalized-safe unrecognized id) — no file needed
  await cp(hdrSrc, path.join(workDir, path.basename(hdrSrc)));
}

// checkCapabilities/validateRenderParams/validateSceneDimensions/LIMITS/
// ArtRenderError now live in art-render-validation.mjs (Slice 4d extraction)
// — a pure module with no Playwright/fs/child_process dependency, so
// app/api/dashboard/proof-render/route.js can import the SAME validation
// logic without bundling Playwright into a Vercel function. Re-exported
// below so every existing import from THIS file keeps working unchanged.

async function startLocalStaticServer(rootDir) {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = new URL(req.url, 'http://127.0.0.1').pathname;
      const filePath = path.join(rootDir, decodeURIComponent(urlPath));
      if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

// ── Server-owned process-lifecycle timeouts (Slice 4f) ─────────────────────
// Bounds every local ffmpeg/ffprobe subprocess this module spawns. NOT
// derived from, or settable by, any caller/request input — width/height/fps/
// durationSeconds/warmupFrames are bounded separately by this module's own
// LIMITS (art-render-validation.mjs); a caller can request a smaller or
// larger RENDER within those bounds, but never a longer SUBPROCESS TIMEOUT.
// Two separate, documented budgets, sized to the actual work each binary does:
//  - ffmpeg (encode): real work that scales with frame count/resolution —
//    sized generously enough to cover the LARGEST render this pass allows
//    (LIMITS.MAX_TOTAL_FRAMES=900 frames at up to
//    LIMITS.MAX_DIMENSION=1920px) on ordinary local hardware, while still
//    killing a genuinely hung encode rather than blocking forever.
//  - ffprobe: only inspects an already-encoded local file — a healthy call
//    finishes in well under a second regardless of render size, so this
//    budget is much tighter and independent of the render's own size.
const FFMPEG_TIMEOUT_MS = 180_000;
const FFPROBE_TIMEOUT_MS = 30_000;
// Grace window between SIGTERM and SIGKILL — long enough for a well-behaved
// ffmpeg/ffprobe process to flush and exit on its own signal handler, short
// enough that a genuinely stuck process is force-killed promptly.
const KILL_GRACE_MS = 5_000;
// Codex re-review (Slice 4f, P1): SIGKILL cannot itself be caught or
// ignored, but this code must never CLAIM a process is dead without
// observing its own 'close' event — a signal-delivery delay, kernel
// scheduling, or (rarely) a process stuck in uninterruptible I/O could all
// mean 'close' hasn't fired yet even after SIGKILL. This is the short,
// server-owned deadline for that confirmation: if 'close' arrives within
// this window after SIGKILL, termination is CONFIRMED; if not, the promise
// still settles (reject) rather than hang forever, but honestly reports
// termination as UNCONFIRMED instead of claiming a kill that was never
// actually observed.
const REAP_CONFIRM_MS = 5_000;
// Per-stream captured stdout/stderr cap, so a noisy or runaway process can
// never grow this promise's memory without limit. A TRUE byte cap (Codex
// re-review, P2) — chunks are accumulated as raw Buffers and trimmed to the
// TAIL by actual byte length, never by JS string .length (which counts
// UTF-16 code units, not bytes, and would under-count multi-byte UTF-8
// output). Decoded to a UTF-8 string only once, at settlement time (see
// finalizeCaptured) — matching this repo's existing convention in
// services/studio-render/server.mjs's own ffmpeg error handling
// (`stderr.slice(-400)`): ffmpeg/ffprobe put the actionable error message at
// the END of stderr, so keeping the tail is more likely to preserve it.
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;

function toBuffer(chunk) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

/**
 * Appends `chunk` (a Buffer) to `chunks`, trimming from the FRONT (oldest
 * bytes first) whenever the running total exceeds `capBytes`, so the
 * accumulated bytes always represent the most recent (TAIL) output. Returns
 * the updated `[chunks, totalBytes]` pair — `chunks[0]` may end up partially
 * sliced (or fully dropped), never mutated beyond that.
 */
function appendBoundedBuffer(chunks, totalBytes, chunk, capBytes) {
  chunks.push(chunk);
  totalBytes += chunk.length;
  while (totalBytes > capBytes && chunks.length) {
    const first = chunks[0];
    const excess = totalBytes - capBytes;
    if (first.length <= excess) {
      chunks.shift();
      totalBytes -= first.length;
    } else {
      chunks[0] = first.subarray(excess);
      totalBytes -= excess;
    }
  }
  return [chunks, totalBytes];
}

/**
 * Decodes the accumulated (already byte-bounded) Buffer chunks to a UTF-8
 * string, then defensively re-checks the RESULT's own byte length —
 * byte-level truncation can occasionally land mid-multi-byte-character,
 * which Node's UTF-8 decoder replaces with U+FFFD (3 bytes); in the rare
 * case that expansion pushes the decoded string's byte length back over
 * `capBytes`, leading characters (not bytes — this is now a valid JS
 * string) are trimmed until it's genuinely back under the cap. Guarantees
 * `Buffer.byteLength(result, 'utf8') <= capBytes` unconditionally.
 */
function finalizeCaptured(chunks, capBytes) {
  let str = Buffer.concat(chunks).toString('utf8');
  while (str.length && Buffer.byteLength(str, 'utf8') > capBytes) {
    str = str.slice(1);
  }
  return str;
}

/**
 * Sends `signal` to `child`, tolerating both a `false` return (Node's
 * documented "the signal could not be delivered" outcome) and a thrown
 * error (e.g. ESRCH), rather than assuming success either way (Codex
 * re-review, Slice 4f P1). Neither outcome is treated as proof of
 * anything — only an observed `'close'` event (or the reap deadline
 * elapsing) determines what actually happened; this is purely a
 * diagnostic label carried in the eventual error's `details`.
 */
function attemptKill(child, signal) {
  try {
    const delivered = child.kill(signal);
    return delivered === false ? `${signal}-not-delivered` : `${signal}-sent`;
  } catch (err) {
    return `${signal}-threw:${err?.message || err}`;
  }
}

// ── Async (non-blocking) local binary execution with a bounded, CONFIRMED
// lifecycle (Codex re-review round 3, P1; timeout/kill policy added Slice
// 4f; termination-confirmation + true byte cap added in Slice 4f re-review)
// ───────────────────────────────────────────────────────────────────────────
// Previously used spawnSync, which BLOCKS THE ENTIRE NODE EVENT LOOP until
// ffmpeg/ffprobe exit — including any setInterval-based heartbeat trying to
// renew the render's lease (services/studio-render/proof-render-worker.mjs)
// while encoding/probing was in progress. Converted to an async `spawn()` so
// the event loop — and any interval timers — keep running while the child
// process does its work.
//
// Slice 4f adds the timeout/kill policy the Slice 4d checkpoint's own "known
// limitations" section flagged as required before any live Cloud Run
// deployment. A Codex re-review of the first Slice 4f pass found that
// sending SIGKILL and immediately settling does NOT actually confirm the
// process died — this version never does that. The full escalation:
//
//   1. `timeoutMs` elapses with no natural exit → SIGTERM sent, `timedOut`
//      set. If `'close'` arrives within `killGraceMs`, that IS confirmed
//      exit (a signal-terminated process still emits `'close'`) — settle
//      (reject) here; SIGKILL is never sent.
//   2. `killGraceMs` elapses with still no `'close'` → SIGKILL sent,
//      `killSent` set. The `'close'` listener STAYS ATTACHED (a prior
//      version detached it here — fixed per Codex re-review). If `'close'`
//      arrives within `reapConfirmMs`, exit is CONFIRMED — settle (reject)
//      with `terminationConfirmed:true`.
//   3. `reapConfirmMs` elapses with STILL no `'close'` → settle (reject)
//      with an explicit `terminationConfirmed:false` "unconfirmed" error.
//      This never claims the process was killed — only that this code gave
//      up waiting for proof.
//
// A `child.on('error', ...)` firing anywhere inside steps 1–3 (`timedOut`
// already true) deliberately does NOT settle the promise — an 'error' event
// does not prove the process is dead, and letting it short-circuit would
// abandon the escalation with the process potentially still alive (Codex
// re-review requirement). `attemptKill` never assumes a `kill()` call
// succeeded (handles both a `false` return and a thrown error) — the
// escalation proceeds identically either way, since neither outcome is
// trustworthy proof on its own.
//
// Exactly one of {spawn error, a pre-timeout process `'error'`, a natural/
// SIGTERM/SIGKILL-confirmed `'close'`, the post-SIGKILL reap-deadline
// "unconfirmed" rejection} ever settles this promise — the `settled` guard
// makes every other path a no-op, and `clearTimers`/`detachListeners` run on
// every settlement so no timer or listener ever outlives it.
function runLocalBinaryImpl(cmd, args, kind, signal) {
  const timeoutMs = _internals.PROCESS_TIMEOUTS_MS[kind] ?? _internals.PROCESS_TIMEOUTS_MS.ffmpeg;
  const killGraceMs = _internals.KILL_GRACE_MS;
  const reapConfirmMs = _internals.REAP_CONFIRM_MS;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ArtRenderError(`${cmd} aborted before starting.`, { aborted: true }));
      return;
    }

    let child;
    try {
      child = _internals.spawn(cmd, args);
    } catch (err) {
      reject(new ArtRenderError(`${cmd} failed to start: ${err.message}`));
      return;
    }

    let stdoutChunks = [];
    let stdoutBytes = 0;
    let stderrChunks = [];
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let escalating = false;
    let killSent = false;
    let sigtermOutcome = null;
    let sigkillOutcome = null;
    let timeoutTimer = null;
    let killTimer = null;
    let reapTimer = null;

    const capturedStdout = () => finalizeCaptured(stdoutChunks, MAX_CAPTURED_OUTPUT_BYTES);
    const capturedStderr = () => finalizeCaptured(stderrChunks, MAX_CAPTURED_OUTPUT_BYTES);

    const clearTimers = () => {
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      if (killTimer) { clearTimeout(killTimer); killTimer = null; }
      if (reapTimer) { clearTimeout(reapTimer); reapTimer = null; }
    };
    const detachListeners = () => {
      child.stdout?.removeListener?.('data', onStdout);
      child.stderr?.removeListener?.('data', onStderr);
      child.removeListener?.('error', onError);
      child.removeListener?.('close', onClose);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimers();
      detachListeners();
      fn(value);
    };

    function onStdout(chunk) { [stdoutChunks, stdoutBytes] = appendBoundedBuffer(stdoutChunks, stdoutBytes, toBuffer(chunk), MAX_CAPTURED_OUTPUT_BYTES); }
    function onStderr(chunk) { [stderrChunks, stderrBytes] = appendBoundedBuffer(stderrChunks, stderrBytes, toBuffer(chunk), MAX_CAPTURED_OUTPUT_BYTES); }

    function onError(err) {
      // Once the timeout escalation has begun, an 'error' event does not
      // prove the process is dead — never let it preempt SIGTERM/SIGKILL/
      // reap-deadline confirmation (Codex re-review, Slice 4f P1).
      if (timedOut) return;
      settle(reject, new ArtRenderError(`${cmd} failed to start: ${err.message}`));
    }

    function onClose(code, closeSignal) {
      if (timedOut) {
        // A 'close' event during the timeout escalation IS genuine
        // confirmation the process exited. But (Codex re-review, Slice 4f
        // P2) attributing that exit to "SIGTERM"/"SIGKILL" purely because
        // THIS code attempted those signals can be FALSE: attemptKill's
        // outcome doesn't prove delivery, and the process may have exited
        // naturally (or for an unrelated reason) around the same time.
        // Only the OBSERVED `closeSignal` Node itself reports on 'close' may
        // be attributed — anything else (including a natural exit with
        // signal:null) is reported honestly as "not attributable," never
        // guessed from which kill() calls this code happened to attempt.
        const attributedSignal = (closeSignal === 'SIGTERM' || closeSignal === 'SIGKILL') ? closeSignal : null;
        const details = {
          stderr: capturedStderr(),
          timedOut: true,
          terminationConfirmed: true,
          terminationSignal: closeSignal || null,
          exitCode: code ?? null,
          sigkillAttempted: killSent,
          sigtermOutcome,
          sigkillOutcome,
          forceKilled: attributedSignal === 'SIGKILL',
        };
        const message = attributedSignal
          ? `${cmd} timed out after ${timeoutMs}ms and was terminated by ${attributedSignal} — exit confirmed (code=${code ?? 'null'}, signal=${attributedSignal}).`
          : `${cmd} timed out after ${timeoutMs}ms; the process exited during the timeout/kill escalation (code=${code ?? 'null'}, signal=${closeSignal || 'none'}) — exit confirmed, but not attributable to a signal this code sent.`;
        settle(reject, new ArtRenderError(message, details));
        return;
      }
      if (code !== 0) {
        settle(reject, new ArtRenderError(`${cmd} exited with status ${code}`, { stderr: capturedStderr() }));
        return;
      }
      settle(resolve, capturedStdout());
    }

    // Shared SIGTERM→grace→SIGKILL→reap-confirm escalation — triggerable by
    // EITHER the internal per-`kind` timeout OR an external `signal` abort
    // (Slice 4f Phase B: cooperative cancellation from a total render/job
    // deadline the caller owns, e.g. proof-render-worker.mjs's
    // TOTAL_RENDER_DEADLINE_MS). `escalating` guards double-entry if both
    // fire close together — whichever reaches here first runs the escalation
    // exactly once; every step inside is still `settled`-guarded exactly as
    // before, so an external abort composes with the existing kill lifecycle
    // instead of duplicating or racing it.
    function beginEscalation() {
      if (settled || escalating) return;
      escalating = true;
      timedOut = true;
      sigtermOutcome = attemptKill(child, 'SIGTERM');
      killTimer = setTimeout(() => {
        if (settled) return;
        killSent = true;
        sigkillOutcome = attemptKill(child, 'SIGKILL');
        reapTimer = setTimeout(() => {
          if (settled) return;
          // Never set forceKilled:true here — SIGKILL was attempted, but
          // with no 'close' event ever observed, nothing confirms it
          // actually took effect (that's precisely what "unconfirmed"
          // means). sigkillAttempted carries the "we tried" fact instead.
          settle(reject, new ArtRenderError(
            `${cmd} termination unconfirmed: SIGKILL was sent ${reapConfirmMs}ms ago but no 'close' event has been observed. The process may still be running.`,
            {
              stderr: capturedStderr(), timedOut: true, forceKilled: false, terminationConfirmed: false,
              terminationSignal: null, exitCode: null, sigkillAttempted: true, sigtermOutcome, sigkillOutcome,
            },
          ));
        }, reapConfirmMs);
      }, killGraceMs);
    }

    function onAbort() { beginEscalation(); }

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.on('error', onError);
    child.on('close', onClose);
    signal?.addEventListener?.('abort', onAbort);

    timeoutTimer = setTimeout(beginEscalation, timeoutMs);
  });
}

// DI seam. `spawn` is the narrow seam UNDER `runLocalBinary` — lets a test
// inject a fully controllable fake child process (to prove the SIGTERM→
// SIGKILL→reap-confirmation escalation, byte-cap, and single-settlement
// behavior deterministically, without needing a real hung ffmpeg/ffprobe
// process). `runLocalBinary` is the existing, WIDER seam (unchanged shape —
// still `(cmd, args) => ...`) — lets a test wrap the REAL implementation
// with an artificial delay (proving the heartbeat keeps firing while this
// call is pending) without faking away ffmpeg/ffprobe themselves; a caller
// that overrides only `runLocalBinary` and forwards just `(cmd, args)` keeps
// working unchanged — `kind` simply defaults to the `ffmpeg` budget inside
// `runLocalBinaryImpl` when omitted. `PROCESS_TIMEOUTS_MS`/`KILL_GRACE_MS`/
// `REAP_CONFIRM_MS` are test-only overrides of the server-owned constants
// above (mutated only by tests that need to shrink them so a timeout test
// doesn't take minutes) — nothing in the production request/job path (the
// API route body, a job's renderParams) can reach or influence these; only
// this in-process test seam can. Production code always goes through
// `runLocalBinaryImpl` directly.
// Pure (no browser/network) — the exact launch args the live-capture browser
// gets, built from the shared chromeGpuLaunchArgs() plus the two flags that
// stay explicit/unconditional on every platform (see the DI seam's own
// comment below for the full rationale). Factored out to module scope so a
// test can assert on the real, production args array directly (`_internals.
// liveCaptureLaunchArgs()`) without needing to intercept `chromium.launch`
// itself.
function liveCaptureLaunchArgs() {
  return Array.from(new Set([...chromeGpuLaunchArgs(), '--no-sandbox', '--disable-dev-shm-usage']));
}

export const _internals = {
  spawn: (cmd, args) => spawn(cmd, args),
  runLocalBinary: (cmd, args, kind, signal) => runLocalBinaryImpl(cmd, args, kind, signal),
  PROCESS_TIMEOUTS_MS: { ffmpeg: FFMPEG_TIMEOUT_MS, ffprobe: FFPROBE_TIMEOUT_MS },
  KILL_GRACE_MS,
  REAP_CONFIRM_MS,
  // Live website frames (device-screen-live) — DI seam, same shape/purpose
  // as `spawn`/`runLocalBinary` above: production always goes through the
  // real Playwright-driven capture; a test replaces this with a fake that
  // returns synthetic frames and never touches the network (see
  // art-render.test.mjs's "device-screen-live" render tests).
  //
  // "Live capture GPU acceleration" checkpoint: this is a DEDICATED browser
  // instance (never shared with the deterministic THREE.js scene render
  // below — see `chromium.launch` further down in `renderArtScene`/
  // `inspectScene`, both untouched by this change) launched with the SAME
  // GPU-enabling flags (chromeGpuLaunchArgs) render.mjs's own proven
  // spawnChrome has always used. `executablePath`/`CHROME_PATH` unchanged —
  // locally (CHROME_PATH unset) this launches Playwright's OWN bundled
  // "Chrome for Testing" binary (a full browser build, not the software-only
  // `chrome-headless-shell`), which was independently verified to expose a
  // real Metal/Vulkan/GL backend once these flags are present (see the
  // checkpoint's own GPU-probe evidence). In the deployed Proof/Final
  // Render container (Dockerfile.proof, CHROME_PATH=/usr/bin/chromium) this
  // launches the apt-installed system Chromium instead — see that
  // Dockerfile's own header comment (CPU-only by design, no GPU driver/lib
  // injection) for the deployment implication these flags do NOT change:
  // without real GPU hardware/drivers present in that container, Chromium's
  // own GPU-process init fails closed and it falls back to software,
  // exactly as before. `--no-sandbox`/`--disable-dev-shm-usage` stay
  // explicit (unconditional, every platform) — they're load-bearing for the
  // root-user container regardless of the GPU/ANGLE backend the platform-
  // conditional flags above choose; deduped via Set since the non-darwin
  // ANGLE branch already includes its own `--no-sandbox`.
  captureDeviceLiveFrames: (opts) => captureDeviceLiveFramesReal({
    ...opts,
    launchChromium: () => chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || undefined,
      args: liveCaptureLaunchArgs(),
    }),
  }),
  // Test-only seam (same pattern as PROCESS_TIMEOUTS_MS above) — lets a test
  // assert the real production launch args directly.
  liveCaptureLaunchArgs,
};

/**
 * Encodes `frameDir`'s `frame-%04d.png` sequence into an H.264 MP4
 * (CRF 18, yuv420p, +faststart — matches the SSOT plan's own encode spec)
 * plus a JPEG poster from the first frame. Local `ffmpeg` only. An optional
 * `signal` (Slice 4f Phase B cooperative cancellation) is threaded straight
 * into `runLocalBinary`, which reuses the SAME SIGTERM→grace→SIGKILL→
 * reap-confirm escalation an internal per-call timeout would trigger.
 *
 * `-color_primaries/-color_trc/-colorspace bt709` tag the stream as the SDR
 * color space every browser preview already renders in — without them, HD
 * (≥720-line) output has no color metadata at all, and some players guess
 * BT.601 instead, shifting color versus the browser preview. Container-level
 * metadata only: it does not touch pixel data, resolution, fps, duration, or
 * frame count, so `validateWithFfprobe`'s existing width/height/fps/codec/
 * nb_frames/duration checks are unaffected.
 */
async function encodeWithFfmpeg({ frameDir, fps, mp4Path, posterPath, signal }) {
  await _internals.runLocalBinary('ffmpeg', [
    '-y', '-framerate', String(fps), '-i', path.join(frameDir, 'frame-%04d.png'),
    '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-movflags', '+faststart',
    mp4Path,
  ], 'ffmpeg', signal);
  await _internals.runLocalBinary('ffmpeg', ['-y', '-i', path.join(frameDir, 'frame-0000.png'), '-q:v', '2', posterPath], 'ffmpeg', signal);
}

/**
 * Validates the encoded MP4 with local `ffprobe`: width, height, fps, codec,
 * and frame count must all match what was requested — a mismatch is a
 * failed render, never silently accepted (mirrors the SSOT plan's own
 * "Final output must be checked with ffprobe; a mismatched artifact is a
 * failed job" rule). Optional `signal`, same cooperative-cancellation
 * contract as `encodeWithFfmpeg`.
 */
async function validateWithFfprobe({ mp4Path, expected, signal }) {
  const stdout = await _internals.runLocalBinary('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,codec_name,nb_frames',
    '-show_entries', 'format=duration',
    '-of', 'json',
    mp4Path,
  ], 'ffprobe', signal);
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0];
  if (!stream) throw new ArtRenderError('ffprobe reported no video stream.', { stdout });

  const [num, den] = String(stream.r_frame_rate || '0/1').split('/').map(Number);
  const actualFps = den ? num / den : 0;
  const actual = {
    width: Number(stream.width),
    height: Number(stream.height),
    fps: actualFps,
    codec: stream.codec_name,
    frameCount: Number(stream.nb_frames),
    duration: Number(parsed.format?.duration),
  };

  const problems = [];
  if (actual.width !== expected.width) problems.push(`width: expected ${expected.width}, got ${actual.width}`);
  if (actual.height !== expected.height) problems.push(`height: expected ${expected.height}, got ${actual.height}`);
  if (Math.abs(actual.fps - expected.fps) > 0.01) problems.push(`fps: expected ${expected.fps}, got ${actual.fps}`);
  if (actual.codec !== 'h264') problems.push(`codec: expected h264, got ${actual.codec}`);
  if (actual.frameCount !== expected.frameCount) problems.push(`frameCount: expected ${expected.frameCount}, got ${actual.frameCount}`);

  if (problems.length) {
    throw new ArtRenderError(`ffprobe validation failed: ${problems.join('; ')}`, { actual, expected });
  }
  return actual;
}

/**
 * Renders `recipe` (an already-normalized art-scene-v2 recipe — see
 * art-recipe.mjs) to a local MP4 + poster, fully deterministically. Returns
 * `{ mp4Path, posterPath, metadata, frameHashes, capabilities }`. Everything
 * (temp scene dir, static server, browser, frame PNGs) except the final
 * `outDir` contents is cleaned up before returning; the caller owns `outDir`.
 *
 * Rejects (throws `ArtRenderError`) if `recipe` requests any feature this
 * pass doesn't implement (Diffusion Camera, FX, glass, extra elements, a
 * non-solid background) UNLESS `allowUnsupportedFeatures:true` is passed —
 * in which case the render proceeds (rendering only what IS implemented)
 * and `result.capabilities.unsupportedFeatures` reports exactly what was
 * requested but omitted. Either way, nothing is ever silently dropped.
 */
export async function renderArtScene({
  recipe, width = 320, height = 320, fps = 30, durationSeconds = 1,
  warmupFrames = 3, outDir, allowUnsupportedFeatures = false, signal,
  // Slice F2 — LOCAL path to the already-downloaded pinned screen still
  // (proof-render-worker.mjs downloads + hash-verifies it). REQUIRED
  // whenever the recipe carries devicePrimary.screenStill: a pinned screen
  // must render its pinned content or fail — never a silent placeholder.
  deviceScreenStillPath,
  // Timeline (Phase C, "Interrupted export recovery") — the ALREADY-REDUCED
  // scroll/posY keyframe track (services/studio-render/art-timeline.mjs's
  // sanitizeArtTimeline, run by the route BEFORE a job is ever created;
  // this function never re-validates it). `null`/absent means no timeline —
  // byte-identical behavior to before this phase.
  timeline = null,
}) {
  // Fail fast if the caller's total render/job deadline (Slice 4f Phase B —
  // owned and enforced by proof-render-worker.mjs, NEVER by this function or
  // any request/job field) has already elapsed before any work started.
  if (signal?.aborted) {
    throw new ArtRenderError('Render aborted before starting: the total render/job deadline was already exceeded.', { aborted: true });
  }

  const totalFrames = validateRenderParams({ width, height, fps, durationSeconds, warmupFrames });

  const capabilities = checkCapabilities(recipe);
  if (!capabilities.supported && !allowUnsupportedFeatures) {
    throw new ArtRenderError(
      `Recipe requests unsupported feature(s) this render pass doesn't implement: ${capabilities.unsupportedFeatures.join(', ')}. Pass allowUnsupportedFeatures:true for a best-effort render that reports this instead of rejecting.`,
      { capabilities },
    );
  }

  const artworkSrc = BUILTIN_ARTWORK_ASSETS[recipe.artworkId] || BUILTIN_ARTWORK_ASSETS.brock;
  const artworkFileName = `artwork${path.extname(artworkSrc)}`;

  const pinnedStillRef = recipe?.devicePrimary?.screenStill || null;
  if (pinnedStillRef && !deviceScreenStillPath) {
    throw new ArtRenderError('Recipe pins a device screen still but no local deviceScreenStillPath was provided — a pinned screen is never rendered blank.', { pinnedStill: true });
  }
  const deviceScreenStillFileName = pinnedStillRef ? `screen-still.${pinnedStillRef.ext}` : null;

  // Capture Frame parity: an active frame renders the stage at a boosted
  // source resolution and captures a native-resolution crop — resolved
  // here (server-owned), rejected precisely when unrenderable.
  const frameRender = resolveFrameRender({ frameId: recipe?.frameId, stageAspect: recipe?.stageAspect, targetWidth: width, targetHeight: height });
  if (frameRender?.error) {
    throw new ArtRenderError(`Capture-frame render rejected: ${frameRender.error}`, { frame: true });
  }

  const workDir = await mkdtemp(path.join(os.tmpdir(), 'studio-art-render-'));
  const finalOutDir = outDir || await mkdtemp(path.join(os.tmpdir(), 'studio-art-render-out-'));
  let server;
  let browser;
  let aborted = false;
  // Cooperative cancellation (Slice 4f Phase B): force-closing the browser
  // immediately is what actually STOPS frame capture — Playwright has no
  // separate "cancel this in-flight page.evaluate" API, but closing the
  // browser rejects any pending page operation right away instead of
  // letting it run to its own natural conclusion. The frame-loop's own
  // `signal.aborted` check (below) catches the common case cleanly between
  // frames; this listener catches the less common case of an abort landing
  // WHILE a single frame's evaluate() call is still in flight.
  const onAbort = () => {
    aborted = true;
    try { browser?.close(); } catch { /* best-effort — finally still closes/cleans up below */ }
  };
  signal?.addEventListener?.('abort', onAbort);
  try {
    // Live website frames on the device screen — a real, scrolling capture
    // of devicePrimary.liveUrl, written to workDir BEFORE buildSceneHtml so
    // the generated page can preload the exact frame count/filenames.
    // checkCapabilities already rejected an unusable liveUrl above unless
    // the caller passed allowUnsupportedFeatures — this re-checks the same
    // condition defensively (never attempts a capture the recipe didn't
    // actually ask for, and never silently skips one it did that IS
    // usable). A capture that produces zero frames throws — a sourced
    // screen is never rendered blank (same discipline as the pinned-still
    // path above).
    let deviceLiveFrameFileNames = [];
    let deviceLiveCaptureViewportPx = null;
    let liveCaptureMeta = null;
    const wantsLiveDeviceScreen = recipe?.clothShape === 'device'
      && (recipe?.devicePrimary?.live === true || Boolean(recipe?.devicePrimary?.liveUrl));
    if (wantsLiveDeviceScreen && isValidHttpUrl(recipe?.devicePrimary?.liveUrl)) {
      const liveUrl = recipe.devicePrimary.liveUrl;
      const captured = await _internals.captureDeviceLiveFrames({
        url: liveUrl, viewport: recipe.devicePrimary.viewport || 'desktop', seconds: durationSeconds, fps, signal,
      });
      if (!captured.frames || !captured.frames.length) {
        throw new ArtRenderError(`Live device-screen capture produced no frames from ${liveUrl} — a sourced screen is never rendered blank.`, { liveCapture: true, url: liveUrl });
      }
      deviceLiveCaptureViewportPx = captured.viewport;
      // eslint-disable-next-line no-await-in-loop -- sequential disk writes of an already-captured in-memory array, not a network loop.
      for (let i = 0; i < captured.frames.length; i += 1) {
        const base64 = captured.frames[i].slice(captured.frames[i].indexOf(',') + 1);
        const fileName = `live-frame-${String(i).padStart(4, '0')}.jpg`;
        // eslint-disable-next-line no-await-in-loop
        await writeFile(path.join(workDir, fileName), Buffer.from(base64, 'base64'));
        deviceLiveFrameFileNames.push(fileName);
      }
      // gpu: { renderer, software } — the "Live capture GPU acceleration"
      // checkpoint's headline diagnostic, carried all the way out to
      // renderArtScene's own return value (result.liveCapture.gpu below) so
      // a caller can see at a glance whether this specific render got real
      // GPU acceleration or silently fell back to software, never just a
      // slow render with no visible explanation.
      liveCaptureMeta = {
        url: liveUrl, frameCount: deviceLiveFrameFileNames.length, viewport: deviceLiveCaptureViewportPx, readiness: captured.readiness, scrollInfo: captured.scrollInfo, gpu: captured.gpu,
      };
    }

    const html = buildSceneHtml({
      recipe, width, height, fps, artworkFileName, deviceScreenStillFileName, frameRender, timeline,
      deviceLiveFrameFileNames, deviceLiveCaptureViewportPx, totalFrames,
    });
    await writeFile(path.join(workDir, 'scene.html'), html);
    await cp(THREE_MODULE_SRC, path.join(workDir, 'three.module.min.js'));
    await cp(artworkSrc, path.join(workDir, artworkFileName));
    if (deviceScreenStillFileName) await cp(deviceScreenStillPath, path.join(workDir, deviceScreenStillFileName));
    await copyEnvironmentAssets(recipe, workDir);
    await copySceneBackgroundAssets(recipe, workDir);

    server = await startLocalStaticServer(workDir);
    const { port } = server.address();

    // executablePath: launches the apt-installed SYSTEM Chromium when
    // CHROME_PATH is set (the dedicated studio-proof-render Cloud Run image
    // — see Dockerfile.proof) instead of downloading Playwright's own
    // bundled browser into that image. Unset in local dev/tests (this repo's
    // CHROME_PATH is only ever set for a deployed Proof container), so
    // Playwright's own bundled Chromium is used exactly as before — zero
    // behavior change for every existing local/test invocation.
    // --no-sandbox/--disable-dev-shm-usage: unconditional, not container-
    // gated. Chromium's own sandbox refuses to start at all when the process
    // runs as root (the Dockerfile.proof container's default user — no
    // dedicated non-root user is set up there), so these are load-bearing in
    // production, not merely an optimization. Harmless in every other
    // context this function already runs in (local dev, CI, `npm test`) —
    // Playwright accepts both flags identically whether or not sandboxing
    // would otherwise have been available.
    browser = await chromium.launch({
      headless: true, executablePath: process.env.CHROME_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    // The __sceneReady gate below is an in-page async chain (asset loads,
    // the frame-zero live-frame decode, IBL/GLB parsing). Any
    // rejection inside it leaves __sceneReady unset, so the ONLY symptom is
    // this function's own 120s waitForFunction timeout with no cause — the
    // page's own error is discarded. Surfacing both channels turns that
    // silent hang into a named failure.
    page.on('pageerror', (err) => {
      console.warn('[art-render][page error]', err?.message || err);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.warn('[art-render][page console]', msg.text());
    });
    await page.goto(`http://127.0.0.1:${port}/scene.html`);
    // Playwright's default waitForFunction timeout (30s) is tight once a
    // recipe's ready-gate genuinely does real work before frame zero — HDR
    // environments, PMREM, GLB parsing, a live device screen's frame-zero
    // decode — on top of every other async asset this page already loads.
    // Widened to match render.mjs's own precedent
    // budget for "wait for a whole real-world render/asset pipeline to
    // finish" (120000ms) — every OTHER recipe still resolves in a fraction
    // of that, so this raises the ceiling without changing behavior for
    // anything that isn't actually this slow.
    await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120000 });
    await page.evaluate((n) => window.__warmup(n), warmupFrames);

    const frameHashes = [];
    // Per-frame glass rotation trace (glass-parity P2 regression surface):
    // __renderFrame refreshes __glassInspection.rotation after every frame,
    // so this reads the exact rotation each captured frame was rendered
    // with. Only collected when this recipe's glass is actually on — stays
    // undefined (and unreturned) otherwise.
    const glassRotations = recipe.glass?.on === true ? [] : null;
    // Per-frame timeline scroll/posY trace (Phase C regression surface,
    // mirrors glassRotations above): __renderFrame refreshes
    // __deviceInspection.timelineScrollApplied after every frame, so this
    // reads the exact {scrollPosition, posY} each captured frame was
    // rendered with. Only collected when a device is actually being built
    // AND a timeline is genuinely active — stays undefined (and unreturned)
    // otherwise.
    const timelineScrollTrace = (recipe.clothShape === 'device' && Array.isArray(timeline?.keyframes) && timeline.keyframes.length > 0) ? [] : null;
    for (let i = 0; i < totalFrames; i += 1) {
      if (signal?.aborted) {
        throw new ArtRenderError(
          'Render aborted: the total render/job deadline was exceeded during frame capture.',
          { aborted: true, framesCaptured: i, totalFrames },
        );
      }
      // eslint-disable-next-line no-await-in-loop -- strict sequence: each
      // frame's physics depends on every prior frame's; the page's WebGL
      // context is single-threaded/stateful.
      const dataUrl = await page.evaluate((idx) => window.__renderFrame(idx), i);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const buffer = Buffer.from(base64, 'base64');
      // eslint-disable-next-line no-await-in-loop
      await writeFile(path.join(workDir, `frame-${String(i).padStart(4, '0')}.png`), buffer);
      frameHashes.push(createHash('sha256').update(buffer).digest('hex'));
      if (glassRotations) {
        // eslint-disable-next-line no-await-in-loop
        glassRotations.push(await page.evaluate(() => window.__glassInspection.rotation));
      }
      if (timelineScrollTrace) {
        // eslint-disable-next-line no-await-in-loop
        timelineScrollTrace.push(await page.evaluate(() => window.__deviceInspection.timelineScrollApplied));
      }
    }

    if (signal?.aborted) {
      throw new ArtRenderError('Render aborted: the total render/job deadline was exceeded before encoding could start.', { aborted: true });
    }

    // Peak number of DECODED captured website frames the page held resident
    // at once. Captured frames are decoded on demand behind a small LRU (see
    // art-scene.mjs's ensureDeviceLiveFrame) precisely so this stays a small
    // constant instead of scaling with the capture length — retaining every
    // decoded frame is what used to blow the page's memory ceiling on any
    // render longer than ~1 second. Surfaced on the result so a caller (and
    // the regression test) can see the bound actually held.
    if (liveCaptureMeta) {
      liveCaptureMeta.residentFramePeak = await page.evaluate(() => (window.__deviceInspection ? window.__deviceInspection.liveFrameResidentPeak : null));
    }

    const mp4Path = path.join(finalOutDir, 'output.mp4');
    const posterPath = path.join(finalOutDir, 'poster.jpg');
    // signal threaded through: an abort during ffmpeg/ffprobe reuses the
    // EXACT SAME SIGTERM→grace→SIGKILL→reap-confirm escalation an internal
    // per-call timeout would trigger (runLocalBinaryImpl's beginEscalation)
    // — never a second, different termination mechanism.
    await encodeWithFfmpeg({ frameDir: workDir, fps, mp4Path, posterPath, signal });
    const metadata = await validateWithFfprobe({ mp4Path, expected: { width, height, fps, frameCount: totalFrames }, signal });

    return {
      mp4Path, posterPath, metadata, frameHashes, frameCount: totalFrames, capabilities,
      ...(glassRotations ? { glassRotations } : {}),
      ...(timelineScrollTrace ? { timelineScrollTrace } : {}),
      ...(liveCaptureMeta ? { liveCapture: liveCaptureMeta } : {}),
    };
  } catch (err) {
    // A forced browser.close() from onAbort makes any in-flight Playwright
    // call reject with ITS OWN raw (non-ArtRenderError) message — normalize
    // that specific case into a clean, typed error. Anything already an
    // ArtRenderError (the frame-loop's own aborted-check above, or the
    // ffmpeg/ffprobe escalation's own richly-detailed rejection) passes
    // through completely unchanged — never re-wrapped, never losing its
    // sigtermOutcome/terminationConfirmed/etc. detail.
    if (aborted && !(err instanceof ArtRenderError)) {
      throw new ArtRenderError(`Render aborted: deadline exceeded (${err?.message || err}).`, { aborted: true, cause: String(err?.message || err) });
    }
    throw err;
  } finally {
    // "Do not requeue until cleanup completes" (Slice 4f Phase B): this
    // finally block is awaited in full — browser/server closed and workDir
    // removed — before the rejection above (or a normal return) can
    // propagate to the caller (proof-render-worker.mjs), so a fenced
    // requeue can never fire ahead of cleanup finishing.
    signal?.removeEventListener?.('abort', onAbort);
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Lightweight scene inspection — serves + launches + reads whatever
 * `window` globals the generated scene exposes for testing (`__clothDimensions`
 * and `__materialInspection`), without capturing frames or invoking
 * ffmpeg/ffprobe. Used by the clothAspect:'auto' and native-material-parity
 * regression tests, which only need exact property values, not a full
 * encoded render. Same capability enforcement as renderArtScene (skippable
 * the same way).
 */
export async function inspectScene({
  recipe, width = 320, height = 320, fps = 30, allowUnsupportedFeatures = false, deviceScreenStillPath,
  // Timeline (Phase C) — threaded through for parity with renderArtScene;
  // note inspectScene never calls __renderFrame (see its own header), so a
  // recipe's deviceInspection.timelineScrollApplied stays whatever
  // art-scene.mjs's own window.__deviceInspection literal initializes it
  // to (null) rather than ever reflecting a real interpolated frame.
  timeline = null,
}) {
  validateSceneDimensions({ width, height, fps });
  const capabilities = checkCapabilities(recipe);
  if (!capabilities.supported && !allowUnsupportedFeatures) {
    throw new ArtRenderError(`Recipe requests unsupported feature(s): ${capabilities.unsupportedFeatures.join(', ')}.`, { capabilities });
  }
  const artworkSrc = BUILTIN_ARTWORK_ASSETS[recipe.artworkId] || BUILTIN_ARTWORK_ASSETS.brock;
  const artworkFileName = `artwork${path.extname(artworkSrc)}`;
  const pinnedStillRef = recipe?.devicePrimary?.screenStill || null;
  if (pinnedStillRef && !deviceScreenStillPath) {
    throw new ArtRenderError('Recipe pins a device screen still but no local deviceScreenStillPath was provided.', { pinnedStill: true });
  }
  const deviceScreenStillFileName = pinnedStillRef ? `screen-still.${pinnedStillRef.ext}` : null;
  const frameRender = resolveFrameRender({ frameId: recipe?.frameId, stageAspect: recipe?.stageAspect, targetWidth: width, targetHeight: height });
  if (frameRender?.error) {
    throw new ArtRenderError(`Capture-frame render rejected: ${frameRender.error}`, { frame: true });
  }
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'studio-art-inspect-'));
  let server;
  let browser;
  try {
    const html = buildSceneHtml({ recipe, width, height, fps, artworkFileName, deviceScreenStillFileName, frameRender, timeline });
    await writeFile(path.join(workDir, 'scene.html'), html);
    await cp(THREE_MODULE_SRC, path.join(workDir, 'three.module.min.js'));
    await cp(artworkSrc, path.join(workDir, artworkFileName));
    if (deviceScreenStillFileName) await cp(deviceScreenStillPath, path.join(workDir, deviceScreenStillFileName));
    await copyEnvironmentAssets(recipe, workDir);
    await copySceneBackgroundAssets(recipe, workDir);
    server = await startLocalStaticServer(workDir);
    const { port } = server.address();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/scene.html`);
    await page.waitForFunction(() => window.__sceneReady === true);
    const clothDimensions = await page.evaluate(() => window.__clothDimensions);
    const materialInspection = await page.evaluate(() => window.__materialInspection);
    const glassInspection = await page.evaluate(() => window.__glassInspection ?? null);
    const sceneBackgroundInspection = await page.evaluate(() => window.__sceneBackgroundInspection ?? null);
    const shadowInspection = await page.evaluate(() => window.__shadowInspection ?? null);
    const tshirtInspection = await page.evaluate(() => window.__tshirtInspection ?? null);
    const deviceInspection = await page.evaluate(() => window.__deviceInspection ?? null);
    const frameInspection = await page.evaluate(() => window.__frameInspection ?? null);
    // Diffusion Camera (Phase B) — __diffusionInspection reflects the
    // PRE-FRAME-ZERO baseline (uniforms synced once at composer-construction
    // time, same "static snapshot before any frame" pattern __glassInspection
    // uses for its rotation baseline) since inspectScene never calls
    // __renderFrame. null whenever this recipe's diffusionCamera is off.
    const diffusionInspection = await page.evaluate(() => window.__diffusionInspection ?? null);
    // Capture Frame parity proof: the delivered framed capture must be a
    // PURE region copy of the crop rect — re-crop the SAME source canvas
    // independently and compare encodings byte-for-byte. Any overlay, HUD
    // guide, label, filmstrip or dimming would break the equality.
    // __renderFrame is async (it may await one on-demand live-frame decode —
    // see art-scene.mjs's ensureDeviceLiveFrame), so the delivered data URL
    // must be awaited before it can be compared.
    const frameCropProof = frameInspection ? await page.evaluate(async () => {
      const delivered = await window.__renderFrame(0);
      const F = window.__frameInspection;
      const src = document.getElementById('c');
      const c = document.createElement('canvas');
      c.width = F.targetWidth; c.height = F.targetHeight;
      c.getContext('2d').drawImage(src, F.cropRect.x, F.cropRect.y, F.cropRect.w, F.cropRect.h, 0, 0, c.width, c.height);
      return { pureRegionCopy: c.toDataURL('image/png') === delivered };
    }) : null;
    return { clothDimensions, materialInspection, glassInspection, sceneBackgroundInspection, shadowInspection, tshirtInspection, deviceInspection, frameInspection, frameCropProof, diffusionInspection, capabilities };
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(workDir, { recursive: true, force: true });
  }
}

export { ArtRenderError, checkCapabilities, validateSceneDimensions, validateRenderParams, LIMITS, BUILTIN_ENV_HDR_ASSETS };

// Exported for tests only — lets a test list a rendered outDir's contents
// without re-deriving the frame-file naming convention, and directly
// exercise ffprobe validation against a real encoded file without paying
// for a full render each time.
export async function listOutputFiles(dir) {
  return readdir(dir);
}
export { validateWithFfprobe };
