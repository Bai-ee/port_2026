import { after, NextResponse } from 'next/server';
import { createRequire } from 'module';

import { chunkText } from '../../../../../features/knowledge-base/chunk.js';
import { embedKnowledgeItemChunks } from '../../../../../features/knowledge-base/embed.js';
import { createKnowledgeItem } from '../../../../../features/knowledge-base/store.js';
import { fetchUrlText } from '../../../../../features/knowledge-base/url.js';

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

  if (!body?.url) {
    return json({ error: 'url is required.' }, 400);
  }

  try {
    const extracted = await fetchUrlText(body.url);
    const chunks = chunkText(extracted.text);
    if (!chunks.length) {
      return json({ error: 'No usable text was found to store.' }, 400);
    }

    const item = await createKnowledgeItem({
      clientId: context.clientId,
      title: String(body?.title || extracted.title || 'Imported URL').trim(),
      type: 'url',
      sourceUrl: extracted.url,
      chunks,
      status: 'processing',
    });
    after(async () => {
      try {
        await embedKnowledgeItemChunks({ clientId: context.clientId, itemId: item.id });
      } catch (err) {
        console.error('[knowledge-base/ingest-url/embed]', err?.message || err);
      }
    });
    return json({ ok: true, item: { ...item, status: 'processing', error: null }, chunkCount: chunks.length, embedded: { queued: true } }, 202);
  } catch (err) {
    return json({ error: err.message || 'URL ingest failed.' }, err.status || 500);
  }
}
