// Lead Gen — Geo Priority
// Added to the composite lead score so prospects closer to home rank higher
// when scores are similar. Score still dominates; geo nudges.
// Source: operator config (see docs/LEAD_GEN_PIPELINE_PLAN.md + CLAUDE.md).

import { GEO_PRIORITY } from './constants.js';

// Home-area ZIPs (DeKalb proper + Sycamore + Genoa).
const HOME_ZIPS = new Set(['60115', '60150', '60178']);

// Chicagoland heuristic — any Illinois ZIP starting with "60" that isn't in
// the home set. Covers Cook, DuPage, Lake, Will, Kane, McHenry counties.
function isChicagolandZip(zip) {
  return /^60\d{3}$/.test(zip) && !HOME_ZIPS.has(zip);
}

// Cities to recognize when ZIP isn't extractable (defensive fallback).
const HOME_CITY_TOKENS = ['dekalb', 'sycamore', 'genoa'];
const CHICAGOLAND_CITY_TOKENS = [
  'chicago', 'evanston', 'oak park', 'naperville', 'aurora', 'schaumburg',
  'skokie', 'joliet', 'arlington heights', 'wheaton', 'cicero', 'des plaines',
  'orland park', 'tinley park', 'palatine', 'mount prospect', 'wheeling',
  'oak lawn', 'berwyn', 'bolingbrook', 'downers grove', 'glenview',
  'highland park', 'elgin', 'waukegan',
];

function extractStateZip(address) {
  if (!address) return { state: null, zip: null };
  const m = String(address).match(/,\s*([A-Z]{2})\s+(\d{5})/);
  return m ? { state: m[1], zip: m[2] } : { state: null, zip: null };
}

// Returns one of: 'home' | 'metro' | 'state' | 'other'
export function geoTier({ address }) {
  const { state, zip } = extractStateZip(address);
  const lower = String(address || '').toLowerCase();

  if (zip && HOME_ZIPS.has(zip)) return 'home';
  if (HOME_CITY_TOKENS.some((t) => lower.includes(`, ${t},`))) return 'home';

  if (zip && isChicagolandZip(zip)) return 'metro';
  if (CHICAGOLAND_CITY_TOKENS.some((t) => lower.includes(`, ${t},`))) return 'metro';

  if (state === 'IL') return 'state';
  return 'other';
}

const TIER_LABEL = {
  home:  'DeKalb area',
  metro: 'Chicagoland',
  state: 'Illinois',
  other: 'Rest of US',
};

// Returns { tier, boost, label }. `boostOverride` lets the operator tune the
// per-tier boost values via the Settings modal without code changes.
export function geoPriority({ address, boostOverride = null }) {
  const tier = geoTier({ address });
  const boostTable = boostOverride
    ? { ...GEO_PRIORITY.boost, ...boostOverride }
    : GEO_PRIORITY.boost;
  return {
    tier,
    boost: boostTable[tier] ?? 0,
    label: TIER_LABEL[tier],
  };
}
