import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyForm, formFromV2, toV2Body, formTotalSeconds, overBudget, formMissing, addBeat, removeBeat, moveBeat, setBeatCell, canUseV2, isV2Row, V2_BEATS_MAX, secondsCap, beatsCap,
} from '../video-brief-v2-model.js';

test('form <-> v2 body round trip; lists split per line; seconds numeric', () => {
  const f = { ...emptyForm(), format: 'guide', lesson: 'Posting a Defender', posterBanner: 'SET YOUR DEFENDER', narrationLines: 'One.\n\n Two. ', needs: 'NEEDS: modal' };
  f.beats = [{ ...f.beats[0], seconds: '4.5' }];
  const body = toV2Body(f);
  assert.equal(body.format, 'guide');
  assert.deepEqual(body.narrationLines, ['One.', 'Two.']);
  assert.deepEqual(body.needs, ['NEEDS: modal']);
  assert.equal(body.beats[0].seconds, 4.5);
  assert.equal(body.poster.banner, 'SET YOUR DEFENDER');
  assert.equal(formFromV2({ ...body, narrationLines: ['One.'] }).narrationLines, 'One.');
  assert.equal(formFromV2(null).beats.length, 3);
});

test('total seconds and the 30 s budget', () => {
  const f = emptyForm();
  f.beats = f.beats.map((b) => ({ ...b, seconds: '10' }));
  assert.equal(formTotalSeconds(f), 30); assert.equal(overBudget(f), false);
  f.beats = setBeatCell(f.beats, 0, 'seconds', '11');
  assert.equal(overBudget(f), true);
});

test('beat add / remove / reorder and caps', () => {
  let b = emptyForm().beats;
  while (b.length < V2_BEATS_MAX) b = addBeat(b);
  assert.equal(addBeat(b).length, V2_BEATS_MAX);
  b = setBeatCell(b, 0, 'purpose', 'first');
  assert.equal(moveBeat(b, 0, 1)[1].purpose, 'first');
  assert.equal(moveBeat(b, 0, -1)[0].purpose, 'first');
  assert.equal(removeBeat([b[0]], 0).length, 1);
  assert.equal(removeBeat(b, 0).length, V2_BEATS_MAX - 1);
});

test('live missing list matches the server rule; v2 detection', () => {
  assert.ok(formMissing(emptyForm()).includes('format'));
  assert.equal(canUseV2({ clientId: 'paradice-dbBQCHUX' }), true);
  assert.equal(canUseV2({ clientId: 'other' }), false);
  assert.equal(isV2Row({ videoBriefMeta: { briefVersion: 2, v2: {} } }), true);
  assert.equal(isV2Row({ videoBriefMeta: { status: 'draft' } }), false);
});

test('promo form: treatment/cast/bubbles round trip; 23 s and 3-beat caps', () => {
  const f = { ...emptyForm(), format: 'promo', treatment: 'faceOff', cast: 'Gravitax\nAxiom', bubbles: 'A\nB' };
  const body = toV2Body(f);
  assert.deepEqual(body.cast, ['Gravitax', 'Axiom']);
  assert.equal(formFromV2(body).bubbles, 'A\nB');
  assert.equal(secondsCap(f), 23); assert.equal(beatsCap(f), 3);
  f.beats = f.beats.map((b) => ({ ...b, seconds: '8' }));
  assert.equal(overBudget(f), true);
  assert.equal(addBeat(f.beats, beatsCap(f)).length, 3);
  assert.ok(formMissing({ ...f, treatment: '' }).includes('treatment'));
});
