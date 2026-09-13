import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  compactXOAuthError,
  getXOAuthStatus,
  startXOAuthFlow,
} from '../../../../features/social-posting/x-oauth.js';
import {
  estimateAudienceCalls,
  syncAudience,
  syncPosts,
  syncProfile,
} from '../../../../features/x-monitor/sync.js';
import { listAudienceEvents, listPosts, listSnapshots, readAccount } from '../../../../features/x-monitor/store.js';
import { postMetricDeltas } from '../../../../features/x-monitor/audience-diff.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');

// X Monitor — read-only performance surface over the connected @bai_ee account.
// Admin-only, same reasoning as the X Command Center route: these tokens control
// a real account and every sync spends X API credits that the Operating Cost
// card cannot see (docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md §0/§3).
//
// GET is free — it only reads Firestore snapshots. Every POST sync action is
// metered and is fired from a confirm row in the card that names the call count.

const POSTS_PAGE = 300;
const EVENTS_PAGE = 300;
const HISTORY_KEPT = 8; // trim per-post history before it crosses the wire

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
    const err = new Error('Admin access required for X monitoring.');
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

/** Free overview: connection state + everything already stored for the account. */
async function buildOverview(request) {
  const connection = await getXOAuthStatus();
  const accountId = connection.userId ? String(connection.userId) : null;
  if (!accountId) {
    return { connection, callbackUrl: callbackRedirectUri(request), account: null, snapshots: [], posts: [], events: [], estimate: null };
  }

  const [account, snapshots, posts, events, estimate] = await Promise.all([
    readAccount(accountId),
    listSnapshots(accountId),
    listPosts(accountId, POSTS_PAGE),
    listAudienceEvents(accountId, EVENTS_PAGE),
    estimateAudienceCalls(accountId),
  ]);

  return {
    connection,
    callbackUrl: callbackRedirectUri(request),
    accountId,
    account,
    snapshots,
    events,
    estimate,
    posts: posts.map((post) => ({
      ...post,
      history: (post.history || []).slice(-HISTORY_KEPT),
      deltas: postMetricDeltas(post.history || []),
    })),
  };
}

export async function GET(request) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  try {
    return json({ ok: true, ...(await buildOverview(request)) });
  } catch (err) {
    if (err?.status) return json({ error: err.message }, err.status);
    const mapped = compactXOAuthError(err);
    return json({ error: mapped.message }, mapped.status || 500);
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
    // Free — starts the OAuth 2.0 PKCE flow for the global @bai_ee connection.
    if (action === 'connect-start') {
      const { url } = await startXOAuthFlow(callbackRedirectUri(request), decoded?.email || null, null);
      return json({ ok: true, url });
    }

    // ── Metered. Each of these is spend-gated in the card. ──────────────────
    if (action === 'sync-profile') {
      const result = await syncProfile();
      return json({ ok: true, result, callsMade: result.callsMade, ...(await buildOverview(request)) });
    }
    if (action === 'sync-posts') {
      const result = await syncPosts({ deep: Boolean(body.deep) });
      return json({ ok: true, result, callsMade: result.callsMade, ...(await buildOverview(request)) });
    }
    if (action === 'sync-audience') {
      const result = await syncAudience();
      return json({ ok: true, result, callsMade: result.callsMade, ...(await buildOverview(request)) });
    }
    if (action === 'sync-all') {
      // Profile first: it refreshes the follower count the audience estimate
      // and the day's snapshot are both built from.
      const profile = await syncProfile();
      const posts = await syncPosts({ deep: false });
      const audience = await syncAudience();
      return json({
        ok: true,
        result: { profile, posts, audience },
        callsMade: profile.callsMade + posts.callsMade + audience.callsMade,
        ...(await buildOverview(request)),
      });
    }
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    if (err?.status) return json({ error: err.message }, err.status);
    const mapped = compactXOAuthError(err);
    return json({ error: mapped.message }, mapped.status || 500);
  }
}
