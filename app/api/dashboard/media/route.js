import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const mediaJobs = require('../../../../api/_lib/media-jobs.cjs');
const { validateRemixRecipe } = require('../../../../api/_lib/media-recipe.cjs');
const {
  enqueueVideoJob,
  triggerWorker,
  listSourceFolders,
  listSourceFoldersWithCounts,
  listFolderMedia,
  createUploadSession,
  invalidateFolderCache,
  listOptions,
} = require('../../../../api/_lib/editvideos-bridge.cjs');
const { reconcileMediaJob } = require('../../../../api/_lib/media-reconcile.cjs');

// Metadata-only route: it creates/reads media_jobs records and writes pending
// markers to dashboard_state. No file bytes, no FFmpeg, no Arweave upload ever
// pass through this Vercel function — that work lives in an external worker.
// See docs/plans/EDITVIDEOS_TO_HITLOOP_CARDS_PLAN.md (Phase 2 + Build Rules).
export const dynamic = 'force-dynamic';

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

// Mirror studio-render-core.appendCaptureRef: client-scoped dashboard_state doc,
// transactional merge-set so the live card listener flips to "Queued" without
// clobbering sibling fields.
async function setVideoPending(clientId, marker) {
  const docRef = fb.adminDb.collection('dashboard_state').doc(clientId);
  await fb.adminDb.runTransaction(async (tx) => {
    await tx.get(docRef);
    tx.set(docRef, { mediaVideoPending: marker }, { merge: true });
  });
}

export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const action = new URL(request.url).searchParams.get('action');

  if (action === 'create-video-remix') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    let recipe;
    try {
      recipe = validateRemixRecipe(body);
    } catch (err) {
      return json({ error: err.message }, 400);
    }

    try {
      const { jobId } = await mediaJobs.createMediaJob({
        clientId: context.clientId,
        type: 'video-remix',
        recipe,
      });

      // Bridge into the LIVE EditVideos pipeline. If the bridge is unconfigured
      // we still return the queued job (the backstop cron can pick it up once
      // creds land), so a missing credential degrades instead of failing.
      let editJobId = null;
      try {
        ({ editJobId } = await enqueueVideoJob(recipe));
        await mediaJobs.setMediaJobEditRef(jobId, editJobId);
        // Fire the EditVideos GitHub Action now — its cron is throttled (free
        // tier), so without this the job sits queued. Best-effort, non-blocking.
        triggerWorker().then((r) => {
          if (!r.triggered) console.warn(`[media] EditVideos worker not triggered: ${r.reason || r.status}`);
        }).catch(() => {});
      } catch (bridgeErr) {
        console.warn(`[media] EditVideos enqueue failed: ${bridgeErr?.message}`);
      }

      await setVideoPending(context.clientId, {
        jobId,
        editJobId,
        type: 'video-remix',
        queuedAt: new Date().toISOString(),
        sourceFolders: recipe.sourceFolders,
      });
      return json({ ok: true, queued: true, jobId, editJobId }, 202);
    } catch (err) {
      return json({ error: `Could not queue media job: ${err.message}` }, 500);
    }
  }

  if (action === 'create-upload-session') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    try {
      const session = await createUploadSession(body || {});
      return json({ ok: true, session });
    } catch (err) {
      return json({ error: err.message || 'Could not create upload session.' }, 400);
    }
  }

  if (action === 'complete-upload') {
    invalidateFolderCache();
    return json({ ok: true });
  }

  return json({ error: 'Unknown action.' }, 400);
}

export async function GET(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const clientId = context.clientId;
  const params = new URL(request.url).searchParams;
  const action = params.get('action');

  try {
    if (action === 'job') {
      const jobId = params.get('jobId');
      if (!jobId) return json({ error: 'jobId is required.' }, 400);
      let job = await mediaJobs.getMediaJob(jobId, clientId);
      if (!job) return json({ error: 'Media job not found.' }, 404);
      // Pull the live EditVideos result forward so polling flips the card.
      try {
        await reconcileMediaJob(job, clientId);
        job = (await mediaJobs.getMediaJob(jobId, clientId)) || job;
      } catch (recErr) {
        console.warn(`[media] reconcile failed for ${jobId}: ${recErr?.message}`);
      }
      return json({ ok: true, job });
    }

    if (action === 'jobs') {
      const type = params.get('type') || null;
      let jobs = await mediaJobs.listMediaJobs(clientId, { type, limit: 20 });
      const activeJobs = jobs.filter((job) => job?.editJobId && (job.status === 'queued' || job.status === 'processing'));
      if (activeJobs.length) {
        await Promise.all(activeJobs.slice(0, 5).map((job) => (
          reconcileMediaJob(job, clientId).catch((recErr) => {
            console.warn(`[media] reconcile failed for ${job.jobId}: ${recErr?.message}`);
          })
        )));
        jobs = await mediaJobs.listMediaJobs(clientId, { type, limit: 20 });
      }
      return json({ ok: true, jobs });
    }

    if (action === 'folders') {
      try {
        if (params.get('withCounts') === '1') {
          try {
            const folders = await listSourceFoldersWithCounts();
            return json({ ok: true, folders });
          } catch (countErr) {
            console.warn(`[media] counted folder listing failed: ${countErr?.message}`);
            const folders = await listSourceFolders();
            return json({ ok: true, folders: folders.map((name) => ({ name, displayName: name, count: null, type: name.includes('/') ? 'nested' : 'root' })) });
          }
        }
        const folders = await listSourceFolders();
        return json({ ok: true, folders });
      } catch {
        // Bridge unconfigured — degrade to an empty list so the card falls back.
        return json({ ok: true, folders: [] });
      }
    }

    if (action === 'folder-files') {
      const folder = params.get('folder');
      if (!folder) return json({ error: 'folder is required.' }, 400);
      try {
        const result = await listFolderMedia(folder, { limit: Number(params.get('limit') || 60) });
        return json({ ok: true, ...result });
      } catch (err) {
        return json({ error: err.message || 'Could not list folder media.' }, 400);
      }
    }

    if (action === 'options') {
      try {
        const options = await listOptions();
        return json({ ok: true, options });
      } catch {
        // Bridge unconfigured — degrade so the params tab still renders (Random only).
        return json({ ok: true, options: { filters: [], overlays: [], artists: [], logos: [] } });
      }
    }
  } catch (err) {
    return json({ error: `Could not read media jobs: ${err.message}` }, 500);
  }

  return json({ error: 'Unknown action.' }, 400);
}
