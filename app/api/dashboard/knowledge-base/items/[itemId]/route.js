import { NextResponse } from 'next/server';
import { createRequire } from 'module';

import { deleteKnowledgeItemCascade } from '../../../../../../features/knowledge-base/store.js';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../../api/_lib/client-provisioning.cjs');

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

export async function DELETE(request, { params }) {
  let context;
  try {
    context = await resolveContext(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const resolvedParams = typeof params?.then === 'function' ? await params : params;
  const itemId = String(resolvedParams?.itemId || '').trim();
  if (!itemId) {
    return json({ error: 'itemId is required.' }, 400);
  }

  try {
    const result = await deleteKnowledgeItemCascade({ clientId: context.clientId, itemId });
    return json({ ok: true, ...result });
  } catch (err) {
    return json({ error: err.message || 'Could not delete Knowledge Base item.' }, err.status || 500);
  }
}
