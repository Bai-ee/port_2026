import {
  buildBriefOpenGraphMeta,
  esc,
  resolvePublicBrief,
  validId,
} from '../../_lib/custom-briefs.js';

function htmlResponse(body, status = 200, cacheControl = 'public, max-age=60, stale-while-revalidate=300') {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': cacheControl,
    },
  });
}

function errorPage(status, message) {
  return htmlResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(message)}</title></head><body><main style="font:14px/1.5 system-ui;padding:24px;"><h1 style="font-size:18px;margin:0 0 8px;">${esc(message)}</h1><p style="margin:0;color:#666;">The requested custom brief is not available.</p></main></body></html>`,
    status,
    'no-store, max-age=0'
  );
}

function managedHeadTags(meta) {
  return [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    `<link rel="canonical" href="${esc(meta.publicUrl)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:url" content="${esc(meta.publicUrl)}">`,
    `<meta property="og:image" content="${esc(meta.imageUrl)}">`,
    `<meta property="og:image:secure_url" content="${esc(meta.imageUrl)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(meta.imageAlt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(meta.title)}">`,
    `<meta name="twitter:description" content="${esc(meta.description)}">`,
    `<meta name="twitter:image" content="${esc(meta.imageUrl)}">`,
    `<meta name="twitter:image:alt" content="${esc(meta.imageAlt)}">`,
  ].join('\n');
}

function stripManagedMetadata(html) {
  return String(html || '')
    .replace(/<title[\s\S]*?<\/title>/i, '')
    .replace(/<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*>/gi, '')
    .replace(/<meta\s+[^>]*(?:name|property)\s*=\s*["'](?:description|og:title|og:description|og:url|og:type|og:image|og:image:secure_url|og:image:width|og:image:height|og:image:alt|twitter:card|twitter:title|twitter:description|twitter:image|twitter:image:alt)["'][^>]*>/gi, '');
}

function injectOpenGraphMetadata(html, meta) {
  const tags = managedHeadTags(meta);
  const body = stripManagedMetadata(html);
  if (/<head[^>]*>/i.test(body)) {
    return body.replace(/<head([^>]*)>/i, `<head$1>\n${tags}\n`);
  }
  if (/<html[^>]*>/i.test(body)) {
    return body.replace(/<html([^>]*)>/i, `<html$1>\n<head>\n${tags}\n</head>\n`);
  }
  return `<!doctype html><html><head>${tags}</head><body>${body}</body></html>`;
}

export async function GET(request, context) {
  const params = await Promise.resolve(context?.params || {});
  const clientKey = String(params.clientId || '').trim();
  const briefSlug = String(params.briefSlug || '').trim();

  if (!validId(clientKey) || !validId(briefSlug)) {
    return errorPage(400, 'Invalid brief URL');
  }

  const resolved = await resolvePublicBrief(clientKey, briefSlug);
  if (!resolved?.brief?.html) {
    return errorPage(404, 'Brief not found');
  }

  const meta = buildBriefOpenGraphMeta({
    origin: request.nextUrl.origin,
    clientId: resolved.clientId,
    client: resolved.client,
    brief: resolved.brief,
    snapshotId: resolved.snapshot.id,
  });

  return htmlResponse(injectOpenGraphMetadata(String(resolved.brief.html), meta));
}
