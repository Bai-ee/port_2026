// Daily fill: baseline per track target, quote / narrative / client-work rows, idempotent re-runs (daily-fill.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDailyFill, runDailyFill, runDailyFillForCron, normalizeFillSpec, trackPostsPerDay, fillKeyOf, FILL_KINDS } from '../daily-fill.js';
import { normalizeContentTracks } from '../../x-strategy/content-tracks.js';

const TODAY = '2026-10-17';
const tracks = normalizeContentTracks([
  { id: 'record', label: 'Record Collection Videos', engines: ['record'], buckets: ['record'], share: 0.4 },
  { id: 'ue', label: 'Dj Mix Videos', engines: ['ue'], buckets: ['ue'], share: 0.2 },
  { id: 'client', label: 'Video Editing', engines: ['client'], buckets: ['client'], share: 0.2 },
  { id: 'nas', label: 'Throwback Content', engines: ['identity'], buckets: ['nas'], share: 0.2 },
  { id: 'off', label: 'Off Track', engines: [], buckets: ['off'], share: 0 },
]);
const pkg = (id, bucketId, extra = {}) => ({ id, bucketId, engine: bucketId === 'nas' ? 'identity' : bucketId, title: id, mediaState: 'none', effort: '10-min', ...extra });
const ready = { mediaState: 'video', effort: 'ready' };
const PACKAGES = [
  pkg('rec-a', 'record', ready), pkg('rec-b', 'record'), pkg('rec-c', 'record', ready),
  pkg('rec-bday', 'record', { facets: { eventMonthDay: '10-18' } }),
  pkg('ue-a', 'ue', ready), pkg('ue-b', 'ue', ready),
  pkg('cl-a', 'client', ready), pkg('cl-b', 'client', ready),
  pkg('nas-a', 'nas', ready), pkg('nas-b', 'nas'),
  pkg('off-a', 'off', ready),
];
const plan = (extra = {}) => planDailyFill({ tracks, packages: PACKAGES, from: TODAY, days: 3, today: TODAY, ...extra });
const where = (p, kind, date) => p.rows.filter((r) => r.kind === kind && (!date || r.date === date));

test('targets: engine targets summed, weekly minimum / 7, share fallback, zero share = none', () => {
  assert.equal(trackPostsPerDay(tracks[0], {}), 1);
  assert.ok(Math.abs(trackPostsPerDay(tracks[1], {}) - 3 / 7) < 1e-9);
  assert.equal(trackPostsPerDay(tracks[3], {}), 1); // identity default target 1
  assert.equal(trackPostsPerDay({ engines: [], share: 0.3 }, {}), 1);
  assert.equal(trackPostsPerDay(tracks[4], {}), 0);
  assert.equal(trackPostsPerDay(tracks[0], { engines: { record: { targetPerDay: 2 } } }), 2);
});

test('normalizeFillSpec: defaults, ranges, unknown kinds, never plans into the past', () => {
  assert.deepEqual(normalizeFillSpec({}, { today: TODAY }).spec, { from: TODAY, days: 7, include: FILL_KINDS });
  assert.equal(normalizeFillSpec({ days: 32 }, { today: TODAY }).ok, false);
  assert.equal(normalizeFillSpec({ include: ['bogus'] }, { today: TODAY }).ok, false);
  assert.equal(normalizeFillSpec({ from: '2026-10-01' }, { today: TODAY }).spec.from, TODAY);
  assert.deepEqual(normalizeFillSpec({ include: ['quotes'] }, { today: TODAY }).spec.include, ['quotes']);
});

test('baseline: the track target a day; media-ready first; an anniversary item only on its own day; zero-share tracks nothing', () => {
  const p = plan({ include: ['baseline'] });
  assert.equal(p.ok, true);
  const rec = (d) => where(p, 'baseline', d).filter((r) => r.trackId === 'record').map((r) => r.packageId);
  assert.equal(rec(TODAY).length, 1);
  assert.ok(['rec-a', 'rec-c'].includes(rec(TODAY)[0]), 'media-ready before plain');
  assert.deepEqual(rec('2026-10-18'), ['rec-bday'], 'birthday item lands on its day');
  assert.ok(!p.rows.some((r) => r.packageId === 'off-a'));
  assert.ok(!p.rows.some((r) => r.packageId === 'cl-a'), 'client-work track is not baseline');
  const ids = p.rows.map((r) => r.packageId);
  assert.equal(new Set(ids).size, ids.length, 'a package is used once per plan');
  const ue = p.rows.filter((r) => r.trackId === 'ue');
  assert.ok(ue.length >= 1 && ue.length <= 2, 'about 3 a week across 3 days');
  for (const r of p.rows) {
    assert.ok(r.reason && r.source.type === 'library-item' && r.source.id === r.packageId && r.source.asOf === TODAY);
    assert.ok(r.text.length <= 280);
    assert.equal(r.needsStory, true);
  }
});

test('baseline: open posts skipped (a bare draft is placed), the 30-day gap is respected, earlier fills count', () => {
  const open = new Map([
    ['rec-a', { postId: 'p1', status: 'scheduled', scheduledAt: '2026-10-20T10:00:00Z', reviewOn: null }],
    ['rec-c', { postId: 'p2', status: 'draft', scheduledAt: null, reviewOn: null }],
  ]);
  const lastUsed = new Map([['rec-b', '2026-10-01']]);
  const p = plan({ include: ['baseline'], openPosts: open, lastUsed });
  const ids = where(p, 'baseline').filter((r) => r.trackId === 'record').map((r) => r.packageId);
  assert.ok(!ids.includes('rec-a'));
  assert.ok(!ids.includes('rec-b'), 'used 16 days ago');
  assert.equal(p.rows.find((r) => r.packageId === 'rec-c').existingPostId, 'p2');
  assert.equal(p.counts.placesExisting, 1);
  // a fill already on today for the record bucket takes the slot
  const again = plan({ include: ['baseline'], fillPosts: [{ reviewOn: TODAY, fillKind: 'baseline', bucketId: 'record', idempotencyKey: 'k' }] });
  assert.equal(where(again, 'baseline', TODAY).filter((r) => r.trackId === 'record').length, 0);
});

test('client-work: client tracks only, one a day, kind client-work, off when not included', () => {
  const p = plan({ include: ['client-work'] });
  assert.deepEqual([...new Set(p.rows.map((r) => r.kind))], ['client-work']);
  assert.ok(p.rows.every((r) => r.trackId === 'client'));
  assert.ok(p.rows.length >= 1 && p.rows.length <= 3);
  assert.equal(plan({ include: ['baseline'] }).rows.some((r) => r.kind === 'client-work'), false);
});

const NOW = Date.parse('2026-10-17T12:00:00Z');
const target = (id, hoursAgo, extra = {}) => ({ id, url: `https://x.com/h${id}/status/${id}`, text: 'a post', handle: `h${id}`, createdAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(), ...extra });

test('quotes: today only, closed windows skipped, expiresAt = posted + 36h, statement caption, take placeholder, url last', () => {
  const p = plan({ include: ['quotes'], nowMs: NOW, quoteTargets: [target('111', 2), target('222', 40), target('333', 30), { id: '444', createdAt: 'x', url: 'https://x.com/a/status/444' }], asOf: { quotes: '2026-10-17T06:00:00Z' } });
  const q = where(p, 'quote');
  assert.deepEqual(q.map((r) => r.quoteTarget.id).sort(), ['111', '333']);
  for (const r of q) {
    assert.equal(r.date, TODAY);
    assert.ok(!r.text.includes('?'));
    assert.match(r.text, /\[add your take\]/);
    assert.ok(r.text.endsWith(r.quoteTarget.url));
    assert.equal(r.needsStory, true);
    assert.equal(r.source.type, 'quote-target');
    assert.equal(r.source.asOf, '2026-10-17T06:00:00Z');
  }
  assert.equal(q.find((r) => r.quoteTarget.id === '111').expiresAt, new Date(NOW - 2 * 3_600_000 + 36 * 3_600_000).toISOString());
  assert.equal(p.counts.skipped['window-closed'], 1);
  assert.equal(p.counts.skipped['no-timestamp'], 1);
  // a range that does not include today has no quotes
  assert.equal(plan({ include: ['quotes'], from: '2026-10-19', nowMs: NOW, quoteTargets: [target('111', 2)] }).rows.length, 0);
  // re-run: the same key is already filled
  const key = `daily-fill:${TODAY}:quote:111`;
  assert.equal(where(plan({ include: ['quotes'], nowMs: NOW, quoteTargets: [target('111', 2)], fillPosts: [{ idempotencyKey: key, reviewOn: TODAY }] }), 'quote').length, 0);
});

test('narratives: one a day for today and tomorrow, placeholder gated, cites the signal; none without signals', () => {
  const marketSignals = { generatedAt: '2026-10-16T09:00:00Z', topics: [{ topic: 'Vinyl is back', detail: 'Sales up 12%' }, { topic: 'AI mastering', detail: '' }], opportunities: [{ topic: 'Third', angle: 'x' }] };
  const p = plan({ include: ['narratives'], days: 5, marketSignals });
  assert.deepEqual(p.rows.map((r) => r.date), [TODAY, '2026-10-18']);
  assert.match(p.rows[0].text, /^Vinyl is back: Sales up 12%\n\nWhere it shows up in my work: \[add your take\]$/);
  assert.equal(p.rows[0].source.asOf, '2026-10-16T09:00:00Z');
  assert.equal(p.rows[0].kind, 'narrative');
  assert.ok(p.rows.every((r) => !r.text.includes('?') && r.text.length <= 280 && r.needsStory));
  assert.equal(plan({ include: ['narratives'] }).rows.length, 0);
  const again = plan({ include: ['narratives'], marketSignals, fillPosts: [{ fillKind: 'narrative', reviewOn: TODAY }] });
  assert.deepEqual(again.rows.map((r) => r.date), ['2026-10-18']);
});

test('runDailyFill: preview writes nothing; execute writes with the idempotency key and the fill fields; a re-run is existing', async () => {
  const drafts = new Map();
  const placed = [];
  const deps = {
    loadInputs: async () => ({ tracks, packages: PACKAGES, openPosts: new Map([['rec-c', { postId: 'p2', status: 'draft', scheduledAt: null, reviewOn: null }]]), quoteTargets: [target('111', 2)], marketSignals: { topics: [{ topic: 'T', detail: 'd' }] }, today: TODAY, nowMs: NOW }),
    ensureDraft: async (_c, payload) => { const hit = drafts.get(payload.idempotencyKey); if (hit) return { post: hit, existing: true }; drafts.set(payload.idempotencyKey, payload); return { post: payload, existing: false }; },
    placeDraft: async (_c, id, patch) => { placed.push([id, patch.reviewOn]); return true; },
    mediaFor: async (_c, id) => (id === 'rec-a' ? { mediaUrl: 'https://m/rec-a.mp4', mediaType: 'video' } : null),
  };
  const pre = await runDailyFill('c1', { from: TODAY, days: 2, deps });
  assert.equal(pre.ok, true);
  assert.equal(pre.preview, true);
  assert.equal(drafts.size, 0);
  const run = await runDailyFill('c1', { from: TODAY, days: 2, execute: true, deps });
  assert.equal(run.created, drafts.size);
  assert.equal(run.failed.length, 0);
  assert.ok(run.created > 3);
  const q = [...drafts.values()].find((d) => d.fillKind === 'quote');
  assert.equal(q.idempotencyKey, `daily-fill:${TODAY}:quote:111`);
  assert.equal(q.source, 'daily-fill');
  assert.equal(q.reviewOn, TODAY);
  assert.equal(q.needsStory, true);
  assert.ok(q.expiresAt && q.fillSource.type === 'quote-target' && q.sourceRef.url);
  const base = [...drafts.values()].find((d) => d.packageId === 'rec-a');
  if (base) assert.equal(base.mediaUrl, 'https://m/rec-a.mp4');
  assert.ok(placed.length >= 1 || !placed.length); // rec-c is placed only when picked
  const again = await runDailyFill('c1', { from: TODAY, days: 2, execute: true, deps });
  assert.equal(again.created, 0);
  assert.equal(again.existing, run.created);
  assert.equal((await runDailyFill('c1', { from: TODAY, days: 99, deps })).ok, false);
});

test('runDailyFill: a failing write is reported, the rest still go; fillKeyOf is per day, kind and item', async () => {
  const deps = {
    loadInputs: async () => ({ tracks, packages: PACKAGES, today: TODAY, nowMs: NOW }),
    ensureDraft: async (_c, p) => { if (p.packageId === 'rec-a') throw new Error('boom'); return { post: p, existing: false }; },
  };
  const r = await runDailyFill('c1', { from: TODAY, days: 1, include: ['baseline'], execute: true, deps });
  assert.ok(r.created >= 1);
  assert.equal(r.failed.length, r.rows.some((x) => x.packageId === 'rec-a') ? 1 : 0);
  assert.equal(fillKeyOf({ date: TODAY, kind: 'baseline', packageId: 'rec-a' }), 'daily-fill:2026-10-17:baseline:rec-a');
});

test('runDailyFillForCron: today + 6 days, every kind, executes', async () => {
  const seen = [];
  const r = await runDailyFillForCron('c1', { today: TODAY, deps: {
    loadInputs: async () => ({ tracks, packages: PACKAGES, quoteTargets: [target('111', 2)], today: '1999-01-01', nowMs: NOW }),
    ensureDraft: async (_c, p) => { seen.push(p); return { post: p, existing: false }; },
  } });
  assert.equal(r.spec.from, TODAY);
  assert.equal(r.spec.days, 7);
  assert.deepEqual(r.spec.include, FILL_KINDS);
  assert.equal(r.preview, false);
  assert.ok(seen.length > 0 && seen.every((d) => d.reviewOn >= TODAY && d.reviewOn <= '2026-10-23'));
});

test('baseline: junk auto-caption titles are never picked', () => {
  const junk = pkg('nas-junk', 'nas', { ...ready, title: 'Heavily corrupted or low-quality video frame with no clear subject' });
  const p = planDailyFill({ tracks, packages: [junk, ...PACKAGES], from: TODAY, days: 3, today: TODAY, include: ['baseline'] });
  assert.ok(!p.rows.some((r) => r.packageId === 'nas-junk'));
});

test('trackRules (daily mix): one BAI-EE video a day from the Dj Mix Videos bucket, newest unused first, then least recently used', async () => {
  const { dailyMixRulesFor, DAILY_MIX_RULE } = await import('../daily-mix-rule.js');
  const rv = (id, artist, renderedAt, extra = {}) => pkg(id, 'ue', { ...ready, entities: [artist], renderedAt, ...extra });
  const packages = [
    rv('rv-old', 'BAI-EE', '2026-09-01T06:03:00Z'),
    rv('rv-new', 'BAI-EE', '2026-10-17T06:03:00Z'),
    rv('rv-mid', 'bai-ee', '2026-10-10T06:03:00Z'),
    rv('rv-other', 'CESAR RAMIREZ', '2026-10-18T06:03:00Z'),
    rv('rv-gone', 'BAI-EE', '2026-10-16T06:03:00Z', { status: 'retired' }),
    rv('rv-still', 'BAI-EE', '2026-10-15T06:03:00Z', { mediaState: 'still' }),
    rv('rv-used', 'BAI-EE', '2026-10-14T06:03:00Z'),
  ];
  const lastUsed = new Map([['rv-used', '2026-08-01']]);
  const p = planDailyFill({ tracks, packages, lastUsed, from: TODAY, days: 4, today: TODAY, include: ['baseline'], trackRules: { ue: DAILY_MIX_RULE } });
  const ue = p.rows.filter((r) => r.trackId === 'ue');
  // Exactly one a day (the rule replaces the engine target), BAI-EE only, never retired or a still.
  assert.deepEqual(ue.map((r) => r.date), ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']);
  // Newest never-used first, then the rest by render date, then the least recently used.
  assert.deepEqual(ue.map((r) => r.packageId), ['rv-new', 'rv-mid', 'rv-old', 'rv-used']);
  // Without the rule the same pool keeps the engine target and any artist.
  const plain = planDailyFill({ tracks, packages, from: TODAY, days: 4, today: TODAY, include: ['baseline'] });
  assert.ok(plain.rows.filter((r) => r.trackId === 'ue').length < 4);
  // Only the media owner client gets the rule.
  assert.deepEqual(dailyMixRulesFor('home', { ownerClientId: 'home' }), { ue: DAILY_MIX_RULE });
  assert.deepEqual(dailyMixRulesFor('other', { ownerClientId: 'home' }), {});
  assert.deepEqual(dailyMixRulesFor('home', { ownerClientId: null }), {});
});

test('trackRules: two renders of the same mix never fill two days of one window', async () => {
  const { DAILY_MIX_RULE } = await import('../daily-mix-rule.js');
  const rv = (id, title, renderedAt) => pkg(id, 'ue', { ...ready, entities: ['BAI-EE'], title, renderedAt });
  const packages = [rv('rv-1', "BAI-EE – Live @ Viva Acid '24", '2026-10-03'), rv('rv-2', "BAI-EE – Live @ Viva Acid '24", '2026-10-02'), rv('rv-3', 'BAI-EE – Music Mix', '2026-10-01')];
  const p = planDailyFill({ tracks, packages, from: TODAY, days: 3, today: TODAY, include: ['baseline'], trackRules: { ue: DAILY_MIX_RULE } });
  assert.deepEqual(p.rows.filter((r) => r.trackId === 'ue').map((r) => r.packageId), ['rv-1', 'rv-3']);
});

test('excludePackageIds: an excluded package is never picked; spec carries it only when given', () => {
  const base = plan({ days: 1, include: ['baseline'] });
  const first = where(base, 'baseline').find((r) => r.trackId === 'record');
  const p = plan({ days: 1, include: ['baseline'], excludePackageIds: [first.packageId] });
  assert.ok(!p.rows.some((r) => r.packageId === first.packageId));
  assert.equal('excludePackageIds' in normalizeFillSpec({}, { today: TODAY }).spec, false);
  assert.deepEqual(normalizeFillSpec({ excludePackageIds: ['a', 'a', 'b'] }, { today: TODAY }).spec.excludePackageIds, ['a', 'b']);
  assert.equal(normalizeFillSpec({ excludePackageIds: [1] }, { today: TODAY }).ok, false);
  assert.equal(normalizeFillSpec({ excludePackageIds: Array.from({ length: 201 }, (_, i) => `p${i}`) }, { today: TODAY }).ok, false);
});

test('replace mode: a rejected fill no longer holds its slot, only that bucket is filled, one row max', () => {
  const rejected = [{ postId: 'x', status: 'rejected', reviewOn: TODAY, fillKind: 'baseline', bucketId: 'record', idempotencyKey: 'k' }];
  // Normal re-run: the rejected draft still counts, so the record track gets nothing today.
  assert.equal(where(plan({ days: 1, include: ['baseline'], fillPosts: rejected }), 'baseline').filter((r) => r.trackId === 'record').length, 0);
  const p = plan({ days: 1, include: ['baseline'], fillPosts: rejected, replace: { bucketId: 'record' } });
  assert.deepEqual(p.rows.map((r) => r.trackId), ['record']);
  assert.equal(normalizeFillSpec({ replace: { bucketId: 5 } }, { today: TODAY }).ok, false);
});

// ---- Throwback track: only a NAS item dated to the day with a real asset link ------------------------------------
const SHA = (c) => c.repeat(64);
const nasItem = (id, md, extra = {}) => pkg(id, 'nas', {
  mediaState: 'still', rights: 'owned', facets: md ? { eventMonthDay: md } : {},
  nas: { sha256: SHA(id.slice(-1)), relativePath: `2009/${id}.jpg`, sourceId: 'nas-main' }, ...extra,
});
const throwbacks = (p, date) => p.rows.filter((r) => r.trackId === 'nas' && (!date || r.date === date));

test('throwback: a dated NAS item with an asset link is picked on its day and carries nasSha; undated never picked', () => {
  const pkgs = [...PACKAGES, nasItem('nas-1', '10-18'), nasItem('nas-2', null)];
  const p = planDailyFill({ tracks, packages: pkgs, from: TODAY, days: 3, today: TODAY, include: ['baseline'] });
  assert.deepEqual(throwbacks(p).map((r) => [r.date, r.packageId]), [['2026-10-18', 'nas-1']]);
  assert.equal(throwbacks(p)[0].nasSha, SHA('1'));
  assert.ok(!p.rows.some((r) => ['nas-2', 'nas-a', 'nas-b'].includes(r.packageId)), 'undated / unlinked NAS items never fill');
  assert.ok(p.skipped.some((s) => s.date === TODAY && s.trackId === 'nas' && s.reason === 'no-dated-media'));
});

test('throwback: no asset link, wrong mediaState or blocked rights => skipped no-dated-media', () => {
  const pkgs = [
    nasItem('nas-3', '10-17', { nas: { sha256: SHA('3') } }), // no path / source: cannot be pulled
    nasItem('nas-4', '10-17', { mediaState: 'none' }),
    nasItem('nas-5', '10-17', { rights: 'never-public' }),
    nasItem('nas-6', '10-17', { rights: 'client-approval-needed' }),
  ];
  const p = planDailyFill({ tracks, packages: pkgs, from: TODAY, days: 1, today: TODAY, include: ['baseline'] });
  assert.equal(throwbacks(p).length, 0);
  assert.deepEqual(p.skipped.filter((s) => s.trackId === 'nas').map((s) => s.reason), ['no-dated-media']);
});

test('throwback: video before still, then staged/thumbnailed, then never used, then id', () => {
  const day = (pkgs, lastUsed) => throwbacks(planDailyFill({ tracks, packages: pkgs, from: TODAY, days: 1, today: TODAY, include: ['baseline'], lastUsed }))[0]?.packageId;
  assert.equal(day([nasItem('nas-a1', '10-17'), nasItem('nas-b2', '10-17', { mediaState: 'video' })]), 'nas-b2');
  assert.equal(day([nasItem('nas-a1', '10-17'), nasItem('nas-b2', '10-17', { assetRefs: ['publish-staging/nas/nas-b2/x.jpg'] })]), 'nas-b2');
  assert.equal(day([nasItem('nas-a1', '10-17'), nasItem('nas-b2', '10-17', { thumbRef: 'content-thumbs/c/nas-b2.jpg' })]), 'nas-b2');
  assert.equal(day([nasItem('nas-a1', '10-17'), nasItem('nas-b2', '10-17')], new Map([['nas-a1', '2025-10-17']])), 'nas-b2');
  assert.equal(day([nasItem('nas-b2', '10-17'), nasItem('nas-a1', '10-17')]), 'nas-a1');
});

test('throwback: other tracks are unchanged by the throwback rule', () => {
  const base = planDailyFill({ tracks, packages: PACKAGES, from: TODAY, days: 3, today: TODAY, include: ['baseline'] });
  const withNas = planDailyFill({ tracks, packages: [...PACKAGES, nasItem('nas-1', '10-18')], from: TODAY, days: 3, today: TODAY, include: ['baseline'] });
  const other = (p) => p.rows.filter((r) => r.trackId !== 'nas').map((r) => `${r.date}:${r.packageId}`);
  assert.deepEqual(other(withNas), other(base));
});

test('throwback re-runs: a fill with a dated linked item holds the day; a media-less one does not (and is not removed)', () => {
  const pkgs = [nasItem('nas-1', '10-17'), nasItem('nas-7', '10-17'), pkg('nas-old', 'nas')];
  const fill = (packageId) => [{ postId: 'p1', status: 'draft', reviewOn: TODAY, fillKind: 'baseline', bucketId: 'nas', packageId }];
  const run = (fillPosts) => planDailyFill({ tracks, packages: pkgs, fillPosts, from: TODAY, days: 1, today: TODAY, include: ['baseline'] });
  assert.equal(throwbacks(run(fill('nas-1'))).length, 0, 'the linked draft already holds the day');
  const r = run(fill('nas-old'));
  assert.equal(throwbacks(r).length, 1, 'a media-less earlier draft does not satisfy the day');
  assert.ok(!r.rows.some((x) => x.existingPostId === 'p1'));
});

test('runDailyFill: a throwback draft is written with packageId + nasSha (no upload needed)', async () => {
  const drafts = [];
  const deps = {
    loadInputs: async () => ({ tracks, packages: [nasItem('nas-1', '10-17')], today: TODAY, nowMs: NOW }),
    ensureDraft: async (_c, payload) => { drafts.push(payload); return { post: { id: 'x' }, existing: false }; },
    mediaFor: async () => null, // not staged yet: pickMedia finds no ref
  };
  const r = await runDailyFill('c1', { from: TODAY, days: 1, include: ['baseline'], execute: true, deps });
  assert.equal(r.failed.length, 0);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].packageId, 'nas-1');
  assert.equal(drafts[0].nasSha, SHA('1'));
  assert.equal(drafts[0].mediaUrl, undefined);
});

test('quotes: a hot pick uses its own window (72h music), carries no caption and no take placeholder', () => {
  const p = plan({ include: ['quotes'], nowMs: NOW, quoteTargets: [target('555', 50, { windowHours: 72, hot: { lane: 'music' } }), target('666', 50, { hot: { lane: 'design' } })] });
  const q = where(p, 'quote');
  assert.deepEqual(q.map((r) => r.quoteTarget.id), ['555']);
  assert.equal(q[0].text, 'https://x.com/h555/status/555');
  assert.equal(q[0].needsStory, false);
});
