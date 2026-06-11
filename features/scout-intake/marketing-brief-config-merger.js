'use strict';

// marketing-brief-config-merger.js
//
// Flows a fresh audit-generated scoutConfig into marketingBriefConfig (the
// layer the dashboard cards read) with user-vs-aggregated merge semantics —
// the same contract brandOverview uses:
//
//   - field group never touched by the user  → refresh from the new audit
//   - field group user-touched               → user entries kept verbatim,
//                                              novel audit items appended
//                                              (deduped, capped)
//
// Provenance is two signals:
//   1. acknowledgedCards[cardId] — the user explicitly saved that card
//   2. auditSeed — snapshot of what the last audit wrote per group; if the
//      current value still equals the seed the user never changed it.
//   Legacy configs with no auditSeed: non-empty groups are treated as
//   user-touched (conservative — never destroy what we can't attribute).
//
// Deterministic — no AI agent. Writes via dot-notation update so unrelated
// marketingBriefConfig fields (weather, events, localSignals, scribe/guardian
// settings, acknowledgedCards) are never replaced.

const fb = require('../../api/_lib/firebase-admin.cjs');

const LIST_CAPS = { brandKeywords: 12, categoryTerms: 12, kols: 20, competitors: 20 };
const SEARCHES_CAP = 8;

function cleanList(input) {
  return (Array.isArray(input) ? input : [])
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

// Case/quote/@-insensitive key for list dedupe and equality.
function listKey(v) {
  return String(v || '').trim().toLowerCase().replace(/^["'@]+|["']+$/g, '');
}

function sameList(a, b) {
  const ka = cleanList(a).map(listKey).sort();
  const kb = cleanList(b).map(listKey).sort();
  return ka.length === kb.length && ka.every((v, i) => v === kb[i]);
}

function mergeList(userList, auditList, cap) {
  const user = cleanList(userList);
  const seen = new Set(user.map(listKey));
  const novel = cleanList(auditList).filter((v) => !seen.has(listKey(v)));
  return [...user, ...novel].slice(0, cap);
}

function cleanSearches(input) {
  return (Array.isArray(input) ? input : [])
    .map((row) => ({
      label: String(row?.label || '').trim(),
      query: String(row?.query || '').trim(),
      goal:  String(row?.goal || '').trim(),
    }))
    .filter((row) => row.query);
}

function searchKey(row) {
  return `${String(row?.label || '').trim().toLowerCase()}`;
}

function sameSearches(a, b) {
  const ra = cleanSearches(a);
  const rb = cleanSearches(b);
  return ra.length === rb.length
    && ra.every((row, i) => row.label === rb[i]?.label && row.query === rb[i]?.query);
}

function mergeSearches(userRows, auditRows) {
  const user = cleanSearches(userRows);
  const seen = new Set(user.map(searchKey));
  const novel = cleanSearches(auditRows).filter((row) => !seen.has(searchKey(row)));
  return [...user, ...novel].slice(0, SEARCHES_CAP);
}

// Map the audit scoutConfig onto marketingBriefConfig field shapes.
function auditValues(scoutConfig) {
  const sc = scoutConfig || {};
  return {
    brandName:         String(sc.clientName || '').trim(),
    brandKeywords:     cleanList(sc.brandKeywords).slice(0, LIST_CAPS.brandKeywords),
    categoryTerms:     cleanList(sc.categoryTerms).slice(0, LIST_CAPS.categoryTerms),
    kols:              cleanList(sc.kols).slice(0, LIST_CAPS.kols),
    competitors:       cleanList(sc.competitors).slice(0, LIST_CAPS.competitors),
    searches:          cleanSearches(sc.scout?.searchPlan).slice(0, SEARCHES_CAP),
    sourceFocus:       String(sc.scout?.sourceFocus || '').trim(),
    scoutInstructions: String(sc.scout?.analysisInstructions || '').trim(),
  };
}

// Field groups with the provenance card that marks them user-touched.
// competitors/searches have no acknowledge card — auditSeed comparison only.
const GROUPS = [
  { fields: ['brandName', 'brandKeywords', 'categoryTerms'], ackCard: 'brand-keywords' },
  { fields: ['kols'],                                        ackCard: 'watchlist' },
  { fields: ['competitors'],                                 ackCard: null },
  { fields: ['searches'],                                    ackCard: null },
  { fields: ['sourceFocus', 'scoutInstructions'],            ackCard: 'scout-focus' },
];

function isEmptyValue(field, value) {
  if (field === 'searches') return cleanSearches(value).length === 0;
  if (field === 'brandName' || field === 'sourceFocus' || field === 'scoutInstructions') {
    return !String(value || '').trim();
  }
  return cleanList(value).length === 0;
}

function sameValue(field, a, b) {
  if (field === 'searches') return sameSearches(a, b);
  if (field === 'brandName' || field === 'sourceFocus' || field === 'scoutInstructions') {
    return String(a || '').trim() === String(b || '').trim();
  }
  return sameList(a, b);
}

function mergeValue(field, userValue, auditValue) {
  if (field === 'searches') return mergeSearches(userValue, auditValue);
  if (field === 'brandName' || field === 'sourceFocus' || field === 'scoutInstructions') {
    // Strings: user text wins outright when present; audit fills empties.
    return String(userValue || '').trim() || String(auditValue || '').trim();
  }
  return mergeList(userValue, auditValue, LIST_CAPS[field] || 20);
}

/**
 * Seed or merge marketingBriefConfig from a fresh audit scoutConfig.
 * Non-fatal — intended to run fire-and-forget inside the worker after
 * ensureScoutConfig. Writes only the groups that changed, plus the new
 * auditSeed snapshot for next-run provenance.
 *
 * @param {string} clientId
 * @param {object} scoutConfig - fresh result from ensureScoutConfig
 */
async function mergeMarketingBriefConfig(clientId, scoutConfig) {
  if (!clientId || !scoutConfig) return;

  try {
    const ref = fb.adminDb.collection('client_configs').doc(clientId);
    const snap = await ref.get();
    const existing = snap.data()?.marketingBriefConfig || null;
    const audit = auditValues(scoutConfig);

    const patch = {};

    if (!existing) {
      // First run — seed the whole layer from the audit.
      patch['marketingBriefConfig'] = {
        enabled: true,
        ...audit,
        auditSeed: { ...audit, seededAtIso: new Date().toISOString() },
        updatedAtIso: new Date().toISOString(),
      };
      await ref.update(patch);
      console.log(`[mb-config-merger] seeded marketingBriefConfig for ${clientId}`);
      return;
    }

    const ack = existing.acknowledgedCards || {};
    const seed = existing.auditSeed || null;
    let changed = 0;

    for (const group of GROUPS) {
      for (const field of group.fields) {
        const current = existing[field];
        const auditVal = audit[field];
        if (isEmptyValue(field, auditVal)) continue; // audit has nothing new for this field

        const acknowledged = group.ackCard ? ack[group.ackCard] === true : false;
        const differsFromSeed = seed ? !sameValue(field, current, seed[field]) : null;
        const userTouched = acknowledged
          || (seed ? differsFromSeed : !isEmptyValue(field, current));

        const next = userTouched
          ? mergeValue(field, current, auditVal)   // user wins, audit appends novel
          : auditVal;                               // untouched — refresh from audit

        if (!sameValue(field, current, next)) {
          patch[`marketingBriefConfig.${field}`] = next;
          changed++;
        }
      }
    }

    // Always record the latest audit snapshot so next run's provenance
    // compares against what THIS audit produced.
    patch['marketingBriefConfig.auditSeed'] = { ...audit, seededAtIso: new Date().toISOString() };

    await ref.update(patch);
    console.log(`[mb-config-merger] merged marketingBriefConfig for ${clientId}: ${changed} field(s) updated`);
  } catch (err) {
    console.warn(`[mb-config-merger] non-fatal failure for ${clientId}: ${err.message}`);
  }
}

module.exports = { mergeMarketingBriefConfig };
