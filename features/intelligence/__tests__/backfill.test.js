'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { existingIsNewer, wrapStoredSeoAudit } = require('../../../scripts/backfill-psi-intelligence.cjs');

// ── existingIsNewer ───────────────────────────────────────────────────────────

test('returns false when no existing source doc', () => {
  assert.strictEqual(existingIsNewer(null, { fetchedAt: '2026-04-10T00:00:00Z' }), false);
});

test('returns false when existing has no fetchedAt', () => {
  assert.strictEqual(existingIsNewer({}, { fetchedAt: '2026-04-10T00:00:00Z' }), false);
});

test('returns true when existing is same timestamp as seoAudit', () => {
  const ts = '2026-04-10T00:00:00Z';
  assert.strictEqual(existingIsNewer({ fetchedAt: ts }, { fetchedAt: ts }), true);
});

test('returns true when existing is newer than seoAudit', () => {
  assert.strictEqual(
    existingIsNewer(
      { fetchedAt: '2026-04-12T00:00:00Z' },
      { fetchedAt: '2026-04-10T00:00:00Z' }
    ),
    true
  );
});

test('returns false when existing is older than seoAudit', () => {
  assert.strictEqual(
    existingIsNewer(
      { fetchedAt: '2026-04-08T00:00:00Z' },
      { fetchedAt: '2026-04-10T00:00:00Z' }
    ),
    false
  );
});

test('returns true when seoAudit has no fetchedAt (keep existing)', () => {
  assert.strictEqual(existingIsNewer({ fetchedAt: '2026-04-10T00:00:00Z' }, {}), true);
});

test('returns true when seoAudit is null (keep existing)', () => {
  assert.strictEqual(existingIsNewer({ fetchedAt: '2026-04-10T00:00:00Z' }, null), true);
});

// ── wrapStoredSeoAudit ────────────────────────────────────────────────────────

test('wraps a valid seoAudit as ok psi result', () => {
  const seoAudit = {
    fetchedAt:  '2026-04-10T00:00:00Z',
    websiteUrl: 'https://example.com',
    scores:     { performance: 60, seo: 80 },
    status:     'ok',
  };
  const result = wrapStoredSeoAudit(seoAudit, 'https://example.com');
  assert.strictEqual(result.ok,     true);
  assert.strictEqual(result.error,  null);
  assert.deepStrictEqual(result.seoAudit, seoAudit);
});

test('applies websiteUrl fallback when seoAudit.websiteUrl is absent', () => {
  const seoAudit = { fetchedAt: '2026-04-10T00:00:00Z', status: 'ok', scores: { performance: 60 } };
  const result   = wrapStoredSeoAudit(seoAudit, 'https://fallback.com');
  assert.strictEqual(result.seoAudit.websiteUrl, 'https://fallback.com');
});

test('wraps a seoAudit with status=partial as ok (data is present)', () => {
  const seoAudit = { fetchedAt: '2026-04-10T00:00:00Z', websiteUrl: 'https://x.com', status: 'partial', scores: { performance: 30 } };
  const result   = wrapStoredSeoAudit(seoAudit, 'https://x.com');
  assert.strictEqual(result.ok, true);
});

test('wraps a null input as error result', () => {
  const result = wrapStoredSeoAudit(null, 'https://example.com');
  assert.strictEqual(result.ok, false);
  assert.ok(typeof result.error === 'string');
});

test('wraps an error-status seoAudit as error result', () => {
  const seoAudit = { status: 'error', error: 'timeout' };
  const result   = wrapStoredSeoAudit(seoAudit, 'https://example.com');
  assert.strictEqual(result.ok,  false);
  assert.match(result.error,     /timeout/);
});
