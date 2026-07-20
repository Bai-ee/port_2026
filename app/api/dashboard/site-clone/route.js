import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { validateUrl } = require('../../../../api/_lib/safe-fetch.cjs');
const cloneJobs = require('../../../../api/_lib/clone-jobs.cjs');
const cloneDemo = require('../../../../api/_lib/clone-demo.cjs');
const editvideosBridge = require('../../../../api/_lib/editvideos-bridge.cjs');

// Site Recreate — metadata-only route. It creates/reads clone_jobs records.
// No fetch/parse/mirror of the target site ever happens in this Vercel
// function — that work is the services/site-clone engine, run by an admin CLI
// (Phase 2) and later a Cloud Run worker (Phase 4). See
// docs/plans/SITE-RECREATE-AUTOMATION-PLAN.md.
export const dynamic = 'force-dynamic';

const MAX_JOBS_PER_CLIENT = 200;

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) { const e = new Error('No user record.'); e.status = 404; throw e; }
  if (!context.clientId) { const e = new Error('No clientId on user record.'); e.status = 404; throw e; }
  return { decoded, context };
}

// Cloning arbitrary sites is a legal/abuse surface (see plan Risk #1) — job
// creation stays admin-only in v1. Reads (status/list) stay open so a
// non-admin can see an existing result, matching the Media Library pattern.
async function requireAdmin(decoded) {
  const ok = await isAdminEmail(decoded?.email);
  if (!ok) { const e = new Error('Forbidden: admin access required.'); e.status = 403; throw e; }
}

// Phase 4 (best-effort): if a Cloud Run worker is configured, ping it right
// after job creation so it claims and runs the job with zero human touch.
// Never blocks or fails job creation — an unreachable/unconfigured worker
// just leaves the job `queued` for the Phase 2 admin CLI as a fallback.
async function triggerWorker(jobId) {
  const url = String(process.env.SITE_CLONE_WORKER_URL || '').trim();
  const secret = String(process.env.SITE_CLONE_SHARED_SECRET || '').trim();
  if (!url || !secret) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(`${url.replace(/\/$/, '')}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-secret': secret },
      body: JSON.stringify({ jobId }),
      signal: controller.signal,
    }).catch(() => {});
    clearTimeout(timer);
  } catch { /* best-effort trigger only */ }
}

export async function POST(request) {
  const action = new URL(request.url).searchParams.get('action');

  // Owned-tier dirty flag: the hosted Payload CMS's afterChange hook posts
  // here on every content edit. Machine-to-machine — authenticated by the
  // per-job webhook secret minted at deploy time (deploy-cms.mjs), NOT by a
  // user token, so this runs BEFORE resolveContext.
  if (action === 'content-changed') {
    try {
      let body = {};
      try { body = await request.json(); } catch { body = {}; }
      const jobId = String(body?.jobId || '').trim();
      const secret = String(body?.secret || '').trim();
      if (!jobId || !secret) return json({ error: 'jobId and secret are required.' }, 400);
      const job = await cloneJobs.getCloneJob(jobId);
      if (!job?.cms?.webhookSecret || job.cms.webhookSecret !== secret) {
        return json({ error: 'Invalid webhook credentials.' }, 403);
      }
      await cloneJobs.updateJobFields(jobId, { contentUpdatedAt: new Date().toISOString() });
      return json({ ok: true });
    } catch (err) {
      return json({ error: err.message || 'content-changed failed.' }, 500);
    }
  }

  let context;
  let decoded;
  try {
    ({ context, decoded } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  if (action === 'create') {
    try {
      await requireAdmin(decoded);
    } catch (err) {
      return json({ error: err.message }, err.status || 403);
    }

    let body = {};
    try { body = await request.json(); } catch { body = {}; }

    const rawUrl = String(body?.targetUrl || '').trim();
    if (!rawUrl) return json({ error: 'targetUrl is required.' }, 400);
    if (body?.ownershipAttested !== true) {
      return json({ error: 'Ownership attestation is required before a job can be created.' }, 400);
    }

    try {
      const existing = await cloneJobs.listCloneJobs(context.clientId, { limit: MAX_JOBS_PER_CLIENT });
      if (existing.length >= MAX_JOBS_PER_CLIENT) {
        return json({ error: `Per-client job limit reached (${MAX_JOBS_PER_CLIENT}).` }, 429);
      }

      const parsed = await validateUrl(rawUrl);

      const { jobId } = await cloneJobs.createCloneJob({
        clientId: context.clientId,
        targetUrl: parsed.toString(),
        ownershipAttested: true,
      });
      await triggerWorker(jobId); // best-effort — bounded to a 5s ping, never blocks on the full run
      const job = await cloneJobs.getCloneJob(jobId, context.clientId);
      return json({ ok: true, jobId, job });
    } catch (err) {
      const status = String(err?.message || '').startsWith('SSRF_BLOCKED') ? 400 : (err.status || 500);
      return json({ error: err.message || 'Could not create clone job.' }, status);
    }
  }

  // Card content editor → hosted demo slot values. Writes are admin-gated
  // like `create`; the job must belong to the caller's client.
  if (action === 'save-slots') {
    try {
      await requireAdmin(decoded);
      let body = {};
      try { body = await request.json(); } catch { body = {}; }
      const jobId = String(body?.jobId || '').trim();
      const slug = String(body?.slug || '').trim();
      const edits = Array.isArray(body?.edits) ? body.edits : [];
      if (!jobId || !slug) return json({ error: 'jobId and slug are required.' }, 400);
      if (!edits.length) return json({ error: 'No edits provided.' }, 400);
      const job = await cloneJobs.getCloneJob(jobId, context.clientId);
      if (!job) return json({ error: 'Job not found.' }, 404);
      const result = await cloneDemo.saveClonePageSlots({ jobId, slug, edits });
      // Managed-tier dirty flag: any content edit stamps the job so the card
      // can show "changed since last Arweave publish" (SSOT §5e).
      await cloneJobs.updateJobFields(jobId, { contentUpdatedAt: new Date().toISOString() });
      return json({ ok: true, ...result });
    } catch (err) {
      return json({ error: err.message || 'Could not save edits.' }, err.status || 500);
    }
  }

  // One-click "host my site" — records the request on the job; the hosting
  // deploy (Turso db + cloud seed + Vercel build) runs via the admin CLI
  // `deploy-cms.mjs --job <id>` (same executor model as the clone engine —
  // a Vercel function cannot run npm/vercel builds). Card shows
  // "provisioning" until job.cms.hostedUrl lands.
  if (action === 'request-hosting') {
    try {
      await requireAdmin(decoded);
      let body = {};
      try { body = await request.json(); } catch { body = {}; }
      const jobId = String(body?.jobId || '').trim();
      const target = String(body?.target || 'vercel').trim();
      if (!jobId) return json({ error: 'jobId is required.' }, 400);
      if (!['vercel'].includes(target)) return json({ error: `Unsupported hosting target: ${target}.` }, 400);
      const job = await cloneJobs.getCloneJob(jobId, context.clientId);
      if (!job) return json({ error: 'Job not found.' }, 404);
      if (!job.cms?.downloadUrl) return json({ error: 'Build the CMS first — no CMS on this job yet.' }, 400);
      if (job.cms?.hostedUrl) return json({ ok: true, alreadyHosted: true, hostedUrl: job.cms.hostedUrl });
      const hostRequest = { target, requestedAt: new Date().toISOString(), requestedBy: decoded.email || null };
      await cloneJobs.updateJobFields(jobId, { hostRequest });
      return json({ ok: true, hostRequest });
    } catch (err) {
      return json({ error: err.message || 'Could not request hosting.' }, err.status || 500);
    }
  }

  // Launch the recreated static site on Arweave — wallet-funded + PERMANENT,
  // so admin-gated with an estimate-first confirm in the card (Archive/
  // Publishing pattern). Proxied to the EditVideos app; 503s cleanly until
  // its deploy-external-site endpoint ships (see SITE-RECREATE-CARD.md).
  if (action === 'arweave-deploy') {
    try {
      await requireAdmin(decoded);
      let body = {};
      try { body = await request.json(); } catch { body = {}; }
      const jobId = String(body?.jobId || '').trim();
      if (!jobId) return json({ error: 'jobId is required.' }, 400);
      const job = await cloneJobs.getCloneJob(jobId, context.clientId);
      if (!job) return json({ error: 'Job not found.' }, 404);
      if (!job.zip?.downloadUrl) return json({ error: 'Job has no site zip yet — run the clone first.' }, 400);

      // Republish uses the freshest snapshot of the AUTHORITATIVE origin
      // (snapshot-cms.mjs writes job.snapshot after content edits); first
      // publish falls back to the original mirror zip.
      const zipUrl = job.snapshot?.downloadUrl || job.zip.downloadUrl;
      const result = await editvideosBridge.deployExternalSite({
        zipUrl,
        siteId: jobId,
      });
      const arweave = {
        status: 'deployed',
        manifestId: result.manifestId || result.transactionId || null,
        arweaveUrl: result.arweaveUrl
          || (result.manifestId ? `https://arweave.net/${result.manifestId}` : null),
        arnsUrl: result.arnsUrl || null,
        fileCount: result.fileCount ?? null,
        sizeBytes: result.sizeBytes ?? null,
        deployedAt: new Date().toISOString(),
      };
      await cloneJobs.updateJobFields(jobId, { arweave });
      return json({ ok: true, arweave });
    } catch (err) {
      return json({ error: err.message || 'Arweave deploy failed.' }, err.status || 500);
    }
  }

  return json({ error: `Unknown action: ${action || '(none)'}` }, 400);
}

export async function GET(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'list';

  try {
    if (action === 'status') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId) return json({ error: 'jobId is required.' }, 400);
      const job = await cloneJobs.getCloneJob(jobId, context.clientId);
      if (!job) return json({ error: 'Job not found.' }, 404);
      return json({ ok: true, job });
    }

    if (action === 'list') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 20, MAX_JOBS_PER_CLIENT);
      const jobs = await cloneJobs.listCloneJobs(context.clientId, { limit });
      return json({ ok: true, jobs });
    }

    // Cost estimate for launching the site on Arweave (read-only: live AR
    // price × the mirror's byte total; no wallet touch).
    if (action === 'arweave-estimate') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId) return json({ error: 'jobId is required.' }, 400);
      const job = await cloneJobs.getCloneJob(jobId, context.clientId);
      if (!job) return json({ error: 'Job not found.' }, 404);
      const sizeBytes = Number(job.totalBytes || job.zip?.bytes || 0);
      const fileCount = Number(job.assetCount || 0) + (Array.isArray(job.pages) ? job.pages.length : 0);
      const estimate = await editvideosBridge.estimateArchiveFiles([
        { fileName: 'site', sizeBytes },
      ]);
      return json({ ok: true, estimate: { ...estimate, fileCount, sizeBytes } });
    }

    // Demo pages + slots for the card's content editor (reads open, matching
    // status/list — the demo itself is public by capability URL anyway).
    if (action === 'demo-pages') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId) return json({ error: 'jobId is required.' }, 400);
      const job = await cloneJobs.getCloneJob(jobId, context.clientId);
      if (!job) return json({ error: 'Job not found.' }, 404);
      const pages = await cloneDemo.listClonePages(jobId);
      return json({ ok: true, pages });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err.message || 'Site-clone read failed.' }, err.status || 500);
  }
}
