#!/usr/bin/env node
// public/edittrax-player/ is GENERATED — edit the top-level edittrax_player/ template
// and re-run this script (node scripts/sync-edittrax-player.mjs). Do not hand-edit the
// generated copy; it will be overwritten (and pruned) on the next sync.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SRC_DIR = path.join(repoRoot, 'edittrax_player');
const DEST_DIR = path.join(repoRoot, 'public', 'edittrax-player');

// Files excluded from the export-zip manifest (docs + the per-track template that gets
// regenerated per export + the manifest itself).
const MANIFEST_EXCLUDE = new Set(['README.md', 'BUILD_NOTES.md', 'track.js', 'manifest.json']);

function toPosixPath(relPath) {
  return relPath.split(path.sep).join('/');
}

/** Recursively copy srcDir -> destDir, creating directories (including empty ones). */
function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Recursively remove anything under destDir that has no corresponding path under srcDir. */
function pruneDir(srcDir, destDir) {
  if (!fs.existsSync(destDir)) return;
  const entries = fs.readdirSync(destDir, { withFileTypes: true });
  for (const entry of entries) {
    const destPath = path.join(destDir, entry.name);
    const srcPath = path.join(srcDir, entry.name);
    if (!fs.existsSync(srcPath)) {
      fs.rmSync(destPath, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) {
      pruneDir(srcPath, destPath);
    }
  }
}

/** Recursively collect { path, bytes } for every file under dir, relative to dir (POSIX-style). */
function listFiles(dir, baseDir = dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      const relPath = toPosixPath(path.relative(baseDir, fullPath));
      out.push({ path: relPath, bytes: fs.statSync(fullPath).size });
    }
  }
  return out;
}

function main() {
  if (!fs.existsSync(SRC_DIR) || !fs.statSync(SRC_DIR).isDirectory()) {
    throw new Error(`Source template not found: ${SRC_DIR}`);
  }

  copyDir(SRC_DIR, DEST_DIR);
  pruneDir(SRC_DIR, DEST_DIR);

  const files = listFiles(DEST_DIR)
    .filter((f) => !MANIFEST_EXCLUDE.has(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const manifest = {
    generatedAt: new Date().toISOString(),
    files,
  };

  fs.writeFileSync(
    path.join(DEST_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );

  console.log(`Synced ${SRC_DIR} -> ${DEST_DIR}`);
  console.log(`manifest.json: ${files.length} export-zip file entries`);
}

main();
