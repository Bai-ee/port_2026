import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeWorld, OWNER, OTHER } from './ops-world.js';
import { CONFIRM_ON_INCLUDE_KEYS, BLOCKED_ON_INCLUDE_KEYS, MODULE_IDS } from '../ops/settings.js';
import { isDeniedCollectionName } from '../redact.js';

const { SECTIONS } = createRequire(import.meta.url)('../../email-digest/sections.registry.cjs');
const DEFAULTS = Object.fromEntries(SECTIONS.map((x) => [x.key, x.defaultOn]));
const profile = (w, id) => ({ enabled: w.settings.dailyDocs.get(id).enabled, groups: w.settings.dailyDocs.get(id).groups });

const set = (w, key, value, extra = {}) => w.call('set_setting', { key, value, ...extra });
const nothingWritten = (w) => w.settings.writes.digest.length + w.settings.writes.daily.length + w.settings.writes.sources.length === 0;

test('get_settings: values + per-direction gates; read-only block; never recipientEmail', async () => {
  const w = makeWorld();
  const out = w.json(await w.call('get_settings'));
  const by = (k) => out.settings.find((s) => s.key === k);
  assert.equal(by('digest.dailyXSearch').value, false);
  assert.deepEqual(by('digest.dailyXSearch').set, { true: 'blocked', false: 'free' });
  assert.deepEqual(by('digest.include.signals').set, { true: 'confirm', false: 'free' });
  assert.deepEqual(by('digest.include.xMarketTalk').set, { true: 'blocked', false: 'free' });
  assert.deepEqual(by('digest.briefLinkMode').set, { fresh: 'blocked', latest: 'confirm', off: 'free' });
  assert.deepEqual(by('x-sources.strategyAccounts').set, { mac: 'free', 'x-api': 'blocked' });
  assert.equal(by('refresh-daily.group.renders').value, true);
  assert.equal(by('digest.include.todayPlan').value, true, 'home client default shows through');
  assert.equal(out.readOnly.schedule.timezone, 'America/Chicago');
  assert.deepEqual(out.readOnly.autoPublish, { x: 'off', instagram: 'approval' });
  assert.deepEqual(out.readOnly.trustedRefresh, { enabled: true, dailyCapUsd: 5 });
  assert.ok(!JSON.stringify(out).includes('secret@example.com'));
  assert.ok(!out.settings.some((s) => /recipient/i.test(s.key)));
  assert.deepEqual(out.settings.filter((s) => s.key.startsWith('modules.')).map((s) => s.key), MODULE_IDS.map((id) => `modules.${id}.enabled`));
  assert.deepEqual(out.settings.find((s) => s.key === 'modules.social-preview.enabled').set, { true: 'confirm', false: 'free' });
});

test('allowlist: unknown keys, modules.*, recipientEmail, autoPublish, bad values and unknown include sections are refused; nothing written', async () => {
  const w = makeWorld();
  for (const key of ['modules.nope.enabled', 'modules.signals.enabled', 'digest.recipientEmail', 'digest.autoPublish.x', 'agentAutonomy.trustedRefresh', 'digest.include.notASection', 'refresh-daily.group.bogus', 'digest.include.__proto__', 'x-sources.nothing']) {
    const r = await set(w, key, false);
    assert.equal(r.isError, true, key); assert.match(r.content[0].text, /not a setting that can be changed/, key);
  }
  assert.equal((await set(w, 'digest.dailyXSearch', 'false')).isError, true, 'string for a boolean');
  assert.equal((await set(w, 'digest.briefLinkMode', 'sometimes')).isError, true);
  assert.equal((await set(w, 'x-sources.quoteTargets', true)).isError, true);
  assert.ok(nothingWritten(w));
});

test('blocked directions: turning on anything that spends or sends is refused, even with confirm:true; nothing written', async () => {
  const w = makeWorld();
  w.settings.dailyDocs.set(OWNER, { enabled: false, groups: [] });
  w.settings.digestDocs.set(OWNER, { summaryEnabled: false, dailyXSearch: false, briefLinkMode: 'latest' });
  const cases = [['refresh-daily.enabled', true], ['refresh-daily.group.analysis', true], ['refresh-daily.group.today-queue', true], ['refresh-daily.group.x-search', true],
    ['digest.schedule.enabled', true], ['digest.dailyXSearch', true], ['digest.summaryEnabled', true], ['digest.briefLinkMode', 'fresh'],
    ['digest.include.xMarketTalk', true], ['x-sources.strategyAccounts', 'x-api'], ['x-sources.quoteTargets', 'x-api'], ['x-sources.autoDaily.quoteTargets', true]];
  w.settings.digestDocs.get(OWNER).schedule = { enabled: false };
  for (const [key, value] of cases) {
    for (const extra of [{}, { confirm: true }]) {
      const r = w.json(await set(w, key, value, extra));
      assert.equal(r.applied, false, key); assert.equal(r.blocked, true, key); assert.ok(r.reason, key);
    }
  }
  assert.ok(nothingWritten(w));
  assert.equal(w.stores.changes._raw.size, 0);
});

test('every cost include key is blocked ON and free OFF', async () => {
  const w = makeWorld();
  const out = w.json(await w.call('get_settings'));
  for (const k of ['xMarketTalk', 'videoPosts', 'videoPromo', 'creativeBrief', 'execBriefLink', 'execSummary']) {
    const row = out.settings.find((s) => s.key === `digest.include.${k}`);
    assert.deepEqual(row.set, { true: 'blocked', false: 'free' }, k);
  }
});

test('confirm: include ON needs confirm:true (no write without it); OFF is free', async () => {
  const w = makeWorld();
  const ask = w.json(await set(w, 'digest.include.signals', true));
  assert.equal(ask.applied, false); assert.equal(ask.needsConfirm, true); assert.ok(nothingWritten(w));
  const done = w.json(await set(w, 'digest.include.signals', true, { confirm: true }));
  assert.equal(done.applied, true); assert.equal(done.before, false); assert.equal(done.after, true); assert.match(done.changeId, /^chg_/);
  const off = w.json(await set(w, 'digest.include.agenda', false));
  assert.equal(off.applied, true, 'OFF needs no confirm');
});

test('no-op: setting the value it already has writes nothing and logs nothing', async () => {
  const w = makeWorld();
  const r = w.json(await set(w, 'digest.dailyXSearch', false));
  assert.equal(r.unchanged, true); assert.ok(nothingWritten(w)); assert.equal(w.stores.changes._raw.size, 0);
});

test('writer: include patch sends the FULL map, so other sections keep their values', async () => {
  const w = makeWorld();
  w.settings.digestDocs.set(OWNER, { include: { signals: false, humanBrief: true, agenda: true, xMarketTalk: true, videoPosts: false, execSummary: false, execBriefLink: true } });
  await set(w, 'digest.include.signals', true, { confirm: true });
  const stored = w.settings.digestDocs.get(OWNER).include;
  const expected = { ...DEFAULTS, signals: true, humanBrief: true, xMarketTalk: true, videoPosts: false, execSummary: false };
  delete expected.todayPlan;
  assert.deepEqual({ ...stored }, expected, 'every other key kept (incl. non-default ones)');
});

test('writer: todayPlan is not frozen by an unrelated include change, and can be changed on purpose', async () => {
  const w = makeWorld();
  await set(w, 'digest.include.humanBrief', false); // already false: no-op; use a real change instead
  await set(w, 'digest.include.agenda', false);
  const sent = w.settings.writes.digest.at(-1).patch.include;
  assert.ok(!('todayPlan' in sent), 'todayPlan omitted from the patch');
  assert.ok(!('todayPlan' in w.settings.digestDocs.get(OWNER).include), 'not frozen into storage');
  assert.equal(w.json(await w.call('get_settings')).settings.find((s) => s.key === 'digest.include.todayPlan').value, true, 'home default still applies');
  const r = w.json(await set(w, 'digest.include.todayPlan', false));
  assert.equal(r.applied, true);
  assert.equal(w.settings.digestDocs.get(OWNER).include.todayPlan, false, 'explicit todayPlan change is stored');
});

test('writer: schedule OFF keeps hour / weekday / timezone / frequency, and is NOT undoable', async () => {
  const w = makeWorld();
  w.settings.digestDocs.set(OWNER, { schedule: { enabled: true, frequency: 'weekly', sendHour: 9, weekday: 3, timezone: 'Europe/Paris' } });
  const r = w.json(await set(w, 'digest.schedule.enabled', false));
  assert.equal(r.applied, true); assert.equal(r.undoable, false);
  assert.deepEqual(w.settings.digestDocs.get(OWNER).schedule, { enabled: false, frequency: 'weekly', sendHour: 9, weekday: 3, timezone: 'Europe/Paris' });
  const undo = w.json(await w.call('undo_setting', { changeId: r.changeId }));
  assert.equal(undo.undone, false); assert.match(undo.reason, /cannot be undone over MCP/);
  assert.equal(w.settings.digestDocs.get(OWNER).schedule.enabled, false);
});

test('writer: refresh-daily group OFF keeps enabled + the other groups (saved profile)', async () => {
  const w = makeWorld();
  w.settings.dailyDocs.set(OWNER, { enabled: false, groups: ['analysis', 'renders', 'x-search'] });
  const r = w.json(await set(w, 'refresh-daily.group.renders', false));
  assert.equal(r.applied, true);
  assert.deepEqual(w.settings.writes.daily.at(-1).input, { enabled: false, groups: ['analysis', 'x-search'] });
  assert.deepEqual(profile(w, OWNER), { enabled: false, groups: ['analysis', 'x-search'] }, 'a saved enabled:false is NOT reset to true');
  assert.equal(w.settings.writes.daily.at(-1).by, 'bryanballi@gmail.com');
});

test('writer: refresh-daily never-saved client starts from the effective default, not an empty profile', async () => {
  const w = makeWorld();
  assert.equal(w.settings.dailyDocs.has(OWNER), false);
  const r = w.json(await set(w, 'refresh-daily.group.analysis', false));
  assert.equal(r.applied, true);
  assert.deepEqual(profile(w, OWNER), { enabled: true, groups: ['market-signals', 'renders', 'today-queue'] });
  const off = w.json(await set(w, 'refresh-daily.enabled', false));
  assert.equal(off.applied, true);
  assert.deepEqual(profile(w, OWNER), { enabled: false, groups: ['market-signals', 'renders', 'today-queue'] }, 'enabled OFF keeps the groups');
});

test('writer: x-sources autoDaily OFF touches only that key; source back to mac is free', async () => {
  const w = makeWorld();
  w.settings.sourceDocs.set(OWNER, { strategyAccounts: 'x-api', quoteTargets: 'x-api', autoDaily: { strategyAccounts: true, quoteTargets: true } });
  assert.equal(w.json(await set(w, 'x-sources.autoDaily.quoteTargets', false)).applied, true);
  assert.deepEqual(w.settings.writes.sources.at(-1).patch, { autoDaily: { quoteTargets: false } });
  assert.deepEqual(w.settings.sourceDocs.get(OWNER), { strategyAccounts: 'x-api', quoteTargets: 'x-api', autoDaily: { strategyAccounts: true, quoteTargets: false } });
  assert.equal(w.json(await set(w, 'x-sources.strategyAccounts', 'mac')).applied, true);
});

test('mutex: two concurrent set_setting calls on one client both land (no lost update)', async () => {
  const w = makeWorld();
  const [a, b] = await Promise.all([set(w, 'digest.include.agenda', false), set(w, 'digest.include.videoPosts', false)]);
  assert.equal(w.json(a).applied, true); assert.equal(w.json(b).applied, true);
  const inc = w.settings.digestDocs.get(OWNER).include;
  assert.equal(inc.agenda, false); assert.equal(inc.videoPosts, false);
  assert.equal(w.stores.locks._raw.size, 0, 'lock released');
});

test('mutex: a held lock makes set_setting wait then fail clearly; different clients do not block each other', async () => {
  const w = makeWorld();
  await w.stores.locks.acquire(`settings_${OWNER}`, { now: w.clock.now, leaseMs: 60000 });
  const blocked = await set(w, 'digest.include.agenda', false);
  assert.equal(blocked.isError, true); assert.match(blocked.content[0].text, /still running/);
  assert.equal(w.json(await set(w, 'digest.include.agenda', false, { clientId: OTHER })).applied, true);
  w.clock.now += 61000; // lease expired
  assert.equal(w.json(await set(w, 'digest.include.agenda', false)).applied, true);
});

test('undo: success restores only that key and marks the change undone', async () => {
  const w = makeWorld();
  w.settings.digestDocs.set(OWNER, { include: { signals: true, agenda: true, humanBrief: false, xMarketTalk: false, videoPosts: true, execSummary: true, execBriefLink: true } });
  await set(w, 'digest.include.agenda', false);
  const r = w.json(await set(w, 'digest.include.signals', false));
  assert.equal(r.undoable, true); assert.equal(r.undoNeedsConfirm, true, 'undoing an OFF means turning ON: confirm-gated');
  const row = await w.stores.changes.get(r.changeId);
  assert.equal(row.clientId, OWNER); assert.equal(row.key, 'digest.include.signals'); assert.equal(row.before, true); assert.equal(row.after, false); assert.equal(row.via, 'mcp'); assert.equal(row.undoneAt, null);
  const needs = w.json(await w.call('undo_setting', { changeId: r.changeId }));
  assert.equal(needs.undone, false); assert.equal(needs.needsConfirm, true);
  const ok = w.json(await w.call('undo_setting', { changeId: r.changeId, confirm: true }));
  assert.equal(ok.undone, true); assert.equal(ok.after, true);
  const inc = w.settings.digestDocs.get(OWNER).include;
  assert.equal(inc.signals, true); assert.equal(inc.agenda, false, 'the other change is untouched');
  assert.ok((await w.stores.changes.get(r.changeId)).undoneAt);
  assert.equal(w.json(await w.call('undo_setting', { changeId: r.changeId, confirm: true })).undone, false, 'cannot undo twice');
});

test('undo: free when it reduces risk (turning an ON change back OFF)', async () => {
  const w = makeWorld();
  const r = w.json(await set(w, 'digest.include.signals', true, { confirm: true }));
  const u = w.json(await w.call('undo_setting', { changeId: r.changeId }));
  assert.equal(u.undone, true); assert.equal(w.settings.digestDocs.get(OWNER).include.signals, false);
});

test('undo: conflict after an external edit writes nothing', async () => {
  const w = makeWorld();
  const r = w.json(await set(w, 'digest.include.signals', true, { confirm: true }));
  w.settings.digestDocs.get(OWNER).include.signals = false; // someone flips it in HITLOOP
  const writesBefore = w.settings.writes.digest.length;
  const u = w.json(await w.call('undo_setting', { changeId: r.changeId }));
  assert.equal(u.undone, false); assert.equal(u.conflict, true); assert.equal(u.current, false); assert.equal(u.expected, true);
  assert.equal(w.settings.writes.digest.length, writesBefore);
});

test('undo: undoing an OFF whose reverse spends is non-undoable (cost section) and is refused', async () => {
  const w = makeWorld();
  w.settings.digestDocs.set(OWNER, { include: { xMarketTalk: true, agenda: true, videoPosts: true, execSummary: true, execBriefLink: true } });
  const r = w.json(await set(w, 'digest.include.xMarketTalk', false));
  assert.equal(r.applied, true); assert.equal(r.undoable, false);
  const u = w.json(await w.call('undo_setting', { changeId: r.changeId, confirm: true }));
  assert.equal(u.undone, false); assert.equal(w.settings.digestDocs.get(OWNER).include.xMarketTalk, false);
});

test('undo: a changeId of another client is refused like a missing one; bad ids too; nothing written', async () => {
  const w = makeWorld();
  const r = w.json(await set(w, 'digest.include.signals', true, { confirm: true }));
  const writes = w.settings.writes.digest.length;
  const cross = await w.call('undo_setting', { changeId: r.changeId, clientId: OTHER });
  assert.equal(cross.isError, true); assert.match(cross.content[0].text, /No such change for this client/);
  for (const bad of ['chg_missing', 'a/b', '../etc']) assert.equal((await w.call('undo_setting', { changeId: bad })).isError, true, bad);
  assert.equal(w.settings.writes.digest.length, writes);
  assert.equal(w.settings.digestDocs.get(OWNER).include.signals, true);
});

test('settings are per client: a change for one client never touches another', async () => {
  const w = makeWorld();
  await set(w, 'digest.include.agenda', false, { clientId: OTHER });
  assert.equal(w.settings.digestDocs.get(OWNER), undefined);
  assert.equal(w.settings.digestDocs.get(OTHER).include.agenda, false);
  assert.equal((await w.stores.changes.get('chg_t1')).clientId, OTHER);
});

test('include ON fails closed: every REAL registry key is classified exactly once (a new section fails until decided)', () => {
  const keys = SECTIONS.map((x) => x.key);
  const classified = [...CONFIRM_ON_INCLUDE_KEYS, ...BLOCKED_ON_INCLUDE_KEYS];
  assert.equal(new Set(classified).size, classified.length, 'no key in both lists');
  assert.deepEqual([...classified].sort(), [...keys].sort(), 'lists cover the registry exactly');
});

test('include ON per real registry key: only the pinned presentation-only keys are confirm; all others blocked (even with confirm:true); OFF always free', async () => {
  const w = makeWorld();
  const out = w.json(await w.call('get_settings'));
  for (const k of SECTIONS.map((x) => x.key)) {
    const row = out.settings.find((s) => s.key === `digest.include.${k}`);
    assert.ok(row, k);
    assert.equal(row.set.false, 'free', k);
    assert.equal(row.set.true, CONFIRM_ON_INCLUDE_KEYS.includes(k) ? 'confirm' : 'blocked', k);
  }
  for (const k of ['signups', 'platformOverview', 'dashboards', 'pipeline', 'deployments', 'runtimeErrors', 'redditAnalysis', 'followerPosts', 'xMarketTalk', 'weather', 'agenda', 'ga4Traffic']) {
    w.settings.digestDocs.set(OWNER, { include: { [k]: false } });
    const r = w.json(await set(w, `digest.include.${k}`, true, { confirm: true }));
    assert.equal(r.blocked, true, k);
  }
  assert.ok(nothingWritten(w));
});

test('briefLinkMode latest needs confirm:true; off is free; fresh stays blocked', async () => {
  const w = makeWorld();
  assert.equal(w.json(await set(w, 'digest.briefLinkMode', 'latest')).needsConfirm, true);
  assert.equal(w.json(await set(w, 'digest.briefLinkMode', 'latest', { confirm: true })).applied, true);
  assert.equal(w.json(await set(w, 'digest.briefLinkMode', 'off')).applied, true);
  assert.equal(w.json(await set(w, 'digest.briefLinkMode', 'fresh', { confirm: true })).blocked, true);
});

test('dailyXSearch OFF warns when the saved refresh-daily profile still runs x-search; no warning otherwise', async () => {
  const w = makeWorld();
  w.settings.digestDocs.set(OWNER, { dailyXSearch: true });
  w.settings.dailyDocs.set(OWNER, { enabled: true, groups: ['analysis', 'x-search'] });
  const r = w.json(await set(w, 'digest.dailyXSearch', false));
  assert.equal(r.applied, true); assert.match(r.warning, /STILL runs.*refresh-daily\.group\.x-search/);
  assert.deepEqual(profile(w, OWNER).groups, ['analysis', 'x-search'], 'one key per change: the group is not touched');
  const w2 = makeWorld();
  w2.settings.digestDocs.set(OWNER, { dailyXSearch: true });
  assert.equal(w2.json(await set(w2, 'digest.dailyXSearch', false)).warning, undefined);
});

test('log is written right after the write; a read-back mismatch still reports the changeId and marks the row', async () => {
  const w = makeWorld();
  const realGet = w.settings.digest.get;
  let after = false;
  const realSave = w.settings.digest.save;
  w.settings.digest.save = async (...a) => { await realSave(...a); after = true; };
  w.settings.digest.get = async (id) => { const c = await realGet(id); if (after) c.include.agenda = true; return c; }; // read-back disagrees
  const r = await set(w, 'digest.include.agenda', false);
  assert.equal(r.isError, true); assert.match(r.content[0].text, /changeId chg_t1/);
  const row = await w.stores.changes.get('chg_t1');
  assert.equal(row.verified, false); assert.equal(row.undoable, false);
});

test('new ops collections are denied to the data tools (mcp_* except mcp_audit)', () => {
  for (const n of ['mcp_ops_runs', 'mcp_settings_log', 'mcp_ops_locks']) assert.equal(isDeniedCollectionName(n), true, n);
  assert.equal(isDeniedCollectionName('mcp_audit'), false);
});

test('brief-derived include ON is blocked when includeClientIds is non-empty; confirm message names the recipient otherwise', async () => {
  const keys = ['humanBrief', 'opportunities', 'suggestedReplies', 'signals', 'pressCoverage', 'suggestedPosts', 'planPreview'];
  const w = makeWorld();
  w.settings.digestDocs.set(OWNER, { include: { signals: false, humanBrief: false, opportunities: false, suggestedReplies: false, pressCoverage: false, suggestedPosts: false, planPreview: false, contactHuman: false }, includeClientIds: [OTHER] });
  const list = w.json(await w.call('get_settings'));
  for (const k of keys) {
    assert.equal(list.settings.find((s) => s.key === `digest.include.${k}`).set.true, 'blocked', k);
    const r = w.json(await set(w, `digest.include.${k}`, true, { confirm: true }));
    assert.equal(r.blocked, true, k); assert.match(r.reason, /includeClientIds/);
  }
  assert.ok(nothingWritten(w));
  // todayPlan / contactHuman are not brief-derived: still confirm
  assert.equal(w.json(await set(w, 'digest.include.contactHuman', true)).needsConfirm, true);
  const w2 = makeWorld();
  const ask = w2.json(await set(w2, 'digest.include.signals', true));
  assert.equal(ask.needsConfirm, true); assert.match(ask.message, /sent to the configured recipient/);
});
