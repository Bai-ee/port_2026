import { NextResponse } from 'next/server';
import { createRequire } from 'module';

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_PROVIDER,
  embedKnowledgeItemChunks,
  embedTexts,
  getEmbeddingConfig,
} from '../../../../../features/knowledge-base/embed.js';
import {
  getKnowledgeItem,
  listKnowledgeChunks,
  markChunkEmbeddingErrorBatch,
  updateChunkEmbeddingBatch,
  updateKnowledgeItemStatus,
} from '../../../../../features/knowledge-base/store.js';

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
    body = {};
  }

  const itemId = String(body?.itemId || '').trim();

  try {
    getEmbeddingConfig();

    if (itemId) {
      const item = await getKnowledgeItem({ clientId: context.clientId, itemId });
      if (!item) return json({ error: 'Knowledge Base item not found.' }, 404);
      const result = await embedKnowledgeItemChunks({ clientId: context.clientId, itemId });
      return json({
        ok: true,
        reindexed: result.embedded || 0,
        failed: result.failed || 0,
        provider: EMBEDDING_PROVIDER,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      });
    }

    const chunks = await listKnowledgeChunks({
      clientId: context.clientId,
      embeddingStatuses: ['pending', 'error'],
      limit: 500,
    });
    if (!chunks.length) {
      return json({
        ok: true,
        reindexed: 0,
        failed: 0,
        provider: EMBEDDING_PROVIDER,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      });
    }

    try {
      const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
      const updates = chunks.map((chunk, index) => ({
        chunkId: chunk.id,
        embedding: embeddings[index],
        provider: EMBEDDING_PROVIDER,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      }));
      const result = await updateChunkEmbeddingBatch({ clientId: context.clientId, updates });
      const itemIds = [...new Set(chunks.map((chunk) => chunk.itemId).filter(Boolean))];
      await Promise.all(
        itemIds.map((id) => updateKnowledgeItemStatus({ clientId: context.clientId, itemId: id, status: 'ready', error: null }))
      );
      return json({
        ok: true,
        reindexed: result.updated,
        failed: 0,
        provider: EMBEDDING_PROVIDER,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      });
    } catch (err) {
      const chunkIds = chunks.map((chunk) => chunk.id);
      const result = await markChunkEmbeddingErrorBatch({ clientId: context.clientId, chunkIds, error: err.message });
      return json({
        ok: false,
        error: err.message || 'Reindex failed.',
        reindexed: 0,
        failed: result.failed,
        provider: EMBEDDING_PROVIDER,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      }, err.status || 500);
    }
  } catch (err) {
    return json({ error: err.message || 'Knowledge Base reindex failed.' }, err.status || 500);
  }
}
