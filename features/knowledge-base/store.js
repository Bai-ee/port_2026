import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');

import {
  brainPathForTitle,
  findSourceRegister,
  legacyBrainFields,
  parseSourceRegister,
  todayIso,
  versionPathFor,
} from './brain-layout.js';

export const MAX_ITEMS_PER_CLIENT = 500;

export function getKnowledgeBaseRefs(clientId) {
  const root = fb.adminDb.collection('knowledge_base').doc(clientId);
  return {
    root,
    items: root.collection('items'),
    chunks: root.collection('chunks'),
  };
}

function brainFieldsFromData(data, createdAt) {
  if (data.brainPath) {
    return {
      brainPath: data.brainPath,
      brainRole: data.brainRole || 'source',
      brainDate: data.brainDate || null,
      versionLabel: data.versionLabel || null,
      legacy: false,
    };
  }
  const derived = legacyBrainFields({ ...data, createdAt });
  return {
    brainPath: derived.brainPath,
    brainRole: derived.brainRole,
    brainDate: derived.brainDate,
    versionLabel: derived.versionLabel,
    legacy: true,
  };
}

function publicItemFromDoc(doc) {
  const data = doc.data() || {};
  const createdAt = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || null;
  return {
    ...brainFieldsFromData(data, createdAt),
    sha256: data.sha256 || null,
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
    createdAt,
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
  brain = null,
  sha256 = null,
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
  const brainFields = brain?.brainPath ? brain : brainPathForTitle(safeTitle, { ext: type === 'url' ? '.url.md' : '.md' });

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
    brainPath: brainFields.brainPath,
    brainRole: brainFields.brainRole,
    brainDate: brainFields.brainDate || null,
    versionLabel: brainFields.versionLabel || null,
    sha256: sha256 || null,
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

// The current (non-version) item at a brain path, if any.
export async function findItemByBrainPath({ clientId, brainPath }) {
  if (!clientId || !brainPath) return null;
  const { items } = getKnowledgeBaseRefs(clientId);
  const snap = await items.where('brainPath', '==', brainPath).limit(10).get();
  const doc = snap.docs.find((entry) => (entry.data() || {}).brainRole !== 'version');
  return doc ? publicItemFromDoc(doc) : null;
}

// Keep the old copy of a replaced file under versions/<date>-before-<name>/.
export async function moveItemToVersions({ clientId, itemId, brainPath, today = todayIso() }) {
  const { items } = getKnowledgeBaseRefs(clientId);
  const next = versionPathFor(brainPath, { today });
  await items.doc(itemId).set(
    {
      brainPath: next.brainPath,
      brainRole: 'version',
      versionLabel: next.versionLabel,
      brainDate: today,
      updatedAt: fb.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return next;
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

// Pasted text and imported URLs have no uploaded file. Save their text to
// Storage so the brain export can write them out as files with a real hash.
export async function saveItemRawText({ clientId, itemId, text }) {
  const { createHash } = await import('node:crypto');
  const buffer = Buffer.from(String(text || ''), 'utf8');
  const storagePath = `knowledge-base/${clientId}/${itemId}.md`;
  await fb.adminStorage.bucket().file(storagePath).save(buffer, {
    resumable: false,
    contentType: 'text/markdown; charset=utf-8',
    metadata: { metadata: { clientId, itemId, uploadedAt: new Date().toISOString() } },
  });
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  await getKnowledgeBaseRefs(clientId).items.doc(itemId).set(
    { storagePath, contentType: 'text/markdown', sizeBytes: buffer.length, sha256, updatedAt: fb.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return { storagePath, sha256, sizeBytes: buffer.length };
}

// Raw bytes of an item for export: the stored file when there is one,
// otherwise the item's chunks rejoined (older pasted-text items).
export async function readItemBytes({ clientId, item }) {
  if (item.storagePath) {
    try {
      const [buffer] = await fb.adminStorage.bucket().file(item.storagePath).download();
      return buffer;
    } catch (err) {
      console.warn('[knowledge-base] export read failed:', item.storagePath, err.message);
    }
  }
  const chunks = await listKnowledgeChunks({ clientId, itemId: item.id, limit: 500 });
  return Buffer.from(chunks.map((chunk) => chunk.text).join('\n\n'), 'utf8');
}

// Attach source IDs (D1, X1–X11, ...) from the brain's source register, when
// one has been uploaded.
export async function attachSourceIds({ clientId, items }) {
  const register = findSourceRegister(items);
  if (!register) return items;
  try {
    const text = (await readItemBytes({ clientId, item: register })).toString('utf8');
    const ids = parseSourceRegister(text, { registerPath: register.brainPath });
    return items.map((item) => (ids[item.brainPath] ? { ...item, sourceIds: ids[item.brainPath] } : item));
  } catch (err) {
    console.warn('[knowledge-base] source register read failed:', err.message);
    return items;
  }
}
