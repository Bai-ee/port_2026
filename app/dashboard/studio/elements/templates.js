// Scene Template system — docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md
// "Template system" § Scene Template + Persistence. Pure logic (no React, no
// three.js, no localStorage access at the call boundary — callers pass the
// raw string in/out) — CRUD/schema/validation/migration-dispatch over a
// plain array, mirroring elements/schema.js's own "validate and normalize,
// never trust raw input" discipline for anything that could have been
// hand-edited (an imported JSON file) or drifted across a schema version.
// IDs follow the SAME "scan existing ids for the next free N" idiom as
// elements/scene-elements.js's nextElementId/nextDuplicateId — deterministic,
// no Math.random(), no counter to reseed after a reload.
//
// Scope, stated precisely: LOCAL (localStorage) persistence only. The plan's
// `scope: user|client|global`, authenticated cloud persistence, admin-only
// Global promotion, thumbnail capture, and the separate Element/Look/Render
// preset KINDS are explicitly NOT implemented here — every template this
// module creates is `scope: 'local'`, `kind: 'scene'` only. See this
// round's as-built notes for what's deferred and why.

export const TEMPLATE_SCHEMA_VERSION = 1;
export const SCENE_TEMPLATES_KEY = 'holocloth-studio-scene-templates-v1';
export const MAX_TEMPLATES = 40;
const MAX_NAME_LENGTH = 60;

/** Next collision-safe template id — same scan-existing-ids idiom as scene-elements.js, never Math.random(). */
export function nextTemplateId(existingIds) {
  let maxN = 0;
  for (const id of existingIds || []) {
    const m = /^tpl-(\d+)$/.exec(String(id || ''));
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  return `tpl-${maxN + 1}`;
}

function clampName(raw, fallback = 'Untitled Scene') {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return (s || fallback).slice(0, MAX_NAME_LENGTH);
}

/**
 * Migration dispatch — only `TEMPLATE_SCHEMA_VERSION === 1` exists today, so
 * this is an identity pass-through for that version and a hard rejection
 * (returns null) for anything else. NOT a claim that real migrations are
 * implemented yet — there is nothing to migrate FROM. This function is the
 * extension point a future schema bump adds a real transform to (see this
 * module's own tests for how the dispatch mechanism itself is proven with a
 * synthetic v0 case, independent of any real migration existing).
 */
export function migrateTemplate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion === 1) return raw;
  return null; // unknown/future schema version — reject rather than guess
}

/** True only for a fully well-formed, current-schema template object. Never throws. */
export function isValidTemplate(t) {
  if (!t || typeof t !== 'object') return false;
  if (t.schemaVersion !== TEMPLATE_SCHEMA_VERSION) return false;
  if (typeof t.id !== 'string' || !t.id) return false;
  if (t.scope !== 'local') return false;
  if (t.kind !== 'scene') return false;
  if (typeof t.name !== 'string' || !t.name) return false;
  if (!t.recipe || typeof t.recipe !== 'object') return false;
  if (typeof t.createdAt !== 'number') return false;
  if (typeof t.updatedAt !== 'number') return false;
  return true;
}

/** Parses raw JSON from localStorage into a validated template array. Never throws; malformed/foreign entries are silently dropped, not repaired. */
export function parseTemplateListJSON(json) {
  let raw;
  try { raw = JSON.parse(json || '[]'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    const migrated = migrateTemplate(entry);
    if (migrated && isValidTemplate(migrated)) out.push(migrated);
  }
  return out;
}

export function serializeTemplateList(list) {
  return JSON.stringify(Array.isArray(list) ? list : []);
}

/** Builds a new, valid template from a captured recipe. `now` is injected (never `Date.now()` called internally) so callers control time and tests stay deterministic. */
export function createSceneTemplate(list, { name, recipe, now }) {
  const id = nextTemplateId((list || []).map((t) => t.id));
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id,
    scope: 'local',
    kind: 'scene',
    name: clampName(name),
    recipe: recipe && typeof recipe === 'object' ? recipe : {},
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Appends a new template, truncating the OLDEST entries if over MAX_TEMPLATES (same bounded-list precedent as MAX_EXTRA_INSTANCES elsewhere in this codebase). */
export function addTemplate(list, template) {
  const next = [...(list || []), template];
  if (next.length > MAX_TEMPLATES) next.splice(0, next.length - MAX_TEMPLATES);
  return next;
}

export function findTemplate(list, id) {
  return (list || []).find((t) => t.id === id) || null;
}

export function renameTemplate(list, id, name, now) {
  return (list || []).map((t) => (t.id === id ? { ...t, name: clampName(name, t.name), updatedAt: now } : t));
}

/** Overwrites an existing template's recipe (explicit "Save" over a prior template, not a new one). */
export function updateTemplateRecipe(list, id, recipe, now) {
  return (list || []).map((t) => (t.id === id ? { ...t, recipe: recipe && typeof recipe === 'object' ? recipe : t.recipe, updatedAt: now } : t));
}

export function duplicateTemplate(list, id, now) {
  const source = findTemplate(list, id);
  if (!source) return list;
  const dup = {
    ...source,
    id: nextTemplateId((list || []).map((t) => t.id)),
    name: clampName(`${source.name} copy`, source.name),
    createdAt: now,
    updatedAt: now,
  };
  return addTemplate(list, dup);
}

/** Soft-delete — matches the plan's own "duplicate, rename, ARCHIVE, export, import" wording (never a hard destructive delete). */
export function archiveTemplate(list, id, now) {
  return (list || []).map((t) => (t.id === id ? { ...t, archived: true, updatedAt: now } : t));
}

export function unarchiveTemplate(list, id, now) {
  return (list || []).map((t) => (t.id === id ? { ...t, archived: false, updatedAt: now } : t));
}

export function listActiveTemplates(list) {
  return (list || []).filter((t) => !t.archived);
}

export function listArchivedTemplates(list) {
  return (list || []).filter((t) => t.archived);
}

export function exportTemplateJSON(template) {
  return JSON.stringify(template, null, 2);
}

/**
 * Imports a single template from a pasted/uploaded JSON string. Always
 * assigns a FRESH id (never trusts an imported id, which could collide or
 * have been hand-edited) and resets archived/timestamps — an import is
 * always a genuinely new, active local template, never a silent overwrite
 * of something already saved. Returns `{ list, error }`; `error` is a
 * human-readable string and `list` is unchanged (the original reference)
 * when the import is rejected.
 */
export function importTemplateJSON(list, json, now) {
  let raw;
  try { raw = JSON.parse(json); } catch { return { list, error: 'Not valid JSON.' }; }
  const migrated = migrateTemplate(raw);
  if (!migrated) return { list, error: 'Unrecognized or unsupported template schema version.' };
  if (migrated.kind !== 'scene' || !migrated.recipe || typeof migrated.recipe !== 'object') {
    return { list, error: 'Not a valid Scene Template.' };
  }
  const imported = createSceneTemplate(list, { name: migrated.name, recipe: migrated.recipe, now });
  return { list: addTemplate(list, imported), error: null };
}
