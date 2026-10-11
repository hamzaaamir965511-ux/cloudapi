import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { UserProfile, UserPrivateInfo, VALIDATION_RULES } from '../types/whatsapp';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  privateInfo: UserPrivateInfo | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string, orgName: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<string>;
  resendVerificationEmail: () => Promise<string>;
  refreshUserToken: () => Promise<void>;
  updateWorkspaceProfile: (displayName: string, organizationName: string, timezone: string, notificationEmail: string) => Promise<void>;
  signOut: () => Promise<void>;
  getBearerToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [privateInfo, setPrivateInfo] = useState<UserPrivateInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const syncLockRef = React.useRef<Promise<void> | null>(null);

  const ensureFirestoreProfile = async (currentUser: User, fallbackName?: string, fallbackOrg?: string) => {
    if (!currentUser.emailVerified) {
      return;
    }
    if (syncLockRef.current) {
      return syncLockRef.current;
    }

    const runSync = async () => {
      const userPath = `users/${currentUser.uid}`;
      const privatePath = `users/${currentUser.uid}/private/info`;

      const safeDisplayName = (
        (fallbackName || currentUser.displayName || currentUser.email?.split('@')[0] || 'Workspace Owner').trim() ||
        'Workspace Owner'
      ).slice(0, VALIDATION_RULES.MAX_DISPLAY_NAME);

      const safeOrgName = (
        (fallbackOrg || `${safeDisplayName} Business`).trim() ||
        'Enterprise Workspace'
      ).slice(0, VALIDATION_RULES.MAX_ORG_NAME);

      const resolvedTimezone = (
        (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').trim() || 'UTC'
      ).slice(0, 64);

      const userRef = doc(db, 'users', currentUser.uid);
      let userSnap;
      try {
        userSnap = await getDoc(userRef);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, userPath);
      }

      if (!userSnap.exists()) {
        const newProfile = {
          uid: currentUser.uid,
          displayName: safeDisplayName,
          organizationName: safeOrgName,
          role: 'owner' as const,
          timezone: resolvedTimezone,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        try {
          await setDoc(userRef, newProfile);
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, userPath);
        }
        setProfile({
          ...newProfile,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else {
        setProfile(userSnap.data() as UserProfile);
      }

      const privRef = doc(db, 'users', currentUser.uid, 'private', 'info');
      let privSnap;
      try {
        privSnap = await getDoc(privRef);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, privatePath);
      }

      const safeEmail = ((currentUser.email || 'user@example.com').trim() || 'user@example.com').slice(0, 254);

      if (!privSnap.exists()) {
        const newPriv = {
          uid: currentUser.uid,
          email: safeEmail,
          notificationEmail: safeEmail,
          updatedAt: serverTimestamp(),
        };
        try {
          await setDoc(privRef, newPriv);
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, privatePath);
        }
        setPrivateInfo({
          ...newPriv,
          updatedAt: new Date().toISOString(),
        });
      } else {
        setPrivateInfo(privSnap.data() as UserPrivateInfo);
      }
    };

    syncLockRef.current = runSync().finally(() => {
      syncLockRef.current = null;
    });
    return syncLockRef.current;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          await ensureFirestoreProfile(firebaseUser);
        } catch (err: any) {
          console.error('Profile sync error:', err);
        }
      } else {
        setProfile(null);
        setPrivateInfo(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const clearAuthError = () => setAuthError(null);

  const formatFirebaseAuthError = (err: any, fallbackMsg: string): string => {
    const code = err?.code || '';
    const currentDomain = typeof window !== 'undefined' ? window.location.hostname : '';
    if (code === 'auth/unauthorized-domain' || String(err?.message || '').includes('auth/unauthorized-domain')) {
      return `Domain "${currentDomain}" is not yet authorized in Firebase Authentication. Add "${currentDomain}" to Firebase Console → Authentication → Settings → Authorized domains (Project: gen-lang-client-0035122854), or open the app via the AI Studio preview pane.`;
    }
    if (code === 'auth/operation-not-allowed') {
      return 'Email/Password sign-in is not yet enabled in your Firebase project. Please sign in with Google or enable Email/Password provider in Firebase Console → Authentication → Sign-in method.';
    }
    return err?.message || fallbackMsg;
  };

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await ensureFirestoreProfile(cred.user);
    } catch (err: any) {
      setAuthError(formatFirebaseAuthError(err, 'Google sign-in failed.'));
      throw err;
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await ensureFirestoreProfile(cred.user);
    } catch (err: any) {
      setAuthError(formatFirebaseAuthError(err, 'Invalid email or password.'));
      throw err;
    }
  };

  const registerWithEmail = async (
    email: string,
    password: string,
    displayName: string,
    orgName: string
  ) => {
    setAuthError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: displayName.trim().slice(0, 120) });
      await sendEmailVerification(cred.user);
      await ensureFirestoreProfile(cred.user, displayName.trim(), orgName.trim());
    } catch (err: any) {
      setAuthError(formatFirebaseAuthError(err, 'Failed to register user account.'));
      throw err;
    }
  };

  const sendPasswordReset = async (email: string): Promise<string> => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      return `Password reset instructions dispatched to ${email.trim()}.`;
    } catch (err: any) {
      const msg = err?.message || 'Unable to send password reset email.';
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const resendVerificationEmail = async (): Promise<string> => {
    if (!auth.currentUser) throw new Error('No signed-in user.');
    await sendEmailVerification(auth.currentUser);
    return `Verification email sent to ${auth.currentUser.email}.`;
  };

  const refreshUserToken = async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    const refreshed = auth.currentUser;
    setUser({ ...refreshed } as User);
    if (refreshed.emailVerified) {
      await ensureFirestoreProfile(refreshed);
    }
  };

  const updateWorkspaceProfile = async (
    displayName: string,
    organizationName: string,
    timezone: string,
    notificationEmail: string
  ) => {
    if (!auth.currentUser) throw new Error('Not authenticated');
    const uid = auth.currentUser.uid;
    const safeName = displayName.trim().slice(0, VALIDATION_RULES.MAX_DISPLAY_NAME);
    const safeOrg = organizationName.trim().slice(0, VALIDATION_RULES.MAX_ORG_NAME);
    const safeTz = timezone.trim().slice(0, 64);
    const safeNotifEmail = notificationEmail.trim().slice(0, 254);

    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        displayName: safeName,
        organizationName: safeOrg,
        timezone: safeTz,
        updatedAt: serverTimestamp(),
      });

      const privRef = doc(db, 'users', uid, 'private', 'info');
      await updateDoc(privRef, {
        email: (auth.currentUser.email || safeNotifEmail).slice(0, 254),
        notificationEmail: safeNotifEmail,
        updatedAt: serverTimestamp(),
      });

      setProfile((prev) =>
        prev
          ? {
              ...prev,
              displayName: safeName,
              organizationName: safeOrg,
              timezone: safeTz,
              updatedAt: new Date().toISOString(),
            }
          : prev
      );
      setPrivateInfo((prev) =>
        prev
          ? {
              ...prev,
              notificationEmail: safeNotifEmail,
              updatedAt: new Date().toISOString(),
            }
          : prev
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setProfile(null);
    setPrivateInfo(null);
  };

  const getBearerToken = async (): Promise<string> => {
    if (!auth.currentUser) {
      throw new Error('Authentication session required.');
    }
    return await auth.currentUser.getIdToken();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        privateInfo,
        loading,
        authError,
        clearAuthError,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        sendPasswordReset,
        resendVerificationEmail,
        refreshUserToken,
        updateWorkspaceProfile,
        signOut,
        getBearerToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
