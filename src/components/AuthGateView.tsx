import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Lock, LogIn, ShieldCheck } from "lucide-react";
import { doc, getDocFromServer } from "firebase/firestore";
import {
  FIREBASE_PROJECT_ID,
  db,
  isFirebaseConfigured,
  signInWithGooglePopup,
} from "../firebase";

interface AuthGateViewProps {
  dbReachable: boolean;
  connectionDetail: string;
  onEnterIsolatedDemoMode: () => void;
}

export const AuthGateView: React.FC<AuthGateViewProps> = ({
  dbReachable,
  connectionDetail,
  onEnterIsolatedDemoMode,
}) => {
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [unauthProbeResult, setUnauthProbeResult] = useState<{
    blocked: boolean;
    detail: string;
  } | null>(null);
  const [probing, setProbing] = useState(false);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithGooglePopup();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("auth/popup-closed-by-user")) {
        setAuthError("Sign-in window was closed before completing authentication.");
      } else if (msg.includes("auth/popup-blocked")) {
        setAuthError(
          "Your browser blocked the Google Sign-In popup. Allow popups for this site and try again."
        );
      } else {
        setAuthError(msg || "Unable to complete Google Sign-In.");
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleVerifyUnauthenticatedBlocked = async () => {
    setProbing(true);
    setUnauthProbeResult(null);
    try {
      let firestoreBlocked = false;
      if (db) {
        try {
          await getDocFromServer(
            doc(db, "users", "nora-private-check", "opportunities", "opp-starter-rethinkbh-bdr")
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          firestoreBlocked =
            msg.includes("Missing or insufficient permissions") ||
            msg.includes("PERMISSION_DENIED");
        }
      }

      const apiRes = await fetch("/api/auth/session");
      const apiBlocked = apiRes.status === 401;

      setUnauthProbeResult({
        blocked: firestoreBlocked && apiBlocked,
        detail:
          firestoreBlocked && apiBlocked
            ? "Verified: Unauthenticated visitor was denied by Cloud Firestore Security Rules (PERMISSION_DENIED) and denied by backend API (HTTP 401 Unauthorized)."
            : `Firestore denied=${firestoreBlocked}, Backend API 401=${apiBlocked}.`,
      });
    } catch (err) {
      setUnauthProbeResult({
        blocked: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="h-14 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between">
        <span className="text-base lg:text-lg font-bold tracking-tight text-slate-900">
          Career Launch
        </span>
        <span className="text-xs text-slate-500 font-mono">
          {isFirebaseConfigured && dbReachable
            ? "Authentication Required"
            : "Demo mode — database not connected"}
        </span>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="max-w-xl w-full space-y-6">
          {(!isFirebaseConfigured || !dbReachable) && (
            <div
              role="alert"
              className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-1.5"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Demo mode — database not connected</span>
              </div>
              <p className="text-xs text-amber-900 leading-relaxed">
                {connectionDetail} Do not enter real personal information until a live authenticated database connection is active.
              </p>
            </div>
          )}

          <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-teal-900">
                <Lock className="w-4 h-4 text-teal-800 shrink-0" />
                <span>Private Authenticated Career Workspace</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Sign in to your private Career Launch workspace
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Profile details, verified evidence claims, opportunities, outreach history, and uploaded résumés are stored in owner-isolated Cloud Firestore records and protected from unauthenticated visitors and other users.
              </p>
            </div>

            {authError && (
              <div
                role="alert"
                className="p-3.5 rounded-lg bg-red-50 border border-red-300 text-xs font-medium text-red-900"
              >
                {authError}
              </div>
            )}

            <div className="space-y-3">
              <button
                type="button"
                disabled={!isFirebaseConfigured || !dbReachable || signingIn}
                onClick={handleSignIn}
                className="w-full inline-flex items-center justify-center gap-2.5 px-5 py-3 text-sm font-semibold text-white bg-teal-800 hover:bg-teal-900 disabled:opacity-50 rounded-lg transition-colors"
              >
                <LogIn className="w-4 h-4" />
                <span>
                  {signingIn ? "Opening Google Sign-In..." : "Sign In with Google"}
                </span>
              </button>

              <button
                type="button"
                onClick={onEnterIsolatedDemoMode}
                className="w-full px-4 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
              >
                Preview Isolated Demo Mode (Database Not Connected — Sample Session Only)
              </button>
            </div>

            <div className="pt-5 border-t border-slate-200 space-y-3 text-xs text-slate-600 leading-relaxed">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-teal-800 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-slate-900">Access & Storage Summary:</strong>{" "}
                  Authenticated via Firebase Google Sign-In (Project:{" "}
                  <code className="font-mono text-slate-800">
                    {FIREBASE_PROJECT_ID || "unconfigured"}
                  </code>
                  ). Every record is keyed to your verified account UID. Uploaded résumés and job files are stored in non-listable private records without public URLs.
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={probing}
                  onClick={handleVerifyUnauthenticatedBlocked}
                  className="text-teal-800 hover:underline font-medium"
                >
                  {probing
                    ? "Verifying unauthenticated block..."
                    : "Verify unauthenticated visitor access is blocked"}
                </button>
              </div>

              {unauthProbeResult && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                    unauthProbeResult.blocked
                      ? "bg-teal-50/70 border-teal-200 text-teal-950"
                      : "bg-amber-50 border-amber-300 text-amber-950"
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-teal-800" />
                  <span>{unauthProbeResult.detail}</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};
