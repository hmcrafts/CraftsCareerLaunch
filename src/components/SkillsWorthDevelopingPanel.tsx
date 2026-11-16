import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Plus } from "lucide-react";
import { LearningItem, WorkspaceState } from "../types/models";
import {
  PrioritizedSkillRecommendation,
  prioritizeSkillsAcrossSavedOpportunities,
} from "../utils/relationshipGraphEngine";

interface SkillsWorthDevelopingPanelProps {
  workspace: WorkspaceState;
  ownerUid: string;
  onSelectOpportunity?: (opportunityId: string) => void;
  onAddLearningItem?: (item: Omit<LearningItem, "id">) => Promise<boolean> | void;
  onOpenLearningPlanTab?: () => void;
}

function formatCoverageState(
  state: PrioritizedSkillRecommendation["coverageState"]
): { label: string; toneClass: string } {
  switch (state) {
    case "gap":
      return {
        label: "Open gap (no experience or study yet)",
        toneClass: "text-amber-900 font-semibold",
      };
    case "training_only_not_experience":
      return {
        label: "In training / study only (not paid experience)",
        toneClass: "text-teal-900 font-semibold",
      };
    case "unverified_suggestion":
      return {
        label: "Unverified note (needs confirmation)",
        toneClass: "text-amber-900 font-semibold",
      };
    case "demonstrated_experience":
      return {
        label: "Demonstrated in verified experience",
        toneClass: "text-slate-800 font-medium",
      };
    case "transferable_experience":
      return {
        label: "Supported by transferable experience",
        toneClass: "text-slate-800 font-medium",
      };
  }
}

export const SkillsWorthDevelopingPanel: React.FC<
  SkillsWorthDevelopingPanelProps
> = ({
  workspace,
  ownerUid,
  onSelectOpportunity,
  onAddLearningItem,
  onOpenLearningPlanTab,
}) => {
  const [filterMode, setFilterMode] = useState<
    "worth_developing" | "demonstrated" | "all"
  >("worth_developing");
  const [expandedSkillIds, setExpandedSkillIds] = useState<Record<string, boolean>>(
    {}
  );
  const [addedNotice, setAddedNotice] = useState<string | null>(null);

  const recommendations = useMemo(
    () => prioritizeSkillsAcrossSavedOpportunities(workspace, ownerUid),
    [workspace, ownerUid]
  );

  const activeSavedOppCount = useMemo(
    () =>
      (workspace.opportunities || []).filter(
        (o) => !o.archived && !o.isSampleRecord
      ).length,
    [workspace.opportunities]
  );

  const worthCount = useMemo(
    () => recommendations.filter((r) => r.worthDeveloping).length,
    [recommendations]
  );
  const demonstratedCount = useMemo(
    () => recommendations.filter((r) => !r.worthDeveloping).length,
    [recommendations]
  );

  const filtered = useMemo(() => {
    if (filterMode === "worth_developing") {
      return recommendations.filter((r) => r.worthDeveloping);
    }
    if (filterMode === "demonstrated") {
      return recommendations.filter((r) => !r.worthDeveloping);
    }
    return recommendations;
  }, [recommendations, filterMode]);

  const toggleExpanded = (skillId: string) => {
    setExpandedSkillIds((prev) => ({
      ...prev,
      [skillId]: !(prev[skillId] ?? true),
    }));
  };

  const handleQuickAddStudyItem = async (rec: PrioritizedSkillRecommendation) => {
    if (!onAddLearningItem) return;
    const firstOpp = rec.opportunities[0];
    const firstReq = firstOpp?.matchingRequirements[0];
    const tiedLabel = firstOpp
      ? `${firstOpp.employer} (${firstOpp.title}) — ${
          firstReq ? firstReq.requirementText : rec.skillLabel
        }`
      : rec.skillLabel;

    await onAddLearningItem({
      title: `Focused fundamentals: ${rec.skillLabel}`,
      tiedToRequirement: tiedLabel,
      linkedOpportunityId: firstOpp?.opportunityId,
      status: "Planned",
      estimatedHours: 2,
      practicalExercise: `Review core workflows for ${rec.skillLabel} across ${rec.totalOpportunityCount} saved ${
        rec.totalOpportunityCount === 1 ? "opportunity" : "opportunities"
      } (${rec.requiredOpportunityCount} Required, ${rec.preferredOpportunityCount} Preferred) and practice explaining your approach in plain English.`,
      honestFramingNote:
        "Teaches foundational concepts only — describe as self-directed preparation, never as prior paid work experience.",
    });

    setAddedNotice(
      `Added "${rec.skillLabel}" to your Learning Plan. Training teaches foundational concepts and is never recorded as job experience.`
    );
  };

  return (
    <section
      aria-labelledby="skills-worth-developing-heading"
      className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
    >
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="space-y-1">
          <div className="text-xs text-slate-500">
            Evidence Relationship Graph · Aggregated across{" "}
            <span className="font-mono tabular-nums font-semibold text-slate-800">
              {activeSavedOppCount}
            </span>{" "}
            active saved{" "}
            {activeSavedOppCount === 1 ? "opportunity" : "opportunities"}
          </div>
          <h2
            id="skills-worth-developing-heading"
            className="text-lg sm:text-xl font-bold text-slate-900"
          >
            Skills Worth Developing
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 max-w-3xl leading-relaxed">
            Prioritizes skills requested by your real saved opportunities, separates{" "}
            <strong>Required</strong> from <strong>Preferred</strong> qualifications, and lists the exact saved opportunities behind every count. Coursework and practice remain labeled as learning activities rather than claimed job experience.
          </p>
        </div>

        <div
          role="group"
          aria-label="Filter skills across saved opportunities"
          className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start shrink-0"
        >
          <button
            type="button"
            onClick={() => setFilterMode("worth_developing")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              filterMode === "worth_developing"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Worth Developing ({worthCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode("demonstrated")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              filterMode === "demonstrated"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Demonstrated ({demonstratedCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              filterMode === "all"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            All Skills ({recommendations.length})
          </button>
        </div>
      </div>

      {addedNotice && (
        <div
          role="status"
          className="px-4 py-2.5 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-950 flex items-center justify-between gap-3"
        >
          <span>{addedNotice}</span>
          {onOpenLearningPlanTab && (
            <button
              type="button"
              onClick={onOpenLearningPlanTab}
              className="font-semibold text-teal-900 hover:underline whitespace-nowrap shrink-0"
            >
              View Learning Plan
            </button>
          )}
        </div>
      )}

      {activeSavedOppCount === 0 ? (
        <div className="py-6 text-sm text-slate-600">
          You have no active saved opportunities yet. Save one or more job postings in{" "}
          <strong>Find & Evaluate</strong> to see which skills appear most often and which opportunities require them.
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-6 text-sm text-slate-600">
          {filterMode === "worth_developing"
            ? "Every skill mapped in your current saved opportunities is already backed by verified experience. Switch to 'All Skills' to inspect the full breakdown."
            : "No skills match this filter yet."}
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-700">
                <th className="py-3 px-4 font-semibold">Skill</th>
                <th className="py-3 px-4 font-semibold whitespace-nowrap">
                  Saved Opportunities
                </th>
                <th className="py-3 px-4 font-semibold whitespace-nowrap">
                  Required vs. Preferred
                </th>
                <th className="py-3 px-4 font-semibold">
                  Current Workspace Coverage
                </th>
                <th className="py-3 px-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((rec) => {
                const isExpanded = expandedSkillIds[rec.skillId] ?? true;
                const cov = formatCoverageState(rec.coverageState);
                return (
                  <React.Fragment key={rec.skillId}>
                    <tr className="align-top hover:bg-slate-50/60">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(rec.skillId)}
                          aria-expanded={isExpanded}
                          className="inline-flex items-start gap-1.5 text-left hover:text-teal-900"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                          )}
                          <span>{rec.skillLabel}</span>
                        </button>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                        {rec.totalOpportunityCount}{" "}
                        <span className="font-sans font-normal text-xs text-slate-500">
                          {rec.totalOpportunityCount === 1
                            ? "opportunity"
                            : "opportunities"}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          {rec.requiredOpportunityCount}
                        </span>{" "}
                        <span className="text-slate-600">Required</span>
                        <span className="mx-1.5 text-slate-300">·</span>
                        <span className="font-mono tabular-nums font-semibold text-slate-800">
                          {rec.preferredOpportunityCount}
                        </span>{" "}
                        <span className="text-slate-600">Preferred</span>
                      </td>
                      <td className="py-3.5 px-4 text-xs max-w-md space-y-1">
                        <div className={cov.toneClass}>{cov.label}</div>
                        <p className="text-slate-600 leading-relaxed">
                          {rec.coverageExplanation}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                        {rec.worthDeveloping &&
                        rec.linkedLearningItems.length === 0 &&
                        onAddLearningItem ? (
                          <button
                            type="button"
                            onClick={() => handleQuickAddStudyItem(rec)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-teal-900 border border-teal-800/30 bg-teal-50/50 hover:bg-teal-50 rounded-lg whitespace-nowrap"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add to Learning Plan</span>
                          </button>
                        ) : rec.linkedLearningItems.length > 0 ? (
                          <span className="text-slate-600">
                            In Learning Plan ({rec.linkedLearningItems[0].status})
                          </span>
                        ) : (
                          <span className="text-slate-500">Covered</span>
                        )}
                      </td>
                    </tr>

                    {/* Exact Saved Opportunities Behind the Count */}
                    {isExpanded && (
                      <tr className="bg-slate-50/50">
                        <td colSpan={5} className="py-3 px-6 sm:px-10">
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-slate-700">
                              Saved opportunities behind this count (
                              <span className="font-mono tabular-nums">
                                {rec.opportunities.length}
                              </span>
                              ):
                            </div>
                            <ul className="divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg">
                              {rec.opportunities.map((oppItem) => (
                                <li
                                  key={oppItem.opportunityId}
                                  className="p-3 text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                                >
                                  <div className="space-y-1">
                                    <div className="font-semibold text-slate-900">
                                      {oppItem.title} — {oppItem.employer}
                                      <span className="font-normal text-slate-500">
                                        {" "}
                                        · {oppItem.stage} ·{" "}
                                        {oppItem.hasRequired && oppItem.hasPreferred
                                          ? "Required & Preferred"
                                          : oppItem.highestPriority}
                                      </span>
                                    </div>
                                    <ul className="text-slate-600 list-disc pl-4 space-y-0.5">
                                      {oppItem.matchingRequirements.map((mr) => (
                                        <li key={mr.requirementId}>
                                          <strong>{mr.priority}:</strong>{" "}
                                          {mr.requirementText}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>

                                  {onSelectOpportunity && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onSelectOpportunity(oppItem.opportunityId)
                                      }
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-teal-900 border border-slate-300 bg-white hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0 self-start"
                                    >
                                      <span>Open Opportunity</span>
                                      <ExternalLink className="w-3 h-3" />
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
