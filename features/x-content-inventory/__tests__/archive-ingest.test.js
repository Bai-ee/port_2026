import test from 'node:test';
import assert from 'node:assert/strict';
import {
  packageFromReviewRecord,
  ingestArchiveRecords,
  normalizeDecisions,
  confirmationKey,
  questionIdFor,
  eraYearFromLabel,
  mergeInventory,
} from '../archive-ingest.js';
import { routeDecision } from '../jev-taxonomy.js';

/** A CONFIRMED archive_review record, in the shape the control plane stores. */
function record(over = {}) {
  return {
    id: 'ca_abc',
    sha256: 'a'.repeat(64),
    sizeBytes: 1234,
    archiveName: 'housepit-2018-03-06.jpg',
    sourcePaths: ['/Volumes/NAS/private/housepit-2018-03-06.jpg'],
    collectionJobId: 'job1',
    state: 'CONFIRMED',
    mediaType: 'image',
    decisions: [
      { id: 'pillar', question: 'Which content pillar does this artifact belong to?', selectedValue: 'made-this', confidence: 0.95 },
      { id: 'series', question: 'Which posting series could publish this artifact?', selectedValue: 'C3', confidence: 0.71 },
      { id: 'clientWork', question: 'Is this client work, or work made for someone else?', selectedValue: 'yes', confidence: 0.93 },
    ],
    humanConfirmations: {},
    ...over,
  };
}

test('only a CONFIRMED record becomes a package', () => {
  // A model's answers are evidence, not a decision (invariant 7). A record a
  // person has not finished reviewing must not enter the inventory.
  const r = packageFromReviewRecord(record({ state: 'REVIEW_PENDING' }));
  assert.equal(r.ok, false);
  assert.match(r.skipped, /REVIEW_PENDING/);
});

test('a record without sha256 is refused — identity is bytes, not filename', () => {
  const r = packageFromReviewRecord(record({ sha256: null }));
  assert.equal(r.ok, false);
  assert.match(r.skipped, /sha256/);
});

test('the human value wins over the model selection', () => {
  const r = packageFromReviewRecord(record({
    humanConfirmations: { pillar: 'was-there', series: 'C3', clientWork: 'no' },
  }));
  assert.equal(r.package.pillar, 'was-there');   // model said made-this
  assert.deepEqual(r.provenance.corrections, [
    { questionId: 'pillar', model: 'made-this', human: 'was-there' },
    { questionId: 'clientWork', model: 'yes', human: 'no' },
  ]);
});

test('a human confirmation clears the clientWork gate; a confident model answer never does', () => {
  // The gate's own rule: a model answer is evidence, never permission. But a
  // person answering "no" IS the permission the gate is waiting for.
  const modelOnly = packageFromReviewRecord(record());
  assert.equal(modelOnly.package.rights, 'client-approval-needed');

  const humanSaysNo = packageFromReviewRecord(record({
    humanConfirmations: { clientWork: 'no' },
  }));
  assert.equal(humanSaysNo.package.rights, 'owned');

  // ...and a human "yes" stays gated, whatever the model thought.
  const humanSaysYes = packageFromReviewRecord(record({
    decisions: [{ id: 'clientWork', question: 'q', selectedValue: 'no', confidence: 0.99 }],
    humanConfirmations: { clientWork: 'yes' },
  }));
  assert.equal(humanSaysYes.package.rights, 'client-approval-needed');
});

test('routeDecision applies a human answer regardless of band or gate', () => {
  assert.equal(routeDecision({ questionId: 'clientWork', confidence: 0.1, humanConfirmed: true }).action, 'apply');
  assert.equal(routeDecision({ questionId: 'clientWork', confidence: 0.99 }).action, 'review');
  assert.equal(routeDecision({ questionId: 'pillar', confidence: 0.4, humanConfirmed: true }).action, 'apply');
});

test('NAS paths never reach the package', () => {
  // "No secrets or private absolute NAS/network details in public metadata."
  const r = packageFromReviewRecord(record({ humanConfirmations: { clientWork: 'no' } }));
  const blob = JSON.stringify(r.package);
  assert.ok(!blob.includes('/Volumes/'), 'package must not carry a NAS path');
  assert.ok(!blob.includes('housepit-2018-03-06.jpg'), 'package must not carry the source filename');
  assert.equal(r.provenance.sourcePathCount, 1);
});

test('confirmationKey matches how the control plane keys confirmations', () => {
  // app/api/archive/review/route.js keys by `d.id || d.question`. Deriving it
  // differently here silently drops every human correction.
  assert.equal(confirmationKey({ id: 'pillar', question: 'Which…' }), 'pillar');
  assert.equal(confirmationKey({ question: 'Which…' }), 'Which…');
  assert.equal(confirmationKey({}), null);
  assert.equal(confirmationKey(null), null);
});

test('a question is matched by id, then by verbatim text; unknown ones are skipped', () => {
  assert.equal(questionIdFor({ id: 'pillar' }), 'pillar');
  assert.equal(questionIdFor({ question: 'What era is this artifact from?' }), 'era');
  assert.equal(questionIdFor({ id: 'not-a-question' }), null);
  const norm = normalizeDecisions(record({
    decisions: [
      { id: 'pillar', selectedValue: 'was-there', confidence: 0.9 },
      { id: 'invented-by-the-worker', selectedValue: 'x', confidence: 0.9 },
    ],
  }));
  assert.deepEqual(norm.map((d) => d.questionId), ['pillar']);
});

test('a decade label becomes the first year it covers, or null', () => {
  assert.equal(eraYearFromLabel('1990-1994'), 1990);
  assert.equal(eraYearFromLabel('2020-present'), 2020);
  assert.equal(eraYearFromLabel('pre-1985'), null);
  assert.equal(eraYearFromLabel('unknown'), null);
  assert.equal(eraYearFromLabel(undefined), null);
});

test('a permanent asset references its Arweave URL first, then its hash', () => {
  const r = packageFromReviewRecord(record({ transactionId: 'TX1', arweaveUrl: 'https://arweave.net/TX1' }));
  assert.deepEqual(r.package.assetRefs, ['https://arweave.net/TX1', 'a'.repeat(64)]);
  assert.equal(r.provenance.permanent, true);

  const notYet = packageFromReviewRecord(record());
  assert.deepEqual(notYet.package.assetRefs, ['a'.repeat(64)]);
  assert.equal(notYet.provenance.permanent, false);
});

test('a draft is reported as invalid for exactly the two fields only a human can fill', () => {
  const r = packageFromReviewRecord(record({ humanConfirmations: { pillar: 'was-there', series: 'C3', clientWork: 'no' } }));
  assert.equal(r.validation.ok, false);
  assert.deepEqual(r.validation.errors, [
    'missing required field: title',
    'missing required field: story',
  ]);
});

test('re-ingesting does not duplicate a row a human has since written a story into', () => {
  const recs = [record({ humanConfirmations: { clientWork: 'no' } })];
  const first = ingestArchiveRecords({ records: recs, existing: [] });
  assert.equal(first.counts.added, 1);
  assert.deepEqual(first.needsStory, ['asset-aaaaaaaaaaaa']);

  // The operator fills in the story; the next ingest must leave it alone.
  const existing = [{ ...first.added[0], story: 'The night the PA died.', title: 'East Room' }];
  const second = ingestArchiveRecords({ records: recs, existing });
  assert.equal(second.counts.added, 0);
  assert.equal(second.skipped[0].reason, 'already in the inventory');
});

test('one bad record does not stop the batch', () => {
  // "Failed assets do not stop the whole collection."
  const out = ingestArchiveRecords({
    records: [record({ id: 'a', sha256: null }), record({ id: 'b', sha256: 'b'.repeat(64) })],
  });
  assert.equal(out.counts.added, 1);
  assert.equal(out.counts.skipped, 1);
});

test('never throws on junk', () => {
  for (const junk of [undefined, null, {}, { decisions: null }, { decisions: [null] }, { humanConfirmations: null }]) {
    assert.doesNotThrow(() => packageFromReviewRecord(junk));
    assert.doesNotThrow(() => normalizeDecisions(junk));
  }
  assert.doesNotThrow(() => ingestArchiveRecords({ records: [null], existing: [null] }));
  assert.doesNotThrow(() => ingestArchiveRecords(null));
});

/* ---- mergeInventory: the seam between the file, the Archive and the plan ---- */

test('a stored story reaches the plan instead of dying in the store', () => {
  // The defect this pins: Archive Inbox wrote stories to the package store
  // while the day plan read only the committed file, so a story an operator
  // wrote reached nothing at all.
  const seed = [{ id: 'asset-abc', series: 'C3', pillar: 'was-there', mediaState: 'still', rights: 'owned', effort: 'ready', story: '', title: '' }];
  const stored = [{ id: 'asset-abc', story: 'The night the PA died.', title: 'East Room' }];
  const merged = mergeInventory(seed, stored);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].story, 'The night the PA died.');
  assert.equal(merged[0].title, 'East Room');
  // ...without blanking the fields the store never wrote.
  assert.equal(merged[0].series, 'C3');
  assert.equal(merged[0].rights, 'owned');
  assert.equal(merged[0].mediaState, 'still');
});

test('a partial stored row never blanks a fully described one', () => {
  // save-story writes a handful of fields. Spreading it wholesale would wipe
  // series/rights/media off a row the file describes completely.
  const seed = [{ id: 'p1', series: 'C1', pillar: 'found-this', rights: 'owned', mediaState: 'video', effort: 'ready', story: 'old', title: 'T' }];
  const stored = [{ id: 'p1', story: 'new', title: '', series: null, pillar: undefined }];
  const [row] = mergeInventory(seed, stored);
  assert.equal(row.story, 'new');
  assert.equal(row.title, 'T', 'an empty string must not overwrite a real title');
  assert.equal(row.series, 'C1', 'null must not overwrite');
  assert.equal(row.pillar, 'found-this', 'undefined must not overwrite');
  assert.equal(row.mediaState, 'video');
});

test('an archive-derived row with no counterpart in the file is added', () => {
  const merged = mergeInventory(
    [{ id: 'seeded', series: 'C3' }],
    [{ id: 'asset-from-archive', series: 'C2', story: 'a test pressing' }],
  );
  assert.deepEqual(merged.map((p) => p.id).sort(), ['asset-from-archive', 'seeded']);
});

test('mergeInventory never throws on junk and keeps the seed', () => {
  for (const junk of [undefined, null, 'nope', 42, {}]) {
    assert.doesNotThrow(() => mergeInventory(junk, junk));
  }
  assert.deepEqual(mergeInventory([{ id: 'a' }], null), [{ id: 'a' }]);
  assert.deepEqual(mergeInventory(null, null), []);
  // A stored row with no id cannot be matched or added — dropped, not crashed.
  assert.deepEqual(mergeInventory([], [{ story: 'orphan' }]), []);
});
