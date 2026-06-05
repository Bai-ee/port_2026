#!/usr/bin/env node
/**
 * inline-brief-images.cjs
 *
 * Converts all <img src="..."> references in a brief HTML file to base64 data URIs.
 * This makes the brief a single self-contained HTML file with no external dependencies.
 *
 * Usage:
 *   node scripts/inline-brief-images.cjs clients/fast-poker/its-raw-poke/platform-brief.html
 *
 * What it does:
 *   1. Reads the HTML file
 *   2. Finds all <img src="..."> tags that reference local files (not already data: URIs)
 *   3. Resolves the file path relative to the HTML file's location
 *   4. Reads the image, base64 encodes it, replaces the src
 *   5. Writes the updated HTML back (or to --out if specified)
 *
 * Options:
 *   --out <path>    Write to a different file instead of overwriting
 *   --dry-run       Show what would be replaced without writing
 *   --max-size <kb> Skip images larger than this (default: 200KB)
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const maxSizeKB = parseInt(args[args.indexOf('--max-size') + 1] || '200', 10);

let outPath = null;
const outIdx = args.indexOf('--out');
if (outIdx > -1) outPath = args[outIdx + 1];

const htmlPath = args.find(a => a.endsWith('.html'));
if (!htmlPath) {
  console.error('Usage: node scripts/inline-brief-images.cjs <brief.html> [--out <path>] [--dry-run]');
  process.exit(1);
}

const resolvedHtml = path.resolve(htmlPath);
if (!fs.existsSync(resolvedHtml)) {
  console.error(`File not found: ${resolvedHtml}`);
  process.exit(1);
}

const htmlDir = path.dirname(resolvedHtml);
let html = fs.readFileSync(resolvedHtml, 'utf8');

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

// Match <img src="..."> where src is NOT already a data: URI
const imgRegex = /(<img\s[^>]*?)src="([^"]+)"([^>]*?>)/gi;

let count = 0;
let skipped = 0;

html = html.replace(imgRegex, (match, before, src, after) => {
  // Skip data URIs (already inlined)
  if (src.startsWith('data:')) return match;

  // Skip external URLs
  if (src.startsWith('http://') || src.startsWith('https://')) return match;

  // Resolve the image path relative to the HTML file
  const imgPath = path.resolve(htmlDir, src);

  if (!fs.existsSync(imgPath)) {
    console.warn(`  SKIP (not found): ${src} -> ${imgPath}`);
    skipped++;
    return match;
  }

  const stats = fs.statSync(imgPath);
  const sizeKB = stats.size / 1024;

  if (sizeKB > maxSizeKB) {
    console.warn(`  SKIP (${sizeKB.toFixed(0)}KB > ${maxSizeKB}KB max): ${src}`);
    skipped++;
    return match;
  }

  const ext = path.extname(imgPath).toLowerCase();
  const mime = MIME_TYPES[ext];
  if (!mime) {
    console.warn(`  SKIP (unknown type): ${src}`);
    skipped++;
    return match;
  }

  const buffer = fs.readFileSync(imgPath);
  const b64 = buffer.toString('base64');
  const dataUri = `data:${mime};base64,${b64}`;

  console.log(`  INLINE: ${src} (${sizeKB.toFixed(1)}KB ${ext})`);
  count++;

  return `${before}src="${dataUri}"${after}`;
});

if (dryRun) {
  console.log(`\nDry run: would inline ${count} images, skipped ${skipped}`);
} else {
  const target = outPath ? path.resolve(outPath) : resolvedHtml;
  fs.writeFileSync(target, html, 'utf8');
  console.log(`\nInlined ${count} images, skipped ${skipped}`);
  console.log(`Written to: ${target}`);
}
