// Lead Gen — Prospector
// Server-only. Calls SerpAPI's Google Maps endpoint, dedupes against existing
// Firestore prospects by place_id, and persists new prospects to Firestore.
// Source: docs/LEAD_GEN_PIPELINE_PLAN.md §1.1 / §1.3.

import { DISCOVERY_QUALITY_FLOOR } from './constants.js';

const SERPAPI_BASE = 'https://serpapi.com/search.json';

// Haversine distance in miles between two lat/lng points.
function haversineDistanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Drop prospects that are more than maxMiles from the campaign ZIP centroid.
// Only applied when the campaign has been geocoded (lat/lng resolved).
// Skips filtering if either side has no coordinates (fail-open).
function passesGeoFilter(prospect, campaign, maxMiles = 50) {
  if (campaign.location?.lat == null || campaign.location?.lng == null) return true;
  if (prospect.lat == null || prospect.lng == null) return true;
  return haversineDistanceMiles(
    campaign.location.lat, campaign.location.lng,
    prospect.lat, prospect.lng,
  ) <= maxMiles;
}

// Drop obvious junk before we spend a single audit fetch on it. Rule-of-thumb
// only — anything more nuanced belongs in the scorer.
function passesQualityFloor(prospect, override = null) {
  const f = { ...DISCOVERY_QUALITY_FLOOR, ...(override || {}) };
  if (f.skipPermanentlyClosed && prospect.businessStatus === 'CLOSED_PERMANENTLY') return false;
  if ((prospect.rating ?? 0)      < f.minRating)  return false;
  if ((prospect.reviewCount ?? 0) < f.minReviews) return false;
  return true;
}

function classifyVerticalFromCategories(categories, verticalMap) {
  if (!Array.isArray(categories) || !categories.length) return null;
  for (const [key, def] of Object.entries(verticalMap)) {
    for (const cat of categories) {
      if (def.gbpCategories.some((c) => c.toLowerCase() === String(cat).toLowerCase())) {
        return {
          vertical: key,
          subVertical: def.subVerticalFromCategory?.[cat] || null,
        };
      }
    }
  }
  return null;
}

// Map a SerpAPI google_maps result to our prospect shape.
function mapSerpResultToProspect(r, campaign, verticalMap) {
  const placeId = r.place_id || r.data_id || null;
  if (!placeId) return null;

  const categories = r.categories || (r.type ? [r.type] : []);
  const classification = classifyVerticalFromCategories(categories, verticalMap);

  return {
    placeId,
    name: r.title || null,
    vertical: campaign.vertical || classification?.vertical || null,
    subVertical: classification?.subVertical || null,

    phone: r.phone || null,
    email: null,
    website: r.website || r.link || null,
    address: r.address || null,
    lat: r.gps_coordinates?.latitude  ?? null,
    lng: r.gps_coordinates?.longitude ?? null,

    rating:          typeof r.rating  === 'number' ? r.rating  : null,
    reviewCount:     typeof r.reviews === 'number' ? r.reviews : 0,
    priceLevel:      typeof r.price   === 'string' ? r.price.length : (r.price_level ?? 0),
    businessStatus:  r.operating_hours ? 'OPERATIONAL' : (r.permanently_closed ? 'CLOSED_PERMANENTLY' : 'OPERATIONAL'),
    hoursComplete:   Boolean(r.hours || r.operating_hours),
    photosCount:     Array.isArray(r.images) ? r.images.length : (r.photos_link ? 1 : 0),
    gbpCompleteness: null,

    campaignId: campaign.id,
    discoveredAt: new Date().toISOString(),
    source: 'serpapi_google_maps',
    starred: false,

    stage: 'discovered',
    score: null,
    scoreBreakdown: null,
    enrichedAt: null,
    auditedAt: null,
    previewUrl: null,
    contactedAt: null,
    outcome: null,
  };
}

// Calls SerpAPI for a single query and returns raw map results.
async function fetchSerpResults({ query, lat, lng, radiusMeters, apiKey }) {
  const params = new URLSearchParams({
    engine: 'google_maps',
    type: 'search',
    q: query,
    api_key: apiKey,
  });
  if (typeof lat === 'number' && typeof lng === 'number') {
    // SerpAPI uses an "ll" param: @lat,lng,zoom — zoom 14 ≈ ~3-mile radius
    const zoom = radiusMeters && radiusMeters > 8000 ? 12 : 14;
    params.set('ll', `@${lat},${lng},${zoom}z`);
  }
  const res = await fetch(`${SERPAPI_BASE}?${params.toString()}`, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`SerpAPI HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.error) throw new Error(`SerpAPI: ${json.error}`);
  return json.local_results || json.places_results || [];
}

// ── Public API ──────────────────────────────────────────────────────────────

// discoverFromCampaign(campaign, { adminDb, verticalMap, apiKey, maxPerRun })
//   → { found, persisted, skippedDuplicates, errors, prospects }
//
// `adminDb` is the firebase-admin Firestore instance. We dedupe by place_id
// (the doc ID) using a single batched read of existing IDs.
export async function discoverFromCampaign({
  campaign,
  adminDb,
  verticalMap,
  apiKey,
  maxPerRun = 20,
  qualityFloorOverride = null,
}) {
  if (!campaign) throw new Error('discoverFromCampaign: campaign is required');
  if (!apiKey)   throw new Error('discoverFromCampaign: SERPAPI_KEY is required');
  if (!adminDb)  throw new Error('discoverFromCampaign: adminDb is required');

  const queries = Array.isArray(campaign.queries) && campaign.queries.length
    ? campaign.queries
    : [`${campaign.vertical} near ${campaign.location?.label || ''}`.trim()];

  const errors = [];
  const rawByPlaceId = new Map();
  // Count of SerpAPI queries that returned successfully — these are the billable ones.
  let queriesRun = 0;

  for (const q of queries) {
    if (rawByPlaceId.size >= maxPerRun) break;
    try {
      const results = await fetchSerpResults({
        query: q,
        lat: campaign.location?.lat,
        lng: campaign.location?.lng,
        radiusMeters: (campaign.location?.radiusMiles || 3) * 1609,
        apiKey,
      });
      queriesRun += 1;
      for (const r of results) {
        const mapped = mapSerpResultToProspect(r, campaign, verticalMap);
        if (mapped && !rawByPlaceId.has(mapped.placeId)) {
          rawByPlaceId.set(mapped.placeId, mapped);
          if (rawByPlaceId.size >= maxPerRun) break;
        }
      }
    } catch (err) {
      errors.push({ query: q, error: err?.message || String(err) });
    }
  }

  const allCandidates = Array.from(rawByPlaceId.values());

  // Apply discovery quality floor BEFORE dedupe/persistence so junk listings
  // never hit Firestore.
  const qualityPassed = allCandidates.filter((p) => passesQualityFloor(p, qualityFloorOverride));
  const skippedJunk = allCandidates.length - qualityPassed.length;

  // Drop prospects outside the campaign ZIP radius (when geocoded coords are available).
  const candidates = qualityPassed.filter((p) => passesGeoFilter(p, campaign));
  const skippedOutOfArea = qualityPassed.length - candidates.length;

  if (!candidates.length) {
    return {
      found: allCandidates.length,
      persisted: 0,
      skippedDuplicates: 0,
      skippedJunk,
      skippedOutOfArea,
      queriesRun,
      errors,
      prospects: [],
    };
  }

  // Dedupe against existing prospects (Firestore doc IDs are place_ids).
  const collection = adminDb.collection('leadgen_prospects');
  const idChunks = [];
  for (let i = 0; i < candidates.length; i += 10) idChunks.push(candidates.slice(i, i + 10));
  const existingIds = new Set();
  for (const chunk of idChunks) {
    const snapshot = await collection
      .where('placeId', 'in', chunk.map((p) => p.placeId))
      .get();
    snapshot.forEach((doc) => existingIds.add(doc.id));
  }

  const fresh = candidates.filter((p) => !existingIds.has(p.placeId));
  const skippedDuplicates = candidates.length - fresh.length;

  // Persist in batches of 500 (Firestore batch limit).
  let persisted = 0;
  for (let i = 0; i < fresh.length; i += 500) {
    const slice = fresh.slice(i, i + 500);
    const batch = adminDb.batch();
    for (const p of slice) batch.set(collection.doc(p.placeId), p);
    await batch.commit();
    persisted += slice.length;
  }

  return {
    found: allCandidates.length,
    persisted,
    skippedDuplicates,
    skippedJunk,
    skippedOutOfArea,
    queriesRun,
    errors,
    prospects: fresh,
  };
}
