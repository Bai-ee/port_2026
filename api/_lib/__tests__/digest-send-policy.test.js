'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveSendPolicy } = require('../digest-send-policy.cjs');
const { buildRefreshStampEntry, buildSendStampEntry } = require('../digest-self-origin.cjs');

// ── Send policy: the scheduled-send invariants (EMAIL-REBUILD-PLAN.md §3) ────

test('a SCHEDULED send is zero-LLM, zero-social, zero-fresh-brief', () => {
  const p = resolveSendPolicy({ isPreview: false, isTemplate: false, isSendNow: false });
  assert.equal(p.isRealSend, true);
  assert.equal(p.isScheduledSend, true);
  assert.equal(p.allowInlineLlm, false);
  assert.equal(p.allowSocialSideEffects, false);
  assert.equal(p.allowFreshBriefRun, false);
});

test('a MANUAL send keeps inline LLM + social side effects, but never a fresh-brief run', () => {
  const p = resolveSendPolicy({ isSendNow: true });
  assert.equal(p.isRealSend, true);
  assert.equal(p.isScheduledSend, false);
  assert.equal(p.allowInlineLlm, true);
  assert.equal(p.allowSocialSideEffects, true);
  assert.equal(p.allowFreshBriefRun, false);
});

test('previews and templates never touch social state and are never real sends', () => {
  for (const mode of [{ isPreview: true }, { isTemplate: true }]) {
    const p = resolveSendPolicy(mode);
    assert.equal(p.isRealSend, false, JSON.stringify(mode));
    assert.equal(p.isScheduledSend, false);
    assert.equal(p.allowSocialSideEffects, false);
    assert.equal(p.allowFreshBriefRun, false);
  }
});

// ── Refresh stamp contract ───────────────────────────────────────────────────

const executed = (status, body) => ({ executed: true, status, body });

test('a 200 with EMPTY JSON is a FAILED refresh stamp, never ok', () => {
  const entry = buildRefreshStampEntry('client-a', executed(200, {}));
  assert.equal(entry.ok, false);
  assert.match(entry.reason, /unrecognized JSON/);
});

test('refresh success requires the child’s explicit ok:true', () => {
  const good = buildRefreshStampEntry('client-a', executed(200, { ok: true, scout: { ok: true }, watchlist: { ok: true }, strategy: { ok: true }, executiveSummary: { ok: true } }));
  assert.equal(good.ok, true);
  assert.match(good.reason, /scout:ok/);

  const partial = buildRefreshStampEntry('client-a', executed(207, { ok: false, scout: { ok: false }, watchlist: { ok: true }, strategy: { ok: true }, executiveSummary: { ok: true } }));
  assert.equal(partial.ok, false);
  assert.match(partial.reason, /scout:failed/);
});

test('the child body can never overwrite the dispatcher’s trusted fields', () => {
  const hostile = executed(500, { ok: true, clientId: 'attacker', status: 200, reason: 'looks fine' });
  const entry = buildRefreshStampEntry('client-a', hostile);
  assert.equal(entry.clientId, 'client-a'); // dispatcher's, not the body's
  assert.equal(entry.status, 500);          // real HTTP status
  assert.equal(entry.ok, false);            // 500 can never stamp ok
});

test('a non-executed refresh sub-request stamps failed with its transport reason', () => {
  const entry = buildRefreshStampEntry('client-a', { executed: false, status: 200, reason: 'sub-request returned HTTP 200 (text/html) — route did not execute' });
  assert.equal(entry.ok, false);
  assert.match(entry.reason, /text\/html/);
});

// ── Send stamp contract ──────────────────────────────────────────────────────

test('send success requires a provider email id; empty JSON fails honestly', () => {
  const empty = buildSendStampEntry('client-a', executed(200, {}));
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /without a provider email id/);

  const good = buildSendStampEntry('client-a', executed(200, { ok: true, email: { id: 'em_1' }, delivery: { id: 'd1' } }));
  assert.equal(good.ok, true);
  assert.equal(good.emailId, 'em_1');
  assert.equal(good.deliveryId, 'd1');
});

test('a skipped (not-enrolled) send child stamps skipped, not failed-with-provider-fiction', () => {
  const entry = buildSendStampEntry('client-a', executed(200, { ok: true, skipped: true, reason: 'Daily email is off for this client (schedule disabled).' }));
  assert.equal(entry.ok, false);
  assert.equal(entry.skipped, true);
  assert.match(entry.reason, /schedule disabled/);
});

test('a non-executed send sub-request never fabricates a provider-shaped reason', () => {
  const entry = buildSendStampEntry('client-a', { executed: false, status: 504, reason: 'sub-request returned HTTP 504 (text/plain) — route did not execute' });
  assert.equal(entry.ok, false);
  assert.equal(entry.emailId, null);
  assert.doesNotMatch(entry.reason, /provider did not return/i);
  assert.match(entry.reason, /HTTP 504/);
});
