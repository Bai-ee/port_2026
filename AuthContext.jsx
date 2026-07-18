'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';

const AuthContext = createContext(null);
const googleProvider = typeof window !== 'undefined' ? new GoogleAuthProvider() : null;
const PENDING_DASHBOARD_SIGNUP_KEY = 'pending-dashboard-signup';

// Thrown when a sign-in (no provisioning payload) resolves a brand-new Firebase
// Auth user — i.e. the Google account has never signed in here, or the previous
// account was deleted. Caller should route them into the Create Dashboard flow.
export const NEW_USER_SIGNIN_ERROR = 'NEW_USER_SIGNIN';

// Thrown when a blocklisted (previously deleted) email attempts to sign up
// again. AuthPage surfaces it as the "Deleted Account, Contact Bryan." toast.
export const DELETED_ACCOUNT_ERROR = 'DELETED_ACCOUNT';
export const DELETED_ACCOUNT_MESSAGE = 'Deleted Account, Contact Bryan.';

const throwDeletedAccountError = () => {
  const err = new Error(DELETED_ACCOUNT_MESSAGE);
  err.code = DELETED_ACCOUNT_ERROR;
  throw err;
};

// Pre-signup blocklist check. Fail-open on network errors — the provision
// route re-checks server-side and is the authority.
const checkDeletedAccountBlock = async (email) => {
  try {
    const res = await fetch(
      `/api/public/deleted-account-check?email=${encodeURIComponent(String(email || '').trim())}`,
      { cache: 'no-store' }
    );
    const data = await res.json().catch(() => ({}));
    return Boolean(data?.blocked);
  } catch {
    return false;
  }
};

function isBrandNewAuthUser(fbUser) {
  const created = fbUser?.metadata?.creationTime;
  const lastSignIn = fbUser?.metadata?.lastSignInTime;
  if (!created || !lastSignIn) return false;
  // Same timestamp → first ever sign-in for this uid.
  return created === lastSignIn;
}

if (googleProvider) {
  googleProvider.setCustomParameters({ prompt: 'select_account' });
}

const getAuthHeaders = async (user) => {
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
};

const persistPendingDashboardSignup = (payload = {}) => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(
    PENDING_DASHBOARD_SIGNUP_KEY,
    JSON.stringify({
      ...payload,
      createdAt: Date.now(),
    })
  );
};

const clearPendingDashboardSignup = () => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(PENDING_DASHBOARD_SIGNUP_KEY);
};

const provisionClientForSignup = async (user, payload) => {
  const response = await fetch('/api/clients/provision', {
    method: 'POST',
    headers: await getAuthHeaders(user),
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || 'Client provisioning failed.');
  }

  return data;
};

const upsertUserProfile = async (user, profile = {}) => {
  if (!db || !user) return;

  const userRef = doc(db, 'users', user.uid);
  await setDoc(
    userRef,
    {
      uid: user.uid,
      email: user.email,
      displayName: profile.displayName ?? user.displayName ?? '',
      photoURL: user.photoURL ?? '',
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...profile,
    },
    { merge: true }
  );
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminReady, setAdminReady] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth || !isFirebaseConfigured) {
      setLoading(false);
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!db || !user) {
      setUserProfile(null);
      return undefined;
    }

    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(
      userRef,
      async (snapshot) => {
        if (!snapshot.exists()) {
          await upsertUserProfile(user, {
            createdAt: serverTimestamp(),
            dashboardTitle: 'Custom Dashboard',
            dashboardDescription: 'Your client workspace is connected to Firebase Auth and Firestore.',
          });
          return;
        }
        setUserProfile(snapshot.data());
      },
      (err) => {
        // permission-denied fires transiently at sign-out before the listener
        // is unsubscribed — clear profile and let auth state change drive cleanup.
        if (err.code === 'permission-denied') {
          setUserProfile(null);
          return;
        }
        console.error('[AuthContext] user snapshot error:', err.code, err.message);
      }
    );

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setAdminReady(!loading);
      return undefined;
    }

    let cancelled = false;
    setIsAdmin(false);
    setAdminReady(false);
    (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/admin/whoami', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (!cancelled) {
          setIsAdmin(Boolean(response.ok && data?.admin?.docExists));
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) setAdminReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  const value = useMemo(() => ({
    user,
    userProfile,
    loading,
    isFirebaseConfigured,
    isAdmin,
    adminReady,
    signUp: async ({ email, password, displayName, companyName, websiteUrl, ideaDescription }) => {
      if (!auth) {
        throw new Error('Firebase is not configured.');
      }

      // Blocklisted (deleted) emails are refused BEFORE the auth user is
      // created, so the toast is immediate and no orphan identity is left.
      if (await checkDeletedAccountBlock(email)) {
        throwDeletedAccountError();
      }

      const credential = await createUserWithEmailAndPassword(auth, email, password);

      try {
        if (displayName) {
          await updateProfile(credential.user, { displayName });
        }

        await upsertUserProfile(credential.user, {
          displayName: displayName || credential.user.displayName || '',
          createdAt: serverTimestamp(),
          dashboardTitle: 'Provisioning Dashboard',
          dashboardDescription: 'Your client workspace is being provisioned.',
        });

        await provisionClientForSignup(credential.user, {
          displayName: displayName || credential.user.displayName || '',
          companyName: companyName || '',
          websiteUrl: websiteUrl || '',
          ideaDescription: ideaDescription || '',
        });

        persistPendingDashboardSignup({
          displayName: displayName || credential.user.displayName || '',
          companyName: companyName || '',
          websiteUrl: websiteUrl || '',
          ideaDescription: ideaDescription || '',
        });

        return credential.user;
      } catch (error) {
        clearPendingDashboardSignup();
        await signOut(auth).catch(() => {});
        throw error;
      }
    },
    signIn: async ({ email, password }) => {
      if (!auth) {
        throw new Error('Firebase is not configured.');
      }

      const credential = await signInWithEmailAndPassword(auth, email, password);
      await upsertUserProfile(credential.user);
      clearPendingDashboardSignup();
      return credential.user;
    },
    signInWithGoogle: async ({ provisioningPayload } = {}) => {
      if (!auth || !googleProvider) {
        throw new Error('Firebase is not configured.');
      }

      const credential = await signInWithPopup(auth, googleProvider);

      // Sign-in path with no provisioning payload but a brand-new Firebase Auth
      // user = account was never set up here, or was deleted. Sign them back
      // out and signal the UI to switch into Create Dashboard mode.
      if (!provisioningPayload && isBrandNewAuthUser(credential.user)) {
        await signOut(auth).catch(() => {});
        clearPendingDashboardSignup();
        const err = new Error(NEW_USER_SIGNIN_ERROR);
        err.code = NEW_USER_SIGNIN_ERROR;
        err.email = credential.user.email || '';
        throw err;
      }

      // Google signup path: the email is only known after the popup. A
      // blocklisted (deleted) account is signed back out and refused before
      // any profile/provision writes.
      if (provisioningPayload && (await checkDeletedAccountBlock(credential.user.email))) {
        await signOut(auth).catch(() => {});
        clearPendingDashboardSignup();
        throwDeletedAccountError();
      }

      const resolvedDisplayName = provisioningPayload?.displayName?.trim()
        || credential.user.displayName
        || '';

      try {
        await upsertUserProfile(credential.user, {
          displayName: resolvedDisplayName,
          photoURL: credential.user.photoURL || '',
          ...(provisioningPayload
            ? {
                dashboardTitle: 'Provisioning Dashboard',
                dashboardDescription: 'Your client workspace is being provisioned.',
              }
            : null),
        });

        if (provisioningPayload) {
          await provisionClientForSignup(credential.user, {
            displayName: resolvedDisplayName,
            companyName: provisioningPayload.companyName || '',
            websiteUrl: provisioningPayload.websiteUrl || '',
            ideaDescription: provisioningPayload.ideaDescription || '',
          });
          persistPendingDashboardSignup({
            displayName: resolvedDisplayName,
            companyName: provisioningPayload.companyName || '',
            websiteUrl: provisioningPayload.websiteUrl || '',
            ideaDescription: provisioningPayload.ideaDescription || '',
          });
        } else {
          clearPendingDashboardSignup();
        }

        return credential.user;
      } catch (error) {
        clearPendingDashboardSignup();
        await signOut(auth).catch(() => {});
        throw error;
      }
    },
    signOutUser: async () => {
      if (!auth) return;
      clearPendingDashboardSignup();
      await signOut(auth);
    },
  }), [loading, user, userProfile, isAdmin, adminReady]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
};
