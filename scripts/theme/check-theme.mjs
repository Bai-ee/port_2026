#!/usr/bin/env node
// Verifies the theme pipeline without touching anything (contract 14, 15.8):
//   - production-theme.json validates and is canonical
//   - styles/theme/theme.generated.css and lib/theme/production/resolved*.generated.json equal a fresh build
//   - the pre-paint bootstrap script is ES5-safe and prints its sha256 (pin it if a CSP is ever added)
//   - prints the contrast summary of the production theme (informational; use --strict to fail on required failures)
//
// Usage: node scripts/theme/check-theme.mjs [--strict] [--baseline]

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildProductionOutputs } from '../../lib/theme/production/build-outputs.js';
import { buildReport } from '../../lib/theme/report.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const checkBaseline = args.includes('--baseline');

const read = (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : null);
const problems = [];
const fail = (msg) => problems.push(msg);

const production = read('lib/theme/production/production-theme.json');
if (production === null) {
  console.error('[theme:check] lib/theme/production/production-theme.json is missing');
  process.exit(1);
}
const out = buildProductionOutputs(production);
if (!out.ok) {
  console.error('[theme:check] production-theme.json is invalid:');
  for (const e of out.errors) console.error(`  - ${e.code} ${e.path}: ${e.message}`);
  process.exit(1);
}
for (const w of out.warnings) console.warn(`[theme:check] warning ${w.code} ${w.path}: ${w.message}`);

if (production !== out.files.canonicalJson) fail('production-theme.json is not canonical (re-export it, then run `npm run theme:build`)');

const targets = [
  ['styles/theme/theme.generated.css', out.files.css],
  ['lib/theme/production/resolved.generated.json', out.files.resolved],
  ['lib/theme/production/resolved.runtime.generated.json', out.files.runtime],
  ['lib/theme/production/resolved.runtime.generated.js', out.files.runtimeModule],
];
if (checkBaseline) targets.push(['lib/theme/production/baseline.report.json', out.files.baselineReport]);
for (const [rel, expected] of targets) {
  const actual = read(rel);
  if (actual === null) fail(`${rel} is missing: run \`npm run theme:build\``);
  else if (actual !== expected) fail(`${rel} is out of date: run \`npm run theme:build\``);
}

const script = out.files.bootstrap;
if (/=>|`|\blet\b|\bconst\b|\?\./.test(script)) fail('bootstrap script is not ES5-safe');
if (Buffer.byteLength(script) >= 1600) fail(`bootstrap script is ${Buffer.byteLength(script)} bytes (limit 1600)`);
const sha = crypto.createHash('sha256').update(script).digest('base64');
console.log(`[theme:check] bootstrap script: ${Buffer.byteLength(script)} bytes, CSP hash 'sha256-${sha}'`);

const report = buildReport(out.definition);
const s = report.summary;
console.log(
  `[theme:check] theme ${report.definitionId} hash ${report.hash}: contrast pass ${s.pass}, required failures ${s.failRequired}, advisory failures ${s.advisoryFail}, ` +
    `gamut-mapped ${report.gamut.length}, range warnings ${report.ranges.length}`
);
console.log(`[theme:check] ${report.statement}`);
if (strict && s.failRequired > 0) fail(`${s.failRequired} required contrast check(s) fail (--strict)`);
if (report.structure.errors.length) fail(`${report.structure.errors.length} structural error(s)`);

if (problems.length) {
  for (const p of problems) console.error(`[theme:check] FAIL ${p}`);
  process.exit(1);
}
console.log('[theme:check] OK: generated artefacts match production-theme.json');
