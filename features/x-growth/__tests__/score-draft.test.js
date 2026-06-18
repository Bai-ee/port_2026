import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreXPost } from '../score-draft.js';

test('spammy hard-sell post gets higher negativeFeedbackRisk', () => {
  const result = scoreXPost('BUY NOW!!! Limited time offer, act now, don\'t miss this deal!!!');
  assert.ok(result.scores.negativeFeedbackRisk > 0.20, `expected negativeFeedbackRisk > 0.20, got ${result.scores.negativeFeedbackRisk}`);
});

test('question/conversation post gets higher replyPotential', () => {
  const baseline = scoreXPost('We shipped a new feature today.');
  const withQuestion = scoreXPost('We shipped a new feature today. What do you think?');
  assert.ok(withQuestion.scores.replyPotential > baseline.scores.replyPotential,
    `expected replyPotential to increase with question`);
});

test('direct conversation invite raises replyPotential', () => {
  const result = scoreXPost('What do you think about this? Thoughts? Hot take incoming.');
  assert.ok(result.scores.replyPotential > 0.40, `expected replyPotential > 0.40, got ${result.scores.replyPotential}`);
});

test('post with external link gets positive linkRisk', () => {
  const result = scoreXPost('Check out this tool https://example.com/tool — very useful');
  assert.ok(result.scores.linkRisk > 0, `expected linkRisk > 0, got ${result.scores.linkRisk}`);
});

test('post without link has zero linkRisk', () => {
  const result = scoreXPost('We just hit 1000 users. Here is what we learned.');
  assert.strictEqual(result.scores.linkRisk, 0);
});

test('engagement bait triggers negativeFeedbackRisk warning', () => {
  const result = scoreXPost('Like if you agree, rt if you disagree!');
  assert.ok(result.scores.negativeFeedbackRisk > 0.15);
  assert.ok(result.warnings.some((w) => w.type === 'negativeFeedbackRisk'));
});

test('clean authority post has low negativeFeedbackRisk', () => {
  const result = scoreXPost('We grew from 0 to 5k users in 90 days. Here is the playbook we used.');
  assert.ok(result.scores.negativeFeedbackRisk < 0.10, `got ${result.scores.negativeFeedbackRisk}`);
});

test('returns expected shape', () => {
  const result = scoreXPost('Building something new.');
  assert.ok(typeof result.algorithmProfileVersion === 'string');
  assert.ok(typeof result.xGrowthScore === 'number');
  assert.ok(typeof result.targetAction === 'string');
  assert.ok(typeof result.postType === 'string');
  assert.ok(typeof result.scores === 'object');
  assert.ok(Array.isArray(result.warnings));
  assert.ok(Array.isArray(result.recommendations));
  assert.ok(typeof result.hypothesis === 'string');
});

test('scores are all between 0 and 1', () => {
  const result = scoreXPost('EXCLUSIVE!!! BUY NOW buy now buy now like if you love deals rt if you want free money!!!');
  for (const [key, val] of Object.entries(result.scores)) {
    assert.ok(val >= 0 && val <= 1, `scores.${key} = ${val} is out of [0,1]`);
  }
  assert.ok(result.xGrowthScore >= 0 && result.xGrowthScore <= 1);
});
