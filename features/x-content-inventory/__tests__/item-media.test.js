// Item media: give a library item the video/image of another item (item-media.js), the agent tools around it, and
// the confirmed-proposal executor. Library fields only; never a post.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaOf, findMediaCandidates, linkMediaPatch, normalizeLinks, MAX_LINKS } from '../item-media.js';
import { pickMediaRef } from '../item-actions.js';
import { prepareProposal, runReadTool } from '../../x-strategy/agent/tools.js';
import { validateProposal, buildExecutors } from '../../x-strategy/agent/proposals.js';

const birthday = { id: 'birthday-bob-sinclar', clientId: 'c1', title: 'Bob Sinclar birthday (05-10)', series: 'C1', mediaState: 'needs-capture', effort: 'needs-shoot', assetRefs: [],
  story: 'Bob Sinclar was born 1969-05-10. On my shelf: Paradise (2017).', source: { kind: 'discogs', externalId: '10442424' } };
const record = { id: 'discogs-10442424', clientId: 'c1', title: 'Bob Sinclar – Paradise', mediaState: 'video', thumbRef: 'content-thumbs/c1/discogs-10442424.jpg',
  assetRefs: ['publish-staging/discogs/10442424/video-1x1.mp4', 'publish-staging/discogs/10442424/image-1x1.jpg'], source: { kind: 'discogs', externalId: '10442424' } };
const wordMatch = { id: 'discogs-1', clientId: 'c1', title: 'Bob Sinclar – Gym Tonic', assetRefs: ['publish-staging/discogs/1/image-1x1.jpg'], source: { kind: 'discogs', externalId: '1' } };
const noMedia = { id: 'idea-1', clientId: 'c1', title: 'Bob Sinclar notes', assetRefs: ['sha256:abc'] };
const PKGS = [birthday, record, wordMatch, noMedia];

test('mediaOf: only refs the publisher accepts', () => {
  assert.deepEqual(mediaOf(record), { video: record.assetRefs[0], image: record.assetRefs[1], kind: 'video' });
  assert.deepEqual(mediaOf(noMedia), { video: null, image: null, kind: null });
});

test('findMediaCandidates: same Discogs release first, then title words; never self or media-less items', () => {
  const c = findMediaCandidates(birthday, PKGS);
  assert.deepEqual(c.map((x) => [x.id, x.kind]), [['discogs-10442424', 'video'], ['discogs-1', 'image']]);
  assert.match(c[0].why, /same Discogs release 10442424/);
  assert.deepEqual(findMediaCandidates(record, [record]), []);
  // Story boilerplate ("Source: <url>") and filler words never make a match on their own.
  const noisy = { id: 'discogs-2', clientId: 'c1', title: 'Some Source – Just You', assetRefs: ['publish-staging/discogs/2/video.mp4'] };
  assert.deepEqual(findMediaCandidates({ ...birthday, story: `${birthday.story} Source: https://en.wikipedia.org/x` }, [noisy]), []);
});

test('linkMediaPatch: source media first, ready with video, thumb reused, provenance recorded; the publisher picks the video', () => {
  const { patch } = linkMediaPatch({ ...birthday, assetRefs: ['ev:own/still.jpg'] }, record, { now: 5 });
  assert.deepEqual(patch.assetRefs, [record.assetRefs[0], record.assetRefs[1], 'ev:own/still.jpg']);
  assert.equal(patch.mediaState, 'video');
  assert.equal(patch.effort, 'ready');
  assert.equal(patch.thumbRef, record.thumbRef);
  assert.deepEqual(patch.mediaFrom, { id: record.id, kind: 'video', at: 5 });
  assert.equal(pickMediaRef({ ...birthday, ...patch }).kind, 'video');
  assert.match(linkMediaPatch(birthday, noMedia).error, /no usable video or image/);
  assert.match(linkMediaPatch(birthday, { ...record, clientId: 'other' }).error, /different clients/);
  assert.match(linkMediaPatch(record, record).error, /itself/);
});

test('normalizeLinks: one per target, no self links, capped', () => {
  assert.deepEqual(normalizeLinks([{ targetId: ' a ', sourceId: 'b' }]), { ok: true, links: [{ targetId: 'a', sourceId: 'b' }] });
  assert.equal(normalizeLinks([{ targetId: 'a', sourceId: 'b' }, { targetId: 'a', sourceId: 'c' }]).ok, false);
  assert.equal(normalizeLinks([{ targetId: 'a', sourceId: 'a' }]).ok, false);
  assert.equal(normalizeLinks(Array.from({ length: MAX_LINKS + 1 }, (_, i) => ({ targetId: `t${i}`, sourceId: 's' }))).ok, false);
});

test('agent: find_item_media reads through toolDeps; propose_item_media previews, refuses a bad pair; confirm runs the writer', async () => {
  const deps = {
    findItemMedia: async ({ id }) => ({ id, candidates: findMediaCandidates(PKGS.find((p) => p.id === id), PKGS) }),
    previewItemMedia: async (links) => ({ ok: true, rows: normalizeLinks(links).links.map((l) => {
      const t = PKGS.find((p) => p.id === l.targetId); const s = PKGS.find((p) => p.id === l.sourceId); const r = linkMediaPatch(t, s);
      return { ...l, targetTitle: t.title, sourceTitle: s.title, ...(r.error ? { error: r.error } : { kind: r.patch.mediaFrom.kind }) };
    }) }),
  };
  const found = await runReadTool('find_item_media', { itemId: birthday.id }, deps);
  assert.equal(found.candidates[0].id, record.id);
  const base = { summary: 'Link birthday videos', rationale: 'Same release on the shelf', evidence: [] };
  const ok = await prepareProposal('propose_item_media', { ...base, links: [{ targetId: birthday.id, sourceId: record.id }] }, { toolDeps: deps });
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual(ok.proposal.payload.rows[0].kind, 'video');
  const bad = await prepareProposal('propose_item_media', { ...base, links: [{ targetId: birthday.id, sourceId: noMedia.id }] }, { toolDeps: deps });
  assert.match(bad.error, /no usable video or image/);

  const v = validateProposal({ kind: 'item-media', payload: ok.proposal.payload });
  assert.equal(v.ok, true);
  const calls = [];
  const ex = buildExecutors({ planStore: {}, runItemMedia: async (a) => { calls.push(a); return { linked: 1, failed: 0, results: [{ ok: true }] }; } });
  assert.deepEqual(await ex['item-media']({ clientId: 'c1', payload: v.proposal.payload }), { linked: 1, failed: 0, results: [] });
  assert.deepEqual(calls[0], { clientId: 'c1', links: [{ targetId: birthday.id, sourceId: record.id }] });
  const none = buildExecutors({ planStore: {}, runItemMedia: async () => ({ linked: 0, failed: 1, results: [{ ok: false, error: 'x' }] }) });
  await assert.rejects(() => none['item-media']({ clientId: 'c1', payload: v.proposal.payload }), /no link could be made/);
});
