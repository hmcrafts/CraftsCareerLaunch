import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Plus,
  Search,
} from "lucide-react";
import {
  GraphEntityType,
  LearningItem,
  RelationshipStatus,
  RelationshipType,
  WorkspaceState,
} from "../types/models";
import {
  ALLOWED_RELATIONSHIP_COMBINATIONS,
  GraphNode,
  RelationshipCandidateInput,
  buildEmployerId,
  exploreAdjacentWorkFromGraph,
  extractSkillsFromText,
  resolveAccessibleWorkspaceGraph,
} from "../utils/relationshipGraphEngine";
import {
  RelationshipInspectorPanel,
  formatRelationshipOrigin,
  formatRelationshipStatusLabel,
  formatRelationshipVerb,
} from "./RelationshipInspectorPanel";
import { SkillsWorthDevelopingPanel } from "./SkillsWorthDevelopingPanel";

interface ConnectionsViewProps {
  workspace: WorkspaceState;
  ownerUid: string;
  onSaveRelationship: (
    candidate: RelationshipCandidateInput,
    options?: { mode?: "create" | "update"; explicitNewEvidence?: boolean }
  ) => Promise<{ ok: boolean; error?: string }>;
  onAddLearningItem: (item: Omit<LearningItem, "id">) => Promise<boolean> | void;
  onSelectOpportunity: (opportunityId: string) => void;
}

export const ConnectionsView: React.FC<ConnectionsViewProps> = ({
  workspace,
  ownerUid,
  onSaveRelationship,
  onAddLearningItem,
  onSelectOpportunity,
}) => {
  const [displayMode, setDisplayMode] = useState<"table" | "visual">("table");
  const [statusFilter, setStatusFilter] = useState<"all" | RelationshipStatus>(
    "all"
  );
  const [typeFilter, setTypeFilter] = useState<"all" | RelationshipType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  // Add Typed Relationship Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedRuleIndex, setSelectedRuleIndex] = useState(0);
  const [sourceChoiceId, setSourceChoiceId] = useState("");
  const [customSourceText, setCustomSourceText] = useState("");
  const [targetChoiceId, setTargetChoiceId] = useState("");
  const [customTargetText, setCustomTargetText] = useState("");
  const [attachedEvidenceId, setAttachedEvidenceId] = useState("");
  const [initialStatus, setInitialStatus] =
    useState<RelationshipStatus>("suggested");
  const [explanationNote, setExplanationNote] = useState("");
  const [formResult, setFormResult] = useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);
  const [isSubmittingEdge, setIsSubmittingEdge] = useState(false);

  const resolvedGraph = useMemo(
    () => resolveAccessibleWorkspaceGraph(workspace, ownerUid),
    [workspace, ownerUid]
  );

  const adjacentWork = useMemo(
    () => exploreAdjacentWorkFromGraph(workspace, ownerUid),
    [workspace, ownerUid]
  );

  const counts = useMemo(() => {
    const confirmed = resolvedGraph.edges.filter(
      (e) => e.effectiveStatus === "confirmed"
    ).length;
    const suggested = resolvedGraph.edges.filter(
      (e) => e.effectiveStatus === "suggested"
    ).length;
    const rejected = resolvedGraph.edges.filter(
      (e) => e.effectiveStatus === "rejected"
    ).length;
    return {
      total: resolvedGraph.edges.length,
      confirmed,
      suggested,
      rejected,
    };
  }, [resolvedGraph.edges]);

  const filteredEdges = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return resolvedGraph.edges.filter((edge) => {
      if (statusFilter !== "all" && edge.effectiveStatus !== statusFilter) {
        return false;
      }
      if (typeFilter !== "all" && edge.relationshipType !== typeFilter) {
        return false;
      }
      if (
        focusedNodeId &&
        edge.sourceId !== focusedNodeId &&
        edge.targetId !== focusedNodeId
      ) {
        return false;
      }
      if (q) {
        const hay = `${edge.sourceLabel} ${edge.relationshipType} ${edge.targetLabel} ${edge.explanationNote}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    resolvedGraph.edges,
    statusFilter,
    typeFilter,
    focusedNodeId,
    searchQuery,
  ]);

  const selectedEdge = useMemo(
    () =>
      selectedEdgeId
        ? resolvedGraph.edges.find((e) => e.id === selectedEdgeId) ?? null
        : null,
    [resolvedGraph.edges, selectedEdgeId]
  );

  // Group nodes into structured semantic lanes for the optional Visual Path Map
  const visualLanes = useMemo(() => {
    const byType = (types: GraphEntityType[]): GraphNode[] =>
      resolvedGraph.nodes.filter((n) => types.includes(n.type));
    return [
      {
        id: "lane-evidence",
        title: "1. Evidence & Documents",
        subtitle: "Uploaded files & verified claims",
        nodes: byType(["evidence"]),
      },
      {
        id: "lane-exp-learn",
        title: "2. Experience & Learning",
        subtitle: "Work claims vs. study items",
        nodes: byType(["experience", "learning"]),
      },
      {
        id: "lane-skills",
        title: "3. Workspace Skills",
        subtitle: "Canonical skills mapped",
        nodes: byType(["skill"]),
      },
      {
        id: "lane-opps-employers",
        title: "4. Requirements, Roles & Employers",
        subtitle: "Saved postings & contacts",
        nodes: byType(["requirement", "opportunity", "contact", "employer"]),
      },
    ];
  }, [resolvedGraph.nodes]);

  const activeRule =
    ALLOWED_RELATIONSHIP_COMBINATIONS[selectedRuleIndex] ??
    ALLOWED_RELATIONSHIP_COMBINATIONS[0];

  const getEntityChoicesForType = (
    entityType: GraphEntityType
  ): Array<{ id: string; label: string }> => {
    switch (entityType) {
      case "experience":
        return (workspace.evidence || [])
          .filter(
            (e) =>
              e.category === "demonstrated_skill" ||
              e.category === "transferable_experience"
          )
          .map((e) => ({
            id: `exp-${e.id}`,
            label: e.claimText.slice(0, 84),
          }));
      case "evidence":
        return [
          ...(workspace.evidence || []).map((e) => ({
            id: e.id,
            label: `${e.claimText.slice(0, 72)} (${e.verificationStatus})`,
          })),
          ...(workspace.documents || []).map((d) => ({
            id: d.id,
            label: `Private file: ${d.fileName}`,
          })),
        ];
      case "learning":
        return [
          ...(workspace.learningItems || []).map((l) => ({
            id: l.id,
            label: `${l.title} (${l.status})`,
          })),
          ...(workspace.evidence || [])
            .filter(
              (e) =>
                e.category === "training_in_progress" ||
                e.category === "completed_training"
            )
            .map((e) => ({
              id: `learn-${e.id}`,
              label: `Training record: ${e.claimText.slice(0, 70)}`,
            })),
        ];
      case "opportunity":
        return (workspace.opportunities || [])
          .filter((o) => !o.isSampleRecord)
          .map((o) => ({
            id: o.id,
            label: `${o.title} — ${o.employer}`,
          }));
      case "requirement":
        return (workspace.assessments || []).map((a) => ({
          id: a.id,
          label: `${a.priority}: ${a.requirementText.slice(0, 75)}`,
        }));
      case "contact":
        return (workspace.contacts || []).map((c) => ({
          id: c.id,
          label: `${c.name} (${c.organization || "No org"}) · ${
            c.roleVerified ? "Role verified" : "Unverified affiliation"
          }`,
        }));
      case "skill":
        return resolvedGraph.nodes
          .filter((n) => n.type === "skill")
          .map((n) => ({ id: n.id, label: n.label }));
      case "employer":
        return resolvedGraph.nodes
          .filter((n) => n.type === "employer")
          .map((n) => ({ id: n.id, label: n.label }));
    }
  };

  const sourceOptions = getEntityChoicesForType(activeRule.sourceType);
  const targetOptions = getEntityChoicesForType(activeRule.targetType);

  const handleCreateRelationship = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormResult(null);

    let resolvedSourceId = sourceChoiceId;
    let resolvedSourceLabel =
      sourceOptions.find((o) => o.id === sourceChoiceId)?.label || "";
    if (activeRule.sourceType === "skill" && customSourceText.trim()) {
      const sk = extractSkillsFromText(customSourceText.trim(), [])[0];
      resolvedSourceId = sk.skillId;
      resolvedSourceLabel = sk.label;
    }

    let resolvedTargetId = targetChoiceId;
    let resolvedTargetLabel =
      targetOptions.find((o) => o.id === targetChoiceId)?.label || "";
    if (activeRule.targetType === "skill" && customTargetText.trim()) {
      const sk = extractSkillsFromText(customTargetText.trim(), [])[0];
      resolvedTargetId = sk.skillId;
      resolvedTargetLabel = sk.label;
    } else if (activeRule.targetType === "employer" && customTargetText.trim()) {
      resolvedTargetId = buildEmployerId(customTargetText.trim());
      resolvedTargetLabel = customTargetText.trim();
    }

    if (!resolvedSourceId || !resolvedTargetId) {
      setFormResult({
        tone: "err",
        text: "Select both a valid source entity and destination entity from your workspace.",
      });
      return;
    }

    setIsSubmittingEdge(true);
    const res = await onSaveRelationship(
      {
        userId: ownerUid,
        sourceType: activeRule.sourceType,
        sourceId: resolvedSourceId,
        sourceLabel: resolvedSourceLabel || resolvedSourceId,
        targetType: activeRule.targetType,
        targetId: resolvedTargetId,
        targetLabel: resolvedTargetLabel || resolvedTargetId,
        relationshipType: activeRule.relationshipType,
        evidenceIds: attachedEvidenceId ? [attachedEvidenceId] : [],
        status: initialStatus,
        origin: "user",
        explanationNote: explanationNote.trim(),
      },
      { mode: "create", explicitNewEvidence: Boolean(attachedEvidenceId) }
    );
    setIsSubmittingEdge(false);

    if (res.ok) {
      setFormResult({
        tone: "ok",
        text: "Typed relationship validated and saved to your private workspace graph.",
      });
      setCustomSourceText("");
      setCustomTargetText("");
      setAttachedEvidenceId("");
      setExplanationNote("");
    } else {
      setFormResult({
        tone: "err",
        text: res.error || "Relationship rejected by validation rules.",
      });
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header & Accessible Table vs Optional Visual Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Connections — Evidence Relationship Graph
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 max-w-3xl">
            Inspect how your verified experience, documents, learning activities, contacts, and saved job requirements connect inside your private workspace. Select any relationship to verify its sources.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Choose accessible table or optional visual path view"
            className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg"
          >
            <button
              type="button"
              onClick={() => setDisplayMode("table")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                displayMode === "table"
                  ? "bg-white text-slate-950 font-semibold shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Accessible Table & List
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode("visual")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                displayMode === "visual"
                  ? "bg-white text-slate-950 font-semibold shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Visual Path Map (Optional)
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showAddForm ? "Close Form" : "Add Relationship"}</span>
          </button>
        </div>
      </div>

      {/* Unboxed Summary Counts (Tabular Numerals) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-2 sm:grid-cols-4 gap-6">
        <div>
          <div className="text-xs text-slate-500">Total Workspace Edges</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {counts.total}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Confirmed Relationships</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-teal-900">
            {counts.confirmed}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">
            Suggestions (Unverified)
          </div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-900">
            {counts.suggested}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Rejected Suggestions</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-700">
            {counts.rejected}
          </div>
        </div>
      </div>

      {/* Add Typed Relationship Form (Strict Allowlist Validation) */}
      {showAddForm && (
        <form
          onSubmit={handleCreateRelationship}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="pb-3 border-b border-slate-200">
            <h2 className="text-base font-bold text-slate-900">
              Record a Validated Workspace Relationship
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Only defined entity/relationship combinations are permitted. Coursework cannot be recorded as work experience, and unsupported claims remain suggestions until backed by verified evidence.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm">
            <div className="md:col-span-2 space-y-1">
              <label
                htmlFor="rel-rule-select"
                className="block text-xs font-semibold text-slate-800"
              >
                Permitted Relationship Type
              </label>
              <select
                id="rel-rule-select"
                value={selectedRuleIndex}
                onChange={(e) => {
                  setSelectedRuleIndex(Number(e.target.value));
                  setSourceChoiceId("");
                  setTargetChoiceId("");
                  setFormResult(null);
                }}
                className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                {ALLOWED_RELATIONSHIP_COMBINATIONS.map((rule, idx) => (
                  <option key={rule.humanLabel} value={idx}>
                    {rule.humanLabel}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">{activeRule.description}</p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                Source ({activeRule.sourceType})
              </label>
              <select
                value={sourceChoiceId}
                onChange={(e) => setSourceChoiceId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                <option value="">
                  Select {activeRule.sourceType} from your workspace...
                </option>
                {sourceOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {activeRule.sourceType === "skill" && (
                <input
                  type="text"
                  value={customSourceText}
                  onChange={(e) => setCustomSourceText(e.target.value)}
                  placeholder="Or enter a specific skill name..."
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                Destination ({activeRule.targetType})
              </label>
              <select
                value={targetChoiceId}
                onChange={(e) => setTargetChoiceId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                <option value="">
                  Select {activeRule.targetType} from your workspace...
                </option>
                {targetOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {(activeRule.targetType === "skill" ||
                activeRule.targetType === "employer") && (
                <input
                  type="text"
                  value={customTargetText}
                  onChange={(e) => setCustomTargetText(e.target.value)}
                  placeholder={
                    activeRule.targetType === "skill"
                      ? "Or enter a specific skill name..."
                      : "Or enter employer organization name..."
                  }
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
              )}
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-800">
                Supporting Workspace Evidence (Optional for suggestions)
              </label>
              <select
                value={attachedEvidenceId}
                onChange={(e) => setAttachedEvidenceId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                <option value="">No evidence attached yet (Suggestion)</option>
                {(workspace.evidence || [])
                  .filter((ev) => ev.category !== "not_yet_demonstrated")
                  .map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.claimText.slice(0, 76)} ({ev.verificationStatus})
                    </option>
                  ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-800">
                Requested Verification Status
              </label>
              <select
                value={initialStatus}
                onChange={(e) =>
                  setInitialStatus(e.target.value as RelationshipStatus)
                }
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                <option value="suggested">Suggested (unverified)</option>
                <option value="confirmed">
                  Confirmed (requires verified support)
                </option>
              </select>
            </div>

            <div className="md:col-span-2 space-y-1">
              <label className="block text-xs font-semibold text-slate-800">
                Context Note (Optional)
              </label>
              <input
                type="text"
                value={explanationNote}
                onChange={(e) => setExplanationNote(e.target.value)}
                placeholder="Plain-English note explaining how these items connect..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              />
            </div>
          </div>

          {formResult && (
            <div
              role="alert"
              className={`p-3 rounded-lg text-xs font-medium flex items-start gap-2 ${
                formResult.tone === "ok"
                  ? "bg-teal-50 border border-teal-200 text-teal-950"
                  : "bg-red-50 border border-red-200 text-red-950"
              }`}
            >
              {formResult.tone === "ok" ? (
                <CheckCircle2 className="w-4 h-4 text-teal-800 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              )}
              <span>{formResult.text}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmittingEdge}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 disabled:opacity-50 rounded-lg"
            >
              {isSubmittingEdge
                ? "Validating & Saving..."
                : "Validate & Save Relationship"}
            </button>
          </div>
        </form>
      )}

      {/* Selected Relationship Source & Verification Inspector */}
      {selectedEdge && (
        <RelationshipInspectorPanel
          edge={selectedEdge}
          workspaceEvidence={workspace.evidence || []}
          onSaveRelationship={onSaveRelationship}
          onClose={() => setSelectedEdgeId(null)}
        />
      )}

      {/* Relationships Workspace Section (Accessible Table OR Optional Visual Path Map) */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Filter relationships by verification status"
              className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg"
            >
              {(["all", "confirmed", "suggested", "rejected"] as const).map(
                (st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                      statusFilter === st
                        ? "bg-white text-slate-950 font-semibold shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {st === "all"
                      ? `All (${counts.total})`
                      : st === "confirmed"
                      ? `Confirmed (${counts.confirmed})`
                      : st === "suggested"
                      ? `Suggested (${counts.suggested})`
                      : `Rejected (${counts.rejected})`}
                  </button>
                )
              )}
            </div>

            <select
              aria-label="Filter by relationship type"
              value={typeFilter}
              onChange={(e) =>
                setTypeFilter(e.target.value as "all" | RelationshipType)
              }
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800"
            >
              <option value="all">All relationship types</option>
              <option value="demonstrates">Experience → demonstrates → Skill</option>
              <option value="supports">Evidence → supports → Experience</option>
              <option value="has_requirement">
                Opportunity → has requirement → Requirement
              </option>
              <option value="requires">Requirement → requires → Skill</option>
              <option value="teaches">Learning → teaches → Skill</option>
              <option value="confirmed_affiliation_with">
                Contact → confirmed affiliation → Employer
              </option>
              <option value="claims_affiliation_with">
                Contact → claims affiliation → Employer
              </option>
              <option value="offered_by">Opportunity → offered by → Employer</option>
            </select>

            {focusedNodeId && (
              <button
                type="button"
                onClick={() => setFocusedNodeId(null)}
                className="px-2.5 py-1 text-xs font-medium text-teal-900 border border-teal-800/30 bg-teal-50 rounded-md"
              >
                Clear focused node filter
              </button>
            )}
          </div>

          <div className="relative w-full lg:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entities or skills..."
              aria-label="Search relationships"
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
            />
          </div>
        </div>

        {/* OPTIONAL VISUAL PATH MAP VIEW */}
        {displayMode === "visual" && (
          <div className="space-y-5">
            <div className="text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>Structured Path Columns:</strong> Select any entity to filter its connected paths below, then select any relationship to inspect its supporting sources.
              </span>
              <button
                type="button"
                onClick={() => setDisplayMode("table")}
                className="text-teal-800 font-medium hover:underline"
              >
                Switch to Accessible Table Equivalent
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {visualLanes.map((lane) => (
                <div
                  key={lane.id}
                  className="border border-slate-200 rounded-xl bg-slate-50/50 p-3.5 space-y-2.5"
                >
                  <div className="pb-2 border-b border-slate-200">
                    <h3 className="text-xs font-bold text-slate-900">
                      {lane.title}
                    </h3>
                    <p className="text-[11px] text-slate-500">{lane.subtitle}</p>
                  </div>
                  {lane.nodes.length === 0 ? (
                    <p className="text-xs text-slate-500 py-2">
                      No entities in this lane yet.
                    </p>
                  ) : (
                    <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                      {lane.nodes.map((node) => {
                        const isFocused = focusedNodeId === node.id;
                        const connectedCount = resolvedGraph.edges.filter(
                          (e) =>
                            e.sourceId === node.id || e.targetId === node.id
                        ).length;
                        return (
                          <li key={node.id}>
                            <button
                              type="button"
                              onClick={() =>
                                setFocusedNodeId(isFocused ? null : node.id)
                              }
                              className={`w-full text-left p-2.5 rounded-lg border text-xs transition-colors ${
                                isFocused
                                  ? "bg-teal-900 text-white border-teal-900"
                                  : "bg-white hover:bg-slate-50 text-slate-900 border-slate-200"
                              }`}
                            >
                              <div className="font-semibold leading-snug">
                                {node.label}
                              </div>
                              <div
                                className={`mt-1 text-[11px] flex items-center justify-between gap-2 ${
                                  isFocused
                                    ? "text-teal-100"
                                    : "text-slate-500"
                                }`}
                              >
                                <span className="truncate">
                                  {node.type} · {node.verificationState}
                                </span>
                                <span className="font-mono tabular-nums shrink-0">
                                  {connectedCount}
                                </span>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ACCESSIBLE TABLE / LIST EQUIVALENT (Always rendered in Table mode, and rendered below lane filter in Visual mode so keyboard/screen-reader inspection is always immediate) */}
        {filteredEdges.length === 0 ? (
          <div className="py-6 text-sm text-slate-600">
            No relationships match your current filters. Add evidence in{" "}
            <strong>My Profile</strong> or save an opportunity in{" "}
            <strong>Find & Evaluate</strong> to populate verified paths.
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table
              aria-label="Workspace evidence relationships table"
              className="w-full text-left border-collapse text-xs sm:text-sm"
            >
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-700">
                  <th className="py-3 px-4 font-semibold">Source Entity</th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">
                    Relationship
                  </th>
                  <th className="py-3 px-4 font-semibold">
                    Destination Entity
                  </th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">
                    Verification Status
                  </th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">
                    Origin
                  </th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">
                    Sources
                  </th>
                  <th className="py-3 px-4 font-semibold">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredEdges.map((edge) => {
                  const isSelected = selectedEdgeId === edge.id;
                  const sourceCount =
                    edge.accessibleEvidence.length +
                    edge.accessibleDocuments.length;
                  return (
                    <tr
                      key={edge.id}
                      className={`align-top transition-colors ${
                        isSelected
                          ? "bg-teal-50/70"
                          : "hover:bg-slate-50/70"
                      }`}
                    >
                      <td className="py-3 px-4 text-xs max-w-xs">
                        <div className="font-medium text-slate-900">
                          {edge.sourceLabel}
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          {edge.sourceType}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs font-medium text-teal-900 whitespace-nowrap">
                        <div>{formatRelationshipVerb(edge.relationshipType)}</div>
                        {edge.requirementPriority !== "N/A" && (
                          <div className="text-slate-500 font-normal">
                            {edge.requirementPriority}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs max-w-xs">
                        <div className="font-medium text-slate-900">
                          {edge.targetLabel}
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          {edge.targetType}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        <div
                          className={
                            edge.effectiveStatus === "confirmed"
                              ? "text-teal-900 font-semibold"
                              : edge.effectiveStatus === "rejected"
                              ? "text-red-800 font-semibold"
                              : "text-amber-900 font-semibold"
                          }
                        >
                          {formatRelationshipStatusLabel(edge.effectiveStatus)}
                        </div>
                        {!edge.evidencePathComplete && (
                          <div className="text-slate-500 mt-0.5">
                            Path incomplete
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                        {formatRelationshipOrigin(edge.origin)}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-800 whitespace-nowrap">
                        {sourceCount}
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedEdgeId(isSelected ? null : edge.id)
                          }
                          aria-expanded={isSelected}
                          className={`px-2.5 py-1 rounded-md border font-medium transition-colors ${
                            isSelected
                              ? "bg-teal-900 text-white border-teal-900"
                              : "bg-white text-slate-800 border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          {isSelected ? "Selected" : "Sources & State"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Skills Worth Developing Across Saved Opportunities */}
      <SkillsWorthDevelopingPanel
        workspace={workspace}
        ownerUid={ownerUid}
        onSelectOpportunity={onSelectOpportunity}
        onAddLearningItem={onAddLearningItem}
      />

      {/* Function 3: Explore Adjacent Work (Documented vs Speculative Labeled) */}
      <section
        aria-labelledby="adjacent-work-heading"
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
      >
        <div className="pb-4 border-b border-slate-200 space-y-1">
          <h2
            id="adjacent-work-heading"
            className="text-lg sm:text-xl font-bold text-slate-900"
          >
            Explore Adjacent Work — Documented Bridges vs. Speculative Directions
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 max-w-3xl leading-relaxed">
            Separates documented skill overlaps in your saved opportunities from exploratory adjacent role ideas. Career Launch never invents contacts, referrals, prior experience, or live job availability.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Documented Connections */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              Documented Connections in Saved Opportunities (
              <span className="font-mono tabular-nums">
                {adjacentWork.documentedBridges.length}
              </span>
              )
            </h3>
            {adjacentWork.documentedBridges.length === 0 ? (
              <p className="text-xs text-slate-600">
                Save opportunities in Find & Evaluate to see documented skill bridges.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200 border border-slate-200 rounded-xl">
                {adjacentWork.documentedBridges.map((bridge) => (
                  <li key={bridge.opportunityId} className="p-4 text-xs space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-semibold text-slate-900 text-sm">
                        {bridge.title} — {bridge.employer}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          onSelectOpportunity(bridge.opportunityId)
                        }
                        className="inline-flex items-center gap-1 text-teal-900 font-medium hover:underline whitespace-nowrap shrink-0"
                      >
                        <span>Inspect Fit</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      {bridge.traceableSummary}
                    </p>
                    {bridge.trainingSupportedSkills.length > 0 && (
                      <p className="text-slate-600">
                        <strong>Training-only familiarity (not paid work):</strong>{" "}
                        {bridge.trainingSupportedSkills.join(", ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Speculative Suggestions (Explicitly Labeled) */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              Speculative Adjacent Role Directions (
              <span className="font-mono tabular-nums">
                {adjacentWork.speculativeSuggestions.length}
              </span>
              )
            </h3>
            {adjacentWork.speculativeSuggestions.length === 0 ? (
              <p className="text-xs text-slate-600">
                Add confirmed experience claims in My Profile to see grounded adjacent role ideas.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200 border border-slate-200 rounded-xl">
                {adjacentWork.speculativeSuggestions.map((spec) => (
                  <li key={spec.id} className="p-4 text-xs space-y-2">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-900 text-sm">
                        {spec.roleTitle}{" "}
                        <span className="font-normal text-slate-500">
                          · {spec.sectorContext}
                        </span>
                      </div>
                      <div className="text-amber-900 font-medium">
                        {spec.speculativeLabel}
                      </div>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      {spec.rationale}
                    </p>
                    <div className="text-slate-600">
                      <strong>Grounded in your confirmed skills:</strong>{" "}
                      {spec.groundedInSkills.join(", ")}
                    </div>
                    <div className="text-slate-500 flex items-center gap-1.5 pt-0.5">
                      <ArrowRight className="w-3.5 h-3.5 shrink-0 text-teal-800" />
                      <span>{spec.verificationNextStep}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
