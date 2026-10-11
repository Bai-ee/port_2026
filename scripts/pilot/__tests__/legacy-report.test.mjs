import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLegacyRows } from '../legacy-report.mjs';

const now = Date.parse('2026-10-11T18:00:00Z');
const iso = (m) => new Date(now + m * 60_000).toISOString();
const rules = (rows, packages = {}) => classifyLegacyRows(rows, { now, packages }).map((f) => `${f.postId}:${f.rule}`);
const base = { packageId: 'p', engine: 'x', content: 'hi' };

test('A reply row', () => {
  assert.ok(rules([{ ...base, id: 'a', status: 'scheduled', scheduledAt: iso(500), replyTo: { url: 'u' } }]).includes('a:A-reply-as-original'));
});
test('B never-public, rejected, expired', () => {
  const r = [{ ...base, id: 'n', status: 'queued', scheduledAt: iso(10), packageId: 'pn' }, { ...base, id: 'j', status: 'scheduled', scheduledAt: iso(900), packageId: 'pj' }, { ...base, id: 'e', status: 'scheduled', scheduledAt: iso(2000), expiresAt: iso(-5) }];
  const out = rules(r, { pn: { rights: 'never-public' }, pj: { approval: { state: 'rejected' } } });
  assert.ok(out.includes('n:B-package-never-public') && out.includes('j:B-package-rejected') && out.includes('e:B-expired'));
});
test('C duplicate package', () => {
  const out = rules([{ ...base, id: 'd1', status: 'scheduled', scheduledAt: iso(100) }, { ...base, id: 'd2', status: 'queued', scheduledAt: iso(1000) }]);
  assert.ok(out.includes('d1:C-duplicate-package') && out.includes('d2:C-duplicate-package'));
});
test('D too close and over cap', () => {
  const close = rules([{ ...base, packageId: 'x1', id: 'c1', status: 'scheduled', scheduledAt: iso(100) }, { ...base, packageId: 'x2', id: 'c2', status: 'scheduled', scheduledAt: iso(160) }]);
  assert.ok(close.includes('c2:D-too-close') && !close.includes('c1:D-too-close'));
  const rows = Array.from({ length: 8 }, (_, i) => ({ ...base, packageId: `k${i}`, id: `k${i}`, status: 'scheduled', scheduledAt: new Date(Date.parse('2026-10-20T14:00:00Z') + i * 130 * 60_000).toISOString() }));
  const cap = rules(rows);
  assert.ok(cap.includes('k6:D-over-daily-cap') && !cap.includes('k5:D-over-daily-cap'));
});
test('E stale schedule', () => {
  assert.ok(rules([{ ...base, id: 's', status: 'scheduled', scheduledAt: iso(-180) }]).includes('s:E-stale-schedule'));
  assert.ok(!rules([{ ...base, id: 's', status: 'scheduled', scheduledAt: iso(-60) }]).includes('s:E-stale-schedule'));
});
test('F ambiguous failures only', () => {
  const out = rules([{ ...base, id: 'f1', status: 'failed', errorClass: 'network-ambiguous' }, { ...base, id: 'f2', status: 'failed', errorClass: 'client-error' }]);
  assert.ok(out.includes('f1:F-failed-ambiguous') && !out.includes('f2:F-failed-ambiguous'));
});
test('G unreviewed needing approval', () => {
  const out = rules([{ ...base, id: 'g1', status: 'scheduled', scheduledAt: iso(100), packageId: 'pg' }, { ...base, id: 'g2', status: 'scheduled', scheduledAt: iso(1000), packageId: 'pg2', reviewedAt: 'x' }], { pg: { rights: 'client-approval-needed' }, pg2: { rights: 'client-approval-needed' } });
  assert.ok(out.includes('g1:G-unreviewed-needs-approval') && !out.includes('g2:G-unreviewed-needs-approval'));
});
test('H untagged is info, never delete', () => {
  const f = classifyLegacyRows([{ id: 'h', status: 'approved', content: 'x' }], { now });
  assert.equal(f[0].rule, 'H-untagged');
  assert.equal(f[0].action, 'info');
  assert.ok(f.every((x) => x.action !== 'delete'));
});
test('v2 rows and out-of-scope statuses are ignored; excerpt capped', () => {
  assert.deepEqual(rules([{ id: 'v', status: 'scheduled', lifecycleVersion: 2, scheduledAt: iso(-600), replyTo: { url: 'u' } }, { id: 'p', status: 'posted' }]), []);
  const f = classifyLegacyRows([{ id: 'l', status: 'approved', content: 'y'.repeat(300) }], { now });
  assert.equal(f[0].excerpt.length, 80);
});
