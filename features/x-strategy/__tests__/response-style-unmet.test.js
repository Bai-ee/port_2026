// Owner reply format (response-style.js) and the "could not do" log (unmet-requests.js), incl. the agent tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextResponseStyle, effectiveResponseStyle, DEFAULT_RESPONSE_STYLE, RESPONSE_STYLE_MAX_CHARS } from '../response-style.js';
import { normalizeUnmet, createMemoryUnmetStore, unmetKeyOf } from '../unmet-requests.js';
import { runReadTool, runStyleTool } from '../agent/tools.js';
import { buildSystemPrompt } from '../agent/prompt.js';

test('response style: default until saved; replace, append, cap, history', () => {
  assert.deepEqual(effectiveResponseStyle(null), { text: DEFAULT_RESPONSE_STYLE, isDefault: true, updatedAt: null });
  const a = nextResponseStyle(null, { text: '  Lead with the number.  ', now: 't1' });
  assert.equal(a.value.text, 'Lead with the number.');
  const b = nextResponseStyle(a.value, { text: 'Tables for comparisons.', mode: 'append', now: 't2' });
  assert.equal(b.value.text, 'Lead with the number.\nTables for comparisons.');
  assert.equal(b.value.history[0].text, 'Lead with the number.');
  const c = nextResponseStyle(b.value, { text: 'x'.repeat(5000) });
  assert.equal(c.value.text.length, RESPONSE_STYLE_MAX_CHARS);
  assert.equal(nextResponseStyle(null, { text: '   ' }).ok, false);
  assert.equal(nextResponseStyle(null, { text: 'a', mode: 'bogus' }).ok, false);
});

test('response style: the system prompt carries it last, labelled default or owner-set', () => {
  const p = buildSystemPrompt({ planSummary: 'x', responseStyle: effectiveResponseStyle({ text: 'Always a table.' }) });
  assert.match(p, /OWNER REPLY FORMAT \(set by the owner/);
  assert.ok(p.trimEnd().endsWith('Always a table.'));
  assert.match(buildSystemPrompt({ planSummary: 'x', responseStyle: effectiveResponseStyle(null) }), /default until the owner sets their own/);
  assert.doesNotMatch(buildSystemPrompt({ planSummary: 'x' }), /OWNER REPLY FORMAT/);
});

test('response style tools: get reads, save appends by default and reports errors', async () => {
  let stored = null;
  const deps = {
    getResponseStyle: async () => stored,
    saveResponseStyle: async ({ text, mode }) => { const n = nextResponseStyle(stored, { text, mode }); if (n.ok) stored = n.value; return n; },
  };
  assert.equal((await runReadTool('get_response_style', {}, deps)).isDefault, true);
  assert.deepEqual(await runStyleTool('save_response_style', { text: 'Short.' }, deps), { saved: true, text: 'Short.' });
  assert.equal((await runStyleTool('save_response_style', { text: 'Links inline.' }, deps)).text, 'Short.\nLinks inline.');
  assert.equal((await runReadTool('get_response_style', {}, deps)).text, 'Short.\nLinks inline.');
  assert.match((await runStyleTool('save_response_style', { text: '' }, deps)).error, /required/);
  assert.match((await runStyleTool('save_response_style', { text: 'a' }, {})).error, /not available/);
});

test('unmet requests: normalized, repeats counted not duplicated, status kept, tools', async () => {
  assert.equal(normalizeUnmet({ request: '' }).ok, false);
  assert.equal(normalizeUnmet({ request: 'x', kind: 'weird' }).entry.kind, 'needs-code');
  const store = createMemoryUnmetStore();
  const deps = {
    logUnmetRequest: async (raw) => { const n = normalizeUnmet(raw); return n.ok ? store.log('c1', n.entry, { now: new Date().toISOString() }) : n; },
    listUnmetRequests: ({ status } = {}) => store.list('c1', { status }),
  };
  const r1 = await runStyleTool('log_unmet_request', { request: 'Post to Instagram', missing: 'no IG publisher', kind: 'needs-code' }, deps);
  const r2 = await runStyleTool('log_unmet_request', { request: '  post to   instagram ', kind: 'needs-code' }, deps);
  assert.equal(r1.id, r2.id);
  assert.equal(r2.count, 2);
  assert.equal(r1.id, unmetKeyOf('Post to Instagram'));
  await store.setStatus('c1', r1.id, 'planned');
  const list = await runReadTool('get_unmet_requests', {}, deps);
  assert.equal(list.requests.length, 1);
  assert.equal(list.requests[0].status, 'planned');
  assert.equal((await runReadTool('get_unmet_requests', { status: 'open' }, deps)).requests.length, 0);
  assert.match((await runStyleTool('log_unmet_request', { request: '' }, deps)).error, /required/);
});
