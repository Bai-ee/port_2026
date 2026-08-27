// Plain `node --test` has no `window`/`localStorage` (no jsdom). storage.js
// mirrors the existing app/dashboard/studio/page.jsx SSR-guard pattern,
// which gates on `typeof window === 'undefined'` and then reads/writes via
// `window.localStorage` — so the shim below provides a minimal `window`
// global backed by an in-memory Map, assigned before storage.js is ever
// called (module-load order doesn't matter here: storage.js has no
// top-level side effects, only function bodies that touch `window`).
const memory = new Map();
const fakeLocalStorage = {
  getItem(key) {
    return memory.has(key) ? memory.get(key) : null;
  },
  setItem(key, value) {
    memory.set(key, String(value));
  },
  removeItem(key) {
    memory.delete(key);
  },
  clear() {
    memory.clear();
  },
};
globalThis.window = globalThis.window || {};
globalThis.window.localStorage = fakeLocalStorage;

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAINT_RECIPES_KEY,
  listSavedRecipes,
  saveRecipe,
  updateRecipe,
  loadRecipe,
  duplicateRecipe,
  deleteRecipe,
} from '../storage.js';

test('PAINT_RECIPES_KEY is a dedicated, versioned key (not the Mockup/Cloth keys)', () => {
  assert.equal(PAINT_RECIPES_KEY, 'paint-studio-recipes-v1');
});

test('save -> list -> load round-trip', () => {
  fakeLocalStorage.clear();
  const recipe = { schemaVersion: 1, templateId: 'fake', seed: 1 };
  const created = saveRecipe({ name: 'My Wallpaper', recipe });

  assert.ok(created.id);
  assert.equal(created.name, 'My Wallpaper');
  assert.deepEqual(created.recipe, recipe);
  assert.ok(created.createdAt);
  assert.equal(created.createdAt, created.updatedAt);

  const list = listSavedRecipes();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], created);

  const loaded = loadRecipe(created.id);
  assert.deepEqual(loaded, created);
});

test('loadRecipe: returns null for an unknown id', () => {
  fakeLocalStorage.clear();
  assert.equal(loadRecipe('nope'), null);
});

test('updateRecipe: updates name/recipe in place, preserves createdAt, and bumps updatedAt', () => {
  fakeLocalStorage.clear();
  const created = saveRecipe({ name: 'V1', recipe: { seed: 1 } });
  const updated = updateRecipe(created.id, { name: 'V2', recipe: { seed: 2 } });

  assert.equal(updated.id, created.id);
  assert.equal(updated.name, 'V2');
  assert.deepEqual(updated.recipe, { seed: 2 });
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(listSavedRecipes().length, 1);
  assert.deepEqual(loadRecipe(created.id), updated);
});

test('updateRecipe: returns null for an unknown id', () => {
  fakeLocalStorage.clear();
  assert.equal(updateRecipe('nope', { name: 'x' }), null);
});

test('duplicateRecipe: clones with a new id and "Copy of <name>" name', () => {
  fakeLocalStorage.clear();
  const original = saveRecipe({ name: 'Original', recipe: { seed: 7 } });
  const dup = duplicateRecipe(original.id);

  assert.notEqual(dup.id, original.id);
  assert.equal(dup.name, 'Copy of Original');
  assert.deepEqual(dup.recipe, original.recipe);
  assert.equal(listSavedRecipes().length, 2);
});

test('duplicateRecipe: returns null for an unknown id', () => {
  fakeLocalStorage.clear();
  assert.equal(duplicateRecipe('nope'), null);
});

test('deleteRecipe: removes an entry and returns true; returns false when nothing matched', () => {
  fakeLocalStorage.clear();
  const created = saveRecipe({ name: 'ToDelete', recipe: {} });
  assert.equal(deleteRecipe(created.id), true);
  assert.equal(listSavedRecipes().length, 0);
  assert.equal(deleteRecipe(created.id), false);
});

test('a corrupt/non-JSON value in the storage key does not throw — falls back to an empty list', () => {
  fakeLocalStorage.clear();
  fakeLocalStorage.setItem(PAINT_RECIPES_KEY, '{not valid json');
  assert.doesNotThrow(() => listSavedRecipes());
  assert.deepEqual(listSavedRecipes(), []);
});

test('listSavedRecipes: sorted newest-first by updatedAt', () => {
  fakeLocalStorage.clear();
  const RealDate = globalThis.Date;
  let current = new RealDate('2026-01-01T00:00:00.000Z').getTime();
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(current);
    }
    static now() {
      return current;
    }
  }
  globalThis.Date = FakeDate;
  try {
    const a = saveRecipe({ name: 'A', recipe: {} });
    current += 1000;
    const b = saveRecipe({ name: 'B', recipe: {} });
    current += 1000;
    const updatedA = updateRecipe(a.id, { name: 'A2' });

    const list = listSavedRecipes();
    assert.equal(list[0].id, updatedA.id);
    assert.equal(list[1].id, b.id);
  } finally {
    globalThis.Date = RealDate;
  }
});

test('SSR-safe: with no window global, every function returns an empty/null/false result without throwing', () => {
  const savedWindow = globalThis.window;
  delete globalThis.window;
  try {
    assert.deepEqual(listSavedRecipes(), []);
    assert.equal(saveRecipe({ name: 'x', recipe: {} }), null);
    assert.equal(loadRecipe('anything'), null);
    assert.equal(updateRecipe('anything', {}), null);
    assert.equal(duplicateRecipe('anything'), null);
    assert.equal(deleteRecipe('anything'), false);
  } finally {
    globalThis.window = savedWindow;
  }
});
