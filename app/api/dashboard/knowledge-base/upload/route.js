import { extname } from 'node:path';
import { NextResponse } from 'next/server';
import { createRequire } from 'module';

import { chunkText } from '../../../../../features/knowledge-base/chunk.js';
import { extractDocumentText, validateDocumentFile } from '../../../../../features/knowledge-base/document.js';
import { embedKnowledgeItemChunks } from '../../../../../features/knowledge-base/embed.js';
import { createKnowledgeItem, updateKnowledgeItemStatus } from '../../../../../features/knowledge-base/store.js';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');

export const runtime = 'nodejs';
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

function sanitizeFileName(name) {
  return String(name || 'document')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'document';
}

function storageExtension(fileName, documentType) {
  const ext = extname(String(fileName || '').toLowerCase()).replace(/[^a-z0-9.]/g, '').slice(0, 16);
  if (ext) return ext;
  if (documentType === 'pdf') return '.pdf';
  if (documentType === 'docx') return '.docx';
  return '.txt';
}

export async function POST(request) {
  let context;
  try {
    context = await resolveContext(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: 'Invalid form data.' }, 400);
  }

  const file = formData.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return json({ error: 'file is required.' }, 400);
  }

  const fileName = sanitizeFileName(file.name);
  const title = String(formData.get('title') || fileName || 'Uploaded document').trim();
  const contentType = file.type || 'application/octet-stream';
  const sizeBytes = Number(file.size) || 0;
  let item = null;
  let stage = 'validate';

  try {
    validateDocumentFile({ fileName, contentType, sizeBytes });

    stage = 'read';
    const buffer = Buffer.from(await file.arrayBuffer());
    stage = 'extract';
    const extracted = await extractDocumentText({ buffer, fileName, contentType });
    stage = 'chunk';
    const chunks = chunkText(extracted.text);
    if (!chunks.length) {
      return json({ error: 'No usable text was found to store.' }, 400);
    }

    stage = 'store';
    item = await createKnowledgeItem({
      clientId: context.clientId,
      title: title || fileName,
      type: extracted.type || 'file',
      sourceUrl: null,
      chunks,
      status: 'processing',
      storagePath: null,
      fileName,
      contentType,
      sizeBytes,
    });

    stage = 'upload-storage';
    const storagePath = `knowledge-base/${context.clientId}/${item.id}${storageExtension(fileName, extracted.type)}`;
    await fb.adminStorage.bucket().file(storagePath).save(buffer, {
      resumable: false,
      contentType,
      metadata: {
        metadata: {
          clientId: context.clientId,
          itemId: item.id,
          originalFileName: fileName,
          documentType: extracted.type || 'file',
          parser: extracted.parser || '',
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    await fb.adminDb
      .collection('knowledge_base')
      .doc(context.clientId)
      .collection('items')
      .doc(item.id)
      .set(
        {
          storagePath,
          fileName,
          contentType,
          sizeBytes,
          documentParser: extracted.parser || null,
          documentPages: extracted.pages || null,
          documentWarnings: Array.isArray(extracted.warnings) ? extracted.warnings.slice(0, 10) : [],
          updatedAt: fb.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    stage = 'embed';
    const embedded = await embedKnowledgeItemChunks({ clientId: context.clientId, itemId: item.id });
    return json({
      ok: true,
      item: {
        ...item,
        type: extracted.type || 'file',
        status: 'ready',
        error: null,
        storagePath,
        fileName,
        contentType,
        sizeBytes,
        documentParser: extracted.parser || null,
        documentPages: extracted.pages || null,
      },
      chunkCount: chunks.length,
      embedded,
      warnings: Array.isArray(extracted.warnings) ? extracted.warnings : [],
    });
  } catch (err) {
    if (item?.id) {
      await updateKnowledgeItemStatus({
        clientId: context.clientId,
        itemId: item.id,
        status: 'error',
        error: err.message || 'Document upload failed.',
      }).catch(() => null);
    }
    console.error('[knowledge-base] document upload failed', {
      stage,
      fileName,
      contentType,
      sizeBytes,
      clientId: context.clientId,
      itemId: item?.id || null,
      error: err.message,
      stack: err.stack,
    });
    return json({ error: err.message || 'Document upload failed.', stage }, err.status || 500);
  }
}
