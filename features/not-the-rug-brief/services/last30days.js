// services/last30days.js — last30days social intelligence service
//
// Fetches social/community signals by running the last30days Python CLI
// as a local subprocess. Returns structured JSON for normalization and
// Scout integration.
//
// ─── LOCAL EXECUTION ────────────────────────────────────────────────────────
// Requires:
//   - Python 3.12+ accessible via LAST30DAYS_PYTHON (default: auto-detect)
//   - Skill installed at LAST30DAYS_SKILL_ROOT
//     (default: ~/.claude/skills/last30days-skill-main)
//   - ~/.config/last30days/.env configured (API keys, browser cookies, etc.)
//
// ─── PRODUCTION STATUS ──────────────────────────────────────────────────────
// Local-only. The subprocess path is fully isolated here. When production
// execution is ready (e.g., an HTTP worker or managed cloud function), swap
// only this module — the normalization layer, store, and Scout integration
// are all agnostic to how the raw data arrives.
//
// Production failure mode: if LAST30DAYS_SKILL_ROOT is not set and the skill
// is not installed, execFile throws ENOENT. The caller (xscout.js) catches
// this and falls back to the latest cached artifact — the pipeline continues.

require('../load-env');

const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');

const execFileAsync = promisify(execFile);

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_SKILL_ROOT = path.join(
  os.homedir(),
  '.claude',
  'skills',
  'last30days-skill-main'
);

const SCRIPT_RELATIVE = path.join('scripts', 'last30days.py');
const TIMEOUT_MS = 120_000; // 2 minutes — last30days typically runs 30–60s
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB stdout buffer

// ─── Environment helpers ─────────────────────────────────────────────────────

function getSkillRoot() {
  return process.env.LAST30DAYS_SKILL_ROOT || DEFAULT_SKILL_ROOT;
}

/**
 * Auto-detect a Python 3.12+ binary, preferring explicit env override.
 * Falls back to 'python3' and lets execFile surface the error if not found.
 */
function getPythonBin() {
  if (process.env.LAST30DAYS_PYTHON) return process.env.LAST30DAYS_PYTHON;

  // Prefer newer versions first
  for (const bin of ['python3.14', 'python3.13', 'python3.12', 'python3']) {
    try {
      // Check existence on PATH synchronously — fast enough for startup
      // (execFileSync would also work but adds overhead on every call)
      const which = require('child_process').execFileSync(
        process.platform === 'win32' ? 'where' : 'which',
        [bin],
        { stdio: 'pipe', timeout: 3000 }
      );
      if (which && which.toString().trim()) return bin;
    } catch {
      // not found — try next
    }
  }

  return 'python3'; // last resort — let execFile fail explicitly
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Whether last30days is enabled for a given client config.
 */
function isEnabled(clientConfig = {}) {
  return clientConfig.last30days?.enabled === true;
}

/**
 * Build CLI args from client last30days config.
 * Returns [scriptPath, ...topicWords, ...flags]
 */
function buildArgs(topic, clientConfig = {}) {
  const l30 = clientConfig.last30days || {};
  const skillRoot = getSkillRoot();
  const scriptPath = path.join(skillRoot, SCRIPT_RELATIVE);

  const args = [
    scriptPath,
    // Topic words are spread individually so execFile handles quoting
    ...topic.split(/\s+/).filter(Boolean),
    '--emit', 'json',
  ];

  if (l30.lookbackDays) args.push('--lookback-days', String(l30.lookbackDays));
  if (l30.sources)       args.push('--search', l30.sources);
  if (l30.subreddits)    args.push('--subreddits', l30.subreddits);
  if (l30.tiktokHashtags) args.push('--tiktok-hashtags', l30.tiktokHashtags);
  if (l30.xHandle)        args.push('--x-handle', l30.xHandle);
  if (l30.xRelated)       args.push('--x-related', l30.xRelated);

  return args;
}

/**
 * Run the last30days CLI and return the parsed report JSON.
 *
 * Returns a service result object:
 *   { status, fetchedAt, clientId, topic, sources, lookbackDays, rawOutput, error }
 *
 * Never throws — all errors are captured in the returned object so the
 * caller can decide whether to fall back to cache or skip gracefully.
 */
async function fetchLast30Days(clientConfig = {}) {
  if (!isEnabled(clientConfig)) {
    return null; // explicitly disabled — caller should not cache this
  }

  const l30 = clientConfig.last30days;
  const topic = l30.primaryTopic || clientConfig.clientName || 'local business intelligence';
  const fetchedAt = new Date().toISOString();

  const skillRoot = getSkillRoot();
  const scriptPath = path.join(skillRoot, SCRIPT_RELATIVE);

  // Explicit pre-check so the error message is clear — not an ENOENT traceback
  if (!fs.existsSync(scriptPath)) {
    return {
      status: 'error',
      fetchedAt,
      clientId: clientConfig.clientId,
      topic,
      sources: l30.sources || null,
      lookbackDays: l30.lookbackDays || 30,
      rawOutput: null,
      error: `last30days script not found at ${scriptPath}. Set LAST30DAYS_SKILL_ROOT or install the skill.`,
    };
  }

  const pythonBin = getPythonBin();
  const args = buildArgs(topic, clientConfig);

  try {
    const { stdout, stderr } = await execFileAsync(pythonBin, args, {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      env: {
        ...process.env,
        HOME: os.homedir(), // ensure ~/.config/last30days/.env is discoverable
      },
    });

    // last30days writes progress lines to stderr — that's normal and expected.
    // Only surface lines that look like genuine errors.
    if (stderr) {
      const errorLines = stderr
        .split('\n')
        .filter((line) => /\b(error|exception|traceback|critical)\b/i.test(line))
        .filter((line) => !/^\[last30days\]/.test(line)) // skip its own status lines
        .slice(0, 5);

      if (errorLines.length > 0) {
        console.warn(`[last30days service] subprocess warnings: ${errorLines.join(' | ')}`);
      }
    }

    if (!stdout || !stdout.trim()) {
      return {
        status: 'empty',
        fetchedAt,
        clientId: clientConfig.clientId,
        topic,
        sources: l30.sources || null,
        lookbackDays: l30.lookbackDays || 30,
        rawOutput: null,
        error: 'subprocess returned empty stdout',
      };
    }

    let rawOutput;
    try {
      rawOutput = JSON.parse(stdout);
    } catch (parseErr) {
      return {
        status: 'error',
        fetchedAt,
        clientId: clientConfig.clientId,
        topic,
        sources: l30.sources || null,
        lookbackDays: l30.lookbackDays || 30,
        rawOutput: null,
        error: `JSON parse failed: ${parseErr.message}. stdout prefix: ${stdout.slice(0, 200)}`,
      };
    }

    return {
      status: 'success',
      fetchedAt,
      clientId: clientConfig.clientId,
      topic,
      sources: l30.sources || null,
      lookbackDays: l30.lookbackDays || 30,
      rawOutput,
    };
  } catch (err) {
    const isTimeout = err.killed || err.code === 'ETIMEDOUT';
    return {
      status: 'error',
      fetchedAt,
      clientId: clientConfig.clientId,
      topic,
      sources: l30.sources || null,
      lookbackDays: l30.lookbackDays || 30,
      rawOutput: null,
      error: isTimeout
        ? `subprocess timed out after ${TIMEOUT_MS / 1000}s`
        : (err.message || String(err)),
    };
  }
}

module.exports = {
  fetchLast30Days,
  isEnabled,
  // Exported for tests / diagnostics
  buildArgs,
  getSkillRoot,
  getPythonBin,
};
