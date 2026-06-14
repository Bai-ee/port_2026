'use strict';

// seed-extractor.js
//
// Collects verbatim search seeds from Founder Q&A answers into
// dashboard_state.snapshot.searchSeeds.
//
// Unlike qa-synthesizer (which runs an LLM to infer brand positioning), seeds
// are stored RAW. They are query inputs — SERP, X/social, local, events — so we
// never let a model rewrite them. Runs fire-and-forget on every answer/complete,
// and seeds can be edited at any time (the merge below preserves prior data).

const fb = require('../../api/_lib/firebase-admin.cjs');
const { SEED_STEPS } = require('../../onboarding/questions.config.cjs');

// Build a plain searchSeeds object from stored answers, verbatim. Skipped or
// empty answers are omitted so the object stays tight. Returns null if nothing
// usable is present.
function buildSearchSeeds(answers) {
  const a = answers || {};
  const seeds = {};
  for (const step of SEED_STEPS) {
    const entry = a[step.id];
    if (!entry || entry.skipped === true) continue;
    const v = entry.value;
    if (v === null || v === undefined) continue;

    if (Array.isArray(v)) {
      if (v.length) seeds[step.seedKey] = v;
    } else if (typeof v === 'object') {
      if (Object.keys(v).length) seeds[step.seedKey] = v;
    } else if (typeof v === 'string') {
      const t = v.trim();
      if (t) seeds[step.seedKey] = t;
    }
  }
  return Object.keys(seeds).length ? seeds : null;
}

function hasAnySeed(answers) {
  return buildSearchSeeds(answers) !== null;
}

// ── Merge ─────────────────────────────────────────────────────────────────────
// Fresh seeds merge over existing snapshot.searchSeeds. Arrays union (dedupe,
// case-insensitive); nested objects merge field-wise; scalars: fresh wins when
// present. Never drops data already present from a prior save or other source.

function dedupeArr(arr) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = (item && typeof item === 'object' ? JSON.stringify(item) : String(item)).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function mergeSeeds(existing, fresh) {
  const out = { ...(existing || {}) };
  for (const [k, v] of Object.entries(fresh)) {
    if (Array.isArray(v)) {
      const prev = Array.isArray(out[k]) ? out[k] : [];
      out[k] = dedupeArr([...prev, ...v]);
    } else if (v && typeof v === 'object') {
      const prev = out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? out[k] : {};
      out[k] = { ...prev, ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Read Q&A answers from client_configs, build verbatim search seeds, and merge
 * them into dashboard_state.snapshot.searchSeeds. Non-fatal — failures are
 * logged and swallowed so the survey flow never blocks on this.
 *
 * Uses ref.update() with a dot-notation path to avoid Firestore shallow-merge
 * replacing the whole snapshot.
 *
 * @param {string} clientId
 */
async function applySeedsToSnapshot(clientId) {
  if (!clientId) return;

  try {
    const [configSnap, stateSnap] = await Promise.all([
      fb.adminDb.collection('client_configs').doc(clientId).get(),
      fb.adminDb.collection('dashboard_state').doc(clientId).get(),
    ]);

    const answers = configSnap.data()?.onboardingAnswers?.answers || null;
    const fresh = buildSearchSeeds(answers);
    if (!fresh) return;

    const existing = stateSnap.data()?.snapshot?.searchSeeds || null;
    const merged = mergeSeeds(existing, fresh);
    merged.source = 'qa';
    merged.updatedAt = new Date().toISOString();

    await fb.adminDb.collection('dashboard_state').doc(clientId).update({
      'snapshot.searchSeeds': merged,
    });

    console.log(`[seed-extractor] snapshot.searchSeeds updated for ${clientId}: ${Object.keys(fresh).join(', ')}`);
  } catch (err) {
    console.warn(`[seed-extractor] non-fatal failure for ${clientId}: ${err.message}`);
  }
}

module.exports = { buildSearchSeeds, hasAnySeed, mergeSeeds, applySeedsToSnapshot };
