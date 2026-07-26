import { createRequire } from 'node:module';
import { TwitterApi } from 'twitter-api-v2';
import { PLATFORM_KEYS } from './platforms.js';
import { getXOAuth2Client } from './x-oauth.js';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');
const digestConfig = require('../intelligence/_digest-config.js');

const ACCOUNTS_COLLECTION = 'social_accounts';

function accountRef(clientId) {
  if (!clientId) throw Object.assign(new Error('clientId is required.'), { status: 400 });
  return fb.adminDb.collection(ACCOUNTS_COLLECTION).doc(clientId);
}

function stripQuotes(value) {
  if (!value || typeof value !== 'string') return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// Never return raw tokens to a client caller.
export function toPublicAccount(platformDoc) {
  if (!platformDoc) return { connected: false };
  return {
    connected: Boolean(platformDoc.accessToken || platformDoc.oauth1),
    authMode: platformDoc.authMode || null,
    username: platformDoc.username || null,
    userId: platformDoc.userId || null,
    scope: Array.isArray(platformDoc.scope) ? platformDoc.scope : [],
    updatedAt: platformDoc.updatedAt || null,
    connectedBy: platformDoc.connectedBy || null,
  };
}

export async function getSocialAccount(clientId, platform) {
  const snap = await accountRef(clientId).get();
  const data = snap.exists ? snap.data() : null;
  return data?.platforms?.[platform] || null;
}

export async function listSocialAccounts(clientId) {
  const snap = await accountRef(clientId).get();
  const data = snap.exists ? snap.data() : null;
  const platforms = data?.platforms || {};
  const out = {};
  for (const key of PLATFORM_KEYS) out[key] = toPublicAccount(platforms[key] || null);
  return out;
}

export async function saveSocialAccount(clientId, platform, patch) {
  if (!PLATFORM_KEYS.includes(platform)) {
    throw Object.assign(new Error(`Unknown platform: ${platform}`), { status: 400 });
  }
  await accountRef(clientId).set(
    { clientId, platforms: { [platform]: { ...patch, updatedAt: Date.now() } } },
    { merge: true }
  );
  return getSocialAccount(clientId, platform);
}

export async function disconnectSocialAccount(clientId, platform) {
  await accountRef(clientId).set({ platforms: { [platform]: fb.FieldValue.delete() } }, { merge: true });
  return { ok: true };
}

function getEnvOAuth1Client() {
  const appKey = stripQuotes(process.env.TWITTER_API_KEY || '');
  const appSecret = stripQuotes(process.env.TWITTER_API_SECRET || '');
  const accessToken = stripQuotes(process.env.TWITTER_ACCESS_TOKEN || '');
  const accessSecret = stripQuotes(process.env.TWITTER_ACCESS_SECRET || '');
  if (!appKey || !appSecret || !accessToken || !accessSecret) return null;
  return new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
}

// Resolution order for a platform's write client:
// 1. per-client oauth1 override (client's own dev app, client's own credits)
// 2. per-client oauth2 tokens (HitLoop's X app, HitLoop's credits)
// 3. only for the digest home client: global TWITTER_* env (today's behavior)
// 4. else: account-not-connected
export async function getPlatformClient(clientId, platform) {
  if (platform !== 'x') {
    throw Object.assign(new Error(`No client resolver for platform "${platform}".`), { status: 501, code: 'not-implemented' });
  }
  const account = await getSocialAccount(clientId, platform);
  if (account?.oauth1?.appKey && account?.oauth1?.appSecret && account?.oauth1?.accessToken && account?.oauth1?.accessSecret) {
    return {
      client: new TwitterApi({
        appKey: account.oauth1.appKey,
        appSecret: account.oauth1.appSecret,
        accessToken: account.oauth1.accessToken,
        accessSecret: account.oauth1.accessSecret,
      }),
      authMode: 'oauth1',
      username: account.username || null,
    };
  }
  if (account?.accessToken) {
    // Routed through getXOAuth2Client (not a raw `new TwitterApi(accessToken)`)
    // so a near-expiry token refreshes and writes back before use — access
    // tokens are short-lived and this runs unattended off a daily cron.
    const { client, tokens } = await getXOAuth2Client(clientId);
    return { client, authMode: 'oauth2', username: tokens.username || null, scope: tokens.scope || [] };
  }
  const homeClientId = await digestConfig.resolveDigestClientId();
  if (clientId === homeClientId) {
    const envClient = getEnvOAuth1Client();
    if (envClient) return { client: envClient, authMode: 'oauth1', username: null };
  }
  throw Object.assign(new Error('This client has no connected X account. Connect one in the Social Accounts card.'), { status: 409, code: 'account-not-connected' });
}
