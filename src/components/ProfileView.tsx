import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Lock, Plus, Trash2, Upload } from "lucide-react";
import { getTodayIsoDate } from "../data/initialData";
import {
  Evidence,
  EvidenceCategory,
  PrivateDocumentCategory,
  PrivateDocumentMeta,
  Profile,
  VerificationStatus,
} from "../types/models";
import { detectEvidenceConflicts } from "../utils/analysisEngine";

interface ProfileViewProps {
  profile: Profile;
  evidence: Evidence[];
  documents: PrivateDocumentMeta[];
  isDemoMode: boolean;
  onUpdateProfile: (profile: Profile) => void;
  onAddEvidence: (item: Omit<Evidence, "id" | "dateAdded">) => Promise<boolean>;
  onUpdateEvidence: (item: Evidence) => Promise<boolean>;
  onDeleteEvidence: (id: string) => Promise<boolean>;
  onUploadPrivateFile: (
    file: File,
    docCategory: PrivateDocumentCategory,
    linkedOpportunityId?: string
  ) => Promise<{ meta: PrivateDocumentMeta; extractedTextIfPlain: string | null } | null>;
  onDownloadPrivateFile: (meta: PrivateDocumentMeta) => Promise<void>;
  onDeletePrivateFile: (docId: string) => Promise<boolean>;
}

const EVIDENCE_SECTIONS: Array<{
  category: EvidenceCategory;
  title: string;
  description: string;
}> = [
  {
    category: "demonstrated_skill",
    title: "Demonstrated Skills",
    description: "Skills and credentials directly supported by paid roles, degrees, or confirmed records.",
  },
  {
    category: "transferable_experience",
    title: "Transferable Experience",
    description: "Real experience from ABA care, tutoring, or coordination that applies to adjacent roles.",
  },
  {
    category: "training_in_progress",
    title: "Training in Progress",
    description: "Courses, guided simulations, or self-study currently underway (never framed as paid work).",
  },
  {
    category: "completed_training",
    title: "Completed Training",
    description: "Completed coursework, workshops, or tutorials.",
  },
  {
    category: "not_yet_demonstrated",
    title: "Skills Not Yet Demonstrated",
    description: "Known gaps kept visible so applications never exaggerate or invent experience.",
  },
];

const VERIFICATION_STATUSES: VerificationStatus[] = [
  "Confirmed by Nora",
  "Supported by uploaded document",
  "Needs clarification",
  "Draft wording only",
];

export const ProfileView: React.FC<ProfileViewProps> = ({
  profile,
  evidence,
  documents,
  isDemoMode,
  onUpdateProfile,
  onAddEvidence,
  onUpdateEvidence,
  onDeleteEvidence,
  onUploadPrivateFile,
  onDownloadPrivateFile,
  onDeletePrivateFile,
}) => {
  const [subTab, setSubTab] = useState<"overview" | "evidence" | "resume">("overview");
  const [categoryFilter, setCategoryFilter] = useState<EvidenceCategory | "all">("all");
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Add/edit evidence state
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);
  const [claimText, setClaimText] = useState("");
  const [claimCategory, setClaimCategory] = useState<EvidenceCategory>("demonstrated_skill");
  const [claimSource, setClaimSource] = useState("Confirmed by Nora");
  const [claimExcerpt, setClaimExcerpt] = useState("");
  const [claimStatus, setClaimStatus] = useState<VerificationStatus>("Confirmed by Nora");
  const [claimMayUse, setClaimMayUse] = useState(true);
  const [lastUploadedDocId, setLastUploadedDocId] = useState<string>("");

  // Resume upload state
  const [uploadMessage, setUploadMessage] = useState<{
    kind: "info" | "warning";
    text: string;
  } | null>(null);
  const [extractedCandidates, setExtractedCandidates] = useState<string[]>([]);

  const conflicts = useMemo(
    () => detectEvidenceConflicts(profile, evidence),
    [profile, evidence]
  );

  const triggerSavedBanner = (msg: string) => {
    setSavedNotice(msg);
    window.setTimeout(() => setSavedNotice(null), 3500);
  };

  const updateConstraint = <K extends keyof Profile["constraints"]>(
    key: K,
    value: Profile["constraints"][K]
  ) => {
    onUpdateProfile({
      ...profile,
      constraints: {
        ...profile.constraints,
        [key]: value,
      },
    });
  };

  const resetEvidenceForm = () => {
    setEditingEvidenceId(null);
    setClaimText("");
    setClaimCategory("demonstrated_skill");
    setClaimSource("Confirmed by Nora");
    setClaimExcerpt("");
    setClaimStatus("Confirmed by Nora");
    setClaimMayUse(true);
    setShowAddForm(false);
  };

  const startEditEvidence = (item: Evidence) => {
    setEditingEvidenceId(item.id);
    setClaimText(item.claimText);
    setClaimCategory(item.category);
    setClaimSource(item.sourceDocumentOrConfirmation);
    setClaimExcerpt(item.sourceExcerpt);
    setClaimStatus(item.verificationStatus);
    setClaimMayUse(item.mayUseInApplications);
    setShowAddForm(true);
  };

  const handleSaveEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimText.trim()) return;

    const safeMayUse =
      claimCategory === "not_yet_demonstrated" ||
      claimStatus === "Needs clarification" ||
      claimStatus === "Draft wording only"
        ? false
        : claimMayUse;

    if (editingEvidenceId) {
      const existing = evidence.find((ev) => ev.id === editingEvidenceId);
      if (existing) {
        const ok = await onUpdateEvidence({
          ...existing,
          claimText: claimText.trim(),
          category: claimCategory,
          sourceDocumentOrConfirmation: claimSource.trim() || "User entry",
          sourceExcerpt: claimExcerpt.trim(),
          verificationStatus: claimStatus,
          mayUseInApplications: safeMayUse,
        });
        if (ok) {
          triggerSavedBanner("Confirmed and saved evidence record to database.");
          resetEvidenceForm();
        }
      }
    } else {
      const ok = await onAddEvidence({
        claimText: claimText.trim(),
        category: claimCategory,
        sourceDocumentOrConfirmation: claimSource.trim() || "Confirmed by Nora",
        sourceExcerpt: claimExcerpt.trim(),
        verificationStatus: claimStatus,
        mayUseInApplications: safeMayUse,
        tags: [],
      });
      if (ok) {
        triggerSavedBanner("Saved new evidence record to database.");
        resetEvidenceForm();
      }
    }
  };

  const handleResumeFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";

    if (!isDemoMode) {
      const uploaded = await onUploadPrivateFile(file, "resume");
      if (!uploaded) {
        e.target.value = "";
        return;
      }
      setLastUploadedDocId(uploaded.meta.id);
      if (uploaded.extractedTextIfPlain) {
        onUpdateProfile({
          ...profile,
          masterResumeText: uploaded.extractedTextIfPlain,
          masterResumeUpdatedAt: getTodayIsoDate(),
        });
        setUploadMessage({
          kind: "info",
          text: `Saved "${file.name}" into your private, non-public document storage and loaded its plain text into your Master Résumé below.`,
        });
      } else {
        setUploadMessage({
          kind: "warning",
          text: `Saved "${file.name}" privately in your account storage (zero public URLs). Because .${ext || "binary"} files cannot be parsed cleanly without risking garbled lines, also paste your plain-text résumé below before scanning candidate claims.`,
        });
      }
    } else if (ext === "txt" || ext === "md") {
      const content = await file.text();
      onUpdateProfile({
        ...profile,
        masterResumeText: content,
        masterResumeUpdatedAt: getTodayIsoDate(),
      });
      setUploadMessage({
        kind: "info",
        text: `Loaded "${file.name}" into temporary Demo Mode session (not saved to database).`,
      });
    } else {
      setUploadMessage({
        kind: "warning",
        text: `Demo Mode cannot store private files in Cloud Firestore. Sign in to store "${file.name}" privately, or paste plain text below.`,
      });
    }
    e.target.value = "";
  };

  const handleScanResumeCandidates = () => {
    const lines = profile.masterResumeText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^[-•*]\s+/.test(l) && !l.includes("[PLACEHOLDER"));
    const bullets = lines.map((l) => l.replace(/^[-•*]\s+/, "").trim());
    const existingLower = new Set(evidence.map((ev) => ev.claimText.toLowerCase()));
    const fresh = bullets.filter((b) => b.length > 15 && !existingLower.has(b.toLowerCase()));
    setExtractedCandidates(fresh);
    if (fresh.length === 0) {
      setUploadMessage({
        kind: "info",
        text: "All bullet lines in your Master Résumé already match claims in your Evidence Library (or have placeholders).",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            My Profile & Evidence Library
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 max-w-2xl">
            Every recommendation and application draft draws strictly from your verified claims and personal constraints. You can edit or clarify any detail here.
          </p>
        </div>

        {/* Clean Segmented Sub-Tab Controls */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start shrink-0">
          <button
            type="button"
            onClick={() => setSubTab("overview")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === "overview"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Profile & Constraints
          </button>
          <button
            type="button"
            onClick={() => setSubTab("evidence")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === "evidence"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Evidence Library ({evidence.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab("resume")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === "resume"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Master Résumé
          </button>
        </div>
      </div>

      {/* Conflict Alert Banner */}
      {conflicts.length > 0 && (
        <div className="bg-amber-50/70 border border-amber-300 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>Conflicting Evidence Needs Clarification</span>
          </div>
          <ul className="space-y-1 text-sm text-amber-900">
            {conflicts.map((c, idx) => (
              <li key={idx}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {savedNotice && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-2.5 text-xs font-medium text-teal-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-teal-800 shrink-0" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* SUB-TAB 1: OVERVIEW & GUIDED ONBOARDING CONSTRAINTS */}
      {subTab === "overview" && (
        <div className="space-y-8">
          {/* Core Personal & Background Verification */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Starting Profile Facts
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Prepopulated from your starting brief. Correct any field and mark verified when accurate.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile.profileVerifiedByNora}
                  onChange={(e) => {
                    onUpdateProfile({ ...profile, profileVerifiedByNora: e.target.checked });
                    triggerSavedBanner("Updated profile verification status.");
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-teal-800"
                />
                <span>I have reviewed and verified these core profile fields</span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Full name
                </label>
                <input
                  type="text"
                  value={profile.fullName}
                  onChange={(e) => onUpdateProfile({ ...profile, fullName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Current location
                </label>
                <input
                  type="text"
                  value={profile.location}
                  onChange={(e) => onUpdateProfile({ ...profile, location: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Education
                </label>
                <input
                  type="text"
                  value={profile.educationSummary}
                  onChange={(e) => onUpdateProfile({ ...profile, educationSummary: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
              {profile.fullName.trim().toLowerCase() === "nora crafts" ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Current RBT certification status (never assumed active)
                    </label>
                    <select
                      value={profile.rbtCertificationStatus}
                      onChange={(e) =>
                        onUpdateProfile({
                          ...profile,
                          rbtCertificationStatus: e.target
                            .value as Profile["rbtCertificationStatus"],
                        })
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="unverified">
                        Unverified — check BACB registry before stating
                      </option>
                      <option value="active">Active & in good standing</option>
                      <option value="inactive_or_expired">
                        Inactive / lapsed (prior RBT experience only)
                      </option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Clinical / data software actually used at Little Leaves
                    </label>
                    <input
                      type="text"
                      value={profile.littleLeavesSoftwareUsed}
                      onChange={(e) =>
                        onUpdateProfile({
                          ...profile,
                          littleLeavesSoftwareUsed: e.target.value,
                        })
                      }
                      placeholder="Leave blank until confirmed (do not assume RethinkBH)"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </>
              ) : (
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Confirmed workplace software, tools, or certifications
                  </label>
                  <input
                    type="text"
                    value={profile.littleLeavesSoftwareUsed}
                    onChange={(e) =>
                      onUpdateProfile({
                        ...profile,
                        littleLeavesSoftwareUsed: e.target.value,
                      })
                    }
                    placeholder="List only software or credentials you have personally used or hold"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              )}
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Other experience notes (awaiting actual résumé before detailed claims)
                </label>
                <textarea
                  rows={2}
                  value={profile.otherExperienceNotes}
                  onChange={(e) =>
                    onUpdateProfile({ ...profile, otherExperienceNotes: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>
          </section>

          {/* Guided Onboarding: Missing Constraints Before Ranking Jobs */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Job-Search Constraints (Guided Onboarding)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Used to evaluate income reliability, commute fit, and commission risk. Leave any item as “Not sure yet” rather than guessing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  updateConstraint("onboardingReviewed", true);
                  triggerSavedBanner("Saved your job-search constraints.");
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0 self-start"
              >
                Save & Mark Constraints Reviewed
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 1. Minimum Base Salary */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">
                    Minimum acceptable annual base salary ($)
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={profile.constraints.minBaseSalaryUnsure}
                      onChange={(e) =>
                        onUpdateProfile({
                          ...profile,
                          constraints: {
                            ...profile.constraints,
                            minBaseSalaryUnsure: e.target.checked,
                            minBaseSalary: e.target.checked ? null : profile.constraints.minBaseSalary ?? 52000,
                          },
                        })
                      }
                      className="rounded border-slate-300 text-teal-800"
                    />
                    <span>Not sure yet</span>
                  </label>
                </div>
                <input
                  type="number"
                  step={1000}
                  disabled={profile.constraints.minBaseSalaryUnsure}
                  value={profile.constraints.minBaseSalary ?? ""}
                  onChange={(e) =>
                    updateConstraint(
                      "minBaseSalary",
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                  placeholder={profile.constraints.minBaseSalaryUnsure ? "Not sure yet" : "e.g., 52000"}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>

              {/* 2. Desired Total Compensation */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">
                    Desired total annual compensation ($)
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={profile.constraints.desiredTotalCompUnsure}
                      onChange={(e) =>
                        onUpdateProfile({
                          ...profile,
                          constraints: {
                            ...profile.constraints,
                            desiredTotalCompUnsure: e.target.checked,
                            desiredTotalComp: e.target.checked ? null : profile.constraints.desiredTotalComp ?? 62000,
                          },
                        })
                      }
                      className="rounded border-slate-300 text-teal-800"
                    />
                    <span>Not sure yet</span>
                  </label>
                </div>
                <input
                  type="number"
                  step={1000}
                  disabled={profile.constraints.desiredTotalCompUnsure}
                  value={profile.constraints.desiredTotalComp ?? ""}
                  onChange={(e) =>
                    updateConstraint(
                      "desiredTotalComp",
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                  placeholder={profile.constraints.desiredTotalCompUnsure ? "Not sure yet" : "e.g., 65000"}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>

              {/* 3. Benefits */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Are employer health/retirement benefits essential?
                </label>
                <select
                  value={profile.constraints.benefitsRequirement}
                  onChange={(e) =>
                    updateConstraint(
                      "benefitsRequirement",
                      e.target.value as Profile["constraints"]["benefitsRequirement"]
                    )
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="not_sure">Not sure yet</option>
                  <option value="essential">Yes — full benefits are essential</option>
                  <option value="preferred">Preferred, but flexible for strong base pay</option>
                  <option value="not_essential">Not essential right now</option>
                </select>
              </div>

              {/* 4. Employment Type */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Employment type preference
                </label>
                <select
                  value={profile.constraints.employmentType}
                  onChange={(e) =>
                    updateConstraint(
                      "employmentType",
                      e.target.value as Profile["constraints"]["employmentType"]
                    )
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="not_sure">Not sure yet</option>
                  <option value="full_time">Full-time</option>
                  <option value="part_time">Part-time</option>
                  <option value="either">Either full-time or part-time</option>
                </select>
              </div>

              {/* 5. Remote / Hybrid / On-site */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Remote, hybrid, or on-site preference
                </label>
                <select
                  value={profile.constraints.workArrangement}
                  onChange={(e) =>
                    updateConstraint(
                      "workArrangement",
                      e.target.value as Profile["constraints"]["workArrangement"]
                    )
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="not_sure">Not sure yet</option>
                  <option value="remote">Remote preferred</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">On-site</option>
                  <option value="any">Open to remote, hybrid, or local on-site</option>
                </select>
              </div>

              {/* 6. Max commute & relocation */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-700">Max commute (min)</label>
                    <label className="inline-flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={profile.constraints.maxCommuteUnsure}
                        onChange={(e) =>
                          onUpdateProfile({
                            ...profile,
                            constraints: {
                              ...profile.constraints,
                              maxCommuteUnsure: e.target.checked,
                              maxCommuteMinutes: e.target.checked ? null : 35,
                            },
                          })
                        }
                        className="rounded border-slate-300 text-teal-800"
                      />
                      <span>Unsure</span>
                    </label>
                  </div>
                  <input
                    type="number"
                    disabled={profile.constraints.maxCommuteUnsure}
                    value={profile.constraints.maxCommuteMinutes ?? ""}
                    onChange={(e) =>
                      updateConstraint(
                        "maxCommuteMinutes",
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                    placeholder="Not sure"
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Willing to relocate?
                  </label>
                  <select
                    value={profile.constraints.willingToRelocate}
                    onChange={(e) =>
                      updateConstraint(
                        "willingToRelocate",
                        e.target.value as Profile["constraints"]["willingToRelocate"]
                      )
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="not_sure">Not sure yet</option>
                    <option value="no">
                      {profile.fullName.trim().toLowerCase() === "nora crafts"
                        ? "No — staying in Oakton / NoVA"
                        : "No — staying in current area"}
                    </option>
                    <option value="open_for_right_role">Open for the right role</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
              </div>

              {/* 7. Tolerance for commission */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tolerance for commission-based income
                </label>
                <select
                  value={profile.constraints.commissionTolerance}
                  onChange={(e) =>
                    updateConstraint(
                      "commissionTolerance",
                      e.target.value as Profile["constraints"]["commissionTolerance"]
                    )
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="not_sure">Not sure yet</option>
                  <option value="none_base_only">None — 100% predictable base pay only</option>
                  <option value="low_supplemental">Small bonus/commission okay on top of livable base</option>
                  <option value="moderate_with_solid_base">Open to BDR base + commission if base covers essentials</option>
                </select>
              </div>

              {/* 8. Comfort with outbound calling */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Comfort with outbound sales & daily phone calling
                </label>
                <select
                  value={profile.constraints.outboundCallingComfort}
                  onChange={(e) =>
                    updateConstraint(
                      "outboundCallingComfort",
                      e.target.value as Profile["constraints"]["outboundCallingComfort"]
                    )
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="not_sure">Not sure yet</option>
                  <option value="comfortable">Comfortable with daily outbound calling</option>
                  <option value="willing_with_training">Willing to learn if structured training & warm domain fit exist</option>
                  <option value="prefer_limited">Prefer warm inbound / client coordination over cold calling</option>
                  <option value="avoid">Prefer to avoid outbound sales calling</option>
                </select>
              </div>

              {/* 9. Schedule & Start Date */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Work schedule & start-date availability
                </label>
                <input
                  type="text"
                  value={profile.constraints.scheduleAndStartAvailability}
                  onChange={(e) =>
                    updateConstraint("scheduleAndStartAvailability", e.target.value)
                  }
                  placeholder="e.g., Standard weekday hours; available within 2 weeks, or Not sure yet"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>

              {/* 10. Travel limits */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Travel limits
                </label>
                <input
                  type="text"
                  value={profile.constraints.travelLimits}
                  onChange={(e) => updateConstraint("travelLimits", e.target.value)}
                  placeholder="e.g., Minimal overnight travel (<10%), local driving okay, or Not sure yet"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>

              {/* 11. Preferred & Excluded Industries */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Preferred industries
                </label>
                <input
                  type="text"
                  value={profile.constraints.preferredIndustries}
                  onChange={(e) => updateConstraint("preferredIndustries", e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Excluded industries
                </label>
                <input
                  type="text"
                  value={profile.constraints.excludedIndustries}
                  onChange={(e) => updateConstraint("excludedIndustries", e.target.value)}
                  placeholder="e.g., Door-to-door sales, multi-level marketing, or leave blank"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>

              {/* 12. Time & Budget for Training */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Weekly time available for skill preparation
                </label>
                <input
                  type="text"
                  value={profile.constraints.trainingTimeWeeklyHours}
                  onChange={(e) => updateConstraint("trainingTimeWeeklyHours", e.target.value)}
                  placeholder="e.g., 3–5 hours/week, or Not sure yet"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Budget available for training / renewals
                </label>
                <input
                  type="text"
                  value={profile.constraints.trainingBudgetDollars}
                  onChange={(e) => updateConstraint("trainingBudgetDollars", e.target.value)}
                  placeholder="e.g., Free resources only ($0), or Not sure yet"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>
          </section>
        </div>
      )}

      {/* SUB-TAB 2: EVIDENCE LIBRARY (FEATURE 1) */}
      {subTab === "evidence" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
              <button
                type="button"
                onClick={() => setCategoryFilter("all")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                  categoryFilter === "all"
                    ? "bg-white text-slate-950 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                All Lists
              </button>
              {EVIDENCE_SECTIONS.map((sec) => (
                <button
                  key={sec.category}
                  type="button"
                  onClick={() => setCategoryFilter(sec.category)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                    categoryFilter === sec.category
                      ? "bg-white text-slate-950 font-semibold shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {sec.title}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                resetEvidenceForm();
                setShowAddForm(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Evidence Claim</span>
            </button>
          </div>

          {showAddForm && (
            <form
              onSubmit={handleSaveEvidence}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
            >
              <h2 className="text-base font-semibold text-slate-900">
                {editingEvidenceId ? "Edit Evidence Record" : "New Evidence Record"}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Claim text (factual, without invented metrics)
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={claimText}
                    onChange={(e) => setClaimText(e.target.value)}
                    placeholder="e.g., Coordinated daily afterschool check-in schedules and parent pickup communication at [Organization]."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    List / Category
                  </label>
                  <select
                    value={claimCategory}
                    onChange={(e) => setClaimCategory(e.target.value as EvidenceCategory)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {EVIDENCE_SECTIONS.map((s) => (
                      <option key={s.category} value={s.category}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Verification status
                  </label>
                  <select
                    value={claimStatus}
                    onChange={(e) => setClaimStatus(e.target.value as VerificationStatus)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {VERIFICATION_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Source document or confirmation
                  </label>
                  <input
                    type="text"
                    value={claimSource}
                    onChange={(e) => setClaimSource(e.target.value)}
                    placeholder="e.g., Confirmed by Nora, or 2024 Master Résumé"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Source excerpt (optional)
                  </label>
                  <input
                    type="text"
                    value={claimExcerpt}
                    onChange={(e) => setClaimExcerpt(e.target.value)}
                    placeholder="Exact line from résumé or transcript when available"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={
                      claimCategory !== "not_yet_demonstrated" &&
                      claimStatus !== "Needs clarification" &&
                      claimStatus !== "Draft wording only" &&
                      claimMayUse
                    }
                    disabled={
                      claimCategory === "not_yet_demonstrated" ||
                      claimStatus === "Needs clarification" ||
                      claimStatus === "Draft wording only"
                    }
                    onChange={(e) => setClaimMayUse(e.target.checked)}
                    className="rounded border-slate-300 text-teal-800"
                  />
                  <span>
                    May be used in external applications (requires “Confirmed by Nora” or “Supported by uploaded document”)
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetEvidenceForm}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg"
                  >
                    {editingEvidenceId ? "Save Changes" : "Add Claim"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Render the 5 distinct Evidence Lists */}
          <div className="space-y-6">
            {EVIDENCE_SECTIONS.filter(
              (sec) => categoryFilter === "all" || categoryFilter === sec.category
            ).map((sec) => {
              const items = evidence.filter((e) => e.category === sec.category);
              return (
                <section
                  key={sec.category}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden"
                >
                  <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">{sec.title}</h2>
                      <p className="text-xs text-slate-600">{sec.description}</p>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-slate-500 shrink-0">
                      {items.length} {items.length === 1 ? "item" : "items"}
                    </span>
                  </div>

                  {items.length === 0 ? (
                    <div className="p-5 text-sm text-slate-500">
                      No entries in {sec.title.toLowerCase()} yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="p-5 flex flex-col lg:flex-row lg:items-start justify-between gap-4"
                        >
                          <div className="space-y-1.5 max-w-3xl">
                            {/* Clean unboxed metadata */}
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span
                                className={
                                  item.verificationStatus === "Needs clarification"
                                    ? "text-amber-800 font-semibold"
                                    : item.verificationStatus === "Confirmed by Nora"
                                    ? "text-teal-900 font-semibold"
                                    : "text-slate-700 font-medium"
                                }
                              >
                                {item.verificationStatus}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {item.mayUseInApplications
                                  ? "Approved for applications"
                                  : "Not used in applications"}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>Source: {item.sourceDocumentOrConfirmation}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">Added {item.dateAdded}</span>
                            </div>

                            <p className="text-sm font-medium text-slate-900 leading-relaxed">
                              {item.claimText}
                            </p>

                            {item.sourceExcerpt && (
                              <p className="text-xs text-slate-500">
                                Excerpt: “{item.sourceExcerpt}”
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {item.verificationStatus === "Needs clarification" && (
                              <button
                                type="button"
                                onClick={async () => {
                                  const ok = await onUpdateEvidence({
                                    ...item,
                                    verificationStatus: "Confirmed by Nora",
                                    sourceDocumentOrConfirmation: "Confirmed by Nora",
                                    mayUseInApplications: item.category !== "not_yet_demonstrated",
                                  });
                                  if (ok) {
                                    triggerSavedBanner("Confirmed claim and saved to database.");
                                  }
                                }}
                                className="px-2.5 py-1.5 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-md whitespace-nowrap shrink-0"
                              >
                                Confirm Claim
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => startEditEvidence(item)}
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteEvidence(item.id)}
                              className="px-2.5 py-1.5 text-xs font-medium text-red-700 border border-slate-200 hover:bg-red-50 rounded-md whitespace-nowrap shrink-0"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: MASTER RÉSUMÉ & PRIVATE FILE STORAGE */}
      {subTab === "resume" && (
        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Master Résumé & Private Document Storage
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Uploaded résumés (up to 500 KB) are stored in owner-isolated private database records with zero public URLs. Opportunity-specific tailored résumés branch from this Master Résumé without overwriting it.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Private File</span>
                  <input
                    type="file"
                    accept=".txt,.md,.pdf,.doc,.docx"
                    onChange={handleResumeFileUpload}
                    className="sr-only"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleScanResumeCandidates}
                  className="px-3 py-2 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg whitespace-nowrap shrink-0"
                >
                  Scan for Candidate Claims
                </button>
              </div>
            </div>

            {uploadMessage && (
              <div
                className={`p-4 rounded-lg border text-sm ${
                  uploadMessage.kind === "warning"
                    ? "bg-amber-50/70 border-amber-300 text-amber-950"
                    : "bg-slate-50 border-slate-200 text-slate-800"
                }`}
              >
                {uploadMessage.text}
              </div>
            )}

            {extractedCandidates.length > 0 && (
              <div className="border border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50/60">
                <div className="text-xs font-semibold text-slate-900">
                  Candidate bullets found in your Master Résumé (review before adding to Evidence Library):
                </div>
                <ul className="divide-y divide-slate-200">
                  {extractedCandidates.map((bullet, idx) => (
                    <li key={idx} className="py-2.5 flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-800">{bullet}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await onAddEvidence({
                            claimText: bullet,
                            category: "demonstrated_skill",
                            sourceDocumentOrConfirmation: "Master Résumé text",
                            sourceExcerpt: bullet,
                            verificationStatus: "Supported by uploaded document",
                            mayUseInApplications: true,
                            tags: [],
                            sourceDocumentId: lastUploadedDocId || undefined,
                          });
                          if (ok) {
                            setExtractedCandidates((prev) => prev.filter((_, i) => i !== idx));
                            triggerSavedBanner("Added bullet to Evidence Library.");
                          }
                        }}
                        className="px-2.5 py-1 text-xs font-semibold text-teal-900 bg-white border border-teal-300 rounded-md hover:bg-teal-50 whitespace-nowrap shrink-0"
                      >
                        Add as Supported Evidence
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Paste or edit your complete verified résumé text below:</span>
                <span className="font-mono tabular-nums">
                  {profile.masterResumeUpdatedAt
                    ? `Last updated ${profile.masterResumeUpdatedAt}`
                    : "Starter template — please replace placeholders with your real résumé"}
                </span>
              </div>
              <textarea
                rows={16}
                value={profile.masterResumeText}
                onChange={(e) =>
                  onUpdateProfile({
                    ...profile,
                    masterResumeText: e.target.value,
                    masterResumeUpdatedAt: getTodayIsoDate(),
                  })
                }
                className="w-full p-4 text-sm font-mono leading-relaxed border border-slate-300 rounded-lg bg-white"
              />
            </div>
          </section>

          {/* Private Uploaded Résumé & Supporting Files Vault */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-teal-800 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900">
                  Private Uploaded Files ({documents.filter((d) => d.docCategory !== "job_description").length})
                </h3>
              </div>
              <span className="text-xs text-slate-500">
                Owner-only access · No public URLs
              </span>
            </div>

            {documents.filter((d) => d.docCategory !== "job_description").length === 0 ? (
              <p className="text-xs text-slate-500">
                No private résumé files uploaded yet. Uploaded files are stored in non-listable private records tied strictly to your signed-in account.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200 text-xs">
                {documents
                  .filter((d) => d.docCategory !== "job_description")
                  .map((docMeta) => (
                    <li
                      key={docMeta.id}
                      className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900">{docMeta.fileName}</div>
                        <div className="text-slate-500 font-mono tabular-nums">
                          {Math.max(1, Math.round(docMeta.byteSize / 1024))} KB · SHA-256{" "}
                          {docMeta.sha256.slice(0, 12)}… · Uploaded{" "}
                          {docMeta.createdAtIso.slice(0, 10)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onDownloadPrivateFile(docMeta)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeletePrivateFile(docMeta.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-red-700 border border-slate-200 rounded-md hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
