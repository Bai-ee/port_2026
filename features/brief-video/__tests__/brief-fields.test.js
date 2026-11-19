import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeVideoBrief, isPanelBriefPending, panelBriefBlocksRender, videoBriefView } from '../brief-fields.js';
import { selectCandidates } from '../jobs.js';
import { classifyVideoProcessing } from '../videoStatus.js';
import { planAttach } from '../attach.js';
import { briefHash } from '../brief.js';

test('mergeVideoBrief: partial saves keep other fields; validation; empty clears', () => {
  const a = mergeVideoBrief({}, { template: 'T', shots: '0-2s hook', assets: 'u1\n\nu2' }, { now: 'n' });
  assert.deepEqual(a.videoBriefMeta.assets, ['u1', 'u2']);
  assert.equal(a.videoBriefMeta.status, 'draft');
  const b = mergeVideoBrief({ videoBrief: 'T', videoBriefMeta: a.videoBriefMeta }, { captions: 'C' });
  assert.equal(b.videoBrief, 'T'); assert.equal(b.videoBriefMeta.shots, '0-2s hook'); assert.equal(b.videoBriefMeta.captions, 'C');
  assert.throws(() => mergeVideoBrief({}, { template: 'x'.repeat(8001) }), /8000/);
  assert.throws(() => mergeVideoBrief({}, { template: 'x', status: 'rendered' }), /status/);
  assert.deepEqual(mergeVideoBrief({ videoBrief: 'T' }, { template: '  ' }), { videoBrief: null, videoBriefMeta: null });
});

test('render gate: panel briefs render only when approved; legacy content briefs unchanged; status line; attach marks rendered', () => {
  const base = { clientId: 'paradice-dbBQCHUX', status: 'draft', reviewOn: '2026-11-20', content: 'Copy.' };
  const clients = { 'paradice-dbBQCHUX': {} };
  const ready = { ...base, id: 'a', videoBrief: 'Shot 1', videoBriefMeta: { status: 'ready' } };
  const approved = { ...base, id: 'b', videoBrief: 'Shot 1', videoBriefMeta: { status: 'approved' } };
  const legacy = { ...base, id: 'c', content: 'Copy.\n\nINTERNAL VIDEO BRIEF: Shot 1' };
  const ids = selectCandidates([ready, approved, legacy], { today: '2026-11-19', clients }).map((c) => c.post.id);
  assert.deepEqual(ids.sort(), ['b', 'c']);
  assert.equal(panelBriefBlocksRender(ready), true);
  assert.equal(isPanelBriefPending(approved), true);
  assert.equal(classifyVideoProcessing(ready, [], { today: '2026-11-19' }).state, 'brief-not-approved');
  const job = { clientId: base.clientId, briefHash: briefHash('Shot 1'), downloadUrl: 'https://v.mp4', posterUrl: 'https://p.jpg', jobId: 'bv_1' };
  const r = planAttach(approved, job, { now: 'n' });
  assert.equal(r.ok, true);
  assert.equal(r.updated.videoBriefMeta.status, 'rendered');
  assert.equal(r.updated.content, 'Copy.');
  assert.equal(isPanelBriefPending(r.updated), false);
  assert.equal(videoBriefView(r.updated).meta.status, 'rendered');
});
