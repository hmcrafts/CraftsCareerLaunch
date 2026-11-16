import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  Globe,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import {
  BEYOND_JOB_BOARDS_CHANNELS,
  ROLE_FAMILIES_TO_EXPLORE,
  getTodayIsoDate,
} from "../data/initialData";
import {
  analyzeJobDescriptionSmart,
  verifyOpportunityLiveWeb,
} from "../services/apiClient";
import {
  AuthenticityReview,
  Evidence,
  LiveVerificationSource,
  Opportunity,
  PrivateDocumentCategory,
  PrivateDocumentMeta,
  Profile,
  RequirementAssessment,
  Task,
} from "../types/models";
import {
  evaluateAuthenticityFlags,
  findDuplicateOpportunities,
  generateRequirementAssessments,
} from "../utils/analysisEngine";
import { AuthenticitySafetyReviewPanel } from "./AuthenticitySafetyReviewPanel";

interface FindEvaluateViewProps {
  profile: Profile;
  evidence: Evidence[];
  existingOpportunities: Opportunity[];
  allowServerSideAi: boolean;
  isDemoMode: boolean;
  onSaveOpportunity: (
    opp: Opportunity,
    assessments: RequirementAssessment[]
  ) => Promise<boolean>;
  onAddTask: (
    task: Omit<Task, "id" | "completed" | "completedAt" | "archived">
  ) => Promise<boolean>;
  onUploadPrivateFile: (
    file: File,
    docCategory: PrivateDocumentCategory,
    linkedOpportunityId?: string
  ) => Promise<{ meta: PrivateDocumentMeta; extractedTextIfPlain: string | null } | null>;
  onOpenOpportunity: (oppId: string) => void;
  activeUserId?: string;
  authenticityReviews?: AuthenticityReview[];
  documents?: PrivateDocumentMeta[];
  onSaveAuthenticityReview?: (
    review: AuthenticityReview
  ) => Promise<{ ok: boolean; error?: string }>;
  onDeleteAuthenticityReview?: (reviewId: string) => Promise<boolean>;
}

type IntakeMethod = "paste" | "url" | "upload" | "manual" | "csv";

function parseSimpleCsv(csvText: string): Array<Record<string, string>> {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const splitRow = (row: string): string[] => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const headers = splitRow(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return lines.slice(1).map((line) => {
    const values = splitRow(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] ?? "";
    });
    return obj;
  });
}

export const FindEvaluateView: React.FC<FindEvaluateViewProps> = ({
  profile,
  evidence,
  existingOpportunities,
  allowServerSideAi,
  isDemoMode,
  onSaveOpportunity,
  onAddTask,
  onUploadPrivateFile,
  onOpenOpportunity,
  activeUserId = "demo-mode",
  authenticityReviews = [],
  documents = [],
  onSaveAuthenticityReview,
  onDeleteAuthenticityReview,
}) => {
  const [sectionTab, setSectionTab] = useState<"intake" | "safety" | "beyond">("intake");
  const [intakeMethod, setIntakeMethod] = useState<IntakeMethod>("paste");

  // Form fields for new Opportunity
  const [rawText, setRawText] = useState("");
  const [employer, setEmployer] = useState("");
  const [title, setTitle] = useState("");
  const [officialWebsite, setOfficialWebsite] = useState("");
  const [postingUrl, setPostingUrl] = useState("");
  const [applicationUrl, setApplicationUrl] = useState("");
  const [location, setLocation] = useState("");
  const [eligibleLocations, setEligibleLocations] = useState("");
  const [workArrangement, setWorkArrangement] = useState<Opportunity["workArrangement"]>("unknown");
  const [employmentType, setEmploymentType] = useState<Opportunity["employmentType"]>("full_time");
  const [datePosted, setDatePosted] = useState("");
  const [openingStatus, setOpeningStatus] =
    useState<Opportunity["openingAvailabilityStatus"]>("Unverified");
  const [intakeChannel, setIntakeChannel] =
    useState<Opportunity["intakeChannel"]>("Employer careers page");

  // Compensation: Employer-published facts vs Third-party estimates strictly separated!
  const [employerBasePay, setEmployerBasePay] = useState("");
  const [employerVariablePay, setEmployerVariablePay] = useState("");
  const [variableAssumptions, setVariableAssumptions] = useState("");
  const [benefitsDoc, setBenefitsDoc] = useState("");
  const [thirdPartyEstimate, setThirdPartyEstimate] = useState("");
  const [thirdPartySource, setThirdPartySource] = useState("");

  // Requirements & Duties
  const [reqLines, setReqLines] = useState("");
  const [prefLines, setPrefLines] = useState("");
  const [dutyLines, setDutyLines] = useState("");
  const [nextAction, setNextAction] = useState("Verify official posting details and review requirement mapping");
  const [nextDueDate, setNextDueDate] = useState(getTodayIsoDate(2));

  // Status & Live Web Check
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisNotice, setAnalysisNotice] = useState<string | null>(null);
  const [uploadAlert, setUploadAlert] = useState<string | null>(null);
  const [isCheckingLive, setIsCheckingLive] = useState(false);
  const [liveResult, setLiveResult] = useState<{
    checkedAt: string;
    liveAvailable: boolean;
    summary: string;
    sources: LiveVerificationSource[];
  } | null>(null);

  // CSV Import state
  const [csvText, setCsvText] = useState("");
  const [csvImportDoneMsg, setCsvImportDoneMsg] = useState<string | null>(null);

  const duplicates = useMemo(
    () =>
      employer.trim() || postingUrl.trim()
        ? findDuplicateOpportunities({ employer, title, postingUrl }, existingOpportunities)
        : [],
    [employer, title, postingUrl, existingOpportunities]
  );

  const draftCandidateOpp: Opportunity = useMemo(() => {
    const reqs = reqLines
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const prefs = prefLines
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const duties = dutyLines
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    const partial: Opportunity = {
      id: "preview-candidate",
      employer: employer.trim() || "Unspecified Employer",
      title: title.trim() || "Unspecified Role",
      officialWebsite: officialWebsite.trim(),
      postingUrl: postingUrl.trim(),
      applicationUrl: applicationUrl.trim(),
      location: location.trim() || "Unknown",
      eligibleLocations: eligibleLocations.trim(),
      workArrangement,
      employmentType,
      datePosted,
      dateFirstFound: getTodayIsoDate(),
      dateLastVerified:
        openingStatus === "Seen on official careers page" ? getTodayIsoDate() : "",
      openingAvailabilityStatus: openingStatus,
      intakeChannel,
      rawDescriptionText: rawText,
      compensation: {
        employerPublishedBase: employerBasePay.trim(),
        employerPublishedVariable: employerVariablePay.trim(),
        variableAssumptionsNote: variableAssumptions.trim(),
        thirdPartyEstimate: thirdPartyEstimate.trim(),
        thirdPartySource: thirdPartySource.trim(),
        compensationSourceNote: employerBasePay.trim()
          ? "Employer-published in supplied posting"
          : "No employer-published base compensation stated",
        benefitsDocumented: benefitsDoc.trim(),
      },
      requiredQualifications: reqs,
      preferredQualifications: prefs,
      coreDuties: duties,
      knownContactIds: [],
      stage: "Research / preparation",
      appliedConfirmedByNora: "not_applied",
      nextAction: nextAction.trim() || "Review fit table and decide next step",
      nextActionDueDate: nextDueDate || getTodayIsoDate(2),
      writtenAdvancementInfo: "",
      trainingProvidedInfo: "",
      commuteAndScheduleNotes: "",
      outstandingQuestions: [],
      authenticityFlags: [],
      liveVerificationLog: liveResult
        ? {
            lastCheckedAt: liveResult.checkedAt,
            liveAvailable: liveResult.liveAvailable,
            summary: liveResult.summary,
            sources: liveResult.sources,
          }
        : {
            lastCheckedAt: null,
            liveAvailable: false,
            summary: "Not checked against live web sources yet.",
            sources: [],
          },
      archived: false,
    };

    partial.authenticityFlags = evaluateAuthenticityFlags(partial);
    return partial;
  }, [
    employer,
    title,
    officialWebsite,
    postingUrl,
    applicationUrl,
    location,
    eligibleLocations,
    workArrangement,
    employmentType,
    datePosted,
    openingStatus,
    intakeChannel,
    rawText,
    employerBasePay,
    employerVariablePay,
    variableAssumptions,
    thirdPartyEstimate,
    thirdPartySource,
    benefitsDoc,
    reqLines,
    prefLines,
    dutyLines,
    nextAction,
    nextDueDate,
    liveResult,
  ]);

  const previewAssessments = useMemo(
    () => generateRequirementAssessments(draftCandidateOpp, profile, evidence),
    [draftCandidateOpp, profile, evidence]
  );

  const handleParseRawText = async () => {
    if (!rawText.trim()) return;
    setIsAnalyzing(true);
    setAnalysisNotice(null);
    const { parsed, usedServerAi, notice } = await analyzeJobDescriptionSmart(
      rawText,
      allowServerSideAi
    );
    if (parsed.employer && !employer) setEmployer(parsed.employer);
    if (parsed.title && !title) setTitle(parsed.title);
    if (parsed.location && !location) setLocation(parsed.location);
    if (parsed.workArrangement !== "unknown") setWorkArrangement(parsed.workArrangement);
    if (parsed.employmentType !== "unknown") setEmploymentType(parsed.employmentType);
    // Preserve unknown pay strictly as blank if not explicitly stated!
    setEmployerBasePay(parsed.employerPublishedBasePay || "");
    setEmployerVariablePay(parsed.employerPublishedVariablePay || "");
    setBenefitsDoc(parsed.benefitsSummary || "");
    setReqLines(parsed.requiredQualifications.join("\n"));
    setPrefLines(parsed.preferredQualifications.join("\n"));
    setDutyLines(parsed.coreDuties.join("\n"));

    setAnalysisNotice(
      usedServerAi
        ? "Extracted structured fields using server-side Gemini analysis. Unknown compensation fields were left blank rather than guessed — review every field below before saving."
        : notice ||
            "Extracted requirements, duties, and explicit pay locally. Unknown fields remain blank for human verification."
    );
    setIsAnalyzing(false);
  };

  const handleCheckLiveWeb = async () => {
    setIsCheckingLive(true);
    const result = await verifyOpportunityLiveWeb({
      employer,
      title,
      postingUrl,
      officialWebsite,
      allowServerSideAi,
    });
    setLiveResult({
      checkedAt: result.retrievedAt,
      liveAvailable: result.liveAvailable,
      summary: result.summary,
      sources: result.sources,
    });
    setIsCheckingLive(false);
  };

  const handleJdDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";

    if (!isDemoMode) {
      const uploaded = await onUploadPrivateFile(file, "job_description");
      if (!uploaded) {
        e.target.value = "";
        return;
      }
      if (uploaded.extractedTextIfPlain) {
        setRawText(uploaded.extractedTextIfPlain);
        setUploadAlert(
          `Stored "${file.name}" privately in your workspace (no public URL) and loaded text below. Click "Extract Requirements & Map Evidence" to populate structured fields.`
        );
      } else {
        setUploadAlert(
          `Stored "${file.name}" privately in your workspace. Because .${ext || "binary"} files can introduce formatting errors during automatic parsing, paste the job description text below to extract requirements accurately.`
        );
      }
    } else if (ext === "txt" || ext === "md") {
      const content = await file.text();
      setRawText(content);
      setUploadAlert(
        `Loaded "${file.name}" in Demo Mode (not stored in database). Click "Extract Requirements & Map Evidence" to populate structured fields.`
      );
    } else {
      setUploadAlert(
        `"${file.name}" (.${ext || "binary"}) cannot be parsed reliably in Demo Mode. Paste the job description text directly below.`
      );
    }
    e.target.value = "";
  };

  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employer.trim() && !title.trim()) return;

    const newId = `opp-${Date.now()}`;
    const finalOpp: Opportunity = {
      ...draftCandidateOpp,
      id: newId,
    };
    const finalAssessments = generateRequirementAssessments(finalOpp, profile, evidence);
    const savedOk = await onSaveOpportunity(finalOpp, finalAssessments);
    if (savedOk) {
      onOpenOpportunity(newId);
    }
  };

  const csvRows = useMemo(() => parseSimpleCsv(csvText), [csvText]);

  const handleImportCsvRows = async () => {
    if (csvRows.length === 0) return;
    let importedCount = 0;
    for (let idx = 0; idx < csvRows.length; idx++) {
      const row = csvRows[idx];
      const emp = row.employer || row.company || row.organization || "";
      const jobTitle = row.title || row.jobtitle || row.role || "";
      if (!emp && !jobTitle) continue;
      const newId = `opp-csv-${Date.now()}-${idx}`;
      const newOpp: Opportunity = {
        id: newId,
        employer: emp || "Unspecified Employer",
        title: jobTitle || "Unspecified Role",
        officialWebsite: row.officialwebsite || row.website || "",
        postingUrl: row.postingurl || row.url || "",
        applicationUrl: row.applicationurl || row.postingurl || row.url || "",
        location: row.location || "Unknown",
        eligibleLocations: "",
        workArrangement: "unknown",
        employmentType: "full_time",
        datePosted: row.dateposted || "",
        dateFirstFound: getTodayIsoDate(),
        dateLastVerified: "",
        openingAvailabilityStatus: "Unverified",
        intakeChannel: "Manual / CSV import",
        rawDescriptionText: row.description || "",
        compensation: {
          employerPublishedBase: row.basepay || row.salary || "",
          employerPublishedVariable: row.variablepay || "",
          variableAssumptionsNote: "",
          thirdPartyEstimate: "",
          thirdPartySource: "",
          compensationSourceNote: row.basepay ? "Imported via CSV" : "Unknown — needs verification",
          benefitsDocumented: "",
        },
        requiredQualifications: row.description
          ? [row.description.slice(0, 140)]
          : ["Verify required qualifications from official employer posting"],
        preferredQualifications: [],
        coreDuties: [],
        knownContactIds: [],
        stage: "Research / preparation",
        appliedConfirmedByNora: "not_applied",
        nextAction: "Verify official employer website and full job requirements",
        nextActionDueDate: getTodayIsoDate(2),
        writtenAdvancementInfo: "",
        trainingProvidedInfo: "",
        commuteAndScheduleNotes: "",
        outstandingQuestions: [],
        authenticityFlags: [],
        liveVerificationLog: {
          lastCheckedAt: null,
          liveAvailable: false,
          summary: "Imported from CSV — not yet verified.",
          sources: [],
        },
        archived: false,
      };
      newOpp.authenticityFlags = evaluateAuthenticityFlags(newOpp);
      const assessments = generateRequirementAssessments(newOpp, profile, evidence);
      const ok = await onSaveOpportunity(newOpp, assessments);
      if (ok) importedCount++;
    }
    if (importedCount > 0) {
      setCsvText("");
      setCsvImportDoneMsg(
        `Saved ${importedCount} opportunity record(s) to database. Open Opportunities to inspect fit and authenticity flags.`
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Top Mode Switch */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Find & Evaluate Opportunities
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 max-w-2xl">
            Add openings from pasted descriptions, URLs, documents, or CSVs — or develop opportunities beyond job boards through target organizations and referrals.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start shrink-0">
          <button
            type="button"
            onClick={() => setSectionTab("intake")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              sectionTab === "intake"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Add & Evaluate Opening
          </button>
          <button
            type="button"
            onClick={() => setSectionTab("safety")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              sectionTab === "safety"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Authenticity & Safety Review
          </button>
          <button
            type="button"
            onClick={() => setSectionTab("beyond")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              sectionTab === "beyond"
                ? "bg-white text-slate-950 font-semibold shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Search Beyond Job Boards
          </button>
        </div>
      </div>

      {/* TAB 1: OPPORTUNITY INTAKE & AUTHENTICITY (FEATURE 2) */}
      {sectionTab === "intake" && (
        <div className="space-y-6">
          {/* 5 Intake Method Selector */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg w-fit">
            {[
              { id: "paste", label: "Paste Job Description" },
              { id: "url", label: "Enter URL & Live Check" },
              { id: "upload", label: "Upload Document" },
              { id: "manual", label: "Manual Record" },
              { id: "csv", label: "Import CSV" },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setIntakeMethod(m.id as IntakeMethod)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                  intakeMethod === m.id
                    ? "bg-white text-slate-950 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {intakeMethod === "csv" ? (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Import Opportunities from CSV</h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Paste CSV rows or upload a <code className="font-mono">.csv</code> file with headers like:{" "}
                  <code className="font-mono">employer,title,location,officialWebsite,postingUrl,basePay,description</code>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Choose .csv File</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) setCsvText(await f.text());
                    }}
                    className="sr-only"
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setCsvText(
                      [
                        "employer,title,location,officialWebsite,postingUrl,basePay,description",
                        '"Northern Virginia Pediatric Therapy","Intake & Family Coordinator","Fairfax, VA (Hybrid)","https://novapeds-example.org","","","Coordinate family intake calls, clinician schedules, and session documentation."',
                      ].join("\n")
                    )
                  }
                  className="text-xs text-teal-800 hover:underline font-medium"
                >
                  Insert example CSV format
                </button>
              </div>

              <textarea
                rows={6}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder="employer,title,location,officialWebsite,postingUrl,basePay,description"
                className="w-full p-3 text-xs font-mono border border-slate-300 rounded-lg bg-white"
              />

              {csvRows.length > 0 && (
                <div className="border border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50/70">
                  <div className="text-xs font-semibold text-slate-800">
                    Preview ({csvRows.length} row{csvRows.length === 1 ? "" : "s"} detected):
                  </div>
                  <ul className="divide-y divide-slate-200 text-xs">
                    {csvRows.map((r, i) => {
                      const rowDups = findDuplicateOpportunities(
                        {
                          employer: r.employer || r.company || "",
                          title: r.title || r.role || "",
                          postingUrl: r.postingurl || r.url || "",
                        },
                        existingOpportunities
                      );
                      return (
                        <li key={i} className="py-2 flex items-center justify-between gap-3">
                          <span>
                            <strong>{r.title || r.role || "Untitled"}</strong> —{" "}
                            {r.employer || r.company || "Unspecified"} ({r.location || "Location unknown"} ·{" "}
                            {r.basepay || "Pay unknown"})
                          </span>
                          {rowDups.length > 0 && (
                            <span className="text-amber-800 font-semibold whitespace-nowrap shrink-0">
                              Possible duplicate of existing record
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    type="button"
                    onClick={handleImportCsvRows}
                    className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg"
                  >
                    Import {csvRows.length} Record(s)
                  </button>
                </div>
              )}

              {csvImportDoneMsg && (
                <p className="text-xs font-medium text-teal-900 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                  {csvImportDoneMsg}
                </p>
              )}
            </section>
          ) : (
            <form onSubmit={handleSaveRecord} className="space-y-6">
              {/* Top Intake Box Depending on Selected Method */}
              {(intakeMethod === "paste" || intakeMethod === "upload") && (
                <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        {intakeMethod === "upload"
                          ? "Upload Job Description Document"
                          : "Paste Job Description Text"}
                      </h2>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Supplied text is treated strictly as untrusted source content. Unstated compensation remains blank (“Unknown”) — never guessed.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {intakeMethod === "upload" && (
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0">
                          <FileText className="w-3.5 h-3.5" />
                          <span>Select File (.txt / .md)</span>
                          <input
                            type="file"
                            accept=".txt,.md,.pdf,.doc,.docx"
                            onChange={handleJdDocumentUpload}
                            className="sr-only"
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setRawText(
                            [
                              "Job Title: Client Onboarding & Training Coordinator",
                              "Company: Fairfax Behavioral Learning Systems",
                              "Location: Fairfax, VA (Hybrid - 2 days in office)",
                              "Employment Type: Full-time",
                              "",
                              "Responsibilities:",
                              "- Guide new outpatient behavioral health and pediatric clinics through initial software setup and staff training schedules.",
                              "- Communicate clearly with supervising BCBAs, clinic administrators, and support teams.",
                              "- Track onboarding milestones, questions, and follow-up actions in our CRM.",
                              "",
                              "Required Qualifications:",
                              "- Bachelor's degree in Psychology, Education, Healthcare Administration, or related field.",
                              "- 1+ year experience in ABA service delivery, clinic coordination, or educational tutoring/coaching.",
                              "- Strong organization and structured documentation habits.",
                              "",
                              "Preferred Qualifications:",
                              "- Familiarity with Salesforce or client ticketing systems.",
                              "- Experience with behavioral data collection platforms.",
                            ].join("\n")
                          )
                        }
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        Try Example Posting (Pay Omitted)
                      </button>
                    </div>
                  </div>

                  {uploadAlert && (
                    <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-300 text-xs text-amber-950">
                      {uploadAlert}
                    </div>
                  )}

                  <textarea
                    rows={8}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="Paste the full job posting here..."
                    className="w-full p-3.5 text-sm border border-slate-300 rounded-lg bg-white leading-relaxed"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      disabled={!rawText.trim() || isAnalyzing}
                      onClick={handleParseRawText}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                    >
                      <Search className="w-3.5 h-3.5" />
                      <span>
                        {isAnalyzing
                          ? "Extracting requirements..."
                          : "Extract Requirements & Map Evidence"}
                      </span>
                    </button>
                    {analysisNotice && (
                      <span className="text-xs text-slate-600">{analysisNotice}</span>
                    )}
                  </div>
                </section>
              )}

              {intakeMethod === "url" && (
                <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Posting URL & Live Employer Verification
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Prefer the employer’s own <code className="font-mono">/careers</code> page. When live web retrieval is available and opted in, this checks current public listings and shows exact source links and retrieval date.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Employer name
                      </label>
                      <input
                        type="text"
                        value={employer}
                        onChange={(e) => setEmployer(e.target.value)}
                        placeholder="e.g., RethinkBH"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Job title
                      </label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g., Business Development Representative"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Official employer website
                      </label>
                      <input
                        type="url"
                        value={officialWebsite}
                        onChange={(e) => setOfficialWebsite(e.target.value)}
                        placeholder="https://..."
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Posting URL
                      </label>
                      <input
                        type="url"
                        value={postingUrl}
                        onChange={(e) => setPostingUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={(!employer.trim() && !postingUrl.trim()) || isCheckingLive}
                      onClick={handleCheckLiveWeb}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>
                        {isCheckingLive ? "Checking live web..." : "Check Live Web Sources"}
                      </span>
                    </button>
                  </div>

                  {liveResult && (
                    <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="font-semibold text-slate-900">
                          {liveResult.liveAvailable
                            ? "Live web retrieval completed"
                            : "Live verification unavailable"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          Retrieved {new Date(liveResult.checkedAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-slate-800 leading-relaxed">{liveResult.summary}</p>
                      {liveResult.sources.length > 0 && (
                        <div className="pt-2 space-y-1">
                          <div className="text-xs font-semibold text-slate-700">
                            Retrieved source links:
                          </div>
                          <ul className="space-y-1 text-xs">
                            {liveResult.sources.map((s, idx) => (
                              <li key={idx}>
                                <a
                                  href={s.uri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-teal-800 hover:underline break-all"
                                >
                                  <span>{s.title}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* Duplicate Opportunity Detection Banner */}
              {duplicates.length > 0 && (
                <div className="bg-amber-50/80 border border-amber-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>Possible Duplicate Opportunity Flagged</span>
                    </div>
                    <p className="text-xs text-amber-900">
                      Matches existing record:{" "}
                      <strong>
                        {duplicates[0].title} — {duplicates[0].employer}
                      </strong>{" "}
                      (Stage: {duplicates[0].stage}). You can open the existing workspace instead of creating a duplicate, or save anyway if this is a distinct requisition.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenOpportunity(duplicates[0].id)}
                    className="px-3 py-1.5 text-xs font-semibold text-amber-950 bg-white border border-amber-400 rounded-lg hover:bg-amber-100 whitespace-nowrap shrink-0 self-start"
                  >
                    Open Existing Record
                  </button>
                </div>
              )}

              {/* Structured Opportunity Record Editor */}
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
                <div className="pb-3 border-b border-slate-200">
                  <h2 className="text-lg font-semibold text-slate-900">
                    Structured Opportunity Details
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Employer-published facts are stored separately from third-party salary estimates.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Employer *
                    </label>
                    <input
                      type="text"
                      required
                      value={employer}
                      onChange={(e) => setEmployer(e.target.value)}
                      placeholder="Organization name"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Job title *
                    </label>
                    <input
                      type="text"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Exact posting title"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Official employer website
                    </label>
                    <input
                      type="text"
                      value={officialWebsite}
                      onChange={(e) => setOfficialWebsite(e.target.value)}
                      placeholder="https://employer.com"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Posting URL
                    </label>
                    <input
                      type="text"
                      value={postingUrl}
                      onChange={(e) => setPostingUrl(e.target.value)}
                      placeholder="Direct link to job description"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Application destination URL
                    </label>
                    <input
                      type="text"
                      value={applicationUrl}
                      onChange={(e) => setApplicationUrl(e.target.value)}
                      placeholder="Where application form is hosted"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Opening verification status
                    </label>
                    <select
                      value={openingStatus}
                      onChange={(e) =>
                        setOpeningStatus(
                          e.target.value as Opportunity["openingAvailabilityStatus"]
                        )
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Unverified">Unverified (do not assume active)</option>
                      <option value="Seen on official careers page">
                        Seen on official employer careers page
                      </option>
                      <option value="No longer listed / Closed">
                        No longer listed / Closed
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Location & work arrangement
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="City, State"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                      <select
                        value={workArrangement}
                        onChange={(e) =>
                          setWorkArrangement(
                            e.target.value as Opportunity["workArrangement"]
                          )
                        }
                        className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="unknown">Unknown</option>
                        <option value="remote">Remote</option>
                        <option value="hybrid">Hybrid</option>
                        <option value="onsite">On-site</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Eligible states / locations (if remote)
                    </label>
                    <input
                      type="text"
                      value={eligibleLocations}
                      onChange={(e) => setEligibleLocations(e.target.value)}
                      placeholder="e.g., VA, MD, DC, or Unspecified"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Date posted
                      </label>
                      <input
                        type="date"
                        value={datePosted}
                        onChange={(e) => setDatePosted(e.target.value)}
                        className="w-full px-2.5 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Source channel
                      </label>
                      <select
                        value={intakeChannel}
                        onChange={(e) =>
                          setIntakeChannel(e.target.value as Opportunity["intakeChannel"])
                        }
                        className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="Employer careers page">Employer careers page</option>
                        <option value="Target-employer research">Target-employer research</option>
                        <option value="Referral / informational conversation">Referral / info chat</option>
                        <option value="Former colleague / contact">Former colleague</option>
                        <option value="Job board">Job board</option>
                        <option value="Manual / CSV import">Manual entry</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Compensation Split: Employer-Published vs Third-Party */}
                <div className="pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Employer-Published Compensation Facts
                    </h3>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Guaranteed base pay (leave blank if unknown)
                      </label>
                      <input
                        type="text"
                        value={employerBasePay}
                        onChange={(e) => setEmployerBasePay(e.target.value)}
                        placeholder="Unknown — not stated in posting"
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Variable / commission pay (separate from base)
                      </label>
                      <input
                        type="text"
                        value={employerVariablePay}
                        onChange={(e) => setEmployerVariablePay(e.target.value)}
                        placeholder="None stated / Unknown"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Documented benefits
                      </label>
                      <input
                        type="text"
                        value={benefitsDoc}
                        onChange={(e) => setBenefitsDoc(e.target.value)}
                        placeholder="Undocumented"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-700">
                      Third-Party Estimates & Commission Assumptions (Non-Authoritative)
                    </h3>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Third-party salary estimate (if any)
                      </label>
                      <input
                        type="text"
                        value={thirdPartyEstimate}
                        onChange={(e) => setThirdPartyEstimate(e.target.value)}
                        placeholder="Keep separate from official employer base pay"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Third-party estimate source
                      </label>
                      <input
                        type="text"
                        value={thirdPartySource}
                        onChange={(e) => setThirdPartySource(e.target.value)}
                        placeholder="e.g., Job board automated range (unverified)"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Commission / quota assumptions to verify
                      </label>
                      <input
                        type="text"
                        value={variableAssumptions}
                        onChange={(e) => setVariableAssumptions(e.target.value)}
                        placeholder="e.g., Never treat OTE as guaranteed; ask % of reps hitting quota"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Requirements & Duties */}
                <div className="pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Required qualifications (one per line)
                    </label>
                    <textarea
                      rows={5}
                      value={reqLines}
                      onChange={(e) => setReqLines(e.target.value)}
                      placeholder="One required qualification per line..."
                      className="w-full p-2.5 text-xs border border-slate-300 rounded-lg bg-white leading-relaxed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Preferred qualifications (one per line)
                    </label>
                    <textarea
                      rows={5}
                      value={prefLines}
                      onChange={(e) => setPrefLines(e.target.value)}
                      placeholder="One preferred qualification per line..."
                      className="w-full p-2.5 text-xs border border-slate-300 rounded-lg bg-white leading-relaxed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Core duties (one per line)
                    </label>
                    <textarea
                      rows={5}
                      value={dutyLines}
                      onChange={(e) => setDutyLines(e.target.value)}
                      placeholder="Day-to-day responsibilities..."
                      className="w-full p-2.5 text-xs border border-slate-300 rounded-lg bg-white leading-relaxed"
                    />
                  </div>
                </div>

                {/* Live Preview: Authenticity Check & Requirement Fit Mapping */}
                <div className="pt-4 border-t border-slate-200 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Authenticity & Evidence Fit Preview
                    </h3>
                    <span className="text-xs text-slate-500">
                      A flag is a reason to investigate — not proof of fraud. Absence of flags does not mean an employer is “verified safe.”
                    </span>
                  </div>

                  {draftCandidateOpp.authenticityFlags.length > 0 && (
                    <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-4 space-y-2">
                      <div className="text-xs font-semibold text-amber-950">
                        Items flagged for human review ({draftCandidateOpp.authenticityFlags.length}):
                      </div>
                      <ul className="space-y-1.5 text-xs text-amber-900">
                        {draftCandidateOpp.authenticityFlags.map((fl) => (
                          <li key={fl.id}>
                            <strong>{fl.label}:</strong> {fl.explanation}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {previewAssessments.length > 0 && (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                            <th className="py-2.5 px-3 font-semibold">Requirement</th>
                            <th className="py-2.5 px-3 font-semibold">Priority</th>
                            <th className="py-2.5 px-3 font-semibold">Your Evidence</th>
                            <th className="py-2.5 px-3 font-semibold">Assessment</th>
                            <th className="py-2.5 px-3 font-semibold">Next Step</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {previewAssessments.map((ra) => (
                            <tr key={ra.id} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-3 text-slate-900 font-medium">
                                {ra.requirementText}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                                {ra.priority}
                              </td>
                              <td className="py-2.5 px-3 text-slate-700">
                                {ra.noraEvidenceSummary}
                              </td>
                              <td className="py-2.5 px-3 font-semibold whitespace-nowrap">
                                <span
                                  className={
                                    ra.assessment === "Direct evidence"
                                      ? "text-teal-900"
                                      : ra.assessment === "Transferable evidence"
                                      ? "text-slate-800"
                                      : ra.assessment === "Gap"
                                      ? "text-amber-800"
                                      : "text-slate-500"
                                  }
                                >
                                  {ra.assessment}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">{ra.nextStep}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Next Action & Save */}
                <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 max-w-2xl">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Next action
                      </label>
                      <input
                        type="text"
                        value={nextAction}
                        onChange={(e) => setNextAction(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Target date
                      </label>
                      <input
                        type="date"
                        value={nextDueDate}
                        onChange={(e) => setNextDueDate(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="px-5 py-2.5 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Save Opportunity & Open Workspace
                  </button>
                </div>
              </section>
            </form>
          )}
        </div>
      )}

      {/* TAB 2: SEARCH BEYOND JOB BOARDS (FEATURE 4) */}
      {sectionTab === "beyond" && (
        <div className="space-y-8">
          {/* 6 Channels Beyond Job Boards */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Six Ways to Develop Authentic Opportunities
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Public job boards mix outdated listings with high-volume competition. Balance direct career-page checks with warm Northern Virginia and ABA-domain channels.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
              {BEYOND_JOB_BOARDS_CHANNELS.map((ch) => (
                <div
                  key={ch.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2">
                    <h3 className="text-base font-semibold text-slate-900">{ch.title}</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">{ch.description}</p>
                    <p className="text-xs text-slate-700 pt-1">
                      <strong>Practical first step:</strong> {ch.firstStep}
                    </p>
                  </div>
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        onAddTask({
                          title: `${ch.title}: ${ch.firstStep.slice(0, 75)}...`,
                          whyItMatters: ch.description,
                          category:
                            ch.id.includes("informational") || ch.id.includes("colleagues")
                              ? "relationship"
                              : "opportunity",
                          estimatedMinutes: 20,
                          dueDate: getTodayIsoDate(1),
                          scheduledBucket: "tomorrow",
                        })
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Queue for Tomorrow</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 5 Initial Role Families to Explore (Not Automatically Endorsed) */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Role Families to Explore (Not Automatically Endorsed)
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Each path uses parts of your ABA and Psychology background differently and carries distinct training or compensation trade-offs. Not all customer success or implementation postings are entry-level.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
              {ROLE_FAMILIES_TO_EXPLORE.map((rf) => (
                <div key={rf.id} className="p-6 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <h3 className="text-base font-semibold text-slate-900">{rf.title}</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setSectionTab("intake");
                        setIntakeMethod("manual");
                        setTitle(rf.sampleSearchTerms[0]);
                        setIntakeChannel("Target-employer research");
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0 self-start"
                    >
                      Start Target Record
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-700 leading-relaxed">
                    <div>
                      <span className="font-semibold text-slate-900 block text-xs mb-0.5">
                        Why explore this family
                      </span>
                      {rf.whyExplore}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900 block text-xs mb-0.5">
                        Where your current evidence fits
                      </span>
                      {rf.whereNoraHasEvidence}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900 block text-xs mb-0.5">
                        Additional evidence or training often needed
                      </span>
                      {rf.evidenceOrTrainingUsuallyRequired}
                    </div>
                    <div>
                      <span className="font-semibold text-amber-900 block text-xs mb-0.5">
                        Entry-level & compensation reality check
                      </span>
                      {rf.entryLevelRealityCheck}
                    </div>
                  </div>

                  <div className="pt-1 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">Example titles/queries: </span>
                    {rf.sampleSearchTerms.join(" · ")}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: PRE-OPPORTUNITY / STANDALONE AUTHENTICITY & SAFETY REVIEW */}
      {sectionTab === "safety" && (
        <AuthenticitySafetyReviewPanel
          activeUserId={activeUserId}
          mode="standalone"
          allOpportunities={existingOpportunities}
          reviews={authenticityReviews}
          documents={documents}
          allowServerSideAi={allowServerSideAi}
          isDemoMode={isDemoMode}
          onSaveReview={
            onSaveAuthenticityReview ||
            (async () => ({ ok: false, error: "Review save handler not wired." }))
          }
          onDeleteReview={onDeleteAuthenticityReview || (async () => false)}
          onUploadPrivateFile={onUploadPrivateFile}
        />
      )}
    </div>
  );
};
