import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Lock,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  ISOLATED_SAMPLE_OPPORTUNITIES,
  getTodayIsoDate,
} from "../data/initialData";
import { FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID } from "../firebase";
import { verifyBackendSessionAuth } from "../services/apiClient";
import {
  buildExportBundle,
  verifyCrossUserIsolationDenied,
  verifyServerSideRecordPersistence,
} from "../services/firestoreWorkspace";
import {
  Contact,
  NavSection,
  Opportunity,
  OpportunityStage,
  PrivateDocumentMeta,
  TimeLogEntry,
  WorkspaceState,
} from "../types/models";

interface DecisionsProgressViewProps {
  workspace: WorkspaceState;
  isDemoMode: boolean;
  currentUid: string | null;
  canResetStarterWorkspace?: boolean;
  onAddTimeLog: (entry: Omit<TimeLogEntry, "id">) => Promise<boolean>;
  onImportWorkspace: (nextState: WorkspaceState) => Promise<boolean>;
  onResetToStarter: () => Promise<boolean>;
  onDeleteAllRecords: () => Promise<{ deletedCount: number; deletedFilesCount: number } | null>;
  onDownloadPrivateFile: (meta: PrivateDocumentMeta) => Promise<void>;
  onDeletePrivateFile: (docId: string) => Promise<boolean>;
  onTriggerSimulatedFailedSave: () => Promise<void>;
  onNavigateToOpportunity: (oppId: string) => void;
  onNavigate: (section: NavSection) => void;
}

const STAGES_ORDER: OpportunityStage[] = [
  "Research / preparation",
  "Clarifying details",
  "Ready to apply",
  "Applied",
  "Conversation / Screen",
  "Interviewing",
  "Offer received",
  "Deprioritized / Archived",
];

export const DecisionsProgressView: React.FC<DecisionsProgressViewProps> = ({
  workspace,
  isDemoMode,
  currentUid,
  canResetStarterWorkspace = false,
  onAddTimeLog,
  onImportWorkspace,
  onResetToStarter,
  onDeleteAllRecords,
  onDownloadPrivateFile,
  onDeletePrivateFile,
  onTriggerSimulatedFailedSave,
  onNavigateToOpportunity,
  onNavigate,
}) => {
  const [subTab, setSubTab] = useState<"progress" | "compare" | "data">("progress");

  // Optional Time Log Form
  const [logActivity, setLogActivity] = useState<TimeLogEntry["activity"]>(
    "Opportunity research & verification"
  );
  const [logMinutes, setLogMinutes] = useState(30);
  const [logNote, setLogNote] = useState("");

  // Comparison selection
  const [includeSampleInCompare, setIncludeSampleInCompare] = useState(true);

  // Safe inline confirmation states (no window.confirm)
  const [confirmAction, setConfirmAction] = useState<"none" | "reset" | "delete_all">("none");
  const [isExecutingBulkAction, setIsExecutingBulkAction] = useState(false);
  const [dataMessage, setDataMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // Interactive Acceptance Verification Results
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);
  const [diagnosticsLog, setDiagnosticsLog] = useState<
    Array<{ label: string; passed: boolean; detail: string }>
  >([]);

  const todayIso = getTodayIsoDate(0);
  const realOpportunities = workspace.opportunities.filter((o) => !o.isSampleRecord);

  // Transparent Denominators & Counts
  const totalRealOpps = realOpportunities.length;
  const submittedOpps = realOpportunities.filter(
    (o) =>
      o.appliedConfirmedByNora === "applied" ||
      ["Applied", "Conversation / Screen", "Interviewing", "Offer received"].includes(
        o.stage
      )
  );
  const interviewStageOpps = realOpportunities.filter((o) =>
    ["Interviewing", "Offer received"].includes(o.stage)
  );
  const offerOpps = realOpportunities.filter((o) => o.stage === "Offer received");

  const contactedPeople = workspace.contacts.filter(
    (c) => c.replyStatus !== "Not contacted yet" && !c.doNotContact
  );
  const activeConversations = workspace.contacts.filter(
    (c) => c.replyStatus === "Replied — conversation active"
  );

  // Overdue follow-ups across tasks and contacts
  const overdueTasks = workspace.tasks.filter(
    (t) => !t.completed && !t.archived && t.dueDate && t.dueDate < todayIso
  );
  const overdueContacts = workspace.contacts.filter(
    (c) => !c.doNotContact && c.nextActionDueDate && c.nextActionDueDate < todayIso
  );

  // Channel conversation table
  const channelStats = useMemo(() => {
    const map = new Map<
      string,
      { total: number; conversationsOrInterviews: number }
    >();
    for (const opp of realOpportunities) {
      const ch = opp.intakeChannel;
      const cur = map.get(ch) ?? { total: 0, conversationsOrInterviews: 0 };
      cur.total += 1;
      if (
        ["Conversation / Screen", "Interviewing", "Offer received"].includes(
          opp.stage
        )
      ) {
        cur.conversationsOrInterviews += 1;
      }
      map.set(ch, cur);
    }
    return Array.from(map.entries());
  }, [realOpportunities]);

  // Time spent summary
  const timeByActivity = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of workspace.timeLogs) {
      totals.set(entry.activity, (totals.get(entry.activity) ?? 0) + entry.minutes);
    }
    return Array.from(totals.entries());
  }, [workspace.timeLogs]);

  const comparePool: Opportunity[] = useMemo(() => {
    const activeReal = realOpportunities.filter((o) => !o.archived);
    return includeSampleInCompare
      ? [...activeReal, ...ISOLATED_SAMPLE_OPPORTUNITIES]
      : activeReal;
  }, [realOpportunities, includeSampleInCompare]);

  const handleLogTimeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (logMinutes <= 0) return;
    const ok = await onAddTimeLog({
      date: todayIso,
      activity: logActivity,
      minutes: Number(logMinutes),
      note: logNote.trim(),
    });
    if (ok) {
      setLogNote("");
    }
  };

  const ownerFilePrefix = useMemo(() => {
    const cleaned = (workspace.profile.fullName || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return cleaned || "career-launch";
  }, [workspace.profile.fullName]);

  const handleExportJson = () => {
    const payload = buildExportBundle(workspace);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ownerFilePrefix}-career-launch-records-${todayIso}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDataMessage({
      kind: "success",
      text: `Exported complete workspace (${totalRealOpps} opportunities, ${workspace.evidence.length} evidence items, ${workspace.contacts.length} contacts, and ${workspace.documents.length} private file metadata references) as JSON.`,
    });
  };

  const handleExportOpportunitiesCsv = () => {
    const esc = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
    const rows = [
      [
        "ID",
        "Employer",
        "Title",
        "Stage",
        "Opening_Verification",
        "Employer_Published_Base_Pay",
        "Employer_Published_Variable_Pay",
        "Location",
        "Official_Website",
        "Posting_URL",
        "Next_Action",
        "Next_Action_Due",
      ].join(","),
      ...realOpportunities.map((o) =>
        [
          esc(o.id),
          esc(o.employer),
          esc(o.title),
          esc(o.stage),
          esc(o.openingAvailabilityStatus),
          esc(o.compensation.employerPublishedBase || "Unknown"),
          esc(o.compensation.employerPublishedVariable || "Unknown"),
          esc(o.location),
          esc(o.officialWebsite),
          esc(o.postingUrl),
          esc(o.nextAction),
          esc(o.nextActionDueDate),
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ownerFilePrefix}-opportunities-${todayIso}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setDataMessage({
      kind: "success",
      text: "Exported your real opportunities (excluding sample data) to CSV.",
    });
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as WorkspaceState;
      if (
        !parsed.profile ||
        !Array.isArray(parsed.opportunities) ||
        !Array.isArray(parsed.evidence)
      ) {
        setDataMessage({
          kind: "error",
          text: "Import failed: JSON file does not match Career Launch workspace schema.",
        });
        return;
      }
      const ok = await onImportWorkspace(parsed);
      if (ok) {
        setDataMessage({
          kind: "success",
          text: `Restored workspace records from "${file.name}" into your account.`,
        });
      }
    } catch {
      setDataMessage({
        kind: "error",
        text: "Import failed: Could not parse JSON file.",
      });
    }
    e.target.value = "";
  };

  const handleRunAcceptanceDiagnostics = async () => {
    if (isDemoMode || !currentUid) return;
    setRunningDiagnostics(true);
    const results: Array<{ label: string; passed: boolean; detail: string }> = [];

    try {
      const serverCheck = await verifyServerSideRecordPersistence(currentUid);
      results.push({
        label: "1. Live Cloud Firestore Server Read (Not Local Cache)",
        passed: serverCheck.verifiedFromServer,
        detail: serverCheck.verifiedFromServer
          ? `Fetched directly from Google Cloud Firestore server: ${serverCheck.opportunityCountOnServer} opportunity record(s) persisted under UID ${currentUid.slice(
              0,
              10
            )}….`
          : "User document was not found on Firestore server.",
      });
    } catch (err) {
      results.push({
        label: "1. Live Cloud Firestore Server Read",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const isolation = await verifyCrossUserIsolationDenied(currentUid);
      const bothBlocked =
        isolation.otherUserProfileBlocked && isolation.otherUserOpportunitiesBlocked;
      results.push({
        label: "2. Cross-User Isolation (Another User's Records Blocked)",
        passed: bothBlocked,
        detail: bothBlocked
          ? "Firestore Security Rules rejected reading another user's profile and opportunities with PERMISSION_DENIED."
          : "Unexpected cross-user rule response.",
      });
    } catch (err) {
      results.push({
        label: "2. Cross-User Isolation",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const backendCheck = await verifyBackendSessionAuth();
      const passed =
        backendCheck.unauthenticatedBlocked401 &&
        backendCheck.authenticatedAccepted200 &&
        backendCheck.verifiedUid === currentUid;
      results.push({
        label: "3. Backend API Authorization (Unauthenticated 401 + Bearer JWT 200)",
        passed,
        detail: passed
          ? `Unauthenticated /api/auth/session blocked with HTTP 401; signed-in Bearer JWT verified via Google SecureToken JWKS for UID ${currentUid.slice(
              0,
              10
            )}….`
          : `Unauth 401=${backendCheck.unauthenticatedBlocked401}, Auth 200=${backendCheck.authenticatedAccepted200}.`,
      });
    } catch (err) {
      results.push({
        label: "3. Backend API Authorization",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    setDiagnosticsLog(results);
    setRunningDiagnostics(false);
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Decisions, Progress & Data Control
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 max-w-2xl">
            Transparent counts with real denominators, side-by-side base versus variable pay comparison, private file management, backup status, and complete export/deletion control.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start shrink-0">
          <button
            type="button"
            onClick={() => setSubTab("progress")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              subTab === "progress"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Progress & Channels
          </button>
          <button
            type="button"
            onClick={() => setSubTab("compare")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              subTab === "compare"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Offer & Pay Comparison
          </button>
          <button
            type="button"
            onClick={() => setSubTab("data")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              subTab === "data"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Data, Backups & Diagnostics
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: PROGRESS & TRANSPARENT DENOMINATORS */}
      {subTab === "progress" && (
        <div className="space-y-6">
          {/* Top 4 Transparent Denominator Strip */}
          <section className="bg-white border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
            <div className="p-5 space-y-1">
              <div className="text-xs text-slate-500">Submitted / Evaluated</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {submittedOpps.length} / {totalRealOpps}
              </div>
              <p className="text-xs text-slate-600">
                Applications submitted out of {totalRealOpps} tracked openings (quality over volume)
              </p>
            </div>
            <div className="p-5 space-y-1">
              <div className="text-xs text-slate-500">Outreach Replies</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {activeConversations.length} / {contactedPeople.length}
              </div>
              <p className="text-xs text-slate-600">
                Active conversations from {contactedPeople.length} contacted people
              </p>
            </div>
            <div className="p-5 space-y-1">
              <div className="text-xs text-slate-500">Interviews & Offers</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {interviewStageOpps.length} / {submittedOpps.length}
              </div>
              <p className="text-xs text-slate-600">
                Interviewing ({interviewStageOpps.length}) · Written offers ({offerOpps.length})
              </p>
            </div>
            <div className="p-5 space-y-1">
              <div className="text-xs text-slate-500">Practice Completed</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {workspace.practiceSessions.length}
              </div>
              <p className="text-xs text-slate-600">
                Rehearsals & CRM simulations logged
              </p>
            </div>
          </section>

          {/* Opportunities by Stage & Channel Effectiveness */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h2 className="text-base font-semibold text-slate-900">
                Opportunities by Stage
              </h2>
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-2 font-medium">Stage</th>
                    <th className="py-2 font-medium text-right">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {STAGES_ORDER.map((st) => {
                    const count = realOpportunities.filter((o) => o.stage === st).length;
                    return (
                      <tr key={st}>
                        <td className="py-2.5 text-slate-800">{st}</td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-slate-900 font-semibold">
                          {count} / {totalRealOpps}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Which Channels Produce Actual Conversations
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Tracks real human screens/interviews by how the opportunity was developed.
                </p>
              </div>
              {channelStats.length === 0 ? (
                <p className="text-sm text-slate-500">No opportunities recorded yet.</p>
              ) : (
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2 font-medium">Channel</th>
                      <th className="py-2 font-medium text-right">
                        Conversations / Tracked
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {channelStats.map(([ch, stats]) => (
                      <tr key={ch}>
                        <td className="py-2.5 text-slate-800">{ch}</td>
                        <td className="py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {stats.conversationsOrInterviews} / {stats.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {/* Overdue Follow-Ups & Optional Time Log */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
              <h2 className="text-base font-semibold text-slate-900">
                Past-Target Follow-Ups ({overdueTasks.length + overdueContacts.length})
              </h2>
              {overdueTasks.length === 0 && overdueContacts.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No overdue follow-ups. Any target date earlier than {todayIso} will surface here so you can act on it or reschedule calmly.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 text-xs">
                  {overdueTasks.map((t) => (
                    <li key={t.id} className="py-2.5 flex items-center justify-between gap-3">
                      <span>
                        <strong className="text-slate-900">{t.title}</strong> (target{" "}
                        <span className="font-mono tabular-nums">{t.dueDate}</span>)
                      </span>
                      <button
                        type="button"
                        onClick={() => onNavigate("today")}
                        className="text-teal-800 hover:underline font-medium shrink-0"
                      >
                        Reschedule in Today
                      </button>
                    </li>
                  ))}
                  {overdueContacts.map((c: Contact) => (
                    <li key={c.id} className="py-2.5 flex items-center justify-between gap-3">
                      <span>
                        <strong className="text-slate-900">{c.name}:</strong> {c.nextAction} (
                        <span className="font-mono tabular-nums">{c.nextActionDueDate}</span>)
                      </span>
                      <button
                        type="button"
                        onClick={() => onNavigate("people")}
                        className="text-teal-800 hover:underline font-medium shrink-0"
                      >
                        Open Contact
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Time Spent by Activity (Optional)
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Log time only if it helps you see whether energy is going toward direct applications, relationships, or preparation.
                </p>
              </div>

              <form
                onSubmit={handleLogTimeSubmit}
                className="grid grid-cols-1 sm:grid-cols-3 gap-2"
              >
                <select
                  value={logActivity}
                  onChange={(e) =>
                    setLogActivity(e.target.value as TimeLogEntry["activity"])
                  }
                  className="sm:col-span-2 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Opportunity research & verification">
                    Opportunity research & verification
                  </option>
                  <option value="Application tailoring">Application tailoring</option>
                  <option value="Outreach & informational conversations">
                    Outreach & informational conversations
                  </option>
                  <option value="Interview & CRM practice">
                    Interview & CRM practice
                  </option>
                  <option value="Skill building">Skill building</option>
                </select>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={5}
                    max={480}
                    value={logMinutes}
                    onChange={(e) => setLogMinutes(Number(e.target.value))}
                    className="w-20 px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Log</span>
                  </button>
                </div>
              </form>

              {timeByActivity.length > 0 && (
                <ul className="divide-y divide-slate-100 text-xs">
                  {timeByActivity.map(([act, mins]) => (
                    <li key={act} className="py-2 flex items-center justify-between">
                      <span className="text-slate-700">{act}</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900">
                        {mins} min
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: SIDE-BY-SIDE OFFER & COMPENSATION COMPARISON */}
      {subTab === "compare" && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Side-by-Side Opportunity & Offer Comparison
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Guaranteed base pay and variable commission are strictly separated. Never treat target commission (OTE) as guaranteed income.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={includeSampleInCompare}
                onChange={(e) => setIncludeSampleInCompare(e.target.checked)}
                className="rounded border-slate-300 text-teal-800"
              />
              <span>Include sample salaried role for benchmark</span>
            </label>
          </div>

          {comparePool.length === 0 ? (
            <p className="text-sm text-slate-500">
              Add at least one opportunity to compare compensation and advancement details.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-800">
                    <th className="py-3 px-4 font-semibold w-48">Comparison Factor</th>
                    {comparePool.map((opp) => (
                      <th key={opp.id} className="py-3 px-4 font-semibold min-w-[240px]">
                        <button
                          type="button"
                          onClick={() => onNavigateToOpportunity(opp.id)}
                          className="text-left hover:underline text-teal-950"
                        >
                          {opp.title} — {opp.employer}
                        </button>
                        {opp.isSampleRecord && (
                          <span className="block font-normal text-amber-800 mt-0.5">
                            Sample comparison benchmark
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 align-top">
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      1. Guaranteed Base Pay
                    </td>
                    {comparePool.map((opp) => (
                      <td
                        key={opp.id}
                        className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-900"
                      >
                        {opp.compensation.employerPublishedBase ||
                          "Unknown — needs employer verification"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      2. Variable / Commission Pay (Separate — Not Guaranteed)
                    </td>
                    {comparePool.map((opp) => (
                      <td key={opp.id} className="py-3 px-4 text-slate-700 space-y-1">
                        <div className="font-mono tabular-nums">
                          {opp.compensation.employerPublishedVariable || "Unknown / None"}
                        </div>
                        {opp.compensation.variableAssumptionsNote && (
                          <div className="text-amber-900">
                            Assumption check: {opp.compensation.variableAssumptionsNote}
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-900">3. Benefits</td>
                    {comparePool.map((opp) => (
                      <td key={opp.id} className="py-3 px-4 text-slate-700">
                        {opp.compensation.benefitsDocumented || "Undocumented"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      4. Commute & Schedule
                    </td>
                    {comparePool.map((opp) => (
                      <td key={opp.id} className="py-3 px-4 text-slate-700">
                        {opp.location} ({opp.workArrangement}) ·{" "}
                        {opp.commuteAndScheduleNotes || "Schedule unverified"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-900">5. Training</td>
                    {comparePool.map((opp) => (
                      <td key={opp.id} className="py-3 px-4 text-slate-700">
                        {opp.trainingProvidedInfo || "Unverified — ask during screening"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      6. Core Responsibilities
                    </td>
                    {comparePool.map((opp) => (
                      <td key={opp.id} className="py-3 px-4 text-slate-700">
                        {opp.coreDuties.length > 0
                          ? opp.coreDuties.slice(0, 3).join("; ")
                          : "Verify from official posting"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      7. Written Advancement Information
                    </td>
                    {comparePool.map((opp) => (
                      <td key={opp.id} className="py-3 px-4 text-slate-700">
                        {opp.writtenAdvancementInfo ||
                          "No written advancement path documented yet"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      8. Outstanding Questions
                    </td>
                    {comparePool.map((opp) => (
                      <td key={opp.id} className="py-3 px-4 text-amber-950">
                        {opp.outstandingQuestions.length > 0
                          ? opp.outstandingQuestions.join(" · ")
                          : "None listed"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* SUB-TAB 3: DATABASE BACKUPS, PRIVATE FILES, EXPORT, DELETION & ACCEPTANCE DIAGNOSTICS */}
      {subTab === "data" && (
        <div className="space-y-6">
          {dataMessage && (
            <div
              className={`rounded-lg px-4 py-2.5 text-xs font-medium border ${
                dataMessage.kind === "error"
                  ? "bg-red-50 border-red-300 text-red-900"
                  : "bg-teal-50 border-teal-200 text-teal-900"
              }`}
            >
              {dataMessage.text}
            </div>
          )}

          {/* 1. Database Persistence, Backup & Recovery Arrangements (Honest Disclosure) */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Database Persistence, Backup & Recovery Status
            </h2>

            <div className="space-y-2.5 text-sm text-slate-700 leading-relaxed max-w-3xl">
              <p>
                <strong>Primary system of record:</strong>{" "}
                {isDemoMode ? (
                  <span className="text-amber-900 font-semibold">
                    Demo mode — database not connected. Sign in with Google to persist records in Cloud Firestore.
                  </span>
                ) : (
                  <>
                    Connected to <strong>Google Cloud Firestore</strong> (Project:{" "}
                    <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">
                      {FIREBASE_PROJECT_ID}
                    </code>
                    , Database:{" "}
                    <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">
                      {FIRESTORE_DATABASE_ID}
                    </code>
                    ). Browser <code className="font-mono text-xs">localStorage</code> is not used to store your records.
                  </>
                )}
              </p>

              <p>
                <strong>Backup & recovery arrangements (not enabled by default):</strong>{" "}
                Cloud Firestore automatically replicates live documents across storage zones for hardware fault tolerance.{" "}
                <strong className="text-slate-900">
                  However, automated scheduled backups and Point-in-Time Recovery (PITR) are NOT verified or enabled by default
                </strong>{" "}
                on this free-tier Spark database. Accidental deletions or overwrites cannot be rolled back automatically unless you:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-xs text-slate-600">
                <li>
                  Export regular JSON snapshots below for immediate free offline backup, or
                </li>
                <li>
                  Manually configure <strong>Point-in-Time Recovery (7-day window)</strong> and{" "}
                  <strong>Scheduled Backups</strong> in the Google Cloud / Firebase Console under{" "}
                  <code className="font-mono">Firestore &gt; Backups / Disaster Recovery</code> (note: Google Cloud requires attaching a Blaze billing account to enable managed scheduled backups or PITR).
                </li>
              </ul>
            </div>

            <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleExportJson}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Full Records (.json)</span>
              </button>

              <button
                type="button"
                onClick={handleExportOpportunitiesCsv}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Opportunities (.csv)</span>
              </button>

              <label className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap shrink-0">
                <Upload className="w-3.5 h-3.5" />
                <span>Import Records (.json)</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportJsonFile}
                  className="sr-only"
                />
              </label>
            </div>
          </section>

          {/* 2. Private Uploaded Files Vault (All Categories) */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-teal-800 shrink-0" />
                <h2 className="text-base font-semibold text-slate-900">
                  Private Uploaded Files ({workspace.documents.length})
                </h2>
              </div>
              <span className="text-xs text-slate-500">
                Stored in non-listable private records · Zero public URLs
              </span>
            </div>

            {workspace.documents.length === 0 ? (
              <p className="text-xs text-slate-500">
                No private documents uploaded yet. Any résumé or job description uploaded in My Profile or Find & Evaluate appears here and is deleted automatically when you delete all records.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200 text-xs">
                {workspace.documents.map((docMeta) => (
                  <li
                    key={docMeta.id}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-900">
                        {docMeta.fileName}{" "}
                        <span className="font-normal text-slate-500">
                          ({docMeta.docCategory.replace("_", " ")})
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-slate-500">
                        {Math.max(1, Math.round(docMeta.byteSize / 1024))} KB · Ref:{" "}
                        {docMeta.storageRef} · SHA-256 {docMeta.sha256.slice(0, 12)}…
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onDownloadPrivateFile(docMeta)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Private File</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await onDeletePrivateFile(docMeta.id);
                          if (ok) {
                            setDataMessage({
                              kind: "success",
                              text: `Deleted private file "${docMeta.fileName}" and its underlying storage blob.`,
                            });
                          }
                        }}
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

          {/* 3. Database Security & Persistence Verification Panel */}
          {!isDemoMode && currentUid && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-teal-800 shrink-0" />
                    <h2 className="text-base font-semibold text-slate-900">
                      Database Persistence, Isolation & Error-Handling Checks
                    </h2>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Verify live Cloud Firestore server reads, cross-user rule isolation, backend JWT checks, and accurate failed-save error reporting.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={runningDiagnostics}
                    onClick={handleRunAcceptanceDiagnostics}
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
                  >
                    {runningDiagnostics ? "Running Live Checks..." : "Run Live Isolation Checks"}
                  </button>
                  <button
                    type="button"
                    onClick={onTriggerSimulatedFailedSave}
                    className="px-3.5 py-2 text-xs font-medium text-red-800 bg-white border border-red-300 hover:bg-red-50 rounded-lg whitespace-nowrap"
                  >
                    Test Failed-Save Error State
                  </button>
                </div>
              </div>

              {diagnosticsLog.length > 0 && (
                <ul className="divide-y divide-slate-100 text-xs">
                  {diagnosticsLog.map((item, idx) => (
                    <li key={idx} className="py-2.5 flex items-start gap-2.5">
                      {item.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-teal-800 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold text-slate-900">{item.label}</div>
                        <div className="text-slate-600 mt-0.5">{item.detail}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* 4. Confirmed Cascading Reset or Delete All Records & Files */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-900">
              {canResetStarterWorkspace
                ? "Reset Starter Workspace or Delete All Records & Uploaded Files"
                : "Delete All Records & Uploaded Files"}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 max-w-2xl">
              Destructive bulk actions require explicit confirmation below. Deleting all records permanently removes your profile fields, evidence items, opportunities, assessments, contacts, outreach drafts, application versions, tasks, practice logs, and all {workspace.documents.length} private uploaded file(s) from Cloud Firestore.
            </p>

            {confirmAction === "none" ? (
              <div className="flex flex-wrap items-center gap-3">
                {canResetStarterWorkspace && (
                  <button
                    type="button"
                    onClick={() => setConfirmAction("reset")}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset to Starter Workspace</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmAction("delete_all")}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-red-700 border border-red-300 rounded-lg hover:bg-red-50 whitespace-nowrap shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete All My Records & Uploaded Files</span>
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-red-50 border border-red-300 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-red-950">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                  <span>
                    {confirmAction === "delete_all"
                      ? `Confirm permanent deletion of all database records and ${workspace.documents.length} private uploaded file(s)? This cannot be undone.`
                      : "Confirm replacing current records with the initial RethinkBH starter workspace?"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isExecutingBulkAction}
                    onClick={async () => {
                      setIsExecutingBulkAction(true);
                      if (confirmAction === "delete_all") {
                        const res = await onDeleteAllRecords();
                        if (res) {
                          setDataMessage({
                            kind: "success",
                            text: `Permanently deleted ${res.deletedCount} database record(s) (including ${res.deletedFilesCount} private uploaded file(s)) from Cloud Firestore.`,
                          });
                        }
                      } else {
                        const ok = await onResetToStarter();
                        if (ok) {
                          setDataMessage({
                            kind: "success",
                            text: "Restored initial starter workspace in Cloud Firestore.",
                          });
                        }
                      }
                      setIsExecutingBulkAction(false);
                      setConfirmAction("none");
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-lg"
                  >
                    {isExecutingBulkAction
                      ? "Processing in Database..."
                      : confirmAction === "delete_all"
                      ? "Yes, Permanently Delete Everything"
                      : "Yes, Reset Starter State"}
                  </button>
                  <button
                    type="button"
                    disabled={isExecutingBulkAction}
                    onClick={() => setConfirmAction("none")}
                    className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
