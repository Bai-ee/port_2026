// studio-templates.cjs — Slice 3 (Cloud Template Persistence) of the Studio
// roadmap (docs/plans/STUDIO-ROADMAP-NEXT-PHASE-SONNET-HANDOFF.md). Moves
// Scene/Element/Look/Render templates from local-only (localStorage,
// app/dashboard/studio/elements/{templates,preset-kinds}.js) into
// authenticated cloud storage, while local storage keeps working unchanged
// (this module never reads/writes localStorage; that stays entirely a
// client-side concern — see ClothStudio.jsx's own loadSaved*/*PresetsKey
// effects, untouched by this slice).
//
// One Firestore collection, all four kinds, discriminated by `kind`:
//   studio_templates/{id}
//
// Fields (every doc):
//   id            doc id (self-assigned, see makeId)
//   schemaVersion 1
//   kind          'scene' | 'element' | 'look' | 'render'
//   scope         'user' | 'client' | 'global'
//   ownerUid      uid of the creator — server-controlled, never trusts the caller's value
//   clientId      owning client, or null iff scope==='global'
//   name          user-facing label
//   recipe        kind-specific payload — see validateAndSanitizeRecipe
//   sourceSeed    optional numeric seed the recipe was captured at (sceneSeed/
//                 lookSeed/camSeed as applicable) — null if not supplied
//   thumbnailPath always null this slice — no thumbnail upload system exists;
//                 the field exists so a later phase can populate it without a
//                 schema change
//   archived      soft-delete flag — same non-destructive precedent as the
//                 local templates.js module (duplicate/rename/ARCHIVE/export/
//                 import, never a hard delete)
//   version       starts at 1 on create; every explicit update increments it
//   createdAt / updatedAt   ISO strings (server-controlled)
//   createdAtTs / updatedAtTs  serverTimestamp() companions, for ordering
//
// ── Authorization model ─────────────────────────────────────────────────────
// Every read/write is authorized SERVER-SIDE against the caller's
// { clientId, uid, isAdmin } (resolved upstream via verifyRequestUser +
// getEffectiveClientContext — this module never trusts a client-supplied
// ownerUid/clientId/scope/version/timestamp):
//
//   scope 'global'  — readable by everyone; writable (create/update/archive/
//                     unarchive/promote/demote) only when isAdmin === true.
//   scope 'client'  — readable/writable by any caller whose clientId matches
//                     the doc's clientId. No finer-grained per-user role
//                     exists in this codebase, so "same client" is the whole
//                     check, matching how every other client-scoped
//                     Firestore read in this repo already works (see
//                     api/_lib/studio-render-jobs.cjs getRenderJob: "return
//                     null if missing/foreign", the same idiom used here).
//   scope 'user'    — readable/writable only by the exact ownerUid, AND only
//                     within their own clientId (a user scope template is
//                     strictly a subset of that client's data).
//
// A request for a template outside the caller's read scope gets exactly the
// same 404 a genuinely-missing id would — existence of another tenant's
// private template is never leaked. A template the caller CAN read but not
// WRITE (a Global template, to a non-admin) gets 403 — Global templates are
// intentionally public knowledge, so there is nothing to hide there.
//
// ── Query strategy ───────────────────────────────────────────────────────
// Every Firestore query below uses AT MOST one `where(field, '==', value)` —
// deliberately, to need only Firestore's automatic single-field indexes,
// never a composite index this slice would have to remember to provision
// (matching this repo's existing "avoid composite indexes" precedent, e.g.
// docs/source-of-truth/SITE-RECREATE-CARD.md's own no-composite-index rule).
// `kind`/`archived`/per-scope ownership filtering all happen in application
// code after a broader single-field fetch — safe here because result sets
// are bounded (LIST_FETCH_LIMIT) and per-tenant, not a full-collection scan.

const { randomUUID } = require('crypto');
const realFb = require('./firebase-admin.cjs');

const COLLECTION = 'studio_templates';
const SCHEMA_VERSION = 1;
const KINDS = ['scene', 'element', 'look', 'render'];
const SCOPES = ['user', 'client', 'global'];
const MAX_NAME_LENGTH = 60;
// Generous single-field-query fetch cap, not a per-tenant display cap — see
// "Query strategy" above. Real per-tenant lists are filtered down from this
// in memory and are expected to be far smaller in practice.
const LIST_FETCH_LIMIT = 500;

// --- test seam --------------------------------------------------------------
// Same pattern as media-jobs.cjs/studio-render-jobs.cjs: every Firestore call
// site goes through ctx() so tests can inject an in-memory fake
// (api/_lib/__tests__/fake-firestore.cjs) without a live project. In
// production ctx() resolves to the real firebase-admin module.
let _ctx = null;
function __setTestContext(ctx) { _ctx = ctx; }
function ctx() { return _ctx || realFb; }

// --- ESM interop for the existing client-side sanitizers -------------------
// elements/preset-kinds.js and elements/scene-recipe.js are ES modules
// (this repo's root package.json is "type":"module"; api/_lib/*.cjs is the
// explicit CommonJS escape hatch) — `require()` cannot load them
// synchronously, so this loader dynamic-`import()`s them once and caches the
// result. Verified working in this exact repo layout before writing this
// module (dynamic import of these three files from a plain Node script
// resolved every named export cleanly).
let _studioModulesPromise = null;
function loadStudioModules() {
  if (!_studioModulesPromise) {
    _studioModulesPromise = Promise.all([
      import('../../app/dashboard/studio/elements/preset-kinds.js'),
      import('../../app/dashboard/studio/elements/scene-recipe.js'),
    ]).then(([presetKinds, sceneRecipe]) => ({ presetKinds, sceneRecipe }));
  }
  return _studioModulesPromise;
}

function makeId(kind) {
  return `${kind}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function clampName(raw, fallback = 'Untitled') {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return (s || fallback).slice(0, MAX_NAME_LENGTH);
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ── Recipe validation — "treat recipe data as untrusted input, reuse the
// existing Scene/Element/Look/Render validation and sanitization functions
// rather than accepting arbitrary objects." ────────────────────────────────
//
// Element/Look/Render presets each already have a portable, self-contained
// sanitizer in elements/preset-kinds.js (sanitizeElementPresetRecipe/
// sanitizeLookPresetRecipe/sanitizeRenderPresetRecipe) — none of the three
// need any enum/id list that lives outside elements/*.js, so they're reused
// here VERBATIM, unmodified, exactly as the instruction asks.
//
// Scene Template is different: its real, full validation
// (ClothStudio.jsx's applySceneRecipe) checks many fields against enum/id
// lists that are ClothStudio.jsx-LOCAL constants (PERF_LEVELS, FINISHES,
// MATERIAL_PRESET_IDS, LIGHT_TEMPLATES, FRAME_PRESETS, ENV_PRESETS,
// FX_PRESETS, SCENE_PRESETS, CLOTH_ASPECTS, VIDEO_FORMATS,
// PLACEMENT_FORMATS, LIVE_PREVIEW_TIERS) that are not exported from
// elements/*.js and are not safely importable server-side (ClothStudio.jsx
// is a 'use client' React component full of browser/three.js-only code —
// requiring it in a Node server context is not viable, and extracting those
// enums to elements/ would be an unrelated refactor this slice explicitly
// excludes). sanitizeSceneRecipeForCloud below is therefore a deliberately
// LIGHTER, structural check: it reuses every scene-recipe.js sanitizer that
// IS self-contained (sanitizeVec3/sanitizeLightCans/sanitizeShotCam/
// sanitizeDiffusionCamera/isFiniteNum/isHexColor/isBool), and for the
// handful of fields that need a ClothStudio-local enum it only checks type
// (string/number/plain-object), not enum membership. This is NOT a security
// gap: ClothStudio.jsx's applySceneRecipe already treats every recipe it
// loads — local OR cloud — as fully untrusted and re-validates each field
// against the real enum lists at LOAD TIME (see its own header comment: "a
// template is exactly as untrusted as a hand-edited localStorage blob").
// This server-side pass exists to reject structurally-wrong payloads before
// they're stored, not to be the final word on every field's legality.
function sanitizeSceneRecipeForCloud(raw, sceneRecipeModule) {
  const { isFiniteNum, isHexColor, isBool, sanitizeVec3, sanitizeLightCans, sanitizeShotCam, sanitizeDiffusionCamera } = sceneRecipeModule;
  const r = (raw && typeof raw === 'object') ? raw : {};
  const out = {};
  // Free-form sub-objects whose real enum validation only exists client-side
  // (see header comment) — kept only if they're at least plain objects, and
  // deep-cloned via JSON round-trip so no function/prototype pollution can
  // ride along in a nested value.
  const passthroughObjectKeys = ['perf', 'mat', 'phys', 'anim', 'cam', 'glass', 'fx', 'elementLocks'];
  passthroughObjectKeys.forEach((key) => {
    if (r[key] && typeof r[key] === 'object' && !Array.isArray(r[key])) {
      try { out[key] = JSON.parse(JSON.stringify(r[key])); } catch { /* drop unserializable */ }
    }
  });
  const passthroughStringKeys = [
    'lightTemplate', 'hudOn', 'frameId', 'envId', 'fxPresetId', 'clothAspect', 'artworkId',
    'bgMode', 'bgColor', 'sceneId', 'videoFormat', 'elementFormatId', 'elementQualityTier', 'randomizeIntensity', 'artworkRatio',
  ];
  passthroughStringKeys.forEach((key) => {
    if (key === 'hudOn') { if (isBool(r[key])) out[key] = r[key]; return; }
    if (key === 'artworkRatio') { if (isFiniteNum(r[key]) || r[key] === null) out[key] = r[key]; return; }
    if (isHexColor(r[key]) || typeof r[key] === 'string') out[key] = r[key];
  });
  if (Array.isArray(r.lightCans) && r.lightCans.length === 4) {
    out.lightCans = sanitizeLightCans(r.lightCans, [
      { on: false, color: '#ffffff', intensity: 1, az: 0, el: 0 },
      { on: false, color: '#ffffff', intensity: 1, az: 0, el: 0 },
      { on: false, color: '#ffffff', intensity: 1, az: 0, el: 0 },
      { on: false, color: '#ffffff', intensity: 1, az: 0, el: 0 },
    ]);
  }
  out.shotCam = sanitizeShotCam(r.shotCam, { use: false, az: 0, el: 0, dist: 3, fov: 40 });
  out.diffusionCamera = sanitizeDiffusionCamera(r.diffusionCamera, {
    enabled: false, locked: false, focalTarget: 'origin', focusDistance: 2.2, aperture: 0.4,
    falloff: 0.5, diffusionRadius: 0.3, highlightBloom: 0.2, foregroundBias: 0, backgroundBias: 0,
  });
  out.artworkRatio = (isFiniteNum(r.artworkRatio) || r.artworkRatio === null) ? r.artworkRatio : null;
  if (isFiniteNum(r.envIntensity)) out.envIntensity = r.envIntensity;
  if (isFiniteNum(r.videoSeconds) && r.videoSeconds > 0) out.videoSeconds = r.videoSeconds;
  if (Number.isFinite(r.sceneSeed)) out.sceneSeed = r.sceneSeed;
  if (Number.isFinite(r.lookSeed)) out.lookSeed = r.lookSeed;
  if (Number.isFinite(r.camSeed)) out.camSeed = r.camSeed;
  if (Array.isArray(r.extraInstances)) {
    // Deep-cloned defensively (JSON round-trip) — full per-instance schema
    // validation is elements/schema.js's normalizeElementInstance, run
    // client-side on load (restoreExtraInstances), same "untrusted until
    // load" boundary as the rest of this recipe.
    try { out.extraInstances = JSON.parse(JSON.stringify(r.extraInstances)).slice(0, 64); } catch { out.extraInstances = []; }
  }
  // Hero Text (Studio Hero Text Builder Phase 1, docs/plans/STUDIO-HERO-
  // TEXT-BUILDER-SONNET-HANDOFF.md) — same "lighter, structural" boundary
  // as everything else in this function (see the header comment above):
  // this module doesn't import app/dashboard/studio/text-layers.js's real
  // field enums (GOOGLE_FONT_CATALOG membership, TEXT_ALIGNS, per-field
  // numeric clamps), so it only keeps each entry that's a plain object and,
  // per field, only values of the RIGHT RAW TYPE (string/finite-
  // number/boolean) — never an enum/range check. `text` gets the same
  // 400-char cap text-layers.js's own sanitizeText applies. The real
  // per-field validation is client-side sanitizeTextLayers, run by
  // applySceneRecipe on EVERY load (local or cloud) — same "untrusted until
  // load" boundary the header comment describes; a corrupted/forged field
  // here just falls back to that field's default on load, same as any other
  // hand-edited localStorage blob. Capped to 6 raw entries (client-side
  // MAX_TEXT_LAYERS is 3) purely to bound payload size before that real
  // truncation runs — same "generous cap here, real cap on load" precedent
  // extraInstances' own 64-vs-lower-real-cap uses above. `id` is
  // deliberately dropped: sanitizeTextLayers always reassigns ids
  // positionally on load regardless of what's stored.
  if (Array.isArray(r.textLayers)) {
    // Phase 2 (backdrop bar/pill) `backdrop`/`backdropColor`/
    // `backdropOpacity`/`backdropPadPct` — same lighter/structural boundary
    // as every other field here (see the header comment above and the
    // `anim` sub-object's own comment below): this module doesn't import
    // text-layers.js's real TEXT_BACKDROPS enum or backdropOpacity/
    // backdropPadPct's numeric ranges, so `backdrop`/`backdropColor` are
    // just kept as strings and `backdropOpacity`/`backdropPadPct` as finite
    // numbers via the SAME TEXT_LAYER_STRING_FIELDS/TEXT_LAYER_NUMBER_FIELDS
    // pass every pre-existing field already goes through — no separate
    // code path needed. A layer with none of these keys at all (old cloud
    // recipe, saved before Phase 2) simply stores none of them, and the
    // client-side sanitizeTextLayer's own fallback chain resolves that to
    // 'none'/the DEFAULT_TEXT_LAYER backdrop defaults on load — same
    // backward-compat story `anim` already has.
    const TEXT_LAYER_STRING_FIELDS = ['text', 'fontId', 'align', 'color', 'backdrop', 'backdropColor'];
    const TEXT_LAYER_NUMBER_FIELDS = [
      'weight', 'sizePct', 'leading', 'tracking', 'anchorX', 'anchorY', 'maxWidthPct', 'rotX', 'rotY', 'rotZ', 'opacity',
      'backdropOpacity', 'backdropPadPct',
    ];
    const TEXT_LAYER_BOOL_FIELDS = ['on', 'uppercase'];
    // Phase 3 (in/out animation) `anim` sub-object — same lighter/structural
    // boundary as every other field in this function (see the header
    // comment above): this module doesn't import text-layers.js's real
    // TEXT_ANIM_INS/TEXT_ANIM_OUTS/TEXT_ANIM_EASES enums or its
    // inDur/outDur/delay numeric ranges, so it only keeps `anim` when it's
    // a plain object and, per field, only values of the RIGHT RAW TYPE
    // (in/out/ease as strings, inDur/outDur/delay as finite numbers) —
    // never an enum/range check. The real per-field validation is
    // client-side sanitizeTextLayer's sanitizeTextAnim, run by
    // applySceneRecipe on EVERY load (local or cloud) — same
    // "untrusted until load" boundary the header comment describes; a
    // corrupted/forged/missing `anim` here just falls back to
    // DEFAULT_TEXT_LAYER.anim on load, same as any other hand-edited
    // localStorage blob (this is also what makes an old cloud recipe saved
    // before `anim` existed load correctly: no `anim` key survives this
    // pass, so the client-side loader applies the default).
    const TEXT_ANIM_STRING_FIELDS = ['in', 'out', 'ease'];
    const TEXT_ANIM_NUMBER_FIELDS = ['inDur', 'outDur', 'delay'];
    out.textLayers = r.textLayers
      .slice(0, 6)
      .filter((v) => v && typeof v === 'object' && !Array.isArray(v))
      .map((entry) => {
        const clean = {};
        TEXT_LAYER_STRING_FIELDS.forEach((key) => {
          if (typeof entry[key] !== 'string') return;
          clean[key] = key === 'text' ? entry[key].slice(0, 400) : entry[key];
        });
        TEXT_LAYER_NUMBER_FIELDS.forEach((key) => { if (isFiniteNum(entry[key])) clean[key] = entry[key]; });
        TEXT_LAYER_BOOL_FIELDS.forEach((key) => { if (isBool(entry[key])) clean[key] = entry[key]; });
        if (entry.anim && typeof entry.anim === 'object' && !Array.isArray(entry.anim)) {
          const animClean = {};
          TEXT_ANIM_STRING_FIELDS.forEach((key) => { if (typeof entry.anim[key] === 'string') animClean[key] = entry.anim[key]; });
          TEXT_ANIM_NUMBER_FIELDS.forEach((key) => { if (isFiniteNum(entry.anim[key])) animClean[key] = entry.anim[key]; });
          if (Object.keys(animClean).length) clean.anim = animClean;
        }
        return clean;
      });
  }
  return out;
}

async function validateAndSanitizeRecipe(kind, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw httpError('recipe must be a plain object.', 400);
  }
  // Defensive size cap — an oversized recipe is either abuse or a client bug;
  // reject before it ever reaches Firestore rather than silently truncating.
  let serialized;
  try { serialized = JSON.stringify(raw); } catch { throw httpError('recipe must be JSON-serializable.', 400); }
  if (serialized.length > 200_000) throw httpError('recipe is too large.', 400);

  const { presetKinds, sceneRecipe } = await loadStudioModules();
  if (kind === 'element') return presetKinds.sanitizeElementPresetRecipe(raw, {});
  if (kind === 'look') return presetKinds.sanitizeLookPresetRecipe(raw, {});
  if (kind === 'render') return presetKinds.sanitizeRenderPresetRecipe(raw, {});
  return sanitizeSceneRecipeForCloud(raw, sceneRecipe);
}

// ── Authorization predicates ────────────────────────────────────────────────

function canRead(doc, { clientId, uid }) {
  if (!doc) return false;
  if (doc.scope === 'global') return true;
  if (doc.scope === 'client') return Boolean(clientId) && doc.clientId === clientId;
  if (doc.scope === 'user') return Boolean(clientId) && doc.clientId === clientId && doc.ownerUid === uid;
  return false;
}

/** Returns 'ok' | 'not-found' | 'forbidden' — never leaks a foreign client's private doc as anything but 'not-found'. */
function authorizeWrite(doc, { clientId, uid, isAdmin }) {
  if (!doc) return 'not-found';
  if (doc.scope === 'global') return isAdmin === true ? 'ok' : 'forbidden'; // visible to everyone — 403, not 404
  if (!canRead(doc, { clientId, uid })) return 'not-found'; // foreign client/user-scoped doc — never reveal it exists
  return 'ok';
}

function assertValidKind(kind) {
  if (!KINDS.includes(kind)) throw httpError(`Unknown template kind: ${kind}`, 400);
}

function assertValidScope(scope) {
  if (!SCOPES.includes(scope)) throw httpError(`Unknown template scope: ${scope}`, 400);
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * List templates of `kind` readable by { clientId, uid }: every scope
 * 'global' doc plus this caller's own 'client'/'user'-scope docs (a 'user'
 * doc only if ownerUid matches). Archived docs are excluded unless
 * `includeArchived` is true. Two single-field queries (never a compound
 * where — see module header), merged and sorted by updatedAt desc.
 */
async function listTemplates({ kind, clientId, uid, includeArchived = false }) {
  assertValidKind(kind);
  const fb = ctx();

  const [globalSnap, clientSnap] = await Promise.all([
    fb.adminDb.collection(COLLECTION).where('scope', '==', 'global').limit(LIST_FETCH_LIMIT).get(),
    clientId
      ? fb.adminDb.collection(COLLECTION).where('clientId', '==', clientId).limit(LIST_FETCH_LIMIT).get()
      : Promise.resolve({ docs: [] }),
  ]);

  const byId = new Map();
  [...globalSnap.docs, ...clientSnap.docs].forEach((d) => byId.set(d.id, d.data()));

  const rows = Array.from(byId.values()).filter((doc) => {
    if (doc.kind !== kind) return false;
    if (!includeArchived && doc.archived) return false;
    return canRead(doc, { clientId, uid });
  });

  rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return rows;
}

/** Single template, tenant-checked. Returns null for missing OR foreign — identical shape either way, never leaks existence. */
async function getTemplate(id, { clientId, uid }) {
  if (!id) return null;
  const fb = ctx();
  const snap = await fb.adminDb.collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const doc = snap.data();
  if (!canRead(doc, { clientId, uid })) return null;
  return doc;
}

// ── Writes ──────────────────────────────────────────────────────────────────

async function createTemplate({ kind, scope, ownerUid, clientId, name, recipe, sourceSeed, isAdmin }) {
  assertValidKind(kind);
  assertValidScope(scope);
  if (!ownerUid) throw httpError('ownerUid is required.', 400);
  if (scope === 'global') {
    if (isAdmin !== true) throw httpError('Forbidden: admin access required to create a Global template.', 403);
  } else if (!clientId) {
    throw httpError('clientId is required for a user/client-scope template.', 400);
  }

  const sanitizedRecipe = await validateAndSanitizeRecipe(kind, recipe);
  const fb = ctx();
  const id = makeId(kind);
  const now = new Date().toISOString();
  const doc = {
    id,
    schemaVersion: SCHEMA_VERSION,
    kind,
    scope,
    ownerUid,
    clientId: scope === 'global' ? null : clientId,
    name: clampName(name),
    recipe: sanitizedRecipe,
    sourceSeed: Number.isFinite(sourceSeed) ? sourceSeed : null,
    thumbnailPath: null,
    archived: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
    createdAtTs: fb.FieldValue.serverTimestamp(),
    updatedAtTs: fb.FieldValue.serverTimestamp(),
  };
  await fb.adminDb.collection(COLLECTION).doc(id).set(doc);
  return doc;
}

/**
 * Explicit update — never a silent overwrite, and never a plain
 * read-then-write (that would race: two concurrent updates could both read
 * version 1, both pass the check, and one write would silently clobber the
 * other). `expectedVersion` is REQUIRED and must match the doc's CURRENT
 * version at the instant this transaction commits, or the write is rejected
 * with 409 — the read, the authorization check, the version comparison, and
 * the write itself all happen inside one `adminDb.runTransaction`, so two
 * concurrent update calls against the same doc are guaranteed to resolve as
 * exactly one success + one 409, never a lost update. A successful update
 * always increments `version` by exactly 1.
 */
async function updateTemplate({ id, clientId, uid, isAdmin, name, recipe, expectedVersion }) {
  if (!Number.isFinite(expectedVersion)) {
    throw httpError('expectedVersion is required to update a template.', 400);
  }
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(id);

  return fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const doc = snap.exists ? snap.data() : null;

    const verdict = authorizeWrite(doc, { clientId, uid, isAdmin });
    if (verdict === 'not-found') throw httpError('Template not found.', 404);
    if (verdict === 'forbidden') throw httpError('Forbidden: admin access required to update a Global template.', 403);

    if (expectedVersion !== doc.version) {
      throw httpError(`Version conflict: expected ${expectedVersion}, current is ${doc.version}.`, 409);
    }

    const patch = { updatedAt: new Date().toISOString(), updatedAtTs: fb.FieldValue.serverTimestamp(), version: doc.version + 1 };
    if (typeof name === 'string') patch.name = clampName(name, doc.name);
    if (recipe !== undefined) patch.recipe = await validateAndSanitizeRecipe(doc.kind, recipe);

    tx.set(ref, patch, { merge: true });
    return { ...doc, ...patch };
  });
}

async function setArchived(id, { clientId, uid, isAdmin }, archived) {
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  const doc = snap.exists ? snap.data() : null;

  const verdict = authorizeWrite(doc, { clientId, uid, isAdmin });
  if (verdict === 'not-found') throw httpError('Template not found.', 404);
  if (verdict === 'forbidden') throw httpError('Forbidden: admin access required to archive a Global template.', 403);

  const patch = { archived, updatedAt: new Date().toISOString(), updatedAtTs: fb.FieldValue.serverTimestamp() };
  await ref.set(patch, { merge: true });
  return { ...doc, ...patch };
}

const archiveTemplate = (id, auth) => setArchived(id, auth, true);
const unarchiveTemplate = (id, auth) => setArchived(id, auth, false);

/**
 * Duplicate an existing (readable) template into the CALLER's own scope —
 * never into another tenant's space, and never silently promoted to Global
 * even when duplicating a Global source (a non-admin forking a Global
 * preset gets their own private/client copy, not a second Global one).
 * Always version 1 — it's a new template, not a revision of the source.
 */
async function duplicateTemplate({ id, clientId, uid, isAdmin, name }) {
  const fb = ctx();
  const snap = await fb.adminDb.collection(COLLECTION).doc(id).get();
  const source = snap.exists ? snap.data() : null;
  if (!canRead(source, { clientId, uid })) throw httpError('Template not found.', 404);

  const targetScope = source.scope === 'global' ? (clientId ? 'client' : 'user') : source.scope;
  return createTemplate({
    kind: source.kind,
    scope: targetScope,
    ownerUid: uid,
    clientId,
    name: clampName(name || `${source.name} copy`),
    recipe: source.recipe,
    sourceSeed: source.sourceSeed,
    isAdmin,
  });
}

/** Admin-only: promote an existing client/user-scope template to Global. */
async function promoteToGlobal({ id, isAdmin }) {
  if (isAdmin !== true) throw httpError('Forbidden: admin access required to promote a template to Global.', 403);
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw httpError('Template not found.', 404);
  const doc = snap.data();
  if (doc.scope === 'global') return doc; // already global — no-op, not an error
  const patch = {
    scope: 'global',
    clientId: null,
    updatedAt: new Date().toISOString(),
    updatedAtTs: fb.FieldValue.serverTimestamp(),
  };
  await ref.set(patch, { merge: true });
  return { ...doc, ...patch };
}

/**
 * Admin-only: demote a Global template back to a specific client's (or a
 * user's) scope — the data model has no "ownerless" non-global scope, so a
 * target must be supplied. Optional per the roadmap's "optionally demote
 * Global if the data model safely supports it" — implemented since the
 * model already supports it cleanly (the inverse of promoteToGlobal).
 */
async function demoteGlobal({ id, isAdmin, targetClientId, targetScope = 'client' }) {
  if (isAdmin !== true) throw httpError('Forbidden: admin access required to demote a Global template.', 403);
  assertValidScope(targetScope);
  if (targetScope === 'global') throw httpError('targetScope must not be global.', 400);
  if (!targetClientId) throw httpError('targetClientId is required to demote a Global template.', 400);

  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw httpError('Template not found.', 404);
  const doc = snap.data();
  if (doc.scope !== 'global') throw httpError('Template is not Global.', 400);

  const patch = {
    scope: targetScope,
    clientId: targetClientId,
    updatedAt: new Date().toISOString(),
    updatedAtTs: fb.FieldValue.serverTimestamp(),
  };
  await ref.set(patch, { merge: true });
  return { ...doc, ...patch };
}

module.exports = {
  COLLECTION,
  KINDS,
  SCOPES,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  archiveTemplate,
  unarchiveTemplate,
  duplicateTemplate,
  promoteToGlobal,
  demoteGlobal,
  canRead,
  authorizeWrite,
  validateAndSanitizeRecipe,
  __setTestContext,
};
