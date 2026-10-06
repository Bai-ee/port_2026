import test from 'node:test';
import assert from 'node:assert/strict';
import { planRecordSchedule, zonedTimeToUtcMs, isRecordReady, scheduleReadyRecords } from '../scheduler.js';
import { buildContentPackage, buildDraftPayload, buildDraftMediaPatch } from '../draft-builder.js';
import { validatePackage } from '../../x-content-inventory/schema.js';

const ready = (id, createdAt, extra = {}) => ({
  id, createdAt, source: 'discogs-ingest', status: 'draft', needsStory: false, sourceRef: { releaseId: Number(id.replace(/\D/g, '')) || 1 },
  content: 'Artist - Title\nLabel · CAT · 1995\nI bought this at Gramaphone.', mediaUrl: 'https://x/v.mp4', ...extra,
});
const other = (id, iso, extra = {}) => ({ id, source: 'manual', engine: 'identity', status: 'scheduled', scheduledAt: iso, ...extra });
// 2026-10-05 12:00 UTC = 07:00 CDT Monday
const NOW = new Date('2026-10-05T12:00:00Z');
const plan = (o) => planRecordSchedule({ now: NOW, ...o });
const iso = (r) => r.scheduled.map((s) => s.scheduledAt);

test('prefers 09:00 CT (CDT offset in October) and explains why', () => {
  const r = plan({ posts: [ready('a1', '1')] });
  assert.deepEqual(iso(r), ['2026-10-05T14:00:00.000Z']);
  assert.match(r.scheduled[0].reason, /owner preferred slot/);
});

test('DST: 09:00 CT is 15:00Z in winter and 14:00Z in summer', () => {
  assert.equal(new Date(zonedTimeToUtcMs(2026, 12, 1, 9, 0, 'America/Chicago')).toISOString(), '2026-12-01T15:00:00.000Z');
  assert.equal(new Date(zonedTimeToUtcMs(2026, 3, 8, 9, 0, 'America/Chicago')).toISOString(), '2026-03-08T14:00:00.000Z');
});

test('daily cap: one record per day by default, oldest first', () => {
  const r = plan({ posts: [ready('b2', '2'), ready('a1', '1'), ready('c3', '3')] });
  assert.deepEqual(r.scheduled.map((p) => p.postId), ['a1', 'b2', 'c3']);
  assert.deepEqual(iso(r).map((t) => t.slice(0, 10)), ['2026-10-05', '2026-10-06', '2026-10-07']);
});

test('perDay 2 uses 09:00 and 19:00 when share allows (other posts raise the denominator)', () => {
  const r = plan({ posts: [ready('a1', '1'), ready('b2', '2'), ...['11:00', '16:30', '19:00', '21:30'].map((h, i) => other(`o${i}`, `2026-10-05T${h}:00Z`))], config: { perDay: 2 } });
  assert.deepEqual(iso(r).slice(0, 2), ['2026-10-05T14:00:00.000Z', '2026-10-06T00:00:00.000Z']);
});

test('perDay is clamped to the record engine max (2)', () => {
  const r = plan({ posts: [1, 2, 3].map((n) => ready(`p${n}`, String(n))), config: { perDay: 9, engineConfig: { engines: { record: { maxSharePct: 100 } } } } });
  assert.equal(iso(r).filter((t) => t.startsWith('2026-10-05') || t.startsWith('2026-10-06T0')).length, 2);
});

test('share cap: a 2nd record is refused when it would exceed 40% of the day', () => {
  // existing: 1 record + 1 other; adding a record => 2 of max(3,4)=4 => 50% > 40
  const posts = [
    ready('a1', '1'),
    { id: 'r0', source: 'discogs-ingest', engine: 'record', status: 'scheduled', scheduledAt: '2026-10-05T14:00:00Z' },
    other('x', '2026-10-05T18:00:00Z'),
  ];
  const r = plan({ posts, config: { perDay: 2 } });
  assert.ok(r.scheduled[0].scheduledAt.startsWith('2026-10-06'));
});

test('spacing: >= 120 min from a scheduled post of ANY engine; 19:00 CT preferred slot used when 09:00 is blocked', () => {
  const r = plan({ posts: [other('x', '2026-10-05T14:30:00Z', { engine: 'client' }), ready('a1', '1')] });
  assert.equal(iso(r)[0], '2026-10-06T00:00:00.000Z');
});

test('fallback: both preferred slots blocked -> nearest valid time inside 08:00-21:00 CT', () => {
  const posts = [other('x', '2026-10-05T14:30:00Z'), other('y', '2026-10-06T00:30:00Z'), ready('a1', '1')];
  const r = plan({ posts });
  const t = Date.parse(iso(r)[0]);
  for (const o of posts.slice(0, 2)) assert.ok(Math.abs(t - Date.parse(o.scheduledAt)) >= 120 * 60_000);
  assert.equal(iso(r)[0], '2026-10-05T22:30:00.000Z'); // 17:30 CT
  assert.match(r.scheduled[0].reason, /nearest valid time/);
});

test('spacing counts approved, posting and posted posts too', () => {
  for (const status of ['approved', 'posting', 'posted']) {
    const o = other('x', '2026-10-05T14:10:00Z', { status, postedAt: '2026-10-05T14:10:00Z' });
    const r = plan({ posts: [o, ready('a1', '1')] });
    assert.ok(Math.abs(Date.parse(iso(r)[0]) - Date.parse(o.scheduledAt)) >= 120 * 60_000, status);
  }
});

test('window: every placement is inside 08:00-21:00 CT', () => {
  const posts = Array.from({ length: 12 }, (_, i) => ready(`r${i + 1}`, String(i + 1)));
  for (const t of iso(plan({ posts, config: { perDay: 2, engineConfig: { engines: { record: { maxSharePct: 100 } } } } }))) {
    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));
    assert.ok(h >= 8 && h <= 21, t);
  }
});

test('past times are skipped', () => {
  const r = planRecordSchedule({ posts: [ready('a1', '1')], now: new Date('2026-10-05T14:10:00Z') });
  assert.equal(iso(r)[0], '2026-10-06T00:00:00.000Z'); // 19:00 CT is the nearest preferred
});

const pk = (id, entities, extra = {}) => ({ id, engine: 'record', entities, ...extra });

test('entity cooldown: same label within 30 days is refused, different label placed', () => {
  const posts = [
    { id: 'old', source: 'discogs-ingest', engine: 'record', packageId: 'discogs-9', status: 'posted', postedAt: '2026-10-01T14:00:00Z', scheduledAt: '2026-10-01T14:00:00Z' },
    ready('a1', '1'), ready('b2', '2'),
  ];
  const packages = { 'discogs-9': pk('discogs-9', ['aphex twin', 'warp records']), 'discogs-1': pk('discogs-1', ['Someone Else', ' WARP  Records ']), 'discogs-2': pk('discogs-2', ['other', 'other label']) };
  const r = plan({ posts, packages });
  assert.deepEqual(r.scheduled.map((p) => p.postId), ['b2']);
  assert.equal(r.skipped[0].postId, 'a1');
  assert.match(r.skipped[0].reasons.join(' '), /entity cooldown/);
});

test('entity cooldown also covers records scheduled in the same batch', () => {
  const packages = { 'discogs-1': pk('discogs-1', ['a', 'warp']), 'discogs-2': pk('discogs-2', ['b', 'warp']) };
  const r = plan({ posts: [ready('a1', '1'), ready('b2', '2')], packages });
  assert.deepEqual(r.scheduled.map((p) => p.postId), ['a1']);
  assert.equal(r.skipped.length, 1);
});

test('needs-approval package is skipped until approved', () => {
  const packages = { 'discogs-1': { id: 'discogs-1', rights: 'client-approval-needed', entities: [] } };
  const r = plan({ posts: [ready('a1', '1')], packages });
  assert.equal(r.scheduled.length, 0);
  assert.match(r.skipped[0].reasons[0], /needs approval/);
  const r2 = plan({ posts: [ready('a1', '1', { status: 'approved', reviewedAt: 'x' })], packages });
  assert.equal(r2.scheduled.length, 1);
});

test('placeholder / needsStory / no media are never scheduled', () => {
  const posts = [
    ready('p1', '1', { content: 'x\n[add your memory]' }), ready('n2', '2', { needsStory: true }), ready('m3', '3', { mediaUrl: null }),
    ready('s5', '5', { status: 'scheduled', scheduledAt: '2030-01-01T00:00:00Z' }), ready('ok6', '6'),
  ];
  assert.deepEqual(posts.filter(isRecordReady).map((p) => p.id), ['ok6']);
  assert.deepEqual(plan({ posts }).scheduled.map((p) => p.postId), ['ok6']);
});

test('idempotent: re-running after scheduling adds nothing', async () => {
  const rows = [ready('a1', '1'), ready('b2', '2')];
  const updates = [];
  const deps = {
    readSocialQueue: async () => rows,
    getPackage: async () => null,
    updateSocialPost: async (_c, id, patch) => { updates.push(id); Object.assign(rows.find((r) => r.id === id), { status: 'scheduled', ...patch }); },
  };
  const first = await scheduleReadyRecords({ clientId: 'c', now: NOW, deps });
  assert.equal(first.scheduled.length, 2);
  const second = await scheduleReadyRecords({ clientId: 'c', now: NOW, deps });
  assert.equal(second.plan.length, 0);
  assert.equal(updates.length, 2);
  const dry = await scheduleReadyRecords({ clientId: 'c', now: NOW, dryRun: true, deps: { ...deps, readSocialQueue: async () => [ready('z9', '9')] } });
  assert.equal(dry.plan.length, 1); assert.equal(dry.scheduled.length, 0);
});

const body = {
  releaseId: 74379, discogsUrl: 'https://www.discogs.com/release/74379', artist: ' Aphex  Twin ', title: 'Windowlicker', label: 'Warp Records',
  catno: 'WAP 105', year: '1999', videoStoragePath: 'v', imageStoragePath: 'i', variants: {}, files: { images: [], videos: [] }, clip: null,
};

test('fields stamped on package and draft', () => {
  const pkg = buildContentPackage(body);
  assert.equal(pkg.engine, 'record'); assert.equal(pkg.priority, 'evergreen'); assert.equal(pkg.format, 'video'); assert.equal(pkg.lastPostedAt, null);
  assert.deepEqual(pkg.source, { kind: 'discogs', externalId: '74379', url: body.discogsUrl });
  assert.deepEqual(pkg.entities, ['aphex twin', 'warp records']);
  assert.equal(validatePackage(pkg).ok, true);
  assert.equal(buildContentPackage(body, { lastPostedAt: '2026-01-01T00:00:00Z' }).lastPostedAt, '2026-01-01T00:00:00Z');
  const d = buildDraftPayload(body, { videoUrl: 'V', imageUrl: 'I' });
  assert.equal(d.packageId, 'discogs-74379'); assert.equal(d.engine, 'record');
  assert.equal(buildDraftMediaPatch(body, { videoUrl: 'V', imageUrl: 'I' }).packageId, 'discogs-74379');
});
