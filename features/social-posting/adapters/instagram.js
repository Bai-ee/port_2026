// instagram.js — Instagram Graph API content publishing (Business/Creator).
// Built behind the platforms.js `live` flag: refuses to run while
// instagram.live === false unless the caller passes { allowNotLive: true }
// (tests / explicit owner dry-run). All HTTP goes through the injected
// fetchImpl; the global fetch is only a production default and is never
// reached by tests. Plan: docs/plans/INSTAGRAM-CHANNEL-STRATEGY.md.
//
// Flow (documented two-step container model):
//   1. POST /{ig-user-id}/media            -> container id (children first for carousels)
//   2. GET  /{container-id}?fields=status_code, polled until FINISHED
//   3. POST /{ig-user-id}/media_publish    -> published media id
//
// Retry philosophy (mirrors X): only a failure that PROVES nothing was
// published is retryable. Steps 1-2 never publish, so transient failures there
// retry. Any failure at step 3 without a definitive Graph rejection is
// AMBIGUOUS (the post may be live) and is never retryable.

import { getPlatformDef } from '../platforms.js';

export const GRAPH_API_VERSION = 'v21.0';
export const GRAPH_HOST = 'https://graph.facebook.com';
export const CAPTION_MAX = 2200;
export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 10;

const DEFAULT_POLL = { maxAttempts: 12, initialDelayMs: 2000, factor: 1.6, maxDelayMs: 15000 };
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function __graphUrl(path) {
  return `${GRAPH_HOST}/${GRAPH_API_VERSION}/${String(path).replace(/^\/+/, '')}`;
}

function fail(message, { status = 500, code, retryable = false, ambiguous = false, stage, graph } = {}) {
  return Object.assign(new Error(message), { status, code, retryable, ambiguous, stage, graph: graph || undefined });
}

// Classify a failure at a given stage. stage: 'container' | 'poll' | 'publish'.
// err is either a thrown network error (no .graphStatus) or a parsed Graph reply.
function classify(stage, { networkError, httpStatus, body }) {
  const g = body?.error || null;
  const message = g?.message || networkError?.message || `Instagram request failed (HTTP ${httpStatus ?? 'n/a'}).`;
  const pre = stage !== 'publish';

  if (g && (g.code === 190 || g.code === 102 || httpStatus === 401)) {
    return fail(`Instagram token invalid or expired: ${message}`, { status: 401, code: 'ig-reconnect-required', stage, graph: g });
  }
  if (g && (g.code === 4 || g.code === 17 || g.code === 32 || g.code === 613 || g.code === 9)) {
    // Rate / publishing-limit. Rejected up front => nothing published, but retrying
    // immediately will not help; let the caller reschedule rather than loop.
    return fail(`Instagram rate or publishing limit: ${message}`, { status: 429, code: 'ig-rate-limited', retryable: false, ambiguous: false, stage, graph: g });
  }
  const transient = !!(g?.is_transient) || networkError || (httpStatus >= 500);
  if (pre) {
    // Nothing can have been published before media_publish.
    return fail(message, { status: transient ? 503 : (httpStatus || 400), code: transient ? 'ig-transient' : 'ig-rejected', retryable: !!transient, stage, graph: g });
  }
  // Publish step: only a definitive 4xx Graph rejection proves "not published".
  if (g && httpStatus >= 400 && httpStatus < 500 && !g.is_transient) {
    return fail(message, { status: httpStatus, code: 'ig-rejected', retryable: false, ambiguous: false, stage, graph: g });
  }
  return fail(`Instagram publish outcome unknown (${message}). Check the account before retrying.`, { status: 502, code: 'ig-publish-ambiguous', retryable: false, ambiguous: true, stage, graph: g });
}

async function graphCall(fetchImpl, stage, { method, path, params = {}, accessToken }) {
  const isGet = method === 'GET';
  const headers = { Authorization: `Bearer ${accessToken}` };
  let url = __graphUrl(path);
  const init = { method, headers };
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (isGet) {
    if (entries.length) url += `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
  }
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (networkError) {
    throw classify(stage, { networkError });
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || body?.error) throw classify(stage, { httpStatus: res.status, body });
  return body || {};
}

function validatePost(post) {
  const { mediaType, mediaUrl, caption = '', children } = post || {};
  if (!['reel', 'image', 'carousel'].includes(mediaType)) {
    throw fail('mediaType must be reel, image or carousel.', { status: 400, code: 'ig-bad-request' });
  }
  if (String(caption).length > CAPTION_MAX) {
    throw fail(`Caption exceeds ${CAPTION_MAX} characters.`, { status: 400, code: 'ig-caption-too-long' });
  }
  if (mediaType === 'carousel') {
    const n = Array.isArray(children) ? children.length : 0;
    if (n < CAROUSEL_MIN || n > CAROUSEL_MAX) {
      throw fail(`A carousel needs ${CAROUSEL_MIN}-${CAROUSEL_MAX} items.`, { status: 400, code: 'ig-bad-request' });
    }
    for (const c of children) {
      if (!c?.mediaUrl || !/^https:\/\//i.test(c.mediaUrl)) throw fail('Every carousel child needs a public https mediaUrl.', { status: 400, code: 'ig-bad-request' });
    }
  } else if (!mediaUrl || !/^https:\/\//i.test(String(mediaUrl))) {
    throw fail('Instagram fetches media itself: mediaUrl must be a public https URL.', { status: 400, code: 'ig-media-url-not-public' });
  }
}

async function waitUntilFinished(fetchImpl, containerId, accessToken, poll, sleep) {
  const o = { ...DEFAULT_POLL, ...(poll || {}) };
  let delay = o.initialDelayMs;
  for (let attempt = 1; attempt <= o.maxAttempts; attempt += 1) {
    const body = await graphCall(fetchImpl, 'poll', { method: 'GET', path: containerId, params: { fields: 'status_code,status' }, accessToken });
    const s = body.status_code;
    if (s === 'FINISHED') return;
    if (s === 'ERROR' || s === 'EXPIRED') {
      // Instagram rejected/never processed the media: not published, not retryable as-is.
      throw fail(`Instagram could not process the media (${s}${body.status ? `: ${body.status}` : ''}).`, { status: 422, code: 'ig-media-processing-failed', stage: 'poll' });
    }
    if (s === 'PUBLISHED') throw fail('Container is already published.', { status: 409, code: 'ig-already-published', ambiguous: true, stage: 'poll' });
    if (attempt < o.maxAttempts) { await sleep(delay); delay = Math.min(Math.round(delay * o.factor), o.maxDelayMs); }
  }
  // Still IN_PROGRESS: nothing published; a later retry with a fresh container is safe.
  throw fail('Instagram media processing did not finish in time.', { status: 504, code: 'ig-poll-timeout', retryable: true, stage: 'poll' });
}

async function createContainer(fetchImpl, igUserId, accessToken, params) {
  const body = await graphCall(fetchImpl, 'container', { method: 'POST', path: `${igUserId}/media`, params, accessToken });
  if (!body.id) throw fail('Instagram returned no container id.', { status: 502, code: 'ig-no-container', retryable: true, stage: 'container' });
  return String(body.id);
}

export async function publish(post, { accessToken, igUserId, fetchImpl, sleep = defaultSleep, poll, allowNotLive = false } = {}) {
  const def = getPlatformDef('instagram');
  if (!def?.live && !allowNotLive) {
    throw fail('Instagram is not live. Publishing is disabled until the owner enables it.', { status: 403, code: 'ig-not-live' });
  }
  if (!accessToken || !igUserId) throw fail('Instagram account is not connected.', { status: 401, code: 'ig-reconnect-required' });
  validatePost(post);
  const doFetch = fetchImpl || globalThis.fetch;
  const caption = post.caption || '';

  let containerId;
  if (post.mediaType === 'carousel') {
    const childIds = [];
    for (const child of post.children) {
      const isVideo = child.mediaType === 'video' || child.mediaType === 'reel';
      const id = await createContainer(doFetch, igUserId, accessToken, {
        is_carousel_item: 'true',
        ...(isVideo ? { media_type: 'VIDEO', video_url: child.mediaUrl } : { image_url: child.mediaUrl }),
      });
      await waitUntilFinished(doFetch, id, accessToken, poll, sleep);
      childIds.push(id);
    }
    containerId = await createContainer(doFetch, igUserId, accessToken, { media_type: 'CAROUSEL', children: childIds.join(','), caption });
  } else if (post.mediaType === 'reel') {
    containerId = await createContainer(doFetch, igUserId, accessToken, { media_type: 'REELS', video_url: post.mediaUrl, cover_url: post.coverUrl, caption });
  } else {
    containerId = await createContainer(doFetch, igUserId, accessToken, { image_url: post.mediaUrl, caption });
  }
  await waitUntilFinished(doFetch, containerId, accessToken, poll, sleep);

  const out = await graphCall(doFetch, 'publish', { method: 'POST', path: `${igUserId}/media_publish`, params: { creation_id: containerId }, accessToken });
  if (!out.id) throw fail('Instagram media_publish returned no media id.', { status: 502, code: 'ig-publish-ambiguous', ambiguous: true, stage: 'publish' });
  return { instagramMediaId: String(out.id), containerId, apiVersion: GRAPH_API_VERSION };
}

// getStatus / disconnect share x.js's contract ({ clientId }) and the generic
// social-accounts store. Imported lazily so this module (and its tests) never
// load firebase unless these two are actually called.
export async function getStatus({ clientId }, { getAccount, toPublic } = {}) {
  if (!getAccount || !toPublic) {
    const mod = await import('../social-accounts.js');
    getAccount = getAccount || mod.getSocialAccount;
    toPublic = toPublic || mod.toPublicAccount;
  }
  return toPublic(await getAccount(clientId, 'instagram'));
}

export async function disconnect({ clientId }, { disconnectAccount } = {}) {
  if (!disconnectAccount) disconnectAccount = (await import('../social-accounts.js')).disconnectSocialAccount;
  return disconnectAccount(clientId, 'instagram');
}
