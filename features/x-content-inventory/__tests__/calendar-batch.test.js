// Calendar batch: bulk review drafts from library items (calendar-batch.js), the agent propose tool and the
// confirmed-proposal executor. Nothing here may approve, schedule or publish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBatchSpec, nextAnniversary, eventMonthDay, draftTextFor, planCalendarBatch, createCalendarBatch, MAX_BATCH, MEMORY_PLACEHOLDER,
} from '../calendar-batch.js';
import { normalizeContentTracks } from '../../x-strategy/content-tracks.js';
import { validateProposal, buildExecutors } from '../../x-strategy/agent/proposals.js';
import { prepareProposal } from '../../x-strategy/agent/tools.js';

const TODAY = '2026-10-16';
const tracks = normalizeContentTracks([
  { id: 'record', label: 'Record Collection Videos', engines: ['record'], buckets: ['record'], share: 0.5 },
  { id: 'ue', label: 'Dj Mix Videos', engines: ['ue', 'client', 'identity'], buckets: ['ue'], share: 0.3 },
  { id: 'nas', label: 'Throwback Content', engines: [], buckets: ['nas'], share: 0.2 },
]);
const flyer = (id, facets, extra = {}) => ({ id, engine: 'record', bucketId: 'nas', series: 'C3', story: MEMORY_PLACEHOLDER, facets, ...extra });
const PACKAGES = [
  flyer('nas-a', { eventDate: '2014-12-17', eventMonthDay: '12-17', partyNames: ['an evening of deep rhythms'], venues: ['1195 w folsom st | sf'] }, { title: 'An Evening of Deep Rhythms' }),
  flyer('nas-b', { eventMonthDay: '03-02' }, { title: 'Spring warehouse' }),
  flyer('nas-c', { eventMonthDay: '10-16' }, { title: 'Same day', story: 'I played the closing set and the sound cut out twice.' }),
  flyer('nas-d', { decade: '2000s' }, { title: 'No date at all' }),
  { id: 'disc-1', engine: 'record', title: 'A record', facets: { eventMonthDay: '11-01' } },
];

test('normalizeBatchSpec: needs a selector and a known date rule; caps and ranges enforced', () => {
  assert.equal(normalizeBatchSpec({ select: {}, dateRule: { kind: 'anniversary' } }).ok, false);
  assert.equal(normalizeBatchSpec({ select: { track: 'nas' }, dateRule: { kind: 'someday' } }).ok, false);
  assert.equal(normalizeBatchSpec({ select: { ids: Array.from({ length: MAX_BATCH + 1 }, (_, i) => `x${i}`) }, dateRule: { kind: 'anniversary' } }).ok, false);
  assert.equal(normalizeBatchSpec({ select: { track: 'nas' }, dateRule: { kind: 'spread', perDay: 9 } }).ok, false);
  const ok = normalizeBatchSpec({ select: { track: ' Throwback Content ', bucketId: 'NAS' }, dateRule: { kind: 'spread', startDate: '2026-11-01' } });
  assert.deepEqual(normalizeBatchSpec({ select: { track: 'nas' }, dateRule: { kind: 'anniversary' } }).spec.dateRule, { kind: 'anniversary', perDay: 1 });
  assert.deepEqual(ok, { ok: true, spec: { select: { track: 'Throwback Content', bucketId: 'nas' }, dateRule: { kind: 'spread', startDate: '2026-11-01', perDay: 1 }, limit: MAX_BATCH } });
});

test('dates: month-day from facets, next anniversary on or after today, Feb 29 in a common year', () => {
  assert.equal(eventMonthDay(PACKAGES[0]), '12-17');
  assert.equal(eventMonthDay({ facets: { eventDate: '1999-07-04' } }), '07-04');
  assert.equal(eventMonthDay({ facets: { eventMonthDay: '03-02' }, humanEdits: { eventMonthDay: '03-09' } }), '03-09'); // owner edit wins
  assert.equal(nextAnniversary('12-17', TODAY), '2026-12-17');
  assert.equal(nextAnniversary('10-16', TODAY), '2026-10-16');
  assert.equal(nextAnniversary('03-02', TODAY), '2027-03-02');
  assert.equal(nextAnniversary('02-29', TODAY), '2027-02-28');
  assert.equal(nextAnniversary('04-31', TODAY), null);
});

test('draftTextFor: facts + placeholder when no story, the owner story otherwise, never over 280', () => {
  const t = draftTextFor(PACKAGES[0]);
  assert.match(t, /^Dec 17, 2014 · An Evening of Deep Rhythms\n1195 w folsom st \| sf\n\n\[add your memory\]$/);
  assert.match(draftTextFor(PACKAGES[2]), /I played the closing set/);
  assert.ok(draftTextFor({ ...PACKAGES[0], title: 'x'.repeat(400) }).length <= 280);
  assert.ok(draftTextFor({ ...PACKAGES[0], title: 'x'.repeat(400) }).endsWith(MEMORY_PLACEHOLDER));
});

test('planCalendarBatch anniversary: dated by event, sorted, undated and queued items skipped', () => {
  const spec = normalizeBatchSpec({ select: { track: 'Throwback Content' }, dateRule: { kind: 'anniversary' } }).spec;
  const plan = planCalendarBatch({ packages: PACKAGES, tracks, spec, today: TODAY, openPackageIds: new Set(['nas-b']) });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rows.map((r) => [r.packageId, r.reviewOn, r.needsStory, r.track]), [
    ['nas-c', '2026-10-16', false, 'nas'], ['nas-a', '2026-12-17', true, 'nas'],
  ]);
  assert.deepEqual(plan.counts, { matched: 4, drafts: 2, needsMemory: 1, skipped: { 'already-queued': 1, 'no-date': 1 } });
  assert.equal(plan.firstDate, '2026-10-16');
  assert.equal(plan.lastDate, '2026-12-17');
});

test('planCalendarBatch anniversary perDay: one per date by default, the item with a story or full date wins', () => {
  const twins = [
    flyer('dup-1', { eventMonthDay: '12-17' }, { title: 'Undated twin' }),
    ...PACKAGES,
  ];
  const spec = normalizeBatchSpec({ select: { track: 'nas' }, dateRule: { kind: 'anniversary' } }).spec;
  const plan = planCalendarBatch({ packages: twins, tracks, spec, today: TODAY });
  assert.deepEqual(plan.rows.filter((r) => r.reviewOn === '2026-12-17').map((r) => r.packageId), ['nas-a']);
  assert.equal(plan.counts.skipped['day-full'], 1);
  const two = planCalendarBatch({ packages: twins, tracks, spec: { ...spec, dateRule: { kind: 'anniversary', perDay: 2 } }, today: TODAY });
  assert.equal(two.rows.filter((r) => r.reviewOn === '2026-12-17').length, 2);
});

test('planCalendarBatch spread + limit + unknown track', () => {
  const spec = normalizeBatchSpec({ select: { bucketId: 'nas' }, dateRule: { kind: 'spread', perDay: 2 }, limit: 3 }).spec;
  const plan = planCalendarBatch({ packages: PACKAGES, tracks, spec, today: TODAY });
  assert.deepEqual(plan.rows.map((r) => r.reviewOn), ['2026-10-17', '2026-10-17', '2026-10-18']);
  assert.equal(plan.counts.skipped['over-limit'], 1);
  const bad = planCalendarBatch({ packages: PACKAGES, tracks, spec: { ...spec, select: { track: 'nope' } }, today: TODAY });
  assert.deepEqual(bad, { ok: false, error: 'unknown track "nope"' });
});

test('createCalendarBatch: one draft per item via the create-once writer; a re-run adds nothing', async () => {
  const store = new Map();
  const ensureDraft = async (clientId, payload) => {
    if (store.has(payload.idempotencyKey)) return { post: store.get(payload.idempotencyKey), existing: true };
    const post = { ...payload, clientId, status: 'draft', scheduledAt: null };
    store.set(payload.idempotencyKey, post);
    return { post, existing: false };
  };
  const spec = normalizeBatchSpec({ select: { track: 'nas' }, dateRule: { kind: 'anniversary' } }).spec;
  const plan = planCalendarBatch({ packages: PACKAGES, tracks, spec, today: TODAY });
  assert.deepEqual(await createCalendarBatch('c1', plan, { ensureDraft }), { created: 3, existing: 0, failed: [] });
  assert.deepEqual(await createCalendarBatch('c1', plan, { ensureDraft }), { created: 0, existing: 3, failed: [] });
  for (const post of store.values()) {
    assert.equal(post.status, 'draft');
    assert.equal(post.scheduledAt, null);
    assert.equal(post.source, 'calendar-batch');
    assert.match(post.reviewOn, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(store.get('calendar-batch:nas-a').needsStory, true);
});

test('agent: propose_calendar_batch previews through toolDeps, refuses an empty batch; the proposal executes the spec', async () => {
  const spec = { select: { track: 'nas' }, dateRule: { kind: 'anniversary' } };
  const preview = async (s) => ({ ok: true, ...planCalendarBatch({ packages: PACKAGES, tracks, spec: s, today: TODAY }) });
  const base = { summary: 'Throwback anniversaries', rationale: 'Owner asked', evidence: [] };
  const out = await prepareProposal('propose_calendar_batch', { ...base, ...spec }, { toolDeps: { previewCalendarBatch: preview } });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.proposal.kind, 'calendar-batch');
  assert.equal(out.proposal.payload.preview.drafts, 3);
  const empty = await prepareProposal('propose_calendar_batch', { ...base, select: { ids: ['nope'] }, dateRule: { kind: 'anniversary' } }, { toolDeps: { previewCalendarBatch: preview } });
  assert.match(empty.error, /no drafts to create/);

  const v = validateProposal({ kind: 'calendar-batch', payload: out.proposal.payload });
  assert.equal(v.ok, true);
  const calls = [];
  const ex = buildExecutors({ planStore: {}, runCalendarBatch: async (a) => { calls.push(a); return { ok: true, created: 3, existing: 0, failed: [], counts: { drafts: 3 } }; } });
  const res = await ex['calendar-batch']({ clientId: 'c1', payload: v.proposal.payload, proposalId: 'p1' });
  assert.equal(res.created, 3);
  assert.deepEqual(calls[0].spec, v.proposal.payload.spec);
  assert.equal(calls[0].proposalId, 'p1');
});
