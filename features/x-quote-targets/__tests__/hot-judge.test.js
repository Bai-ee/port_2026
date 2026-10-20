import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brainDigest, groundAngle, judgeSystemPrompt, judgeUserPrompt, parseJudgeOutput, judgeCostUsd, chooseJudgeCandidates, judgeCandidates,
} from '../hot-judge.js';
import { JUDGE } from '../hot-config.js';

const cand = (i, lane = 'design', o = {}) => ({ id: String(i), lane, author: `a${i}`, authorName: 'N', text: `text ${i}`, ageHours: 5, engagement: 500, hasVideo: true, score: 0.5, ...o });
const digest = brainDigest(null);

test('brainDigest: defaults carry the lanes and the avoid list; Brain fields add to them', () => {
  assert.match(digest.who, /Chicago/);
  assert.ok(digest.avoid.some((a) => /crypto/i.test(a)));
  const d = brainDigest({ identity: { name: 'HITLOOP', xHandle: 'bai_ee', category: 'Designer-builder' }, positioning: { avoidPositioning: ['Agency'] }, audience: { primary: ['Founders'] } });
  assert.ok(d.avoid.includes('Agency') && d.own.includes('Founders') && /HITLOOP/.test(d.who));
});

test('prompts: system names the owner, avoid list and JSON contract; user lists indexed posts', () => {
  const sys = judgeSystemPrompt(digest);
  assert.match(sys, /ONLY a JSON array/);
  assert.match(sys, /fan art/);
  const user = judgeUserPrompt([cand(0), cand(1, 'music')]);
  assert.equal(user.split('\n').length, 3);
  assert.match(user, /"i":1,"lane":"music"/);
});

test('parseJudgeOutput: tolerant of fences, clamps fit, unknown angle -> none, bad rows dropped', () => {
  const text = 'Here:\n```json\n[{"i":0,"fit":0.9,"angle":"craft","why":"good"},{"i":1,"fit":7,"angle":"weird","why":"x"},{"i":9,"fit":1},{"i":2,"fit":"n/a"},{"i":3,"fit":0,"angle":"none","reject":"actor, not a DJ"}]\n```';
  const m = parseJudgeOutput(text, 4);
  assert.equal(m.get(0).fit, 0.9);
  assert.deepEqual([m.get(1).fit, m.get(1).angle], [1, 'none']);
  assert.equal(m.has(2), false);
  assert.equal(m.get(3).reject, 'actor, not a DJ');
  assert.equal(parseJudgeOutput('no json', 3).size, 0);
  assert.equal(parseJudgeOutput('[not json]', 3).size, 0);
});

test('judgeCostUsd: Haiku 5.5 prices ($0.10 in / $0.50 out per MTok)', () => {
  assert.ok(Math.abs(judgeCostUsd({ input_tokens: 4000, output_tokens: 1000 }) - 0.0009) < 1e-9);
});

test('chooseJudgeCandidates: hard cap 24, music gets up to a third, either lane uses the other\'s slack', () => {
  const design = Array.from({ length: 30 }, (_, i) => cand(i));
  const music = Array.from({ length: 20 }, (_, i) => cand(100 + i, 'music'));
  const a = chooseJudgeCandidates({ design, music });
  assert.equal(a.length, 24);
  assert.equal(a.filter((c) => c.lane === 'music').length, 8);
  assert.equal(chooseJudgeCandidates({ design: design.slice(0, 5), music }).length, 24);
  assert.equal(chooseJudgeCandidates({ design: design.slice(0, 3), music: music.slice(0, 2) }).length, 5);
});

test('judgeCandidates: one call, merges verdicts, unjudged rows are rejected, cost from usage, false positives rejected', async () => {
  let calls = 0;
  const callModel = async ({ user }) => {
    calls += 1;
    assert.match(user, /masters at work/i);
    return { text: '[{"i":0,"fit":0.8,"angle":"craft","why":"fits"},{"i":1,"fit":0,"angle":"none","why":"","reject":"actor named Masters At Work fan, not the music duo"}]', usage: { input_tokens: 2000, output_tokens: 300 } };
  };
  const candidates = [cand(0), cand(1, 'music', { text: 'Masters At Work premiere tonight on HBO' }), cand(2)];
  const r = await judgeCandidates({ candidates, digest, callModel });
  assert.equal(calls, 1);
  assert.equal(r.judged[0].fit, 0.8);
  assert.match(r.judged[1].reject, /actor/);
  assert.equal(r.judged[2].reject, 'unjudged');
  assert.ok(r.costUsd > 0 && r.costUsd < JUDGE.maxCostUsd);
  assert.ok(r.notes.some((n) => /2\/3 verdicts/.test(n)));
});

test('judgeCandidates: refuses more than the candidate cap, no call for an empty list', async () => {
  const callModel = async () => { throw new Error('must not be called'); };
  assert.deepEqual((await judgeCandidates({ candidates: [], digest, callModel })).judged, []);
  await assert.rejects(judgeCandidates({ candidates: Array.from({ length: 25 }, (_, i) => cand(i)), digest, callModel }), /judge cap/);
});

// The real client_brain/current shape (inspected read-only 2026-10-20): approved decisions nest under decisions.intelligence.*.
const REAL_BRAIN = {
  identity: { name: 'HITLOOP', xHandle: 'bai_ee', category: 'Designer-builder for founders and small teams', location: 'Chicago', description: 'Started in design, creating event flyers as a Chicago House Dj.' },
  positioning: { avoidPositioning: ['Agency (the landing page sells the opposite)', 'Crypto commentary and price talk'] },
  proof: { workHistory: ['Festival collateral for a Chicago-based promoter'], projects: ['Critters Quest UI and launches'] },
  decisions: { intelligence: { content: { topicsToAvoid: { value: ['Crypto price and speculation talk', 'Promo and announcement posts as a post type', 'Politics not associated with design or music or creative'] } }, identity: { categoryToAvoid: { value: ['AI or SaaS product pitch (no proof on the account)'] } } }, social: { handlesToAvoid: { value: ['spammer'] } } },
};

test('brainDigest: avoid topics come from the real Brain doc shape (decisions.intelligence.*), evidence carries the authority claims and Brain proof', () => {
  const d = brainDigest(REAL_BRAIN);
  assert.ok(d.avoid.includes('Politics not associated with design or music or creative'));
  assert.ok(d.avoid.includes('AI or SaaS product pitch (no proof on the account)'));
  assert.ok(d.evidence.some((e) => /Chicago\/SF house scene/.test(e)) && d.evidence.includes('Housepitality') && d.evidence.includes('record collector'));
  assert.ok(d.evidence.includes('Festival collateral for a Chicago-based promoter'));
  assert.match(judgeSystemPrompt(d), /ONLY authority claims[^\n]*Housepitality/);
});

test('groundAngle: i-was-there needs his scene; a 1996 UK festival post has no Brain evidence -> none', () => {
  const d = brainDigest(REAL_BRAIN);
  const uk = 'The Prodigy - Live at Phoenix Festival, 1996 #90s #oldskool';
  assert.deepEqual(groundAngle('i-was-there', uk, d), { angle: 'none', reject: 'no Brain evidence for angle "i-was-there"' });
  assert.equal(groundAngle('i-was-there', 'Frankie Knuckles at the Warehouse, Chicago 1987', d).angle, 'i-was-there');
  assert.equal(groundAngle('record', 'New 12" pressing arrives', d).angle, 'record');
  assert.equal(groundAngle('record', 'Live at Phoenix 1996', d).angle, 'none');
  assert.equal(groundAngle('builder', 'I built this with Claude', d).angle, 'builder');
  assert.equal(groundAngle('builder', 'Nice sunset', d).angle, 'none');
  assert.equal(groundAngle('craft', 'anything', d).angle, 'craft', 'craft/credit are not gated');
});

test('judgeCandidates: a model answer of i-was-there on the UK festival post is grounded down to none and rejected', async () => {
  const callModel = async () => ({ text: '[{"i":0,"fit":0.9,"angle":"i-was-there","why":"90s rave memory"}]', usage: { input_tokens: 1000, output_tokens: 100 } });
  const r = await judgeCandidates({ candidates: [cand(0, 'music', { text: 'The Prodigy Live at Phoenix Festival, 1996' })], digest: brainDigest(REAL_BRAIN), callModel });
  assert.equal(r.judged[0].angle, 'none');
  assert.match(r.judged[0].reject, /no Brain evidence/);
});

test('judge threshold default is 0.65', () => {
  assert.equal(JUDGE.threshold, 0.65);
});
