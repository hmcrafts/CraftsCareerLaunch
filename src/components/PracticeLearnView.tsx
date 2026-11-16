import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Search } from "lucide-react";
import {
  SYNTHETIC_CRM_ACCOUNTS,
  getTodayIsoDate,
} from "../data/initialData";
import { requestPracticeFeedbackSmart } from "../services/apiClient";
import {
  Evidence,
  LearningItem,
  PracticeFeedback,
  PracticeMode,
  PracticeSession,
  Profile,
  SyntheticCrmHandoff,
  SyntheticCrmLog,
  SyntheticCrmTask,
  WorkspaceState,
} from "../types/models";
import { SkillsWorthDevelopingPanel } from "./SkillsWorthDevelopingPanel";

interface PracticeLearnViewProps {
  profile: Profile;
  evidence: Evidence[];
  practiceSessions: PracticeSession[];
  learningItems: LearningItem[];
  crmSimulation: {
    searchedQueries: string[];
    conversationLogs: SyntheticCrmLog[];
    followUpTasks: SyntheticCrmTask[];
    handoffNotes: SyntheticCrmHandoff[];
  };
  allowServerSideAi: boolean;
  onSavePracticeSession: (session: Omit<PracticeSession, "id" | "createdAt">) => void;
  onUpdateLearningItem: (item: LearningItem) => void;
  onAddLearningItem: (item: Omit<LearningItem, "id">) => Promise<boolean> | void;
  onUpdateCrmSimulation: (nextSim: PracticeLearnViewProps["crmSimulation"]) => void;
  workspace?: WorkspaceState;
  ownerUid?: string;
  initialSubTab?: "rehearse" | "crm" | "skills" | "learning";
  onSelectOpportunity?: (opportunityId: string) => void;
}

function getPracticePrompts(isNoraProfile: boolean): Record<
  Exclude<PracticeMode, "crm_simulation">,
  { label: string; prompt: string; guidance: string }
> {
  return {
    intro_45s: {
      label: "45-Second Introduction",
      prompt: isNoraProfile
        ? "Tell me briefly about your background and why you are interested in moving from ABA clinical delivery into this role."
        : "Tell me briefly about your background and why you are interested in moving into this role.",
      guidance: isNoraProfile
        ? "Aim for ~95–125 words. Mention GMU Psychology, Little Leaves RBT work, structured data & family communication, and what you bring without apologizing or exaggerating."
        : "Aim for ~95–125 words. Ground your answer in confirmed roles and education from your Evidence Library, and explain what you bring without apologizing or exaggerating.",
    },
    short_answer: {
      label: "Short Answer Rehearsal",
      prompt:
        "How do you stay organized when managing multiple schedules, follow-ups, and detailed records?",
      guidance: isNoraProfile
        ? "Draw on a real routine from Little Leaves session notes or independent tutoring scheduling. Do not invent percentages."
        : "Draw on a real routine from your confirmed work or academic experience. Do not invent percentages.",
    },
    interview_roleplay: {
      label: "Interview Roleplay (Addressing CRM Gap)",
      prompt:
        "This role uses Salesforce every day to track outreach, and I don't see Salesforce on your résumé. How would you handle ramping up?",
      guidance:
        "Acknowledge honestly if you have not used Salesforce in a paid role, connect your real documentation habits, and describe concrete CRM concepts you have practiced.",
    },
    discovery_call: {
      label: "Discovery-Call Practice",
      prompt: isNoraProfile
        ? "You are speaking with a busy Clinic Director at an outpatient ABA practice. Open the call respectfully in 3–4 sentences and ask one grounded discovery question."
        : "You are speaking with a busy operations lead at a prospective client organization. Open the call respectfully in 3–4 sentences and ask one grounded discovery question.",
      guidance: isNoraProfile
        ? "Use real clinic empathy (session notes, BCBA supervision load, parent updates) rather than pushy sales clichés."
        : "Use respectful operational curiosity rather than pushy sales clichés.",
    },
    objection_handling: {
      label: "Objection-Handling Practice",
      prompt:
        "Prospect says: 'We already have a workflow in place and we're too busy right now to switch tools.' How do you respond calmly?",
      guidance:
        "Validate how disruptive workflow transitions feel, avoid arguing, and ask a brief clarifying question or offer low-friction follow-up timing.",
    },
    salesforce_vocab: {
      label: "CRM Vocabulary Check",
      prompt:
        "In plain English, explain the difference between an Account, a Contact, an Activity Log, and a Qualified Meeting Handoff in a B2B CRM.",
      guidance:
        "Demonstrate clear conceptual understanding while keeping training distinct from prior employment.",
    },
  };
}

export const PracticeLearnView: React.FC<PracticeLearnViewProps> = ({
  profile,
  evidence,
  practiceSessions,
  learningItems,
  crmSimulation,
  allowServerSideAi,
  onSavePracticeSession,
  onUpdateLearningItem,
  onAddLearningItem,
  onUpdateCrmSimulation,
  workspace,
  ownerUid = "demo-mode",
  initialSubTab = "rehearse",
  onSelectOpportunity,
}) => {
  const isNoraProfile =
    profile.fullName.trim().toLowerCase() === "nora crafts";
  const practicePrompts = useMemo(
    () => getPracticePrompts(isNoraProfile),
    [isNoraProfile]
  );

  const [subTab, setSubTab] = useState<"rehearse" | "crm" | "skills" | "learning">(
    initialSubTab
  );

  // Rehearsal state
  const [selectedMode, setSelectedMode] =
    useState<Exclude<PracticeMode, "crm_simulation">>("intro_45s");
  const [customPrompt, setCustomPrompt] = useState(
    () => getPracticePrompts(profile.fullName.trim().toLowerCase() === "nora crafts").intro_45s.prompt
  );
  const [responseDraft, setResponseDraft] = useState("");
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  // Synthetic CRM Simulation state
  const [crmSearch, setCrmSearch] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    SYNTHETIC_CRM_ACCOUNTS[0].id
  );
  const [logContactName, setLogContactName] = useState(
    SYNTHETIC_CRM_ACCOUNTS[0].syntheticContacts[0].name
  );
  const [logSummary, setLogSummary] = useState("");
  const [logPainPoints, setLogPainPoints] = useState("");
  const [logTools, setLogTools] = useState("");

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState(getTodayIsoDate(3));
  const [taskPurpose, setTaskPurpose] = useState("");

  const [handoffCriteria, setHandoffCriteria] = useState("");
  const [handoffUnknowns, setHandoffUnknowns] = useState("");
  const [handoffAgenda, setHandoffAgenda] = useState("");

  // Learning plan form
  const [showAddLearn, setShowAddLearn] = useState(false);
  const [learnTitle, setLearnTitle] = useState("");
  const [learnReq, setLearnReq] = useState("");
  const [learnExercise, setLearnExercise] = useState("");

  const flashBanner = (msg: string) => {
    setSavedBanner(msg);
    window.setTimeout(() => setSavedBanner(null), 4000);
  };

  const handleModeSwitch = (mode: Exclude<PracticeMode, "crm_simulation">) => {
    setSelectedMode(mode);
    setCustomPrompt(practicePrompts[mode].prompt);
    setFeedback(null);
  };

  const handleEvaluatePractice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!responseDraft.trim()) return;
    setIsEvaluating(true);
    const { feedback: result } = await requestPracticeFeedbackSmart({
      mode: selectedMode,
      promptQuestion: customPrompt,
      userResponse: responseDraft,
      profile,
      evidence,
      allowServerSideAi,
    });
    setFeedback(result);
    onSavePracticeSession({
      mode: selectedMode,
      promptQuestion: customPrompt,
      noraResponse: responseDraft,
      feedback: result,
      durationMinutes: 10,
    });
    setIsEvaluating(false);
    flashBanner("Evaluated response and saved session to your practice log.");
  };

  // CRM Simulation Helpers
  const filteredAccounts = useMemo(() => {
    if (!crmSearch.trim()) return SYNTHETIC_CRM_ACCOUNTS;
    const q = crmSearch.toLowerCase();
    return SYNTHETIC_CRM_ACCOUNTS.filter(
      (a) =>
        a.organizationName.toLowerCase().includes(q) ||
        a.cityState.toLowerCase().includes(q) ||
        a.syntheticContacts.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [crmSearch]);

  const activeAccount =
    SYNTHETIC_CRM_ACCOUNTS.find((a) => a.id === selectedAccountId) ??
    SYNTHETIC_CRM_ACCOUNTS[0];

  const step1Done = crmSimulation.searchedQueries.length > 0;
  const step2Done = crmSimulation.conversationLogs.length > 0;
  const step3Done = crmSimulation.followUpTasks.length > 0;
  const step4Done = crmSimulation.handoffNotes.length > 0;

  const handleRunCrmSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = crmSearch.trim() || "Potomac";
    setCrmSearch(q);
    if (!crmSimulation.searchedQueries.includes(q)) {
      onUpdateCrmSimulation({
        ...crmSimulation,
        searchedQueries: [...crmSimulation.searchedQueries, q],
      });
    }
  };

  const handleSaveCrmCallLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!logSummary.trim()) return;
    const newLog: SyntheticCrmLog = {
      id: `crmlog-${Date.now()}`,
      accountId: activeAccount.id,
      contactName: logContactName,
      summary: logSummary.trim(),
      painPointsIdentified: logPainPoints.trim(),
      currentToolsNoted: logTools.trim() || "Unknown — ask on next touchpoint",
      createdAt: new Date().toISOString(),
    };
    onUpdateCrmSimulation({
      ...crmSimulation,
      conversationLogs: [newLog, ...crmSimulation.conversationLogs],
    });
    setLogSummary("");
    setLogPainPoints("");
    setLogTools("");
    flashBanner("Step 2 complete: Logged discovery conversation in simulation.");
  };

  const handleSaveCrmTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    const newTask: SyntheticCrmTask = {
      id: `crmtask-${Date.now()}`,
      accountId: activeAccount.id,
      actionTitle: taskTitle.trim(),
      dueDate: taskDue,
      purpose: taskPurpose.trim(),
      completed: false,
    };
    onUpdateCrmSimulation({
      ...crmSimulation,
      followUpTasks: [newTask, ...crmSimulation.followUpTasks],
    });
    setTaskTitle("");
    setTaskPurpose("");
    flashBanner("Step 3 complete: Created CRM follow-up task in simulation.");
  };

  const handleSaveCrmHandoff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!handoffCriteria.trim()) return;
    const newHandoff: SyntheticCrmHandoff = {
      id: `crmhandoff-${Date.now()}`,
      accountId: activeAccount.id,
      qualifiedCriteriaMet: handoffCriteria.trim(),
      openUnknownsForAE: handoffUnknowns.trim() || "Confirm budget authority during AE demo",
      proposedMeetingAgenda: handoffAgenda.trim(),
      createdAt: new Date().toISOString(),
    };
    const nextSim = {
      ...crmSimulation,
      handoffNotes: [newHandoff, ...crmSimulation.handoffNotes],
    };
    onUpdateCrmSimulation(nextSim);
    onSavePracticeSession({
      mode: "crm_simulation",
      promptQuestion: `Synthetic CRM 4-step workflow for ${activeAccount.organizationName}`,
      noraResponse: `Qualified handoff: ${handoffCriteria.trim()} | Open unknowns: ${handoffUnknowns.trim()}`,
      feedback: {
        accuracy:
          "Completed structured account lookup, conversation logging, follow-up tasking, and transparent AE handoff.",
        relevance:
          "Directly mirrors entry-level BDR and Client Onboarding CRM hygiene expectations.",
        clarity: "Separates confirmed clinic facts from open unknowns for the Account Executive.",
        specificExamples: `Practiced on synthetic organization ${activeAccount.organizationName}.`,
        concision: "Structured into scannable CRM fields.",
        unsupportedClaims: [],
        evidenceUsed: ["CRM simulation practice exercise"],
        missingInformation: [],
        reasoning:
          "Completing this workflow lets you discuss CRM concepts accurately in interviews while keeping simulation distinct from workplace Salesforce history.",
        suggestedNextAction:
          "Update your CRM fundamentals item in Targeted Learning Plan to Completed if you feel comfortable with all 4 steps.",
      },
      durationMinutes: 15,
    });
    setHandoffCriteria("");
    setHandoffUnknowns("");
    setHandoffAgenda("");
    flashBanner("Step 4 complete: Recorded AE meeting handoff and logged practice session.");
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Practice & Learn
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 max-w-2xl">
            Rehearse honest, concise answers, practice CRM workflows in a clearly labeled simulation, and focus study strictly on real job requirements.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start shrink-0">
          <button
            type="button"
            onClick={() => setSubTab("rehearse")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              subTab === "rehearse"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Interview & Call Practice
          </button>
          <button
            type="button"
            onClick={() => setSubTab("crm")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              subTab === "crm"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            CRM Simulation
          </button>
          <button
            type="button"
            onClick={() => setSubTab("skills")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              subTab === "skills"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Skills Worth Developing
          </button>
          <button
            type="button"
            onClick={() => setSubTab("learning")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              subTab === "learning"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Learning Plan ({learningItems.length})
          </button>
        </div>
      </div>

      {savedBanner && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-2.5 text-xs font-medium text-teal-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-teal-800 shrink-0" />
          <span>{savedBanner}</span>
        </div>
      )}

      {/* SUB-TAB 1: INTERVIEW, DISCOVERY & OBJECTION PRACTICE */}
      {subTab === "rehearse" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg w-fit">
            {(
              Object.keys(practicePrompts) as Array<
                Exclude<PracticeMode, "crm_simulation">
              >
            ).map((modeKey) => (
              <button
                key={modeKey}
                type="button"
                onClick={() => handleModeSwitch(modeKey)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                  selectedMode === modeKey
                    ? "bg-white text-slate-950 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {practicePrompts[modeKey].label}
              </button>
            ))}
          </div>

          <form
            onSubmit={handleEvaluatePractice}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-500">
                Practice prompt (editable)
              </label>
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="w-full px-3 py-2 text-sm font-semibold text-slate-900 border border-slate-300 rounded-lg bg-white"
              />
              <p className="text-xs text-slate-600 pt-1">
                <strong>Coach note:</strong> {practicePrompts[selectedMode].guidance}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <label htmlFor="nora-practice-answer" className="font-medium text-slate-800">
                  Your spoken or written response
                </label>
                <span className="font-mono tabular-nums">
                  {responseDraft.trim() ? responseDraft.trim().split(/\s+/).length : 0} words
                </span>
              </div>
              <textarea
                id="nora-practice-answer"
                rows={6}
                required
                value={responseDraft}
                onChange={(e) => setResponseDraft(e.target.value)}
                placeholder="Type what you would actually say in plain English..."
                className="w-full p-3.5 text-sm leading-relaxed border border-slate-300 rounded-lg bg-white"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Never advises claiming unearned certifications or workplace Salesforce history.
              </span>
              <button
                type="submit"
                disabled={!responseDraft.trim() || isEvaluating}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
              >
                {isEvaluating ? "Reviewing answer..." : "Get Honest Feedback & Save Session"}
              </button>
            </div>
          </form>

          {feedback && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <h2 className="text-base font-semibold text-slate-900 pb-3 border-b border-slate-200">
                Six-Point Constructive Feedback
              </h2>

              {feedback.unsupportedClaims.length > 0 && (
                <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-950">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Unsupported Claim Warning ({feedback.unsupportedClaims.length})</span>
                  </div>
                  <ul className="text-xs text-amber-900 list-disc pl-4 space-y-1">
                    {feedback.unsupportedClaims.map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm">
                <div>
                  <span className="font-semibold text-slate-900 block">1. Accuracy</span>
                  <p className="text-slate-700 mt-0.5">{feedback.accuracy}</p>
                </div>
                <div>
                  <span className="font-semibold text-slate-900 block">2. Relevance</span>
                  <p className="text-slate-700 mt-0.5">{feedback.relevance}</p>
                </div>
                <div>
                  <span className="font-semibold text-slate-900 block">3. Clarity</span>
                  <p className="text-slate-700 mt-0.5">{feedback.clarity}</p>
                </div>
                <div>
                  <span className="font-semibold text-slate-900 block">
                    4. Specific Examples
                  </span>
                  <p className="text-slate-700 mt-0.5">{feedback.specificExamples}</p>
                </div>
                <div>
                  <span className="font-semibold text-slate-900 block">5. Concision</span>
                  <p className="text-slate-700 mt-0.5">{feedback.concision}</p>
                </div>
                <div>
                  <span className="font-semibold text-teal-900 block">
                    6. Suggested Next Step
                  </span>
                  <p className="text-slate-800 mt-0.5 font-medium">
                    {feedback.suggestedNextAction}
                  </p>
                </div>
              </div>

              {feedback.revisedExample && (
                <div className="pt-4 border-t border-slate-200 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-800">
                    Editable Grounded Example (for comparison — edit freely):
                  </div>
                  <p className="text-xs sm:text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3.5 leading-relaxed">
                    {feedback.revisedExample}
                  </p>
                </div>
              )}
            </section>
          )}

          {practiceSessions.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Completed Practice Sessions ({practiceSessions.length})
              </h3>
              <ul className="divide-y divide-slate-100 text-xs">
                {practiceSessions.slice(0, 8).map((s) => (
                  <li key={s.id} className="py-2.5 flex items-center justify-between gap-4">
                    <div>
                      <strong className="text-slate-900">{s.promptQuestion}</strong>
                      <div className="text-slate-500 mt-0.5 line-clamp-1">
                        {s.noraResponse}
                      </div>
                    </div>
                    <span className="font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* SUB-TAB 2: SYNTHETIC CRM SIMULATION (FEATURE 7) */}
      {subTab === "crm" && (
        <div className="space-y-6">
          {/* Mandatory Prominent Simulation Label */}
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-2">
            <div className="text-sm font-bold text-amber-950">
              Practice simulation—not Salesforce
            </div>
            <p className="text-xs sm:text-sm text-amber-900 leading-relaxed">
              This interactive sandbox uses 100% synthetic organizations and fictional contacts so you can practice standard CRM hygiene: (1) searching existing records before creating duplicates, (2) logging a discovery conversation, (3) scheduling a follow-up task, and (4) writing a clean Account Executive meeting handoff. <strong>Never enter real patient, family, or confidential clinical information.</strong>
            </p>
            <div className="pt-1 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-800">
              <span>1. Search existing: {step1Done ? "Completed" : "Pending"}</span>
              <span aria-hidden="true">·</span>
              <span>2. Log call: {step2Done ? "Completed" : "Pending"}</span>
              <span aria-hidden="true">·</span>
              <span>3. Follow-up task: {step3Done ? "Completed" : "Pending"}</span>
              <span aria-hidden="true">·</span>
              <span>4. AE handoff: {step4Done ? "Completed" : "Pending"}</span>
            </div>
          </div>

          {/* Step 1: Search Existing Synthetic Accounts */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  01. Search Existing Synthetic Accounts
                </h2>
                <p className="text-xs text-slate-600">
                  In a real CRM, reps always search existing Accounts & Contacts first so two people do not create duplicate clinic records or double-call the same director.
                </p>
              </div>
              <form onSubmit={handleRunCrmSearch} className="flex items-center gap-2 shrink-0">
                <input
                  type="search"
                  value={crmSearch}
                  onChange={(e) => setCrmSearch(e.target.value)}
                  placeholder="e.g., Potomac or Reston"
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Search Records</span>
                </button>
              </form>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {filteredAccounts.map((acct) => {
                const selected = acct.id === activeAccount.id;
                return (
                  <button
                    key={acct.id}
                    type="button"
                    onClick={() => {
                      setSelectedAccountId(acct.id);
                      if (acct.syntheticContacts[0]) {
                        setLogContactName(acct.syntheticContacts[0].name);
                      }
                    }}
                    className={`text-left p-4 rounded-lg border transition-colors space-y-2 ${
                      selected
                        ? "border-teal-700 bg-teal-50/40"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-900">
                      {acct.organizationName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {acct.sector} · {acct.cityState}
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      {acct.currentWorkflowSummary}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Selected Synthetic Account Workspace: Steps 2, 3, 4 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Step 2: Log Conversation */}
            <form
              onSubmit={handleSaveCrmCallLog}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  02. Record a Conversation ({activeAccount.organizationName})
                </h3>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Fictional contact spoken with
                  </label>
                  <select
                    value={logContactName}
                    onChange={(e) => setLogContactName(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {activeAccount.syntheticContacts.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name} — {c.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Call / email summary *
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={logSummary}
                    onChange={(e) => setLogSummary(e.target.value)}
                    placeholder="e.g., Spoke briefly between sessions; confirmed they have 18 clinicians and spend Fridays reconciling paper/spreadsheet schedules."
                    className="w-full p-2.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Operational pain points heard
                  </label>
                  <input
                    type="text"
                    value={logPainPoints}
                    onChange={(e) => setLogPainPoints(e.target.value)}
                    placeholder="e.g., RBT onboarding time & BCBA note review backlog"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Current software noted
                  </label>
                  <input
                    type="text"
                    value={logTools}
                    onChange={(e) => setLogTools(e.target.value)}
                    placeholder="e.g., Spreadsheets + legacy note system"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg"
              >
                Log Conversation
              </button>
            </form>

            {/* Step 3: Create Follow-Up Task */}
            <form
              onSubmit={handleSaveCrmTask}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  03. Create a Follow-Up Task
                </h3>
                <p className="text-xs text-slate-600">
                  Every active prospect record should have one clear next action and due date so follow-ups never slip through the cracks.
                </p>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Follow-up task title *
                  </label>
                  <input
                    type="text"
                    required
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="e.g., Send calendar invite & confirm Operations Manager attendance"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Due date
                  </label>
                  <input
                    type="date"
                    value={taskDue}
                    onChange={(e) => setTaskDue(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Purpose of touchpoint
                  </label>
                  <textarea
                    rows={3}
                    value={taskPurpose}
                    onChange={(e) => setTaskPurpose(e.target.value)}
                    placeholder="e.g., Share 2-bullet agenda ahead of Tuesday walkthrough so Dr. Patel's time is respected."
                    className="w-full p-2.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg"
              >
                Save Follow-Up Task
              </button>
            </form>

            {/* Step 4: Prepare Meeting Handoff */}
            <form
              onSubmit={handleSaveCrmHandoff}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  04. Prepare AE Meeting Handoff
                </h3>
                <p className="text-xs text-slate-600">
                  Account Executives trust BDRs who state clearly what was verified versus what still needs to be asked on the demo.
                </p>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Confirmed qualification facts *
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={handoffCriteria}
                    onChange={(e) => setHandoffCriteria(e.target.value)}
                    placeholder="e.g., 18-clinician outpatient ABA clinic; Clinical Director confirmed active interest in streamlining RBT scheduling + session data."
                    className="w-full p-2.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Open unknowns for AE to uncover
                  </label>
                  <input
                    type="text"
                    value={handoffUnknowns}
                    onChange={(e) => setHandoffUnknowns(e.target.value)}
                    placeholder="e.g., Exact contract renewal date & budget range not yet confirmed"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Suggested 20-minute call focus
                  </label>
                  <input
                    type="text"
                    value={handoffAgenda}
                    onChange={(e) => setHandoffAgenda(e.target.value)}
                    placeholder="e.g., RBT mobile data entry + BCBA supervision dashboard"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                Save Handoff & Complete Simulation
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: TARGETED LEARNING PLAN */}
      {subTab === "learning" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs sm:text-sm text-slate-600 max-w-2xl">
              Every learning item below is tied to a specific requirement from your evaluated opportunities, with notes on how to describe self-study honestly.
            </p>
            <button
              type="button"
              onClick={() => setShowAddLearn((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Learning Goal</span>
            </button>
          </div>

          {showAddLearn && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!learnTitle.trim()) return;
                onAddLearningItem({
                  title: learnTitle.trim(),
                  tiedToRequirement: learnReq.trim() || "Target role skill gap",
                  status: "Planned",
                  estimatedHours: 2,
                  practicalExercise:
                    learnExercise.trim() || "Complete hands-on exercise and record reflection.",
                  honestFramingNote:
                    "Present as self-directed preparation, never as paid workplace tenure.",
                });
                setLearnTitle("");
                setLearnReq("");
                setLearnExercise("");
                setShowAddLearn(false);
              }}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Skill or topic *
                  </label>
                  <input
                    type="text"
                    required
                    value={learnTitle}
                    onChange={(e) => setLearnTitle(e.target.value)}
                    placeholder="e.g., Help-desk ticket triage & escalation notes"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tied to job requirement
                  </label>
                  <input
                    type="text"
                    value={learnReq}
                    onChange={(e) => setLearnReq(e.target.value)}
                    placeholder="e.g., Customer Support Specialist ticketing requirement"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Concrete practice exercise
                  </label>
                  <input
                    type="text"
                    value={learnExercise}
                    onChange={(e) => setLearnExercise(e.target.value)}
                    placeholder="e.g., Draft 3 sample support replies translating clinical user questions into clear bug steps"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddLearn(false)}
                  className="px-3 py-1.5 text-xs text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 rounded-lg"
                >
                  Add Item
                </button>
              </div>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
            {learningItems.map((item) => (
              <div
                key={item.id}
                className="p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
              >
                <div className="space-y-1.5 max-w-3xl">
                  <div className="text-xs text-slate-500">
                    Requirement link: {item.tiedToRequirement} · Est.{" "}
                    <span className="font-mono tabular-nums">{item.estimatedHours}h</span>
                  </div>
                  <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
                  <p className="text-xs sm:text-sm text-slate-700">
                    <strong>Exercise:</strong> {item.practicalExercise}
                  </p>
                  <p className="text-xs text-slate-500">
                    <strong>Honest framing:</strong> {item.honestFramingNote}
                  </p>
                </div>

                <select
                  value={item.status}
                  onChange={(e) =>
                    onUpdateLearningItem({
                      ...item,
                      status: e.target.value as LearningItem["status"],
                    })
                  }
                  aria-label={`Status for ${item.title}`}
                  className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white shrink-0 self-start"
                >
                  <option value="Planned">Planned</option>
                  <option value="In progress">In progress</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-TAB: SKILLS WORTH DEVELOPING ACROSS SAVED OPPORTUNITIES */}
      {subTab === "skills" && workspace && (
        <SkillsWorthDevelopingPanel
          workspace={workspace}
          ownerUid={ownerUid}
          onSelectOpportunity={onSelectOpportunity}
          onAddLearningItem={onAddLearningItem}
          onOpenLearningPlanTab={() => setSubTab("learning")}
        />
      )}
    </div>
  );
};
