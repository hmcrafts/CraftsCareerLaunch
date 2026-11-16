import React, { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Lock,
  Upload,
  X,
} from "lucide-react";
import {
  Evidence,
  InviterSuggestionItem,
  OnboardingWizardState,
  PrivateDocumentCategory,
  PrivateDocumentMeta,
  Profile,
} from "../types/models";

interface FirstLoginOnboardingWizardProps {
  profile: Profile;
  wizard: OnboardingWizardState;
  inviterSuggestions: InviterSuggestionItem[];
  onSaveProgress: (params: {
    profile: Profile;
    wizard: OnboardingWizardState;
    inviterSuggestions: InviterSuggestionItem[];
  }) => void;
  onAddEvidence: (item: Omit<Evidence, "id" | "dateAdded">) => Promise<boolean>;
  onUploadPrivateFile: (
    file: File,
    docCategory: PrivateDocumentCategory,
    linkedOpportunityId?: string
  ) => Promise<{
    meta: PrivateDocumentMeta;
    extractedTextIfPlain: string | null;
  } | null>;
}

const STEPS: Array<{ step: 1 | 2 | 3 | 4 | 5 | 6; title: string }> = [
  { step: 1, title: "About you" },
  { step: 2, title: "Work preferences" },
  { step: 3, title: "Experience" },
  { step: 4, title: "Career interests" },
  { step: 5, title: "Privacy & sharing" },
  { step: 6, title: "Review" },
];

const SITUATION_OPTIONS = [
  "Working and looking for a stronger next role",
  "Between roles and actively searching",
  "Studying or completing training",
  "Exploring options / not sure yet",
];

export const FirstLoginOnboardingWizard: React.FC<
  FirstLoginOnboardingWizardProps
> = ({
  profile,
  wizard,
  inviterSuggestions,
  onSaveProgress,
  onAddEvidence,
  onUploadPrivateFile,
}) => {
  const [draftProfile, setDraftProfile] = useState<Profile>(profile);
  const [draftWizard, setDraftWizard] = useState<OnboardingWizardState>(wizard);
  const [draftSuggestions, setDraftSuggestions] =
    useState<InviterSuggestionItem[]>(inviterSuggestions);

  const [manualExperienceClaim, setManualExperienceClaim] = useState("");
  const [manualClaimSavedNote, setManualClaimSavedNote] = useState<string | null>(
    null
  );
  const [uploadingResume, setUploadingResume] = useState(false);
  const [uploadStatusNote, setUploadStatusNote] = useState<string | null>(null);

  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(
    null
  );
  const [editingSuggestionText, setEditingSuggestionText] = useState<string>("");

  const currentStep = draftWizard.currentStep;

  const persistStep = (
    nextStep: 1 | 2 | 3 | 4 | 5 | 6,
    opts?: { completed?: boolean; pausedForLater?: boolean }
  ) => {
    const nowIso = new Date().toISOString();
    const updatedWizard: OnboardingWizardState = {
      ...draftWizard,
      currentStep: nextStep,
      completed: opts?.completed ?? draftWizard.completed,
      pausedForLater: opts?.pausedForLater ?? false,
      updatedAtIso: nowIso,
    };

    const updatedProfile: Profile = {
      ...draftProfile,
      otherExperienceNotes: [
        draftProfile.otherExperienceNotes.trim(),
        updatedWizard.rolesOfInterest
          ? `Roles of interest: ${updatedWizard.rolesOfInterest}`
          : "",
        updatedWizard.workToAvoid
          ? `Work to avoid: ${updatedWizard.workToAvoid}`
          : "",
        updatedWizard.skillsToDevelop
          ? `Skills to develop: ${updatedWizard.skillsToDevelop}`
          : "",
      ]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 2000),
      constraints: {
        ...draftProfile.constraints,
        onboardingReviewed: Boolean(opts?.completed),
      },
    };

    setDraftWizard(updatedWizard);
    setDraftProfile(updatedProfile);
    onSaveProgress({
      profile: updatedProfile,
      wizard: updatedWizard,
      inviterSuggestions: draftSuggestions,
    });
  };

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingResume(true);
    setUploadStatusNote(null);
    const res = await onUploadPrivateFile(file, "resume");
    setUploadingResume(false);
    if (res) {
      const nextResumeText =
        res.extractedTextIfPlain || draftProfile.masterResumeText;
      setDraftProfile((prev) => ({
        ...prev,
        masterResumeText: nextResumeText,
        masterResumeUpdatedAt: new Date().toISOString(),
      }));
      setDraftWizard((prev) => ({
        ...prev,
        experienceIntakeMode: "upload",
      }));
      setUploadStatusNote(
        `Uploaded "${res.meta.fileName}" to private workspace storage (no public URL). Imported details remain marked for your review until confirmed.`
      );
    } else {
      setUploadStatusNote(
        "File upload failed. Check file size (max 500 KB) and try again."
      );
    }
  };

  const handleAddManualExperience = async () => {
    const trimmed = manualExperienceClaim.trim();
    if (!trimmed) return;
    const ok = await onAddEvidence({
      claimText: trimmed,
      category: "demonstrated_skill",
      sourceDocumentOrConfirmation: "Entered during first-login setup",
      sourceExcerpt: "",
      verificationStatus: "Confirmed by Nora",
      mayUseInApplications: true,
      tags: ["onboarding"],
    });
    if (ok) {
      setManualExperienceClaim("");
      setDraftWizard((prev) => ({ ...prev, experienceIntakeMode: "manual" }));
      setManualClaimSavedNote(
        "Saved to your private experience & evidence library."
      );
    }
  };

  const handleAcceptSuggestion = async (
    sug: InviterSuggestionItem,
    customText?: string
  ) => {
    const finalText = (customText ?? sug.text).trim();
    if (!finalText) return;

    // Add to Evidence marked as "Needs clarification" until explicitly verified by user (Section 10 Step 6 & Section 11)
    await onAddEvidence({
      claimText: finalText,
      category: "transferable_experience",
      sourceDocumentOrConfirmation: `Suggested by inviter (${sug.suppliedBy}) — unverified until you confirm`,
      sourceExcerpt: "",
      verificationStatus: "Needs clarification",
      mayUseInApplications: false,
      tags: ["inviter-suggestion"],
    });

    const updated = draftSuggestions.map((s) =>
      s.id === sug.id
        ? { ...s, text: finalText, decision: "accepted" as const }
        : s
    );
    setDraftSuggestions(updated);
    setEditingSuggestionId(null);
    onSaveProgress({
      profile: draftProfile,
      wizard: draftWizard,
      inviterSuggestions: updated,
    });
  };

  const handleDiscardSuggestion = (sugId: string) => {
    const updated = draftSuggestions.map((s) =>
      s.id === sugId ? { ...s, decision: "discarded" as const } : s
    );
    setDraftSuggestions(updated);
    setEditingSuggestionId(null);
    onSaveProgress({
      profile: draftProfile,
      wizard: draftWizard,
      inviterSuggestions: updated,
    });
  };

  return (
    <div className="max-w-3xl mx-auto py-4 space-y-6">
      {/* Header & Save-for-later action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <span className="text-xs font-mono tabular-nums font-semibold text-teal-800">
            Step {currentStep} of 6
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
            Set up your private workspace
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Everything here belongs only to you. You can choose “Not sure yet” on any question or save and finish later.
          </p>
        </div>

        <button
          type="button"
          onClick={() => persistStep(currentStep, { pausedForLater: true })}
          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start"
        >
          Save & return later
        </button>
      </div>

      {/* Step Progress Bar */}
      <nav aria-label="Setup steps" className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        {STEPS.map((s) => {
          const isCurrent = s.step === currentStep;
          const isPast = s.step < currentStep;
          return (
            <button
              key={s.step}
              type="button"
              onClick={() => persistStep(s.step)}
              aria-current={isCurrent ? "step" : undefined}
              className={`text-left p-2.5 rounded-lg border text-xs transition-colors ${
                isCurrent
                  ? "bg-teal-50/70 border-teal-800 text-teal-950 font-semibold"
                  : isPast
                  ? "bg-white border-slate-300 text-slate-800 font-medium"
                  : "bg-white border-slate-200 text-slate-500"
              }`}
            >
              <span className="font-mono tabular-nums block text-[11px]">
                0{s.step}
              </span>
              <span className="truncate block mt-0.5">{s.title}</span>
            </button>
          );
        })}
      </nav>

      {/* Main Step Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        {/* STEP 1: ABOUT YOU */}
        {currentStep === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                1. About you
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Start with how you’d like your name to appear and your general location.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Preferred name
                </label>
                <input
                  type="text"
                  value={draftProfile.fullName}
                  onChange={(e) =>
                    setDraftProfile((prev) => ({
                      ...prev,
                      fullName: e.target.value,
                    }))
                  }
                  placeholder="e.g., Harry Crafts III"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  General location
                </label>
                <input
                  type="text"
                  value={draftProfile.location}
                  onChange={(e) =>
                    setDraftProfile((prev) => ({
                      ...prev,
                      location: e.target.value,
                    }))
                  }
                  placeholder="e.g., Northern Virginia / Washington, DC area"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Current situation
                </label>
                <select
                  value={draftWizard.currentSituation}
                  onChange={(e) =>
                    setDraftWizard((prev) => ({
                      ...prev,
                      currentSituation: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">Select current situation (optional)</option>
                  {SITUATION_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Start-date availability
                </label>
                <input
                  type="text"
                  value={draftProfile.constraints.scheduleAndStartAvailability}
                  onChange={(e) =>
                    setDraftProfile((prev) => ({
                      ...prev,
                      constraints: {
                        ...prev.constraints,
                        scheduleAndStartAvailability: e.target.value,
                      },
                    }))
                  }
                  placeholder="e.g., Available in 2 weeks, or Not sure yet"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: WORK PREFERENCES */}
        {currentStep === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                2. Work preferences
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Used to evaluate whether job postings realistically match your income, schedule, and commute requirements.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700">
                    Minimum annual base pay ($)
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftProfile.constraints.minBaseSalaryUnsure}
                      onChange={(e) =>
                        setDraftProfile((prev) => ({
                          ...prev,
                          constraints: {
                            ...prev.constraints,
                            minBaseSalaryUnsure: e.target.checked,
                            minBaseSalary: e.target.checked
                              ? null
                              : prev.constraints.minBaseSalary,
                          },
                        }))
                      }
                    />
                    <span>Not sure yet</span>
                  </label>
                </div>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  disabled={draftProfile.constraints.minBaseSalaryUnsure}
                  value={draftProfile.constraints.minBaseSalary ?? ""}
                  onChange={(e) =>
                    setDraftProfile((prev) => ({
                      ...prev,
                      constraints: {
                        ...prev.constraints,
                        minBaseSalary: e.target.value
                          ? Number(e.target.value)
                          : null,
                        minBaseSalaryUnsure: false,
                      },
                    }))
                  }
                  placeholder="e.g., 52000"
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Benefits needs (health, PTO, retirement)
                </label>
                <select
                  value={draftProfile.constraints.benefitsRequirement}
                  onChange={(e) =>
                    setDraftProfile((prev) => ({
                      ...prev,
                      constraints: {
                        ...prev.constraints,
                        benefitsRequirement: e.target
                          .value as Profile["constraints"]["benefitsRequirement"],
                      },
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="not_sure">Not sure yet</option>
                  <option value="essential">Essential — full benefits required</option>
                  <option value="preferred">Preferred, but flexible</option>
                  <option value="not_essential">Not essential right now</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Full-time or part-time
                </label>
                <select
                  value={draftProfile.constraints.employmentType}
                  onChange={(e) =>
                    setDraftProfile((prev) => ({
                      ...prev,
                      constraints: {
                        ...prev.constraints,
                        employmentType: e.target
                          .value as Profile["constraints"]["employmentType"],
                      },
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="not_sure">Not sure yet</option>
                  <option value="full_time">Full-time</option>
                  <option value="part_time">Part-time</option>
                  <option value="either">Open to either</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Remote, hybrid, or on-site
                </label>
                <select
                  value={draftProfile.constraints.workArrangement}
                  onChange={(e) =>
                    setDraftProfile((prev) => ({
                      ...prev,
                      constraints: {
                        ...prev.constraints,
                        workArrangement: e.target
                          .value as Profile["constraints"]["workArrangement"],
                      },
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="not_sure">Not sure yet</option>
                  <option value="remote">Remote only</option>
                  <option value="hybrid">Hybrid or remote</option>
                  <option value="onsite">On-site</option>
                  <option value="any">Open to remote, hybrid, or on-site</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700">
                    One-way commute limit (minutes)
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftProfile.constraints.maxCommuteUnsure}
                      onChange={(e) =>
                        setDraftProfile((prev) => ({
                          ...prev,
                          constraints: {
                            ...prev.constraints,
                            maxCommuteUnsure: e.target.checked,
                            maxCommuteMinutes: e.target.checked
                              ? null
                              : prev.constraints.maxCommuteMinutes,
                          },
                        }))
                      }
                    />
                    <span>Not sure yet</span>
                  </label>
                </div>
                <input
                  type="number"
                  min={0}
                  max={180}
                  disabled={draftProfile.constraints.maxCommuteUnsure}
                  value={draftProfile.constraints.maxCommuteMinutes ?? ""}
                  onChange={(e) =>
                    setDraftProfile((prev) => ({
                      ...prev,
                      constraints: {
                        ...prev.constraints,
                        maxCommuteMinutes: e.target.value
                          ? Number(e.target.value)
                          : null,
                        maxCommuteUnsure: false,
                      },
                    }))
                  }
                  placeholder="e.g., 35"
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Schedule or travel constraints
                </label>
                <input
                  type="text"
                  value={draftProfile.constraints.travelLimits}
                  onChange={(e) =>
                    setDraftProfile((prev) => ({
                      ...prev,
                      constraints: {
                        ...prev.constraints,
                        travelLimits: e.target.value,
                      },
                    }))
                  }
                  placeholder="e.g., Standard weekday hours preferred"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: EXPERIENCE */}
        {currentStep === 3 && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  3. Experience
                </h2>
                <p className="text-sm text-slate-600 mt-0.5">
                  Upload a résumé privately, paste experience notes, enter a verified skill manually, or skip for now.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDraftWizard((prev) => ({
                    ...prev,
                    experienceIntakeMode: "skipped",
                  }));
                  persistStep(4);
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0 self-start"
              >
                Skip for now
              </button>
            </div>

            {/* Option A: Private Resume File Upload */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Upload className="w-4 h-4 text-teal-800" />
                  <span>Upload résumé (private workspace storage)</span>
                </div>
                <label className="px-3.5 py-1.5 text-xs font-semibold text-teal-900 bg-white border border-teal-300 hover:bg-teal-50 rounded-lg cursor-pointer whitespace-nowrap shrink-0">
                  <span>{uploadingResume ? "Uploading..." : "Choose file"}</span>
                  <input
                    type="file"
                    accept=".txt,.md,.pdf,.doc,.docx"
                    onChange={handleResumeUpload}
                    disabled={uploadingResume}
                    className="sr-only"
                  />
                </label>
              </div>
              <p className="text-xs text-slate-600">
                Files are stored under your private account UID with no public URLs (max 500 KB). Plain-text files (.txt, .md) also populate your editable résumé text below.
              </p>
              {uploadStatusNote && (
                <p className="text-xs font-medium text-teal-900">
                  {uploadStatusNote}
                </p>
              )}
            </div>

            {/* Option B: Paste Experience / Master Resume Text */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>Paste résumé or work experience summary</span>
              </label>
              <textarea
                rows={5}
                value={draftProfile.masterResumeText}
                onChange={(e) => {
                  const text = e.target.value;
                  setDraftProfile((prev) => ({
                    ...prev,
                    masterResumeText: text,
                    masterResumeUpdatedAt: text
                      ? new Date().toISOString()
                      : prev.masterResumeUpdatedAt,
                  }));
                  setDraftWizard((prev) => ({
                    ...prev,
                    experienceIntakeMode: text ? "paste" : prev.experienceIntakeMode,
                    pastedExperienceDraft: text.slice(0, 15000),
                  }));
                }}
                placeholder="Paste experience bullets, education, or responsibilities here. Career Launch never invents metrics or employers."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              />
            </div>

            {/* Option C: Enter Verified Claim Manually */}
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <label className="block text-xs font-medium text-slate-700">
                Or add a single verified experience item manually
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={manualExperienceClaim}
                  onChange={(e) => setManualExperienceClaim(e.target.value)}
                  placeholder="e.g., Coordinated scheduling and client follow-up across weekly sessions"
                  className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
                <button
                  type="button"
                  onClick={handleAddManualExperience}
                  className="px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg whitespace-nowrap shrink-0"
                >
                  Add experience item
                </button>
              </div>
              {manualClaimSavedNote && (
                <p className="text-xs text-teal-800 font-medium">
                  {manualClaimSavedNote}
                </p>
              )}
            </div>
          </div>
        )}

        {/* STEP 4: CAREER INTERESTS */}
        {currentStep === 4 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                4. Career interests
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Share the kinds of roles you want to explore, work you prefer to avoid, and skills you want to build.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700">
                    Roles or fields of interest
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftWizard.rolesUnsure}
                      onChange={(e) =>
                        setDraftWizard((prev) => ({
                          ...prev,
                          rolesUnsure: e.target.checked,
                        }))
                      }
                    />
                    <span>Not sure yet</span>
                  </label>
                </div>
                <input
                  type="text"
                  value={draftWizard.rolesOfInterest}
                  onChange={(e) =>
                    setDraftWizard((prev) => ({
                      ...prev,
                      rolesOfInterest: e.target.value,
                    }))
                  }
                  placeholder="e.g., Operations coordinator, customer implementation, project support, analyst"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Types of work to avoid
                </label>
                <input
                  type="text"
                  value={draftWizard.workToAvoid}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDraftWizard((prev) => ({ ...prev, workToAvoid: val }));
                    setDraftProfile((prev) => ({
                      ...prev,
                      constraints: {
                        ...prev.constraints,
                        excludedIndustries: val,
                      },
                    }));
                  }}
                  placeholder="e.g., 100% commission-only roles, unpaid trials, overnight shifts"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Skills you want to develop
                </label>
                <input
                  type="text"
                  value={draftWizard.skillsToDevelop}
                  onChange={(e) =>
                    setDraftWizard((prev) => ({
                      ...prev,
                      skillsToDevelop: e.target.value,
                    }))
                  }
                  placeholder="e.g., Structured interviewing, spreadsheet reporting, CRM workflows"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 5: PRIVACY AND SHARING */}
        {currentStep === 5 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                5. Privacy and sharing
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Your workspace starts completely private. Sharing with the person who invited you is never preselected.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-teal-50/60 border border-teal-200 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-teal-950">
                <Lock className="w-4 h-4 text-teal-800 shrink-0" />
                <span>Default setting: Private — only you.</span>
              </div>
              <p className="text-xs sm:text-sm text-teal-950/90 leading-relaxed">
                Your profile, résumé uploads, evaluated job postings, outreach drafts, and interview practice belong to your account alone. Application administrators can see whether you accepted your invitation, and nothing inside your career workspace.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-sm text-slate-700">
              <div className="font-semibold text-slate-900">
                Optional reviewer access (future selective sharing)
              </div>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Reviewer invitations are separate from job-seeker workspaces and are currently disabled in Settings → Sharing until item-level selective permissions are enabled. You can export or delete your records at any time from Settings.
              </p>
            </div>
          </div>
        )}

        {/* STEP 6: REVIEW & UNVERIFIED SUGGESTIONS */}
        {currentStep === 6 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                6. Review & confirm
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Check your details below. Any imported résumé text or inviter-supplied suggestions remain marked as needing confirmation until you verify them.
              </p>
            </div>

            {/* Section 11: Inviter-Supplied Suggestions (Accept / Edit / Discard) */}
            {draftSuggestions.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-amber-950">
                    Unverified suggestions supplied by inviter
                  </h3>
                  <p className="text-xs text-amber-900 mt-0.5">
                    These optional notes were never included in your invitation email and are not treated as verified facts. Choose whether to accept (for your review), edit, or discard each item.
                  </p>
                </div>

                <ul className="divide-y divide-amber-200/70">
                  {draftSuggestions.map((sug) => (
                    <li key={sug.id} className="py-3 space-y-2">
                      {editingSuggestionId === sug.id ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editingSuggestionText}
                            onChange={(e) =>
                              setEditingSuggestionText(e.target.value)
                            }
                            className="w-full px-3 py-1.5 text-sm border border-amber-300 rounded-lg bg-white"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                handleAcceptSuggestion(sug, editingSuggestionText)
                              }
                              className="px-3 py-1 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-md"
                            >
                              Save & add for confirmation
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSuggestionId(null)}
                              className="px-3 py-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-0.5">
                            <p className="text-sm text-slate-900">{sug.text}</p>
                            <p className="text-xs text-amber-900">
                              Supplied by {sug.suppliedBy} · Status:{" "}
                              <strong>
                                {sug.decision === "pending"
                                  ? "Unverified — awaiting your choice"
                                  : sug.decision === "accepted"
                                  ? "Added to Evidence (marked Needs clarification)"
                                  : "Discarded"}
                              </strong>
                            </p>
                          </div>

                          {sug.decision === "pending" && (
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleAcceptSuggestion(sug)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-teal-900 bg-white border border-teal-300 hover:bg-teal-50 rounded-md whitespace-nowrap shrink-0"
                              >
                                <Check className="w-3 h-3" />
                                <span>Accept</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSuggestionId(sug.id);
                                  setEditingSuggestionText(sug.text);
                                }}
                                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDiscardSuggestion(sug.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-800 bg-white border border-red-200 hover:bg-red-50 rounded-md whitespace-nowrap shrink-0"
                              >
                                <X className="w-3 h-3" />
                                <span>Discard</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Summary Review Grid */}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm">
              <div>
                <dt className="text-xs font-medium text-slate-500">
                  Preferred name
                </dt>
                <dd className="mt-0.5 font-semibold text-slate-900">
                  {draftProfile.fullName || "Not set yet"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">Location</dt>
                <dd className="mt-0.5 text-slate-900">
                  {draftProfile.location || "Not set yet"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">
                  Minimum base pay
                </dt>
                <dd className="mt-0.5 font-mono tabular-nums text-slate-900">
                  {draftProfile.constraints.minBaseSalaryUnsure ||
                  !draftProfile.constraints.minBaseSalary
                    ? "Not sure yet"
                    : `$${draftProfile.constraints.minBaseSalary.toLocaleString()}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">
                  Work arrangement
                </dt>
                <dd className="mt-0.5 text-slate-900">
                  {draftProfile.constraints.workArrangement === "not_sure"
                    ? "Not sure yet"
                    : draftProfile.constraints.workArrangement}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">
                  Roles of interest
                </dt>
                <dd className="mt-0.5 text-slate-900">
                  {draftWizard.rolesUnsure
                    ? "Not sure yet"
                    : draftWizard.rolesOfInterest || "Not specified yet"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">
                  Workspace privacy
                </dt>
                <dd className="mt-0.5 font-semibold text-teal-900">
                  Private — only you
                </dd>
              </div>
            </dl>

            <label className="flex items-start gap-2.5 cursor-pointer text-sm text-slate-800">
              <input
                type="checkbox"
                checked={draftProfile.profileVerifiedByNora}
                onChange={(e) =>
                  setDraftProfile((prev) => ({
                    ...prev,
                    profileVerifiedByNora: e.target.checked,
                  }))
                }
                className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-800"
              />
              <span>
                I confirm the personal details I entered above are accurate so far (imported or suggested claims remain marked for review until individually confirmed in My Profile).
              </span>
            </label>
          </div>
        )}

        {/* Step Navigation Footer */}
        <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
          <div>
            {currentStep > 1 && (
              <button
                type="button"
                onClick={() =>
                  persistStep((currentStep - 1) as 1 | 2 | 3 | 4 | 5 | 6)
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {currentStep < 6 ? (
              <button
                type="button"
                onClick={() =>
                  persistStep((currentStep + 1) as 1 | 2 | 3 | 4 | 5 | 6)
                }
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs sm:text-sm font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <span>Save & continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  persistStep(6, { completed: true, pausedForLater: false })
                }
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Check className="w-4 h-4" />
                <span>Complete setup & enter workspace</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
