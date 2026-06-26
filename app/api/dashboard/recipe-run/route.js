import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { listRecipes, getRecipe } = require('../../../../features/intelligence/analysis-recipes/recipes');
const { runAnalysisRecipe } = require('../../../../features/intelligence/analysis-recipes/run-recipe');
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

// Bound cost: at most this many recipes per Run. (3 = the full default skill set —
// customer-research + watchlist-analysis + reply-targets — runs in one pass.)
const MAX_RECIPES_PER_RUN = 3;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_REQUESTS_PER_CLIENT = 6;
const MAX_AGENT_DATA_CHARS = 80_000;

async function resolveClient(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) return { error: json({ error: 'No user record.' }, 404) };
  const clientId = context.clientId || null;
  if (!clientId) return { error: json({ error: 'No clientId on user record.' }, 404) };
  return { clientId };
}

/**
 * GET /api/dashboard/recipe-run → { recipes: [{ id, label, description, source }] }
 * The catalog of available analysis skills (from the registry).
 */
export async function GET(request) {
  try {
    await resolveClient(request); // auth gate only
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, err?.status || 401);
  }
  return json({ recipes: listRecipes() });
}

/**
 * POST /api/dashboard/recipe-run  { recipeIds: string[] }
 *
 * Runs the enabled analysis recipes over the client's stored Marketing Insights
 * content (dashboard_state.marketingBrief.scoutBrief.agentData) and returns each
 * recipe's synthesis. Does NOT run the brief pipeline and writes nothing.
 */
export async function POST(request) {
  let clientId;
  try {
    const resolved = await resolveClient(request);
    if (resolved.error) return resolved.error;
    clientId = resolved.clientId;
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, err?.status || 401);
  }

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const requested = Array.isArray(body.recipeIds) ? body.recipeIds : [];
  const recipeIds = [...new Set(requested.map((s) => String(s || '')).filter((id) => getRecipe(id)))].slice(0, MAX_RECIPES_PER_RUN);
  if (!recipeIds.length) {
    return json({ error: 'No valid recipeIds. Enable at least one analysis skill.' }, 400);
  }

  const ip = getClientIp(request);
  const rl = await checkRateLimit({
    key: `dashboard:${clientId}:recipe-run:${ip}`,
    limit: RATE_LIMIT_REQUESTS_PER_CLIENT,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (!rl.allowed) {
    return json({ error: 'Too many analysis runs. Try again later.' }, 429);
  }

  // Stored market signals. Most recipes read agentData (what the brief renders);
  // reply-targets reads an assembled reply candidate pool (watchlist mentions +
  // brand mentions + reddit + KOL) — the data the watchlist pull persists.
  const stateSnap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
  const marketingBrief = stateSnap.exists ? (stateSnap.data()?.marketingBrief || {}) : {};
  const agentData = marketingBrief?.scoutBrief?.agentData || null;
  const watchlistTimelines = marketingBrief?.watchlistTimelines || null;

  // reply-pool recipes can run on watchlist data alone; agentData-recipes need it.
  const needsAgentData = recipeIds.some((id) => getRecipe(id)?.contentKind !== 'reply-pool');
  const wantsReplyPool = recipeIds.some((id) => getRecipe(id)?.contentKind === 'reply-pool');
  if (needsAgentData && !agentData) {
    return json({ error: 'No stored market signals to analyze yet — run a brief (or refresh signals) first.' }, 409);
  }
  if (wantsReplyPool && !agentData && !watchlistTimelines) {
    return json({ error: 'No reply candidates yet — run a brief or pull the Watchlist (Mentions on) first.' }, 409);
  }
  if (agentData) {
    const agentDataChars = (() => {
      try { return JSON.stringify(agentData).length; } catch { return String(agentData).length; }
    })();
    if (needsAgentData && agentDataChars > MAX_AGENT_DATA_CHARS) {
      return json({ error: 'Stored market signals are too large for an interactive analysis run. Refresh signals or narrow the enabled analysis skills.' }, 413);
    }
  }

  // The reply candidate pool — built once, used for reply-pool recipes.
  const replyPool = {
    watchlistMentions: Array.isArray(watchlistTimelines?.handles) ? watchlistTimelines.handles : [],
    brandMentions: Array.isArray(agentData?.brandMentions) ? agentData.brandMentions : [],
    redditSignals: Array.isArray(agentData?.redditSignals) ? agentData.redditSignals : [],
    kolActivity: Array.isArray(agentData?.kolActivity) ? agentData.kolActivity : [],
  };
  const contentFor = (recipeId) => (getRecipe(recipeId)?.contentKind === 'reply-pool' ? replyPool : agentData);

  // Optional positioning context for grounding.
  let context = '';
  try {
    const cfgSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    const pos = cfgSnap.exists ? cfgSnap.data()?.scoutConfig?.positioningContext : null;
    if (pos) context = typeof pos === 'string' ? pos : JSON.stringify(pos);
  } catch { /* non-fatal */ }

  const results = [];
  for (const recipeId of recipeIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await runAnalysisRecipe({ recipeId, content: contentFor(recipeId), context });
      results.push(r);
    } catch (err) {
      results.push({ ok: false, recipeId, analysis: null, costUsd: 0, ms: 0, error: err.message || 'Recipe failed.' });
    }
  }

  return json({ results, count: results.length });
}
