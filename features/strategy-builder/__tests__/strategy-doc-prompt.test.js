import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildTodayPrompt } from '../prompt.js';
import { buildStrategyDocContext, strategyDocPromptBlock } from '../strategy-doc-context.js';

const doc = (over = {}) => ({
  confirmed: true,
  version: 4,
  sections: { thesis: 'Show the work.', tracks: 'design, music', formats: 'video for reach', rules: 'no hashtags', audience: 'SHOULD-NOT-APPEAR' },
  ...over,
});

const ctx = (extra = {}) => ({
  client: { id: 'c', name: 'C', vertical: 'x', location: {}, offers: [] },
  brand: {}, brief: {}, campaign: {}, signals: {}, config: { startDate: '2026-01-01', days: 7, postsPerDay: 1 },
  cardFindings: {}, now: '2026-01-01T00:00:00.000Z', editorialRecommendationText: 'ed', ...extra,
});

const flat = (m) => JSON.stringify(m);

test('only a confirmed doc yields context; selected sections only', () => {
  assert.equal(buildStrategyDocContext(null), null);
  assert.equal(buildStrategyDocContext(doc({ confirmed: false })), null);
  const c = buildStrategyDocContext(doc());
  assert.equal(c.version, 4);
  assert.match(c.text, /Show the work/);
  assert.doesNotMatch(c.text, /SHOULD-NOT-APPEAR/);
  assert.ok(c.text.length <= 3000);
});

test('absent/draft doc leaves both prompts byte-identical', () => {
  assert.equal(strategyDocPromptBlock(null), '');
  for (const fn of [buildPrompt, buildTodayPrompt]) {
    const base = flat(fn(ctx()));
    assert.equal(flat(fn(ctx({ strategyDoc: null }))), base);
    assert.equal(flat(fn(ctx({ strategyDoc: buildStrategyDocContext(doc({ confirmed: false })) }))), base);
    assert.doesNotMatch(base, /CONFIRMED X STRATEGY/);
  }
});

test('confirmed doc appears in both prompts', () => {
  const strategyDoc = buildStrategyDocContext(doc());
  for (const fn of [buildPrompt, buildTodayPrompt]) {
    assert.match(flat(fn(ctx({ strategyDoc }))), /CONFIRMED X STRATEGY[\s\S]*Show the work/);
  }
});
