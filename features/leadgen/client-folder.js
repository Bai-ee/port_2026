// Lead Gen — Client Folder Layout
// Single source of truth for the on-disk structure of clients/{slug}/.
// All pipeline writes route through these helpers so the layout can evolve
// in one place. Deploy artifacts (index.html, gsap-kit.js, assets/) stay at
// the slug root so HTML asset refs and the Vercel deploy collector keep
// working unchanged; pipeline metadata moves into numbered subfolders.

import { mkdir, writeFile, readFile, access, readdir } from 'fs/promises';
import path from 'path';

const CLIENTS_ROOT = process.env.VERCEL
  ? '/tmp/clients'
  : path.join(process.cwd(), 'clients');

export const SUBDIRS = {
  onboarding:  '01-onboarding',
  scraped:     '02-scraped',
  brandSystem: '03-brand-system',
  brief:       '04-brief',
  generation:  '05-generation',
  deploy:      '06-deploy',
  comparison:  '07-comparison',
};

export function clientRoot(slug) {
  return path.join(CLIENTS_ROOT, slug);
}

export function subdir(slug, key) {
  if (!SUBDIRS[key]) throw new Error(`Unknown subdir key: ${key}`);
  return path.join(clientRoot(slug), SUBDIRS[key]);
}

export function assetsDir(slug) {
  return path.join(clientRoot(slug), 'assets');
}

export async function ensureSubdir(slug, key) {
  const dir = subdir(slug, key);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function ensureClientFolder(slug) {
  const root = clientRoot(slug);
  await mkdir(root, { recursive: true });
  await mkdir(assetsDir(slug), { recursive: true });
  for (const key of Object.keys(SUBDIRS)) {
    await mkdir(subdir(slug, key), { recursive: true });
  }
  await writeBrandSystemPlaceholder(slug);
  return root;
}

// Brand-system content currently lives in Firestore (`dashboard_state`) and
// Firebase Storage under a different clientId scheme. Wiring it to disk is a
// follow-up; this placeholder makes the gap visible during review.
async function writeBrandSystemPlaceholder(slug) {
  const dest = path.join(subdir(slug, 'brandSystem'), 'README.md');
  try { await access(dest); return; } catch { /* write below */ }
  const body =
`# Brand System (placeholder)

Brand-system artifacts for this slug are **not yet mirrored to disk**.

They currently live in:
- Firestore: \`dashboard_state/{clientId}.brandSystem\` — generated JSON, prompts, sources
- Firebase Storage: \`clients/{clientId}/brand-system/...\` — uploaded images (logo, mood-board, etc.)

The brand-system uses a separate \`clientId\` (from \`users/{uid}.clientId\`),
which does not currently match the leadgen slug \`${slug}\`. Mirroring requires
a slug ↔ clientId mapping step. Track as a follow-up.
`;
  await writeFile(dest, body, 'utf8');
}

export async function writeClientRecord(slug, partial) {
  const dest = path.join(clientRoot(slug), 'client.json');
  let existing = {};
  try { existing = JSON.parse(await readFile(dest, 'utf8')); } catch { /* first write */ }
  const merged = { ...existing, ...partial, slug, updatedAt: new Date().toISOString() };
  await writeFile(dest, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

export async function readClientRecord(slug) {
  try { return JSON.parse(await readFile(path.join(clientRoot(slug), 'client.json'), 'utf8')); }
  catch { return null; }
}

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function countFiles(dir, predicate = () => true) {
  try {
    const entries = await readdir(dir);
    return entries.filter(predicate).length;
  } catch { return 0; }
}

export async function inspectClient(slug) {
  const root = clientRoot(slug);
  const probes = {
    'client.json':                                   path.join(root, 'client.json'),
    [`${SUBDIRS.onboarding}/prospect.json`]:         path.join(subdir(slug, 'onboarding'), 'prospect.json'),
    [`${SUBDIRS.onboarding}/onboard-answers.json`]:  path.join(subdir(slug, 'onboarding'), 'onboard-answers.json'),
    [`${SUBDIRS.onboarding}/audit.json`]:            path.join(subdir(slug, 'onboarding'), 'audit.json'),
    [`${SUBDIRS.scraped}/content.json`]:             path.join(subdir(slug, 'scraped'),    'content.json'),
    [`${SUBDIRS.brief}/DESIGN.MD`]:                  path.join(subdir(slug, 'brief'),      'DESIGN.MD'),
    [`${SUBDIRS.generation}/generation-prompt.txt`]: path.join(subdir(slug, 'generation'), 'generation-prompt.txt'),
    [`${SUBDIRS.deploy}/preview-meta.json`]:         path.join(subdir(slug, 'deploy'),     'preview-meta.json'),
    [`${SUBDIRS.comparison}/readiness.json`]:        path.join(subdir(slug, 'comparison'), 'readiness.json'),
    'index.html':                                    path.join(root, 'index.html'),
    'gsap-kit.js':                                   path.join(root, 'gsap-kit.js'),
  };
  const status = {};
  for (const [key, p] of Object.entries(probes)) status[key] = await exists(p);

  const assetCount       = await countFiles(assetsDir(slug),                f => /\.(jpg|jpeg|png|webp|svg|gif)$/i.test(f));
  const brandSystemFiles = await countFiles(subdir(slug, 'brandSystem'),    f => f !== 'README.md');

  return { status, assetCount, brandSystemFiles };
}

export async function writeClientReadme(slug, { record = null } = {}) {
  const rec = record || await readClientRecord(slug);
  const insp = await inspectClient(slug);
  const tick = (ok) => ok ? '✓' : '·';

  const stages = [
    { title: '01 — Onboarding', files: [
      `${SUBDIRS.onboarding}/prospect.json`,
      `${SUBDIRS.onboarding}/onboard-answers.json`,
      `${SUBDIRS.onboarding}/audit.json`,
    ]},
    { title: '02 — Scraped',      files: [`${SUBDIRS.scraped}/content.json`] },
    { title: '03 — Brand System', files: [],
      note: insp.brandSystemFiles
        ? `${insp.brandSystemFiles} file(s) present in ${SUBDIRS.brandSystem}/`
        : `Not mirrored yet — see ${SUBDIRS.brandSystem}/README.md` },
    { title: '04 — Brief',        files: [`${SUBDIRS.brief}/DESIGN.MD`] },
    { title: '05 — Generation',   files: [`${SUBDIRS.generation}/generation-prompt.txt`, 'index.html', 'gsap-kit.js'],
      note: `${insp.assetCount} asset file(s) in /assets` },
    { title: '06 — Deploy',       files: [`${SUBDIRS.deploy}/preview-meta.json`] },
    { title: '07 — Comparison',   files: [`${SUBDIRS.comparison}/readiness.json`] },
  ];

  const stageBlocks = stages.map(s => {
    const fileLines = s.files.length
      ? s.files.map(f => `  - [${tick(insp.status[f])}] ${f}`).join('\n')
      : '  _(see note below)_';
    const note = s.note ? `\n  > ${s.note}` : '';
    return `### ${s.title}\n${fileLines}${note}`;
  }).join('\n\n');

  const headerLines = [
    `# ${rec?.name || slug}`,
    '',
    `**Slug:** \`${slug}\``,
    rec?.placeId    ? `**Place ID:** \`${rec.placeId}\``  : null,
    rec?.website    ? `**Website:** ${rec.website}`       : null,
    rec?.stage      ? `**Stage:** ${rec.stage}`           : null,
    rec?.previewUrl ? `**Preview:** ${rec.previewUrl}`    : null,
    rec?.updatedAt  ? `**Updated:** ${rec.updatedAt}`     : null,
  ].filter(Boolean).join('\n');

  const body = `${headerLines}\n\n## Pipeline status\n\n${stageBlocks}\n\n_Auto-generated. Do not edit by hand._\n`;
  await writeFile(path.join(clientRoot(slug), 'README.md'), body, 'utf8');
  return body;
}

// Convenience: ensure folder, write/merge record, refresh README in one go.
export async function syncClientFolder(slug, partial = {}) {
  await ensureClientFolder(slug);
  const record = await writeClientRecord(slug, partial);
  await writeClientReadme(slug, { record });
  return record;
}
