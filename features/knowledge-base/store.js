import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');

export const MAX_ITEMS_PER_CLIENT = 100;

export function getKnowledgeBaseRefs(clientId) {
  const root = fb.adminDb.collection('knowledge_base').doc(clientId);
  return {
    root,
    items: root.collection('items'),
    chunks: root.collection('chunks'),
  };
}

function publicItemFromDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    title: data.title || '',
    type: data.type || 'text',
    sourceUrl: data.sourceUrl || null,
    status: data.status || 'ready',
    error: data.error || null,
    chunkCount: Number(data.chunkCount) || 0,
    charCount: Number(data.charCount) || 0,
    storagePath: data.storagePath || null,
    fileName: data.fileName || null,
    contentType: data.contentType || null,
    sizeBytes: Number(data.sizeBytes) || null,
    documentParser: data.documentParser || null,
    documentPages: Number(data.documentPages) || null,
    documentWarnings: Array.isArray(data.documentWarnings) ? data.documentWarnings : [],
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || null,
    updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : data.updatedAt || null,
  };
}

export async function getItemCount(clientId) {
  const { items } = getKnowledgeBaseRefs(clientId);
  const snap = await items.count().get();
  return snap.data().count || 0;
}

export async function assertItemLimit(clientId) {
  const count = await getItemCount(clientId);
  if (count >= MAX_ITEMS_PER_CLIENT) {
    const err = new Error(`Knowledge Base item limit reached (${MAX_ITEMS_PER_CLIENT} items). Delete an item before adding another.`);
    err.status = 400;
    throw err;
  }
  return count;
}

export async function createKnowledgeItem({
  clientId,
  title,
  type,
  sourceUrl = null,
  chunks,
  status = 'ready',
  error = null,
  storagePath = null,
  fileName = null,
  contentType = null,
  sizeBytes = null,
}) {
  if (!clientId) throw new Error('createKnowledgeItem: clientId is required');
  if (!Array.isArray(chunks) || chunks.length === 0) {
    const err = new Error('No usable text was found to store.');
    err.status = 400;
    throw err;
  }

  await assertItemLimit(clientId);

  const { root, items, chunks: chunksCol } = getKnowledgeBaseRefs(clientId);
  const itemRef = items.doc();
  const now = fb.FieldValue.serverTimestamp();
  const safeTitle = String(title || '').trim().slice(0, 160) || (type === 'url' ? 'Imported URL' : 'Pasted text');
  const totalChars = chunks.reduce((sum, chunk) => sum + (Number(chunk.charCount) || String(chunk.text || '').length), 0);

  const itemPayload = {
    clientId,
    title: safeTitle,
    type,
    sourceUrl: sourceUrl || null,
    status,
    error,
    chunkCount: chunks.length,
    charCount: totalChars,
    storagePath,
    fileName,
    contentType,
    sizeBytes,
    createdAt: now,
    updatedAt: now,
  };

  let batch = fb.adminDb.batch();
  let ops = 0;
  const commitIfNeeded = async () => {
    if (ops < 450) return;
    await batch.commit();
    batch = fb.adminDb.batch();
    ops = 0;
  };

  batch.set(root, { clientId, updatedAt: now }, { merge: true });
  ops += 1;
  batch.set(itemRef, itemPayload);
  ops += 1;

  for (const [index, chunk] of chunks.entries()) {
    const chunkRef = chunksCol.doc();
    batch.set(chunkRef, {
      clientId,
      itemId: itemRef.id,
      position: Number.isFinite(chunk.position) ? chunk.position : index,
      text: String(chunk.text || ''),
      tokenEstimate: Number(chunk.tokenEstimate) || 0,
      charCount: Number(chunk.charCount) || String(chunk.text || '').length,
      sourceTitle: safeTitle,
      sourceUrl: sourceUrl || null,
      embedding: null,
      embeddingProvider: null,
      embeddingModel: null,
      embeddingDimensions: null,
      embeddingStatus: 'pending',
      embeddingError: null,
      createdAt: now,
      embeddedAt: null,
    });
    ops += 1;
    await commitIfNeeded();
  }

  if (ops > 0) await batch.commit();
  const saved = await itemRef.get();
  return publicItemFromDoc(saved);
}

export async function listKnowledgeItems(clientId) {
  const { items } = getKnowledgeBaseRefs(clientId);
  const snap = await items.orderBy('createdAt', 'desc').limit(MAX_ITEMS_PER_CLIENT).get();
  return snap.docs.map(publicItemFromDoc);
}

export async function getKnowledgeItem({ clientId, itemId }) {
  const { items } = getKnowledgeBaseRefs(clientId);
  const snap = await items.doc(itemId).get();
  return snap.exists ? publicItemFromDoc(snap) : null;
}

export async function updateKnowledgeItemStatus({ clientId, itemId, status, error = null }) {
  const { items } = getKnowledgeBaseRefs(clientId);
  const itemRef = items.doc(itemId);
  await itemRef.set(
    {
      status,
      error,
      updatedAt: fb.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return getKnowledgeItem({ clientId, itemId });
}

export async function listKnowledgeChunks({ clientId, itemId = null, embeddingStatuses = null, limit = 200 } = {}) {
  if (!clientId) throw new Error('listKnowledgeChunks: clientId is required');
  const { chunks } = getKnowledgeBaseRefs(clientId);
  let query = chunks.where('clientId', '==', clientId);
  if (itemId) query = query.where('itemId', '==', itemId);
  if (Array.isArray(embeddingStatuses) && embeddingStatuses.length === 1) {
    query = query.where('embeddingStatus', '==', embeddingStatuses[0]);
  }
  query = query.limit(Math.max(1, Math.min(500, Number(limit) || 200)));
  const snap = await query.get();
  return snap.docs
    .map((doc) => {
      const data = doc.data() || {};
      if (Array.isArray(embeddingStatuses) && embeddingStatuses.length > 1 && !embeddingStatuses.includes(data.embeddingStatus)) {
        return null;
      }
      return {
        id: doc.id,
        itemId: data.itemId || '',
        position: Number(data.position) || 0,
        text: data.text || '',
        embeddingStatus: data.embeddingStatus || 'pending',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.position - b.position);
}

export async function updateChunkEmbeddingBatch({ clientId, updates }) {
  if (!clientId) throw new Error('updateChunkEmbeddingBatch: clientId is required');
  if (!Array.isArray(updates) || updates.length === 0) return { updated: 0 };

  const { chunks } = getKnowledgeBaseRefs(clientId);
  let batch = fb.adminDb.batch();
  let ops = 0;
  let updated = 0;

  for (const update of updates) {
    if (!update?.chunkId || !Array.isArray(update.embedding)) continue;
    batch.set(
      chunks.doc(update.chunkId),
      {
        embedding: fb.FieldValue.vector(update.embedding),
        embeddingProvider: update.provider,
        embeddingModel: update.model,
        embeddingDimensions: update.dimensions,
        embeddingStatus: 'embedded',
        embeddingError: null,
        embeddedAt: fb.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    ops += 1;
    updated += 1;
    if (ops >= 450) {
      await batch.commit();
      batch = fb.adminDb.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
  return { updated };
}

export async function markChunkEmbeddingErrorBatch({ clientId, chunkIds, error }) {
  if (!clientId) throw new Error('markChunkEmbeddingErrorBatch: clientId is required');
  if (!Array.isArray(chunkIds) || chunkIds.length === 0) return { failed: 0 };

  const { chunks } = getKnowledgeBaseRefs(clientId);
  const message = String(error || 'Embedding failed.').slice(0, 500);
  let batch = fb.adminDb.batch();
  let ops = 0;
  let failed = 0;

  for (const chunkId of chunkIds) {
    if (!chunkId) continue;
    batch.set(
      chunks.doc(chunkId),
      {
        embeddingStatus: 'error',
        embeddingError: message,
        embeddedAt: null,
      },
      { merge: true }
    );
    ops += 1;
    failed += 1;
    if (ops >= 450) {
      await batch.commit();
      batch = fb.adminDb.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
  return { failed };
}

export async function deleteKnowledgeItemCascade({ clientId, itemId }) {
  if (!clientId || !itemId) {
    const err = new Error('itemId is required.');
    err.status = 400;
    throw err;
  }

  const { items, chunks } = getKnowledgeBaseRefs(clientId);
  const itemRef = items.doc(itemId);
  const itemSnap = await itemRef.get();
  if (!itemSnap.exists) {
    const err = new Error('Knowledge Base item not found.');
    err.status = 404;
    throw err;
  }
  const itemData = itemSnap.data() || {};

  const chunkSnap = await chunks.where('itemId', '==', itemId).get();
  let batch = fb.adminDb.batch();
  let ops = 0;
  let deletedChunks = 0;

  for (const doc of chunkSnap.docs) {
    batch.delete(doc.ref);
    ops += 1;
    deletedChunks += 1;
    if (ops >= 450) {
      await batch.commit();
      batch = fb.adminDb.batch();
      ops = 0;
    }
  }

  batch.delete(itemRef);
  ops += 1;
  if (ops > 0) await batch.commit();

  if (itemData.storagePath) {
    try {
      await fb.adminStorage.bucket().file(itemData.storagePath).delete({ ignoreNotFound: true });
    } catch (err) {
      console.warn('[knowledge-base] storage delete failed:', err.message);
    }
  }

  return { deletedChunks };
}
