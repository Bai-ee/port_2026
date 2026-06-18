import test from 'node:test';
import assert from 'node:assert/strict';
import { inferXObjective } from '../objective-inference.js';

test('strong kolActivity infers qualified-conversations', () => {
  const result = inferXObjective({
    intelligence: {
      kolActivity: [{ name: '@user1' }, { name: '@user2' }],
      viralOpportunities: [],
    },
  });
  assert.strictEqual(result.objective, 'qualified-conversations');
  assert.ok(result.postTypeMix.includes('reply-loop'));
});

test('strong viralOpportunities infers qualified-conversations', () => {
  const result = inferXObjective({
    intelligence: {
      kolActivity: [],
      viralOpportunities: ['trend1', 'trend2'],
    },
  });
  assert.strictEqual(result.objective, 'qualified-conversations');
});

test('CTA + lead objective infers leads-or-calls', () => {
  const result = inferXObjective({
    campaign: { ctaText: 'Book a call', ctaUrl: 'https://cal.com/xyz' },
    brief: { objectives: 'generate leads and book calls' },
  });
  assert.strictEqual(result.objective, 'leads-or-calls');
  assert.ok(result.postTypeMix.includes('offer'));
});

test('proof/case study material infers profile-clicks-and-follows', () => {
  const result = inferXObjective({
    intelligence: {
      kolActivity: [],
      viralOpportunities: [],
      brandMentions: [{ text: 'great results' }],
    },
    brief: { objectives: 'show results' },
  });
  assert.strictEqual(result.objective, 'profile-clicks-and-follows');
  assert.ok(result.postTypeMix.includes('proof-loop'));
});

test('empty/weak account context defaults to topic-authority', () => {
  const result = inferXObjective({});
  assert.strictEqual(result.objective, 'topic-authority');
  assert.ok(result.postTypeMix.includes('authority'));
});

test('returns reason string', () => {
  const result = inferXObjective({});
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
});

test('postTypeMix is non-empty array', () => {
  const result = inferXObjective({});
  assert.ok(Array.isArray(result.postTypeMix) && result.postTypeMix.length > 0);
});
