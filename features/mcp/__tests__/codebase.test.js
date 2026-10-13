import test from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../registry.js';
import { handleRpc } from '../jsonrpc.js';
import { cleanRepoPath, sliceLines, stripQualifiers, READ_MAX_CHARS } from '../tools/codebase.js';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const TREE = { truncated: false, tree: [
  { path: 'CHANGELOG.md', type: 'blob', size: 10 },
  { path: 'docs', type: 'tree' },
  { path: 'docs/source-of-truth', type: 'tree' },
  { path: 'docs/source-of-truth/X-STRATEGY-TAB.md', type: 'blob', size: 500 },
  { path: 'docs/source-of-truth/HITLOOP-MCP-SERVER.md', type: 'blob', size: 800 },
  { path: 'features/x-strategy/agent/tools.js', type: 'blob', size: 20000 },
  { path: 'features/x-strategy/agent/huge.js', type: 'blob', size: 900000 },
  { path: 'features/mcp/oauth.js', type: 'blob', size: 3000 },
] };
const RAW = {
  'docs/source-of-truth/X-STRATEGY-TAB.md': 'line1\nstrategy rules here\nline3\n',
  'features/x-strategy/agent/tools.js': 'export const a = 1;\n// strategy tools\n',
  'features/mcp/oauth.js': 'binary\u0000data',
  'big.txt': `${'x'.repeat(100)}\n`.repeat(2000),
};

function fakeFetch({ rateLimit = false, status = {} } = {}) {
  const log = [];
  const fn = async (url, init = {}) => {
    log.push({ url, headers: init.headers || {} });
    const res = (body, st = 200, headers = {}) => ({ status: st, ok: st < 400, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (rateLimit && url.startsWith('https://api.github.com')) return res({ message: 'rate limit' }, 403, { 'x-ratelimit-remaining': '0' });
    if (url.includes('/git/trees/')) return res(TREE);
    if (url.includes('/search/code')) return res({ total_count: 3, items: [
      { path: 'features/mcp/oauth.js', repository: { full_name: 'Bai-ee/port_2026' }, text_matches: [{ fragment: 'verifyPkceS256(...)' }] },
      { path: 'secrets/private.js', repository: { full_name: 'Bai-ee/private-repo' }, text_matches: [{ fragment: 'PRIVATE CODE' }] },
      { path: 'no/repo-field.js', text_matches: [{ fragment: 'unknown origin' }] },
    ] });
    if (url.includes('/commits')) return res([{ sha: 'abcdef1234567890', commit: { author: { name: 'Bai', date: '2026-10-11' }, message: 'feat: thing\n\nbody' } }]);
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      const path = decodeURIComponent(url.split('/main/')[1]);
      if (status[path]) return res('', status[path]);
      return RAW[path] === undefined ? res('', 404) : res(RAW[path]);
    }
    return res('', 500);
  };
  fn.log = log;
  return fn;
}
const makeCtx = (opts = {}) => ({ db: null, email: 'o@x.test', clientId: 'c', now: () => NOW, services: { fetch: fakeFetch(opts), githubToken: opts.token || null, treeCache: { tree: null, at: 0 } } });
const call = async (name, args, ctx) => (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { registry, ctx, instructions: '' })).body.result;
const out = (r) => JSON.parse(r.content[0].text);

test('path cleaning rejects traversal and odd characters', () => {
  assert.equal(cleanRepoPath('/docs/x.md'), 'docs/x.md');
  for (const bad of ['../etc/passwd', 'a/../b', 'a b;rm', 'a//b', '', 'a\\b']) assert.throws(() => cleanRepoPath(bad), bad);
  assert.equal(cleanRepoPath('', { allowEmpty: true }), '');
});

test('list_repo_path: root, nested, dirs first; missing path is an error; tree fetched once and cached', async () => {
  const ctx = makeCtx();
  const root = out(await call('list_repo_path', {}, ctx));
  assert.deepEqual(root.entries.map((e) => `${e.type}:${e.name}`), ['dir:docs', 'dir:features', 'file:CHANGELOG.md']);
  const sub = out(await call('list_repo_path', { path: 'docs/source-of-truth' }, ctx));
  assert.deepEqual(sub.entries.map((e) => e.name), ['HITLOOP-MCP-SERVER.md', 'X-STRATEGY-TAB.md']);
  assert.equal((await call('list_repo_path', { path: 'nope' }, ctx)).isError, true);
  assert.equal(ctx.services.fetch.log.filter((l) => l.url.includes('/git/trees/')).length, 1);
});

test('tree cache expires after 10 minutes', async () => {
  const ctx = makeCtx();
  await call('list_repo_path', {}, ctx);
  ctx.now = () => NOW + 11 * 60 * 1000;
  await call('list_repo_path', {}, ctx);
  assert.equal(ctx.services.fetch.log.filter((l) => l.url.includes('/git/trees/')).length, 2);
});

test('read_repo_file: whole file, line range, 404, binary, traversal', async () => {
  const ctx = makeCtx();
  const f = out(await call('read_repo_file', { path: 'docs/source-of-truth/X-STRATEGY-TAB.md' }, ctx));
  assert.equal(f.totalLines, 4);
  assert.match(f.content, /strategy rules here/);
  const r = out(await call('read_repo_file', { path: 'docs/source-of-truth/X-STRATEGY-TAB.md', startLine: 2, endLine: 2 }, ctx));
  assert.equal(r.content, 'strategy rules here');
  assert.deepEqual([r.startLine, r.endLine], [2, 2]);
  assert.match((await call('read_repo_file', { path: 'missing.md' }, ctx)).content[0].text, /not found/i);
  assert.match((await call('read_repo_file', { path: 'features/mcp/oauth.js' }, ctx)).content[0].text, /binary/);
  assert.equal((await call('read_repo_file', { path: '../secrets' }, ctx)).isError, true);
  assert.equal((await call('read_repo_file', { path: 'docs/source-of-truth/X-STRATEGY-TAB.md', startLine: 99 }, ctx)).isError, true);
  assert.ok(!ctx.services.fetch.log.some((l) => l.url.startsWith('https://api.github.com')), 'file reads must not use the rate-limited API');
});

test('read_repo_file caps at 120k characters and reports the last line shown', () => {
  const s = sliceLines(RAW['big.txt'], 1, undefined);
  assert.equal(s.truncated, true);
  assert.ok(s.content.length <= READ_MAX_CHARS);
  assert.ok(s.endLine < s.totalLines);
});

test('search_repo without a token: path match, and grep only on request and only small files', async () => {
  const ctx = makeCtx();
  const r = out(await call('search_repo', { query: 'x-strategy' }, ctx));
  assert.equal(r.mode, 'path-match');
  assert.deepEqual(r.results.map((x) => x.path), ['docs/source-of-truth/X-STRATEGY-TAB.md', 'features/x-strategy/agent/tools.js', 'features/x-strategy/agent/huge.js']);
  assert.equal(r.grep, undefined);
  const g = out(await call('search_repo', { query: 'strategy', grep: true, pathPrefix: 'features' }, ctx));
  assert.deepEqual(g.grep.map((x) => x.path), ['features/x-strategy/agent/tools.js']); // huge.js skipped, docs outside prefix
  assert.equal(g.grep[0].hits[0].line, 2);
  const none = out(await call('search_repo', { query: 'zzzzqqq' }, ctx));
  assert.equal(none.totalMatches, 0);
});

test('search_repo with GITHUB_TOKEN uses code search with the token', async () => {
  const ctx = makeCtx({ token: 'ghp_testtoken' });
  const r = out(await call('search_repo', { query: 'verifyPkceS256', pathPrefix: 'features' }, ctx));
  assert.equal(r.mode, 'github-code-search');
  assert.equal(r.results[0].path, 'features/mcp/oauth.js');
  const req = ctx.services.fetch.log.find((l) => l.url.includes('/search/code'));
  assert.equal(req.headers.authorization, 'Bearer ghp_testtoken');
  assert.match(decodeURIComponent(req.url), /repo:Bai-ee\/port_2026 path:features/);
});

test('search_repo strips search qualifiers, always pins repo:Bai-ee/port_2026, and drops hits from any other repo', async () => {
  assert.equal(stripQualifiers('foo repo:other/private org:acme -repo:x user:me path:secrets bar'), 'foo other/private acme x me secrets bar'); // qualifier words are removed, the values stay as plain search words
  assert.equal(stripQualifiers('repo:a/b'), 'a/b');
  assert.equal(stripQualifiers('verifyPkce'), 'verifyPkce');
  const ctx = makeCtx({ token: 'ghp_testtoken' });
  const r = out(await call('search_repo', { query: 'verifyPkceS256 repo:Bai-ee/private-repo org:Bai-ee user:Bai-ee' }, ctx));
  const req = ctx.services.fetch.log.find((l) => l.url.includes('/search/code'));
  const q = decodeURIComponent(new URL(req.url).searchParams.get('q'));
  assert.equal((q.match(/repo:/g) || []).length, 1, q);
  assert.match(q, /repo:Bai-ee\/port_2026$/);
  assert.ok(!/org:|user:|private-repo:/.test(q), q);
  assert.deepEqual(r.results.map((x) => x.path), ['features/mcp/oauth.js'], 'foreign-repo and repo-less hits are dropped');
  assert.ok(!JSON.stringify(r).includes('PRIVATE CODE'));
  const none = await call('search_repo', { query: 'repo:Bai-ee/private-repo' }, makeCtx({ token: 'ghp_testtoken' }));
  assert.equal(out(none).results.length, 1, 'the remaining words still search');
});

test('recent_commits shapes the list', async () => {
  const r = out(await call('recent_commits', { limit: 5, path: 'features/mcp' }, makeCtx()));
  assert.deepEqual(r.commits[0], { sha: 'abcdef12', date: '2026-10-11', author: 'Bai', message: 'feat: thing' });
});

test('GitHub rate limits give a clear error naming the fix; raw file reads still work', async () => {
  const ctx = makeCtx({ rateLimit: true });
  const e = await call('recent_commits', {}, ctx);
  assert.equal(e.isError, true);
  assert.match(e.content[0].text, /rate limit/i);
  assert.match(e.content[0].text, /GITHUB_TOKEN/);
  assert.equal((await call('read_repo_file', { path: 'docs/source-of-truth/X-STRATEGY-TAB.md' }, ctx)).isError, undefined);
});
