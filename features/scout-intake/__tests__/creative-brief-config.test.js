const test = require('node:test');
const assert = require('node:assert');
const {
  CREATIVE_BRIEF_GROUPS,
  SIMPLE_BRIEF_GROUPS,
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

test('Phase 3b: legacy website-status config (predating crawler-parity/coverage-manifest) defaults them on and appends them', () => {
  // Simulates a saved doc from before these two ids existed in the registry.
  const cfg = normalizeCreativeBriefConfig({
    order: { 'website-status': ['wtis-lead', 'social-share', 'whats-missing', 'biggest-risk', 'opportunity', 'decision'] },
  });
  assert.strictEqual(cfg.include['crawler-parity'], true);
  assert.strictEqual(cfg.include['coverage-manifest'], true);
  assert.deepStrictEqual(cfg.order['website-status'], [
    'wtis-lead', 'social-share', 'whats-missing', 'biggest-risk', 'opportunity', 'decision',
    'crawler-parity', 'coverage-manifest',
  ]);
});

test('normalize ignores non-boolean include values', () => {
  const cfg = normalizeCreativeBriefConfig({ include: { 'key-insight': 'nope' } });
  assert.strictEqual(cfg.include['key-insight'], true);
});

test('simple layout: defaults honor defaultOff + register heading toggles', () => {
  const def = defaultCreativeBriefConfig();
  assert.strictEqual(def.layout, 'classic');
  for (const group of SIMPLE_BRIEF_GROUPS) {
    for (const item of group.items) {
      assert.strictEqual(def.include[item.id], !item.defaultOff, item.id);
      if (item.hasHeading) assert.strictEqual(def.include[`${item.id}:heading`], true, `${item.id}:heading`);
    }
  }
  // Spec removals start off but stay registered.
  assert.strictEqual(def.include['sb-header-meta'], false);
  assert.strictEqual(def.include['sb-header-marquee'], false);
});

test('normalize validates layout and keeps sb order groups', () => {
  assert.strictEqual(normalizeCreativeBriefConfig({ layout: 'simple' }).layout, 'simple');
  assert.strictEqual(normalizeCreativeBriefConfig({ layout: 'weird' }).layout, 'classic');
  const cfg = normalizeCreativeBriefConfig({ order: { 'sb-pages': ['sb-contact', 'sb-key-insight'] }, include: { 'sb-key-insight:heading': false } });
  assert.strictEqual(cfg.order['sb-pages'][0], 'sb-contact');
  assert.strictEqual(cfg.order['sb-pages'][1], 'sb-key-insight');
  assert.strictEqual(cfg.order['sb-pages'].length, SIMPLE_BRIEF_GROUPS.find((g) => g.key === 'sb-pages').items.length);
  assert.strictEqual(cfg.include['sb-key-insight:heading'], false);
});
