import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncResultLine, syncChangedRows } from '../sync-view.js';

test('syncResultLine: a quiet sync reads "0 new · N up to date"', () => {
  assert.equal(syncResultLine({ created: 0, updated: 0, unchanged: 820, total: 820 }, '3 min ago'), '0 new · 820 up to date · synced 3 min ago');
});

test('syncResultLine: changes are listed; a throttled echo is labelled as the last sync', () => {
  assert.equal(syncResultLine({ created: 2, updated: 1, retired: 1, unchanged: 5 }), '2 new · 1 updated · 1 retired · 5 up to date');
  assert.equal(syncResultLine({ throttled: true, created: 0, updated: 820, unchanged: 0 }, '4 min ago'), 'Last sync: 0 new · 820 updated · 0 up to date · 4 min ago');
  assert.equal(syncResultLine(null), 'Not synced yet');
});

test('syncChangedRows: only a real sync that wrote rows asks for a reload', () => {
  assert.equal(syncChangedRows({ created: 0, updated: 0, unchanged: 3 }), false);
  assert.equal(syncChangedRows({ created: 1 }), true);
  assert.equal(syncChangedRows({ throttled: true, updated: 820 }), false);
  assert.equal(syncChangedRows(null), false);
});
