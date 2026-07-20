#!/usr/bin/env node
// build-cms.mjs — Phase 5: turn a completed clone job's mirror into an
// editable Payload 3 + Next.js project (libSQL file DB by default, Turso via
// env), seeded with the site's extracted content.
//
//   node services/site-clone/build-cms.mjs --job <jobId> [--verify] [--no-upload]
//   node services/site-clone/build-cms.mjs --dir <siteDir> --url <targetUrl> [--verify]
//
// --job reads the mirror from .out/<jobId>/site, uploads cms.zip to Storage
// and writes job.cms onto the clone_jobs doc. --dir runs ad-hoc, no Firestore.
// --verify = runbook B7 gate: npm install + seed + next dev + curl / and
// /admin (all must be 200) before the zip is built.
//
// Scaffolds from cms-template/ (static files + {{PLACEHOLDER}} substitution)
// — NEVER create-payload-app (runbook gotcha #1). Versions pinned in the
// template (gotcha #2). See docs/plans/SITE-RECREATE-CMS-LAYER-PLAN.md.

import path from 'path';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { cp, mkdir, readdir, readFile, rename, rm, writeFile, copyFile } from 'fs/promises';
import { fileURLToPath } from 'url';

import { extractSiteContent } from './lib/extract.mjs';
import { tokenizeSite } from './lib/overlay.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, 'cms-template');

// ── helpers ────────────────────────────────────────────────────────────────

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'site';

/** Copy the template tree, substituting {{PLACEHOLDER}}s and stripping .tpl.
 *  (Slot tokens like `{{slot:home-3}}` are lowercase and never match the
 *  `[A-Z_]+` placeholder pattern — but templates/*.html are written outside
 *  this scaffold pass anyway.) */
async function scaffold(templateDir, outDir, replacements) {
  const sub = (s) => s.replace(/{{([A-Z_]+)}}/g, (m, key) => (key in replacements ? replacements[key] : m));
  async function walk(src, dest) {
    await mkdir(dest, { recursive: true });
    for (const entry of await readdir(src, { withFileTypes: true })) {
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name.replace(/\.tpl$/, ''));
      if (entry.isDirectory()) await walk(from, to);
      else await writeFile(to, sub(await readFile(from, 'utf8')), 'utf8');
    }
  }
  await walk(templateDir, outDir);
}

function runCmd(cmd, args, { cwd, env, log, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const onData = (buf) => { tail = (tail + buf.toString()).slice(-4000); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      if (code === 0) resolve(tail);
      else reject(new Error(`${label || cmd} exited ${code}: …${tail.slice(-600)}`));
    });
    child.on('error', reject);
  });
}

async function httpStatus(url) {
  try {
    const res = await fetch(url, { redirect: 'manual' });
    return res.status;
  } catch {
    return 0;
  }
}

// ── main build ─────────────────────────────────────────────────────────────

export async function buildCms({ siteDir, targetUrl, outBase, log = console.log }) {
  // extract still supplies siteName (project slug) — the page CONTENT now
  // comes from the overlay tokenizer, which preserves the theme exactly.
  const { settings } = await extractSiteContent({ siteDir, targetUrl, log: () => {} });
  const tokenized = await tokenizeSite({ siteDir, log });
  const project = slugify(settings.siteName);
  const projectDir = path.join(outBase, `${project}-cms`);

  // Preserve node_modules across rebuilds — a full reinstall is minutes.
  const keepModules = path.join(outBase, '.node_modules-keep');
  await rm(keepModules, { recursive: true, force: true });
  await rename(path.join(projectDir, 'node_modules'), keepModules).catch(() => {});
  await rm(projectDir, { recursive: true, force: true });

  log(`buildCms: scaffolding ${project}-cms (exact-mirror overlay, Payload 3.86 + libSQL/Turso)…`);
  await scaffold(TEMPLATE_DIR, projectDir, {
    PROJECT: project,
    SITE_NAME: settings.siteName,
    SOURCE_URL: settings.sourceUrl,
    PAYLOAD_SECRET: randomBytes(24).toString('hex'),
  });
  await rename(keepModules, path.join(projectDir, 'node_modules')).catch(() => {});
  // Ship a working .env (defaults) alongside the annotated .env.example.
  await copyFile(path.join(projectDir, '.env.example'), path.join(projectDir, '.env'));

  // The site's assets ship verbatim — that's what keeps the theme exact.
  await cp(path.join(siteDir, 'assets'), path.join(projectDir, 'public', 'assets'), { recursive: true });

  // Tokenized templates + slot seed data.
  const templatesDir = path.join(projectDir, 'templates');
  const seedDir = path.join(projectDir, 'seed-data');
  await mkdir(templatesDir, { recursive: true });
  await mkdir(seedDir, { recursive: true });
  const seedPages = [];
  let slotCount = 0;
  for (const pg of tokenized) {
    await writeFile(path.join(templatesDir, pg.sourceFile), pg.html, 'utf8');
    seedPages.push({ slug: pg.slug, title: pg.title, sourceFile: pg.sourceFile, slots: pg.slots });
    slotCount += pg.slots.length;
  }
  await writeFile(path.join(seedDir, 'pages.json'), JSON.stringify(seedPages, null, 2));
  log(`buildCms: ${seedPages.length} pages templated, ${slotCount} editable slots`);

  return { project, projectDir, pageCount: seedPages.length, slotCount, tokenizedPages: tokenized };
}

/** B7 gate: install + seed + dev server up + / and /admin return 200, AND the
 *  rendered home page proves the overlay is exact — original theme assets
 *  referenced, a known original text present, zero unreplaced slot tokens. */
export async function verifyCms({ projectDir, expectText = '', log = console.log }) {
  log('verifyCms: npm install (this takes a few minutes)…');
  await runCmd('npm', ['install', '--no-audit', '--no-fund'], { cwd: projectDir, log, label: 'npm install' });
  log('verifyCms: npm run seed…');
  await runCmd('npm', ['run', 'seed'], { cwd: projectDir, log, label: 'seed' });

  log('verifyCms: starting next dev on :3100…');
  const child = spawn('npm', ['run', 'dev'], { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let devTail = '';
  const onData = (buf) => { devTail = (devTail + buf.toString()).slice(-4000); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  try {
    let home = 0;
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 3000));
      home = await httpStatus('http://localhost:3100/');
      if (home === 200) break;
    }
    const admin = await httpStatus('http://localhost:3100/admin');
    // /admin redirects (307/302) to /admin/login on a fresh DB — that counts
    // as "admin is up". 200 = already-authed or login page directly.
    const adminOk = [200, 302, 307].includes(admin);

    let bodyOk = false;
    let tokensLeft = -1;
    let themeOk = false;
    if (home === 200) {
      const html = await fetch('http://localhost:3100/').then((r) => r.text()).catch(() => '');
      tokensLeft = (html.match(/{{slot(?:set)?:/g) || []).length;
      themeOk = html.includes('/assets/');
      bodyOk = !expectText || html.includes(expectText);
    }
    const pass = home === 200 && adminOk && tokensLeft === 0 && themeOk && bodyOk;
    log(`verifyCms: / -> ${home}, /admin -> ${admin}, theme assets ${themeOk ? 'yes' : 'NO'}, leftover tokens ${tokensLeft}, content ${bodyOk ? 'yes' : 'NO'} — ${pass ? 'PASS' : 'FAIL'}`);
    if (!pass) throw new Error(`verifyCms gate failed (/ ${home}, /admin ${admin}, tokens ${tokensLeft}, theme ${themeOk}, content ${bodyOk}): …${devTail.slice(-600)}`);
    return { home, admin, pass };
  } finally {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const getFlag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : args[i + 1];
  };
  const jobId = getFlag('--job');
  const dirArg = getFlag('--dir');
  const verify = args.includes('--verify');
  const noUpload = args.includes('--no-upload');

  let siteDir;
  let targetUrl;
  let job = null;
  let cloneJobs = null;

  if (jobId) {
    cloneJobs = await import('../../api/_lib/clone-jobs.cjs').then((m) => m.default ?? m);
    job = await cloneJobs.getCloneJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found.`);
    siteDir = path.join(__dirname, '.out', jobId, 'site');
    targetUrl = job.targetUrl;
  } else if (dirArg) {
    siteDir = path.resolve(dirArg);
    targetUrl = getFlag('--url') || 'https://example.com/';
  } else {
    console.error('Usage: build-cms.mjs --job <jobId> [--verify] [--no-upload] | --dir <siteDir> --url <targetUrl>');
    process.exit(1);
  }

  const log = (line) => {
    console.log(jobId ? `[cms ${jobId}] ${line}` : line);
    if (jobId && cloneJobs) cloneJobs.appendJobLog(jobId, line).catch(() => {});
  };

  const outBase = jobId ? path.join(__dirname, '.out', jobId) : path.join(__dirname, '.out', 'adhoc-cms');
  const built = await buildCms({ siteDir, targetUrl, outBase, log });

  if (verify) {
    // Exactness assertion: the rendered home page must contain the first real
    // text slot's original value.
    const seedPages = JSON.parse(await readFile(path.join(built.projectDir, 'seed-data', 'pages.json'), 'utf8'));
    const homePage = seedPages.find((p) => p.slug === 'home') || seedPages[0];
    const expectText = homePage?.slots?.find((s) => s.kind === 'text' && s.value.length >= 8 && !/[<>&]/.test(s.value))?.value || '';
    await verifyCms({ projectDir: built.projectDir, expectText, log });
  }

  // Zip AFTER verify so the artifact ships the pre-seeded DB + imported media
  // when the gate ran (node_modules/.next stay excluded either way).
  const zipPath = path.join(outBase, 'cms.zip');
  await rm(zipPath, { force: true });
  await zipCmsProject({ projectDir: built.projectDir, zipPath });
  log(`buildCms: zipped -> ${zipPath}`);

  if (jobId && !noUpload) {
    const { saveBufferArtifact } = await import('../../api/_lib/storage-artifacts.cjs').then((m) => m.default ?? m);
    const buffer = await readFile(zipPath);
    const storagePath = `clients/${job.clientId}/site-clone/${jobId}/cms.zip`;
    const stored = await saveBufferArtifact({
      storagePath,
      buffer,
      contentType: 'application/zip',
      metadata: { jobId, clientId: job.clientId, kind: 'cms' },
    });
    await cloneJobs.updateJobFields(jobId, {
      cms: {
        storagePath,
        downloadUrl: stored.downloadUrl,
        bytes: stored.sizeBytes,
        project: built.project,
        pageCount: built.pageCount,
        slotCount: built.slotCount,
        verified: verify,
      },
    });
    log(`buildCms: cms.zip uploaded (${stored.sizeBytes}b) — job.cms set`);

    // Hosted demo (default): publish templates+slots into HITLOOP so the card
    // links a live, editable /sites/<jobId>/ URL. Needs the static preview
    // origin to serve assets — without one the demo is skipped, not failed.
    if (!args.includes('--no-demo')) {
      const previewOrigin = job.preview?.vercelUrl || '';
      if (!previewOrigin) {
        log('buildCms: no static preview URL on the job — skipping hosted demo (zip-only).');
      } else {
        const cloneDemo = await import('../../api/_lib/clone-demo.cjs').then((m) => m.default ?? m);
        const demo = await cloneDemo.publishCloneDemo({
          jobId,
          clientId: job.clientId,
          pages: built.tokenizedPages,
          previewOrigin,
          log,
        });
        await cloneJobs.updateJobFields(jobId, {
          demo: { url: demo.url, pageCount: demo.pageCount, slotCount: demo.slotCount, publishedAt: new Date().toISOString() },
        });
        log(`buildCms: hosted demo published — ${demo.url}`);
      }
    }
    console.log(`Done. CMS zip: ${stored.downloadUrl}`);
  } else {
    console.log(`Done. Project: ${built.projectDir}`);
  }
  process.exit(0);
}

async function zipCmsProject({ projectDir, zipPath }) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  await mkdir(path.dirname(zipPath), { recursive: true });
  await execFileAsync('zip', ['-r', '-q', zipPath, '.', '-x', 'node_modules/*', '.next/*'], { cwd: projectDir });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
