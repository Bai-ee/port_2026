import test from 'node:test';
import assert from 'node:assert/strict';
import { createBaseline, setRoleCustom, STORAGE_KEYS } from '../../theme/index.js';
import { hashDefinition, canonicalize } from '../../theme/validate.js';
import { createLibrary, LIBRARY_CAP } from '../library.js';

function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); return true; } };
}
function make(opts = {}) {
  let t = 1000;
  const storage = opts.storage || memStorage();
  return { storage, lib: createLibrary({ storage, now: () => ++t, ...opts.lib }) };
}
const def = () => createBaseline();

test('storage key is registered', () => {
  assert.equal(STORAGE_KEYS.library, 'theme-studio:library:v1');
});

test('save, list, load: canonical definition round trips', () => {
  const { lib } = make();
  const d = def();
  const r = lib.save({ name: '  My   theme ', definition: d });
  assert.equal(r.ok, true);
  assert.equal(r.entry.name, 'My theme');
  assert.equal(r.entry.hash, hashDefinition(d));
  assert.match(r.entry.preview.accent, /^#[0-9a-f]{6}$/i);
  assert.match(r.entry.preview.page, /^#[0-9a-f]{6}$/i);
  assert.match(r.entry.preview.text, /^#[0-9a-f]{6}$/i);
  const { entries } = lib.list();
  assert.equal(entries.length, 1);
  const loaded = lib.load(r.entry.id);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.definition, canonicalize(d));
});

test('rename, star toggle, duplicate, remove', () => {
  const { lib } = make();
  const a = lib.save({ name: 'A', definition: def() }).entry;
  assert.equal(lib.rename(a.id, 'Alpha').entry.name, 'Alpha');
  assert.equal(lib.rename(a.id, '   ').entry.name, 'Alpha');
  assert.equal(lib.star(a.id).entry.starred, true);
  assert.equal(lib.star(a.id).entry.starred, false);
  assert.equal(lib.star(a.id, true).entry.starred, true);
  const dup = lib.duplicate(a.id);
  assert.equal(dup.entry.name, 'Alpha copy');
  assert.notEqual(dup.entry.id, a.id);
  assert.equal(dup.entry.starred, false);
  assert.equal(dup.entry.hash, a.hash);
  assert.equal(lib.list().entries.length, 2);
  assert.equal(lib.remove(a.id).ok, true);
  assert.equal(lib.list().entries.length, 1);
  assert.equal(lib.remove(a.id).ok, false);
  assert.equal(lib.load('nope').ok, false);
  assert.equal(lib.rename('nope', 'x').ok, false);
});

test('list is newest-updated first', () => {
  const { lib } = make();
  const a = lib.save({ name: 'A', definition: def() }).entry;
  lib.save({ name: 'B', definition: def() });
  lib.rename(a.id, 'A2');
  assert.deepEqual(lib.list().entries.map((e) => e.name), ['A2', 'B']);
});

test('cap evicts the oldest unstarred and keeps starred', () => {
  const { lib } = make();
  const first = lib.save({ name: 'first', definition: def() }).entry;
  lib.star(first.id, true);
  const second = lib.save({ name: 'second', definition: def() }).entry;
  for (let i = 0; i < LIBRARY_CAP - 2; i += 1) lib.save({ name: `n${i}`, definition: def() });
  assert.equal(lib.list().entries.length, LIBRARY_CAP);
  const r = lib.save({ name: 'overflow', definition: def() });
  assert.equal(r.ok, true);
  assert.match(r.notice, /removed the oldest unstarred theme "second"/);
  const names = lib.list().entries.map((e) => e.name);
  assert.equal(names.length, LIBRARY_CAP);
  assert.ok(names.includes('first'));
  assert.ok(!names.includes('second'));
  assert.ok(names.includes('overflow'));
  assert.equal(lib.load(second.id).ok, false);
});

test('full of starred themes refuses the save without losing anything', () => {
  const { lib } = make({ lib: { cap: 3 } });
  for (let i = 0; i < 3; i += 1) lib.star(lib.save({ name: `s${i}`, definition: def() }).entry.id, true);
  const r = lib.save({ name: 'extra', definition: def() });
  assert.equal(r.ok, false);
  assert.match(r.notice, /all starred/);
  assert.equal(lib.list().entries.length, 3);
});

test('corrupt storage reads as empty with a notice and never throws', () => {
  for (const raw of ['{not json', '"str"', '{"entries":5}', '[]']) {
    const { lib } = make({ storage: memStorage({ [STORAGE_KEYS.library]: raw }) });
    const l = lib.list();
    assert.deepEqual(l.entries, []);
    assert.ok(l.notice);
    assert.equal(lib.save({ name: 'ok', definition: def() }).ok, true); // recovers
    assert.equal(lib.list().entries.length, 1);
  }
  const throwing = { get() { throw new Error('boom'); }, set() { throw new Error('boom'); } };
  const lib = createLibrary({ storage: throwing });
  assert.deepEqual(lib.list().entries, []);
  assert.equal(lib.save({ name: 'x', definition: def() }).ok, false);
  assert.equal(createLibrary({}).list().entries.length, 0);
});

test('bad entries are skipped, good ones survive', () => {
  const { lib, storage } = make();
  lib.save({ name: 'good', definition: def() });
  const blob = JSON.parse(storage.get(STORAGE_KEYS.library));
  blob.entries.push({ id: 'bad', name: 'bad', definition: { nope: 1 } }, null);
  storage.set(STORAGE_KEYS.library, JSON.stringify(blob));
  const l = lib.list();
  assert.deepEqual(l.entries.map((e) => e.name), ['good']);
  assert.match(l.notice, /2 unreadable themes were skipped/);
});

test('export then import round trips (replace and merge)', () => {
  const a = make();
  const d2 = setRoleCustom(def(), 'accent', { l: 0.5, c: 0.15, h: 30 });
  a.lib.save({ name: 'one', definition: def() });
  const two = a.lib.save({ name: 'two', definition: d2 }).entry;
  a.lib.star(two.id, true);
  const json = a.lib.exportAll();

  const b = make();
  const r = b.lib.importAll(json, { merge: false });
  assert.equal(r.ok, true);
  assert.equal(r.added, 2);
  const got = b.lib.list().entries;
  assert.deepEqual(got.map((e) => e.name).sort(), ['one', 'two']);
  const gotTwo = got.find((e) => e.name === 'two');
  assert.equal(gotTwo.starred, true);
  assert.deepEqual(b.lib.load(gotTwo.id).definition, canonicalize(d2));
  assert.equal(gotTwo.hash, hashDefinition(d2));

  // merging the same file again adds nothing
  const again = b.lib.importAll(json, { merge: true });
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 2);
  assert.equal(b.lib.list().entries.length, 2);

  // merge into a different library keeps both sets
  const c = make();
  c.lib.save({ name: 'mine', definition: def() });
  c.lib.importAll(json, { merge: true });
  assert.equal(c.lib.list().entries.length, 3);
});

test('import rejects junk without touching the library', () => {
  const { lib } = make();
  lib.save({ name: 'keep', definition: def() });
  assert.equal(lib.importAll('{{{').ok, false);
  assert.equal(lib.importAll(JSON.stringify({ schema: 'other', entries: [] })).ok, false);
  const partial = lib.importAll(JSON.stringify({ schema: 'hitloop.theme-library', version: 1, entries: [{ id: 'z', name: 'z', definition: 7 }] }));
  assert.equal(partial.added, 0);
  assert.equal(partial.skipped, 1);
  assert.equal(lib.list().entries.length, 1);
});

test('import respects the cap and keeps starred', () => {
  const src = make({ lib: { cap: 10 } });
  for (let i = 0; i < 6; i += 1) src.lib.star(src.lib.save({ name: `s${i}`, definition: def() }).entry.id, i === 0);
  const dst = make({ lib: { cap: 4 } });
  const r = dst.lib.importAll(src.lib.exportAll(), { merge: false });
  assert.equal(r.ok, true);
  const names = dst.lib.list().entries.map((e) => e.name);
  assert.equal(names.length, 4);
  assert.ok(names.includes('s0'));
});

test('storage write failure is reported, not thrown', () => {
  const storage = { get: () => null, set: () => false };
  const lib = createLibrary({ storage });
  const r = lib.save({ name: 'x', definition: def() });
  assert.equal(r.ok, false);
  assert.match(r.notice, /Could not save/);
});
