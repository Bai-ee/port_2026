const test = require('node:test');
const assert = require('node:assert');
const {
  CREATIVE_BRIEF_GROUPS,
  defaultCreativeBriefConfig,
  normalizeCreativeBriefConfig,
} = require('../creative-brief-config.cjs');

test('defaults: every registry item is on, order matches registry', () => {
  const def = defaultCreativeBriefConfig();
  for (const group of CREATIVE_BRIEF_GROUPS) {
    assert.deepStrictEqual(def.order[group.key], group.items.map((i) => i.id));
    for (const item of group.items) assert.strictEqual(def.include[item.id], true);
  }
});

test('normalize(null) === defaults', () => {
  assert.deepStrictEqual(normalizeCreativeBriefConfig(null), defaultCreativeBriefConfig());
});

test('normalize keeps saved toggles/order, drops unknown ids, appends missing', () => {
  const cfg = normalizeCreativeBriefConfig({
    include: { 'key-insight': false, 'not-a-real-id': false },
    order: { 'pages': ['contact', 'ghost-page', 'intro-split'] },
  });
  assert.strictEqual(cfg.include['key-insight'], false);
  assert.strictEqual('not-a-real-id' in cfg.include, false);
  // Saved order first (unknowns dropped), missing ids appended in default order.
  assert.deepStrictEqual(cfg.order.pages, ['contact', 'intro-split', 'featured-post', 'website-status']);
  // Untouched groups keep default order.
  assert.deepStrictEqual(cfg.order.cover, defaultCreativeBriefConfig().order.cover);
});

test('normalize ignores non-boolean include values', () => {
  const cfg = normalizeCreativeBriefConfig({ include: { 'key-insight': 'nope' } });
  assert.strictEqual(cfg.include['key-insight'], true);
});
