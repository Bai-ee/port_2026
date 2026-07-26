import { NextResponse } from 'next/server';
import { createRequire } from 'module';

import { getItemCount, listKnowledgeItems, MAX_ITEMS_PER_CLIENT } from '../../../../../features/knowledge-base/store.js';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');

export const maxDuration = 120;

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

export async function GET(request) {
  let context;
  try {
    context = await resolveContext(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  try {
    const [items, count] = await Promise.all([
      listKnowledgeItems(context.clientId),
      getItemCount(context.clientId),
    ]);
    return json({
      ok: true,
      items,
      limits: {
        maxItems: MAX_ITEMS_PER_CLIENT,
        remaining: Math.max(0, MAX_ITEMS_PER_CLIENT - count),
      },
    });
  } catch (err) {
    return json({ error: err.message || 'Could not list Knowledge Base items.' }, err.status || 500);
  }
}
