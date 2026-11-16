import React, { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Briefcase,
  CalendarCheck,
  CheckCircle2,
  Compass,
  GitBranch,
  Loader2,
  LogOut,
  Menu,
  Scale,
  Settings,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID } from "../firebase";
import { ServerAiStatus } from "../services/apiClient";
import { NavSection, PersistenceIndicatorState } from "../types/models";

interface LayoutShellProps {
  activeNav: NavSection;
  onSelectNav: (nav: NavSection) => void;
  onQuickAddOpportunity: () => void;
  aiStatus: ServerAiStatus;
  allowServerSideAi: boolean;
  onToggleServerSideAi: (val: boolean) => void;
  isDemoMode: boolean;
  isAdmin?: boolean;
  workspaceOwnerName?: string;
  userEmail: string | null;
  persistence: PersistenceIndicatorState;
  onDismissSaveError: () => void;
  onSignOutOrExitDemo: () => void;
  onOpenAdminInvitations?: () => void;
  counts: {
    todayTasksOpen: number;
    opportunitiesActive: number;
    unverifiedEvidence: number;
    overdueFollowUps: number;
  };
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "today", label: "Today", shortLabel: "Today", icon: CalendarCheck },
  { id: "profile", label: "My Profile", shortLabel: "Profile", icon: UserCheck },
  { id: "discover", label: "Find & Evaluate", shortLabel: "Evaluate", icon: Compass },
  { id: "opportunities", label: "Opportunities", shortLabel: "Opportunities", icon: Briefcase },
  { id: "people", label: "People & Outreach", shortLabel: "Outreach", icon: Users },
  { id: "practice", label: "Practice & Learn", shortLabel: "Practice", icon: BookOpen },
  { id: "connections", label: "Connections", shortLabel: "Connections", icon: GitBranch },
  { id: "progress", label: "Decisions & Progress", shortLabel: "Progress", icon: Scale },
  { id: "settings", label: "Settings", shortLabel: "Settings", icon: Settings },
];

export const LayoutShell: React.FC<LayoutShellProps> = ({
  activeNav,
  onSelectNav,
  onQuickAddOpportunity,
  aiStatus,
  allowServerSideAi,
  onToggleServerSideAi,
  isDemoMode,
  isAdmin = false,
  workspaceOwnerName = "",
  userEmail,
  persistence,
  onDismissSaveError,
  onSignOutOrExitDemo,
  onOpenAdminInvitations,
  counts,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [storageInfoOpen, setStorageInfoOpen] = useState(false);

  const activeItem = NAV_ITEMS.find((i) => i.id === activeNav) ?? NAV_ITEMS[0];
  const brandTitle =
    isDemoMode || workspaceOwnerName.trim().toLowerCase() === "nora crafts"
      ? "Nora’s Career Launch"
      : "Career Launch";

  const getCountNote = (id: NavSection): string | null => {
    if (id === "today" && counts.todayTasksOpen > 0) return String(counts.todayTasksOpen);
    if (id === "opportunities" && counts.opportunitiesActive > 0)
      return String(counts.opportunitiesActive);
    if (id === "profile" && counts.unverifiedEvidence > 0)
      return `${counts.unverifiedEvidence} to verify`;
    if (id === "progress" && counts.overdueFollowUps > 0)
      return `${counts.overdueFollowUps} due`;
    return null;
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract (height <= 56px to respect 15% mobile sticky cap) */}
      <header className="sticky top-0 z-30 h-14 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Title */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="lg:hidden p-2 -ml-2 text-slate-700 hover:text-slate-900 rounded-md"
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button
            type="button"
            onClick={() => onSelectNav("today")}
            className="text-base lg:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 text-left"
          >
            {brandTitle}
          </button>
        </div>

        {/* Zone 2: Clean single-line text links on top bar for rapid section jumping */}
        <nav
          aria-label="Quick navigation"
          className="hidden xl:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          {NAV_ITEMS.slice(0, 5).map((item) => {
            const isCurrent = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectNav(item.id)}
                className={`whitespace-nowrap shrink-0 py-1 transition-colors border-b-2 ${
                  isCurrent
                    ? "text-teal-900 border-teal-800 font-semibold"
                    : "border-transparent hover:text-slate-900 hover:border-slate-300"
                }`}
              >
                {item.shortLabel}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onQuickAddOpportunity}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Add Opportunity
          </button>
        </div>
      </header>

      {/* Main Workspace Canvas: Left Sidebar (260px) + Viewport */}
      <div className="flex-1 flex relative">
        {/* Mobile Backdrop */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar Navigation */}
        <aside
          aria-label="Primary workspace navigation"
          className={`fixed lg:static inset-y-0 left-0 z-20 w-64 bg-white border-r border-slate-200 pt-16 lg:pt-5 pb-6 px-3 flex flex-col justify-between transition-transform duration-150 ease-out ${
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeNav === item.id;
              const countNote = getCountNote(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectNav(item.id);
                    setMobileMenuOpen(false);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    active
                      ? "bg-slate-100 text-slate-950 font-semibold"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium"
                  }`}
                >
                  <span className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
                    <Icon
                      className={`w-4 h-4 ${
                        active ? "text-teal-800" : "text-slate-400"
                      }`}
                    />
                    <span>{item.label}</span>
                  </span>
                  {countNote && (
                    <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
                      {countNote}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Admin-only Entry Point: Settings -> People & Invitations */}
            {isAdmin && onOpenAdminInvitations && (
              <div className="pl-7 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    onOpenAdminInvitations();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium text-teal-900 hover:bg-teal-50 transition-colors whitespace-nowrap"
                >
                  People & Invitations
                </button>
              </div>
            )}
          </div>

          {/* Authenticated Account & Persistence Disclosure Footer */}
          <div className="mt-8 pt-4 border-t border-slate-200 px-3 space-y-2.5 text-xs text-slate-600">
            {isDemoMode ? (
              <>
                <div className="font-semibold text-amber-900">
                  Demo mode — database not connected
                </div>
                <p className="leading-relaxed text-amber-900/90">
                  Temporary preview only. Do not enter real personal information. Sign in to connect Cloud Firestore.
                </p>
              </>
            ) : (
              <>
                <div className="font-semibold text-slate-900 truncate" title={userEmail || ""}>
                  {userEmail || "Authenticated User"}
                </div>
                <p className="leading-relaxed">
                  Connected to private Cloud Firestore workspace. Syncs across devices after sign-in.
                </p>
              </>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStorageInfoOpen(true)}
                className="text-teal-800 hover:underline font-medium whitespace-nowrap shrink-0"
              >
                Security & Backups
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => {
                  onSelectNav("progress");
                  setMobileMenuOpen(false);
                }}
                className="text-teal-800 hover:underline font-medium whitespace-nowrap shrink-0"
              >
                Export / Delete
              </button>
            </div>

            <button
              type="button"
              onClick={onSignOutOrExitDemo}
              className="w-full mt-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{isDemoMode ? "Exit Demo & Sign In" : "Sign Out"}</span>
            </button>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main
          id="main-content"
          className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-6 lg:py-8 max-w-6xl"
        >
          {/* Explicit Demo Mode Warning Banner (Requirement: Never present Demo Mode as ready for real personal info) */}
          {isDemoMode && (
            <div
              role="alert"
              className="mb-5 bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 text-xs sm:text-sm text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold">
                    Demo mode — database not connected.
                  </strong>{" "}
                  Changes in this preview live only in temporary browser memory and are not saved to any database. Do not enter real personal information here.
                </div>
              </div>
              <button
                type="button"
                onClick={onSignOutOrExitDemo}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-amber-900 hover:bg-amber-950 rounded-lg whitespace-nowrap shrink-0 self-start sm:self-center"
              >
                Sign In to Connect Database
              </button>
            </div>
          )}

          {/* Honest Failed-to-Save Error Banner (Acceptance Test #6: Never show false success when write fails) */}
          {persistence.status === "error" && persistence.errorMessage && (
            <div
              role="alert"
              className="mb-5 bg-red-50 border border-red-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 text-xs sm:text-sm text-red-950">
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold block">
                    Failed to save to database — changes were not confirmed
                  </strong>
                  <span className="text-xs text-red-900 block mt-0.5">
                    {persistence.errorMessage}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismissSaveError}
                className="px-3 py-1 text-xs font-medium text-red-900 bg-white border border-red-300 rounded-md hover:bg-red-100 whitespace-nowrap shrink-0 self-start"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Contextual Breadcrumb & Honest Save State Strip */}
          <div className="mb-6 pb-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span>Workspace</span>
              <span aria-hidden="true">/</span>
              <span className="text-slate-800 font-medium">{activeItem.label}</span>
              <span aria-hidden="true">·</span>
              <span>
                {isDemoMode
                  ? "Isolated Demo Session"
                  : userEmail || "Authenticated Workspace"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Accurate Database Save Indicator */}
              {isDemoMode ? (
                <span className="text-amber-800 font-medium">
                  Demo mode — not saving to database
                </span>
              ) : persistence.status === "saving" ? (
                <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-800" />
                  <span>
                    Saving{persistence.lastActionLabel ? ` (${persistence.lastActionLabel})` : ""}...
                  </span>
                </span>
              ) : persistence.status === "error" ? (
                <span className="inline-flex items-center gap-1 text-red-700 font-semibold">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Failed to save</span>
                </span>
              ) : persistence.status === "saved" && persistence.lastSavedAt ? (
                <span className="inline-flex items-center gap-1 text-teal-900 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-800" />
                  <span className="font-mono tabular-nums">
                    Saved {persistence.lastSavedAt}
                  </span>
                </span>
              ) : (
                <span className="text-slate-600">Cloud Firestore synced</span>
              )}

              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setStorageInfoOpen(true)}
                className="text-teal-800 hover:underline font-medium whitespace-nowrap shrink-0"
              >
                Privacy & Backups
              </button>
            </div>
          </div>

          {children}
        </main>
      </div>

      {/* Database, Backup & AI Privacy Modal */}
      {storageInfoOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="storage-privacy-heading"
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-teal-800 shrink-0" />
                <h2
                  id="storage-privacy-heading"
                  className="text-lg font-bold text-slate-900"
                >
                  Database Persistence, Isolation & Backup Status
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setStorageInfoOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
              <p>
                <strong>Primary system of record:</strong>{" "}
                {isDemoMode
                  ? "Currently in isolated Demo Mode (no database writes). Sign in to use Cloud Firestore."
                  : `Cloud Firestore (Project: ${FIREBASE_PROJECT_ID}, DB: ${FIRESTORE_DATABASE_ID.slice(
                      0,
                      28
                    )}…). Browser localStorage is not used for workspace records.`}
              </p>
              <p>
                <strong>Authorization & private files:</strong> Every record and uploaded file is isolated under your verified Google account UID and enforced by Firestore Security Rules plus backend JWT verification. Uploaded résumés have no public URLs.
              </p>
              <p>
                <strong>Backup & recovery honesty:</strong> Firestore replicates live data across storage replicas, <em>however</em> automated scheduled backups and Point-in-Time Recovery (PITR) are <strong>not enabled or verified by default</strong>. Enabling scheduled backups or PITR requires manual configuration in the Google Cloud / Firebase Console; export JSON backups regularly in the meantime.
              </p>
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowServerSideAi}
                  onChange={(e) => onToggleServerSideAi(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-800"
                />
                <span className="text-sm text-slate-800">
                  <span className="font-semibold block">
                    Allow opt-in authenticated server-side Gemini analysis & live web checks
                  </span>
                  <span className="text-xs text-slate-600 block mt-0.5">
                    Protected by your Firebase Bearer ID token. API keys stay server-side and personal content is never written to server logs. Status:{" "}
                    {aiStatus.message}
                  </span>
                </span>
              </label>
            </div>

            <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setStorageInfoOpen(false);
                  onSelectNav("progress");
                }}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Open Export, Delete & Diagnostics
              </button>
              <button
                type="button"
                onClick={() => setStorageInfoOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
