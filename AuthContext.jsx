import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';

const AuthContext = createContext(null);

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
    const unsubscribe = onSnapshot(userRef, async (snapshot) => {
      if (!snapshot.exists()) {
        await upsertUserProfile(user, {
          createdAt: serverTimestamp(),
          dashboardTitle: 'Custom Dashboard',
          dashboardDescription: 'Your client workspace is connected to Firebase Auth and Firestore.',
        });
        return;
      }

      setUserProfile(snapshot.data());
    });

    return unsubscribe;
  }, [user]);

  const value = useMemo(() => ({
    user,
    userProfile,
    loading,
    isFirebaseConfigured,
    signUp: async ({ email, password, displayName }) => {
      if (!auth) {
        throw new Error('Firebase is not configured.');
      }

      const credential = await createUserWithEmailAndPassword(auth, email, password);

      if (displayName) {
        await updateProfile(credential.user, { displayName });
      }

      await upsertUserProfile(credential.user, {
        displayName: displayName || credential.user.displayName || '',
        createdAt: serverTimestamp(),
        dashboardTitle: 'Custom Dashboard',
        dashboardDescription: 'Your client workspace is connected to Firebase Auth and Firestore.',
      });

      return credential.user;
    },
    signIn: async ({ email, password }) => {
      if (!auth) {
        throw new Error('Firebase is not configured.');
      }

      const credential = await signInWithEmailAndPassword(auth, email, password);
      await upsertUserProfile(credential.user);
      return credential.user;
    },
    signOutUser: async () => {
      if (!auth) return;
      await signOut(auth);
    },
  }), [loading, user, userProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
};
