import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshnessLabel, refreshStatusView, handleResultText, groupCaveats, tierText, tierComparison,
  planChangesFromDraft, planDraftFromPlan, historyDiffSummary, handlesDirty, validateHandlesDraft,
  normalizeHandlesDraft, todayPlanLine, planErrorView, typeShareText, comparisonRows, draftTier,
  PLANNABLE_SLOT_TYPES, historyNewestFirst,
  proposalKindLabel, proposalPayloadPreview, proposalStatusText, chatErrorText, costFooterText,
} from '../ui-model.js';
import { DEFAULT_PLAN } from '../contracts.js';

const meta = (over) => ({ handle: 'a', source: 'bird', rowsMeta: { rowCount: 100 }, freshness: { pulledAt: '2026-10-09T00:00:00Z', ageDays: 2, stale: false }, ...over });

test('freshness wording covers fresh / today / stale / committed / none', () => {
  assert.equal(freshnessLabel(meta()), 'fresh 2d');
  assert.equal(freshnessLabel(meta({ freshness: { pulledAt: 'x', ageDays: 0, stale: false } })), 'fresh today');
  assert.equal(freshnessLabel(meta({ freshness: { pulledAt: 'x', ageDays: 9, stale: true } })), 'stale 9d — refresh');
  assert.equal(freshnessLabel(meta({ freshness: { pulledAt: null, ageDays: null, stale: true } })), 'committed data — refresh');
  assert.equal(freshnessLabel(meta({ source: 'none', rowsMeta: null })), 'needs refresh');
  assert.equal(freshnessLabel(meta({ rowsMeta: { rowCount: 0 } })), 'needs refresh');
  assert.equal(freshnessLabel(undefined), 'needs refresh');
});

test('refresh status: each status has plain words; queued hint only after repeated polls', () => {
  for (const s of ['queued', 'running', 'done', 'partial', 'rate-limited', 'bird-unavailable', 'failed']) {
    const v = refreshStatusView({ status: s });
    assert.ok(v.headline.length > 8, s);
    assert.equal(v.active, s === 'queued' || s === 'running');
  }
  assert.equal(refreshStatusView({ status: 'queued' }, { polls: 1 }).hint, null);
  assert.match(refreshStatusView({ status: 'queued' }, { polls: 3 }).hint, /Mac/);
  assert.equal(refreshStatusView({ status: 'done' }, { polls: 9 }).hint, null);
  assert.equal(refreshStatusView(null).active, false);
  assert.equal(refreshStatusView({ status: 'weird' }).headline, 'Refresh status: weird.');
});

test('refresh status lists per-handle results incl. errors', () => {
  const v = refreshStatusView({
    status: 'rate-limited', handles: ['a', 'b'],
    results: { a: { status: 'partial', added: 3, errorKind: 'rate-limited' }, b: { status: 'skipped' } },
  });
  assert.equal(v.tone, 'warn');
  assert.equal(v.lines[0], '@a: partial (rate-limited), 3 new rows kept');
  assert.equal(v.lines[1], '@b: skipped');
  assert.equal(handleResultText('c', undefined), '@c: waiting');
  assert.match(handleResultText('c', { status: 'failed', error: 'boom' }), /failed \(boom\)/);
  assert.match(refreshStatusView({ status: 'failed', handles: [], error: 'bad' }).lines[0], /bad/);
});

test('caveats group by handle and never drop any', () => {
  const cs = [
    { code: 'likes-only', handle: 'seb__design', message: 'm1' },
    { code: 'stale', handle: 'bai_ee', message: 'm2' },
    { code: 'few-rows', handle: 'seb__design', message: 'm3' },
    { code: 'quote-react-undervalued', message: 'm4' },
  ];
  const g = groupCaveats(cs);
  assert.deepEqual(g.map((x) => x.handle), ['seb__design', 'bai_ee', '']);
  assert.equal(g.flatMap((x) => x.items).length, cs.length);
  assert.equal(g[0].items[1].title, 'Few rows');
  assert.deepEqual(groupCaveats(null), []);
  assert.equal(groupCaveats([{ code: 'new-code', handle: 'X' }])[0].items[0].title, 'new-code');
});

test('tier text and comparison', () => {
  assert.equal(tierText({ tier: 2, authoredPerDay: 6, label: 'Ramp' }), 'Tier 2 · 6/day (Ramp)');
  assert.equal(tierText(3), 'Tier 3');
  assert.equal(tierText(null), '—');
  assert.match(tierComparison({ currentTier: 1, recommendedTier: { tier: 2, authoredPerDay: 6 } }), /Recommended next step: Tier 2/);
  assert.match(tierComparison({ currentTier: 2, recommendedTier: { tier: 2 } }), /matches/);
  assert.equal(tierComparison(null), '');
});

test('comparison rows and type shares', () => {
  assert.equal(typeShareText({ a: { share: 10 }, b: { share: 60.4 }, c: {} }), 'b 60% · a 10%');
  assert.equal(typeShareText({}), '—');
  const rows = comparisonRows({
    own: { handle: 'me', rows: 5, range: { from: '2026-01-01', to: '2026-02-01' }, cadence: { authoredPerActiveDay: 2.5 }, byType: {} },
    benchmarks: [{ handle: 'them', rows: 0, range: null, cadence: null, byType: {} }],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].perDay, 2.5);
  assert.equal(rows[1].perDay, null);
  assert.equal(rows[1].window, '—');
});

test('plan draft: unchanged -> no changes; changes only changed fields', () => {
  const plan = { ...DEFAULT_PLAN };
  const d = planDraftFromPlan(plan);
  assert.equal(planChangesFromDraft(plan, d).dirty, false);
  const r = planChangesFromDraft(plan, { ...d, authoredPerDay: '6', notes: 'hi' });
  assert.deepEqual(r.changes, { authoredPerDay: 6, notes: 'hi' });
  assert.deepEqual(r.errors, []);
});

test('plan draft: invalid numbers, floors over total, floor above cap', () => {
  const plan = { ...DEFAULT_PLAN, typeFloors: {}, typeCaps: {} };
  const d = planDraftFromPlan(plan);
  assert.match(planChangesFromDraft(plan, { ...d, authoredPerDay: '' }).errors[0], /whole number 1-16/);
  assert.match(planChangesFromDraft(plan, { ...d, authoredPerDay: '17' }).errors[0], /1-16/);
  assert.match(planChangesFromDraft(plan, { ...d, authoredPerDay: '2.5' }).errors[0], /1-16/);
  assert.match(planChangesFromDraft(plan, { ...d, typeFloors: { hook: '-1' } }).errors[0], /Floor for hook/);
  const over = planChangesFromDraft(plan, { ...d, authoredPerDay: '2', typeFloors: { hook: '2', story: '1' } });
  assert.match(over.errors.join(), /Floors add up to 3/);
  const cap = planChangesFromDraft(plan, { ...d, authoredPerDay: '8', typeFloors: { hook: '3' }, typeCaps: { hook: '1' } });
  assert.match(cap.errors.join(), /above its cap/);
});

test('plan draft: blank map entry removes the key; reordered keys are not a change', () => {
  const plan = { ...DEFAULT_PLAN, typeFloors: { a: 1, b: 2 }, typeCaps: {} };
  const d = planDraftFromPlan(plan);
  assert.equal(planChangesFromDraft(plan, { ...d, typeFloors: { b: '2', a: '1' } }).dirty, false);
  assert.deepEqual(planChangesFromDraft(plan, { ...d, typeFloors: { a: '1', b: '' } }).changes, { typeFloors: { a: 1 } });
});

test('plannable slot types exclude reply/retweet', () => {
  assert.ok(PLANNABLE_SLOT_TYPES.length > 0);
  assert.ok(!PLANNABLE_SLOT_TYPES.includes('reply') && !PLANNABLE_SLOT_TYPES.includes('retweet'));
});

test('draftTier derives or returns null', () => {
  assert.equal(draftTier('abc'), null);
  assert.equal(draftTier(''), null);
  assert.ok(Number.isInteger(draftTier('4')));
});

test('history summary: empty, truncation, long strings', () => {
  assert.equal(historyDiffSummary({ diff: [] }), 'no changes');
  assert.equal(historyDiffSummary({}), 'no changes');
  const e = { diff: [1, 2, 3, 4, 5].map((i) => ({ path: `p${i}`, from: i, to: i + 1 })) };
  assert.equal(historyDiffSummary(e), 'p1 1 → 2; p2 2 → 3; p3 3 → 4 (+2 more)');
  assert.match(historyDiffSummary({ diff: [{ path: 'notes', from: null, to: 'x'.repeat(50) }] }), /none → "x{24}…"/);
  const doc = { history: [{ version: 1 }, { version: 3 }, { version: 2 }] };
  assert.deepEqual(historyNewestFirst(doc).map((h) => h.version), [3, 2, 1]);
  assert.deepEqual(historyNewestFirst(null), []);
});

test('handles: normalize, dirty, validate', () => {
  const profile = { ownHandle: 'bai_ee', benchmarkHandles: ['seb__design'] };
  assert.equal(handlesDirty(profile, { own: '@Bai_ee', benchmarks: ['SEB__design', ''] }), false);
  assert.equal(handlesDirty(profile, { own: 'bai_ee', benchmarks: ['seb__design', 'x'] }), true);
  assert.deepEqual(normalizeHandlesDraft({ own: 'me', benchmarks: ['me', 'a', 'A', ' '] }), { own: 'me', benchmarks: ['a'] });
  assert.match(validateHandlesDraft({ own: '', benchmarks: [] }), /own X handle/);
  assert.match(validateHandlesDraft({ own: 'me', benchmarks: ['bad handle'] }), /not a valid/);
  assert.match(validateHandlesDraft({ own: 'me', benchmarks: ['a', 'b', 'c', 'd', 'e', 'f'] }), /At most 5/);
  assert.equal(validateHandlesDraft({ own: 'me', benchmarks: ['a'] }), null);
});

test('today line and plan error view', () => {
  assert.equal(todayPlanLine({ available: true, posts: 6, usedPlan: true }, { version: 3 }), 'Today: 6 posts (from plan v3).');
  assert.equal(todayPlanLine({ available: true, posts: 1, usedPlan: false }, null), 'Today: 1 post (default).');
  assert.match(todayPlanLine({ available: false, reason: 'no-own-rows' }, null), /refresh first/);
  assert.match(todayPlanLine(null, null), /unavailable/);
  assert.equal(planErrorView({ status: 409 }).conflict, true);
  assert.deepEqual(planErrorView({ status: 400, error: 'bad', errors: ['e1'] }), { conflict: false, message: 'bad', errors: ['e1'] });
});

test('proposalKindLabel: plain words, unknown kinds do not throw', () => {
  assert.equal(proposalKindLabel('plan-change'), 'Change the plan');
  assert.equal(proposalKindLabel('some-new-kind'), 'some new kind');
  assert.equal(proposalKindLabel(undefined), 'Proposal');
});

test('proposalPayloadPreview: per-kind lines and odd payloads', () => {
  const plan = { authoredPerDay: 4, typeFloors: { 'quote-react': 1 } };
  assert.deepEqual(proposalPayloadPreview('plan-change', { changes: { authoredPerDay: 6, notes: 'x' } }, plan), ['authoredPerDay: 4 → 6', 'notes: unset → x']);
  assert.deepEqual(proposalPayloadPreview('plan-change', { changes: { typeFloors: { a: 2 } } }, plan), ['typeFloors: {"quote-react":1} → {"a":2}']);
  assert.deepEqual(proposalPayloadPreview('plan-change', {}, plan), ['No field changes.']);
  assert.deepEqual(proposalPayloadPreview('suggestion-edit', { text: 'hi' }), ['New text: hi']);
  assert.deepEqual(proposalPayloadPreview('item-story', { story: 'We shipped it' }), ['Story: We shipped it']);
  assert.deepEqual(proposalPayloadPreview('benchmarks-change', { ownHandle: 'bai_ee', benchmarkHandles: ['a', '@b'] }), ['Your handle: @bai_ee', 'Benchmarks: @a, @b']);
  assert.deepEqual(proposalPayloadPreview('refresh-handles', { handles: ['a'] }), ['Pull fresh posts for: @a']);
  assert.deepEqual(proposalPayloadPreview('regenerate-today', { useModel: false }), ['Model drafting: off']);
  assert.deepEqual(proposalPayloadPreview('regenerate-today', { useModel: true, force: true }), ['Model drafting: on', 'Replaces the existing run.']);
  assert.deepEqual(proposalPayloadPreview('unknown', null), []);
  assert.deepEqual(proposalPayloadPreview('benchmarks-change', null), ['Benchmarks: none']);
});

test('proposalStatusText: every status, including failure reasons', () => {
  assert.deepEqual(proposalStatusText({ status: 'pending' }), { label: 'pending', tone: 'pending', detail: '' });
  assert.equal(proposalStatusText({ status: 'rejected' }).tone, 'muted');
  assert.equal(proposalStatusText({ status: 'confirmed', kind: 'plan-change', result: { version: 5 } }).detail, 'Plan updated to v5.');
  assert.match(proposalStatusText({ status: 'confirmed', kind: 'suggestion-edit' }).detail, /open the Today tab/);
  assert.match(proposalStatusText({ status: 'confirmed', kind: 'regenerate-today' }).detail, /Today tab/);
  assert.equal(proposalStatusText({ status: 'failed', result: { error: 'stale', currentVersion: 5 } }).detail, 'stale: plan is now v5, ask again');
  assert.match(proposalStatusText({ status: 'failed', result: { error: 'stale' } }).detail, /^stale:/);
  assert.equal(proposalStatusText({ status: 'failed', result: { error: 'failed', message: 'boom' } }).detail, 'boom');
  assert.match(proposalStatusText({ status: 'failed' }).detail, /could not be applied/);
  assert.equal(proposalStatusText(null).label, 'pending');
});

test('chatErrorText: cap, 503, 502, 409, network, fallback', () => {
  assert.equal(chatErrorText({ status: 429, data: { code: 'chat-cap', used: 20, cap: 20 } }), 'Daily chat limit reached (20/20).');
  assert.equal(chatErrorText({ status: 429, data: {} }), 'Daily chat limit reached.');
  assert.match(chatErrorText({ status: 503 }), /No model is configured/);
  assert.equal(chatErrorText({ status: 502, message: 'The strategy agent failed: x' }), 'The strategy agent failed: x');
  assert.equal(chatErrorText({ status: 409 }), 'Already decided.');
  assert.match(chatErrorText(new TypeError('Failed to fetch')), /Network problem/);
  assert.equal(chatErrorText({ status: 400, message: 'text is required.' }), 'text is required.');
  assert.equal(chatErrorText(null), 'Network problem — check your connection and try again.');
});

test('costFooterText: formats and omits missing pieces', () => {
  assert.equal(costFooterText({ costUsd: 0.0123 }, 3, 20), '3 of 20 turns today · last turn $0.012');
  assert.equal(costFooterText(null, 0, 20), '0 of 20 turns today');
  assert.equal(costFooterText({ costUsd: 'x' }, 1, 20), '1 of 20 turns today');
  assert.equal(costFooterText(undefined, undefined, undefined), '');
  assert.equal(costFooterText(null, 2, undefined), '2 turns today');
});

test('proposalStatusText: a deciding proposal reads as applying/interrupted (no retry)', () => {
  const st = proposalStatusText({ status: 'deciding', kind: 'plan-change' });
  assert.equal(st.label, 'applying');
  assert.match(st.detail, /Applying.*interrupted.*check Today\/Plan before retrying/);
});
