import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  compactXOAuthError,
  startXOAuthFlow,
} from '../../../../features/social-posting/x-oauth.js';
import {
  estimateAudienceCalls,
  readClientConnection,
  resolveAccountId,
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
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { resolveDigestClientId } = require('../../../../features/intelligence/_digest-config.js');

// X Monitor — read-only performance surface over the active client's connected
// X account (?as=<clientId> via the dashboard switcher; the home client with no
// per-client X doc keeps the legacy global @bai_ee connection).
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
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context?.clientId) {
    const err = new Error('No client workspace was found.');
    err.status = 404;
    throw err;
  }
  return { decoded, clientId: context.clientId };
}

async function isHomeClient(clientId) {
  try {
    const home = await resolveDigestClientId();
    return Boolean(home) && home === clientId;
  } catch {
    return false;
  }
}

function callbackRedirectUri(request) {
  const override = (process.env.X_OAUTH_REDIRECT_URI || '').trim();
  if (override) return override;
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const origin = host ? `${proto}://${host}` : new URL(request.url).origin;
  return `${origin}/api/social-posting/x-oauth/callback`;
}

/** Free overview: this client's connection state + everything already stored for its account. */
async function buildOverview(request, clientId) {
  const connection = await readClientConnection(clientId);
  const { accountId } = await resolveAccountId(clientId);
  if (!accountId) {
    return { clientId, connection, callbackUrl: callbackRedirectUri(request), account: null, snapshots: [], posts: [], events: [], estimate: null };
  }

  const [account, snapshots, posts, events, estimate] = await Promise.all([
    readAccount(accountId),
    listSnapshots(accountId),
    listPosts(accountId, POSTS_PAGE),
    listAudienceEvents(accountId, EVENTS_PAGE),
    estimateAudienceCalls(accountId),
  ]);

  return {
    clientId,
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
  let clientId;
  try {
    ({ clientId } = await requireAdmin(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  try {
    return json({ ok: true, ...(await buildOverview(request, clientId)) });
  } catch (err) {
    if (err?.status) return json({ error: err.message }, err.status);
    const mapped = compactXOAuthError(err);
    return json({ error: mapped.message }, mapped.status || 500);
  }
}

export async function POST(request) {
  let decoded;
  let clientId;
  try {
    ({ decoded, clientId } = await requireAdmin(request));
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
    // Free — starts the OAuth 2.0 PKCE flow. The home client keeps the legacy
    // global connection; every other client connects its own account (same
    // per-client flow as the Social Accounts card).
    if (action === 'connect-start') {
      const flowClientId = (await isHomeClient(clientId)) ? null : clientId;
      const { url } = await startXOAuthFlow(callbackRedirectUri(request), decoded?.email || null, flowClientId);
      return json({ ok: true, url });
    }

    // ── Metered. Each of these is spend-gated in the card. ──────────────────
    if (action === 'sync-profile') {
      const result = await syncProfile({ clientId });
      return json({ ok: true, result, callsMade: result.callsMade, ...(await buildOverview(request, clientId)) });
    }
    if (action === 'sync-posts') {
      const result = await syncPosts({ clientId, deep: Boolean(body.deep) });
      return json({ ok: true, result, callsMade: result.callsMade, ...(await buildOverview(request, clientId)) });
    }
    if (action === 'sync-audience') {
      const result = await syncAudience({ clientId });
      return json({ ok: true, result, callsMade: result.callsMade, ...(await buildOverview(request, clientId)) });
    }
    if (action === 'sync-all') {
      // Profile first: it refreshes the follower count the audience estimate
      // and the day's snapshot are both built from.
      const profile = await syncProfile({ clientId });
      const posts = await syncPosts({ clientId, deep: false });
      const audience = await syncAudience({ clientId });
      return json({
        ok: true,
        result: { profile, posts, audience },
        callsMade: profile.callsMade + posts.callsMade + audience.callsMade,
        ...(await buildOverview(request, clientId)),
      });
    }
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    if (err?.status) return json({ error: err.message }, err.status);
    const mapped = compactXOAuthError(err);
    return json({ error: mapped.message }, mapped.status || 500);
  }
}
