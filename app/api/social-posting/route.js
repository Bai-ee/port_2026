import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { alertOnHeldPosts } from '../../../features/social-posting/publish-alert.js';
import {
  approveAndSchedule,
  trustedSchedulePost,
  approveDraft,
  attachMediaToPost,
  createSocialPost,
  diagnoseTwitterAccess,
  enhancePost,
  generatePromoCopy,
  getTwitterCredentialStatus,
  postNow,
  processDuePosts,
  retrySelfReply,
  processDuePostsForAllClients,
  publishApprovedPost,
  getSocialPost,
  readSocialQueue,
  reconcilePost,
  rejectDraft,
  rejectSocialPost,
  runPostingAgents,
  schedulePost,
  updateSocialPost,
} from '../../../features/social-posting/twitter-service.js';
import { scoreXPost } from '../../../features/x-growth/index.js';
import {
  getKnowledgeBaseRuntimeContext,
} from '../../../features/knowledge-base/pipeline-context.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../api/_lib/client-provisioning.cjs');
const { revokeApprovalsForClient, revokeApprovalsForPost } = require('../../../api/_lib/social-approval.cjs');
const { getHeaderValue, safeSecretEquals } = require('../../../api/_lib/auth.cjs');
const { requirePilotOwner } = require('../../../api/_lib/pilot-access.cjs');

// The due-sweep cron used to live at /api/social-posting/process-due, a thin
// wrapper that only called processDuePostsForAllClients. It was folded in here
// (written when the project was on Vercel Hobby's 12-function cap; the project is now on Pro and this cron
// runs every 15 minutes, but the route stays folded so nothing else changes). Vercel crons issue GET with a bearer CRON_SECRET, so
// the sweep hangs off GET ahead of the user-session path below.
//
// Fails closed in production: no CRON_SECRET configured means no cron access.
function isCronRequest(request) {
  const cronSecret = process.env.CRON_SECRET || process.env.SOCIAL_POSTING_CRON_SECRET || '';
  const provided = getHeaderValue({ authorization: request.headers.get('authorization') }, 'authorization');
  if (cronSecret) return safeSecretEquals(provided, `Bearer ${cronSecret}`);
  if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') return false;
  return request.headers.get('x-vercel-cron') === '1';
}

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

// Content Management boundary: lifecycle-v2 rows (the pilot's) are owner-only; legacy rows keep serving every
// client's Copywriter / Schedule Posts. The client id is the server-resolved one, never the body's.
async function gatePilotRow(context, decoded, postId) {
  const row = postId ? await getSocialPost(context.clientId, postId) : null;
  if (row && Number(row.lifecycleVersion) >= 2) requirePilotOwner(context, decoded);
}

// Explicit, audited plan override: only reachable on owner-gated actions, only with a written reason. The service
// stamps {by, at, reason} on the post; the UI shows it.
function planOverrideFrom(body, decoded) {
  const o = body?.planOverride;
  if (!o || o.confirm !== true) return null;
  const reason = String(o.reason || '').trim();
  if (!reason) throw Object.assign(new Error('An override needs a written reason.'), { status: 400, code: 'override-reason-required' });
  return { by: decoded?.email || decoded?.uid || null, reason };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.clientId) {
    const err = new Error('No client workspace was found.');
    err.status = 404;
    throw err;
  }
  return { decoded, context };
}

export async function GET(request) {
  // Cron: publish everything that is due, across all clients. Checked before
  // the session path because a cron carries no user token.
  if (new URL(request.url).searchParams.get('action') === 'process-due') {
    if (!isCronRequest(request)) return json({ error: 'Unauthorized.' }, 401);
    try {
      const maxParam = Number(new URL(request.url).searchParams.get('max'));
      const result = await processDuePostsForAllClients(Number.isFinite(maxParam) && maxParam > 0 ? { maxPerRun: Math.min(maxParam, 10) } : {});
      // Owner alert when the run parked or failed anything (off unless PILOT_ALERT_* + RESEND_API_KEY are set).
      const alert = await alertOnHeldPosts(result);
      return json({
        ok: true,
        alert: alert.sent ? 'sent' : alert.reason,
        posted: result.posted.length,
        failed: result.failed.length,
        skipped: result.skipped.length,
        expired: (result.expired || []).length,
        deferred: result.deferred,
        needsReview: result.needsReview.map((p) => p.id),
      });
    } catch (err) {
      return json({ error: err.message || 'Failed to process due social posts.' }, err.status || 500);
    }
  }

  let context;
  let decoded;
  try {
    ({ context, decoded } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  try {
    const posts = await readSocialQueue(context.clientId);
    // Env names + key/token previews are the global @bai_ee credentials: admins only. Others get the booleans.
    const { envNames, previews, ...credentialFlags } = getTwitterCredentialStatus();
    const credentials = (await isAdminEmail(decoded?.email)) ? { ...credentialFlags, envNames, previews } : credentialFlags;
    return json({
      ok: true,
      posts,
      credentials,
    });
  } catch (err) {
    return json({ error: err.message || 'Failed to load social posts.' }, err.status || 500);
  }
}

export async function POST(request) {
  let context;
  let decoded;
  try {
    ({ context, decoded } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    const action = body.action || 'draft';

    // Lightweight, deterministic X-algo score — no LLM, no network, no KB fetch.
    // Powers the Copywriter notepad's live score-as-you-type, so it must
    // short-circuit before the (expensive) Knowledge Base retrieval below.
    if (action === 'score') {
      const score = scoreXPost(String(body.content || ''), {
        mediaType: body.mediaType || 'none',
        objective: body.objective || undefined,
      });
      return json({ ok: true, score });
    }

    // AI Enhance (Copywriter card) — two spelling-corrected rewrites: brand voice
    // + best-for-X-algo. Uses Client Brain voice (not the KB retrieval below), so
    // it short-circuits before the KB fetch. Each candidate carries its own score.
    if (action === 'enhance') {
      let clientBrainContext = '';
      try {
        const { loadClientBrainContext } = require('../../../features/client-brain/store.cjs');
        clientBrainContext = await loadClientBrainContext(context.clientId, { useFor: 'socialPosts', maxChars: 1500 });
      } catch { /* non-fatal — fall back to brand-only tone */ }
      const { voice, algo } = await enhancePost(body.content, { clientBrainContext, clientId: context.clientId });
      const scoreOf = (text) => scoreXPost(String(text || ''), { mediaType: body.mediaType || 'none' });
      const candidates = [
        { id: 'voice', label: 'Brand Voice', text: voice, score: scoreOf(voice) },
        { id: 'algo', label: 'Best for X', text: algo, score: scoreOf(algo) },
      ];
      return json({ ok: true, candidates });
    }

    let knowledgeBaseContext = null;
    if (body.content) {
      knowledgeBaseContext = await getKnowledgeBaseRuntimeContext({
        clientId: context.clientId,
        query: String(body.content).slice(0, 1000),
        topK: 5,
        charCap: 2200,
      });
    }
    const agentContext = {
      source: body.source || null,
      replyTo: body.replyTo || null,
      knowledgeBaseContext,
    };

    if (action === 'optimize') {
      const result = runPostingAgents(body.content, agentContext);
      return json({ ok: true, ...result });
    }

    if (action === 'generate-copy') {
      // Approved Client Brain voice/positioning (optional, additive). Absent or
      // unapproved => '' => promo copy behaves exactly as before.
      let clientBrainContext = '';
      try {
        const { loadClientBrainContext } = require('../../../features/client-brain/store.cjs');
        clientBrainContext = await loadClientBrainContext(context.clientId, { useFor: 'socialPosts', maxChars: 1500 });
      } catch { /* non-fatal — fall back to brand-only copy */ }
      const copy = await generatePromoCopy(body.brand || {}, { clientBrainContext });
      return json({ ok: true, copy });
    }

    // Reply Targets skill → Post Me. Turn selected reply targets into draft
    // posts (status 'draft', source 'reply-targets') carrying the target post as
    // replyTo context. The operator reviews/edits/posts from the Post Me queue.
    if (action === 'create-reply-drafts') {
      const targets = Array.isArray(body.targets) ? body.targets.slice(0, 10) : [];
      if (!targets.length) return json({ error: 'No reply targets supplied.' }, 400);
      const created = [];
      const failed = [];
      for (const t of targets) {
        const content = String(t?.suggestedReply || '').trim().slice(0, 280);
        if (!content) { failed.push({ target: t?.url || t?.author || 'unknown', error: 'No suggested reply text.' }); continue; }
        const replyTo = { author: t?.author, url: t?.url, text: t?.text, source: t?.source };
        try {
          // Score the reply draft now (reply-aware) so the queued draft carries an
          // xGrowthScore — mirroring how generated posts are scored at creation.
          const { agents } = runPostingAgents(content, { source: 'reply-targets', replyTo });
          // eslint-disable-next-line no-await-in-loop
          const post = await createSocialPost(context.clientId, {
            content,
            source: 'reply-targets',
            status: 'draft',
            replyTo,
            agents,
          });
          created.push(post);
        } catch (err) {
          failed.push({ target: t?.url || t?.author || 'unknown', error: err.message || 'Draft failed.' });
        }
      }
      return json({ ok: created.length > 0, created, createdCount: created.length, failed });
    }

    if (action === 'diagnose') {
      // Uses (and spends X calls on) the global @bai_ee token and returns its identity: admins only.
      if (!(await isAdminEmail(decoded?.email))) return json({ error: 'Admin only.' }, 403);
      const result = await diagnoseTwitterAccess();
      return json({ ok: true, diagnostics: result });
    }

    if (action === 'post-now') {
      const agents = body.agents || runPostingAgents(body.content, agentContext).agents;
      const post = await postNow(context.clientId, { ...body, agents });
      return json({ ok: true, post });
    }

    if (action === 'schedule') {
      const agents = body.agents || runPostingAgents(body.content, agentContext).agents;
      const post = await schedulePost(context.clientId, { ...body, agents }, { by: decoded?.email || decoded?.uid || null });
      return json({ ok: true, post });
    }

    // Edit a saved draft/scheduled post in place (Copywriter notepad). Re-scores
    // via the same agents pass so the updated doc carries a fresh xGrowthScore.
    if (action === 'update') {
      await gatePilotRow(context, decoded, body.postId);
      const agents = body.agents || runPostingAgents(body.content, agentContext).agents;
      // The override is never read from the generic payload: only an owner-gated v2 row may carry one.
      const row = body.planOverride ? await getSocialPost(context.clientId, body.postId) : null;
      const overrideAllowed = row && Number(row.lifecycleVersion) >= 2;
      const post = await updateSocialPost(context.clientId, body.postId, { ...body, agents, planOverride: undefined }, {
        expectedRevision: body.expectedRevision,
        planOverride: overrideAllowed ? planOverrideFrom(body, decoded) : null,
      });
      return json({ ok: true, post });
    }

    // draft -> approved (stamps reviewedAt/reviewedBy). Does not schedule or publish.
    if (action === 'approve-draft') {
      requirePilotOwner(context, decoded);
      const post = await approveDraft(context.clientId, body.postId, { reviewedBy: decoded?.email || decoded?.uid || null, expectedRevision: body.expectedRevision });
      return json({ ok: true, post });
    }

    // Calendar Approve: draft -> approved -> scheduled at the shown time, in one call (explicit operator click only).
    if (action === 'approve-and-schedule') {
      requirePilotOwner(context, decoded);
      const post = await approveAndSchedule(context.clientId, body.postId, {
        scheduledAt: body.scheduledAt,
        content: typeof body.content === 'string' ? body.content : undefined,
        reviewedBy: decoded?.email || decoded?.uid || null,
        expectedRevision: body.expectedRevision,
        planOverride: planOverrideFrom(body, decoded),
      });
      return json({ ok: true, post });
    }

    // Trusted scheduling (agent, owner opt-in): schedule an OWNER-approved, unchanged post with a cancel window. The
    // setting is read here from client_configs.agentAutonomy, never taken from the request. twitter-service re-checks the rest.
    if (action === 'trusted-schedule') {
      requirePilotOwner(context, decoded);
      const fbAdmin = require('../../../api/_lib/firebase-admin.cjs');
      const { normalizeTrustedSchedule } = await import('../../../features/x-strategy/agent/action-runtime.js');
      const cfg = await fbAdmin.adminDb.collection('client_configs').doc(context.clientId).get();
      const settings = normalizeTrustedSchedule(cfg.exists ? cfg.data()?.agentAutonomy?.trustedSchedule : null);
      const post = await trustedSchedulePost(context.clientId, body.postId, {
        scheduledAt: body.scheduledAt, expectedRevision: body.expectedRevision, settings,
        by: `agent (${decoded?.email || decoded?.uid || 'owner session'})`,
      });
      return json({ ok: true, post, trusted: true, cancel: 'Unschedule it in the dashboard calendar (or ask the agent) before it goes out.' });
    }

    // Calendar Reject: draft -> rejected. Never touches scheduled/posted rows.
    if (action === 'reject-draft') {
      requirePilotOwner(context, decoded);
      const post = await rejectDraft(context.clientId, body.postId, { reviewedBy: decoded?.email || decoded?.uid || null, expectedRevision: body.expectedRevision });
      return json({ ok: true, post });
    }

    // Reconcile a held / ambiguous post against what X actually shows (owner only; nothing is sent to X).
    if (action === 'reconcile-post') {
      requirePilotOwner(context, decoded);
      const post = await reconcilePost(context.clientId, body.postId, { outcome: body.outcome, platformId: body.platformId, by: decoded?.email || decoded?.uid || null });
      return json({ ok: true, post });
    }

    if (action === 'attach-media') {
      await gatePilotRow(context, decoded, body.postId);
      const post = await attachMediaToPost(context.clientId, body.postId, body);
      return json({ ok: true, post });
    }

    if (action === 'retry-self-reply') {
      await gatePilotRow(context, decoded, body.postId);
      const post = await retrySelfReply(context.clientId, body.postId);
      return json({ ok: true, post });
    }

    if (action === 'process-due') {
      const result = await processDuePosts(context.clientId);
      return json({ ok: true, ...result });
    }

    // Dashboard-side counterpart to the emailed approval link — approve/reject
    // an 'awaiting_approval' post directly, or revoke every pending link for
    // this client (e.g. before switching a platform back to 'off').
    if (action === 'approve-post') {
      await gatePilotRow(context, decoded, body.postId);
      const post = await publishApprovedPost(context.clientId, body.postId, { source: 'dashboard' });
      // Retire any still-pending email token for this post — the publish above
      // already happened, so a later click on that link must not double-post.
      await revokeApprovalsForPost(body.postId).catch((err) => {
        console.error('[social-posting] revokeApprovalsForPost failed after approve-post', body.postId, err?.message);
      });
      return json({ ok: true, post });
    }

    if (action === 'reject-post') {
      await gatePilotRow(context, decoded, body.postId);
      const post = await rejectSocialPost(context.clientId, body.postId);
      await revokeApprovalsForPost(body.postId).catch((err) => {
        console.error('[social-posting] revokeApprovalsForPost failed after reject-post', body.postId, err?.message);
      });
      return json({ ok: true, post });
    }

    if (action === 'revoke-approvals') {
      const result = await revokeApprovalsForClient(context.clientId);
      return json({ ok: true, ...result });
    }

    const agents = body.agents || runPostingAgents(body.content, agentContext).agents;
    const post = await createSocialPost(context.clientId, { ...body, agents, status: 'draft' });
    return json({ ok: true, post });
  } catch (err) {
    return json(
      {
        error: err.message || 'Social posting action failed.',
        details: err.details || null,
        hint: err.hint || null,
        code: err.code || null,
        twitterError: err.twitterError || null,
      },
      err.status || 500
    );
  }
}
