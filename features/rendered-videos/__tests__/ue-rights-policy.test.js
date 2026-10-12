import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyUeRightsPolicy } from '../ue-rights-policy.js';

const rv = (id, o = {}) => ({
  id, source: { kind: 'rendered-video', externalId: id }, title: 'ACIDMAN – Mix', entities: ['ACIDMAN'], status: 'idea',
  rights: 'never-public', approval: { state: 'needed' }, tags: ['rendered-video', 'rights:third-party-unconfirmed'], ...o,
});

function fake(rows) {
  const db = new Map(rows.map((r) => [r.id, structuredClone(r)]));
  const writes = [];
  return {
    db, writes,
    listPackages: async () => [...db.values()].map((r) => structuredClone(r)),
    applyPatches: async (items) => { for (const { id, patch } of items) { writes.push(id); db.set(id, { ...db.get(id), ...patch }); } },
  };
}

const rows = () => [
  rv('rv-1'),
  rv('rv-2', { title: 'BAI-EE – Night', entities: ['BAI-EE'], rights: 'owned', approval: { state: 'none' }, tags: ['rendered-video'] }),
  rv('rv-3', { rightsSetBy: 'human', rights: 'never-public' }),
  rv('rv-4', { status: 'retired' }),
  rv('rv-5', { approval: { state: 'approved', by: 'me' } }),
  { id: 'ev-x', source: { kind: 'discogs' }, rights: 'owned' },
];

test('dry run (default) reports counts and writes nothing', async () => {
  const s = fake(rows());
  const c = await applyUeRightsPolicy(s);
  assert.equal(c.dryRun, true);
  assert.equal(s.writes.length, 0);
  assert.deepEqual([c.scanned, c.cleared, c.owned, c.skippedHuman, c.skippedRetired, c.alreadyOnPolicy], [5, 2, 0, 1, 1, 1]);
  assert.equal(JSON.stringify(c).includes('rv-'), false, 'counts only, no ids');
});

test('--write applies D1, respects human rights/retired/approved, ignores non-rendered rows', async () => {
  const s = fake(rows());
  const c = await applyUeRightsPolicy(s, { write: true });
  assert.equal(c.written, 2);
  const r1 = s.db.get('rv-1');
  assert.deepEqual([r1.rights, r1.approval.state], ['cleared', 'none']);
  assert.deepEqual(r1.rightsSource, { by: 'owner', policy: 'ue-hosted-cleared', at: '2026-10-11' });
  assert.ok(!r1.tags.includes('rights:third-party-unconfirmed') && r1.tags.includes('rights:ue-hosted-cleared'));
  assert.equal(s.db.get('rv-3').rights, 'never-public');
  assert.equal(s.db.get('rv-4').rights, 'never-public');
  assert.equal(s.db.get('rv-5').approval.state, 'approved');
  assert.equal(s.db.get('rv-5').rights, 'cleared');
  assert.equal(s.db.get('ev-x').rights, 'owned');
});

test('BAI-EE mix with legacy owned->never-public drift is set to owned', async () => {
  const s = fake([rv('rv-9', { title: 'BAI-EE – X', entities: ['BAI-EE'] })]);
  await applyUeRightsPolicy(s, { write: true });
  assert.deepEqual([s.db.get('rv-9').rights, s.db.get('rv-9').approval.state, s.db.get('rv-9').rightsSource], ['owned', 'none', undefined]);
});

test('idempotent: second --write changes nothing', async () => {
  const s = fake(rows());
  await applyUeRightsPolicy(s, { write: true });
  const before = JSON.stringify([...s.db.entries()]);
  s.writes.length = 0;
  const c = await applyUeRightsPolicy(s, { write: true });
  assert.equal(c.wouldChange, 0);
  assert.equal(s.writes.length, 0);
  assert.equal(JSON.stringify([...s.db.entries()]), before);
});
