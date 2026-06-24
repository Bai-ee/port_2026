import { after, NextResponse } from 'next/server';
import { createRequire } from 'module';

import { chunkText, normalizeWhitespace } from '../../../../../features/knowledge-base/chunk.js';
import { embedKnowledgeItemChunks } from '../../../../../features/knowledge-base/embed.js';
import { createKnowledgeItem } from '../../../../../features/knowledge-base/store.js';

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

  const text = normalizeWhitespace(body?.text);
  if (!text || text.length < 20) {
    return json({ error: 'Text must contain at least 20 characters.' }, 400);
  }

  const chunks = chunkText(text);
  if (!chunks.length) {
    return json({ error: 'No usable text was found to store.' }, 400);
  }

  try {
    const item = await createKnowledgeItem({
      clientId: context.clientId,
      title: String(body?.title || 'Pasted text').trim(),
      type: 'text',
      sourceUrl: null,
      chunks,
      status: 'processing',
    });
    after(async () => {
      try {
        await embedKnowledgeItemChunks({ clientId: context.clientId, itemId: item.id });
      } catch (err) {
        console.error('[knowledge-base/ingest-text/embed]', err?.message || err);
      }
    });
    return json({ ok: true, item: { ...item, status: 'processing', error: null }, chunkCount: chunks.length, embedded: { queued: true } }, 202);
  } catch (err) {
    return json({ error: err.message || 'Knowledge Base ingest failed.' }, err.status || 500);
  }
}
