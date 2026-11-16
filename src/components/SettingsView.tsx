import React, { useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  KeyRound,
  Loader2,
  Lock,
  Share2,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import {
  deleteCurrentFirebaseAuthUser,
  reauthenticateWithGooglePopup,
  signInWithGooglePopup,
  signOutCurrentUser,
  updateCurrentAuthDisplayName,
} from "../firebase";
import { recordUserSecurityEvent } from "../services/apiClient";
import { buildExportBundle } from "../services/firestoreWorkspace";
import { Profile, WorkspaceState } from "../types/models";
import { PeopleInvitationsAdminView } from "./PeopleInvitationsAdminView";

interface SettingsViewProps {
  workspace: WorkspaceState;
  userEmail: string | null;
  userUid: string | null;
  isAdmin: boolean;
  isDemoMode: boolean;
  initialSubTab?: "account" | "people_invitations";
  onUpdateProfile: (next: Profile) => void;
  onPermanentlyDeleteWorkspaceAndAccount: () => Promise<{
    deletedCount: number;
    deletedFilesCount: number;
  } | null>;
  onRestartOnboardingWizard?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  workspace,
  userEmail,
  userUid,
  isAdmin,
  isDemoMode,
  initialSubTab = "account",
  onUpdateProfile,
  onPermanentlyDeleteWorkspaceAndAccount,
  onRestartOnboardingWizard,
}) => {
  const [activeTab, setActiveTab] = useState<"account" | "people_invitations">(
    isAdmin && initialSubTab === "people_invitations"
      ? "people_invitations"
      : "account"
  );

  const [displayNameDraft, setDisplayNameDraft] = useState<string>(
    workspace.profile.fullName
  );
  const [savingName, setSavingName] = useState<boolean>(false);
  const [nameSavedBanner, setNameSavedBanner] = useState<string | null>(null);

  // Account deletion confirmation state (Section 12)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [deletePhrase, setDeletePhrase] = useState<string>("");
  const [deletingAccount, setDeletingAccount] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleSaveDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = displayNameDraft.trim().slice(0, 120);
    if (!cleaned) return;
    setSavingName(true);
    setNameSavedBanner(null);
    onUpdateProfile({
      ...workspace.profile,
      fullName: cleaned,
    });
    if (!isDemoMode) {
      try {
        await updateCurrentAuthDisplayName(cleaned);
      } catch {
        // Workspace Firestore profile remains primary
      }
    }
    setSavingName(false);
    setNameSavedBanner("Updated display name.");
    window.setTimeout(() => setNameSavedBanner(null), 3000);
  };

  const handleExportOwnDataJson = () => {
    const bundle = buildExportBundle(workspace);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `career-launch-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleSwitchSignInAccount = async () => {
    await signOutCurrentUser();
    try {
      await signInWithGooglePopup();
    } catch {
      // User can sign in from AuthGateView
    }
  };

  const handlePermanentAccountDeletion = async () => {
    if (deletePhrase.trim() !== "DELETE MY ACCOUNT" || deletingAccount) return;
    setDeletingAccount(true);
    setDeleteError(null);

    try {
      if (!isDemoMode) {
        await recordUserSecurityEvent(
          "account_deleted",
          "owner_initiated_workspace_and_account_deletion"
        );
      }

      const deleted = await onPermanentlyDeleteWorkspaceAndAccount();
      if (!deleted && !isDemoMode) {
        setDeleteError(
          "Could not finish deleting all workspace records. No authentication credentials were removed yet; please retry."
        );
        setDeletingAccount(false);
        return;
      }

      if (!isDemoMode) {
        try {
          await deleteCurrentFirebaseAuthUser();
        } catch (authErr) {
          const msg =
            authErr instanceof Error ? authErr.message : String(authErr);
          if (msg.includes("requires-recent-login")) {
            await reauthenticateWithGooglePopup();
            await deleteCurrentFirebaseAuthUser();
          } else {
            await signOutCurrentUser();
          }
        }
      }
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : "Account deletion encountered an error."
      );
      setDeletingAccount(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Settings Header & Role-Aware Sub-Navigation */}
      <div className="space-y-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Settings
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage your account, sign-in methods, workspace sharing, data exports, and account deletion.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("account")}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "account"
                ? "bg-slate-900 text-white border-slate-900 font-semibold"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 font-medium"
            }`}
          >
            <UserCog className="w-4 h-4" />
            <span>Account & Sharing</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab("people_invitations")}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                activeTab === "people_invitations"
                  ? "bg-slate-900 text-white border-slate-900 font-semibold"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 font-medium"
              }`}
            >
              <Users className="w-4 h-4" />
              <span>People & Invitations</span>
            </button>
          )}
        </div>
      </div>

      {/* ADMIN-ONLY SCREEN: SETTINGS -> PEOPLE & INVITATIONS */}
      {activeTab === "people_invitations" && isAdmin ? (
        <PeopleInvitationsAdminView
          adminDisplayName={
            workspace.profile.fullName || userEmail || "Administrator"
          }
          adminUid={userUid || ""}
        />
      ) : (
        /* EVERY USER: ACCOUNT, SIGN-IN, SHARING, EXPORT & DELETION (Section 2 & 12) */
        <div className="space-y-6">
          {/* 1. Display Name & First-Login Setup */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Profile & Display Name
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                  Used inside your private workspace and on invitations if you are an authorized administrator.
                </p>
              </div>
              {onRestartOnboardingWizard && (
                <button
                  type="button"
                  onClick={onRestartOnboardingWizard}
                  className="px-3 py-1.5 text-xs font-medium text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg whitespace-nowrap shrink-0 self-start"
                >
                  Open 6-Step Guided Setup
                </button>
              )}
            </div>

            <form
              onSubmit={handleSaveDisplayName}
              className="flex flex-col sm:flex-row sm:items-end gap-3 max-w-xl"
            >
              <div className="flex-1">
                <label
                  htmlFor="account-display-name"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Display name
                </label>
                <input
                  id="account-display-name"
                  type="text"
                  maxLength={120}
                  value={displayNameDraft}
                  onChange={(e) => setDisplayNameDraft(e.target.value)}
                  placeholder="Your preferred name"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <button
                type="submit"
                disabled={savingName || !displayNameDraft.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-teal-800 hover:bg-teal-900 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
              >
                {savingName ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>Save name</span>
              </button>
            </form>
            {nameSavedBanner && (
              <p className="text-xs font-medium text-teal-800">
                {nameSavedBanner}
              </p>
            )}
          </section>

          {/* 2. Sign-In Methods */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-teal-800 shrink-0" />
              <h2 className="text-base font-semibold text-slate-900">
                Sign-In & Authentication Method
              </h2>
            </div>

            {isDemoMode ? (
              <p className="text-sm text-amber-900">
                Currently viewing isolated Demo Mode without an authenticated account. Sign in with Google to use a persistent Cloud Firestore workspace.
              </p>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="space-y-1 text-sm">
                  <div className="font-semibold text-slate-900">
                    Google Sign-In (Firebase Authentication)
                  </div>
                  <div className="text-xs text-slate-600">
                    Verified email:{" "}
                    <span className="font-mono text-slate-900">
                      {userEmail || "Verified"}
                    </span>{" "}
                    · Password management and two-factor authentication are handled directly by your Google account.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSwitchSignInAccount}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0 self-start sm:self-center"
                >
                  Switch Google Account
                </button>
              </div>
            )}
          </section>

          {/* 3. Sharing Settings & Separate Disabled "Invite reviewer" Action (Section 1, 2, 12) */}
          <section
            aria-labelledby="sharing-settings-heading"
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="space-y-1 max-w-2xl">
                <div className="flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-teal-800 shrink-0" />
                  <h2
                    id="sharing-settings-heading"
                    className="text-base font-semibold text-slate-900"
                  >
                    Sharing & Reviewer Permissions
                  </h2>
                </div>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Control who can view selected material in your workspace. Reviewer access is strictly separate from inviting a new job seeker to start their own workspace.
                </p>
              </div>

              {/* Separate "Invite reviewer" action in Sharing settings — explicitly disabled until selective sharing is implemented */}
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Disabled until selective item-level reviewer permissions are enabled"
                className="px-4 py-2 text-xs font-semibold text-slate-400 bg-slate-100 border border-slate-200 rounded-lg cursor-not-allowed whitespace-nowrap shrink-0 self-start"
              >
                Invite reviewer (coming soon)
              </button>
            </div>

            <div className="p-4 rounded-xl bg-teal-50/60 border border-teal-200 flex items-start gap-3">
              <Lock className="w-4 h-4 text-teal-800 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs sm:text-sm text-teal-950">
                <div className="font-semibold">
                  Active workspace visibility: Private — only you
                </div>
                <p className="leading-relaxed opacity-90">
                  <strong>0 active reviewers.</strong> Nobody else — including the person who invited you or application administrators — has application access to your profile, documents, opportunities, outreach drafts, or practice sessions. Reviewer invitations remain disabled until granular item-level permissions are completed; unrestricted reviewer access is never used as a shortcut.
                </p>
              </div>
            </div>
          </section>

          {/* 4. Export Own Data */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1 max-w-xl">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-teal-800 shrink-0" />
                <h2 className="text-base font-semibold text-slate-900">
                  Export Your Workspace Records
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-slate-600">
                Download a complete JSON copy of your profile, evidence, opportunities, assessments, outreach drafts, tasks, practice history, and private document metadata references.
              </p>
            </div>
            <button
              type="button"
              onClick={handleExportOwnDataJson}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0 self-start sm:self-center"
            >
              <Download className="w-4 h-4" />
              <span>Export JSON Backup</span>
            </button>
          </section>

          {/* 5. Account & Workspace Deletion (Section 12) */}
          <section className="bg-white border border-red-200 rounded-xl p-6 space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-700 shrink-0" />
                <h2 className="text-base font-semibold text-slate-900">
                  Delete Account & Private Workspace
                </h2>
              </div>
              <div className="text-xs sm:text-sm text-slate-600 space-y-1.5 leading-relaxed">
                <p>
                  <strong>What this permanently deletes:</strong> Deleting your account removes your root profile document (<code className="font-mono">/users/&#123;uid&#125;</code>), all 11 career record subcollections, all uploaded private résumé and job-posting files (<code className="font-mono">documents</code> and <code className="font-mono">documentBlobs</code>), and your Career Launch Firebase Authentication user record.
                </p>
                <p>
                  <strong>How this differs from admin actions:</strong> Only you (the workspace owner) can delete your workspace records and files through the application. An administrator revoking an unredeemed invitation cancels only an unused invite link and never deletes or suspends an active user’s workspace.
                </p>
              </div>
            </div>

            {!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(true);
                  setDeletePhrase("");
                  setDeleteError(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-red-800 bg-red-50 hover:bg-red-100 border border-red-300 rounded-lg whitespace-nowrap shrink-0"
              >
                Delete my account & workspace...
              </button>
            ) : (
              <div className="p-4 rounded-xl bg-red-50 border border-red-300 space-y-3">
                <div className="flex items-start gap-2 text-xs text-red-950">
                  <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  <p>
                    Export a JSON backup above first if you want to keep a copy. Type{" "}
                    <strong className="font-mono">DELETE MY ACCOUNT</strong>{" "}
                    below to permanently erase all database records, uploaded files, and your Career Launch sign-in.
                  </p>
                </div>

                <input
                  type="text"
                  value={deletePhrase}
                  onChange={(e) => setDeletePhrase(e.target.value)}
                  placeholder="Type DELETE MY ACCOUNT"
                  className="w-full max-w-sm px-3 py-2 text-sm font-mono border border-red-300 rounded-lg bg-white"
                />

                {deleteError && (
                  <p className="text-xs font-medium text-red-800">
                    {deleteError}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={
                      deletePhrase.trim() !== "DELETE MY ACCOUNT" ||
                      deletingAccount
                    }
                    onClick={handlePermanentAccountDeletion}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    {deletingAccount && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    <span>
                      {deletingAccount
                        ? "Deleting workspace & account..."
                        : "Permanently delete account & all files"}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={deletingAccount}
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
