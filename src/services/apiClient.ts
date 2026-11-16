import { auth } from "../firebase";
import {
  AuditEventType,
  AuditLogEntry,
  Evidence,
  InvitationRecord,
  LiveVerificationSource,
  Opportunity,
  PracticeFeedback,
  PracticeMode,
  Profile,
  ReviewArtifact,
  RiskFinding,
} from "../types/models";
import {
  ParsedJdResult,
  evaluatePracticeResponseLocally,
  parseJobDescriptionLocally,
} from "../utils/analysisEngine";

export interface ServerAiStatus {
  available: boolean;
  liveWebAvailable: boolean;
  backendAuthConfigured?: boolean;
  emailDeliveryConfigured?: boolean;
  emailProviderName?: string;
  message: string;
}

export interface AuthSessionInfo {
  authenticated: boolean;
  uid: string;
  isAdmin: boolean;
  emailDeliveryConfigured: boolean;
  emailProviderName: string;
  appOrigin: string;
  projectId: string;
  databaseId: string;
}

export interface AdminInvitationsResponse {
  invitations: InvitationRecord[];
  auditLogs: AuditLogEntry[];
  emailDeliveryConfigured: boolean;
  emailProviderName: string;
  appOrigin: string;
}

export interface CreateInvitationPayload {
  displayName: string;
  email: string;
  personalMessage: string;
  inviterDisplayName?: string;
  expirationDays: number;
  idempotencyKey: string;
  suggestedItems?: string[];
}

export interface CreateOrResendInvitationResponse {
  invitation: InvitationRecord;
  emailConfigured: boolean;
  deliveryOutcome: "accepted_by_provider" | "delivery_failed" | "unconfigured";
  providerDetailMessage: string;
  idempotentReplay?: boolean;
}

export interface ManualInviteLinkResponse {
  invitation: InvitationRecord;
  manualInviteUrl: string;
  emailSubject: string;
  emailBodyWithLink: string;
}

export type InspectInvitationState =
  | {
      state: "valid";
      invitationType: "job_seeker";
      inviterDisplayName: string;
      maskedRecipientEmail: string;
      expiresAtIso: string;
    }
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "revoked" }
  | { state: "accepted" }
  | { state: "service_error"; message: string };

export type VerifyInvitationSessionState =
  | {
      state: "ready_to_accept";
      inviterDisplayName: string;
      recipientEmail: string;
      expiresAtIso: string;
      existingWorkspace: boolean;
    }
  | {
      state: "wrong_email";
      signedInEmail: string;
      message: string;
    }
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "revoked" }
  | { state: "accepted" }
  | { state: "service_error"; message: string };

export interface AcceptInvitationResult {
  accepted: boolean;
  workspaceCreated: boolean;
  existingWorkspacePreserved: boolean;
  acceptedAtIso: string;
}

async function buildAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth?.currentUser) {
    const token = await auth.currentUser.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchServerAiStatus(): Promise<ServerAiStatus> {
  try {
    const res = await fetch("/api/ai/status");
    if (!res.ok) {
      return {
        available: false,
        liveWebAvailable: false,
        message: "Live verification unavailable — analyzing supplied material locally.",
      };
    }
    return await res.json();
  } catch {
    return {
      available: false,
      liveWebAvailable: false,
      message: "Live verification unavailable — analyzing supplied material locally.",
    };
  }
}

export async function fetchAuthSession(): Promise<AuthSessionInfo | null> {
  if (!auth?.currentUser) return null;
  try {
    const headers = await buildAuthHeaders();
    const res = await fetch("/api/auth/session", { headers });
    if (!res.ok) return null;
    return (await res.json()) as AuthSessionInfo;
  } catch {
    return null;
  }
}

export async function verifyBackendSessionAuth(): Promise<{
  unauthenticatedBlocked401: boolean;
  authenticatedAccepted200: boolean;
  verifiedUid: string | null;
}> {
  let unauthenticatedBlocked401 = false;
  try {
    const unauthRes = await fetch("/api/auth/session");
    unauthenticatedBlocked401 = unauthRes.status === 401;
  } catch {
    unauthenticatedBlocked401 = false;
  }

  let authenticatedAccepted200 = false;
  let verifiedUid: string | null = null;
  if (auth?.currentUser) {
    try {
      const headers = await buildAuthHeaders();
      const authRes = await fetch("/api/auth/session", { headers });
      if (authRes.ok) {
        const body = await authRes.json();
        authenticatedAccepted200 = Boolean(body?.authenticated);
        verifiedUid = body?.uid ?? null;
      }
    } catch {
      authenticatedAccepted200 = false;
    }
  }

  return {
    unauthenticatedBlocked401,
    authenticatedAccepted200,
    verifiedUid,
  };
}

// ============================================================================
// ADMIN INVITATION MANAGEMENT API CLIENT (/api/admin/*)
// ============================================================================

export async function fetchAdminInvitations(): Promise<AdminInvitationsResponse> {
  const headers = await buildAuthHeaders();
  const res = await fetch("/api/admin/invitations", { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data?.error || `Failed to load invitations (HTTP ${res.status}).`
    );
  }
  return data as AdminInvitationsResponse;
}

export async function createJobSeekerInvitation(
  payload: CreateInvitationPayload
): Promise<CreateOrResendInvitationResponse> {
  const headers = await buildAuthHeaders();
  const res = await fetch("/api/admin/invitations", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      data?.error || `Unable to create invitation (HTTP ${res.status}).`
    ) as Error & { field?: string; status?: number };
    err.field = data?.field;
    err.status = res.status;
    throw err;
  }
  return data as CreateOrResendInvitationResponse;
}

export async function resendJobSeekerInvitation(
  invitationId: string
): Promise<CreateOrResendInvitationResponse> {
  const headers = await buildAuthHeaders();
  const res = await fetch(
    `/api/admin/invitations/${encodeURIComponent(invitationId)}/resend`,
    {
      method: "POST",
      headers,
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data?.error || `Unable to resend invitation (HTTP ${res.status}).`
    );
  }
  return data as CreateOrResendInvitationResponse;
}

export async function generateManualInviteLink(
  invitationId: string
): Promise<ManualInviteLinkResponse> {
  const headers = await buildAuthHeaders();
  const res = await fetch(
    `/api/admin/invitations/${encodeURIComponent(invitationId)}/generate-manual-link`,
    {
      method: "POST",
      headers,
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data?.error || `Unable to generate manual link (HTTP ${res.status}).`
    );
  }
  return data as ManualInviteLinkResponse;
}

export async function revokeJobSeekerInvitation(
  invitationId: string
): Promise<{ invitation: InvitationRecord }> {
  const headers = await buildAuthHeaders();
  const res = await fetch(
    `/api/admin/invitations/${encodeURIComponent(invitationId)}/revoke`,
    {
      method: "POST",
      headers,
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data?.error || `Unable to revoke invitation (HTTP ${res.status}).`
    );
  }
  return data as { invitation: InvitationRecord };
}

// ============================================================================
// PUBLIC & INVITEE REDEMPTION API CLIENT (/api/invitations/*)
// ============================================================================

export async function inspectInvitationToken(
  token: string
): Promise<InspectInvitationState> {
  try {
    const res = await fetch("/api/invitations/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 || data?.state === "invalid") {
      return { state: "invalid" };
    }
    if (data?.state === "revoked") {
      return { state: "revoked" };
    }
    if (data?.state === "accepted") {
      return { state: "accepted" };
    }
    if (data?.state === "expired") {
      return { state: "expired" };
    }
    if (res.ok && data?.state === "valid") {
      return {
        state: "valid",
        invitationType: "job_seeker",
        inviterDisplayName: String(data.inviterDisplayName || "Administrator"),
        maskedRecipientEmail: String(data.maskedRecipientEmail || "***@***"),
        expiresAtIso: String(data.expiresAtIso || ""),
      };
    }
    return {
      state: "service_error",
      message:
        data?.message ||
        "Temporary service failure while checking this invitation. Please retry in a moment.",
    };
  } catch {
    return {
      state: "service_error",
      message:
        "Network error while contacting Career Launch. Please check your connection and retry.",
    };
  }
}

export async function verifyInvitationSession(
  token: string
): Promise<VerifyInvitationSessionState> {
  try {
    const headers = await buildAuthHeaders();
    const res = await fetch("/api/invitations/verify-session", {
      method: "POST",
      headers,
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 403 && data?.state === "wrong_email") {
      return {
        state: "wrong_email",
        signedInEmail: String(data.signedInEmail || ""),
        message:
          data.message ||
          "You’re signed in with a different email from this invitation.",
      };
    }
    if (res.status === 404 || data?.state === "invalid") {
      return { state: "invalid" };
    }
    if (data?.state === "revoked") {
      return { state: "revoked" };
    }
    if (data?.state === "accepted") {
      return { state: "accepted" };
    }
    if (data?.state === "expired") {
      return { state: "expired" };
    }
    if (res.ok && data?.state === "ready_to_accept") {
      return {
        state: "ready_to_accept",
        inviterDisplayName: String(data.inviterDisplayName || "Administrator"),
        recipientEmail: String(data.recipientEmail || ""),
        expiresAtIso: String(data.expiresAtIso || ""),
        existingWorkspace: Boolean(data.existingWorkspace),
      };
    }
    return {
      state: "service_error",
      message:
        data?.message ||
        data?.error ||
        "Temporary service failure verifying signed-in session.",
    };
  } catch {
    return {
      state: "service_error",
      message: "Network error verifying signed-in invitation session.",
    };
  }
}

export async function acceptInvitationToken(
  token: string
): Promise<AcceptInvitationResult> {
  const headers = await buildAuthHeaders();
  const res = await fetch("/api/invitations/accept", {
    method: "POST",
    headers,
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      data?.error || `Unable to accept invitation (HTTP ${res.status}).`
    ) as Error & { state?: string; status?: number };
    err.state = data?.state;
    err.status = res.status;
    throw err;
  }
  return data as AcceptInvitationResult;
}

export async function recordUserSecurityEvent(
  eventType: Extract<
    AuditEventType,
    "sharing_permission_changed" | "account_deleted"
  >,
  summaryCode: string
): Promise<void> {
  if (!auth?.currentUser) return;
  try {
    const headers = await buildAuthHeaders();
    await fetch("/api/audit/user-event", {
      method: "POST",
      headers,
      body: JSON.stringify({ eventType, summaryCode }),
    });
  } catch {
    // Non-blocking audit telemetry
  }
}

// ============================================================================
// EXISTING GEMINI ANALYSIS CLIENT FUNCTIONS
// ============================================================================

export async function verifyOpportunityLiveWeb(params: {
  employer: string;
  title: string;
  postingUrl: string;
  officialWebsite: string;
  allowServerSideAi: boolean;
}): Promise<{
  liveAvailable: boolean;
  retrievedAt: string;
  summary: string;
  sources: LiveVerificationSource[];
}> {
  if (!params.allowServerSideAi || !auth?.currentUser) {
    return {
      liveAvailable: false,
      retrievedAt: new Date().toISOString(),
      summary: !auth?.currentUser
        ? "Live verification unavailable in Demo Mode (requires authenticated workspace sign-in). Analyzing only supplied material."
        : "Live verification unavailable because server-side AI lookup is turned off in Data & Privacy settings. Analyzing only supplied material.",
      sources: [],
    };
  }

  try {
    const headers = await buildAuthHeaders();
    const res = await fetch("/api/ai/verify-opportunity", {
      method: "POST",
      headers,
      body: JSON.stringify({
        employer: params.employer,
        title: params.title,
        postingUrl: params.postingUrl,
        officialWebsite: params.officialWebsite,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.liveAvailable) {
      return {
        liveAvailable: false,
        retrievedAt: new Date().toISOString(),
        summary:
          data?.error ||
          data?.summary ||
          "Live verification unavailable. Analyzing only supplied material.",
        sources: [],
      };
    }
    return {
      liveAvailable: true,
      retrievedAt: data.retrievedAt || new Date().toISOString(),
      summary: data.summary || "Live search completed.",
      sources: Array.isArray(data.sources) ? data.sources : [],
    };
  } catch {
    return {
      liveAvailable: false,
      retrievedAt: new Date().toISOString(),
      summary:
        "Live verification unavailable due to network error. Analyzing only supplied material.",
      sources: [],
    };
  }
}

export async function analyzeJobDescriptionSmart(
  rawText: string,
  allowServerSideAi: boolean
): Promise<{ parsed: ParsedJdResult; usedServerAi: boolean; notice?: string }> {
  const localParsed = parseJobDescriptionLocally(rawText);

  if (!allowServerSideAi || !auth?.currentUser) {
    return {
      parsed: localParsed,
      usedServerAi: false,
      notice: !auth?.currentUser
        ? "Parsed locally in Demo Mode (sign in for server-side Gemini extraction)."
        : "Parsed locally in your browser (server-side AI disabled in settings).",
    };
  }

  try {
    const headers = await buildAuthHeaders();
    const res = await fetch("/api/ai/analyze-jd", {
      method: "POST",
      headers,
      body: JSON.stringify({ rawText }),
    });
    if (!res.ok) {
      return {
        parsed: localParsed,
        usedServerAi: false,
        notice: "Parsed using local structured extractor (server-side AI unavailable).",
      };
    }
    const data = await res.json();
    const workArr = ["remote", "hybrid", "onsite"].includes(data.workArrangement)
      ? data.workArrangement
      : localParsed.workArrangement;
    const empType = ["full_time", "part_time", "contract"].includes(data.employmentType)
      ? data.employmentType
      : localParsed.employmentType;

    return {
      parsed: {
        employer: data.employer || localParsed.employer,
        title: data.title || localParsed.title,
        location: data.location || localParsed.location,
        workArrangement: workArr,
        employmentType: empType,
        employerPublishedBasePay:
          data.employerPublishedBasePay || localParsed.employerPublishedBasePay,
        employerPublishedVariablePay:
          data.employerPublishedVariablePay ||
          localParsed.employerPublishedVariablePay,
        benefitsSummary: data.benefitsSummary || localParsed.benefitsSummary,
        requiredQualifications:
          Array.isArray(data.requiredQualifications) &&
          data.requiredQualifications.length > 0
            ? data.requiredQualifications
            : localParsed.requiredQualifications,
        preferredQualifications: Array.isArray(data.preferredQualifications)
          ? data.preferredQualifications
          : localParsed.preferredQualifications,
        coreDuties:
          Array.isArray(data.coreDuties) && data.coreDuties.length > 0
            ? data.coreDuties
            : localParsed.coreDuties,
      },
      usedServerAi: true,
    };
  } catch {
    return {
      parsed: localParsed,
      usedServerAi: false,
      notice: "Parsed locally in your browser.",
    };
  }
}

export async function requestTruthfulAiDraft(params: {
  draftType: string;
  opportunity?: Partial<Opportunity>;
  evidence: Evidence[];
  contact?: {
    id?: string;
    name: string;
    organization: string;
    role: string;
    relationship: string;
  };
  allowServerSideAi: boolean;
}): Promise<{
  draftText: string;
  evidenceUsed: string[];
  missingInformation: string[];
  reasoning: string;
  suggestedNextAction: string;
} | null> {
  if (!params.allowServerSideAi || !auth?.currentUser) return null;

  const allowedEvidence = params.evidence
    .filter(
      (e) =>
        e.mayUseInApplications &&
        e.category !== "not_yet_demonstrated" &&
        (e.verificationStatus === "Confirmed by Nora" ||
          e.verificationStatus === "Supported by uploaded document")
    )
    .map((e) => e.claimText);

  const developmentAreas = params.evidence
    .filter((e) => e.category === "not_yet_demonstrated")
    .map((e) => e.claimText);

  try {
    const headers = await buildAuthHeaders();
    const res = await fetch("/api/ai/draft-material", {
      method: "POST",
      headers,
      body: JSON.stringify({
        draftType: params.draftType,
        opportunity: params.opportunity
          ? {
              id: params.opportunity.id,
              employer: params.opportunity.employer,
              title: params.opportunity.title,
              requiredQualifications: params.opportunity.requiredQualifications,
              coreDuties: params.opportunity.coreDuties,
            }
          : undefined,
        allowedEvidence,
        developmentAreas,
        contact: params.contact,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.draftText) return null;
    return data;
  } catch {
    return null;
  }
}

export async function requestPracticeFeedbackSmart(params: {
  mode: PracticeMode;
  promptQuestion: string;
  userResponse: string;
  profile: Profile;
  evidence: Evidence[];
  allowServerSideAi: boolean;
}): Promise<{ feedback: PracticeFeedback; usedServerAi: boolean }> {
  const localFeedback = evaluatePracticeResponseLocally(
    params.mode,
    params.promptQuestion,
    params.userResponse,
    params.profile,
    params.evidence
  );

  if (!params.allowServerSideAi || !auth?.currentUser) {
    return { feedback: localFeedback, usedServerAi: false };
  }

  const allowedEvidence = params.evidence
    .filter((e) => e.mayUseInApplications && e.category !== "not_yet_demonstrated")
    .map((e) => e.claimText);
  const developmentAreas = params.evidence
    .filter((e) => e.category === "not_yet_demonstrated")
    .map((e) => e.claimText);

  try {
    const headers = await buildAuthHeaders();
    const res = await fetch("/api/ai/practice-feedback", {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: params.mode,
        promptQuestion: params.promptQuestion,
        userResponse: params.userResponse,
        allowedEvidence,
        developmentAreas,
      }),
    });
    if (!res.ok) return { feedback: localFeedback, usedServerAi: false };
    const data = await res.json();
    const combinedUnsupported = Array.from(
      new Set([
        ...(localFeedback.unsupportedClaims || []),
        ...(data.unsupportedClaims || []),
      ])
    );
    return {
      feedback: {
        accuracy: data.accuracy || localFeedback.accuracy,
        relevance: data.relevance || localFeedback.relevance,
        clarity: data.clarity || localFeedback.clarity,
        specificExamples: data.specificExamples || localFeedback.specificExamples,
        concision: data.concision || localFeedback.concision,
        unsupportedClaims: combinedUnsupported,
        evidenceUsed: Array.isArray(data.evidenceUsed)
          ? data.evidenceUsed
          : localFeedback.evidenceUsed,
        missingInformation: Array.isArray(data.missingInformation)
          ? data.missingInformation
          : localFeedback.missingInformation,
        reasoning: data.reasoning || localFeedback.reasoning,
        suggestedNextAction:
          data.suggestedNextAction || localFeedback.suggestedNextAction,
        revisedExample: data.revisedExample || localFeedback.revisedExample,
      },
      usedServerAi: true,
    };
  } catch {
    return { feedback: localFeedback, usedServerAi: false };
  }
}

export interface ControlledSafetyUrlResult {
  ok: boolean;
  finalUrl: string;
  httpStatus: number | null;
  contentType: string;
  extractedTitle: string;
  textExcerpt: string;
  missingOrExpired: boolean;
  redirectChainCount: number;
  errorCode?: string;
  errorMessage?: string;
}

export async function fetchControlledSafetyUrl(
  url: string
): Promise<ControlledSafetyUrlResult> {
  if (!auth?.currentUser) {
    return {
      ok: false,
      finalUrl: url,
      httpStatus: null,
      contentType: "",
      extractedTitle: "",
      textExcerpt: "",
      missingOrExpired: false,
      redirectChainCount: 0,
      errorCode: "UNAUTHENTICATED",
      errorMessage:
        "Controlled URL retrieval requires an authenticated workspace session. Paste the text excerpt manually instead.",
    };
  }

  try {
    const uid = auth.currentUser.uid;
    const headers = await buildAuthHeaders();
    const res = await fetch(
      `/api/workspace/${encodeURIComponent(uid)}/safety/fetch-url`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ url }),
      }
    );
    const data = await res.json();
    return {
      ok: Boolean(data.ok && res.ok),
      finalUrl: String(data.finalUrl || url),
      httpStatus: typeof data.httpStatus === "number" ? data.httpStatus : null,
      contentType: String(data.contentType || ""),
      extractedTitle: String(data.extractedTitle || ""),
      textExcerpt: String(data.textExcerpt || ""),
      missingOrExpired: Boolean(data.missingOrExpired),
      redirectChainCount: Number(data.redirectChainCount) || 0,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage || data.error,
    };
  } catch {
    return {
      ok: false,
      finalUrl: url,
      httpStatus: null,
      contentType: "",
      extractedTitle: "",
      textExcerpt: "",
      missingOrExpired: false,
      redirectChainCount: 0,
      errorCode: "NETWORK_ERROR",
      errorMessage: "Unable to contact controlled URL retrieval service.",
    };
  }
}

export interface AssistedSafetyAnalysisResponse {
  deterministicFindings: RiskFinding[];
  aiSuggestedFindings: RiskFinding[];
  rejectedAiSuggestionCount: number;
  liveResearchStatus: "not_requested" | "available" | "unavailable";
  liveResearchSummary: string;
}

export async function requestAssistedSafetyAnalysis(params: {
  opportunityId: string;
  subjectLabel: string;
  officialEmployerDomain: string;
  artifacts: ReviewArtifact[];
  allowServerSideAi: boolean;
}): Promise<AssistedSafetyAnalysisResponse | null> {
  if (!auth?.currentUser) {
    return null;
  }

  try {
    const uid = auth.currentUser.uid;
    const headers = await buildAuthHeaders();
    const res = await fetch(
      `/api/workspace/${encodeURIComponent(uid)}/safety/analyze`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          userId: uid,
          opportunityId: params.opportunityId,
          subjectLabel: params.subjectLabel,
          officialEmployerDomain: params.officialEmployerDomain,
          artifacts: params.artifacts,
          allowServerSideAi: params.allowServerSideAi,
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      deterministicFindings: Array.isArray(data.deterministicFindings)
        ? data.deterministicFindings
        : [],
      aiSuggestedFindings: Array.isArray(data.aiSuggestedFindings)
        ? data.aiSuggestedFindings
        : [],
      rejectedAiSuggestionCount: Number(data.rejectedAiSuggestionCount) || 0,
      liveResearchStatus:
        data.liveResearchStatus === "available" ||
        data.liveResearchStatus === "not_requested"
          ? data.liveResearchStatus
          : "unavailable",
      liveResearchSummary: String(
        data.liveResearchSummary || "Live verification unavailable"
      ),
    };
  } catch {
    return null;
  }
}

