import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeCorpus } from '../summarize.js';
import { compareToBenchmark } from '../compare.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const loadCorpus = (name) => JSON.parse(readFileSync(path.join(REPO, 'docs/audits', name), 'utf8'));

const seb = summarizeCorpus(loadCorpus('seb-design-x-corpus.json'), { handle: 'seb__design' });
const baiee = summarizeCorpus(loadCorpus('bai-ee-x-corpus.json'), { handle: 'bai_ee' });
const report = compareToBenchmark({ own: baiee, benchmark: seb });

const gap = (id) => report.gaps.find((g) => g.id === id);

const post = (over = {}) => ({
  id: String(Math.random()),
  dateLocal: '2026-09-01',
  hourLocal: 10,
  type: 'original-text',
  media: 'none',
  topics: [],
  chars: 50,
  likes: 10,
  reposts: 0,
  replies: 0,
  views: 1000,
  ...over,
});

/** Build a block from a type->{count, likes} spec. */
const blockOf = (handle, spec, extra = {}) => summarizeCorpus(
  Object.entries(spec).flatMap(([type, { n, likes, ...rest }]) =>
    Array.from({ length: n }, (_, i) => post({
      type,
      likes,
      dateLocal: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      ...rest,
    }))),
  { handle, ...extra },
);

test('volume is the top-ranked gap on the real pair', () => {
  // The session's conclusion, now computed rather than argued: the model
  // account publishes ~6.6x more authored posts per active day.
  assert.equal(report.gaps[0].id, 'volume');
  assert.equal(report.gaps[0].unit, 'perDay');
  assert.ok(report.projection.volumeRatio > 6 && report.projection.volumeRatio < 7);
});

test('reallocating retweet slots is reported as the cheap half of the volume gap', () => {
  const g = gap('authored-share');
  assert.equal(g.unit, 'perDay');
  // 34% authored against 77% — at the same posting frequency that alone is
  // ~2.25x the authored output.
  assert.ok(g.impact > 1 && g.impact < 1.5, `unexpected impact ${g.impact}`);
  assert.ok(g.impact < report.gaps[0].impact, 'must not outrank the full volume gap');
});

test('a strong type the benchmark posts less of is held, not cut', () => {
  // The trap: bai_ee's best type (original-showcase, 1.61x own average) is one
  // seb posts LESS of. Blind mix-matching would recommend cutting it.
  const g = gap('type-mix:original-showcase');
  assert.equal(g.direction, 'hold');
  assert.equal(g.impact, 0);
  assert.match(g.headline, /keep it/);
});

test('a type the benchmark leans on but the account executes badly is an execution finding', () => {
  const g = gap('type-mix:original-text');
  assert.equal(g.direction, 'investigate');
  assert.equal(g.impact, 0, 'must not be ranked as a mix opportunity');
  assert.match(g.headline, /execution question/);
});

test('the mix projection only counts moves the comparison supports', () => {
  // Blind mix-matching scored 0.84x here — copying the benchmark's shape would
  // have made this account worse. Restricting to actionable moves cannot.
  assert.ok(report.projection.mixMultiplier >= 1, `expected >= 1, got ${report.projection.mixMultiplier}`);
  assert.ok(report.projection.caveat.includes('ceiling'));
});

test('topic gaps are suppressed when the two taggers share no vocabulary', () => {
  // The real corpora share 1 topic label out of 16. Reporting "japanese-asian-
  // design is 0% of your output" would describe the tagger, not the account.
  assert.equal(report.gaps.filter((g) => g.dimension === 'topic').length, 0);
  assert.ok(report.warnings.some((w) => w.includes('Topic comparison suppressed')));
});

test('topic gaps survive when the vocabularies do overlap', () => {
  const own = blockOf('own', { 'original-text': { n: 20, likes: 10, topics: ['craft'] } });
  const bench = blockOf('bench', {
    'original-text': { n: 20, likes: 10, topics: ['craft'] },
    'original-showcase': { n: 20, likes: 90, topics: ['motion'] },
  });
  const r = compareToBenchmark({ own, benchmark: bench });
  assert.ok(r.gaps.some((g) => g.id === 'topic:motion'));
  assert.ok(!r.warnings.some((w) => w.includes('Topic comparison suppressed')));
});

test('an under-posted type the account performs well at is an increase', () => {
  const own = blockOf('own', {
    'original-text': { n: 40, likes: 5 },
    'original-showcase': { n: 4, likes: 50 },
  });
  const bench = blockOf('bench', {
    'original-text': { n: 10, likes: 5 },
    'original-showcase': { n: 40, likes: 50 },
  });
  const r = compareToBenchmark({ own, benchmark: bench });
  const g = r.gaps.find((x) => x.id === 'type-mix:original-showcase');
  assert.equal(g.direction, 'increase');
  assert.ok(g.impact > 0);
  assert.ok(r.projection.mixMultiplier > 1);
});

test('lift is borrowed from the benchmark only when the account has too few posts, and confidence says so', () => {
  const own = blockOf('own', {
    'original-text': { n: 40, likes: 10 },
    'self-quote': { n: 2, likes: 1 },
  });
  const bench = blockOf('bench', {
    'original-text': { n: 20, likes: 10 },
    'self-quote': { n: 30, likes: 60 },
  });
  const r = compareToBenchmark({ own, benchmark: bench });
  const g = r.gaps.find((x) => x.id === 'type-mix:self-quote');
  assert.equal(g.liftSource, 'benchmark', 'two posts cannot measure a type');
  assert.equal(g.confidence, 'low');
});

test('differences below the noise floor are not reported', () => {
  const own = blockOf('own', { 'original-text': { n: 50, likes: 10 }, 'quote-react': { n: 50, likes: 10 } });
  const bench = blockOf('bench', { 'original-text': { n: 51, likes: 10 }, 'quote-react': { n: 49, likes: 10 } });
  const r = compareToBenchmark({ own, benchmark: bench });
  assert.equal(r.gaps.filter((g) => g.dimension === 'type-mix').length, 0);
});

test('media is only compared inside a post type', () => {
  const own = blockOf('own', { 'original-showcase': { n: 30, likes: 10, media: 'image' } });
  const bench = summarizeCorpus([
    ...Array.from({ length: 20 }, () => post({ type: 'original-showcase', media: 'video', likes: 90 })),
    ...Array.from({ length: 20 }, () => post({ type: 'original-showcase', media: 'image', likes: 10 })),
  ], { handle: 'bench' });
  const r = compareToBenchmark({ own, benchmark: bench });
  const g = r.gaps.find((x) => x.id === 'media:original-showcase:video');
  assert.ok(g, 'expected a video gap inside original-showcase');
  assert.equal(g.unit, 'perPost');
  assert.ok(g.lift > 1);
});

test('hour density is reported as a finding with no modelled impact', () => {
  const g = gap('hour-density');
  assert.equal(g.unit, 'shape');
  assert.equal(g.impact, 0);
  assert.match(g.headline, /spacing is not the lever/);
});

test('clock hours are never compared across accounts', () => {
  assert.ok(report.warnings.some((w) => w.includes('own local clock')));
});

test('a biased view sample is called out rather than silently used', () => {
  assert.ok(report.warnings.some((w) => w.includes('Benchmark view coverage is 25%')));
  assert.equal(report.projection.liftBasis, 'avgLikes');
});

test('a thin own corpus is flagged', () => {
  const own = blockOf('own', { 'original-text': { n: 5, likes: 10 } });
  const r = compareToBenchmark({ own, benchmark: seb });
  assert.ok(r.warnings.some((w) => w.includes('authored posts')));
});

test('an empty corpus returns no gaps instead of inventing them', () => {
  const r = compareToBenchmark({ own: summarizeCorpus([], { handle: 'x' }), benchmark: seb });
  assert.deepEqual(r.gaps, []);
  assert.equal(r.projection, null);
});

test('never throws on junk input', () => {
  for (const input of [{}, { own: null, benchmark: null }, { own: 'x', benchmark: 42 }]) {
    const r = compareToBenchmark(input);
    assert.deepEqual(r.gaps, []);
  }
});

test('gaps are sorted by impact and each carries its unit', () => {
  const impacts = report.gaps.map((g) => Math.abs(g.impact ?? 0));
  assert.deepEqual(impacts, [...impacts].sort((a, b) => b - a));
  for (const g of report.gaps) {
    assert.ok(['perPost', 'perDay', 'shape'].includes(g.unit), `bad unit on ${g.id}`);
    assert.ok(['high', 'medium', 'low'].includes(g.confidence), `bad confidence on ${g.id}`);
  }
});
