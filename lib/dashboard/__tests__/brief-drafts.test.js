import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBriefSuggestedPost,
  parseEstimateLineItems,
  hydrateEstimateBriefDraft,
  buildDefaultEstimateBriefDraft,
} from '../brief-drafts.js';

test('parseBriefSuggestedPost: collects the Suggested Post section until the next label', () => {
  const raw = [
    'Headline: Some Headline',
    'What This Site Is: describes the site',
    'Suggested Post: Check out our new',
    'feature launch today!',
    'Biggest Risk: something',
  ].join('\n');
  assert.strictEqual(parseBriefSuggestedPost(raw), 'Check out our new feature launch today!');
});

test('parseBriefSuggestedPost: Suggested Post as the final section (no trailing label)', () => {
  const raw = ['Headline: X', 'Suggested Post: Final line only'].join('\n');
  assert.strictEqual(parseBriefSuggestedPost(raw), 'Final line only');
});

test('parseBriefSuggestedPost: returns empty string when no Suggested Post label is present', () => {
  const raw = ['Headline: X', 'Decision: Y'].join('\n');
  assert.strictEqual(parseBriefSuggestedPost(raw), '');
});

test('parseBriefSuggestedPost: falsy input short-circuits to empty string', () => {
  assert.strictEqual(parseBriefSuggestedPost(null), '');
  assert.strictEqual(parseBriefSuggestedPost(undefined), '');
  assert.strictEqual(parseBriefSuggestedPost(''), '');
});

test('parseEstimateLineItems: parses pipe-delimited rows and filters rows with no label', () => {
  const text = [
    'Website redesign | Client-facing homepage redesign. | 4500 | 1',
    'Launch QA | Final review. | 750',
    ' | ignored because no label',
  ].join('\n');
  const rows = parseEstimateLineItems(text);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], {
    id: 'line-1', label: 'Website redesign', description: 'Client-facing homepage redesign.', unitPrice: 4500, quantity: 1,
  });
  // Missing quantity column falls back to 1
  assert.deepStrictEqual(rows[1], {
    id: 'line-2', label: 'Launch QA', description: 'Final review.', unitPrice: 750, quantity: 1,
  });
});

test('parseEstimateLineItems: empty text returns an empty array', () => {
  assert.deepStrictEqual(parseEstimateLineItems(''), []);
  assert.deepStrictEqual(parseEstimateLineItems(undefined), []);
});

test('hydrateEstimateBriefDraft: array lineItems are formatted into lineItemsText', () => {
  const draft = hydrateEstimateBriefDraft(
    { lineItems: [{ label: 'X', description: 'Y', unitPrice: 10, quantity: 2 }] },
    { companyName: 'Acme' },
  );
  assert.strictEqual(draft.lineItemsText, 'X | Y | 10 | 2');
});

test('hydrateEstimateBriefDraft: a string lineItemsText passes through untouched', () => {
  const draft = hydrateEstimateBriefDraft({ lineItemsText: 'Custom | Text | 5 | 1' }, { companyName: 'Acme' });
  assert.strictEqual(draft.lineItemsText, 'Custom | Text | 5 | 1');
});

test('hydrateEstimateBriefDraft: empty config falls back to the client default draft', () => {
  const client = { companyName: 'Acme' };
  const draft = hydrateEstimateBriefDraft({}, client);
  const fallback = buildDefaultEstimateBriefDraft(client);
  assert.strictEqual(draft.lineItemsText, fallback.lineItemsText);
  assert.strictEqual(draft.offerSummary, fallback.offerSummary);
});
