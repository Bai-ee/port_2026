import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');
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
  getMediaUsage,
  deleteSourceFiles,
  getArchiveManifest,
  getArchiveJob,
  normalizeArchiveSources,
  estimateArchiveFiles,
  archiveFirebaseFile,
  estimateWebsiteDeploy,
  deployWebsite,
  updateArns,
} = require('../../../../api/_lib/editvideos-bridge.cjs');
const {
  buildArchivedAsset,
  mergeArchivedAssets,
  buildLatestArchiveJob,
} = require('../../../../api/_lib/archive-publishing-projection.cjs');
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

// Archive / Publishing actions are admin-only (wallet-funded, irreversible
// Arweave uploads). Resolve admin from the verified token email, not the
// impersonation flag — a real admin acting on their own dashboard must pass.
async function requireAdmin(decoded) {
  const ok = await isAdminEmail(decoded?.email);
  if (!ok) { const e = new Error('Forbidden: admin access required.'); e.status = 403; throw e; }
}

const ARCHIVE_MUTATIONS = new Set(['archive-to-arweave', 'deploy-website', 'update-arns']);
const ADMIN_MEDIA_MUTATIONS = new Set(['delete-source-media']);

// Transactional merge into dashboard_state.{clientId}.archivePublishing so the
// card listener updates without clobbering sibling fields.
async function writeArchivePublishing(clientId, mutate) {
  const docRef = fb.adminDb.collection('dashboard_state').doc(clientId);
  await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const current = snap.data()?.archivePublishing || {};
    const next = mutate(current) || current;
    tx.set(docRef, { archivePublishing: next }, { merge: true });
  });
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
  let decoded;
  try {
    ({ context, decoded } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const action = new URL(request.url).searchParams.get('action');

  if (ADMIN_MEDIA_MUTATIONS.has(action)) {
    try {
      await requireAdmin(decoded);
    } catch (err) {
      return json({ error: err.message }, err.status || 403);
    }

    let body = {};
    try { body = await request.json(); } catch { body = {}; }

    try {
      if (action === 'delete-source-media') {
        const files = Array.isArray(body?.files) ? body.files.slice(0, 25) : [];
        const result = await deleteSourceFiles(files);
        return json({ ok: true, ...result });
      }
    } catch (err) {
      return json({ error: err.message || 'Media mutation failed.' }, err.status || 500);
    }
  }

  // --- Archive / Publishing (admin-only, Knowledge Officer card) -----------
  if (action && (action.startsWith('archive-') || ARCHIVE_MUTATIONS.has(action) || action === 'deploy-website')) {
    try {
      await requireAdmin(decoded);
    } catch (err) {
      return json({ error: err.message }, err.status || 403);
    }

    let body = {};
    try { body = await request.json(); } catch { body = {}; }

    try {
      if (action === 'archive-estimate') {
        const files = Array.isArray(body?.files) ? body.files : [];
        const estimate = await estimateArchiveFiles(files);
        await writeArchivePublishing(context.clientId, (cur) => ({
          ...cur,
          costEstimate: { mode: 'archive', ...estimate },
        }));
        return json({ ok: true, estimate });
      }

      if (action === 'archive-to-arweave') {
        const files = Array.isArray(body?.files) ? body.files.slice(0, 25) : [];
        if (!files.length) return json({ error: 'No files selected to archive.' }, 400);

        // One media_jobs parent record for the batch (audit/history).
        const { jobId } = await mediaJobs.createMediaJob({
          clientId: context.clientId,
          type: 'arweave-archive',
          recipe: { source: files[0]?.source || 'editvideosFolder', files },
        });
        await writeArchivePublishing(context.clientId, (cur) => ({
          ...cur,
          latestArchiveJob: buildLatestArchiveJob({ jobId, status: 'processing', fileCount: files.length }),
        }));

        const archivedAssets = [];
        const errors = [];
        for (const row of files) {
          // Map each row to an EditVideos {folder, fileName}. Source-folder rows
          // carry it directly; capture rows need a stored storagePath/folder.
          const folder = row.folder || (row.fullPath ? row.fullPath.split('/').slice(0, -1).join('/') : null);
          const fileName = row.fileName || (row.fullPath ? row.fullPath.split('/').pop() : null);
          if (!folder || !fileName) {
            errors.push({ label: row.label, error: 'No EditVideos storage path for this file.' });
            continue;
          }
          try {
            const result = await archiveFirebaseFile({ folder, fileName });
            archivedAssets.push(buildArchivedAsset(row, result));
          } catch (fileErr) {
            errors.push({ label: row.label, error: fileErr.message || 'Archive failed.' });
          }
        }

        const status = archivedAssets.length === 0 ? 'failed'
          : errors.length ? 'partial' : 'done';
        await writeArchivePublishing(context.clientId, (cur) => {
          const merged = mergeArchivedAssets(cur, archivedAssets);
          return {
            ...merged,
            latestArchiveJob: buildLatestArchiveJob({
              jobId,
              status,
              fileCount: files.length,
              error: errors.length ? `${errors.length} file(s) failed` : null,
              completedAt: new Date().toISOString(),
            }),
          };
        });
        if (status === 'done') await mediaJobs.completeMediaJob(jobId, { archivedFiles: archivedAssets });
        else if (status === 'failed') await mediaJobs.failMediaJob(jobId, errors[0]?.error || 'Archive failed.');
        else await mediaJobs.completeMediaJob(jobId, { archivedFiles: archivedAssets, errors });

        return json({ ok: true, jobId, status, archivedAssets, errors });
      }

      if (action === 'deploy-website') {
        const result = await deployWebsite({ websiteDir: body?.websiteDir });
        const deployedAt = new Date().toISOString();
        await writeArchivePublishing(context.clientId, (cur) => ({
          ...cur,
          latestDeployment: {
            deploymentId: result.manifestId || `deploy_${Date.now()}`,
            status: result.status,
            manifestId: result.manifestId,
            arweaveUrl: result.arweaveUrl,
            arnsUrl: result.arnsUrl,
            filesUploaded: result.filesUploaded,
            filesUnchanged: result.filesUnchanged,
            totalFiles: result.totalFiles,
            costEstimate: result.costEstimate,
            deployedAt,
            arnsUpdatedAt: result.arnsUrl ? deployedAt : null,
            arnsError: null,
          },
        }));
        return json({ ok: true, deployment: result });
      }

      if (action === 'update-arns') {
        const manifestId = body?.manifestId;
        if (!manifestId) return json({ error: 'manifestId is required.' }, 400);
        try {
          const result = await updateArns({ manifestId });
          await writeArchivePublishing(context.clientId, (cur) => ({
            ...cur,
            latestDeployment: {
              ...(cur.latestDeployment || {}),
              arnsUrl: result.arnsUrl,
              arnsUpdatedAt: result.updatedAt,
              arnsError: null,
            },
          }));
          return json({ ok: true, arns: result });
        } catch (arnsErr) {
          // Never erase deploy success — record the error, return it visibly.
          await writeArchivePublishing(context.clientId, (cur) => ({
            ...cur,
            latestDeployment: {
              ...(cur.latestDeployment || {}),
              arnsError: arnsErr.message || 'ArNS update failed.',
            },
          }));
          return json({ error: arnsErr.message || 'ArNS update failed.' }, arnsErr.status || 500);
        }
      }
    } catch (err) {
      return json({ error: err.message || 'Archive action failed.' }, err.status || 500);
    }
    return json({ error: 'Unknown archive action.' }, 400);
  }

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
  let decoded;
  try {
    ({ context, decoded } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const clientId = context.clientId;
  const params = new URL(request.url).searchParams;
  const action = params.get('action');

  // --- Archive / Publishing reads (admin-only in v1) -----------------------
  if (action === 'archive-sources' || action === 'archive-manifest' || action === 'archive-job' || action === 'website-deploy-estimate') {
    try {
      await requireAdmin(decoded);
    } catch (err) {
      return json({ error: err.message }, err.status || 403);
    }
    try {
      if (action === 'archive-manifest') {
        try {
          const manifest = await getArchiveManifest();
          return json({ ok: true, manifest });
        } catch (err) {
          // Bridge unconfigured / unreachable — degrade, don't crash the card.
          return json({ ok: true, manifest: { source: 'editvideos', version: null, lastUpdated: null, folders: {}, entries: [] }, disabled: true, reason: err.message });
        }
      }

      if (action === 'archive-job') {
        const archiveJobId = params.get('jobId');
        if (!archiveJobId) return json({ error: 'jobId is required.' }, 400);
        const job = await getArchiveJob(archiveJobId);
        if (!job) return json({ error: 'Archive job not found.' }, 404);
        return json({ ok: true, job });
      }

      if (action === 'archive-sources') {
        const stateSnap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
        const state = stateSnap.exists ? stateSnap.data() : {};
        let folderFiles = null;
        const folder = params.get('folder');
        if (folder) {
          try {
            folderFiles = await listFolderMedia(folder, { limit: Number(params.get('limit') || 60) });
          } catch {
            folderFiles = null;
          }
        }
        const sources = normalizeArchiveSources({
          mediaCaptures: state?.mediaCaptures || [],
          studioCaptures: state?.studioCaptures || [],
          folderFiles,
        });
        return json({ ok: true, sources });
      }

      if (action === 'website-deploy-estimate') {
        try {
          const estimate = await estimateWebsiteDeploy({ websiteDir: params.get('websiteDir') || undefined });
          estimate.estimatedAt = new Date().toISOString();
          await writeArchivePublishing(clientId, (cur) => ({ ...cur, costEstimate: estimate }));
          return json({ ok: true, estimate });
        } catch (err) {
          return json({ error: err.message || 'Deploy estimate failed.' }, err.status || 500);
        }
      }
    } catch (err) {
      return json({ error: err.message || 'Archive read failed.' }, err.status || 500);
    }
  }

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

    if (action === 'usage') {
      try {
        const usage = await getMediaUsage();
        return json({ ok: true, usage });
      } catch (err) {
        return json({ ok: true, usage: null, disabled: true, reason: err.message || 'Media usage unavailable.' });
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
