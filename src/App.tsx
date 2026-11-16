/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { Unsubscribe } from "firebase/firestore";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { AcceptInvitationView } from "./components/AcceptInvitationView";
import { AuthGateView } from "./components/AuthGateView";
import { ConnectionsView } from "./components/ConnectionsView";
import { DecisionsProgressView } from "./components/DecisionsProgressView";
import { FindEvaluateView } from "./components/FindEvaluateView";
import { FirstLoginOnboardingWizard } from "./components/FirstLoginOnboardingWizard";
import { LayoutShell } from "./components/LayoutShell";
import { OpportunitiesView } from "./components/OpportunitiesView";
import { PeopleOutreachView } from "./components/PeopleOutreachView";
import { PracticeLearnView } from "./components/PracticeLearnView";
import { ProfileView } from "./components/ProfileView";
import { SettingsView } from "./components/SettingsView";
import { TodayView } from "./components/TodayView";
import {
  CURRENT_SCHEMA_VERSION,
  STARTER_RETHINKBH_ID,
  createStarterWorkspaceState,
  getTodayIsoDate,
} from "./data/initialData";
import {
  auth,
  extractReadableSaveError,
  isFirebaseConfigured,
  signOutCurrentUser,
  testFirestoreConnection,
} from "./firebase";
import {
  ServerAiStatus,
  fetchAuthSession,
  fetchServerAiStatus,
} from "./services/apiClient";
import {
  createApplicationVersionInFirestore,
  createContactInFirestore,
  createEvidenceInFirestore,
  createLearningItemInFirestore,
  createOpportunityWithAssessmentsInFirestore,
  createOutreachDraftInFirestore,
  createPracticeSessionInFirestore,
  createTaskInFirestore,
  createTimeLogInFirestore,
  deleteAllUserRecordsAndFilesFromFirestore,
  deleteAuthenticityReviewFromFirestore,
  deleteContactFromFirestore,
  deleteEvidenceFromFirestore,
  deleteOpportunityCascadeFromFirestore,
  deletePrivateDocumentFromFirestore,
  downloadPrivateDocumentFromFirestore,
  ensureUserWorkspaceInitialized,
  importWorkspaceBackupToFirestore,
  permanentlyDeleteUserWorkspaceFromFirestore,
  pruneRemovedEvidenceFromRelationshipsInFirestore,
  replaceAssessmentsForOpportunityInFirestore,
  sanitizeId,
  saveUserDocToFirestore,
  subscribeToUserWorkspace,
  triggerDiagnosticRejectedSave,
  updateContactInFirestore,
  updateEvidenceInFirestore,
  updateLearningItemInFirestore,
  updateOpportunityInFirestore,
  updateTaskInFirestore,
  uploadPrivateDocumentToFirestore,
  upsertAuthenticityReviewInFirestore,
  upsertRelationshipEdgeInFirestore,
} from "./services/firestoreWorkspace";
import {
  ApplicationVersion,
  AuthenticityReview,
  Contact,
  Evidence,
  InviterSuggestionItem,
  LearningItem,
  NavSection,
  OnboardingWizardState,
  Opportunity,
  OutreachDraft,
  PersistenceIndicatorState,
  PracticeSession,
  PrivateDocumentCategory,
  PrivateDocumentMeta,
  Profile,
  RequirementAssessment,
  Task,
  TimeLogEntry,
  WorkspaceSettings,
  WorkspaceSharingSettings,
  WorkspaceState,
} from "./types/models";
import { validateReviewWorkspaceIsolation } from "./utils/authenticityReviewEngine";
import {
  RelationshipCandidateInput,
  validateRelationshipEdgeCandidate,
} from "./utils/relationshipGraphEngine";

function formatClockTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function createEmptyClearedWorkspace(): WorkspaceState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: {
      id: "profile-unauthenticated",
      fullName: "",
      location: "",
      educationSummary: "",
      rbtCertificationStatus: "unverified",
      rbtCertificationNote: "",
      littleLeavesSoftwareUsed: "",
      otherExperienceNotes: "",
      masterResumeText: "",
      masterResumeUpdatedAt: null,
      profileVerifiedByNora: false,
      constraints: {
        minBaseSalary: null,
        minBaseSalaryUnsure: true,
        desiredTotalComp: null,
        desiredTotalCompUnsure: true,
        benefitsRequirement: "not_sure",
        employmentType: "not_sure",
        workArrangement: "not_sure",
        maxCommuteMinutes: null,
        maxCommuteUnsure: true,
        willingToRelocate: "not_sure",
        scheduleAndStartAvailability: "Not sure yet",
        commissionTolerance: "not_sure",
        outboundCallingComfort: "not_sure",
        preferredIndustries: "",
        excludedIndustries: "",
        travelLimits: "Not sure yet",
        trainingTimeWeeklyHours: "Not sure yet",
        trainingBudgetDollars: "Not sure yet",
        onboardingReviewed: false,
      },
    },
    evidence: [],
    opportunities: [],
    assessments: [],
    applicationVersions: [],
    contacts: [],
    outreachDrafts: [],
    tasks: [],
    practiceSessions: [],
    learningItems: [],
    timeLogs: [],
    documents: [],
    relationships: [],
    crmSimulation: {
      searchedQueries: [],
      conversationLogs: [],
      followUpTasks: [],
      handoffNotes: [],
    },
    settings: {
      availableMinutesToday: 45,
      allowServerSideAi: false,
      showSampleComparisonData: false,
    },
  };
}

interface ErrorBoundaryState {
  hasError: boolean;
  readableMessage: string;
}

class WorkspaceErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, readableMessage: "" };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      readableMessage: extractReadableSaveError(error),
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F9F9F8] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#FECACA] rounded-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#B91C1C] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h1 className="text-base font-semibold text-[#18181B]">
                  Workspace encountered an unexpected error
                </h1>
                <p className="text-sm text-[#52525B]">
                  {this.state.readableMessage}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-[#1F4E5F] text-white text-sm font-medium hover:bg-[#173c4a]"
            >
              Reload Workspace
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function extractInitialInviteTokenFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("invite")?.trim();
    if (raw) {
      params.delete("invite");
      const remaining = params.toString();
      const cleanUrl = `${window.location.pathname}${
        remaining ? `?${remaining}` : ""
      }${window.location.hash || ""}`;
      window.history.replaceState({}, "", cleanUrl);
      return raw;
    }
  } catch {
    // Ignore history API restrictions if any
  }
  return null;
}

function CareerLaunchWorkspace() {
  const [activeInviteToken, setActiveInviteToken] = useState<string | null>(() =>
    extractInitialInviteTokenFromUrl()
  );

  const [authReady, setAuthReady] = useState<boolean>(!isFirebaseConfigured);
  const [authUser, setAuthUser] = useState<{
    uid: string;
    email: string | null;
    displayName: string | null;
  } | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(!isFirebaseConfigured);

  const [dbReachable, setDbReachable] = useState<boolean>(isFirebaseConfigured);
  const [connectionDetail, setConnectionDetail] = useState<string>(
    isFirebaseConfigured
      ? "Verifying Cloud Firestore connection..."
      : "Demo mode — database not connected (Firebase configuration missing)."
  );

  const [isBootstrappingWorkspace, setIsBootstrappingWorkspace] =
    useState<boolean>(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState<number>(0);

  const [workspace, setWorkspace] = useState<WorkspaceState>(() =>
    !isFirebaseConfigured
      ? createStarterWorkspaceState()
      : createEmptyClearedWorkspace()
  );
  const workspaceRef = useRef<WorkspaceState>(workspace);
  workspaceRef.current = workspace;

  const [activeNav, setActiveNav] = useState<NavSection>("today");
  const [practiceSubTab, setPracticeSubTab] = useState<
    "rehearse" | "crm" | "skills" | "learning"
  >("rehearse");
  const [settingsSubTab, setSettingsSubTab] = useState<
    "account" | "people_invitations"
  >("account");
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(
    STARTER_RETHINKBH_ID
  );
  const [aiStatus, setAiStatus] = useState<ServerAiStatus>({
    available: false,
    liveWebAvailable: false,
    message: "Checking server-side AI configuration...",
  });

  const [persistence, setPersistence] = useState<PersistenceIndicatorState>({
    status: "idle",
    pendingCount: 0,
    lastSavedAt: null,
    lastActionLabel: null,
    errorMessage: null,
  });

  const pendingWritesRef = useRef<number>(0);
  const userDocDebounceRef = useRef<number | null>(null);
  const userDocDirtyLockUntilRef = useRef<number>(0);

  // Verify Firestore reachability & server AI status on boot
  useEffect(() => {
    fetchServerAiStatus().then(setAiStatus);
    testFirestoreConnection().then((res) => {
      setDbReachable(res.reachable);
      setConnectionDetail(res.detail);
    });
  }, []);

  // Subscribe to Firebase Authentication state
  useEffect(() => {
    if (!auth || !isFirebaseConfigured) {
      setAuthReady(true);
      setIsDemoMode(true);
      return;
    }

    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (userDocDebounceRef.current !== null) {
        window.clearTimeout(userDocDebounceRef.current);
        userDocDebounceRef.current = null;
      }
      pendingWritesRef.current = 0;
      userDocDirtyLockUntilRef.current = 0;

      if (firebaseUser) {
        setAuthUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? null,
          displayName: firebaseUser.displayName ?? null,
        });
        setIsDemoMode(false);
        setPersistence({
          status: "idle",
          pendingCount: 0,
          lastSavedAt: null,
          lastActionLabel: null,
          errorMessage: null,
        });
      } else {
        setAuthUser(null);
        setIsAdmin(false);
        // Immediately wipe private records from browser memory on sign-out
        setWorkspace(createEmptyClearedWorkspace());
        setIsBootstrappingWorkspace(false);
        setBootstrapError(null);
        setPersistence({
          status: "idle",
          pendingCount: 0,
          lastSavedAt: null,
          lastActionLabel: null,
          errorMessage: null,
        });
      }
      setAuthReady(true);
    });

    return () => unsubAuth();
  }, []);

  // Verify Application Administrator status from backend JWT session endpoint
  useEffect(() => {
    if (!authUser) {
      setIsAdmin(false);
      return;
    }
    let active = true;
    fetchAuthSession().then((session) => {
      if (active && session) {
        setIsAdmin(Boolean(session.isAdmin));
      }
    });
    return () => {
      active = false;
    };
  }, [authUser]);

  // Connect to authenticated user's private Cloud Firestore workspace
  // (Paused while activeInviteToken is present so invitation acceptance atomically initializes workspace first)
  useEffect(() => {
    if (!authUser || activeInviteToken) return;

    let cancelled = false;
    let unsubFirestore: Unsubscribe | null = null;

    setIsBootstrappingWorkspace(true);
    setBootstrapError(null);

    (async () => {
      try {
        await ensureUserWorkspaceInitialized(authUser.uid, {
          displayName: authUser.displayName,
          email: authUser.email,
        });
        if (cancelled) return;

        unsubFirestore = subscribeToUserWorkspace(authUser.uid, {
          onUserDoc: ({
            profile,
            settings,
            crmSimulation,
            onboardingWizard,
            sharingSettings,
            inviterSuggestions,
          }) => {
            if (Date.now() < userDocDirtyLockUntilRef.current) {
              return;
            }
            setWorkspace((prev) => ({
              ...prev,
              profile,
              settings,
              crmSimulation,
              onboardingWizard,
              sharingSettings,
              inviterSuggestions,
            }));
          },
          onEvidence: (evidence) => {
            setWorkspace((prev) => ({ ...prev, evidence }));
          },
          onOpportunities: (opportunities) => {
            setWorkspace((prev) => ({ ...prev, opportunities }));
            setSelectedOpportunityId((currentId) => {
              if (currentId && opportunities.some((o) => o.id === currentId)) {
                return currentId;
              }
              const starter = opportunities.find(
                (o) => o.id === STARTER_RETHINKBH_ID
              );
              if (starter) return starter.id;
              return opportunities[0]?.id ?? null;
            });
          },
          onAssessments: (assessments) => {
            setWorkspace((prev) => ({ ...prev, assessments }));
          },
          onContacts: (contacts) => {
            setWorkspace((prev) => ({ ...prev, contacts }));
          },
          onOutreachDrafts: (outreachDrafts) => {
            setWorkspace((prev) => ({ ...prev, outreachDrafts }));
          },
          onApplicationVersions: (applicationVersions) => {
            setWorkspace((prev) => ({ ...prev, applicationVersions }));
          },
          onTasks: (tasks) => {
            setWorkspace((prev) => ({ ...prev, tasks }));
          },
          onPracticeSessions: (practiceSessions) => {
            setWorkspace((prev) => ({ ...prev, practiceSessions }));
          },
          onLearningItems: (learningItems) => {
            setWorkspace((prev) => ({ ...prev, learningItems }));
          },
          onTimeLogs: (timeLogs) => {
            setWorkspace((prev) => ({ ...prev, timeLogs }));
          },
          onDocuments: (documents) => {
            setWorkspace((prev) => ({ ...prev, documents }));
          },
          onRelationships: (relationships) => {
            setWorkspace((prev) => ({ ...prev, relationships }));
          },
          onAuthenticityReviews: (authenticityReviews) => {
            setWorkspace((prev) => ({ ...prev, authenticityReviews }));
          },
          onListenerError: (err) => {
            setPersistence((prev) => ({
              ...prev,
              status: "error",
              errorMessage: extractReadableSaveError(err),
            }));
          },
        });

        setIsBootstrappingWorkspace(false);
        setPersistence({
          status: "saved",
          pendingCount: 0,
          lastSavedAt: formatClockTime(),
          lastActionLabel: "Workspace connected",
          errorMessage: null,
        });
      } catch (err) {
        if (cancelled) return;
        setIsBootstrappingWorkspace(false);
        setBootstrapError(extractReadableSaveError(err));
      }
    })();

    return () => {
      cancelled = true;
      if (unsubFirestore) {
        unsubFirestore();
      }
    };
  }, [authUser, activeInviteToken, bootstrapAttempt]);

  /**
   * Executes a discrete Firestore mutation while tracking real save status.
   * Never reports "Saved" if the database write rejects.
   */
  const runTrackedWrite = useCallback(
    async <T,>(
      fn: (uid: string) => Promise<T>,
      actionLabel = "Workspace update"
    ): Promise<{ ok: true; value: T } | { ok: false }> => {
      if (!authUser) {
        return { ok: false };
      }

      pendingWritesRef.current += 1;
      setPersistence((prev) => ({
        ...prev,
        status: "saving",
        pendingCount: pendingWritesRef.current,
        lastActionLabel: actionLabel,
        errorMessage: null,
      }));

      try {
        const value = await fn(authUser.uid);
        pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
        const stillSaving =
          pendingWritesRef.current > 0 || userDocDebounceRef.current !== null;
        setPersistence({
          status: stillSaving ? "saving" : "saved",
          pendingCount: pendingWritesRef.current,
          lastSavedAt: formatClockTime(),
          lastActionLabel: actionLabel,
          errorMessage: null,
        });
        return { ok: true, value };
      } catch (err) {
        pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
        const readable = extractReadableSaveError(err);
        setPersistence((prev) => ({
          ...prev,
          status: "error",
          pendingCount: pendingWritesRef.current,
          lastActionLabel: actionLabel,
          errorMessage: readable,
        }));
        return { ok: false };
      }
    },
    [authUser]
  );

  /**
   * Schedules a debounced Firestore update for the root user document
   * (`profile`, `settings`, `crmSimulation`) so controlled inputs stay responsive
   * while still showing honest Saving... -> Saved / Failed-to-save states.
   */
  const scheduleUserDocSave = useCallback(
    (
      nextProfile: Profile,
      nextSettings: WorkspaceSettings,
      nextCrm: WorkspaceState["crmSimulation"],
      explicitExtras?: {
        onboardingWizard?: OnboardingWizardState;
        sharingSettings?: WorkspaceSharingSettings;
        inviterSuggestions?: InviterSuggestionItem[];
      }
    ) => {
      if (isDemoMode || !authUser) {
        setPersistence({
          status: "idle",
          pendingCount: 0,
          lastSavedAt: null,
          lastActionLabel: null,
          errorMessage: null,
        });
        return;
      }

      const targetUid = authUser.uid;
      const cur = workspaceRef.current;
      const mergedExtras = {
        onboardingWizard:
          explicitExtras?.onboardingWizard ?? cur.onboardingWizard,
        sharingSettings: explicitExtras?.sharingSettings ?? cur.sharingSettings,
        inviterSuggestions:
          explicitExtras?.inviterSuggestions ?? cur.inviterSuggestions,
      };

      userDocDirtyLockUntilRef.current = Date.now() + 1400;

      if (userDocDebounceRef.current !== null) {
        window.clearTimeout(userDocDebounceRef.current);
      }

      setPersistence((prev) => ({
        ...prev,
        status: "saving",
        lastActionLabel: "Profile & workspace preferences",
        errorMessage: null,
      }));

      userDocDebounceRef.current = window.setTimeout(async () => {
        userDocDebounceRef.current = null;
        pendingWritesRef.current += 1;
        try {
          await saveUserDocToFirestore(
            targetUid,
            nextProfile,
            nextSettings,
            nextCrm,
            mergedExtras
          );
          pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
          setPersistence({
            status: pendingWritesRef.current > 0 ? "saving" : "saved",
            pendingCount: pendingWritesRef.current,
            lastSavedAt: formatClockTime(),
            lastActionLabel: "Profile & workspace preferences",
            errorMessage: null,
          });
        } catch (err) {
          pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
          setPersistence((prev) => ({
            ...prev,
            status: "error",
            pendingCount: pendingWritesRef.current,
            lastActionLabel: "Profile & workspace preferences",
            errorMessage: extractReadableSaveError(err),
          }));
        }
      }, 450);
    },
    [authUser, isDemoMode]
  );

  const handleEnterIsolatedDemoMode = () => {
    setWorkspace(createStarterWorkspaceState());
    setSelectedOpportunityId(STARTER_RETHINKBH_ID);
    setIsDemoMode(true);
    setPersistence({
      status: "idle",
      pendingCount: 0,
      lastSavedAt: null,
      lastActionLabel: null,
      errorMessage: null,
    });
  };

  const handleSignOutOrExitDemo = async () => {
    if (userDocDebounceRef.current !== null) {
      window.clearTimeout(userDocDebounceRef.current);
      userDocDebounceRef.current = null;
    }
    if (authUser) {
      await signOutCurrentUser();
    } else {
      setIsDemoMode(false);
      setWorkspace(createEmptyClearedWorkspace());
    }
  };

  const todayIso = getTodayIsoDate(0);

  const navCounts = useMemo(() => {
    const todayTasksOpen = workspace.tasks.filter(
      (t) =>
        !t.completed &&
        !t.archived &&
        (t.scheduledBucket === "today" || t.dueDate <= todayIso)
    ).length;

    const opportunitiesActive = workspace.opportunities.filter(
      (o) => !o.archived && !o.isSampleRecord
    ).length;

    const unverifiedEvidence = workspace.evidence.filter(
      (e) => e.verificationStatus === "Needs clarification"
    ).length;

    const overdueFollowUps =
      workspace.tasks.filter(
        (t) => !t.completed && !t.archived && t.dueDate && t.dueDate < todayIso
      ).length +
      workspace.contacts.filter(
        (c) =>
          !c.doNotContact && c.nextActionDueDate && c.nextActionDueDate < todayIso
      ).length;

    return {
      todayTasksOpen,
      opportunitiesActive,
      unverifiedEvidence,
      overdueFollowUps,
    };
  }, [workspace, todayIso]);

  const handleNavigate = (section: NavSection, focusOpportunityId?: string) => {
    if (focusOpportunityId) {
      setSelectedOpportunityId(focusOpportunityId);
    }
    setActiveNav(section);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ==========================================================================
  // PROFILE, SETTINGS & CRM SIMULATION HANDLERS (Debounced Root Doc Sync)
  // ==========================================================================

  const handleUpdateProfile = (nextProfile: Profile) => {
    const cur = workspaceRef.current;
    setWorkspace((prev) => ({ ...prev, profile: nextProfile }));
    scheduleUserDocSave(nextProfile, cur.settings, cur.crmSimulation);
  };

  const handleChangeAvailableMinutes = (mins: number) => {
    const cur = workspaceRef.current;
    const nextSettings: WorkspaceSettings = {
      ...cur.settings,
      availableMinutesToday: mins,
    };
    setWorkspace((prev) => ({ ...prev, settings: nextSettings }));
    scheduleUserDocSave(cur.profile, nextSettings, cur.crmSimulation);
  };

  const handleToggleServerSideAi = (val: boolean) => {
    const cur = workspaceRef.current;
    const nextSettings: WorkspaceSettings = {
      ...cur.settings,
      allowServerSideAi: val,
    };
    setWorkspace((prev) => ({ ...prev, settings: nextSettings }));
    scheduleUserDocSave(cur.profile, nextSettings, cur.crmSimulation);
  };

  const handleToggleSampleData = (val: boolean) => {
    const cur = workspaceRef.current;
    const nextSettings: WorkspaceSettings = {
      ...cur.settings,
      showSampleComparisonData: val,
    };
    setWorkspace((prev) => ({ ...prev, settings: nextSettings }));
    scheduleUserDocSave(cur.profile, nextSettings, cur.crmSimulation);
  };

  const handleUpdateCrmSimulation = (
    nextSim: WorkspaceState["crmSimulation"]
  ) => {
    const cur = workspaceRef.current;
    setWorkspace((prev) => ({ ...prev, crmSimulation: nextSim }));
    scheduleUserDocSave(cur.profile, cur.settings, nextSim);
  };

  const handleSaveOnboardingWizardProgress = (params: {
    profile: Profile;
    wizard: OnboardingWizardState;
    inviterSuggestions: InviterSuggestionItem[];
  }) => {
    const cur = workspaceRef.current;
    setWorkspace((prev) => ({
      ...prev,
      profile: params.profile,
      onboardingWizard: params.wizard,
      inviterSuggestions: params.inviterSuggestions,
    }));
    scheduleUserDocSave(params.profile, cur.settings, cur.crmSimulation, {
      onboardingWizard: params.wizard,
      sharingSettings: cur.sharingSettings,
      inviterSuggestions: params.inviterSuggestions,
    });
  };

  const handleResumeOrStartOnboardingWizard = () => {
    const cur = workspaceRef.current;
    const nextWizard: OnboardingWizardState = cur.onboardingWizard
      ? {
          ...cur.onboardingWizard,
          completed: false,
          pausedForLater: false,
          updatedAtIso: new Date().toISOString(),
        }
      : {
          completed: false,
          pausedForLater: false,
          currentStep: 1,
          currentSituation: "",
          rolesOfInterest: "",
          rolesUnsure: false,
          workToAvoid: "",
          skillsToDevelop: "",
          experienceIntakeMode: "none",
          pastedExperienceDraft: "",
          updatedAtIso: new Date().toISOString(),
        };
    setWorkspace((prev) => ({ ...prev, onboardingWizard: nextWizard }));
    setActiveNav("today");
    scheduleUserDocSave(cur.profile, cur.settings, cur.crmSimulation, {
      onboardingWizard: nextWizard,
    });
  };

  // ==========================================================================
  // EVIDENCE HANDLERS
  // ==========================================================================

  const handleAddEvidence = async (
    item: Omit<Evidence, "id" | "dateAdded">
  ): Promise<boolean> => {
    const record: Evidence = {
      ...item,
      id: sanitizeId(`ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, "ev"),
      dateAdded: getTodayIsoDate(0),
    };
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        evidence: [record, ...prev.evidence],
      }));
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      createEvidenceInFirestore(uid, record)
    );
    return res.ok;
  };

  const handleUpdateEvidence = async (item: Evidence): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        evidence: prev.evidence.map((e) => (e.id === item.id ? item : e)),
      }));
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      updateEvidenceInFirestore(uid, item)
    );
    return res.ok;
  };

  const handleDeleteEvidence = async (id: string): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        evidence: prev.evidence.filter((e) => e.id !== id),
        relationships: (prev.relationships || [])
          .filter(
            (r) =>
              r.sourceId !== id &&
              r.sourceId !== `exp-${id}` &&
              r.sourceId !== `learn-${id}`
          )
          .map((r) => {
            if (!(r.evidenceIds || []).includes(id)) return r;
            const nextEvIds = (r.evidenceIds || []).filter((eid) => eid !== id);
            const downgrade =
              nextEvIds.length === 0 &&
              r.status === "confirmed" &&
              ["demonstrates", "supports", "adjacent_to"].includes(
                r.relationshipType
              );
            return {
              ...r,
              evidenceIds: nextEvIds,
              status: downgrade ? "suggested" : r.status,
              updatedAtIso: new Date().toISOString(),
            };
          }),
      }));
      return true;
    }
    const existingRels = workspaceRef.current.relationships || [];
    const res = await runTrackedWrite(async (uid) => {
      await deleteEvidenceFromFirestore(uid, id);
      await pruneRemovedEvidenceFromRelationshipsInFirestore(
        uid,
        id,
        existingRels
      );
    }, "Delete evidence & update graph");
    return res.ok;
  };

  // ==========================================================================
  // EVIDENCE RELATIONSHIP GRAPH HANDLER
  // ==========================================================================

  const handleSaveRelationship = async (
    candidate: RelationshipCandidateInput,
    options?: { mode?: "create" | "update"; explicitNewEvidence?: boolean }
  ): Promise<{ ok: boolean; error?: string }> => {
    const activeUid = authUser?.uid || "demo-mode";
    const cur = workspaceRef.current;
    const validation = validateRelationshipEdgeCandidate(
      { ...candidate, userId: activeUid },
      cur,
      activeUid,
      cur.relationships || [],
      {
        mode: options?.mode ?? "update",
        explicitNewEvidence: options?.explicitNewEvidence,
        strictConfirmCheck: true,
      }
    );

    if (!validation.valid || !validation.normalizedEdge) {
      return {
        ok: false,
        error:
          validation.errorMessage ||
          "Relationship did not pass workspace validation.",
      };
    }

    const edgeToSave = validation.normalizedEdge;

    if (isDemoMode) {
      setWorkspace((prev) => {
        const currentRels = prev.relationships || [];
        const exists = currentRels.some(
          (r) =>
            r.id === edgeToSave.id || r.canonicalKey === edgeToSave.canonicalKey
        );
        const nextRels = exists
          ? currentRels.map((r) =>
              r.id === edgeToSave.id ||
              r.canonicalKey === edgeToSave.canonicalKey
                ? edgeToSave
                : r
            )
          : [edgeToSave, ...currentRels];
        return {
          ...prev,
          relationships: nextRels,
        };
      });
      return { ok: true };
    }

    const alreadyPersisted = (cur.relationships || []).some(
      (r) => r.id === edgeToSave.id
    );
    const res = await runTrackedWrite(
      (uid) =>
        upsertRelationshipEdgeInFirestore(
          uid,
          { ...edgeToSave, userId: uid },
          alreadyPersisted
        ),
      "Relationship graph update"
    );
    return res.ok
      ? { ok: true }
      : { ok: false, error: "Failed to save relationship to Cloud Firestore." };
  };

  // ==========================================================================
  // AUTHENTICITY & SAFETY REVIEW HANDLERS
  // ==========================================================================

  const handleSaveAuthenticityReview = async (
    review: AuthenticityReview
  ): Promise<{ ok: boolean; error?: string }> => {
    const activeUid = authUser?.uid || "demo-mode";
    const cur = workspaceRef.current;
    const normalizedReview: AuthenticityReview = {
      ...review,
      id: sanitizeId(review.id, "authrev"),
      userId: activeUid,
    };

    const isolation = validateReviewWorkspaceIsolation({
      review: normalizedReview,
      activeUserId: activeUid,
      workspace: cur,
    });
    if (!isolation.valid) {
      return {
        ok: false,
        error:
          isolation.errorMessage ||
          "Authenticity review did not pass workspace isolation checks.",
      };
    }

    if (isDemoMode) {
      setWorkspace((prev) => {
        const list = prev.authenticityReviews || [];
        const exists = list.some((r) => r.id === normalizedReview.id);
        const nextList = exists
          ? list.map((r) =>
              r.id === normalizedReview.id ? normalizedReview : r
            )
          : [normalizedReview, ...list];
        return {
          ...prev,
          authenticityReviews: nextList,
        };
      });
      return { ok: true };
    }

    const alreadyPersisted = (cur.authenticityReviews || []).some(
      (r) => r.id === normalizedReview.id
    );
    const res = await runTrackedWrite(
      (uid) =>
        upsertAuthenticityReviewInFirestore(
          uid,
          { ...normalizedReview, userId: uid },
          alreadyPersisted
        ),
      "Authenticity & Safety Review update"
    );
    return res.ok
      ? { ok: true }
      : {
          ok: false,
          error: "Failed to save Authenticity & Safety Review to Cloud Firestore.",
        };
  };

  const handleDeleteAuthenticityReview = async (
    reviewId: string
  ): Promise<boolean> => {
    const cleanId = sanitizeId(reviewId, "authrev");
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        authenticityReviews: (prev.authenticityReviews || []).filter(
          (r) => r.id !== cleanId
        ),
      }));
      return true;
    }
    const res = await runTrackedWrite(
      (uid) => deleteAuthenticityReviewFromFirestore(uid, cleanId),
      "Delete Authenticity & Safety Review"
    );
    return res.ok;
  };

  // ==========================================================================
  // TASKS HANDLERS
  // ==========================================================================

  const handleUpdateTask = async (updated: Task): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)),
      }));
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      updateTaskInFirestore(uid, updated)
    );
    return res.ok;
  };

  const handleAddTask = async (
    item: Omit<Task, "id" | "completed" | "completedAt" | "archived">
  ): Promise<boolean> => {
    const newTask: Task = {
      ...item,
      id: sanitizeId(
        `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        "task"
      ),
      completed: false,
      completedAt: null,
      archived: false,
    };
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        tasks: [newTask, ...prev.tasks],
      }));
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      createTaskInFirestore(uid, newTask)
    );
    return res.ok;
  };

  // ==========================================================================
  // OPPORTUNITIES, ASSESSMENTS & APPLICATION VERSIONS HANDLERS
  // ==========================================================================

  const handleSaveNewOpportunity = async (
    opp: Opportunity,
    newAssessments: RequirementAssessment[]
  ): Promise<boolean> => {
    const cleanOppId = sanitizeId(opp.id, "opp");
    const normalizedOpp: Opportunity = { ...opp, id: cleanOppId };
    const normalizedAssessments: RequirementAssessment[] = newAssessments.map(
      (a, idx) => ({
        ...a,
        id: sanitizeId(a.id || `ra-${cleanOppId}-${idx}`, "ra"),
        opportunityId: cleanOppId,
      })
    );

    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        opportunities: [normalizedOpp, ...prev.opportunities],
        assessments: [
          ...prev.assessments.filter((a) => a.opportunityId !== cleanOppId),
          ...normalizedAssessments,
        ],
      }));
      setSelectedOpportunityId(cleanOppId);
      return true;
    }

    const res = await runTrackedWrite((uid) =>
      createOpportunityWithAssessmentsInFirestore(
        uid,
        normalizedOpp,
        normalizedAssessments
      )
    );
    if (res.ok) {
      setSelectedOpportunityId(cleanOppId);
    }
    return res.ok;
  };

  const handleUpdateOpportunity = async (opp: Opportunity): Promise<boolean> => {
    if (opp.isSampleRecord) return false;
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        opportunities: prev.opportunities.map((o) =>
          o.id === opp.id ? opp : o
        ),
      }));
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      updateOpportunityInFirestore(uid, opp)
    );
    return res.ok;
  };

  const handleDeleteOpportunity = async (oppId: string): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace((prev) => {
        const remaining = prev.opportunities.filter((o) => o.id !== oppId);
        if (selectedOpportunityId === oppId) {
          setSelectedOpportunityId(remaining[0]?.id ?? null);
        }
        return {
          ...prev,
          opportunities: remaining,
          assessments: prev.assessments.filter((a) => a.opportunityId !== oppId),
          applicationVersions: prev.applicationVersions.filter(
            (v) => v.opportunityId !== oppId
          ),
          authenticityReviews: (prev.authenticityReviews || []).map((rev) =>
            rev.opportunityId === oppId ? { ...rev, opportunityId: "" } : rev
          ),
        };
      });
      return true;
    }

    const cur = workspaceRef.current;
    const res = await runTrackedWrite((uid) =>
      deleteOpportunityCascadeFromFirestore(
        uid,
        oppId,
        cur.assessments,
        cur.applicationVersions,
        cur.authenticityReviews || []
      )
    );
    if (res.ok && selectedOpportunityId === oppId) {
      const remaining = cur.opportunities.filter((o) => o.id !== oppId);
      setSelectedOpportunityId(remaining[0]?.id ?? null);
    }
    return res.ok;
  };

  const handleReplaceAssessments = async (
    oppId: string,
    items: RequirementAssessment[]
  ): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        assessments: [
          ...prev.assessments.filter((a) => a.opportunityId !== oppId),
          ...items,
        ],
      }));
      return true;
    }
    const prevAssessments = workspaceRef.current.assessments;
    const res = await runTrackedWrite((uid) =>
      replaceAssessmentsForOpportunityInFirestore(
        uid,
        oppId,
        prevAssessments,
        items
      )
    );
    return res.ok;
  };

  const handleSaveApplicationVersion = async (
    version: ApplicationVersion
  ): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        applicationVersions: [...prev.applicationVersions, version],
      }));
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      createApplicationVersionInFirestore(uid, version)
    );
    return res.ok;
  };

  // ==========================================================================
  // CONTACTS & OUTREACH HANDLERS
  // ==========================================================================

  const handleAddContact = async (
    contact: Omit<Contact, "id">
  ): Promise<string | null> => {
    const id = sanitizeId(
      `con-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      "con"
    );
    const full: Contact = { ...contact, id };

    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        contacts: [full, ...prev.contacts],
      }));
      return id;
    }

    const res = await runTrackedWrite((uid) =>
      createContactInFirestore(uid, full)
    );
    return res.ok ? id : null;
  };

  const handleUpdateContact = async (contact: Contact): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        contacts: prev.contacts.map((c) => (c.id === contact.id ? contact : c)),
      }));
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      updateContactInFirestore(uid, contact)
    );
    return res.ok;
  };

  const handleDeleteContact = async (id: string): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        contacts: prev.contacts.filter((c) => c.id !== id),
      }));
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      deleteContactFromFirestore(uid, id)
    );
    return res.ok;
  };

  const handleSaveOutreachDraft = async (
    draft: OutreachDraft
  ): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        outreachDrafts: [draft, ...prev.outreachDrafts],
      }));
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      createOutreachDraftInFirestore(uid, draft)
    );
    return res.ok;
  };

  // ==========================================================================
  // PRACTICE, LEARNING & TIME LOG HANDLERS
  // ==========================================================================

  const handleSavePracticeSession = async (
    session: Omit<PracticeSession, "id" | "createdAt">
  ): Promise<boolean> => {
    const record: PracticeSession = {
      ...session,
      id: sanitizeId(`prac-${Date.now()}`, "prac"),
      createdAt: new Date().toISOString(),
    };

    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        practiceSessions: [record, ...prev.practiceSessions],
      }));
      return true;
    }

    const res = await runTrackedWrite(async (uid) => {
      await createPracticeSessionInFirestore(uid, record);

      // Mark matching starter preparation task complete if still open
      const matchingStarterTask = workspaceRef.current.tasks.find(
        (t) =>
          !t.completed &&
          ((session.mode === "intro_45s" && t.id === "task-rethink-5") ||
            (session.mode === "crm_simulation" && t.id === "task-rethink-6"))
      );
      if (matchingStarterTask) {
        await updateTaskInFirestore(uid, {
          ...matchingStarterTask,
          completed: true,
          completedAt: new Date().toISOString(),
        });
      }
    });
    return res.ok;
  };

  const handleUpdateLearningItem = async (
    item: LearningItem
  ): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        learningItems: prev.learningItems.map((l) =>
          l.id === item.id ? item : l
        ),
      }));
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      updateLearningItemInFirestore(uid, item)
    );
    return res.ok;
  };

  const handleAddLearningItem = async (
    item: Omit<LearningItem, "id">
  ): Promise<boolean> => {
    const record: LearningItem = {
      ...item,
      id: sanitizeId(`learn-${Date.now()}`, "learn"),
    };
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        learningItems: [...prev.learningItems, record],
      }));
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      createLearningItemInFirestore(uid, record)
    );
    return res.ok;
  };

  const handleAddTimeLog = async (
    entry: Omit<TimeLogEntry, "id">
  ): Promise<boolean> => {
    const record: TimeLogEntry = {
      ...entry,
      id: sanitizeId(`time-${Date.now()}`, "time"),
    };
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        timeLogs: [record, ...prev.timeLogs],
      }));
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      createTimeLogInFirestore(uid, record)
    );
    return res.ok;
  };

  // ==========================================================================
  // PRIVATE DOCUMENT STORAGE HANDLERS (Zero Public URLs)
  // ==========================================================================

  const handleUploadPrivateFile = async (
    file: File,
    docCategory: PrivateDocumentCategory,
    linkedOpportunityId = ""
  ): Promise<{
    meta: PrivateDocumentMeta;
    extractedTextIfPlain: string | null;
  } | null> => {
    if (isDemoMode) {
      // In isolated Demo Mode, read plain text locally without persisting to database
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const isPlain = ["txt", "md", "csv", "json"].includes(ext);
      const extractedTextIfPlain = isPlain ? await file.text() : null;
      const demoMeta: PrivateDocumentMeta = {
        id: `demo-doc-${Date.now()}`,
        userId: "demo-mode",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        byteSize: file.size,
        docCategory,
        linkedOpportunityId,
        storageRef: "demo-memory-only",
        sha256: "demo-unpersisted",
        createdAtIso: new Date().toISOString(),
      };
      setWorkspace((prev) => ({
        ...prev,
        documents: [demoMeta, ...prev.documents],
      }));
      return { meta: demoMeta, extractedTextIfPlain };
    }

    const res = await runTrackedWrite((uid) =>
      uploadPrivateDocumentToFirestore(
        uid,
        file,
        docCategory,
        linkedOpportunityId
      )
    );
    return res.ok ? res.value : null;
  };

  const handleDownloadPrivateFile = async (
    meta: PrivateDocumentMeta
  ): Promise<void> => {
    if (isDemoMode || !authUser) return;
    try {
      await downloadPrivateDocumentFromFirestore(authUser.uid, meta);
    } catch (err) {
      setPersistence((prev) => ({
        ...prev,
        status: "error",
        errorMessage: extractReadableSaveError(err),
      }));
    }
  };

  const handleDeletePrivateFile = async (docId: string): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace((prev) => ({
        ...prev,
        documents: prev.documents.filter((d) => d.id !== docId),
        relationships: (prev.relationships || [])
          .filter((r) => r.sourceId !== docId)
          .map((r) => {
            if (!(r.evidenceIds || []).includes(docId)) return r;
            const nextEvIds = (r.evidenceIds || []).filter(
              (eid) => eid !== docId
            );
            const downgrade =
              nextEvIds.length === 0 &&
              r.status === "confirmed" &&
              ["demonstrates", "supports", "adjacent_to"].includes(
                r.relationshipType
              );
            return {
              ...r,
              evidenceIds: nextEvIds,
              status: downgrade ? "suggested" : r.status,
              updatedAtIso: new Date().toISOString(),
            };
          }),
      }));
      return true;
    }
    const existingRels = workspaceRef.current.relationships || [];
    const res = await runTrackedWrite(async (uid) => {
      await deletePrivateDocumentFromFirestore(uid, docId);
      await pruneRemovedEvidenceFromRelationshipsInFirestore(
        uid,
        docId,
        existingRels
      );
    }, "Delete private file & update graph");
    return res.ok;
  };

  // ==========================================================================
  // DATA MANAGEMENT & DIAGNOSTIC ACCEPTANCE HANDLERS
  // ==========================================================================

  const handleImportWorkspace = async (
    imported: WorkspaceState
  ): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace({
        ...imported,
        documents: imported.documents || [],
        relationships: imported.relationships || [],
      });
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      importWorkspaceBackupToFirestore(uid, imported)
    );
    return res.ok;
  };

  const handleResetToStarter = async (): Promise<boolean> => {
    if (isDemoMode) {
      setWorkspace(createStarterWorkspaceState());
      setSelectedOpportunityId(STARTER_RETHINKBH_ID);
      return true;
    }
    const res = await runTrackedWrite((uid) =>
      deleteAllUserRecordsAndFilesFromFirestore(uid, "reset_starter", {
        displayName: authUser?.displayName,
        email: authUser?.email,
      })
    );
    if (res.ok) {
      setSelectedOpportunityId(STARTER_RETHINKBH_ID);
    }
    return res.ok;
  };

  const handleDeleteAllRecords = async (): Promise<{
    deletedCount: number;
    deletedFilesCount: number;
  } | null> => {
    if (isDemoMode) {
      const filesCount = workspaceRef.current.documents.length;
      setWorkspace(createEmptyClearedWorkspace());
      setSelectedOpportunityId(null);
      return { deletedCount: 0, deletedFilesCount: filesCount };
    }
    const res = await runTrackedWrite((uid) =>
      deleteAllUserRecordsAndFilesFromFirestore(uid, "clear_empty")
    );
    if (res.ok) {
      setSelectedOpportunityId(null);
      return res.value;
    }
    return null;
  };

  const handlePermanentlyDeleteWorkspaceAndAccount = async (): Promise<{
    deletedCount: number;
    deletedFilesCount: number;
  } | null> => {
    if (isDemoMode) {
      const filesCount = workspaceRef.current.documents.length;
      setWorkspace(createEmptyClearedWorkspace());
      setIsDemoMode(false);
      return { deletedCount: 0, deletedFilesCount: filesCount };
    }
    const res = await runTrackedWrite((uid) =>
      permanentlyDeleteUserWorkspaceFromFirestore(uid)
    );
    return res.ok ? res.value : null;
  };

  const handleTriggerSimulatedFailedSave = async (): Promise<void> => {
    if (isDemoMode || !authUser) return;
    await runTrackedWrite((uid) => triggerDiagnosticRejectedSave(uid));
  };

  // ==========================================================================
  // RENDER GATES: INITIAL AUTH CHECK, INVITATION GATE, SIGN-IN GATE, BOOTSTRAP
  // ==========================================================================

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F9F9F8] flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm text-[#52525B]">
          <Loader2 className="w-4 h-4 animate-spin text-[#1F4E5F]" />
          <span>Verifying authentication session...</span>
        </div>
      </div>
    );
  }

  if (activeInviteToken) {
    return (
      <AcceptInvitationView
        inviteToken={activeInviteToken}
        authUser={
          authUser ? { uid: authUser.uid, email: authUser.email } : null
        }
        onInvitationAccepted={() => {
          setActiveInviteToken(null);
          setActiveNav("today");
        }}
        onCancelAndReturn={() => {
          setActiveInviteToken(null);
        }}
      />
    );
  }

  if (!authUser && !isDemoMode) {
    return (
      <AuthGateView
        dbReachable={dbReachable}
        connectionDetail={connectionDetail}
        onEnterIsolatedDemoMode={handleEnterIsolatedDemoMode}
      />
    );
  }

  if (authUser && isBootstrappingWorkspace) {
    return (
      <div className="min-h-screen bg-[#F9F9F8] flex items-center justify-center p-6">
        <div className="bg-white border border-[#E4E4E7] rounded-xl p-6 max-w-md w-full space-y-2">
          <div className="flex items-center gap-2.5 text-sm font-medium text-[#18181B]">
            <Loader2 className="w-4 h-4 animate-spin text-[#1F4E5F]" />
            <span>Loading your private Cloud Firestore workspace...</span>
          </div>
          <p className="text-xs text-[#52525B]">
            Verifying owner-scoped records and private document references for{" "}
            <span className="font-medium text-[#18181B]">
              {authUser.email || authUser.uid}
            </span>
            .
          </p>
        </div>
      </div>
    );
  }

  if (authUser && bootstrapError) {
    return (
      <div className="min-h-screen bg-[#F9F9F8] flex items-center justify-center p-6">
        <div className="bg-white border border-[#FECACA] rounded-xl p-6 max-w-lg w-full space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#B91C1C] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h1 className="text-base font-semibold text-[#18181B]">
                Unable to load Cloud Firestore workspace
              </h1>
              <p className="text-sm text-[#52525B]">{bootstrapError}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBootstrapAttempt((n) => n + 1)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1F4E5F] text-white text-xs font-medium hover:bg-[#173c4a]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry Connection
            </button>
            <button
              type="button"
              onClick={handleSignOutOrExitDemo}
              className="px-3.5 py-2 rounded-lg border border-[#D4D4D8] bg-white text-xs font-medium text-[#18181B] hover:bg-[#F4F4F5]"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const showGuidedOnboardingWizard = Boolean(
    !isDemoMode &&
      authUser &&
      workspace.onboardingWizard &&
      !workspace.onboardingWizard.completed &&
      !workspace.onboardingWizard.pausedForLater &&
      activeNav !== "settings"
  );

  return (
    <LayoutShell
      activeNav={activeNav}
      onSelectNav={(nav) => {
        if (nav === "settings") {
          setSettingsSubTab("account");
        }
        handleNavigate(nav);
      }}
      onQuickAddOpportunity={() => handleNavigate("discover")}
      aiStatus={aiStatus}
      allowServerSideAi={workspace.settings.allowServerSideAi}
      onToggleServerSideAi={handleToggleServerSideAi}
      isDemoMode={isDemoMode}
      isAdmin={isAdmin}
      workspaceOwnerName={workspace.profile.fullName}
      userEmail={authUser?.email ?? null}
      persistence={persistence}
      onDismissSaveError={() =>
        setPersistence((prev) => ({
          ...prev,
          status: "idle",
          errorMessage: null,
        }))
      }
      onSignOutOrExitDemo={handleSignOutOrExitDemo}
      onOpenAdminInvitations={() => {
        setSettingsSubTab("people_invitations");
        handleNavigate("settings");
      }}
      counts={navCounts}
    >
      {showGuidedOnboardingWizard && workspace.onboardingWizard ? (
        <FirstLoginOnboardingWizard
          profile={workspace.profile}
          wizard={workspace.onboardingWizard}
          inviterSuggestions={workspace.inviterSuggestions ?? []}
          onSaveProgress={handleSaveOnboardingWizardProgress}
          onAddEvidence={handleAddEvidence}
          onUploadPrivateFile={handleUploadPrivateFile}
        />
      ) : (
        <>
          {activeNav === "today" && (
            <TodayView
              profile={workspace.profile}
              tasks={workspace.tasks}
              opportunities={workspace.opportunities}
              availableMinutes={workspace.settings.availableMinutesToday}
              onboardingWizard={workspace.onboardingWizard}
              onResumeOnboardingWizard={handleResumeOrStartOnboardingWizard}
              onChangeAvailableMinutes={handleChangeAvailableMinutes}
              onUpdateTask={handleUpdateTask}
              onAddTask={handleAddTask}
              onNavigate={handleNavigate}
            />
          )}

      {activeNav === "profile" && (
        <ProfileView
          profile={workspace.profile}
          evidence={workspace.evidence}
          documents={workspace.documents}
          isDemoMode={isDemoMode}
          onUpdateProfile={handleUpdateProfile}
          onAddEvidence={handleAddEvidence}
          onUpdateEvidence={handleUpdateEvidence}
          onDeleteEvidence={handleDeleteEvidence}
          onUploadPrivateFile={handleUploadPrivateFile}
          onDownloadPrivateFile={handleDownloadPrivateFile}
          onDeletePrivateFile={handleDeletePrivateFile}
        />
      )}

      {activeNav === "discover" && (
        <FindEvaluateView
          profile={workspace.profile}
          evidence={workspace.evidence}
          existingOpportunities={workspace.opportunities}
          allowServerSideAi={workspace.settings.allowServerSideAi}
          isDemoMode={isDemoMode}
          onSaveOpportunity={handleSaveNewOpportunity}
          onAddTask={handleAddTask}
          onUploadPrivateFile={handleUploadPrivateFile}
          onOpenOpportunity={(oppId) => handleNavigate("opportunities", oppId)}
          activeUserId={authUser?.uid || "demo-mode"}
          authenticityReviews={workspace.authenticityReviews || []}
          documents={workspace.documents}
          onSaveAuthenticityReview={handleSaveAuthenticityReview}
          onDeleteAuthenticityReview={handleDeleteAuthenticityReview}
        />
      )}

      {activeNav === "opportunities" && (
        <OpportunitiesView
          profile={workspace.profile}
          evidence={workspace.evidence}
          opportunities={workspace.opportunities}
          assessments={workspace.assessments}
          applicationVersions={workspace.applicationVersions}
          selectedOpportunityId={selectedOpportunityId}
          showSampleData={workspace.settings.showSampleComparisonData}
          allowServerSideAi={workspace.settings.allowServerSideAi}
          onSelectOpportunity={(id) => setSelectedOpportunityId(id)}
          onToggleSampleData={handleToggleSampleData}
          onUpdateOpportunity={handleUpdateOpportunity}
          onDeleteOpportunity={handleDeleteOpportunity}
          onReplaceAssessmentsForOpportunity={handleReplaceAssessments}
          onSaveApplicationVersion={handleSaveApplicationVersion}
          onAddNewOpportunityClick={() => handleNavigate("discover")}
          workspace={workspace}
          ownerUid={authUser?.uid || "demo-mode"}
          onSaveRelationship={handleSaveRelationship}
          onOpenSkillsWorthDeveloping={() => {
            setPracticeSubTab("skills");
            handleNavigate("practice");
          }}
          onOpenConnections={() => handleNavigate("connections")}
          isDemoMode={isDemoMode}
          onSaveAuthenticityReview={handleSaveAuthenticityReview}
          onDeleteAuthenticityReview={handleDeleteAuthenticityReview}
          onUploadPrivateFile={handleUploadPrivateFile}
        />
      )}

      {activeNav === "people" && (
        <PeopleOutreachView
          profile={workspace.profile}
          evidence={workspace.evidence}
          contacts={workspace.contacts}
          opportunities={workspace.opportunities}
          outreachDrafts={workspace.outreachDrafts}
          allowServerSideAi={workspace.settings.allowServerSideAi}
          onAddContact={handleAddContact}
          onUpdateContact={handleUpdateContact}
          onDeleteContact={handleDeleteContact}
          onSaveOutreachDraft={handleSaveOutreachDraft}
          onAddTask={handleAddTask}
        />
      )}

      {activeNav === "practice" && (
        <PracticeLearnView
          key={`practice-${practiceSubTab}`}
          profile={workspace.profile}
          evidence={workspace.evidence}
          practiceSessions={workspace.practiceSessions}
          learningItems={workspace.learningItems}
          crmSimulation={workspace.crmSimulation}
          allowServerSideAi={workspace.settings.allowServerSideAi}
          onSavePracticeSession={handleSavePracticeSession}
          onUpdateLearningItem={handleUpdateLearningItem}
          onAddLearningItem={handleAddLearningItem}
          onUpdateCrmSimulation={handleUpdateCrmSimulation}
          workspace={workspace}
          ownerUid={authUser?.uid || "demo-mode"}
          initialSubTab={practiceSubTab}
          onSelectOpportunity={(oppId) =>
            handleNavigate("opportunities", oppId)
          }
        />
      )}

      {activeNav === "connections" && (
        <ConnectionsView
          workspace={workspace}
          ownerUid={authUser?.uid || "demo-mode"}
          onSaveRelationship={handleSaveRelationship}
          onAddLearningItem={handleAddLearningItem}
          onSelectOpportunity={(oppId) =>
            handleNavigate("opportunities", oppId)
          }
        />
      )}

          {activeNav === "progress" && (
            <DecisionsProgressView
              workspace={workspace}
              isDemoMode={isDemoMode}
              currentUid={authUser?.uid ?? null}
              canResetStarterWorkspace={
                isDemoMode ||
                workspace.profile.fullName.trim().toLowerCase() === "nora crafts"
              }
              onAddTimeLog={handleAddTimeLog}
              onImportWorkspace={handleImportWorkspace}
              onResetToStarter={handleResetToStarter}
              onDeleteAllRecords={handleDeleteAllRecords}
              onDownloadPrivateFile={handleDownloadPrivateFile}
              onDeletePrivateFile={handleDeletePrivateFile}
              onTriggerSimulatedFailedSave={handleTriggerSimulatedFailedSave}
              onNavigateToOpportunity={(oppId) =>
                handleNavigate("opportunities", oppId)
              }
              onNavigate={handleNavigate}
            />
          )}

          {activeNav === "settings" && (
            <SettingsView
              key={`settings-${settingsSubTab}-${isAdmin ? "adm" : "usr"}`}
              workspace={workspace}
              userEmail={authUser?.email ?? null}
              userUid={authUser?.uid ?? null}
              isAdmin={isAdmin}
              isDemoMode={isDemoMode}
              initialSubTab={settingsSubTab}
              onUpdateProfile={handleUpdateProfile}
              onPermanentlyDeleteWorkspaceAndAccount={
                handlePermanentlyDeleteWorkspaceAndAccount
              }
              onRestartOnboardingWizard={
                !isDemoMode ? handleResumeOrStartOnboardingWizard : undefined
              }
            />
          )}
        </>
      )}
    </LayoutShell>
  );
}

export default function App() {
  return (
    <WorkspaceErrorBoundary>
      <CareerLaunchWorkspace />
    </WorkspaceErrorBoundary>
  );
}
