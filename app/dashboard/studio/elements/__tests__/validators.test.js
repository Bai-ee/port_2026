import test from 'node:test';
import assert from 'node:assert/strict';
import { clampNumber, isHexColor, clampVec3, clampString, normalizeFieldGroup, defaultsFromFieldGroup } from '../validators.js';

test('clampNumber: clamps into [min, max], falls back on non-finite input', () => {
  assert.equal(clampNumber(5, 0, 2, 1), 2);
  assert.equal(clampNumber(-5, 0, 2, 1), 0);
  assert.equal(clampNumber(1.5, 0, 2, 1), 1.5);
  assert.equal(clampNumber('x', 0, 2, 1), 1);
  assert.equal(clampNumber(undefined, 0, 2, 1), 1);
  assert.equal(clampNumber(NaN, 0, 2, 1), 1);
});

test('isHexColor: accepts 3/6-digit hex, rejects everything else', () => {
  assert.equal(isHexColor('#fff'), true);
  assert.equal(isHexColor('#ffffff'), true);
  assert.equal(isHexColor('#FFAA00'), true);
  assert.equal(isHexColor('red'), false);
  assert.equal(isHexColor('#ff'), false);
  assert.equal(isHexColor('ffffff'), false);
  assert.equal(isHexColor(123), false);
  assert.equal(isHexColor(null), false);
});

test('clampVec3: non-array input falls back to the whole default vector', () => {
  const spec = { min: 0, max: 2, default: [1, 1, 1] };
  assert.deepEqual(clampVec3('nope', spec), [1, 1, 1]);
  assert.deepEqual(clampVec3(null, spec), [1, 1, 1]);
});

test('clampVec3: clamps per-component and keeps valid components on partial garbage', () => {
  const spec = { min: 0.4, max: 2.2, default: [1, 1, 1] };
  assert.deepEqual(clampVec3([5, 'x', -1], spec), [2.2, 1, 0.4]);
});

test('normalizeFieldGroup: drops keys not present in the spec', () => {
  const spec = { clarity: { type: 'number', min: 0, max: 0.4, default: 0.06 } };
  const out = normalizeFieldGroup({ clarity: 0.2, bogus: 'nope', __proto__: { evil: 1 } }, spec);
  assert.deepEqual(out, { clarity: 0.2 });
  assert.equal(out.bogus, undefined);
  assert.equal(out.evil, undefined);
});

test('normalizeFieldGroup: clamps numbers, validates booleans/colors/enums/vectors', () => {
  const spec = {
    n: { type: 'number', min: 0, max: 1, default: 0.5 },
    b: { type: 'boolean', default: true },
    c: { type: 'color', default: '#ffffff' },
    e: { type: 'enum', values: ['a', 'b'], default: 'a' },
    v: { type: 'vec3', min: -1, max: 1, default: [0, 0, 0] },
  };
  const out = normalizeFieldGroup({ n: 5, b: 'yes', c: 'not-a-color', e: 'zzz', v: [2, 0, -2] }, spec);
  assert.equal(out.n, 1); // clamped
  assert.equal(out.b, true); // invalid type -> default
  assert.equal(out.c, '#ffffff'); // invalid color -> default
  assert.equal(out.e, 'a'); // not in values -> default
  assert.deepEqual(out.v, [1, 0, -1]); // clamped per-component
});

test('clampString: non-string input falls back; strings are truncated to maxLength', () => {
  assert.equal(clampString('hello', 10, 'fallback'), 'hello');
  assert.equal(clampString('hello world', 5, 'fallback'), 'hello');
  assert.equal(clampString(123, 10, 'fallback'), 'fallback');
  assert.equal(clampString(null, 10, 'fallback'), 'fallback');
  assert.equal(clampString(undefined, 10, 'fallback'), 'fallback');
  assert.equal(clampString('x', 0, 'fallback'), 'x'); // maxLength 0/falsy -> the 200-char generic cap applies, string still passes through untruncated
});

test('normalizeFieldGroup: string type is bounded/sanitized, never passed through unchecked', () => {
  const spec = { assetId: { type: 'string', maxLength: 8, default: '' } };
  assert.deepEqual(normalizeFieldGroup({ assetId: 'abc123' }, spec), { assetId: 'abc123' });
  assert.deepEqual(normalizeFieldGroup({ assetId: 'way-too-long-for-eight' }, spec), { assetId: 'way-too-' });
  assert.deepEqual(normalizeFieldGroup({ assetId: 12345 }, spec), { assetId: '' });
  assert.deepEqual(normalizeFieldGroup({}, spec), { assetId: '' });
});

test('normalizeFieldGroup: undefined/null raw input still produces full defaults', () => {
  const spec = { n: { type: 'number', min: 0, max: 1, default: 0.5 } };
  assert.deepEqual(normalizeFieldGroup(undefined, spec), { n: 0.5 });
  assert.deepEqual(normalizeFieldGroup(null, spec), { n: 0.5 });
});

test('defaultsFromFieldGroup: returns fresh (non-shared) default values', () => {
  const spec = { v: { type: 'vec3', min: -1, max: 1, default: [0, 0, 0] } };
  const a = defaultsFromFieldGroup(spec);
  const b = defaultsFromFieldGroup(spec);
  a.v.push(99);
  assert.deepEqual(b.v, [0, 0, 0]); // not mutated by the other call
});
