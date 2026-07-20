#!/usr/bin/env node
// snapshot-cms.mjs — republish preflight (SSOT §5e): capture a fresh static
// snapshot of the AUTHORITATIVE origin for a job — the hosted Payload CMS if
// deployed (owned tier), else the HITLOOP-hosted demo (managed tier) — verify
// it with the A6 gate, and upload snapshot.zip. `arweave-deploy` then ships
// this instead of the original mirror, so a republish carries the edits.
//
//   node --env-file=.env.local services/site-clone/snapshot-cms.mjs --job <jobId>
//
// The origin already serves clean post-strip HTML (both tiers render the
// overlay templates), so this is a focused re-mirror: fetch each page,
// download every referenced asset (preview-origin /assets/* + Payload
// /api/media/file/*), rewrite refs to local paths, verify, zip, upload.

import path from 'path';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { load } from 'cheerio';

import { verifyStatic } from './lib/verify.mjs';
import { zipSite } from './lib/package.mjs';
import { pageSlug } from './lib/overlay.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sanitize = (p) => p.replace(/[^a-zA-Z0-9._/-]+/g, '_');

/** URL under one of the snapshot origins → stable local asset path. */
function localPathFor(u) {
  const url = new URL(u);
  if (url.pathname.startsWith('/assets/')) return sanitize(url.pathname.slice(1)); // keep assets/<host>/… layout
  if (url.pathname.startsWith('/api/media/file/')) return sanitize(`media/${decodeURIComponent(url.pathname.split('/').pop())}`);
  return sanitize(`assets/extra/${url.hostname}${url.pathname}`);
}

export async function snapshotCms({ job, log = console.log }) {
  const jobId = job.jobId;
  const origin = job.cms?.hostedUrl || `${process.env.HITLOOP_PUBLIC_ORIGIN || 'https://hitloop.agency'}${job.demo?.url || ''}`;
  if (!origin || origin.endsWith('undefined')) throw new Error('No authoritative origin — job has neither cms.hostedUrl nor demo.url.');
  const isDemoOrigin = !job.cms?.hostedUrl;
  log(`snapshot: origin ${origin} (${isDemoOrigin ? 'managed/demo tier' : 'owned/CMS tier'})`);

  const pages = (job.pages || []).map((p) => {
    const file = p.localFile || p.file;
    const slug = pageSlug(file);
    return { path: p.path, file, slug, url: `${origin.replace(/\/$/, '')}/${slug === 'home' ? '' : slug}` };
  });
  if (!pages.length) throw new Error('Job has no pages list.');

  const workDir = path.join(__dirname, '.out', jobId, 'snapshot');
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  // Fetch pages, collect asset refs, rewrite to local.
  const assetUrls = new Map(); // absUrl -> localPath
  const slugToFile = new Map(pages.map((p) => [p.slug, p.file]));
  for (const pg of pages) {
    const res = await fetch(pg.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${pg.url}`);
    const $ = load(await res.text());

    const rewrite = (raw) => {
      if (!raw) return raw;
      let abs;
      try { abs = new URL(raw, pg.url).toString(); } catch { return raw; }
      const u = new URL(abs);
      const isAsset = u.pathname.startsWith('/assets/') || u.pathname.startsWith('/api/media/file/');
      if (!isAsset) {
        // Internal page link (origin-relative or /sites/<jobId>/<slug>) → local file.
        const clean = u.pathname.replace(/^\/sites\/[^/]+/, '').replace(/^\/+|\/+$/g, '');
        const slug = clean === '' ? 'home' : clean;
        if ((u.origin === new URL(pg.url).origin) && slugToFile.has(slug)) return slugToFile.get(slug);
        return raw;
      }
      const local = localPathFor(abs);
      assetUrls.set(abs, local);
      return local;
    };

    $('[src]').each((_, el) => { $(el).attr('src', rewrite($(el).attr('src'))); });
    $('[href]').each((_, el) => { $(el).attr('href', rewrite($(el).attr('href'))); });
    $('[poster]').each((_, el) => { $(el).attr('poster', rewrite($(el).attr('poster'))); });
    $('[srcset]').each((_, el) => {
      const v = $(el).attr('srcset');
      if (!v) return;
      $(el).attr('srcset', v.split(',').map((part) => {
        const [u2, ...desc] = part.trim().split(/\s+/);
        return [rewrite(u2), ...desc].join(' ');
      }).join(', '));
    });
    const fixCss = (css) => css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u2) => `url(${q}${rewrite(u2)}${q})`);
    $('[style]').each((_, el) => { $(el).attr('style', fixCss($(el).attr('style') || '')); });
    $('style').each((_, el) => { const css = $(el).html(); if (css) $(el).html(fixCss(css)); });

    await writeFile(path.join(workDir, pg.file), $.html(), 'utf8');
    log(`snapshot: page ${pg.file}`);
  }

  // Download assets sequentially (gentle, like the mirror).
  let bytes = 0;
  for (const [abs, local] of assetUrls) {
    const dest = path.join(workDir, local);
    await mkdir(path.dirname(dest), { recursive: true });
    const res = await fetch(abs).catch(() => null);
    if (!res || !res.ok) { log(`snapshot: WARN asset ${res?.status || 'ERR'} ${abs}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    bytes += buf.length;
    // CSS may reference further assets — one level of recursion is enough
    // here because the mirror already flattened deep chains at clone time.
    if (local.endsWith('.css')) {
      const css = buf.toString('utf8');
      const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
      let m;
      while ((m = re.exec(css))) {
        try {
          const sub = new URL(m[2], abs).toString();
          const u = new URL(sub);
          if ((u.pathname.startsWith('/assets/') || u.pathname.startsWith('/api/media/file/')) && !assetUrls.has(sub)) {
            assetUrls.set(sub, localPathFor(sub));
          }
        } catch { /* ignore malformed */ }
      }
    }
  }
  log(`snapshot: ${assetUrls.size} assets, ${bytes} bytes`);

  // A6 gate on the snapshot.
  const report = await verifyStatic({ siteDir: workDir, pages: pages.map((p) => ({ path: p.path, file: p.file })) });
  log(`snapshot: verify — ${report.consoleErrors} console, ${report.httpErrors} http — ${report.pass ? 'PASS' : 'FAIL'}`);
  if (!report.pass) throw new Error('Snapshot failed the A6 gate — not uploading.');

  const zipPath = path.join(__dirname, '.out', jobId, 'snapshot.zip');
  await rm(zipPath, { force: true });
  await zipSite({ outDir: workDir, zipPath });
  return { zipPath, origin, pageCount: pages.length, assetCount: assetUrls.size, bytes };
}

// ── CLI ────────────────────────────────────────────────────────────────────
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  (async () => {
    const i = process.argv.indexOf('--job');
    const jobId = i === -1 ? null : process.argv[i + 1];
    if (!jobId) { console.error('Usage: snapshot-cms.mjs --job <jobId>'); process.exit(1); }
    const cloneJobs = await import('../../api/_lib/clone-jobs.cjs').then((m) => m.default ?? m);
    const { saveBufferArtifact } = await import('../../api/_lib/storage-artifacts.cjs').then((m) => m.default ?? m);
    const log = (line) => { console.log(`[snap ${jobId}] ${line}`); cloneJobs.appendJobLog(jobId, line).catch(() => {}); };
    const job = await cloneJobs.getCloneJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found.`);
    const snap = await snapshotCms({ job, log });
    const buffer = await readFile(snap.zipPath);
    const storagePath = `clients/${job.clientId}/site-clone/${jobId}/snapshot.zip`;
    const stored = await saveBufferArtifact({ storagePath, buffer, contentType: 'application/zip', metadata: { jobId, kind: 'snapshot' } });
    await cloneJobs.updateJobFields(jobId, {
      snapshot: {
        storagePath,
        downloadUrl: stored.downloadUrl,
        bytes: stored.sizeBytes,
        origin: snap.origin,
        pageCount: snap.pageCount,
        assetCount: snap.assetCount,
        at: new Date().toISOString(),
      },
    });
    log(`snapshot: uploaded (${stored.sizeBytes}b) — job.snapshot set`);
    console.log('Done.');
    process.exit(0);
  })().catch((err) => { console.error(err); process.exit(1); });
}
