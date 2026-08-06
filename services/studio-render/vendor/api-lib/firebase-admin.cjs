const { cert, applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

function parsePrivateKey(raw) {
  return String(raw || '')
    .replace(/^"|"$/g, '')
    .replace(/\\n/g, '\n');
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }
  return value;
}

// DI seam (Slice 4f Phase B) — lets a test substitute fake cert/
// applicationDefault/initializeApp/getApps to assert WHICH credential path
// initAdminApp() chose and with what arguments, without ever touching a real
// Firebase app or real GCP credentials. Production code always goes through
// these same names, just the real firebase-admin/app exports by default.
const _internals = { cert, applicationDefault, initializeApp, getApps };

function hasVercelServiceAccountEnv() {
  return Boolean(
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
    process.env.FIREBASE_ADMIN_PRIVATE_KEY,
  );
}

// Lazy initialization — deferred until first request so next build
// does not require Firebase Admin env vars to be present at build time.
let _adminApp = null;
let _adminAuth = null;
let _adminDb = null;
let _adminStorage = null;

/**
 * Two credential paths, chosen automatically — never by an explicit mode
 * flag a caller sets, so there is nothing new to misconfigure:
 *
 * 1. **Vercel path (unchanged default).** Whenever all three
 *    `FIREBASE_ADMIN_PROJECT_ID`/`FIREBASE_ADMIN_CLIENT_EMAIL`/
 *    `FIREBASE_ADMIN_PRIVATE_KEY` env vars are present, an explicit service
 *    account key is used, exactly as before this change — Vercel's runtime
 *    has no Application Default Credentials of its own, so this remains
 *    required there. Every existing Vercel deploy is byte-for-byte
 *    unaffected: this branch is identical to the prior single code path.
 * 2. **Cloud Run path (Slice 4f Phase B, new).** When those three vars are
 *    entirely absent — the case for the dedicated `studio-proof-render`
 *    Cloud Run service, which has its OWN service account attached to the
 *    revision via IAM (see `docs/features/studio/PROOF_RENDER_HOSTING.md`
 *    §5), never an env var or key file — falls back to Application Default
 *    Credentials. Cloud Run's metadata server resolves ADC to that attached
 *    service account automatically; no key material anywhere in the
 *    container's env or filesystem. `projectId` is taken from
 *    `FIREBASE_ADMIN_PROJECT_ID`/`GOOGLE_CLOUD_PROJECT` if either is set
 *    (Cloud Run sets the latter automatically), otherwise omitted entirely
 *    so ADC's own metadata-server auto-discovery resolves it.
 */
function initAdminApp() {
  if (_internals.getApps().length > 0) {
    return _internals.getApps()[0];
  }

  const storageBucket =
    process.env.FIREBASE_ADMIN_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  if (hasVercelServiceAccountEnv()) {
    const projectId = readRequiredEnv('FIREBASE_ADMIN_PROJECT_ID');
    const clientEmail = readRequiredEnv('FIREBASE_ADMIN_CLIENT_EMAIL');
    const privateKey = parsePrivateKey(readRequiredEnv('FIREBASE_ADMIN_PRIVATE_KEY'));
    return _internals.initializeApp({
      credential: _internals.cert({ projectId, clientEmail, privateKey }),
      storageBucket,
    });
  }

  const adcProjectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || undefined;
  return _internals.initializeApp({
    credential: _internals.applicationDefault(),
    ...(adcProjectId ? { projectId: adcProjectId } : {}),
    storageBucket,
  });
}

module.exports = {
  FieldValue,
  _internals,
  // Test-only: clears the module's own cached lazy singletons so a test can
  // force initAdminApp() to run again against a freshly-swapped _internals.
  // Never used by production code — nothing in the normal request path ever
  // needs to re-initialize an already-initialized app.
  __resetForTests() {
    _adminApp = null;
    _adminAuth = null;
    _adminDb = null;
    _adminStorage = null;
  },
  get adminApp() {
    if (!_adminApp) _adminApp = initAdminApp();
    return _adminApp;
  },
  get adminAuth() {
    if (!_adminAuth) _adminAuth = getAuth(module.exports.adminApp);
    return _adminAuth;
  },
  get adminDb() {
    if (!_adminDb) _adminDb = getFirestore(module.exports.adminApp);
    return _adminDb;
  },
  get adminStorage() {
    if (!_adminStorage) _adminStorage = getStorage(module.exports.adminApp);
    return _adminStorage;
  },
};
