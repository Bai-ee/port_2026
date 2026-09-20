import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportForWorker, QUESTIONS, REVIEW_BANDS } from '../jev-taxonomy.js';
import { PILLARS, SERIES } from '../categories.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT = path.join(HERE, '..', 'jev-taxonomy.export.json');

function contractOf(obj) {
  const { generatedAt, ...rest } = obj ?? {};
  return rest;
}

test('the committed artifact matches the source vocabulary', () => {
  // The worker vendors this JSON because it is TypeScript in another repo and
  // cannot import the module. If the two disagree, the archive tags assets with
  // a vocabulary this engine no longer uses — the exact drift that made 27 of
  // 28 benchmark topics read as "0% of your output".
  assert.ok(existsSync(ARTIFACT), 'run: node scripts/x-content/export-jev-taxonomy.mjs');
  const onDisk = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
  assert.deepEqual(
    contractOf(onDisk),
    contractOf(exportForWorker()),
    'jev-taxonomy.export.json is stale — regenerate it',
  );
});

test('choices are derived from categories.js, never retyped', () => {
  // The whole point of deriving them: a hand-written second copy is how the two
  // sides drift apart without anyone noticing.
  const exported = exportForWorker();
  const pillar = exported.questions.find((q) => q.id === 'pillar');
  const series = exported.questions.find((q) => q.id === 'series');
  assert.deepEqual(pillar.choices, Object.keys(PILLARS));
  assert.deepEqual(series.choices, Object.keys(SERIES));
});

test('the export carries the review bands the worker branches on', () => {
  const exported = exportForWorker();
  assert.equal(exported.reviewBands.AUTO_CONFIRM, REVIEW_BANDS.AUTO_CONFIRM);
  assert.equal(exported.reviewBands.QUICK_REVIEW, REVIEW_BANDS.QUICK_REVIEW);
});

test('every question survives the export with the fields the worker needs', () => {
  const exported = exportForWorker();
  assert.equal(exported.questions.length, QUESTIONS.length);
  for (const q of exported.questions) {
    assert.ok(q.id, 'id');
    assert.ok(q.question, `question text for ${q.id}`);
    assert.ok(Array.isArray(q.choices), `choices for ${q.id}`);
    assert.equal(typeof q.gate, 'boolean');
    assert.equal(typeof q.openEnded, 'boolean');
  }
});

test('the gate and the blocked question are both marked in the artifact', () => {
  // The worker must be able to see, from the JSON alone, that clientWork can
  // never auto-apply and that entities has nothing to write to yet.
  const exported = exportForWorker();
  const gates = exported.questions.filter((q) => q.gate).map((q) => q.id);
  const blocked = exported.questions.filter((q) => q.blocked).map((q) => q.id);
  assert.deepEqual(gates, ['clientWork']);
  assert.deepEqual(blocked, ['entities']);
});
