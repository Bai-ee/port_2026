import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAsyncBirdRunner, ingestHandle, classifyBirdError, probeBirdVersion, BIRD_FAILURE } from '../ingest.js';
import { makePages, FIXTURE_HANDLE } from './fixtures/timeline-fixture.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const FIX = path.join(HERE, 'fixtures');
const GOLDEN = path.join(FIX, 'golden');
const CLI = path.join(REPO, 'scripts/x-content/ingest-corpus.mjs');
const GOLDEN_OUT_REL = 'features/x-strategy/__tests__/fixtures/golden';

/** Fake runBird serving the fixture pages by cursor; failOn = cursor name that throws. Records every call. */
function fakeBird({ failOn, failWith } = {}) {
  const pages = makePages();
  const calls = [];
  const run = (args) => {
    calls.push(args);
    const ci = args.indexOf('--cursor');
    const cursor = ci === -1 ? null : args[ci + 1];
    if (failOn && failOn === (cursor || 'first')) {
      throw Object.assign(new Error('Command failed'), { stderr: failWith || 'boom' });
    }
    return `banner\n${JSON.stringify(pages[cursor ? Number(cursor.slice(1)) : 0])}\n`;
  };
  run.calls = calls;
  return run;
}

// ---- golden: CLI output byte-identical to the PRE-refactor CLI (goldens captured from the original code) ----

function runCli(name, argv, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ingest-golden-'));
  const out = path.join(dir, 'rows.json');
  const useOut = argv.includes('--out');
  const full = useOut ? [...argv, out] : argv;
  const r = spawnSync('node', [CLI, ...full], {
    cwd: REPO, encoding: 'utf8',
    env: { ...process.env, BIRD: path.join(FIX, 'fake-bird.mjs'), ...env },
  });
  return { r, out };
}

const golden = (f) => readFileSync(path.join(GOLDEN, f), 'utf8');
const goldenExit = (n) => (existsSync(path.join(GOLDEN, `${n}.exit`)) ? Number(golden(`${n}.exit`)) : 0);

for (const [name, argv, env] of [
  ['A', ['--handle', '@fixture_handle', '--since', '2026-09-01T00:00:00.000Z', '--tz', '-5', '--lanes', 'web,brand', '--out'], {}],
  ['B', ['--handle', '@fixture_handle', '--since', '2026-09-01T00:00:00.000Z', '--out'], { FAKE_BIRD_FAIL_ON: 'c2' }],
  ['C', ['--handle', '@fixture_handle', '--since', '2026-10-07T00:00:00.000Z', '--tz', '2', '--out'], {}],
]) {
  test(`golden ${name}: CLI stdout/stderr/--out byte-identical to pre-refactor capture`, () => {
    const { r, out } = runCli(name, argv, env);
    assert.equal(r.status, goldenExit(name));
    assert.equal(r.stdout, golden(`${name}.stdout`));
    assert.equal(r.stderr.replace(out, `${GOLDEN_OUT_REL}/${name}.rows.json`), golden(`${name}.stderr`));
    assert.equal(readFileSync(out, 'utf8'), golden(`${name}.rows.json`));
  });
}

test('golden D: zero posts -> same message, exit 1, empty stdout', () => {
  const { r } = runCli('D', ['--handle', 'fixture_handle', '--since', '2026-09-01T00:00:00.000Z'], { FAKE_BIRD_FAIL_ON: 'first' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, golden('D.stdout'));
  assert.equal(r.stderr, golden('D.stderr'));
});

test('golden E/F: missing handle and bad --source unchanged', () => {
  const e = runCli('E', []);
  assert.equal(e.r.status, 1);
  assert.equal(e.r.stderr, golden('E.stderr'));
  const f = runCli('F', ['--handle', 'x', '--source', 'scrape']);
  assert.equal(f.r.status, 1);
  assert.equal(f.r.stderr, golden('F.stderr'));
});

// ---- characterization of ingestHandle with an injected runBird ----

const SINCE_OLD = '2026-09-01T00:00:00.000Z';

test('pages with cursor until exhausted; dedupes; rows newest-first; shape of result', async () => {
  const runBird = fakeBird();
  const logs = [];
  const res = await ingestHandle({ handle: '@' + FIXTURE_HANDLE, since: SINCE_OLD, runBird, log: (l) => logs.push(l) });
  assert.equal(runBird.calls.length, 3);
  assert.deepEqual(runBird.calls[0], ['user-tweets', `@${FIXTURE_HANDLE}`, '-n', '200', '--max-pages', '10', '--delay', '1200', '--json']);
  assert.deepEqual(runBird.calls[1].slice(-2), ['--cursor', 'c1']);
  assert.equal(res.rows.length, 36);
  assert.ok(res.rows[0].utc > res.rows[35].utc);
  assert.deepEqual(Object.keys(res).sort(), ['dropped', 'meta', 'pull', 'rows', 'since', 'stats', 'watchlist']);
  assert.equal(res.pull.stopped, 'exhausted');
  assert.equal(res.meta.source, 'bird');
  assert.equal(res.meta.posts, 36);
  assert.equal(res.meta.clientId, null);
  assert.equal(logs[0], `Pulling @${FIXTURE_HANDLE} back to 2026-09-01…`);
  assert.equal(logs[1], 'round 1: +12 (total 12) oldest=2026-10-07');
});

test('cutoff: stops once a page reaches past since; older rows dropped by normalize', async () => {
  const runBird = fakeBird();
  const res = await ingestHandle({ handle: FIXTURE_HANDLE, since: '2026-10-07T00:00:00.000Z', runBird });
  assert.equal(runBird.calls.length, 2); // page 2 oldest (10-04) < cutoff -> no 3rd call
  assert.equal(res.pull.stopped, 'cutoff');
  assert.equal(res.rows.length, 15);
  assert.equal(res.dropped, 9);
});

test('rounds cap is honoured', async () => {
  const runBird = fakeBird();
  const res = await ingestHandle({ handle: FIXTURE_HANDLE, since: SINCE_OLD, rounds: 1, runBird });
  assert.equal(runBird.calls.length, 1);
  assert.equal(res.rows.length, 12);
  assert.equal(res.pull.stopped, 'rounds-exhausted');
});

test('since defaults to now - days (injected clock)', async () => {
  const now = Date.parse('2026-10-10T00:00:00.000Z');
  const res = await ingestHandle({ handle: FIXTURE_HANDLE, days: 2, now, runBird: fakeBird() });
  assert.equal(res.since, '2026-10-08T00:00:00.000Z');
});

test('error mid-pull keeps partial rows and reports a typed failure', async () => {
  const runBird = fakeBird({ failOn: 'c2', failWith: 'HTTP 429 Too Many Requests' });
  const res = await ingestHandle({ handle: FIXTURE_HANDLE, since: SINCE_OLD, runBird });
  assert.equal(res.rows.length, 24);
  assert.equal(res.pull.stopped, 'error');
  assert.equal(res.pull.error.kind, BIRD_FAILURE.RATE_LIMITED);
});

test('failure on round 1 -> throws NO_POSTS carrying pull.error', async () => {
  const runBird = fakeBird({ failOn: 'first', failWith: 'EPERM: operation not permitted, open Cookies.binarycookies' });
  await assert.rejects(
    () => ingestHandle({ handle: FIXTURE_HANDLE, since: SINCE_OLD, runBird }),
    (e) => e.code === 'NO_POSTS' && e.pull.error.kind === BIRD_FAILURE.COOKIE_ACCESS,
  );
});

test('non-JSON output stops the chain without throwing when rows exist', async () => {
  let n = 0;
  const pages = makePages();
  const runBird = () => { n += 1; return n === 1 ? JSON.stringify(pages[0]) : 'garbage'; };
  const res = await ingestHandle({ handle: FIXTURE_HANDLE, since: SINCE_OLD, runBird });
  assert.equal(res.rows.length, 12);
  assert.equal(res.pull.error.message, 'no JSON in output');
});

test('async runBird is awaited; bad input rejected', async () => {
  const pages = makePages();
  const res = await ingestHandle({ handle: FIXTURE_HANDLE, since: SINCE_OLD, rounds: 1, runBird: async () => JSON.stringify(pages[0]) });
  assert.equal(res.rows.length, 12);
  await assert.rejects(() => ingestHandle({ handle: '  ', runBird: () => '' }), { code: 'NO_HANDLE' });
  await assert.rejects(() => ingestHandle({ handle: 'x' }), { code: 'NO_RUNNER' });
});

test('classifyBirdError', () => {
  assert.equal(classifyBirdError({ stderr: 'Error 429' }), 'rate-limited');
  assert.equal(classifyBirdError({ message: 'rate limit exceeded' }), 'rate-limited');
  assert.equal(classifyBirdError({ stderr: 'EPERM x' }), 'cookie-access');
  assert.equal(classifyBirdError(new Error('weird')), 'error');
  assert.equal(classifyBirdError(null), 'error');
});

test('probeBirdVersion: uses --version with timeout; maps success and failure (injected exec, no real bird)', async () => {
  let seen;
  const ok = await probeBirdVersion({ bird: '/x/bird', exec: (b, a, o, cb) => { seen = { b, a, o }; cb(null, '0.8.0\n'); } });
  assert.deepEqual(seen.a, ['--version']);
  assert.equal(seen.o.timeout, 5000);
  assert.deepEqual(ok, { available: true, path: '/x/bird', version: '0.8.0' });
  const bad = await probeBirdVersion({ bird: 'bird', exec: (b, a, o, cb) => cb(Object.assign(new Error('nf'), { code: 'ENOENT' })) });
  assert.equal(bad.available, false);
  assert.equal(bad.error, 'ENOENT');
});

test('classifyBirdError: timeout shapes', () => {
  assert.equal(classifyBirdError({ code: 'ETIMEDOUT', message: 'x' }), 'timeout');
  assert.equal(classifyBirdError({ killed: true, signal: 'SIGTERM', message: 'Command failed' }), 'timeout');
});

test('createAsyncBirdRunner: passes timeout (env override), cookie source, maps kill to ETIMEDOUT', async () => {
  let seen;
  const exec = (bin, args, opts, cb) => { seen = { bin, args, opts }; cb(null, 'out', ''); };
  assert.equal(await createAsyncBirdRunner({ bird: 'b', cookieSource: 'chrome', exec, env: {} })(['x']), 'out');
  assert.equal(seen.opts.timeout, 90000);
  assert.deepEqual(seen.args, ['x', '--cookie-source', 'chrome']);
  await createAsyncBirdRunner({ bird: 'b', exec, env: { X_STRATEGY_BIRD_TIMEOUT_MS: '1234' } })(['x']);
  assert.equal(seen.opts.timeout, 1234);
  const killed = (b, a, o, cb) => cb(Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' }), '', '');
  await assert.rejects(createAsyncBirdRunner({ bird: 'b', exec: killed, env: {} })(['x']), (e) => classifyBirdError(e) === 'timeout' && /timed out/.test(e.message));
});
