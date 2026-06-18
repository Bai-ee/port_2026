import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  attachMediaToPost,
  createSocialPost,
  diagnoseTwitterAccess,
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
        twitterError: err.twitterError || null,
      },
      err.status || 500
    );
  }
}
