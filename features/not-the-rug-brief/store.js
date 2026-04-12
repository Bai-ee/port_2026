// store.js — JSON file read/write helpers
// Why JSON files: keeps the system simple and portable while we validate
// the agent architecture. We'll migrate to a DB when data volume demands it.

const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = process.env.NOT_THE_RUG_BRIEF_DATA_DIR
  ? path.resolve(process.env.NOT_THE_RUG_BRIEF_DATA_DIR)
  : path.join(process.cwd(), 'data', 'not-the-rug-brief');

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Read and parse a JSON file. Returns null if the file doesn't exist.
 */
async function readJSON(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Write an object to a JSON file, creating parent directories as needed.
 */
async function writeJSON(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Append an entry to a JSON array file. Creates the file if it doesn't exist.
 */
async function appendToJSONArray(filePath, entry) {
  const existing = (await readJSON(filePath)) || [];
  existing.push(entry);
  await writeJSON(filePath, existing);
}

// --- Filename generation ---

/**
 * Generate a human-readable filename for any agent's output.
 * Format: [agent]-[mon]-[dd]-[yyyy]-[h:mm am/pm].json
 * Example: scout-mar-08-2026-5:33pm.json
 */
function generateFilename(agentName) {
  const now = new Date();
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const mon = months[now.getMonth()];
  const dd = String(now.getDate()).padStart(2, '0');
  const yyyy = now.getFullYear();
  let hours = now.getHours();
  const mins = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${agentName}-${mon}-${dd}-${yyyy}-${hours}:${mins}${ampm}.json`;
}

// --- Brief-specific helpers ---

function briefDir(clientId) {
  return path.join(DATA_DIR, 'briefs', clientId);
}

async function saveLatestBrief(clientId, brief) {
  const dir = briefDir(clientId);
  const archiveFile = path.join(dir, generateFilename('scout'));
  const latestFile = path.join(dir, 'latest.json');

  await writeJSON(archiveFile, brief);
  await writeJSON(latestFile, brief);
}

async function getLatestBrief(clientId) {
  return readJSON(path.join(briefDir(clientId), 'latest.json'));
}

/**
 * Get brief history for a client, sorted newest first.
 * Reads all timestamped JSON files in the client's brief directory,
 * skipping latest.json (which is a duplicate of the most recent).
 */
async function getBriefHistory(clientId, limit = 20) {
  const dir = briefDir(clientId);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  // Only archive files (not latest.json), sorted by modification time newest first
  const briefFiles = (
    await Promise.all(
      files
        .filter((f) => f.endsWith('.json') && f !== 'latest.json')
        .map(async (f) => {
          const stat = await fs.stat(path.join(dir, f));
          return { name: f, mtime: stat.mtimeMs };
        })
    )
  )
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((f) => f.name);

  const briefs = [];
  for (const file of briefFiles) {
    const brief = await readJSON(path.join(dir, file));
    if (brief) briefs.push(brief);
  }
  return briefs;
}

// --- Content-specific helpers ---

function contentDir(clientId) {
  return path.join(DATA_DIR, 'content', clientId);
}

async function saveLatestContent(clientId, contentOutput) {
  const dir = contentDir(clientId);
  const archiveFile = path.join(dir, generateFilename('scribe'));
  const latestFile = path.join(dir, 'latest-content.json');

  await writeJSON(archiveFile, contentOutput);
  await writeJSON(latestFile, contentOutput);
}

async function getLatestContent(clientId) {
  return readJSON(path.join(contentDir(clientId), 'latest-content.json'));
}

// --- Weather-specific helpers ---

function weatherDir(clientId) {
  return path.join(DATA_DIR, 'weather', clientId);
}

async function saveLatestWeather(clientId, weatherOutput) {
  const dir = weatherDir(clientId);
  const archiveFile = path.join(dir, generateFilename('weather'));
  const latestFile = path.join(dir, 'latest-weather.json');

  await writeJSON(archiveFile, weatherOutput);
  await writeJSON(latestFile, weatherOutput);
}

async function getLatestWeather(clientId) {
  return readJSON(path.join(weatherDir(clientId), 'latest-weather.json'));
}

// --- Review-specific helpers ---

function reviewsDir(clientId) {
  return path.join(DATA_DIR, 'reviews', clientId);
}

async function saveLatestReviews(clientId, reviewOutput) {
  const dir = reviewsDir(clientId);
  const archiveFile = path.join(dir, generateFilename('reviews'));
  const latestFile = path.join(dir, 'latest-reviews.json');

  await writeJSON(archiveFile, reviewOutput);
  await writeJSON(latestFile, reviewOutput);
}

async function getLatestReviews(clientId) {
  return readJSON(path.join(reviewsDir(clientId), 'latest-reviews.json'));
}

// --- Instagram-specific helpers ---

function instagramDir(clientId) {
  return path.join(DATA_DIR, 'instagram', clientId);
}

async function saveLatestInstagram(clientId, instagramOutput) {
  const dir = instagramDir(clientId);
  const archiveFile = path.join(dir, generateFilename('instagram'));
  const latestFile = path.join(dir, 'latest-instagram.json');

  await writeJSON(archiveFile, instagramOutput);
  await writeJSON(latestFile, instagramOutput);
}

async function getLatestInstagram(clientId) {
  return readJSON(path.join(instagramDir(clientId), 'latest-instagram.json'));
}

// --- Reddit-specific helpers ---

function redditDir(clientId) {
  return path.join(DATA_DIR, 'reddit', clientId);
}

async function saveLatestReddit(clientId, redditOutput) {
  const dir = redditDir(clientId);
  const archiveFile = path.join(dir, generateFilename('reddit'));
  const latestFile = path.join(dir, 'latest-reddit.json');

  await writeJSON(archiveFile, redditOutput);
  await writeJSON(latestFile, redditOutput);
}

async function getLatestReddit(clientId) {
  return readJSON(path.join(redditDir(clientId), 'latest-reddit.json'));
}

// --- last30days-specific helpers ---
//
// Stores the full three-layer artifact: raw + normalized + mapped.
// Keeping all layers in one file makes it easy to debug, remap, and compare
// across runs without needing to correlate separate files.
//
// Schema of the stored artifact:
// {
//   status, fetchedAt, clientId, topic, sources, lookbackDays,
//   rawOutput,        // the raw last30days JSON report (schema.Report)
//   normalized: [],   // normalized signal objects with provenance
//   mapped: {}        // Scout-compatible agentData buckets
// }

function last30daysDir(clientId) {
  return path.join(DATA_DIR, 'last30days', clientId);
}

async function saveLatestLast30Days(clientId, artifact) {
  const dir = last30daysDir(clientId);
  const archiveFile = path.join(dir, generateFilename('last30days'));
  const latestFile = path.join(dir, 'latest-last30days.json');

  await writeJSON(archiveFile, artifact);
  await writeJSON(latestFile, artifact);
}

async function getLatestLast30Days(clientId) {
  return readJSON(path.join(last30daysDir(clientId), 'latest-last30days.json'));
}

// --- Error log helper ---

async function logError(error, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    message: error.message || String(error),
    stack: error.stack || null,
    ...context,
  };
  const errFile = path.join(DATA_DIR, 'errors.json');
  await appendToJSONArray(errFile, entry).catch((writeErr) => {
    // Last resort: if we can't write the error file, log to console
    console.error(`[${new Date().toISOString()}] STORE: failed to write error log`, writeErr);
  });
}

module.exports = {
  DATA_DIR,
  ensureDir,
  readJSON,
  writeJSON,
  appendToJSONArray,
  generateFilename,
  briefDir,
  saveLatestBrief,
  getLatestBrief,
  getBriefHistory,
  contentDir,
  saveLatestContent,
  getLatestContent,
  weatherDir,
  saveLatestWeather,
  getLatestWeather,
  reviewsDir,
  saveLatestReviews,
  getLatestReviews,
  instagramDir,
  saveLatestInstagram,
  getLatestInstagram,
  redditDir,
  saveLatestReddit,
  getLatestReddit,
  last30daysDir,
  saveLatestLast30Days,
  getLatestLast30Days,
  logError,
};
