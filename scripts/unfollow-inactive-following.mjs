import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { TwitterApi } from 'twitter-api-v2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const auditPath = path.join(repoRoot, 'data', 'bai-ee-inactive-following-audit.json');
const logPath = path.join(repoRoot, 'data', 'bai-ee-inactive-unfollow-log.json');
const envPath = path.join(repoRoot, '.env.local');
const cutoff = '2025-06-19T00:00:00.000Z';

const execute = process.argv.includes('--execute');
const autoWait = process.argv.includes('--auto-wait');
const maxArg = process.argv.find((arg) => arg.startsWith('--max='));
const maxThisRun = maxArg ? Number(maxArg.split('=')[1]) : Number(process.env.MAX_UNFOLLOWS || 0);
const delayArg = process.argv.find((arg) => arg.startsWith('--delay='));
const delayMs = delayArg ? Number(delayArg.split('=')[1]) : Number(process.env.UNFOLLOW_DELAY_MS || 1200);

function stripQuotes(value) {
  if (!value || typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function firstEnv(...names) {
  for (const name of names) {
    const value = stripQuotes(process.env[name]);
    if (value) return value;
  }
  return null;
}

function compactError(error) {
  return {
    code: error?.code || null,
    message: error?.message || null,
    data: error?.data || null,
    rateLimit: error?.rateLimit || null,
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

loadDotenv({ path: envPath, override: false });

const appKey = firstEnv('TWITTER_API_KEY', 'X_API_KEY');
const appSecret = firstEnv('TWITTER_API_SECRET', 'TWITTER_API_KEY_SECRET', 'X_API_SECRET', 'X_API_KEY_SECRET');
const accessToken = firstEnv('TWITTER_ACCESS_TOKEN', 'ACCESS_TOKEN', 'X_ACCESS_TOKEN');
const accessSecret = firstEnv('TWITTER_ACCESS_SECRET', 'TWITTER_ACCESS_TOKEN_SECRET', 'ACCESS_SECRET', 'X_ACCESS_SECRET', 'X_ACCESS_TOKEN_SECRET');

if (!appKey || !appSecret || !accessToken || !accessSecret) {
  throw new Error('Twitter credentials are not configured in .env.local.');
}

const audit = await readJson(auditPath, null);
const rows = audit?.results || [];
const candidates = rows
  .filter((row) => row?.inactiveOneYear === true && row?.status === 'ok')
  .filter((row) => row?.latestPostAt && row.latestPostAt < cutoff)
  .sort((a, b) => String(a.latestPostAt).localeCompare(String(b.latestPostAt)));

const existingLog = await readJson(logPath, {
  createdAt: new Date().toISOString(),
  sourceAuditPath: path.relative(repoRoot, auditPath),
  cutoff,
  dryRun: !execute,
  results: [],
});

const completedIds = new Set(
  existingLog.results
    .filter((result) => result.status === 'unfollowed')
    .map((result) => String(result.id)),
);
const remaining = candidates.filter((candidate) => !completedIds.has(String(candidate.id)));

console.log(JSON.stringify({
  execute,
  cutoff,
  candidateCount: candidates.length,
  previouslyCompleted: candidates.length - remaining.length,
  remaining: remaining.length,
  delayMs,
  autoWait,
  maxThisRun: maxThisRun > 0 ? maxThisRun : null,
}, null, 2));

if (!execute) {
  existingLog.dryRun = true;
  existingLog.results.push(...remaining.map((candidate) => ({
    status: 'dry-run',
    id: String(candidate.id),
    username: candidate.username,
    latestPostAt: candidate.latestPostAt,
    checkedAt: new Date().toISOString(),
  })));
  existingLog.updatedAt = new Date().toISOString();
  await writeJson(logPath, existingLog);
  console.log(`Dry run written to ${path.relative(repoRoot, logPath)}`);
  process.exit(0);
}

const client = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
const me = await client.v2.me();
const sourceUserId = me?.data?.id;
if (!sourceUserId) throw new Error('Could not resolve authenticated X user.');

existingLog.dryRun = false;
existingLog.sourceUser = {
  id: sourceUserId,
  username: me?.data?.username || null,
  name: me?.data?.name || null,
};

let processed = 0;
let stoppedForRateLimit = false;
let index = 0;

while (index < remaining.length) {
  if (maxThisRun > 0 && processed >= maxThisRun) {
    console.log(`stopping after maxThisRun=${maxThisRun}`);
    break;
  }

  const candidate = remaining[index];
  const resultBase = {
    id: String(candidate.id),
    username: candidate.username,
    name: candidate.name || null,
    latestPostAt: candidate.latestPostAt,
    actionBucket: candidate.actionBucket || candidate.bucket || null,
    checkedAt: new Date().toISOString(),
  };

  try {
    const response = await client.v2.unfollow(sourceUserId, String(candidate.id));
    existingLog.results.push({
      ...resultBase,
      status: 'unfollowed',
      response,
    });
    processed += 1;
    index += 1;
    console.log(`unfollowed ${processed}/${remaining.length} @${candidate.username}`);
  } catch (error) {
    const twitterError = compactError(error);
    const isCreditsDepleted = error?.code === 402 || twitterError?.data?.title === 'CreditsDepleted';
    if (error?.code === 429 || error?.rateLimit) {
      if (isCreditsDepleted) {
        existingLog.results.push({
          ...resultBase,
          status: 'credits-depleted',
          twitterError,
        });
        existingLog.updatedAt = new Date().toISOString();
        await writeJson(logPath, existingLog);
        console.log(`credits depleted before @${candidate.username}; stopping`);
        break;
      }

      const resetMs = Number(error?.rateLimit?.reset || 0) * 1000;
      const waitMs = Math.max(resetMs - Date.now() + 5000, 60_000);
      existingLog.results.push({
        ...resultBase,
        status: autoWait ? 'rate-limited-wait' : 'failed',
        twitterError,
        retryAfterMs: autoWait ? waitMs : null,
      });
      existingLog.updatedAt = new Date().toISOString();
      await writeJson(logPath, existingLog);
      console.log(`rate limited at ${processed}/${remaining.length} before @${candidate.username}`);

      if (autoWait) {
        console.log(`waiting ${Math.ceil(waitMs / 1000)}s for X reset`);
        await sleep(waitMs);
        continue;
      }

      stoppedForRateLimit = true;
      break;
    }

    existingLog.results.push({
      ...resultBase,
      status: 'failed',
      twitterError,
    });
    index += 1;
    console.log(`failed ${processed + 1}/${remaining.length} @${candidate.username}: ${twitterError.message || twitterError.code || 'unknown error'}`);
  }

  existingLog.updatedAt = new Date().toISOString();
  await writeJson(logPath, existingLog);
  await sleep(delayMs);
}

existingLog.updatedAt = new Date().toISOString();
existingLog.stoppedForRateLimit = stoppedForRateLimit;
await writeJson(logPath, existingLog);

const summary = existingLog.results.reduce((acc, result) => {
  acc[result.status] = (acc[result.status] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  done: true,
  processedThisRun: processed,
  stoppedForRateLimit,
  summary,
  logPath: path.relative(repoRoot, logPath),
}, null, 2));
