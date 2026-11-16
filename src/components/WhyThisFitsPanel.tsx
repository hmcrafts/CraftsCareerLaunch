import React, { useMemo, useState } from "react";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { Evidence, Opportunity, WorkspaceState } from "../types/models";
import {
  RelationshipCandidateInput,
  RequirementGraphSupportKind,
  ResolvedRelationshipEdge,
  explainOpportunityFitWithGraph,
} from "../utils/relationshipGraphEngine";
import {
  RelationshipInspectorPanel,
  formatRelationshipStatusLabel,
  formatRelationshipVerb,
} from "./RelationshipInspectorPanel";

interface WhyThisFitsPanelProps {
  opportunity: Opportunity;
  workspace: WorkspaceState;
  ownerUid: string;
  onSaveRelationship?: (
    candidate: RelationshipCandidateInput,
    options?: { mode?: "create" | "update"; explicitNewEvidence?: boolean }
  ) => Promise<{ ok: boolean; error?: string }>;
  onOpenSkillsWorthDeveloping?: () => void;
  onOpenConnections?: () => void;
}

function formatSupportKindHeading(kind: RequirementGraphSupportKind): {
  label: string;
  toneClass: string;
} {
  switch (kind) {
    case "verified_experience":
      return {
        label: "Verified experience path",
        toneClass: "text-teal-900 font-semibold",
      };
    case "transferable_experience":
      return {
        label: "Transferable experience path",
        toneClass: "text-teal-800 font-semibold",
      };
    case "training_only_not_experience":
      return {
        label: "Training / rehearsal only (not job experience)",
        toneClass: "text-amber-900 font-semibold",
      };
    case "suggested_unverified":
      return {
        label: "Unverified suggestion (path incomplete)",
        toneClass: "text-amber-900 font-semibold",
      };
    case "gap_incomplete_path":
      return {
        label: "Incomplete path — open gap",
        toneClass: "text-slate-700 font-semibold",
      };
  }
}

export const WhyThisFitsPanel: React.FC<WhyThisFitsPanelProps> = ({
  opportunity,
  workspace,
  ownerUid,
  onSaveRelationship,
  onOpenSkillsWorthDeveloping,
  onOpenConnections,
}) => {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<
    "all" | "Required" | "Preferred"
  >("all");

  const explanation = useMemo(
    () => explainOpportunityFitWithGraph(opportunity, workspace, ownerUid),
    [opportunity, workspace, ownerUid]
  );

  // Build lookup map of all edges referenced on this opportunity page so selecting any edge inspects live state
  const allReferencedEdges = useMemo(() => {
    const map = new Map<string, ResolvedRelationshipEdge>();
    for (const rp of explanation.requirementPaths) {
      for (const e of rp.supportingEdges) {
        map.set(e.id, e);
      }
      for (const t of rp.trainingEdges) {
        map.set(t.id, t);
      }
    }
    for (const ec of explanation.employerContacts) {
      map.set(ec.edge.id, ec.edge);
    }
    return map;
  }, [explanation]);

  const selectedEdge = selectedEdgeId
    ? allReferencedEdges.get(selectedEdgeId) ?? null
    : null;

  const filteredPaths = useMemo(() => {
    if (priorityFilter === "all") return explanation.requirementPaths;
    return explanation.requirementPaths.filter(
      (p) => p.priority === priorityFilter
    );
  }, [explanation.requirementPaths, priorityFilter]);

  const accessibleEvidenceList: Evidence[] = workspace.evidence || [];

  return (
    <section
      aria-labelledby="why-this-fits-heading"
      className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
    >
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="space-y-1">
          <div className="text-xs text-slate-500">
            Evidence Relationship Graph · Private to your workspace
          </div>
          <h3
            id="why-this-fits-heading"
            className="text-lg font-bold text-slate-900"
          >
            Why this fits — Traceable Evidence & Gaps
          </h3>
          <p className="text-xs sm:text-sm text-slate-600 max-w-3xl leading-relaxed">
            Every qualification below shows its exact evidence chain in your workspace or states clearly where the path is incomplete. Select any relationship link to inspect its source document and verification status.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onOpenSkillsWorthDeveloping && (
            <button
              type="button"
              onClick={onOpenSkillsWorthDeveloping}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <span>Skills Worth Developing</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {onOpenConnections && (
            <button
              type="button"
              onClick={onOpenConnections}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-900 border border-teal-800/30 bg-teal-50/50 rounded-lg hover:bg-teal-50 whitespace-nowrap shrink-0"
            >
              <span>Explore All Connections</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Unboxed KPI Strip with strict tabular numerals (Zero fake scores) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pb-4 border-b border-slate-200">
        <div>
          <div className="text-xs text-slate-500">
            Required backed by experience
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">
            {explanation.counts.requiredVerified} / {explanation.counts.requiredTotal}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">
            Required with training only
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-amber-900">
            {explanation.counts.requiredTrainingOnly}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">
            Required incomplete / gaps
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-800">
            {explanation.counts.requiredIncompleteOrGap}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">
            Preferred backed by experience
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">
            {explanation.counts.preferredVerified} / {explanation.counts.preferredTotal}
          </div>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter requirements by priority"
          className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg"
        >
          {(["all", "Required", "Preferred"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setPriorityFilter(tab)}
              className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                priorityFilter === tab
                  ? "bg-white text-slate-950 font-semibold shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab === "all"
                ? `All Qualifications (${explanation.requirementPaths.length})`
                : `${tab} (${
                    tab === "Required"
                      ? explanation.counts.requiredTotal
                      : explanation.counts.preferredTotal
                  })`}
            </button>
          ))}
        </div>

        <span className="text-xs text-slate-500">
          Select any relationship button below to view source verification
        </span>
      </div>

      {/* Selected Relationship Inspector */}
      {selectedEdge && (
        <RelationshipInspectorPanel
          edge={selectedEdge}
          workspaceEvidence={accessibleEvidenceList}
          readOnly={Boolean(opportunity.isSampleRecord)}
          onSaveRelationship={onSaveRelationship}
          onClose={() => setSelectedEdgeId(null)}
        />
      )}

      {/*Accessible Requirement-to-Evidence Path List */}
      {filteredPaths.length === 0 ? (
        <p className="text-sm text-slate-600 py-4">
          No qualifications listed in this category yet. Add required or preferred qualifications below to map them against your evidence.
        </p>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-700">
                <th className="py-3 px-4 font-semibold">Qualification</th>
                <th className="py-3 px-4 font-semibold whitespace-nowrap">
                  Priority
                </th>
                <th className="py-3 px-4 font-semibold">Path State</th>
                <th className="py-3 px-4 font-semibold">
                  Traceable Evidence Chain & Selectable Relationships
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredPaths.map((item) => {
                const heading = formatSupportKindHeading(item.supportKind);
                return (
                  <tr
                    key={item.requirementId}
                    className="align-top hover:bg-slate-50/60"
                  >
                    <td className="py-3.5 px-4 font-medium text-slate-900 max-w-xs">
                      <div>{item.requirementText}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Mapped skill:{" "}
                        {item.skills.map((s) => s.label).join(", ")}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium text-slate-700 whitespace-nowrap">
                      {item.priority}
                    </td>
                    <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                      <div className={heading.toneClass}>{heading.label}</div>
                      <div className="text-slate-500 mt-0.5">
                        {item.pathComplete
                          ? "Complete verified path"
                          : "Path incomplete"}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-700 space-y-2 max-w-xl">
                      <p className="leading-relaxed">{item.pathSummary}</p>

                      {item.honestyNote && (
                        <p className="text-amber-900 leading-relaxed">
                          {item.honestyNote}
                        </p>
                      )}

                      {item.supportingEdges.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {item.supportingEdges.map((edge) => {
                            const isSelected = selectedEdgeId === edge.id;
                            return (
                              <button
                                key={edge.id}
                                type="button"
                                onClick={() =>
                                  setSelectedEdgeId(
                                    isSelected ? null : edge.id
                                  )
                                }
                                className={`px-2.5 py-1 text-left rounded-md border text-xs transition-colors ${
                                  isSelected
                                    ? "bg-teal-900 text-white border-teal-900 font-medium"
                                    : "bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200"
                                }`}
                              >
                                <span>
                                  {edge.sourceLabel.slice(0, 32)}
                                  {edge.sourceLabel.length > 32 ? "…" : ""} →{" "}
                                  {formatRelationshipVerb(edge.relationshipType)}{" "}
                                  → {edge.targetLabel.slice(0, 28)}
                                  {edge.targetLabel.length > 28 ? "…" : ""}
                                </span>
                                <span
                                  className={`ml-1.5 ${
                                    isSelected
                                      ? "text-teal-100"
                                      : "text-slate-500"
                                  }`}
                                >
                                  · {formatRelationshipStatusLabel(edge.effectiveStatus)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Employer Affiliations & Opportunity-Scoped Safety Context */}
      <div className="pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
        <div className="space-y-2">
          <h4 className="font-semibold text-slate-900">
            Workspace Contacts & Employer Affiliations ({explanation.employerName})
          </h4>
          {explanation.employerContacts.length === 0 ? (
            <p className="text-slate-600 leading-relaxed">
              No contacts in your private workspace currently list{" "}
              <strong>{explanation.employerName}</strong>. Career Launch never invents contacts or referrals.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
              {explanation.employerContacts.map((ec) => (
                <li
                  key={ec.contactId}
                  className="p-3 flex items-start justify-between gap-3"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold text-slate-900">
                      {ec.contactName} · {ec.role}
                    </div>
                    <div
                      className={
                        ec.isConfirmedEmployment
                          ? "text-teal-900"
                          : "text-amber-900"
                      }
                    >
                      {ec.verificationLabel}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedEdgeId(
                        selectedEdgeId === ec.edge.id ? null : ec.edge.id
                      )
                    }
                    className="px-2.5 py-1 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    Inspect source
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <h4 className="font-semibold text-slate-900 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-slate-700 shrink-0" />
            <span>Posting Authenticity & Review Scope</span>
          </h4>
          <p className="text-slate-700 leading-relaxed">
            Vacancy check:{" "}
            <strong>{explanation.safetyReviewContext.openingAvailabilityStatus}</strong>
            .{" "}
            {explanation.safetyReviewContext.authenticityFlags.length > 0
              ? `Flagged items tied to this review: ${explanation.safetyReviewContext.authenticityFlags.join(
                  "; "
                )}.`
              : "No red-flag solicitation patterns detected in saved posting text."}
          </p>
          <p className="text-slate-500 leading-relaxed">
            {explanation.safetyReviewContext.isolationDisclosure}
          </p>
        </div>
      </div>
    </section>
  );
};
