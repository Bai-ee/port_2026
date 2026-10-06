// Per-item actions behind the Content Engine routes: set-rights, save-thumb,
// create-draft-from-item. All I/O injected (tests use fakes).

import { needsApproval, isApproved } from './schema.js';
import { thumbPathFor, validateThumbDataUrl, makeThumbJpeg, uploadThumb } from './thumbs.js';

export const HUMAN_RIGHTS = ['owned', 'cleared', 'never-public'];
const PLACEHOLDER_STORY = '[add your memory]';
const REUSABLE_DRAFT = new Set(['draft', 'scheduled']);
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

export const isPlaceholderStory = (s) => {
  const t = String(s ?? '').trim();
  return !t || t === PLACEHOLDER_STORY || /^\[[^\]]*\]$/.test(t);
};

/** deps: { getPackage, upsertPackage(pkg), now() } */
export async function setRights(deps, { id, rights }) {
  if (!id) throw bad('id is required.');
  if (!HUMAN_RIGHTS.includes(rights)) throw bad(`rights must be one of ${HUMAN_RIGHTS.join(', ')}.`);
  const existing = await deps.getPackage(id);
  if (!existing) throw bad(`No package ${id}.`, 404);
  const at = new Date(deps.now ? deps.now() : Date.now()).toISOString();
  await deps.upsertPackage({ ...existing, rights, rightsSetBy: 'human', rightsSetAt: at });
  return { ok: true };
}

/** deps: { getPackage, upsertPackage, bucket, sharp? } ; Package must already exist (404 otherwise). */
export async function saveThumb(deps, { clientId, id, dataUrl }) {
  if (!id) throw bad('id is required.');
  const v = validateThumbDataUrl(dataUrl);
  if (!v.ok) throw bad(v.error);
  const existing = await deps.getPackage(id);
  if (!existing) throw bad(`No package ${id}. Run sync-rendered-videos first for rv-* items.`, 404);
  const jpeg = await makeThumbJpeg(v.buffer, { sharp: deps.sharp });
  const thumbRef = thumbPathFor(clientId, id);
  await uploadThumb(deps.bucket, thumbRef, jpeg);
  await deps.upsertPackage({ ...existing, thumbRef });
  return { ok: true, thumbRef };
}

const contentTypeFor = (p) => (/\.mov$/i.test(p) ? 'video/quicktime' : /\.webm$/i.test(p) ? 'video/webm' : /\.(mp4|m4v)$/i.test(p) ? 'video/mp4'
  : /\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : /\.gif$/i.test(p) ? 'image/gif' : 'image/jpeg');

/** Pick the post media from assetRefs. deps.signEvLong(path), deps.hitloopUrl(path). */
async function pickMedia(pkg, deps) {
  for (const ref of pkg.assetRefs || []) {
    const r = String(ref);
    const ev = /^ev:(.+)$/.exec(r)?.[1];
    const path = ev || (r.startsWith('publish-staging/') ? r : null);
    if (!path || path.startsWith('/') || path.split('/').includes('..')) continue;
    if (!/\.(mp4|mov|m4v|webm|jpe?g|png|webp|gif)$/i.test(path)) continue;
    const url = ev ? await deps.signEvLong(path) : await deps.hitloopUrl(path);
    if (!url) throw bad(`Could not resolve media for ${r}.`, 502);
    const ct = contentTypeFor(path);
    return { mediaUrl: url, mediaType: ct.startsWith('video/') ? 'video' : 'image', mediaContentType: ct, mediaStoragePath: r.slice(0, 500) };
  }
  return null;
}

/**
 * Creates (or returns the existing) social_posts DRAFT. Never schedules or posts.
 * deps: { getPackage, findDraft(packageId), createPost(clientId,payload), patchPost(postId,patch), signEvLong, hitloopUrl }
 */
export async function createDraftFromItem(deps, { clientId, id }) {
  if (!id) throw bad('id is required.');
  const pkg = await deps.getPackage(id);
  if (!pkg) throw bad(`No package ${id}.`, 404);

  const prior = await deps.findDraft(id);
  if (prior && REUSABLE_DRAFT.has(prior.status)) return { ok: true, postId: prior.id, existing: true };

  if (pkg.rights !== 'owned' && pkg.rights !== 'cleared') throw bad(`Rights are "${pkg.rights}"; set rights to owned or cleared before drafting.`, 409);
  if (needsApproval(pkg) && !isApproved(pkg)) throw bad('This item needs approval before it can be drafted.', 409);

  let text = !isPlaceholderStory(pkg.story) ? pkg.story : (pkg.variants?.x?.suggestedStory || pkg.title || '');
  text = String(text).trim();
  if (text.length > 280) text = `${text.slice(0, 277).trimEnd()}...`;
  if (!text) throw bad('Item has no text to draft from.');

  const media = await pickMedia(pkg, deps);
  const post = await deps.createPost(clientId, {
    content: text,
    status: 'draft',
    scheduledAt: null,
    source: 'content-engine',
    packageId: pkg.id,
    engine: pkg.engine || null,
    ...(media || {}),
  });
  if (pkg.bucketId) await deps.patchPost(post.id, { bucketId: pkg.bucketId });
  return { ok: true, postId: post.id };
}
