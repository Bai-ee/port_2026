import assert from 'node:assert/strict';
import test from 'node:test';
import { SHOWCASE_CLIENTS, validateCreateInput } from '../registry.js';
import focusFile from '../focus.hitloop.json' with { type: 'json' };

const focus = focusFile.focuses[0];

test('only the HITLOOP owner client is allowlisted', () => {
  assert.deepEqual(SHOWCASE_CLIENTS, { 'bryan-balli-WUoltG84': 'hitloop' });
});

test('accepts a known focus, format and theme; theme defaults to cycle', () => {
  const r = validateCreateInput({ focusId: focus.id, format: focus.formats[0] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { focusId: focus.id, format: focus.formats[0], theme: 'cycle' });
});

test('rejects unknown focus, format and theme', () => {
  assert.equal(validateCreateInput({ focusId: 'nope', format: 'square' }).ok, false);
  assert.equal(validateCreateInput({ focusId: focus.id, format: 'imax' }).ok, false);
  assert.equal(validateCreateInput({ focusId: focus.id, format: focus.formats[0], theme: 'neon' }).ok, false);
  assert.equal(validateCreateInput(null).ok, false);
});

test('ignores params and scenes (value carries only the three keys)', () => {
  const r = validateCreateInput({
    focusId: focus.id, format: focus.formats[0], theme: 'dark',
    params: { label: 'x' }, scenes: [{ kind: 'evil' }], title: 'hijack',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value).sort(), ['focusId', 'format', 'theme']);
});
