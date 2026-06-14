import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Discovery + quick-audit + scoring runs synchronously here. SerpAPI is fast
// (~2s per query) but quick-audit hits each prospect's homepage so total time
// scales with maxPerRun. Cap maxDuration high enough to cover ~20 prospects.
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const fb                    = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { logUsage, computeFlatCost } = require('../../../../api/_lib/usage-logger.cjs');

import { discoverFromCampaign } from '../../../../features/leadgen/prospector.js';
import { quickSiteAudit }       from '../../../../features/leadgen/quick-auditor.js';
import { scoreProspect }        from '../../../../features/leadgen/scorer.js';
import { VERTICAL_MAP }         from '../../../../features/leadgen/vertical-map.js';
import { DEFAULT_THRESHOLDS }   from '../../../../features/leadgen/constants.js';

// Resolve a US ZIP code to lat/lng using the free Census Bureau geocoder.
// Returns null on any failure — discovery continues without coordinates.
async function geocodeZip(zip) {
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/address?zip=${encodeURIComponent(zip)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const json = await res.json();
    const match = json?.result?.addressMatches?.[0];
    if (!match?.coordinates) return null;
    // Census API: x = longitude, y = latitude
    return { lat: match.coordinates.y, lng: match.coordinates.x };
  } catch {
    return null;
  }
}

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

async function loadCampaign(adminDb, campaignId) {
  const snap = await adminDb.collection('leadgen_configs').doc('discovery').get();
  if (!snap.exists) return null;
  const campaigns = snap.data()?.campaigns || [];
  return campaigns.find((c) => c.id === campaignId) || null;
}

async function loadScoringConfig(adminDb) {
  const snap = await adminDb.collection('leadgen_configs').doc('scoring').get();
  return snap.exists ? snap.data() : null;
}

// POST /api/leadgen/discover
//   body: { campaignId: string }
//   → runs SerpAPI discovery, then quick-audit + scoring on each new prospect,
//     persists everything, and returns a summary.
export async function POST(request) {
  // Auth
  let decoded;
  try {
    decoded = await verifyAdminRequest(makeReqShim(request));
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // Body — accept either { campaignId } (saved campaign) or { campaign } (ad-hoc).
  let body;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const campaignId = String(body?.campaignId || '').trim();
  const adhocCampaign = body?.campaign && typeof body.campaign === 'object' ? body.campaign : null;
  if (!campaignId && !adhocCampaign) {
    return NextResponse.json({ error: 'Provide campaignId (saved campaign) or campaign (ad-hoc run).' }, { status: 400 });
  }

  // Env
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: 'SERPAPI_KEY not set. Add it to your environment to enable discovery.',
    }, { status: 412 });
  }

  // Resolve campaign — saved or ad-hoc.
  let campaign;
  let isAdhoc = false;
  if (adhocCampaign) {
    isAdhoc = true;
    campaign = {
      enabled: true,
      maxProspectsPerRun: 20,
      ...adhocCampaign,
      id: adhocCampaign.id || `adhoc-${Date.now().toString(36)}`,
    };
    if (!campaign.vertical) {
      return NextResponse.json({ error: 'Ad-hoc campaign requires a vertical.' }, { status: 400 });
    }
    if (!Array.isArray(campaign.queries) || !campaign.queries.length) {
      return NextResponse.json({ error: 'Ad-hoc campaign requires at least one query.' }, { status: 400 });
    }
  } else {
    campaign = await loadCampaign(fb.adminDb, campaignId);
    if (!campaign) {
      return NextResponse.json({ error: `Campaign not found: ${campaignId}` }, { status: 404 });
    }
    if (campaign.enabled === false) {
      return NextResponse.json({ error: `Campaign disabled: ${campaignId}` }, { status: 409 });
    }
  }

  // Load operator overrides up-front so both discovery and scoring see them.
  const scoringCfg = await loadScoringConfig(fb.adminDb);
  const weightsOverride      = scoringCfg?.weights || null;
  const geoBoostOverride     = scoringCfg?.geoBoost || null;
  const qualityFloorOverride = scoringCfg?.discoveryFloor || null;
  const thresholds           = { ...DEFAULT_THRESHOLDS, ...(scoringCfg?.thresholds || {}) };

  // Geocode ZIP → lat/lng so SerpAPI can use it as a geographic anchor via the
  // `ll` param and the prospector can post-filter by distance.
  if (campaign.location?.zip && campaign.location.lat == null) {
    const coords = await geocodeZip(campaign.location.zip);
    if (coords) {
      campaign = { ...campaign, location: { ...campaign.location, ...coords } };
    }
  }

  // 1) Discover via SerpAPI + persist new prospects (stage='discovered')
  const discovery = await discoverFromCampaign({
    campaign,
    adminDb: fb.adminDb,
    verticalMap: VERTICAL_MAP,
    apiKey,
    maxPerRun: campaign.maxProspectsPerRun || 20,
    qualityFloorOverride,
  });

  // Log SerpAPI usage — billed per successful query (see prospector.queriesRun).
  if (discovery.queriesRun > 0) {
    const serpModel = 'serpapi-google-maps';
    await logUsage({
      module:   'leadgen',
      action:   'discover',
      provider: 'serpapi',
      model:    serpModel,
      calls:    discovery.queriesRun,
      costUsd:  computeFlatCost({ model: serpModel, calls: discovery.queriesRun }),
      metadata: {
        campaignId: campaign.id,
        vertical:   campaign.vertical || null,
        found:      discovery.found,
        persisted:  discovery.persisted,
      },
    });
  }

  // 2) Quick-audit + score each newly persisted prospect
  const auditResults = [];
  let belowFloorDiscarded = 0;
  for (const p of discovery.prospects) {
    const audit = await quickSiteAudit(p.website);
    const scoreResult = scoreProspect({ prospect: p, audit, weightsOverride, geoBoostOverride });

    // Below the warm floor (default 55) → delete the doc that was just
    // persisted by the prospector. Operator philosophy: surface only
    // legitimate warm-to-hot signals; keeping cold rows would clutter the
    // dashboard and waste reads.
    if (scoreResult.score < thresholds.minimumScore) {
      await fb.adminDb.collection('leadgen_prospects').doc(p.placeId).delete();
      belowFloorDiscarded += 1;
      continue;
    }

    await fb.adminDb.collection('leadgen_prospects').doc(p.placeId).set({
      stage: 'scored',
      // Hoist scraped email to a top-level field so the UI / outreach phase
      // doesn't have to dig into quickAudit. Falsy when nothing was found.
      email: audit.emailFound || null,
      score: scoreResult.score,
      baseScore: scoreResult.baseScore,
      geoTier: scoreResult.geo?.tier ?? null,
      geoBoost: scoreResult.geo?.boost ?? 0,
      geoLabel: scoreResult.geo?.label ?? null,
      scoreBreakdown: scoreResult.breakdown,
      scoreGrade: scoreResult.grade,
      scoreTier: scoreResult.tier,
      scoreRecommendation: scoreResult.recommendation,
      quickAudit: {
        siteScore: audit.siteScore,
        loadTimeMs: audit.loadTimeMs,
        platform: audit.platform,
        deficiencies: audit.deficiencies,
        hasJsonLd: audit.hasJsonLd,
        hasOgTags: audit.hasOgTags,
        hasMetaDescription: audit.hasMetaDescription,
        isResponsive: audit.isResponsive,
        isHttps: audit.isHttps,
        hasBlog: audit.hasBlog,
        blogLinksCount: audit.blogLinksCount,
        hasSocial: audit.hasSocial,
        socialLinksCount: audit.socialLinksCount,
        socialPlatforms: audit.socialPlatforms || [],
        hasContactForm: audit.hasContactForm,
        hasEmail: audit.hasEmail,
        emailFound: audit.emailFound,
        error: audit.error,
        scannedAt: new Date().toISOString(),
      },
    }, { merge: true });

    auditResults.push({
      placeId: p.placeId,
      score: scoreResult.score,
      tier: scoreResult.tier,
    });
  }

  // 3) Stamp the campaign with lastRunAt — only for saved campaigns; ad-hoc
  // runs aren't tracked in leadgen_configs.
  if (!isAdhoc) {
    const cfgRef = fb.adminDb.collection('leadgen_configs').doc('discovery');
    const cfgSnap = await cfgRef.get();
    if (cfgSnap.exists) {
      const data = cfgSnap.data();
      const campaigns = (data?.campaigns || []).map((c) =>
        c.id === campaignId ? { ...c, lastRunAt: new Date().toISOString() } : c,
      );
      await cfgRef.set({ campaigns }, { merge: true });
    }
  }

  return NextResponse.json({
    ok: true,
    campaignId: campaign.id,
    isAdhoc,
    discovery: {
      found: discovery.found,
      persisted: discovery.persisted,
      skippedDuplicates: discovery.skippedDuplicates,
      skippedJunk: discovery.skippedJunk ?? 0,
      skippedOutOfArea: discovery.skippedOutOfArea ?? 0,
      errors: discovery.errors,
    },
    scored: auditResults.length,
    belowFloorDiscarded,
    sample: auditResults.slice(0, 5),
  });
}
