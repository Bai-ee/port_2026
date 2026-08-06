// video-export.js — Studio browser "Export video" upgrade. Pure,
// DOM/WebGL/MediaRecorder-free logic: bitrate presets per codec, a real-time
// capability/memory/pixel-budget safeguard evaluation, and the live-export
// guard/capture-lifecycle helpers. No renderer/canvas access here at all —
// ClothStudio.jsx's exportVideo is where these are actually applied; this
// module only decides WHAT to request and whether that request is safe,
// never HOW to render it.
//
// Quick Export always records at the platform-native size: the live canvas
// directly ('off'), or a native-resolution crop into an offscreen canvas
// sized exactly to the active FRAME_PRESETS entry — never a boosted/upscaled
// resolution. A resolution-tier system used to offer a 2x/"4K"/"Ultra"
// export here; it was removed because it required resizing the renderer/
// composer mid-recording, which was the confirmed source of the export's
// fragility (GPU memory pressure, FX pixel-pitch drift versus the preview).
// High-resolution export returns later on a different (non-MediaRecorder)
// architecture.

// ── Bitrate presets ─────────────────────────────────────────────────────────
// H.264 needs materially more bits/pixel than VP9 for comparable visual
// quality at the same resolution, so this is two separate numbers, not one
// shared value scaled by a codec factor. Values are the encode target passed
// to MediaRecorder's own videoBitsPerSecond option — the prod rates, one per
// container, now that there is only ever one export resolution.
export const BITRATE_PRESETS = { mp4: 12_000_000, webm: 8_000_000 };

/** Returns the bitrate (bits/sec) for a format, or null for an unrecognized format. */
export function getBitrateFor(format) {
  return BITRATE_PRESETS[format] ?? null;
}

// ── Real-time pixel-frame work budget ───────────────────────────────────────
// width * height * fps * seconds — analogous to the Proof render pipeline's
// own MAX_PIXEL_FRAME_BUDGET (services/studio-render/art-render-validation.mjs
// LIMITS), but sized for what a REAL-TIME in-browser MediaRecorder encode can
// plausibly sustain, not a batch server render with no wall-clock deadline.
// Exceeding this is a WARNING, never an outright block — the SSOT plan's own
// documented limitation is that browser recording doesn't guarantee frame
// timing under load, not that it's impossible; the caller decides whether to
// let the user proceed anyway.
export const MAX_REALTIME_PIXEL_FRAME_BUDGET = 3840 * 2160 * 30 * 15; // 4K @ 30fps for 15s

/** width*height*fps*seconds — the same shape of number LIMITS.MAX_PIXEL_FRAME_BUDGET bounds server-side, computed here for the browser's own real-time budget check. */
export function estimatePixelFrameWork({ width, height, fps, seconds }) {
  return width * height * fps * seconds;
}

// ── Capability/memory/resolution safeguard evaluation ──────────────────────
// Pure — every signal is INJECTED by the caller (ClothStudio.jsx reads real
// values from the DOM/renderer/navigator; tests supply fakes), never read
// from globals in this module. Returns one of:
//   allowed:false            — a hard block (unsupported browser, invalid
//                               dimensions, or exceeds a real GPU limit)
//   allowed:true, warnings:[] — safe to proceed
//   allowed:true, warnings:[...] — proceed, but the caller should surface
//                               these to the user (uncertain-but-risky
//                               combinations: low reported memory/cores, or
//                               a pixel-frame budget large enough that
//                               real-time encoding may drop frames)
export function evaluateExportCapability({
  width, height, fps = 30, seconds = 5,
  maxTextureSize, maxRenderbufferSize, maxViewportDims,
  deviceMemory, hardwareConcurrency,
  hasMediaRecorder = true, hasCaptureStream = true,
} = {}) {
  const warnings = [];

  if (!hasMediaRecorder || !hasCaptureStream) {
    return { allowed: false, warnings, reason: 'Video capture is not supported in this browser.' };
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { allowed: false, warnings, reason: 'Invalid export dimensions.' };
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    return { allowed: false, warnings, reason: 'Invalid export frame rate.' };
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { allowed: false, warnings, reason: 'Invalid export duration.' };
  }
  if (Number.isFinite(maxTextureSize) && maxTextureSize > 0 && (width > maxTextureSize || height > maxTextureSize)) {
    return {
      allowed: false, warnings,
      reason: `Requested ${width}×${height} exceeds this device's maximum texture size (${maxTextureSize}px).`,
    };
  }
  if (Number.isFinite(maxRenderbufferSize) && maxRenderbufferSize > 0 && (width > maxRenderbufferSize || height > maxRenderbufferSize)) {
    return {
      allowed: false, warnings,
      reason: `Requested ${width}×${height} exceeds this device's maximum renderbuffer size (${maxRenderbufferSize}px).`,
    };
  }
  if (Array.isArray(maxViewportDims) && maxViewportDims.length === 2) {
    const [maxViewportW, maxViewportH] = maxViewportDims;
    const overW = Number.isFinite(maxViewportW) && maxViewportW > 0 && width > maxViewportW;
    const overH = Number.isFinite(maxViewportH) && maxViewportH > 0 && height > maxViewportH;
    if (overW || overH) {
      return {
        allowed: false, warnings,
        reason: `Requested ${width}×${height} exceeds this device's maximum viewport dimensions (${maxViewportW}×${maxViewportH}).`,
      };
    }
  }

  const highRes = width * height > 1920 * 1080;
  if (highRes && Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory < 4) {
    warnings.push('This device reports limited memory — a high-resolution export may be slow or drop frames.');
  }
  if (highRes && Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 && hardwareConcurrency <= 2) {
    warnings.push('This device has few CPU cores available — a high-resolution export may drop frames during encoding.');
  }

  const pixelFrameWork = estimatePixelFrameWork({ width, height, fps, seconds });
  if (pixelFrameWork > MAX_REALTIME_PIXEL_FRAME_BUDGET) {
    warnings.push(
      `This combination of resolution, frame rate, and duration is large for real-time browser encoding (${width}×${height} @ ${fps}fps for ${seconds}s) — frames may drop under load.`,
    );
  }

  return { allowed: true, warnings, reason: null };
}

// ── Crop-source resolution (Final Render only) ──────────────────────────────
// Inverts ClothStudio.jsx's own computeFrameRect margin math (a 0.92 safety
// inset around the crop) to answer: "at what stage-aspect resolution does
// the crop mechanism produce exactly the requested target width/height, with
// no upscaling?" Quick Export (exportVideo, this file's own capture-lifecycle
// helpers below) no longer needs this — it records the crop at the frame's
// own native size directly. This function is kept for the separate,
// server-side Final Render pipeline (services/studio-render/art-scene-
// def.mjs's resolveFrameRender, via the vendored copy of this file), which
// deterministically renders a boosted-resolution source so its own crop
// lands natively on the target dimensions — the same math, a different
// caller. Returns null if any input is missing or non-positive.
const FRAME_RECT_MARGIN = 0.92; // must match ClothStudio.jsx's computeFrameRect exactly

export function computeCropSourceResolution({ stageWidth, stageHeight, targetWidth, targetHeight }) {
  if (!stageWidth || !stageHeight || !targetWidth || !targetHeight) return null;
  if (stageWidth <= 0 || stageHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) return null;
  const stageAspect = stageWidth / stageHeight;
  const frameAspect = targetWidth / targetHeight;
  let sourceWidth;
  let sourceHeight;
  if (stageAspect >= frameAspect) {
    // computeFrameRect's height-clamp branch will be the constraining one at
    // this aspect combination — solve so that clamped crop height (== source
    // height * MARGIN) lands exactly on targetHeight.
    sourceHeight = targetHeight / FRAME_RECT_MARGIN;
    sourceWidth = sourceHeight * stageAspect;
  } else {
    // computeFrameRect's initial width (== source width * MARGIN) is itself
    // the constraining dimension — solve so it lands exactly on targetWidth.
    sourceWidth = targetWidth / FRAME_RECT_MARGIN;
    sourceHeight = sourceWidth / stageAspect;
  }
  return { width: Math.ceil(sourceWidth), height: Math.ceil(sourceHeight) };
}

// ── Capture frame-rate decision (Phase 2) ───────────────────────────────────
// "Use an explicit 30fps export rate unless live measurement proves 60fps is
// sustainable at the selected resolution." The actual measurement (real
// requestAnimationFrame/performance.now timing at the live target
// resolution) can only happen in a live browser, not in this DOM-free
// module — this is just the DECISION given an already-measured throughput,
// so the decision rule itself stays independently testable.
export const DEFAULT_CAPTURE_FPS = 30;
export const HIGH_CAPTURE_FPS = 60;
// Codex re-review (P2): the threshold must genuinely reflect 60fps
// sustainability, not a meaningfully slower rate — 55fps is a real,
// noticeably different frame rate from 60fps, not "close enough" headroom.
// 59 allows only for ordinary measurement jitter around a true 60Hz-locked
// loop (e.g. a display reporting 59.94Hz-class timing), never a genuinely
// lower sustained rate. A measurement below this always falls back to the
// safe 30fps default rather than requesting 60fps from a renderer that
// cannot actually sustain it.
export const HIGH_CAPTURE_FPS_THRESHOLD = 59;

export function chooseCaptureFps(measuredFps) {
  if (!Number.isFinite(measuredFps) || measuredFps <= 0) return DEFAULT_CAPTURE_FPS;
  return measuredFps >= HIGH_CAPTURE_FPS_THRESHOLD ? HIGH_CAPTURE_FPS : DEFAULT_CAPTURE_FPS;
}

// Codex re-review (P2): 15 passed a measurement that was still well below
// the 30fps chooseCaptureFps() would go on to request — "sustainable enough
// to attempt" is meaningless if the rate actually granted is roughly double
// what was measured; that's the same class of mismatch (request a cadence
// the renderer can't sustain) this whole check exists to prevent. Raised to
// 27 — allows for ordinary measurement jitter around a true 30fps-capable
// renderer (the same "allow jitter, not a genuinely different rate" logic
// HIGH_CAPTURE_FPS_THRESHOLD already uses at 59 for 60fps), without passing
// anything meaningfully short of the 30fps that will actually be requested.
export const MIN_SUSTAINABLE_CAPTURE_FPS = 27;

// Codex re-review (P1): `document.hidden` is now checked explicitly and
// separately (ClothStudio.jsx's startRecording, before this even runs) —
// that was the confirmed, common cause of a measurement hitting its own
// hard-ceiling timeout (resolving NaN) rather than reading a genuinely low
// number. Once THAT cause is ruled out by the caller, a NaN here means the
// measurement still couldn't complete on a VISIBLE tab — real GPU pressure,
// a lost/thrashing WebGL context, or throttling severe enough to matter for
// reasons other than tab visibility. That is no longer an "inconclusive,
// assume it's fine" signal; treating it as safe would let exactly the
// near-empty-capture failure this whole mechanism exists to prevent through
// on a visible tab. NaN now blocks, same as any other measured value below
// MIN_SUSTAINABLE_CAPTURE_FPS — this deliberately does NOT mirror
// chooseCaptureFps's own "NaN -> assume 30fps is safe" default, because
// that function is choosing which rate to REQUEST when uncertain (30fps is
// a conservative choice either way), not deciding whether to proceed at all.
//
// Export-restore round (Phase 2): this signal is now ADVISORY, not a gate.
// The prod version this Studio build regressed from measured nothing and
// always attempted the recording; ClothStudio.jsx's startRecording no
// longer aborts on a `false` result here — it surfaces the low/unmeasurable
// reading as a status warning (via describeUnsustainableCapture below) and
// proceeds anyway at the conservative 30fps chooseCaptureFps still selects
// for exactly this case, trading "might stutter" for "produces a file at
// all." The function's own return value and the NaN-handling reasoning
// above are unchanged — only what the caller does with a `false` result
// changed, so the tests below (and MIN_SUSTAINABLE_CAPTURE_FPS itself)
// still hold.
export function canSustainExportCapture(measuredFpsAtTargetResolution) {
  if (!Number.isFinite(measuredFpsAtTargetResolution)) return false;
  return measuredFpsAtTargetResolution >= MIN_SUSTAINABLE_CAPTURE_FPS;
}

/**
 * Codex re-review (P1, round 5): the "can't sustain a usable capture"
 * status message interpolated `Math.round(measuredFps)` directly — for a
 * non-finite measurement (the hard-ceiling timeout `measureSustainableFps`
 * itself can hit) that rendered the literal, meaningless text "~NaNfps".
 * Extracted as its own pure function (rather than inlined in ClothStudio.jsx)
 * specifically so this formatting is independently unit-testable — the rest
 * of that status-message call site is real React/DOM glue with no test
 * coverage anywhere in this codebase, but there's no reason THIS part has
 * to share that limitation.
 */
export function describeUnsustainableCapture(measuredFps) {
  return Number.isFinite(measuredFps) ? ` (measured ~${Math.round(measuredFps)}fps)` : ' (throughput could not be measured)';
}

// ── Export capture lifecycle (Codex re-review, P1) ──────────────────────────
// Codex re-review found: `captureStream()` and the second (fallback)
// `rec.start()` call could both throw OUTSIDE the one try/catch that
// previously guarded only the `MediaRecorder` constructor — and because
// `startRecording()` was invoked without being awaited or `.catch()`-ed, any
// of those throws became an unhandled promise rejection that skipped
// `cleanup()` entirely, leaving `recording` state stuck true forever.
//
// Fix: every external-API step most likely to throw is extracted here into
// two small, fully dependency-injected functions — never touching a global
// `document`/`MediaRecorder` reference — so (a) they're independently
// unit-testable with fakes (mirrors services/studio-render/art-render.mjs's
// own DI pattern for "an external API can throw at any point"), and (b)
// ClothStudio.jsx can wrap ONE call to each in ONE guarded try/catch that
// always runs its cleanup/restore path, regardless of which specific step
// failed.

/**
 * Build the capture source + construct the MediaStream + construct the
 * MediaRecorder. Throws on ANY failure in this sequence — a
 * `buildCaptureSource()` throw (e.g. a 2D context failure), a
 * `captureStream()` throw, or a `MediaRecorder` constructor throw — and
 * always releases whatever it already allocated before rethrowing (the
 * crop-copy source's own cleanup, then the MediaStream's tracks) so a
 * caller catching the throw never has to guess what, if anything, needs
 * releasing. Never calls `.start()` — that's `startMediaRecorderWithFallback`'s
 * job, run separately once the caller has wired the recorder's own event
 * handlers. Never resizes anything — the caller always captures at
 * whatever resolution the renderer already is.
 *
 * `buildCaptureSource()` must return `{ source, stopCropCopy }` — `source`
 * is anything with a `.captureStream(fps)` method (a real canvas, or a
 * fake in tests); `stopCropCopy` is an optional cleanup callback for
 * whatever per-frame copy loop `buildCaptureSource` may have started (the
 * crop-copy `requestAnimationFrame` loop in the real caller; a no-op or
 * absent in the `frameId:'off'` case, which returns the live canvas
 * directly with nothing to stop).
 */
export function startExportCapture({
  buildCaptureSource, captureFps, MediaRecorderCtor, mime, videoBitsPerSecond,
}) {
  const { source, stopCropCopy } = buildCaptureSource();

  let stream;
  try {
    stream = source.captureStream(captureFps);
  } catch (err) {
    stopCropCopy?.();
    throw err;
  }

  let rec;
  try {
    rec = new MediaRecorderCtor(stream, { mimeType: mime, videoBitsPerSecond });
  } catch (err) {
    stopCropCopy?.();
    stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
    throw err;
  }

  return { rec, stream, stopCropCopy };
}

/**
 * Starts `rec` with the existing timeslice→no-args fallback (some browser
 * builds reject a timeslice argument for a given container — pre-existing
 * behavior, unchanged). Throws if BOTH attempts fail, so a caller's own
 * guarded path can clean up — previously, a throwing FALLBACK call (the
 * bare `rec.start()` inside the old inline `catch`) had nowhere left to
 * propagate to and would itself become an unhandled rejection.
 */
export function startMediaRecorderWithFallback(rec, timesliceMs = 500) {
  try {
    rec.start(timesliceMs);
    return { usedFallback: false };
  } catch (err) {
    rec.start();
    return { usedFallback: true, fallbackReason: err };
  }
}

// ── "Record live screen" export source (Phase 8) ────────────────────────────
// Every earlier round answered "I want my live website in the exported video"
// with a STILL capture of the site, on the reasoning that a CSS3D iframe
// behind the WebGL canvas cannot be rasterized by `canvas.captureStream()`.
// The premise is true; the conclusion was wrong. `captureStream()` records
// ONE canvas — `navigator.mediaDevices.getDisplayMedia()` records the whole
// COMPOSITED TAB, cross-origin iframes included. These four pure functions
// are that path's decisions; ClothStudio.jsx's exportVideo owns the DOM/
// MediaRecorder glue and reuses startExportCapture/startMediaRecorderWith-
// Fallback above unchanged (the recorder lifecycle is never forked).
//
// Honest limitation, stated in the UI as well as here: tab capture records at
// the SURFACE's own resolution (the user's display), not at a native
// 1080p/4K framebuffer — the crop is upscaled to the capture frame's
// dimensions. This mode trades resolution for actually showing the live site.

/**
 * May the "Record live screen" mode be offered/used right now? The mode is
 * only meaningful for a device subject with an actually-live iframe on its
 * screen; everywhere else the normal canvas capture already records exactly
 * what is on screen, at a better resolution. `hasDisplayMedia` is injected
 * (ClothStudio.jsx reads `navigator.mediaDevices?.getDisplayMedia`).
 */
export function evaluateLiveRecordEligibility({ clothShape, live, liveUrl, hasDisplayMedia } = {}) {
  if (!hasDisplayMedia) {
    return {
      eligible: false,
      reason: 'This browser has no tab-capture API (navigator.mediaDevices.getDisplayMedia) — use the normal export, which records the WebGL canvas.',
    };
  }
  if (clothShape !== 'device') {
    return { eligible: false, reason: 'Only the Device subject has a live screen to record — switch Sheet Shape to Device.' };
  }
  if (!live || !liveUrl) {
    return { eligible: false, reason: 'Turn Go Live on with a URL first — there is no live website on the screen to record.' };
  }
  return { eligible: true, reason: null };
}

// The MediaTrackSettings.displaySurface value for a browser TAB. 'window' and
// 'monitor' are the other two the spec defines; anything else is treated the
// same way — not a tab, so not what this mode asked for.
export const DISPLAY_SURFACE_TAB = 'browser';

const DISPLAY_SURFACE_LABELS = {
  window: 'an application window',
  monitor: 'an entire screen',
};

/**
 * Did the user actually share a browser TAB? Chrome reports the kind of
 * surface on the video track's settings, so sharing the wrong thing (another
 * window, a whole monitor) is DETECTABLE — and recording it would silently
 * produce a video of something else entirely. Firefox/Safari may not report
 * the field at all; an unreported surface is allowed through (with
 * `unknown:true`, so the caller can say so) rather than blocking a browser
 * that simply doesn't expose the signal. Note that even a 'browser' surface
 * only proves a tab, not THIS tab — `preferCurrentTab` is what constrains
 * the choice to this tab, and it is Chrome-only.
 */
export function evaluateDisplaySurface({ displaySurface } = {}) {
  if (displaySurface === undefined || displaySurface === null || displaySurface === '') {
    return { ok: true, unknown: true, surface: '', reason: null };
  }
  if (displaySurface === DISPLAY_SURFACE_TAB) {
    return { ok: true, unknown: false, surface: DISPLAY_SURFACE_TAB, reason: null };
  }
  const label = DISPLAY_SURFACE_LABELS[displaySurface] || `a “${displaySurface}” surface`;
  return {
    ok: false,
    unknown: false,
    surface: String(displaySurface),
    reason: `You shared ${label}, not this browser tab — stopping rather than recording the wrong thing. Export again and choose THIS TAB in the sharing prompt.`,
  };
}

/**
 * Maps the stage canvas's `getBoundingClientRect()` (CSS px, viewport-
 * relative) into SOURCE pixels of a getDisplayMedia stream, then insets the
 * active capture frame's aspect inside it — the same 0.92-margin crop
 * `ClothStudio.jsx`'s computeFrameRect applies to the canvas itself, so a
 * tab-captured export frames identically to a normal one.
 *
 * The stream-to-CSS ratio is MEASURED (`streamWidth / viewportWidth`), never
 * assumed to be `devicePixelRatio`: a tab-capture track is commonly capped
 * (e.g. a 4K display capturing at 1080p-class dimensions), and browsers are
 * free to hand back a surface at any resolution they like.
 *
 * `frame` is the active FRAME_PRESETS entry (`{w,h}`) or null/`{}` for
 * "Off — full canvas". With a frame, output size is that frame's own native
 * size (identical to the canvas crop path). Without one, output is the
 * canvas region's own size in stream pixels, rounded to even dimensions
 * (odd dimensions break some H.264 encoders).
 *
 * Returns `{ ok:false, reason }` rather than clamping when the required crop
 * is not fully inside the shared surface — a silently clamped crop is a
 * silently wrong video.
 */
export function computeDisplayCaptureRect({
  streamWidth, streamHeight, viewportWidth, viewportHeight, canvasRect, frame,
} = {}) {
  const positive = (n) => Number.isFinite(n) && n > 0;
  if (!positive(streamWidth) || !positive(streamHeight)) {
    return { ok: false, reason: 'The shared tab reported no video dimensions yet — try the export again.' };
  }
  if (!positive(viewportWidth) || !positive(viewportHeight)) {
    return { ok: false, reason: 'The tab viewport reported no dimensions — try the export again.' };
  }
  if (!canvasRect || !positive(canvasRect.width) || !positive(canvasRect.height)) {
    return { ok: false, reason: 'The stage has no on-screen size — make the studio canvas visible, then export again.' };
  }

  const scaleX = streamWidth / viewportWidth;
  const scaleY = streamHeight / viewportHeight;
  const left = Number.isFinite(canvasRect.left) ? canvasRect.left : 0;
  const top = Number.isFinite(canvasRect.top) ? canvasRect.top : 0;

  // Frame inset inside the canvas, in CSS px — must match ClothStudio.jsx's
  // computeFrameRect exactly (same FRAME_RECT_MARGIN this file already
  // documents for computeCropSourceResolution).
  const hasFrame = Boolean(frame && positive(frame.w) && positive(frame.h));
  let cssX = left;
  let cssY = top;
  let cssW = canvasRect.width;
  let cssH = canvasRect.height;
  if (hasFrame) {
    const aspect = frame.w / frame.h;
    let w = canvasRect.width * FRAME_RECT_MARGIN;
    let h = w / aspect;
    if (h > canvasRect.height * FRAME_RECT_MARGIN) { h = canvasRect.height * FRAME_RECT_MARGIN; w = h * aspect; }
    cssX = left + (canvasRect.width - w) / 2;
    cssY = top + (canvasRect.height - h) / 2;
    cssW = w;
    cssH = h;
  }

  const sx = Math.round(cssX * scaleX);
  const sy = Math.round(cssY * scaleY);
  const sw = Math.round(cssW * scaleX);
  const sh = Math.round(cssH * scaleY);

  if (sw < 2 || sh < 2) {
    return { ok: false, reason: 'The stage is too small on screen to record — enlarge the studio window, then export again.' };
  }
  if (sx < 0 || sy < 0 || sx + sw > streamWidth || sy + sh > streamHeight) {
    return {
      ok: false,
      reason: 'The stage is partly outside the shared tab — scroll/resize so the whole canvas is visible, then export again.',
    };
  }

  const evenize = (n) => Math.max(2, n - (n % 2));
  return {
    ok: true,
    reason: null,
    sx, sy, sw, sh,
    scaleX, scaleY,
    outWidth: hasFrame ? frame.w : evenize(sw),
    outHeight: hasFrame ? frame.h : evenize(sh),
  };
}

/**
 * Chrome rejects some legal-looking getDisplayMedia option combinations
 * outright (notably `preferCurrentTab` alongside a `displaySurface`
 * constraint) with a TypeError-class rejection rather than simply ignoring
 * the member. That is a CONSTRAINT problem, not a user decision, so it earns
 * exactly one retry with `preferCurrentTab` dropped — still inside the
 * click's transient activation, because no prompt was ever shown. A user
 * cancellation (NotAllowedError) must never be retried.
 */
// The rejection names that mean "the browser refused this OPTION COMBINATION",
// as opposed to "the user said no". Shared by both getDisplayMedia call sites
// (the Phase 8 export capture and the Phase 9 SHARE TAB screen source) so the
// one-legal-retry rule can never drift apart between them.
const DISPLAY_CONSTRAINT_ERROR_NAMES = ['TypeError', 'NotSupportedError', 'InvalidStateError', 'OverconstrainedError'];

export function shouldRetryDisplayCaptureWithoutPreferCurrentTab(err) {
  return DISPLAY_CONSTRAINT_ERROR_NAMES.includes(err?.name || '');
}

/**
 * Turns a getDisplayMedia rejection into `{ aborted, message }`. `aborted`
 * separates "the user said no" (a clean, expected outcome that must not read
 * as a crash) from a genuine failure — both still get a precise message;
 * neither is ever silent.
 */
export function describeDisplayCaptureError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return { aborted: true, message: 'Tab sharing was cancelled — nothing was recorded. Export again and choose this tab to record the live screen.' };
  }
  if (name === 'NotFoundError') {
    return { aborted: false, message: 'No shareable surface was offered by the browser — nothing was recorded.' };
  }
  if (name === 'NotReadableError') {
    return { aborted: false, message: 'The browser could not read the shared tab (another capture may already own it) — nothing was recorded.' };
  }
  if (name === 'NotSupportedError' || name === 'TypeError') {
    return { aborted: false, message: 'This browser refused the tab-capture request — turn “Record live screen” off and use the normal export, which records the WebGL canvas.' };
  }
  const detail = err?.message ? ` (${err.message})` : '';
  return { aborted: false, message: `Tab capture failed${detail} — nothing was recorded.` };
}

// ── SHARE TAB — the live site as a real texture (Phase 9) ─────────────────
// Go Live puts the real website on the device screen as a CSS3D <iframe>
// composited BEHIND the WebGL canvas through an alpha-punched hole. Those
// pixels are DOM, never GL, so the Diffusion Camera / bloom / treatment /
// grain can never touch them — the screen is the one rectangle in the frame
// with no post-processing on it. Reading a cross-origin site into a texture
// is blocked by same-origin policy; that is a rule, not a missing feature.
//
// getDisplayMedia is the CONSENTED exception. When the user shares their own
// site's tab, the resulting MediaStream is ours to sample: a <video> element
// decodes it and a THREE.VideoTexture puts it on the screen mesh as an
// ORDINARY texture, at which point the whole FX chain applies to it live in
// the preview and the normal canvas export records it with no tab-capture of
// a composite involved.
//
// These are the pure decisions only. Everything renderer/DOM/MediaStream side
// lives in ClothStudio.jsx; nothing here touches a browser API.

/**
 * May SHARE TAB be offered/used right now? Distinct from
 * evaluateLiveRecordEligibility (Phase 8), which is about the EXPORT mode and
 * therefore requires Go Live to already be running — this mode REPLACES Go
 * Live, so it must be available exactly when Go Live is (a device subject in
 * a browser with the API), with no live iframe required.
 */
export function evaluateScreenShareEligibility({ clothShape, hasDisplayMedia } = {}) {
  if (!hasDisplayMedia) {
    return {
      eligible: false,
      reason: 'This browser has no tab-sharing API (navigator.mediaDevices.getDisplayMedia) — use Capture or Upload image for the screen instead.',
    };
  }
  if (clothShape !== 'device') {
    return { eligible: false, reason: 'Only the Device subject has a screen to share onto — switch Sheet Shape to Device.' };
  }
  return { eligible: true, reason: null };
}

/**
 * The getDisplayMedia request for SHARE TAB.
 *
 * `selfBrowserSurface:'exclude'` is LOAD-BEARING, not a nicety: it removes
 * the Studio's own tab from the picker, which is what makes a
 * canvas-showing-itself feedback loop impossible rather than merely
 * discouraged. `surfaceSwitching:'include'` lets the user swap which tab is
 * being shared without re-opening the picker (the stream survives; the video
 * element's dimensions may change, which the caller re-fits on).
 *
 * No `displaySurface` constraint and no `preferCurrentTab`: the user is
 * choosing a DIFFERENT tab here, and pinning the surface kind is what made
 * Chrome reject the Phase 8 combination in the first place.
 */
export function buildScreenShareRequest() {
  return {
    video: { frameRate: 30 },
    audio: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  };
}

/**
 * The degraded request used for the ONE legal retry — a browser that rejects
 * the dictionary above outright still gets a working share rather than a
 * hard failure. Unknown dictionary members are ignored per WebIDL, so this
 * retry only ever runs on a browser that actively refused the combination.
 * The feedback-loop protection is gone in this shape, which is why it is the
 * fallback and never the first attempt.
 */
export function buildBasicScreenShareRequest() {
  return { video: true, audio: false };
}

/** The one legal retry: constraint-class rejections only, never a user cancel. */
export function shouldRetryScreenShareWithBasicOptions(err) {
  return DISPLAY_CONSTRAINT_ERROR_NAMES.includes(err?.name || '');
}

/**
 * Turns a SHARE TAB getDisplayMedia rejection into `{ aborted, message }`.
 * `aborted` separates "the user closed the picker" — a clean no-op that must
 * change nothing and must not read as a crash — from a genuine failure.
 * Neither is ever silent.
 */
export function describeScreenShareError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return { aborted: true, message: 'Tab sharing was cancelled — the screen is unchanged. Click Share a tab again and pick the tab your site is open in.' };
  }
  if (name === 'NotFoundError') {
    return { aborted: false, message: 'The browser offered nothing to share — the screen is unchanged.' };
  }
  if (name === 'NotReadableError') {
    return { aborted: false, message: 'The browser could not read the shared tab (another capture may already own it) — the screen is unchanged.' };
  }
  if (name === 'NotSupportedError' || name === 'TypeError') {
    return { aborted: false, message: 'This browser refused the tab-sharing request — use Capture or Upload image for the screen instead.' };
  }
  const detail = err?.message ? ` (${err.message})` : '';
  return { aborted: false, message: `Tab sharing failed${detail} — the screen is unchanged.` };
}

const SHARE_SURFACE_LABELS = {
  window: 'an application window',
  monitor: 'your whole screen',
};

/**
 * Classifies what was actually shared. Deliberately ALLOW-with-warning, where
 * the export path's evaluateDisplaySurface BLOCKS: there, recording the wrong
 * surface produces a silently wrong FILE; here the pixels land visibly on the
 * device screen in the preview, where the user can see immediately what they
 * shared — so refusing would be paternalistic, while saying nothing would be
 * silent. An unreported surface (Firefox/Safari may not expose the field) is
 * simply not commented on.
 */
export function describeSharedSurfaceForScreen({ displaySurface } = {}) {
  if (displaySurface === undefined || displaySurface === null || displaySurface === '') {
    return { surface: '', isTab: false, unknown: true, warning: null };
  }
  if (displaySurface === DISPLAY_SURFACE_TAB) {
    return { surface: DISPLAY_SURFACE_TAB, isTab: true, unknown: false, warning: null };
  }
  const label = SHARE_SURFACE_LABELS[displaySurface] || `a “${displaySurface}” surface`;
  return {
    surface: String(displaySurface),
    isTab: false,
    unknown: false,
    warning: `You shared ${label}, not a single tab — everything on it shows on the device screen. Share again and pick a Chrome Tab for just your site.`,
  };
}

/**
 * COVER-fit mapping from a shared stream's pixel dimensions onto the device
 * screen's aspect, as THREE texture `repeat`/`offset` values.
 *
 * A shared tab is VIEWPORT-shaped, not page-shaped, so the full-page
 * scroll-fraction mapping deviceScreenRepeatFraction applies to tall
 * screenshots is wrong for it twice over: there is no page below the fold to
 * pan onto (the user scrolls in their own tab and it shows live), and the
 * aspect mismatch is a crop problem, not a scroll problem. Cover = fill the
 * screen entirely, centre-cropping the overflowing axis, never letterbox and
 * never stretch.
 *
 * `screenAspect` is INJECTED (ClothStudio passes deviceScreenAspect(viewport)
 * from elements/factories.js, where the screen's shape has always lived) so
 * this stays pure math with no factory import.
 *
 * Returns `{ ok:false, reason }` for unusable inputs rather than emitting
 * NaN repeat values, which render as a black screen with no explanation.
 */
export function computeScreenCoverFit({ screenAspect, sourceWidth, sourceHeight } = {}) {
  const positive = (n) => Number.isFinite(n) && n > 0;
  if (!positive(screenAspect)) {
    return { ok: false, reason: 'The device screen has no usable shape to fit the shared tab into.' };
  }
  if (!positive(sourceWidth) || !positive(sourceHeight)) {
    return { ok: false, reason: 'The shared tab reported no video size yet — stop sharing and share it again.' };
  }
  const sourceAspect = sourceWidth / sourceHeight;
  if (sourceAspect > screenAspect) {
    // Source is WIDER than the screen — keep full height, crop the sides.
    const repeatX = screenAspect / sourceAspect;
    return { ok: true, reason: null, repeat: { x: repeatX, y: 1 }, offset: { x: (1 - repeatX) / 2, y: 0 } };
  }
  // Source is TALLER than (or exactly) the screen — keep full width, crop
  // top/bottom. An exact match falls here and produces repeat {1,1} /
  // offset {0,0}, i.e. no crop at all.
  const repeatY = sourceAspect / screenAspect;
  return { ok: true, reason: null, repeat: { x: 1, y: repeatY }, offset: { x: 0, y: (1 - repeatY) / 2 } };
}

// ── Live-screen export guard (Go Live export-safety round) ─────────────────
// The live device screen is a CSS3D/DOM iframe composited BEHIND the WebGL
// canvas through an alpha-punched hole — no browser API can rasterize it
// into canvas.captureStream(), so ANY export that starts while Go Live is
// active records a transparent hole where the site is. These two pure
// helpers are the guard's decision logic and readiness contract, DI'd so
// they're testable without a DOM (ClothStudio.jsx wires real state in):
//
//   evaluateLiveExportGuard  — decides, BEFORE any renderer/stream/recorder
//     is touched: proceed (live not active), capture-then-await (no capture
//     of THIS live URL/viewport exists yet — a same-origin capture is
//     obtained automatically, never the raw iframe and never a silent
//     placeholder export), or await-readiness (a capture of THIS exact
//     live URL/viewport already exists — Live pauses and the export starts
//     only after the REAL teardown/restore/texture signals below, never a
//     fixed timer).
//
//   isLiveTeardownReady — the explicit readiness signal: iframe torn down,
//     alpha-punch material replaced by the factory's textured material,
//     captured texture applied as the live map, and at least one frame
//     COMMITTED with that state (framesSinceRestored counts real render
//     ticks, not wall time).
//
// Interrupted-export-recovery Phase A: a live-without-capture device used to
// hard-block the export ("click Capture manually first"). That silently
// exported nothing when the user's actual intent — a website is live on the
// screen — is fully knowable and obtainable through the existing same-origin
// capture route. The 'capture-then-await' verdict replaces the block: the
// caller obtains a capture (async, visible progress), THEN falls into the
// exact same teardown-wait as an existing capture. Nothing renderer/stream/
// recorder-side is ever touched before that capture succeeds.
//
// Recovery round 2 (Defect 1 — "Quick Export records a STALE capture"): a
// captureUrl alone used to be trusted regardless of WHICH site it was a
// capture OF. A scene can carry an old capture (e.g. from an earlier
// session) while Go Live now points at a different site — the old
// `Boolean(captureUrl)` check took the await-readiness path and silently
// exported the stale site. `captureSourceUrl`/`captureViewport` are the
// capture's own provenance (written at every site that sets captureUrl —
// see DeviceScreenControl.jsx and ClothStudio.jsx's pinDeviceScreenIfNeeded/
// runExportWithLiveGuard); a capture that CARRIES provenance is only
// trusted when it matches BOTH the live URL AND the live viewport —
// mismatched provenance is replaced by a fresh capture rather than exported
// blind.
//
// ── Phase 6 (2026-08-04): absent provenance is NOT trusted ───────────────
// An intermediate export-restore round made a captureUrl with NO provenance
// TRUSTED here, on the reasoning that "a legacy capture is exactly as usable
// as one with provenance; it only lacks the field that records what it's a
// capture OF." That reasoning was measured wrong against the user's real
// saved scene, and it is the confirmed cause of "every export records an
// example domain":
//
//   liveUrl:          "hitloop.agency"
//   captureUrl:       -> studio_device_captures/c54ea80a...
//   that doc's url:   "https://example.com/"      <-- a DIFFERENT site
//   captureSourceUrl: ""   captureViewport: ""    <-- no provenance
//
// The stored image was pulled out of Firestore and decoded: it is a correct,
// successful full-page capture of the IANA "Example Domain" page (1440x900
// because that page genuinely IS one viewport tall). Trusting it meant the
// guard took await-readiness, pinned example.com onto the device screen, and
// recorded it — while the live iframe on screen showed the real site the
// whole time. Absence of provenance is not evidence that a capture is of the
// current site; it is the absence of any evidence at all, and a capture that
// cannot prove what it is OF must never be exported while Live is active.
//
// This restores the rule planDeviceScreenSteps (below, the Proof/Final
// Render path) has enforced all along — the two functions previously gave
// OPPOSITE answers to the same question in the same file. Cost of the
// stricter rule is bounded: the capture-then-await branch writes provenance
// on success, so only the FIRST export of a legacy scene pays for a capture
// (and same-URL re-captures within 24h are served free from the route's own
// cache anyway).
//
// The provenance comparison stays value-based rather than a strict
// `undefined` check: ClothStudio.jsx's DEFAULT_DEVICE_PRIMARY uses `''` (never
// `undefined`) as this codebase's "unset" sentinel for every screen-source
// string field, and its `{...DEFAULT_DEVICE_PRIMARY, ...saved.devicePrimary}`
// merge fills that `''` in for keys an old saved blob lacks — so a legacy
// scene reaches this function with `''`, and `'' === 'hitloop.agency'` is
// false, which is exactly the intended "not trusted" answer.
export function evaluateLiveExportGuard({ clothShape, live, liveUrl, captureUrl, captureSourceUrl, captureViewport, viewport }) {
  const liveActive = clothShape === 'device' && Boolean(live) && Boolean(liveUrl);
  if (!liveActive) return { action: 'proceed' };
  const captureMatchesLive = Boolean(captureUrl)
    && captureSourceUrl === liveUrl && captureViewport === viewport;
  if (!captureMatchesLive) {
    return {
      action: 'capture-then-await',
      message: 'Live screen active — capturing the website for export (same capture the Capture button uses; cached for 24h). This can take up to a minute.',
    };
  }
  return {
    action: 'await-readiness',
    message: 'Live screen paused for export (a live site can’t be recorded) — switching to the captured screen. It returns automatically once the export finishes.',
  };
}

export function isLiveTeardownReady({ deviceLiveGone, screenMaterialRestored, capturedTextureApplied, framesSinceRestored }) {
  return Boolean(deviceLiveGone)
    && Boolean(screenMaterialRestored)
    && Boolean(capturedTextureApplied)
    && Number.isFinite(framesSinceRestored) && framesSinceRestored >= 1;
}

// ── Teardown-deadline decision (export-restore Phase 5) ───────────────────
// What to do when awaitLiveScreenTeardownThenRun's bounded deadline expires
// without isLiveTeardownReady ever going true.
//
// Phase 1 made that branch proceed UNCONDITIONALLY, reasoning that recording
// something beats recording nothing. That reasoning is wrong for the two
// states this actually lands in:
//
//   - the live CSS3D iframe is still up (or its alpha-punch material is
//     still on the screen mesh) — the render loop sets uCleanAlphaHole=1
//     for exactly that case, so the screen region records as a TRANSPARENT
//     HOLE. On a device that fills the frame the file is blank. That is not
//     "something"; it is a knowingly-wrong frame.
//   - the scene has a real screen SOURCE (a website capture or an uploaded
//     image) that never became the screen map — the export would record the
//     procedural placeholder site instead, which reads to the user as "it
//     lost my live URL and recorded an example domain".
//
// Both must stop, with a message that names the actual failure. Everything
// else still proceeds — that is Phase 1's intent preserved: a guard hiccup
// on a scene with no live hole and no capture requirement must not block an
// export.
//
// Why STOP rather than automatically obtaining a fresh capture: by the time
// this deadline is reached, runExportWithLiveGuard has ALREADY either
// obtained a fresh capture successfully or verified one exists. The failure
// is that an image the browser already holds a URL for will not load. A
// second capture costs a browserless quota unit that
// api/_lib/studio-device-capture.cjs explicitly does not refund, and the
// route's 24h cache would hand back the same cached bytes at the same URL —
// so it would very likely fail identically while spending money. The user
// already has two zero-cost recovery paths (the Capture button, and the
// "Skip live-screen prep" toggle), so naming the failure is both cheaper and
// more useful than paying to repeat it.
//
// `screenCaptureError` is factories.js's recordScreenCaptureLoadFailure
// marker ({ url, reason }) — the failure that used to be swallowed.
export function evaluateLiveTeardownDeadline({
  deviceLiveGone, screenMaterialRestored, capturedTextureApplied, wantsCapturedScreen, screenCaptureError,
} = {}) {
  if (!deviceLiveGone) {
    return {
      action: 'stop',
      message: 'The live website frame could not be torn down for the export — stopping rather than recording a transparent hole where the site is. Turn Go Live off, or switch on "Skip live-screen prep", then export again.',
    };
  }
  if (!screenMaterialRestored) {
    return {
      action: 'stop',
      message: 'The device screen is still showing the live-mode cut-out material — stopping rather than recording a transparent hole. Turn Go Live off, then export again.',
    };
  }
  if (screenCaptureError) {
    const where = screenCaptureError.url ? ` (${screenCaptureError.url})` : '';
    const foreign = screenCaptureError.reason === 'foreign'
      ? ' That reference is not the studio\'s own capture route, so it can never load here.'
      : '';
    return {
      action: 'stop',
      message: `The captured screen image could not be loaded${where}.${foreign} Re-run CAPTURE under Go Live, then export again — exporting now would record the placeholder site instead of your website.`,
    };
  }
  if (wantsCapturedScreen && !capturedTextureApplied) {
    return {
      action: 'stop',
      message: 'The captured screen never became the device screen in time — stopping rather than recording the placeholder site instead of your website. Try the export again.',
    };
  }
  return {
    action: 'proceed',
    message: 'The live screen did not settle in time, but nothing wrong is on screen — exporting with what the screen currently shows.',
  };
}

// ── Device-screen SOURCE resolution planner (Interrupted export recovery,
// Phase A) ───────────────────────────────────────────────────────────────
// Pure, priority-ordered classification of a device-primary scene's screen
// SOURCE. This is the shared decision boundary ClothStudio.jsx's
// `pinDeviceScreenIfNeeded` (the ONE preparation path used by BOTH Proof and
// Final Render) consults before doing any fetch/setState — no DOM/fetch/
// THREE access here at all, every input is a plain value.
//
// Priority mirrors the factory's own deviceWantedScreenSource contract
// EXACTLY (factories.js: uploadAssetId is checked before captureUrl — an
// uploaded image wins if somehow both are set) plus the pinned-still
// short-circuit and the case-D auto-capture gap this workstream closes:
//   screenStill > uploadAssetId > captureUrl(-if-trustworthy) > (live && liveUrl) > none
//
// Returns { steps: [...] } — an ORDERED array that always ends in 'proceed'.
// Step kinds:
//   'not-device'     — non-device scene (or missing devicePrimary); no-op,
//                       nothing to prepare.
//   'use-live'       — Final Render ONLY (`preferLiveForFinalRender:true`,
//                       see below): live is active and wins outright — the
//                       caller submits devicePrimary.live/liveUrl through to
//                       the job UNCHANGED (still clearing stale raw
//                       capture/upload fields) instead of pinning a still.
//   'use-still'      — already pinned; the caller clears stale raw source
//                       fields and proceeds (F2b hardening, preserved).
//   'use-upload'     — uploadAssetId already present; fetch+pin those bytes.
//   'use-capture'    — captureUrl already present AND trustworthy; fetch+pin
//                       those bytes.
//   'obtain-capture' — live/liveUrl with NO trustworthy capture (either the
//                       gap Phase A closed — no captureUrl at all — or
//                       Recovery round 2's Defect 1: a captureUrl exists but
//                       isn't of THIS live URL/viewport, or carries no
//                       provenance at all): a same-origin capture must be
//                       OBTAINED before anything else in this preparation
//                       can run.
//   'use-none'       — no source at all; the placeholder is the honest,
//                       supported server-side render — not an error.
//   'proceed'        — always last; safe to run the caller's next step.
//
// The hard invariant the tests assert: whenever 'obtain-capture' appears it
// is ALWAYS steps[0] — nothing else in this preparation (reading upload
// bytes, fetching capture bytes, submitting a pin) can happen before a
// capture is successfully obtained. The same holds for 'use-live'.
//
// Recovery round 2 (Defect 1): a captureUrl is only "trustworthy" while
// Live is active when its own recorded provenance (`captureSourceUrl`/
// `captureViewport`, written at every site that sets `captureUrl` — see
// DeviceScreenControl.jsx and ClothStudio.jsx) matches the CURRENT
// `liveUrl`/`viewport` exactly. Absent provenance (a legacy capture saved
// before this round) never matches — it is treated exactly like having no
// capture at all, so a fresh one is obtained rather than pinning stale
// content while Live is active. When Live is NOT active, an explicit
// Capture/upload selection is used exactly as before, regardless of
// provenance — the user picked it deliberately with no live site to
// conflict with.
//
// ── Final Render live-URL precedence (STUDIO-DETERMINISTIC-FINAL-RENDER-
// SONNET-HANDOFF.md, "Live URL wired to Final Render" wiring round) ───────
// The server render pipeline now genuinely captures and renders a real live
// URL (`device-screen-live` capability lifted — see art-render-validation.mjs)
// instead of only supporting one pinned still. `preferLiveForFinalRender`
// (default false — every EXISTING caller, including Proof and Quick
// Export's own guard, is unaffected) lets Final Render's own pin-before-
// submit path opt into a different precedence: when it is true AND live is
// active, 'use-live' is returned BEFORE the screenStill/upload/capture
// checks below — an explicitly active Live URL always wins for Final
// Render, even over a coexisting (possibly stale) captureUrl/uploadAssetId,
// so the caller never routes a live-URL scene through the slow, Browserless-
// backed pin-to-still path (the 2.8-minute-502 dead end) when the more
// capable direct path exists. Proof Render and Quick Export never pass this
// flag — Proof stays a small/fast deterministic check (a multi-second-plus
// live capture doesn't belong in a "quick sanity check"), and Quick Export's
// browser `captureStream()` still cannot record a live iframe at all, so it
// still needs a pinned/captured texture exactly as before. When
// `preferLiveForFinalRender` is true but live is NOT active, every case
// below behaves exactly as it always has (screenStill/upload/capture pin as
// today) — this flag only ever changes behavior for the live-active case.
export function planDeviceScreenSteps({ clothShape, devicePrimary, preferLiveForFinalRender = false }) {
  if (clothShape !== 'device' || !devicePrimary) return { steps: ['not-device', 'proceed'] };
  const dp = devicePrimary;
  const liveActive = Boolean(dp.live) && Boolean(dp.liveUrl);
  if (preferLiveForFinalRender && liveActive) return { steps: ['use-live', 'proceed'] };
  if (dp.screenStill) return { steps: ['use-still', 'proceed'] };
  if (dp.uploadAssetId) return { steps: ['use-upload', 'proceed'] };
  if (dp.captureUrl) {
    const captureMatchesLive = dp.captureSourceUrl === dp.liveUrl && dp.captureViewport === dp.viewport;
    if (!liveActive || captureMatchesLive) return { steps: ['use-capture', 'proceed'] };
    // Live is active and this capture is of a DIFFERENT site/viewport (or
    // carries no provenance) — never trust it; fall through exactly as if
    // there were no capture at all.
  }
  if (liveActive) return { steps: ['obtain-capture', 'proceed'] };
  return { steps: ['use-none', 'proceed'] };
}

// ── Live-resume decision (Recovery round 2, Defect 1's secondary
// contributor — "Live is deliberately NOT auto-resumed") ──────────────────
// runExportWithLiveGuard pauses Live (sets `live:false`) so the captured/
// obtained screen can be recorded instead of the live iframe hole. Leaving
// it paused forever independently reads as "the live URL fell off" — this
// is the pure decision for whether ClothStudio.jsx's resumeLiveAfterExport
// glue should turn Live back on once an export attempt has fully settled
// (success, cancel, OR any failure — this function does not know or care
// which; the caller invokes it identically on every exit path once the
// export lifecycle is done). `pending` is the snapshot the guard recorded
// at the moment it paused Live (`{ liveUrl, captureUrlAtPause,
// uploadAssetIdAtPause }`, or null when nothing was paused for this
// attempt — the guard's own 'proceed' verdict, or an already-consumed
// resume). Never resumes if:
//   - nothing was paused (`pending` is null/falsy) — nothing to resume;
//   - the component unmounted (`mounted:false`) — never touch state after
//     unmount, and there is nothing left to show a resumed screen on;
//   - the user already re-enabled Go Live themselves (`currentLive:true`)
//     during the export — never stomp their own choice, whatever URL they
//     committed;
//   - the screen SOURCE changed mid-export (a different capture, a new
//     upload, or "Use placeholder" — `currentCaptureUrl`/
//     `currentUploadAssetId` no longer match what the guard paused with).
// Otherwise resumes to the exact `liveUrl` that was paused.
export function shouldResumeLiveAfterExport({
  mounted, pending, currentCaptureUrl, currentUploadAssetId, currentLive,
}) {
  if (!mounted) return false;
  if (!pending) return false;
  if (currentLive) return false;
  if (currentCaptureUrl !== pending.captureUrlAtPause) return false;
  if (currentUploadAssetId !== pending.uploadAssetIdAtPause) return false;
  return true;
}

// ── Stranded hole-material invariant (backstop, NOT the fix) ─────────────
// The device screen mesh must NEVER carry the live-mode alpha-punch cut-out
// material while no live iframe is actually up — that combination renders
// as a permanent transparent hole (the render loop's uCleanAlphaHole/hole
// material contract assumes an iframe sits behind the punched-out region;
// with no iframe there is nothing there at all). Every code path that ends
// live mode is SUPPOSED to restore the factory's own textured material in
// the same breath it drops the iframe (teardownLiveScreenNow, module scope
// in ClothStudio.jsx, is the one shared implementation every path — the
// live-screen effect's own cleanup, the export guard's synchronous pause,
// the teardown deadline, cancel, and every export error path — funnels
// through). This is the cheap per-frame check that catches it if one of
// them doesn't, called from the render loop (which runs regardless of
// React's own effect timing) so it is immune to whatever exact sequence let
// the mesh material and the "is Live actually up" signal drift apart. Pure
// and unit-tested on purpose — the decision needs no THREE.js/DOM to verify,
// only three property reads the caller already has on hand every frame:
//   - `deviceLiveActive` — Boolean(world.deviceLive), the ONE authoritative
//     "is a live iframe actually up right now" signal (never devicePrimary.
//     live, which can be true in React state for a frame or two before the
//     effect that owns the iframe has caught up).
//   - `meshMaterial` — the screen mesh's CURRENT material.
//   - `factoryMaterial` — the factory's own textured material for this
//     device (userData.screenMaterial) — the only material a non-live
//     screen may ever show.
// Never fires while genuinely live (the hole IS correct then), and never
// fires when there is nothing to compare (mesh/material not built yet).
export function isScreenMaterialStranded({ deviceLiveActive, meshMaterial, factoryMaterial }) {
  if (deviceLiveActive) return false;
  if (!meshMaterial || !factoryMaterial) return false;
  return meshMaterial !== factoryMaterial;
}
