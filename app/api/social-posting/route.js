import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  attachMediaToPost,
  createSocialPost,
  diagnoseTwitterAccess,
  enhancePost,
  generatePromoCopy,
  getTwitterCredentialStatus,
  postNow,
  processDuePosts,
  processDuePostsForAllClients,
  publishApprovedPost,
  readSocialQueue,
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
const { verifyRequestUser } = require('../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../api/_lib/client-provisioning.cjs');
const { revokeApprovalsForClient, revokeApprovalsForPost } = require('../../../api/_lib/social-approval.cjs');
const { getHeaderValue, safeSecretEquals } = require('../../../api/_lib/auth.cjs');

// The due-sweep cron used to live at /api/social-posting/process-due, a thin
// wrapper that only called processDuePostsForAllClients. It was folded in here
// because Vercel Hobby caps a deployment at 12 function groups and the route
// earned none of its own. Vercel crons issue GET with a bearer CRON_SECRET, so
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
      const result = await processDuePostsForAllClients();
      return json({ ok: true, posted: result.posted.length, failed: result.failed.length });
    } catch (err) {
      return json({ error: err.message || 'Failed to process due social posts.' }, err.status || 500);
    }
  }

  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  try {
    const posts = await readSocialQueue(context.clientId);
    return json({
      ok: true,
      posts,
      credentials: getTwitterCredentialStatus(),
    });
  } catch (err) {
    return json({ error: err.message || 'Failed to load social posts.' }, err.status || 500);
  }
}

export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
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
      const { voice, algo } = await enhancePost(body.content, { clientBrainContext });
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
      const post = await schedulePost(context.clientId, { ...body, agents });
      return json({ ok: true, post });
    }

    // Edit a saved draft/scheduled post in place (Copywriter notepad). Re-scores
    // via the same agents pass so the updated doc carries a fresh xGrowthScore.
    if (action === 'update') {
      const agents = body.agents || runPostingAgents(body.content, agentContext).agents;
      const post = await updateSocialPost(context.clientId, body.postId, { ...body, agents });
      return json({ ok: true, post });
    }

    if (action === 'attach-media') {
      const post = await attachMediaToPost(context.clientId, body.postId, body);
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
      const post = await publishApprovedPost(context.clientId, body.postId, { source: 'dashboard' });
      // Retire any still-pending email token for this post — the publish above
      // already happened, so a later click on that link must not double-post.
      await revokeApprovalsForPost(body.postId).catch((err) => {
        console.error('[social-posting] revokeApprovalsForPost failed after approve-post', body.postId, err?.message);
      });
      return json({ ok: true, post });
    }

    if (action === 'reject-post') {
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
