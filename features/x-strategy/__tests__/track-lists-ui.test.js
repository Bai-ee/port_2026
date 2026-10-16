// P4 (Track Lists → Daily Signals): ContentTracksPanel list chips are a thin view over ui-model.js. This exercises the
// full pure path: add/remove chip -> trackChangesFromDraft payload (changes.contentTracks) -> plan normalize ->
// Brain write-back diff (recordCardEdits' cardView + changedManifestFields) -> Brain markdown `lists:` -> parse back.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  trackDraftFromPlan, trackChangesFromDraft, validateTrackList, addTrackList, removeTrackList, addDraftTrack,
} from '../ui-model.js';
import { normalizeContentTracks, MAX_LISTS_PER_TRACK, MAX_DISTINCT_LISTS } from '../content-tracks.js';
import { twoTrackPlan } from './fixtures/two-tracks.js';

const sync = createRequire(import.meta.url)('../../client-brain/brain-sync.cjs');

const DESIGN_URL = 'https://x.com/i/lists/1299069903333285888';
const AI_ID = '1275110927726239748';
const BRAIN = '## Content Intelligence\n\n### Content Tracks\n- label: Design & client work | share: 50% | benchmarks: seb__design\n- label: Music (UE mixes, Discogs) | share: 50%\n';

// What the Brain sees after a plan save: prior/next plan docs -> markdown, exactly as recordCardEdits does it.
function brainAfterSave(markdown, priorPlan, nextPlan) {
  const view = (x) => sync.cardView('contentTracks', x, null);
  const edits = sync.changedManifestFields(view(priorPlan), view(nextPlan), sync.CONTENT_TRACKS_FIELDS);
  return { edits, ...sync.applyCardEditsToMarkdown(markdown, edits, sync.CONTENT_TRACKS_FIELDS) };
}

test('list validation: URL or digits, duplicates, per-track and distinct caps', () => {
  let d = trackDraftFromPlan(twoTrackPlan());
  assert.match(validateTrackList(d, 'design', ''), /Paste an X list/);
  assert.match(validateTrackList(d, 'design', 'https://x.com/someone'), /Not an X list/);
  assert.equal(validateTrackList(d, 'design', DESIGN_URL), null);
  assert.equal(validateTrackList(d, 'design', AI_ID), null);
  assert.equal(validateTrackList(d, 'nope', AI_ID), 'Unknown track.');
  d = addTrackList(d, 'design', DESIGN_URL, 'Design craft');
  assert.match(validateTrackList(d, 'design', '1299069903333285888'), /already on this track/);
  d = addTrackList(addTrackList(d, 'design', '2'), 'design', '3');
  assert.equal(d[0].lists.length, MAX_LISTS_PER_TRACK);
  assert.match(validateTrackList(d, 'design', '4'), /per track/);
  // distinct cap across tracks: fill to MAX_DISTINCT_LISTS with extra tracks.
  let many = d;
  for (let i = 0; many.flatMap((t) => t.lists || []).length < MAX_DISTINCT_LISTS; i += 1) {
    const tid = i < 3 ? 'music' : 'extra';
    if (tid === 'extra' && !many.some((t) => t.id === 'extra')) many = addDraftTrack(many, 'Extra');
    many = addTrackList(many, tid, String(100 + i));
  }
  const target = many.find((t) => (t.lists || []).length < MAX_LISTS_PER_TRACK);
  assert.match(validateTrackList(many, target.id, '999'), /distinct lists/);
  assert.equal(validateTrackList(many, target.id, '1299069903333285888'), null, 'a list already on another track does not count twice');
});

test('add: label sanitized, blank label => "List <id>", unparseable input is a no-op', () => {
  const d0 = trackDraftFromPlan(twoTrackPlan());
  assert.deepEqual(addTrackList(d0, 'design', 'junk'), d0);
  const d = addTrackList(addTrackList(d0, 'design', DESIGN_URL, 'Design; craft = UI'), 'music', AI_ID, '');
  assert.deepEqual(d[0].lists, [{ id: '1299069903333285888', label: 'Design craft UI' }]);
  assert.deepEqual(d[1].lists, [{ id: AI_ID, label: `List ${AI_ID}` }]);
});

test('add/remove chip -> contentTracks payload -> Brain markdown `lists:` -> parse back (lossless)', () => {
  const saved = twoTrackPlan();
  let d = trackDraftFromPlan(saved);
  assert.equal(trackChangesFromDraft(saved, d).dirty, false, 'existing plans without lists open clean');

  d = addTrackList(d, 'design', DESIGN_URL, 'Design craft');
  d = addTrackList(d, 'design', AI_ID, 'AI builders');
  const add = trackChangesFromDraft(saved, d);
  assert.equal(add.dirty, true);
  assert.deepEqual(add.errors, []);
  assert.deepEqual(add.contentTracks[0].lists, [{ id: '1299069903333285888', label: 'Design craft' }, { id: AI_ID, label: 'AI builders' }]);
  assert.deepEqual(add.contentTracks[1].lists, []);

  // Plan save (plan-state normalizes) keeps lists.
  const next = { plan: { contentTracks: normalizeContentTracks(add.contentTracks) } };
  assert.deepEqual(next.plan.contentTracks[0].lists, add.contentTracks[0].lists);
  assert.equal(trackChangesFromDraft(next, trackDraftFromPlan(next)).dirty, false, 're-opening the saved tracks is clean');

  // Brain write-back.
  const b1 = brainAfterSave(BRAIN, saved, next);
  assert.deepEqual(b1.changed, ['contentTracks']);
  assert.match(b1.markdown, /- label: Design & client work \| share: 50% \| benchmarks: seb__design \| lists: 1299069903333285888=Design craft; 1275110927726239748=AI builders\n/);
  assert.match(b1.markdown, /- label: Music \(UE mixes, Discogs\) \| share: 50%\n/);
  const parsed = sync.projectFields(b1.markdown, sync.CONTENT_TRACKS_FIELDS).values.contentTracks;
  assert.deepEqual(parsed[0].lists, next.plan.contentTracks[0].lists);

  // Remove one chip -> save -> Brain row drops it; removing the last drops `lists:` entirely.
  const r1 = trackChangesFromDraft(next, removeTrackList(trackDraftFromPlan(next), 'design', AI_ID));
  const next2 = { plan: { contentTracks: normalizeContentTracks(r1.contentTracks) } };
  const b2 = brainAfterSave(b1.markdown, next, next2);
  assert.match(b2.markdown, /benchmarks: seb__design \| lists: 1299069903333285888=Design craft\n/);
  const r2 = trackChangesFromDraft(next2, removeTrackList(trackDraftFromPlan(next2), 'design', '1299069903333285888'));
  const next3 = { plan: { contentTracks: normalizeContentTracks(r2.contentTracks) } };
  const b3 = brainAfterSave(b2.markdown, next2, next3);
  assert.deepEqual(b3.changed, ['contentTracks']);
  assert.doesNotMatch(b3.markdown, /lists:/);
});

test('a save that does not touch lists makes no Brain change for lists', () => {
  const saved = twoTrackPlan();
  const b = brainAfterSave(BRAIN, saved, { plan: { contentTracks: normalizeContentTracks(trackChangesFromDraft(saved, trackDraftFromPlan(saved)).contentTracks || saved.plan.contentTracks) } });
  assert.deepEqual(b.changed, []);
});
