// Paint Studio — local persistence for saved recipes. Dedicated, versioned
// key (never the Mockup `mockup-studio-*` or Holo Paper keys). Mirrors the
// SSR-safe `window.localStorage` try/catch pattern already established by
// `loadSavedDefaults`/`loadCustomTemplates` in app/dashboard/studio/page.jsx.
export const PAINT_RECIPES_KEY = 'paint-studio-recipes-v1';

function readAll() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PAINT_RECIPES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PAINT_RECIPES_KEY, JSON.stringify(entries));
  } catch {
    // Storage full/blocked — silently no-op, same as the existing Studio
    // localStorage helpers this mirrors.
  }
}

// Bookkeeping id for a saved-recipe list entry — not part of the serialized
// recipe/visual state, so a timestamp+random suffix is fine here (the
// PRNG-determinism rule in PAINT_STUDIO_PLAN.md applies to recipe render
// state, not to storage record ids).
function generateId() {
  return `paint-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// listSavedRecipes() -> [{ id, name, recipe, createdAt, updatedAt }, ...]
// newest first (by updatedAt, falling back to createdAt).
export function listSavedRecipes() {
  const entries = readAll();
  return entries.slice().sort((a, b) => {
    const bKey = b?.updatedAt || b?.createdAt || '';
    const aKey = a?.updatedAt || a?.createdAt || '';
    return bKey.localeCompare(aKey);
  });
}

// saveRecipe({ name, recipe }) -> creates and returns a new saved entry.
export function saveRecipe({ name, recipe } = {}) {
  if (typeof window === 'undefined') return null;
  const entries = readAll();
  const now = new Date().toISOString();
  const entry = {
    id: generateId(),
    name: name || 'Untitled recipe',
    recipe,
    createdAt: now,
    updatedAt: now,
  };
  entries.push(entry);
  writeAll(entries);
  return entry;
}

// updateRecipe(id, { name, recipe }) -> updates an existing entry in place
// (only the provided fields change) and bumps updatedAt. Returns the updated
// entry, or null if `id` does not match a saved entry.
export function updateRecipe(id, { name, recipe } = {}) {
  if (typeof window === 'undefined') return null;
  const entries = readAll();
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) return null;
  const updated = {
    ...entries[index],
    ...(name !== undefined ? { name } : {}),
    ...(recipe !== undefined ? { recipe } : {}),
    updatedAt: new Date().toISOString(),
  };
  entries[index] = updated;
  writeAll(entries);
  return updated;
}

// loadRecipe(id) -> the matching entry, or null.
export function loadRecipe(id) {
  if (typeof window === 'undefined') return null;
  const entries = readAll();
  return entries.find((entry) => entry.id === id) || null;
}

// duplicateRecipe(id) -> clones an entry with a new id and name
// "Copy of <name>", or null if `id` does not match a saved entry.
export function duplicateRecipe(id) {
  if (typeof window === 'undefined') return null;
  const entries = readAll();
  const source = entries.find((entry) => entry.id === id);
  if (!source) return null;
  const now = new Date().toISOString();
  const clone = {
    ...source,
    id: generateId(),
    name: `Copy of ${source.name}`,
    createdAt: now,
    updatedAt: now,
  };
  entries.push(clone);
  writeAll(entries);
  return clone;
}

// deleteRecipe(id) -> true if an entry was removed, false otherwise.
export function deleteRecipe(id) {
  if (typeof window === 'undefined') return false;
  const entries = readAll();
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length === entries.length) return false;
  writeAll(next);
  return true;
}
