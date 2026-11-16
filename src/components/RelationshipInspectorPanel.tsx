import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, X, XCircle } from "lucide-react";
import {
  Evidence,
  RelationshipOrigin,
  RelationshipStatus,
  RelationshipType,
} from "../types/models";
import {
  RelationshipCandidateInput,
  ResolvedRelationshipEdge,
} from "../utils/relationshipGraphEngine";

interface RelationshipInspectorPanelProps {
  edge: ResolvedRelationshipEdge;
  workspaceEvidence: Evidence[];
  readOnly?: boolean;
  onSaveRelationship?: (
    candidate: RelationshipCandidateInput,
    options?: { mode?: "create" | "update"; explicitNewEvidence?: boolean }
  ) => Promise<{ ok: boolean; error?: string }>;
  onClose?: () => void;
}

export function formatRelationshipVerb(rel: RelationshipType): string {
  switch (rel) {
    case "demonstrates":
      return "demonstrates";
    case "supports":
      return "supports";
    case "has_requirement":
      return "has requirement";
    case "requires":
      return "requires";
    case "teaches":
      return "teaches (training only)";
    case "claims_affiliation_with":
      return "claims affiliation with (unverified)";
    case "confirmed_affiliation_with":
      return "confirmed affiliation with";
    case "offered_by":
      return "offered by";
    case "adjacent_to":
      return "adjacent to";
  }
}

export function formatRelationshipOrigin(origin: RelationshipOrigin): string {
  switch (origin) {
    case "user":
      return "User recorded";
    case "document_extraction":
      return "Document / profile extraction";
    case "ai_suggestion":
      return "AI suggestion (requires verification)";
  }
}

export function formatRelationshipStatusLabel(status: RelationshipStatus): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "suggested":
      return "Suggested (unverified)";
    case "rejected":
      return "Rejected";
  }
}

export const RelationshipInspectorPanel: React.FC<RelationshipInspectorPanelProps> = ({
  edge,
  workspaceEvidence,
  readOnly = false,
  onSaveRelationship,
  onClose,
}) => {
  const [selectedNewEvidenceId, setSelectedNewEvidenceId] = useState<string>("");
  const [actionFeedback, setActionFeedback] = useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const priorRejectedIds = useMemo(
    () => new Set(edge.rejectedEvidenceIds || []),
    [edge.rejectedEvidenceIds]
  );

  // Eligible workspace evidence for attaching or reconsidering a rejected suggestion
  const eligibleNewEvidence = useMemo(() => {
    return workspaceEvidence.filter((ev) => {
      if (ev.category === "not_yet_demonstrated") return false;
      if (
        edge.sourceType === "experience" &&
        edge.relationshipType === "demonstrates" &&
        (ev.category === "training_in_progress" ||
          ev.category === "completed_training")
      ) {
        return false;
      }
      if (edge.effectiveStatus === "rejected") {
        return !priorRejectedIds.has(ev.id);
      }
      return !edge.evidenceIds.includes(ev.id);
    });
  }, [
    workspaceEvidence,
    edge.sourceType,
    edge.relationshipType,
    edge.effectiveStatus,
    edge.evidenceIds,
    priorRejectedIds,
  ]);

  const isClaimedAffiliation =
    edge.relationshipType === "claims_affiliation_with";
  const isLearningEdge =
    edge.sourceType === "learning" || edge.relationshipType === "teaches";

  const hasVerifiedSupportAttached = edge.accessibleEvidence.some(
    (ev) =>
      ev.verificationStatus === "Confirmed by Nora" ||
      ev.verificationStatus === "Supported by uploaded document"
  );

  const canConfirmDirectly =
    !readOnly &&
    Boolean(onSaveRelationship) &&
    !isClaimedAffiliation &&
    edge.effectiveStatus !== "rejected" &&
    (edge.relationshipType === "has_requirement" ||
      edge.relationshipType === "requires" ||
      edge.relationshipType === "teaches" ||
      edge.relationshipType === "offered_by" ||
      edge.relationshipType === "confirmed_affiliation_with" ||
      hasVerifiedSupportAttached);

  const handleStatusChange = async (
    nextStatus: RelationshipStatus,
    explicitNewEvidence = false,
    extraEvidenceId?: string
  ) => {
    if (!onSaveRelationship || readOnly) return;
    setIsSaving(true);
    setActionFeedback(null);

    const nextEvidenceIds = Array.from(
      new Set([
        ...edge.evidenceIds,
        ...(extraEvidenceId ? [extraEvidenceId] : []),
      ])
    );

    const res = await onSaveRelationship(
      {
        userId: edge.userId,
        sourceType: edge.sourceType,
        sourceId: edge.sourceId,
        sourceLabel: edge.sourceLabel,
        targetType: edge.targetType,
        targetId: edge.targetId,
        targetLabel: edge.targetLabel,
        relationshipType: edge.relationshipType,
        requirementPriority: edge.requirementPriority,
        evidenceIds: nextEvidenceIds,
        rejectedEvidenceIds: edge.rejectedEvidenceIds,
        status: nextStatus,
        origin: edge.origin,
        explanationNote: edge.explanationNote,
      },
      {
        mode: "update",
        explicitNewEvidence,
      }
    );

    setIsSaving(false);
    if (res.ok) {
      setSelectedNewEvidenceId("");
      setActionFeedback({
        tone: "ok",
        text:
          nextStatus === "rejected"
            ? "Marked as rejected. It will stay rejected unless you explicitly attach new supporting evidence."
            : nextStatus === "confirmed"
            ? "Relationship confirmed and saved to your private workspace."
            : "Relationship updated as a suggestion.",
      });
    } else {
      setActionFeedback({
        tone: "err",
        text: res.error || "Unable to update relationship.",
      });
    }
  };

  return (
    <section
      aria-label="Selected relationship sources and verification state"
      className="bg-white border border-slate-300 rounded-xl p-5 space-y-4"
    >
      <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-200">
        <div className="space-y-1">
          <div className="text-xs text-slate-500">
            Selected Relationship · Verification & Evidence Inspector
          </div>
          <h4 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
            <span>{edge.sourceLabel}</span>{" "}
            <span className="text-teal-800 font-semibold">
              → {formatRelationshipVerb(edge.relationshipType)} →
            </span>{" "}
            <span>{edge.targetLabel}</span>
          </h4>
          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Source type: <strong className="text-slate-800">{edge.sourceType}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Destination type:{" "}
              <strong className="text-slate-800">{edge.targetType}</strong>
            </span>
            {edge.requirementPriority !== "N/A" && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Requirement priority:{" "}
                  <strong className="text-slate-800">
                    {edge.requirementPriority}
                  </strong>
                </span>
              </>
            )}
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md shrink-0"
            aria-label="Close relationship inspector"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Verification State, Origin & Timestamps */}
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pb-3 border-b border-slate-200">
        <div>
          <dt className="text-slate-500">Verification status</dt>
          <dd
            className={`mt-0.5 font-semibold ${
              edge.effectiveStatus === "confirmed"
                ? "text-teal-900"
                : edge.effectiveStatus === "rejected"
                ? "text-red-800"
                : "text-amber-900"
            }`}
          >
            {formatRelationshipStatusLabel(edge.effectiveStatus)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Relationship origin</dt>
          <dd className="mt-0.5 font-medium text-slate-800">
            {formatRelationshipOrigin(edge.origin)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Recorded / updated</dt>
          <dd className="mt-0.5 font-mono tabular-nums text-slate-700">
            {edge.updatedAtIso ? edge.updatedAtIso.slice(0, 10) : "Derived live"}
          </dd>
        </div>
      </dl>

      {/* Domain Honesty Safeguard Notices */}
      {isClaimedAffiliation && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <strong>Unverified affiliation:</strong> “Claims affiliation with” records an unverified statement or profile note. It is never treated as confirmed employment until you independently verify the contact’s role.
          </div>
        </div>
      )}

      {isLearningEdge && (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800">
          <strong>Training boundary:</strong> Learning activities and coursework teach foundational concepts (`learning → teaches → skill`). They are never turned into claimed professional job experience.
        </div>
      )}

      {/* Traceable Supporting Sources & Verification State */}
      <div className="space-y-2">
        <h5 className="text-xs font-semibold text-slate-900">
          Supporting Evidence & Source Verification (
          <span className="font-mono tabular-nums">
            {edge.accessibleEvidence.length + edge.accessibleDocuments.length}
          </span>
          )
        </h5>

        {!edge.evidencePathComplete && edge.incompleteReason && (
          <p className="text-xs text-amber-900 bg-amber-50/70 border border-amber-200 rounded-lg px-3 py-2">
            <strong>Incomplete path:</strong> {edge.incompleteReason}
          </p>
        )}

        {edge.accessibleEvidence.length === 0 &&
        edge.accessibleDocuments.length === 0 ? (
          <p className="text-xs text-slate-600">
            {edge.explanationNote ||
              "No direct Evidence Library item is attached to this relationship."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
            {edge.accessibleEvidence.map((ev) => (
              <li key={ev.id} className="p-3 text-xs space-y-1">
                <div className="font-medium text-slate-900">{ev.claimText}</div>
                <div className="text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span>
                    Source:{" "}
                    <strong className="text-slate-800">
                      {ev.sourceDocumentOrConfirmation}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Verification:{" "}
                    <strong
                      className={
                        ev.verificationStatus === "Needs clarification"
                          ? "text-amber-900"
                          : "text-teal-900"
                      }
                    >
                      {ev.verificationStatus}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Added {ev.dateAdded}
                  </span>
                </div>
              </li>
            ))}
            {edge.accessibleDocuments.map((docMeta) => (
              <li
                key={docMeta.id}
                className="p-3 text-xs flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 text-slate-800">
                  <FileText className="w-3.5 h-3.5 text-teal-800 shrink-0" />
                  <span>
                    Private uploaded file:{" "}
                    <strong>{docMeta.fileName}</strong> ({docMeta.docCategory})
                  </span>
                </div>
                <span className="font-mono tabular-nums text-slate-500">
                  {docMeta.createdAtIso.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {actionFeedback && (
        <div
          role="status"
          className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 ${
            actionFeedback.tone === "ok"
              ? "bg-teal-50 border border-teal-200 text-teal-950"
              : "bg-red-50 border border-red-200 text-red-950"
          }`}
        >
          {actionFeedback.tone === "ok" ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-teal-800 shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-700 shrink-0" />
          )}
          <span>{actionFeedback.text}</span>
        </div>
      )}

      {/* Interactive Governance Controls */}
      {!readOnly && onSaveRelationship && (
        <div className="pt-3 border-t border-slate-200 space-y-3">
          {edge.effectiveStatus === "rejected" ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-700">
                <strong>Rejected suggestion lock:</strong> This relationship stays rejected unless you explicitly introduce new accessible evidence from your workspace that was not part of the rejected state.
              </p>
              {eligibleNewEvidence.length > 0 ? (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <select
                    aria-label="Select new accessible evidence to reconsider relationship"
                    value={selectedNewEvidenceId}
                    onChange={(e) => setSelectedNewEvidenceId(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
                  >
                    <option value="">
                      Select new supporting evidence to reconsider...
                    </option>
                    {eligibleNewEvidence.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.claimText.slice(0, 76)} ({ev.verificationStatus})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedNewEvidenceId || isSaving}
                    onClick={() =>
                      handleStatusChange("suggested", true, selectedNewEvidenceId)
                    }
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Reconsider with New Evidence
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  Add a new verified evidence record in My Profile first if you later obtain proof for this connection.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {edge.effectiveStatus !== "confirmed" && (
                  <button
                    type="button"
                    disabled={!canConfirmDirectly || isSaving}
                    onClick={() => handleStatusChange("confirmed", false)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 disabled:opacity-45 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Confirm Relationship
                  </button>
                )}

                {edge.effectiveStatus === "confirmed" && (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleStatusChange("suggested", false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Mark as Suggestion
                  </button>
                )}

                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => handleStatusChange("rejected", false)}
                  className="px-3 py-1.5 text-xs font-medium text-red-800 border border-red-200 hover:bg-red-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  Reject Suggestion
                </button>
              </div>

              {!canConfirmDirectly && !isClaimedAffiliation && (
                <span className="text-xs text-slate-500">
                  Attach confirmed evidence below before confirming.
                </span>
              )}
            </div>
          )}

          {/* Attach additional accessible evidence when active */}
          {edge.effectiveStatus !== "rejected" &&
            eligibleNewEvidence.length > 0 &&
            !isClaimedAffiliation && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                <select
                  aria-label="Attach supporting evidence from your workspace"
                  value={selectedNewEvidenceId}
                  onChange={(e) => setSelectedNewEvidenceId(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
                >
                  <option value="">
                    Attach additional workspace evidence...
                  </option>
                  {eligibleNewEvidence.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.claimText.slice(0, 76)} ({ev.verificationStatus})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!selectedNewEvidenceId || isSaving}
                  onClick={() =>
                    handleStatusChange(
                      edge.effectiveStatus,
                      true,
                      selectedNewEvidenceId
                    )
                  }
                  className="px-3 py-1.5 text-xs font-medium text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  Attach Evidence
                </button>
              </div>
            )}
        </div>
      )}
    </section>
  );
};
