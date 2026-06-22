'use strict';

// The new-signup video template. Every signup's onboarding video is rendered
// from ONE recipe; this module persists that recipe (Firestore config doc) and
// resolves it for the worker. Authoring happens in the Mockup Studio ("Set as
// new-signup default"); rendering happens in run-brief via getSignupVideoRecipe.
//
// The render service (services/studio-render/recipe.mjs → normalizeRecipe) is
// the source of truth for clamping and re-normalizes every recipe at render
// time. We still sanitize here so the STORED config stays clean and the admin
// UI reads back valid values. Allowed-value lists below mirror recipe.mjs.

const fb = require('./firebase-admin.cjs');
const { buildLockedStudioRecipe } = require('./studio-render-core.cjs');

const CONFIG_COLLECTION = 'config';
const CONFIG_DOC = 'signupVideoRecipe';

// Mirror of recipe.mjs CAMERA_PRESETS keys / allowed option lists. Keep in sync.
const KNOWN_PRESETS = ['push-in-hold', 'push-rotate-flat', 'orbit-reveal'];
const VIEWPORTS = ['desktop', 'mobile', 'tablet'];
const ENV_MODES = ['preset', 'color', 'site', 'gradient'];
const ENV_PRESETS = ['airport-terminal', 'desk', 'studio', 'loft', 'sunset'];

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function configDocRef() {
  return fb.adminDb.collection(CONFIG_COLLECTION).doc(CONFIG_DOC);
}

// The built-in fallback recipe WITHOUT a url (the locked launch config).
function builtinDefaultRecipe() {
  const { url, ...rest } = buildLockedStudioRecipe('');
  void url;
  return rest;
}

// Sanitize a raw recipe into a clean, bounded template — NO url (it's injected
// per signup). Unknown fields are dropped; out-of-range scalars are clamped.
function sanitizeRecipe(input) {
  const r = input || {};
  const out = {
    preset: KNOWN_PRESETS.includes(r.preset) ? r.preset : 'push-rotate-flat',
    output: {
      seconds: clamp(r.output?.seconds, 2, 12, 8),
      fps: clamp(r.output?.fps, 24, 30, 30),
      width: clamp(r.output?.width, 640, 2560, 1920),
      height: clamp(r.output?.height, 360, 1600, 1200),
    },
    device: {
      viewport: VIEWPORTS.includes(r.device?.viewport) ? r.device.viewport : 'desktop',
      backdrop: String(r.device?.backdrop || 'home').slice(0, 20),
      loop: r.device?.loop !== false,
    },
    environment: {
      mode: ENV_MODES.includes(r.environment?.mode) ? r.environment.mode : 'gradient',
      preset: ENV_PRESETS.includes(r.environment?.preset) ? r.environment.preset : 'studio',
      color: String(r.environment?.color || '#11141a').slice(0, 20),
      blur: clamp(r.environment?.blur, 0, 48, 0),
      reflections: r.environment?.reflections !== false,
    },
    capture: { warmupMs: clamp(r.capture?.warmupMs, 0, 5000, 1000) },
  };

  // Optional custom camera track (>=2 keyframes) — lets the Studio author a shot
  // beyond the named presets. The render service re-clamps each pose.
  if (Array.isArray(r.cameraTrack) && r.cameraTrack.length >= 2) {
    out.cameraTrack = r.cameraTrack
      .filter((k) => k && Array.isArray(k.pose))
      .map((k) => ({
        t: clamp(k.t, 0, 1, 0),
        pose: [
          clamp(k.pose[0], 0.2, 3, 1),
          clamp(k.pose[1], -180, 180, 0),
          clamp(k.pose[2], -89, 89, 0),
          clamp(k.pose[3], -1, 1, 0),
          clamp(k.pose[4], -1, 1, 0),
        ],
      }))
      .sort((a, b) => a.t - b.t);
    if (out.cameraTrack.length < 2) delete out.cameraTrack;
  }

  // Optional scroll target passthrough (light validation; service re-normalizes).
  if (r.scroll && typeof r.scroll === 'object') {
    const t = r.scroll.target || {};
    const target = {};
    if (t.selector) target.selector = String(t.selector).slice(0, 200);
    if (t.text) target.text = String(t.text).slice(0, 120);
    if (t.percent != null) target.percent = clamp(t.percent, 0, 100, 55);
    out.scroll = {
      target,
      startAt: clamp(r.scroll.startAt, 0, 1, 0.25),
      arriveAt: clamp(r.scroll.arriveAt, 0, 1, 0.85),
      align: r.scroll.align === 'top' ? 'top' : 'center',
    };
  }

  return out;
}

// Resolve the recipe for a signup render: stored custom template if present and
// valid, else the built-in locked recipe. Always returns a recipe WITH the url.
async function getSignupVideoRecipe(url) {
  try {
    const snap = await configDocRef().get();
    const stored = snap.exists ? snap.data()?.recipe : null;
    if (stored && typeof stored === 'object') {
      return { ...sanitizeRecipe(stored), url };
    }
  } catch (err) {
    // Never block a signup render on config read — fall back to the locked recipe.
    console.warn(`[signup-video-recipe] config read failed, using built-in default: ${err?.message || err}`);
  }
  return buildLockedStudioRecipe(url);
}

// Read the current config for the admin UI: the stored template (or the built-in
// default) plus provenance. Recipe is returned WITHOUT a url.
async function readSignupRecipeConfig() {
  try {
    const snap = await configDocRef().get();
    if (snap.exists && snap.data()?.recipe) {
      const data = snap.data();
      return {
        recipe: sanitizeRecipe(data.recipe),
        source: 'custom',
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null,
      };
    }
  } catch (err) {
    console.warn(`[signup-video-recipe] config read failed: ${err?.message || err}`);
  }
  return { recipe: builtinDefaultRecipe(), source: 'default', updatedAt: null, updatedBy: null };
}

// Persist a new default template (admin). Sanitizes, stores, returns the config.
async function writeSignupRecipeConfig(rawRecipe, { email } = {}) {
  const recipe = sanitizeRecipe(rawRecipe);
  const updatedAt = new Date().toISOString();
  await configDocRef().set(
    { recipe, updatedAt, updatedBy: email || null },
    { merge: true }
  );
  return { recipe, source: 'custom', updatedAt, updatedBy: email || null };
}

module.exports = {
  getSignupVideoRecipe,
  readSignupRecipeConfig,
  writeSignupRecipeConfig,
  sanitizeRecipe,
  builtinDefaultRecipe,
};
