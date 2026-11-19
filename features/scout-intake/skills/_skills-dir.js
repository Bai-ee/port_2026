'use strict';

// _skills-dir.js — Locates the skills/ directory holding the .md prompt files.
//
// Turbopack rewrites __dirname to a virtual /ROOT/... path in server bundles,
// while the traced .md files live under process.cwd() at runtime. So we try
// __dirname first (works in Node/tests), then the cwd-based path.

const fs   = require('fs');
const path = require('path');

function skillsDirCandidates() {
  const list = [__dirname, path.join(process.cwd(), 'features', 'scout-intake', 'skills')];
  return [...new Set(list)];
}

function hasSkillMd(dir, fsImpl) {
  try {
    return fsImpl.readdirSync(dir).some((f) => f.endsWith('.md') && !f.startsWith('_'));
  } catch {
    return false;
  }
}

/**
 * First candidate directory that is readable and contains at least one skill .md.
 * @param {string[]} candidates
 * @param {{readdirSync: Function}} [fsImpl]
 * @returns {string|null}
 */
function resolveSkillsDir(candidates = skillsDirCandidates(), fsImpl = fs) {
  for (const dir of candidates) {
    if (hasSkillMd(dir, fsImpl)) return dir;
  }
  return null;
}

/**
 * Read a skill .md file (e.g. 'brand-system-vision.md') from the resolved dir.
 * @param {string} fileName
 * @returns {string}
 */
function readSkillFile(fileName) {
  const dir = resolveSkillsDir();
  if (!dir) {
    throw new Error(`skills dir not found (tried: ${skillsDirCandidates().join(', ')})`);
  }
  return fs.readFileSync(path.join(dir, fileName), 'utf8');
}

module.exports = { skillsDirCandidates, resolveSkillsDir, readSkillFile };
