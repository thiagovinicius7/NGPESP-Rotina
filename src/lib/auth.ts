/**
 * Login com conta Google (Firebase Auth).
 * Só os e-mails desta lista podem usar o app. As regras do Firestore devem
 * exigir o mesmo e-mail — é isso que protege os dados de verdade.
 */
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User
} from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

export const ALLOWED_EMAILS = ["thiagovinicius7@gmail.com"];

export function isAllowedUser(user: User | null | undefined): boolean {
  if (!user || !user.email || !user.emailVerified) return false;
  return ALLOWED_EMAILS.includes(user.email.toLowerCase());
}

export async function loginWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export function logout(): Promise<void> {
  return signOut(auth);
}

export function onUserChange(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

/** Token do usuário logado, para as chamadas REST ao Firestore. */
export async function getIdTokenOrNull(): Promise<string | null> {
  const u = auth.currentUser;
  if (!u) return null;
  try {
    return await u.getIdToken();
  } catch (_) {
    return null;
  }
}
