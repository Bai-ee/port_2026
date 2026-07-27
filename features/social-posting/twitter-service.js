import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { config as loadDotenv } from 'dotenv';
import { TwitterApi } from 'twitter-api-v2';
import { scoreXPost } from '../x-growth/index.js';
import { compactTwitterError, mapTwitterError } from './twitter-errors.js';
import { getAdapter } from './adapters/index.js';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');
const { logUsage } = require('../../api/_lib/usage-logger.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PORTFOLIO_ENV = path.join(REPO_ROOT, '.env.local');
const SOURCE_BOT_ENV = path.resolve(REPO_ROOT, '..', 'agent_master_repo', 'creative-tech-dj-twitter-bot', '.env');

// Social posts live in a top-level Firestore collection (one doc per post)
// rather than a local JSON file — the file is ephemeral on Vercel serverless,
// so scheduled posts written by one invocation were invisible to the cron in
// the next. clientId is a field so per-client reads and the cross-client due
// sweep are both single queries.
const POSTS_COLLECTION = 'social_posts';
function postsCol() {
  return fb.adminDb.collection(POSTS_COLLECTION);
}

let envLoaded = false;
let twitterClient = null;

function stripQuotes(value) {
  if (!value || typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadTwitterEnv() {
  if (envLoaded) return;
  envLoaded = true;

  // Next loads .env.local for API routes, but direct node diagnostics do not.
  // Load the portfolio env first, then fall back to the source bot env.
  loadDotenv({ path: PORTFOLIO_ENV, override: false });

  const credentials = getCredentialValuesFromProcess();
  const hasTwitterEnv = credentials.appKey
    && credentials.appSecret
    && credentials.accessToken
    && credentials.accessSecret;

  if (!hasTwitterEnv) {
    loadDotenv({ path: process.env.TWITTER_BOT_ENV_PATH || SOURCE_BOT_ENV, override: false });
  }
}

function firstEnv(...names) {
  for (const name of names) {
    const value = stripQuotes(process.env[name]);
    if (value) return { name, value };
  }
  return { name: null, value: null };
}

function getCredentialValuesFromProcess() {
  return {
    appKey: firstEnv('TWITTER_API_KEY', 'X_API_KEY').value,
    appSecret: firstEnv('TWITTER_API_SECRET', 'TWITTER_API_KEY_SECRET', 'X_API_SECRET', 'X_API_KEY_SECRET').value,
    accessToken: firstEnv('TWITTER_ACCESS_TOKEN', 'ACCESS_TOKEN', 'X_ACCESS_TOKEN').value,
    accessSecret: firstEnv('TWITTER_ACCESS_SECRET', 'TWITTER_ACCESS_TOKEN_SECRET', 'ACCESS_SECRET', 'X_ACCESS_SECRET', 'X_ACCESS_TOKEN_SECRET').value,
  };
}

function getResolvedTwitterCredentials() {
  loadTwitterEnv();
  const appKey = firstEnv('TWITTER_API_KEY', 'X_API_KEY');
  const appSecret = firstEnv('TWITTER_API_SECRET', 'TWITTER_API_KEY_SECRET', 'X_API_SECRET', 'X_API_KEY_SECRET');
  const accessToken = firstEnv('TWITTER_ACCESS_TOKEN', 'ACCESS_TOKEN', 'X_ACCESS_TOKEN');
  const accessSecret = firstEnv('TWITTER_ACCESS_SECRET', 'TWITTER_ACCESS_TOKEN_SECRET', 'ACCESS_SECRET', 'X_ACCESS_SECRET', 'X_ACCESS_TOKEN_SECRET');
  return { appKey, appSecret, accessToken, accessSecret };
}

function credentialPreview(value) {
  if (!value) return null;
  return `${String(value).slice(0, 6)}...${String(value).slice(-4)}`;
}

export function getTwitterCredentialStatus() {
  const creds = getResolvedTwitterCredentials();
  return {
    hasApiKey: Boolean(creds.appKey.value),
    hasApiSecret: Boolean(creds.appSecret.value),
    hasAccessToken: Boolean(creds.accessToken.value),
    hasAccessSecret: Boolean(creds.accessSecret.value),
    envNames: {
      apiKey: creds.appKey.name,
      apiSecret: creds.appSecret.name,
      accessToken: creds.accessToken.name,
      accessSecret: creds.accessSecret.name,
    },
    previews: {
      apiKey: credentialPreview(creds.appKey.value),
      accessToken: credentialPreview(creds.accessToken.value),
    },
  };
}

function getTwitterClient() {
  const creds = getResolvedTwitterCredentials();
  const appKey = creds.appKey.value;
  const appSecret = creds.appSecret.value;
  const accessToken = creds.accessToken.value;
  const accessSecret = creds.accessSecret.value;

  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    const err = new Error('Twitter credentials are not configured.');
    err.status = 500;
    throw err;
  }

  if (!twitterClient) {
    twitterClient = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
  }
  return twitterClient;
}

async function postViaV1Fallback(text, originalError) {
  try {
    const response = await getTwitterClient().v1.tweet(text);
    // Call counts only, no fabricated dollar rate (see the v2 write below).
    logUsage({ module: 'social-posting', action: 'x-write', provider: 'x-api', model: 'x-write', calls: 1, costUsd: 0, metadata: { apiVersion: 'v1.1', fallback: true } }).catch(() => {});
    return {
      twitterId: response?.id_str || response?.id || null,
      response,
      apiVersion: 'v1.1',
      fallbackFrom: originalError?.data?.reason || null,
    };
  } catch (fallbackError) {
    const mapped = mapTwitterError(fallbackError);
    mapped.message = mapped.message || 'Twitter v1.1 fallback failed.';
    mapped.hint = mapped.hint || 'X rejected both v2 and v1.1 write attempts. Check Project product access and the regenerated token pair.';
    mapped.twitterError = {
      v2: compactTwitterError(originalError),
      v1: compactTwitterError(fallbackError),
    };
    throw mapped;
  }
}

export async function diagnoseTwitterAccess() {
  const credentials = getTwitterCredentialStatus();
  if (!credentials.hasApiKey || !credentials.hasApiSecret || !credentials.hasAccessToken || !credentials.hasAccessSecret) {
    return {
      ok: false,
      credentials,
      readable: false,
      account: null,
      issue: 'missing-credentials',
      message: 'Twitter credentials are not fully configured.',
    };
  }

  try {
    const account = await getTwitterClient().v1.verifyCredentials({ skip_status: true });
    let v2Access = { ok: true, error: null };
    try {
      await getTwitterClient().v2.me();
    } catch (v2Error) {
      v2Access = { ok: false, error: compactTwitterError(v2Error) };
    }

    if (!v2Access.ok) {
      const reason = v2Access.error?.data?.reason || null;
      return {
        ok: false,
        credentials,
        readable: true,
        v2Readable: false,
        account: account ? {
          id: account.id_str || account.id || null,
          username: account.screen_name || null,
          name: account.name || null,
        } : null,
        issue: reason === 'client-not-enrolled' ? 'v2-client-not-enrolled' : 'v2-access-failed',
        message: reason === 'client-not-enrolled'
          ? 'OAuth is valid, but X API v2 rejects this app because its Project is not enrolled for the required API access.'
          : 'OAuth is valid, but X API v2 access failed for this app.',
        twitterError: v2Access.error,
      };
    }

    return {
      ok: true,
      credentials,
      readable: true,
      v2Readable: true,
      account: account ? {
        id: account.id_str || account.id || null,
        username: account.screen_name || null,
        name: account.name || null,
      } : null,
      issue: null,
      message: 'OAuth 1.0a credentials can authenticate as this X account. Posting still requires Read and Write app permissions on the token.',
    };
  } catch (error) {
    return {
      ok: false,
      credentials,
      readable: false,
      account: null,
      issue: error?.code === 401 ? 'invalid-credentials' : 'auth-check-failed',
      message: error?.code === 401
        ? 'Twitter authentication failed. The API key/secret and access token/secret must come from the same X app.'
        : 'Could not verify Twitter credentials.',
      twitterError: compactTwitterError(error),
    };
  }
}

export async function readSocialQueue(clientId) {
  const snap = await postsCol()
    .where('clientId', '==', clientId)
    .orderBy('createdAt', 'desc')
    .get();
  return snap.docs.map((doc) => doc.data());
}

// Read a single post by id, scoped to its owning client. Null if missing/foreign.
export async function getSocialPost(clientId, postId) {
  if (!postId) return null;
  const snap = await postsCol().doc(postId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (clientId && data.clientId !== clientId) return null;
  return data;
}

// Persist a full post doc (id is the Firestore doc id).
async function savePost(post) {
  await postsCol().doc(post.id).set(post);
  return post;
}

// Merge a partial update onto an existing post doc.
async function patchPost(postId, patch) {
  await postsCol().doc(postId).set(patch, { merge: true });
}

// Due posts = scheduled/queued/failed whose time has arrived. The status filter
// runs in memory so the query needs only a scheduledAt range (+ clientId when
// scoped), keeping the index requirements minimal. Null scheduledAt (drafts)
// are a different Firestore type than the ISO-string bound and are excluded.
const DUE_STATUSES = new Set(['scheduled', 'queued', 'failed']);

// A post whose scheduledAt slipped this far into the past is not "a bit late"
// — it's stale history. Without this, the FIRST run of a due-sweep cron would
// flush the entire never-sent backlog to a live account in one go. Marked
// 'expired' (not in DUE_STATUSES) and skipped rather than posted.
// 26h, not 12h: on Vercel Hobby the due-sweep cron can only run ONCE A DAY, so
// a 12h window would silently expire any post scheduled more than 12h before
// that single daily tick — i.e. most of them. The window must exceed the cron
// period. If this project moves to Vercel Pro and the cron goes back to a
// sub-daily schedule (*/30), drop this to 12h.
const STALE_DUE_MS = 26 * 60 * 60 * 1000; // 26h — must stay > the cron period

async function readDuePosts(clientId = null) {
  const nowIso = new Date().toISOString();
  let q = postsCol().where('scheduledAt', '<=', nowIso);
  if (clientId) q = q.where('clientId', '==', clientId);
  const snap = await q.get();

  const due = [];
  const expireWrites = [];
  const now = Date.now();
  const nowStamp = new Date(now).toISOString();
  for (const doc of snap.docs) {
    const post = doc.data();
    if (!DUE_STATUSES.has(post.status)) continue;
    const scheduledMs = Date.parse(post.scheduledAt);
    if (Number.isFinite(scheduledMs) && now - scheduledMs > STALE_DUE_MS) {
      expireWrites.push(patchPost(post.id, {
        status: 'expired',
        error: 'Scheduled time was more than 12h in the past when the due sweep ran — not posted.',
        updatedAt: nowStamp,
      }));
      continue;
    }
    due.push(post);
  }
  if (expireWrites.length) await Promise.all(expireWrites);
  return due;
}

function makeId() {
  return `social_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Extract the optional media pairing off a post payload. A post carries at most
// one attached asset (a rendered Studio video, or an image). mediaUrl is the
// fetchable source used to upload to X at post time; mediaStoragePath/jobId let
// the dashboard trace the asset back to its render job.
function extractMedia(payload = {}) {
  const mediaUrl = payload.mediaUrl ? String(payload.mediaUrl).slice(0, 2000) : null;
  if (!mediaUrl) {
    return {
      mediaUrl: null,
      mediaType: null,
      mediaStoragePath: null,
      mediaContentType: null,
      mediaJobId: null,
      mediaAssetClientId: null,
      mediaMetadata: null,
    };
  }
  const contentType = payload.mediaContentType ? String(payload.mediaContentType).slice(0, 80) : null;
  const inferredType = contentType
    ? (contentType.startsWith('video/') ? 'video' : contentType.startsWith('image/') ? 'image' : null)
    : null;
  return {
    mediaUrl,
    mediaType: payload.mediaType ? String(payload.mediaType).slice(0, 20) : (inferredType || 'video'),
    mediaStoragePath: payload.mediaStoragePath ? String(payload.mediaStoragePath).slice(0, 500) : null,
    mediaContentType: contentType,
    mediaJobId: payload.mediaJobId ? String(payload.mediaJobId).slice(0, 120) : null,
    mediaAssetClientId: payload.mediaAssetClientId ? String(payload.mediaAssetClientId).slice(0, 160) : null,
    mediaMetadata: payload.mediaMetadata && typeof payload.mediaMetadata === 'object'
      ? JSON.parse(JSON.stringify(payload.mediaMetadata))
      : null,
  };
}

export function normalizePostText(content) {
  return String(content || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Strategist-written single promo post via Claude — the same model the Strategy
// Developer uses. Returns one X-ready caption (≤280 chars) promoting the brand's
// site. brand: { name, summary, url, industry }. Falls back to a derived line on
// any failure so the caller always gets usable copy.
export async function generatePromoCopy(brand = {}, { clientBrainContext = '' } = {}) {
  const name = String(brand.name || '').slice(0, 120);
  const summary = String(brand.summary || '').slice(0, 600);
  const url = String(brand.url || '').slice(0, 200);
  const industry = String(brand.industry || '').slice(0, 80);
  const fallback = ((name && summary) ? `${name} — ${summary.slice(0, 120)}` : (name ? `Check out ${name}` : 'Check out our new site'))
    + (url ? `\n\n${url}` : '');
  try {
    const { createAnthropicClient } = require('../not-the-rug-brief/anthropic-client.js');
    const anthropic = createAnthropicClient();
    const prompt = [
      `Write ONE X (Twitter) post promoting this brand's website.`,
      name && `Brand: ${name}`,
      industry && `Industry: ${industry}`,
      summary && `About: ${summary}`,
      clientBrainContext && `\nApproved Client Brain (match this voice/positioning, avoid its do-not-use language):\n${clientBrainContext}`,
      url && `Link to include verbatim at the end: ${url}`,
      ``,
      `Rules: under 240 characters (excluding the link), confident and specific,`,
      `no hashtags, no emojis, no quotation marks around the post, first person or brand voice.`,
      `Return ONLY the post text, nothing else.`,
    ].filter(Boolean).join('\n');
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: 'You are a senior social media strategist. Return only the post text.',
      messages: [{ role: 'user', content: prompt }],
    });
    let text = String(res?.content?.[0]?.text || '').trim().replace(/^["']|["']$/g, '');
    if (!text) return normalizePostText(fallback).slice(0, 280);
    // Guarantee the link is present.
    if (url && !text.includes(url)) text = `${text}\n\n${url}`;
    return normalizePostText(text).slice(0, 280);
  } catch {
    return normalizePostText(fallback).slice(0, 280);
  }
}

// AI Enhance (Copywriter card) — turn one draft into TWO improved options via
// Claude, both spelling/grammar-corrected: `voice` rewrites in the brand's
// established voice (Client Brain), `algo` rewrites to score best on the X
// algorithm. Mirrors generatePromoCopy's client/model. Always returns usable
// text — on any failure both options fall back to the normalized original.
export async function enhancePost(content, { clientBrainContext = '' } = {}) {
  const base = normalizePostText(content).slice(0, 280);
  const fallback = { voice: base, algo: base };
  if (!base) return fallback;
  try {
    const { createAnthropicClient } = require('../not-the-rug-brief/anthropic-client.js');
    const anthropic = createAnthropicClient();
    const prompt = [
      `Rewrite this X (Twitter) post as TWO improved options. First fix ALL spelling and grammar, then produce:`,
      `- "voice": the post rewritten in the brand's established voice below. Preserve the author's meaning and intent. On-brand, natural, ≤280 characters.`,
      `- "algo": the post rewritten to score best on the X algorithm — a strong hook, specific and substantive, invites replies, ≤280 characters. No engagement-bait ("like/RT if", "follow for"), no hashtag stuffing (at most 1, only if natural), no link-only CTA.`,
      ``,
      `Original post:`,
      base,
      ``,
      `Brand voice to match for the "voice" option${clientBrainContext ? '' : ' (none provided — use a clear, confident first-person brand tone)'}:`,
      clientBrainContext || '(none)',
      ``,
      `Rules: both options must be spelling/grammar-correct, ≤280 characters, no surrounding quotation marks, no emojis unless the original used them.`,
      `Return ONLY minified JSON: {"voice":"...","algo":"..."}`,
    ].join('\n');
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: 'You are a senior social media copy editor. Return only valid minified JSON, nothing else.',
      messages: [{ role: 'user', content: prompt }],
    });
    let text = String(res?.content?.[0]?.text || '').trim();
    // Strip ```json fences if present, then isolate the JSON object.
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    const parsed = JSON.parse(text);
    const clean = (v) => normalizePostText(String(v || '').replace(/^["']|["']$/g, '')).slice(0, 280);
    const voice = clean(parsed.voice) || base;
    const algo = clean(parsed.algo) || base;
    return { voice, algo };
  } catch {
    return fallback;
  }
}

export function runPostingAgents(content, context = {}) {
  const base = normalizePostText(content);

  // A reply (carrying a replyTo target, or flagged kind:'reply') is scored and
  // shaped differently from a standalone post: substance over announcement, no
  // hashtags, links penalised harder.
  const isReply = context.kind === 'reply'
    || !!(context.replyTo && (context.replyTo.url || context.replyTo.author));

  // Strip existing hashtags before optimising (re-added from strategy only)
  const withoutTags = base.replace(/\s+#\w+/g, '').trim();

  // Use strategy hashtags when provided; KB terms as secondary source.
  // Never inject generic off-brand fallback tags (#CreativeTech, #AI, etc.).
  const strategyTags = Array.isArray(context.strategyHashtags)
    ? context.strategyHashtags.filter(Boolean)
    : [];
  const kbTerms = Array.isArray(context.knowledgeBaseContext?.chunks)
    ? context.knowledgeBaseContext.chunks.flatMap((chunk) => chunk.matchedTerms || [])
    : [];
  const kbTags = kbTerms
    .filter((term) => /^[a-z0-9][a-z0-9-]{2,18}$/i.test(term))
    .slice(0, 2)
    .map((term) => `#${term.replace(/[^a-z0-9]/gi, '')}`);
  const currentTags = base.match(/#\w+/g) || [];
  // Replies don't carry hashtags — they read as spammy on a reply and add nothing
  // to reply distribution. Keep the reply text clean.
  const tags = isReply
    ? []
    : Array.from(new Set([...currentTags, ...strategyTags, ...kbTags])).slice(0, 3);

  let optimized = withoutTags || base;
  if (optimized.length > 230) optimized = `${optimized.slice(0, 227).trim()}...`;
  if (tags.length && optimized.length + 1 + tags.join(' ').length <= 280) {
    optimized = `${optimized} ${tags.join(' ')}`.trim();
  }

  let xScoring = null;
  try {
    xScoring = scoreXPost(optimized, {
      mediaType: context.mediaType || 'none',
      objective: context.xGrowthObjective,
      kind: isReply ? 'reply' : undefined,
    });
  } catch {
    // Non-fatal — scoring is advisory
  }

  return {
    optimized,
    xScoring,
    agents: {
      contentCreator: {
        status: 'complete',
        note: context.knowledgeBaseContext?.available
          ? `Adapted with Knowledge Base context from ${context.knowledgeBaseContext.sources?.length || 0} source(s).`
          : context.source ? `Adapted from ${context.source}.` : 'Cleaned into a concise X-ready draft.',
      },
      hashtagSpecialist: {
        status: 'complete',
        hashtags: tags,
      },
      engagementOptimizer: {
        status: 'complete',
        note: optimized.length <= 240
          ? 'Kept short enough for replies and quote reposts.'
          : 'Trimmed toward the 280-character limit.',
        ...(xScoring ? {
          xGrowthScore: xScoring.xGrowthScore,
          targetAction: xScoring.targetAction,
          postType: xScoring.postType,
        } : {}),
      },
      knowledgeBaseVerifier: context.knowledgeBaseContext?.available
        ? {
            status: 'complete',
            note: 'Matched the draft against retrieved client-owned context.',
            sources: context.knowledgeBaseContext.sources || [],
          }
        : {
            status: 'skipped',
            note: 'No Knowledge Base context available for this draft.',
          },
      mediaGenerator: {
        status: 'queued',
        note: 'Video/audio generation hooks are reserved for the next build phase.',
      },
    },
  };
}

// X accepts MP4 for video and PNG/JPG/GIF/WEBP for images. WebM (the Studio
// render output) is NOT accepted — it must be transcoded to MP4 first (Phase B).
const X_VIDEO_TYPES = new Set(['video/mp4']);
const X_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);

// Fetch a paired asset and upload it to X, returning a media_id. Uses
// twitter-api-v2's uploadMedia, which performs chunked INIT/APPEND/FINALIZE and
// waits for X-side video processing on its own.
async function uploadPostMedia(media) {
  const mediaUrl = media?.mediaUrl ? String(media.mediaUrl) : null;
  if (!mediaUrl) return null;

  let mimeType = media?.mediaContentType ? String(media.mediaContentType).toLowerCase() : '';
  const isVideoHint = (media?.mediaType === 'video') || mimeType.startsWith('video/');

  // Guard the known format gap: WebM cannot be posted to X.
  if (mimeType === 'video/webm' || (!mimeType && isVideoHint && /\.webm(\?|$)/i.test(mediaUrl))) {
    const err = new Error('Attached video is WebM, which X does not accept. Transcode to MP4 (H.264/AAC) before posting.');
    err.status = 422;
    err.code = 'media-format-unsupported';
    throw err;
  }

  const res = await fetch(mediaUrl);
  if (!res.ok) {
    const err = new Error(`Could not fetch attached media (HTTP ${res.status}).`);
    err.status = 502;
    throw err;
  }
  if (!mimeType) mimeType = String(res.headers.get('content-type') || '').toLowerCase().split(';')[0];
  const buffer = Buffer.from(await res.arrayBuffer());

  const isVideo = X_VIDEO_TYPES.has(mimeType);
  const isImage = X_IMAGE_TYPES.has(mimeType);
  if (!isVideo && !isImage) {
    const err = new Error(`Attached media type "${mimeType || 'unknown'}" is not supported by X.`);
    err.status = 422;
    err.code = 'media-format-unsupported';
    throw err;
  }

  // target: 'tweet' yields a media_id usable in a standard post.
  const mediaId = await getTwitterClient().v1.uploadMedia(buffer, { mimeType, target: 'tweet' });
  return mediaId || null;
}

export async function postToTwitter(content, media = null, { clientId, platform = 'x' } = {}) {
  const text = normalizePostText(content);
  if (!text) {
    const err = new Error('Post content is required.');
    err.status = 400;
    throw err;
  }
  if (text.length > 280) {
    const err = new Error('X posts must be 280 characters or fewer.');
    err.status = 400;
    throw err;
  }

  // A clientId routes through the per-client adapter (its own connected
  // account, per platform). No clientId keeps today's env-credential path
  // below, unchanged, for any caller that hasn't been made client-aware yet.
  if (clientId) {
    return getAdapter(platform).publish({ clientId, text, media });
  }

  // Upload any paired asset first so we can attach its media_id to the tweet.
  let mediaId = null;
  if (media?.mediaUrl) {
    mediaId = await uploadPostMedia(media);
  }

  try {
    // Match the known-working source bot direct-post path: send the v2 Tweet
    // payload object explicitly instead of relying on the string overload.
    const payload = mediaId ? { text, media: { media_ids: [mediaId] } } : { text };
    const response = await getTwitterClient().v2.tweet(payload);
    // Call counts only, no fabricated dollar rate — X spend genuinely isn't
    // knowable from the API (only developer.x.com has it). This just makes
    // the write COUNTED on the Operating Cost card, not priced.
    logUsage({ module: 'social-posting', action: 'x-write', provider: 'x-api', model: 'x-write', calls: 1, costUsd: 0, metadata: { apiVersion: 'v2', mediaAttached: !!mediaId } }).catch(() => {});
    return { twitterId: response?.data?.id || null, response, apiVersion: 'v2', mediaId };
  } catch (error) {
    // v1.1 fallback is text-only; a media post that fails v2 cannot downgrade.
    if (!mediaId && error?.code === 403 && error?.data?.reason === 'client-not-enrolled') {
      return postViaV1Fallback(text, error);
    }
    throw mapTwitterError(error);
  }
}

// Pull the media descriptor off a stored post (null when text-only).
function postMedia(post) {
  if (!post?.mediaUrl) return null;
  return {
    mediaUrl: post.mediaUrl,
    mediaType: post.mediaType || null,
    mediaContentType: post.mediaContentType || null,
  };
}

export async function createSocialPost(clientId, payload) {
  const now = new Date().toISOString();
  const content = normalizePostText(payload.content);
  if (!content) {
    const err = new Error('Post content is required.');
    err.status = 400;
    throw err;
  }
  if (content.length > 280) {
    const err = new Error('X posts must be 280 characters or fewer.');
    err.status = 400;
    throw err;
  }

  const status = payload.status || 'draft';
  const media = extractMedia(payload);
  const post = {
    id: makeId(),
    clientId,
    platform: payload.platform || 'x',
    content,
    source: payload.source || 'manual',
    status,
    scheduledAt: payload.scheduledAt || null,
    // Optional reply context (from the Reply Targets skill): the post this draft
    // replies to. Threaded posting via the X API is a later item — v1 carries the
    // target so the operator can review + reply. null = standalone post.
    replyTo: payload.replyTo && typeof payload.replyTo === 'object'
      ? {
          author: String(payload.replyTo.author || '').slice(0, 120),
          url: String(payload.replyTo.url || '').slice(0, 400),
          text: String(payload.replyTo.text || '').slice(0, 600),
          source: String(payload.replyTo.source || '').slice(0, 40),
        }
      : null,
    twitterId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    postedAt: null,
    agents: payload.agents || null,
    // X growth metadata — stored for future performance correlation.
    xStrategy: payload.xStrategy || null,
    algorithmProfileVersion: payload.algorithmProfileVersion || null,
    performance: null,
    // Optional paired asset (rendered Studio video / image). null = text-only.
    mediaUrl: media.mediaUrl,
    mediaType: media.mediaType,
    mediaStoragePath: media.mediaStoragePath,
    mediaContentType: media.mediaContentType,
    mediaJobId: media.mediaJobId,
  };

  await savePost(post);
  return post;
}

export async function postNow(clientId, payload) {
  const draft = await createSocialPost(clientId, { ...payload, status: 'posting' });
  try {
    const result = await postToTwitter(draft.content, postMedia(draft), { clientId: draft.clientId, platform: draft.platform || 'x' });
    const updated = {
      ...draft,
      status: 'posted',
      twitterId: result.twitterId,
      apiVersion: result.apiVersion || 'v2',
      fallbackFrom: result.fallbackFrom || null,
      postedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await savePost(updated);
    return updated;
  } catch (error) {
    const failed = {
      ...draft,
      status: 'failed',
      error: error.message || 'Failed to post.',
      errorHint: error.hint || null,
      twitterError: error.twitterError || null,
      updatedAt: new Date().toISOString(),
    };
    await savePost(failed);
    throw error;
  }
}

// Publishes a post that already exists (status 'awaiting_approval'), created
// by enqueueAutoPublishVideoPost for approval-mode. Called after the approval
// token's single-use burn already succeeded — this only publishes + records
// the result, it never re-checks the token.
export async function publishApprovedPost(clientId, postId, { source = 'email' } = {}) {
  const post = await getSocialPost(clientId, postId);
  if (!post) {
    const err = new Error('Post not found.');
    err.status = 404;
    throw err;
  }
  if (post.status !== 'awaiting_approval') {
    // Guards the race between the email token and a dashboard action (or a
    // second click of this same route): once a post has left awaiting_approval,
    // publishing it again would double-post to a live account.
    const err = new Error('This post is not awaiting approval — it may have already been handled.');
    err.status = 409;
    err.code = 'not-pending';
    throw err;
  }
  const now = new Date().toISOString();
  try {
    const result = await postToTwitter(post.content, postMedia(post), { clientId, platform: post.platform || 'x' });
    const updated = {
      ...post,
      status: 'posted',
      twitterId: result.twitterId,
      apiVersion: result.apiVersion || 'v2',
      postedAt: now,
      approvedAt: now,
      approvalSource: source,
      error: null,
      updatedAt: now,
    };
    await savePost(updated);
    return updated;
  } catch (error) {
    const failed = {
      ...post,
      status: 'failed',
      error: error.message || 'Failed to post.',
      errorHint: error.hint || null,
      approvedAt: now,
      approvalSource: source,
      updatedAt: now,
    };
    await savePost(failed);
    throw error;
  }
}

// Pending-approval rows that outlived their approval token's TTL. Without this
// sweep the roll-up re-lists every never-approved post forever, minting a fresh
// token for it each day — and by then its EditVideos media URL is usually dead,
// so the click burns a token only to hit media-unavailable. Same treatment
// readDuePosts gives stale scheduled posts: mark 'expired' (not in
// DUE_STATUSES, not awaiting_approval) and drop it from the live set.
//
// Returns only the rows still inside the window, so callers get the sweep and
// the read in one pass.
export async function listPendingApprovalPosts({ maxAgeMs, limit = 200 } = {}) {
  const snap = await postsCol().where('status', '==', 'awaiting_approval').limit(limit).get();
  const now = Date.now();
  const nowStamp = new Date(now).toISOString();
  const live = [];
  const expireWrites = [];
  for (const doc of snap.docs) {
    const post = doc.data();
    const createdMs = Date.parse(post.createdAt);
    if (maxAgeMs && Number.isFinite(createdMs) && now - createdMs > maxAgeMs) {
      expireWrites.push(patchPost(post.id, {
        status: 'expired',
        error: 'Approval window closed before anyone approved or rejected it — not posted.',
        updatedAt: nowStamp,
      }));
      continue;
    }
    live.push(post);
  }
  if (expireWrites.length) await Promise.all(expireWrites);
  return { posts: live, expired: expireWrites.length };
}

// Dashboard-side reject for an 'awaiting_approval' post — the counterpart to
// the emailed approval link's Post button. Not in DUE_STATUSES, so a rejected
// post is never picked up by the due sweep.
export async function rejectSocialPost(clientId, postId) {
  const post = await getSocialPost(clientId, postId);
  if (!post) {
    const err = new Error('Post not found.');
    err.status = 404;
    throw err;
  }
  if (post.status !== 'awaiting_approval') {
    // Same guard as publishApprovedPost — must not be able to flip an already
    // 'posted' row to 'rejected' and hide a tweet that is live on X.
    const err = new Error('This post is not awaiting approval — it may have already been handled.');
    err.status = 409;
    err.code = 'not-pending';
    throw err;
  }
  const now = new Date().toISOString();
  const updated = { ...post, status: 'rejected', rejectedAt: now, updatedAt: now };
  await savePost(updated);
  return updated;
}

export async function schedulePost(clientId, payload) {
  const scheduledAt = payload.scheduledAt ? new Date(payload.scheduledAt) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    const err = new Error('A valid scheduled time is required.');
    err.status = 400;
    throw err;
  }
  return createSocialPost(clientId, {
    ...payload,
    status: scheduledAt.getTime() <= Date.now() ? 'queued' : 'scheduled',
    scheduledAt: scheduledAt.toISOString(),
  });
}

// Pair a rendered asset (Studio video / image) onto an existing post. Used when
// a render finishes after the post draft already exists — e.g. a post is queued
// for a render, the video lands, then gets attached here. Also flips the
// mediaGenerator agent to a completed state for the card UI.
export async function attachMediaToPost(clientId, postId, payload) {
  if (!postId) {
    const err = new Error('postId is required to attach media.');
    err.status = 400;
    throw err;
  }
  const media = extractMedia(payload);
  if (!media.mediaUrl) {
    const err = new Error('A mediaUrl is required to attach media.');
    err.status = 400;
    throw err;
  }
  const post = await getSocialPost(clientId, postId);
  if (!post) {
    const err = new Error('Post not found.');
    err.status = 404;
    throw err;
  }
  const agents = post.agents && typeof post.agents === 'object' ? { ...post.agents } : {};
  agents.mediaGenerator = {
    status: 'complete',
    note: `Attached ${media.mediaType || 'media'} from Mockup Studio.`,
    mediaUrl: media.mediaUrl,
    jobId: media.mediaJobId || null,
  };
  const updated = {
    ...post,
    ...media,
    agents,
    updatedAt: new Date().toISOString(),
  };
  await savePost(updated);
  return updated;
}

// Approval-page remix lifecycle. These mutations are deliberately restricted
// to awaiting_approval posts: a public approval token may prepare a replacement
// asset, but it can never alter a post that is already publishing or live.
export async function markApprovalRemixPending(clientId, postId, pending) {
  const post = await getSocialPost(clientId, postId);
  if (!post) {
    const err = new Error('Post not found.');
    err.status = 404;
    throw err;
  }
  if (post.status !== 'awaiting_approval') {
    const err = new Error('This post is no longer awaiting approval.');
    err.status = 409;
    throw err;
  }
  if (post.remixPending?.jobId && post.remixPending?.status !== 'failed') {
    const err = new Error('A remix is already rendering for this post.');
    err.status = 409;
    err.code = 'remix-pending';
    throw err;
  }
  const remixCount = Number(post.remixCount || 0);
  if (remixCount >= 3) {
    const err = new Error('This approval has reached its three-remix limit.');
    err.status = 429;
    err.code = 'remix-limit';
    throw err;
  }
  const now = new Date().toISOString();
  const updated = {
    ...post,
    remixPending: {
      jobId: String(pending?.jobId || ''),
      assetClientId: String(pending?.assetClientId || ''),
      status: 'rendering',
      queuedAt: now,
    },
    remixCount: remixCount + 1,
    updatedAt: now,
  };
  await savePost(updated);
  return updated;
}

export async function failApprovalRemix(clientId, postId, message) {
  const post = await getSocialPost(clientId, postId);
  if (!post || post.status !== 'awaiting_approval') return post;
  const now = new Date().toISOString();
  const updated = {
    ...post,
    remixPending: post.remixPending
      ? { ...post.remixPending, status: 'failed', error: String(message || 'Remix failed.').slice(0, 300) }
      : null,
    updatedAt: now,
  };
  await savePost(updated);
  return updated;
}

export async function completeApprovalRemix(clientId, postId, payload) {
  const post = await getSocialPost(clientId, postId);
  if (!post) {
    const err = new Error('Post not found.');
    err.status = 404;
    throw err;
  }
  if (post.status !== 'awaiting_approval') {
    const err = new Error('This post is no longer awaiting approval.');
    err.status = 409;
    throw err;
  }
  const media = extractMedia(payload);
  if (!media.mediaUrl) {
    const err = new Error('The completed remix has no video URL.');
    err.status = 500;
    throw err;
  }
  const content = normalizePostText(payload.content || post.content);
  if (!content || content.length > 280) {
    const err = new Error('The replacement post copy is invalid.');
    err.status = 400;
    throw err;
  }
  const now = new Date().toISOString();
  const updated = {
    ...post,
    ...media,
    content,
    remixPending: null,
    updatedAt: now,
  };
  await savePost(updated);
  return updated;
}

// Edit an existing post in place (content and/or schedule) and re-score, scoped
// to the owning client. Used by the Copywriter notepad "update" action so editing
// a saved draft patches the same doc instead of creating a duplicate. Already
// posted/posting rows are locked — editing local text can't un-post them.
export async function updateSocialPost(clientId, postId, payload = {}) {
  if (!postId) {
    const err = new Error('postId is required to update a post.');
    err.status = 400;
    throw err;
  }
  const post = await getSocialPost(clientId, postId);
  if (!post) {
    const err = new Error('Post not found.');
    err.status = 404;
    throw err;
  }
  if (post.status === 'posted' || post.status === 'posting') {
    const err = new Error('This post has already been published and can no longer be edited.');
    err.status = 409;
    throw err;
  }

  const content = normalizePostText(payload.content != null ? payload.content : post.content);
  if (!content) {
    const err = new Error('Post content is required.');
    err.status = 400;
    throw err;
  }
  if (content.length > 280) {
    const err = new Error('X posts must be 280 characters or fewer.');
    err.status = 400;
    throw err;
  }

  // scheduledAt is only touched when the caller explicitly sends the field.
  // '' or null clears the schedule (back to a plain draft); a valid time re-arms
  // it (queued if already due, scheduled otherwise).
  let scheduledAt = post.scheduledAt || null;
  let status = post.status;
  if (Object.prototype.hasOwnProperty.call(payload, 'scheduledAt')) {
    if (!payload.scheduledAt) {
      scheduledAt = null;
      if (status === 'scheduled' || status === 'queued') status = 'draft';
    } else {
      const dt = new Date(payload.scheduledAt);
      if (Number.isNaN(dt.getTime())) {
        const err = new Error('A valid scheduled time is required.');
        err.status = 400;
        throw err;
      }
      scheduledAt = dt.toISOString();
      status = dt.getTime() <= Date.now() ? 'queued' : 'scheduled';
    }
  }

  const updated = {
    ...post,
    content,
    scheduledAt,
    status,
    agents: payload.agents || post.agents || null,
    updatedAt: new Date().toISOString(),
  };
  await savePost(updated);
  return updated;
}

// Post one due row and write the result back. Never throws — the due sweep must
// keep going past a single failure.
async function postAndRecord(post) {
  try {
    const result = await postToTwitter(post.content, postMedia(post), { clientId: post.clientId, platform: post.platform || 'x' });
    const updated = {
      ...post,
      status: 'posted',
      twitterId: result.twitterId,
      postedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
    };
    await savePost(updated);
    return { ok: true, updated };
  } catch (error) {
    const updated = {
      ...post,
      status: 'failed',
      error: error.message || 'Failed to post.',
      updatedAt: new Date().toISOString(),
    };
    await savePost(updated);
    return { ok: false, updated };
  }
}

async function runDueSweep(due) {
  const posted = [];
  const failed = [];
  for (const post of due) {
    const { ok, updated } = await postAndRecord(post);
    (ok ? posted : failed).push(updated);
  }
  return { posted, failed };
}

export async function processDuePosts(clientId) {
  return runDueSweep(await readDuePosts(clientId));
}

export async function processDuePostsForAllClients() {
  return runDueSweep(await readDuePosts(null));
}

// ── X READ — fetch the actual recent posts of specific handles ────────────────
// Uses the X API v2 user-timeline (GET /2/users/:id/tweets) via the same OAuth
// 1.0a client used for posting. This is the most efficient + relevant way to get
// a watchlist account's posts — exact tweets from the exact accounts, with real
// permalinks — and it works in production (no Python/last30days). Read access
// requires a paid X project tier (Basic+); on a read-blocked tier the v2 calls
// throw 403 and we surface that so callers can fall back to web_search.
//
// Returns { ok, items, errors } where each item matches the scout-test/agentData
// item shape: { title, url, summary, tag, handle, author, createdAt, platform }.
export async function fetchHandleTimelines(handles = [], opts = {}) {
  const perHandle = Math.max(1, Math.min(20, Number(opts.perHandle) || 5));
  const excludeRetweets = opts.excludeRetweets !== false; // default: skip RTs
  const clean = (Array.isArray(handles) ? handles : [])
    .map((h) => String(h || '').trim().replace(/^@+/, ''))
    .filter((h) => /^[A-Za-z0-9_]{1,15}$/.test(h)) // valid X usernames only
    .slice(0, 12);

  if (!clean.length) return { ok: false, items: [], errors: ['no valid handles'] };

  let client;
  try {
    client = getTwitterClient();
  } catch (err) {
    return { ok: false, items: [], errors: [err.message || 'no X credentials'] };
  }

  const items = [];
  const errors = [];
  for (const username of clean) {
    try {
      const user = await client.v2.userByUsername(username);
      const userId = user?.data?.id;
      const displayName = user?.data?.name || `@${username}`;
      if (!userId) { errors.push(`${username}: not found`); continue; }

      const timeline = await client.v2.userTimeline(userId, {
        max_results: Math.max(5, perHandle), // API min is 5
        exclude: excludeRetweets ? ['retweets', 'replies'] : [],
        'tweet.fields': 'created_at,public_metrics',
      });
      const tweets = (timeline?.data?.data || timeline?.tweets || []).slice(0, perHandle);
      for (const t of tweets) {
        const text = String(t.text || '').trim();
        if (!text) continue;
        items.push({
          title: displayName,
          url: `https://x.com/${username}/status/${t.id}`,
          summary: text,
          tag: `@${username}`,
          handle: `@${username}`,
          author: displayName,
          createdAt: t.created_at || null,
          metrics: t.public_metrics || null,
          platform: 'x',
        });
      }
    } catch (err) {
      const code = err?.code || err?.status;
      errors.push(`${username}: ${code || ''} ${err?.message || 'read failed'}`.trim());
      // 403 = tier lacks read access → stop early, the rest will 403 too.
      if (code === 403) { errors.push('x-read-forbidden'); break; }
    }
  }

  return { ok: items.length > 0, items, errors };
}

/** Recent-search the public X firehose for a keyword query (posts from the last
 *  7 days) — a genuine keyword search, distinct from fetchHandleTimelines'
 *  per-user timeline reads. ScrapeCreators has no X search endpoint (see
 *  docs/x-content/README.md), so this is the only path for X keyword search.
 *  Paid, tier-gated: X's Free tier has NO access to this endpoint at all —
 *  expect a 403 if the app/account isn't entitled. Read
 *  docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md before calling this
 *  from anywhere new; X API spend is not visible on the Operating Cost card. */
export async function searchXPosts(query, { limit = 10 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, items: [], error: 'no query' };

  let client;
  try {
    client = getTwitterClient();
  } catch (err) {
    return { ok: false, items: [], error: err.message || 'no X credentials' };
  }

  try {
    // X requires max_results in [10, 100] for recent search.
    const paginator = await client.v2.search(q, {
      max_results: Math.max(10, Math.min(100, limit)),
      'tweet.fields': 'created_at,public_metrics,author_id',
      expansions: 'author_id',
      'user.fields': 'username,name',
    });
    const tweets = (paginator.tweets || []).slice(0, limit);
    const items = tweets.map((t) => {
      const author = typeof paginator.includes?.author === 'function' ? paginator.includes.author(t) : null;
      const username = author?.username || '';
      return {
        title: author?.name || (username ? `@${username}` : 'X post'),
        url: username ? `https://x.com/${username}/status/${t.id}` : `https://x.com/i/status/${t.id}`,
        summary: String(t.text || '').trim(),
        tag: username ? `@${username}` : 'x',
        handle: username ? `@${username}` : '',
        author: author?.name || '',
        createdAt: t.created_at || null,
        metrics: t.public_metrics || null,
        platform: 'x',
      };
    });
    return { ok: true, items, error: null };
  } catch (err) {
    const code = err?.code || err?.status;
    // 403 = tier lacks Search entitlement (Free tier has none) — same signal
    // fetchHandleTimelines treats as a hard-stop, not a retry-worthy error.
    const message = code === 403
      ? 'X API 403 — not entitled to the Search endpoint (needs Basic tier or higher).'
      : (err?.message || 'X search failed');
    return { ok: false, items: [], error: message, code };
  }
}
