'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveRefreshDaily, normalizeRefreshDaily, cronGroupsFor, DAILY_GROUP_IDS } = require('../_refresh-daily');

test('no saved profile = what the crons ran before (enabled; X search only with the legacy dailyXSearch opt-in)', () => {
  const plain = resolveRefreshDaily({});
  assert.equal(plain.saved, false);
  assert.equal(plain.enabled, true);
  assert.deepEqual([...plain.groups].sort(), ['analysis', 'market-signals', 'renders', 'today-queue']);
  assert.ok(resolveRefreshDaily({ dailyXSearch: true }).groups.includes('x-search'));
});

test('a saved profile wins; unknown groups are dropped; enabled defaults to true', () => {
  const p = resolveRefreshDaily({ dailyXSearch: true, refreshDaily: { groups: ['analysis', 'nope', 'analysis'], updatedBy: 'o@x.com' } });
  assert.equal(p.saved, true);
  assert.equal(p.enabled, true);
  assert.deepEqual(p.groups, ['analysis']);
  assert.equal(p.updatedBy, 'o@x.com');
  assert.deepEqual(normalizeRefreshDaily({ enabled: false, groups: DAILY_GROUP_IDS }).enabled, false);
});

test('cron groups: Daily off = nothing runs; on = the ticked groups', () => {
  assert.equal(cronGroupsFor({ enabled: false, groups: ['analysis'] }).size, 0);
  assert.deepEqual([...cronGroupsFor({ enabled: true, groups: ['renders', 'x-search'] })], ['renders', 'x-search']);
  assert.equal(cronGroupsFor(null).size, 0);
});
