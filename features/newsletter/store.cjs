// store.js — Newsletter-specific save/load helpers
//
// Mirrors the pattern from not-the-rug-brief/store.js but writes to
// data/newsletter/{clientId}/. Archives every run with a timestamped
// filename alongside a latest.json for quick reads.
//
// Reuses the base helpers (readJSON, writeJSON, ensureDir, generateFilename)
// from the existing store module.

const path = require('path');
const {
  readJSON,
  writeJSON,
  ensureDir,
  generateFilename,
  DATA_DIR,
} = require('../not-the-rug-brief/store.cjs');

// Newsletter data lives alongside briefs and content in the shared data dir
const NEWSLETTER_DIR = path.join(DATA_DIR, 'newsletter');

function newsletterDir(clientId) {
  return path.join(NEWSLETTER_DIR, clientId);
}

// --- Newsletter content (Scribe output + Guardian verdict) ---

async function saveNewsletterContent(clientId, newsletterOutput) {
  const dir = newsletterDir(clientId);
  const archiveFile = path.join(dir, generateFilename('newsletter'));
  const latestFile = path.join(dir, 'latest-newsletter.json');

  await writeJSON(archiveFile, newsletterOutput);
  await writeJSON(latestFile, newsletterOutput);
}

async function getLatestNewsletter(clientId) {
  return readJSON(path.join(newsletterDir(clientId), 'latest-newsletter.json'));
}

// --- Rendered HTML output ---

async function saveRenderedNewsletter(clientId, html) {
  const dir = newsletterDir(clientId);
  await ensureDir(dir);

  const archiveFile = path.join(dir, generateFilename('newsletter-html').replace('.json', '.html'));
  const latestFile = path.join(dir, 'latest-newsletter.html');

  const fs = require('fs').promises;
  await fs.writeFile(archiveFile, html, 'utf-8');
  await fs.writeFile(latestFile, html, 'utf-8');
}

async function getRenderedNewsletter(clientId) {
  const fs = require('fs').promises;
  try {
    return await fs.readFile(path.join(newsletterDir(clientId), 'latest-newsletter.html'), 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// --- Newsletter history ---

async function getNewsletterHistory(clientId, limit = 20) {
  const dir = newsletterDir(clientId);
  const fs = require('fs').promises;

  let files;
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const archiveFiles = (
    await Promise.all(
      files
        .filter((f) => f.startsWith('newsletter-') && f.endsWith('.json'))
        .map(async (f) => {
          const stat = await fs.stat(path.join(dir, f));
          return { name: f, mtime: stat.mtimeMs };
        })
    )
  )
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  const newsletters = [];
  for (const file of archiveFiles) {
    const newsletter = await readJSON(path.join(dir, file));
    if (newsletter) newsletters.push(newsletter);
  }
  return newsletters;
}

module.exports = {
  NEWSLETTER_DIR,
  newsletterDir,
  saveNewsletterContent,
  getLatestNewsletter,
  saveRenderedNewsletter,
  getRenderedNewsletter,
  getNewsletterHistory,
};
