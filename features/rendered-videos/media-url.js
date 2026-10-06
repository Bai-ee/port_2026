// Fresh signed URLs for a rendered-video package (backs the 'media-url' route
// action). Pure given an injected `sign(objectPath) -> Promise<string|null>`;
// the route passes the EditVideos bridge's signReadUrl (1h, v4).

const EV_RE = /^ev:(.+)$/;

/** Object path for an `ev:` ref, or null for any other / unsafe ref. */
export function evObjectPath(ref) {
  const m = EV_RE.exec(String(ref ?? ''));
  const p = m?.[1] ?? '';
  if (!p || p.startsWith('/') || p.split('/').includes('..')) return null;
  return p;
}

/** @returns {Promise<{ok:true, videoUrl:string, posterUrl?:string, expiresInSeconds:number}>}
 * Throws {status} errors for a missing/foreign package or an unsignable object. */
export async function resolveMediaUrls(pkg, sign, { expiresInSeconds = 3600 } = {}) {
  if (!pkg) throw Object.assign(new Error('Package not found.'), { status: 404 });
  const videoPath = (pkg.assetRefs || []).map(evObjectPath).find(Boolean);
  if (!videoPath) throw Object.assign(new Error('Package has no EditVideos media (ev:) asset.'), { status: 422 });
  const videoUrl = await sign(videoPath);
  if (!videoUrl) throw Object.assign(new Error('Could not sign the video URL.'), { status: 502 });
  const out = { ok: true, videoUrl, expiresInSeconds };
  const posterPath = evObjectPath(pkg.posterRef);
  if (posterPath) {
    const posterUrl = await sign(posterPath);
    if (posterUrl) out.posterUrl = posterUrl;
  }
  return out;
}
