import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MASTER_SAVES_KEY, MAX_MASTER_SAVES,
  nextMasterSaveId, createMasterSave, isValidMasterSave, addMasterSave, deleteMasterSave,
} from '../master-saves.js';
import { TEMPLATE_SCHEMA_VERSION, renameTemplate, updateTemplateRecipe, serializeTemplateList } from '../templates.js';
import { parsePresetListJSON } from '../preset-kinds.js';

const NOW = 1700000000000;
const validSave = (overrides = {}) => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION, id: 'master-1', scope: 'local', kind: 'master',
  name: 'Version 1', recipe: { bgColor: '#000000', timeline: { keyframes: [] } }, archived: false, createdAt: NOW, updatedAt: NOW,
  ...overrides,
});

test('nextMasterSaveId: scans existing ids for the next free N', () => {
  assert.equal(nextMasterSaveId([]), 'master-1');
  assert.equal(nextMasterSaveId(['master-1', 'master-2']), 'master-3');
  assert.equal(nextMasterSaveId(['master-5', 'master-2']), 'master-6');
  assert.equal(nextMasterSaveId(['tpl-9', 'garbage']), 'master-1');
});

test('createMasterSave: blank name auto-names from the id counter, never "Untitled"', () => {
  const s = createMasterSave([], { name: '', recipe: { a: 1 }, now: NOW });
  assert.equal(s.id, 'master-1');
  assert.equal(s.name, 'Version 1');
  assert.equal(s.kind, 'master');
  assert.ok(isValidMasterSave(s));
  const s2 = createMasterSave([validSave(), validSave({ id: 'master-4' })], { name: '   ', recipe: {}, now: NOW });
  assert.equal(s2.name, 'Version 5', 'auto-name follows the monotonic id counter, not list length');
});

test('createMasterSave: explicit name wins, trimmed and clamped to 60 chars', () => {
  const s = createMasterSave([], { name: `  ${'x'.repeat(80)}  `, recipe: {}, now: NOW });
  assert.equal(s.name, 'x'.repeat(60));
});

test('isValidMasterSave: rejects wrong kind, missing recipe, bad timestamps', () => {
  assert.ok(isValidMasterSave(validSave()));
  assert.equal(isValidMasterSave(validSave({ kind: 'scene' })), false);
  assert.equal(isValidMasterSave(validSave({ recipe: null })), false);
  assert.equal(isValidMasterSave(validSave({ createdAt: 'yesterday' })), false);
  assert.equal(isValidMasterSave(null), false);
});

test('addMasterSave: truncates the OLDEST past MAX_MASTER_SAVES so Save never dead-ends', () => {
  let list = [];
  for (let i = 0; i < MAX_MASTER_SAVES + 3; i += 1) {
    list = addMasterSave(list, createMasterSave(list, { name: '', recipe: {}, now: NOW + i }));
  }
  assert.equal(list.length, MAX_MASTER_SAVES);
  assert.equal(list[0].name, 'Version 4', 'the three oldest were truncated');
  assert.equal(list[list.length - 1].name, `Version ${MAX_MASTER_SAVES + 3}`);
});

test('deleteMasterSave: hard-removes by id, leaves others untouched', () => {
  const list = [validSave(), validSave({ id: 'master-2', name: 'Version 2' })];
  const next = deleteMasterSave(list, 'master-1');
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'master-2');
  assert.equal(deleteMasterSave(list, 'nope').length, 2);
});

test('round-trip: serializeTemplateList -> parsePresetListJSON(isValidMasterSave) survives; foreign kinds drop', () => {
  const mine = validSave();
  const foreign = validSave({ id: 'master-2', kind: 'scene' });
  const parsed = parsePresetListJSON(serializeTemplateList([mine, foreign]), { isValidFn: isValidMasterSave });
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], mine);
  assert.equal(MASTER_SAVES_KEY, 'holocloth-master-saves-v1');
});

test('templates.js generic list ops work unchanged on master saves (rename + overwrite recipe)', () => {
  const list = [validSave()];
  const renamed = renameTemplate(list, 'master-1', 'My Launch Look', NOW + 5);
  assert.equal(renamed[0].name, 'My Launch Look');
  assert.equal(renamed[0].updatedAt, NOW + 5);
  const updated = updateTemplateRecipe(renamed, 'master-1', { bgColor: '#ffffff', exportResolutionTier: '2x' }, NOW + 9);
  assert.equal(updated[0].recipe.exportResolutionTier, '2x');
  assert.ok(isValidMasterSave(updated[0]), 'still a valid master save after generic ops');
});
