import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');
const { loadClientBrainContext } = require('../client-brain/store.cjs');

import { normalizeVertical } from './normalize-vertical.js';
import {
  buildKnowledgeBaseRuntimeQuery,
  getKnowledgeBaseRuntimeContext,
} from '../knowledge-base/pipeline-context.js';
import {
  buildDailyEditorialRecommendation,
  formatEditorialRecommendationForPrompt,
  normalizeEditorialStrategyConfig,
} from '../editorial-strategy/engine.js';

/**
 * Generate a Strategy Builder plan for a client and persist it to
 * dashboard_state/{clientId}.strategyBuilder.lastPlan.
 *
 * Shared by the dashboard route (POST /api/dashboard/strategy-builder/generate)
 * and the pre-digest refresh worker. Never trusts client-supplied strategy
 * data — all source intelligence is read server-side from Firestore.
 *
 * @param {Object}  args
 * @param {string}  args.clientId
 * @param {Object}  args.clientConfig  Visible Strategy Builder config (sources,
 *   signals, campaign, days, vertical, editorial). Pass the persisted
 *   dashboard_state.strategyBuilder.config for headless/cron runs.
 * @returns {Promise<{ok:true, plan:Object} | {ok:false, status:number, error:string}>}
 */
export async function generateStrategyPlan({ clientId, clientConfig = {} }) {
  if (!clientId) return { ok: false, status: 400, error: 'Missing clientId.' };

  const rawVertical = String(clientConfig.vertical || '').trim();

  // Load server-side data from Firestore — never trust client-supplied strategy data
  let dsData = {};
  let ccData = {};
  let prospectData = {};
  try {
    const [dsSnap, ccSnap, prospectSnap] = await Promise.all([
      fb.adminDb.collection('dashboard_state').doc(clientId).get(),
      fb.adminDb.collection('client_configs').doc(clientId).get(),
      fb.adminDb.collection('leadgen_prospects').doc(`client:${clientId}`).get(),
    ]);
    dsData = dsSnap.exists ? (dsSnap.data() || {}) : {};
    ccData = ccSnap.exists ? (ccSnap.data() || {}) : {};
    prospectData = prospectSnap.exists ? (prospectSnap.data() || {}) : {};
  } catch (err) {
    return { ok: false, status: 500, error: `Firestore error: ${err.message}` };
  }

  // Resolve + normalize vertical. Source of truth: per-strategy override →
  // Market Category card (user-set or auto-detected) → lead-gen profile.
  // lead-gen seeds snake_case; normalize → kebab so holidays + UI align.
  const vertical = normalizeVertical(
    rawVertical ||
      dsData.marketCategory?.value ||
      dsData.snapshot?.brandOverview?.industry ||
      dsData.leadgen?.vertical ||
      ''
  );
  if (!vertical) {
    return {
      ok: false,
      status: 400,
      error: 'No category set. Set one in the Market Category card, or pass config.vertical.',
    };
  }

  // Resolve location from leadgen data
  const leadgen = dsData.leadgen || {};
  const visualIdentity = dsData.snapshot?.visualIdentity || {};
  const scribeBrief = dsData.snapshot?.scribe?.brief || {};
  const analyzer = dsData.analyzer || {};

  const location = {
    lat: leadgen.lat || null,
    lng: leadgen.lng || null,
    city: leadgen.city || leadgen.placeId || '',
    country: leadgen.country || 'US',
    tz: leadgen.timezone || leadgen.tz || 'America/New_York',
  };

  // Build card findings summary
  const cardFindings = {};
  for (const [cardId, cardData] of Object.entries(analyzer)) {
    if (cardData && typeof cardData === 'object') {
      cardFindings[cardId] = {
        highlights: cardData.highlights || [],
        gaps: cardData.gaps || [],
        readiness: cardData.readiness || cardData.status || 'unknown',
      };
    }
  }

  // Marketing-Brief output lives at dashboard_state.marketingBrief (NOT
  // snapshot.scribe.brief — see docs/MARKETING_BRIEF_HANDOFF.md). Surface the
  // rich Scout intelligence so strategies reflect generated pipeline data.
  const marketingBrief = dsData.marketingBrief || {};

  const agentData = marketingBrief?.scoutBrief?.agentData || {};

  // Gate: day strategy requires Marketing Brief to have been run.
  const hasBriefData = Boolean(
    marketingBrief?.scoutBrief?.humanBrief ||
    (agentData.brandMentions || []).length ||
    (agentData.kolActivity || []).length ||
    (agentData.viralOpportunities?.opportunities || agentData.viralOpportunities || []).length ||
    (agentData.categoryTrends || []).length
  );
  if (!hasBriefData) {
    return {
      ok: false,
      status: 400,
      error: 'Run Marketing Brief first — day strategy requires it. The brief provides the live signals that drive today\'s strategy and seed the week plan.',
    };
  }
  const visualDna = prospectData?.visualDna || {};
  const seoAudit = dsData.seoAudit || {};

  // Per-source enable map — a source is included unless explicitly disabled by
  // the user's Data Sources toggles, so toggling off truly removes it.
  const sourceMap = (clientConfig.sources && typeof clientConfig.sources === 'object')
    ? clientConfig.sources
    : {};
  const srcOn = (key) => sourceMap?.[key]?.enabled !== false;

  const briefIncluded = srcOn('marketing-brief') || srcOn('daily-brief');
  const brief = briefIncluded
    ? {
        positioning: scribeBrief.positioning || marketingBrief.headline || '',
        audience: scribeBrief.audience || scribeBrief.targetAudience || '',
        objectives: scribeBrief.objectives || '',
        productLines: scribeBrief.productLines || [],
      }
    : { positioning: '', audience: '', objectives: '', productLines: [] };

  const intelligence = srcOn('marketing-brief')
    ? {
        humanBrief: marketingBrief?.scoutBrief?.humanBrief || '',
        brandMentions: agentData.brandMentions || [],
        kolActivity: agentData.kolActivity || [],
        categoryTrends: agentData.categoryTrends || [],
        competitorIntel: agentData.competitorIntel || [],
        viralOpportunities: agentData.viralOpportunities || [],
        contentOpportunities: marketingBrief?.contentOpportunities || [],
      }
    : null;

  const media = srcOn('visual-dna')
    ? { dnaPromptBlock: visualDna?.masterPromptBlock || '' }
    : null;

  const seo = srcOn('seo-performance')
    ? { summary: seoAudit?.summary || '', topics: seoAudit?.topics || [] }
    : null;

  const knowledgeBase = srcOn('knowledge-base')
    ? await getKnowledgeBaseRuntimeContext({
        clientId,
        query: buildKnowledgeBaseRuntimeQuery({
          intent: 'social strategy content angles brand voice offer claims ICP positioning product proof points',
          websiteUrl: ccData.sourceInputs?.websiteUrl || ccData.websiteUrl || leadgen.website || '',
          clientName: leadgen.businessName || leadgen.name || ccData.businessName || ccData.displayName || '',
          brandOverview: dsData.snapshot?.brandOverview || {},
          sourceInputs: ccData.sourceInputs || {},
        }),
        topK: 5,
        charCap: 3400,
      })
    : null;
  const clientBrainContext = srcOn('client-brain')
    ? await loadClientBrainContext(clientId, { useFor: 'socialPosts', maxChars: 2500 })
    : '';

  const brandIncluded = srcOn('brand-snapshot');
  const includedCardFindings = srcOn('analyzer') ? cardFindings : {};

  // Build StrategyContext
  const now = new Date().toISOString();
  const startDate = now.slice(0, 10);

  const signals = {
    weather: { enabled: Boolean(clientConfig.signals?.weather?.enabled), forecast: [] },
    events: { enabled: Boolean(clientConfig.signals?.events?.enabled), items: [] },
    holidays: { enabled: clientConfig.signals?.holidays?.enabled !== false },
  };

  // Resolve signals server-side
  try {
    const { getWeatherForecast } = await import('./signal-providers/weather.js');
    const { getLocalEvents } = await import('./signal-providers/events.js');
    const { getHolidays } = await import('./signal-providers/holidays.js');

    const [weatherResult, eventsResult, holidaysResult] = await Promise.all([
      getWeatherForecast({ location, enabled: signals.weather.enabled }),
      getLocalEvents({
        enabled: signals.events.enabled,
        events: dsData.strategyBuilder?.events || [],
      }),
      getHolidays({
        vertical,
        enabled: signals.holidays.enabled,
        startDate,
        days: Number(clientConfig.days) || 30,
      }),
    ]);

    signals.weather = weatherResult;
    signals.events = eventsResult;
    signals.holidays = holidaysResult;
  } catch (err) {
    // Non-fatal — continue without signals
    console.error('[strategy-builder/generate] signal provider error:', err.message);
  }

  // Campaign Setup — sanitize server-side (never trust client-supplied config).
  const rawCampaign = (clientConfig.campaign && typeof clientConfig.campaign === 'object')
    ? clientConfig.campaign
    : {};
  const OBJECTIVES = ['awareness', 'bookings', 'foot-traffic', 'leads', 'promotions', 'community'];
  const EMOJI = ['none', 'sparing', 'liberal'];
  const timeOk = (t) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || '')) ? String(t) : '');
  const campaign = {
    objective: OBJECTIVES.includes(rawCampaign.objective) ? rawCampaign.objective : '',
    ctaText: String(rawCampaign.ctaText || '').slice(0, 80),
    ctaUrl: String(rawCampaign.ctaUrl || '').slice(0, 300),
    postTime: timeOk(rawCampaign.postTime),
    postTime2: timeOk(rawCampaign.postTime2),
    guardrails: String(rawCampaign.guardrails || '').slice(0, 500),
    emojiPolicy: EMOJI.includes(rawCampaign.emojiPolicy) ? rawCampaign.emojiPolicy : 'none',
    maxHashtags: Math.max(0, Math.min(5, Number(rawCampaign.maxHashtags) ?? 2)),
    promotions: (Array.isArray(rawCampaign.promotions) ? rawCampaign.promotions : [])
      .filter((p) => p && p.label && p.endDate)
      .slice(0, 20)
      .map((p, i) => ({
        id: String(p.id || `promo-${i}`).slice(0, 60),
        label: String(p.label).slice(0, 80),
        endDate: String(p.endDate).slice(0, 30),
      })),
  };
  const editorial = normalizeEditorialStrategyConfig(clientConfig.editorial || dsData.strategyBuilder?.config?.editorial || {});

  const ctx = {
    client: {
      id: clientId,
      name: leadgen.businessName || leadgen.name || ccData.businessName || 'Client',
      vertical,
      location,
      hours: leadgen.hours || '',
      closedDays: leadgen.closedDays || [],
      offers: leadgen.offers || [],
    },
    brand: brandIncluded
      ? {
          voice: visualIdentity.voice || '',
          tone: visualIdentity.tone || '',
          palette: visualIdentity.palette || [],
          fonts: visualIdentity.fonts || {},
          styleGuide: {
            summary: visualIdentity.styleGuide?.summary || visualIdentity.summary || '',
          },
        }
      : { voice: '', tone: '', palette: [], fonts: {}, styleGuide: { summary: '' } },
    brief,
    intelligence,
    media,
    seo,
    knowledgeBase: knowledgeBase?.available
      ? {
          block: knowledgeBase.block,
          sources: knowledgeBase.sources,
        }
      : null,
    clientBrain: clientBrainContext ? { context: clientBrainContext } : null,
    cardFindings: includedCardFindings,
    campaign,
    editorial,
    signals,
    config: {
      startDate,
      days: Math.max(7, Math.min(90, Number(clientConfig.days) || 30)),
      postsPerDay: Math.max(1, Math.min(5, Number(clientConfig.postsPerDay) || 1)),
      baselineMixPct: Math.max(10, Math.min(60, Number(clientConfig.baselineMixPct) || 40)),
      rampAggressiveness: Math.max(0, Math.min(1, Number(clientConfig.rampAggressiveness) ?? 0.5)),
    },
    now,
  };

  const editorialRecommendation = buildDailyEditorialRecommendation({
    editorial,
    ctx,
    now,
  });
  ctx.editorialRecommendation = editorialRecommendation;
  ctx.editorialRecommendationText = formatEditorialRecommendationForPrompt(editorialRecommendation);

  // Build xGrowth context from Marketing Brief signals
  try {
    const { inferXObjective, getActiveProfileId } = await import('../x-growth/index.js');
    ctx.xGrowth = {
      algorithmProfileVersion: getActiveProfileId(),
      ...inferXObjective(ctx),
    };
  } catch (err) {
    console.error('[strategy-builder/generate] xGrowth inference error:', err.message);
    ctx.xGrowth = null;
  }

  // Two-phase build: today strategy from brief signals, then week calendar seeded by it.
  let todayStrategy = null;
  let plan;
  try {
    const { buildTodayStrategy, buildStrategy } = await import('./build-strategy.js');
    try {
      todayStrategy = await buildTodayStrategy(ctx);
    } catch (err) {
      // Non-fatal — week generation continues without today context
      console.error('[strategy-builder/generate] today strategy error:', err.message);
    }
    plan = await buildStrategy(ctx, todayStrategy);
  } catch (err) {
    return { ok: false, status: 500, error: `Strategy generation failed: ${err.message}` };
  }

  // Score every item server-side and merge xStrategy
  try {
    const { scoreXPost } = await import('../x-growth/index.js');
    const profileVersion = ctx.xGrowth?.algorithmProfileVersion || null;
    plan.items = plan.items.map((item) => {
      const scored = scoreXPost(item.content || '', {
        postTypeHint: item.xStrategy?.postType || null,
        mediaType: item.mediaType || 'none',
        objective: ctx.xGrowth?.objective,
      });
      return {
        ...item,
        xStrategy: {
          // LLM-written fields (postType, targetAction, hypothesis) take priority;
          // server always provides numeric scores and profile version.
          postType: item.xStrategy?.postType || scored.postType,
          targetAction: item.xStrategy?.targetAction || scored.targetAction,
          hypothesis: item.xStrategy?.hypothesis || scored.hypothesis,
          ...scored,
          algorithmProfileVersion: profileVersion,
        },
      };
    });
  } catch (err) {
    console.error('[strategy-builder/generate] xStrategy scoring error:', err.message);
  }

  // Attach today strategy to the plan before saving
  if (todayStrategy) plan.today = todayStrategy;
  if (editorialRecommendation) plan.editorialRecommendation = editorialRecommendation;
  if (knowledgeBase?.available) {
    plan.knowledgeBaseSources = knowledgeBase.sources || [];
  }

  // Save plan to Firestore
  try {
    await fb.adminDb.collection('dashboard_state').doc(clientId).set(
      {
        strategyBuilder: {
          lastPlan: plan,
          updatedAt: fb.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
  } catch (err) {
    // Non-fatal — return plan even if save fails
    console.error('[strategy-builder/generate] Firestore save error:', err.message);
  }

  return { ok: true, plan };
}
