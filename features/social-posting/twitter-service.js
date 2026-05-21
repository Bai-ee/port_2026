import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { TwitterApi } from 'twitter-api-v2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'social-posting-queue.json');
const PORTFOLIO_ENV = path.join(REPO_ROOT, '.env.local');
const SOURCE_BOT_ENV = path.resolve(REPO_ROOT, '..', 'agent_master_repo', 'creative-tech-dj-twitter-bot', '.env');

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

function compactTwitterError(error) {
  return {
    code: error?.code || null,
    message: error?.message || null,
    data: error?.data || null,
    rateLimit: error?.rateLimit || null,
  };
}

async function postViaV1Fallback(text, originalError) {
  try {
    const response = await getTwitterClient().v1.tweet(text);
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

async function ensureQueueFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(QUEUE_FILE);
  } catch {
    await fs.writeFile(QUEUE_FILE, JSON.stringify({ posts: [] }, null, 2));
  }
}

export async function readSocialQueue(clientId) {
  await ensureQueueFile();
  const raw = await fs.readFile(QUEUE_FILE, 'utf8');
  const parsed = JSON.parse(raw || '{"posts":[]}');
  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
  return posts.filter((post) => post.clientId === clientId);
}

async function writeSocialQueueForClient(clientId, updater) {
  await ensureQueueFile();
  const raw = await fs.readFile(QUEUE_FILE, 'utf8');
  const parsed = JSON.parse(raw || '{"posts":[]}');
  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
  const clientPosts = posts.filter((post) => post.clientId === clientId);
  const otherPosts = posts.filter((post) => post.clientId !== clientId);
  const nextClientPosts = await updater(clientPosts);
  const next = {
    posts: [...otherPosts, ...nextClientPosts].sort((a, b) => {
      const aTime = new Date(a.createdAt || a.scheduledAt || 0).getTime();
      const bTime = new Date(b.createdAt || b.scheduledAt || 0).getTime();
      return bTime - aTime;
    }),
  };
  await fs.writeFile(QUEUE_FILE, JSON.stringify(next, null, 2));
  return nextClientPosts;
}

async function readAllPosts() {
  await ensureQueueFile();
  const raw = await fs.readFile(QUEUE_FILE, 'utf8');
  const parsed = JSON.parse(raw || '{"posts":[]}');
  return Array.isArray(parsed.posts) ? parsed.posts : [];
}

function makeId() {
  return `social_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizePostText(content) {
  return String(content || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function runPostingAgents(content, context = {}) {
  const base = normalizePostText(content);
  const withoutTags = base.replace(/\s+#\w+/g, '').trim();
  const suggestedTags = ['#CreativeTech', '#AI', '#BuildInPublic'];
  const currentTags = base.match(/#\w+/g) || [];
  const tags = Array.from(new Set([...currentTags, ...suggestedTags])).slice(0, 3);

  let optimized = withoutTags || base;
  if (optimized.length > 230) optimized = `${optimized.slice(0, 227).trim()}...`;
  if (tags.length && optimized.length + 1 + tags.join(' ').length <= 280) {
    optimized = `${optimized} ${tags.join(' ')}`.trim();
  }

  return {
    optimized,
    agents: {
      contentCreator: {
        status: 'complete',
        note: context.source ? `Adapted from ${context.source}.` : 'Cleaned into a concise X-ready draft.',
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
      },
      mediaGenerator: {
        status: 'queued',
        note: 'Video/audio generation hooks are reserved for the next build phase.',
      },
    },
  };
}

function mapTwitterError(error) {
  let message = 'Failed to post to Twitter.';
  let hint = null;
  if (error?.code === 403) {
    const detail = String(error?.data?.detail || '');
    const reason = String(error?.data?.reason || '');
    if (detail.includes('duplicate')) {
      message = 'Tweet content appears to be a duplicate. Edit it and try again.';
    } else if (reason === 'client-not-enrolled') {
      message = 'X rejected the post because this developer app is not attached to an API Project.';
      hint = 'In the X developer portal, attach this app to a Project with API access, then regenerate the Access Token and Access Secret for that app.';
    } else {
      message = 'Twitter rejected the request. Check API write permissions.';
      hint = 'The OAuth token authenticated, but X rejected the write. Confirm the API key belongs to the Read and Write app shown in the developer portal, then regenerate the Access Token and Access Secret for that app.';
    }
  } else if (error?.code === 401) {
    message = 'Twitter authentication failed. Check API credentials.';
    hint = 'Use the Consumer Key, Consumer Secret, Access Token, and Access Token Secret from the same X app. Regenerate the OAuth 1.0a access token pair after changing app permissions or switching apps.';
  } else if (error?.code === 429) {
    message = 'Twitter rate limit exceeded. Wait before posting again.';
    hint = 'Retry after the X API rate limit window resets.';
  } else if (error?.message) {
    message = error.message;
  }
  const out = new Error(message);
  out.status = error?.code === 429 ? 429 : 500;
  out.details = error?.message;
  out.hint = hint;
  out.twitterError = compactTwitterError(error);
  return out;
}

export async function postToTwitter(content) {
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

  try {
    // Match the known-working source bot direct-post path: send the v2 Tweet
    // payload object explicitly instead of relying on the string overload.
    const response = await getTwitterClient().v2.tweet({ text });
    return { twitterId: response?.data?.id || null, response, apiVersion: 'v2' };
  } catch (error) {
    if (error?.code === 403 && error?.data?.reason === 'client-not-enrolled') {
      return postViaV1Fallback(text, error);
    }
    throw mapTwitterError(error);
  }
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
  const post = {
    id: makeId(),
    clientId,
    platform: 'x',
    content,
    source: payload.source || 'manual',
    status,
    scheduledAt: payload.scheduledAt || null,
    twitterId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    postedAt: null,
    agents: payload.agents || null,
  };

  await writeSocialQueueForClient(clientId, (posts) => [post, ...posts]);
  return post;
}

export async function postNow(clientId, payload) {
  const draft = await createSocialPost(clientId, { ...payload, status: 'posting' });
  try {
    const result = await postToTwitter(draft.content);
    const updated = {
      ...draft,
      status: 'posted',
      twitterId: result.twitterId,
      apiVersion: result.apiVersion || 'v2',
      fallbackFrom: result.fallbackFrom || null,
      postedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeSocialQueueForClient(clientId, (posts) => posts.map((post) => (post.id === draft.id ? updated : post)));
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
    await writeSocialQueueForClient(clientId, (posts) => posts.map((post) => (post.id === draft.id ? failed : post)));
    throw error;
  }
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

export async function processDuePosts(clientId) {
  const due = (await readSocialQueue(clientId)).filter((post) => (
    ['scheduled', 'queued', 'failed'].includes(post.status)
    && post.scheduledAt
    && new Date(post.scheduledAt).getTime() <= Date.now()
  ));
  const posted = [];
  const failed = [];

  for (const post of due) {
    try {
      const result = await postToTwitter(post.content);
      const updated = {
        ...post,
        status: 'posted',
        twitterId: result.twitterId,
        postedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: null,
      };
      posted.push(updated);
      await writeSocialQueueForClient(clientId, (posts) => posts.map((row) => (row.id === post.id ? updated : row)));
    } catch (error) {
      const updated = {
        ...post,
        status: 'failed',
        error: error.message || 'Failed to post.',
        updatedAt: new Date().toISOString(),
      };
      failed.push(updated);
      await writeSocialQueueForClient(clientId, (posts) => posts.map((row) => (row.id === post.id ? updated : row)));
    }
  }

  return { posted, failed };
}

export async function processDuePostsForAllClients() {
  const posts = await readAllPosts();
  const clientIds = Array.from(new Set(posts.map((post) => post.clientId).filter(Boolean)));
  const result = { posted: [], failed: [] };

  for (const clientId of clientIds) {
    const clientResult = await processDuePosts(clientId);
    result.posted.push(...clientResult.posted);
    result.failed.push(...clientResult.failed);
  }

  return result;
}
