import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { chunkText, normalizeWhitespace } from '../../../../features/knowledge-base/chunk.js';
import { embedKnowledgeItemChunks } from '../../../../features/knowledge-base/embed.js';
import { createKnowledgeItem, deleteKnowledgeItemCascade } from '../../../../features/knowledge-base/store.js';
import { ClientBriefParseError } from '../../../../features/client-brief/parse.js';
import {
  CLIENT_BRIEF_KIND,
  CLIENT_BRIEF_LAYOUT_VERSION,
  CLIENT_BRIEF_MAX_HTML_BYTES,
  CLIENT_BRIEF_SLUG_RE,
  clientBriefPdfMode,
  allowsFuzzyResolve,
  buildClientBrief,
  isClientBriefData,
  newClientBriefSlug,
  selectBriefsForViewer,
} from '../../../../features/client-brief/publish.js';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { isAdminEmail, verifyAdminRequest, verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
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
    // Client briefs are reachable by exact id / exact public slug only.
    if (!allowsFuzzyResolve(data)) return false;
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

// Throws on failure so callers that must know (client-brief unpublish) can see it.
async function deleteStorageObjectStrict({ storagePath, bucketName = null }) {
  const bucket = bucketName ? fb.adminStorage.bucket(bucketName) : fb.adminStorage.bucket();
  await bucket.file(storagePath).delete({ ignoreNotFound: true });
  return 1;
}

// Best-effort variant used by every existing caller: same 1/0 result as before.
async function deleteStorageObject({ storagePath, bucketName = null }) {
  if (!storagePath) return 0;
  try {
    return await deleteStorageObjectStrict({ storagePath, bucketName });
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
    kind: data.kind === 'invoice' ? 'invoice' : data.kind === CLIENT_BRIEF_KIND ? CLIENT_BRIEF_KIND : 'brief',
    invoice: data.invoice || null,
    sections: data.sections || null,
    description: data.description || '',
    ogLabel: data.ogLabel || 'BRYAN BALLI',
    hideOgSubhead: data.hideOgSubhead === true,
    ogSubhead: data.ogSubhead || '',
    ogLines: Array.isArray(data.ogLines) ? data.ogLines : [],
    ogTitleLines: Array.isArray(data.ogTitleLines) ? data.ogTitleLines : [],
    ...(data.kind === CLIENT_BRIEF_KIND ? { sourceText: String(data.sourceText || ''), layoutVersion: Number(data.layoutVersion) || 1 } : {}),
    sourcePath: data.sourcePath || '',
    sourceHash: data.sourceHash || '',
    public: data.public === true,
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

// Client Brief publish/update/preview. The server parses and renders the pasted
// text itself (never trusts client HTML). The client always comes from the
// admin's effective-client bootstrap, never from the body. Never ingests into
// Client Brain and never touches Vercel.
//
// POST with an existing client brief's `briefSlug` UPDATES it in place (same
// slug and URL, createdAt kept); without one it creates a new random slug. An
// update never falls through to create and never touches another kind/client.
async function handleClientBriefPost({ request, decoded, bootstrap, clientId, body }) {
  const client = bootstrap?.client || null;
  const clientName = clientDisplayName(client, '');
  const noStore = { headers: { 'cache-control': 'no-store' } };
  const parseFailure = (error) => {
    if (error instanceof ClientBriefParseError) {
      return NextResponse.json({ error: error.message }, { status: error.code === 'too_long' ? 413 : 400 });
    }
    return null;
  };

  // Preview: pure render. No Firestore, no Storage, no PDF, no slug.
  if (body.preview === true) {
    try {
      const { html, model } = buildClientBrief({ body, clientName });
      return NextResponse.json({ ok: true, html, title: model.title }, noStore);
    } catch (error) {
      const failure = parseFailure(error);
      if (failure) return failure;
      throw error;
    }
  }

  const collection = fb.adminDb.collection('clients').doc(clientId).collection('custom_briefs');
  const requestedSlug = body.briefSlug === undefined || body.briefSlug === null ? '' : String(body.briefSlug).trim();
  const isUpdate = Boolean(requestedSlug);
  let existing = null;
  if (isUpdate) {
    if (!CLIENT_BRIEF_SLUG_RE.test(requestedSlug)) {
      return NextResponse.json({ error: 'A valid client brief id is required.' }, { status: 400 });
    }
    const snapshot = await collection.doc(requestedSlug).get();
    if (!snapshot.exists || !isClientBriefData(snapshot.data())) {
      return NextResponse.json({ error: 'Client brief not found.' }, { status: 404 });
    }
    existing = snapshot.data() || {};
  }

  const briefSlug = isUpdate ? requestedSlug : newClientBriefSlug();
  const publicBriefSlug = briefSlug;
  const publicClientSlug = (isUpdate && existing.publicClientSlug) || publicClientSlugFor(client, clientId);
  const publicPath = (isUpdate && existing.publicPath) || `/briefs/${publicClientSlug}/${publicBriefSlug}`;

  let built;
  try {
    built = buildClientBrief({ body, clientName, pdfPath: `${publicPath}/pdf` });
  } catch (error) {
    const failure = parseFailure(error);
    if (failure) return failure;
    throw error;
  }
  const { model, html, og, description } = built;
  if (Buffer.byteLength(html, 'utf8') > CLIENT_BRIEF_MAX_HTML_BYTES) {
    return NextResponse.json({ error: 'Client brief is too large.' }, { status: 413 });
  }

  const title = model.title.slice(0, 140);
  const pdfFileName = titlePdfFileName(title, 'Client Brief');
  // Update: an omitted `public` keeps the existing value.
  const isPublic = isUpdate && typeof body.public !== 'boolean' ? existing.public === true : body.public === true;
  const ref = collection.doc(briefSlug);
  const now = fb.FieldValue.serverTimestamp();

  // Update: the old stored PDF is deleted BEFORE re-rendering (a title change
  // alters the storage file name) and its pointers are cleared. If it cannot
  // be removed nothing is written.
  const clearedPdf = {};
  if (isUpdate) {
    const artifact = existing.pdfArtifact || null;
    if (artifact?.storagePath) {
      try {
        await deleteStorageObjectStrict({ storagePath: artifact.storagePath, bucketName: artifact.bucket || null });
      } catch {
        return NextResponse.json({ error: 'The previous PDF could not be removed, so nothing was changed. Try again.' }, { status: 502 });
      }
    }
    await deleteCustomBriefArtifacts({ clientId, briefDocId: briefSlug, brief: { ...existing, pdfArtifact: null } });
    clearedPdf.pdfArtifact = fb.FieldValue.delete();
    clearedPdf.pdfUrl = fb.FieldValue.delete();
    clearedPdf.warnings = fb.FieldValue.delete();
  }

  // Write the doc FIRST so a failed write can never leave an orphan PDF behind.
  await ref.set({
    clientId,
    kind: CLIENT_BRIEF_KIND,
    layoutVersion: CLIENT_BRIEF_LAYOUT_VERSION,
    briefSlug,
    publicBriefSlug,
    title,
    description,
    ogLabel: og.ogLabel,
    hideOgSubhead: og.hideOgSubhead,
    ogSubhead: og.ogSubhead,
    ogLines: og.ogLines,
    ogTitleLines: og.ogTitleLines,
    html,
    sourceText: String(body.text),
    blocks: model.blocks,
    public: isPublic,
    publicClientSlug,
    pdfFileName,
    publicPath,
    legacyPublicPath: `/briefs/${clientId}/${briefSlug}`,
    sourcePath: 'dashboard-client-brief',
    sourceHash: hashHtml(html),
    submittedBy: decoded.email || decoded.uid || 'admin',
    updatedAt: now,
    ...(isUpdate ? {} : { importedAt: now, createdAt: now }),
    ...clearedPdf,
    // Never part of Client Brain.
    addToClientBrain: false,
    knowledgeBaseStatus: 'skipped',
    knowledgeBaseUpdatedAt: now,
  }, { merge: true });

  await Promise.all([
    fb.adminDb.collection('brief_client_slugs').doc(publicClientSlug).set({
      publicClientSlug,
      clientId,
      clientName: clientDisplayName(client, clientId),
      updatedAt: now,
    }, { merge: true }),
    fb.adminDb.collection('clients').doc(clientId).set({
      publicClientSlug,
      updatedAt: now,
    }, { merge: true }),
  ]);

  // PDF second. A failure here is a warning only; the doc stays and /pdf
  // renders lazily on first download.
  const warnings = [];
  let pdfResult = null;
  if (isPublic) {
    try {
      pdfResult = await persistBriefPdfArtifact({
        clientId,
        runId: `custom-brief-${briefSlug}-${Date.now()}`,
        html,
        fileName: pdfFileName,
        storageClientKey: publicClientSlug,
        storageBriefKey: publicBriefSlug,
        pdfMode: clientBriefPdfMode({ layoutVersion: CLIENT_BRIEF_LAYOUT_VERSION }),
      });
    } catch (error) {
      pdfResult = { ok: false, warning: { type: 'warning', code: 'client_brief_pdf_failed', message: error instanceof Error ? error.message : 'PDF render failed.' } };
    }
    if (pdfResult?.ok && pdfResult.artifactRef) {
      try {
        await ref.set({
          pdfArtifact: pdfResult.artifactRef,
          pdfUrl: pdfResult.artifactRef.downloadUrl || '',
        }, { merge: true });
      } catch (error) {
        // Doc update failed after the PDF was stored: do not leave it orphaned.
        await deleteStorageObject({ storagePath: pdfResult.artifactRef.storagePath, bucketName: pdfResult.artifactRef.bucket || null });
        pdfResult = { ok: false, warning: { type: 'warning', code: 'client_brief_pdf_link_failed', message: 'PDF was rendered but could not be linked; it will generate on first download.' } };
      }
    }
    if (!pdfResult?.ok && pdfResult?.warning) {
      warnings.push(pdfResult.warning);
      await ref.set({ warnings }, { merge: true }).catch(() => {});
    }
  }

  const saved = await ref.get();
  const brief = serializeBriefDoc({
    doc: saved,
    data: saved.data() || {},
    clientId,
    client,
    origin: request.nextUrl.origin,
  });
  return NextResponse.json({
    clientId,
    updated: isUpdate,
    brief,
    pdf: pdfResult?.ok ? { ok: true } : { ok: false, skipped: !pdfResult, warning: pdfResult?.warning || null },
    brain: { ok: false, skipped: true, warning: null },
  }, noStore);
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
    // Optional ?kind=invoice (or ?kind=brief) filter for the card's
    // separate invoice list; omitted/unrecognized = no filtering, so
    // existing callers keep getting every public brief as before.
    const kindFilter = request.nextUrl.searchParams.get('kind');
    // Client briefs are admin-only: selectBriefsForViewer drops them for
    // everyone else, and only hands them to admins who ask for
    // ?kind=client-brief (including unpublished ones, for republish/delete).
    const viewerIsAdmin = await isAdminEmail(decoded.email).catch(() => false);
    const briefs = selectBriefsForViewer(
      snapshot.docs.map((doc) => serializeBriefDoc({ doc, data: doc.data() || {}, clientId, client: bootstrap?.client || null, origin })),
      { isAdmin: viewerIsAdmin, kindFilter }
    )
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
    // Client Brief: pasted breakdown text -> fixed template. Fully separate
    // path; the invoice / pasted-HTML paths below are untouched.
    if (body.kind === CLIENT_BRIEF_KIND) {
      return await handleClientBriefPost({ request, decoded, bootstrap, clientId, body });
    }
    // Only 'invoice' is a recognized alternate kind; anything else
    // (including omitted) is the original pasted-HTML brief path, which
    // runs unchanged below.
    const kind = body.kind === 'invoice' ? 'invoice' : 'brief';

    let html = '';
    let invoiceModel = null;
    let invoiceSections = null;
    let renderInvoiceHtmlFn = null;
    let skippedSections = [];
    let invoicePdfHeightPx = null;
    // Declared here (not inside the first invoice block) because the second
    // `kind === 'invoice'` block below — the render call — reads both.
    let DEFAULT_FROM;
    let resolvePaymentQr;

    if (kind === 'invoice') {
      // Structured-invoice path: build the complete HTML document
      // server-side from features/invoices/* instead of accepting pasted
      // HTML. Dynamic import (not a static top-of-file import) so a
      // missing/broken invoices module can only ever fail kind:'invoice'
      // requests — never the brief path above, which must behave exactly
      // as it does today whether or not that module has landed yet.
      let normalizeInvoice;
      let normalizeInvoiceSectionConfig;
      // DEFAULT_FROM and resolvePaymentQr are dynamic imports for the same
      // reason renderInvoiceDocument's `brand` option is: features/invoices/
      // model.js and render.js are also imported by the PUBLIC Invoice
      // Studio client bundle, so a static top-level import of either the
      // owner's real identity (default-from.js) or the Venmo QR/handle
      // (payment-qr.js) would ship those bytes into that bundle regardless
      // of whether this server-only route ever runs. This route is
      // server-only, so the dynamic import costs nothing but keeps the
      // pattern consistent with the client-side callers.
      try {
        ({ normalizeInvoice } = await import('../../../../features/invoices/model.js'));
        ({ normalizeInvoiceSectionConfig } = await import('../../../../features/invoices/registry.js'));
        ({ renderInvoiceDocument: renderInvoiceHtmlFn } = await import('../../../../features/invoices/render.js'));
        ({ DEFAULT_FROM } = await import('../../../../features/invoices/default-from.js'));
        ({ resolvePaymentQr } = await import('../../../../features/invoices/payment-qr.js'));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invoice module unavailable.';
        return NextResponse.json({ error: `Invoice rendering is not available: ${message}` }, { status: 500 });
      }

      try {
        // defaultFrom explicit here (model.js's own default flipped to "no
        // backfill" — D13 follow-up): the STORED invoiceModel must keep
        // today's behavior of backfilling a blank `from` with the owner's
        // real identity, same as the render call below.
        invoiceModel = normalizeInvoice(body.invoice, { clientId, defaultFrom: DEFAULT_FROM });
        invoiceSections = normalizeInvoiceSectionConfig(body.sections);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid invoice payload.';
        return NextResponse.json({ error: message }, { status: 400 });
      }
    } else {
      html = String(body.html || '').trim();
      if (!html) {
        return NextResponse.json({ error: 'HTML is required.' }, { status: 400 });
      }
      if (!/<html[\s>]/i.test(html) && !/<!doctype html/i.test(html)) {
        return NextResponse.json({ error: 'Submit a complete HTML document.' }, { status: 400 });
      }
      if (Buffer.byteLength(html, 'utf8') > 3 * 1024 * 1024) {
        return NextResponse.json({ error: 'HTML brief is too large. Keep it under 3MB.' }, { status: 413 });
      }
    }

    const title = kind === 'invoice'
      ? String(
          body.title
          || (invoiceModel?.invoiceNumber ? `Invoice ${invoiceModel.invoiceNumber}` : '')
          || invoiceModel?.billTo?.name
          || 'Invoice'
        ).trim().slice(0, 140)
      : String(body.title || extractTitle(html, 'Custom brief')).trim().slice(0, 140);
    const briefSlug = slugify(body.briefSlug || title, kind === 'invoice' ? 'invoice' : 'custom-brief');
    const publicBriefSlug = compactPathSlug(body.publicBriefSlug || body.briefSlug || title, briefSlug);
    const description = String(body.description || '').trim().slice(0, 500);
    const ogLabel = String(body.ogLabel || 'BRYAN BALLI').trim().slice(0, 80) || 'BRYAN BALLI';
    const hideOgSubhead = body.hideOgSubhead === true;
    const ogSubhead = String(body.ogSubhead || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const ogLines = (Array.isArray(body.ogLines) ? body.ogLines : []).map((line) => String(line || '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 2);
    const ogTitleLines = (Array.isArray(body.ogTitleLines) ? body.ogTitleLines : []).map((line) => String(line || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, 3);
    const pdfFileName = titlePdfFileName(title);
    const isPublic = body.public === true;
    const publicClientSlug = publicClientSlugFor(bootstrap?.client || null, clientId, body.publicClientSlug);
    const publicPath = `/briefs/${publicClientSlug}/${publicBriefSlug}`;
    const publicUrl = `${request.nextUrl.origin}${publicPath}`;

    if (kind === 'invoice') {
      // render.js no longer imports brand-marks.js (nor payment-qr.js)
      // itself (Invoice Studio plan D8/D10, and the D13 bundle-inspection
      // follow-up — a public client bundle must never carry the HITLOOP
      // logo/signature or the Venmo QR/handle unless it explicitly asks for
      // them), so the server publish path — which keeps today's
      // HITLOOP-branded, fully-identified look — sources both here and
      // passes them through explicitly.
      const { HITLOOP_BRAND } = await import('../../../../features/invoices/brand-marks.js');
      const paymentQr = resolvePaymentQr(invoiceModel.payment?.qr) || null;
      // Render now that publicPath/publicUrl/pdfPath are known — the
      // invoice document links to its own PDF download route.
      const rendered = renderInvoiceHtmlFn(invoiceModel, {
        sections: invoiceSections,
        clientId,
        publicUrl,
        pdfPath: `${publicPath}/pdf`,
        origin: request.nextUrl.origin,
        brandLabel: ogLabel,
        brand: HITLOOP_BRAND,
        defaultFrom: DEFAULT_FROM,
        paymentQr,
      });
      html = String(rendered.html);
      // Enabled sections that produced nothing (no data yet) — the live
      // preview surfaces these so a sparse page reads as "nothing to show
      // there yet" rather than a broken render.
      skippedSections = Array.isArray(rendered.skippedSections) ? rendered.skippedSections : [];
      // Sizes the PDF page box to the document so an invoice prints as one page.
      invoicePdfHeightPx = Number(rendered.estimatedHeightPx) || null;
      if (Buffer.byteLength(html, 'utf8') > 3 * 1024 * 1024) {
        return NextResponse.json({ error: 'Invoice document is too large. Keep it under 3MB.' }, { status: 413 });
      }
      // Preview: pure render only — no Firestore write, no Storage, no
      // Browserless PDF render/spend. The card's live-preview iframe calls
      // this on every edit, so it must stay a side-effect-free function.
      if (body.preview === true) {
        return NextResponse.json({ ok: true, html, skippedSections });
      }
    }

    const sourceHash = hashHtml(html);
    // Briefs feed the Client Brain by default; invoices must NOT — a pricing
    // document is not brand knowledge, and silently ingesting it would leak
    // rates into every downstream copy consumer of the Brain. Opt-in only.
    const addToClientBrain = kind === 'invoice'
      ? body.addToClientBrain === true
      : body.addToClientBrain !== false;
    const ref = fb.adminDb
      .collection('clients')
      .doc(clientId)
      .collection('custom_briefs')
      .doc(briefSlug);
    const existing = await ref.get();
    const existingData = existing.exists ? existing.data() || {} : {};
    // An invoice/brief publish must never overwrite a client brief that
    // happens to own this doc id (it would turn it into kind 'brief').
    if (existing.exists && isClientBriefData(existingData)) {
      return NextResponse.json({ error: 'That id belongs to a client brief and cannot be overwritten here.' }, { status: 409 });
    }
    const now = fb.FieldValue.serverTimestamp();
    const runId = `custom-brief-${briefSlug}-${Date.now()}`;
    const pdfResult = await persistBriefPdfArtifact({
      clientId,
      runId,
      html,
      fileName: pdfFileName,
      storageClientKey: publicClientSlug,
      storageBriefKey: publicBriefSlug,
      pdfMode: kind === 'invoice' ? 'invoice' : 'edge-to-edge',
      pdfHeightPx: invoicePdfHeightPx,
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
      ogSubhead,
      ogLines,
      ogTitleLines,
      html,
      kind,
      ...(kind === 'invoice' ? { invoice: invoiceModel, sections: invoiceSections } : {}),
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

// Client Brief unpublish / republish. Unpublish also deletes the stored PDF
// (Storage object + artifact fields); republish just flips public back on and
// the PDF re-renders lazily on the next /pdf request.
export async function PATCH(request) {
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
    const briefKey = String(body.briefSlug || body.briefId || body.id || '').trim();
    if (!briefKey || !validCustomBriefKey(briefKey)) {
      return NextResponse.json({ error: 'A valid brief id is required.' }, { status: 400 });
    }
    if (typeof body.public !== 'boolean') {
      return NextResponse.json({ error: 'public must be true or false.' }, { status: 400 });
    }

    // Exact doc id only — never the fuzzy resolver.
    const ref = fb.adminDb.collection('clients').doc(clientId).collection('custom_briefs').doc(briefKey);
    const snapshot = await ref.get();
    if (!snapshot.exists || !isClientBriefData(snapshot.data())) {
      return NextResponse.json({ error: 'Client brief not found.' }, { status: 404 });
    }
    const brief = snapshot.data() || {};
    const now = fb.FieldValue.serverTimestamp();

    let artifacts = { deletedFiles: 0 };
    let warning = null;
    if (body.public === false) {
      // The stored PDF must actually be gone before its pointers are cleared.
      let pdfGone = true;
      const artifact = brief.pdfArtifact || null;
      if (artifact?.storagePath) {
        try {
          const deleted = await deleteStorageObjectStrict({ storagePath: artifact.storagePath, bucketName: artifact.bucket || null });
          pdfGone = deleted > 0;
        } catch {
          pdfGone = false;
        }
      }
      artifacts = await deleteCustomBriefArtifacts({ clientId, briefDocId: snapshot.id, brief });
      if (pdfGone) {
        await ref.set({
          public: false,
          pdfArtifact: fb.FieldValue.delete(),
          pdfUrl: fb.FieldValue.delete(),
          updatedAt: now,
        }, { merge: true });
      } else {
        // Keep pdfArtifact/pdfUrl so the file stays tracked and deletable.
        await ref.set({ public: false, updatedAt: now }, { merge: true });
        warning = { type: 'warning', code: 'client_brief_pdf_delete_failed', message: 'Unpublished, but the stored PDF could not be deleted. It is still tracked on the brief; delete the brief or retry.' };
      }
    } else {
      await ref.set({ public: true, updatedAt: now }, { merge: true });
    }

    const saved = await ref.get();
    return NextResponse.json({
      ok: true,
      clientId,
      brief: serializeBriefDoc({
        doc: saved,
        data: saved.data() || {},
        clientId,
        client: bootstrap?.client || null,
        origin: request.nextUrl.origin,
      }),
      artifacts: { deletedFiles: artifacts.deletedFiles },
      ...(warning ? { warning } : {}),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update client brief.';
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
