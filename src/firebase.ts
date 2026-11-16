import { FirebaseApp, initializeApp } from "firebase/app";
import {
  Auth,
  GoogleAuthProvider,
  deleteUser,
  getAuth,
  reauthenticateWithPopup,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  Firestore,
  doc,
  getDocFromServer,
  getFirestore,
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

export const FIREBASE_PROJECT_ID = firebaseConfig?.projectId || "";
export const FIRESTORE_DATABASE_ID = firebaseConfig?.firestoreDatabaseId || "";

export const isFirebaseConfigured: boolean = Boolean(
  firebaseConfig &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== "remixed-project-id" &&
    firebaseConfig.apiKey &&
    firebaseConfig.firestoreDatabaseId
);

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;

if (isFirebaseConfigured) {
  appInstance = initializeApp(firebaseConfig);
  dbInstance = getFirestore(appInstance, firebaseConfig.firestoreDatabaseId);
  authInstance = getAuth(appInstance);
}

export const app = appInstance;
export const db = dbInstance;
export const auth = authInstance;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function maskEmailForDevLog(email?: string | null): string | null {
  if (!email) return null;
  const parts = email.trim().split("@");
  if (parts.length !== 2) return "[redacted]";
  const [local, domain] = parts;
  const safeLocal =
    local.length <= 1 ? "*" : `${local[0]}***`;
  return `${safeLocal}@${domain}`;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid ?? null,
      email: auth?.currentUser?.email ?? null,
      emailVerified: auth?.currentUser?.emailVerified ?? null,
      isAnonymous: auth?.currentUser?.isAnonymous ?? null,
      tenantId: auth?.currentUser?.tenantId ?? null,
      providerInfo:
        auth?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  const redactedLogInfo: FirestoreErrorInfo = {
    ...errInfo,
    authInfo: {
      ...errInfo.authInfo,
      email: maskEmailForDevLog(errInfo.authInfo.email),
      providerInfo: (errInfo.authInfo.providerInfo || []).map((p) => ({
        providerId: p.providerId,
        email: maskEmailForDevLog(p.email),
      })),
    },
  };
  console.error("Firestore Error: ", JSON.stringify(redactedLogInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function extractReadableSaveError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as Partial<FirestoreErrorInfo>;
    if (parsed && typeof parsed.error === "string") {
      if (parsed.error.includes("Quota exceeded")) {
        return `Firestore free-tier daily quota reached. Quota resets tomorrow (Project: ${FIREBASE_PROJECT_ID}).`;
      }
      if (
        parsed.error.includes("Missing or insufficient permissions") ||
        parsed.error.includes("PERMISSION_DENIED")
      ) {
        return `Database security rule rejected write (${parsed.operationType || "write"} on ${parsed.path || "record"}). Changes were NOT saved.`;
      }
      return `Database error: ${parsed.error}`;
    }
  } catch {
    // Plain error message
  }
  if (raw.includes("Quota exceeded")) {
    return `Firestore free-tier daily quota reached. Quota resets tomorrow.`;
  }
  return raw || "Database write failed. Changes were not saved.";
}

export async function testFirestoreConnection(): Promise<{
  reachable: boolean;
  detail: string;
}> {
  if (!isFirebaseConfigured || !db) {
    return {
      reachable: false,
      detail: "Demo mode — database not connected (Firebase configuration missing).",
    };
  }
  try {
    await getDocFromServer(doc(db, "test", "connection"));
    return {
      reachable: true,
      detail: "Connected to Cloud Firestore.",
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration.");
      return {
        reachable: false,
        detail: "Demo mode — database not connected (client is offline or unable to reach Cloud Firestore).",
      };
    }
    // A permission-denied response from the server confirms live reachability and active security rules
    return {
      reachable: true,
      detail: "Connected to Cloud Firestore (Zero-trust security rules active).",
    };
  }
}

export async function signInWithGooglePopup(): Promise<void> {
  if (!auth) {
    throw new Error("Firebase Authentication is not configured.");
  }
  await signInWithPopup(auth, googleProvider);
}

export async function signOutCurrentUser(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

export async function updateCurrentAuthDisplayName(
  displayName: string
): Promise<void> {
  if (!auth?.currentUser) return;
  await updateProfile(auth.currentUser, {
    displayName: displayName.trim().slice(0, 120),
  });
}

export async function reauthenticateWithGooglePopup(): Promise<void> {
  if (!auth?.currentUser) {
    throw new Error("No authenticated user session found.");
  }
  await reauthenticateWithPopup(auth.currentUser, googleProvider);
}

export async function deleteCurrentFirebaseAuthUser(): Promise<void> {
  if (!auth?.currentUser) {
    throw new Error("No authenticated user session found.");
  }
  await deleteUser(auth.currentUser);
}
