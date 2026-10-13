// codebase.js - read-only access to the public HITLOOP repo (Bai-ee/port_2026, branch main) over HTTPS.
// fetch is injected (ctx.services.fetch) so tests never touch the network. GITHUB_TOKEN (ctx.services.githubToken)
// is optional: it only raises the GitHub API rate limit and enables code search.

import { ToolError } from '../jsonrpc.js';
import { defTool, str, int } from './common.js';

export const REPO = Object.freeze({ owner: 'Bai-ee', name: 'port_2026', branch: 'main' });
export const READ_MAX_CHARS = 120000;
export const TREE_TTL_MS = 10 * 60 * 1000;
const GREP_MAX_FILES = 20;
const GREP_MAX_BYTES = 120000;
const PATH_RE = /^[A-Za-z0-9_\-.@()[\]+= /]{0,300}$/;

const GUIDE = 'Map: call get_hitloop_guide first (repo map; CLAUDE.md itself is local-only and not on GitHub), then docs/source-of-truth/*.md for each feature\'s as-built spec (e.g. X-STRATEGY-TAB.md, CONTENT-MANAGEMENT.md, HITLOOP-MCP-SERVER.md), docs/plans/* for handoffs.';

export const REPO_FULL_NAME = `${REPO.owner}/${REPO.name}`;

/** Remove GitHub search qualifiers (`repo:`, `org:`, `user:`, `path:`, `-repo:` ...): the repo scope is ours, not the caller's. */
export function stripQualifiers(raw) {
  return String(raw ?? '').replace(/-?[\w.-]+:/g, ' ').replace(/\s+/g, ' ').trim();
}

export function cleanRepoPath(raw, { allowEmpty = false } = {}) {
  const p = String(raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!p) { if (allowEmpty) return ''; throw new ToolError('path is required.'); }
  if (!PATH_RE.test(p) || p.split('/').some((s) => s === '..' || s === '.' || s === '')) throw new ToolError('path contains characters that are not allowed.');
  return p;
}

function ghHeaders(ctx, extra = {}) {
  const h = { accept: 'application/vnd.github+json', 'user-agent': 'hitloop-mcp', ...extra };
  if (ctx.services.githubToken) h.authorization = `Bearer ${ctx.services.githubToken}`;
  return h;
}

function rateLimited(res) {
  return res.status === 429 || (res.status === 403 && res.headers?.get?.('x-ratelimit-remaining') === '0');
}

async function gh(ctx, url, extraHeaders) {
  const res = await ctx.services.fetch(url, { headers: ghHeaders(ctx, extraHeaders) });
  if (rateLimited(res)) {
    throw new ToolError(`GitHub API rate limit reached${ctx.services.githubToken ? '' : ' (unauthenticated: 60 requests/hour). Set GITHUB_TOKEN on the server to raise it'}. read_repo_file does not use the API and still works.`);
  }
  if (res.status === 404) throw new ToolError('Not found on GitHub (check the path).');
  if (!res.ok) throw new ToolError(`GitHub returned HTTP ${res.status}.`);
  return res.json();
}

/** Recursive git tree, cached in memory for 10 minutes. */
export async function loadTree(ctx) {
  const cache = ctx.services.treeCache;
  const now = ctx.now();
  if (cache.tree && now - cache.at < TREE_TTL_MS) return cache.tree;
  const data = await gh(ctx, `https://api.github.com/repos/${REPO.owner}/${REPO.name}/git/trees/${REPO.branch}?recursive=1`);
  const tree = { entries: (data.tree || []).map((e) => ({ path: e.path, type: e.type === 'tree' ? 'dir' : 'file', size: e.size ?? null })), truncated: Boolean(data.truncated) };
  cache.tree = tree; cache.at = now;
  return tree;
}

async function fetchRaw(ctx, path) {
  const res = await ctx.services.fetch(`https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.branch}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: { 'user-agent': 'hitloop-mcp' } });
  if (res.status === 404) throw new ToolError(`File not found: ${path}. Use list_repo_path or search_repo to find it.`);
  if (!res.ok) throw new ToolError(`raw.githubusercontent.com returned HTTP ${res.status}.`);
  return res.text();
}

export function sliceLines(text, startLine, endLine, max = READ_MAX_CHARS) {
  const lines = text.split('\n');
  const total = lines.length;
  const from = Math.max(1, Math.floor(startLine || 1));
  const to = Math.min(total, Math.floor(endLine || total));
  if (from > total) throw new ToolError(`startLine ${from} is past the end of the file (${total} lines).`);
  let content = lines.slice(from - 1, to).join('\n');
  let truncated = false;
  let last = to;
  if (content.length > max) {
    content = content.slice(0, max);
    last = from + content.split('\n').length - 1;
    truncated = true;
  }
  return { startLine: from, endLine: last, totalLines: total, truncated, content };
}

const listRepoPath = defTool({
  name: 'list_repo_path',
  title: 'List a repo directory',
  kind: 'external',
  description: `List files and folders at a path in the HITLOOP source repo (${REPO.owner}/${REPO.name}, branch ${REPO.branch}). Empty path = repo root. ${GUIDE} Read-only.`,
  inputSchema: { type: 'object', properties: { path: str('Directory path, e.g. "features/mcp" or "docs/source-of-truth". Empty for the root.') } },
  handler: async ({ args, ctx }) => {
    const dir = cleanRepoPath(args.path, { allowEmpty: true });
    const tree = await loadTree(ctx);
    if (tree.truncated) {
      const data = await gh(ctx, `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${dir}?ref=${REPO.branch}`);
      return { path: dir, entries: (Array.isArray(data) ? data : [data]).map((e) => ({ name: e.name, type: e.type === 'dir' ? 'dir' : 'file', size: e.size ?? null })) };
    }
    const prefix = dir ? `${dir}/` : '';
    const seen = new Map();
    for (const e of tree.entries) {
      if (!e.path.startsWith(prefix) || e.path === dir) continue;
      const rest = e.path.slice(prefix.length);
      const name = rest.split('/')[0];
      if (rest.includes('/')) seen.set(name, { name, type: 'dir', size: null });
      else seen.set(name, { name, type: e.type, size: e.size });
    }
    if (!seen.size) throw new ToolError(`Nothing at "${dir}". It may not exist or be empty.`);
    const entries = [...seen.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    return { path: dir, count: entries.length, entries: entries.slice(0, 500), ...(entries.length > 500 ? { truncated: true } : {}) };
  },
});

const readRepoFile = defTool({
  name: 'read_repo_file',
  title: 'Read a repo file',
  kind: 'external',
  description: `Read a file from the HITLOOP source repo (${REPO.owner}/${REPO.name}, ${REPO.branch}). Returns up to ${READ_MAX_CHARS} characters; pass startLine/endLine to page through a big file (totalLines is returned). Start with get_hitloop_guide for the map, then docs/source-of-truth/<FEATURE>.md for how a feature is built. This is the code on GitHub main, which may differ from what is deployed. Read-only.`,
  inputSchema: { type: 'object', properties: { path: str('File path, e.g. "CLAUDE.md" or "features/x-strategy/agent/tools.js"'), startLine: int('First line (1-based)', { minimum: 1 }), endLine: int('Last line (inclusive)', { minimum: 1 }) }, required: ['path'] },
  handler: async ({ args, ctx }) => {
    const path = cleanRepoPath(args.path);
    const text = await fetchRaw(ctx, path);
    if (text.includes('\u0000')) throw new ToolError('That looks like a binary file; not shown.');
    return { path, ...sliceLines(text, args.startLine, args.endLine) };
  },
});

const searchRepo = defTool({
  name: 'search_repo',
  title: 'Search the repo',
  kind: 'external',
  description: `Find code or docs in the HITLOOP repo. With a server GITHUB_TOKEN this is GitHub code search (matches inside files, with text fragments). Without it, it matches the query words against FILE PATHS (cached git tree) and, with grep:true, also greps inside up to ${GREP_MAX_FILES} small matching files. Good first queries: a feature name ("x-strategy"), a function name, or a doc name. ${GUIDE} Read-only.`,
  inputSchema: { type: 'object', properties: { query: str('Words to look for', { minLength: 2, maxLength: 120 }), pathPrefix: str('Only paths under this directory, e.g. "docs/source-of-truth"'), grep: { type: 'boolean', description: 'Without GITHUB_TOKEN: also grep inside matching files' }, limit: int('Max results (default 20, max 50)', { minimum: 1, maximum: 50 }) }, required: ['query'] },
  handler: async ({ args, ctx }) => {
    const limit = Math.min(args.limit || 20, 50);
    const prefix = args.pathPrefix ? cleanRepoPath(args.pathPrefix) : '';
    const query = stripQualifiers(args.query);
    if (!query) throw new ToolError('query has no searchable words (search qualifiers like repo: or org: are not allowed).');
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (ctx.services.githubToken) {
      const q = encodeURIComponent(`${query} repo:${REPO.owner}/${REPO.name}${prefix ? ` path:${prefix}` : ''}`);
      const data = await gh(ctx, `https://api.github.com/search/code?q=${q}&per_page=${limit}`, { accept: 'application/vnd.github.text-match+json' });
      // Belt and braces: the GitHub token may see private repos, so only ever return hits from the HITLOOP repo itself.
      const items = (data.items || []).filter((i) => i?.repository?.full_name === REPO_FULL_NAME);
      return {
        mode: 'github-code-search', totalCount: data.total_count ?? null,
        results: items.slice(0, limit).map((i) => ({ path: i.path, fragments: (i.text_matches || []).slice(0, 3).map((m) => String(m.fragment || '').slice(0, 300)) })),
      };
    }
    const tree = await loadTree(ctx);
    const matches = tree.entries.filter((e) => e.type === 'file' && (!prefix || e.path.startsWith(`${prefix}/`)) && words.every((w) => e.path.toLowerCase().includes(w)));
    const out = { mode: 'path-match', note: 'No GITHUB_TOKEN on the server: matching file paths only' + (args.grep ? ', plus grep in small matches.' : '. Pass grep:true to also search inside the matching files.'), totalMatches: matches.length, results: matches.slice(0, limit).map((e) => ({ path: e.path, size: e.size })) };
    if (args.grep) {
      const needle = words[0];
      const files = matches.filter((e) => (e.size ?? 0) <= GREP_MAX_BYTES).slice(0, GREP_MAX_FILES);
      out.grep = [];
      for (const f of files) {
        let text;
        try { text = await fetchRaw(ctx, f.path); } catch { continue; }
        const hits = [];
        text.split('\n').forEach((line, i) => { if (hits.length < 5 && line.toLowerCase().includes(needle)) hits.push({ line: i + 1, text: line.trim().slice(0, 200) }); });
        if (hits.length) out.grep.push({ path: f.path, hits });
      }
    }
    return out;
  },
});

const recentCommits = defTool({
  name: 'recent_commits',
  title: 'Recent commits',
  kind: 'external',
  description: `Recent commits on ${REPO.owner}/${REPO.name} ${REPO.branch}: short sha, date, author, first line of the message. Optionally only commits touching a path. Use it to see what changed lately before trusting a doc. Read-only.`,
  inputSchema: { type: 'object', properties: { path: str('Only commits that touch this file or directory'), limit: int('How many (default 15, max 40)', { minimum: 1, maximum: 40 }) } },
  handler: async ({ args, ctx }) => {
    const limit = Math.min(args.limit || 15, 40);
    const path = args.path ? cleanRepoPath(args.path) : '';
    const data = await gh(ctx, `https://api.github.com/repos/${REPO.owner}/${REPO.name}/commits?sha=${REPO.branch}&per_page=${limit}${path ? `&path=${encodeURIComponent(path)}` : ''}`);
    return { branch: REPO.branch, commits: (Array.isArray(data) ? data : []).map((c) => ({ sha: String(c.sha).slice(0, 8), date: c.commit?.author?.date ?? null, author: c.commit?.author?.name ?? null, message: String(c.commit?.message || '').split('\n')[0].slice(0, 200) })) };
  },
});

export const codebaseTools = Object.freeze([listRepoPath, readRepoFile, searchRepo, recentCommits]);
