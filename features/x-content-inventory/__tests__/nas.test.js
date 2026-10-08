import test from 'node:test';
import assert from 'node:assert/strict';
import { getPackage, upsertPackage } from '../store.js';
import {
  ingestNasResults, nasUploadUrl, applyStageComplete, handleNasAction, nasPackageId,
} from '../nas.js';

// Minimal Firestore fake: docs, subcollections, where('==')+limit queries, batch.
function makeDb() {
  const cols = new Map();
  const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  const FieldValue = { increment: (n) => ({ __inc: n }), serverTimestamp: () => ({ __ts: true }) };
  const apply = (prev, patch, merge) => {
    const out = merge ? { ...(prev || {}) } : {};
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && '__inc' in v) out[k] = (Number(out[k]) || 0) + v.__inc;
      else if (v && typeof v === 'object' && '__ts' in v) out[k] = new Date().toISOString();
      else out[k] = structuredClone(v);
    }
    return out;
  };
  const docRef = (n, id) => ({
    id,
    async get() { const d = col(n).get(id); return { id, exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) }; },
    async set(data, o) { col(n).set(id, apply(col(n).get(id), data, !!o?.merge)); },
    async delete() { col(n).delete(id); },
    collection: (sub) => collectionRef(`${n}/${id}/${sub}`),
  });
  const query = (n, spec = {}) => ({
    where: (f, op, v) => query(n, { ...spec, wheres: [...(spec.wheres || []), [f, v]] }),
    limit: (l) => query(n, { ...spec, lim: l }),
    orderBy: () => query(n, spec),
    startAfter: () => query(n, spec),
    async get() {
      let rows = [...col(n).entries()].map(([id, data]) => ({ id, data }));
      for (const [f, v] of spec.wheres || []) rows = rows.filter((r) => r.data[f] === v);
      if (spec.lim) rows = rows.slice(0, spec.lim);
      return { docs: rows.map((r) => ({ id: r.id, data: () => structuredClone(r.data) })) };
    },
  });
  const collectionRef = (n) => ({ doc: (id) => docRef(n, id), ...query(n) });
  return {
    FieldValue, cols, collection: collectionRef,
    batch() {
      const ops = [];
      return { set: (ref, d, o) => ops.push(() => ref.set(d, o)), delete: (ref) => ops.push(() => ref.delete()), commit: async () => { for (const op of ops) await op(); } };
    },
  };
}

const SHA = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);
const item = (o = {}) => ({
  sha256: SHA, relativePath: 'Housepit/1998/flyer.jpg', mediaType: 'image', width: 1000, height: 1400,
  facets: { people: ['DJ Sneak'], venues: ['Metro'], partyNames: ['Housepit Anniversary'], dateText: 'Oct 1998', eraYear: 1998, vibe: { kind: 'flyer', light: 'dark' } },
  summary: 'A 1998 Housepit flyer.', activity: 'flyer', peopleCount: 0, jev: { pillar: 'was-there' },
  model: 'claude-haiku-4-5', promptVersion: 'v1', costUsd: 0.004, ...o,
});

function setup() {
  const db = makeDb();
  const deps = {
    db, fieldValue: FieldValue(db),
    getPackage: (id) => getPackage(id, { db }),
    upsertPackage: (pkg) => upsertPackage(pkg, { db, returnPackages: false }),
    now: () => 1_700_000_000_000, sleep: async () => {}, randomId: (() => { let i = 0; return () => `cmd-${++i}`; })(),
    signUpload: async ({ storagePath }) => `https://signed/${storagePath}`,
    browseWaitMs: 0,
  };
  return { db, deps };
}
function FieldValue(db) { return db.FieldValue; }
const pkgs = (db) => db.cols.get('x_content_packages');

test('results: create sets owner defaults and machine fields', async () => {
  const { db, deps } = setup();
  const r = await ingestNasResults(deps, { sourceId: 's1', items: [item()] });
  assert.deepEqual({ created: r.created, updated: r.updated, ok: r.ok }, { created: 1, updated: 0, ok: true });
  const p = pkgs(db).get(nasPackageId(SHA));
  assert.equal(p.bucketId, 'nas'); assert.equal(p.engine, 'record'); assert.equal(p.series, 'C3');
  assert.equal(p.pillar, 'was-there'); assert.equal(p.status, 'idea'); assert.equal(p.story, '[add your memory]');
  assert.equal(p.rights, 'owned'); assert.equal(p.format, 'still'); assert.equal(p.mediaState, 'still');
  assert.equal(p.title, 'Housepit Anniversary · Metro · Oct 1998');
  assert.deepEqual(p.source, { kind: 'nas-archive', externalId: SHA });
  assert.equal(p.nas.sourceId, 's1'); assert.equal(p.nas.sha256, SHA); assert.equal(p.variants.x.suggestedStory, 'A 1998 Housepit flyer.');
  assert.deepEqual(p.facets.people, ['dj sneak']); assert.equal(p.analysis.costUsd, 0.004);
  assert.equal(p.lastPostedAt, null);
});

test('results: non-flyer video -> C5; invalid pillar -> was-there; title falls back to summary and caps at 90', async () => {
  const { db, deps } = setup();
  await ingestNasResults(deps, { sourceId: 's1', items: [item({ mediaType: 'video', durationSec: 12, facets: { vibe: { kind: 'gear' } }, jev: { pillar: 'nope' }, summary: 'x'.repeat(200) })] });
  const p = pkgs(db).get(nasPackageId(SHA));
  assert.equal(p.series, 'C5'); assert.equal(p.pillar, 'was-there'); assert.equal(p.format, 'video'); assert.equal(p.mediaState, 'video');
  assert.ok(p.title.length <= 90);
  assert.equal(p.nas.durationSec, 12);
});

test('results: re-analysis updates machine fields and preserves owner fields', async () => {
  const { db, deps } = setup();
  await ingestNasResults(deps, { sourceId: 's1', items: [item()] });
  const id = nasPackageId(SHA);
  db.cols.get('x_content_packages').set(id, {
    ...pkgs(db).get(id), story: 'I was there.', status: 'drafted', title: 'Mine',
    approval: { state: 'approved', by: 'me' }, humanEdits: { people: ['Sneak'] },
  });
  const r = await ingestNasResults(deps, { sourceId: 's1', items: [item({ summary: 'New summary', facets: { people: ['Someone Else'] } })] });
  assert.deepEqual({ created: r.created, updated: r.updated }, { created: 0, updated: 1 });
  const p = pkgs(db).get(id);
  assert.equal(p.story, 'I was there.'); assert.equal(p.status, 'drafted'); assert.equal(p.title, 'Mine');
  assert.deepEqual(p.approval, { state: 'approved', by: 'me' }); assert.deepEqual(p.humanEdits, { people: ['Sneak'] });
  assert.equal(p.summary, 'New summary'); assert.deepEqual(p.facets.people, ['someone else']);
  assert.equal(p.variants.x.suggestedStory, 'New summary');
});

test('results: organizedPath is stored and preserved when a re-analysis omits it', async () => {
  const { db, deps } = setup();
  await ingestNasResults(deps, { sourceId: 's1', items: [item({ organizedPath: 'HITLOOP-ARCHIVE/content/image/1998/a.jpg' })] });
  const id = nasPackageId(SHA);
  assert.equal(pkgs(db).get(id).nas.organizedPath, 'HITLOOP-ARCHIVE/content/image/1998/a.jpg');
  await ingestNasResults(deps, { sourceId: 's1', items: [item({ summary: 'again' })] });
  assert.equal(pkgs(db).get(id).nas.organizedPath, 'HITLOOP-ARCHIVE/content/image/1998/a.jpg');
  await ingestNasResults(deps, { sourceId: 's1', items: [item({ organizedPath: 'HITLOOP-ARCHIVE/content/image/1999/a.jpg' })] });
  assert.equal(pkgs(db).get(id).nas.organizedPath, 'HITLOOP-ARCHIVE/content/image/1999/a.jpg');
});

test('results: validation (sha, cap, sourceId, empty) and per-item skips', async () => {
  const { deps } = setup();
  await assert.rejects(() => ingestNasResults(deps, { items: [item()] }), { status: 400 });
  await assert.rejects(() => ingestNasResults(deps, { sourceId: 's', items: [] }), { status: 400 });
  await assert.rejects(() => ingestNasResults(deps, { sourceId: 's', items: Array.from({ length: 201 }, () => item()) }), { status: 400 });
  await assert.rejects(() => ingestNasResults(deps, { sourceId: 's', items: [item({ sha256: 'xyz' })] }), { status: 400 });
  const r = await ingestNasResults(deps, { sourceId: 's', items: [item({ sha256: 'bad' }), item({ sha256: SHA2 })] });
  assert.equal(r.created, 1); assert.equal(r.skipped[0].index, 0);
});

test('upload-url: constraints and path', async () => {
  const { deps } = setup();
  const ok = await nasUploadUrl(deps, { packageId: nasPackageId(SHA), sha256: SHA, contentType: 'video/quicktime', sizeBytes: 1000 });
  assert.equal(ok.storagePath, `publish-staging/nas/nas-${'a'.repeat(16)}/${'a'.repeat(16)}.mov`);
  assert.deepEqual(ok.headers, { 'Content-Type': 'video/quicktime' }); assert.match(ok.uploadUrl, /^https:\/\/signed\//);
  const base = { packageId: nasPackageId(SHA), sha256: SHA, contentType: 'image/jpeg', sizeBytes: 10 };
  await assert.rejects(() => nasUploadUrl(deps, { ...base, contentType: 'application/pdf' }), { status: 400 });
  await assert.rejects(() => nasUploadUrl(deps, { ...base, sizeBytes: 512 * 1024 * 1024 + 1 }), { status: 400 });
  await assert.rejects(() => nasUploadUrl(deps, { ...base, sizeBytes: 0 }), { status: 400 });
  await assert.rejects(() => nasUploadUrl(deps, { ...base, packageId: 'nas-0000000000000000' }), { status: 400 });
  await assert.rejects(() => nasUploadUrl(deps, { ...base, sha256: 'zz' }), { status: 400 });
});

async function seedWorkers(db, { ageMs = 5000, now = 1_700_000_000_000 } = {}) {
  await db.collection('archive_workers').doc('mac-analyzer').set({ workerAt: new Date(now - ageMs).toISOString(), lastHeartbeatAt: new Date(now - ageMs).toISOString(), localThumbBase: '/Users/x/thumbs', capabilities: ['ANALYZE_FACETS'] });
  await db.collection('archive_workers').doc('mac').set({ workerAt: new Date(now).toISOString() });
  await db.collection('archive_workers').doc('mac').collection('sources').doc('nas1').set({ label: 'NAS', root: '/Volumes/NAS' });
}

test('card: nas-status online/offline/none', async () => {
  const { db, deps } = setup();
  assert.deepEqual(await handleNasAction(deps, 'nas-status', {}), { ok: true, online: false, workerId: null, lastSeenAt: null, localThumbBase: null, sources: [] });
  await seedWorkers(db);
  const s = await handleNasAction(deps, 'nas-status', {});
  assert.equal(s.online, true); assert.equal(s.workerId, 'mac-analyzer'); assert.equal(s.localThumbBase, '/Users/x/thumbs');
  assert.deepEqual(s.sources, [{ id: 'nas1', label: 'NAS', root: '/Volumes/NAS' }]);
  await seedWorkers(db, { ageMs: 120_000 });
  assert.equal((await handleNasAction(deps, 'nas-status', {})).online, false);
});

test('card: estimate/process queue ANALYZE_FACETS; offline + validation refusals', async () => {
  const { db, deps } = setup();
  await assert.rejects(() => handleNasAction(deps, 'nas-process', { sourceId: 'nas1', paths: ['a'] }), { status: 409 });
  await seedWorkers(db);
  const est = await handleNasAction(deps, 'nas-estimate', { sourceId: 'nas1', paths: ['Housepit'] });
  assert.deepEqual(est, { ok: true, commandId: 'cmd-1' });
  const c1 = db.cols.get('archive_commands').get('cmd-1');
  assert.equal(c1.type, 'ANALYZE_FACETS'); assert.equal(c1.dryRun, true); assert.equal(c1.workerId, 'mac-analyzer'); assert.equal(c1.state, 'QUEUED');
  const pr = await handleNasAction(deps, 'nas-process', { sourceId: 'nas1', paths: ['Housepit'], capUsd: 3 });
  const c2 = db.cols.get('archive_commands').get(pr.commandId);
  assert.equal(c2.dryRun, false); assert.equal(c2.capUsd, 3); assert.ok(c2.model); assert.ok(c2.promptVersion);
  assert.equal(db.cols.get('archive_commands').get((await handleNasAction(deps, 'nas-process', { sourceId: 'nas1', paths: ['x'] })).commandId).capUsd, 5);
  await assert.rejects(() => handleNasAction(deps, 'nas-process', { sourceId: 'nas1', paths: ['x'], capUsd: 21 }), { status: 400 });
  // Batch mode is opt-in: only an explicit boolean true is stored.
  const cmds = db.cols.get('archive_commands');
  assert.equal(cmds.get((await handleNasAction(deps, 'nas-process', { sourceId: 'nas1', paths: ['x'], batch: true })).commandId).batch, true);
  assert.equal(cmds.get((await handleNasAction(deps, 'nas-process', { sourceId: 'nas1', paths: ['x'], batch: 'yes' })).commandId).batch, undefined);
  assert.equal(cmds.get((await handleNasAction(deps, 'nas-process', { sourceId: 'nas1', paths: ['x'] })).commandId).batch, undefined);
  await assert.rejects(() => handleNasAction(deps, 'nas-process', { sourceId: 'nas1', paths: ['../x'] }), { status: 400 });
  await assert.rejects(() => handleNasAction(deps, 'nas-process', { sourceId: 'nas1', paths: [] }), { status: 400 });
});

test('card: nas-jobs shape, nas-cancel', async () => {
  const { db, deps } = setup();
  await seedWorkers(db);
  const { commandId } = await handleNasAction(deps, 'nas-process', { sourceId: 'nas1', paths: ['A'], capUsd: 2 });
  await db.collection('archive_commands').doc(commandId).set({ state: 'RUNNING', result: { progress: { done: 3, total: 10 }, spentUsd: 0.02 } }, { merge: true });
  await db.collection('archive_commands').doc('other').set({ type: 'LIST_DIRECTORY', workerId: 'mac-analyzer' });
  const { jobs } = await handleNasAction(deps, 'nas-jobs', {});
  assert.equal(jobs.length, 1);
  assert.deepEqual(Object.keys(jobs[0]).sort(), ['batch', 'capUsd', 'createdAt', 'dryRun', 'error', 'estimate', 'final', 'id', 'paths', 'progress', 'spentUsd', 'state', 'type', 'updatedAt']);
  assert.equal(jobs[0].state, 'RUNNING'); assert.deepEqual(jobs[0].progress, { done: 3, total: 10 }); assert.equal(jobs[0].spentUsd, 0.02);
  assert.equal(jobs[0].final, null); // only terminal results carry final tallies
  const c = await handleNasAction(deps, 'nas-cancel', { commandId });
  const cc = db.cols.get('archive_commands').get(c.commandId);
  assert.equal(cc.type, 'CANCEL_JOB'); assert.equal(cc.commandId, commandId); assert.equal(cc.workerId, 'mac-analyzer');
  await assert.rejects(() => handleNasAction(deps, 'nas-cancel', { commandId: 'other' }), { status: 404 });
});

test('card: nas-browse maps entries; pending when worker has not answered', async () => {
  const { db, deps } = setup();
  await seedWorkers(db);
  const pending = await handleNasAction(deps, 'nas-browse', { sourceId: 'nas1', path: 'Housepit' });
  assert.equal(pending.pending, true); assert.equal(pending.commandId, 'cmd-1'); assert.deepEqual(pending.entries, []);
  const q = db.cols.get('archive_commands').get('cmd-1');
  assert.equal(q.type, 'LIST_DIRECTORY'); assert.equal(q.workerId, 'mac'); assert.equal(q.relativePath, 'Housepit');
  await db.collection('archive_commands').doc('cmd-1').set({ state: 'COMPLETE', result: { entries: [{ name: '1998', kind: 'folder' }, { name: 'a.JPG', kind: 'file' }, { name: 'b.mov', kind: 'file' }, { name: 'c.txt', kind: 'file' }] } }, { merge: true });
  const done = await handleNasAction(deps, 'nas-browse', { sourceId: 'nas1', path: 'Housepit', commandId: 'cmd-1' });
  assert.deepEqual(done, { ok: true, path: 'Housepit', entries: [
    { name: '1998', relativePath: 'Housepit/1998', kind: 'dir' },
    { name: 'a.JPG', relativePath: 'Housepit/a.JPG', kind: 'file', mediaType: 'image' },
    { name: 'b.mov', relativePath: 'Housepit/b.mov', kind: 'file', mediaType: 'video' },
    { name: 'c.txt', relativePath: 'Housepit/c.txt', kind: 'file' },
  ] });
  await assert.rejects(() => handleNasAction(deps, 'nas-browse', { sourceId: 'nope', path: '.' }), { status: 404 });
});

test('card: nas-stage approves then queues; refuses never-public / client-approval', async () => {
  const { db, deps } = setup();
  await seedWorkers(db);
  await ingestNasResults(deps, { sourceId: 'nas1', items: [item()] });
  const id = nasPackageId(SHA);
  const r = await handleNasAction(deps, 'nas-stage', { id }, { email: 'me@x.com' });
  assert.equal(r.ok, true);
  const c = db.cols.get('archive_commands').get(r.commandId);
  assert.deepEqual({ t: c.type, p: c.packageId, s: c.sha256, r: c.relativePath, src: c.sourceId }, { t: 'STAGE_FOR_PUBLISH', p: id, s: SHA, r: 'Housepit/1998/flyer.jpg', src: 'nas1' });
  assert.equal(pkgs(db).get(id).approval.state, 'approved'); assert.equal(pkgs(db).get(id).approval.by, 'me@x.com');
  pkgs(db).set(id, { ...pkgs(db).get(id), rights: 'never-public' });
  await assert.rejects(() => handleNasAction(deps, 'nas-stage', { id }, {}), { status: 403 });
  pkgs(db).set(id, { ...pkgs(db).get(id), rights: 'client-approval-needed' });
  await assert.rejects(() => handleNasAction(deps, 'nas-stage', { id }, {}), { status: 403 });
  await assert.rejects(() => handleNasAction(deps, 'nas-stage', { id: 'missing' }, {}), { status: 404 });
});

test('PATCH hook: STAGE COMPLETE writes assetRefs + staged; other types and bad paths are no-ops', async () => {
  const { db, deps } = setup();
  await ingestNasResults(deps, { sourceId: 'nas1', items: [item()] });
  const id = nasPackageId(SHA);
  const path = `publish-staging/nas/${id}/${'a'.repeat(16)}.jpg`;
  assert.equal(await applyStageComplete(deps, { command: { type: 'ANALYZE_FACETS', packageId: id }, result: { storagePath: path } }), null);
  assert.equal(await applyStageComplete(deps, { command: { type: 'STAGE_FOR_PUBLISH', packageId: id }, result: { storagePath: 'elsewhere/x.jpg' } }), null);
  assert.deepEqual(pkgs(db).get(id).assetRefs, []);
  await applyStageComplete(deps, { command: { type: 'STAGE_FOR_PUBLISH', packageId: id }, result: { storagePath: path } });
  await applyStageComplete(deps, { command: { type: 'STAGE_FOR_PUBLISH', packageId: id }, result: { storagePath: path } });
  const p = pkgs(db).get(id);
  assert.deepEqual(p.assetRefs, [path]); assert.equal(p.staged.storagePath, path); assert.equal(p.mediaState, 'still');
});

test('results: event-date facets are carried through, strictly sanitized, and never derived from capturedAt', async () => {
  const { db, deps } = setup();
  const facets = {
    eventDate: '2018-11-15', eventMonthDay: '11-15', eventYear: 2018, eventYearSource: 'weekday',
    eventYearCandidates: [2018, 2012, 2018, 'x', 1700], eventDateRaw: '  THURSDAY   11/15 ',
    eventDates: [
      { monthDay: '11-15', year: 2018, yearSource: 'weekday', raw: 'THURSDAY 11/15', weekday: 'Thursday' },
      { monthDay: '13-40', year: 2018 }, { monthDay: '02-29', year: null, yearSource: 'printed' },
    ],
  };
  await ingestNasResults(deps, { sourceId: 's1', items: [item({ capturedAt: '2003-05-05T00:00:00Z', facets })] });
  const f = pkgs(db).get(nasPackageId(SHA)).facets;
  assert.equal(f.eventDate, '2018-11-15'); assert.equal(f.eventMonthDay, '11-15'); assert.equal(f.eventYear, 2018);
  assert.equal(f.eventYearSource, 'weekday'); assert.deepEqual(f.eventYearCandidates, [2012, 2018]);
  assert.equal(f.eventDateRaw, 'THURSDAY 11/15');
  assert.deepEqual(f.eventDates.map((d) => [d.monthDay, d.year, d.yearSource]), [['11-15', 2018, 'weekday'], ['02-29', null, null]]);
});

test('results: invalid event-date facets are dropped; no capturedAt fallback', async () => {
  const { db, deps } = setup();
  const facets = { eventDate: '2018-02-30', eventMonthDay: '2-3', eventYear: 'soon', eventYearSource: 'guess', eventYearCandidates: 'no', eventDates: 'no' };
  await ingestNasResults(deps, { sourceId: 's1', items: [item({ capturedAt: '2003-05-05T00:00:00Z', facets })] });
  const f = pkgs(db).get(nasPackageId(SHA)).facets;
  for (const k of ['eventDate', 'eventMonthDay', 'eventYear', 'eventYearSource', 'eventYearCandidates', 'eventDateRaw', 'eventDates']) assert.equal(k in f, false, k);
});

test('results: ISO date contradicting the month-day is dropped', async () => {
  const { db, deps } = setup();
  await ingestNasResults(deps, { sourceId: 's1', items: [item({ facets: { eventDate: '2018-11-15', eventMonthDay: '11-16' } })] });
  const f = pkgs(db).get(nasPackageId(SHA)).facets;
  assert.equal(f.eventDate, undefined); assert.equal(f.eventMonthDay, '11-16');
});
