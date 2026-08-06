// Master Save — one-click full-state versions. A fourth preset kind beside
// Scene Template (templates.js) and Element/Look/Render (preset-kinds.js),
// same pure-logic discipline: no React, no three.js, no localStorage access
// at the call boundary; schema versioning, the "next collision-safe id"
// scan idiom, a MAX_* cap, name clamping.
//
// What makes this kind different from a Scene Template: its recipe is the
// COMPLETE settings blob the studio persists as next-visit defaults —
// captureSceneRecipe() PLUS `timeline` (keyframes). Deliberately absent from
// captureSceneRecipe itself (a timeline keyframe's recipe IS a
// captureSceneRecipe snapshot — nesting timeline into that recipe would
// recurse), so the caller composes the master recipe and this module never
// needs to know the field list. No at-rest recipe sanitizer for the same
// reason Element Presets have none: apply routes through applySceneRecipe +
// sanitizeTimeline, which fully re-validate field-by-field. (A recipe saved
// before the export-resolution tier was removed may still carry a stray
// `exportResolutionTier` key — this module's ops are field-agnostic, so it
// passes through untouched and is simply never read by the apply path.)
//
// Cap is 12 (not the other kinds' 40): a master recipe can carry up to 12
// timeline keyframes each holding a full scene recipe, so entries are an
// order of magnitude heavier — 12 versions keeps worst-case localStorage
// spend bounded. addMasterSave truncates the OLDEST on overflow (same
// bounded-list precedent as templates.js's addTemplate), so Save never
// disables — quick versioning must never dead-end on a cap. Versions get a
// hard `deleteMasterSave` (no archive tier): overflow already destroys the
// oldest silently, so pretending the list is append-only would be dishonest.
//
// templates.js is IMPORT-ONLY (its kind-agnostic list ops — findTemplate,
// renameTemplate, updateTemplateRecipe, serializeTemplateList — work
// unchanged on this list); parse via preset-kinds.js's parsePresetListJSON
// with this module's isValidMasterSave.

import { TEMPLATE_SCHEMA_VERSION } from './templates.js';

export const MASTER_SAVES_KEY = 'holocloth-master-saves-v1';
export const MAX_MASTER_SAVES = 12;
const MAX_NAME_LENGTH = 60;

export function nextMasterSaveId(existingIds) {
  let maxN = 0;
  for (const id of existingIds || []) {
    const m = /^master-(\d+)$/.exec(String(id || ''));
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  return `master-${maxN + 1}`;
}

/**
 * Builds a new, valid master save. A blank name auto-names from the id's
 * own monotonic counter ("Version 3") — the one-click save path types
 * nothing, so the fallback must be meaningful, not "Untitled".
 */
export function createMasterSave(list, { name, recipe, now }) {
  const id = nextMasterSaveId((list || []).map((t) => t.id));
  const n = Number(/^master-(\d+)$/.exec(id)[1]);
  const s = typeof name === 'string' ? name.trim() : '';
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id,
    scope: 'local',
    kind: 'master',
    name: (s || `Version ${n}`).slice(0, MAX_NAME_LENGTH),
    recipe: recipe && typeof recipe === 'object' ? recipe : {},
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function isValidMasterSave(t) {
  if (!t || typeof t !== 'object') return false;
  if (t.schemaVersion !== TEMPLATE_SCHEMA_VERSION) return false;
  if (typeof t.id !== 'string' || !t.id) return false;
  if (t.scope !== 'local') return false;
  if (t.kind !== 'master') return false;
  if (typeof t.name !== 'string' || !t.name) return false;
  if (!t.recipe || typeof t.recipe !== 'object') return false;
  if (typeof t.createdAt !== 'number') return false;
  if (typeof t.updatedAt !== 'number') return false;
  return true;
}

/** Appends, truncating the OLDEST entries past MAX_MASTER_SAVES — Save never disables at the cap. */
export function addMasterSave(list, save) {
  const next = [...(list || []), save];
  if (next.length > MAX_MASTER_SAVES) next.splice(0, next.length - MAX_MASTER_SAVES);
  return next;
}

export function deleteMasterSave(list, id) {
  return (list || []).filter((t) => t.id !== id);
}
