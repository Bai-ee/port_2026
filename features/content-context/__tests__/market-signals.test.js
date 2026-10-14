import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeMarketSignals, matchMarketTopic, textUsesTopic, marketSignalsPromptSection, MARKET_SIGNALS_MAX_CHARS } from '../market-signals.js';
import { fallbackCopy } from '../../x-content-inventory/daily-loop/copy.js';
import { suggestionTrigger } from '../../x-content-inventory/daily-loop/present.js';

const brief = {
  headline: 'Agents everywhere', generatedAt: '2026-10-13T10:00:00Z',
  narratives: Array.from({ length: 9 }, (_, i) => ({ trend: `Trend ${i} on typography`, detail: 'd'.repeat(300) })),
  opportunities: Array.from({ length: 8 }, (_, i) => ({ topic: `Opp ${i}`, angle: 'a'.repeat(300) })),
  brandMentions: Array.from({ length: 8 }, (_, i) => ({ author: `u${i}`, content: 'm'.repeat(300) })),
};

test('shapeMarketSignals: null-safe, capped counts and size', () => {
  assert.equal(shapeMarketSignals(null), null);
  assert.equal(shapeMarketSignals({ narratives: [] }), null);
  const b = shapeMarketSignals(brief);
  assert.ok(b.topics.length <= 6 && b.opportunities.length <= 5 && b.brandMentions.length <= 5);
  assert.ok(JSON.stringify(b).length <= MARKET_SIGNALS_MAX_CHARS);
  assert.equal(b.generatedAt, brief.generatedAt);
  assert.ok(b.topics.length >= 1, 'highest-priority list survives the cap');
});

test('matchMarketTopic + prompt section', () => {
  const b = shapeMarketSignals(brief);
  assert.equal(matchMarketTopic(b, ['Typography']), 'Trend 0 on typography');
  assert.equal(matchMarketTopic(b, []), null);
  assert.equal(matchMarketTopic(null, ['x']), null);
  assert.ok(textUsesTopic('thoughts on typography', 'Trend 0 on typography'));
  assert.match(marketSignalsPromptSection(b), /What the market is talking about today[\s\S]*DATA/);
  assert.equal(marketSignalsPromptSection(null), '');
});

test('template fallback names the matched topic for a package-less original; nothing otherwise', () => {
  const b = shapeMarketSignals(brief);
  const s = { type: 'original', slot: { type: 'text' }, package: null };
  assert.match(fallbackCopy(s, { marketSignals: b, trackTopics: ['typography'] }), /^Trend 0 on typography: /);
  assert.equal(fallbackCopy(s, { marketSignals: b, trackTopics: ['pottery'] }), '');
  assert.equal(fallbackCopy({ ...s, type: 'reply' }, { marketSignals: b, trackTopics: ['typography'] }), '');
  assert.equal(fallbackCopy(s), '');
});

test('market trigger renders as Hot narrative with the topic as reason', () => {
  const t = suggestionTrigger({ trigger: { kind: 'market', reason: 'Typography' }, track: 'design' });
  assert.equal(t.label, 'Hot narrative');
  assert.equal(t.reason, 'Typography');
});
