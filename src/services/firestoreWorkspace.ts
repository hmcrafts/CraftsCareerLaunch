import {
  Timestamp,
  Unsubscribe,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  CURRENT_SCHEMA_VERSION,
  INITIAL_ASSESSMENTS,
  INITIAL_EVIDENCE,
  INITIAL_LEARNING_ITEMS,
  INITIAL_OPPORTUNITIES,
  INITIAL_PROFILE,
  INITIAL_TASKS,
  getTodayIsoDate,
} from "../data/initialData";
import {
  OperationType,
  db,
  handleFirestoreError,
} from "../firebase";
import {
  ApplicationVersion,
  AuthenticityDimension,
  AuthenticityReview,
  CareerConstraints,
  Contact,
  DimensionAssessmentSummary,
  Evidence,
  InviterSuggestionItem,
  LearningItem,
  OnboardingWizardState,
  Opportunity,
  OutreachDraft,
  PracticeSession,
  PrivateDocumentCategory,
  PrivateDocumentMeta,
  Profile,
  RelationshipEdge,
  RequirementAssessment,
  ReviewArtifact,
  RiskFinding,
  Task,
  TimeLogEntry,
  VerificationCheck,
  WorkspaceSettings,
  WorkspaceSharingSettings,
  WorkspaceState,
} from "../types/models";
import { DIMENSION_LABELS } from "../utils/authenticityReviewEngine";

function requireDb() {
  if (!db) {
    throw new Error("Cloud Firestore is not configured.");
  }
  return db;
}

export function sanitizeId(raw: string, prefix = "rec"): string {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : `${prefix}-${Date.now()}`;
}

function sanitizeOptionalId(raw?: string | null): string {
  if (!raw || !String(raw).trim()) return "";
  return sanitizeId(raw);
}

function trunc(val: unknown, maxLen: number, fallback = ""): string {
  const s = typeof val === "string" ? val : val == null ? fallback : String(val);
  return s.slice(0, maxLen);
}

function nonEmptyTrunc(val: unknown, maxLen: number, fallback: string): string {
  const trimmed = trunc(val, maxLen).trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLen) : fallback.slice(0, maxLen);
}

function boundedStrings(
  arr: unknown,
  maxItems: number,
  maxItemLen: number
): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, maxItems)
    .map((item) => trunc(item, maxItemLen))
    .filter((s) => s.length > 0);
}

function timestampToIso(val: unknown, fallback = ""): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === "string") return val;
  return fallback;
}

function sanitizeConstraints(c: CareerConstraints): CareerConstraints {
  return {
    minBaseSalary:
      typeof c.minBaseSalary === "number" && Number.isFinite(c.minBaseSalary)
        ? c.minBaseSalary
        : null,
    minBaseSalaryUnsure: Boolean(c.minBaseSalaryUnsure),
    desiredTotalComp:
      typeof c.desiredTotalComp === "number" && Number.isFinite(c.desiredTotalComp)
        ? c.desiredTotalComp
        : null,
    desiredTotalCompUnsure: Boolean(c.desiredTotalCompUnsure),
    benefitsRequirement: c.benefitsRequirement || "not_sure",
    employmentType: c.employmentType || "not_sure",
    workArrangement: c.workArrangement || "not_sure",
    maxCommuteMinutes:
      typeof c.maxCommuteMinutes === "number" && Number.isFinite(c.maxCommuteMinutes)
        ? c.maxCommuteMinutes
        : null,
    maxCommuteUnsure: Boolean(c.maxCommuteUnsure),
    willingToRelocate: c.willingToRelocate || "not_sure",
    scheduleAndStartAvailability: trunc(c.scheduleAndStartAvailability, 300, "Not sure yet"),
    commissionTolerance: c.commissionTolerance || "not_sure",
    outboundCallingComfort: c.outboundCallingComfort || "not_sure",
    preferredIndustries: trunc(c.preferredIndustries, 500),
    excludedIndustries: trunc(c.excludedIndustries, 500),
    travelLimits: trunc(c.travelLimits, 300, "Not sure yet"),
    trainingTimeWeeklyHours: trunc(c.trainingTimeWeeklyHours, 200, "Not sure yet"),
    trainingBudgetDollars: trunc(c.trainingBudgetDollars, 200, "Not sure yet"),
    onboardingReviewed: Boolean(c.onboardingReviewed),
  };
}

function sanitizeSettings(s: WorkspaceSettings): WorkspaceSettings {
  const mins = Math.min(
    600,
    Math.max(5, Math.round(Number(s?.availableMinutesToday) || 45))
  );
  return {
    availableMinutesToday: mins,
    allowServerSideAi: Boolean(s?.allowServerSideAi ?? true),
    showSampleComparisonData: Boolean(s?.showSampleComparisonData ?? false),
  };
}

function sanitizeCrmSimulation(
  sim: WorkspaceState["crmSimulation"]
): WorkspaceState["crmSimulation"] {
  return {
    searchedQueries: boundedStrings(sim?.searchedQueries, 40, 200),
    conversationLogs: (sim?.conversationLogs || []).slice(0, 40).map((l) => ({
      id: sanitizeId(l.id, "crmlog"),
      accountId: trunc(l.accountId, 120),
      contactName: trunc(l.contactName, 200),
      summary: trunc(l.summary, 1500),
      painPointsIdentified: trunc(l.painPointsIdentified, 1000),
      currentToolsNoted: trunc(l.currentToolsNoted, 500),
      createdAt: trunc(l.createdAt, 40),
    })),
    followUpTasks: (sim?.followUpTasks || []).slice(0, 40).map((t) => ({
      id: sanitizeId(t.id, "crmtask"),
      accountId: trunc(t.accountId, 120),
      actionTitle: trunc(t.actionTitle, 300),
      dueDate: trunc(t.dueDate, 30),
      purpose: trunc(t.purpose, 500),
      completed: Boolean(t.completed),
    })),
    handoffNotes: (sim?.handoffNotes || []).slice(0, 40).map((h) => ({
      id: sanitizeId(h.id, "crmhandoff"),
      accountId: trunc(h.accountId, 120),
      qualifiedCriteriaMet: trunc(h.qualifiedCriteriaMet, 1000),
      openUnknownsForAE: trunc(h.openUnknownsForAE, 1000),
      proposedMeetingAgenda: trunc(h.proposedMeetingAgenda, 1000),
      createdAt: trunc(h.createdAt, 40),
    })),
  };
}

function sanitizeOnboardingWizard(
  w?: OnboardingWizardState
): OnboardingWizardState | undefined {
  if (!w || typeof w !== "object") return undefined;
  const stepNum = Number(w.currentStep);
  const validStep = (
    [1, 2, 3, 4, 5, 6].includes(stepNum) ? stepNum : 1
  ) as 1 | 2 | 3 | 4 | 5 | 6;
  const intakeMode = ["none", "upload", "paste", "manual", "skipped"].includes(
    w.experienceIntakeMode
  )
    ? w.experienceIntakeMode
    : "none";
  return {
    completed: Boolean(w.completed),
    pausedForLater: Boolean(w.pausedForLater),
    currentStep: validStep,
    currentSituation: trunc(w.currentSituation, 500),
    rolesOfInterest: trunc(w.rolesOfInterest, 600),
    rolesUnsure: Boolean(w.rolesUnsure),
    workToAvoid: trunc(w.workToAvoid, 600),
    skillsToDevelop: trunc(w.skillsToDevelop, 600),
    experienceIntakeMode: intakeMode,
    pastedExperienceDraft: trunc(w.pastedExperienceDraft, 15000),
    updatedAtIso: trunc(w.updatedAtIso || new Date().toISOString(), 40),
  };
}

function sanitizeSharingSettings(
  sh?: WorkspaceSharingSettings
): WorkspaceSharingSettings | undefined {
  if (!sh || typeof sh !== "object") return undefined;
  return {
    mode: "private",
    reviewersEnabled: false,
    updatedAtIso: trunc(sh.updatedAtIso || new Date().toISOString(), 40),
  };
}

function sanitizeInviterSuggestions(
  items?: InviterSuggestionItem[]
): InviterSuggestionItem[] | undefined {
  if (!Array.isArray(items)) return undefined;
  return items.slice(0, 10).map((item, idx) => ({
    id: sanitizeId(item.id || `sug-${idx + 1}`, "sug"),
    text: trunc(item.text, 300),
    suppliedBy: trunc(item.suppliedBy, 120, "Inviter"),
    decision: ["pending", "accepted", "discarded"].includes(item.decision)
      ? item.decision
      : "pending",
  }));
}

function buildUserDocPayload(
  uid: string,
  profile: Profile,
  settings: WorkspaceSettings,
  crmSimulation: WorkspaceState["crmSimulation"],
  starterSeeded: boolean,
  extras?: {
    onboardingWizard?: OnboardingWizardState;
    sharingSettings?: WorkspaceSharingSettings;
    inviterSuggestions?: InviterSuggestionItem[];
  }
) {
  const sanitizedWizard = sanitizeOnboardingWizard(extras?.onboardingWizard);
  const sanitizedSharing = sanitizeSharingSettings(extras?.sharingSettings);
  const sanitizedSuggestions = sanitizeInviterSuggestions(
    extras?.inviterSuggestions
  );

  return {
    fullName: trunc(profile.fullName, 200),
    location: trunc(profile.location, 200),
    educationSummary: trunc(profile.educationSummary, 1000),
    rbtCertificationStatus: ["unverified", "active", "inactive_or_expired"].includes(
      profile.rbtCertificationStatus
    )
      ? profile.rbtCertificationStatus
      : "unverified",
    rbtCertificationNote: trunc(profile.rbtCertificationNote, 1000),
    littleLeavesSoftwareUsed: trunc(profile.littleLeavesSoftwareUsed, 300),
    otherExperienceNotes: trunc(profile.otherExperienceNotes, 2000),
    masterResumeText: trunc(profile.masterResumeText, 30000),
    masterResumeUpdatedAt: trunc(profile.masterResumeUpdatedAt || "", 40),
    profileVerifiedByNora: Boolean(profile.profileVerifiedByNora),
    constraints: sanitizeConstraints(profile.constraints),
    settings: sanitizeSettings(settings),
    crmSimulation: sanitizeCrmSimulation(crmSimulation),
    starterSeeded: Boolean(starterSeeded),
    ...(sanitizedWizard ? { onboardingWizard: sanitizedWizard } : {}),
    ...(sanitizedSharing ? { sharingSettings: sanitizedSharing } : {}),
    ...(sanitizedSuggestions ? { inviterSuggestions: sanitizedSuggestions } : {}),
  };
}

function buildEvidenceMutableFields(item: Evidence) {
  return {
    claimText: nonEmptyTrunc(item.claimText, 2000, "Unspecified claim"),
    category: item.category,
    sourceDocumentOrConfirmation: trunc(
      item.sourceDocumentOrConfirmation,
      500,
      "Confirmed by Nora"
    ),
    sourceExcerpt: trunc(item.sourceExcerpt, 2000),
    verificationStatus: item.verificationStatus,
    dateAdded: trunc(item.dateAdded || getTodayIsoDate(), 30),
    mayUseInApplications: Boolean(item.mayUseInApplications),
    tags: boundedStrings(item.tags, 20, 80),
    sourceDocumentId: sanitizeOptionalId(item.sourceDocumentId),
  };
}

function buildOpportunityMutableFields(opp: Opportunity) {
  return {
    employer: nonEmptyTrunc(opp.employer, 300, "Unspecified Employer"),
    title: nonEmptyTrunc(opp.title, 300, "Unspecified Role"),
    officialWebsite: trunc(opp.officialWebsite, 500),
    postingUrl: trunc(opp.postingUrl, 800),
    applicationUrl: trunc(opp.applicationUrl, 800),
    location: trunc(opp.location, 300, "Unknown"),
    eligibleLocations: trunc(opp.eligibleLocations, 500),
    workArrangement: ["remote", "hybrid", "onsite", "unknown"].includes(
      opp.workArrangement
    )
      ? opp.workArrangement
      : "unknown",
    employmentType: ["full_time", "part_time", "contract", "unknown"].includes(
      opp.employmentType
    )
      ? opp.employmentType
      : "unknown",
    datePosted: trunc(opp.datePosted, 30),
    dateFirstFound: trunc(opp.dateFirstFound || getTodayIsoDate(), 30),
    dateLastVerified: trunc(opp.dateLastVerified, 30),
    openingAvailabilityStatus: [
      "Unverified",
      "Seen on official careers page",
      "No longer listed / Closed",
    ].includes(opp.openingAvailabilityStatus)
      ? opp.openingAvailabilityStatus
      : "Unverified",
    intakeChannel: trunc(opp.intakeChannel, 80, "Employer careers page"),
    rawDescriptionText: trunc(opp.rawDescriptionText, 25000),
    compensation: {
      employerPublishedBase: trunc(opp.compensation?.employerPublishedBase, 300),
      employerPublishedVariable: trunc(
        opp.compensation?.employerPublishedVariable,
        300
      ),
      variableAssumptionsNote: trunc(
        opp.compensation?.variableAssumptionsNote,
        1000
      ),
      thirdPartyEstimate: trunc(opp.compensation?.thirdPartyEstimate, 300),
      thirdPartySource: trunc(opp.compensation?.thirdPartySource, 300),
      compensationSourceNote: trunc(
        opp.compensation?.compensationSourceNote,
        500
      ),
      benefitsDocumented: trunc(opp.compensation?.benefitsDocumented, 1000),
    },
    requiredQualifications: boundedStrings(opp.requiredQualifications, 30, 500),
    preferredQualifications: boundedStrings(opp.preferredQualifications, 30, 500),
    coreDuties: boundedStrings(opp.coreDuties, 30, 500),
    knownContactIds: boundedStrings(opp.knownContactIds, 30, 128),
    stage: trunc(opp.stage, 60, "Research / preparation"),
    appliedConfirmedByNora: ["unconfirmed", "not_applied", "applied"].includes(
      opp.appliedConfirmedByNora
    )
      ? opp.appliedConfirmedByNora
      : "unconfirmed",
    nextAction: trunc(opp.nextAction, 500),
    nextActionDueDate: trunc(opp.nextActionDueDate, 30),
    writtenAdvancementInfo: trunc(opp.writtenAdvancementInfo, 2000),
    trainingProvidedInfo: trunc(opp.trainingProvidedInfo, 2000),
    commuteAndScheduleNotes: trunc(opp.commuteAndScheduleNotes, 2000),
    outstandingQuestions: boundedStrings(opp.outstandingQuestions, 25, 500),
    authenticityFlags: (opp.authenticityFlags || []).slice(0, 20).map((f, idx) => ({
      id: sanitizeId(f.id || `flag-${idx}`, "flag"),
      label: trunc(f.label, 200),
      explanation: trunc(f.explanation, 1000),
      ...(f.resolvedNote ? { resolvedNote: trunc(f.resolvedNote, 500) } : {}),
    })),
    liveVerificationLog: {
      lastCheckedAt: trunc(opp.liveVerificationLog?.lastCheckedAt || "", 50),
      liveAvailable: Boolean(opp.liveVerificationLog?.liveAvailable),
      summary: trunc(
        opp.liveVerificationLog?.summary,
        4000,
        "Not yet checked against live web sources."
      ),
      sources: (opp.liveVerificationLog?.sources || []).slice(0, 20).map((s) => ({
        title: trunc(s.title, 300, "Web source"),
        uri: trunc(s.uri, 800),
      })),
    },
    archived: Boolean(opp.archived),
  };
}

function buildAssessmentMutableFields(a: RequirementAssessment) {
  return {
    requirementText: nonEmptyTrunc(
      a.requirementText,
      1000,
      "Verify requirement from official job description"
    ),
    priority: a.priority === "Preferred" ? "Preferred" : "Required",
    noraEvidenceSummary: trunc(a.noraEvidenceSummary, 2000),
    linkedEvidenceIds: boundedStrings(a.linkedEvidenceIds, 15, 128),
    assessment: [
      "Direct evidence",
      "Transferable evidence",
      "Gap",
      "Unknown",
    ].includes(a.assessment)
      ? a.assessment
      : "Unknown",
    gapNature: [
      "none",
      "hard_eligibility",
      "trainable_skill",
      "missing_evidence_check",
    ].includes(a.gapNature)
      ? a.gapNature
      : "none",
    nextStep: trunc(a.nextStep, 1000),
  };
}

function buildContactMutableFields(c: Contact) {
  return {
    name: nonEmptyTrunc(c.name, 200, "Unnamed Contact"),
    organization: trunc(c.organization, 300),
    role: trunc(c.role, 200),
    roleVerified: Boolean(c.roleVerified),
    relationship: trunc(c.relationship, 300),
    source: trunc(c.source, 300),
    contactChannelNote: trunc(c.contactChannelNote, 500),
    lastContactDate: trunc(c.lastContactDate, 30),
    nextAction: trunc(c.nextAction, 500),
    nextActionDueDate: trunc(c.nextActionDueDate, 30),
    replyStatus: trunc(c.replyStatus, 60, "Not contacted yet"),
    doNotContact: Boolean(c.doNotContact),
    linkedOpportunityId: sanitizeOptionalId(c.linkedOpportunityId),
    notes: trunc(c.notes, 3000),
  };
}

function buildTaskMutableFields(t: Task) {
  const mins = Math.min(
    600,
    Math.max(1, Math.round(Number(t.estimatedMinutes) || 15))
  );
  return {
    title: nonEmptyTrunc(t.title, 400, "Workspace task"),
    whyItMatters: trunc(t.whyItMatters, 1500),
    category: ["opportunity", "relationship", "preparation", "followup"].includes(
      t.category
    )
      ? t.category
      : "opportunity",
    estimatedMinutes: mins,
    dueDate: trunc(t.dueDate, 30),
    scheduledBucket: ["today", "tomorrow", "later"].includes(t.scheduledBucket)
      ? t.scheduledBucket
      : "today",
    completed: Boolean(t.completed),
    completedAt: trunc(t.completedAt || "", 40),
    archived: Boolean(t.archived),
    linkedOpportunityId: sanitizeOptionalId(t.linkedOpportunityId),
    linkedContactId: sanitizeOptionalId(t.linkedContactId),
  };
}

/**
 * Ensures the authenticated user's root profile and starter records exist in Firestore.
 * Existing workspaces (such as Nora's) are preserved untouched.
 * CRITICAL PRIVACY INVARIANT (Section 11): Never expose Nora's profile or records as a template
 * to any other user. Only seed Nora's starter workspace if the user's Auth display name is explicitly "Nora Crafts".
 * All other brand-new sign-ins receive a clean, private, empty workspace with the 6-step onboarding wizard.
 */
export async function ensureUserWorkspaceInitialized(
  uid: string,
  userContext?: { displayName?: string | null; email?: string | null }
): Promise<{
  createdStarter: boolean;
}> {
  const firestore = requireDb();
  const userPath = `users/${uid}`;
  const userRef = doc(firestore, "users", uid);

  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return { createdStarter: false };
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  const starterSettings: WorkspaceSettings = {
    availableMinutesToday: 45,
    allowServerSideAi: true,
    showSampleComparisonData: false,
  };
  const emptyCrm: WorkspaceState["crmSimulation"] = {
    searchedQueries: [],
    conversationLogs: [],
    followUpTasks: [],
    handoffNotes: [],
  };

  const normalizedDisplayName = (userContext?.displayName || "").trim();
  const isExplicitlyNora =
    normalizedDisplayName.toLowerCase() === "nora crafts";

  if (!isExplicitlyNora) {
    const nowIso = new Date().toISOString();
    const cleanProfile: Profile = {
      id: uid,
      fullName: normalizedDisplayName.slice(0, 200),
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
    };

    try {
      await setDoc(userRef, {
        id: uid,
        userId: uid,
        ...buildUserDocPayload(uid, cleanProfile, starterSettings, emptyCrm, true, {
          onboardingWizard: {
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
            updatedAtIso: nowIso,
          },
          sharingSettings: {
            mode: "private",
            reviewersEnabled: false,
            updatedAtIso: nowIso,
          },
          inviterSuggestions: [],
        }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { createdStarter: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, userPath);
    }
  }

  // First sign-in explicitly for Nora Crafts: seed Nora's starter workspace atomically
  const batch = writeBatch(firestore);
  const nowIso = new Date().toISOString();

  batch.set(userRef, {
    id: uid,
    userId: uid,
    ...buildUserDocPayload(uid, INITIAL_PROFILE, starterSettings, emptyCrm, true, {
      sharingSettings: {
        mode: "private",
        reviewersEnabled: false,
        updatedAtIso: nowIso,
      },
    }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  for (const ev of INITIAL_EVIDENCE) {
    const evId = sanitizeId(ev.id, "ev");
    batch.set(doc(firestore, "users", uid, "evidence", evId), {
      id: evId,
      userId: uid,
      ...buildEvidenceMutableFields(ev),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const opp of INITIAL_OPPORTUNITIES) {
    const oppId = sanitizeId(opp.id, "opp");
    batch.set(doc(firestore, "users", uid, "opportunities", oppId), {
      id: oppId,
      userId: uid,
      ...buildOpportunityMutableFields(opp),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const a of INITIAL_ASSESSMENTS) {
    const aId = sanitizeId(a.id, "ra");
    const oppId = sanitizeId(a.opportunityId, "opp");
    batch.set(doc(firestore, "users", uid, "assessments", aId), {
      id: aId,
      userId: uid,
      opportunityId: oppId,
      ...buildAssessmentMutableFields(a),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const t of INITIAL_TASKS) {
    const tId = sanitizeId(t.id, "task");
    batch.set(doc(firestore, "users", uid, "tasks", tId), {
      id: tId,
      userId: uid,
      ...buildTaskMutableFields(t),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const l of INITIAL_LEARNING_ITEMS) {
    const lId = sanitizeId(l.id, "learn");
    batch.set(doc(firestore, "users", uid, "learningItems", lId), {
      id: lId,
      userId: uid,
      title: nonEmptyTrunc(l.title, 400, "Learning goal"),
      tiedToRequirement: trunc(l.tiedToRequirement, 600),
      linkedOpportunityId: sanitizeOptionalId(l.linkedOpportunityId),
      progressStage: l.status,
      estimatedHours: Math.min(500, Math.max(0, Number(l.estimatedHours) || 1)),
      practicalExercise: trunc(l.practicalExercise, 1500),
      honestFramingNote: trunc(l.honestFramingNote, 1000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    return { createdStarter: true };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

/**
 * Attaches owner-scoped real-time Firestore listeners to all workspace collections
 * for the authenticated user. Every subcollection query explicitly enforces `where("userId", "==", uid)`.
 */
export function subscribeToUserWorkspace(
  uid: string,
  callbacks: {
    onUserDoc: (data: {
      profile: Profile;
      settings: WorkspaceSettings;
      crmSimulation: WorkspaceState["crmSimulation"];
      onboardingWizard?: OnboardingWizardState;
      sharingSettings?: WorkspaceSharingSettings;
      inviterSuggestions?: InviterSuggestionItem[];
    }) => void;
    onEvidence: (items: Evidence[]) => void;
    onOpportunities: (items: Opportunity[]) => void;
    onAssessments: (items: RequirementAssessment[]) => void;
    onContacts: (items: Contact[]) => void;
    onOutreachDrafts: (items: OutreachDraft[]) => void;
    onApplicationVersions: (items: ApplicationVersion[]) => void;
    onTasks: (items: Task[]) => void;
    onPracticeSessions: (items: PracticeSession[]) => void;
    onLearningItems: (items: LearningItem[]) => void;
    onTimeLogs: (items: TimeLogEntry[]) => void;
    onDocuments: (items: PrivateDocumentMeta[]) => void;
    onRelationships?: (items: RelationshipEdge[]) => void;
    onAuthenticityReviews?: (items: AuthenticityReview[]) => void;
    onListenerError: (err: unknown) => void;
  }
): Unsubscribe {
  const firestore = requireDb();
  const unsubs: Unsubscribe[] = [];

  const wrapErr = (op: OperationType, path: string) => (error: unknown) => {
    callbacks.onListenerError(error);
    try {
      handleFirestoreError(error, op, path);
    } catch {
      // Logged structured FirestoreErrorInfo; surfaced to UI via onListenerError
    }
  };

  // 1. Root User Document (/users/{uid})
  const userPath = `users/${uid}`;
  unsubs.push(
    onSnapshot(
      doc(firestore, "users", uid),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const profile: Profile = {
          id: uid,
          fullName: d.fullName ?? "",
          location: d.location ?? "",
          educationSummary: d.educationSummary ?? "",
          rbtCertificationStatus: d.rbtCertificationStatus ?? "unverified",
          rbtCertificationNote: d.rbtCertificationNote ?? "",
          littleLeavesSoftwareUsed: d.littleLeavesSoftwareUsed ?? "",
          otherExperienceNotes: d.otherExperienceNotes ?? "",
          masterResumeText: d.masterResumeText ?? "",
          masterResumeUpdatedAt: d.masterResumeUpdatedAt ? d.masterResumeUpdatedAt : null,
          profileVerifiedByNora: Boolean(d.profileVerifiedByNora),
          constraints: d.constraints ?? INITIAL_PROFILE.constraints,
        };
        callbacks.onUserDoc({
          profile,
          settings: d.settings ?? {
            availableMinutesToday: 45,
            allowServerSideAi: true,
            showSampleComparisonData: false,
          },
          crmSimulation: d.crmSimulation ?? {
            searchedQueries: [],
            conversationLogs: [],
            followUpTasks: [],
            handoffNotes: [],
          },
          onboardingWizard: sanitizeOnboardingWizard(d.onboardingWizard),
          sharingSettings:
            sanitizeSharingSettings(d.sharingSettings) ?? {
              mode: "private",
              reviewersEnabled: false,
              updatedAtIso: new Date().toISOString(),
            },
          inviterSuggestions: sanitizeInviterSuggestions(d.inviterSuggestions),
        });
      },
      wrapErr(OperationType.GET, userPath)
    )
  );

  // 2. Evidence
  const evPath = `users/${uid}/evidence`;
  unsubs.push(
    onSnapshot(
      query(collection(firestore, "users", uid, "evidence"), where("userId", "==", uid)),
      (snap) => {
        const items: Evidence[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            claimText: d.claimText ?? "",
            category: d.category ?? "demonstrated_skill",
            sourceDocumentOrConfirmation: d.sourceDocumentOrConfirmation ?? "",
            sourceExcerpt: d.sourceExcerpt ?? "",
            verificationStatus: d.verificationStatus ?? "Needs clarification",
            dateAdded: d.dateAdded ?? "",
            mayUseInApplications: Boolean(d.mayUseInApplications),
            tags: Array.isArray(d.tags) ? d.tags : [],
            sourceDocumentId: d.sourceDocumentId || undefined,
          };
        });
        callbacks.onEvidence(items);
      },
      wrapErr(OperationType.LIST, evPath)
    )
  );

  // 3. Opportunities
  const oppPath = `users/${uid}/opportunities`;
  unsubs.push(
    onSnapshot(
      query(collection(firestore, "users", uid, "opportunities"), where("userId", "==", uid)),
      (snap) => {
        const items: Opportunity[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            employer: d.employer ?? "",
            title: d.title ?? "",
            officialWebsite: d.officialWebsite ?? "",
            postingUrl: d.postingUrl ?? "",
            applicationUrl: d.applicationUrl ?? "",
            location: d.location ?? "",
            eligibleLocations: d.eligibleLocations ?? "",
            workArrangement: d.workArrangement ?? "unknown",
            employmentType: d.employmentType ?? "unknown",
            datePosted: d.datePosted ?? "",
            dateFirstFound: d.dateFirstFound ?? "",
            dateLastVerified: d.dateLastVerified ?? "",
            openingAvailabilityStatus: d.openingAvailabilityStatus ?? "Unverified",
            intakeChannel: d.intakeChannel ?? "Employer careers page",
            rawDescriptionText: d.rawDescriptionText ?? "",
            compensation: d.compensation ?? {
              employerPublishedBase: "",
              employerPublishedVariable: "",
              variableAssumptionsNote: "",
              thirdPartyEstimate: "",
              thirdPartySource: "",
              compensationSourceNote: "",
              benefitsDocumented: "",
            },
            requiredQualifications: Array.isArray(d.requiredQualifications)
              ? d.requiredQualifications
              : [],
            preferredQualifications: Array.isArray(d.preferredQualifications)
              ? d.preferredQualifications
              : [],
            coreDuties: Array.isArray(d.coreDuties) ? d.coreDuties : [],
            knownContactIds: Array.isArray(d.knownContactIds) ? d.knownContactIds : [],
            stage: d.stage ?? "Research / preparation",
            appliedConfirmedByNora: d.appliedConfirmedByNora ?? "unconfirmed",
            nextAction: d.nextAction ?? "",
            nextActionDueDate: d.nextActionDueDate ?? "",
            writtenAdvancementInfo: d.writtenAdvancementInfo ?? "",
            trainingProvidedInfo: d.trainingProvidedInfo ?? "",
            commuteAndScheduleNotes: d.commuteAndScheduleNotes ?? "",
            outstandingQuestions: Array.isArray(d.outstandingQuestions)
              ? d.outstandingQuestions
              : [],
            authenticityFlags: Array.isArray(d.authenticityFlags)
              ? d.authenticityFlags
              : [],
            liveVerificationLog: {
              lastCheckedAt: d.liveVerificationLog?.lastCheckedAt
                ? d.liveVerificationLog.lastCheckedAt
                : null,
              liveAvailable: Boolean(d.liveVerificationLog?.liveAvailable),
              summary: d.liveVerificationLog?.summary ?? "",
              sources: Array.isArray(d.liveVerificationLog?.sources)
                ? d.liveVerificationLog.sources
                : [],
            },
            archived: Boolean(d.archived),
          };
        });
        callbacks.onOpportunities(items);
      },
      wrapErr(OperationType.LIST, oppPath)
    )
  );

  // 4. Requirement Assessments
  const raPath = `users/${uid}/assessments`;
  unsubs.push(
    onSnapshot(
      query(collection(firestore, "users", uid, "assessments"), where("userId", "==", uid)),
      (snap) => {
        const items: RequirementAssessment[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            opportunityId: d.opportunityId,
            requirementText: d.requirementText ?? "",
            priority: d.priority === "Preferred" ? "Preferred" : "Required",
            noraEvidenceSummary: d.noraEvidenceSummary ?? "",
            linkedEvidenceIds: Array.isArray(d.linkedEvidenceIds)
              ? d.linkedEvidenceIds
              : [],
            assessment: d.assessment ?? "Unknown",
            gapNature: d.gapNature ?? "none",
            nextStep: d.nextStep ?? "",
          };
        });
        callbacks.onAssessments(items);
      },
      wrapErr(OperationType.LIST, raPath)
    )
  );

  // 5. Contacts
  const conPath = `users/${uid}/contacts`;
  unsubs.push(
    onSnapshot(
      query(collection(firestore, "users", uid, "contacts"), where("userId", "==", uid)),
      (snap) => {
        const items: Contact[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            name: d.name ?? "",
            organization: d.organization ?? "",
            role: d.role ?? "",
            roleVerified: Boolean(d.roleVerified),
            relationship: d.relationship ?? "",
            source: d.source ?? "",
            contactChannelNote: d.contactChannelNote ?? "",
            lastContactDate: d.lastContactDate ?? "",
            nextAction: d.nextAction ?? "",
            nextActionDueDate: d.nextActionDueDate ?? "",
            replyStatus: d.replyStatus ?? "Not contacted yet",
            doNotContact: Boolean(d.doNotContact),
            linkedOpportunityId: d.linkedOpportunityId ?? "",
            notes: d.notes ?? "",
          };
        });
        callbacks.onContacts(items);
      },
      wrapErr(OperationType.LIST, conPath)
    )
  );

  // 6. Outreach Drafts
  const draftPath = `users/${uid}/outreachDrafts`;
  unsubs.push(
    onSnapshot(
      query(collection(firestore, "users", uid, "outreachDrafts"), where("userId", "==", uid)),
      (snap) => {
        const items: OutreachDraft[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            contactId: d.contactId ?? "",
            opportunityId: d.opportunityId ?? "",
            messageType: d.messageType ?? "Informational interview request",
            recipientSummary: d.recipientSummary ?? "",
            bodyText: d.bodyText ?? "",
            evidenceUsed: Array.isArray(d.evidenceUsed) ? d.evidenceUsed : [],
            missingInformation: Array.isArray(d.missingInformation)
              ? d.missingInformation
              : [],
            reasoning: d.reasoning ?? "",
            suggestedNextAction: d.suggestedNextAction ?? "",
            approvedByNora: Boolean(d.approvedByNora),
            approvedAt: d.approvedAt ? d.approvedAt : null,
            sentState: d.sentState ?? "approved",
            manuallySentLoggedAt: d.manuallySentLoggedAt ? d.manuallySentLoggedAt : null,
            createdAt: timestampToIso(d.createdAt, new Date().toISOString()),
          };
        });
        callbacks.onOutreachDrafts(items);
      },
      wrapErr(OperationType.LIST, draftPath)
    )
  );

  // 7. Application Versions
  const verPath = `users/${uid}/applicationVersions`;
  unsubs.push(
    onSnapshot(
      query(
        collection(firestore, "users", uid, "applicationVersions"),
        where("userId", "==", uid)
      ),
      (snap) => {
        const items: ApplicationVersion[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            opportunityId: d.opportunityId ?? "",
            versionLabel: d.versionLabel ?? "Saved Draft",
            createdAt: timestampToIso(d.createdAt, new Date().toISOString()),
            tailoredResumeText: d.tailoredResumeText ?? "",
            coverNoteText: d.coverNoteText ?? "",
            whyThisRoleText: d.whyThisRoleText ?? "",
            applicationQuestionsText: d.applicationQuestionsText ?? "",
            interviewTalkingPoints: d.interviewTalkingPoints ?? "",
            checklistCompleted: d.checklistCompleted ?? {
              verifiedAllClaims: false,
              noInventedMetrics: false,
              noTrainingImpliedAsWork: false,
              placeholdersResolved: false,
              employerDestinationChecked: false,
            },
            submitted: Boolean(d.submitted),
            submittedDate: d.submittedDate ?? "",
            submissionNotes: d.submissionNotes ?? "",
          };
        });
        callbacks.onApplicationVersions(items);
      },
      wrapErr(OperationType.LIST, verPath)
    )
  );

  // 8. Tasks
  const taskPath = `users/${uid}/tasks`;
  unsubs.push(
    onSnapshot(
      query(collection(firestore, "users", uid, "tasks"), where("userId", "==", uid)),
      (snap) => {
        const items: Task[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            title: d.title ?? "",
            whyItMatters: d.whyItMatters ?? "",
            category: d.category ?? "opportunity",
            estimatedMinutes: Number(d.estimatedMinutes) || 15,
            dueDate: d.dueDate ?? "",
            scheduledBucket: d.scheduledBucket ?? "today",
            completed: Boolean(d.completed),
            completedAt: d.completedAt ? d.completedAt : null,
            archived: Boolean(d.archived),
            linkedOpportunityId: d.linkedOpportunityId || undefined,
            linkedContactId: d.linkedContactId || undefined,
          };
        });
        callbacks.onTasks(items);
      },
      wrapErr(OperationType.LIST, taskPath)
    )
  );

  // 9. Practice Sessions
  const pracPath = `users/${uid}/practiceSessions`;
  unsubs.push(
    onSnapshot(
      query(
        collection(firestore, "users", uid, "practiceSessions"),
        where("userId", "==", uid)
      ),
      (snap) => {
        const items: PracticeSession[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            mode: d.mode ?? "intro_45s",
            promptQuestion: d.promptQuestion ?? "",
            noraResponse: d.noraResponse ?? "",
            feedback: d.feedback ?? {
              accuracy: "",
              relevance: "",
              clarity: "",
              specificExamples: "",
              concision: "",
              unsupportedClaims: [],
              evidenceUsed: [],
              missingInformation: [],
              reasoning: "",
              suggestedNextAction: "",
            },
            durationMinutes: Number(d.durationMinutes) || 5,
            createdAt: timestampToIso(d.createdAt, new Date().toISOString()),
            linkedOpportunityId: d.linkedOpportunityId || undefined,
          };
        });
        items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        callbacks.onPracticeSessions(items);
      },
      wrapErr(OperationType.LIST, pracPath)
    )
  );

  // 10. Learning Items
  const learnPath = `users/${uid}/learningItems`;
  unsubs.push(
    onSnapshot(
      query(collection(firestore, "users", uid, "learningItems"), where("userId", "==", uid)),
      (snap) => {
        const items: LearningItem[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            title: d.title ?? "",
            tiedToRequirement: d.tiedToRequirement ?? "",
            linkedOpportunityId: d.linkedOpportunityId || undefined,
            status: d.progressStage ?? "Planned",
            estimatedHours: Number(d.estimatedHours) || 1,
            practicalExercise: d.practicalExercise ?? "",
            honestFramingNote: d.honestFramingNote ?? "",
          };
        });
        callbacks.onLearningItems(items);
      },
      wrapErr(OperationType.LIST, learnPath)
    )
  );

  // 11. Time Logs
  const timePath = `users/${uid}/timeLogs`;
  unsubs.push(
    onSnapshot(
      query(collection(firestore, "users", uid, "timeLogs"), where("userId", "==", uid)),
      (snap) => {
        const items: TimeLogEntry[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            date: d.date ?? "",
            activity: d.activity ?? "Opportunity research & verification",
            minutes: Number(d.minutes) || 15,
            note: d.note ?? "",
          };
        });
        callbacks.onTimeLogs(items);
      },
      wrapErr(OperationType.LIST, timePath)
    )
  );

  // 12. Private Document Metadata (Note: documentBlobs are strictly non-listable)
  const docPath = `users/${uid}/documents`;
  unsubs.push(
    onSnapshot(
      query(collection(firestore, "users", uid, "documents"), where("userId", "==", uid)),
      (snap) => {
        const items: PrivateDocumentMeta[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: d.id,
            userId: d.userId,
            fileName: d.fileName ?? "",
            mimeType: d.mimeType ?? "application/octet-stream",
            byteSize: Number(d.byteSize) || 0,
            docCategory: d.docCategory ?? "supporting_document",
            linkedOpportunityId: d.linkedOpportunityId ?? "",
            storageRef: d.storageRef ?? "",
            sha256: d.sha256 ?? "",
            createdAtIso: timestampToIso(d.createdAt, new Date().toISOString()),
          };
        });
        items.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
        callbacks.onDocuments(items);
      },
      wrapErr(OperationType.LIST, docPath)
    )
  );

  // 13. Evidence Relationship Graph Edges (/users/{uid}/relationships)
  if (callbacks.onRelationships) {
    const relPath = `users/${uid}/relationships`;
    unsubs.push(
      onSnapshot(
        query(collection(firestore, "users", uid, "relationships"), where("userId", "==", uid)),
        (snap) => {
          const items: RelationshipEdge[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              id: d.id,
              userId: d.userId,
              canonicalKey: d.canonicalKey ?? "",
              sourceType: d.sourceType ?? "experience",
              sourceId: d.sourceId ?? "",
              sourceLabel: d.sourceLabel ?? "",
              targetType: d.targetType ?? "skill",
              targetId: d.targetId ?? "",
              targetLabel: d.targetLabel ?? "",
              relationshipType: d.relationshipType ?? "demonstrates",
              requirementPriority:
                d.requirementPriority === "Required" ||
                d.requirementPriority === "Preferred"
                  ? d.requirementPriority
                  : "N/A",
              evidenceIds: Array.isArray(d.evidenceIds) ? d.evidenceIds : [],
              rejectedEvidenceIds: Array.isArray(d.rejectedEvidenceIds)
                ? d.rejectedEvidenceIds
                : [],
              status:
                d.status === "confirmed" || d.status === "rejected"
                  ? d.status
                  : "suggested",
              origin:
                d.origin === "user" || d.origin === "ai_suggestion"
                  ? d.origin
                  : "document_extraction",
              explanationNote: d.explanationNote ?? "",
              createdAtIso: timestampToIso(d.createdAt, new Date().toISOString()),
              updatedAtIso: timestampToIso(d.updatedAt, new Date().toISOString()),
            };
          });
          items.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
          callbacks.onRelationships?.(items);
        },
        wrapErr(OperationType.LIST, relPath)
      )
    );
  }

  // 14. Authenticity & Safety Reviews (/users/{uid}/authenticityReviews)
  if (callbacks.onAuthenticityReviews) {
    const revPath = `users/${uid}/authenticityReviews`;
    unsubs.push(
      onSnapshot(
        query(
          collection(firestore, "users", uid, "authenticityReviews"),
          where("userId", "==", uid)
        ),
        (snap) => {
          const dims: AuthenticityDimension[] = [
            "employer_identity",
            "opening_authenticity",
            "recruiter_affiliation",
            "sender_channel_authenticity",
            "requested_action",
          ];
          const items: AuthenticityReview[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            const rawDims = (d.dimensionAssessments ?? {}) as Record<
              string,
              Partial<DimensionAssessmentSummary>
            >;
            const dimMap = {} as Record<AuthenticityDimension, DimensionAssessmentSummary>;
            for (const dim of dims) {
              const entry = rawDims[dim];
              dimMap[dim] = {
                dimension: dim,
                label: entry?.label ? String(entry.label) : DIMENSION_LABELS[dim],
                state:
                  entry?.state === "corroborated" ||
                  entry?.state === "unconfirmed" ||
                  entry?.state === "concern_or_conflict" ||
                  entry?.state === "high_risk"
                    ? entry.state
                    : "unchecked",
                summary: entry?.summary ? String(entry.summary) : "Not checked yet.",
              };
            }

            const ic = d.impersonationConfirmation;
            const impersonationConfirmation =
              ic && typeof ic === "object" && ic.active === true
                ? {
                    confirmedByIdentity: String(ic.confirmedByIdentity || ""),
                    identityEstablishmentMethod: String(
                      ic.identityEstablishmentMethod || ""
                    ),
                    supportingArtifactId: String(ic.supportingArtifactId || ""),
                    confirmedAtIso: String(ic.confirmedAtIso || ""),
                  }
                : null;

            return {
              id: d.id,
              userId: d.userId,
              opportunityId: d.opportunityId ?? "",
              subjectLabel: d.subjectLabel ?? "Authenticity Review",
              officialEmployerDomain: d.officialEmployerDomain ?? "",
              reviewScope: d.reviewScope ?? "",
              overallStatus: d.overallStatus ?? "not_reviewed",
              dimensionAssessments: dimMap,
              impersonationConfirmation,
              userDecision: d.userDecision ?? "undecided",
              userDecisionNote: d.userDecisionNote ?? "",
              liveResearchStatus:
                d.liveResearchStatus === "available" ||
                d.liveResearchStatus === "unavailable"
                  ? d.liveResearchStatus
                  : "not_requested",
              liveResearchSummary: d.liveResearchSummary ?? "",
              whatWasChecked: Array.isArray(d.whatWasChecked) ? d.whatWasChecked : [],
              whatRemainsUnknown: Array.isArray(d.whatRemainsUnknown)
                ? d.whatRemainsUnknown
                : [],
              nextVerificationSteps: Array.isArray(d.nextVerificationSteps)
                ? d.nextVerificationSteps
                : [],
              artifacts: Array.isArray(d.artifacts) ? (d.artifacts as ReviewArtifact[]) : [],
              checks: Array.isArray(d.checks) ? (d.checks as VerificationCheck[]) : [],
              findings: Array.isArray(d.findings) ? (d.findings as RiskFinding[]) : [],
              createdAtIso: timestampToIso(d.createdAt, new Date().toISOString()),
              updatedAtIso: timestampToIso(d.updatedAt, new Date().toISOString()),
            };
          });
          items.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
          callbacks.onAuthenticityReviews?.(items);
        },
        wrapErr(OperationType.LIST, revPath)
      )
    );
  }

  return () => {
    unsubs.forEach((u) => u());
  };
}

// ============================================================================
// DATABASE MUTATIONS (All errors pass through handleFirestoreError & propagate)
// ============================================================================

export async function saveUserDocToFirestore(
  uid: string,
  profile: Profile,
  settings: WorkspaceSettings,
  crmSimulation: WorkspaceState["crmSimulation"],
  extras?: {
    onboardingWizard?: OnboardingWizardState;
    sharingSettings?: WorkspaceSharingSettings;
    inviterSuggestions?: InviterSuggestionItem[];
  }
): Promise<void> {
  const firestore = requireDb();
  const path = `users/${uid}`;
  const ref = doc(firestore, "users", uid);
  try {
    await updateDoc(ref, {
      ...buildUserDocPayload(uid, profile, settings, crmSimulation, true, extras),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function createEvidenceInFirestore(
  uid: string,
  item: Evidence
): Promise<void> {
  const firestore = requireDb();
  const evId = sanitizeId(item.id, "ev");
  const path = `users/${uid}/evidence/${evId}`;
  try {
    await setDoc(doc(firestore, "users", uid, "evidence", evId), {
      id: evId,
      userId: uid,
      ...buildEvidenceMutableFields({ ...item, id: evId }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateEvidenceInFirestore(
  uid: string,
  item: Evidence
): Promise<void> {
  const firestore = requireDb();
  const evId = sanitizeId(item.id, "ev");
  const path = `users/${uid}/evidence/${evId}`;
  try {
    await updateDoc(doc(firestore, "users", uid, "evidence", evId), {
      ...buildEvidenceMutableFields(item),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteEvidenceFromFirestore(
  uid: string,
  evidenceId: string
): Promise<void> {
  const firestore = requireDb();
  const evId = sanitizeId(evidenceId, "ev");
  const path = `users/${uid}/evidence/${evId}`;
  try {
    await deleteDoc(doc(firestore, "users", uid, "evidence", evId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function createOpportunityWithAssessmentsInFirestore(
  uid: string,
  opp: Opportunity,
  assessments: RequirementAssessment[]
): Promise<void> {
  const firestore = requireDb();
  const oppId = sanitizeId(opp.id, "opp");
  const path = `users/${uid}/opportunities/${oppId}`;
  const batch = writeBatch(firestore);

  batch.set(doc(firestore, "users", uid, "opportunities", oppId), {
    id: oppId,
    userId: uid,
    ...buildOpportunityMutableFields({ ...opp, id: oppId }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  for (const a of assessments.slice(0, 40)) {
    const aId = sanitizeId(a.id, "ra");
    batch.set(doc(firestore, "users", uid, "assessments", aId), {
      id: aId,
      userId: uid,
      opportunityId: oppId,
      ...buildAssessmentMutableFields(a),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateOpportunityInFirestore(
  uid: string,
  opp: Opportunity
): Promise<void> {
  if (opp.isSampleRecord) return;
  const firestore = requireDb();
  const oppId = sanitizeId(opp.id, "opp");
  const path = `users/${uid}/opportunities/${oppId}`;
  try {
    await updateDoc(doc(firestore, "users", uid, "opportunities", oppId), {
      ...buildOpportunityMutableFields(opp),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteOpportunityCascadeFromFirestore(
  uid: string,
  opportunityId: string,
  existingAssessments: RequirementAssessment[],
  existingVersions: ApplicationVersion[],
  existingReviews: AuthenticityReview[] = []
): Promise<void> {
  const firestore = requireDb();
  const oppId = sanitizeId(opportunityId, "opp");
  const path = `users/${uid}/opportunities/${oppId}`;
  const batch = writeBatch(firestore);

  for (const a of existingAssessments.filter((x) => x.opportunityId === oppId)) {
    batch.delete(doc(firestore, "users", uid, "assessments", sanitizeId(a.id, "ra")));
  }
  for (const v of existingVersions.filter((x) => x.opportunityId === oppId)) {
    batch.delete(
      doc(firestore, "users", uid, "applicationVersions", sanitizeId(v.id, "ver"))
    );
  }
  for (const rev of existingReviews.filter((x) => x.opportunityId === oppId)) {
    batch.update(
      doc(firestore, "users", uid, "authenticityReviews", sanitizeId(rev.id, "authrev")),
      {
        opportunityId: "",
        updatedAt: serverTimestamp(),
      }
    );
  }
  batch.delete(doc(firestore, "users", uid, "opportunities", oppId));

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function replaceAssessmentsForOpportunityInFirestore(
  uid: string,
  opportunityId: string,
  previousAssessments: RequirementAssessment[],
  nextAssessments: RequirementAssessment[]
): Promise<void> {
  const firestore = requireDb();
  const oppId = sanitizeId(opportunityId, "opp");
  const path = `users/${uid}/assessments`;
  const batch = writeBatch(firestore);

  const prevIds = new Set(
    previousAssessments
      .filter((p) => p.opportunityId === oppId)
      .map((p) => sanitizeId(p.id, "ra"))
  );
  const nextIds = new Set(nextAssessments.map((n) => sanitizeId(n.id, "ra")));

  for (const oldId of prevIds) {
    if (!nextIds.has(oldId)) {
      batch.delete(doc(firestore, "users", uid, "assessments", oldId));
    }
  }

  for (const item of nextAssessments.slice(0, 40)) {
    const aId = sanitizeId(item.id, "ra");
    const ref = doc(firestore, "users", uid, "assessments", aId);
    if (prevIds.has(aId)) {
      batch.update(ref, {
        ...buildAssessmentMutableFields(item),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(ref, {
        id: aId,
        userId: uid,
        opportunityId: oppId,
        ...buildAssessmentMutableFields(item),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function createApplicationVersionInFirestore(
  uid: string,
  version: ApplicationVersion
): Promise<void> {
  const firestore = requireDb();
  const vId = sanitizeId(version.id, "ver");
  const oppId = sanitizeId(version.opportunityId, "opp");
  const path = `users/${uid}/applicationVersions/${vId}`;

  try {
    await setDoc(doc(firestore, "users", uid, "applicationVersions", vId), {
      id: vId,
      userId: uid,
      opportunityId: oppId,
      versionLabel: nonEmptyTrunc(version.versionLabel, 200, "Saved Draft"),
      tailoredResumeText: trunc(version.tailoredResumeText, 30000),
      coverNoteText: trunc(version.coverNoteText, 10000),
      whyThisRoleText: trunc(version.whyThisRoleText, 6000),
      applicationQuestionsText: trunc(version.applicationQuestionsText, 12000),
      interviewTalkingPoints: trunc(version.interviewTalkingPoints, 8000),
      checklistCompleted: {
        verifiedAllClaims: Boolean(version.checklistCompleted?.verifiedAllClaims),
        noInventedMetrics: Boolean(version.checklistCompleted?.noInventedMetrics),
        noTrainingImpliedAsWork: Boolean(
          version.checklistCompleted?.noTrainingImpliedAsWork
        ),
        placeholdersResolved: Boolean(
          version.checklistCompleted?.placeholdersResolved
        ),
        employerDestinationChecked: Boolean(
          version.checklistCompleted?.employerDestinationChecked
        ),
      },
      submitted: Boolean(version.submitted),
      submittedDate: trunc(version.submittedDate, 30),
      submissionNotes: trunc(version.submissionNotes, 1000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createContactInFirestore(
  uid: string,
  contact: Contact
): Promise<void> {
  const firestore = requireDb();
  const cId = sanitizeId(contact.id, "con");
  const path = `users/${uid}/contacts/${cId}`;
  try {
    await setDoc(doc(firestore, "users", uid, "contacts", cId), {
      id: cId,
      userId: uid,
      ...buildContactMutableFields({ ...contact, id: cId }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateContactInFirestore(
  uid: string,
  contact: Contact
): Promise<void> {
  const firestore = requireDb();
  const cId = sanitizeId(contact.id, "con");
  const path = `users/${uid}/contacts/${cId}`;
  try {
    await updateDoc(doc(firestore, "users", uid, "contacts", cId), {
      ...buildContactMutableFields(contact),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteContactFromFirestore(
  uid: string,
  contactId: string
): Promise<void> {
  const firestore = requireDb();
  const cId = sanitizeId(contactId, "con");
  const path = `users/${uid}/contacts/${cId}`;
  try {
    await deleteDoc(doc(firestore, "users", uid, "contacts", cId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function createOutreachDraftInFirestore(
  uid: string,
  draft: OutreachDraft
): Promise<void> {
  const firestore = requireDb();
  const dId = sanitizeId(draft.id, "outreach");
  const cId = sanitizeId(draft.contactId, "con");
  const path = `users/${uid}/outreachDrafts/${dId}`;

  const sentState: "draft" | "approved" | "logged_sent" =
    draft.sentState ||
    (draft.manuallySentLoggedAt
      ? "logged_sent"
      : draft.approvedByNora
      ? "approved"
      : "draft");

  try {
    await setDoc(doc(firestore, "users", uid, "outreachDrafts", dId), {
      id: dId,
      userId: uid,
      contactId: cId,
      opportunityId: sanitizeOptionalId(draft.opportunityId),
      messageType: trunc(draft.messageType, 60, "Informational interview request"),
      recipientSummary: trunc(draft.recipientSummary, 300),
      bodyText: nonEmptyTrunc(draft.bodyText, 8000, "Draft message"),
      evidenceUsed: boundedStrings(draft.evidenceUsed, 15, 500),
      missingInformation: boundedStrings(draft.missingInformation, 15, 500),
      reasoning: trunc(draft.reasoning, 2000),
      suggestedNextAction: trunc(draft.suggestedNextAction, 1000),
      approvedByNora: Boolean(draft.approvedByNora),
      approvedAt: trunc(draft.approvedAt || "", 40),
      sentState,
      manuallySentLoggedAt: trunc(draft.manuallySentLoggedAt || "", 40),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createTaskInFirestore(
  uid: string,
  task: Task
): Promise<void> {
  const firestore = requireDb();
  const tId = sanitizeId(task.id, "task");
  const path = `users/${uid}/tasks/${tId}`;
  try {
    await setDoc(doc(firestore, "users", uid, "tasks", tId), {
      id: tId,
      userId: uid,
      ...buildTaskMutableFields({ ...task, id: tId }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateTaskInFirestore(
  uid: string,
  task: Task
): Promise<void> {
  const firestore = requireDb();
  const tId = sanitizeId(task.id, "task");
  const path = `users/${uid}/tasks/${tId}`;
  try {
    await updateDoc(doc(firestore, "users", uid, "tasks", tId), {
      ...buildTaskMutableFields(task),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function createPracticeSessionInFirestore(
  uid: string,
  session: PracticeSession
): Promise<void> {
  const firestore = requireDb();
  const sId = sanitizeId(session.id, "prac");
  const path = `users/${uid}/practiceSessions/${sId}`;

  const cleanFeedback = {
    accuracy: trunc(session.feedback?.accuracy, 1500),
    relevance: trunc(session.feedback?.relevance, 1500),
    clarity: trunc(session.feedback?.clarity, 1500),
    specificExamples: trunc(session.feedback?.specificExamples, 1500),
    concision: trunc(session.feedback?.concision, 1500),
    unsupportedClaims: boundedStrings(session.feedback?.unsupportedClaims, 15, 500),
    evidenceUsed: boundedStrings(session.feedback?.evidenceUsed, 15, 500),
    missingInformation: boundedStrings(session.feedback?.missingInformation, 15, 500),
    reasoning: trunc(session.feedback?.reasoning, 1500),
    suggestedNextAction: trunc(session.feedback?.suggestedNextAction, 1000),
    revisedExample: trunc(session.feedback?.revisedExample || "", 3000),
  };

  try {
    await setDoc(doc(firestore, "users", uid, "practiceSessions", sId), {
      id: sId,
      userId: uid,
      mode: trunc(session.mode, 40, "intro_45s"),
      promptQuestion: nonEmptyTrunc(
        session.promptQuestion,
        1000,
        "Practice prompt"
      ),
      noraResponse: nonEmptyTrunc(session.noraResponse, 10000, "Practice response"),
      feedback: cleanFeedback,
      durationMinutes: Math.min(
        300,
        Math.max(1, Math.round(Number(session.durationMinutes) || 5))
      ),
      linkedOpportunityId: sanitizeOptionalId(session.linkedOpportunityId),
      sessionState: "finalized",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createLearningItemInFirestore(
  uid: string,
  item: LearningItem
): Promise<void> {
  const firestore = requireDb();
  const lId = sanitizeId(item.id, "learn");
  const path = `users/${uid}/learningItems/${lId}`;
  try {
    await setDoc(doc(firestore, "users", uid, "learningItems", lId), {
      id: lId,
      userId: uid,
      title: nonEmptyTrunc(item.title, 400, "Learning item"),
      tiedToRequirement: trunc(item.tiedToRequirement, 600),
      linkedOpportunityId: sanitizeOptionalId(item.linkedOpportunityId),
      progressStage: item.status,
      estimatedHours: Math.min(500, Math.max(0, Number(item.estimatedHours) || 1)),
      practicalExercise: trunc(item.practicalExercise, 1500),
      honestFramingNote: trunc(item.honestFramingNote, 1000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateLearningItemInFirestore(
  uid: string,
  item: LearningItem
): Promise<void> {
  const firestore = requireDb();
  const lId = sanitizeId(item.id, "learn");
  const path = `users/${uid}/learningItems/${lId}`;
  try {
    await updateDoc(doc(firestore, "users", uid, "learningItems", lId), {
      title: nonEmptyTrunc(item.title, 400, "Learning item"),
      tiedToRequirement: trunc(item.tiedToRequirement, 600),
      linkedOpportunityId: sanitizeOptionalId(item.linkedOpportunityId),
      progressStage: item.status,
      estimatedHours: Math.min(500, Math.max(0, Number(item.estimatedHours) || 1)),
      practicalExercise: trunc(item.practicalExercise, 1500),
      honestFramingNote: trunc(item.honestFramingNote, 1000),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function createTimeLogInFirestore(
  uid: string,
  entry: TimeLogEntry
): Promise<void> {
  const firestore = requireDb();
  const logId = sanitizeId(entry.id, "time");
  const path = `users/${uid}/timeLogs/${logId}`;
  try {
    await setDoc(doc(firestore, "users", uid, "timeLogs", logId), {
      id: logId,
      userId: uid,
      date: trunc(entry.date || getTodayIsoDate(), 30),
      activity: trunc(entry.activity, 120, "Opportunity research & verification"),
      minutes: Math.min(720, Math.max(1, Math.round(Number(entry.minutes) || 15))),
      note: trunc(entry.note, 500),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function upsertRelationshipEdgeInFirestore(
  uid: string,
  edge: RelationshipEdge,
  isExisting: boolean
): Promise<void> {
  const firestore = requireDb();
  const relId = sanitizeId(edge.id, "rel");
  const path = `users/${uid}/relationships/${relId}`;
  const ref = doc(firestore, "users", uid, "relationships", relId);

  const mutableFields = {
    sourceLabel: nonEmptyTrunc(edge.sourceLabel, 300, edge.sourceId || "Source"),
    targetLabel: nonEmptyTrunc(edge.targetLabel, 300, edge.targetId || "Target"),
    requirementPriority:
      edge.requirementPriority === "Required" ||
      edge.requirementPriority === "Preferred"
        ? edge.requirementPriority
        : ("N/A" as const),
    evidenceIds: boundedStrings(edge.evidenceIds, 20, 128),
    rejectedEvidenceIds: boundedStrings(edge.rejectedEvidenceIds, 20, 128),
    status:
      edge.status === "confirmed" || edge.status === "rejected"
        ? edge.status
        : ("suggested" as const),
    origin:
      edge.origin === "user" || edge.origin === "ai_suggestion"
        ? edge.origin
        : ("document_extraction" as const),
    explanationNote: trunc(edge.explanationNote, 1000),
  };

  try {
    if (isExisting) {
      await updateDoc(ref, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id: relId,
        userId: uid,
        canonicalKey: nonEmptyTrunc(
          edge.canonicalKey,
          400,
          `${edge.sourceType}:${edge.sourceId}|${edge.relationshipType}|${edge.targetType}:${edge.targetId}`
        ),
        sourceType: edge.sourceType,
        sourceId: sanitizeId(edge.sourceId, "src"),
        targetType: edge.targetType,
        targetId: sanitizeId(edge.targetId, "dst"),
        relationshipType: edge.relationshipType,
        ...mutableFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(
      err,
      isExisting ? OperationType.UPDATE : OperationType.CREATE,
      path
    );
  }
}

export async function deleteRelationshipEdgeFromFirestore(
  uid: string,
  relationshipId: string
): Promise<void> {
  const firestore = requireDb();
  const relId = sanitizeId(relationshipId, "rel");
  const path = `users/${uid}/relationships/${relId}`;
  try {
    await deleteDoc(doc(firestore, "users", uid, "relationships", relId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function pruneRemovedEvidenceFromRelationshipsInFirestore(
  uid: string,
  removedEvidenceOrDocId: string,
  existingRelationships: RelationshipEdge[]
): Promise<void> {
  const cleanRemovedId = sanitizeId(removedEvidenceOrDocId, "ev");
  const affected = (existingRelationships || []).filter(
    (r) =>
      r.sourceId === cleanRemovedId ||
      r.sourceId === `exp-${cleanRemovedId}` ||
      r.sourceId === `learn-${cleanRemovedId}` ||
      (r.evidenceIds || []).includes(cleanRemovedId)
  );
  if (affected.length === 0) return;

  const firestore = requireDb();
  const batch = writeBatch(firestore);
  const path = `users/${uid}/relationships`;

  for (const edge of affected) {
    const relId = sanitizeId(edge.id, "rel");
    const ref = doc(firestore, "users", uid, "relationships", relId);
    if (
      edge.sourceId === cleanRemovedId ||
      edge.sourceId === `exp-${cleanRemovedId}` ||
      edge.sourceId === `learn-${cleanRemovedId}`
    ) {
      batch.delete(ref);
    } else {
      const nextEvidenceIds = (edge.evidenceIds || []).filter(
        (id) => id !== cleanRemovedId
      );
      const needsDowngrade =
        nextEvidenceIds.length === 0 &&
        edge.status === "confirmed" &&
        ["demonstrates", "supports", "adjacent_to"].includes(
          edge.relationshipType
        );
      batch.update(ref, {
        evidenceIds: boundedStrings(nextEvidenceIds, 20, 128),
        status: needsDowngrade ? "suggested" : edge.status,
        explanationNote: trunc(
          needsDowngrade
            ? "Supporting evidence was removed; downgraded to suggestion until verified evidence is attached."
            : edge.explanationNote,
          1000
        ),
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

function buildAuthenticityReviewMutableFields(review: AuthenticityReview) {
  const dims: AuthenticityDimension[] = [
    "employer_identity",
    "opening_authenticity",
    "recruiter_affiliation",
    "sender_channel_authenticity",
    "requested_action",
  ];
  const dimensionAssessments: Record<string, DimensionAssessmentSummary> = {};
  for (const dim of dims) {
    const entry = review.dimensionAssessments?.[dim];
    dimensionAssessments[dim] = {
      dimension: dim,
      label: nonEmptyTrunc(entry?.label, 80, DIMENSION_LABELS[dim]),
      state:
        entry?.state === "corroborated" ||
        entry?.state === "unconfirmed" ||
        entry?.state === "concern_or_conflict" ||
        entry?.state === "high_risk"
          ? entry.state
          : "unchecked",
      summary: trunc(entry?.summary, 400, "Not checked yet."),
    };
  }

  const hasValidImpersonation = Boolean(
    review.impersonationConfirmation &&
      review.impersonationConfirmation.confirmedByIdentity.trim().length >= 3 &&
      review.impersonationConfirmation.identityEstablishmentMethod.trim().length >= 5 &&
      review.impersonationConfirmation.supportingArtifactId.trim().length >= 1
  );

  const safeStatus =
    review.overallStatus === "documented_impersonation_confirmation" &&
    !hasValidImpersonation
      ? "unresolved_concerns"
      : [
          "not_reviewed",
          "partially_corroborated",
          "unresolved_concerns",
          "high_risk_request_detected",
          "corroborated_within_stated_scope",
          "documented_impersonation_confirmation",
        ].includes(review.overallStatus)
      ? review.overallStatus
      : "not_reviewed";

  const impersonationConfirmation = hasValidImpersonation
    ? {
        active: true,
        confirmedByIdentity: trunc(
          review.impersonationConfirmation!.confirmedByIdentity,
          240
        ),
        identityEstablishmentMethod: trunc(
          review.impersonationConfirmation!.identityEstablishmentMethod,
          500
        ),
        supportingArtifactId: sanitizeId(
          review.impersonationConfirmation!.supportingArtifactId,
          "art"
        ),
        confirmedAtIso: trunc(
          review.impersonationConfirmation!.confirmedAtIso || new Date().toISOString(),
          40
        ),
      }
    : {
        active: false,
        confirmedByIdentity: trunc(
          review.impersonationConfirmation?.confirmedByIdentity || "",
          240
        ),
        identityEstablishmentMethod: trunc(
          review.impersonationConfirmation?.identityEstablishmentMethod || "",
          500
        ),
        supportingArtifactId: sanitizeOptionalId(
          review.impersonationConfirmation?.supportingArtifactId
        ),
        confirmedAtIso: trunc(
          review.impersonationConfirmation?.confirmedAtIso || "",
          40
        ),
      };

  const artifacts = (review.artifacts || []).slice(0, 25).map((a, idx) => ({
    id: sanitizeId(a.id || `art-${idx + 1}`, "art"),
    type: ["message", "url", "screenshot", "document", "user_note"].includes(a.type)
      ? a.type
      : "user_note",
    title: nonEmptyTrunc(a.title, 200, "Supplied Artifact"),
    sourceProvenance: trunc(a.sourceProvenance, 300),
    senderAddress: trunc(a.senderAddress, 254),
    targetUrl: trunc(a.targetUrl, 800),
    contentExcerpt: trunc(a.contentExcerpt, 4000),
    privateDocumentId: sanitizeOptionalId(a.privateDocumentId),
    httpStatus:
      typeof a.httpStatus === "number" && Number.isFinite(a.httpStatus)
        ? a.httpStatus
        : null,
    redactionConfirmed: Boolean(a.redactionConfirmed),
    dateSupplied: trunc(a.dateSupplied || getTodayIsoDate(), 30),
  }));

  const checks = (review.checks || []).slice(0, 20).map((c, idx) => ({
    id: sanitizeId(c.id || `chk-${idx + 1}`, "chk"),
    dimension: dims.includes(c.dimension) ? c.dimension : "employer_identity",
    question: nonEmptyTrunc(c.question, 400, "Verification check"),
    status: ["not_started", "completed", "inconclusive", "unavailable"].includes(c.status)
      ? c.status
      : "not_started",
    outcome: ["not_evaluated", "corroborated", "conflict_or_missing", "inconclusive"].includes(
      c.outcome
    )
      ? c.outcome
      : "not_evaluated",
    method: trunc(c.method, 400),
    evidenceArtifactIds: boundedStrings(c.evidenceArtifactIds, 10, 128),
    notes: trunc(c.notes, 1000),
    datePerformed: trunc(c.datePerformed, 30),
  }));

  const findings = (review.findings || []).slice(0, 40).map((f, idx) => ({
    id: sanitizeId(f.id || `fnd-${idx + 1}`, "fnd"),
    ruleKey: nonEmptyTrunc(f.ruleKey, 120, "rule"),
    dimension: dims.includes(f.dimension) ? f.dimension : "opening_authenticity",
    category: nonEmptyTrunc(f.category, 160, "Review item"),
    severity: ["informational", "caution", "stop_and_verify"].includes(f.severity)
      ? f.severity
      : "caution",
    observedBehavior: nonEmptyTrunc(f.observedBehavior, 600, "Observed detail"),
    interpretation: nonEmptyTrunc(f.interpretation, 600, "Requires verification"),
    supportingArtifactId: sanitizeOptionalId(f.supportingArtifactId),
    supportingExcerpt: trunc(f.supportingExcerpt, 350),
    basis: [
      "deterministic_rule",
      "ai_suggestion",
      "user_report",
      "independently_documented_confirmation",
    ].includes(f.basis)
      ? f.basis
      : "deterministic_rule",
    recommendedAction: trunc(f.recommendedAction, 500),
    userResolution: ["active", "corrected", "dismissed"].includes(f.userResolution)
      ? f.userResolution
      : "active",
    userResolutionExplanation: trunc(f.userResolutionExplanation, 500),
    resolvedAtIso: trunc(f.resolvedAtIso, 40),
  }));

  return {
    opportunityId: review.opportunityId?.startsWith("sample-")
      ? ""
      : sanitizeOptionalId(review.opportunityId),
    subjectLabel: nonEmptyTrunc(review.subjectLabel, 240, "Authenticity Review"),
    officialEmployerDomain: trunc(review.officialEmployerDomain, 255),
    reviewScope: nonEmptyTrunc(
      review.reviewScope,
      400,
      "Supplied text and manual verification checklist"
    ),
    overallStatus: safeStatus,
    dimensionAssessments,
    impersonationConfirmation,
    userDecision: [
      "undecided",
      "proceed_within_scope",
      "pause_until_verified",
      "decline_and_disengage",
    ].includes(review.userDecision)
      ? review.userDecision
      : "undecided",
    userDecisionNote: trunc(review.userDecisionNote, 2000),
    liveResearchStatus: ["not_requested", "available", "unavailable"].includes(
      review.liveResearchStatus
    )
      ? review.liveResearchStatus
      : "not_requested",
    liveResearchSummary: trunc(review.liveResearchSummary, 2000),
    whatWasChecked: boundedStrings(review.whatWasChecked, 15, 400),
    whatRemainsUnknown: boundedStrings(review.whatRemainsUnknown, 15, 400),
    nextVerificationSteps: boundedStrings(review.nextVerificationSteps, 12, 400),
    artifacts,
    checks,
    findings,
  };
}

export async function upsertAuthenticityReviewInFirestore(
  uid: string,
  review: AuthenticityReview,
  existsAlready: boolean
): Promise<void> {
  const firestore = requireDb();
  const revId = sanitizeId(review.id, "authrev");
  const path = `users/${uid}/authenticityReviews/${revId}`;
  const ref = doc(firestore, "users", uid, "authenticityReviews", revId);
  const mutableFields = buildAuthenticityReviewMutableFields(review);

  try {
    if (existsAlready) {
      await updateDoc(ref, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id: revId,
        userId: uid,
        ...mutableFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(
      err,
      existsAlready ? OperationType.UPDATE : OperationType.CREATE,
      path
    );
  }
}

export async function deleteAuthenticityReviewFromFirestore(
  uid: string,
  reviewId: string
): Promise<void> {
  const firestore = requireDb();
  const revId = sanitizeId(reviewId, "authrev");
  const path = `users/${uid}/authenticityReviews/${revId}`;
  try {
    await deleteDoc(doc(firestore, "users", uid, "authenticityReviews", revId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// PRIVATE FILE STORAGE (Zero public URLs; isolated metadata + non-listable blobs)
// ============================================================================

async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function uploadPrivateDocumentToFirestore(
  uid: string,
  file: File,
  docCategory: PrivateDocumentCategory,
  linkedOpportunityId = ""
): Promise<{
  meta: PrivateDocumentMeta;
  extractedTextIfPlain: string | null;
}> {
  const firestore = requireDb();
  if (file.size === 0) {
    throw new Error("Cannot upload an empty file (0 bytes).");
  }
  if (file.size > 500_000) {
    throw new Error(
      `File "${file.name}" is ${Math.round(file.size / 1024)} KB, exceeding the 500 KB private document storage limit.`
    );
  }

  const docId = sanitizeId(`doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, "doc");
  const buffer = await file.arrayBuffer();
  const sha256 = await computeSha256Hex(buffer);

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const isPlainText = ["txt", "md", "csv", "json"].includes(ext);
  let encoding: "utf8" | "base64" = "base64";
  let content = "";
  let extractedTextIfPlain: string | null = null;

  if (isPlainText) {
    const textContent = new TextDecoder("utf-8").decode(buffer);
    if (textContent.length >= 1 && textContent.length <= 700_000) {
      encoding = "utf8";
      content = textContent;
      extractedTextIfPlain = textContent;
    } else {
      encoding = "base64";
      content = arrayBufferToBase64(buffer);
    }
  } else {
    encoding = "base64";
    content = arrayBufferToBase64(buffer);
  }

  const storageRef = `users/${uid}/documentBlobs/${docId}`;
  const mimeType = trunc(file.type || "application/octet-stream", 120);
  const safeFileName = nonEmptyTrunc(file.name, 255, "private-document");
  const safeLinkedOppId = sanitizeOptionalId(linkedOpportunityId);

  const batch = writeBatch(firestore);
  batch.set(doc(firestore, "users", uid, "documents", docId), {
    id: docId,
    userId: uid,
    fileName: safeFileName,
    mimeType,
    byteSize: file.size,
    docCategory,
    linkedOpportunityId: safeLinkedOppId,
    storageRef,
    sha256,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(firestore, "users", uid, "documentBlobs", docId), {
    id: docId,
    userId: uid,
    documentId: docId,
    encoding,
    content,
    byteSize: file.size,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const path = `users/${uid}/documents/${docId}`;
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }

  return {
    meta: {
      id: docId,
      userId: uid,
      fileName: safeFileName,
      mimeType,
      byteSize: file.size,
      docCategory,
      linkedOpportunityId: safeLinkedOppId,
      storageRef,
      sha256,
      createdAtIso: new Date().toISOString(),
    },
    extractedTextIfPlain,
  };
}

export async function downloadPrivateDocumentFromFirestore(
  uid: string,
  meta: PrivateDocumentMeta
): Promise<void> {
  const firestore = requireDb();
  const docId = sanitizeId(meta.id, "doc");
  const blobPath = `users/${uid}/documentBlobs/${docId}`;

  let snap;
  try {
    snap = await getDoc(doc(firestore, "users", uid, "documentBlobs", docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, blobPath);
  }

  if (!snap || !snap.exists()) {
    throw new Error("Private file content was not found or has already been deleted.");
  }

  const data = snap.data();
  let blob: Blob;
  if (data.encoding === "utf8") {
    blob = new Blob([String(data.content || "")], {
      type: `${meta.mimeType || "text/plain"};charset=utf-8`,
    });
  } else {
    const bytes = base64ToUint8Array(String(data.content || ""));
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    blob = new Blob([ab], { type: meta.mimeType || "application/octet-stream" });
  }

  const tempUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = tempUrl;
  anchor.download = meta.fileName || `private-file-${docId}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(tempUrl), 1000);
}

export async function deletePrivateDocumentFromFirestore(
  uid: string,
  documentId: string
): Promise<void> {
  const firestore = requireDb();
  const docId = sanitizeId(documentId, "doc");
  const path = `users/${uid}/documents/${docId}`;

  const batch = writeBatch(firestore);
  batch.delete(doc(firestore, "users", uid, "documentBlobs", docId));
  batch.delete(doc(firestore, "users", uid, "documents", docId));

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// BULK CASCADING DELETE, STARTER RESET & IMPORT
// ============================================================================

const SUBCOLLECTIONS = [
  "evidence",
  "opportunities",
  "assessments",
  "contacts",
  "outreachDrafts",
  "applicationVersions",
  "tasks",
  "practiceSessions",
  "learningItems",
  "timeLogs",
  "documents",
  "relationships",
  "authenticityReviews",
] as const;

export async function deleteAllUserRecordsAndFilesFromFirestore(
  uid: string,
  mode: "clear_empty" | "reset_starter",
  userContext?: { displayName?: string | null; email?: string | null }
): Promise<{ deletedCount: number; deletedFilesCount: number }> {
  const firestore = requireDb();
  const refsToDelete: Array<ReturnType<typeof doc>> = [];
  let deletedFilesCount = 0;

  // Gather all owner documents across all subcollections + associated private documentBlobs
  for (const sub of SUBCOLLECTIONS) {
    const subPath = `users/${uid}/${sub}`;
    try {
      const snap = await getDocs(
        query(collection(firestore, "users", uid, sub), where("userId", "==", uid))
      );
      snap.docs.forEach((d) => {
        if (sub === "documents") {
          deletedFilesCount += 1;
          refsToDelete.push(doc(firestore, "users", uid, "documentBlobs", d.id));
        }
        refsToDelete.push(d.ref);
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, subPath);
    }
  }

  // Delete subcollection documents in chunks of <= 400 while /users/{uid} is still active
  for (let i = 0; i < refsToDelete.length; i += 400) {
    const chunk = refsToDelete.slice(i, i + 400);
    const batch = writeBatch(firestore);
    chunk.forEach((r) => batch.delete(r));
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/*`);
    }
  }

  if (mode === "clear_empty") {
    const emptyProfile: Profile = {
      id: uid,
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
      constraints: INITIAL_PROFILE.constraints,
    };
    const emptySettings: WorkspaceSettings = {
      availableMinutesToday: 45,
      allowServerSideAi: false,
      showSampleComparisonData: false,
    };
    const emptyCrm: WorkspaceState["crmSimulation"] = {
      searchedQueries: [],
      conversationLogs: [],
      followUpTasks: [],
      handoffNotes: [],
    };
    try {
      await updateDoc(doc(firestore, "users", uid), {
        ...buildUserDocPayload(uid, emptyProfile, emptySettings, emptyCrm, true),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  } else {
    // Delete root user doc and re-run starter initialization
    try {
      await deleteDoc(doc(firestore, "users", uid));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}`);
    }
    await ensureUserWorkspaceInitialized(uid, userContext);
  }

  return {
    deletedCount: refsToDelete.length,
    deletedFilesCount,
  };
}

/**
 * Permanently deletes all subcollection records, private uploaded document blobs,
 * AND the root /users/{uid} workspace document (used during user-initiated Account & Workspace Deletion).
 */
export async function permanentlyDeleteUserWorkspaceFromFirestore(
  uid: string
): Promise<{ deletedCount: number; deletedFilesCount: number }> {
  const firestore = requireDb();
  const refsToDelete: Array<ReturnType<typeof doc>> = [];
  let deletedFilesCount = 0;

  for (const sub of SUBCOLLECTIONS) {
    const subPath = `users/${uid}/${sub}`;
    try {
      const snap = await getDocs(
        query(collection(firestore, "users", uid, sub), where("userId", "==", uid))
      );
      snap.docs.forEach((d) => {
        if (sub === "documents") {
          deletedFilesCount += 1;
          refsToDelete.push(doc(firestore, "users", uid, "documentBlobs", d.id));
        }
        refsToDelete.push(d.ref);
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, subPath);
    }
  }

  for (let i = 0; i < refsToDelete.length; i += 400) {
    const chunk = refsToDelete.slice(i, i + 400);
    const batch = writeBatch(firestore);
    chunk.forEach((r) => batch.delete(r));
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/*`);
    }
  }

  try {
    await deleteDoc(doc(firestore, "users", uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${uid}`);
  }

  return {
    deletedCount: refsToDelete.length + 1,
    deletedFilesCount,
  };
}

export async function importWorkspaceBackupToFirestore(
  uid: string,
  imported: WorkspaceState
): Promise<void> {
  await deleteAllUserRecordsAndFilesFromFirestore(uid, "clear_empty");

  await saveUserDocToFirestore(
    uid,
    imported.profile,
    imported.settings || {
      availableMinutesToday: 45,
      allowServerSideAi: true,
      showSampleComparisonData: false,
    },
    imported.crmSimulation || {
      searchedQueries: [],
      conversationLogs: [],
      followUpTasks: [],
      handoffNotes: [],
    }
  );

  for (const ev of imported.evidence || []) {
    await createEvidenceInFirestore(uid, ev);
  }
  for (const opp of (imported.opportunities || []).filter((o) => !o.isSampleRecord)) {
    const matchingAssessments = (imported.assessments || []).filter(
      (a) => a.opportunityId === opp.id
    );
    await createOpportunityWithAssessmentsInFirestore(uid, opp, matchingAssessments);
  }
  for (const con of imported.contacts || []) {
    await createContactInFirestore(uid, con);
  }
  for (const draft of imported.outreachDrafts || []) {
    await createOutreachDraftInFirestore(uid, draft);
  }
  for (const ver of imported.applicationVersions || []) {
    await createApplicationVersionInFirestore(uid, ver);
  }
  for (const task of imported.tasks || []) {
    await createTaskInFirestore(uid, task);
  }
  for (const sess of imported.practiceSessions || []) {
    await createPracticeSessionInFirestore(uid, sess);
  }
  for (const learn of imported.learningItems || []) {
    await createLearningItemInFirestore(uid, learn);
  }
  for (const log of imported.timeLogs || []) {
    await createTimeLogInFirestore(uid, log);
  }
  for (const rel of imported.relationships || []) {
    await upsertRelationshipEdgeInFirestore(
      uid,
      { ...rel, userId: uid },
      false
    );
  }
  for (const rev of imported.authenticityReviews || []) {
    await upsertAuthenticityReviewInFirestore(
      uid,
      { ...rev, userId: uid },
      false
    );
  }
}

// ============================================================================
// DATABASE ACCEPTANCE DIAGNOSTICS (Live Server Read, Cross-User Isolation, Rejected Save)
// ============================================================================

export async function verifyServerSideRecordPersistence(uid: string): Promise<{
  verifiedFromServer: boolean;
  opportunityCountOnServer: number;
  profileFullNameOnServer: string;
}> {
  const firestore = requireDb();
  const userSnap = await getDocFromServer(doc(firestore, "users", uid));
  const oppSnap = await getDocs(
    query(collection(firestore, "users", uid, "opportunities"), where("userId", "==", uid))
  );
  return {
    verifiedFromServer: userSnap.exists(),
    opportunityCountOnServer: oppSnap.size,
    profileFullNameOnServer: userSnap.exists()
      ? String(userSnap.data().fullName || "")
      : "",
  };
}

export async function verifyCrossUserIsolationDenied(currentUid: string): Promise<{
  otherUserProfileBlocked: boolean;
  otherUserOpportunitiesBlocked: boolean;
}> {
  const firestore = requireDb();
  const otherUid =
    currentUid === "isolated-test-user-alpha"
      ? "isolated-test-user-beta"
      : "isolated-test-user-alpha";

  let otherUserProfileBlocked = false;
  let otherUserOpportunitiesBlocked = false;

  try {
    await getDocFromServer(doc(firestore, "users", otherUid));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    otherUserProfileBlocked =
      msg.includes("Missing or insufficient permissions") ||
      msg.includes("PERMISSION_DENIED");
  }

  try {
    await getDocFromServer(
      doc(firestore, "users", otherUid, "opportunities", "opp-foreign-test")
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    otherUserOpportunitiesBlocked =
      msg.includes("Missing or insufficient permissions") ||
      msg.includes("PERMISSION_DENIED");
  }

  return {
    otherUserProfileBlocked,
    otherUserOpportunitiesBlocked,
  };
}

/**
 * Intentionally sends a schema-invalid shadow-field write to Firestore to prove that:
 * 1) Firestore Security Rules reject invalid/unauthorized writes, and
 * 2) The UI accurately displays "Failed to save" rather than reporting false success.
 */
export async function triggerDiagnosticRejectedSave(uid: string): Promise<void> {
  const firestore = requireDb();
  const badPath = `users/${uid}/tasks/diag-rejected-write-test`;
  try {
    await setDoc(doc(firestore, "users", uid, "tasks", "diag-rejected-write-test"), {
      id: "diag-rejected-write-test",
      userId: uid,
      unauthorizedShadowField: true,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, badPath);
  }
}

export function buildExportBundle(workspace: WorkspaceState) {
  return {
    ...workspace,
    opportunities: (workspace.opportunities || []).filter((o) => !o.isSampleRecord),
    relationships: workspace.relationships || [],
    authenticityReviews: workspace.authenticityReviews || [],
    exportedAt: new Date().toISOString(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    privateDocumentsIncludedAsMetadataReferences: workspace.documents,
  };
}
