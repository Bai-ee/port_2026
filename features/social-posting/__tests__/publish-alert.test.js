import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublishAlert, alertOnHeldPosts } from '../publish-alert.js';

const NOW = Date.parse('2026-10-12T15:00:00Z');
const RESULT = { needsReview: [{ id: 'social_a', status: 'needs_review', errorClass: 'network-ambiguous', content: 'SECRET TEXT' }], failed: [{ id: 'social_b', errorClass: 'client-error' }] };
const ENV = { PILOT_ALERT_EMAIL: 'o@example.com', PILOT_ALERT_FROM: 'Alerts <a@example.com>', RESEND_API_KEY: 'k' };

test('nothing to report => no alert', () => {
  assert.equal(buildPublishAlert({ needsReview: [], failed: [] }, { now: NOW }), null);
  assert.equal(buildPublishAlert({}, { now: NOW }), null);
});

test('alert lists ids and classes only (never post text) and is idempotent per id-set and day', () => {
  const a = buildPublishAlert(RESULT, { now: NOW });
  assert.match(a.text, /HELD    social_a  network-ambiguous/);
  assert.match(a.text, /FAILED  social_b  client-error/);
  assert.ok(!a.text.includes('SECRET TEXT'));
  assert.equal(buildPublishAlert(RESULT, { now: NOW + 15 * 60_000 }).idempotencyKey, a.idempotencyKey);
  assert.notEqual(buildPublishAlert({ needsReview: [{ id: 'social_c' }] }, { now: NOW }).idempotencyKey, a.idempotencyKey);
  assert.notEqual(buildPublishAlert(RESULT, { now: NOW + 86_400_000 }).idempotencyKey, a.idempotencyKey);
});

test('off unless all three env values are set; never throws; sends via the injected sender', async () => {
  assert.deepEqual(await alertOnHeldPosts(RESULT, { env: {}, now: NOW }), { sent: false, reason: 'not-configured' });
  assert.equal((await alertOnHeldPosts(RESULT, { env: { ...ENV, RESEND_API_KEY: '' }, now: NOW })).reason, 'not-configured');
  const calls = [];
  const ok = await alertOnHeldPosts(RESULT, { env: ENV, now: NOW, send: async (m) => { calls.push(m); return { ok: true }; } });
  assert.deepEqual(ok, { sent: true, reason: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'o@example.com');
  assert.ok(!calls[0].html.includes('SECRET TEXT'));
  const boom = await alertOnHeldPosts(RESULT, { env: ENV, now: NOW, send: async () => { throw new Error('network down'); } });
  assert.equal(boom.sent, false);
  assert.equal((await alertOnHeldPosts({ needsReview: [], failed: [] }, { env: ENV, now: NOW })).reason, 'nothing-to-report');
});

test('expired rows are reported; an ambiguous failure (status needs_review inside failed[]) is labelled HELD; HTML is escaped', async () => {
  const a = buildPublishAlert({
    expired: [{ id: 'social_e', errorClass: 'missed-window' }],
    failed: [{ id: 'social_h', status: 'needs_review', errorClass: 'network-ambiguous' }, { id: 'social_f', status: 'failed', errorClass: 'client-error' }],
  }, { now: NOW });
  assert.match(a.subject, /1 held, 1 failed, 1 expired/);
  assert.match(a.text, /EXPIRED social_e/);
  assert.match(a.text, /HELD    social_h/);
  assert.match(a.text, /FAILED  social_f/);
  const calls = [];
  await alertOnHeldPosts({ expired: [{ id: '<b>x</b>' }] }, { env: ENV, now: NOW, send: async (m) => { calls.push(m); return { ok: false, reason: 'rate' }; } });
  assert.ok(!calls[0].html.includes('<b>x</b>'));
  assert.equal((await alertOnHeldPosts({ expired: [{ id: 'z' }] }, { env: ENV, now: NOW, send: async () => ({ ok: false, reason: 'send-failed' }) })).reason, 'send-failed');
});
