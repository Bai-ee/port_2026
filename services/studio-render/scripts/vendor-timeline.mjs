#!/usr/bin/env node
// vendor-timeline.mjs — Phase C correction (STUDIO-DETERMINISTIC-FINAL-
// RENDER-SONNET-HANDOFF.md, "exact smoothstep-eased parity" checkpoint).
// Vendors `app/dashboard/studio/timeline.js` — a standalone, zero-import,
// pure ESM module — into `services/studio-render/vendor/timeline.js`, so
// `art-scene.mjs`'s generated render page can `import { resolveTrackState }
// from './timeline.js'` and reuse the EXACT straddling-pair/smoothstep
// resolver the live client's `stepTimelinePlayback` calls, rather than
// re-implementing (and risking drifting from) its easing/edge-case math.
//
// Same "committed mirror, byte-copied, drift-tested" discipline as
// scripts/vendor-diffusion-camera.mjs's own diffusion-focus.js half (this
// file just isn't UNDER elements/, so it can't ride vendor-elements.mjs's
// fixed SOURCE_DIR, and it isn't extracted from a JSX component, so it
// doesn't need vendor-scene-presets.mjs's extractConstObject either) — see
// that script's own header for the fuller precedent list.
//
// Only `resolveTrackState` is actually imported by art-scene.mjs (it
// already returns the smoothstep-EASED `blend` field directly — no need to
// separately vendor the private, unexported `smoothstep` helper timeline.js
// uses internally). The whole file is still byte-copied rather than an
// extracted single export: timeline.js is small, self-contained, and this
// keeps the vendored copy trivially diffable against its real source
// (same reasoning vendor-elements.mjs gives for copying whole files instead
// of hand-extracting individual functions).

import { existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = path.resolve(__dirname, '..');
const TIMELINE_SOURCE = path.resolve(SERVICE_DIR, '../../app/dashboard/studio/timeline.js');
export const TIMELINE_TARGET = path.resolve(SERVICE_DIR, 'vendor/timeline.js');

/**
 * Runs the vendoring step. `log` defaults to a no-op (tests can call this
 * silently); the CLI invocation below passes console.log.
 */
export function vendorTimeline({ log = () => {} } = {}) {
  if (!existsSync(TIMELINE_SOURCE)) {
    throw new Error(`vendor-timeline: source file missing: ${TIMELINE_SOURCE}`);
  }
  copyFileSync(TIMELINE_SOURCE, TIMELINE_TARGET);
  log(`vendored timeline.js -> ${TIMELINE_TARGET}`);
  return { source: TIMELINE_SOURCE, target: TIMELINE_TARGET };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  vendorTimeline({ log: (msg) => console.log(msg) });
}
