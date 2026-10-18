// creative-picker-model: tile states (staged / format / rights) and filter + search. Pure; no I/O.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileState, pickerTiles, pickMediaRef, REASONS } from '../creative-picker-model.js';
import { pickMediaRef as serverPickMediaRef } from '../../../../features/x-content-inventory/item-actions.js';

const img = { id: 'a', title: 'Flyer one', assetRefs: ['publish-staging/nas/a/flyer.jpg'], rights: 'owned' };
const mp4 = { id: 'b', title: 'Render', assetRefs: ['ev:renders/b.mp4'], rights: 'owned' };
const mov = { id: 'c', title: 'Raw clip', assetRefs: ['ev:raw/c.mov'], rights: 'owned' };
const nas = { id: 'd', title: 'Unstaged scan', assetRefs: ['9f2c0a-sha256'], rights: 'cleared' };
const text = { id: 'e', title: 'Text only', assetRefs: [] };
const nope = { id: 'f', title: 'Secret', assetRefs: ['ev:x/f.mp4'], rights: 'never-public' };

test('tileState reasons', () => {
  assert.deepEqual(tileState(img), { kind: 'image', staged: true, usable: true, reason: null });
  assert.equal(tileState(mp4).kind, 'video');
  assert.equal(tileState(mp4).usable, true);
  assert.deepEqual([tileState(mov).usable, tileState(mov).reason], [false, REASONS.badFormat]);
  assert.equal(tileState(nas).reason, REASONS.notStaged);
  assert.equal(tileState(text).reason, REASONS.noMedia);
  assert.equal(tileState(nope).reason, REASONS.neverPublic);
});

test('filters', () => {
  const all = [img, mp4, mov, nas, text, nope];
  const ids = (f) => pickerTiles(all, { filter: f }).map((t) => t.item.id);
  assert.deepEqual(ids('image'), ['a']);
  assert.deepEqual(ids('video').sort(), ['b', 'c']);
  assert.deepEqual(ids('staged').sort(), ['a', 'b', 'c']);
  assert.equal(ids('all').length, 6);
});

test('usable tiles sort first, order otherwise stable', () => {
  const ids = pickerTiles([nas, mov, img, mp4]).map((t) => t.item.id);
  assert.deepEqual(ids, ['a', 'b', 'd', 'c']);
});

test('search matches all words over title, story, id, tags', () => {
  const items = [{ ...img, tags: ['house'] }, mp4];
  assert.deepEqual(pickerTiles(items, { query: 'flyer HOUSE' }).map((t) => t.item.id), ['a']);
  assert.deepEqual(pickerTiles(items, { query: 'zzz' }), []);
  assert.deepEqual(pickerTiles(items, { query: 'b' }).map((t) => t.item.id), ['b']);
});

test('tolerates junk input', () => {
  assert.deepEqual(pickerTiles(null), []);
  assert.deepEqual(pickerTiles([null, {}, { title: 'no id' }]), []);
});

test('local pickMediaRef stays in parity with the server pick rule', () => {
  const cases = [img, mp4, mov, nas, text, nope, { assetRefs: ['ev:../x.mp4', 'ev:/abs.mp4', 'publish-staging/ok.webp'] }, { assetRefs: ['ev:a/b.txt'] }];
  for (const c of cases) {
    const a = pickMediaRef(c);
    const b = serverPickMediaRef(c);
    assert.deepEqual(a, b ? { kind: b.kind, contentType: b.contentType } : null);
  }
});
