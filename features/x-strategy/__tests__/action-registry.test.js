import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  ACTIONS, ROUTE_MODULES, ROUTE_FILES, ROUTE_AUTH, GROUPS, findActions, getAction, validateAction, summarizeArgs,
} from '../agent/action-registry.js';
import { STRATEGY_ROUTE_ACTIONS } from '../route-handlers.js';
import { NAS_ACTIONS } from '../../x-content-inventory/nas.js';
import { DISCOGS_ACTIONS } from '../../discogs-ingest/actions.js';
import { TIMELINE_ACTIONS } from '../../social-archive/actions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = (key) => readFileSync(path.join(ROOT, ROUTE_FILES[key]), 'utf8');
const QT_LISTS = new Set([...STRATEGY_ROUTE_ACTIONS, ...NAS_ACTIONS, ...DISCOGS_ACTIONS, ...TIMELINE_ACTIONS]);

test('every entry is structurally valid and ids are unique', () => {
  const seen = new Set();
  for (const a of ACTIONS) {
    assert.deepEqual(validateAction(a), [], a.id);
    assert.ok(!seen.has(a.id), `duplicate id ${a.id}`);
    seen.add(a.id);
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.args), `${a.id} not frozen`);
  }
  assert.ok(ACTIONS.length >= 120, `expected a broad catalog, got ${ACTIONS.length}`);
});

test('ROUTE_MODULES / ROUTE_FILES / ROUTE_AUTH agree and point at real files', () => {
  const keys = Object.keys(ROUTE_MODULES).sort();
  assert.deepEqual(Object.keys(ROUTE_FILES).sort(), keys);
  assert.deepEqual(Object.keys(ROUTE_AUTH).sort(), keys);
  for (const k of keys) {
    assert.equal(typeof ROUTE_MODULES[k], 'function');
    assert.ok(existsSync(path.join(ROOT, ROUTE_FILES[k])), `${ROUTE_FILES[k]} missing`);
    assert.ok(ROUTE_AUTH[k].bearer === true && ['context', 'explicit'].includes(ROUTE_AUTH[k].clientFrom), k);
  }
});

test('every action literal exists in its route source (or the route\'s declared action lists)', () => {
  for (const a of ACTIONS) {
    const lit = a.action ?? a.query?.action;
    const text = src(a.route);
    const exports = a.method === 'GET' ? /export\s+(async\s+)?function\s+GET\b|export\s+const\s+GET\b/ : /export\s+(async\s+)?function\s+POST\b|export\s+const\s+POST\b|export\s+(async\s+)?function\s+handle\b/;
    if (a.route === 'email-digest' || a.route === 'cost-report' || a.route === 'pre-digest-refresh') assert.ok(/export\s+(async\s+)?function\s+(GET|POST)\b/.test(text), `${a.id}: no handler export`);
    else assert.ok(exports.test(text), `${a.id}: route has no ${a.method} export`);
    if (!lit) continue;
    const found = text.includes(`'${lit}'`) || (a.route === 'quote-targets' && QT_LISTS.has(lit));
    assert.ok(found, `${a.id}: action "${lit}" not found in ${ROUTE_FILES[a.route]}`);
  }
});

test('coverage: every action of the two core routes is catalogued or explicitly excluded', () => {
  const EXCLUDED_QT = new Set(['strategy-chat-send', 'strategy-chat-history', 'strategy-proposal-decide', 'strategy-review', 'save-thumb', 'media-url']);
  const EXCLUDED_SP = new Set(['process-due-cron']);
  const registered = (route) => new Set(ACTIONS.filter((a) => a.route === route).map((a) => a.action).filter(Boolean));

  // quote-targets: SUPPORTED_ACTIONS array in the route (spreads resolved through the imported lists).
  const qt = src('quote-targets');
  const block = qt.slice(qt.indexOf('const SUPPORTED_ACTIONS = ['), qt.indexOf('];', qt.indexOf('const SUPPORTED_ACTIONS = [')));
  const supported = new Set([...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]));
  for (const l of [STRATEGY_ROUTE_ACTIONS, NAS_ACTIONS, DISCOGS_ACTIONS, TIMELINE_ACTIONS]) l.forEach((x) => supported.add(x));
  const qtReg = registered('quote-targets');
  for (const a of supported) assert.ok(qtReg.has(a) || EXCLUDED_QT.has(a), `quote-targets action "${a}" is neither catalogued nor excluded`);

  // social-posting: every `action === '...'` branch plus the default draft.
  const sp = src('social-posting');
  const spActions = new Set([...sp.matchAll(/action === '([a-z-]+)'/g)].map((m) => m[1]).filter((x) => x !== 'process-due-cron'));
  spActions.add('draft');
  spActions.delete('process-due'); // appears twice: GET cron branch and POST client sweep; POST one is catalogued below
  const spReg = registered('social-posting');
  for (const a of spActions) assert.ok(spReg.has(a) || EXCLUDED_SP.has(a), `social-posting action "${a}" is neither catalogued nor excluded`);
  assert.ok(spReg.has('process-due'));
});

test('core route sizes: quote-targets and social-posting are thoroughly covered', () => {
  const n = (route) => ACTIONS.filter((a) => a.route === route).length;
  assert.ok(n('quote-targets') >= 70, `quote-targets entries: ${n('quote-targets')}`);
  assert.ok(n('social-posting') >= 25, `social-posting entries: ${n('social-posting')}`);
});

test('anything that can publish to X is tier 3 external x', () => {
  const mustBeX = ['queue.post.schedule', 'queue.post.reschedule', 'queue.post.approve-and-schedule', 'queue.post.post-now', 'queue.repost.schedule', 'queue.repost.post-now', 'queue.approval.approve', 'queue.post.retry-self-reply', 'queue.process-due', 'digest.autopublish.save'];
  for (const id of mustBeX) {
    const a = getAction(id);
    assert.ok(a, id);
    assert.equal(a.tier, 3, id);
    assert.equal(a.external, 'x', id);
    assert.ok(a.cost, id);
  }
  // Any POST that can set a schedule time is armed for the cron, so it must be tier 3 x, except tier-1 entries that cannot carry one.
  for (const a of ACTIONS.filter((x) => x.route === 'social-posting')) {
    if ('scheduledAt' in a.args.properties) assert.equal(a.external, 'x', `${a.id} takes scheduledAt`);
  }
  for (const id of ['queue.post.post-now', 'queue.repost.post-now', 'queue.approval.approve']) assert.equal(getAction(id).irreversible, true);
});

test('tier calibration spot checks', () => {
  const t = (id) => getAction(id).tier;
  assert.equal(t('queue.post.approve'), 1); // approve without scheduling
  assert.equal(t('queue.post.unschedule'), 1);
  assert.equal(getAction('queue.post.unschedule').fixed.scheduledAt, null);
  assert.equal(t('queue.post.reject'), 2);
  assert.equal(t('content.item.delete'), 2);
  assert.equal(t('buckets.delete'), 2);
  assert.equal(t('media.delete-folder'), 2);
  assert.equal(t('nas.process'), 3);
  assert.equal(t('xmonitor.sync-all'), 3);
  assert.equal(t('xmonitor.get'), 0);
  assert.equal(t('signals.opportunities.refresh'), 3);
  assert.equal(t('archive.upload'), 3);
  assert.equal(getAction('archive.upload').external, 'arweave');
  assert.equal(t('digest.send-now'), 3);
  assert.equal(getAction('digest.send-now').external, 'email');
  assert.equal(getAction('daily-run.generate-with-model').fixed.draftWithModel, true);
  // Every read-only listing stays free.
  for (const id of ['queue.list', 'queue.score', 'buckets.list', 'strategy.get', 'brain.get', 'digest.preview']) assert.equal(t(id), 0, id);
});

test('tier 0 entries never carry snapshots; tier 1/2 core writes carry a snapshot or native undo', () => {
  for (const a of ACTIONS.filter((x) => x.tier === 0)) assert.ok(!a.snapshot && !a.undo, a.id);
  for (const id of ['queue.post.update', 'queue.post.unschedule', 'queue.post.approve', 'queue.post.reject', 'content.item.save', 'content.item.move', 'content.item.delete', 'buckets.upsert', 'buckets.delete', 'brain.form.save', 'signals.config.save', 'strategy.plan.apply', 'strategy.doc.save']) {
    const a = getAction(id);
    assert.ok(a.snapshot?.length || a.undo, `${id} needs a snapshot or undo`);
  }
  assert.deepEqual(getAction('queue.post.update').snapshot, [{ collection: 'social_posts', idArg: 'postId' }]);
  assert.equal(getAction('strategy.plan.apply').undo.actionId, 'strategy.plan.revert');
  assert.ok(getAction(getAction('strategy.doc.save').undo.actionId), 'native undo target exists');
  for (const a of ACTIONS.filter((x) => x.undo)) assert.ok(getAction(a.undo.actionId), `${a.id} undo target ${a.undo.actionId}`);
});

test('snapshot paths match the real Firestore layout', () => {
  const paths = ACTIONS.flatMap((a) => (a.snapshot || []).map((s) => s.path || s.collection)).filter(Boolean);
  const roots = new Set(paths.map((p) => p.split('/')[0]));
  for (const r of roots) assert.ok(['social_posts', 'x_content_packages', 'content_buckets', 'dashboard_state', 'client_configs', 'digest_config', 'x_strategy_plans', 'x_strategy_docs', 'clients'].includes(r), `unexpected snapshot root ${r}`);
  // Collection names the stores really use.
  const store = readFileSync(path.join(ROOT, 'features/x-content-inventory/bucket-store.js'), 'utf8');
  assert.ok(store.includes("'content_buckets'") && store.includes("'x_content_packages'"));
  const svc = readFileSync(path.join(ROOT, 'features/social-posting/twitter-service.js'), 'utf8');
  assert.ok(svc.includes("POSTS_COLLECTION = 'social_posts'"));
});

test('args schemas: required args exist, dangerous fields are not exposed', () => {
  assert.ok(!('planOverride' in getAction('queue.post.approve-and-schedule').args.properties));
  assert.ok(!('scheduledAt' in getAction('queue.post.update').args.properties), 'update must not be able to arm the cron');
  assert.ok(!('schedule' in getAction('digest.config.save').args.properties));
  assert.ok(!('autoPublish' in getAction('digest.config.save').args.properties));
  assert.ok(!('mode' in getAction('brain.generate').args.properties), 'brain.generate cannot pick llm');
  assert.equal(getAction('brain.generate.llm').fixed.mode, 'llm');
  for (const a of ACTIONS) assert.ok(a.args.additionalProperties === false || a.args.additionalProperties === true, a.id);
});

test('findActions: ranking, filters, limits', () => {
  const top = (q, o) => findActions(q, o).map((r) => r.id);
  assert.equal(top('schedule a post')[0], 'queue.post.schedule');
  assert.ok(top('unschedule')[0] === 'queue.post.unschedule');
  assert.ok(top('delete bucket').includes('buckets.delete'));
  assert.equal(top('delete bucket')[0], 'buckets.delete');
  assert.ok(top('x monitor sync').slice(0, 5).some((id) => id.startsWith('xmonitor.sync')));
  assert.equal(findActions('queue.post.update')[0].id, 'queue.post.update', 'exact id wins');
  // maxTier / group filters
  assert.ok(findActions('post', { maxTier: 1 }).every((r) => r.tier <= 1));
  assert.ok(findActions('', { group: 'buckets' }).every((r) => r.group === 'buckets'));
  assert.ok(findActions('', { group: 'buckets' }).length >= 5);
  assert.equal(findActions('post', { limit: 3 }).length, 3);
  assert.deepEqual(findActions('zzzznotathing'), []);
  // compact shape
  const r = findActions('edit queued post')[0];
  assert.deepEqual(Object.keys(r).sort(), ['args', 'external', 'group', 'id', 'tier', 'title']);
  assert.ok(r.args.includes('postId*'));
  assert.deepEqual(summarizeArgs(getAction('queue.post.update').args).slice(0, 2), ['postId*', 'content']);
});

test('groups: every declared group is used, none is unknown, counts are stable-ish', () => {
  const used = new Set(ACTIONS.map((a) => a.group));
  for (const g of used) assert.ok(GROUPS.includes(g), g);
  for (const g of ['queue', 'calendar', 'content', 'buckets', 'strategy', 'brain', 'signals', 'digest', 'refresh', 'xmonitor', 'media', 'nas', 'other']) assert.ok(used.has(g), `group ${g} empty`);
});
