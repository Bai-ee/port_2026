import test from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../registry.js';
import { handleRpc, RESULT_MAX_CHARS } from '../jsonrpc.js';
import { runGetDocumentField } from '../firestore-query.js';
import { capText } from '../redact.js';
import { buildInstructions } from '../instructions.js';
import { createFakeDb } from './fake-db.js';

const OWNER = 'bryan-balli-WUoltG84';
const CQ = 'paradice-dbBQCHUX';
const SK = ['s', 'k', '-'].join('');

// A dashboard_state doc whose audienceSummary sits after ~45 KB of other keys, like CQ's.
const warm = Array.from({ length: 400 }, (_, i) => ({ accountId: String(1000 + i), handle: `fan${i}`, rank: i + 1, classification: i % 2 ? 'collector' : 'artist', note: 'n'.repeat(60) }));
const methodology = 'm'.repeat(70000);
const dash = {
  marketingBrief: { body: 'b'.repeat(45000) },
  audienceSummary: { accountIds: warm.map((w) => w.accountId), warmFollowers: warm, classifications: { collector: 200, artist: 200 }, methodology },
  xAccessToken: SK + 'abcdefghijklmnopqrstuvwxyz123456',
  nested: { refresh_token: 'abc', plain: 'ok', key: SK + 'abcdefghijklmnopqrstuvwxyz123456' },
};
const db = () => createFakeDb({ [`dashboard_state/${CQ}`]: dash, [`clients/${OWNER}`]: { name: 'Bryan' }, 'users/u1': { email: 'x@y.z' } });
const ctx = () => ({ db: db(), email: 'bryanballi@gmail.com', clientId: OWNER, now: () => 0, services: {} });
const call = async (name, args) => {
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { registry, ctx: ctx(), instructions: '' });
  return r.body.result;
};
const textOf = (res) => JSON.parse(res.content[0].text);

test('get_document_field is registered read-only', () => {
  const t = registry.find((x) => x.name === 'get_document_field');
  assert.ok(t);
  assert.equal(t.annotations.readOnlyHint, true);
  assert.deepEqual(t.inputSchema.required, ['path']);
});

test('root of a too-big doc returns its keys with sizes, never truncated', async () => {
  const res = await call('get_document_field', { path: `dashboard_state/${CQ}` });
  assert.equal(res.isError, undefined);
  assert.ok(res.content[0].text.length <= RESULT_MAX_CHARS);
  const out = textOf(res);
  assert.equal(out.tooBigForOneRead, true);
  assert.deepEqual(out.keys.map((k) => k.key).sort(), ['audienceSummary', 'marketingBrief', 'nested', 'xAccessToken']);
  assert.equal(out.keys.find((k) => k.key === 'xAccessToken').chars, JSON.stringify('[redacted]').length, 'sized after redaction');
});

test('the WHOLE audienceSummary is reachable across pages and matches the stored value', async () => {
  const top = textOf(await call('get_document_field', { path: `dashboard_state/${CQ}`, field: 'audienceSummary' }));
  assert.equal(top.tooBigForOneRead, true);
  const rebuilt = {};
  for (const { key, type } of top.keys) {
    if (type === 'array' || type === 'string') {
      let offset = 0; let acc = type === 'array' ? [] : '';
      for (let guard = 0; guard < 50; guard += 1) {
        const res = await call('get_document_field', { path: `dashboard_state/${CQ}`, field: `audienceSummary.${key}`, offset });
        assert.equal(res.isError, undefined);
        assert.ok(res.content[0].text.length <= RESULT_MAX_CHARS, `${key} page fits without truncation`);
        assert.doesNotMatch(res.content[0].text, /\[truncated/);
        const page = textOf(res);
        acc = type === 'array' ? acc.concat(page.items) : acc + page.value;
        if (page.nextOffset === undefined) break;
        offset = page.nextOffset;
      }
      rebuilt[key] = acc;
    } else {
      rebuilt[key] = textOf(await call('get_document_field', { path: `dashboard_state/${CQ}`, field: `audienceSummary.${key}` })).value;
    }
  }
  assert.deepEqual(rebuilt, dash.audienceSummary);
});

test('arrays: explicit offset/limit and numeric index paths', async () => {
  const p = textOf(await call('get_document_field', { path: `dashboard_state/${CQ}`, field: 'audienceSummary.warmFollowers', offset: 10, limit: 5 }));
  assert.equal(p.total, 400); assert.equal(p.offset, 10); assert.equal(p.returned, 5); assert.equal(p.nextOffset, 15);
  assert.equal(p.items[0].handle, 'fan10');
  const one = textOf(await call('get_document_field', { path: `dashboard_state/${CQ}`, field: 'audienceSummary.warmFollowers.3.handle' }));
  assert.equal(one.value, 'fan3');
});

test('secrets: credential-looking segments refused; redaction applied inside returned values', async () => {
  for (const field of ['xAccessToken', 'nested.refresh_token', 'nested.apiKey', 'audienceSummary.sessionId']) {
    const r = await call('get_document_field', { path: `dashboard_state/${CQ}`, field });
    assert.equal(r.isError, true, field);
  }
  const nested = textOf(await call('get_document_field', { path: `dashboard_state/${CQ}`, field: 'nested' }));
  assert.equal(nested.value.refresh_token, '[redacted]');
  assert.equal(nested.value.plain, 'ok');
  assert.equal(nested.value.key, '[redacted]', 'value pattern still redacted');
  const key = textOf(await call('get_document_field', { path: `dashboard_state/${CQ}`, field: 'nested.key' }));
  assert.equal(key.value, '[redacted]');
});

test('denied paths, collection paths, bad fields and missing docs', async () => {
  assert.equal((await call('get_document_field', { path: 'users/u1', field: 'email' })).isError, true);
  assert.equal((await call('get_document_field', { path: 'system_flags/x_oauth_tokens' })).isError, true);
  assert.equal((await call('get_document_field', { path: 'dashboard_state' })).isError, true);
  assert.equal((await call('get_document_field', { path: `dashboard_state/${CQ}`, field: 'a..b' })).isError, true);
  assert.equal((await call('get_document_field', { path: `dashboard_state/${CQ}`, field: 'nope' })).isError, true);
  assert.equal((await call('get_document_field', { path: `dashboard_state/${CQ}`, field: 'audienceSummary.warmFollowers.999' })).isError, true);
  assert.deepEqual(textOf(await call('get_document_field', { path: 'dashboard_state/ghost-client' })), { path: 'dashboard_state/ghost-client', exists: false });
  await assert.rejects(runGetDocumentField(db(), { path: `dashboard_state/${CQ}`, field: 'audienceSummary.methodology', offset: -1 }));
});

test('an array element bigger than one page points at the element path', async () => {
  const big = createFakeDb({ 'dashboard_state/c1': { rows: [{ text: 'x'.repeat(40000) }, { text: 'y' }] } });
  const out = await runGetDocumentField(big, { path: 'dashboard_state/c1', field: 'rows' });
  assert.equal(out.tooBigForOneRead, true);
  assert.match(out.howToRead, /rows\.0/);
  const s = await runGetDocumentField(big, { path: 'dashboard_state/c1', field: 'rows.0.text', offset: 35000 });
  assert.equal(s.returned, 5000); assert.equal(s.nextOffset, undefined);
});

test('truncation hint names a tool that exists; instructions mention it', () => {
  const { text } = capText({ s: 'x'.repeat(500) }, 100);
  assert.match(text, /get_document_field/);
  assert.doesNotMatch(text, /fields\)/);
  assert.match(buildInstructions(), /get_document_field/);
});

test('a string full of escaped characters still pages within the result cap', async () => {
  const text = '"\n'.repeat(40000);
  const d = createFakeDb({ 'dashboard_state/c1': { notes: text } });
  let offset = 0; let acc = '';
  for (let guard = 0; guard < 20; guard += 1) {
    const page = await runGetDocumentField(d, { path: 'dashboard_state/c1', field: 'notes', offset });
    assert.ok(JSON.stringify(page, null, 1).length <= RESULT_MAX_CHARS - 2000);
    acc += page.value;
    if (page.nextOffset === undefined) break;
    offset = page.nextOffset;
  }
  assert.equal(acc, text);
});

test('arrays of short nested arrays (indent blow-up) still fit every page, and rebuild exactly', async () => {
  const rows = Array.from({ length: 3000 }, (_, i) => [i, i + 1, i + 2, 0, 1]);
  const d = createFakeDb({ 'dashboard_state/c1': { rows } });
  let offset = 0; let acc = [];
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await runGetDocumentField(d, { path: 'dashboard_state/c1', field: 'rows', offset });
    assert.ok(JSON.stringify(page, null, 1).length <= RESULT_MAX_CHARS - 2000);
    acc = acc.concat(page.items);
    if (page.nextOffset === undefined) break;
    offset = page.nextOffset;
  }
  assert.deepEqual(acc, rows);
});

test('a huge map pages its key list; odd keys are marked unreachable', async () => {
  const map = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`acct${i}`, { n: i, s: 'z'.repeat(20) }]));
  map['has.dot'] = 1;
  const d = createFakeDb({ 'dashboard_state/c1': { map } });
  const seen = [];
  let offset = 0;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await runGetDocumentField(d, { path: 'dashboard_state/c1', field: 'map', offset });
    assert.ok(JSON.stringify(page, null, 1).length <= RESULT_MAX_CHARS - 2000);
    assert.equal(page.totalKeys, 5001);
    seen.push(...page.keys);
    if (page.nextOffset === undefined) break;
    offset = page.nextOffset;
  }
  assert.equal(seen.length, 5001);
  assert.equal(seen.find((k) => k.key === 'has.dot').reachable, false);
  assert.equal(seen.find((k) => k.key === 'acct7').reachable, undefined);
});

test('leading-zero array index is an error, not undefined', async () => {
  await assert.rejects(runGetDocumentField(db(), { path: `dashboard_state/${CQ}`, field: 'audienceSummary.warmFollowers.01' }));
});
