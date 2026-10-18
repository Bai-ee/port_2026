// media-link.js — a link that opens any library item's or post's video/image (agent get_media_link, MCP strategy_get_media_link).
// Refs: `ev:<path>` = EditVideos bucket (signed, 6.9 days); `publish-staging/…` and other bucket paths = Hitloop bucket
// (permanent token URL); http(s) URLs (Arweave, stored download URLs) pass through. A NAS item not yet copied off the
// drive comes back needsStaging with the run_action that copies it; nothing here writes or queues anything.
//
// deps: { readPackages() -> pkg[], readPost?(id) -> post|null, signRef({bucket:'ev'|'hitloop', path}) -> url|null,
//         readCaptures?() -> [{id,title,kind,url,storagePath?,createdAt?}] (studio / remix renders) }

export const MEDIA_LINK_MAX = 10;
const MEDIA_EXT = /\.(mp4|mov|m4v|webm|jpe?g|png|webp|gif)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const EV_EXPIRES = '6.9 days';

const kindOf = (s) => (VIDEO_EXT.test(s) ? 'video' : 'image');
const safePath = (p) => !!p && !p.startsWith('/') && !p.split('/').includes('..') && MEDIA_EXT.test(p);

/** Where one ref lives: {bucket, path, kind} | {url, kind} | null (pure). */
export function locateRef(ref) {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  if (/^https?:\/\//i.test(r)) return MEDIA_EXT.test(r) || /arweave\.net\//i.test(r) ? { url: r, kind: kindOf(r) } : null;
  const ev = /^ev:(.+)$/.exec(r)?.[1];
  const path = ev || r;
  if (!safePath(path)) return null;
  return { bucket: ev ? 'ev' : 'hitloop', path, kind: kindOf(path) };
}

/** Every ref an item can show, media first: assetRefs, the staged NAS copy, then poster/thumbnail (pure). */
export function refsOf(pkg) {
  const out = [];
  const seen = new Set();
  const add = (ref, role) => {
    const loc = locateRef(ref);
    const key = loc && (loc.url || `${loc.bucket}:${loc.path}`);
    if (!loc || seen.has(key)) return;
    seen.add(key);
    out.push({ role, ref: String(ref), ...loc });
  };
  for (const r of Array.isArray(pkg?.assetRefs) ? pkg.assetRefs : []) add(r, 'media');
  if (pkg?.staged?.storagePath) add(pkg.staged.storagePath, 'media');
  if (pkg?.posterRef) add(pkg.posterRef, 'poster');
  if (pkg?.thumbRef) add(pkg.thumbRef, 'thumbnail');
  return out;
}

const isNas = (pkg) => String(pkg?.id ?? '').startsWith('nas-') || !!pkg?.nas;

async function signAll(refs, signRef) {
  const links = [];
  for (const r of refs) {
    const url = r.url || (await Promise.resolve(signRef({ bucket: r.bucket, path: r.path })).catch(() => null));
    if (!url) continue;
    links.push({ role: r.role, kind: r.kind, url, expires: r.url ? 'stored link' : r.bucket === 'ev' ? EV_EXPIRES : 'permanent' });
  }
  return links;
}

/** Links for one library item. */
export async function itemLinks(pkg, deps) {
  const links = await signAll(refsOf(pkg), deps.signRef);
  const row = { type: 'item', id: pkg.id, title: pkg.title ?? null, format: pkg.format ?? pkg.mediaState ?? null, links };
  if (pkg.durationSec) row.durationSec = pkg.durationSec;
  if (/^https?:\/\//i.test(String(pkg?.source?.url ?? ''))) row.sourceUrl = pkg.source.url;
  const hasMedia = links.some((l) => l.role === 'media');
  if (!hasMedia && !isNas(pkg) && refsOf(pkg).some((r) => r.role === 'media')) row.missing = 'The file is no longer in storage.';
  if (!hasMedia && isNas(pkg)) {
    row.needsStaging = true;
    row.drivePath = pkg.nas?.organizedPath || pkg.nas?.relativePath || null;
    row.stage = pkg.rights === 'never-public'
      ? { refused: 'rights are never-public' }
      : { action: 'nas.stage', args: { id: pkg.id }, note: 'Copies the original off the drive (Mac worker must be online); ask again once done.' };
  }
  return row;
}

/** Links for one post: its own media, then its library item's. */
async function postLinks(post, deps, byId) {
  const refs = [];
  if (post.mediaStoragePath) refs.push({ role: 'media', ref: post.mediaStoragePath, ...(locateRef(post.mediaStoragePath) || {}) });
  const own = refs.filter((r) => r.bucket || r.url);
  let links = await signAll(own, deps.signRef);
  if (!links.length && post.mediaUrl) links = [{ role: 'media', kind: post.mediaType === 'image' ? 'image' : kindOf(post.mediaUrl), url: post.mediaUrl, expires: 'stored link (may have expired)' }];
  const row = { type: 'post', id: post.id, status: post.status ?? null, text: String(post.content ?? '').slice(0, 120), links };
  const pkg = post.packageId ? byId().get(post.packageId) : null;
  if (pkg) row.item = await itemLinks(pkg, deps);
  return row;
}

const tokensOf = (q) => String(q ?? '').toLowerCase().split(/\s+/).filter((t) => t.length > 1).slice(0, 8);
const hayOf = (p) => `${p.id} ${p.title ?? ''} ${p.story ?? ''} ${(p.searchTokens || []).join(' ')} ${(p.entities || []).join(' ')}`.toLowerCase();

/**
 * @param {{itemId?:string, postId?:string, query?:string, kind?:'video'|'image'|'any', limit?:number}} input
 * @returns {Promise<{results:object[], total?:number}|{error:string}>}
 */
export async function getMediaLinks(deps, input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 5, 1), MEDIA_LINK_MAX);
  const want = input.kind === 'image' || input.kind === 'video' ? input.kind : 'any';
  let cache = null;
  const pkgs = async () => (cache ??= (await deps.readPackages()) || []);
  let map = null;
  const byId = () => map;
  const ensureMap = async () => { map ??= new Map((await pkgs()).map((p) => [p.id, p])); };

  if (input.postId) {
    if (typeof deps.readPost !== 'function') return { error: 'posts are not readable here' };
    const post = await deps.readPost(input.postId);
    if (!post) return { error: `unknown post ${input.postId}` };
    await ensureMap();
    return { results: [await postLinks(post, deps, byId)] };
  }
  if (input.itemId) {
    await ensureMap();
    const pkg = map.get(input.itemId);
    if (!pkg) return { error: `unknown item ${input.itemId}` };
    return { results: [await itemLinks(pkg, deps)] };
  }
  const tokens = tokensOf(input.query);
  if (!tokens.length) return { error: 'itemId, postId or query is required' };

  const hits = [];
  for (const p of await pkgs()) {
    const hay = hayOf(p);
    const score = tokens.filter((t) => hay.includes(t)).length;
    if (!score) continue;
    const refs = refsOf(p).filter((r) => r.role === 'media');
    const kinds = new Set(refs.map((r) => r.kind));
    const nasVideo = isNas(p) && !refs.length && (p.mediaType === 'video' || p.format === 'video');
    if (want !== 'any' && !kinds.has(want) && !(want === 'video' && nasVideo) && !(want === 'image' && isNas(p) && !refs.length && !nasVideo)) continue;
    // All words matched first; then items that already have media (a link now beats one that needs staging).
    hits.push({ p, score: score * 10 + (refs.length ? 2 : isNas(p) ? 1 : 0) });
  }
  const captures = typeof deps.readCaptures === 'function' ? ((await deps.readCaptures().catch(() => [])) || []) : [];
  for (const c of captures) {
    if (want !== 'any' && c.kind !== want) continue;
    const score = tokens.filter((t) => `${c.title ?? ''} ${c.id ?? ''}`.toLowerCase().includes(t)).length;
    if (score) hits.push({ capture: c, score: score * 10 + 2 });
  }
  hits.sort((a, b) => b.score - a.score);
  const results = [];
  for (const h of hits.slice(0, limit)) {
    if (h.capture) {
      const c = h.capture;
      const links = c.storagePath ? await signAll([{ role: 'media', ref: c.storagePath, ...(locateRef(c.storagePath) || {}) }].filter((r) => r.bucket), deps.signRef) : [];
      if (!links.length && c.url) links.push({ role: 'media', kind: c.kind, url: c.url, expires: 'stored link (may have expired)' });
      results.push({ type: c.type || 'render', id: c.id, title: c.title ?? null, createdAt: c.createdAt ?? null, links });
    } else {
      results.push(await itemLinks(h.p, deps));
    }
  }
  return { results, total: hits.length };
}
