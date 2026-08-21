import { createRequire } from 'module';
import {
  contentDispositionFileName,
  fb,
  resolvePublicBrief,
  titlePdfFileName,
  validId,
} from '../../../_lib/custom-briefs.js';

const require = createRequire(import.meta.url);
const { persistBriefPdfArtifact } = require('../../../../../api/_lib/browserless.cjs');

function textResponse(message, status = 404) {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
  });
}

async function downloadPdfBuffer(brief) {
  const artifact = brief.pdfArtifact || null;
  if (artifact?.storagePath) {
    const bucket = artifact.bucket
      ? fb.adminStorage.bucket(artifact.bucket)
      : fb.adminStorage.bucket();
    const [buffer] = await bucket.file(artifact.storagePath).download();
    return buffer;
  }

  if (brief.pdfUrl) {
    const response = await fetch(brief.pdfUrl);
    if (!response.ok) throw new Error(`PDF fetch failed with HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  return null;
}

export async function GET(_request, context) {
  const params = await Promise.resolve(context?.params || {});
  const clientKey = String(params.clientId || '').trim();
  const briefSlug = String(params.briefSlug || '').trim();

  if (!validId(clientKey) || !validId(briefSlug)) {
    return textResponse('Invalid brief PDF URL.', 400);
  }

  const resolved = await resolvePublicBrief(clientKey, briefSlug);
  if (!resolved) return textResponse('Brief PDF not found.', 404);

  let buffer = await downloadPdfBuffer(resolved.brief).catch(() => null);

  // On-demand generation (2026-08-21): auto-published daily briefs (the email
  // system's publishBriefDoc path) store HTML but never pre-render a PDF, so
  // this route 404'd for them. First download renders via Browserless and
  // caches the artifact on the brief doc — every later download serves the
  // stored file. resolvePublicBrief already gates on `public: true`, so this
  // never renders a private brief. Two racing first-downloads at worst render
  // twice and both serve identical content — the second doc write wins,
  // harmlessly.
  if (!buffer?.length && resolved.brief.html) {
    const fileNameForPdf = resolved.brief.pdfFileName ||
      titlePdfFileName(resolved.brief.title || resolved.brief.briefSlug || resolved.snapshot.id);
    const pdfResult = await persistBriefPdfArtifact({
      clientId: resolved.clientId,
      runId: `public-pdf-${resolved.snapshot.id}-${Date.now()}`,
      html: resolved.brief.html,
      fileName: fileNameForPdf,
      storageClientKey: resolved.brief.publicClientSlug || resolved.clientId,
      storageBriefKey: resolved.brief.publicBriefSlug || resolved.snapshot.id,
      pdfMode: 'edge-to-edge',
    }).catch(() => null);
    if (pdfResult?.ok && pdfResult.artifactRef) {
      await resolved.snapshot.ref.set({
        pdfArtifact: pdfResult.artifactRef,
        pdfUrl: pdfResult.artifactRef.downloadUrl || '',
        pdfFileName: pdfResult.artifactRef.fileName || fileNameForPdf,
      }, { merge: true }).catch(() => { /* cache write is best-effort; the buffer still serves */ });
      buffer = await downloadPdfBuffer({ pdfArtifact: pdfResult.artifactRef }).catch(() => null);
    }
  }

  if (!buffer?.length) return textResponse('No PDF has been generated for this brief.', 404);

  const fileName = resolved.brief.pdfFileName ||
    resolved.brief.pdfArtifact?.fileName ||
    titlePdfFileName(resolved.brief.title || resolved.brief.briefSlug || resolved.snapshot.id);

  return new Response(buffer, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(buffer.length),
      'content-disposition': contentDispositionFileName(fileName),
      'cache-control': 'private, max-age=0, no-transform',
    },
  });
}
