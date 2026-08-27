import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDomain, formatFailedAt, buildCreationFailureReport } from '../creation-failure-report.js';

test('extractDomain: strips protocol and www', () => {
  assert.equal(extractDomain('https://www.rositas.com/menu'), 'rositas.com');
  assert.equal(extractDomain('http://rositas.com'), 'rositas.com');
});

test('extractDomain: bare hostname with no protocol still parses', () => {
  assert.equal(extractDomain('rositas.com'), 'rositas.com');
});

test('extractDomain: empty/missing input returns empty string, never throws', () => {
  assert.equal(extractDomain(''), '');
  assert.equal(extractDomain(null), '');
  assert.equal(extractDomain(undefined), '');
});

test('extractDomain: unparseable input falls back to the raw string rather than throwing', () => {
  assert.equal(extractDomain('not a url at all'), 'not a url at all');
});

test('formatFailedAt: includes both a local and a UTC rendering', () => {
  const result = formatFailedAt('2026-08-26T12:34:56.000Z');
  assert.match(result, /\(local\)/);
  assert.match(result, /2026-08-26 12:34:56 UTC/);
});

test('formatFailedAt: empty/invalid input never throws', () => {
  assert.equal(formatFailedAt(''), '');
  assert.equal(formatFailedAt(null), '');
  assert.equal(formatFailedAt('not-a-date'), 'not-a-date');
});

const CREATION_FAILURE = {
  status: 'open',
  incidentId: 'client-a-signup',
  runId: 'client-a-signup',
  failedAt: '2026-08-26T12:34:56.000Z',
  publicCode: 'HIT-ABC123',
  publicStage: 'website_access',
  publicMessage: 'We could not reach the website to build your dashboard.',
  notification: { status: 'sent' },
};

test('buildCreationFailureReport: includes every required field from the plan (code, time, domain, category, message, run id)', () => {
  const report = buildCreationFailureReport(CREATION_FAILURE, { websiteUrl: 'https://www.rositas.com' });
  assert.match(report, /Support reference: HIT-ABC123/);
  assert.match(report, /Failed at: .*\(local\)/);
  assert.match(report, /Website: rositas\.com/);
  assert.match(report, /Category: website_access/);
  assert.match(report, /Details: We could not reach the website to build your dashboard\./);
  assert.match(report, /Run ID: client-a-signup/);
});

test('buildCreationFailureReport: never contains raw error text — only the classified publicMessage', () => {
  const report = buildCreationFailureReport(CREATION_FAILURE, { websiteUrl: 'https://rositas.com' });
  assert.ok(!report.toLowerCase().includes('enotfound'));
  assert.ok(!report.toLowerCase().includes('stack'));
});

test('buildCreationFailureReport: returns an empty string with no incident, never throws', () => {
  assert.equal(buildCreationFailureReport(null), '');
  assert.equal(buildCreationFailureReport(undefined, { websiteUrl: 'https://x.com' }), '');
});

test('buildCreationFailureReport: a website-less signup reports "(none submitted)" instead of a blank line', () => {
  const report = buildCreationFailureReport(CREATION_FAILURE, { websiteUrl: '' });
  assert.match(report, /Website: \(none submitted\)/);
});
