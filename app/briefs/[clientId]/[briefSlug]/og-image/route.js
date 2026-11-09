import {
  buildBriefOpenGraphMeta,
  resolvePublicBrief,
  validId,
} from '../../../_lib/custom-briefs.js';
import { contentDispositionFileName, renderOgImageJpeg } from '../../../_lib/og-image-render.js';

export const runtime = 'nodejs';

function textResponse(message, status = 404) {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
  });
}

export async function GET(request, context) {
  const params = await Promise.resolve(context?.params || {});
  const clientKey = String(params.clientId || '').trim();
  const briefSlug = String(params.briefSlug || '').trim();

  if (!validId(clientKey) || !validId(briefSlug)) {
    return textResponse('Invalid brief preview URL.', 400);
  }

  const resolved = await resolvePublicBrief(clientKey, briefSlug);
  if (!resolved?.brief) return textResponse('Brief preview not found.', 404);

  const meta = buildBriefOpenGraphMeta({
    origin: new URL(request.url).origin,
    clientId: resolved.clientId,
    client: resolved.client,
    brief: resolved.brief,
    snapshotId: resolved.snapshot.id,
  });

  const jpg = await renderOgImageJpeg(meta);
  const shouldDownload = new URL(request.url).searchParams.get('download') === '1';
  return new Response(jpg, {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(jpg.length),
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      ...(shouldDownload ? { 'content-disposition': contentDispositionFileName(`${meta.title || 'custom-brief'} OG Image`) } : {}),
    },
  });
}
