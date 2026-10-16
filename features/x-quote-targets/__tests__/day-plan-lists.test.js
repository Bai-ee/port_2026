import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeListCandidates, STALE_SCAN_HOURS } from '../day-plan.js';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const iso = (h) => new Date(NOW - h * 3_600_000).toISOString();
const qt = { generatedAt: iso(1), dismissed: ['l2'], candidates: [{ id: 'h1', vein: 'peer', score: 0.5 }, { id: 'dup', vein: 'peer', score: 0.4 }] };
const ls = {
  generatedAt: iso(2),
  byTrack: {
    design: { lists: [{ id: '1', label: 'A' }], posts: [{ id: 'l1', score: 0.9, listId: '1' }, { id: 'dup', score: 0.8 }, { id: 'l2', score: 0.7 }] },
    music: { lists: [], posts: [{ id: 'l1', score: 0.6 }, { id: 'm1', score: 0.3, trackId: 'music' }] },
  },
};

test('no listSignals returns quoteTargets unchanged (same reference)', () => {
  assert.equal(mergeListCandidates(qt, null), qt);
  assert.equal(mergeListCandidates(qt, { generatedAt: iso(1) }), qt);
  assert.equal(mergeListCandidates(null, undefined), null);
});

test('handle candidates first and win duplicates; list ids deduped across tracks; vein = owning track', () => {
  const m = mergeListCandidates(qt, ls, { now: NOW });
  assert.deepEqual(m.candidates.map((c) => c.id), ['h1', 'dup', 'l1', 'l2', 'm1']);
  assert.equal(m.candidates.find((c) => c.id === 'dup').vein, 'peer');
  const l1 = m.candidates.find((c) => c.id === 'l1');
  assert.equal(l1.vein, 'design'); assert.equal(l1.trackId, 'design'); assert.equal(l1.source, 'list');
  assert.equal(m.listScan.count, 3);
  assert.equal(m.listScan.stale, false);
});

test('dismissed array is preserved (consumers filter it), generatedAt falls back to the list scan', () => {
  const m = mergeListCandidates({}, ls, { now: NOW });
  assert.equal(m.generatedAt, ls.generatedAt);
  assert.deepEqual(mergeListCandidates(qt, ls, { now: NOW }).dismissed, ['l2']);
});

test('stale when generatedAt missing or older than STALE_SCAN_HOURS', () => {
  assert.equal(mergeListCandidates(qt, { ...ls, generatedAt: iso(STALE_SCAN_HOURS + 1) }, { now: NOW }).listScan.stale, true);
  assert.equal(mergeListCandidates(qt, { ...ls, generatedAt: null }, { now: NOW }).listScan.stale, true);
});

// ---- buildDayPlan with merged list candidates ----
import { buildDayPlan } from '../day-plan.js';

const CAL = { days: [{ day: 1, weekday: 'Thu', theme: 't', slots: [{ slot: 1, timeCT: '09:00', type: 'quote-react', lane: 'design' }] }] };
const fresh = (id, extra = {}) => ({ id, url: `https://x.com/a/status/${id}`, windowOpen: true, ...extra });

test('buildDayPlan: list candidate wins a quote-react slot whose lane equals its trackId within tolerance', () => {
  const merged = mergeListCandidates(
    { generatedAt: iso(1), candidates: [fresh('h1', { vein: 'peer', score: 0.8 })] },
    { generatedAt: iso(1), byTrack: { design: { posts: [fresh('l1', { score: 0.7 })] } } },
    { now: NOW },
  );
  const plan = buildDayPlan({ calendar: CAL, quoteTargets: merged, dayNumber: 1, now: NOW });
  assert.equal(plan.slots[0].candidate.id, 'l1');
  assert.equal(plan.slots[0].fillReason, 'vein match design');
});

test('buildDayPlan: a dismissed list id (existingDraftIds) is never assigned', () => {
  const merged = mergeListCandidates(
    { generatedAt: iso(1), candidates: [] },
    { generatedAt: iso(1), byTrack: { design: { posts: [fresh('l1', { score: 0.9 }), fresh('l2', { score: 0.5 })] } } },
    { now: NOW },
  );
  const plan = buildDayPlan({ calendar: CAL, quoteTargets: merged, dayNumber: 1, now: NOW, existingDraftIds: ['l1'] });
  assert.equal(plan.slots[0].candidate.id, 'l2');
});

test('buildDayPlan: scan.listScan passes through (null when no lists)', () => {
  const merged = mergeListCandidates(
    { generatedAt: iso(1), candidates: [] },
    { generatedAt: iso(2), byTrack: { design: { posts: [fresh('l1', { score: 0.9 })] } } },
    { now: NOW },
  );
  const plan = buildDayPlan({ calendar: CAL, quoteTargets: merged, dayNumber: 1, now: NOW });
  assert.deepEqual(plan.scan.listScan, { generatedAt: iso(2), stale: false, count: 1 });
  assert.equal(buildDayPlan({ calendar: CAL, quoteTargets: { candidates: [] }, dayNumber: 1, now: NOW }).scan.listScan, null);
});
