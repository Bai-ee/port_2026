// Put a Content Center item's media on a post (calendar editor "Add / change creative").
// Pure + deps-injected so the route stays thin and tests run on fakes.
// deps: { getPackage(id) (per-client getter), pickMedia(pkg) -> media|null,
//         swapPostMedia(postId, media) -> false | { approvalVoided }, rowOf(postId) -> row|null }
// Never throws for expected refusals; returns { ok:false, status, error, code?, packageId? }.

/** What X can publish: mp4 video and jpeg/png/webp/gif stills. .mov / webm are not. */
export const X_PUBLISHABLE_CONTENT_TYPES = Object.freeze(['video/mp4', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const isXPublishableContentType = (t) => X_PUBLISHABLE_CONTENT_TYPES.includes(String(t || '').toLowerCase());

const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });

export async function attachItemMedia(deps, { clientId, postId, packageId } = {}) {
  postId = String(postId || '').trim();
  packageId = String(packageId || '').trim();
  if (!postId || !packageId) return fail(400, 'postId and packageId are required.');

  const pkg = await deps.getPackage(packageId);
  if (!pkg || (pkg.clientId && clientId && pkg.clientId !== clientId)) return fail(404, `No item ${packageId}.`);
  if (pkg.rights === 'never-public') return fail(403, 'This item is marked never-public and cannot be posted.', { code: 'never-public', packageId });

  const media = await deps.pickMedia(pkg);
  if (!media) return fail(409, 'This item has no staged media yet. Stage it first, then use it.', { code: 'needs-staging', packageId });
  if (!isXPublishableContentType(media.mediaContentType)) {
    return fail(422, `X can't publish this format (${media.mediaContentType || 'unknown'}). Use an mp4 video or a jpeg, png, webp or gif image.`, { code: 'unsupported-format', packageId });
  }

  const swapped = await deps.swapPostMedia(postId, media);
  if (!swapped) return fail(409, 'The post changed or can no longer be edited.', { code: 'post-conflict' });

  return { ok: true, approvalVoided: swapped.approvalVoided === true, row: (await deps.rowOf(postId)) || null };
}
