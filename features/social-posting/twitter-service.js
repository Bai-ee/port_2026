import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { config as loadDotenv } from 'dotenv';
import { TwitterApi } from 'twitter-api-v2';
import { instrumentXClient } from '../x-api-usage/index.js';
import { scoreXPost } from '../x-growth/index.js';
import { compactTwitterError, mapTwitterError } from './twitter-errors.js';
import { getAdapter } from './adapters/index.js';
import { storySyncPlan } from '../discogs-ingest/draft-builder.js';
import { needsApproval } from '../x-content-inventory/schema.js';
import { reserveInTx, releaseReservations } from './reservations.js';
import { toMs, contentHash, LIFECYCLE_VERSION, OPEN_STATUSES, MANUAL_CLAIMABLE_STATUSES, APPROVAL_VOID_STATUSES, isV2, packageClearance, replyBlock, findPackageCollision, isMaterialEdit, deliveryBlock } from './lifecycle.js';
import { assertNoMemoryPlaceholder, hasMemoryPlaceholder, stripBlockingPlaceholders, sanitizeMediaVariants, sanitizeSelfReply, sanitizeSourceRef } from './self-reply.js';
import { sanitizeRepostOf, repostLabel } from './repost.js';
import { postTargets, normalizeTargets, instagramBlockReason, deliverInstagram } from './cross-post.js';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');
const { isPilotClient } = require('../../api/_lib/pilot-access.cjs');
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
    twitterClient = instrumentXClient(new TwitterApi({ appKey, appSecret, accessToken, accessSecret }));
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

export async function readSocialQueue(clientId, { limit = 0 } = {}) {
  let q = postsCol()
    .where('clientId', '==', clientId)
    .orderBy('createdAt', 'desc');
  if (Number.isFinite(limit) && limit > 0) q = q.limit(Math.floor(limit)); // optional bound; default stays unbounded
  const snap = await q.get();
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

// Due posts = scheduled/queued (plus explicitly retryable 'failed') whose time
// has arrived. The status filter runs in memory so the query needs only a
// scheduledAt range (+ clientId when scoped), keeping the index requirements
// minimal. Null scheduledAt (drafts, approved, seeded packages) is a different
// Firestore type than the ISO-string bound and is excluded: nothing without an
// explicit schedule is ever published by the sweep.
//
// Status machine (social_posts):
//   draft -> approved -> scheduled|queued -> posting -> posted
//                                              |-> failed (retry only if retryable && attempts < MAX_ATTEMPTS)
//                                              |-> needs_review (claim went stale; may already be live)
//   scheduled|queued|failed -> expired (>26h late)
const DUE_STATUSES = new Set(['scheduled', 'queued', 'failed']);
const CLAIMABLE_STATUSES = DUE_STATUSES;

export const MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_PER_RUN = 3;
// A 'posting' claim older than this means the sweeper died or timed out mid-publish.
// The tweet may already be live, so it is surfaced for review, never retried.
export const STALE_CLAIM_MS = 15 * 60 * 1000;

// A post whose scheduledAt slipped this far into the past is not "a bit late"
// — it's stale history. Without this, the FIRST run of a due-sweep cron would
// flush the entire never-sent backlog to a live account in one go. Marked
// 'expired' (not in DUE_STATUSES) and skipped rather than posted.
// 26h, not 12h: on Vercel Hobby the due-sweep cron can only run ONCE A DAY, so
// a 12h window would silently expire any post scheduled more than 12h before
// that single daily tick — i.e. most of them. The window must exceed the cron
// period. If this project moves to Vercel Pro and the cron goes back to a
// sub-daily schedule (*/30), drop this to 12h.
const STALE_DUE_MS = 2 * 60 * 60 * 1000; // 2h — must stay well above the 15-minute process-due cron period (Vercel Pro)
const STALE_DUE_HOURS = STALE_DUE_MS / 3600000;

// The request never left this machine — X cannot have accepted the post.
const PRE_SEND_ERROR_RE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i;
// The request may have reached X — the post may already be live.
const AMBIGUOUS_NETWORK_RE = /ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|fetch failed|network|timed out|timeout|abort/i;
// Outcomes where X may already have the post: never auto-retried; lifecycle-v2 rows park as needs_review.
export const AMBIGUOUS_CLASSES = new Set(['server-error-ambiguous', 'network-ambiguous', 'unknown']);

// Is this publish failure worth another automatic attempt? Only failures that
// prove X did not accept the post: 429 (rejected) and pre-send network errors.
// 5xx and mid-request network errors are AMBIGUOUS — X has no idempotency key,
// so a retry can double-post on the live account; those wait for a human.
// 402 (credits), 4xx content/auth errors and anything unrecognised never retry.
export function classifyPublishError(error) {
  const code = Number(error?.code ?? error?.twitterError?.code);
  if (code === 402) return { retryable: false, errorClass: 'credits-depleted' };
  if (code === 429) return { retryable: true, errorClass: 'rate-limited' };
  if (Number.isFinite(code) && code >= 500 && code < 600) return { retryable: false, errorClass: 'server-error-ambiguous' };
  if (Number.isFinite(code) && code >= 400 && code < 500) return { retryable: false, errorClass: 'client-error' };
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  if (PRE_SEND_ERROR_RE.test(text)) return { retryable: true, errorClass: 'network-pre-send' };
  if (AMBIGUOUS_NETWORK_RE.test(text)) return { retryable: false, errorClass: 'network-ambiguous' };
  return { retryable: false, errorClass: 'unknown' };
}

function isRetryableFailure(post) {
  return post.status === 'failed' && post.retryable === true && (Number(post.attempts) || 0) < MAX_ATTEMPTS;
}

// Atomically take ownership of one due post: status scheduled|queued|failed(retryable)
// -> 'posting', stamping claimedAt and attempts+1. Returns the claimed post, or null
// when the doc is gone or no longer claimable (another sweeper got it, already
// posted, edited back to draft, ...). The transaction re-reads the doc, so the
// decision is made on fresh state, never on the sweep's stale snapshot.
export async function claimDuePost(postId, { now = Date.now() } = {}) {
  const ref = postsCol().doc(postId);
  return fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const post = snap.data();
    if (!CLAIMABLE_STATUSES.has(post.status)) return null;
    if (post.status === 'failed' && !isRetryableFailure(post)) return null;
    const scheduledMs = Date.parse(post.scheduledAt);
    if (!Number.isFinite(scheduledMs) || scheduledMs > now) return null;
    const stamp = new Date(now).toISOString();
    const claimed = {
      ...post,
      status: 'posting',
      claimedAt: stamp,
      attempts: (Number(post.attempts) || 0) + 1,
      idempotencyKey: post.id,
      updatedAt: stamp,
    };
    const revision = (post.revision || 0) + 1;
    tx.set(ref, { status: claimed.status, claimedAt: stamp, attempts: claimed.attempts, idempotencyKey: post.id, updatedAt: stamp, revision }, { merge: true });
    return { ...claimed, revision };
  });
}

async function readDuePosts(clientId = null, { now = Date.now() } = {}) {
  const nowIso = new Date(now).toISOString();
  let q = postsCol().where('scheduledAt', '<=', nowIso);
  if (clientId) q = q.where('clientId', '==', clientId);
  const snap = await q.get();

  const due = [];
  const stale = [];
  const expired = [];
  const writes = [];
  const nowStamp = nowIso;
  for (const doc of snap.docs) {
    const post = doc.data();
    if (post.status === 'posting') {
      // Stale claim: report, never auto-retry (the tweet may already be live).
      const claimedMs = Date.parse(post.claimedAt);
      if (Number.isFinite(claimedMs) && now - claimedMs > STALE_CLAIM_MS) {
        const marked = {
          status: 'needs_review',
          error: 'Publish claim went stale (sweeper died or timed out mid-publish). The post may already be live on X — check before re-scheduling. Not retried automatically.',
          updatedAt: nowStamp,
        };
        writes.push(guardedPatch(post.id, { statuses: ['posting'], claimedAt: post.claimedAt || null }, marked)
          .then((ok) => (ok ? releaseHeldSlot(post) : null)));
        stale.push({ ...post, ...marked });
      }
      continue;
    }
    if (!DUE_STATUSES.has(post.status)) continue;
    if (post.status === 'failed' && !isRetryableFailure(post)) continue;
    const scheduledMs = Date.parse(post.scheduledAt);
    if (Number.isFinite(scheduledMs) && now - scheduledMs > STALE_DUE_MS) {
      writes.push(guardedPatch(post.id, { statuses: ['scheduled', 'queued', 'failed'], scheduledAt: post.scheduledAt || null }, {
        status: 'expired',
        error: `Scheduled time was more than ${STALE_DUE_HOURS}h in the past when the due sweep ran — not posted.`,
        updatedAt: nowStamp,
      }).then((ok) => (ok ? releaseHeldSlot(post) : null)));
      expired.push({ id: post.id, clientId: post.clientId, status: 'expired', errorClass: 'missed-window' });
      continue;
    }
    due.push(post);
  }
  // Claimed rows with no scheduledAt (approval-page and post-now publishes) are invisible to the range query above:
  // sweep them by claim age so a crashed publish surfaces as needs_review instead of sitting in 'posting' forever.
  const seen = new Set(snap.docs.map((d) => d.id));
  const posting = await postsCol().where('status', '==', 'posting').get().catch(() => ({ docs: [] }));
  for (const doc of posting.docs) {
    const post = doc.data();
    if (seen.has(post.id) || (clientId && post.clientId !== clientId)) continue;
    const claimedMs = Date.parse(post.claimedAt || post.updatedAt || post.createdAt || '');
    if (Number.isFinite(claimedMs) && now - claimedMs > STALE_CLAIM_MS) {
      const marked = {
        status: 'needs_review',
        error: 'Publish claim went stale (the publish may have died mid-flight). The post may already be live on X: check, then reconcile it. Not retried automatically.',
        updatedAt: nowStamp,
      };
      writes.push(guardedPatch(post.id, { statuses: ['posting'], claimedAt: post.claimedAt || null }, marked));
      stale.push({ ...post, ...marked });
    }
  }
  if (writes.length) await Promise.all(writes);
  due.sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  return { due, stale, expired };
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

// What the operator typed is what posts: line breaks (incl. one blank line between paragraphs), emoji and @handles
// all pass through. Only trailing spaces/tabs on a line are dropped and runs of 3+ newlines are capped at a blank line.
export function normalizePostText(content) {
  return String(content || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
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
export async function enhancePost(content, { clientBrainContext = '', clientId = null } = {}) {
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
    // Spend visibility: this call used to be invisible on the Operating Cost card. Best-effort, never fails Enhance.
    try {
      const { logAnthropicCall } = require('../../api/_lib/usage-logger.cjs');
      await logAnthropicCall({ module: 'social-posting', action: 'enhance-post', model: 'claude-sonnet-4-6', response: res, clientId });
    } catch { /* logging only */ }
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

export async function postToTwitter(content, media = null, { clientId, platform = 'x', selfReply = null, idempotencyKey = null } = {}) {
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
    return getAdapter(platform).publish({ clientId, text, media, selfReply, idempotencyKey });
  }
  if (selfReply) {
    const err = new Error('A self-reply needs a clientId (connected X account).');
    err.status = 400;
    throw err;
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

// Persisted self-reply outcome for a stored post. {} when the post has none, so
// plain posts keep their exact previous shape.
function selfReplyFields(post, result, now) {
  if (!post?.selfReply) return {};
  return {
    selfReplyTwitterId: result.selfReplyTwitterId || null,
    selfReplyPostedAt: result.selfReplyTwitterId ? now : null,
    selfReplyError: result.selfReplyError || null,
  };
}

// Publish a stored post. Never re-posts a main tweet that already has a
// twitterId (reply-only in that case, if a reply is still owed).
async function publishStoredPost(post, now) {
  const platform = post.platform || 'x';
  // A repost never creates a tweet: one retweet call on the target. twitterId
  // = the target id (X mints none), which also makes a second publish a no-op.
  if (post.kind === 'repost') {
    if (post.twitterId) return { twitterId: post.twitterId, apiVersion: post.apiVersion || 'v2' };
    const adapter = getAdapter(platform);
    if (typeof adapter.repost !== 'function') throw Object.assign(new Error(`Reposts are not supported on ${platform}.`), { status: 400 });
    const out = await adapter.repost({ clientId: post.clientId, targetTweetId: post.repostOf?.tweetId });
    return { twitterId: out.twitterId, apiVersion: out.apiVersion || 'v2' };
  }
  if (post.twitterId) {
    const owed = post.selfReply && !post.selfReplyTwitterId;
    const result = { twitterId: post.twitterId, apiVersion: post.apiVersion || 'v2' };
    if (!owed) return { ...result, ...selfReplyFields(post, post, now) };
    try {
      const reply = await getAdapter(platform).publishReply({ clientId: post.clientId, inReplyToTweetId: post.twitterId, text: post.selfReply.text || '', media: post.selfReply });
      return { ...result, selfReplyTwitterId: reply.twitterId, selfReplyError: null };
    } catch (error) {
      return { ...result, selfReplyTwitterId: null, selfReplyError: error.message || 'Self-reply failed.' };
    }
  }
  return postToTwitter(post.content, await freshPostMedia(post), { clientId: post.clientId, platform, selfReply: post.selfReply || null, idempotencyKey: post.id });
}

// Publish-time media: an EditVideos ref (mediaStoragePath 'ev:<path>') is re-signed, because the stored signed URL
// expires (~6.9 days) and drafts are filled up to 31 days ahead. Never written back: approval binds the stored row.
// Any other media (Hitloop download-token URLs, studio renders) is used as stored; a failed re-sign keeps the stored URL.
async function freshPostMedia(post) {
  const media = postMedia(post);
  const ev = /^ev:(.+)$/.exec(String(post?.mediaStoragePath || ''))?.[1];
  if (!media || !ev) return media;
  try {
    const { signMediaRef } = await import('../x-content-inventory/media-signers.js');
    const url = await signMediaRef({ bucket: 'ev', path: ev });
    return url ? { ...media, mediaUrl: url } : media;
  } catch {
    return media;
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

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function cleanStr(value, max) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, max);
}

export async function createSocialPost(clientId, payload) {
  const post = buildSocialPostRecord(clientId, payload, makeId());
  await savePost(post);
  return post;
}

/**
 * Draft-only, create-once. The same `postId` always yields exactly one row: a
 * second call (double-click, retry, concurrent request) returns the existing
 * row instead of writing a duplicate. Used by the Daily Content Loop's Save
 * Draft. Never schedules — status is forced to 'draft', scheduledAt to null.
 */
export async function createDraftPostOnce(clientId, postId, payload) {
  if (!/^social_[A-Za-z0-9_-]{6,120}$/.test(String(postId || ''))) {
    const err = new Error('createDraftPostOnce needs a stable social_* id.');
    err.status = 400;
    throw err;
  }
  const post = buildSocialPostRecord(clientId, { ...payload, status: 'draft', scheduledAt: null }, postId);
  const ref = postsCol().doc(postId);
  try {
    await ref.create(post);
    return { post, existing: false };
  } catch (err) {
    // 6 = ALREADY_EXISTS: someone else won the race; hand back their row.
    if (err?.code !== 6 && !/already exists/i.test(String(err?.message || ''))) throw err;
    const snap = await ref.get();
    return { post: snap.data(), existing: true };
  }
}

/**
 * The shared producer entry point: one durable draft per (client, idempotencyKey). Repeated calls
 * (double click, retry, a second producer with the same key) return the SAME post id. Rows are v2.
 */
export async function ensureDraftPost(clientId, { idempotencyKey, ...payload } = {}) {
  const key = String(idempotencyKey || '').trim();
  if (!clientId || !key) {
    const err = new Error('ensureDraftPost needs a clientId and an idempotencyKey.');
    err.status = 400;
    throw err;
  }
  // A key maps to one open row. If that row has reached a terminal state (posted/failed/expired/rejected), the
  // next generation of the key gets a fresh id, so re-drafting after a post or failure still works.
  for (let gen = 0; gen < 25; gen += 1) {
    const postId = `social_${createHash('sha1').update(`${clientId}|${key}${gen ? `#${gen}` : ''}`).digest('hex').slice(0, 24)}`;
    const res = await createDraftPostOnce(clientId, postId, { ...payload, lifecycleVersion: LIFECYCLE_VERSION, idempotencyKey: key });
    if (!res.existing || OPEN_STATUSES.includes(res.post?.status)) return res;
  }
  throw Object.assign(new Error('Too many prior posts for this idempotency key.'), { status: 409 });
}

/** Client-scoped: the newest still-open row for a package (any open status), or null. */
export async function findOpenPostForPackage(clientId, packageId) {
  if (!clientId || !packageId) return null;
  const snap = await postsCol().where('clientId', '==', clientId).where('packageId', '==', packageId).get();
  const rows = snap.docs.map((d) => d.data()).filter((r) => OPEN_STATUSES.includes(r.status));
  rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return rows[0] || null;
}

async function loadPackageForRules(packageId) {
  if (!packageId) return null;
  const { getPackage } = await import('../x-content-inventory/store.js');
  return getPackage(packageId);
}

// A timely window must still be open now, and the slot must fall inside it.
function assertWindowOpen(expiresAt, scheduledAt) {
  const end = toMs(expiresAt);
  if (!Number.isFinite(end)) return;
  const slot = toMs(scheduledAt);
  if (end <= Date.now() || (Number.isFinite(slot) && slot > end)) {
    throw Object.assign(new Error(`The window for this post closed at ${new Date(end).toISOString()}. Pick an earlier time or drop it.`), { status: 409, code: 'opportunity-expired' });
  }
}

// KNOWN LIMIT: the collision check below is read-then-write, so two truly concurrent schedules of the same
// package can both pass. Sequential producers (the supported case) are blocked; a transaction/slot doc is future work.
// New scheduling action only: a reply must not become a standalone original, cleared material only,
// and one package cannot sit in the queue twice. Runs AFTER the approval gate (assertSchedulable).
async function assertSchedulingRules(post, { clientId, selfId = null, scheduledAt = null }) {
  // New (lifecycle-v2) posts only: legacy reply rows schedule exactly as before. v2 replies stay blocked.
  const reply = isV2(post) ? replyBlock(post) : { ok: true };
  if (!reply.ok) throw Object.assign(new Error(reply.reason), { status: 409, code: reply.code });
  // Timely-window rule is v2-only (legacy flows keep scheduling as before); delivery re-checks it for v2 rows.
  const windowRule = isV2(post);
  if (windowRule) assertWindowOpen(post.expiresAt, scheduledAt);
  if (!post.packageId) return;
  let pkg;
  try {
    pkg = await loadPackageForRules(post.packageId);
  } catch {
    throw Object.assign(new Error('Could not verify clearance for this package. Try again.'), { status: 409, code: 'clearance-unverifiable' });
  }
  const clearance = packageClearance(pkg);
  if (!clearance.ok) throw Object.assign(new Error(clearance.reason), { status: 409, code: clearance.code });
  if (windowRule) assertWindowOpen(pkg?.expiresAt, scheduledAt);
  const snap = await postsCol().where('clientId', '==', clientId).where('packageId', '==', post.packageId).get();
  const dupe = findPackageCollision(snap.docs.map((d) => d.data()), { packageId: post.packageId, selfId });
  if (dupe) {
    throw Object.assign(new Error(`This package is already ${dupe.status} as another post (${dupe.id}). Schedule that one or remove it first.`), { status: 409, code: 'package-already-pending', existingPostId: dupe.id });
  }
}

// Delivery-time recheck for lifecycleVersion-2 rows: park as needs_review instead of publishing.
async function deliveryHold(post) {
  if (!isV2(post)) return null;
  let pkg = null;
  let lookupFailed = false;
  if (post.packageId) {
    try { pkg = await loadPackageForRules(post.packageId); } catch { lookupFailed = true; }
  }
  const block = lookupFailed
    ? { code: 'clearance-unverifiable', reason: 'Could not verify package clearance at delivery time.' }
    : deliveryBlock(post, { pkg, now: Date.now() });
  if (!block) return null;
  const parked = {
    ...post,
    status: 'needs_review',
    error: `Held at delivery: ${block.reason}`,
    errorClass: block.code,
    retryable: false,
    updatedAt: new Date().toISOString(),
  };
  return parked;
}

function buildSocialPostRecord(clientId, payload, id) {
  const now = new Date().toISOString();
  // kind:'repost' rows carry the target tweet; their content is a display label
  // (never sent to X) so every content rule below still applies unchanged.
  const kind = payload.kind === 'repost' ? 'repost' : null;
  const repostOf = kind ? sanitizeRepostOf(payload.repostOf) : null;
  if (kind && !repostOf) {
    const err = new Error('A repost needs the X post URL or id to repost.');
    err.status = 400;
    throw err;
  }
  const content = kind ? repostLabel(repostOf) : normalizePostText(payload.content);
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
  return {
    id,
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
    // Optional first self-reply (text + media), provenance ref and story flag —
    // persisted only; the publish path does not read them.
    selfReply: sanitizeSelfReply(payload.selfReply),
    sourceRef: sanitizeSourceRef(payload.sourceRef),
    mediaVariants: sanitizeMediaVariants(payload.mediaVariants),
    needsStory: payload.needsStory === true,
    // Content-system joins/metadata (all optional). packageId links to an
    // x_content_packages row for the posted write-back and the approval gate.
    packageId: cleanStr(payload.packageId, 160),
    engine: cleanStr(payload.engine, 40),
    campaign: cleanStr(payload.campaign, 120),
    priority: cleanStr(payload.priority, 20),
    needsApproval: payload.needsApproval === true,
    attempts: 0,
    // Repost rows only (legacy rows keep their exact shape).
    ...(kind ? { kind, repostOf } : {}),
    // Additive provenance (only present when the producer supplies it, so legacy rows keep their exact shape).
    // lifecycleVersion 2 opts the row into the stricter edit/delivery rules in ./lifecycle.js.
    ...(payload.lifecycleVersion === LIFECYCLE_VERSION ? { lifecycleVersion: LIFECYCLE_VERSION } : {}),
    ...(cleanStr(payload.idempotencyKey, 200) ? { idempotencyKey: cleanStr(payload.idempotencyKey, 200) } : {}),
    ...(cleanStr(payload.runId, 160) ? { runId: cleanStr(payload.runId, 160) } : {}),
    ...(cleanStr(payload.suggestionId, 160) ? { suggestionId: cleanStr(payload.suggestionId, 160) } : {}),
    ...(Number.isFinite(Number(payload.strategyVersion)) && payload.strategyVersion !== null ? { strategyVersion: Number(payload.strategyVersion) } : {}),
    ...(cleanStr(payload.channel, 40) ? { channel: cleanStr(payload.channel, 40) } : {}),
    ...(cleanStr(payload.expiresAt, 40) ? { expiresAt: cleanStr(payload.expiresAt, 40) } : {}),
    // Calendar batch (features/x-content-inventory/calendar-batch.js): the day this draft is meant to be reviewed for.
    // A plain date, not a schedule: nothing publishes from it.
    ...(/^\d{4}-\d{2}-\d{2}$/.test(String(payload.reviewOn || '')) ? { reviewOn: payload.reviewOn } : {}),
    // Daily fill (features/x-content-inventory/daily-fill.js): what kind of fill this draft is and where it came from.
    ...(FILL_KINDS.includes(payload.fillKind) ? { fillKind: payload.fillKind } : {}),
    ...(sanitizeFillSource(payload.fillSource) ? { fillSource: sanitizeFillSource(payload.fillSource) } : {}),
    // Content Center bucket of the source item (calendar colors). Absent => resolved from the package at read time.
    ...(/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(payload.bucketId || '')) ? { bucketId: payload.bucketId } : {}),
    // NAS archive asset this draft posts (x_content_packages nas.sha256): a link, not an upload. The file is staged from
    // the drive (nas-stage) when the owner schedules it; the publish path does not read this field.
    ...(/^[a-f0-9]{64}$/.test(String(payload.nasSha || '')) ? { nasSha: payload.nasSha } : {}),
  };
}

const FILL_KINDS = ['baseline', 'quote', 'narrative', 'client-work'];
function sanitizeFillSource(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const type = cleanStr(v.type, 40);
  const id = cleanStr(v.id, 200);
  return type && id ? { type, id, asOf: cleanStr(v.asOf, 40) } : null;
}

export async function postNow(clientId, payload) {
  assertNoMemoryPlaceholder(normalizePostText(payload.content));
  assertNoMemoryPlaceholder(payload.selfReply?.text);
  const draft = await createSocialPost(clientId, { ...payload, status: 'posting' });
  try {
    const now = new Date().toISOString();
    const result = await publishStoredPost(draft, now);
    const updated = {
      ...draft,
      status: 'posted',
      twitterId: result.twitterId,
      apiVersion: result.apiVersion || 'v2',
      fallbackFrom: result.fallbackFrom || null,
      postedAt: now,
      updatedAt: now,
      ...selfReplyFields(draft, result, now),
    };
    await savePost(updated);
    await recordPackagePosted(updated, now);
    return updated;
  } catch (error) {
    const failed = {
      ...failedRow(draft, error),
      // Explicitly non-retryable: nothing re-sends a post-now failure; the class is for the operator.
      retryable: false,
      errorHint: error.hint || null,
      twitterError: error.twitterError || null,
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
  assertNoMemoryPlaceholder(post.content);
  assertNoMemoryPlaceholder(post.selfReply?.text);
  const now = new Date().toISOString();
  // Claim before publishing: a double click / token-vs-dashboard race now loses at the transaction instead of
  // double-posting to the live account. Everything below settles against OUR claim.
  const ref = postsCol().doc(postId);
  const claimed = await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : null;
    if (!cur || cur.status !== 'awaiting_approval') {
      throw Object.assign(new Error('This post is not awaiting approval — it may have already been handled.'), { status: 409, code: 'not-pending' });
    }
    const next = { ...cur, status: 'posting', claimedAt: now, updatedAt: now, revision: (cur.revision || 0) + 1 };
    tx.set(ref, next);
    return next;
  });
  // Delivery recheck on the FRESH claimed row (clearance / reply / expiry / approval hash), settled against our claim.
  const heldRow = await deliveryHold(claimed);
  if (heldRow) {
    await settleClaimed(claimed, heldRow);
    throw Object.assign(new Error(heldRow.error), { status: 409, code: heldRow.errorClass });
  }
  try {
    const result = await publishStoredPost({ ...claimed, clientId }, now);
    const updated = {
      ...claimed,
      status: 'posted',
      twitterId: result.twitterId,
      apiVersion: result.apiVersion || 'v2',
      postedAt: now,
      approvedAt: now,
      approvalSource: source,
      error: null,
      updatedAt: now,
      ...selfReplyFields(claimed, result, now),
    };
    await settleClaimed(claimed, updated);
    await recordPackagePosted(updated, now);
    return updated;
  } catch (error) {
    const failed = {
      ...failedRow(claimed, error),
      retryable: false,
      errorHint: error.hint || null,
      approvedAt: now,
      approvalSource: source,
    };
    await settleClaimed(claimed, failed);
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
      expireWrites.push(guardedPatch(post.id, { statuses: ['awaiting_approval'] }, {
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
  // Revision/status-checked: a concurrent claim, edit or reject loses instead of being overwritten.
  return commitPostTransition(clientId, post, updated);
}

// Approval gate for scheduling. A post may be scheduled directly (legacy path)
// UNLESS the post itself (needsApproval flag) or its linked package (client-
// approval-needed rights, or approval.state needed/rejected) requires sign-off —
// then it must be an approved post first (status 'approved', or it carries the
// reviewedAt stamp from approve-draft). A package lookup error fails closed.
async function assertSchedulable(post) {
  const reviewed = post.status === 'approved' || Boolean(post.reviewedAt);
  if (reviewed) return;
  // lifecycleVersion-2 rows: approval is a separate step and always precedes scheduling.
  if (isV2(post)) {
    throw Object.assign(new Error('Approve this draft before scheduling it.'), { status: 409, code: 'approval-required' });
  }
  let needs = post.needsApproval === true;
  if (!needs && post.packageId) {
    const { getPackage } = await import('../x-content-inventory/store.js');
    const pkg = await getPackage(post.packageId);
    needs = Boolean(pkg) && needsApproval(pkg);
  }
  if (needs) {
    const err = new Error('This post needs approval before it can be scheduled. Approve the draft first.');
    err.status = 409;
    err.code = 'approval-required';
    throw err;
  }
}


// A NAS-linked draft (nasSha) carries only a pointer to the file on the drive. Until that file is pulled
// (nas-stage) and attached as mediaUrl it would publish text-only, so scheduling it is refused.
function assertNasMediaAttached(post) {
  if (!post?.nasSha || post.mediaUrl) return;
  throw Object.assign(new Error('Pull this post\'s file from the drive (Stage) before scheduling it; it has no media attached yet.'), { status: 409, code: 'media-not-staged' });
}


// ---- Revision-safe, reservation-aware row transitions -------------------------------------------------
// Every material transition (edit, approve, reject, schedule/reschedule/unschedule, approve-and-schedule) is
// computed from a SNAPSHOT outside the transaction (package lookups etc.) and committed in ONE transaction that
// re-reads the row, refuses if it changed meanwhile (revision/status), reserves/releases the slot and package
// (./reservations.js) and writes the row with revision+1. Nothing restores an old whole document over a newer one.
function conflict(message = 'This post changed while you were working on it. Reload and try again.') {
  return Object.assign(new Error(message), { status: 409, code: 'revision-conflict' });
}

async function planConfigFor(clientId) {
  try {
    const [{ createFirestorePlanStore }, { resolveCalendarEngineConfig }] = await Promise.all([
      import('../x-strategy/plan-store.js'),
      import('../content-context/load-content-context.js'),
    ]);
    const planDoc = await createFirestorePlanStore(fb.adminDb).get(clientId).catch(() => null);
    const legacy = await fb.adminDb.collection('content_system_config').doc('x').get().then((d) => (d.exists ? d.data() : null)).catch(() => null);
    return resolveCalendarEngineConfig({ planDoc, legacyOverrides: legacy });
  } catch {
    return null;
  }
}

const slotted = (p) => p && (p.status === 'scheduled' || p.status === 'queued' || p.status === 'manual') && p.scheduledAt;

/**
 * @param snapshot  the row as read before computing `updated` (null = create a new row)
 * @param opts      { planOverride?: {by, reason}, expectedRevision? }  override only ever arrives from an owner-gated route
 */
async function commitPostTransition(clientId, snapshot, updated, opts = {}) {
  const pilot = isPilotClient(clientId);
  const scheduling = slotted(updated);
  const override = Boolean(opts.planOverride?.reason);
  const config = pilot && scheduling ? await planConfigFor(clientId) : null;
  const rescheduled = scheduling && (snapshot?.scheduledAt || null) !== updated.scheduledAt;
  const next = override && scheduling
    ? { ...updated, planOverride: { by: String(opts.planOverride.by || '').slice(0, 200) || null, at: new Date().toISOString(), reason: String(opts.planOverride.reason).slice(0, 300) } }
    : (rescheduled && updated.planOverride ? { ...updated, planOverride: null } : updated);
  const ref = postsCol().doc(next.id);
  return fb.adminDb.runTransaction(async (tx) => {
    const curSnap = await tx.get(ref);
    if (snapshot) {
      if (!curSnap.exists) throw Object.assign(new Error('Post not found.'), { status: 404 });
      const cur = curSnap.data();
      if ((cur.revision || 0) !== (snapshot.revision || 0) || cur.status !== snapshot.status) throw conflict();
    } else if (curSnap.exists) {
      throw conflict('That post already exists.');
    }
    const cur = curSnap.exists ? curSnap.data() : null;
    let writes = [];
    if (slotted(next) || slotted(snapshot) || next.packageId) {
      ({ writes } = await reserveInTx(fb.adminDb, tx, { clientId, previous: snapshot, next, config, enforcePlan: pilot, override }));
    }
    const final = { ...next, revision: (cur?.revision || 0) + 1 };
    writes.forEach((w) => w());
    tx.set(ref, final);
    return final;
  });
}

// Settle a claimed ('posting') row. A published result is the truth about the outside world, so it is always
// written; any other outcome is written only while OUR claim still holds (a stale-claim sweep or a manual
// reconcile may have moved the row meanwhile).
async function settleClaimed(post, updated) {
  const ref = postsCol().doc(post.id);
  return fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : post;
    const ours = cur.status === 'posting' && cur.claimedAt === post.claimedAt;
    if (!ours && updated.status !== 'posted') return false;
    tx.set(ref, { ...updated, revision: (cur.revision || 0) + 1 });
    return true;
  });
}

// Best-effort: free the ledger slot / package reservation a no-longer-pending row still holds.
function releaseHeldSlot(post) {
  return releaseReservations(fb.adminDb, { clientId: post.clientId, post: { ...post, status: 'scheduled' }, enforcePlan: isPilotClient(post.clientId) }).catch(() => {});
}

// Guarded merge patch used by sweeps (expiry / stale claim): applies only if the row is still in the expected state.
async function guardedPatch(postId, { statuses, scheduledAt, claimedAt }, patch) {
  const ref = postsCol().doc(postId);
  return fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const cur = snap.data();
    if (!statuses.includes(cur.status)) return false;
    if (scheduledAt !== undefined && (cur.scheduledAt || null) !== scheduledAt) return false;
    if (claimedAt !== undefined && (cur.claimedAt || null) !== claimedAt) return false;
    tx.set(ref, { ...patch, revision: (cur.revision || 0) + 1 }, { merge: true });
    return true;
  });
}

// draft -> approved. The memory line never blocks approval: a blocking placeholder ("[add your memory]" /
// "[add your take]") in the text or the self-reply is STRIPPED and needsStory cleared, then the post approves.
// Publishing guards (post-now / schedule / due sweep) still refuse any text that carries a placeholder.
// Idempotent for an already-approved post. Approving never schedules anything.
/** Pure: the post with blocking placeholders removed from content + selfReply and needsStory cleared. */
function stripPlaceholdersFromPost(post) {
  const content = stripBlockingPlaceholders(post.content);
  if (hasMemoryPlaceholder(post.content) && !String(content || '').trim()) {
    throw Object.assign(new Error('Nothing left to post once the placeholder is removed. Write the post first.'), { status: 409, code: 'empty-after-strip' });
  }
  const out = { ...post, content, needsStory: false };
  if (post.selfReply && hasMemoryPlaceholder(post.selfReply.text)) {
    const text = stripBlockingPlaceholders(post.selfReply.text);
    out.selfReply = text.trim() || post.selfReply.mediaUrl ? { ...post.selfReply, text } : null;
  }
  return out;
}

function approveInMemory(post, reviewedBy) {
  if (post.status === 'approved') return post;
  if (post.status !== 'draft') {
    throw Object.assign(new Error(`Only a draft can be approved (this post is ${post.status}).`), { status: 409, code: 'not-draft' });
  }
  post = stripPlaceholdersFromPost(post);
  const now = new Date().toISOString();
  const approved = {
    ...post,
    status: 'approved',
    reviewedAt: now,
    reviewedBy: reviewedBy ? String(reviewedBy).slice(0, 200) : null,
    error: null,
    updatedAt: now,
  };
  // Approval binds exactly what would be published; lifecycle-v2 delivery refuses a row that changed since.
  approved.approvedHash = contentHash(approved);
  return approved;
}

export async function approveDraft(clientId, postId, { reviewedBy = null, expectedRevision = null } = {}) {
  const post = await getSocialPost(clientId, postId);
  if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
  if (expectedRevision != null && (post.revision || 0) !== Number(expectedRevision)) throw conflict();
  if (post.status === 'approved') return post;
  return commitPostTransition(clientId, post, approveInMemory(post, reviewedBy));
}

// approved -> draft (the calendar's "leave unapproved"). Only an approved post with no schedule; a scheduled/queued/posted
// row is refused (unschedule it first). Clears the review stamp and approval hash. Idempotent for a draft.
export async function unapproveDraft(clientId, postId, { expectedRevision = null } = {}) {
  const post = await getSocialPost(clientId, postId);
  if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
  if (post.status === 'draft') return post;
  if (expectedRevision != null && (post.revision || 0) !== Number(expectedRevision)) throw conflict();
  if (post.status !== 'approved' || post.scheduledAt) {
    throw Object.assign(new Error(`Only an approved, unscheduled post can be unapproved (this post is ${post.status}${post.scheduledAt ? ', scheduled' : ''}).`), { status: 409, code: 'not-approved' });
  }
  return commitPostTransition(clientId, post, { ...post, status: 'draft', reviewedAt: null, reviewedBy: null, approvedHash: null, updatedAt: new Date().toISOString() });
}

// draft -> rejected (the calendar's "disapprove"). Only an unpublished draft/needs_review row can be
// rejected here, never a scheduled/posted row, so a live tweet can't be hidden. The doc is kept.
export async function rejectDraft(clientId, postId, { reviewedBy = null, expectedRevision = null } = {}) {
  const post = await getSocialPost(clientId, postId);
  if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
  if (post.status === 'rejected') return post;
  if (expectedRevision != null && (post.revision || 0) !== Number(expectedRevision)) throw conflict();
  const rejectable = post.status === 'draft' || post.status === 'needs_review' || (post.status === 'approved' && !post.scheduledAt);
  if (!rejectable) {
    throw Object.assign(new Error(`Only an unscheduled draft can be rejected (this post is ${post.status}).`), { status: 409, code: 'not-draft' });
  }
  const now = new Date().toISOString();
  return commitPostTransition(clientId, post, { ...post, status: 'rejected', rejectedAt: now, reviewedBy: reviewedBy ? String(reviewedBy).slice(0, 200) : null, updatedAt: now });
}

// The calendar's Approve: (optional text edit) -> approved -> scheduled at the time the reviewer saw, as ONE atomic
// transition: computed in memory from a snapshot, committed in a single transaction that refuses if the row changed
// (revision) and reserves the slot/package. Nothing is written until everything passes, so there is nothing to
// restore. A repeated identical request returns the existing result. A scheduled post is published by the sweeper:
// this IS the go-live decision, so it is only ever called from an explicit operator click.
export async function approveAndSchedule(clientId, postId, { scheduledAt, content, reviewedBy = null, expectedRevision = null, planOverride = null } = {}) {
  const when = scheduledAt ? new Date(scheduledAt) : null;
  if (!when || Number.isNaN(when.getTime())) {
    throw Object.assign(new Error('A valid scheduled time is required.'), { status: 400 });
  }
  if (when.getTime() < Date.now() + 60_000) {
    throw Object.assign(new Error('Pick a time at least a minute in the future.'), { status: 400, code: 'past-time' });
  }
  const iso = when.toISOString();
  const snapshot = await getSocialPost(clientId, postId);
  if (!snapshot) throw Object.assign(new Error('Post not found.'), { status: 404 });
  if (expectedRevision != null && (snapshot.revision || 0) !== Number(expectedRevision)) throw conflict();
  const sameText = typeof content !== 'string' || normalizePostText(content) === snapshot.content;
  if ((snapshot.status === 'scheduled' || snapshot.status === 'queued') && snapshot.scheduledAt === iso && sameText && snapshot.reviewedAt) {
    return snapshot; // repeated request: same result, no second transition
  }
  let working = snapshot;
  if (!sameText) working = (await prepareUpdate(clientId, working, { content })).updated;
  if (!((working.status === 'scheduled' || working.status === 'queued') && working.reviewedAt)) {
    working = approveInMemory(working, reviewedBy);
  }
  const { updated } = await prepareUpdate(clientId, working, { content: working.content, scheduledAt: iso });
  return commitPostTransition(clientId, snapshot, updated, { planOverride });
}

/**
 * Trusted scheduling (agent, owner opt-in): schedule a post the OWNER already approved, unchanged since that approval.
 * Never approves anything and never posts now. Refuses unless ALL hold:
 *   - settings.enabled (client_configs.agentAutonomy.trustedSchedule, read by the caller) is true
 *   - lifecycle v2 row, status 'approved', not scheduled, reviewed by a person, approvedHash === contentHash (unchanged)
 *   - scheduledAt >= now + settings.minLeadMinutes (the owner's window to cancel)
 *   - fewer than settings.dailyCap trusted schedules made for this client today (UTC day)
 * Slot / plan / collision rules apply exactly as for any schedule (prepareUpdate + commitPostTransition).
 */
export async function trustedSchedulePost(clientId, postId, { scheduledAt, expectedRevision = null, settings = {}, by = 'agent', now = Date.now() } = {}) {
  const refuse = (message, code) => { throw Object.assign(new Error(message), { status: 409, code }); };
  if (settings?.enabled !== true) refuse('Trusted scheduling is off for this client. Ask the owner to turn it on in Agent permissions, or send a confirm card.', 'trusted-off');
  const when = scheduledAt ? new Date(scheduledAt) : null;
  if (!when || Number.isNaN(when.getTime())) throw Object.assign(new Error('A valid scheduled time is required.'), { status: 400 });
  const lead = Math.max(10, Number(settings.minLeadMinutes) || 10);
  if (when.getTime() < now + lead * 60_000) refuse(`Pick a time at least ${lead} minutes ahead (the owner's window to cancel).`, 'trusted-lead');
  const post = await getSocialPost(clientId, postId);
  if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
  if (expectedRevision != null && (post.revision || 0) !== Number(expectedRevision)) throw conflict();
  if (!isV2(post)) refuse('Only lifecycle-v2 posts can be trusted-scheduled (their approval is bound to the copy).', 'trusted-legacy');
  if (post.status !== 'approved' || post.scheduledAt) refuse(`Only an approved, unscheduled post can be trusted-scheduled (this one is ${post.status}${post.scheduledAt ? ', scheduled' : ''}).`, 'trusted-not-approved');
  if (!post.reviewedAt || !post.reviewedBy || /agent|mcp/i.test(String(post.reviewedBy))) refuse('This post was not approved by the owner.', 'trusted-not-owner');
  if (!post.approvedHash || post.approvedHash !== contentHash(post)) refuse('The post changed after it was approved; the owner has to approve it again.', 'trusted-stale');
  const cap = Math.max(1, Number(settings.dailyCap) || 3);
  const day = new Date(now).toISOString().slice(0, 10);
  const today = (await readSocialQueue(clientId)).filter((p) => String(p?.trustedSchedule?.at || '').slice(0, 10) === day).length;
  if (today >= cap) refuse(`The daily limit of ${cap} agent-scheduled post(s) is reached.`, 'trusted-cap');
  const { updated } = await prepareUpdate(clientId, post, { content: post.content, scheduledAt: when.toISOString() });
  if (updated.status !== 'scheduled' || updated.approvedHash !== post.approvedHash) refuse('Scheduling would have changed the approved post; nothing was scheduled.', 'trusted-mismatch');
  const at = new Date(now).toISOString();
  return commitPostTransition(clientId, post, { ...updated, trustedSchedule: { at, by: String(by || 'agent').slice(0, 200), leadMinutes: lead } });
}

export async function schedulePost(clientId, payload, opts = {}) {
  assertNoMemoryPlaceholder(normalizePostText(payload.content));
  assertNoMemoryPlaceholder(payload.selfReply?.text);
  const scheduledAt = payload.scheduledAt ? new Date(payload.scheduledAt) : null;
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    const err = new Error('A valid scheduled time is required.');
    err.status = 400;
    throw err;
  }
  await assertSchedulable({ ...payload, status: 'draft' });
  assertNasMediaAttached(payload);
  await assertSchedulingRules({ ...payload, status: 'draft', ...(isPilotClient(clientId) ? { lifecycleVersion: LIFECYCLE_VERSION } : {}) }, { clientId, scheduledAt: scheduledAt.toISOString() });
  const record = buildSocialPostRecord(clientId, {
    ...payload,
    status: scheduledAt.getTime() <= Date.now() ? 'queued' : 'scheduled',
    scheduledAt: scheduledAt.toISOString(),
  }, makeId());
  // Pilot clients: every NEW scheduled post goes through the full lifecycle (v2 protections, plan enforcement in
  // the commit below). Scheduling is the operator's explicit approval for this exact copy, so the row is stamped
  // reviewed and bound to its content hash. Reply posts stay blocked above (assertSchedulingRules, v2 rule).
  if (isPilotClient(clientId) && record.lifecycleVersion !== LIFECYCLE_VERSION) {
    const now = new Date().toISOString();
    Object.assign(record, { lifecycleVersion: LIFECYCLE_VERSION, reviewedAt: now, reviewedBy: opts.by ? String(opts.by).slice(0, 200) : 'owner-schedule' });
    record.approvedHash = contentHash(record);
  }
  return commitPostTransition(clientId, null, record, { planOverride: opts.planOverride });
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
  if (isV2(post) && (post.status === 'posted' || post.status === 'posting')) {
    throw Object.assign(new Error('This post has already been published; media can no longer be changed.'), { status: 409 });
  }
  if (post.status === 'manual') {
    throw Object.assign(new Error('This post is being posted manually; release it before changing its media.'), { status: 409, code: 'manual-claimed' });
  }
  const updated = {
    ...post,
    ...media,
    agents,
    updatedAt: new Date().toISOString(),
  };
  // Media is part of what approval binds: on a lifecycle-v2 row it voids approval and the schedule like a text edit.
  if (isV2(post) && APPROVAL_VOID_STATUSES.includes(post.status) && isMaterialEdit(post, updated)) {
    Object.assign(updated, { status: 'draft', scheduledAt: null, reviewedAt: null, reviewedBy: null, approvedHash: null });
  }
  return commitPostTransition(clientId, post, updated);
}

/**
 * System media swap (high-res original, staged-original completion, Telegram, Discogs re-ingest): merges a media
 * patch through the shared lifecycle, so on a v2 row a changed media voids approval + schedule (and frees the slot)
 * exactly like attachMediaToPost, instead of leaving a "scheduled" row that delivery later parks as approval-stale.
 * Returns false when the row is gone, foreign, not in `statuses`, or changed concurrently; else { approvalVoided }.
 */
export async function swapPostMedia(clientId, postId, patch, { statuses = null } = {}) {
  if (!clientId || !postId) return false;
  const post = await getSocialPost(clientId, postId);
  if (!post || post.clientId !== clientId) return false;
  if (statuses ? !statuses.includes(post.status) : (post.status === 'posted' || post.status === 'posting' || post.status === 'manual')) return false;
  const updated = { ...post, ...patch, updatedAt: new Date().toISOString() };
  let approvalVoided = false;
  if (isV2(post) && APPROVAL_VOID_STATUSES.includes(post.status) && isMaterialEdit(post, updated)) {
    Object.assign(updated, { status: 'draft', scheduledAt: null, reviewedAt: null, reviewedBy: null, approvedHash: null });
    approvalVoided = true;
  }
  try {
    await commitPostTransition(clientId, post, updated);
  } catch (err) {
    if (err?.status === 409) return false;
    throw err;
  }
  return { approvalVoided };
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
  // Revision/status-checked: a concurrent claim, edit or reject loses instead of being overwritten.
  return commitPostTransition(clientId, post, updated);
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
  // Revision/status-checked: a concurrent claim, edit or reject loses instead of being overwritten.
  return commitPostTransition(clientId, post, updated);
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
  // Revision/status-checked: a concurrent claim, edit or reject loses instead of being overwritten.
  return commitPostTransition(clientId, post, updated);
}

// Edit an existing post in place (content and/or schedule) and re-score, scoped
// to the owning client. Used by the Copywriter notepad "update" action so editing
// a saved draft patches the same doc instead of creating a duplicate. Already
// posted/posting rows are locked — editing local text can't un-post them.
export async function updateSocialPost(clientId, postId, payload = {}, opts = {}) {
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
  const expected = opts.expectedRevision ?? payload.expectedRevision;
  if (expected != null && (post.revision || 0) !== Number(expected)) throw conflict();
  const { updated } = await prepareUpdate(clientId, post, payload);
  const saved = await commitPostTransition(clientId, post, updated, { planOverride: opts.planOverride });
  await syncDiscogsStory(post, saved.content);
  return saved;
}

// Pure-ish: validates and computes the next row from a snapshot (async only for package lookups). Writes nothing.
async function prepareUpdate(clientId, post, payload = {}) {
  if (post.status === 'posted' || post.status === 'posting') {
    const err = new Error('This post has already been published and can no longer be edited.');
    err.status = 409;
    throw err;
  }
  // The owner is posting this one by hand: the copy they were handed is the copy. Release the claim to edit it.
  if (post.status === 'manual') {
    throw Object.assign(new Error('This post is being posted manually. Release it back to HITLOOP before editing.'), { status: 409, code: 'manual-claimed' });
  }
  // A held row may already be live on X: it needs an explicit reconcile before it can be edited back into the queue.
  if (post.status === 'needs_review' && payload.scheduledAt) {
    throw Object.assign(new Error('This post was held for review (it may already be live on X). Reconcile it first.'), { status: 409, code: 'needs-review-reconcile' });
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
  // Editing the text of an approved-but-unscheduled draft voids the approval.
  const contentChanged = content !== post.content;
  let reviewedAt = post.reviewedAt || null;
  let reviewedBy = post.reviewedBy || null;
  let approvalVoided = false;
  let voidHash = false;
  if (contentChanged && post.status === 'approved') {
    status = 'draft';
    reviewedAt = null;
    reviewedBy = null;
    voidHash = true;
  }
  // lifecycleVersion-2 rows: ANY material edit (text, self-reply, media, reply target) voids approval and the
  // schedule, not just a text edit of an approved draft. Legacy rows keep the rule above.
  if (isV2(post) && APPROVAL_VOID_STATUSES.includes(post.status) && status !== 'draft') {
    const next = {
      ...post,
      content,
      selfReply: hasOwn(payload, 'selfReply') ? sanitizeSelfReply(payload.selfReply) : post.selfReply,
      mediaVariants: hasOwn(payload, 'mediaVariants') ? sanitizeMediaVariants(payload.mediaVariants) : post.mediaVariants,
    };
    if (isMaterialEdit(post, next)) {
      status = 'draft';
      scheduledAt = null;
      reviewedAt = null;
      reviewedBy = null;
      approvalVoided = true;
      voidHash = true;
    }
  }
  // An edit that voided approval keeps the row a draft even if the client re-sent the old schedule time.
  const resentOldSchedule = approvalVoided && hasOwn(payload, 'scheduledAt')
    && payload.scheduledAt && new Date(payload.scheduledAt).toISOString() === (post.scheduledAt || null);
  if (hasOwn(payload, 'scheduledAt') && !resentOldSchedule) {
    if (!payload.scheduledAt) {
      scheduledAt = null;
      if (status === 'scheduled' || status === 'queued') status = reviewedAt ? 'approved' : 'draft';
    } else {
      const dt = new Date(payload.scheduledAt);
      if (Number.isNaN(dt.getTime())) {
        const err = new Error('A valid scheduled time is required.');
        err.status = 400;
        throw err;
      }
      scheduledAt = dt.toISOString();
      await assertSchedulable({
        ...post,
        status,
        reviewedAt,
        packageId: hasOwn(payload, 'packageId') ? cleanStr(payload.packageId, 160) : post.packageId,
        needsApproval: payload.needsApproval === true || post.needsApproval === true,
      });
      assertNasMediaAttached({ nasSha: post.nasSha, mediaUrl: hasOwn(payload, 'mediaUrl') ? payload.mediaUrl : post.mediaUrl });
      await assertSchedulingRules({
        ...post,
        packageId: hasOwn(payload, 'packageId') ? cleanStr(payload.packageId, 160) : post.packageId,
      }, { clientId, selfId: post.id, scheduledAt: scheduledAt });
      status = dt.getTime() <= Date.now() ? 'queued' : 'scheduled';
    }
  }

  if (status === 'scheduled' || status === 'queued') assertNoMemoryPlaceholder(content);

  const updated = {
    ...post,
    content,
    scheduledAt,
    status,
    agents: payload.agents || post.agents || null,
    ...(Object.prototype.hasOwnProperty.call(payload, 'selfReply') ? { selfReply: sanitizeSelfReply(payload.selfReply) } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'sourceRef') ? { sourceRef: sanitizeSourceRef(payload.sourceRef) } : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, 'mediaVariants') ? { mediaVariants: sanitizeMediaVariants(payload.mediaVariants) } : {}),
    ...(typeof payload.needsStory === 'boolean' ? { needsStory: payload.needsStory } : {}),
    ...(hasOwn(payload, 'packageId') ? { packageId: cleanStr(payload.packageId, 160) } : {}),
    ...(hasOwn(payload, 'engine') ? { engine: cleanStr(payload.engine, 40) } : {}),
    ...(hasOwn(payload, 'campaign') ? { campaign: cleanStr(payload.campaign, 120) } : {}),
    ...(hasOwn(payload, 'priority') ? { priority: cleanStr(payload.priority, 20) } : {}),
    ...(payload.needsApproval === true ? { needsApproval: true } : {}),
    reviewedAt,
    reviewedBy,
    ...(voidHash ? { approvedHash: null } : {}),
    updatedAt: new Date().toISOString(),
  };
  const plan = storySyncPlan(post, content, null);
  if (plan?.postPatch) Object.assign(updated, plan.postPatch);
  // Calendar-batch and daily-fill drafts: the story gate follows the text, so writing the memory over the placeholder unblocks approval.
  if ((post.source === 'calendar-batch' || post.source === 'daily-fill') && content !== post.content && typeof payload.needsStory !== 'boolean') {
    updated.needsStory = hasMemoryPlaceholder(content) || hasMemoryPlaceholder(updated.selfReply?.text);
  }
  return { updated };
}

// Discogs drafts: push the owner's story into the content package. Never fails the post update.
async function syncDiscogsStory(post, content) {
  try {
    if (post.source !== 'discogs-ingest') return;
    const store = await import('../x-content-inventory/store.js');
    const releaseId = post.sourceRef?.releaseId;
    const existing = await store.getPackage(`discogs-${releaseId}`);
    const plan = storySyncPlan(post, content, existing);
    if (!plan?.packagePatch || !existing) return;
    await store.upsertPackage({ ...existing, ...plan.packagePatch });
  } catch (error) {
    console.warn('[discogs-story-sync] package update failed:', error.message);
  }
}

// Post one due row and write the result back. Never throws — the due sweep must
// keep going past a single failure. Claims the row first (atomic transaction);
// returns { skipped: true } when another sweeper already owns it or it is no
// longer claimable, so a double sweep can never publish the same post twice.
async function postAndRecord(snapshot) {
  const post = await claimDuePost(snapshot.id);
  if (!post) return { ok: false, skipped: true, updated: snapshot };
  const held = await deliveryHold(post);
  if (held) {
    await settleClaimed(post, held);
    return { ok: false, updated: held };
  }
  // Placeholder guard (same rule as post-now/schedule): never publish a draft
  // that still says "[add your memory]". Park it as a draft with a reason.
  if (hasMemoryPlaceholder(post.content) || hasMemoryPlaceholder(post.selfReply?.text)) {
    const updated = {
      ...post,
      status: 'draft',
      error: 'Skipped by due sweep: post still contains an unfilled placeholder ("[add your memory]" / "[add your take]").',
      updatedAt: new Date().toISOString(),
    };
    await settleClaimed(post, updated);
    return { ok: false, updated };
  }
  try {
    const now = new Date().toISOString();
    const targets = postTargets(post);
    let updated = { ...post, updatedAt: now };
    if (targets.x) {
      const result = await publishStoredPost(post, now);
      updated = {
        ...post,
        status: 'posted',
        twitterId: result.twitterId,
        postedAt: post.postedAt || now,
        updatedAt: now,
        error: null,
        retryable: false,
        errorClass: null,
        ...selfReplyFields(post, result, now),
      };
    }
    // Instagram leg (./cross-post.js): runs after X, never fails a published X post. When X is not a target it
    // is the row's only leg, so its outcome becomes the row's outcome.
    if (targets.instagram) {
      const delivery = await runInstagramLeg(post);
      updated.instagramDelivery = delivery;
      if (!targets.x) {
        Object.assign(updated, delivery.status === 'posted'
          ? { status: 'posted', postedAt: post.postedAt || now, error: null, retryable: false, errorClass: null }
          : { status: delivery.status === 'needs_review' ? 'needs_review' : 'failed', error: delivery.error, retryable: false, errorClass: `instagram-${delivery.status}` });
      }
    }
    await settleClaimed(post, updated);
    if (updated.status === 'posted') await recordPackagePosted(updated, now);
    else if (updated.status === 'failed') await releaseHeldSlot(updated);
    return { ok: updated.status === 'posted', updated };
  } catch (error) {
    const updated = failedRow(post, error);
    await settleClaimed(post, updated);
    // A retryable failure (429) will be re-claimed by the next sweep: it keeps its slot and package until terminal.
    if (updated.status === 'failed' && !isRetryableFailure(updated)) await releaseHeldSlot(updated);
    return { ok: false, updated };
  }
}

// Instagram leg deps, lazy so X-only paths (and their tests) never load the accounts store. Swappable in tests.
let instagramLegDeps = null;
export function __setInstagramLegDepsForTest(deps) { instagramLegDeps = deps; }

async function runInstagramLeg(post) {
  const deps = instagramLegDeps || {
    getAccount: async (clientId) => (await import('./social-accounts.js')).getSocialAccount(clientId, 'instagram'),
    publish: async (payload, opts) => (await import('./adapters/instagram.js')).publish(payload, opts),
  };
  return deliverInstagram(post, { ...deps, media: await freshPostMedia(post) });
}

/**
 * Which networks a post goes to (`targets: {x, instagram}`), editable until it is published. Not a material edit:
 * approval, schedule and slot are kept. Instagram is refused unless it could actually deliver (live, account
 * connected, media present), so a ticked box always means "will post".
 */
export async function setPostTargets(clientId, postId, targets, { expectedRevision = null } = {}) {
  const next = normalizeTargets(targets);
  const post = await getSocialPost(clientId, postId);
  if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
  if (expectedRevision != null && (post.revision || 0) !== Number(expectedRevision)) throw conflict();
  if (post.status === 'posted' || post.status === 'posting') {
    throw Object.assign(new Error('This post has already been published; its networks can no longer change.'), { status: 409, code: 'already-published' });
  }
  if (next.instagram) {
    const account = instagramLegDeps
      ? await instagramLegDeps.getAccount(clientId)
      : await (await import('./social-accounts.js')).getSocialAccount(clientId, 'instagram');
    const why = instagramBlockReason(post, account);
    if (why) throw Object.assign(new Error(why), { status: 409, code: 'instagram-blocked' });
  }
  const cur = postTargets(post);
  if (cur.x === next.x && cur.instagram === next.instagram && post.targets) return post;
  return commitPostTransition(clientId, post, { ...post, targets: next, updatedAt: new Date().toISOString() });
}

/** What the editor's network checkboxes show for one post: current targets + whether Instagram can be ticked. */
export async function getPostTargetOptions(clientId, postId) {
  const post = await getSocialPost(clientId, postId);
  if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
  const account = instagramLegDeps
    ? await instagramLegDeps.getAccount(clientId)
    : await (await import('./social-accounts.js')).getSocialAccount(clientId, 'instagram');
  const reason = instagramBlockReason(post, account);
  return {
    targets: postTargets(post),
    instagram: { available: !reason, reason: reason || null, username: account?.username || null },
    instagramDelivery: post.instagramDelivery || null,
  };
}

// A failed publish. Lifecycle-v2 rows whose outcome is AMBIGUOUS (timeout/5xx/unknown: X may already have the
// post) park as needs_review with no automatic retry, to be reconciled by platform id; every other row keeps the
// existing failed + retryable semantics (legacy rows are unchanged).
function failedRow(post, error) {
  const { retryable, errorClass } = classifyPublishError(error);
  const ambiguous = isV2(post) && AMBIGUOUS_CLASSES.has(errorClass);
  return {
    ...post,
    status: ambiguous ? 'needs_review' : 'failed',
    error: ambiguous
      ? `Publish outcome unknown (${error.message || 'no detail'}). The post may already be live on X: check, then reconcile it by platform id. Not retried automatically.`
      : (error.message || 'Failed to post.'),
    retryable: ambiguous ? false : retryable,
    errorClass,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Operator reconciliation of a held/ambiguous row against the real X outcome.
 *  outcome 'posted'     + platformId  -> mark posted with that id (records package usage)
 *  outcome 'not-posted'               -> back to an unscheduled draft (re-approve to schedule again)
 */
export async function reconcilePost(clientId, postId, { outcome, platformId = null, by = null } = {}) {
  const post = await getSocialPost(clientId, postId);
  if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
  const ambiguousFailed = post.status === 'failed' && AMBIGUOUS_CLASSES.has(post.errorClass);
  if (post.status !== 'needs_review' && !ambiguousFailed) {
    throw Object.assign(new Error(`Only a held post can be reconciled (this post is ${post.status}).`), { status: 409, code: 'not-held' });
  }
  const now = new Date().toISOString();
  const stamp = { reconciledAt: now, reconciledBy: by ? String(by).slice(0, 200) : null };
  if (outcome === 'posted') {
    const id = String(platformId || '').trim();
    if (!/^\d{5,25}$/.test(id)) throw Object.assign(new Error('A numeric platform post id is required.'), { status: 400, code: 'platform-id-required' });
    const updated = { ...post, ...stamp, status: 'posted', twitterId: id, postedAt: post.postedAt || now, error: null, retryable: false, updatedAt: now };
    const saved = await commitPostTransition(clientId, post, updated);
    await recordPackagePosted(saved, now);
    return saved;
  }
  if (outcome === 'not-posted' || outcome === 'not_posted') {
    const updated = { ...post, ...stamp, status: 'draft', scheduledAt: null, reviewedAt: null, reviewedBy: null, approvedHash: null, error: null, retryable: false, updatedAt: now };
    const saved = await commitPostTransition(clientId, post, updated);
    await releaseHeldSlot(post);
    return saved;
  }
  throw Object.assign(new Error("outcome must be 'posted' or 'not-posted'."), { status: 400, code: 'bad-outcome' });
}

// ---- Manual delivery (owner posts it themselves; Telegram "Post myself" / "I've posted it") -------------------
// `manual` is a real lifecycle status, not a flag: the sweeper only claims scheduled/queued/failed rows, so moving a
// row to `manual` inside the same revision-checked transaction the sweeper's claim races against is what makes
// manual and automatic delivery mutually exclusive. A row that already reached `posting` can't be taken over.
// Self-reported completion never sets `twitterId`: that field means "HITLOOP published it and X returned this id".

const PERMALINK_RE = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})(?:[/?#].*)?$/;

/** Accepts an x.com / twitter.com status URL only; anything else is dropped (never stored as a link). */
export function parsePermalink(value) {
  const url = String(value || '').trim();
  const m = PERMALINK_RE.exec(url);
  return m ? { permalink: `https://x.com/${m[1]}/status/${m[2]}`, platformId: m[2] } : { permalink: null, platformId: null };
}

function manualRefusal(post) {
  if (post.status === 'posting') return Object.assign(new Error('HITLOOP has already started publishing this post — it can no longer be taken over. Check its status in a minute.'), { status: 409, code: 'auto-delivery-started' });
  if (post.status === 'posted') return Object.assign(new Error('This post is already posted.'), { status: 409, code: 'already-posted' });
  if (post.status === 'needs_review') return Object.assign(new Error('This post was held for review and may already be live on X. Reconcile it in HITLOOP first.'), { status: 409, code: 'needs-review-reconcile' });
  if (post.status === 'rejected') return Object.assign(new Error('This post was rejected.'), { status: 409, code: 'rejected' });
  // Outcome unknown: X may already have it, so a hand post could duplicate it. Reconcile first.
  if (post.status === 'failed' && AMBIGUOUS_CLASSES.has(post.errorClass)) return Object.assign(new Error('This post failed with an unknown outcome and may already be live on X. Reconcile it in HITLOOP first.'), { status: 409, code: 'needs-review-reconcile' });
  if (post.status === 'failed' && !isRetryableFailure(post)) return null; // terminal failure: the owner may still post it by hand
  if (!MANUAL_CLAIMABLE_STATUSES.includes(post.status)) return Object.assign(new Error(`This post can't be taken over (it is ${post.status}).`), { status: 409, code: 'not-claimable' });
  return null;
}

function manualClaimRow(post, by, now) {
  // Only a live slot (scheduled/queued) is kept: the plan already accepted it. Any other target time is display-only.
  const keepsSlot = post.status === 'scheduled' || post.status === 'queued';
  return {
    ...post,
    status: 'manual',
    deliveryMode: 'manual',
    manualClaimedAt: now,
    manualClaimedBy: by ? String(by).slice(0, 200) : null,
    manualFromStatus: post.status,
    manualTargetAt: post.scheduledAt || null,
    scheduledAt: keepsSlot ? post.scheduledAt : null,
    error: null,
    retryable: false,
    updatedAt: now,
  };
}

async function commitManual(clientId, snapshot, updated) {
  try {
    return await commitPostTransition(clientId, snapshot, updated);
  } catch (error) {
    if (error.code !== 'revision-conflict') throw error;
    // Lost a race. If the sweeper claimed it, say so plainly; anything else is an ordinary stale-card conflict.
    const cur = await getSocialPost(clientId, snapshot.id);
    const refusal = cur ? manualRefusal(cur) : null;
    if (refusal) throw refusal;
    throw error;
  }
}

export async function claimManualDelivery(clientId, postId, { by = null, expectedRevision = null } = {}) {
  const post = await getSocialPost(clientId, postId);
  if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
  if (post.status === 'manual') return post; // repeated tap: same result
  const refusal = manualRefusal(post);
  if (refusal) throw refusal;
  if (expectedRevision != null && (post.revision || 0) !== Number(expectedRevision)) throw conflict();
  const saved = await commitManual(clientId, post, manualClaimRow(post, by, new Date().toISOString()));
  // A failed/expired row may still hold a ledger slot it never released; free it (best-effort, like the sweeps).
  if (post.status === 'failed' || post.status === 'expired') await releaseHeldSlot(post);
  return saved;
}

export async function recordManualPosted(clientId, postId, { by = null, permalink = null, expectedRevision = null } = {}) {
  const post = await getSocialPost(clientId, postId);
  if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
  if (post.status === 'posted' && post.deliveryMode === 'manual') return post; // repeated tap
  if (post.status !== 'manual') {
    const refusal = manualRefusal(post);
    if (refusal) throw refusal;
  }
  if (expectedRevision != null && (post.revision || 0) !== Number(expectedRevision)) throw conflict();
  const now = new Date().toISOString();
  const base = post.status === 'manual' ? post : manualClaimRow(post, by, now);
  const link = parsePermalink(permalink);
  const updated = {
    ...base,
    status: 'posted',
    deliveryMode: 'manual',
    deliveryVerified: false,
    postedAt: now,
    reportedPostedAt: now,
    reportedBy: by ? String(by).slice(0, 200) : null,
    permalink: link.permalink,
    reportedPlatformId: link.platformId,
    twitterId: null,
    error: null,
    retryable: false,
    updatedAt: now,
  };
  const saved = await commitManual(clientId, post, updated);
  await recordPackagePosted(saved, now);
  return saved;
}

export async function releaseManualClaim(clientId, postId, { by = null, expectedRevision = null } = {}) {
  const post = await getSocialPost(clientId, postId);
  if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
  if (post.status !== 'manual') throw Object.assign(new Error(`Only a post you are posting manually can be released (this post is ${post.status}).`), { status: 409, code: 'not-manual' });
  if (expectedRevision != null && (post.revision || 0) !== Number(expectedRevision)) throw conflict();
  const now = new Date().toISOString();
  const stillApproved = Boolean(post.approvedHash) && post.approvedHash === contentHash(post);
  const updated = {
    ...post,
    status: stillApproved ? 'approved' : 'draft',
    deliveryMode: null,
    scheduledAt: null,
    reviewedAt: stillApproved ? post.reviewedAt || null : null,
    reviewedBy: stillApproved ? post.reviewedBy || null : null,
    approvedHash: stillApproved ? post.approvedHash : null,
    manualReleasedAt: now,
    manualReleasedBy: by ? String(by).slice(0, 200) : null,
    updatedAt: now,
  };
  return commitPostTransition(clientId, post, updated);
}

/**
 * Explicit "Approve & post now" on an EXISTING row: the same approval gate, scheduling rules (reply / clearance /
 * window / package / plan) and reservation as approve-and-schedule, with the slot set to now; then the same atomic
 * claim + delivery recheck + publisher the sweeper uses. If the sweeper wins the claim first, it publishes instead.
 */
export async function approveAndPostNow(clientId, postId, { reviewedBy = null, expectedRevision = null } = {}) {
  const snapshot = await getSocialPost(clientId, postId);
  if (!snapshot) throw Object.assign(new Error('Post not found.'), { status: 404 });
  if (snapshot.status === 'posted') return { ok: true, outcome: 'already-posted', post: snapshot };
  if (snapshot.status === 'posting') return { ok: false, outcome: 'already-claimed', post: snapshot };
  if (expectedRevision != null && (snapshot.revision || 0) !== Number(expectedRevision)) throw conflict();
  const approvedSlot = (snapshot.status === 'scheduled' || snapshot.status === 'queued') && snapshot.reviewedAt;
  if (!['draft', 'approved'].includes(snapshot.status) && !approvedSlot) {
    throw Object.assign(new Error(`This post can't be posted now (it is ${snapshot.status}).`), { status: 409, code: 'not-postable' });
  }
  const working = snapshot.status === 'draft' ? approveInMemory(snapshot, reviewedBy) : snapshot;
  const { updated } = await prepareUpdate(clientId, working, { content: working.content, scheduledAt: new Date().toISOString() });
  const saved = await commitPostTransition(clientId, snapshot, { ...updated, approvalSource: 'post-now' });
  const result = await postAndRecord(saved);
  if (result.skipped) return { ok: false, outcome: 'already-claimed', post: (await getSocialPost(clientId, postId)) || saved };
  const outcome = result.ok ? 'posted' : result.updated?.status === 'needs_review' ? 'held' : 'failed';
  return { ok: result.ok, outcome, post: result.updated };
}

// Write a published post back onto its content package (post.packageId join):
// lastPostedAt, postCount+1, lastTwitterId, status 'posted'. Best-effort — a
// package failure must never turn a live tweet into a failed post. Idempotent per
// tweet (skips when the package already carries this twitterId).
async function recordPackagePosted(post, now) {
  if (!post?.packageId) return;
  const manual = post.deliveryMode === 'manual' && !post.twitterId;
  if (!post.twitterId && !manual) return;
  try {
    const store = await import('../x-content-inventory/store.js');
    const pkg = await store.getPackage(post.packageId);
    if (manual) {
      // Self-reported: count the use so the package isn't recycled, but never write it as a verified tweet id.
      if (!pkg || pkg.lastManualPostId === post.id) return;
      await store.upsertPackage({
        ...pkg,
        status: 'posted',
        lastPostedAt: now,
        postCount: (Number(pkg.postCount) || 0) + 1,
        lastManualPostId: post.id,
        lastPostedSelfReported: true,
      }, { returnPackages: false });
      return;
    }
    if (!pkg || pkg.lastTwitterId === post.twitterId) return;
    await store.upsertPackage({
      ...pkg,
      status: 'posted',
      lastPostedAt: now,
      postCount: (Number(pkg.postCount) || 0) + 1,
      lastTwitterId: post.twitterId,
    }, { returnPackages: false });
  } catch (error) {
    console.warn('[package-writeback] package update failed:', error.message);
  }
}

// Post ONLY the self-reply for a post whose main tweet is already live.
// Idempotent: a stored selfReplyTwitterId short-circuits with no X call, and the
// main tweet is never re-posted. Failure keeps status 'posted', records
// selfReplyError, and rethrows so the caller sees it.
export async function retrySelfReply(clientId, postId) {
  const post = await getSocialPost(clientId, postId);
  if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
  if (!post.selfReply) throw Object.assign(new Error('This post has no self-reply.'), { status: 400 });
  if (post.status !== 'posted' || !post.twitterId) {
    throw Object.assign(new Error('The main post is not live yet; publish it before posting the self-reply.'), { status: 409 });
  }
  if (post.selfReplyTwitterId) return post;
  if ((post.platform || 'x') !== 'x') throw Object.assign(new Error('Self-reply is only supported on X.'), { status: 400 });
  assertNoMemoryPlaceholder(post.selfReply.text);
  const now = new Date().toISOString();
  try {
    const reply = await getAdapter(post.platform || 'x').publishReply({
      clientId: post.clientId,
      inReplyToTweetId: post.twitterId,
      text: post.selfReply.text || '',
      media: post.selfReply,
    });
    // Merge patch on the posted row (fields only): never rewrites a newer whole document.
    const patch = { selfReplyTwitterId: reply.twitterId, selfReplyPostedAt: now, selfReplyError: null, updatedAt: now };
    await guardedPatch(post.id, { statuses: ['posted'] }, patch);
    return { ...post, ...patch };
  } catch (error) {
    await guardedPatch(post.id, { statuses: ['posted'] }, { selfReplyError: error.message || 'Self-reply failed.', updatedAt: now });
    throw error;
  }
}

// maxPerRun caps live publishes per sweep (oldest-due first); the rest simply stay
// due for the next sweep. Rows skipped because another sweeper claimed them do not
// count against the cap.
async function runDueSweep({ due, stale, expired = [] }, { maxPerRun = DEFAULT_MAX_PER_RUN } = {}) {
  const posted = [];
  const failed = [];
  const skipped = [];
  let attempted = 0;
  let deferred = 0;
  for (const post of due) {
    if (attempted >= maxPerRun) { deferred += 1; continue; }
    const { ok, skipped: wasSkipped, updated } = await postAndRecord(post);
    if (wasSkipped) { skipped.push(updated); continue; }
    attempted += 1;
    (ok ? posted : failed).push(updated);
  }
  return { posted, failed, skipped, needsReview: stale, expired, deferred };
}

export async function processDuePosts(clientId, opts = {}) {
  return runDueSweep(await readDuePosts(clientId), opts);
}

export async function processDuePostsForAllClients(opts = {}) {
  return runDueSweep(await readDuePosts(null), opts);
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

/** The shared X API client (read paths outside this file: strategy-accounts / quote-targets pullers). Throws when credentials are missing. */
export function getXReadClient() {
  return getTwitterClient();
}
