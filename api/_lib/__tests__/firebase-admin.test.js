// firebase-admin.test.js — Slice 4f Phase B. Regression tests for the
// Application-Default-Credentials fallback added for the dedicated
// studio-proof-render Cloud Run service, proving the existing Vercel
// service-account path is entirely unaffected. Uses the module's own
// _internals DI seam — never touches a real Firebase app, real GCP
// credentials, or the network.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fbAdmin = require('../firebase-admin.cjs');

const ENV_KEYS = [
  'FIREBASE_ADMIN_PROJECT_ID', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY',
  'GOOGLE_CLOUD_PROJECT', 'FIREBASE_ADMIN_STORAGE_BUCKET', 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
];

let savedEnv;
let originalInternals;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) { savedEnv[key] = process.env[key]; delete process.env[key]; }
  originalInternals = { ...fbAdmin._internals };
  fbAdmin.__resetForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  Object.assign(fbAdmin._internals, originalInternals);
  fbAdmin.__resetForTests();
});

function fakeApp(tag) { return { __tag: tag }; }

test('Vercel path (all three service-account env vars present) uses an explicit cert() credential, never applicationDefault()', () => {
  process.env.FIREBASE_ADMIN_PROJECT_ID = 'proj-1';
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL = 'sa@proj-1.iam.gserviceaccount.com';
  process.env.FIREBASE_ADMIN_PRIVATE_KEY = '"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"';

  let certArgs = null;
  let applicationDefaultCalled = false;
  let initializeAppArgs = null;
  fbAdmin._internals.getApps = () => [];
  fbAdmin._internals.cert = (args) => { certArgs = args; return { __credential: 'cert' }; };
  fbAdmin._internals.applicationDefault = () => { applicationDefaultCalled = true; return { __credential: 'adc' }; };
  fbAdmin._internals.initializeApp = (args) => { initializeAppArgs = args; return fakeApp('vercel'); };

  const app = fbAdmin.adminApp;
  assert.equal(app.__tag, 'vercel');
  assert.equal(applicationDefaultCalled, false, 'applicationDefault must never be called when the Vercel trio is present');
  assert.ok(certArgs, 'cert() must have been called');
  assert.equal(certArgs.projectId, 'proj-1');
  assert.equal(certArgs.clientEmail, 'sa@proj-1.iam.gserviceaccount.com');
  assert.equal(
    certArgs.privateKey,
    '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    'quotes stripped and \\n unescaped, unchanged from the pre-existing parsePrivateKey behavior',
  );
  assert.deepEqual(initializeAppArgs.credential, { __credential: 'cert' });
});

test('Cloud Run path (Vercel trio entirely absent) falls back to applicationDefault(), never cert()', () => {
  // No FIREBASE_ADMIN_* vars set at all — the case for the dedicated
  // studio-proof-render service, which carries its own IAM-attached service
  // account instead of any env-var key material.
  let certCalled = false;
  let applicationDefaultCalled = false;
  let initializeAppArgs = null;
  fbAdmin._internals.getApps = () => [];
  fbAdmin._internals.cert = () => { certCalled = true; return { __credential: 'cert' }; };
  fbAdmin._internals.applicationDefault = () => { applicationDefaultCalled = true; return { __credential: 'adc' }; };
  fbAdmin._internals.initializeApp = (args) => { initializeAppArgs = args; return fakeApp('cloud-run'); };

  const app = fbAdmin.adminApp;
  assert.equal(app.__tag, 'cloud-run');
  assert.equal(certCalled, false, 'cert() must never be called on the ADC path');
  assert.equal(applicationDefaultCalled, true);
  assert.deepEqual(initializeAppArgs.credential, { __credential: 'adc' });
  assert.equal(initializeAppArgs.projectId, undefined, 'no GOOGLE_CLOUD_PROJECT/FIREBASE_ADMIN_PROJECT_ID set — projectId omitted so ADC auto-discovers it');
});

test('Cloud Run path uses GOOGLE_CLOUD_PROJECT for projectId when set', () => {
  process.env.GOOGLE_CLOUD_PROJECT = 'human-in-the-loop-a1a19';
  let initializeAppArgs = null;
  fbAdmin._internals.getApps = () => [];
  fbAdmin._internals.applicationDefault = () => ({ __credential: 'adc' });
  fbAdmin._internals.initializeApp = (args) => { initializeAppArgs = args; return fakeApp('cloud-run'); };

  // eslint-disable-next-line no-unused-expressions
  fbAdmin.adminApp;
  assert.equal(initializeAppArgs.projectId, 'human-in-the-loop-a1a19');
});

test('a partially-set Vercel trio (only one of the three vars) still falls to the ADC path, never a broken partial cert() call', () => {
  process.env.FIREBASE_ADMIN_PROJECT_ID = 'proj-1'; // only one of the three set
  let certCalled = false;
  let applicationDefaultCalled = false;
  fbAdmin._internals.getApps = () => [];
  fbAdmin._internals.cert = () => { certCalled = true; return {}; };
  fbAdmin._internals.applicationDefault = () => { applicationDefaultCalled = true; return {}; };
  fbAdmin._internals.initializeApp = () => fakeApp('x');

  // eslint-disable-next-line no-unused-expressions
  fbAdmin.adminApp;
  assert.equal(certCalled, false);
  assert.equal(applicationDefaultCalled, true);
});

test('an already-initialized app (getApps() non-empty) short-circuits — initializeApp is never called again', () => {
  let initializeAppCalled = false;
  fbAdmin._internals.getApps = () => [fakeApp('existing')];
  fbAdmin._internals.initializeApp = () => { initializeAppCalled = true; return fakeApp('new'); };

  const app = fbAdmin.adminApp;
  assert.equal(app.__tag, 'existing');
  assert.equal(initializeAppCalled, false);
});

test('storageBucket is passed through on the ADC path from FIREBASE_ADMIN_STORAGE_BUCKET', () => {
  process.env.FIREBASE_ADMIN_STORAGE_BUCKET = 'my-bucket.appspot.com';
  let initializeAppArgs = null;
  fbAdmin._internals.getApps = () => [];
  fbAdmin._internals.applicationDefault = () => ({});
  fbAdmin._internals.initializeApp = (args) => { initializeAppArgs = args; return fakeApp('x'); };

  // eslint-disable-next-line no-unused-expressions
  fbAdmin.adminApp;
  assert.equal(initializeAppArgs.storageBucket, 'my-bucket.appspot.com');
});

test('the adminApp getter caches — repeated access does not re-run initAdminApp at all', () => {
  let initializeAppCalls = 0;
  fbAdmin._internals.getApps = () => [];
  fbAdmin._internals.applicationDefault = () => ({});
  fbAdmin._internals.initializeApp = () => { initializeAppCalls += 1; return fakeApp('x'); };

  const a = fbAdmin.adminApp;
  const b = fbAdmin.adminApp;
  assert.equal(a, b);
  assert.equal(initializeAppCalls, 1);
});
