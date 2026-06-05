import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { chunkText, normalizeWhitespace } from '../../../../features/knowledge-base/chunk.js';
import { embedKnowledgeItemChunks } from '../../../../features/knowledge-base/embed.js';
import { createKnowledgeItem, deleteKnowledgeItemCascade } from '../../../../features/knowledge-base/store.js';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyAdminRequest, verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getDashboardBootstrap } = require('../../../../api/_lib/client-provisioning.cjs');
const { persistBriefPdfArtifact } = require('../../../../api/_lib/browserless.cjs');
const { deleteCustomBriefFromVercel } = require('../../../../api/_lib/vercel-briefs.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : 0;
}

function serializeDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function slugify(value, fallback = 'brief') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function compactClientSlug(value, fallback = 'client') {
  const words = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 2 && ['shop', 'store', 'restaurant', 'llc', 'inc', 'co', 'company', 'ltd'].includes(words[words.length - 1])) {
    words.pop();
  }
  return words.join('') || slugify(fallback, 'client').replace(/-/g, '');
}

function compactPathSlug(value, fallback = 'brief') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return slug || slugify(fallback, 'brief').replace(/-/g, '');
}

function titlePdfFileName(value, fallback = 'Custom Brief') {
  const base = String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  const safeBase = base || fallback;
  return `${safeBase.slice(0, 120)}.pdf`;
}

function clientDisplayName(client, fallback = '') {
  return client?.companyName || client?.name || client?.dashboardTitle || client?.displayName || fallback;
}

function publicClientSlugFor(client, clientId, explicit) {
  return compactClientSlug(
    explicit || client?.publicClientSlug || client?.publicSlug || client?.slug || clientDisplayName(client, clientId),
    clientId
  );
}

function extractTitle(html, fallback) {
  const titleMatch = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = String(html || '').match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const raw = (titleMatch && titleMatch[1]) || (h1Match && h1Match[1]) || fallback;
  return String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashHtml(html) {
  return createHash('sha256').update(String(html || '')).digest('hex');
}

function validCustomBriefKey(value) {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(String(value || ''));
}

function htmlToKnowledgeText(html) {
  return normalizeWhitespace(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|header|footer|main|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+\n/g, '\n')
  );
}

async function ingestBriefIntoClientBrain({
  clientId,
  title,
  html,
  publicUrl,
  briefSlug,
  publicClientSlug,
  publicBriefSlug,
  submittedBy,
}) {
  const text = htmlToKnowledgeText(html);
  if (!text || text.length < 20) {
    return {
      ok: false,
      warning: {
        type: 'warning',
        code: 'custom_brief_brain_ingest_no_text',
        message: 'Custom brief was saved, but no usable text was found for Client Brain ingestion.',
      },
    };
  }

  const chunks = chunkText(text);
  if (!chunks.length) {
    return {
      ok: false,
      warning: {
        type: 'warning',
        code: 'custom_brief_brain_ingest_no_chunks',
        message: 'Custom brief was saved, but no usable chunks were found for Client Brain ingestion.',
      },
    };
  }

  const item = await createKnowledgeItem({
    clientId,
    title,
    type: 'custom-brief',
    sourceUrl: publicUrl,
    chunks,
    status: 'processing',
    fileName: `${publicBriefSlug || briefSlug || 'custom-brief'}.html`,
    contentType: 'text/html',
    sizeBytes: Buffer.byteLength(html, 'utf8'),
  });

  await fb.adminDb
    .collection('knowledge_base')
    .doc(clientId)
    .collection('items')
    .doc(item.id)
    .set({
      customBrief: {
        briefSlug,
        publicClientSlug,
        publicBriefSlug,
        publicUrl,
      },
      sourceKind: 'custom_brief',
      submittedBy: submittedBy || null,
      updatedAt: fb.FieldValue.serverTimestamp(),
    }, { merge: true });

  try {
    const embedded = await embedKnowledgeItemChunks({ clientId, itemId: item.id });
    return {
      ok: true,
      item: { ...item, status: 'ready', error: null },
      chunkCount: chunks.length,
      embedded,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Client Brain embedding failed.';
    return {
      ok: true,
      item: { ...item, status: 'error', error: message },
      chunkCount: chunks.length,
      embedded: null,
      warning: {
        type: 'warning',
        code: 'custom_brief_brain_embed_failed',
        message: `Custom brief was added to Client Brain, but embeddings failed: ${message}`,
      },
    };
  }
}

async function resolveCustomBriefDoc(clientId, briefKey) {
  const briefsRef = fb.adminDb
    .collection('clients')
    .doc(clientId)
    .collection('custom_briefs');

  const direct = await briefsRef.doc(briefKey).get();
  if (direct.exists) return direct;

  const publicSlugSnapshot = await briefsRef
    .where('publicBriefSlug', '==', briefKey)
    .limit(1)
    .get();
  if (!publicSlugSnapshot.empty) return publicSlugSnapshot.docs[0];

  const existingSnapshot = await briefsRef.limit(100).get();
  return existingSnapshot.docs.find((doc) => {
    const data = doc.data() || {};
    return compactPathSlug(data.publicBriefSlug || data.briefSlug || doc.id, doc.id) === briefKey ||
      compactPathSlug(data.title || '', doc.id) === briefKey;
  }) || null;
}

async function deleteKnowledgeItemIfExists(clientId, itemId) {
  if (!itemId) return { deletedItems: 0, deletedChunks: 0 };
  try {
    const result = await deleteKnowledgeItemCascade({ clientId, itemId });
    return { deletedItems: 1, deletedChunks: Number(result.deletedChunks) || 0 };
  } catch (error) {
    if (Number(error?.status) === 404) return { deletedItems: 0, deletedChunks: 0 };
    throw error;
  }
}

async function deleteCustomBriefBrainReferences({ clientId, briefDocId, brief }) {
  const itemIds = new Set();
  if (brief.knowledgeBaseItemId) itemIds.add(String(brief.knowledgeBaseItemId));

  const itemsRef = fb.adminDb.collection('knowledge_base').doc(clientId).collection('items');
  const values = [
    { field: 'customBrief.briefSlug', value: brief.briefSlug || briefDocId },
    { field: 'customBrief.publicBriefSlug', value: brief.publicBriefSlug || null },
    { field: 'customBrief.publicUrl', value: brief.knowledgeBaseSourceUrl || null },
    { field: 'sourceUrl', value: brief.knowledgeBaseSourceUrl || null },
  ].filter((entry) => entry.value);

  for (const entry of values) {
    const snapshot = await itemsRef.where(entry.field, '==', entry.value).limit(50).get();
    snapshot.docs.forEach((doc) => itemIds.add(doc.id));
  }

  let deletedItems = 0;
  let deletedChunks = 0;
  for (const itemId of itemIds) {
    const result = await deleteKnowledgeItemIfExists(clientId, itemId);
    deletedItems += result.deletedItems;
    deletedChunks += result.deletedChunks;
  }

  return { deletedItems, deletedChunks };
}

async function deleteStorageObject({ storagePath, bucketName = null }) {
  if (!storagePath) return 0;
  try {
    const bucket = bucketName ? fb.adminStorage.bucket(bucketName) : fb.adminStorage.bucket();
    await bucket.file(storagePath).delete({ ignoreNotFound: true });
    return 1;
  } catch {
    return 0;
  }
}

async function deleteStoragePrefix(prefix) {
  if (!prefix) return 0;
  try {
    const bucket = fb.adminStorage.bucket();
    const [files] = await bucket.getFiles({ prefix });
    await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true }).catch(() => null)));
    return files.length;
  } catch {
    return 0;
  }
}

async function deleteCustomBriefArtifacts({ clientId, briefDocId, brief }) {
  let deletedFiles = 0;
  const artifact = brief.pdfArtifact || null;

  if (artifact?.storagePath) {
    deletedFiles += await deleteStorageObject({ storagePath: artifact.storagePath, bucketName: artifact.bucket || null });
  }

  const publicClientSlug = brief.publicClientSlug || clientId;
  const publicBriefSlug = brief.publicBriefSlug || compactPathSlug(brief.briefSlug || briefDocId, briefDocId);
  const briefSlug = brief.briefSlug || briefDocId;
  const prefixes = [
    `clients/${publicClientSlug}/brief-runs/${publicBriefSlug}/`,
    `clients/${publicClientSlug}/brief-runs/${briefSlug}/`,
    `clients/${clientId}/brief-runs/${publicBriefSlug}/`,
    `clients/${clientId}/brief-runs/${briefSlug}/`,
    `clients/${clientId}/brief-runs/custom-brief-${briefSlug}-`,
  ];

  for (const prefix of [...new Set(prefixes)].filter(Boolean)) {
    deletedFiles += await deleteStoragePrefix(prefix);
  }

  return { deletedFiles };
}

async function deleteCustomBriefVercelProject(brief) {
  const vercel = brief.vercel || null;
  const hasVercelLink = Boolean(vercel?.projectName || vercel?.deploymentId || vercel?.url || brief.vercelUrl);
  if (!hasVercelLink) {
    return {
      ok: true,
      skipped: true,
      reason: 'No Vercel deployment is linked to this brief.',
    };
  }

  return deleteCustomBriefFromVercel({
    projectName: vercel?.projectName || '',
    deploymentId: vercel?.deploymentId || '',
    url: vercel?.url || brief.vercelUrl || '',
  });
}

function serializeBriefDoc({ doc, data, clientId, client, origin }) {
  const publicClientSlug = data.publicClientSlug || publicClientSlugFor(client, clientId);
  const publicBriefSlug = data.publicBriefSlug || compactPathSlug(data.briefSlug || doc.id, doc.id);
  const publicPath = `/briefs/${encodeURIComponent(publicClientSlug)}/${encodeURIComponent(publicBriefSlug)}`;
  const pdfDownloadPath = `${publicPath}/pdf`;
  const ogImagePath = `${publicPath}/og-image`;
  const pdfArtifact = data.pdfArtifact || null;
  return {
    id: doc.id,
    briefSlug: data.briefSlug || doc.id,
    publicBriefSlug,
    title: data.title || doc.id,
    description: data.description || '',
    ogLabel: data.ogLabel || 'BRYAN BALLI',
    hideOgSubhead: data.hideOgSubhead === true,
    sourcePath: data.sourcePath || '',
    sourceHash: data.sourceHash || '',
    public: data.public !== false,
    publicClientSlug,
    publicPath,
    publicUrl: `${origin}${publicPath}`,
    legacyPublicPath: data.publicPath || `/briefs/${encodeURIComponent(clientId)}/${encodeURIComponent(doc.id)}`,
    ogImagePath,
    ogImageUrl: `${origin}${ogImagePath}`,
    pdfUrl: data.pdfUrl || pdfArtifact?.downloadUrl || '',
    pdfFileName: data.pdfFileName || pdfArtifact?.fileName || titlePdfFileName(data.title || doc.id),
    pdfDownloadPath,
    pdfDownloadUrl: `${origin}${pdfDownloadPath}`,
    pdfArtifact,
    vercel: data.vercel || null,
    vercelUrl: data.vercelUrl || data.vercel?.url || '',
    vercelReadyState: data.vercel?.readyState || '',
    knowledgeBaseItemId: data.knowledgeBaseItemId || '',
    knowledgeBaseStatus: data.knowledgeBaseStatus || '',
    knowledgeBaseChunkCount: Number(data.knowledgeBaseChunkCount) || 0,
    addedToClientBrain: Boolean(data.knowledgeBaseItemId),
    importedAt: serializeDate(data.importedAt),
    updatedAt: serializeDate(data.updatedAt),
    createdAt: serializeDate(data.createdAt),
  };
}

export async function GET(request) {
  try {
    const decoded = await verifyRequestUser(makeReqShim(request));
    const bootstrap = await getDashboardBootstrap({
      uid: decoded.uid,
      email: decoded.email,
      request,
    });
    const clientId = bootstrap?.effectiveClientId || bootstrap?.client?.clientId || bootstrap?.client?.id;

    if (!clientId) {
      return NextResponse.json({ clientId: null, briefs: [] });
    }

    const snapshot = await fb.adminDb
      .collection('clients')
      .doc(clientId)
      .collection('custom_briefs')
      .get();

    const origin = request.nextUrl.origin;
    const briefs = snapshot.docs
      .map((doc) => serializeBriefDoc({ doc, data: doc.data() || {}, clientId, client: bootstrap?.client || null, origin }))
      .filter((brief) => brief.public)
      .sort((a, b) => Math.max(toMillis(b.updatedAt), toMillis(b.importedAt)) - Math.max(toMillis(a.updatedAt), toMillis(a.importedAt)));

    return NextResponse.json({ clientId, briefs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load custom briefs.';
    const status = /^Unauthorized/i.test(message) ? 401 : /^Forbidden/i.test(message) ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request) {
  try {
    const decoded = await verifyAdminRequest(makeReqShim(request));
    const bootstrap = await getDashboardBootstrap({
      uid: decoded.uid,
      email: decoded.email,
      request,
    });
    const clientId = bootstrap?.effectiveClientId || bootstrap?.client?.clientId || bootstrap?.client?.id;

    if (!clientId) {
      return NextResponse.json({ error: 'No effective client is selected.' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const html = String(body.html || '').trim();
    if (!html) {
      return NextResponse.json({ error: 'HTML is required.' }, { status: 400 });
    }
    if (!/<html[\s>]/i.test(html) && !/<!doctype html/i.test(html)) {
      return NextResponse.json({ error: 'Submit a complete HTML document.' }, { status: 400 });
    }
    if (Buffer.byteLength(html, 'utf8') > 3 * 1024 * 1024) {
      return NextResponse.json({ error: 'HTML brief is too large. Keep it under 3MB.' }, { status: 413 });
    }

    const title = String(body.title || extractTitle(html, 'Custom brief')).trim().slice(0, 140);
    const briefSlug = slugify(body.briefSlug || title, 'custom-brief');
    const publicBriefSlug = compactPathSlug(body.publicBriefSlug || body.briefSlug || title, briefSlug);
    const description = String(body.description || '').trim().slice(0, 500);
    const ogLabel = String(body.ogLabel || 'BRYAN BALLI').trim().slice(0, 80) || 'BRYAN BALLI';
    const hideOgSubhead = body.hideOgSubhead === true;
    const pdfFileName = titlePdfFileName(title);
    const isPublic = body.public !== false;
    const publicClientSlug = publicClientSlugFor(bootstrap?.client || null, clientId, body.publicClientSlug);
    const publicPath = `/briefs/${publicClientSlug}/${publicBriefSlug}`;
    const publicUrl = `${request.nextUrl.origin}${publicPath}`;
    const sourceHash = hashHtml(html);
    const addToClientBrain = body.addToClientBrain !== false;
    const ref = fb.adminDb
      .collection('clients')
      .doc(clientId)
      .collection('custom_briefs')
      .doc(briefSlug);
    const existing = await ref.get();
    const existingData = existing.exists ? existing.data() || {} : {};
    const now = fb.FieldValue.serverTimestamp();
    const runId = `custom-brief-${briefSlug}-${Date.now()}`;
    const pdfResult = await persistBriefPdfArtifact({
      clientId,
      runId,
      html,
      fileName: pdfFileName,
      storageClientKey: publicClientSlug,
      storageBriefKey: publicBriefSlug,
      pdfMode: 'edge-to-edge',
    });
    const warnings = [];
    if (!pdfResult?.ok && pdfResult?.warning) warnings.push(pdfResult.warning);
    let brainResult = null;

    if (addToClientBrain) {
      if (existingData.sourceHash === sourceHash && existingData.knowledgeBaseItemId) {
        brainResult = {
          ok: true,
          reused: true,
          item: {
            id: existingData.knowledgeBaseItemId,
            status: existingData.knowledgeBaseStatus || 'ready',
            error: existingData.knowledgeBaseError || null,
          },
          chunkCount: Number(existingData.knowledgeBaseChunkCount) || 0,
        };
      } else {
        try {
          brainResult = await ingestBriefIntoClientBrain({
            clientId,
            title: String(body.knowledgeBaseTitle || title).trim().slice(0, 160) || title,
            html,
            publicUrl,
            briefSlug,
            publicClientSlug,
            publicBriefSlug,
            submittedBy: decoded.email || decoded.uid || 'admin',
          });
          if (brainResult?.warning) warnings.push(brainResult.warning);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Client Brain ingest failed.';
          const warning = {
            type: 'warning',
            code: 'custom_brief_brain_ingest_failed',
            message: `Custom brief was saved, but Client Brain ingest failed: ${message}`,
          };
          warnings.push(warning);
          brainResult = { ok: false, warning };
        }
      }
    }

    await ref.set({
      clientId,
      briefSlug,
      publicBriefSlug,
      title,
      description,
      ogLabel,
      hideOgSubhead,
      html,
      public: isPublic,
      publicClientSlug,
      pdfFileName,
      publicPath,
      legacyPublicPath: `/briefs/${clientId}/${briefSlug}`,
      sourcePath: body.sourcePath || 'dashboard-submit-custom-brief',
      sourceHash,
      submittedBy: decoded.email || decoded.uid || 'admin',
      updatedAt: now,
      importedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
      ...(pdfResult?.ok && pdfResult.artifactRef ? {
        pdfArtifact: pdfResult.artifactRef,
        pdfUrl: pdfResult.artifactRef.downloadUrl || '',
      } : {}),
      ...(brainResult?.ok && brainResult.item?.id ? {
        addToClientBrain,
        knowledgeBaseItemId: brainResult.item.id,
        knowledgeBaseStatus: brainResult.item.status || 'ready',
        knowledgeBaseChunkCount: Number(brainResult.chunkCount) || 0,
        knowledgeBaseSourceUrl: publicUrl,
        knowledgeBaseError: brainResult.item.error || fb.FieldValue.delete(),
        knowledgeBaseUpdatedAt: now,
      } : addToClientBrain ? {
        addToClientBrain,
        knowledgeBaseItemId: fb.FieldValue.delete(),
        knowledgeBaseChunkCount: fb.FieldValue.delete(),
        knowledgeBaseSourceUrl: fb.FieldValue.delete(),
        knowledgeBaseStatus: 'error',
        knowledgeBaseError: brainResult?.warning?.message || 'Client Brain ingest failed.',
        knowledgeBaseUpdatedAt: now,
      } : {
        addToClientBrain: false,
        knowledgeBaseItemId: fb.FieldValue.delete(),
        knowledgeBaseChunkCount: fb.FieldValue.delete(),
        knowledgeBaseSourceUrl: fb.FieldValue.delete(),
        knowledgeBaseError: fb.FieldValue.delete(),
        knowledgeBaseStatus: 'skipped',
        knowledgeBaseUpdatedAt: now,
      }),
      warnings: warnings.length ? warnings : fb.FieldValue.delete(),
    }, { merge: true });

    await Promise.all([
      fb.adminDb.collection('brief_client_slugs').doc(publicClientSlug).set({
        publicClientSlug,
        clientId,
        clientName: clientDisplayName(bootstrap?.client || null, clientId),
        updatedAt: now,
      }, { merge: true }),
      fb.adminDb.collection('clients').doc(clientId).set({
        publicClientSlug,
        updatedAt: now,
      }, { merge: true }),
    ]);

    const saved = await ref.get();
    const brief = serializeBriefDoc({
      doc: saved,
      data: saved.data() || {},
      clientId,
      client: bootstrap?.client || null,
      origin: request.nextUrl.origin,
    });

    return NextResponse.json({
      clientId,
      brief,
      pdf: pdfResult?.ok ? { ok: true } : { ok: false, warning: pdfResult?.warning || null },
      brain: brainResult?.ok
        ? {
          ok: true,
          itemId: brainResult.item?.id || '',
          status: brainResult.item?.status || 'ready',
          reused: Boolean(brainResult.reused),
          chunkCount: Number(brainResult.chunkCount) || 0,
          warning: brainResult.warning || null,
        }
        : {
          ok: false,
          skipped: !addToClientBrain,
          warning: brainResult?.warning || null,
        },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save custom brief.';
    const status = /^Unauthorized/i.test(message) ? 401 : /^Forbidden/i.test(message) ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request) {
  try {
    const decoded = await verifyAdminRequest(makeReqShim(request));
    const bootstrap = await getDashboardBootstrap({
      uid: decoded.uid,
      email: decoded.email,
      request,
    });
    const clientId = bootstrap?.effectiveClientId || bootstrap?.client?.clientId || bootstrap?.client?.id;

    if (!clientId) {
      return NextResponse.json({ error: 'No effective client is selected.' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const briefKey = String(body.briefId || body.briefSlug || body.id || '').trim();
    if (!briefKey || !validCustomBriefKey(briefKey)) {
      return NextResponse.json({ error: 'A valid brief id is required.' }, { status: 400 });
    }

    const snapshot = await resolveCustomBriefDoc(clientId, briefKey);
    if (!snapshot?.exists) {
      return NextResponse.json({ error: 'Custom brief not found.' }, { status: 404 });
    }

    const brief = snapshot.data() || {};
    const vercelResult = await deleteCustomBriefVercelProject(brief);
    const [brainResult, artifactResult] = await Promise.all([
      deleteCustomBriefBrainReferences({ clientId, briefDocId: snapshot.id, brief }),
      deleteCustomBriefArtifacts({ clientId, briefDocId: snapshot.id, brief }),
    ]);

    await snapshot.ref.delete();

    return NextResponse.json({
      ok: true,
      clientId,
      deletedBriefId: snapshot.id,
      brain: {
        deletedItems: brainResult.deletedItems,
        deletedChunks: brainResult.deletedChunks,
      },
      artifacts: {
        deletedFiles: artifactResult.deletedFiles,
      },
      vercel: {
        deleted: Boolean(vercelResult?.ok && !vercelResult?.skipped),
        skipped: Boolean(vercelResult?.skipped),
        alreadyDeleted: Boolean(vercelResult?.alreadyDeleted),
        projectName: vercelResult?.projectName || brief.vercel?.projectName || '',
        reason: vercelResult?.reason || '',
      },
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not delete custom brief.';
    const status = /^Unauthorized/i.test(message) ? 401 : /^Forbidden/i.test(message) ? 403 : Number(error?.status) || 500;
    return NextResponse.json({ error: message }, { status });
  }
}
