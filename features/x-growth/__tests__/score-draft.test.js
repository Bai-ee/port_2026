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

// Changed: invites/questions are weak signals now (measured below baseline on @bai_ee), so the bar drops from 0.40 to "above a neutral post".
test('direct conversation invite still nudges replyPotential above neutral', () => {
  const neutral = scoreXPost('Hello there.');
  const result = scoreXPost('What do you think about this? Thoughts? Hot take incoming.');
  assert.ok(result.scores.replyPotential > neutral.scores.replyPotential);
});

test('substantive claim earns more replyPotential than a bare question', () => {
  const question = scoreXPost('Anyone have thoughts?');
  const claim = scoreXPost('Most logo refreshes fail because teams skip the 3 audits that actually matter.');
  assert.ok(claim.scores.replyPotential > question.scores.replyPotential);
});

test('sharePotential rewards reference / rare / how-made content', () => {
  const plain = scoreXPost('Good morning everyone.');
  const shareable = scoreXPost('Rare unreleased demo found in the archive, plus a breakdown of how it was made.');
  assert.ok(shareable.scores.sharePotential > plain.scores.sharePotential + 0.2);
  assert.ok(shareable.xGrowthScore > plain.xGrowthScore);
});

test('followPotential rewards consistent identity / authority signals', () => {
  const plain = scoreXPost('Good morning everyone.');
  const authority = scoreXPost('I design identity systems for web3 clients. Case study from my studio since 2019.');
  assert.ok(authority.scores.followPotential > plain.scores.followPotential + 0.2);
});

test('profileClickPotential stays in output but carries ~0 composite weight', () => {
  const base = 'Good morning everyone.';
  const a = scoreXPost(base);
  const b = scoreXPost(base + ' Check out my profile, see more, learn more.');
  assert.ok(b.scores.profileClickPotential > a.scores.profileClickPotential);
  assert.ok(Math.abs(b.xGrowthScore - a.xGrowthScore) < 1e-9, 'profile-click phrasing must not move the composite');
});

test('negative-feedback risk is asymmetric: one bait phrase outweighs the repost framing bonus', () => {
  const clean = scoreXPost('New breakdown: how we built the thing.');
  const bait = scoreXPost('New breakdown: how we built the thing. Like if you agree!');
  assert.ok(clean.xGrowthScore - bait.xGrowthScore > 0.10, `clean=${clean.xGrowthScore} bait=${bait.xGrowthScore}`);
});

test('does not recommend "Add a question" by default', () => {
  for (const text of ['We shipped a thing.', 'Hello.', 'Nice day for design work.']) {
    const r = scoreXPost(text);
    assert.ok(!r.recommendations.some((x) => /question/i.test(x.action)), `question rec for: ${text}`);
  }
});

test('thin post recommends share-earning substance', () => {
  const r = scoreXPost('Hello.');
  assert.ok(r.recommendations.some((x) => /worth sending|reference/i.test(x.action)));
});

test('link post recommends moving the link to the first reply and scores lower', () => {
  const text = 'Full breakdown of how it was made https://example.com/post';
  const r = scoreXPost(text);
  assert.ok(r.recommendations.some((x) => /first reply/i.test(x.action)));
  const noLink = scoreXPost('Full breakdown of how it was made');
  assert.ok(r.xGrowthScore < noLink.xGrowthScore);
});

test('video scores above text above still image (measured prior)', () => {
  const t = 'Studio session from last night.';
  const video = scoreXPost(t, { mediaType: 'video' }).xGrowthScore;
  const text = scoreXPost(t).xGrowthScore;
  const image = scoreXPost(t, { mediaType: 'image' }).xGrowthScore;
  assert.ok(video > text);
  assert.ok(image <= text);
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

// --- Reply mode (context.kind === 'reply') ---------------------------------

test('reply mode rewards a substantive insight reply without a question', () => {
  const text = 'The reason this works is retention compounds — a 5% lift in week-4 retention roughly doubles LTV because the curve flattens higher.';
  const post = scoreXPost(text);
  const reply = scoreXPost(text, { kind: 'reply' });
  // Substance-heavy reply must not be punished for lacking announcement/repost framing.
  assert.ok(reply.xGrowthScore >= post.xGrowthScore - 0.02,
    `reply mode should reward substance; reply=${reply.xGrowthScore} post=${post.xGrowthScore}`);
  assert.ok(!reply.recommendations.some((r) => /shareable framing/i.test(r.action)),
    'reply mode must not recommend repost/announcement framing');
});

test('reply mode penalises links harder than post mode and flags removal', () => {
  const text = 'Great point — we wrote about exactly this here https://example.com/post';
  const post = scoreXPost(text);
  const reply = scoreXPost(text, { kind: 'reply' });
  assert.ok(reply.xGrowthScore < post.xGrowthScore,
    `a link should hurt a reply more than a post; reply=${reply.xGrowthScore} post=${post.xGrowthScore}`);
  assert.ok(reply.recommendations.some((r) => /remove the link/i.test(r.action)),
    'reply mode should recommend removing the link');
  assert.ok(!reply.recommendations.some((r) => /first reply/i.test(r.action)),
    'reply mode must not suggest moving the link to the first reply');
});

test('reply mode is backward-compatible — non-reply kind is unchanged', () => {
  const text = 'We shipped a new feature today. What do you think?';
  assert.strictEqual(scoreXPost(text).xGrowthScore, scoreXPost(text, {}).xGrowthScore);
  assert.strictEqual(scoreXPost(text).xGrowthScore, scoreXPost(text, { kind: 'post' }).xGrowthScore);
});
