import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck2,
  Globe,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  ISOLATED_SAMPLE_OPPORTUNITIES,
  getTodayIsoDate,
} from "../data/initialData";
import {
  requestTruthfulAiDraft,
  verifyOpportunityLiveWeb,
} from "../services/apiClient";
import {
  ApplicationVersion,
  AuthenticityReview,
  Evidence,
  Opportunity,
  OpportunityStage,
  PrivateDocumentCategory,
  PrivateDocumentMeta,
  Profile,
  RequirementAssessment,
  RequirementFitLevel,
  WorkspaceState,
} from "../types/models";
import {
  auditDraftClaimsAndPlaceholders,
  buildTruthfulApplicationBundle,
  evaluateAuthenticityFlags,
  evaluateOpportunityDecision,
  generateRequirementAssessments,
} from "../utils/analysisEngine";
import { RelationshipCandidateInput } from "../utils/relationshipGraphEngine";
import { AuthenticitySafetyReviewPanel } from "./AuthenticitySafetyReviewPanel";
import { WhyThisFitsPanel } from "./WhyThisFitsPanel";

interface OpportunitiesViewProps {
  profile: Profile;
  evidence: Evidence[];
  opportunities: Opportunity[];
  assessments: RequirementAssessment[];
  applicationVersions: ApplicationVersion[];
  selectedOpportunityId: string | null;
  showSampleData: boolean;
  allowServerSideAi: boolean;
  onSelectOpportunity: (id: string) => void;
  onToggleSampleData: (val: boolean) => void;
  onUpdateOpportunity: (opp: Opportunity) => Promise<boolean>;
  onDeleteOpportunity: (oppId: string) => Promise<boolean>;
  onReplaceAssessmentsForOpportunity: (
    oppId: string,
    items: RequirementAssessment[]
  ) => Promise<boolean>;
  onSaveApplicationVersion: (version: ApplicationVersion) => Promise<boolean>;
  onAddNewOpportunityClick: () => void;
  workspace?: WorkspaceState;
  ownerUid?: string;
  onSaveRelationship?: (
    candidate: RelationshipCandidateInput,
    options?: { mode?: "create" | "update"; explicitNewEvidence?: boolean }
  ) => Promise<{ ok: boolean; error?: string }>;
  onOpenSkillsWorthDeveloping?: () => void;
  onOpenConnections?: () => void;
  isDemoMode?: boolean;
  onSaveAuthenticityReview?: (
    review: AuthenticityReview
  ) => Promise<{ ok: boolean; error?: string }>;
  onDeleteAuthenticityReview?: (reviewId: string) => Promise<boolean>;
  onUploadPrivateFile?: (
    file: File,
    docCategory: PrivateDocumentCategory,
    linkedOpportunityId?: string
  ) => Promise<{ meta: PrivateDocumentMeta; extractedTextIfPlain: string | null } | null>;
}

const STAGES: OpportunityStage[] = [
  "Research / preparation",
  "Clarifying details",
  "Ready to apply",
  "Applied",
  "Conversation / Screen",
  "Interviewing",
  "Offer received",
  "Deprioritized / Archived",
];

export const OpportunitiesView: React.FC<OpportunitiesViewProps> = ({
  profile,
  evidence,
  opportunities,
  assessments,
  applicationVersions,
  selectedOpportunityId,
  showSampleData,
  allowServerSideAi,
  onSelectOpportunity,
  onToggleSampleData,
  onUpdateOpportunity,
  onDeleteOpportunity,
  onReplaceAssessmentsForOpportunity,
  onSaveApplicationVersion,
  onAddNewOpportunityClick,
  workspace,
  ownerUid = "demo-mode",
  onSaveRelationship,
  onOpenSkillsWorthDeveloping,
  onOpenConnections,
  isDemoMode = false,
  onSaveAuthenticityReview,
  onDeleteAuthenticityReview,
  onUploadPrivateFile,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("active");
  const [workspaceTab, setWorkspaceTab] = useState<
    "fit" | "safety" | "record" | "application"
  >("fit");
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [isCheckingWeb, setIsCheckingWeb] = useState(false);
  const [confirmDeleteOppId, setConfirmDeleteOppId] = useState<string | null>(null);

  // Application Workspace Draft State
  const [tailoredResume, setTailoredResume] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const [whyThisRole, setWhyThisRole] = useState("");
  const [appQuestions, setAppQuestions] = useState("");
  const [talkingPoints, setTalkingPoints] = useState("");
  const [versionLabel, setVersionLabel] = useState("Version 1 — Draft");
  const [checklist, setChecklist] = useState({
    verifiedAllClaims: false,
    noInventedMetrics: false,
    noTrainingImpliedAsWork: false,
    placeholdersResolved: false,
    employerDestinationChecked: false,
  });
  const [draftReasoningMeta, setDraftReasoningMeta] = useState<{
    evidenceUsed: string[];
    missingInformation: string[];
    reasoning: string;
    suggestedNextAction: string;
  } | null>(null);
  const [isAiDrafting, setIsAiDrafting] = useState(false);
  const [exportBlockedError, setExportBlockedError] = useState<string | null>(null);

  // New requirement inline input
  const [newReqText, setNewReqText] = useState("");
  const [newReqPriority, setNewReqPriority] = useState<"Required" | "Preferred">("Required");

  const combinedList = useMemo(() => {
    const base = opportunities.filter((o) =>
      stageFilter === "archived" ? o.archived : !o.archived
    );
    const withSamples = showSampleData
      ? [...base, ...ISOLATED_SAMPLE_OPPORTUNITIES]
      : base;

    return withSamples.filter((o) => {
      if (stageFilter !== "active" && stageFilter !== "archived" && o.stage !== stageFilter) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        o.title.toLowerCase().includes(q) ||
        o.employer.toLowerCase().includes(q) ||
        o.location.toLowerCase().includes(q)
      );
    });
  }, [opportunities, showSampleData, stageFilter, searchQuery]);

  const activeOpp = useMemo(() => {
    const allPool = [...opportunities, ...ISOLATED_SAMPLE_OPPORTUNITIES];
    if (selectedOpportunityId) {
      const found = allPool.find((o) => o.id === selectedOpportunityId);
      if (found) return found;
    }
    return combinedList[0] ?? opportunities[0] ?? null;
  }, [opportunities, selectedOpportunityId, combinedList]);

  const oppAssessments = useMemo(() => {
    if (!activeOpp) return [];
    if (activeOpp.isSampleRecord) {
      return generateRequirementAssessments(activeOpp, profile, evidence);
    }
    const stored = assessments.filter((a) => a.opportunityId === activeOpp.id);
    return stored.length > 0
      ? stored
      : generateRequirementAssessments(activeOpp, profile, evidence);
  }, [activeOpp, assessments, profile, evidence]);

  const decisionReport = useMemo(() => {
    if (!activeOpp) return null;
    return evaluateOpportunityDecision(activeOpp, oppAssessments, profile, evidence);
  }, [activeOpp, oppAssessments, profile, evidence]);

  const oppVersions = useMemo(
    () =>
      activeOpp
        ? applicationVersions.filter((v) => v.opportunityId === activeOpp.id)
        : [],
    [activeOpp, applicationVersions]
  );

  // Load latest saved application version or initialize clean truthful draft when switching opportunities
  useEffect(() => {
    if (!activeOpp) return;
    setExportBlockedError(null);
    const existingVersions = applicationVersions.filter(
      (v) => v.opportunityId === activeOpp.id
    );
    if (existingVersions.length > 0) {
      const latest = existingVersions[existingVersions.length - 1];
      setTailoredResume(latest.tailoredResumeText);
      setCoverNote(latest.coverNoteText);
      setWhyThisRole(latest.whyThisRoleText);
      setAppQuestions(latest.applicationQuestionsText);
      setTalkingPoints(latest.interviewTalkingPoints);
      setChecklist(latest.checklistCompleted);
      setVersionLabel(`Version ${existingVersions.length + 1}`);
      setDraftReasoningMeta(null);
    } else {
      const bundle = buildTruthfulApplicationBundle(activeOpp, profile, evidence);
      setTailoredResume(bundle.tailoredResumeText);
      setCoverNote(bundle.coverNoteText);
      setWhyThisRole(bundle.whyThisRoleText);
      setAppQuestions(bundle.applicationQuestionsText);
      setTalkingPoints(bundle.interviewTalkingPoints);
      setVersionLabel("Version 1 — Grounded Draft");
      setChecklist({
        verifiedAllClaims: false,
        noInventedMetrics: true,
        noTrainingImpliedAsWork: true,
        placeholdersResolved: false,
        employerDestinationChecked: false,
      });
      setDraftReasoningMeta({
        evidenceUsed: bundle.evidenceUsed,
        missingInformation: bundle.missingInformation,
        reasoning: bundle.reasoning,
        suggestedNextAction: bundle.suggestedNextAction,
      });
    }
  }, [activeOpp?.id]);

  const combinedDraftText = `${tailoredResume}\n${coverNote}\n${whyThisRole}\n${appQuestions}`;
  const draftAudit = useMemo(
    () => auditDraftClaimsAndPlaceholders(combinedDraftText, profile, evidence),
    [combinedDraftText, profile, evidence]
  );

  const flashBanner = (msg: string) => {
    setStatusBanner(msg);
    window.setTimeout(() => setStatusBanner(null), 4000);
  };

  const handleUpdateActiveField = async (patch: Partial<Opportunity>) => {
    if (!activeOpp || activeOpp.isSampleRecord) return;
    const merged: Opportunity = { ...activeOpp, ...patch };
    merged.authenticityFlags = evaluateAuthenticityFlags(merged);
    await onUpdateOpportunity(merged);
  };

  const handleResyncAssessments = async () => {
    if (!activeOpp || activeOpp.isSampleRecord) return;
    const regenerated = generateRequirementAssessments(activeOpp, profile, evidence);
    const ok = await onReplaceAssessmentsForOpportunity(activeOpp.id, regenerated);
    if (ok) {
      flashBanner("Re-evaluated requirements and saved assessments to database.");
    }
  };

  const handleLiveWebCheckOnActive = async () => {
    if (!activeOpp || activeOpp.isSampleRecord) return;
    setIsCheckingWeb(true);
    const res = await verifyOpportunityLiveWeb({
      employer: activeOpp.employer,
      title: activeOpp.title,
      postingUrl: activeOpp.postingUrl,
      officialWebsite: activeOpp.officialWebsite,
      allowServerSideAi,
    });
    handleUpdateActiveField({
      liveVerificationLog: {
        lastCheckedAt: res.retrievedAt,
        liveAvailable: res.liveAvailable,
        summary: res.summary,
        sources: res.sources,
      },
    });
    setIsCheckingWeb(false);
  };

  const handleAiRefineCoverNote = async () => {
    if (!activeOpp) return;
    setIsAiDrafting(true);
    const aiDraft = await requestTruthfulAiDraft({
      draftType: "short_cover_note",
      opportunity: activeOpp,
      evidence,
      allowServerSideAi,
    });
    if (aiDraft) {
      setCoverNote(aiDraft.draftText);
      setDraftReasoningMeta({
        evidenceUsed: aiDraft.evidenceUsed,
        missingInformation: aiDraft.missingInformation,
        reasoning: aiDraft.reasoning,
        suggestedNextAction: aiDraft.suggestedNextAction,
      });
      flashBanner("Generated editable cover note from verified claims.");
    } else {
      const local = buildTruthfulApplicationBundle(activeOpp, profile, evidence);
      setCoverNote(local.coverNoteText);
      setDraftReasoningMeta({
        evidenceUsed: local.evidenceUsed,
        missingInformation: local.missingInformation,
        reasoning: local.reasoning,
        suggestedNextAction: local.suggestedNextAction,
      });
      flashBanner("Refreshed cover note using local verified-evidence template.");
    }
    setIsAiDrafting(false);
  };

  const handleSaveSnapshot = async (markSubmitted: boolean) => {
    if (!activeOpp || activeOpp.isSampleRecord) return;
    if (markSubmitted && draftAudit.unresolvedPlaceholders.length > 0) {
      setExportBlockedError(
        `Cannot record final submission while unresolved placeholders remain: ${draftAudit.unresolvedPlaceholders.join(
          ", "
        )}`
      );
      return;
    }
    setExportBlockedError(null);
    const version: ApplicationVersion = {
      id: `appver-${Date.now()}`,
      opportunityId: activeOpp.id,
      versionLabel: versionLabel.trim() || `Version ${oppVersions.length + 1}`,
      createdAt: new Date().toISOString(),
      tailoredResumeText: tailoredResume,
      coverNoteText: coverNote,
      whyThisRoleText: whyThisRole,
      applicationQuestionsText: appQuestions,
      interviewTalkingPoints: talkingPoints,
      checklistCompleted: {
        ...checklist,
        placeholdersResolved: draftAudit.unresolvedPlaceholders.length === 0,
      },
      submitted: markSubmitted,
      submittedDate: markSubmitted ? getTodayIsoDate() : "",
      submissionNotes: markSubmitted
        ? `Submitted ${versionLabel} on ${getTodayIsoDate()}`
        : "Saved workspace draft",
    };
    const ok = await onSaveApplicationVersion(version);
    if (!ok) return;
    if (markSubmitted) {
      await handleUpdateActiveField({
        stage: "Applied",
        appliedConfirmedByNora: "applied",
      });
      flashBanner("Saved submitted application version to database and updated stage to Applied.");
    } else {
      flashBanner("Saved application draft version to database.");
    }
  };

  const handleExportPacket = () => {
    if (!activeOpp) return;
    if (draftAudit.unresolvedPlaceholders.length > 0) {
      setExportBlockedError(
        `Final export prevented — please replace ${draftAudit.unresolvedPlaceholders.length} unresolved placeholder(s) first: ${draftAudit.unresolvedPlaceholders.join(
          ", "
        )}`
      );
      return;
    }
    setExportBlockedError(null);
    const content = [
      `APPLICATION PACKET — ${activeOpp.title} (${activeOpp.employer})`,
      `Exported: ${getTodayIsoDate()}`,
      `Version: ${versionLabel}`,
      "============================================================",
      "",
      "1. TAILORED RÉSUMÉ",
      "------------------------------------------------------------",
      tailoredResume,
      "",
      "2. SHORT COVER NOTE",
      "------------------------------------------------------------",
      coverNote,
      "",
      "3. WHY THIS ROLE",
      "------------------------------------------------------------",
      whyThisRole,
      "",
      "4. APPLICATION QUESTIONS",
      "------------------------------------------------------------",
      appQuestions,
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nora-crafts-${activeOpp.employer
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}-packet.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddInlineRequirement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOpp || activeOpp.isSampleRecord || !newReqText.trim()) return;
    const updatedOpp: Opportunity =
      newReqPriority === "Required"
        ? {
            ...activeOpp,
            requiredQualifications: [...activeOpp.requiredQualifications, newReqText.trim()],
          }
        : {
            ...activeOpp,
            preferredQualifications: [...activeOpp.preferredQualifications, newReqText.trim()],
          };
    onUpdateOpportunity(updatedOpp);
    const regenerated = generateRequirementAssessments(updatedOpp, profile, evidence);
    onReplaceAssessmentsForOpportunity(updatedOpp.id, regenerated);
    setNewReqText("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Opportunities & Fit Workspace
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 max-w-2xl">
            Inspect requirement-by-requirement evidence fit, verify compensation and posting authenticity, and prepare truthful application versions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showSampleData}
              onChange={(e) => onToggleSampleData(e.target.checked)}
              className="rounded border-slate-300 text-teal-800"
            />
            <span>Show isolated sample comparison</span>
          </label>
          <button
            type="button"
            onClick={onAddNewOpportunityClick}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Opportunity</span>
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-2.5 text-xs font-medium text-teal-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-teal-800 shrink-0" />
          <span>{statusBanner}</span>
        </div>
      )}

      {/* Search & Filter Bar + Opportunity Selector Strip */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by role, employer, or location..."
            className="w-full sm:w-72 px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          />
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
            {[
              { id: "active", label: "Active" },
              { id: "Research / preparation", label: "Research" },
              { id: "Ready to apply", label: "Ready" },
              { id: "Applied", label: "Applied" },
              { id: "archived", label: "Archived" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStageFilter(f.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                  stageFilter === f.id
                    ? "bg-white text-slate-950 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {combinedList.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500">
            No opportunities match this filter.
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-slate-200 pt-2">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="py-2 px-3 font-medium">Role & Employer</th>
                  <th className="py-2 px-3 font-medium">Stage</th>
                  <th className="py-2 px-3 font-medium">Vacancy Check</th>
                  <th className="py-2 px-3 font-medium">Guaranteed Base Pay</th>
                  <th className="py-2 px-3 font-medium text-right">Next Action Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {combinedList.map((opp) => {
                  const isSelected = activeOpp?.id === opp.id;
                  return (
                    <tr
                      key={opp.id}
                      onClick={() => onSelectOpportunity(opp.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? "bg-teal-50/60" : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-900">
                          {opp.title} — {opp.employer}
                        </div>
                        <div className="text-slate-500">
                          {opp.location}
                          {opp.isSampleRecord ? " · Sample preview record (not saved to your workspace)" : ""}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">{opp.stage}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={
                            opp.openingAvailabilityStatus === "Seen on official careers page"
                              ? "text-teal-900 font-medium"
                              : "text-amber-800"
                          }
                        >
                          {opp.openingAvailabilityStatus}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {opp.compensation.employerPublishedBase || "Unknown"}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-600 whitespace-nowrap">
                        {opp.nextActionDueDate || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Selected Opportunity Deep Workspace */}
      {activeOpp && decisionReport && (
        <div className="space-y-6">
          {/* Workspace Header Banner */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{activeOpp.intakeChannel}</span>
                  <span aria-hidden="true">·</span>
                  <span>Found {activeOpp.dateFirstFound}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      activeOpp.openingAvailabilityStatus === "Seen on official careers page"
                        ? "text-teal-900 font-semibold"
                        : "text-amber-800 font-semibold"
                    }
                  >
                    Opening status: {activeOpp.openingAvailabilityStatus}
                  </span>
                  {activeOpp.isSampleRecord && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-amber-800 font-semibold">
                        Sample comparison only (read-only)
                      </span>
                    </>
                  )}
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
                  {activeOpp.title} — {activeOpp.employer}
                </h2>
                <p className="text-sm text-slate-600">
                  {activeOpp.location} · Base compensation:{" "}
                  <strong className="font-mono tabular-nums text-slate-900">
                    {activeOpp.compensation.employerPublishedBase ||
                      "Unknown (needs verification)"}
                  </strong>
                </p>
              </div>

              {/* Workspace Sub-Navigation */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setWorkspaceTab("fit")}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                      workspaceTab === "fit"
                        ? "bg-white text-slate-950 font-semibold shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Fit & Decision Support
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceTab("safety")}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                      workspaceTab === "safety"
                        ? "bg-white text-slate-950 font-semibold shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Authenticity & Safety
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceTab("record")}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                      workspaceTab === "record"
                        ? "bg-white text-slate-950 font-semibold shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Opportunity Record
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceTab("application")}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                      workspaceTab === "application"
                        ? "bg-white text-slate-950 font-semibold shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Application Workspace ({oppVersions.length})
                  </button>
                </div>

                {!activeOpp.isSampleRecord && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateActiveField({ archived: !activeOpp.archived })
                      }
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>{activeOpp.archived ? "Unarchive" : "Archive"}</span>
                    </button>

                    {confirmDeleteOppId === activeOpp.id ? (
                      <div className="inline-flex items-center gap-1.5 bg-red-50 border border-red-300 rounded-lg px-2.5 py-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            const idToDelete = activeOpp.id;
                            setConfirmDeleteOppId(null);
                            await onDeleteOpportunity(idToDelete);
                          }}
                          className="text-xs font-semibold text-red-800 hover:underline whitespace-nowrap"
                        >
                          Confirm Delete
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteOppId(null)}
                          className="text-xs text-slate-600 hover:text-slate-900"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteOppId(activeOpp.id)}
                        className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-red-700 border border-slate-200 rounded-lg hover:bg-red-50 whitespace-nowrap shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Starter Confirmation Prompt if Application Status is Unconfirmed */}
            {!activeOpp.isSampleRecord && activeOpp.appliedConfirmedByNora === "unconfirmed" && (
              <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs sm:text-sm text-amber-950 font-medium">
                  Action needed: Have you already submitted an application for {activeOpp.title} at{" "}
                  {activeOpp.employer}?
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateActiveField({
                        appliedConfirmedByNora: "not_applied",
                        stage: "Research / preparation",
                      })
                    }
                    className="px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0"
                  >
                    Not Yet Applied
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateActiveField({
                        appliedConfirmedByNora: "applied",
                        stage: "Applied",
                      })
                    }
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-md whitespace-nowrap shrink-0"
                  >
                    Yes, Already Applied
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* SUB-VIEW 1: FIT & DECISION SUPPORT (FEATURE 3) */}
          {workspaceTab === "fit" && (
            <div className="space-y-6">
              {/* Structured Recommendation Card (Zero fake percentages/scores!) */}
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
                  <div>
                    <div className="text-xs text-slate-500">
                      Evidence-Based Recommendation (No artificial match score or interview probability)
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mt-0.5">
                      Recommendation: {decisionReport.verdict}
                    </h3>
                  </div>
                  {!activeOpp.isSampleRecord && (
                    <button
                      type="button"
                      onClick={handleResyncAssessments}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0 self-start"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Re-check Against Updated Profile</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-900">Reasoning</h4>
                    <p className="text-slate-700 leading-relaxed">{decisionReport.reasoning}</p>
                    <div className="pt-2">
                      <span className="text-xs font-semibold text-teal-900 block">
                        Suggested Next Action
                      </span>
                      <p className="text-slate-800 font-medium mt-0.5">
                        {decisionReport.suggestedNextAction}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <h4 className="text-xs font-semibold text-slate-900">
                        Confirmed Evidence Used ({decisionReport.evidenceUsed.length})
                      </h4>
                      <ul className="mt-1 space-y-1 text-xs text-slate-700 list-disc pl-4">
                        {decisionReport.evidenceUsed.map((ev, i) => (
                          <li key={i}>{ev}</li>
                        ))}
                      </ul>
                    </div>

                    {decisionReport.missingInformation.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-amber-900">
                          Missing Information / Unknowns ({decisionReport.missingInformation.length})
                        </h4>
                        <ul className="mt-1 space-y-1 text-xs text-amber-950 list-disc pl-4">
                          {decisionReport.missingInformation.map((mi, i) => (
                            <li key={i}>{mi}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Hard Eligibility vs Trainable Gaps & Lacking Evidence vs Lacking Skill */}
                <div className="pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="font-semibold text-slate-900 block mb-1">
                      Hard Eligibility Issues
                    </span>
                    <p className="text-slate-600 leading-relaxed">
                      {decisionReport.hardEligibilityIssues.length > 0
                        ? decisionReport.hardEligibilityIssues.join("; ")
                        : "None identified in current required qualifications."}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900 block mb-1">
                      Trainable Gaps ({decisionReport.trainableGaps.length})
                    </span>
                    <p className="text-slate-600 leading-relaxed">
                      {decisionReport.trainableGaps.length > 0
                        ? decisionReport.trainableGaps.join("; ")
                        : "No major trainable gaps flagged."}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900 block mb-1">
                      Missing Evidence vs. Missing Skill
                    </span>
                    <p className="text-slate-600 leading-relaxed">
                      {decisionReport.evidenceVsSkillNote}
                    </p>
                  </div>
                </div>
              </section>

              {/* Evidence Relationship Graph: "Why this fits" */}
              {workspace && (
                <WhyThisFitsPanel
                  opportunity={activeOpp}
                  workspace={workspace}
                  ownerUid={ownerUid}
                  onSaveRelationship={onSaveRelationship}
                  onOpenSkillsWorthDeveloping={onOpenSkillsWorthDeveloping}
                  onOpenConnections={onOpenConnections}
                />
              )}

              {/* Requirement-by-Requirement Table */}
              <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      Requirement-by-Requirement Fit Table
                    </h3>
                    <p className="text-xs text-slate-600">
                      Mapped against your Evidence Library. You can adjust any assessment level directly if you clarify new facts.
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-700">
                        <th className="py-3 px-4 font-semibold">Requirement</th>
                        <th className="py-3 px-4 font-semibold whitespace-nowrap">
                          Required or Preferred
                        </th>
                        <th className="py-3 px-4 font-semibold">Your Evidence</th>
                        <th className="py-3 px-4 font-semibold whitespace-nowrap">Assessment</th>
                        <th className="py-3 px-4 font-semibold">Next Step</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {oppAssessments.map((ra) => (
                        <tr key={ra.id} className="hover:bg-slate-50/60 align-top">
                          <td className="py-3.5 px-4 font-medium text-slate-900 max-w-xs">
                            {ra.requirementText}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                            {ra.priority}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-700 leading-relaxed max-w-sm">
                            {ra.noraEvidenceSummary}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {activeOpp.isSampleRecord ? (
                              <span className="text-xs font-semibold text-slate-800">
                                {ra.assessment}
                              </span>
                            ) : (
                              <select
                                value={ra.assessment}
                                onChange={(e) => {
                                  const nextLevel = e.target.value as RequirementFitLevel;
                                  const updated = oppAssessments.map((item) =>
                                    item.id === ra.id
                                      ? { ...item, assessment: nextLevel }
                                      : item
                                  );
                                  onReplaceAssessmentsForOpportunity(activeOpp.id, updated);
                                }}
                                aria-label={`Assessment for ${ra.requirementText}`}
                                className="px-2 py-1 text-xs font-semibold border border-slate-300 rounded bg-white text-slate-900"
                              >
                                <option value="Direct evidence">Direct evidence</option>
                                <option value="Transferable evidence">Transferable evidence</option>
                                <option value="Gap">Gap</option>
                                <option value="Unknown">Unknown</option>
                              </select>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-600 leading-relaxed max-w-xs">
                            {ra.nextStep}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!activeOpp.isSampleRecord && (
                  <form
                    onSubmit={handleAddInlineRequirement}
                    className="p-4 bg-slate-50/70 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                  >
                    <input
                      type="text"
                      value={newReqText}
                      onChange={(e) => setNewReqText(e.target.value)}
                      placeholder="Add another requirement from the job posting..."
                      className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                    <select
                      value={newReqPriority}
                      onChange={(e) =>
                        setNewReqPriority(e.target.value as "Required" | "Preferred")
                      }
                      className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Required">Required</option>
                      <option value="Preferred">Preferred</option>
                    </select>
                    <button
                      type="submit"
                      className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0"
                    >
                      Add & Map Requirement
                    </button>
                  </form>
                )}
              </section>

              {/* 8-Factor Holistic Decision Evaluation */}
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Eight-Factor Career & Income Evaluation
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Evaluates practical sustainability over 2–4 years without promising promotions, earnings growth, or hiring outcomes.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs sm:text-sm">
                  <div>
                    <span className="font-semibold text-slate-900 block">1. Income Reliability</span>
                    <p className="text-slate-600 mt-0.5 leading-relaxed">
                      {decisionReport.factors.incomeReliability}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900 block">2. Documented Benefits</span>
                    <p className="text-slate-600 mt-0.5 leading-relaxed">
                      {decisionReport.factors.benefits}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900 block">
                      3. Schedule & Location Fit
                    </span>
                    <p className="text-slate-600 mt-0.5 leading-relaxed">
                      {decisionReport.factors.scheduleAndLocationFit}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900 block">4. Day-to-Day Work</span>
                    <p className="text-slate-600 mt-0.5 leading-relaxed">
                      {decisionReport.factors.dayToDayWork}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900 block">5. Training Burden</span>
                    <p className="text-slate-600 mt-0.5 leading-relaxed">
                      {decisionReport.factors.trainingBurden}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900 block">
                      6. Transferable Career Capital
                    </span>
                    <p className="text-slate-600 mt-0.5 leading-relaxed">
                      {decisionReport.factors.transferableCareerCapital}
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900 block">
                      7. Plausible Advancement Questions to Ask
                    </span>
                    <ul className="mt-1 space-y-1 text-slate-600 list-disc pl-4">
                      {decisionReport.factors.advancementQuestions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span className="font-semibold text-amber-950 block">
                      8. Unresolved Risks to Clarify
                    </span>
                    <ul className="mt-1 space-y-1 text-amber-900 list-disc pl-4">
                      {decisionReport.factors.unresolvedRisks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* SUB-VIEW 1B: AUTHENTICITY & SAFETY REVIEW */}
          {workspaceTab === "safety" && (
            <AuthenticitySafetyReviewPanel
              activeUserId={ownerUid}
              mode="opportunity"
              opportunity={activeOpp}
              allOpportunities={opportunities}
              reviews={workspace?.authenticityReviews || []}
              documents={workspace?.documents || []}
              allowServerSideAi={allowServerSideAi}
              isDemoMode={isDemoMode}
              readOnly={Boolean(activeOpp.isSampleRecord)}
              onSaveReview={
                onSaveAuthenticityReview ||
                (async () => ({ ok: false, error: "Review save handler not wired." }))
              }
              onDeleteReview={onDeleteAuthenticityReview || (async () => false)}
              onUploadPrivateFile={onUploadPrivateFile || (async () => null)}
            />
          )}

          {/* SUB-VIEW 2: RECORD, COMPENSATION & AUTHENTICITY */}
          {workspaceTab === "record" && (
            <div className="space-y-6">
              {/* Authenticity & Live Web Verification */}
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      Authenticity & Vacancy Verification
                    </h3>
                    <p className="text-xs text-slate-600">
                      Flags highlight items for your own review — they are neither proof of fraud nor a “verified safe” guarantee.
                    </p>
                  </div>
                  {!activeOpp.isSampleRecord && (
                    <button
                      type="button"
                      disabled={isCheckingWeb}
                      onClick={handleLiveWebCheckOnActive}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 self-start"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>
                        {isCheckingWeb ? "Checking live web..." : "Check Live Web Sources"}
                      </span>
                    </button>
                  )}
                </div>

                {activeOpp.authenticityFlags.length > 0 && (
                  <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-950">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>Human-Review Flags ({activeOpp.authenticityFlags.length})</span>
                    </div>
                    <ul className="space-y-1.5 text-xs text-amber-900">
                      {activeOpp.authenticityFlags.map((fl) => (
                        <li key={fl.id}>
                          <strong>{fl.label}:</strong> {fl.explanation}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2 text-slate-600">
                    <span className="font-semibold text-slate-900">
                      {activeOpp.liveVerificationLog.lastCheckedAt
                        ? activeOpp.liveVerificationLog.liveAvailable
                          ? "Last live web check"
                          : "Live verification unavailable"
                        : "Live web verification status"}
                    </span>
                    {activeOpp.liveVerificationLog.lastCheckedAt && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {new Date(activeOpp.liveVerificationLog.lastCheckedAt).toLocaleString()}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-slate-700 leading-relaxed">
                    {activeOpp.liveVerificationLog.summary}
                  </p>
                  {activeOpp.liveVerificationLog.sources.length > 0 && (
                    <ul className="pt-1 space-y-1">
                      {activeOpp.liveVerificationLog.sources.map((src, i) => (
                        <li key={i}>
                          <a
                            href={src.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-teal-800 hover:underline"
                          >
                            <span>{src.title}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {/* Editable Structured Fields */}
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <h3 className="text-base font-semibold text-slate-900 pb-2 border-b border-slate-200">
                  Editable Opportunity Record
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Application stage
                    </label>
                    <select
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.stage}
                      onChange={(e) =>
                        handleUpdateActiveField({
                          stage: e.target.value as OpportunityStage,
                        })
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {STAGES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Vacancy availability status
                    </label>
                    <select
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.openingAvailabilityStatus}
                      onChange={(e) =>
                        handleUpdateActiveField({
                          openingAvailabilityStatus:
                            e.target.value as Opportunity["openingAvailabilityStatus"],
                          dateLastVerified:
                            e.target.value === "Seen on official careers page"
                              ? getTodayIsoDate()
                              : activeOpp.dateLastVerified,
                        })
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Unverified">Unverified</option>
                      <option value="Seen on official careers page">
                        Seen on official careers page
                      </option>
                      <option value="No longer listed / Closed">
                        No longer listed / Closed
                      </option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Official employer website
                    </label>
                    <input
                      type="text"
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.officialWebsite}
                      onChange={(e) =>
                        handleUpdateActiveField({ officialWebsite: e.target.value })
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Official posting URL
                    </label>
                    <input
                      type="text"
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.postingUrl}
                      onChange={(e) =>
                        handleUpdateActiveField({ postingUrl: e.target.value })
                      }
                      placeholder="Attach current posting link"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Application URL
                    </label>
                    <input
                      type="text"
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.applicationUrl}
                      onChange={(e) =>
                        handleUpdateActiveField({ applicationUrl: e.target.value })
                      }
                      placeholder="Destination application URL"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Location & eligible states
                    </label>
                    <input
                      type="text"
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.location}
                      onChange={(e) =>
                        handleUpdateActiveField({ location: e.target.value })
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>

                {/* Compensation Fact vs Estimate */}
                <div className="pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Employer-published guaranteed base pay (blank = Unknown)
                    </label>
                    <input
                      type="text"
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.compensation.employerPublishedBase}
                      onChange={(e) =>
                        handleUpdateActiveField({
                          compensation: {
                            ...activeOpp.compensation,
                            employerPublishedBase: e.target.value,
                          },
                        })
                      }
                      placeholder="Unknown — confirm with employer"
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Employer-published variable / commission pay
                    </label>
                    <input
                      type="text"
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.compensation.employerPublishedVariable}
                      onChange={(e) =>
                        handleUpdateActiveField({
                          compensation: {
                            ...activeOpp.compensation,
                            employerPublishedVariable: e.target.value,
                          },
                        })
                      }
                      placeholder="Unknown / None"
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Documented benefits
                    </label>
                    <input
                      type="text"
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.compensation.benefitsDocumented}
                      onChange={(e) =>
                        handleUpdateActiveField({
                          compensation: {
                            ...activeOpp.compensation,
                            benefitsDocumented: e.target.value,
                          },
                        })
                      }
                      placeholder="Undocumented"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Third-party estimate (kept strictly separate)
                    </label>
                    <input
                      type="text"
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.compensation.thirdPartyEstimate}
                      onChange={(e) =>
                        handleUpdateActiveField({
                          compensation: {
                            ...activeOpp.compensation,
                            thirdPartyEstimate: e.target.value,
                          },
                        })
                      }
                      placeholder="Do not mix with employer-published base"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>

                {/* Next action & Notes */}
                <div className="pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Next action
                    </label>
                    <input
                      type="text"
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.nextAction}
                      onChange={(e) =>
                        handleUpdateActiveField({ nextAction: e.target.value })
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Next action target date
                    </label>
                    <input
                      type="date"
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.nextActionDueDate}
                      onChange={(e) =>
                        handleUpdateActiveField({ nextActionDueDate: e.target.value })
                      }
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Supplied job description / research notes
                    </label>
                    <textarea
                      rows={6}
                      disabled={Boolean(activeOpp.isSampleRecord)}
                      value={activeOpp.rawDescriptionText}
                      onChange={(e) =>
                        handleUpdateActiveField({ rawDescriptionText: e.target.value })
                      }
                      className="w-full p-3 text-xs leading-relaxed border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* SUB-VIEW 3: APPLICATION WORKSPACE (FEATURE 5) */}
          {workspaceTab === "application" && (
            <div className="space-y-6">
              {/* Guardrail Audit Banner: Newly Introduced Claims & Unresolved Placeholders */}
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      Truthful Application Workspace
                    </h3>
                    <p className="text-xs text-slate-600">
                      Every draft below is editable. Master Résumé stays untouched; separate snapshots are saved per opportunity.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isAiDrafting}
                    onClick={handleAiRefineCoverNote}
                    className="px-3.5 py-2 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg whitespace-nowrap shrink-0 self-start"
                  >
                    {isAiDrafting
                      ? "Generating grounded note..."
                      : "Regenerate Cover Note from Verified Claims"}
                  </button>
                </div>

                {draftReasoningMeta && (
                  <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs text-slate-700">
                    <div>
                      <strong>Reasoning:</strong> {draftReasoningMeta.reasoning}
                    </div>
                    <div>
                      <strong>Evidence used:</strong>{" "}
                      {draftReasoningMeta.evidenceUsed.join(" · ")}
                    </div>
                    {draftReasoningMeta.missingInformation.length > 0 && (
                      <div className="text-amber-900">
                        <strong>Missing info to resolve:</strong>{" "}
                        {draftReasoningMeta.missingInformation.join(" · ")}
                      </div>
                    )}
                  </div>
                )}

                {draftAudit.newlyIntroducedWarnings.length > 0 && (
                  <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-1.5">
                    <div className="text-xs font-semibold text-amber-950">
                      Newly Introduced Claim / Metric Highlighted for Review:
                    </div>
                    <ul className="text-xs text-amber-900 list-disc pl-4 space-y-1">
                      {draftAudit.newlyIntroducedWarnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {draftAudit.unresolvedPlaceholders.length > 0 && (
                  <div className="bg-slate-50 border border-slate-300 rounded-lg p-3.5 text-xs text-slate-800">
                    <strong>Unresolved placeholders ({draftAudit.unresolvedPlaceholders.length}):</strong>{" "}
                    <span className="font-mono">{draftAudit.unresolvedPlaceholders.join(", ")}</span>{" "}
                    — final export and “Mark Submitted” remain locked until placeholders are replaced with real values.
                  </div>
                )}

                {exportBlockedError && (
                  <div className="bg-red-50 border border-red-300 rounded-lg p-3.5 text-xs font-medium text-red-900">
                    {exportBlockedError}
                  </div>
                )}
              </section>

              {/* Editable Draft Sections */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                  <label className="block text-sm font-semibold text-slate-900">
                    1. Tailored Résumé Version (Separate from Master Résumé)
                  </label>
                  <textarea
                    rows={14}
                    value={tailoredResume}
                    onChange={(e) => setTailoredResume(e.target.value)}
                    className="w-full p-3 text-xs font-mono leading-relaxed border border-slate-300 rounded-lg bg-white"
                  />
                </section>

                <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                  <label className="block text-sm font-semibold text-slate-900">
                    2. Short Truthful Cover Note
                  </label>
                  <textarea
                    rows={14}
                    value={coverNote}
                    onChange={(e) => setCoverNote(e.target.value)}
                    className="w-full p-3 text-xs leading-relaxed border border-slate-300 rounded-lg bg-white"
                  />
                </section>

                <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                  <label className="block text-sm font-semibold text-slate-900">
                    3. Evidence-Based “Why This Role” Answer
                  </label>
                  <textarea
                    rows={6}
                    value={whyThisRole}
                    onChange={(e) => setWhyThisRole(e.target.value)}
                    className="w-full p-3 text-xs leading-relaxed border border-slate-300 rounded-lg bg-white"
                  />
                </section>

                <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                  <label className="block text-sm font-semibold text-slate-900">
                    4. Application Question Drafts (Including Honest Gap Framing)
                  </label>
                  <textarea
                    rows={6}
                    value={appQuestions}
                    onChange={(e) => setAppQuestions(e.target.value)}
                    className="w-full p-3 text-xs leading-relaxed border border-slate-300 rounded-lg bg-white"
                  />
                </section>

                <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                  <label className="block text-sm font-semibold text-slate-900">
                    5. Interview Talking Points & Questions to Ask Employer
                  </label>
                  <textarea
                    rows={5}
                    value={talkingPoints}
                    onChange={(e) => setTalkingPoints(e.target.value)}
                    className="w-full p-3 text-xs leading-relaxed border border-slate-300 rounded-lg bg-white"
                  />
                </section>
              </div>

              {/* Submission Checklist, Version Saver & Export */}
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <h3 className="text-base font-semibold text-slate-900">
                  Pre-Submission Checklist & Version Log
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-800">
                  {[
                    {
                      key: "verifiedAllClaims",
                      label: "Every experience claim matches my verified background.",
                    },
                    {
                      key: "noInventedMetrics",
                      label: "Zero invented numbers, percentages, or client counts.",
                    },
                    {
                      key: "noTrainingImpliedAsWork",
                      label: "Self-study or simulation practice is never implied to be paid work experience.",
                    },
                    {
                      key: "employerDestinationChecked",
                      label: "Application URL matches the employer's official site or verified ATS.",
                    },
                  ].map((item) => (
                    <label key={item.key} className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checklist[item.key as keyof typeof checklist]}
                        onChange={(e) =>
                          setChecklist({
                            ...checklist,
                            [item.key]: e.target.checked,
                          })
                        }
                        className="mt-0.5 rounded border-slate-300 text-teal-800"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>

                <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="w-full sm:w-72">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Version label
                    </label>
                    <input
                      type="text"
                      value={versionLabel}
                      onChange={(e) => setVersionLabel(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {!activeOpp.isSampleRecord && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSaveSnapshot(false)}
                          className="px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          Save Draft Version
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveSnapshot(true)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0"
                        >
                          <FileCheck2 className="w-3.5 h-3.5" />
                          <span>Record as Submitted Today</span>
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={handleExportPacket}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export Final .txt Packet</span>
                    </button>
                  </div>
                </div>

                {oppVersions.length > 0 && (
                  <div className="pt-4 border-t border-slate-200 space-y-2">
                    <div className="text-xs font-semibold text-slate-800">
                      Saved Versions for {activeOpp.employer} ({oppVersions.length}):
                    </div>
                    <ul className="divide-y divide-slate-100 text-xs">
                      {oppVersions.map((ver) => (
                        <li
                          key={ver.id}
                          className="py-2 flex flex-wrap items-center justify-between gap-2"
                        >
                          <div>
                            <strong className="text-slate-900">{ver.versionLabel}</strong> ·{" "}
                            <span className="font-mono tabular-nums text-slate-500">
                              {new Date(ver.createdAt).toLocaleDateString()}
                            </span>{" "}
                            ·{" "}
                            <span
                              className={
                                ver.submitted
                                  ? "text-teal-900 font-semibold"
                                  : "text-slate-600"
                              }
                            >
                              {ver.submitted
                                ? `Submitted on ${ver.submittedDate}`
                                : "Draft snapshot"}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setTailoredResume(ver.tailoredResumeText);
                              setCoverNote(ver.coverNoteText);
                              setWhyThisRole(ver.whyThisRoleText);
                              setAppQuestions(ver.applicationQuestionsText);
                              setTalkingPoints(ver.interviewTalkingPoints);
                              flashBanner(`Loaded ${ver.versionLabel} into editor.`);
                            }}
                            className="text-teal-800 hover:underline font-medium"
                          >
                            Load into editor
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
