import {
  contentDispositionFileName,
  fb,
  resolvePublicBrief,
  titlePdfFileName,
  validId,
} from '../../../_lib/custom-briefs.js';

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

  const buffer = await downloadPdfBuffer(resolved.brief).catch(() => null);
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
