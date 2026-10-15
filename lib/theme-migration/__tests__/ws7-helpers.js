// Shared helpers for the WS7 (public JSX) migration tests. Not a test file.
// Dev tooling only: reads source files from the repo root and scans them with
// the WS1 literal scanner (lib/theme/dev/scan-literals.js).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanLiterals, normalizeLiteral, parseLiteral } from '../../theme/dev/scan-literals.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// Public files whose colours go through theme tokens (everything in the WS7
// section of the contract that is not a pinned route).
export const THEMED_FILES = [
  'Header.jsx',
  'SiteFooter.jsx',
  'InnerPageShell.jsx',
  'pageSurfaceSystem.js',
  'StackedSlidesSection.jsx',
  'HorizontalGallery.jsx',
  'HorizontalTextSection.jsx',
  'HoverRevealList.jsx',
  'PortfolioModal.jsx',
  'ReelPlayer.jsx',
  'TextOverlay.jsx',
  'HeroHeadline.jsx',
  'HeroFooter.jsx',
  'AuthPage.jsx',
  'AboutPage.jsx',
  'AiDesignConsultingPage.jsx',
  'BrandIdentityPage.jsx',
  'CaseStudiesPage.jsx',
  'ContactPage.jsx',
  'DesignSystemsPage.jsx',
  'FAQPage.jsx',
  'GalleryPage.jsx',
  'HowItWorksPage.jsx',
  'ProcessPage.jsx',
  'SeoGeoPage.jsx',
  'WebDevelopmentPage.jsx',
  'WorkPage.jsx',
  'CreateCaseStudyModal.jsx',
  'FontSelector.jsx',
  'portfolioContent.js',
  'components/home/AnchorLavaControls.jsx',
  'components/home/AnchorLavaShader.jsx',
  'components/home/DeliverableHoverCards.jsx',
  'components/home/HeroDeliverableDeck.jsx',
  'components/home/heroCursorStage.js',
  'components/home/lavaShaderEngine.js',
  'components/home/scrambleText.js',
  'app/not-found.jsx',
];

// Pinned to the light theme in v1 (exception X8): no literal migration, but the
// outermost element must carry data-theme-scope="light".
export const PINNED_FILES = [
  'components/looper/LooperLandingPage.jsx',
  'components/recreate/RecreateLandingPage.jsx',
  'app/archive/page.jsx',
  'app/capture/page.jsx',
  'app/post-approval/page.jsx',
  'app/preview/layout.jsx',
];

// Whole directories whose literals are out of scope because the route is pinned.
export const PINNED_DIRS = ['components/looper', 'components/recreate', 'app/archive', 'app/capture', 'app/post-approval', 'app/preview'];

export function listUiIcons() {
  const dir = path.join(REPO_ROOT, 'components/ui');
  return fs.readdirSync(dir).filter((f) => /\.(jsx|js)$/.test(f)).map((f) => `components/ui/${f}`);
}

export function allThemedFiles() {
  return [...THEMED_FILES, ...listUiIcons()];
}

export function read(file) {
  return fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

export function loadAllowlist() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'lib/theme-migration/allowlists/ws7.json'), 'utf8'));
}

export const kebab = (s) => String(s || '').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).toLowerCase();

// CSS-declaration or JS-key property that owns the literal at `index`. The WS1
// scanner's own detection only understands JS keys, but most of these files
// carry CSS inside template literals, so the scan test uses this instead.
export function propertyAt(text, index) {
  const before = text.slice(Math.max(0, index - 600), index);
  const cut = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}'), before.lastIndexOf('`'));
  const seg = before.slice(cut + 1);
  let m = /(?:^|[\s,])(--?[A-Za-z][\w-]*|[A-Za-z][\w-]*)\s*:\s*[^:]*$/.exec(seg);
  if (m && !/^(https?|data)$/.test(m[1])) return kebab(m[1]);
  m = /([A-Za-z][\w]*)\s*=\s*\{?\s*["'`]?[^=]*$/.exec(seg);
  if (m) return kebab(m[1]);
  return null;
}

/** rgba(0,0,0,a) / #000 inside box-shadow / text-shadow / drop-shadow: mode-agnostic (exception X6). */
export function isBlackShadowAt(text, finding) {
  const p = parseLiteral(finding.literal);
  if (!p || p.space !== 'rgb' || p.r !== 0 || p.g !== 0 || p.b !== 0) return false;
  if (finding.prop === 'box-shadow' || finding.prop === 'text-shadow') return true;
  return /drop-shadow\([^)]*$/.test(text.slice(Math.max(0, finding.index - 80), finding.index));
}

/** Colour literals of a file that are neither black shadows nor allowlisted. */
export function scanFile(file, allowlist = loadAllowlist()) {
  const src = read(file);
  const all = scanLiterals(src, { file, type: 'js' }).map((f) => ({ ...f, prop: propertyAt(src, f.index) }));
  const findings = all.filter((f) => !isBlackShadowAt(src, f));
  const entries = allowlist.entries.filter((e) => e.file === file);
  const counts = new Map();
  for (const e of entries) counts.set(normalizeLiteral(e.literal), { allowed: e.count ?? Infinity, used: 0, entry: e });
  const unallowed = [];
  for (const f of findings) {
    const slot = counts.get(f.normalized);
    if (slot) slot.used += 1;
    else unallowed.push(f);
  }
  return { src, findings, unallowed, slots: counts };
}

export function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}
