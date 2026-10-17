import test from 'node:test';
import assert from 'node:assert/strict';
import { actionCardModel, undoChipModel, messageUndoChips, typedMatches } from '../action-ui-model.js';

test('tier 2 irreversible is danger with cannot-undo line', () => {
  const m = actionCardModel({ payload: { tier: 2, title: 'Delete 12 posts', warning: 'This will delete 12 drafts.', affected: 12, irreversible: true } });
  assert.equal(m.tone, 'danger');
  assert.equal(m.needsTyped, false);
  assert.ok(m.warningLines.includes("This can't be undone."));
  assert.ok(m.warningLines.some((l) => l.includes('12 items')));
});
test('tier 3 X post needs typed confirm and shows cost + account', () => {
  const m = actionCardModel({ payload: { tier: 3, external: 'x', cost: '3 X writes', confirmText: 'post 3' } });
  assert.equal(m.tone, 'danger');
  assert.equal(m.needsTyped, true);
  assert.equal(m.confirmText, 'post 3');
  assert.ok(m.warningLines.some((l) => /X account/.test(l)));
  assert.ok(m.warningLines.some((l) => /Cost: 3 X writes/.test(l)));
  assert.equal(typedMatches(m, ' Post 3 '), true);
  assert.equal(typedMatches(m, 'post 4'), false);
});
test('tier 1 is info; empty payload is safe', () => {
  assert.equal(actionCardModel({ payload: { tier: 1 } }).tone, 'info');
  assert.equal(actionCardModel(null).title, 'Run an action');
});
test('undo chip model', () => {
  assert.equal(undoChipModel({ ok: true }), null);
  assert.equal(undoChipModel({ undoId: 'u1' }).undoId, 'u1');
  assert.equal(messageUndoChips({ undoIds: ['a', 'a'], toolResults: [{ undoId: 'b' }, {}] }).length, 2);
});
