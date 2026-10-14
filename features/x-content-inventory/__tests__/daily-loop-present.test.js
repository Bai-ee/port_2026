import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotLabel, timingLine, strategySourceLine, slotStatuses } from '../daily-loop/present.js';

test('slotLabel formats and tolerates missing slots', () => {
  assert.equal(slotLabel({ letter: 'D', timeCT: '15:00', type: 'quote-react', pillar: 'P1' }), 'D · 15:00 CT · quote-react · P1');
  assert.equal(slotLabel({ letter: 'C', timeCT: null, type: 'reply', pillar: null }), 'C · anytime today · reply');
  assert.equal(slotLabel(null), null);
});

test('timingLine never says "anytime CT"', () => {
  assert.match(timingLine({ slot: { timeCT: null }, proposedSlot: null }), /^anytime today/);
  assert.match(timingLine({ proposedSlot: { localTime: 'anytime' } }), /^anytime today/);
  assert.match(timingLine({ slot: { timeCT: '15:00' } }), /^proposed 15:00 CT/);
  assert.match(timingLine({ proposedSlot: { localTime: '09:30' } }), /^proposed 09:30 CT/);
});

test('strategySourceLine tolerates absence', () => {
  assert.equal(strategySourceLine(null), null);
  assert.equal(strategySourceLine({ mixSource: 'gap-report', date: '2026-10-10', tier: 1, authoredPerDay: 3 }), 'gap-report · 2026-10-10 · tier 1 · 3 authored/day');
});

test('slotStatuses merges filled and unfilled slots; old runs give []', () => {
  const run = {
    suggestions: [{ slot: { letter: 'D', timeCT: '15:00', type: 'quote-react', pillar: 'P1' } }, { id: 'old' }],
    gaps: [{ code: 'slot-unfilled:A', message: 'm', slot: { letter: 'A', timeCT: '09:00', type: 'original-showcase', pillar: 'P2', fillReason: 'no item' } }, { code: 'brain-not-approved' }],
  };
  const out = slotStatuses(run);
  assert.deepEqual(out.map((s) => [s.letter, s.filled, s.reason]), [['A', false, 'no item'], ['D', true, null]]);
  assert.deepEqual(slotStatuses({ suggestions: [], gaps: [] }), []);
  assert.deepEqual(slotStatuses(null), []);
});

import { suggestionTrigger } from '../daily-loop/present.js';

test('suggestionTrigger classifies from stored fields and honours explicit trigger', () => {
  assert.equal(suggestionTrigger(null), null);
  assert.equal(suggestionTrigger({ conversation: { id: 1 }, why: { now: 'hot' } }).kind, 'hot-narrative');
  assert.equal(suggestionTrigger({ slot: { type: 'self-quote' }, why: { now: 'own post from 40 days ago' } }).kind, 'archive-throwback');
  assert.equal(suggestionTrigger({ package: { id: 'p' }, track: 'Design', why: { now: 'slot A' } }).kind, 'benchmark-gap');
  assert.equal(suggestionTrigger({ package: { id: 'p' }, trigger: { kind: 'opportunity-signal', reason: 'x' } }).kind, 'opportunity-signal');
  assert.equal(suggestionTrigger({ why: {} }), null);
});
