import { NextResponse } from 'next/server';
import { createRequire } from 'module';

import { clampTopK, searchKnowledgeBase } from '../../../../../features/knowledge-base/retrieval.js';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');

export const maxDuration = 60;

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
  if (!context.userProfile) {
    const err = new Error('No user record.');
    err.status = 404;
    throw err;
  }
  if (!context.clientId) {
    const err = new Error('No clientId on user record.');
    err.status = 404;
    throw err;
  }
  return context;
}

export async function POST(request) {
  let context;
  try {
    context = await resolveContext(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const query = String(body?.query || '').trim();
  if (!query) {
    return json({ error: 'query is required.' }, 400);
  }

  try {
    const chunks = await searchKnowledgeBase({
      clientId: context.clientId,
      query,
      topK: clampTopK(body?.topK),
    });
    return json({ ok: true, chunks });
  } catch (err) {
    return json({ error: err.message || 'Knowledge Base search failed.' }, err.status || 500);
  }
}
