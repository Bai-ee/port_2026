import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  completeApprovalRemix,
  failApprovalRemix,
  getSocialPost,
  markApprovalRemixPending,
  publishApprovedPost,
  updateSocialPost,
} from '../../../../features/social-posting/twitter-service.js';
import { getSocialAccount } from '../../../../features/social-posting/social-accounts.js';

const require = createRequire(import.meta.url);
const {
  readApproval,
  recordApprovalResult,
  redeemApprovalToken,
  verifyApprovalToken,
} = require('../../../../api/_lib/social-approval.cjs');
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const mediaJobs = require('../../../../api/_lib/media-jobs.cjs');
const { validateRemixRecipe } = require('../../../../api/_lib/media-recipe.cjs');
const clipSelector = require('../../../../api/_lib/media-clip-selector.cjs');
const {
  enqueueVideoJob,
  listFolderMedia,
  listOptions,
  triggerWorker,
} = require('../../../../api/_lib/editvideos-bridge.cjs');
const { reconcileMediaJob } = require('../../../../api/_lib/media-reconcile.cjs');
const digestConfig = require('../../../../features/intelligence/_digest-config.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The "Post to X" email button — both halves on ONE function. Vercel Hobby caps
// a deployment at 12 serverless functions, so preview and publish share a route
// instead of being two.
//
//   GET  ?token=…  → read-only preview for the approval page. Never writes,
//                    never redeems, never publishes.
//   POST {token, content?} → validates optional edited copy, redeems the
//                            single-use token, saves the edit, then publishes.
//
// The security property is unchanged and is the one that matters: **a GET can
// never publish.** Email scanners and link prefetchers issue GETs, so the
// publish path sits behind an explicit POST that only the approval page's
// button fires. Two separate routes were never what made this safe — the
// method split is. Keep any future read-only helper on GET; never move a write
// onto it.

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function limited(request, bucket, limit = 30) {
  const ip = getClientIp(request);
  const result = await checkRateLimit({ key: `${bucket}:ip:${ip}`, limit, windowSeconds: 3600 });
  return { ip, allowed: result.allowed };
}

function canonicalRemixCopy(metadata = {}) {
  const artist = String(metadata.artist || '').trim();
  const mix = String(metadata.mix || metadata.mixTitle || '').trim();
  return [artist, mix].filter(Boolean).join(' — ') || 'Video Remix';
}

function metadataFrom({ post, capture, job }) {
  const stored = post?.mediaMetadata && typeof post.mediaMetadata === 'object' ? post.mediaMetadata : {};
  const created = capture?.createdWith && typeof capture.createdWith === 'object' ? capture.createdWith : {};
  const recipe = job?.recipeFull && typeof job.recipeFull === 'object' ? job.recipeFull : {};
  return {
    artist: stored.artist || created.artist || recipe.artist || null,
    mix: stored.mix || stored.mixTitle || created.mix || (recipe.useTrax ? 'Tracks' : recipe.mixTitle) || null,
    filter: stored.filter || created.filter || recipe.filter?.key || null,
    overlay: stored.overlay || created.overlay || (recipe.overlay?.enabled ? recipe.overlay.effect : null) || null,
    sourceFolders: Array.isArray(stored.sourceFolders) && stored.sourceFolders.length
      ? stored.sourceFolders
      : Array.isArray(capture?.sourceFolders) && capture.sourceFolders.length
        ? capture.sourceFolders
        : Array.isArray(recipe.sourceFolders) ? recipe.sourceFolders : [],
    duration: Number(stored.duration || created.duration || capture?.durationSeconds || recipe.output?.durationSeconds) || 30,
    topLogo: stored.topLogo || created.topLogo || recipe.logos?.top || null,
    endLogo: stored.endLogo || created.endLogo || recipe.logos?.end || null,
  };
}

async function loadLiveApproval(token) {
  let decoded;
  try {
    decoded = verifyApprovalToken(token);
  } catch (err) {
    err.state = err?.code === 'expired' ? 'expired' : err?.code === 'server' ? 'server' : 'invalid';
    throw err;
  }
  const approval = await readApproval(token);
  if (!approval) throw Object.assign(new Error('Approval link not found.'), { state: 'not-found', status: 404 });
  if (approval.revokedAt) throw Object.assign(new Error('Approval link was revoked.'), { state: 'revoked', status: 409 });
  if (approval.redeemedAt) throw Object.assign(new Error('This post has already been handled.'), { state: 'already-posted', status: 409 });
  if (Date.now() > (approval.expiresAt || 0)) throw Object.assign(new Error('Approval link expired.'), { state: 'expired', status: 410 });
  const post = await getSocialPost(decoded.clientId, decoded.postId);
  if (!post) throw Object.assign(new Error('Post not found.'), { state: 'not-found', status: 404 });
  if (post.status !== 'awaiting_approval') {
    throw Object.assign(new Error('This post is no longer awaiting approval.'), { state: 'already-posted', status: 409 });
  }
  return { decoded, approval, post };
}

async function resolveMediaContext(decoded, post) {
  let assetClientId = post.mediaAssetClientId || '';
  if (!assetClientId) {
    try {
      const config = await digestConfig.getDigestConfig(decoded.clientId);
      assetClientId = digestConfig.resolveDailyVideoAssetClientId(config, decoded.clientId);
    } catch {
      assetClientId = decoded.clientId;
    }
  }

  let capture = null;
  try {
    const snap = await fb.adminDb.collection('dashboard_state').doc(assetClientId).get();
    const captures = Array.isArray(snap.data()?.mediaCaptures) ? snap.data().mediaCaptures : [];
    capture = captures.find((item) => (
      (post.mediaJobId && item?.jobId === post.mediaJobId)
      || (post.mediaUrl && item?.downloadUrl === post.mediaUrl)
    )) || null;
  } catch { /* metadata is optional */ }

  const jobId = post.mediaJobId || capture?.jobId || null;
  const job = jobId ? await mediaJobs.getMediaJob(jobId, assetClientId).catch(() => null) : null;
  return {
    assetClientId,
    capture,
    job,
    jobId,
    metadata: metadataFrom({ post, capture, job }),
  };
}

function readyPayload(post, mediaContext, extra = {}) {
  return {
    state: 'ready',
    caption: post.content || canonicalRemixCopy(mediaContext.metadata),
    videoUrl: post.mediaUrl || null,
    metadata: mediaContext.metadata,
    remix: post.remixPending || null,
    remixCount: Number(post.remixCount || 0),
    ...extra,
  };
}

async function randomizeRecipe(baseRecipe, assetClientId) {
  const raw = { ...(baseRecipe || {}) };
  delete raw.videoOrder;

  // Older daily renders allowed the worker to pick an unreported random DJ.
  // Pin a real DJ + mix for approval-page remixes so the rendered asset and its
  // visible metadata stay truthful.
  if (!raw.artist || (!raw.useTrax && !raw.mixTitle)) {
    const options = await listOptions();
    const artists = Array.isArray(options?.artists)
      ? options.artists.filter((item) => item?.name && Array.isArray(item.mixes) && item.mixes.length)
      : [];
    let selected = raw.artist ? artists.find((item) => item.name === raw.artist) : null;
    if (!selected && artists.length) selected = artists[Math.floor(Math.random() * artists.length)];
    if (selected) {
      raw.artist = selected.name;
      if (!raw.useTrax && !raw.mixTitle) {
        raw.mixTitle = selected.mixes[Math.floor(Math.random() * selected.mixes.length)];
      }
    }
  }

  let recipe = validateRemixRecipe(raw);
  if (recipe.sourceFolders.length === 1) {
    try {
      const folder = recipe.sourceFolders[0];
      const media = await listFolderMedia(folder, { limit: 120 });
      const order = await clipSelector.buildVideoOrder({
        clientId: assetClientId,
        folder,
        files: Array.isArray(media?.files) ? media.files : [],
        segmentCount: clipSelector.DEFAULT_SEGMENT_COUNT,
        antiRepeatLookback: 3,
        deps: { listMediaJobs: mediaJobs.listMediaJobs },
      });
      if (order) recipe = validateRemixRecipe({ ...recipe, videoOrder: order });
    } catch {
      // The external worker can still choose clips if the folder cannot fill a
      // six-segment order, matching the dashboard route's existing behavior.
    }
  }
  return recipe;
}

// ── GET: read-only preview ───────────────────────────────────────────────────
export async function GET(request) {
  const { allowed } = await limited(request, 'social-approve-preview');
  if (!allowed) return json({ state: 'error', error: 'Too many requests. Try again later.' }, 429);

  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token) return json({ error: 'Missing token.' }, 400);

  let decoded;
  try {
    decoded = verifyApprovalToken(token);
  } catch (err) {
    const state = err?.code === 'expired' ? 'expired' : err?.code === 'server' ? 'server' : 'invalid';
    return json({ state, error: err.message }, 200);
  }

  let approval;
  try {
    approval = await readApproval(token);
  } catch (err) {
    return json({ state: err?.code === 'server' ? 'server' : 'invalid', error: err.message }, 200);
  }
  if (!approval) return json({ state: 'not-found' }, 200);
  if (approval.revokedAt) return json({ state: 'revoked' }, 200);
  if (approval.redeemedAt) return json({ state: approval.result === 'failed' ? 'failed' : 'already-posted' }, 200);
  if (Date.now() > (approval.expiresAt || 0)) return json({ state: 'expired' }, 200);

  const [post, account, clientSnap] = await Promise.all([
    getSocialPost(decoded.clientId, decoded.postId),
    getSocialAccount(decoded.clientId, decoded.platform).catch(() => null),
    fb.adminDb.collection('clients').doc(decoded.clientId).get(),
  ]);
  if (!post) return json({ state: 'not-found' }, 200);

  const clientData = clientSnap.exists ? clientSnap.data() : {};
  const clientName = clientData?.companyName || clientData?.name || clientData?.dashboardTitle || decoded.clientId;

  return json({
    ...readyPayload(post, await resolveMediaContext(decoded, post)),
    clientName,
    handle: account?.username || null,
    platform: decoded.platform,
  });
}

// ── POST: redeem + publish ───────────────────────────────────────────────────
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, state: 'error', error: 'Invalid JSON body.' }, 400);
  }

  const token = String(body?.token || '');
  if (!token) return json({ ok: false, state: 'error', error: 'Missing token.' }, 400);
  const action = String(body?.action || 'publish');
  const statusPoll = action === 'remix-status';
  const { ip, allowed } = await limited(
    request,
    statusPoll ? 'social-approve-remix-status' : 'social-approve',
    statusPoll ? 240 : 30,
  );
  if (!allowed) {
    return json({ ok: false, state: 'error', error: 'Too many attempts. Try again later.' }, 429);
  }

  if (action !== 'publish') {
    let live;
    try {
      live = await loadLiveApproval(token);
    } catch (err) {
      return json({ ok: false, state: err.state || 'invalid', error: err.message }, err.status || 400);
    }
    const { decoded, post } = live;
    const mediaContext = await resolveMediaContext(decoded, post);

    if (action === 'refresh-copy') {
      try {
        const content = canonicalRemixCopy(mediaContext.metadata);
        const updated = await updateSocialPost(decoded.clientId, decoded.postId, { content });
        return json({ ok: true, ...readyPayload(updated, mediaContext) });
      } catch (err) {
        return json({ ok: false, state: 'ready', error: err.message }, err.status || 500);
      }
    }

    if (action === 'remix') {
      if (post.remixPending?.jobId && post.remixPending?.status !== 'failed') {
        return json({
          ok: true,
          ...readyPayload(post, mediaContext),
          remix: post.remixPending,
        }, 202);
      }
      if (!mediaContext.job?.recipeFull) {
        return json({
          ok: false,
          state: 'ready',
          error: 'This video has no reusable render recipe. Generate and send a fresh email, then remix that approval.',
        }, 409);
      }
      let jobId = null;
      try {
        const recipe = await randomizeRecipe(mediaContext.job.recipeFull, mediaContext.assetClientId);
        ({ jobId } = await mediaJobs.createMediaJob({
          clientId: mediaContext.assetClientId,
          type: 'video-remix',
          recipe,
        }));
        await markApprovalRemixPending(decoded.clientId, decoded.postId, {
          jobId,
          assetClientId: mediaContext.assetClientId,
        });
        const { editJobId } = await enqueueVideoJob(recipe);
        await mediaJobs.setMediaJobEditRef(jobId, editJobId);
        await triggerWorker().catch(() => null);
        const updated = await getSocialPost(decoded.clientId, decoded.postId);
        return json({ ok: true, ...readyPayload(updated, mediaContext), remix: updated.remixPending }, 202);
      } catch (err) {
        if (jobId) await failApprovalRemix(decoded.clientId, decoded.postId, err.message).catch(() => {});
        return json({ ok: false, state: 'ready', error: err.message || 'Could not start remix.' }, err.status || 500);
      }
    }

    if (action === 'remix-status') {
      const pending = post.remixPending;
      if (!pending?.jobId || !pending?.assetClientId) {
        return json({ ok: true, ...readyPayload(post, mediaContext), remix: null });
      }
      try {
        let job = await mediaJobs.getMediaJob(pending.jobId, pending.assetClientId);
        if (!job) throw new Error('Remix job not found.');
        const result = await reconcileMediaJob(job, pending.assetClientId);
        job = await mediaJobs.getMediaJob(pending.jobId, pending.assetClientId);
        if (result.status === 'failed' || job?.status === 'failed') {
          const failed = await failApprovalRemix(decoded.clientId, decoded.postId, job?.error || 'Remix failed.');
          return json({ ok: false, ...readyPayload(failed, mediaContext), error: job?.error || 'Remix failed.' });
        }
        const capture = result.capture || (job?.status === 'done' ? job.output : null);
        if (!capture?.downloadUrl) {
          return json({ ok: true, ...readyPayload(post, mediaContext), remix: pending }, 202);
        }
        const nextMetadata = metadataFrom({ post: {}, capture, job });
        const updated = await completeApprovalRemix(decoded.clientId, decoded.postId, {
          mediaUrl: capture.downloadUrl,
          mediaType: 'video',
          mediaContentType: capture.contentType || 'video/mp4',
          mediaJobId: capture.jobId || job.jobId,
          mediaAssetClientId: pending.assetClientId,
          mediaMetadata: nextMetadata,
          content: canonicalRemixCopy(nextMetadata),
        });
        return json({
          ok: true,
          ...readyPayload(updated, { ...mediaContext, capture, job, metadata: nextMetadata }),
          remix: null,
          remixComplete: true,
        });
      } catch (err) {
        const failed = await failApprovalRemix(decoded.clientId, decoded.postId, err.message).catch(() => post);
        return json({ ok: false, ...readyPayload(failed, mediaContext), error: err.message || 'Could not check remix.' }, 500);
      }
    }

    return json({ ok: false, state: 'error', error: 'Unknown approval action.' }, 400);
  }

  let editedContent = null;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'content')) {
    editedContent = String(body.content || '').trim();
    if (!editedContent) {
      return json({ ok: false, state: 'error', error: 'Post copy is required.' }, 400);
    }
    if (editedContent.length > 280) {
      return json({ ok: false, state: 'error', error: 'X posts must be 280 characters or fewer.' }, 400);
    }
  }

  // Do not burn the one-time publish token while its replacement video is
  // still rendering. The UI disables the button too, but this server guard is
  // what prevents a stale tab or handcrafted request from posting the old cut.
  try {
    const live = await loadLiveApproval(token);
    if (live.post.remixPending?.status === 'rendering') {
      return json({
        ok: false,
        state: 'ready',
        error: 'Wait for the remix to finish before posting.',
      }, 409);
    }
  } catch (err) {
    return json({ ok: false, state: err.state || 'invalid', error: err.message }, err.status || 400);
  }

  const ua = request.headers.get('user-agent') || null;

  let decoded;
  try {
    decoded = await redeemApprovalToken(token, { ip, ua });
  } catch (err) {
    const code = err?.code || 'invalid';
    const state = ['not-found', 'expired', 'revoked', 'already-posted', 'server'].includes(code) ? code : 'invalid';
    return json({ ok: false, state, error: err.message }, err.status || 400);
  }

  // Token is burned — from here on, the outcome is terminal. A publish failure
  // is recorded but the token is NOT un-burned (re-approve from the dashboard
  // is the recovery path, not a retried click on this link).
  try {
    if (editedContent != null) {
      await updateSocialPost(decoded.clientId, decoded.postId, { content: editedContent });
    }
    await publishApprovedPost(decoded.clientId, decoded.postId, { source: 'email' });
    await recordApprovalResult(decoded.tokenId, 'posted');
    return json({ ok: true, state: 'posted' });
  } catch (err) {
    await recordApprovalResult(decoded.tokenId, 'failed');
    return json({ ok: false, state: 'failed', error: err.message || 'Failed to publish.' });
  }
}
