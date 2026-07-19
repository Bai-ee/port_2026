import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  compactXOAuthError,
  disconnectXOAuth,
  fetchBookmarksPage,
  getXOAuthStatus,
  getXUsage,
  loadXProfile,
  readBookmarksCache,
  removeBookmark,
  runFollowAction,
  runTweetAction,
  startXOAuthFlow,
  updateXProfile,
  verifyBookmarkAccess,
} from '../../../../features/social-posting/x-oauth.js';
import { createSocialPost } from '../../../../features/social-posting/twitter-service.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');

// X Command Center auth surface. Everything here is admin-only: the OAuth
// tokens control the real @bai_ee account, and verify-bookmarks spends real,
// untracked X API credits (see docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md §0).

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function requireAdmin(request) {
  const decoded = await verifyRequestUser({
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  });
  if (!(await isAdminEmail(decoded?.email))) {
    const err = new Error('Admin access required for X account management.');
    err.status = 403;
    throw err;
  }
  return decoded;
}

function callbackRedirectUri(request) {
  const override = (process.env.X_OAUTH_REDIRECT_URI || '').trim();
  if (override) return override;
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const origin = host ? `${proto}://${host}` : new URL(request.url).origin;
  return `${origin}/api/social-posting/x-oauth/callback`;
}

export async function GET(request) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  try {
    const status = await getXOAuthStatus();
    return json({ ok: true, ...status, callbackUrl: callbackRedirectUri(request) });
  } catch (err) {
    return json({ error: err.message || 'Failed to read X connection status.' }, err.status || 500);
  }
}

export async function POST(request) {
  let decoded;
  try {
    decoded = await requireAdmin(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const action = body?.action || '';
  try {
    if (action === 'start') {
      const { url } = await startXOAuthFlow(callbackRedirectUri(request), decoded?.email || null);
      return json({ ok: true, url });
    }
    if (action === 'disconnect') {
      await disconnectXOAuth();
      return json({ ok: true });
    }
    if (action === 'verify-bookmarks') {
      // Spend-gated in the UI: the card shows an explicit confirm naming the
      // call count before this action fires.
      const result = await verifyBookmarkAccess();
      return json({ ok: true, result });
    }

    // ── Command-center actions. Every metered action below is spend-gated in
    // the UI (explicit confirm naming the call count before it fires).
    if (action === 'usage') {
      return json({ ok: true, usage: await getXUsage(), callsMade: 2 });
    }
    if (action === 'bookmarks-cached') {
      return json({ ok: true, bookmarks: await readBookmarksCache(), callsMade: 0 });
    }
    if (action === 'bookmarks-fetch') {
      const bookmarks = await fetchBookmarksPage({ cursor: body.cursor || null });
      return json({ ok: true, bookmarks, callsMade: 1 });
    }
    if (action === 'bookmark-remove') {
      const bookmarks = await removeBookmark(String(body.tweetId || ''));
      return json({ ok: true, bookmarks, callsMade: 1 });
    }
    if (action === 'bookmark-to-draft') {
      // Free: copies the cached bookmark into the shared social_posts queue so
      // Copywriter / Schedule Posts can enhance, score, and publish it.
      const cache = await readBookmarksCache();
      const item = (cache.items || []).find((i) => i.id === String(body.tweetId || ''));
      if (!item) return json({ error: 'Bookmark not found in the cached list — fetch bookmarks first.' }, 404);
      const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
      if (!context.clientId) return json({ error: 'No client workspace found for drafts.' }, 404);
      const seed = (item.authorUsername ? `Riffing on @${item.authorUsername}:\n\n${item.text}` : item.text).slice(0, 280);
      const post = await createSocialPost(context.clientId, { content: seed, source: 'x-bookmarks' });
      return json({ ok: true, post, callsMade: 0 });
    }
    if (action === 'profile-load') {
      return json({ ok: true, profile: await loadXProfile(), callsMade: 1 });
    }
    if (action === 'profile-update') {
      const profile = await updateXProfile(body.fields || {});
      return json({ ok: true, profile, callsMade: 1 });
    }
    if (action === 'tweet-action') {
      const result = await runTweetAction({ op: body.op, tweetId: String(body.tweetId || ''), text: body.text || '' });
      return json({ ok: true, result, callsMade: 1 });
    }
    if (action === 'follow-action') {
      const result = await runFollowAction({ handle: body.handle, op: body.op });
      return json({ ok: true, result, callsMade: 2 });
    }
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    if (err?.status) return json({ error: err.message }, err.status);
    const mapped = compactXOAuthError(err);
    return json({ error: mapped.message }, mapped.status || 500);
  }
}
