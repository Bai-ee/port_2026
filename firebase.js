import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);

const app = isFirebaseConfigured
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;

if (!isFirebaseConfigured && typeof window !== 'undefined') {
  console.warn('Firebase is not configured. Add the VITE_FIREBASE_* variables to enable auth and Firestore.');
}

export const firebaseApp = app;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
