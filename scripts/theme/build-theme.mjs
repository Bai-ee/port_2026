#!/usr/bin/env node
// Regenerates every production theme artefact from
// lib/theme/production/production-theme.json (contract §14):
//   styles/theme/theme.generated.css
//   lib/theme/production/resolved.generated.json          (full ResolvedTheme pair)
//   lib/theme/production/resolved.runtime.generated.json  (slim: tokens + scene, for the main bundle)
//   lib/theme/production/resolved.runtime.generated.js    (the same slim data as an ES module: `export default {...}`)
//   lib/theme/production/baseline.report.json             (only with --baseline)
//
// Usage: node scripts/theme/build-theme.mjs [--baseline] [--theme <path>] [--dry]
// Pure Node, no network, no dev server.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProductionOutputs } from '../../lib/theme/production/build-outputs.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const themePath = path.resolve(root, valueOf('--theme') || 'lib/theme/production/production-theme.json');
const dry = flag('--dry');
const withBaseline = flag('--baseline');

const out = buildProductionOutputs(fs.readFileSync(themePath, 'utf8'));
if (!out.ok) {
  console.error(`[theme:build] ${path.relative(root, themePath)} is invalid:`);
  for (const e of out.errors) console.error(`  - ${e.code} ${e.path}: ${e.message}`);
  process.exit(1);
}
for (const w of out.warnings) console.warn(`[theme:build] warning ${w.code} ${w.path}: ${w.message}`);

const targets = [
  ['styles/theme/theme.generated.css', out.files.css],
  ['lib/theme/production/resolved.generated.json', out.files.resolved],
  ['lib/theme/production/resolved.runtime.generated.json', out.files.runtime],
  ['lib/theme/production/resolved.runtime.generated.js', out.files.runtimeModule],
];
if (withBaseline) targets.push(['lib/theme/production/baseline.report.json', out.files.baselineReport]);

for (const [rel, content] of targets) {
  const abs = path.join(root, rel);
  if (dry) {
    console.log(`[theme:build] (dry) ${rel} ${Buffer.byteLength(content)} bytes`);
    continue;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  fs.writeFileSync(abs, content);
  console.log(`[theme:build] ${before === content ? 'unchanged' : 'wrote'} ${rel} (${Buffer.byteLength(content)} bytes)`);
}
console.log(`[theme:build] theme ${out.definition.meta.id} hash ${JSON.parse(out.files.resolved).hash}`);
