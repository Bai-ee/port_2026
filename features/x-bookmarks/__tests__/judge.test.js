import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectBookmarkCandidates, parseBookmarkJudgeOutput, finalizeVerdict, judgeBookmarks, brainDigest, BOOKMARK_LIMITS,
} from '../judge.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
const digest = brainDigest(null);

test('selectBookmarkCandidates: unjudged + undecided + has text, newest first, capped', () => {
  const items = [
    { id: '1', text: 'a', createdAt: hoursAgo(5) },
    { id: '2', text: 'b', createdAt: hoursAgo(1) },
    { id: '3', text: 'c', createdAt: hoursAgo(2), judge: { fit: 1 } },
    { id: '4', text: 'd', createdAt: hoursAgo(3), decision: { kind: 'dismissed' } },
    { id: '5', text: '  ', createdAt: hoursAgo(4) },
  ];
  assert.deepEqual(selectBookmarkCandidates(items).map((x) => x.id), ['2', '1']);
  assert.deepEqual(selectBookmarkCandidates(items, 1).map((x) => x.id), ['2']);
});

test('parseBookmarkJudgeOutput: tolerant, clamps, defaults bad enums, drops bad rows', () => {
  const text = 'sure\n[{"i":0,"fit":1.4,"lane":"design","angle":"craft","respond":"quote","how":"x","why":"y"},'
    + '{"i":1,"fit":0.7,"lane":"zzz","angle":"nope","respond":"???"},{"i":9,"fit":1},{"i":2},{"fit":1}]';
  const m = parseBookmarkJudgeOutput(text, 3);
  assert.equal(m.size, 2);
  assert.equal(m.get(0).fit, 1);
  assert.equal(m.get(0).respond, 'quote');
  assert.equal(m.get(1).lane, 'other');
  assert.equal(m.get(1).angle, 'none');
  assert.equal(m.get(1).respond, 'skip');
  assert.equal(parseBookmarkJudgeOutput('no json', 3).size, 0);
  assert.equal(parseBookmarkJudgeOutput('[{"i":0,', 3).size, 0);
});

test('parseBookmarkJudgeOutput: how and why are clipped to 140 chars', () => {
  const long = 'z'.repeat(400);
  const v = parseBookmarkJudgeOutput(JSON.stringify([{ i: 0, fit: 0.9, respond: 'reply', angle: 'craft', how: long, why: long }]), 1).get(0);
  assert.equal(v.how.length, 140);
  assert.equal(v.why.length, 140);
});

test('finalizeVerdict: old quote becomes a swipe, no-evidence angle blocks quote/reply, low fit and reject are skips', () => {
  const base = { fit: 0.9, lane: 'design', angle: 'craft', respond: 'quote', how: 'h', why: 'w' };
  const fresh = { text: 'concentric radii', createdAt: hoursAgo(5) };
  const old = { text: 'concentric radii', createdAt: hoursAgo(80) };
  const o = { now: NOW };
  assert.equal(finalizeVerdict(base, fresh, digest, o).respond, 'quote');
  assert.equal(finalizeVerdict(base, old, digest, o).respond, 'swipe');
  assert.equal(finalizeVerdict({ ...base, respond: 'reply' }, old, digest, o).respond, 'reply');
  // 'builder' angle needs a build/ship post
  const noEv = finalizeVerdict({ ...base, angle: 'builder', respond: 'reply' }, { text: 'a sunset photo', createdAt: hoursAgo(1) }, digest, o);
  assert.equal(noEv.angle, 'none');
  assert.equal(noEv.respond, 'swipe');
  assert.equal(finalizeVerdict({ ...base, fit: 0.3 }, fresh, digest, o).respond, 'skip');
  assert.equal(finalizeVerdict({ ...base, reject: 'news' }, fresh, digest, o).respond, 'skip');
  assert.equal(finalizeVerdict(base, fresh, digest, o).judgedAt, new Date(NOW).toISOString());
});

test('judgeBookmarks: one call, verdicts mapped by index, missing verdict stays null, cost computed, cap enforced', async () => {
  const candidates = [
    { id: '1', author: 'a', text: 'I built a tool', createdAt: hoursAgo(2) },
    { id: '2', author: 'b', text: 'second', createdAt: hoursAgo(3) },
  ];
  let calls = 0;
  const callModel = async ({ system, user }) => {
    calls += 1;
    assert.match(system, /Never invent experience/);
    assert.match(user, /"i":1/);
    return { text: JSON.stringify([{ i: 0, fit: 0.8, lane: 'design', angle: 'builder', respond: 'reply', how: 'show the build', why: 'on lane' }]), usage: { input_tokens: 1000, output_tokens: 200 } };
  };
  const r = await judgeBookmarks({ candidates, digest, callModel, now: NOW });
  assert.equal(calls, 1);
  assert.equal(r.judged[0].judge.respond, 'reply');
  assert.equal(r.judged[1].judge, null);
  assert.ok(r.costUsd > 0 && r.costUsd < BOOKMARK_LIMITS.maxCostUsd);
  assert.ok(r.notes.some((n) => /1\/2/.test(n)));
  const tooMany = Array.from({ length: 25 }, (_, i) => ({ id: String(i), text: 't' }));
  await assert.rejects(() => judgeBookmarks({ candidates: tooMany, digest, callModel }), /judge cap/);
  assert.deepEqual((await judgeBookmarks({ candidates: [], digest, callModel })).judged, []);
});
