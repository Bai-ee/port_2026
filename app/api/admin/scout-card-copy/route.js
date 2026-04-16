import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { getDashboardBootstrap } = require('../../../../api/_lib/client-provisioning.cjs');
const { CARD_CONTRACT } = require('../../../../features/scout-intake/card-contract');
const { CARD_STATIC_COPY } = require('../../../../features/scout-intake/card-static-copy');

// Admin · Scout Card Copy
//
// Returns the LIVE rendered copy + raw intake data per card, for the signed-in
// admin's client. Used by the Data Map "Rendered copy (live)" block so the
// reviewer can see what's actually flowing into each card without re-running
// the pipeline.
//
// Response shape:
// {
//   clientId,
//   lastRunAt,
//   cards: {
//     [cardId]: {
//       scribe:       { short, expanded }  | null,   // from dash.scribe.cards
//       rawValue:     any                   | null,   // resolved from card.sourceField
//       fallbackValue: any                  | null,   // resolved from card.fallbackField
//       present:      boolean,                        // true if either rawValue or fallback has data
//       sourceField:  string | null,
//       fallbackField: string | null,
//     }
//   },
//   dataSnapshot: {
//     snapshot, signals, strategy, outputsPreview, siteMeta,
//     scribeBrief, intelligenceSeoAudit, hasScribe
//   }
// }

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

// Firestore Timestamps serialize as { _seconds, _nanoseconds } which React
// can't render. Recursively normalize them to ISO strings.
function deepSerialize(v) {
  if (v == null) return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v === 'object' && typeof v._seconds === 'number') {
    return new Date(v._seconds * 1000 + Math.floor((v._nanoseconds || 0) / 1e6)).toISOString();
  }
  if (Array.isArray(v)) return v.map(deepSerialize);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = deepSerialize(val);
    return out;
  }
  return v;
}

// Resolve a dotted path like "snapshot.brandOverview.industry" or
// "strategy.contentAngles[0]" or "signals.core[top]" against the live data.
// Returns undefined when the path can't resolve.
function resolvePath(root, pathStr) {
  if (!pathStr || root == null) return undefined;

  // Convert bracket accesses into dot segments: foo[0].bar → foo.0.bar
  const normalized = String(pathStr)
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\[top\]/g, '.__TOP__');

  const parts = normalized.split('.').filter(Boolean);

  let cur = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (part === '__TOP__') {
      // Pick the highest-relevance item from a core-signals style array.
      if (!Array.isArray(cur)) return undefined;
      if (!cur.length) return undefined;
      const rank = { high: 3, medium: 2, low: 1 };
      cur = [...cur].sort((a, b) => (rank[b?.relevance] || 0) - (rank[a?.relevance] || 0))[0];
      continue;
    }
    cur = cur[part];
  }
  return cur;
}

function hasData(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

// Best-effort "root of the path" resolution lookup. Path roots we expect:
//   snapshot, signals, strategy, outputsPreview, siteMeta, systemPreview,
//   intelligence, evidence, externalSignals, scoutConfig, userContext
// The live dashboard_state carries most but not all of these; we stitch the
// rest in from adjacent stores.
function buildResolveRoot({ dash, bootstrap }) {
  return {
    snapshot:        dash?.snapshot         ?? null,
    signals:         dash?.signals          ?? null,
    strategy:        dash?.strategy         ?? null,
    outputsPreview:  dash?.outputsPreview   ?? null,
    siteMeta:        dash?.siteMeta         ?? null,
    systemPreview:   dash?.systemPreview    ?? null,
    evidence:        dash?.evidence         ?? null,
    intelligence: {
      pagespeed: bootstrap?.intelligence?.dashboardSeoAudit ?? dash?.seoAudit ?? null,
    },
    externalSignals: dash?.externalSignals  ?? null,
    scoutConfig:     dash?.scoutConfig      ?? null,
    userContext:     dash?.userContext      ?? null,
  };
}

export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyAdminRequest(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  // We look up the admin's own client (same pattern as scout-config-preview).
  let clientId = null;
  let dash = null;
  let bootstrap = null;
  let lastRunAt = null;

  try {
    bootstrap = await getDashboardBootstrap(decoded.uid);
    clientId = bootstrap?.userProfile?.clientId || null;
    dash = bootstrap?.dashboardState || null;
    lastRunAt = dash?.updatedAt || dash?.latestRunAt || null;
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Bootstrap failed.' }, 500);
  }

  const root = buildResolveRoot({ dash, bootstrap });
  const scribeCards = dash?.scribe?.cards || {};
  const scribeBrief = dash?.scribe?.brief || null;
  const analyzerOutputs = dash?.analyzerOutputs || null;

  const cards = {};
  for (const card of CARD_CONTRACT) {
    const scribe = scribeCards[card.id] || null;
    const analyzerOutput = analyzerOutputs?.[card.id] || null;

    const rawValue       = card.sourceField   ? resolvePath(root, card.sourceField)   : null;
    const fallbackValue  = card.fallbackField ? resolvePath(root, card.fallbackField) : null;

    cards[card.id] = {
      scribe: scribe && (scribe.short || scribe.expanded)
        ? { short: scribe.short || null, expanded: scribe.expanded || null }
        : null,
      staticCopy:    CARD_STATIC_COPY[card.id] || null,
      analyzerOutput,
      analyzerSkill: card.analyzerSkill || null,
      rawValue:      rawValue      === undefined ? null : rawValue,
      fallbackValue: fallbackValue === undefined ? null : fallbackValue,
      present:       hasData(rawValue) || hasData(fallbackValue),
      sourceField:   card.sourceField   || null,
      fallbackField: card.fallbackField || null,
    };
  }

  const analyzerFlagEnabled = Boolean(process.env.SCOUT_ANALYZER_SKILLS_ENABLED);
  const analyzerOutputCount = analyzerOutputs ? Object.keys(analyzerOutputs).length : 0;

  // Pull the latest brief_run's warnings so we can surface skill_failed /
  // skill_threw messages in the UI without forcing the user to dig Firestore.
  let skillWarnings = [];
  let allWarnings = [];
  if (clientId && dash?.latestRunId) {
    try {
      const briefSnap = await fb.adminDb
        .collection('clients').doc(clientId)
        .collection('brief_runs').doc(dash.latestRunId)
        .get();
      if (briefSnap.exists) {
        const brun = briefSnap.data() || {};
        if (Array.isArray(brun.warnings)) {
          allWarnings = brun.warnings;
          skillWarnings = brun.warnings.filter((w) => w?.stage === 'skills');
        }
      }
    } catch { /* non-fatal */ }
  }

  return json(deepSerialize({
    clientId,
    lastRunAt,
    hasScribe: Boolean(scribeBrief),
    analyzerFlagEnabled,
    analyzerOutputCount,
    skillWarnings,
    allWarnings,
    cards,
    dataSnapshot: {
      snapshot:              root.snapshot,
      signals:               root.signals,
      strategy:              root.strategy,
      outputsPreview:        root.outputsPreview,
      siteMeta:              root.siteMeta,
      intelligencePagespeed: root.intelligence.pagespeed,
      externalSignals:       root.externalSignals,
      scribeBrief,
    },
  }));
}
