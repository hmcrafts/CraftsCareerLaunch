import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { signInWithGooglePopup, signOutCurrentUser } from "../firebase";
import {
  InspectInvitationState,
  VerifyInvitationSessionState,
  acceptInvitationToken,
  inspectInvitationToken,
  verifyInvitationSession,
} from "../services/apiClient";

interface AcceptInvitationViewProps {
  inviteToken: string;
  authUser: { uid: string; email: string | null } | null;
  onInvitationAccepted: () => void;
  onCancelAndReturn: () => void;
}

function formatUtcTimestamp(iso: string): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export const AcceptInvitationView: React.FC<AcceptInvitationViewProps> = ({
  inviteToken,
  authUser,
  onInvitationAccepted,
  onCancelAndReturn,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [inspectResult, setInspectResult] =
    useState<InspectInvitationState | null>(null);
  const [sessionResult, setSessionResult] =
    useState<VerifyInvitationSessionState | null>(null);

  const [authActionBusy, setAuthActionBusy] = useState<boolean>(false);
  const [redeeming, setRedeeming] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>("");

  const evaluateInviteState = useCallback(async () => {
    setLoading(true);
    setActionError(null);

    if (!authUser) {
      setSessionResult(null);
      const inspected = await inspectInvitationToken(inviteToken);
      setInspectResult(inspected);
      setLoading(false);
      return;
    }

    const verified = await verifyInvitationSession(inviteToken);
    setSessionResult(verified);
    setLoading(false);
  }, [authUser, inviteToken]);

  useEffect(() => {
    evaluateInviteState();
  }, [evaluateInviteState]);

  const handleAuthenticate = async (intentLabel: string) => {
    if (authActionBusy) return;
    setAuthActionBusy(true);
    setActionError(null);
    setLiveAnnouncement(`${intentLabel}: opening Google account verification.`);
    try {
      await signInWithGooglePopup();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("auth/popup-closed-by-user")) {
        setActionError(
          "Sign-in did not complete. Check popup permissions and try again."
        );
      }
    } finally {
      setAuthActionBusy(false);
    }
  };

  const handleSwitchAccount = async () => {
    if (authActionBusy) return;
    setAuthActionBusy(true);
    setActionError(null);
    setLiveAnnouncement("Signing out so you can choose the invited email account.");
    try {
      await signOutCurrentUser();
      await signInWithGooglePopup();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("auth/popup-closed-by-user")) {
        setActionError("Unable to switch account. Please try signing in again.");
      }
    } finally {
      setAuthActionBusy(false);
    }
  };

  const handleAcceptInvitation = async () => {
    if (redeeming) return;
    setRedeeming(true);
    setActionError(null);
    setLiveAnnouncement("Accepting invitation and preparing your private workspace.");
    try {
      await acceptInvitationToken(inviteToken);
      setLiveAnnouncement("Invitation accepted. Opening your private workspace.");
      onInvitationAccepted();
    } catch (err) {
      const typed = err as Error & { state?: string };
      if (
        typed.state === "invalid" ||
        typed.state === "expired" ||
        typed.state === "revoked" ||
        typed.state === "accepted"
      ) {
        await evaluateInviteState();
      } else {
        setActionError(
          typed.message ||
            "Unable to redeem invitation right now. Your account was not changed; please retry."
        );
      }
      setRedeeming(false);
    }
  };

  const effectiveTerminalState:
    | "invalid"
    | "expired"
    | "revoked"
    | "accepted"
    | "service_error"
    | null = (() => {
    const active = authUser ? sessionResult : inspectResult;
    if (!active) return null;
    if (
      active.state === "invalid" ||
      active.state === "expired" ||
      active.state === "revoked" ||
      active.state === "accepted" ||
      active.state === "service_error"
    ) {
      return active.state;
    }
    return null;
  })();

  const serviceErrorMessage =
    authUser && sessionResult?.state === "service_error"
      ? sessionResult.message
      : !authUser && inspectResult?.state === "service_error"
      ? inspectResult.message
      : "";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between p-4 sm:p-8">
      <div className="sr-only" role="status" aria-live="polite">
        {liveAnnouncement}
      </div>

      <header className="max-w-2xl w-full mx-auto pt-2 flex items-center justify-between">
        <span className="text-base font-bold tracking-tight text-slate-900">
          Career Launch
        </span>
        <span className="text-xs text-slate-500">
          Single-use Workspace Invitation
        </span>
      </header>

      <main className="max-w-2xl w-full mx-auto my-8">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2 border-b border-slate-200 pb-5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Welcome to Career Launch
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              Organize job opportunities, evaluate role requirements against verified evidence, practice interviews, and plan realistic next steps in your own private workspace.
            </p>
          </div>

          {loading && (
            <div className="py-8 flex items-center gap-3 text-sm text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin text-teal-800 shrink-0" />
              <span>Checking single-use invitation status...</span>
            </div>
          )}

          {/* Terminal Invalid / Expired / Revoked / Already Redeemed States (Expose ZERO account details) */}
          {!loading && effectiveTerminalState === "invalid" && (
            <div role="alert" className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <AlertCircle className="w-4 h-4 text-slate-700 shrink-0" />
                  <span>This invitation link is not valid</span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  The link may be incomplete, malformed, or replaced by a newer resent invitation. No account details are shown for invalid links. Ask the sender for a fresh invitation if you still need access.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onCancelAndReturn}
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Continue to Career Launch
                </button>
              </div>
            </div>
          )}

          {!loading && effectiveTerminalState === "expired" && (
            <div role="alert" className="space-y-4">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                  <AlertCircle className="w-4 h-4 text-amber-800 shrink-0" />
                  <span>This invitation has expired</span>
                </div>
                <p className="text-sm text-amber-900 leading-relaxed">
                  Invitation links expire automatically for security and cannot be redeemed after their expiration time. Ask the administrator who invited you to resend a new invitation.
                </p>
              </div>
              <button
                type="button"
                onClick={onCancelAndReturn}
                className="px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Return to Sign In
              </button>
            </div>
          )}

          {!loading && effectiveTerminalState === "revoked" && (
            <div role="alert" className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <AlertCircle className="w-4 h-4 text-slate-700 shrink-0" />
                  <span>This invitation was revoked</span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  This single-use link was canceled before redemption and can no longer be used. Contact the administrator if you believe this was a mistake.
                </p>
              </div>
              <button
                type="button"
                onClick={onCancelAndReturn}
                className="px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Return to Sign In
              </button>
            </div>
          )}

          {!loading && effectiveTerminalState === "accepted" && (
            <div role="status" className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <CheckCircle2 className="w-4 h-4 text-teal-800 shrink-0" />
                  <span>This invitation has already been redeemed</span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Each invitation link can only be used once. If you already accepted this invitation, continue to Career Launch and sign in with your account.
                </p>
              </div>
              <button
                type="button"
                onClick={onCancelAndReturn}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Go to Workspace Sign In
              </button>
            </div>
          )}

          {!loading && effectiveTerminalState === "service_error" && (
            <div role="alert" className="space-y-4">
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-red-950">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                  <span>Unable to verify invitation right now</span>
                </div>
                <p className="text-sm text-red-900 leading-relaxed">
                  {serviceErrorMessage ||
                    "Temporary service failure while checking this invitation. Please retry."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={evaluateInviteState}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
                <button
                  type="button"
                  onClick={onCancelAndReturn}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Return without accepting
                </button>
              </div>
            </div>
          )}

          {/* Pre-Authentication Valid Invitation State */}
          {!loading && !authUser && inspectResult?.state === "valid" && (
            <div className="space-y-6">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm">
                <div>
                  <dt className="text-xs font-medium text-slate-500">
                    Invitation sent by
                  </dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">
                    {inspectResult.inviterDisplayName}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">
                    Intended recipient email
                  </dt>
                  <dd className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                    {inspectResult.maskedRecipientEmail}
                  </dd>
                </div>
                <div className="sm:col-span-2 pt-2 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <span>Access offered: Independent job-seeker workspace</span>
                  <span className="font-mono tabular-nums">
                    Expires {formatUtcTimestamp(inspectResult.expiresAtIso)}
                  </span>
                </div>
              </dl>

              <div className="space-y-2.5 text-sm text-slate-700 leading-relaxed">
                <div className="flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-teal-800 shrink-0 mt-1" />
                  <p>
                    <strong>Private by default:</strong> Accepting this invitation creates a private workspace owned by you.{" "}
                    <strong>{inspectResult.inviterDisplayName}</strong> does not receive automatic access to your résumé, job opportunities, outreach drafts, or practice history.
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-teal-800 shrink-0 mt-1" />
                  <p>
                    <strong>Email verification required:</strong> You must create an account or sign in using the exact email address matching{" "}
                    <span className="font-mono tabular-nums font-medium">
                      {inspectResult.maskedRecipientEmail}
                    </span>
                    .
                  </p>
                </div>
              </div>

              {actionError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900"
                >
                  {actionError}
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={authActionBusy}
                  onClick={() => handleAuthenticate("Create account")}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-teal-800 hover:bg-teal-900 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {authActionBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4" />
                  )}
                  <span>Create account</span>
                </button>
                <button
                  type="button"
                  disabled={authActionBusy}
                  onClick={() => handleAuthenticate("Sign in")}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  disabled={authActionBusy}
                  onClick={onCancelAndReturn}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
                >
                  Return without accepting
                </button>
              </div>
            </div>
          )}

          {/* Signed-in with Different Email (Section 8 Exact Copy & Protections) */}
          {!loading && authUser && sessionResult?.state === "wrong_email" && (
            <div role="alert" className="space-y-5">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-2">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold text-amber-950">
                      You’re signed in with a different email from this invitation.
                    </h2>
                    <p className="text-xs sm:text-sm text-amber-900 leading-relaxed">
                      You are currently signed in as{" "}
                      <strong className="font-mono">
                        {sessionResult.signedInEmail || authUser.email}
                      </strong>
                      . For your security, this invitation will never attach to a different email account. Switch to the invited email account to accept, or return without accepting.
                    </p>
                  </div>
                </div>
              </div>

              {actionError && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900">
                  {actionError}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={authActionBusy}
                  onClick={handleSwitchAccount}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white bg-teal-800 hover:bg-teal-900 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {authActionBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Switch account</span>
                </button>
                <button
                  type="button"
                  disabled={authActionBusy}
                  onClick={onCancelAndReturn}
                  className="px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Return without accepting
                </button>
              </div>
            </div>
          )}

          {/* Signed-in with Verified Matching Email — Ready for Atomic Workspace Creation */}
          {!loading && authUser && sessionResult?.state === "ready_to_accept" && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-teal-50/70 border border-teal-200 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-teal-950">
                  <CheckCircle2 className="w-4 h-4 text-teal-800 shrink-0" />
                  <span>Verified email matches this invitation</span>
                </div>
                <p className="text-xs sm:text-sm text-teal-950/90 leading-relaxed">
                  Signed in as{" "}
                  <strong className="font-mono">{sessionResult.recipientEmail}</strong>.
                  Invitation from <strong>{sessionResult.inviterDisplayName}</strong>.
                </p>
              </div>

              {sessionResult.existingWorkspace ? (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700 leading-relaxed">
                  <strong>Existing workspace detected:</strong> Your account already owns a Career Launch workspace. Accepting this invitation marks the invitation complete and opens your existing private workspace without overwriting any of your saved records or changing sharing settings.
                </div>
              ) : (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm">
                  <div>
                    <dt className="text-xs font-medium text-slate-500">
                      Workspace ownership
                    </dt>
                    <dd className="mt-0.5 font-semibold text-slate-900">
                      1 independent job-seeker workspace ({sessionResult.recipientEmail})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">
                      Default sharing setting
                    </dt>
                    <dd className="mt-0.5 font-semibold text-slate-900">
                      Private — only you
                    </dd>
                  </div>
                </dl>
              )}

              {actionError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900"
                >
                  {actionError}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={redeeming}
                  onClick={handleAcceptInvitation}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-teal-800 hover:bg-teal-900 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {redeeming && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>
                    {redeeming
                      ? "Creating private workspace..."
                      : "Accept invitation & open workspace"}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={redeeming}
                  onClick={onCancelAndReturn}
                  className="px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Return without accepting
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="max-w-2xl w-full mx-auto pb-2 text-xs text-slate-500">
        Career Launch · Private owner-scoped Cloud Firestore workspaces
      </footer>
    </div>
  );
};
