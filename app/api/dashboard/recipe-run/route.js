import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { listRecipes, getRecipe } = require('../../../../features/intelligence/analysis-recipes/recipes');
const { runAnalysisRecipe } = require('../../../../features/intelligence/analysis-recipes/run-recipe');
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');
const { loadClientBrainContext } = require('../../../../features/client-brain/store.cjs');
const { logUsage } = require('../../../../api/_lib/usage-logger.cjs');
const { collectRedditSignals } = require('../../../../features/intelligence/_platform-signals.js');

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

// Bound cost: at most this many recipes per Run. (4 = customer-research +
// watchlist-analysis + reddit-analysis + reply-targets in one pass.)
const MAX_RECIPES_PER_RUN = 4;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_REQUESTS_PER_CLIENT = 6;
const MAX_AGENT_DATA_CHARS = 80_000;

// Reply-window + velocity signals for the reply-targets recipe. The biggest reply
// lever in the X algorithm is engagement velocity inside the early-reply window:
// replying to a young, accelerating post rides its rising For-You distribution.
// We compute these from each candidate's publish time + engagement so the recipe
// ranks on a real signal instead of treating recency as flat.
const REPLY_WINDOW_HOURS = 6;
const VELOCITY_AGE_FLOOR_HOURS = 0.25; // floor age so a brand-new post can't divide by ~0

function pickPublishedAt(it) {
  return it?.publishedAt || it?.created_at || it?.createdAt || it?.date || it?.timestamp || null;
}

function pickEngagement(it) {
  if (!it || typeof it !== 'object') return 0;
  if (Number.isFinite(it.engagementTotal)) return it.engagementTotal;
  const fields = ['likes', 'replies', 'reposts', 'retweets', 'quotes', 'comments', 'upvotes', 'score'];
  let sum = 0;
  let any = false;
  for (const f of fields) {
    if (Number.isFinite(it[f])) { sum += it[f]; any = true; }
  }
  return any ? sum : 0;
}

// Add ageHours / velocityPerHour / replyWindowOpen to a candidate post. Items with
// no parseable publish time are left untouched (the recipe treats a missing
// velocity as unknown, not as a zero-priority signal).
function withVelocity(it, nowMs) {
  if (!it || typeof it !== 'object') return it;
  const ts = (() => { const p = pickPublishedAt(it); const n = p ? Date.parse(p) : NaN; return n; })();
  if (!Number.isFinite(ts)) return it;
  const ageHours = Math.max(0, (nowMs - ts) / 3_600_000);
  const engagementTotal = pickEngagement(it);
  const velocityPerHour = Math.round((engagementTotal / Math.max(ageHours, VELOCITY_AGE_FLOOR_HOURS)) * 10) / 10;
  return {
    ...it,
    ageHours: Math.round(ageHours * 10) / 10,
    engagementTotal,
    velocityPerHour,
    replyWindowOpen: ageHours <= REPLY_WINDOW_HOURS,
  };
}

function buildRedditAnalysisContent(marketingBrief = {}, nowMs = Date.now()) {
  const redditSignals = collectRedditSignals(marketingBrief).map((it) => withVelocity(it, nowMs));
  return {
    generatedAt: new Date(nowMs).toISOString(),
    source: 'marketingBrief.scoutBrief.agentData.redditSignals + marketingBrief.reportSnapshot.platformTests.reddit',
    redditSignals,
    dataQuality: {
      itemsAvailable: redditSignals.length,
      note: redditSignals.length
        ? 'Analyze only these supplied Reddit signals. Missing engagement or timestamps means freshness is unknown.'
        : 'No Reddit signals are currently available in stored Market Insights data.',
    },
  };
}

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
  const redditSignals = collectRedditSignals(marketingBrief);

  // reply-pool recipes can run on watchlist data alone; agentData-recipes need it.
  const needsAgentData = recipeIds.some((id) => !['reply-pool', 'reddit-signals'].includes(getRecipe(id)?.contentKind));
  const needsRedditSignals = recipeIds.some((id) => getRecipe(id)?.contentKind === 'reddit-signals');
  const wantsReplyPool = recipeIds.some((id) => getRecipe(id)?.contentKind === 'reply-pool');
  if (needsAgentData && !agentData) {
    return json({ error: 'No stored market signals to analyze yet — run a brief (or refresh signals) first.' }, 409);
  }
  if (needsRedditSignals && !redditSignals.length) {
    return json({ error: 'No Reddit signals to analyze yet — run a Reddit source test or refresh Market Signals with Reddit enabled first.' }, 409);
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

  // The reply candidate pool — built once, used for reply-pool recipes. Each
  // candidate post is enriched with engagement velocity + reply-window freshness
  // (relative to nowMs) so the recipe ranks on the early-reply lever.
  const nowMs = Date.now();
  const replyPool = {
    generatedAt: new Date(nowMs).toISOString(),
    replyWindowHours: REPLY_WINDOW_HOURS,
    watchlistMentions: (Array.isArray(watchlistTimelines?.handles) ? watchlistTimelines.handles : [])
      .map((h) => ({
        ...h,
        ownPosts: Array.isArray(h?.ownPosts) ? h.ownPosts.map((it) => withVelocity(it, nowMs)) : [],
        mentions: Array.isArray(h?.mentions) ? h.mentions.map((it) => withVelocity(it, nowMs)) : [],
      })),
    brandMentions: (Array.isArray(agentData?.brandMentions) ? agentData.brandMentions : []).map((it) => withVelocity(it, nowMs)),
    redditSignals: redditSignals.map((it) => withVelocity(it, nowMs)),
    kolActivity: (Array.isArray(agentData?.kolActivity) ? agentData.kolActivity : []).map((it) => withVelocity(it, nowMs)),
  };
  const contentFor = (recipeId) => {
    const kind = getRecipe(recipeId)?.contentKind;
    if (kind === 'reply-pool') return replyPool;
    if (kind === 'reddit-signals') return buildRedditAnalysisContent(marketingBrief, nowMs);
    return agentData;
  };

  // Grounding context = positioning + the Client Brain voice (tone, pillars, and
  // few-shot example posts). reply-targets drafts replies, so it needs the voice
  // to sound like the operator, not just the positioning. Same single source
  // (CLIENT_BRAIN.md) the post surfaces use — no separate voice logic here.
  const contextParts = [];
  try {
    const cfgSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    const pos = cfgSnap.exists ? cfgSnap.data()?.scoutConfig?.positioningContext : null;
    if (pos) contextParts.push(typeof pos === 'string' ? pos : JSON.stringify(pos));
  } catch { /* non-fatal */ }
  try {
    const voiceContext = await loadClientBrainContext(clientId, { useFor: 'copy', maxChars: 2000 });
    if (voiceContext) contextParts.push(voiceContext);
  } catch { /* non-fatal — replies still run on positioning alone */ }
  const context = contextParts.join('\n\n');

  const results = [];
  for (const recipeId of recipeIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await runAnalysisRecipe({ recipeId, content: contentFor(recipeId), context });
      const recipe = getRecipe(recipeId);
      if (r?.costUsd) {
        await logUsage({
          module: 'market-insights',
          action: `analysis.${recipeId}`,
          provider: 'anthropic',
          model: recipe?.model || 'claude-sonnet-4-5-20250929',
          costUsd: r.costUsd,
          clientId,
          metadata: { recipeId, interactive: true },
        }).catch(() => {});
      }
      results.push(r);
    } catch (err) {
      results.push({ ok: false, recipeId, analysis: null, costUsd: 0, ms: 0, error: err.message || 'Recipe failed.' });
    }
  }

  const successful = results.filter((r) => r?.ok && r?.analysis);
  if (successful.length) {
    const generatedAt = new Date().toISOString();
    const reportSnapshot = {};
    const existingRecipes = Array.isArray(marketingBrief?.reportSnapshot?.digestRecipes)
      ? marketingBrief.reportSnapshot.digestRecipes
      : [];
    let nextDigestRecipes = existingRecipes;
    for (const result of successful) {
      if (result.recipeId === 'reddit-analysis') {
        reportSnapshot.redditAnalysis = { text: result.analysis, generatedAt };
      } else if (result.recipeId === 'instagram-analysis') {
        reportSnapshot.instagramAnalysis = { text: result.analysis, generatedAt };
      } else if (result.recipeId === 'watchlist-analysis') {
        reportSnapshot.watchlistAnalysis = { text: result.analysis, generatedAt };
      } else if (result.recipeId === 'reply-targets') {
        nextDigestRecipes = [
          ...nextDigestRecipes.filter((item) => item?.recipeId !== 'reply-targets'),
          result,
        ];
      }
    }
    if (nextDigestRecipes !== existingRecipes) reportSnapshot.digestRecipes = nextDigestRecipes.slice(-6);
    if (Object.keys(reportSnapshot).length) {
      await fb.adminDb.collection('dashboard_state').doc(clientId).set({
        marketingBrief: { reportSnapshot },
        updatedAt: fb.FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => {});
    }
  }

  return json({ results, count: results.length });
}
