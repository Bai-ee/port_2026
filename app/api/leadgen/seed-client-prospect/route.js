import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Seeds a synthetic leadgen_prospects/client:{clientId} doc from the signed-in
// user's dashboard_state + clients records, so the per-client dashboard cards
// (Prepare Brief / Generate Mockup / Generate Site) can reuse the existing
// /api/leadgen/* routes unchanged.
//
// Idempotent — re-runs merge over existing data without clobbering generation.
//
// Returns: { placeId, seeded, vertical, website, name }

const require = createRequire(import.meta.url);
const fb                    = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function jerror(message, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
}

function pickName(client, dashboardState) {
  return (
    client?.businessName
    || client?.name
    || dashboardState?.brandOverview?.name
    || dashboardState?.brandOverview?.headline
    || dashboardState?.snapshot?.businessName
    || 'Client'
  );
}

function pickWebsite(client, dashboardState) {
  return (
    client?.websiteUrl
    || dashboardState?.snapshot?.websiteUrl
    || dashboardState?.client?.websiteUrl
    || null
  );
}

// Loose mapping from intake industry strings → leadgen vertical keys.
// Falls back to 'default' (which the leadgen prompts handle gracefully).
const INDUSTRY_TO_VERTICAL = [
  [/lawyer|attorney|law firm|legal/i,                'lawyer'],
  [/dentist|dental|orthodont/i,                      'dental'],
  [/plumb|hvac|electric|roof|landscap|cleaning|pest/i, 'home_services'],
  [/restaurant|cafe|bistro|eatery|bar|pub|food/i,    'restaurant'],
  [/spa|aesthetic|cosmetic|botox|skin care|med ?spa/i, 'med_spa'],
  [/auto repair|mechanic|body shop|tire/i,           'auto_repair'],
  [/auto|dealer|car/i,                               'auto_shop'],
  [/chiro|chiropract/i,                              'chiropractor'],
  [/gym|fitness|yoga|crossfit|pilates/i,             'gym_fitness'],
  [/real estate|realtor|broker|property/i,           'real_estate'],
  [/wedding|event|venue|caterer/i,                   'wedding_event'],
  [/pet|vet|grooming|kennel|dog walk/i,              'pet_services'],
];

function inferVertical(client, dashboardState) {
  const haystack = [
    client?.industry,
    dashboardState?.scoutConfig?.industry,
    dashboardState?.brandOverview?.industry,
    dashboardState?.brandOverview?.businessModel,
    dashboardState?.brandOverview?.summary,
    dashboardState?.brandOverview?.headline,
  ].filter(Boolean).join(' ');
  if (!haystack) return 'default';
  for (const [re, key] of INDUSTRY_TO_VERTICAL) {
    if (re.test(haystack)) return key;
  }
  return 'default';
}

/**
 * POST /api/leadgen/seed-client-prospect
 *
 * No body required. Returns the placeId that all subsequent /api/leadgen/*
 * routes can be called against.
 */
export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return jerror(err instanceof Error ? err.message : 'Unauthorized.', 401);
  }

  const userSnap = await fb.adminDb.collection('users').doc(decoded.uid).get();
  if (!userSnap.exists) return jerror('No user record.', 404);
  const clientId = userSnap.data()?.clientId || null;
  if (!clientId) return jerror('No clientId on user record.', 404);

  const [stateSnap, clientSnap] = await Promise.all([
    fb.adminDb.collection('dashboard_state').doc(clientId).get(),
    fb.adminDb.collection('clients').doc(clientId).get(),
  ]);
  const dashboardState = stateSnap.exists ? stateSnap.data() : {};
  const client         = clientSnap.exists ? clientSnap.data() : {};

  const name     = pickName(client, dashboardState);
  const website  = pickWebsite(client, dashboardState);
  const vertical = inferVertical(client, dashboardState);

  if (!website) {
    return jerror('No website URL on client record — set one before seeding.', 409);
  }

  const placeId  = `client:${clientId}`;
  const ref      = fb.adminDb.collection('leadgen_prospects').doc(placeId);
  const existing = await ref.get();
  const seeded   = !existing.exists;

  // Brand guide carry-over so prepare-brief can use uploaded brand assets.
  const brandGuideV2 = dashboardState?.userUploads?.brandSystem?.brandGuideV2 || null;

  const baseDoc = {
    // Synthetic-doc tagging — used by admin LeadGen list to filter these out.
    kind:         'client-self',
    clientId,
    ownerUid:     decoded.uid,

    // Standard prospect fields used by /api/leadgen/* routes.
    name,
    website,
    vertical,
    stage:        existing.data()?.stage || 'audited',
    starred:      existing.data()?.starred || false,

    // Carry uploaded brand assets so prepare-brief can use them.
    userUploads:  { brandSystem: { brandGuideV2 } },

    // Preserve any prior generation output across re-seeds.
    generation:   existing.data()?.generation || {},

    updatedAt:    new Date().toISOString(),
    ...(seeded ? { createdAt: new Date().toISOString() } : {}),
  };

  await ref.set(baseDoc, { merge: true });

  return NextResponse.json(
    { placeId, seeded, vertical, website, name },
    { headers: { 'cache-control': 'no-store' } }
  );
}
