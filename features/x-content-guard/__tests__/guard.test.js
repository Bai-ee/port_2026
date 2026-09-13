import test from 'node:test';
import assert from 'node:assert/strict';
import { guardXPost, classifyLane } from '../index.js';

// ---------------------------------------------------------------------------
// Regression cases. These are verbatim posts from the real @bai_ee corpus and
// are the whole reason the hard-block list is narrow: an earlier broad crypto
// regex flagged the first two as speculation.
// ---------------------------------------------------------------------------

const CQ_MARKETPLACE = {
  // 4,712 views — the account's best post.
  text: 'Clones are going live at @crittersquest today! \n\nSome great threads are floating around, but the Marketplace is what I want to talk about, and the opportunity to explore a darker theme inside the CQ ecosystem.\n\nIt’s the most fun I\'ve had building UI at CQ.🧵 https://t.co/wMvSpAX7gG',
  type: 'original-showcase',
  media: 'video',
};

const CQ_TWO_YEARS = {
  // 1,870 views — second best. Mentions "Token Bound", "Collection", "Staking".
  // NOTE: full verbatim text. An earlier version of this test truncated it and
  // missed that the list contains "$QUEST Pre-mine" — which the first rule set
  // hard-blocked. The replay harness caught what the shortened test could not.
  text: '"2 years is a long time to be in dev for @crittersquest"\n\n☠️\n\n•  Multiplier Collection\n•  Multiplier Spins\n•  Quest for Terron (shards)\n•  Token Bound Master Editions\n•  Genesis Quest Staking\n•  The Gathering Game BETA launch\n•  Mystery Box \n•  Gacha Wheel\n•  Digital + RWA Redemption\n•  $QUEST Pre-mine\n•  Lucky Pick Miner\n•  Critters Quest Game on Mainnet',
  type: 'original-showcase',
  media: 'video',
};

const PUMP_RUG = {
  // 49 views, 0 likes. Genuine casino content.
  text: 'It took me UNDER 5 minutes to put $10 into the pump app and get rugged by @MartinShkreli last night lol. 👋\n#QUANT Personal record.',
  type: 'original-text',
  media: 'none',
};

const FREELANCE_PRICING_RT = {
  text: 'RT @seb__design: Yes! You don’t need to price low just because you’re a freelancer. \n\nAnd you don’t have to just offer ur specific service.…',
  type: 'retweet',
  media: 'none',
};

test('does NOT block the 4,712-view Critters Quest marketplace post', () => {
  const v = guardXPost(CQ_MARKETPLACE);
  assert.equal(v.hardBlock, false);
  assert.notEqual(v.lane, 'casino');
});

test('does NOT block the 1,870-view post — "$QUEST Pre-mine" is a shipped feature, not a promo', () => {
  const v = guardXPost(CQ_TWO_YEARS);
  assert.equal(v.hardBlock, false);
  assert.notEqual(v.lane, 'casino');
  // It should still ask for a human look, because out of context it reads badly.
  assert.ok(v.flags.some((f) => f.code === 'ambiguous-premine'));
  assert.equal(v.reviewRequired, true);
});

test('DOES block the promotional version of the same mechanism', () => {
  const v = guardXPost({
    text: 'RT @crittersquest: The $QUEST Pre-Mine is OPEN. 48 hours. Everyone fills at the same price.',
    type: 'retweet',
  });
  assert.equal(v.hardBlock, true);
  assert.equal(v.lane, 'casino');
});

test('DOES block genuine speculation (pump app / rugged)', () => {
  const v = guardXPost(PUMP_RUG);
  assert.equal(v.hardBlock, true);
  assert.equal(v.lane, 'casino');
  assert.ok(v.flags.some((f) => f.code === 'casino-rug'));
});

test('does NOT block a freelance-pricing retweet (the word "price" alone is not speculation)', () => {
  const v = guardXPost(FREELANCE_PRICING_RT);
  assert.equal(v.hardBlock, false);
});

// ---------------------------------------------------------------------------
// Lane rules
// ---------------------------------------------------------------------------

test('a ticker alone is not speculation; a ticker with price framing is', () => {
  assert.notEqual(classifyLane('$QUEST holders get the new Multiplier Collection UI').lane, 'casino');
  assert.equal(classifyLane('$QUEST price is up 40% from entry').lane, 'casino');
});

test('politics is a blocked lane', () => {
  const v = guardXPost({ text: 'this is why the election matters, vote for them', type: 'original-text' });
  assert.equal(v.hardBlock, true);
  assert.equal(v.lane, 'politics');
});

test('classifies craft, music and infra lanes', () => {
  assert.equal(classifyLane('grabbed the cloth and let go — real verlet physics, no easing curve').lane, 'craft');
  assert.equal(classifyLane('sliced the break into 16 pads and sent it to the SP-16 as a scene').lane, 'music');
  assert.equal(classifyLane('the mix archive is on arweave so it outlives every platform it was on').lane, 'infra');
});

test('era design tooling classifies as craft, not unknown', () => {
  // Regression: a real post — "flash on one monitor, this psd on the other" —
  // classified as `unknown` because the lane vocabulary had no era tooling.
  // Design-history nostalgia is a top-performing vein; it must classify.
  assert.equal(classifyLane('flash on one monitor, this psd on the other').lane, 'craft');
  assert.equal(classifyLane('every iphone mock i made started in this psd').lane, 'craft');
  assert.equal(classifyLane('macromedia director and a stack of comps').lane, 'craft');
});

test('the new craft terms do not steal the music or work lanes', () => {
  assert.equal(classifyLane('sliced a break into 16 pads and sent it to the SP-16 as a scene').lane, 'music');
  assert.equal(classifyLane('marketplace UI for the clone collection, trait grid rebuilt').lane, 'work');
});

test('an unclassifiable post defers rather than guessing', () => {
  const v = guardXPost({ text: 'nice lamp i saw last night', type: 'original-text' });
  assert.equal(v.lane, 'unknown');
  assert.equal(v.needsLaneReview, true);
  assert.equal(v.readyToPublish, false);
});

// ---------------------------------------------------------------------------
// Mechanics
// ---------------------------------------------------------------------------

test('flags hashtags', () => {
  const v = guardXPost({ text: 'new shader work #webgl #creativecoding', type: 'original-showcase', media: 'video' });
  assert.ok(v.flags.some((f) => f.code === 'mech-hashtag' && f.severity === 'major'));
});

test('flags an inline link but not the trailing media URL X appends', () => {
  const inline = guardXPost({ text: 'shader demo https://example.com/demo and more', type: 'original-text' });
  assert.ok(inline.flags.some((f) => f.code === 'mech-inline-link'));

  const trailing = guardXPost({
    text: 'cloth sim settling in the browser https://t.co/abc123',
    type: 'original-showcase',
    media: 'video',
  });
  assert.ok(!trailing.flags.some((f) => f.code === 'mech-inline-link'));
});

test('does not flag the trailing status URL that makes a quote tweet', () => {
  // Composing `caption + "\n\n" + https://x.com/<user>/status/<id>` is how X
  // builds a quote tweet. Flagging it would flag every correct quote-react.
  const quote = guardXPost({
    text: 'japanese graphic design at it again\n\nhttps://x.com/rare_jpg/status/2098110485119783003',
    type: 'quote-react',
  });
  assert.ok(!quote.flags.some((f) => f.code === 'mech-inline-link'));

  // A link in the middle is still a link.
  const mid = guardXPost({
    text: 'see https://x.com/rare_jpg/status/2098110485119783003 and also this',
    type: 'quote-react',
  });
  assert.ok(mid.flags.some((f) => f.code === 'mech-inline-link'));
});

test('flags a showcase with no media, and an image where video would win', () => {
  const noMedia = guardXPost({ text: 'the new cloth sim in figma and webgl', type: 'original-showcase', media: 'none' });
  assert.ok(noMedia.flags.some((f) => f.code === 'mech-showcase-no-media'));

  const image = guardXPost({ text: 'the new cloth sim in webgl with gsap easing', type: 'original-showcase', media: 'image' });
  assert.ok(image.flags.some((f) => f.code === 'mech-image-not-video'));
});

test('flags every retweet as unable to reach non-followers', () => {
  const v = guardXPost({ text: 'RT @someone: look at this', type: 'retweet' });
  assert.ok(v.flags.some((f) => f.code === 'mech-retweet-unreachable'));
});

test('flags engagement bait', () => {
  const v = guardXPost({ text: 'like if you agree with this take', type: 'original-text' });
  assert.ok(v.flags.some((f) => f.code === 'bait-likeif'));
});

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

test('a clean craft showcase passes cleanly and carries a score', () => {
  const v = guardXPost({
    text: 'grabbed a corner and let go. the rebound is real verlet physics in webgl, not an easing curve',
    type: 'original-showcase',
    media: 'video',
  });
  assert.equal(v.hardBlock, false);
  assert.equal(v.lane, 'craft');
  assert.equal(v.readyToPublish, true);
  assert.equal(typeof v.xGrowthScore, 'number');
});

test('never throws on malformed input', () => {
  for (const bad of [undefined, null, {}, { text: null }, { text: 123, type: 7 }]) {
    const v = guardXPost(bad);
    assert.equal(typeof v.readyToPublish, 'boolean');
    assert.equal(typeof v.note, 'string');
  }
});
