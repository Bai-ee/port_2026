#!/usr/bin/env node
// Replaces EXACT legacy colour literals with theme tokens (contract 10.4).
//
//   node scripts/theme/codemod-literals.mjs --paths styles/dashboard,components/dashboard [--write] [--report out.json]
//
// - dry run by default (prints the plan); --write applies the edits
// - CSS: every declaration value; JSX/JS: only inside `key: '<value>'` / `key="<value>"` for
//   color, background(-color), border*, outline*, fill, stroke, stopColor, boxShadow
// - black shadows (rgba(0,0,0,a) in box-shadow / text-shadow / drop-shadow) are never touched (X6)
// - ambiguous / unmapped literals are written to the JSON report and left as they are
// - protected files (email, briefs, invoice documents, orphans: contract section 13) are skipped
//
// Run it only with the dev server STOPPED: Fast-Refresh on DashboardPage.jsx (19k lines) hangs.

import fs from 'node:fs';
import path from 'node:path';
import { applyCodemod } from '../../lib/theme/dev/codemod.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valueOf = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const PROTECTED = [
  'features/email-digest', 'app/api/', 'app/briefs', 'brief-design-system-reference', 'ds-bundle', '.design-sync',
  'ControlPanel.jsx', 'ColorPalette.jsx', 'LoopControls.jsx', 'BrainParticleWindow.jsx', 'AuthContext.jsx', 'Swarm',
  'lib/theme/', 'styles/theme/theme.generated.css', 'node_modules', '.next',
];
const EXTS = new Set(['.css', '.js', '.jsx', '.mjs']);

if (flag('--help') || !valueOf('--paths')) {
  console.log('usage: node scripts/theme/codemod-literals.mjs --paths a,b [--write] [--report out.json]');
  process.exit(valueOf('--paths') ? 0 : 1);
}

function collect(p, out) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) {
    console.error(`[codemod] missing path ${p}`);
    process.exitCode = 1;
    return;
  }
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    for (const e of fs.readdirSync(abs)) collect(path.join(abs, e), out);
  } else if (EXTS.has(path.extname(abs))) {
    out.push(abs);
  }
}

const files = [];
for (const p of valueOf('--paths').split(',').map((s) => s.trim()).filter(Boolean)) collect(p, files);

const write = flag('--write');
const cwd = process.cwd();
const report = [];
const totals = { files: 0, changedFiles: 0, changed: 0, ambiguous: 0, unmapped: 0, notAttempted: 0, skippedBlackShadow: 0, protected: 0 };

for (const abs of files.sort()) {
  const rel = path.relative(cwd, abs).split(path.sep).join('/');
  if (PROTECTED.some((p) => rel.includes(p))) {
    totals.protected += 1;
    continue;
  }
  const src = fs.readFileSync(abs, 'utf8');
  const res = applyCodemod(src, { file: rel });
  totals.files += 1;
  for (const k of ['changed', 'ambiguous', 'unmapped', 'notAttempted', 'skippedBlackShadow']) totals[k] += res.counts[k];
  report.push(...res.report);
  if (res.changed) {
    totals.changedFiles += 1;
    if (write) fs.writeFileSync(abs, res.text);
    console.log(`[codemod] ${write ? 'wrote' : 'would change'} ${rel} (${res.counts.changed} literal${res.counts.changed === 1 ? '' : 's'})`);
  }
}

const out = valueOf('--report');
if (out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify({ write, totals, entries: report.filter((r) => r.status !== 'changed') }, null, 2)}\n`);
  console.log(`[codemod] report -> ${out} (${report.filter((r) => r.status !== 'changed').length} entries need a decision)`);
}
console.log(`[codemod] ${write ? 'APPLIED' : 'DRY RUN'}: ${JSON.stringify(totals)}`);
if (!write) console.log('[codemod] re-run with --write to apply');
