#!/usr/bin/env node
// run-clone.mjs — Phase 2 CLI: proves the clone engine end-to-end.
//
//   node services/site-clone/run-clone.mjs --url https://example.com
//   node services/site-clone/run-clone.mjs --job <jobId>
//
// --job claims the job from Firestore (clone_jobs, via api/_lib/clone-jobs.cjs
// — same lease mechanics as the EditVideos worker), streams progress into
// job.log[], and writes the result back onto the job doc. --url runs ad-hoc
// with no Firestore involvement, for local engine development — output goes
// to ./services/site-clone/.out/<timestamp>/.
//
// See docs/plans/SITE-RECREATE-AUTOMATION-PLAN.md for the pipeline this ports.

import path from 'path';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';

import { discoverPages } from './lib/discover.mjs';
import { downloadPages } from './lib/download.mjs';
import { mirrorAssets } from './lib/mirror.mjs';
import { finalizeLinks } from './lib/finalize.mjs';
import { stripScripts } from './lib/strip.mjs';
import { fixInlineScripts } from './lib/fix-inline-scripts.mjs';
import { verifyStatic } from './lib/verify.mjs';
import { compressImages } from './lib/compress.mjs';
import { writeSiteFiles, zipSite } from './lib/package.mjs';
import { validateUrl } from './lib/http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_PAGES = 15;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

/**
 * Run the full A1-A7 pipeline against a target URL. Pure — no Firestore, no
 * process.exit. `log` is called with a string at each stage boundary.
 *
 * @param {object} args
 * @param {string} args.targetUrl
 * @param {string} args.workDir       directory to write the recreated site into (must exist or be creatable)
 * @param {number} [args.maxPages]
 * @param {(line:string)=>void} [args.log]
 * @param {()=>void} [args.onBeforeVerify]  fires right before the A6 gate — lets a Firestore-aware
 *   caller flip the job status to 'verifying' without this function knowing about Firestore.
 * @returns {Promise<object>} { ok, platform, assetCount, totalBytes, pages, verifyReport, zipPath? }
 */
export async function runClone({ targetUrl, workDir, maxPages = MAX_PAGES, log = () => {}, onBeforeVerify = () => {} }) {
  await validateUrl(targetUrl); // re-validate at run time — the job doc's URL could be stale
  await mkdir(workDir, { recursive: true });

  log(`discoverPages: ${targetUrl}`);
  const { profile, pages: pagePaths, homepageHtml, homepageStatus, origin } = await discoverPages({ targetUrl, maxPages });
  log(`discoverPages: platform=${profile.platform}, ${pagePaths.length} pages (${pagePaths.join(', ')})`);

  log('downloadPages: fetching…');
  const downloaded = await downloadPages({ origin, pages: pagePaths, profile, homepageHtml, homepageStatus });
  log(`downloadPages: ${downloaded.length} pages fetched`);

  log('mirrorAssets: mirroring…');
  const mirrored = await mirrorAssets({
    outDir: workDir, pages: downloaded, origin, profile, log,
    maxTotalBytes: MAX_TOTAL_BYTES, maxAssetBytes: MAX_ASSET_BYTES,
  });
  log(`mirrorAssets: ${mirrored.assets.length} assets, ${mirrored.totalBytes} bytes`);

  const { pages: finalizedPages } = finalizeLinks({ pages: mirrored.pages, origin, profile });
  log('finalizeLinks: internal links rewritten, commerce hrefs neutralized');

  const { pages: strippedPages } = stripScripts({ pages: finalizedPages, profile, assets: mirrored.assets });
  log('stripScripts: killlist scripts removed');

  const { pages: fixedPages } = fixInlineScripts({ pages: strippedPages });
  log('fixInlineScripts: trailing-<script> guard applied');

  await writeSiteFiles({ outDir: workDir, pages: fixedPages, targetUrl, assetCount: mirrored.assets.length });

  onBeforeVerify();
  log('verifyStatic: verifying (0 console errors, 0 HTTP errors required)…');
  let verifyReport = await verifyStatic({ siteDir: workDir, pages: fixedPages });
  // Console-ONLY failures can be load-order races in heavy theme JS (seen on
  // tonysoccer.com: a transient "setAttribute of null" that never reproduced
  // on re-check). HTTP errors are deterministic — never retried. One retry,
  // and only a clean second pass is accepted.
  if (!verifyReport.pass && verifyReport.httpErrors === 0 && verifyReport.consoleErrors > 0) {
    log(`verifyStatic: ${verifyReport.consoleErrors} console errors (0 http) — possible timing flake, retrying once…`);
    verifyReport = await verifyStatic({ siteDir: workDir, pages: fixedPages });
  }
  log(`verifyStatic: ${verifyReport.consoleErrors} console errors, ${verifyReport.httpErrors} http errors — ${verifyReport.pass ? 'PASS' : 'FAIL'}`);

  const pageRefs = fixedPages.map((p) => ({ path: p.path, localFile: p.file }));

  if (!verifyReport.pass) {
    return {
      ok: false, platform: profile.platform, assetCount: mirrored.assets.length,
      totalBytes: mirrored.totalBytes, pages: pageRefs, verifyReport,
    };
  }

  log('compressImages: recompressing…');
  const compressResult = await compressImages({ outDir: workDir, assets: mirrored.assets, log });
  log(`compressImages: ${compressResult.beforeBytes}b -> ${compressResult.afterBytes}b`);

  const zipPath = `${workDir}.zip`;
  await zipSite({ outDir: workDir, zipPath });
  log(`packageSite: zipped to ${zipPath}`);

  return {
    ok: true,
    platform: profile.platform,
    assetCount: mirrored.assets.length,
    totalBytes: compressResult.afterBytes,
    pages: pageRefs,
    verifyReport,
    zipPath,
    siteDir: workDir,
  };
}

// --- CLI ---------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') args.url = argv[++i];
    else if (argv[i] === '--job') args.jobId = argv[++i];
    else if (argv[i] === '--max-pages') args.maxPages = Number(argv[++i]);
  }
  return args;
}

async function runAdHoc(targetUrl, maxPages) {
  const workDir = path.join(__dirname, '.out', `${Date.now()}`, 'site');
  const result = await runClone({ targetUrl, workDir, maxPages, log: (l) => console.log(`[clone] ${l}`) });
  console.log(JSON.stringify({ ...result, pages: undefined }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

/**
 * Claim a queued clone_jobs doc, run the pipeline, publish, and complete/fail
 * the job — the same logic the CLI's `--job` path and the Phase 4 Cloud Run
 * worker both use. Never throws; returns { ok, jobId, reason? } so callers
 * (CLI exit code, HTTP response) decide how to surface failure.
 *
 * @param {string} jobId
 * @param {object} [opts]
 * @param {number} [opts.maxPages]
 * @param {(line:string)=>void} [opts.log]  additional sink for progress lines (console by default)
 */
export async function runForJob(jobId, { maxPages, log: extraLog = () => {} } = {}) {
  const cloneJobsModule = await import('../../api/_lib/clone-jobs.cjs');
  const cloneJobs = cloneJobsModule.default ?? cloneJobsModule;
  const job = await cloneJobs.claimCloneJob(jobId, { workerId: `worker-${process.pid}` });
  if (!job) {
    return { ok: false, jobId, reason: 'Could not claim job (missing, already leased, or retry budget exhausted).' };
  }

  const workDir = path.join(__dirname, '.out', jobId, 'site');
  const log = (line) => { console.log(`[clone ${jobId}] ${line}`); extraLog(line); cloneJobs.appendJobLog(jobId, line).catch(() => {}); };
  const onBeforeVerify = () => { cloneJobs.markCloneJobVerifying(jobId).catch(() => {}); };

  try {
    const result = await runClone({ targetUrl: job.targetUrl, workDir, maxPages, log, onBeforeVerify });
    await cloneJobs.updateJobFields(jobId, { platform: result.platform });

    if (!result.ok) {
      await cloneJobs.failCloneJob(jobId, 'A6 verify gate failed — see verifyReport.', { verifyReport: result.verifyReport });
      return { ok: false, jobId, reason: 'A6 verify gate failed — see job.verifyReport.' };
    }

    log('packageSite: publishing (Storage zip + Vercel preview)…');
    const publishModule = await import('../../api/_lib/site-clone-publish.cjs');
    const { publishSiteClone } = publishModule.default ?? publishModule;
    const published = await publishSiteClone({
      clientId: job.clientId, jobId, siteDir: result.siteDir, zipPath: result.zipPath, log,
    });

    await cloneJobs.completeCloneJob(jobId, {
      zip: published.zip,
      preview: published.preview,
      verifyReport: result.verifyReport,
      assetCount: result.assetCount,
      totalBytes: result.totalBytes,
      pages: result.pages,
    });
    return { ok: true, jobId, zip: published.zip, preview: published.preview };
  } catch (err) {
    await cloneJobs.requeueCloneJob(jobId, err).catch(() => {});
    return { ok: false, jobId, reason: err.message };
  }
}

async function main() {
  const { url, jobId, maxPages } = parseArgs(process.argv.slice(2));
  if (jobId) {
    const result = await runForJob(jobId, { maxPages });
    if (result.ok) {
      console.log(`Done. Zip: ${result.zip.downloadUrl}${result.preview ? ` · Preview: ${result.preview.vercelUrl}` : ''}`);
    } else {
      console.error(`Clone run failed: ${result.reason}`);
      process.exitCode = 1;
    }
  } else if (url) {
    await runAdHoc(url, maxPages);
  } else {
    console.error('Usage: node run-clone.mjs --url <url> | --job <jobId> [--max-pages N]');
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
