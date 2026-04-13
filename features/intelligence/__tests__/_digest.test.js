'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { generateDigest, MAX_DIGEST_TOKENS } = require('../_digest');

test('empty input returns empty bullets and zero tokens', () => {
  const d = generateDigest([]);
  assert.deepStrictEqual(d.briefingBullets, []);
  assert.strictEqual(d.totalTokenEst, 0);
});

test('non-array input is treated as empty', () => {
  const d = generateDigest(null);
  assert.deepStrictEqual(d.briefingBullets, []);
});

test('signals from a single source appear in bullets', () => {
  const d = generateDigest([
    { id: 'src-a', enabled: true, signals: ['Performance score 44/100', 'SEO baseline strong'] },
  ]);
  assert.deepStrictEqual(d.briefingBullets, ['Performance score 44/100', 'SEO baseline strong']);
});

test('disabled sources are excluded', () => {
  const d = generateDigest([
    { id: 'src-a', enabled: false, signals: ['should not appear'] },
    { id: 'src-b', enabled: true,  signals: ['should appear'] },
  ]);
  assert.deepStrictEqual(d.briefingBullets, ['should appear']);
});

test('duplicate signals across sources are deduped', () => {
  const d = generateDigest([
    { id: 'src-a', enabled: true, signals: ['LCP is slow', 'SEO good'] },
    { id: 'src-b', enabled: true, signals: ['LCP is slow', 'New fact'] },
  ]);
  const count = d.briefingBullets.filter((b) => b === 'LCP is slow').length;
  assert.strictEqual(count, 1);
});

test('output is deterministic: identical input produces identical bullets', () => {
  const sources = [
    { id: 'z-source', enabled: true, signals: ['Z signal'] },
    { id: 'a-source', enabled: true, signals: ['A signal'] },
  ];
  const d1 = generateDigest(sources);
  const d2 = generateDigest(sources);
  assert.deepStrictEqual(d1.briefingBullets, d2.briefingBullets);
});

test('sources are processed in stable alphabetical id order', () => {
  const d = generateDigest([
    { id: 'z-source', enabled: true, signals: ['from-z'] },
    { id: 'a-source', enabled: true, signals: ['from-a'] },
  ]);
  assert.strictEqual(d.briefingBullets[0], 'from-a');
  assert.strictEqual(d.briefingBullets[1], 'from-z');
});

test('totalTokenEst is greater than zero for non-empty input', () => {
  const d = generateDigest([
    { id: 'src', enabled: true, signals: ['some signal here'] },
  ]);
  assert.ok(d.totalTokenEst > 0);
});

test('token cap: signals that would exceed MAX_DIGEST_TOKENS are skipped', () => {
  // Generate enough signals to exceed the cap
  const longSignal = 'word '.repeat(500).trim(); // ~500 words × 1.3 ≈ 650 tokens
  const sources = [
    { id: 'src', enabled: true, signals: [longSignal, longSignal + ' extra', 'short'] },
  ];
  const d = generateDigest(sources);
  assert.ok(d.totalTokenEst <= MAX_DIGEST_TOKENS);
});

test('positives contains signals matching positive keywords', () => {
  const d = generateDigest([
    { id: 'src', enabled: true, signals: ['SEO is strong', 'Performance is poor'] },
  ]);
  assert.ok(d.positives.includes('SEO is strong'));
  assert.ok(!d.positives.includes('Performance is poor'));
});

test('risks contains signals matching risk keywords', () => {
  const d = generateDigest([
    { id: 'src', enabled: true, signals: ['Performance is poor', 'SEO is strong'] },
  ]);
  assert.ok(d.risks.includes('Performance is poor'));
  assert.ok(!d.risks.includes('SEO is strong'));
});

test('gaps contains signals matching gap keywords', () => {
  const d = generateDigest([
    { id: 'src', enabled: true, signals: ['Missing meta description', 'Title is present'] },
  ]);
  assert.ok(d.gaps.includes('Missing meta description'));
  assert.ok(!d.gaps.includes('Title is present'));
});

test('generatedAt is a non-empty ISO string', () => {
  const d = generateDigest([]);
  assert.ok(typeof d.generatedAt === 'string' && d.generatedAt.length > 0);
  assert.doesNotThrow(() => new Date(d.generatedAt));
});

test('blank signals are skipped', () => {
  const d = generateDigest([
    { id: 'src', enabled: true, signals: ['', '   ', 'real signal'] },
  ]);
  assert.deepStrictEqual(d.briefingBullets, ['real signal']);
});

test('source with no signals field produces no bullets', () => {
  const d = generateDigest([{ id: 'src', enabled: true }]);
  assert.deepStrictEqual(d.briefingBullets, []);
});
