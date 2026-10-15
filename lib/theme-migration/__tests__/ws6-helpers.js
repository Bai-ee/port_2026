// Shared helpers for the WS6 (dashboard / admin JSX) migration tests. Not a test file.
// Dev tooling only: reads source files from the repo root and scans them with the
// WS1 literal scanner (lib/theme/dev/scan-literals.js).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanLiterals, normalizeLiteral, parseLiteral } from '../../theme/dev/scan-literals.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const EXTS = /\.(jsx|js)$/;

// Individual files owned by WS6 (contract section 2).
const OWNED_FILES = [
  'DashboardPage.jsx',
  'OpsOverviewPage.jsx',
  'components/AdminCostView.jsx',
  'components/AdminDashboardFailuresView.jsx',
  'components/AdminEmailModals.jsx',
];

// Directories owned by WS6, walked recursively (tests excluded).
const OWNED_DIRS = ['components/dashboard', 'components/brain-builder', 'app/dashboard', 'app/admin'];

// Pinned surfaces: no literal migration in v1. Each is listed in the allowlist `pinnedPaths`
// with a reason and exception id, and each pinned DOM root is asserted by ws6-structure.test.js.
export const PINNED_PATHS = [
  'AdminPage.jsx', // X7: always-dark ops console
  'app/admin/control', // X7: always-dark control console
  'app/dashboard/studio', // X8: public Studio workbench, pinned light (outer shell data-theme-scope="light")
];

const isPinned = (rel) => PINNED_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`));

export function read(file) {
  return fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

function walk(rel, out) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const childRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(childRel, out);
    } else if (EXTS.test(entry.name)) {
      out.push(childRel);
    }
  }
}

/** Every WS6-owned source file that is themed (pinned surfaces excluded), sorted. */
export function themedFiles() {
  const out = [...OWNED_FILES];
  for (const dir of OWNED_DIRS) walk(dir, out);
  return out.filter((f) => !isPinned(f)).sort();
}

export function loadAllowlist() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'lib/theme-migration/allowlists/ws6.json'), 'utf8'));
}

export const kebab = (s) => String(s || '').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).toLowerCase();

/** rgba(0,0,0,a) / #000 inside box-shadow / text-shadow / drop-shadow: mode-agnostic (exception X6). */
export function isBlackShadowAt(text, finding) {
  const p = parseLiteral(finding.literal);
  if (!p || p.space !== 'rgb' || p.r !== 0 || p.g !== 0 || p.b !== 0) return false;
  return /(box-shadow|boxShadow|text-shadow|textShadow)\s*[:=][^;{}]*$/.test(text.slice(Math.max(0, finding.index - 300), finding.index))
    || /drop-shadow\([^)]*$/.test(text.slice(Math.max(0, finding.index - 80), finding.index));
}

export function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Colour literals of a file that are neither black shadows nor allowlisted (counted per normalised literal). */
export function scanFile(file, allowlist = loadAllowlist(), source = null) {
  const src = source ?? read(file);
  const findings = scanLiterals(src, { file, type: 'js' }).filter((f) => !isBlackShadowAt(src, f));
  const slots = new Map();
  for (const e of (allowlist.entries || []).filter((x) => x.file === file)) {
    slots.set(normalizeLiteral(e.literal), { allowed: e.count ?? Infinity, used: 0, entry: e });
  }
  const unallowed = [];
  for (const f of findings) {
    const slot = slots.get(f.normalized);
    if (slot) slot.used += 1;
    else unallowed.push(f);
  }
  return { src, findings, unallowed, slots };
}
