import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckSquare,
  FileText,
  Globe,
  Link2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import {
  AuthenticityDimension,
  AuthenticityReview,
  AuthenticityUserDecision,
  ImpersonationConfirmationEvidence,
  Opportunity,
  PrivateDocumentCategory,
  PrivateDocumentMeta,
  ReviewArtifact,
  ReviewArtifactType,
  RiskFinding,
  RiskFindingResolution,
  VerificationCheck,
  VerificationCheckOutcome,
  VerificationCheckStatus,
} from "../types/models";
import {
  DIMENSION_LABELS,
  DIMENSION_STATE_LABELS,
  OVERALL_STATUS_LABELS,
  USER_DECISION_LABELS,
  createInitialAuthenticityReview,
  detectUnredactedSensitivePatterns,
  extractRegistrableDomain,
  isValidImpersonationConfirmation,
  recheckAuthenticityReview,
  resolveFindingWithExplanation,
} from "../utils/authenticityReviewEngine";
import {
  fetchControlledSafetyUrl,
  requestAssistedSafetyAnalysis,
} from "../services/apiClient";
import { getTodayIsoDate } from "../data/initialData";

interface AuthenticitySafetyReviewPanelProps {
  activeUserId: string;
  mode: "opportunity" | "standalone";
  opportunity?: Opportunity | null;
  allOpportunities: Opportunity[];
  reviews: AuthenticityReview[];
  documents: PrivateDocumentMeta[];
  allowServerSideAi: boolean;
  isDemoMode: boolean;
  readOnly?: boolean;
  onSaveReview: (review: AuthenticityReview) => Promise<{ ok: boolean; error?: string }>;
  onDeleteReview: (reviewId: string) => Promise<boolean>;
  onUploadPrivateFile: (
    file: File,
    docCategory: PrivateDocumentCategory,
    linkedOpportunityId?: string
  ) => Promise<{ meta: PrivateDocumentMeta; extractedTextIfPlain: string | null } | null>;
}

const ORDERED_DIMENSIONS: AuthenticityDimension[] = [
  "employer_identity",
  "opening_authenticity",
  "recruiter_affiliation",
  "sender_channel_authenticity",
  "requested_action",
];

function formatBasisLabel(basis: RiskFinding["basis"]): string {
  switch (basis) {
    case "deterministic_rule":
      return "Deterministic pattern check";
    case "ai_suggestion":
      return "AI suggestion — verify independently";
    case "user_report":
      return "Recorded by you";
    case "independently_documented_confirmation":
      return "Independently documented confirmation";
  }
}

function formatSeverityLabel(severity: RiskFinding["severity"]): string {
  switch (severity) {
    case "stop_and_verify":
      return "Stop & verify";
    case "caution":
      return "Caution";
    case "informational":
      return "Informational";
  }
}

function getOverallStatusSurfaceClasses(status: AuthenticityReview["overallStatus"]): string {
  switch (status) {
    case "high_risk_request_detected":
    case "documented_impersonation_confirmation":
      return "bg-red-50/80 border-red-300 text-red-950";
    case "unresolved_concerns":
      return "bg-amber-50/80 border-amber-300 text-amber-950";
    case "corroborated_within_stated_scope":
      return "bg-emerald-50/80 border-emerald-300 text-emerald-950";
    case "partially_corroborated":
      return "bg-teal-50/70 border-teal-300 text-teal-950";
    case "not_reviewed":
    default:
      return "bg-slate-50 border-slate-300 text-slate-900";
  }
}

function getDimensionSurfaceClasses(
  state: AuthenticityReview["dimensionAssessments"][AuthenticityDimension]["state"]
): string {
  switch (state) {
    case "high_risk":
      return "border-red-300 bg-red-50/60 text-red-950";
    case "concern_or_conflict":
      return "border-amber-300 bg-amber-50/60 text-amber-950";
    case "corroborated":
      return "border-emerald-300 bg-emerald-50/60 text-emerald-950";
    case "unconfirmed":
      return "border-slate-300 bg-slate-50 text-slate-900";
    case "unchecked":
    default:
      return "border-slate-200 bg-white text-slate-700";
  }
}

export const AuthenticitySafetyReviewPanel: React.FC<
  AuthenticitySafetyReviewPanelProps
> = ({
  activeUserId,
  mode,
  opportunity,
  allOpportunities,
  reviews,
  documents,
  allowServerSideAi,
  isDemoMode,
  readOnly = false,
  onSaveReview,
  onDeleteReview,
  onUploadPrivateFile,
}) => {
  const realOpportunities = useMemo(
    () => allOpportunities.filter((o) => !o.isSampleRecord && !o.archived),
    [allOpportunities]
  );

  // Reviews relevant to current mode
  const matchingReviews = useMemo(() => {
    if (mode === "opportunity" && opportunity) {
      return reviews.filter((r) => r.opportunityId === opportunity.id);
    }
    return reviews;
  }, [mode, opportunity, reviews]);

  const [selectedStandaloneId, setSelectedStandaloneId] = useState<string | null>(null);
  const activeReview: AuthenticityReview | null = useMemo(() => {
    if (mode === "opportunity") {
      return matchingReviews[0] ?? null;
    }
    if (selectedStandaloneId) {
      const found = matchingReviews.find((r) => r.id === selectedStandaloneId);
      if (found) return found;
    }
    return matchingReviews[0] ?? null;
  }, [mode, matchingReviews, selectedStandaloneId]);

  // Standalone new review starter inputs
  const [newSubjectLabel, setNewSubjectLabel] = useState("");
  const [newOfficialDomain, setNewOfficialDomain] = useState("");

  // Add Artifact form state
  const [artifactType, setArtifactType] = useState<ReviewArtifactType>("message");
  const [artifactTitle, setArtifactTitle] = useState("");
  const [artifactProvenance, setArtifactProvenance] = useState("");
  const [artifactSender, setArtifactSender] = useState("");
  const [artifactUrl, setArtifactUrl] = useState("");
  const [artifactExcerpt, setArtifactExcerpt] = useState("");
  const [artifactPrivateDocId, setArtifactPrivateDocId] = useState("");
  const [artifactHttpStatus, setArtifactHttpStatus] = useState<number | null>(null);
  const [redactionConfirmed, setRedactionConfirmed] = useState(false);

  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [urlFetchFeedback, setUrlFetchFeedback] = useState<string | null>(null);
  const [isRechecking, setIsRechecking] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);

  // Inline resolution draft per finding ID
  const [findingResolutionDrafts, setFindingResolutionDrafts] = useState<
    Record<string, { mode: RiskFindingResolution; explanation: string }>
  >({});

  // Optional impersonation confirmation editor
  const [showImpersonationForm, setShowImpersonationForm] = useState(false);
  const [impConfirmedBy, setImpConfirmedBy] = useState("");
  const [impMethod, setImpMethod] = useState("");
  const [impArtifactId, setImpArtifactId] = useState("");

  const redactionWarnings = useMemo(
    () =>
      detectUnredactedSensitivePatterns(
        `${artifactSender}\n${artifactExcerpt}\n${artifactProvenance}`
      ),
    [artifactSender, artifactExcerpt, artifactProvenance]
  );

  const handleStartReview = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (readOnly) return;
    setErrorFeedback(null);
    setStatusFeedback(null);

    const created = createInitialAuthenticityReview({
      userId: activeUserId,
      opportunity: mode === "opportunity" ? opportunity : null,
      subjectLabel:
        mode === "standalone"
          ? newSubjectLabel.trim() || "Pre-Opportunity Recruiting / Posting Review"
          : undefined,
      officialEmployerDomain:
        mode === "standalone" ? newOfficialDomain.trim() : undefined,
    });

    const saved = await onSaveReview(created);
    if (!saved.ok) {
      setErrorFeedback(saved.error || "Unable to start Authenticity & Safety Review.");
      return;
    }

    if (mode === "standalone") {
      setSelectedStandaloneId(created.id);
      setNewSubjectLabel("");
      setNewOfficialDomain("");
    }
    setStatusFeedback(
      "Started Authenticity & Safety Review. Add the message, URL, sender address, or document you want to inspect."
    );
  };

  const handleSafeFetchUrl = async () => {
    const trimmed = artifactUrl.trim();
    if (!trimmed) return;
    setIsFetchingUrl(true);
    setUrlFetchFeedback(null);
    setErrorFeedback(null);

    const res = await fetchControlledSafetyUrl(trimmed);
    setIsFetchingUrl(false);

    if (!res.ok) {
      setUrlFetchFeedback(
        res.errorMessage ||
          "Could not retrieve URL automatically. You can still paste visible text manually below."
      );
      return;
    }

    setArtifactUrl(res.finalUrl);
    setArtifactHttpStatus(res.httpStatus);
    if (res.extractedTitle && !artifactTitle.trim()) {
      setArtifactTitle(res.extractedTitle);
    }
    if (!artifactProvenance.trim()) {
      setArtifactProvenance(
        `Controlled public text fetch (HTTP ${res.httpStatus ?? 200}, ${
          res.redirectChainCount
        } redirect(s), no cookies/scripts)`
      );
    }
    if (res.textExcerpt) {
      setArtifactExcerpt(res.textExcerpt);
    }
    setUrlFetchFeedback(
      res.missingOrExpired
        ? `Retrieved HTTP ${res.httpStatus ?? 200} — page appears missing, closed, or expired. Click "Add Artifact & Evaluate" to record this check.`
        : `Retrieved plain-text snippet (HTTP ${res.httpStatus ?? 200}) without cookies or script execution. Confirm redaction and add artifact below.`
    );
  };

  const handleSupportingFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !activeReview) return;
    setErrorFeedback(null);

    if (isDemoMode) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (ext === "txt" || ext === "md") {
        const text = await file.text();
        setArtifactTitle(file.name);
        setArtifactProvenance("Local text file (Demo Mode — not stored on server)");
        setArtifactExcerpt(text.slice(0, 3500));
      } else {
        setArtifactTitle(file.name);
        setArtifactProvenance(
          "Attachment metadata only (files are never auto-opened or executed)"
        );
      }
      e.target.value = "";
      return;
    }

    const uploaded = await onUploadPrivateFile(
      file,
      "supporting_document",
      activeReview.opportunityId || undefined
    );
    e.target.value = "";
    if (!uploaded) return;

    setArtifactPrivateDocId(uploaded.meta.id);
    if (!artifactTitle.trim()) {
      setArtifactTitle(uploaded.meta.fileName);
    }
    setArtifactProvenance(
      `Stored privately in workspace (${Math.max(
        1,
        Math.round(uploaded.meta.byteSize / 1024)
      )} KB; no public URL; never auto-executed)`
    );
    if (uploaded.extractedTextIfPlain && !artifactExcerpt.trim()) {
      setArtifactExcerpt(uploaded.extractedTextIfPlain.slice(0, 3500));
    }
  };

  const handleAddArtifact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReview || readOnly) return;
    setErrorFeedback(null);
    setStatusFeedback(null);

    if (
      !artifactExcerpt.trim() &&
      !artifactUrl.trim() &&
      !artifactSender.trim() &&
      !artifactPrivateDocId.trim()
    ) {
      setErrorFeedback(
        "Supply at least a message excerpt, URL, sender address, or private supporting document."
      );
      return;
    }

    if (!redactionConfirmed) {
      setErrorFeedback(
        "Confirm that you redacted any passwords, verification codes, banking numbers, or full ID numbers before saving."
      );
      return;
    }

    const newArtifact: ReviewArtifact = {
      id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: artifactType,
      title:
        artifactTitle.trim() ||
        (artifactType === "message"
          ? "Recruiter / Outreach Message"
          : artifactType === "url"
          ? "Supplied Posting or Portal URL"
          : artifactType === "document"
          ? "Supporting Document"
          : artifactType === "screenshot"
          ? "Screenshot Note / Reference"
          : "User Verification Note"),
      sourceProvenance:
        artifactProvenance.trim() || "Supplied manually by workspace owner",
      senderAddress: artifactSender.trim(),
      targetUrl: artifactUrl.trim(),
      contentExcerpt: artifactExcerpt.trim().slice(0, 4000),
      privateDocumentId: artifactPrivateDocId.trim(),
      httpStatus: artifactHttpStatus,
      redactionConfirmed: true,
      dateSupplied: getTodayIsoDate(),
    };

    const updatedArtifacts = [...activeReview.artifacts, newArtifact].slice(-25);
    const rechecked = recheckAuthenticityReview({
      ...activeReview,
      artifacts: updatedArtifacts,
    });

    const saved = await onSaveReview(rechecked);
    if (!saved.ok) {
      setErrorFeedback(saved.error || "Failed to save artifact.");
      return;
    }

    setArtifactTitle("");
    setArtifactProvenance("");
    setArtifactSender("");
    setArtifactUrl("");
    setArtifactExcerpt("");
    setArtifactPrivateDocId("");
    setArtifactHttpStatus(null);
    setRedactionConfirmed(false);
    setUrlFetchFeedback(null);
    setStatusFeedback(
      "Added artifact and updated deterministic checks across the five dimensions."
    );
  };

  const handleRemoveArtifact = async (artifactId: string) => {
    if (!activeReview || readOnly) return;
    const remainingArtifacts = activeReview.artifacts.filter(
      (a) => a.id !== artifactId
    );
    const remainingFindings = activeReview.findings.filter(
      (f) => f.supportingArtifactId !== artifactId
    );
    const nextImpersonation =
      activeReview.impersonationConfirmation?.supportingArtifactId === artifactId
        ? null
        : activeReview.impersonationConfirmation;

    const rechecked = recheckAuthenticityReview({
      ...activeReview,
      artifacts: remainingArtifacts,
      findings: remainingFindings,
      impersonationConfirmation: nextImpersonation,
    });
    await onSaveReview(rechecked);
  };

  const handleRecheckReview = async () => {
    if (!activeReview || readOnly) return;
    setIsRechecking(true);
    setErrorFeedback(null);
    setStatusFeedback(null);

    const assisted = !isDemoMode
      ? await requestAssistedSafetyAnalysis({
          opportunityId: activeReview.opportunityId,
          subjectLabel: activeReview.subjectLabel,
          officialEmployerDomain: activeReview.officialEmployerDomain,
          artifacts: activeReview.artifacts,
          allowServerSideAi,
        })
      : null;

    const rechecked = recheckAuthenticityReview(activeReview, {
      aiCandidateFindings: assisted ? assisted.aiSuggestedFindings : undefined,
      liveResearchStatus: assisted ? assisted.liveResearchStatus : "unavailable",
      liveResearchSummary: assisted
        ? assisted.liveResearchSummary
        : "Live verification unavailable",
    });

    const saved = await onSaveReview(rechecked);
    setIsRechecking(false);

    if (!saved.ok) {
      setErrorFeedback(saved.error || "Unable to save rechecked review.");
      return;
    }

    setStatusFeedback(
      assisted && allowServerSideAi
        ? `Rechecked ${activeReview.artifacts.length} artifact(s) and ${activeReview.checks.length} checklist items. Prior finding dismissals and manual check notes were preserved.`
        : "Rechecked supplied artifacts and manual verification checklist locally. Live verification unavailable."
    );
  };

  const handleUpdateCheck = async (
    checkId: string,
    patch: Partial<VerificationCheck>
  ) => {
    if (!activeReview || readOnly) return;
    const nextChecks = activeReview.checks.map((chk) => {
      if (chk.id !== checkId) return chk;
      const merged = { ...chk, ...patch };
      if (merged.status === "completed" && merged.outcome === "not_evaluated") {
        merged.outcome = "corroborated";
      }
      if (merged.status !== "not_started" && !merged.datePerformed) {
        merged.datePerformed = getTodayIsoDate();
      }
      return merged;
    });

    const rechecked = recheckAuthenticityReview({
      ...activeReview,
      checks: nextChecks,
    });
    await onSaveReview(rechecked);
  };

  const handleApplyFindingResolution = async (findingId: string) => {
    if (!activeReview || readOnly) return;
    const draft = findingResolutionDrafts[findingId];
    if (!draft) return;

    const result = resolveFindingWithExplanation(
      activeReview,
      findingId,
      draft.mode,
      draft.explanation
    );
    if (!result.ok || !result.updatedReview) {
      setErrorFeedback(result.error || "Provide a brief explanation.");
      return;
    }
    setErrorFeedback(null);
    await onSaveReview(result.updatedReview);
    setFindingResolutionDrafts((prev) => {
      const next = { ...prev };
      delete next[findingId];
      return next;
    });
  };

  const handleRestoreFindingActive = async (findingId: string) => {
    if (!activeReview || readOnly) return;
    const result = resolveFindingWithExplanation(
      activeReview,
      findingId,
      "active",
      ""
    );
    if (result.ok && result.updatedReview) {
      await onSaveReview(result.updatedReview);
    }
  };

  const handleSaveImpersonationConfirmation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReview || readOnly) return;
    const candidate: ImpersonationConfirmationEvidence = {
      confirmedByIdentity: impConfirmedBy.trim(),
      identityEstablishmentMethod: impMethod.trim(),
      supportingArtifactId: impArtifactId.trim(),
      confirmedAtIso: new Date().toISOString(),
    };
    if (!isValidImpersonationConfirmation(candidate, activeReview.artifacts)) {
      setErrorFeedback(
        "Documented impersonation confirmation requires: (1) who confirmed it, (2) how you established their identity, and (3) a linked supporting artifact in this review."
      );
      return;
    }

    const docFinding: RiskFinding = {
      id: `fnd-doc-imp-${candidate.supportingArtifactId}`.slice(0, 100),
      ruleKey: "documented_impersonation_confirmation",
      dimension: "recruiter_affiliation",
      category: "Documented impersonation confirmation",
      severity: "caution",
      observedBehavior: `Confirmed by ${candidate.confirmedByIdentity} (identity established via: ${candidate.identityEstablishmentMethod}).`,
      interpretation:
        "An independently verified representative of the named organization documented that this outreach or posting was unauthorized.",
      supportingArtifactId: candidate.supportingArtifactId,
      supportingExcerpt: `Confirmed by ${candidate.confirmedByIdentity}`,
      basis: "independently_documented_confirmation",
      recommendedAction:
        "Cease communication with the impersonated channel and communicate only through verified official employer channels if applicable.",
      userResolution: "active",
      userResolutionExplanation: "",
      resolvedAtIso: "",
    };

    const rechecked = recheckAuthenticityReview({
      ...activeReview,
      impersonationConfirmation: candidate,
      findings: [
        ...activeReview.findings.filter(
          (f) => f.ruleKey !== "documented_impersonation_confirmation"
        ),
        docFinding,
      ],
    });
    const saved = await onSaveReview(rechecked);
    if (saved.ok) {
      setShowImpersonationForm(false);
      setErrorFeedback(null);
      setStatusFeedback("Recorded documented impersonation confirmation.");
    }
  };

  const handleClearImpersonationConfirmation = async () => {
    if (!activeReview || readOnly) return;
    const rechecked = recheckAuthenticityReview({
      ...activeReview,
      impersonationConfirmation: null,
      findings: activeReview.findings.filter(
        (f) => f.ruleKey !== "documented_impersonation_confirmation"
      ),
    });
    await onSaveReview(rechecked);
  };

  const handleUpdateHeaderMeta = async (patch: {
    officialEmployerDomain?: string;
    reviewScope?: string;
    opportunityId?: string;
    userDecision?: AuthenticityUserDecision;
    userDecisionNote?: string;
  }) => {
    if (!activeReview || readOnly) return;
    const merged: AuthenticityReview = {
      ...activeReview,
      ...patch,
      officialEmployerDomain:
        patch.officialEmployerDomain !== undefined
          ? extractRegistrableDomain(patch.officialEmployerDomain) ||
            patch.officialEmployerDomain.trim()
          : activeReview.officialEmployerDomain,
    };
    const rechecked = recheckAuthenticityReview(merged);
    await onSaveReview(rechecked);
  };

  // ==========================================================================
  // EMPTY STATE (START REVIEW)
  // ==========================================================================
  if (!activeReview) {
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-slate-900">
            Authenticity & Safety Review
          </h2>
          <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
            Evaluate job postings, recruiter messages, sender addresses, and requested next steps across five separate dimensions. Career Launch never certifies an employer or person as safe, never generates fake fraud-probability scores, and never sends external reports automatically.
          </p>
        </div>

        {mode === "standalone" ? (
          <form
            onSubmit={handleStartReview}
            className="p-4 border border-slate-200 rounded-lg bg-slate-50/70 space-y-4 max-w-2xl"
          >
            <div className="text-xs font-semibold text-slate-800">
              Start a Review Before Entering a Full Opportunity
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  What are you reviewing? (employer, role, or sender)
                </label>
                <input
                  type="text"
                  value={newSubjectLabel}
                  onChange={(e) => setNewSubjectLabel(e.target.value)}
                  placeholder="e.g., Unsolicited LinkedIn message re: Intake Coordinator"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Known official employer domain (optional)
                </label>
                <input
                  type="text"
                  value={newOfficialDomain}
                  onChange={(e) => setNewOfficialDomain(e.target.value)}
                  placeholder="e.g., rethinkbh.com"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white font-mono"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={readOnly}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Start Authenticity & Safety Review</span>
            </button>
          </form>
        ) : (
          <div className="p-5 border border-slate-200 rounded-lg bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-900">
                No Authenticity & Safety Review started for this opportunity yet
              </div>
              <p className="text-xs text-slate-600 max-w-xl">
                Starting a review imports the current posting link/description into an editable checklist and checks employer identity, opening authenticity, recruiter affiliation, sender channel, and requested actions separately.
              </p>
            </div>
            {readOnly ? (
              <span className="text-xs font-medium text-slate-500">
                Sample benchmark record (read-only)
              </span>
            ) : (
              <button
                type="button"
                onClick={() => handleStartReview()}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0 self-start"
              >
                <ShieldAlert className="w-4 h-4" />
                <span>Start Review</span>
              </button>
            )}
          </div>
        )}

        {errorFeedback && (
          <div
            role="alert"
            className="p-3 border border-red-200 bg-red-50 text-xs text-red-900 rounded-lg"
          >
            {errorFeedback}
          </div>
        )}
      </section>
    );
  }

  const activeFindings = activeReview.findings.filter(
    (f) => f.userResolution === "active"
  );
  const resolvedFindings = activeReview.findings.filter(
    (f) => f.userResolution !== "active"
  );

  return (
    <div className="space-y-6">
      {/* STANDALONE SELECTOR + NEW REVIEW BAR */}
      {mode === "standalone" && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Pre-Opportunity & Standalone Safety Reviews ({matchingReviews.length})
              </h2>
              <p className="text-xs text-slate-600">
                Inspect an outreach message, recruiter email, or link before deciding whether to enter it as a full opportunity.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={activeReview.id}
                onChange={(e) => setSelectedStandaloneId(e.target.value)}
                aria-label="Select Authenticity Review"
                className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                {matchingReviews.map((rev) => (
                  <option key={rev.id} value={rev.id}>
                    {rev.subjectLabel} — {OVERALL_STATUS_LABELS[rev.overallStatus]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <form
            onSubmit={handleStartReview}
            className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-end gap-2.5"
          >
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Start another standalone review
              </label>
              <input
                type="text"
                value={newSubjectLabel}
                onChange={(e) => setNewSubjectLabel(e.target.value)}
                placeholder="Label (e.g., Recruiter email from Sarah regarding Coordinator role)"
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
            </div>
            <div className="sm:w-56">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Official domain (optional)
              </label>
              <input
                type="text"
                value={newOfficialDomain}
                onChange={(e) => setNewOfficialDomain(e.target.value)}
                placeholder="employer.com"
                className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              New Review
            </button>
          </form>
        </section>
      )}

      {/* 1. OVERALL STATUS, LIVE VERIFICATION DISCLOSURE & 5 INDEPENDENT DIMENSIONS */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-900">
                Authenticity & Safety Review
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                Updated {new Date(activeReview.updatedAtIso).toLocaleString()}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {activeReview.liveResearchStatus === "available"
                  ? "Live research available"
                  : "Live verification unavailable"}
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900">
              {activeReview.subjectLabel}
            </h3>
            <p className="text-xs text-slate-600 max-w-3xl">
              Scope: {activeReview.reviewScope}. Confirming one dimension below never automatically confirms the other four, and findings are never published externally.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div
              className={`px-3 py-1.5 text-xs font-semibold border rounded-md ${getOverallStatusSurfaceClasses(
                activeReview.overallStatus
              )}`}
            >
              Status: {OVERALL_STATUS_LABELS[activeReview.overallStatus]}
            </div>
            {!readOnly && (
              <button
                type="button"
                disabled={isRechecking}
                onClick={handleRecheckReview}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isRechecking ? "animate-spin" : ""}`}
                />
                <span>{isRechecking ? "Rechecking..." : "Recheck Review"}</span>
              </button>
            )}
          </div>
        </div>

        {(statusFeedback || errorFeedback) && (
          <div
            role="status"
            className={`p-3 rounded-lg border text-xs ${
              errorFeedback
                ? "bg-red-50 border-red-200 text-red-900"
                : "bg-slate-50 border-slate-200 text-slate-800"
            }`}
          >
            {errorFeedback || statusFeedback}
          </div>
        )}

        {/* Editable Official Domain & Optional Opportunity Link */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Stated official employer domain (used for sender comparison)
            </label>
            <input
              type="text"
              disabled={readOnly}
              defaultValue={activeReview.officialEmployerDomain}
              onBlur={(e) => {
                if (e.target.value.trim() !== activeReview.officialEmployerDomain) {
                  handleUpdateHeaderMeta({
                    officialEmployerDomain: e.target.value.trim(),
                  });
                }
              }}
              placeholder="e.g., rethinkbh.com"
              className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Review scope note
            </label>
            <input
              type="text"
              disabled={readOnly}
              defaultValue={activeReview.reviewScope}
              onBlur={(e) => {
                if (
                  e.target.value.trim() &&
                  e.target.value.trim() !== activeReview.reviewScope
                ) {
                  handleUpdateHeaderMeta({ reviewScope: e.target.value.trim() });
                }
              }}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Linked workspace opportunity (optional)
            </label>
            <select
              disabled={readOnly || mode === "opportunity"}
              value={activeReview.opportunityId}
              onChange={(e) =>
                handleUpdateHeaderMeta({ opportunityId: e.target.value })
              }
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="">Not linked yet (standalone pre-entry review)</option>
              {realOpportunities.map((opp) => (
                <option key={opp.id} value={opp.id}>
                  {opp.employer} — {opp.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Five Separate Assessment Dimensions Grid */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-900">
            Five Independent Assessment Dimensions
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {ORDERED_DIMENSIONS.map((dim) => {
              const summary = activeReview.dimensionAssessments[dim];
              return (
                <div
                  key={dim}
                  className={`p-3 rounded-lg border flex flex-col justify-between gap-2 ${getDimensionSurfaceClasses(
                    summary.state
                  )}`}
                >
                  <div>
                    <div className="text-xs font-semibold leading-snug">
                      {DIMENSION_LABELS[dim]}
                    </div>
                    <div className="mt-1 text-[11px] font-mono uppercase tracking-wide opacity-90">
                      {DIMENSION_STATE_LABELS[summary.state]}
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed opacity-90">
                    {summary.summary}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 2. ADD ARTIFACT (MESSAGE, URL, SENDER ADDRESS, DOCUMENT, OR NOTE) */}
      {!readOnly && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-slate-900">
              Add Evidence Artifact to Inspect
            </h3>
            <p className="text-xs text-slate-600">
              Add recruiter messages, sender addresses, posting URLs, or supporting documents. Attachments are stored privately and are never auto-opened or executed.
            </p>
          </div>

          {/* Mandatory Redaction & Credential Safety Prompt */}
          <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/70 text-xs text-amber-950 space-y-1">
            <div className="font-semibold">
              Redact sensitive information before pasting or uploading
            </div>
            <p className="text-amber-900 leading-relaxed">
              Remove any bank routing/account numbers, Social Security Numbers, government ID numbers, passwords, or one-time verification codes before saving. Career Launch will never ask you for passwords, banking credentials, authentication codes, or full identity documents.
            </p>
          </div>

          <form onSubmit={handleAddArtifact} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Artifact type
                </label>
                <select
                  value={artifactType}
                  onChange={(e) =>
                    setArtifactType(e.target.value as ReviewArtifactType)
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="message">Recruiter / Sender Message</option>
                  <option value="url">Posting or Application URL</option>
                  <option value="document">Supporting Document</option>
                  <option value="screenshot">Screenshot Note / Upload</option>
                  <option value="user_note">Observation / Call Note</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Short label
                </label>
                <input
                  type="text"
                  value={artifactTitle}
                  onChange={(e) => setArtifactTitle(e.target.value)}
                  placeholder="e.g., Initial outreach email from recruiter"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Source / provenance
                </label>
                <input
                  type="text"
                  value={artifactProvenance}
                  onChange={(e) => setArtifactProvenance(e.target.value)}
                  placeholder="e.g., Received via email / LinkedIn InMail / Employer site"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Exact sender email address or handle (if applicable)
                </label>
                <input
                  type="text"
                  value={artifactSender}
                  onChange={(e) => setArtifactSender(e.target.value)}
                  placeholder="e.g., hiring-team@example.com"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Posting or destination URL (optional)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={artifactUrl}
                    onChange={(e) => setArtifactUrl(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                  />
                  <button
                    type="button"
                    disabled={isFetchingUrl || !artifactUrl.trim()}
                    onClick={handleSafeFetchUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>
                      {isFetchingUrl ? "Fetching..." : "Fetch Public Text"}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {urlFetchFeedback && (
              <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700">
                {urlFetchFeedback}
              </div>
            )}

            {(artifactType === "document" || artifactType === "screenshot") && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Attach Redacted Private File (max 500 KB)</span>
                  <input
                    type="file"
                    accept=".txt,.md,.pdf,.png,.jpg,.jpeg"
                    onChange={handleSupportingFileUpload}
                    className="sr-only"
                  />
                </label>
                {artifactPrivateDocId && (
                  <span className="text-xs font-mono text-emerald-800">
                    Linked private storage ID: {artifactPrivateDocId}
                  </span>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Supplied message text, URL snippet, or observation notes (redacted)
              </label>
              <textarea
                rows={4}
                value={artifactExcerpt}
                onChange={(e) => setArtifactExcerpt(e.target.value)}
                placeholder="Paste the recruiter message, email headers/body, or posting text you want checked..."
                className="w-full p-3 text-xs border border-slate-300 rounded-lg bg-white leading-relaxed"
              />
            </div>

            {redactionWarnings.length > 0 && (
              <div
                role="alert"
                className="p-3 rounded-lg border border-red-300 bg-red-50 text-xs text-red-950 space-y-1"
              >
                <div className="font-semibold">
                  Possible unredacted sensitive data detected:
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {redactionWarnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <label className="inline-flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={redactionConfirmed}
                  onChange={(e) => setRedactionConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <span>
                  I confirmed this text/file does not include passwords, authentication codes, bank account numbers, or full government ID numbers.
                </span>
              </label>

              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0 self-start"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Artifact & Evaluate</span>
              </button>
            </div>
          </form>

          {/* Attached Artifacts Table */}
          {activeReview.artifacts.length > 0 && (
            <div className="pt-4 border-t border-slate-200 space-y-2">
              <div className="text-xs font-semibold text-slate-900">
                Supplied Artifacts in This Review ({activeReview.artifacts.length})
              </div>
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                {activeReview.artifacts.map((art) => {
                  const linkedDoc = art.privateDocumentId
                    ? documents.find((d) => d.id === art.privateDocumentId)
                    : undefined;
                  return (
                    <div
                      key={art.id}
                      className="p-3 text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-slate-700">
                          <span className="font-semibold text-slate-900">
                            {art.title}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono uppercase text-[11px]">
                            {art.type}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-slate-500">
                            {art.dateSupplied}
                          </span>
                          {art.httpStatus !== null && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums text-slate-700">
                                HTTP {art.httpStatus}
                              </span>
                            </>
                          )}
                        </div>
                        {art.sourceProvenance && (
                          <div className="text-slate-600">
                            Provenance: {art.sourceProvenance}
                          </div>
                        )}
                        {art.senderAddress && (
                          <div className="font-mono text-slate-800">
                            Sender: {art.senderAddress}
                          </div>
                        )}
                        {art.targetUrl && (
                          <div className="font-mono text-slate-700 break-all flex items-center gap-1">
                            <Link2 className="w-3 h-3 shrink-0" />
                            <span>{art.targetUrl}</span>
                          </div>
                        )}
                        {linkedDoc && (
                          <div className="inline-flex items-center gap-1 text-slate-700">
                            <FileText className="w-3 h-3 shrink-0" />
                            <span>
                              Private workspace file: {linkedDoc.fileName} (not publicly exposed)
                            </span>
                          </div>
                        )}
                        {art.contentExcerpt && (
                          <p className="text-slate-600 line-clamp-2 pt-0.5">
                            {art.contentExcerpt}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveArtifact(art.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 hover:text-red-700 border border-slate-200 rounded hover:bg-slate-50 shrink-0 self-start"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Remove</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 3. REVIEW FINDINGS (FACT VS INTERPRETATION + CITATION + USER DISMISS/CORRECT) */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-slate-900">
            Findings & Pattern Notes ({activeFindings.length} active
            {resolvedFindings.length > 0
              ? `, ${resolvedFindings.length} corrected or dismissed`
              : ""}
            )
          </h3>
          <p className="text-xs text-slate-600">
            Every finding separates observed behavior (fact) from interpretation and cites the specific supplied artifact. AI outputs are labeled as suggestions, never adjudicated facts.
          </p>
        </div>

        {activeFindings.length === 0 ? (
          <div className="p-4 border border-slate-200 rounded-lg bg-slate-50/70 text-xs text-slate-700">
            No active warning or informational findings are currently triggered on the supplied artifacts. Complete the manual verification checklist below to record what you have independently corroborated and what remains unknown.
          </div>
        ) : (
          <div className="space-y-3">
            {activeFindings.map((f) => {
              const citedArtifact = activeReview.artifacts.find(
                (a) => a.id === f.supportingArtifactId
              );
              const draft = findingResolutionDrafts[f.id];
              const sevClasses =
                f.severity === "stop_and_verify"
                  ? "border-red-300 bg-red-50/50"
                  : f.severity === "caution"
                  ? "border-amber-300 bg-amber-50/40"
                  : "border-slate-200 bg-slate-50/50";

              return (
                <div
                  key={f.id}
                  className={`p-4 rounded-lg border space-y-3 ${sevClasses}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold text-slate-950 flex items-center gap-1">
                        {f.severity === "stop_and_verify" && (
                          <AlertTriangle className="w-3.5 h-3.5 text-red-700 shrink-0" />
                        )}
                        {formatSeverityLabel(f.severity)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-slate-900">
                        {f.category}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-600">
                        Dimension: {DIMENSION_LABELS[f.dimension]}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-700 border border-slate-300 bg-white px-2 py-0.5 rounded shrink-0 self-start">
                      Basis: {formatBasisLabel(f.basis)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-white border border-slate-200 rounded">
                      <div className="font-semibold text-slate-900 mb-1">
                        Observed behavior (fact)
                      </div>
                      <p className="text-slate-700 leading-relaxed">
                        {f.observedBehavior}
                      </p>
                    </div>
                    <div className="p-3 bg-white border border-slate-200 rounded">
                      <div className="font-semibold text-slate-900 mb-1">
                        Interpretation (for your judgment)
                      </div>
                      <p className="text-slate-700 leading-relaxed">
                        {f.interpretation}
                      </p>
                    </div>
                  </div>

                  <div className="text-xs space-y-1 text-slate-700">
                    <div>
                      <span className="font-semibold text-slate-900">
                        Cited artifact:
                      </span>{" "}
                      {citedArtifact ? citedArtifact.title : f.supportingArtifactId}
                      {f.supportingExcerpt && (
                        <span className="font-mono text-[11px] text-slate-600 block mt-0.5 bg-white border border-slate-200 px-2.5 py-1.5 rounded">
                          “{f.supportingExcerpt}”
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">
                        Recommended action:
                      </span>{" "}
                      {f.recommendedAction}
                    </div>
                  </div>

                  {!readOnly && (
                    <div className="pt-2 border-t border-slate-200/80">
                      {!draft ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setFindingResolutionDrafts((prev) => ({
                                ...prev,
                                [f.id]: { mode: "corrected", explanation: "" },
                              }))
                            }
                            className="px-2.5 py-1 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded hover:bg-slate-50"
                          >
                            Correct with note
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setFindingResolutionDrafts((prev) => ({
                                ...prev,
                                [f.id]: { mode: "dismissed", explanation: "" },
                              }))
                            }
                            className="px-2.5 py-1 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded hover:bg-slate-50"
                          >
                            Dismiss with explanation
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2 bg-white p-3 rounded border border-slate-300">
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                            <span>
                              {draft.mode === "corrected"
                                ? "Record correction for this finding"
                                : "Dismiss this finding with explanation"}
                            </span>
                          </div>
                          <input
                            type="text"
                            value={draft.explanation}
                            onChange={(e) =>
                              setFindingResolutionDrafts((prev) => ({
                                ...prev,
                                [f.id]: {
                                  ...draft,
                                  explanation: e.target.value,
                                },
                              }))
                            }
                            placeholder="Explain what you verified (e.g., Confirmed official careers page links directly to this domain)..."
                            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleApplyFindingResolution(f.id)}
                              className="px-3 py-1 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800"
                            >
                              Save Note
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setFindingResolutionDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[f.id];
                                  return next;
                                })
                              }
                              className="px-3 py-1 text-xs text-slate-600 hover:text-slate-900"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {resolvedFindings.length > 0 && (
          <div className="pt-3 border-t border-slate-200 space-y-2">
            <div className="text-xs font-semibold text-slate-700">
              Corrected or Dismissed Findings ({resolvedFindings.length})
            </div>
            <div className="space-y-2">
              {resolvedFindings.map((rf) => (
                <div
                  key={rf.id}
                  className="p-3 rounded border border-slate-200 bg-slate-50 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div>
                    <span className="font-semibold text-slate-800">
                      [{rf.userResolution === "corrected" ? "Corrected" : "Dismissed"}]{" "}
                      {rf.category}:
                    </span>{" "}
                    <span className="text-slate-600">
                      {rf.userResolutionExplanation}
                    </span>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => handleRestoreFindingActive(rf.id)}
                      className="text-xs font-medium text-teal-800 hover:underline shrink-0 self-start"
                    >
                      Restore active
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 4. MANUAL VERIFICATION CHECKLIST + OPTIONAL DOCUMENTED IMPERSONATION CONFIRMATION */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
          <div>
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-slate-700" />
              <span>Manual Verification Checklist</span>
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Record what you checked directly and whether each dimension was corroborated, conflicted, or inconclusive.
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={() => setShowImpersonationForm((v) => !v)}
              className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0 self-start"
            >
              {activeReview.impersonationConfirmation
                ? "Edit Documented Impersonation Record"
                : "Record Documented Impersonation Confirmation"}
            </button>
          )}
        </div>

        {/* Optional Documented Impersonation Confirmation Gate */}
        {(showImpersonationForm || activeReview.impersonationConfirmation) && (
          <div className="p-4 rounded-lg border border-slate-300 bg-slate-50 space-y-3">
            <div className="text-xs font-semibold text-slate-900">
              Documented Impersonation Confirmation (Requires Identity & Artifact Proof)
            </div>
            <p className="text-xs text-slate-600">
              Use this only when a verified representative of the actual organization (for example, HR at the official corporate domain) has confirmed in writing that the outreach or posting was unauthorized.
            </p>
            {activeReview.impersonationConfirmation && !showImpersonationForm ? (
              <div className="text-xs space-y-1 text-slate-800">
                <div>
                  <strong>Confirmed by:</strong>{" "}
                  {activeReview.impersonationConfirmation.confirmedByIdentity}
                </div>
                <div>
                  <strong>How identity was established:</strong>{" "}
                  {activeReview.impersonationConfirmation.identityEstablishmentMethod}
                </div>
                <div>
                  <strong>Supporting artifact ID:</strong>{" "}
                  <span className="font-mono">
                    {activeReview.impersonationConfirmation.supportingArtifactId}
                  </span>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={handleClearImpersonationConfirmation}
                    className="mt-2 text-xs text-red-700 hover:underline font-medium"
                  >
                    Remove impersonation confirmation record
                  </button>
                )}
              </div>
            ) : (
              <form
                onSubmit={handleSaveImpersonationConfirmation}
                className="space-y-3"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Who confirmed the impersonation?
                    </label>
                    <input
                      type="text"
                      value={impConfirmedBy}
                      onChange={(e) => setImpConfirmedBy(e.target.value)}
                      placeholder="e.g., Talent Ops Team (hr@employer.com)"
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      How was their identity established?
                    </label>
                    <input
                      type="text"
                      value={impMethod}
                      onChange={(e) => setImpMethod(e.target.value)}
                      placeholder="e.g., Emailed address listed on official employer website"
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Supporting artifact in this review
                    </label>
                    <select
                      value={impArtifactId}
                      onChange={(e) => setImpArtifactId(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
                    >
                      <option value="">Select attached artifact...</option>
                      {activeReview.artifacts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title} ({a.dateSupplied})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800"
                  >
                    Save Documented Confirmation
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowImpersonationForm(false)}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
          {activeReview.checks.map((chk) => (
            <div key={chk.id} className="p-4 space-y-3 text-xs">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                <div className="space-y-1 max-w-2xl">
                  <div className="font-semibold text-slate-900">
                    {DIMENSION_LABELS[chk.dimension]}: {chk.question}
                  </div>
                  <div className="text-slate-600">
                    Suggested method: {chk.method}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <select
                    disabled={readOnly}
                    value={chk.status}
                    aria-label={`Status for ${DIMENSION_LABELS[chk.dimension]}`}
                    onChange={(e) =>
                      handleUpdateCheck(chk.id, {
                        status: e.target.value as VerificationCheckStatus,
                      })
                    }
                    className="px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded bg-white text-slate-900"
                  >
                    <option value="not_started">Not started</option>
                    <option value="completed">Completed</option>
                    <option value="inconclusive">Inconclusive</option>
                    <option value="unavailable">Unavailable</option>
                  </select>

                  {chk.status === "completed" && (
                    <select
                      disabled={readOnly}
                      value={chk.outcome}
                      aria-label={`Outcome for ${DIMENSION_LABELS[chk.dimension]}`}
                      onChange={(e) =>
                        handleUpdateCheck(chk.id, {
                          outcome: e.target.value as VerificationCheckOutcome,
                        })
                      }
                      className="px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded bg-white text-slate-900"
                    >
                      <option value="corroborated">
                        Corroborated in scope
                      </option>
                      <option value="conflict_or_missing">
                        Conflict or missing confirmation
                      </option>
                      <option value="inconclusive">Inconclusive</option>
                    </select>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                <div className="md:col-span-2">
                  <input
                    type="text"
                    disabled={readOnly}
                    defaultValue={chk.notes}
                    onBlur={(e) => {
                      if (e.target.value !== chk.notes) {
                        handleUpdateCheck(chk.id, { notes: e.target.value });
                      }
                    }}
                    placeholder="Record what you saw (e.g., Found exact role on employer.com/careers linking to Greenhouse)..."
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
                  />
                </div>
                <div>
                  <select
                    disabled={readOnly}
                    value={chk.evidenceArtifactIds[0] || ""}
                    onChange={(e) =>
                      handleUpdateCheck(chk.id, {
                        evidenceArtifactIds: e.target.value ? [e.target.value] : [],
                      })
                    }
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                  >
                    <option value="">Link supporting artifact (optional)</option>
                    {activeReview.artifacts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 5. TRANSPARENCY SUMMARY + RECORD USER DECISION */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
          <div className="p-4 border border-slate-200 rounded-lg bg-slate-50/60 space-y-2">
            <div className="font-semibold text-slate-900">What Was Checked</div>
            {activeReview.whatWasChecked.length === 0 ? (
              <p className="text-slate-600">No checks recorded yet.</p>
            ) : (
              <ul className="list-disc pl-4 space-y-1 text-slate-700 leading-relaxed">
                {activeReview.whatWasChecked.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-4 border border-amber-200 rounded-lg bg-amber-50/40 space-y-2">
            <div className="font-semibold text-amber-950">
              What Remains Unknown
            </div>
            {activeReview.whatRemainsUnknown.length === 0 ? (
              <p className="text-slate-700">
                All five dimensions have been corroborated within your stated scope. Continue exercising normal caution if new requests arrive.
              </p>
            ) : (
              <ul className="list-disc pl-4 space-y-1 text-amber-950 leading-relaxed">
                {activeReview.whatRemainsUnknown.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-4 border border-slate-200 rounded-lg bg-slate-50/60 space-y-2">
            <div className="font-semibold text-slate-900">
              What You Should Verify Next
            </div>
            {activeReview.nextVerificationSteps.length === 0 ? (
              <p className="text-slate-600">
                No pending verification actions. Recheck if the sender changes channels or requests new actions.
              </p>
            ) : (
              <ul className="list-disc pl-4 space-y-1 text-slate-700 leading-relaxed">
                {activeReview.nextVerificationSteps.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-200 space-y-3">
          <h3 className="text-base font-semibold text-slate-900">
            Record Your Decision
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Your current decision
              </label>
              <select
                disabled={readOnly}
                value={activeReview.userDecision}
                onChange={(e) =>
                  handleUpdateHeaderMeta({
                    userDecision: e.target.value as AuthenticityUserDecision,
                  })
                }
                className="w-full px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                {(
                  Object.keys(USER_DECISION_LABELS) as AuthenticityUserDecision[]
                ).map((key) => (
                  <option key={key} value={key}>
                    {USER_DECISION_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Decision notes & boundaries (editable)
              </label>
              <input
                type="text"
                disabled={readOnly}
                defaultValue={activeReview.userDecisionNote}
                onBlur={(e) => {
                  if (e.target.value !== activeReview.userDecisionNote) {
                    handleUpdateHeaderMeta({ userDecisionNote: e.target.value });
                  }
                }}
                placeholder="e.g., Apply only via the official careers page link; do not reply to Gmail sender..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              />
            </div>
          </div>

          {!readOnly && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={async () => {
                  await onDeleteReview(activeReview.id);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-slate-600 hover:text-red-700 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete This Review Record</span>
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
