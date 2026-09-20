// Invoice Studio HoloPaper — DOM-to-texture snapshot pipeline (handoff §4,
// docs/plans/INVOICE-STUDIO-HOLOPAPER-HANDOFF.md). Lane R.
//
// Source of truth stays `renderInvoiceDocument()` (features/invoices/render.js)
// and the live `#invoice-studio-preview-frame` iframe it fills — this module
// NEVER builds a second invoice layout. It only clones the already-rendered
// iframe DOM, strips editor-only scaffolding, and rasterizes the clone into a
// plain `<canvas>` the Holo scene can hand to `THREE.CanvasTexture`.
//
// Split the way identity/svg-sanitizer.js splits POLICY from DRIVER (that
// file's own header comment explains why: this repo's `node --test` has no
// DOM):
//   (a) POLICY — pure functions with no DOM dependency (size/downsample math,
//       the generation-token "latest-wins" gate, the stripped-element rules,
//       the bounded-wait helper, failure/success shaping). Directly
//       unit-tested with node:test; see __tests__/invoice-dom-snapshot.test.js.
//   (b) DRIVER — captureInvoiceSnapshot(), which reads a real iframe's
//       contentDocument, clones/strips/serializes it, and rasterizes via
//       SVG<foreignObject> -> <img> -> <canvas>. Browser-only, verified by
//       hand (see this lane's handoff report for the exact real-browser
//       checks run against localhost:3000/dashboard/studio?tool=invoice).
//
// ── Real-browser proof (2026-09-04, Chrome via claude-in-chrome, live dev
// server) — see the handoff report for full detail: ─────────────────────────
//   - `<img src="data:image/svg+xml;base64,...">` of a foreignObject clone,
//     drawn to canvas, is NOT tainted (toDataURL/getImageData both succeed)
//     and reproduces layout/colors/QR/logo/theme CSS correctly across
//     Default, Ledger, and Studio Dark (Editorial not separately re-checked;
//     same rendering path, no reason to expect a divergent result).
//   - `<img src="blob:...">` of the SAME markup DOES taint the canvas
//     (SecurityError on toDataURL) — this is why the driver below uses a
//     base64 `data:` URI, never a Blob URL, for the rasterizing <img>.
//   - Custom webfonts (Doto/Space Grotesk/Space Mono, and Ledger/Editorial's
//     IBM Plex Mono/Playfair Display) do NOT apply inside the rasterized
//     image — confirmed three independent ways: (1) the external Google
//     Fonts <link> already in the document, (2) an inline @font-face with a
//     base64-embedded woff2 `src`, and (3) the same embedded-font case
//     redrawn 800ms later in case of a decode race. All three fall back to
//     the CSS's own generic fallback (monospace/sans-serif/serif) — legible,
//     structurally correct, just not brand-accurate. This is a hard
//     limitation of rasterizing a foreignObject through an `<img>` in this
//     browser, not a bug in this driver's own font handling.
//   - The plan's pre-authorized escape-hatch dependency (`html-to-image`,
//     the exact package/version this lane installed for the trial:
//     1.11.13) was tried against the SAME live iframe content in the SAME
//     browser and reliably hung: 4 separate `toCanvas()` calls (full-page
//     scope, iframe-scoped `doc.body`, `skipFonts:true` + `fontEmbedCss:''`,
//     and a TRIVIAL single-<div> node with no images/custom fonts at all)
//     each failed to resolve within 8-58+ seconds, with no console error.
//     A dependency that cannot reliably complete violates this pipeline's
//     harder, non-negotiable constraints (H12: latest-wins, never blocks,
//     never blanks the document, <=1 capture/250ms) far more severely than
//     losing brand-font fidelity does. Given the ONE library the plan named
//     as an example failed real-environment testing, this lane did NOT add
//     it (or any other dependency) — see the final report for the full
//     documented decision.
//
// Net result: the native path below is fast (single-digit milliseconds to
// draw once the source image loads), reliable, and preserves everything
// except brand webfonts (which degrade to their own CSS generic fallback,
// still legible). No new dependency was required or added.

// ── (a) POLICY — pure, no DOM ───────────────────────────────────────────────

// Decorative presentation texture, not a print asset (handoff §4 — "cap to a
// documented, reasonable pixel budget"). 4096 is a safe floor for real GPU
// max-texture-size limits, but this ships at 2048 on the long axis: the
// front+back mirrored cloth material (Lane S) needs two such textures live
// at once, a 2048x2048 RGBA canvas is already ~16MB of GPU memory, and a
// cloth viewed at typical Studio proportions does not benefit from more
// resolution than that — it only costs more per-capture canvas-paint time,
// which directly eats into the <=250ms debounce budget below.
export const MAX_TEXTURE_DIMENSION = 2048;

// Bounded waits. FONTS_READY_TIMEOUT_MS mirrors InvoiceCanvas.jsx's own
// handlePrint(), which awaits the iframe's document.fonts.ready the same
// way before printing. The other two bound steps this driver introduces
// that handlePrint does not have: per-<img> decode() and the rasterizing
// <img>'s own load event — both exist so a stalled font/image/browser can
// never hang a capture forever (H12's "never blocks" reading applies to the
// texture pipeline exactly as much as it does to Print).
export const FONTS_READY_TIMEOUT_MS = 1500;
export const IMAGE_DECODE_TIMEOUT_MS = 1200;
export const SVG_LOAD_TIMEOUT_MS = 2000;

export const DEFAULT_DEBOUNCE_MS = 250;

// Editor-only artifacts stripped from the CLONE before rasterization.
// Mirrors InvoiceCanvas.jsx's own handleDownloadHtml, which strips exactly
// the same two things (contenteditable + the bridge highlight <style>) for
// exactly the same reason (a clean, non-editing-surface copy of the live
// document) — plus this driver additionally strips any <script> (render.js
// never injects one — see that file's own header comment — but the check
// costs nothing and is a meaningful defensive floor for a texture pipeline
// that must never execute injected/third-party script) and the optional PDF
// download control (render.js's `#invoice-pdf-download-link`, emitted only
// when `options.pdfPath` is set — never relevant to a Studio canvas capture).
//
// `data-inv-*` annotations (field/type/raw/derived/section/row) are
// deliberately LEFT IN PLACE: they carry no visual effect on their own (no
// CSS in INVOICE_CSS/BRIEF_CSS selects on them) once the bridge's own
// highlight <style> above is removed — the highlight style is the only
// thing that ever gave them a visual presence. Stripping them would just be
// extra DOM-walking work for zero visual benefit.
export const STRIP_IDS = Object.freeze([
  'invoice-bridge-canvas-highlight-style',
  'invoice-pdf-download-link',
]);
export const STRIP_SELECTORS = Object.freeze(['script']);
export const STRIP_ATTRIBUTES = Object.freeze(['contenteditable']);

export function shouldStripElementId(id) {
  return STRIP_IDS.includes(String(id ?? ''));
}

export function shouldStripSelector(selector) {
  return STRIP_SELECTORS.includes(String(selector ?? ''));
}

export function shouldStripAttribute(attrName) {
  return STRIP_ATTRIBUTES.includes(String(attrName ?? ''));
}

// Aspect-preserving downsample math. Never crops: both axes always scale by
// the SAME factor, so the returned box is geometrically similar to the
// input. scale === 1 (no-op) whenever the content already fits the budget.
export function computeCaptureSize(width, height, maxDimension = MAX_TEXTURE_DIMENSION) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const cap = Number(maxDimension);
  const longest = Math.max(w, h);
  if (!Number.isFinite(cap) || cap <= 0 || longest <= cap) {
    return { width: w, height: h, scale: 1 };
  }
  const scale = cap / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  };
}

// ── Generation-token "latest-wins" gate ─────────────────────────────────────
// A fresh capture calls begin() and gets back a token; when that capture's
// async work resolves, the caller checks isCurrent(token) before applying
// the result. Any capture that isn't the most recently begun one is stale
// and its result is discarded — this is what makes a slow older capture
// unable to clobber a newer one's result (H12), without needing real
// cancellation (drawImage/decode() aren't cancelable anyway).
export function createCaptureGate() {
  let latest = 0;
  return {
    begin() {
      latest += 1;
      return latest;
    },
    isCurrent(token) {
      return token === latest;
    },
    current() {
      return latest;
    },
  };
}

// Normalizes a failure/success into a stable shape — mirrors
// identity/svg-sanitizer.js's own `{ok:false, reason}` contract so a caller
// (useInvoiceTexture.js) never has to guess whether a rejected promise vs a
// resolved-with-ok:false object is in play; this driver never throws/rejects
// (see captureInvoiceSnapshot's own doc comment).
export function captureFailure(reason) {
  return { ok: false, reason: String(reason || 'Snapshot failed.') };
}

export function captureSuccessResult(source, width, height) {
  return { ok: true, source, width, height };
}

// Races a promise against a bounded timeout WITHOUT ever rejecting — a
// timed-out or rejected wait resolves `{timedOut:true}` / the underlying
// value is dropped, so a caller can always just "proceed with whatever is
// ready" rather than needing its own try/catch around every bounded step.
// Timer functions are injectable so the debounce/timeout math is directly
// testable with a fake clock (no real waiting, no DOM) — see the test file.
export function withTimeout(promiseLike, ms, { setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeoutFn(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true, value: undefined });
    }, ms);
    Promise.resolve(promiseLike).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeoutFn(timer);
        resolve({ timedOut: false, value });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeoutFn(timer);
        resolve({ timedOut: false, value: undefined });
      },
    );
  });
}

// Trailing-edge debounce scheduler: each schedule() call restarts the
// window, so only the last call within `delayMs` of quiet actually runs
// `fn`. Pure aside from injected timer functions — directly testable by
// injecting a fake setTimeout/clearTimeout and firing the recorded callback
// by hand (no real waiting). Used by useInvoiceTexture.js to hold captures
// to "no more than one per debounceMs" during rapid refreshKey churn
// (handoff §4's own target).
export function createDebouncedScheduler(fn, delayMs, { setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  let timer = null;
  return {
    schedule() {
      if (timer != null) clearTimeoutFn(timer);
      timer = setTimeoutFn(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    cancel() {
      if (timer != null) {
        clearTimeoutFn(timer);
        timer = null;
      }
    },
    get pending() {
      return timer != null;
    },
  };
}

// ── (b) DOM-walking driver ───────────────────────────────────────────────
// Browser-only. Mutates ONLY the detached clone passed in — never the live
// iframe document (the caller guarantees `rootEl` is a cloneNode(true)
// result, never the original).
export function stripEditorArtifacts(rootEl) {
  if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return rootEl;
  STRIP_ATTRIBUTES.forEach((attr) => {
    rootEl.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
  });
  STRIP_SELECTORS.forEach((sel) => {
    rootEl.querySelectorAll(sel).forEach((el) => el.remove());
  });
  STRIP_IDS.forEach((id) => {
    const match = rootEl.id === id ? rootEl : rootEl.querySelector(`#${CSS && CSS.escape ? CSS.escape(id) : id}`);
    if (match) match.remove();
  });
  return rootEl;
}

// Captures the CURRENT state of `iframeEl.contentDocument` (the live Invoice
// Studio canvas — see InvoiceCanvas.jsx) into a plain `<canvas>`. Never
// throws: every failure path returns `captureFailure(reason)` instead, so a
// caller can treat this function's resolution as the complete outcome.
//
// Steps (handoff §4): await the LIVE document's own fonts.ready (bounded) ->
// clone documentElement (never mutate the live doc) -> strip editor-only
// artifacts from the clone -> bound decode() on every cloned <img> -> embed
// the clone in an SVG <foreignObject> -> rasterize via a base64 `data:` <img>
// (never a Blob URL — see the taint note above) -> draw to a budget-capped,
// aspect-preserving canvas.
export async function captureInvoiceSnapshot(iframeEl, options = {}) {
  const {
    maxDimension = MAX_TEXTURE_DIMENSION,
    fontsTimeoutMs = FONTS_READY_TIMEOUT_MS,
    imageDecodeTimeoutMs = IMAGE_DECODE_TIMEOUT_MS,
    svgLoadTimeoutMs = SVG_LOAD_TIMEOUT_MS,
  } = options;

  if (typeof document === 'undefined' || typeof window === 'undefined' || typeof Image === 'undefined') {
    return captureFailure('Snapshot requires a browser environment.');
  }
  if (!iframeEl) return captureFailure('No invoice preview frame to capture.');

  let liveDoc = null;
  try {
    liveDoc = iframeEl.contentDocument;
  } catch {
    liveDoc = null;
  }
  if (!liveDoc || !liveDoc.documentElement) {
    return captureFailure('Invoice document is not ready yet.');
  }

  if (liveDoc.fonts && typeof liveDoc.fonts.ready?.then === 'function') {
    await withTimeout(liveDoc.fonts.ready, fontsTimeoutMs);
  }

  const sourceWidth = liveDoc.documentElement.scrollWidth
    || (liveDoc.body && liveDoc.body.scrollWidth) || 0;
  const sourceHeight = liveDoc.documentElement.scrollHeight
    || (liveDoc.body && liveDoc.body.scrollHeight) || 0;
  if (!sourceWidth || !sourceHeight) {
    return captureFailure('Invoice document has no visible content to capture.');
  }

  let clone;
  try {
    clone = liveDoc.documentElement.cloneNode(true);
  } catch (err) {
    return captureFailure(`Could not clone the invoice document: ${(err && err.message) || err}`);
  }
  stripEditorArtifacts(clone);

  const images = Array.from(clone.querySelectorAll('img'));
  await Promise.all(images.map((img) => withTimeout(
    typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve(),
    imageDecodeTimeoutMs,
  )));

  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  let xhtml;
  try {
    xhtml = new XMLSerializer().serializeToString(clone);
  } catch (err) {
    return captureFailure(`Could not serialize the invoice document: ${(err && err.message) || err}`);
  }

  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${sourceWidth}" height="${sourceHeight}">`
    + `<foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;

  let svgUrl;
  try {
    svgUrl = `data:image/svg+xml;charset=utf-8;base64,${window.btoa(unescape(encodeURIComponent(svgMarkup)))}`;
  } catch (err) {
    return captureFailure(`Could not encode the invoice snapshot: ${(err && err.message) || err}`);
  }

  const loadResult = await withTimeout(
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = svgUrl;
    }),
    svgLoadTimeoutMs,
  );
  if (loadResult.timedOut || !loadResult.value) {
    return captureFailure('The invoice snapshot image failed to load in time.');
  }
  const image = loadResult.value;

  const { width: outWidth, height: outHeight } = computeCaptureSize(sourceWidth, sourceHeight, maxDimension);
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return captureFailure('2D canvas context unavailable.');

  try {
    ctx.drawImage(image, 0, 0, outWidth, outHeight);
  } catch (err) {
    return captureFailure(`Could not draw the invoice snapshot: ${(err && err.message) || err}`);
  }

  // A tainted canvas throws only when its pixels are actually read/exported
  // (toDataURL/getImageData/WebGL texImage2D) — drawImage above can succeed
  // silently even on a tainted source. Confirm export safety NOW, while this
  // driver can still report an honest failure, rather than letting Lane S's
  // scene discover it later as an opaque WebGL upload error.
  try {
    ctx.getImageData(0, 0, 1, 1);
  } catch {
    return captureFailure('The invoice snapshot could not be exported (tainted canvas).');
  }

  return captureSuccessResult(canvas, outWidth, outHeight);
}

export default captureInvoiceSnapshot;
