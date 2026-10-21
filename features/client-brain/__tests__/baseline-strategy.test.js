import assert from 'node:assert/strict';
import test from 'node:test';
import baseline from '../baseline-strategy.cjs';
import formMd from '../form-markdown.cjs';

const { buildBaselineStrategy, applyBaselineToMarkdown } = baseline;
const { markdownToForm } = formMd;

const EMPTY_BRAIN = '---\nschemaVersion: 1\nclientId: c1\nstatus: approved\n---\n# Client Brain\n\n## Strategy Document\n';

const dashboardState = {
  marketingBrief: { content: { x_post: 'hello', content_angle: 'Own the insured-and-bonded trust angle.' } },
  strategy30: {
    days: [
      { date: '2026-10-20', theme: 'Trust proof', idea: 'Show a bonded job' },
      { date: '2026-10-21', theme: 'Trust proof', idea: 'Insurance explainer' },
      { date: '2026-10-22', theme: 'Rug care', idea: 'Wool vs synthetic' },
      { date: '2026-10-23', theme: 'Trust proof', idea: 'Customer story' },
    ],
    today: { post: 'p', angle: 'Trust first', rationale: 'competitor gap' },
  },
  strategyBuilder: {
    lastPlan: { items: [
      { scheduledAt: '2026-10-20T14:00:00Z', xStrategy: { postType: 'authority' } },
      { scheduledAt: '2026-10-20T18:00:00Z', xStrategy: { postType: 'proof-loop' } },
      { scheduledAt: '2026-10-21T14:00:00Z', xStrategy: { postType: 'authority' } },
      { scheduledAt: '2026-10-21T18:00:00Z', xStrategy: { postType: 'authority' } },
    ] },
  },
};

test('empty Brain + baseline -> draft for all three sections', () => {
  const d = buildBaselineStrategy({ brainMarkdown: EMPTY_BRAIN, dashboardState });
  assert.deepEqual(d.onlyEmpty, ['strategyDocument', 'contentTracks', 'trackTargets']);
  assert.equal(d.fields['strategy.thesis'], 'Own the insured-and-bonded trust angle.');
  assert.match(d.fields['strategy.tracks'], /- Trust proof: Show a bonded job \(3 of 4 planned days\)/);
  assert.match(d.fields['strategy.formats'], /- authority: 3 of 4 planned posts/);
  // Rug care appears once: a one-off daily theme is not a track.
  assert.deepEqual(d.fields['content.contentTracks'].map((r) => [r.label, r.share]), [['Trust proof', '100']]);
  // 4 items over 2 days = 2/day
  assert.deepEqual(d.fields['content.trackTargets'].map((r) => [r.track, r.postsPerDay]), [['Trust proof', '2']]);
  assert.deepEqual(d.trackLabels, ['Trust proof']);
  assert.ok(d.source.includes('strategy30.days'));
  assert.match(d.sections.contentTracks, /- label: Trust proof \| share: 100/);
});

test('draft round-trips into the Brain Markdown and keeps status', () => {
  const d = buildBaselineStrategy({ brainMarkdown: EMPTY_BRAIN, dashboardState });
  const md = applyBaselineToMarkdown(EMPTY_BRAIN, d);
  assert.match(md, /status: approved/);
  const f = markdownToForm(md).fields;
  assert.equal(f['strategy.thesis'], 'Own the insured-and-bonded trust angle.');
  assert.equal(f['content.contentTracks'].length, 1);
  assert.equal(f['content.trackTargets'][0].track, 'Trust proof');
});

test('Brain wins: filled sections are omitted, empty ones still filled', () => {
  const brain = `${EMPTY_BRAIN}\n### Thesis\n\nMine.\n`;
  const d = buildBaselineStrategy({ brainMarkdown: brain, dashboardState });
  assert.equal(d.fields['strategy.thesis'], undefined);
  assert.ok(d.fields['strategy.tracks']);
  const md = applyBaselineToMarkdown(brain, d);
  assert.equal(markdownToForm(md).fields['strategy.thesis'], 'Mine.');
});

test('filled Content Tracks: not replaced, targets follow the existing tracks', () => {
  const brain = `${EMPTY_BRAIN}\n## Content Intelligence\n\n### Content Tracks\n\n- label: Design | share: 100\n`;
  const d = buildBaselineStrategy({ brainMarkdown: brain, dashboardState });
  assert.equal(d.fields['content.contentTracks'], undefined);
  assert.deepEqual(d.fields['content.trackTargets'].map((r) => [r.track, r.postsPerDay]), [['Design', '2']]);
});

test('no baseline -> null; everything already filled -> null', () => {
  assert.equal(buildBaselineStrategy({ brainMarkdown: EMPTY_BRAIN, dashboardState: {} }), null);
  assert.equal(buildBaselineStrategy({ brainMarkdown: EMPTY_BRAIN }), null);
  const full = applyBaselineToMarkdown(EMPTY_BRAIN, buildBaselineStrategy({ brainMarkdown: EMPTY_BRAIN, dashboardState }));
  assert.equal(buildBaselineStrategy({ brainMarkdown: full, dashboardState }), null);
});

test('track text with row delimiters is sanitised', () => {
  const ds = { strategy30: { days: [{ date: '2026-10-20', theme: 'A | B; C: D', idea: 'x' }, { date: '2026-10-21', theme: 'A | B; C: D', idea: 'y' }] } };
  const d = buildBaselineStrategy({ brainMarkdown: EMPTY_BRAIN, dashboardState: ds });
  assert.equal(d.fields['content.contentTracks'][0].label, 'A B C D');
  assert.equal(d.fields['content.contentTracks'][0].share, '100');
  const s = buildBaselineStrategy({ brainMarkdown: EMPTY_BRAIN, dashboardState: ds, tracks: [{ label: 'X | Y' }] });
  assert.equal(s.fields['content.contentTracks'][0].label, 'X Y');
});

const POSITIONED_BRAIN = `${EMPTY_BRAIN.replace('## Strategy Document\n', '')}## Identity Intelligence\n\n### Positioning\n\nThe accountable neighborhood alternative.\n\n### Strategic One-Liner\n\nPremium neighborhood dog walking\n\n## Strategy Document\n`;

test('thesis comes from the Brain\'s own positioning before the daily angle', () => {
  const d = buildBaselineStrategy({ brainMarkdown: POSITIONED_BRAIN, dashboardState });
  assert.equal(d.fields['strategy.thesis'], 'Premium neighborhood dog walking. The accountable neighborhood alternative.');
  assert.ok(d.source.includes('brain.identity.positioning'));
  assert.ok(!d.source.includes('marketingBrief.content.content_angle'));
});

const ONE_OFF = { strategy30: { days: [
  { date: '2026-10-20', theme: 'Review trust gap', idea: 'a' },
  { date: '2026-10-21', theme: 'Small group premium', idea: 'b' },
  { date: '2026-10-22', theme: 'Halloween safety', idea: 'c' },
] } };

test('only one-off daily themes -> no tracks drafted; themes returned for grouping', () => {
  const d = buildBaselineStrategy({ brainMarkdown: POSITIONED_BRAIN, dashboardState: ONE_OFF });
  assert.equal(d.fields['content.contentTracks'], undefined);
  assert.equal(d.fields['content.trackTargets'], undefined);
  assert.equal(d.fields['strategy.tracks'], undefined);
  assert.deepEqual(d.onlyEmpty, ['strategyDocument']);
  assert.deepEqual(d.themes, ['Review trust gap', 'Small group premium', 'Halloween safety']);
  assert.ok(d.notes.some((n) => /no recurring lane/.test(n)));
});

test('supplied tracks replace the themes; shares normalised to 100; max 6, deduped', () => {
  const tracks = [{ label: 'Trust & safety', share: 50 }, { label: 'Reviews', share: 30 }, { label: 'Neighborhood', share: 20 }, { label: 'reviews' }];
  const d = buildBaselineStrategy({ brainMarkdown: POSITIONED_BRAIN, dashboardState: ONE_OFF, tracks });
  assert.deepEqual(d.fields['content.contentTracks'].map((r) => [r.label, r.share]), [['Trust & safety', '50'], ['Reviews', '30'], ['Neighborhood', '20']]);
  assert.equal(d.fields['strategy.tracks'], '- Trust & safety\n- Reviews\n- Neighborhood');
  assert.deepEqual(d.trackLabels, ['Trust & safety', 'Reviews', 'Neighborhood']);
  assert.ok(d.source.includes('tracks (supplied)'));
  const many = buildBaselineStrategy({ brainMarkdown: POSITIONED_BRAIN, dashboardState: ONE_OFF, tracks: 'abcdefgh'.split('').map((c) => `T${c}`) });
  assert.equal(many.fields['content.contentTracks'].length, 6);
});
