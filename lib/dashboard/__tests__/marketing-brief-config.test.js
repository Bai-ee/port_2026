import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMarketingBriefPlatform, joinConfigList } from '../marketing-brief-config.js';

test('classifyMarketingBriefPlatform: explicit "twitter" normalizes to "x"', () => {
  assert.strictEqual(classifyMarketingBriefPlatform('https://example.com', 'twitter'), 'x');
});

test('classifyMarketingBriefPlatform: explicit platform is used verbatim when recognized', () => {
  assert.strictEqual(classifyMarketingBriefPlatform(null, 'reddit'), 'reddit');
  assert.strictEqual(classifyMarketingBriefPlatform(null, 'Instagram'), 'instagram');
});

test('classifyMarketingBriefPlatform: unrecognized explicit platform falls through to URL sniffing', () => {
  assert.strictEqual(classifyMarketingBriefPlatform('https://reddit.com/r/foo', 'some-unknown-platform'), 'reddit');
});

test('classifyMarketingBriefPlatform: URL-based classification covers each known domain', () => {
  assert.strictEqual(classifyMarketingBriefPlatform('https://twitter.com/foo'), 'x');
  assert.strictEqual(classifyMarketingBriefPlatform('https://x.com/foo'), 'x');
  assert.strictEqual(classifyMarketingBriefPlatform('https://www.reddit.com/r/foo'), 'reddit');
  assert.strictEqual(classifyMarketingBriefPlatform('https://instagram.com/foo'), 'instagram');
  assert.strictEqual(classifyMarketingBriefPlatform('https://youtube.com/watch?v=1'), 'youtube');
  assert.strictEqual(classifyMarketingBriefPlatform('https://youtu.be/1'), 'youtube');
  assert.strictEqual(classifyMarketingBriefPlatform('https://tiktok.com/@foo'), 'tiktok');
  assert.strictEqual(classifyMarketingBriefPlatform('https://news.ycombinator.com/item?id=1'), 'hackernews');
});

test('classifyMarketingBriefPlatform: defaults to "web" for anything unrecognized (including empty)', () => {
  assert.strictEqual(classifyMarketingBriefPlatform('https://example.com/blog'), 'web');
  assert.strictEqual(classifyMarketingBriefPlatform(null, null), 'web');
  assert.strictEqual(classifyMarketingBriefPlatform(undefined, undefined), 'web');
});

test('joinConfigList: arrays join with newlines, strings pass through, nullish becomes empty string', () => {
  assert.strictEqual(joinConfigList(['a', 'b', 'c']), 'a\nb\nc');
  assert.strictEqual(joinConfigList('already a string'), 'already a string');
  assert.strictEqual(joinConfigList(null), '');
  assert.strictEqual(joinConfigList(undefined), '');
});
