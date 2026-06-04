import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEstimate } from '../estimate-generator.js';
import { verifyEstimate } from '../estimate-verifier.js';
import { renderEstimateHtml } from '../estimate-renderer.js';

function makeProspect(overrides = {}) {
  return {
    name: 'Acme Dental',
    website: 'https://example.com',
    generation: {
      designMd: '# DESIGN.MD',
      previewUrl: 'https://preview.example.com',
      readinessComparison: {
        before: { score: 42 },
        after: { score: 81 },
        improvement: 39,
      },
      contentJson: JSON.stringify({
        copy: { serviceNames: ['Cleaning', 'Whitening'] },
      }),
    },
    ...overrides,
  };
}

test('generateEstimate calculates totals from editable line items', () => {
  const estimate = generateEstimate({
    prospect: makeProspect(),
    config: {
      lineItems: [
        { label: 'Site', description: 'Build', quantity: 1, unitPrice: 5000 },
        { label: 'SEO', description: 'Setup', quantity: 2, unitPrice: 750 },
      ],
    },
  });

  assert.equal(estimate.subtotal, 6500);
  assert.equal(estimate.total, 6500);
  assert.equal(estimate.lineItems[1].total, 1500);
});

test('verifyEstimate rejects readiness proof that does not match stored comparison', () => {
  const estimate = generateEstimate({ prospect: makeProspect() });
  estimate.proof.readinessAfter = 99;

  const result = verifyEstimate(estimate, {
    previewUrl: 'https://preview.example.com',
    readinessComparison: makeProspect().generation.readinessComparison,
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /readiness proof/);
});

test('renderEstimateHtml escapes untrusted estimate text', () => {
  const estimate = generateEstimate({
    prospect: makeProspect({ name: '<script>alert(1)</script>' }),
    config: {
      offerSummary: '<img src=x onerror=alert(1)>',
      lineItems: [{ label: '<b>Bad</b>', quantity: 1, unitPrice: 100 }],
    },
  });
  const html = renderEstimateHtml(estimate, { clientId: 'client-1' });

  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});
