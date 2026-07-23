import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE_SCHEMA_VERSION, MAX_TEMPLATES,
  nextTemplateId, migrateTemplate, isValidTemplate,
  parseTemplateListJSON, serializeTemplateList,
  createSceneTemplate, addTemplate, findTemplate, renameTemplate, updateTemplateRecipe,
  duplicateTemplate, archiveTemplate, unarchiveTemplate, listActiveTemplates, listArchivedTemplates,
  exportTemplateJSON, importTemplateJSON,
} from '../templates.js';

const NOW = 1700000000000;
const validTemplate = (overrides = {}) => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION, id: 'tpl-1', scope: 'local', kind: 'scene',
  name: 'Test Scene', recipe: { bgColor: '#000000' }, archived: false, createdAt: NOW, updatedAt: NOW,
  ...overrides,
});

test('nextTemplateId: scans existing ids for the next free N, starting at 1, never Math.random()', () => {
  assert.equal(nextTemplateId([]), 'tpl-1');
  assert.equal(nextTemplateId(['tpl-1', 'tpl-2']), 'tpl-3');
  assert.equal(nextTemplateId(['tpl-5', 'tpl-2']), 'tpl-6');
  assert.equal(nextTemplateId(['tpl-abc', 'not-a-template-id']), 'tpl-1', 'non-matching ids should not influence the scan');
});

test('migrateTemplate: identity pass-through for the current schema version, rejects everything else', () => {
  const t = validTemplate();
  assert.equal(migrateTemplate(t), t);
  assert.equal(migrateTemplate({ ...t, schemaVersion: 0 }), null, 'an unknown OLDER version with no real migration registered must be rejected, not guessed at');
  assert.equal(migrateTemplate({ ...t, schemaVersion: 99 }), null, 'a FUTURE version this build has never heard of must be rejected');
  assert.equal(migrateTemplate(null), null);
  assert.equal(migrateTemplate('not an object'), null);
});

// Proves the DISPATCH MECHANISM itself works, independent of whether any
// real migration is registered today — a synthetic case, not a claim that
// v0 templates ever really existed in this codebase.
test('migrateTemplate: the dispatch mechanism is provably extensible — a synthetic v0-aware version of the function correctly upgrades a v0 shape', () => {
  function migrateTemplateWithSyntheticV0(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.schemaVersion === 0) {
      // a hypothetical v0->v1 transform: v0 stored `title` instead of `name`
      return { ...raw, schemaVersion: 1, name: raw.title, scope: 'local', kind: 'scene' };
    }
    return migrateTemplate(raw);
  }
  const v0 = { schemaVersion: 0, id: 'tpl-1', title: 'Old Name', recipe: {}, createdAt: NOW, updatedAt: NOW };
  const migrated = migrateTemplateWithSyntheticV0(v0);
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.name, 'Old Name');
  assert.ok(isValidTemplate(migrated));
});

test('isValidTemplate: rejects every required-field violation independently', () => {
  const base = validTemplate();
  assert.ok(isValidTemplate(base));
  assert.equal(isValidTemplate({ ...base, schemaVersion: 2 }), false);
  assert.equal(isValidTemplate({ ...base, id: '' }), false);
  assert.equal(isValidTemplate({ ...base, id: 123 }), false);
  assert.equal(isValidTemplate({ ...base, scope: 'global' }), false, 'this module never produces/accepts non-local scope');
  assert.equal(isValidTemplate({ ...base, kind: 'element' }), false, 'this module never produces/accepts non-scene kinds yet');
  assert.equal(isValidTemplate({ ...base, name: '' }), false);
  assert.equal(isValidTemplate({ ...base, recipe: null }), false);
  assert.equal(isValidTemplate({ ...base, recipe: 'not an object' }), false);
  assert.equal(isValidTemplate({ ...base, createdAt: 'yesterday' }), false);
  assert.equal(isValidTemplate(null), false);
  assert.equal(isValidTemplate(undefined), false);
});

test('parseTemplateListJSON: malformed/foreign/wrong-version entries are silently dropped, never thrown or repaired', () => {
  const good = validTemplate({ id: 'tpl-1' });
  const raw = JSON.stringify([good, { not: 'a template' }, null, { ...good, id: 'tpl-2', schemaVersion: 99 }]);
  const parsed = parseTemplateListJSON(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'tpl-1');
});

test('parseTemplateListJSON: invalid JSON, non-array JSON, and empty/undefined input all return an empty array, never throw', () => {
  assert.deepEqual(parseTemplateListJSON('not json'), []);
  assert.deepEqual(parseTemplateListJSON('{"not":"an array"}'), []);
  assert.deepEqual(parseTemplateListJSON(''), []);
  assert.deepEqual(parseTemplateListJSON(undefined), []);
});

test('serializeTemplateList round-trips cleanly through parseTemplateListJSON', () => {
  const list = [validTemplate({ id: 'tpl-1' }), validTemplate({ id: 'tpl-2', name: 'Second' })];
  const json = serializeTemplateList(list);
  const parsed = parseTemplateListJSON(json);
  assert.deepEqual(parsed, list);
});

test('createSceneTemplate: builds a valid template, derives a collision-safe id from the existing list, clamps a blank name to a fallback', () => {
  const list = [validTemplate({ id: 'tpl-1' })];
  const t = createSceneTemplate(list, { name: '  ', recipe: { bgColor: '#fff' }, now: NOW });
  assert.equal(t.id, 'tpl-2');
  assert.equal(t.name, 'Untitled Scene');
  assert.equal(t.archived, false);
  assert.ok(isValidTemplate(t));
});

test('createSceneTemplate: a non-object recipe falls back to an empty object rather than storing garbage', () => {
  const t = createSceneTemplate([], { name: 'X', recipe: 'not an object', now: NOW });
  assert.deepEqual(t.recipe, {});
});

test('addTemplate: appends, and truncates the OLDEST entries once over MAX_TEMPLATES', () => {
  let list = [];
  for (let i = 0; i < MAX_TEMPLATES + 5; i += 1) {
    list = addTemplate(list, createSceneTemplate(list, { name: `T${i}`, recipe: {}, now: NOW + i }));
  }
  assert.equal(list.length, MAX_TEMPLATES);
  assert.equal(list[0].name, 'T5', 'the oldest 5 entries should have been dropped, oldest-first');
  assert.equal(list[list.length - 1].name, `T${MAX_TEMPLATES + 4}`);
});

test('findTemplate: returns the matching template or null', () => {
  const list = [validTemplate({ id: 'tpl-1' }), validTemplate({ id: 'tpl-2' })];
  assert.equal(findTemplate(list, 'tpl-2').id, 'tpl-2');
  assert.equal(findTemplate(list, 'tpl-missing'), null);
});

test('renameTemplate: updates only the target template\'s name and updatedAt, leaves others untouched', () => {
  const list = [validTemplate({ id: 'tpl-1', name: 'A', updatedAt: NOW }), validTemplate({ id: 'tpl-2', name: 'B', updatedAt: NOW })];
  const renamed = renameTemplate(list, 'tpl-1', 'New Name', NOW + 1000);
  assert.equal(renamed[0].name, 'New Name');
  assert.equal(renamed[0].updatedAt, NOW + 1000);
  assert.deepEqual(renamed[1], list[1]);
});

test('updateTemplateRecipe: overwrites the recipe of an existing template (an explicit re-save), not a new one', () => {
  const list = [validTemplate({ id: 'tpl-1', recipe: { bgColor: '#000' } })];
  const updated = updateTemplateRecipe(list, 'tpl-1', { bgColor: '#fff' }, NOW + 1);
  assert.equal(updated.length, 1);
  assert.deepEqual(updated[0].recipe, { bgColor: '#fff' });
});

test('duplicateTemplate: creates a fresh-id copy with a " copy" suffix, appended (never mutates the source)', () => {
  const list = [validTemplate({ id: 'tpl-1', name: 'Original' })];
  const next = duplicateTemplate(list, 'tpl-1', NOW + 1);
  assert.equal(next.length, 2);
  assert.equal(next[1].name, 'Original copy');
  assert.notEqual(next[1].id, 'tpl-1');
  assert.deepEqual(next[0], list[0], 'the source template must be unchanged');
});

test('duplicateTemplate: a missing id is a no-op, returns the same list reference', () => {
  const list = [validTemplate({ id: 'tpl-1' })];
  assert.equal(duplicateTemplate(list, 'tpl-missing', NOW), list);
});

test('archiveTemplate / unarchiveTemplate / listActiveTemplates / listArchivedTemplates: a soft-delete, never a hard removal', () => {
  const list = [validTemplate({ id: 'tpl-1' }), validTemplate({ id: 'tpl-2' })];
  const archived = archiveTemplate(list, 'tpl-1', NOW + 1);
  assert.equal(archived.length, 2, 'archiving must never remove the entry from the list');
  assert.equal(archived[0].archived, true);
  assert.deepEqual(listActiveTemplates(archived).map((t) => t.id), ['tpl-2']);
  assert.deepEqual(listArchivedTemplates(archived).map((t) => t.id), ['tpl-1']);
  const restored = unarchiveTemplate(archived, 'tpl-1', NOW + 2);
  assert.equal(restored[0].archived, false);
});

test('exportTemplateJSON / importTemplateJSON: round-trips a template, assigning a FRESH id and resetting archived/timestamps rather than trusting the imported ones', () => {
  const source = createSceneTemplate([], { name: 'Exported', recipe: { bgColor: '#123456' }, now: NOW });
  const localList = addTemplate([], source); // source still present locally (the realistic case: import happens alongside the exported original)
  const archivedSource = { ...source, archived: true }; // simulate exporting something that happened to be archived
  const json = exportTemplateJSON(archivedSource);
  const { list, error } = importTemplateJSON(localList, json, NOW + 5000);
  assert.equal(error, null);
  assert.equal(list.length, 2);
  const imported = list[1];
  assert.notEqual(imported.id, source.id, 'import must never trust/reuse the exported id (avoids collisions with an existing local template)');
  assert.equal(imported.archived, false, 'an imported template must always start active, regardless of the exported archived flag');
  assert.equal(imported.createdAt, NOW + 5000);
  assert.deepEqual(imported.recipe, { bgColor: '#123456' });
});

test('importTemplateJSON: importing into an EMPTY list assigns tpl-1 (no source present locally to collide with — the id-freshness guarantee is relative to the target list, not the export origin)', () => {
  const source = createSceneTemplate([], { name: 'Exported', recipe: {}, now: NOW });
  const json = exportTemplateJSON(source);
  const { list } = importTemplateJSON([], json, NOW + 1);
  assert.equal(list[0].id, 'tpl-1');
});

test('importTemplateJSON: rejects invalid JSON without mutating the list', () => {
  const list = [validTemplate({ id: 'tpl-1' })];
  const result = importTemplateJSON(list, 'not json at all', NOW);
  assert.equal(result.list, list);
  assert.ok(result.error);
});

test('importTemplateJSON: rejects a well-formed-JSON object that is not a valid Scene Template (wrong kind, missing recipe)', () => {
  const list = [];
  const notAScene = JSON.stringify({ schemaVersion: 1, id: 'x', scope: 'local', kind: 'render', name: 'Not A Scene' });
  const result = importTemplateJSON(list, notAScene, NOW);
  assert.equal(result.list, list);
  assert.ok(result.error);
});

test('importTemplateJSON: rejects an unrecognized schema version', () => {
  const result = importTemplateJSON([], JSON.stringify({ schemaVersion: 99, kind: 'scene', recipe: {} }), NOW);
  assert.ok(result.error);
});
