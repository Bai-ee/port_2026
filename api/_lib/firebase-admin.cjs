const { cert, getApps, initializeApp } = require('firebase-admin/app');
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

// Lazy initialization — deferred until first request so next build
// does not require Firebase Admin env vars to be present at build time.
let _adminApp = null;
let _adminAuth = null;
let _adminDb = null;
let _adminStorage = null;

function initAdminApp() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const projectId = readRequiredEnv('FIREBASE_ADMIN_PROJECT_ID');
  const clientEmail = readRequiredEnv('FIREBASE_ADMIN_CLIENT_EMAIL');
  const privateKey = parsePrivateKey(readRequiredEnv('FIREBASE_ADMIN_PRIVATE_KEY'));
  const storageBucket =
    process.env.FIREBASE_ADMIN_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    storageBucket,
  });
}

module.exports = {
  FieldValue,
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
