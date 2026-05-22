import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');

import { normalizeVertical } from '../../../../../features/strategy-builder/normalize-vertical.js';
import {
  buildKnowledgeBaseRuntimeQuery,
  getKnowledgeBaseRuntimeContext,
} from '../../../../../features/knowledge-base/pipeline-context.js';

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

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) {
    const err = new Error('No user record.');
    err.status = 404;
    throw err;
  }
  if (!context.clientId) {
    const err = new Error('No clientId on user record.');
    err.status = 404;
    throw err;
  }
  return { decoded, context };
}

export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const clientId = context.clientId;
  const clientConfig = body?.config || {};

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
    return json({ error: `Firestore error: ${err.message}` }, 500);
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
    return json(
      { error: 'No category set. Set one in the Market Category card, or pass config.vertical.' },
      400
    );
  }

  // Resolve location from leadgen data
  const leadgen = dsData.leadgen || {};
  const visualIdentity = dsData.snapshot?.visualIdentity || {};
  const scribeBrief = dsData.snapshot?.scribe?.brief || {};
  const scribeCards = dsData.scribe?.cards || {};
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
    return json(
      { error: 'Run Marketing Brief first — day strategy requires it. The brief provides the live signals that drive today\'s strategy and seed the week plan.' },
      400
    );
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
    const { getWeatherForecast } = await import('../../../../../features/strategy-builder/signal-providers/weather.js');
    const { getLocalEvents } = await import('../../../../../features/strategy-builder/signal-providers/events.js');
    const { getHolidays } = await import('../../../../../features/strategy-builder/signal-providers/holidays.js');

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
    cardFindings: includedCardFindings,
    campaign,
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

  // Two-phase build: today strategy from brief signals, then week calendar seeded by it.
  let todayStrategy = null;
  let plan;
  try {
    const { buildTodayStrategy, buildStrategy } = await import('../../../../../features/strategy-builder/build-strategy.js');
    try {
      todayStrategy = await buildTodayStrategy(ctx);
    } catch (err) {
      // Non-fatal — week generation continues without today context
      console.error('[strategy-builder/generate] today strategy error:', err.message);
    }
    plan = await buildStrategy(ctx, todayStrategy);
  } catch (err) {
    return json({ error: `Strategy generation failed: ${err.message}` }, 500);
  }

  // Attach today strategy to the plan before saving
  if (todayStrategy) plan.today = todayStrategy;
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

  return json({ ok: true, plan });
}
