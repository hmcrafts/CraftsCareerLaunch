export type NavSection =
  | "today"
  | "profile"
  | "discover"
  | "opportunities"
  | "people"
  | "practice"
  | "connections"
  | "progress"
  | "settings";

export type VerificationStatus =
  | "Confirmed by Nora"
  | "Supported by uploaded document"
  | "Needs clarification"
  | "Draft wording only";

export type EvidenceCategory =
  | "demonstrated_skill"
  | "transferable_experience"
  | "training_in_progress"
  | "completed_training"
  | "not_yet_demonstrated";

export interface Evidence {
  id: string;
  claimText: string;
  category: EvidenceCategory;
  sourceDocumentOrConfirmation: string;
  sourceExcerpt: string;
  verificationStatus: VerificationStatus;
  dateAdded: string;
  mayUseInApplications: boolean;
  tags: string[];
  sourceDocumentId?: string;
}

export type TriChoiceOrUnsure<T extends string> = T | "not_sure";

export interface CareerConstraints {
  minBaseSalary: number | null;
  minBaseSalaryUnsure: boolean;
  desiredTotalComp: number | null;
  desiredTotalCompUnsure: boolean;
  benefitsRequirement: "essential" | "preferred" | "not_essential" | "not_sure";
  employmentType: "full_time" | "part_time" | "either" | "not_sure";
  workArrangement: "remote" | "hybrid" | "onsite" | "any" | "not_sure";
  maxCommuteMinutes: number | null;
  maxCommuteUnsure: boolean;
  willingToRelocate: "yes" | "no" | "open_for_right_role" | "not_sure";
  scheduleAndStartAvailability: string;
  commissionTolerance: "none_base_only" | "low_supplemental" | "moderate_with_solid_base" | "not_sure";
  outboundCallingComfort: "comfortable" | "willing_with_training" | "prefer_limited" | "avoid" | "not_sure";
  preferredIndustries: string;
  excludedIndustries: string;
  travelLimits: string;
  trainingTimeWeeklyHours: string;
  trainingBudgetDollars: string;
  onboardingReviewed: boolean;
}

export interface Profile {
  id: string;
  fullName: string;
  location: string;
  educationSummary: string;
  rbtCertificationStatus: "unverified" | "active" | "inactive_or_expired";
  rbtCertificationNote: string;
  littleLeavesSoftwareUsed: string;
  otherExperienceNotes: string;
  masterResumeText: string;
  masterResumeUpdatedAt: string | null;
  profileVerifiedByNora: boolean;
  constraints: CareerConstraints;
}

export type RequirementFitLevel =
  | "Direct evidence"
  | "Transferable evidence"
  | "Gap"
  | "Unknown";

export interface RequirementAssessment {
  id: string;
  opportunityId: string;
  requirementText: string;
  priority: "Required" | "Preferred";
  noraEvidenceSummary: string;
  linkedEvidenceIds: string[];
  assessment: RequirementFitLevel;
  gapNature: "none" | "hard_eligibility" | "trainable_skill" | "missing_evidence_check";
  nextStep: string;
}

export type FitRecommendationVerdict =
  | "Pursue now"
  | "Clarify first"
  | "Prepare, then pursue"
  | "Deprioritize";

export interface AuthenticityFlag {
  id: string;
  label: string;
  explanation: string;
  resolvedNote?: string;
}

export interface LiveVerificationSource {
  title: string;
  uri: string;
}

export type OpportunityStage =
  | "Research / preparation"
  | "Clarifying details"
  | "Ready to apply"
  | "Applied"
  | "Conversation / Screen"
  | "Interviewing"
  | "Offer received"
  | "Deprioritized / Archived";

export interface CompensationRecord {
  employerPublishedBase: string; // Empty string = Unknown
  employerPublishedVariable: string; // Empty string = Unknown
  variableAssumptionsNote: string;
  thirdPartyEstimate: string;
  thirdPartySource: string;
  compensationSourceNote: string;
  benefitsDocumented: string;
}

export interface Opportunity {
  id: string;
  employer: string;
  title: string;
  officialWebsite: string;
  postingUrl: string;
  applicationUrl: string;
  location: string;
  eligibleLocations: string;
  workArrangement: "remote" | "hybrid" | "onsite" | "unknown";
  employmentType: "full_time" | "part_time" | "contract" | "unknown";
  datePosted: string;
  dateFirstFound: string;
  dateLastVerified: string;
  openingAvailabilityStatus: "Unverified" | "Seen on official careers page" | "No longer listed / Closed";
  intakeChannel:
    | "Employer careers page"
    | "Target-employer research"
    | "Referral / informational conversation"
    | "Former colleague / contact"
    | "Job board"
    | "Starter workspace"
    | "Manual / CSV import";
  rawDescriptionText: string;
  compensation: CompensationRecord;
  requiredQualifications: string[];
  preferredQualifications: string[];
  coreDuties: string[];
  knownContactIds: string[];
  stage: OpportunityStage;
  appliedConfirmedByNora: "unconfirmed" | "not_applied" | "applied";
  nextAction: string;
  nextActionDueDate: string;
  writtenAdvancementInfo: string;
  trainingProvidedInfo: string;
  commuteAndScheduleNotes: string;
  outstandingQuestions: string[];
  authenticityFlags: AuthenticityFlag[];
  liveVerificationLog: {
    lastCheckedAt: string | null;
    liveAvailable: boolean;
    summary: string;
    sources: LiveVerificationSource[];
  };
  archived: boolean;
  isSampleRecord?: boolean;
}

export interface ApplicationVersion {
  id: string;
  opportunityId: string;
  versionLabel: string;
  createdAt: string;
  tailoredResumeText: string;
  coverNoteText: string;
  whyThisRoleText: string;
  applicationQuestionsText: string;
  interviewTalkingPoints: string;
  checklistCompleted: {
    verifiedAllClaims: boolean;
    noInventedMetrics: boolean;
    noTrainingImpliedAsWork: boolean;
    placeholdersResolved: boolean;
    employerDestinationChecked: boolean;
  };
  submitted: boolean;
  submittedDate: string;
  submissionNotes: string;
}

export interface Contact {
  id: string;
  name: string;
  organization: string;
  role: string;
  roleVerified: boolean;
  relationship: string;
  source: string;
  contactChannelNote: string; // Never guessed personal email
  lastContactDate: string;
  nextAction: string;
  nextActionDueDate: string;
  replyStatus: "Not contacted yet" | "Awaiting reply" | "Replied — conversation active" | "No response" | "Do not contact";
  doNotContact: boolean;
  linkedOpportunityId: string;
  notes: string;
}

export type OutreachMessageType =
  | "Connection request"
  | "Informational interview request"
  | "Referral request"
  | "Recruiter message"
  | "Follow-up"
  | "Thank-you note";

export interface OutreachDraft {
  id: string;
  contactId: string;
  opportunityId: string;
  messageType: OutreachMessageType;
  recipientSummary: string;
  bodyText: string;
  evidenceUsed: string[];
  missingInformation: string[];
  reasoning: string;
  suggestedNextAction: string;
  approvedByNora: boolean;
  approvedAt: string | null;
  sentState?: "draft" | "approved" | "logged_sent";
  manuallySentLoggedAt: string | null;
  createdAt: string;
}

export type TaskCategory =
  | "opportunity"
  | "relationship"
  | "preparation"
  | "followup";

export interface Task {
  id: string;
  title: string;
  whyItMatters: string;
  category: TaskCategory;
  estimatedMinutes: number;
  dueDate: string; // YYYY-MM-DD
  scheduledBucket: "today" | "tomorrow" | "later";
  completed: boolean;
  completedAt: string | null;
  archived: boolean;
  linkedOpportunityId?: string;
  linkedContactId?: string;
}

export type PracticeMode =
  | "intro_45s"
  | "short_answer"
  | "interview_roleplay"
  | "discovery_call"
  | "objection_handling"
  | "salesforce_vocab"
  | "crm_simulation";

export interface PracticeFeedback {
  accuracy: string;
  relevance: string;
  clarity: string;
  specificExamples: string;
  concision: string;
  unsupportedClaims: string[];
  evidenceUsed: string[];
  missingInformation: string[];
  reasoning: string;
  suggestedNextAction: string;
  revisedExample?: string;
}

export interface PracticeSession {
  id: string;
  mode: PracticeMode;
  promptQuestion: string;
  noraResponse: string;
  feedback: PracticeFeedback;
  durationMinutes: number;
  createdAt: string;
  linkedOpportunityId?: string;
}

export interface LearningItem {
  id: string;
  title: string;
  tiedToRequirement: string;
  linkedOpportunityId?: string;
  status: "Planned" | "In progress" | "Completed";
  estimatedHours: number;
  practicalExercise: string;
  honestFramingNote: string;
}

export interface TimeLogEntry {
  id: string;
  date: string;
  activity:
    | "Opportunity research & verification"
    | "Application tailoring"
    | "Outreach & informational conversations"
    | "Interview & CRM practice"
    | "Skill building";
  minutes: number;
  note: string;
}

export type PrivateDocumentCategory =
  | "resume"
  | "job_description"
  | "supporting_document";

export interface PrivateDocumentMeta {
  id: string;
  userId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  docCategory: PrivateDocumentCategory;
  linkedOpportunityId: string;
  storageRef: string;
  sha256: string;
  createdAtIso: string;
}

export type PersistenceStatusKind = "idle" | "saving" | "saved" | "error";

export interface PersistenceIndicatorState {
  status: PersistenceStatusKind;
  lastSavedAt: string | null;
  lastActionLabel: string | null;
  errorMessage: string | null;
  pendingCount: number;
}

// Synthetic CRM Practice Simulation records (strictly isolated from real contacts)
export interface SyntheticCrmAccount {
  id: string;
  organizationName: string;
  sector: string;
  cityState: string;
  staffSizeRange: string;
  currentWorkflowSummary: string;
  syntheticContacts: Array<{
    id: string;
    name: string;
    title: string;
    phonePlaceholder: string;
    notes: string;
  }>;
}

export interface SyntheticCrmLog {
  id: string;
  accountId: string;
  contactName: string;
  summary: string;
  painPointsIdentified: string;
  currentToolsNoted: string;
  createdAt: string;
}

export interface SyntheticCrmTask {
  id: string;
  accountId: string;
  actionTitle: string;
  dueDate: string;
  purpose: string;
  completed: boolean;
}

export interface SyntheticCrmHandoff {
  id: string;
  accountId: string;
  qualifiedCriteriaMet: string;
  openUnknownsForAE: string;
  proposedMeetingAgenda: string;
  createdAt: string;
}

export interface WorkspaceSettings {
  availableMinutesToday: number;
  allowServerSideAi: boolean;
  showSampleComparisonData: boolean;
}

export type InvitationStatus =
  | "pending_delivery"
  | "sent"
  | "delivery_failed"
  | "expired"
  | "revoked"
  | "accepted";

export type InvitationDeliveryChannel =
  | "email_provider"
  | "unconfigured"
  | "manual_link";

export interface InvitationRecord {
  id: string;
  invitationType: "job_seeker";
  recipientDisplayName: string;
  recipientEmail: string;
  recipientEmailNormalized: string;
  maskedRecipientEmail: string;
  personalMessage: string;
  inviterUid: string;
  inviterDisplayName: string;
  status: InvitationStatus;
  effectiveStatus: InvitationStatus;
  deliveryChannel: InvitationDeliveryChannel;
  deliveryProviderResult: string;
  manualLinkGenerated: boolean;
  sendAttemptCount: number;
  suggestedItems: string[];
  createdAtIso: string;
  expiresAtIso: string;
  expiresAtEpochMs: number;
  acceptedAtIso: string;
  acceptedByUid: string;
  revokedAtIso: string;
}

export type AuditEventType =
  | "invitation_created"
  | "invitation_send_attempted"
  | "invitation_resent"
  | "invitation_manual_link_generated"
  | "invitation_revoked"
  | "invitation_accepted"
  | "workspace_created"
  | "sharing_permission_changed"
  | "account_deleted";

export interface AuditLogEntry {
  id: string;
  eventType: AuditEventType;
  actorUid: string;
  targetId: string;
  outcome: "success" | "failure" | "unconfigured";
  summaryCode: string;
  createdAtIso: string;
}

export interface InviterSuggestionItem {
  id: string;
  text: string;
  suppliedBy: string;
  decision: "pending" | "accepted" | "discarded";
}

export interface OnboardingWizardState {
  completed: boolean;
  pausedForLater: boolean;
  currentStep: 1 | 2 | 3 | 4 | 5 | 6;
  currentSituation: string;
  rolesOfInterest: string;
  rolesUnsure: boolean;
  workToAvoid: string;
  skillsToDevelop: string;
  experienceIntakeMode: "none" | "upload" | "paste" | "manual" | "skipped";
  pastedExperienceDraft: string;
  updatedAtIso: string;
}

export interface WorkspaceSharingSettings {
  mode: "private";
  reviewersEnabled: boolean;
  updatedAtIso: string;
}

export type GraphEntityType =
  | "experience"
  | "evidence"
  | "skill"
  | "requirement"
  | "opportunity"
  | "learning"
  | "contact"
  | "employer";

export type RelationshipType =
  | "demonstrates"
  | "supports"
  | "has_requirement"
  | "requires"
  | "teaches"
  | "claims_affiliation_with"
  | "confirmed_affiliation_with"
  | "offered_by"
  | "adjacent_to";

export type RelationshipStatus = "suggested" | "confirmed" | "rejected";

export type RelationshipOrigin =
  | "user"
  | "document_extraction"
  | "ai_suggestion";

export interface RelationshipEdge {
  id: string;
  userId: string;
  canonicalKey: string;
  sourceType: GraphEntityType;
  sourceId: string;
  sourceLabel: string;
  targetType: GraphEntityType;
  targetId: string;
  targetLabel: string;
  relationshipType: RelationshipType;
  requirementPriority: "Required" | "Preferred" | "N/A";
  evidenceIds: string[];
  rejectedEvidenceIds: string[];
  status: RelationshipStatus;
  origin: RelationshipOrigin;
  explanationNote: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export type AuthenticityDimension =
  | "employer_identity"
  | "opening_authenticity"
  | "recruiter_affiliation"
  | "sender_channel_authenticity"
  | "requested_action";

export type AuthenticityDimensionState =
  | "unchecked"
  | "corroborated"
  | "unconfirmed"
  | "concern_or_conflict"
  | "high_risk";

export type AuthenticityOverallStatus =
  | "not_reviewed"
  | "partially_corroborated"
  | "unresolved_concerns"
  | "high_risk_request_detected"
  | "corroborated_within_stated_scope"
  | "documented_impersonation_confirmation";

export type ReviewArtifactType =
  | "message"
  | "url"
  | "screenshot"
  | "document"
  | "user_note";

export interface ReviewArtifact {
  id: string;
  type: ReviewArtifactType;
  title: string;
  sourceProvenance: string;
  senderAddress: string;
  targetUrl: string;
  contentExcerpt: string;
  privateDocumentId: string;
  httpStatus: number | null;
  redactionConfirmed: boolean;
  dateSupplied: string;
}

export type VerificationCheckStatus =
  | "not_started"
  | "completed"
  | "inconclusive"
  | "unavailable";

export type VerificationCheckOutcome =
  | "not_evaluated"
  | "corroborated"
  | "conflict_or_missing"
  | "inconclusive";

export interface VerificationCheck {
  id: string;
  dimension: AuthenticityDimension;
  question: string;
  status: VerificationCheckStatus;
  outcome: VerificationCheckOutcome;
  method: string;
  evidenceArtifactIds: string[];
  notes: string;
  datePerformed: string;
}

export type RiskFindingSeverity =
  | "informational"
  | "caution"
  | "stop_and_verify";

export type RiskFindingBasis =
  | "deterministic_rule"
  | "ai_suggestion"
  | "user_report"
  | "independently_documented_confirmation";

export type RiskFindingResolution = "active" | "corrected" | "dismissed";

export interface RiskFinding {
  id: string;
  ruleKey: string;
  dimension: AuthenticityDimension;
  category: string;
  severity: RiskFindingSeverity;
  observedBehavior: string;
  interpretation: string;
  supportingArtifactId: string;
  supportingExcerpt: string;
  basis: RiskFindingBasis;
  recommendedAction: string;
  userResolution: RiskFindingResolution;
  userResolutionExplanation: string;
  resolvedAtIso: string;
}

export interface DimensionAssessmentSummary {
  dimension: AuthenticityDimension;
  label: string;
  state: AuthenticityDimensionState;
  summary: string;
}

export interface ImpersonationConfirmationEvidence {
  confirmedByIdentity: string;
  identityEstablishmentMethod: string;
  supportingArtifactId: string;
  confirmedAtIso: string;
}

export type AuthenticityUserDecision =
  | "undecided"
  | "proceed_within_scope"
  | "pause_until_verified"
  | "decline_and_disengage";

export interface AuthenticityReview {
  id: string;
  userId: string;
  opportunityId: string; // Empty string if standalone review started before opportunity entry
  subjectLabel: string;
  officialEmployerDomain: string;
  reviewScope: string;
  overallStatus: AuthenticityOverallStatus;
  dimensionAssessments: Record<AuthenticityDimension, DimensionAssessmentSummary>;
  impersonationConfirmation: ImpersonationConfirmationEvidence | null;
  userDecision: AuthenticityUserDecision;
  userDecisionNote: string;
  liveResearchStatus: "not_requested" | "available" | "unavailable";
  liveResearchSummary: string;
  whatWasChecked: string[];
  whatRemainsUnknown: string[];
  nextVerificationSteps: string[];
  artifacts: ReviewArtifact[];
  checks: VerificationCheck[];
  findings: RiskFinding[];
  createdAtIso: string;
  updatedAtIso: string;
}

export interface WorkspaceState {
  schemaVersion: number;
  profile: Profile;
  evidence: Evidence[];
  opportunities: Opportunity[];
  assessments: RequirementAssessment[];
  applicationVersions: ApplicationVersion[];
  contacts: Contact[];
  outreachDrafts: OutreachDraft[];
  tasks: Task[];
  practiceSessions: PracticeSession[];
  learningItems: LearningItem[];
  timeLogs: TimeLogEntry[];
  documents: PrivateDocumentMeta[];
  relationships?: RelationshipEdge[];
  authenticityReviews?: AuthenticityReview[];
  crmSimulation: {
    searchedQueries: string[];
    conversationLogs: SyntheticCrmLog[];
    followUpTasks: SyntheticCrmTask[];
    handoffNotes: SyntheticCrmHandoff[];
  };
  settings: WorkspaceSettings;
  onboardingWizard?: OnboardingWizardState;
  sharingSettings?: WorkspaceSharingSettings;
  inviterSuggestions?: InviterSuggestionItem[];
}


