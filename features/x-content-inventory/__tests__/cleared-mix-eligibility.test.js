import test from 'node:test';
import assert from 'node:assert/strict';
import { renderedVideoToPackage } from '../../rendered-videos/adapter.js';
import { contentBasis, packageEligibility } from '../daily-loop/content-basis.js';
import { scoreMatch } from '../match.js';

const TODAY = Date.parse('2026-10-11T12:00:00Z');
const slot = { slot: 'B', type: 'original-showcase', lane: 'music', hoursFromNow: 24 };
const ue = [{ artistName: 'ACIDMAN', artistGenre: 'acid', mixes: [{ mixTitle: 'Stargazers', mixDateYear: "'09" }] }];
const vid = (o = {}) => ({ id: 'j1', jobId: 'j1', artist: 'ACIDMAN', mixTitle: 'Stargazers', duration: 125, fileName: 'j1.mp4', status: 'completed', createdAt: '2026-09-01T00:00:00Z', ...o });
const mk = (o, ctx = { ueArtists: ue }) => renderedVideoToPackage(vid(o), ctx);

test('cleared third-party mix: facts basis from metadata only, no invented memory', () => {
  const b = contentBasis(mk());
  assert.equal(b.kind, 'facts');
  const byLabel = Object.fromEntries(b.facts.map((f) => [f.label, f]));
  assert.match(byLabel.mix.value, /^ACIDMAN – Stargazers, hosted on Underground Existence$/);
  assert.equal(byLabel.mix.provenance, 'Underground Existence');
  assert.equal(byLabel.duration.value, '2:05');
  assert.equal(byLabel.year.value, '2009');
  assert.equal(byLabel['artist genre tag'].value, 'acid');
  assert.equal(b.story, '');
});

test('unknown mix/artist yields no facts (nothing to say) and is ineligible', () => {
  assert.equal(contentBasis(mk({ mixTitle: 'Hitloop Video Remix' })).kind, 'none');
  assert.equal(contentBasis(mk({ artist: 'random' })).kind, 'none');
  assert.equal(packageEligibility(mk({ artist: 'random' }), { now: TODAY }).ok, false);
});

test('accept. 4: cleared third-party AND BAI-EE mixes fill a showcase slot; blocked ones never do', () => {
  const cleared = mk();
  const own = mk({ id: 'j2', jobId: 'j2', artist: 'Bai-ee', mixTitle: 'Bai-ee Mix' }, {});
  for (const p of [cleared, own]) {
    assert.equal(packageEligibility(p, { now: TODAY }).ok, true, p.title);
    assert.ok(scoreMatch(p, slot, { today: TODAY }), p.title);
  }
  const blocked = [
    { ...cleared, rights: 'never-public' },
    { ...cleared, rights: 'cleared', approval: { state: 'needed' } },
    { ...cleared, status: 'retired', retiredReason: 'source-missing' },
  ];
  // scoreMatch gates rights/retired; approval is gated by packageEligibility (below).
  for (const p of [blocked[0], blocked[2]]) assert.equal(scoreMatch(p, slot, { today: TODAY }), null);
  assert.equal(packageEligibility(blocked[0], { now: TODAY }).ok, false);
  assert.equal(packageEligibility(blocked[1], { now: TODAY }).ok, false);
  assert.equal(packageEligibility(blocked[2], { now: TODAY }).ok, false);
});

test('placeholder story still blocks a package with no facts basis; a real story unblocks it', () => {
  const unknown = mk({ mixTitle: 'Hitloop Video Remix' });
  assert.equal(scoreMatch(unknown, slot, { today: TODAY }), null);
  const discogsShell = { ...mk(), source: { kind: 'discogs', url: 'https://discogs.com/x' } };
  assert.equal(scoreMatch(discogsShell, slot, { today: TODAY }), null, 'non-rendered shells keep waiting for the owner');
  const withStory = { ...unknown, story: 'I made this one the week the label folded and never sent it to anyone.' };
  assert.ok(scoreMatch(withStory, slot, { today: TODAY }));
});
