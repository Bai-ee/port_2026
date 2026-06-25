import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  attachMediaToPost,
  createSocialPost,
  diagnoseTwitterAccess,
  generatePromoCopy,
  getTwitterCredentialStatus,
  postNow,
  processDuePosts,
  readSocialQueue,
  runPostingAgents,
  schedulePost,
} from '../../../features/social-posting/twitter-service.js';
import {
  getKnowledgeBaseRuntimeContext,
} from '../../../features/knowledge-base/pipeline-context.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../api/_lib/client-provisioning.cjs');

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
        try {
          // eslint-disable-next-line no-await-in-loop
          const post = await createSocialPost(context.clientId, {
            content,
            source: 'reply-targets',
            status: 'draft',
            replyTo: { author: t?.author, url: t?.url, text: t?.text, source: t?.source },
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

    if (action === 'attach-media') {
      const post = await attachMediaToPost(context.clientId, body.postId, body);
      return json({ ok: true, post });
    }

    if (action === 'process-due') {
      const result = await processDuePosts(context.clientId);
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
