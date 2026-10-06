import { createRequire } from 'node:module';
import { getPlatformClient, getSocialAccount, toPublicAccount, disconnectSocialAccount } from '../social-accounts.js';
import { mapTwitterError } from '../twitter-errors.js';

const require = createRequire(import.meta.url);
const { logUsage } = require('../../../api/_lib/usage-logger.cjs');

// X accepts MP4 for video and PNG/JPG/GIF/WEBP for images. WebM (the Studio
// render output) is NOT accepted — kept identical to the legacy allowlist in
// twitter-service.js's uploadPostMedia.
const X_VIDEO_TYPES = new Set(['video/mp4']);
const X_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);

// One GET doubles as the "is this link still alive" re-probe and the content
// fetch for upload — an EditVideos media URL can die between render and
// publish, and a separate HEAD-then-GET would fetch the (often large) video
// twice for no extra safety.
async function fetchAndValidateMedia(media) {
  const mediaUrl = media?.mediaUrl ? String(media.mediaUrl) : null;
  if (!mediaUrl) return null;

  let mimeType = media?.mediaContentType ? String(media.mediaContentType).toLowerCase() : '';
  const isVideoHint = (media?.mediaType === 'video') || mimeType.startsWith('video/');
  if (mimeType === 'video/webm' || (!mimeType && isVideoHint && /\.webm(\?|$)/i.test(mediaUrl))) {
    throw Object.assign(new Error('Attached video is WebM, which X does not accept. Transcode to MP4 (H.264/AAC) before posting.'), { status: 422, code: 'media-format-unsupported' });
  }

  const res = await fetch(mediaUrl);
  if (!res.ok) {
    throw Object.assign(new Error(`Attached media is no longer available (HTTP ${res.status}).`), { status: 422, code: 'media-unavailable' });
  }
  if (!mimeType) mimeType = String(res.headers.get('content-type') || '').toLowerCase().split(';')[0];
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());

  const isVideo = X_VIDEO_TYPES.has(mimeType);
  const isImage = X_IMAGE_TYPES.has(mimeType);
  if (!isVideo && !isImage) {
    throw Object.assign(new Error(`Attached media type "${mimeType || 'unknown'}" is not supported by X.`), { status: 422, code: 'media-format-unsupported' });
  }
  return { buffer, mimeType, isVideo };
}

async function uploadMedia(client, authMode, file) {
  if (authMode === 'oauth1') {
    return client.v1.uploadMedia(file.buffer, { mimeType: file.mimeType, target: 'tweet' });
  }
  return client.v2.uploadMedia(file.buffer, {
    media_type: file.mimeType,
    media_category: file.isVideo ? 'tweet_video' : 'tweet_image',
  });
}

// Test seam: the X client resolver and media fetcher can be swapped so tests
// never touch the network or X. Production always uses the defaults.
const defaultDeps = { getClient: getPlatformClient, fetchMedia: fetchAndValidateMedia };
let deps = defaultDeps;
export function __setXAdapterDepsForTest(overrides) {
  deps = overrides ? { ...defaultDeps, ...overrides } : defaultDeps;
  return () => { deps = defaultDeps; };
}

// Upload the media (if any) and create one tweet. `inReplyToTweetId` makes it
// a reply. Large MP4s: both uploadMedia paths split into 1 MB chunks and wait
// for X's processing_info to finish before returning the media id.
async function createTweet({ client, authMode, text, media, inReplyToTweetId }) {
  let mediaId = null;
  if (media?.mediaUrl) {
    const file = await deps.fetchMedia(media);
    mediaId = await uploadMedia(client, authMode, file);
  }
  const payload = { text };
  if (mediaId) payload.media = { media_ids: [mediaId] };
  if (inReplyToTweetId) payload.reply = { in_reply_to_tweet_id: String(inReplyToTweetId) };
  const response = await client.v2.tweet(payload);
  // Call counts only, no fabricated dollar rate — X spend genuinely isn't
  // knowable from the API (only developer.x.com has it). This just makes
  // the write COUNTED on the Operating Cost card, not priced.
  logUsage({ module: 'social-posting', action: 'x-write', provider: 'x-api', model: 'x-write', calls: 1, costUsd: 0, metadata: { authMode, apiVersion: 'v2', mediaAttached: !!mediaId, isReply: !!inReplyToTweetId } }).catch(() => {});
  return { twitterId: response?.data?.id || null, response, mediaId };
}

function rethrowMapped(error) {
  // Preserve intentionally mapped local/auth errors; map raw X client errors
  // from credential resolution, media upload, and tweet creation uniformly.
  if (error?.twitterError || error?.code === 'x-reconnect-required') throw error;
  throw mapTwitterError(error);
}

// Post ONLY the self-reply under an existing tweet (used by publish() and by
// the retry path). Never posts the main tweet.
export async function publishReply({ clientId, inReplyToTweetId, text, media }) {
  try {
    if (!inReplyToTweetId) throw Object.assign(new Error('A parent tweet id is required to post a reply.'), { status: 400 });
    const { client, authMode } = await deps.getClient(clientId, 'x');
    const out = await createTweet({ client, authMode, text, media, inReplyToTweetId });
    return { twitterId: out.twitterId, response: out.response, apiVersion: 'v2', mediaId: out.mediaId };
  } catch (error) {
    rethrowMapped(error);
  }
}

// Publish the main tweet, then (when selfReply is set) the reply under it.
// A reply failure does NOT throw: the main tweet is already live, so the
// result carries selfReplyError and the caller records a partial state.
export async function publish({ clientId, text, media, selfReply = null }) {
  let main;
  let client;
  let authMode;
  try {
    ({ client, authMode } = await deps.getClient(clientId, 'x'));
    main = await createTweet({ client, authMode, text, media });
  } catch (error) {
    rethrowMapped(error);
  }
  const result = { twitterId: main.twitterId, response: main.response, apiVersion: 'v2', mediaId: main.mediaId };
  if (!selfReply || (!selfReply.text && !selfReply.mediaUrl)) return result;
  if (!main.twitterId) {
    return { ...result, selfReplyTwitterId: null, selfReplyError: 'Main tweet id missing; self-reply not posted.' };
  }
  try {
    const reply = await createTweet({ client, authMode, text: selfReply.text || '', media: selfReply, inReplyToTweetId: main.twitterId });
    return { ...result, selfReplyTwitterId: reply.twitterId, selfReplyError: null };
  } catch (error) {
    let message = error?.message || 'Self-reply failed.';
    try { rethrowMapped(error); } catch (mapped) { message = mapped?.message || message; }
    return { ...result, selfReplyTwitterId: null, selfReplyError: message };
  }
}

export async function getStatus({ clientId }) {
  const account = await getSocialAccount(clientId, 'x');
  return toPublicAccount(account);
}

export async function disconnect({ clientId }) {
  return disconnectSocialAccount(clientId, 'x');
}
