// ingestHandle: pull one X account's timeline through `bird` and normalize it into corpus rows + stats.
// Extracted from scripts/x-content/ingest-corpus.mjs (T1b). SERVER-ONLY: imports node:child_process / node:fs,
// so it must never be imported by index.js or any client component.
//
// I/O is injected: `runBird(args) -> stdout string` (sync or async, throws on failure; the thrown error may
// carry `.stderr`) and `log(line)`. The default runner is createBirdRunner(). Nothing here writes files,
// Firestore, or exits the process; the CLI wrapper owns argv, stdout summary, --out, --write and exit codes.

import { execFileSync, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { normalizeTimeline } from '../x-benchmark/normalize-corpus.js';
import { summarizeCorpus } from '../x-benchmark/summarize.js';
import { deriveWatchlist } from '../x-benchmark/derive-watchlist.js';

export const DEFAULT_DAYS = 65;
export const MAX_ROUNDS = 12;

/** Typed failure kinds surfaced to the refresh UI. */
export const BIRD_FAILURE = Object.freeze({
  RATE_LIMITED: 'rate-limited',
  COOKIE_ACCESS: 'cookie-access',
  TIMEOUT: 'timeout',
  OTHER: 'error',
});

/** Classify a thrown bird error (stderr + message). EPERM = no permission to read browser cookies. */
export function classifyBirdError(err) {
  const text = `${err?.stderr || ''} ${err?.message || ''} ${err?.code || ''}`;
  if (/\b429\b|rate.?limit|too many requests/i.test(text)) return BIRD_FAILURE.RATE_LIMITED;
  if (/EPERM|operation not permitted/i.test(text)) return BIRD_FAILURE.COOKIE_ACCESS;
  if (err?.code === 'ETIMEDOUT' || err?.killed === true || /ETIMEDOUT|timed out|timeout/i.test(text)) return BIRD_FAILURE.TIMEOUT;
  return BIRD_FAILURE.OTHER;
}

export function resolveBird(env = process.env, exists = existsSync) {
  if (env.BIRD && exists(env.BIRD)) return env.BIRD;
  const candidates = [
    path.join(env.HOME || '', '.local/birdtool/node_modules/.bin/bird'),
    path.join(process.cwd(), 'node_modules/.bin/bird'),
  ];
  return candidates.find((p) => exists(p)) || 'bird';
}

/**
 * Default runBird: execFileSync of the resolved bird binary. `cookieSource` (server path only) appends
 * `--cookie-source <v>`; the CLI passes none so its behaviour is unchanged.
 */
export function createBirdRunner({ bird, cookieSource } = {}) {
  return (args) => {
    const full = cookieSource ? [...args, '--cookie-source', cookieSource] : args;
    return execFileSync(bird || resolveBird(), full, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  };
}

export const DEFAULT_BIRD_TIMEOUT_MS = 90_000;

/**
 * Server-path runner: async execFile (never blocks the event loop) with a per-call timeout
 * (`timeoutMs`, else env X_STRATEGY_BIRD_TIMEOUT_MS, else 90s). A timeout rejects with code 'ETIMEDOUT'
 * (classified as BIRD_FAILURE.TIMEOUT). The sync createBirdRunner above is left untouched for the CLI.
 */
export function createAsyncBirdRunner({ bird, cookieSource, timeoutMs, env = process.env, exec = execFile } = {}) {
  const envMs = Number(env.X_STRATEGY_BIRD_TIMEOUT_MS);
  const limit = timeoutMs ?? (Number.isFinite(envMs) && envMs > 0 ? envMs : DEFAULT_BIRD_TIMEOUT_MS);
  return (args) => new Promise((resolve, reject) => {
    const full = cookieSource ? [...args, '--cookie-source', cookieSource] : args;
    exec(bird || resolveBird(), full, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: limit }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const timedOut = err.killed === true || err.code === 'ETIMEDOUT';
      return reject(Object.assign(err, { stderr: stderr || err.stderr, ...(timedOut ? { code: 'ETIMEDOUT', message: `bird timed out after ${limit}ms` } : {}) }));
    });
  });
}

/** `bird --version` with a timeout. No network, no auth. -> {available, path, version, error?} */
export function probeBirdVersion({ bird = resolveBird(), timeoutMs = 5000, exec = execFile } = {}) {
  return new Promise((resolve) => {
    exec(bird, ['--version'], { encoding: 'utf8', timeout: timeoutMs }, (err, stdout) => {
      if (err) return resolve({ available: false, path: bird, version: null, error: String(err.code || err.message).slice(0, 200) });
      return resolve({ available: true, path: bird, version: String(stdout || '').trim().split('\n')[0] || null });
    });
  });
}

/** Chain bird's paged user-tweets until the cutoff is passed. Failures stop the chain and keep what was pulled. */
async function pullTimeline({ handle, sinceIso, rounds, runBird, log }) {
  const cutoff = Date.parse(sinceIso);
  const all = [];
  const seen = new Set();
  let cursor = null;
  const pull = { rounds: 0, stopped: 'rounds-exhausted', error: null };

  for (let round = 1; round <= rounds; round += 1) {
    const args = ['user-tweets', `@${handle}`, '-n', '200', '--max-pages', '10', '--delay', '1200', '--json'];
    if (cursor) args.push('--cursor', cursor);
    let raw;
    try {
      raw = await runBird(args);
    } catch (err) {
      log(`round ${round} failed: ${String(err.stderr || err.message).slice(0, 300)}`);
      pull.stopped = 'error';
      pull.error = { kind: classifyBirdError(err), message: String(err.stderr || err.message).slice(0, 300) };
      break;
    }
    pull.rounds = round;
    raw = String(raw ?? '');
    const objStart = raw.indexOf('{');
    const arrStart = raw.indexOf('[');
    const jsonStart = objStart === -1 ? arrStart : (arrStart === -1 ? objStart : Math.min(objStart, arrStart));
    if (jsonStart === -1) {
      log(`round ${round}: no JSON in output`);
      pull.stopped = 'error';
      pull.error = { kind: BIRD_FAILURE.OTHER, message: 'no JSON in output' };
      break;
    }
    let payload;
    try {
      payload = JSON.parse(raw.slice(jsonStart));
    } catch (err) {
      log(`round ${round} parse failed: ${String(err.message).slice(0, 200)}`);
      pull.stopped = 'error';
      pull.error = { kind: BIRD_FAILURE.OTHER, message: `parse failed: ${String(err.message).slice(0, 200)}` };
      break;
    }
    const tweets = Array.isArray(payload) ? payload : (payload.tweets || []);
    const next = Array.isArray(payload) ? null : (payload.nextCursor || null);

    let added = 0;
    let oldest = null;
    for (const t of tweets) {
      if (!t?.id || seen.has(t.id)) continue;
      seen.add(t.id);
      all.push(t);
      added += 1;
      const d = Date.parse(t.createdAt);
      if (Number.isFinite(d) && (oldest === null || d < oldest)) oldest = d;
    }
    log(`round ${round}: +${added} (total ${all.length}) oldest=${oldest ? new Date(oldest).toISOString().slice(0, 10) : 'n/a'}`);
    if (oldest !== null && Number.isFinite(cutoff) && oldest < cutoff) { pull.stopped = 'cutoff'; break; }
    if (!next || added === 0) { pull.stopped = 'exhausted'; break; }
    cursor = next;
  }
  return { tweets: all, pull };
}

/**
 * @param {Object} o
 * @param {string} o.handle  with or without leading @
 * @param {number} [o.tz=0]  tz offset hours
 * @param {number} [o.days=65]
 * @param {string} [o.since]  ISO; wins over days
 * @param {number} [o.rounds=12]
 * @param {string[]} [o.lanes]
 * @param {(args:string[])=>string|Promise<string>} o.runBird
 * @param {(line:string)=>void} [o.log]
 * @param {number} [o.now]
 * @param {string|null} [o.clientId]  only echoed into meta (CLI --client)
 * @returns {Promise<{rows:object[],dropped:number,stats:object,watchlist:object,meta:object,since:string,
 *   pull:{rounds:number,stopped:string,error:null|{kind:string,message:string}}}>}
 *   Throws (err.code 'NO_POSTS', err.pull set) when zero posts came back; 'NO_HANDLE' / 'NO_RUNNER' on bad input.
 */
export async function ingestHandle({ handle, tz = 0, days = DEFAULT_DAYS, since, rounds = MAX_ROUNDS, lanes = [], runBird, log = () => {}, now = Date.now(), clientId = null } = {}) {
  const h = String(handle || '').replace(/^@+/, '').trim();
  if (!h) throw Object.assign(new Error('handle is required.'), { code: 'NO_HANDLE' });
  if (typeof runBird !== 'function') throw Object.assign(new Error('runBird is required.'), { code: 'NO_RUNNER' });

  const sinceIso = since || new Date(now - days * 86_400_000).toISOString();
  log(`Pulling @${h} back to ${sinceIso.slice(0, 10)}…`);

  const { tweets, pull } = await pullTimeline({ handle: h, sinceIso, rounds, runBird, log });
  if (!tweets.length) {
    throw Object.assign(new Error('No posts returned. Is bird authenticated (browser cookies) and the handle correct?'), { code: 'NO_POSTS', pull });
  }

  const { rows, dropped } = normalizeTimeline(tweets, { handle: h, tzOffsetHours: tz, lanes, since: sinceIso });
  const stats = summarizeCorpus(rows, { handle: h });
  // Derived here, at ingest, because it is the one artifact that needs the raw rows.
  const watchlist = deriveWatchlist(rows, { ownHandle: h });

  const meta = {
    source: 'bird',
    posts: rows.length,
    droppedRows: dropped,
    firstDate: stats.cadence.firstDate,
    lastDate: stats.cadence.lastDate,
    tzOffsetHours: tz,
    since: sinceIso,
    clientId: clientId || null,
    watchlistAccounts: watchlist.accounts.length,
    watchlistCoverage: watchlist.meta.coverageAchieved,
  };
  return { rows, dropped, stats, watchlist, meta, since: sinceIso, pull };
}
