'use strict';

// Lane 2 (phone upload) intake — bucket access. Uses HITLOOP's OWN default
// Firebase Storage bucket (api/_lib/firebase-admin.cjs's adminApp), not the
// EditVideos-bridge bucket Media Library uses.
//
// Why: on 2026-09-20, a live localhost test of the original bridgeBucket()-
// based implementation returned 503 — "Could not configure intake upload
// CORS: invalid_grant: Invalid JWT Signature". Root cause: the EditVideos
// service-account key (EDITVIDEOS_FIREBASE_SERVICE_ACCOUNT_KEY) is rejected
// by Google in that environment, so bridgeBucket()/ensureUploadCors() fail
// before any signed URL is ever minted. HITLOOP's own bucket works, already
// carries a CORS entry for localhost:3000, and is the cleaner ownership
// boundary anyway — archive intake data belongs in HITLOOP's project, not
// EditVideos'. See docs/archive/INTAKE_CONTRACT.md.

const fb = require('./firebase-admin.cjs');

const REQUIRED_METHODS = ['OPTIONS', 'PUT', 'GET', 'HEAD'];
const REQUIRED_HEADERS = ['Content-Type', 'Content-Length', 'x-goog-resumable'];

/** HITLOOP's default Storage bucket. */
function intakeBucket() {
  return fb.adminStorage.bucket();
}

/**
 * The origins a phone/browser may PUT to an intake signed URL from. Always
 * includes the known HITLOOP hosts; NEXT_PUBLIC_SITE_URL is included too so
 * a preview/staging deploy works without a code change.
 */
function intakeOrigins() {
  const fixed = ['http://localhost:3000', 'https://hitloop.agency', 'https://www.hitloop.agency'];
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/$/, '');
  return Array.from(new Set([...fixed, configured].filter(Boolean)));
}

/** Does an existing bucket CORS rule already cover every required origin/method/header? */
function corsRuleCoversIntake(rule, origins) {
  const ruleOrigins = Array.isArray(rule?.origin) ? rule.origin : [];
  const methods = Array.isArray(rule?.method) ? rule.method.map((m) => String(m).toUpperCase()) : [];
  const headers = Array.isArray(rule?.responseHeader) ? rule.responseHeader.map((h) => String(h).toLowerCase()) : [];
  return origins.every((origin) => ruleOrigins.includes(origin) || ruleOrigins.includes('*'))
    && REQUIRED_METHODS.every((method) => methods.includes(method))
    && REQUIRED_HEADERS.every((header) => headers.includes(header.toLowerCase()));
}

// Per-process memoization — once we've confirmed (or established) coverage,
// never re-read/re-write bucket metadata again for the life of this process.
let _ensured = false;

/**
 * Ensures the intake bucket's CORS config allows a browser PUT/GET from the
 * known HITLOOP origins. Reads the bucket's existing CORS rules and MERGES
 * a single new rule in — it never replaces or drops any other rule already
 * on the bucket (e.g. one Media Library or another surface depends on).
 * Skips the write entirely when an existing rule already covers everything
 * this needs.
 */
async function ensureIntakeCors() {
  if (_ensured) return;

  const bucket = intakeBucket();
  const origins = intakeOrigins();
  const [metadata] = await bucket.getMetadata();
  const currentCors = Array.isArray(metadata?.cors) ? metadata.cors : [];

  if (currentCors.some((rule) => corsRuleCoversIntake(rule, origins))) {
    _ensured = true;
    return;
  }

  const desiredRule = {
    origin: origins,
    method: REQUIRED_METHODS,
    responseHeader: REQUIRED_HEADERS,
    maxAgeSeconds: 3600,
  };
  await bucket.setMetadata({ cors: [...currentCors, desiredRule] });
  _ensured = true;
}

module.exports = {
  intakeBucket,
  intakeOrigins,
  ensureIntakeCors,
  // Test-only: clears the per-process memoization so a test can force
  // ensureIntakeCors() to re-check. Never used by production code.
  __resetForTests() { _ensured = false; },
};
