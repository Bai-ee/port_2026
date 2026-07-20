import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { validateUrl } = require('../../../../api/_lib/safe-fetch.cjs');
const cloneJobs = require('../../../../api/_lib/clone-jobs.cjs');

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
  let context;
  let decoded;
  try {
    ({ context, decoded } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const action = new URL(request.url).searchParams.get('action');

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

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err.message || 'Site-clone read failed.' }, err.status || 500);
  }
}
