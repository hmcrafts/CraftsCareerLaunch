import {
  Evidence,
  LearningItem,
  Opportunity,
  Profile,
  RequirementAssessment,
  SyntheticCrmAccount,
  Task,
  WorkspaceState,
} from "../types/models";

export const CURRENT_SCHEMA_VERSION = 2;

export function getTodayIsoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const INITIAL_PROFILE: Profile = {
  id: "profile-nora-crafts",
  fullName: "Nora Crafts",
  location: "Oakton, Virginia",
  educationSummary: "Bachelor’s degree in Psychology, George Mason University (December 2021)",
  rbtCertificationStatus: "unverified",
  rbtCertificationNote:
    "Not yet verified — please confirm whether your RBT credential is currently active, inactive, or expired before referencing active certification.",
  littleLeavesSoftwareUsed: "",
  otherExperienceNotes:
    "Possible prior experience in afterschool coordination and customer-facing restaurant work. Upload or paste your actual résumé before generating detailed claims from those roles.",
  masterResumeText: [
    "NORA CRAFTS",
    "Oakton, Virginia",
    "",
    "EDUCATION",
    "George Mason University — Bachelor’s Degree in Psychology, December 2021",
    "",
    "EXPERIENCE",
    "Little Leaves Behavioral Services — Registered Behavior Technician (January 2023 – July 2024)",
    "- Implemented Applied Behavior Analysis (ABA) treatment plans under BCBA supervision.",
    "- Collected session behavioral data and maintained structured client records.",
    "- Communicated clearly and empathetically with families regarding daily progress and routines.",
    "",
    "Independent Tutoring & Coaching",
    "- Provided individualized academic/skill tutoring and coaching.",
    "- Managed session scheduling, parent/student communication, and regular follow-up.",
    "",
    "[PLACEHOLDER: Paste full verified résumé details, including exact tools used at Little Leaves and any confirmed afterschool coordination or hospitality experience]",
  ].join("\n"),
  masterResumeUpdatedAt: null,
  profileVerifiedByNora: false,
  constraints: {
    minBaseSalary: null,
    minBaseSalaryUnsure: true,
    desiredTotalComp: null,
    desiredTotalCompUnsure: true,
    benefitsRequirement: "not_sure",
    employmentType: "not_sure",
    workArrangement: "not_sure",
    maxCommuteMinutes: null,
    maxCommuteUnsure: true,
    willingToRelocate: "not_sure",
    scheduleAndStartAvailability: "Not sure yet",
    commissionTolerance: "not_sure",
    outboundCallingComfort: "not_sure",
    preferredIndustries: "Behavioral health / ABA software, education services, client operations (open to refine)",
    excludedIndustries: "",
    travelLimits: "Not sure yet",
    trainingTimeWeeklyHours: "Not sure yet",
    trainingBudgetDollars: "Not sure yet",
    onboardingReviewed: false,
  },
};

export const INITIAL_EVIDENCE: Evidence[] = [
  {
    id: "ev-gmu-psych",
    claimText: "Earned a Bachelor’s degree in Psychology from George Mason University in December 2021.",
    category: "demonstrated_skill",
    sourceDocumentOrConfirmation: "Starting profile summary (please verify)",
    sourceExcerpt: "Psychology bachelor’s degree, George Mason University, December 2021.",
    verificationStatus: "Confirmed by Nora",
    dateAdded: getTodayIsoDate(),
    mayUseInApplications: true,
    tags: ["education", "psychology", "degree", "bachelor"],
  },
  {
    id: "ev-little-leaves-aba",
    claimText:
      "Worked as a Registered Behavior Technician at Little Leaves Behavioral Services from January 2023 to July 2024, implementing ABA treatment plans under BCBA supervision.",
    category: "demonstrated_skill",
    sourceDocumentOrConfirmation: "Starting profile summary (please verify)",
    sourceExcerpt:
      "Registered Behavior Technician, Little Leaves Behavioral Services, January 2023–July 2024. Implemented ABA treatment plans under BCBA supervision.",
    verificationStatus: "Confirmed by Nora",
    dateAdded: getTodayIsoDate(),
    mayUseInApplications: true,
    tags: ["aba", "behavioral health", "rbt", "bcba", "clinical", "treatment plans"],
  },
  {
    id: "ev-behavioral-data",
    claimText:
      "Collected session behavioral data accurately and maintained structured client documentation during ABA service delivery.",
    category: "demonstrated_skill",
    sourceDocumentOrConfirmation: "Starting profile summary (please verify)",
    sourceExcerpt: "Collected behavioral data and maintained records.",
    verificationStatus: "Confirmed by Nora",
    dateAdded: getTodayIsoDate(),
    mayUseInApplications: true,
    tags: ["data collection", "documentation", "records", "detail-oriented", "aba"],
  },
  {
    id: "ev-family-comm",
    claimText:
      "Communicated directly with families regarding ABA session routines, observations, and coordination alongside supervising BCBAs.",
    category: "transferable_experience",
    sourceDocumentOrConfirmation: "Starting profile summary (please verify)",
    sourceExcerpt: "Communicated with families.",
    verificationStatus: "Confirmed by Nora",
    dateAdded: getTodayIsoDate(),
    mayUseInApplications: true,
    tags: ["communication", "families", "client relations", "stakeholders", "listening"],
  },
  {
    id: "ev-tutoring-scheduling",
    claimText:
      "Delivered independent tutoring and coaching, managing session scheduling, expectations, and consistent follow-up.",
    category: "transferable_experience",
    sourceDocumentOrConfirmation: "Starting profile summary (please verify)",
    sourceExcerpt: "Independent tutoring and coaching, including scheduling and follow-up.",
    verificationStatus: "Confirmed by Nora",
    dateAdded: getTodayIsoDate(),
    mayUseInApplications: true,
    tags: ["tutoring", "coaching", "scheduling", "follow-up", "organization", "self-directed"],
  },
  {
    id: "ev-rbt-cert-status",
    claimText:
      "Current RBT credential status (active vs. inactive) needs confirmation before stating active certification.",
    category: "demonstrated_skill",
    sourceDocumentOrConfirmation: "Pending Nora confirmation",
    sourceExcerpt: "Do not assume her RBT certification is currently active.",
    verificationStatus: "Needs clarification",
    dateAdded: getTodayIsoDate(),
    mayUseInApplications: false,
    tags: ["rbt", "certification", "credential"],
  },
  {
    id: "ev-little-leaves-software",
    claimText:
      "Specific clinical data/practice management software used at Little Leaves Behavioral Services needs confirmation (do not assume RethinkBH).",
    category: "demonstrated_skill",
    sourceDocumentOrConfirmation: "Pending Nora confirmation",
    sourceExcerpt: "Identify the software Nora actually used at Little Leaves. Do not assume she has used RethinkBH.",
    verificationStatus: "Needs clarification",
    dateAdded: getTodayIsoDate(),
    mayUseInApplications: false,
    tags: ["software", "ehr", "clinical platform", "little leaves"],
  },
  {
    id: "ev-afterschool-restaurant",
    claimText:
      "Possible afterschool program coordination and customer-facing restaurant work — awaiting actual résumé upload/paste before drafting specific claims.",
    category: "transferable_experience",
    sourceDocumentOrConfirmation: "Awaiting actual résumé",
    sourceExcerpt:
      "Other experience may include afterschool coordination and customer-facing restaurant work; request the actual résumé before generating detailed claims.",
    verificationStatus: "Needs clarification",
    dateAdded: getTodayIsoDate(),
    mayUseInApplications: false,
    tags: ["coordination", "customer service", "hospitality", "afterschool"],
  },
  {
    id: "ev-gap-quota",
    claimText: "No established professional sales-quota track record.",
    category: "not_yet_demonstrated",
    sourceDocumentOrConfirmation: "Known development area",
    sourceExcerpt: "No established professional sales-quota track record.",
    verificationStatus: "Confirmed by Nora",
    dateAdded: getTodayIsoDate(),
    mayUseInApplications: false,
    tags: ["quota", "sales", "bdr", "revenue"],
  },
  {
    id: "ev-gap-outbound",
    claimText: "No established high-volume outbound sales calling history.",
    category: "not_yet_demonstrated",
    sourceDocumentOrConfirmation: "Known development area",
    sourceExcerpt: "No established outbound calling history.",
    verificationStatus: "Confirmed by Nora",
    dateAdded: getTodayIsoDate(),
    mayUseInApplications: false,
    tags: ["outbound", "cold calling", "phone prospecting"],
  },
  {
    id: "ev-gap-salesforce",
    claimText: "No established professional Salesforce CRM experience.",
    category: "not_yet_demonstrated",
    sourceDocumentOrConfirmation: "Known development area",
    sourceExcerpt: "No established Salesforce experience.",
    verificationStatus: "Confirmed by Nora",
    dateAdded: getTodayIsoDate(),
    mayUseInApplications: false,
    tags: ["salesforce", "crm", "pipeline"],
  },
];

export const STARTER_RETHINKBH_ID = "opp-starter-rethinkbh-bdr";

export const INITIAL_OPPORTUNITIES: Opportunity[] = [
  {
    id: STARTER_RETHINKBH_ID,
    employer: "RethinkBH (Rethink Behavioral Health)",
    title: "Business Development Representative",
    officialWebsite: "https://www.rethinkbehavioralhealth.com",
    postingUrl: "",
    applicationUrl: "",
    location: "Needs verification from current official posting",
    eligibleLocations: "Confirm whether Virginia / remote / hybrid is eligible on current posting",
    workArrangement: "unknown",
    employmentType: "full_time",
    datePosted: "",
    dateFirstFound: getTodayIsoDate(),
    dateLastVerified: "",
    openingAvailabilityStatus: "Unverified",
    intakeChannel: "Starter workspace",
    rawDescriptionText: [
      "Starter workspace record created from prior supplied job analysis.",
      "Known role elements:",
      "- ABA / behavioral health domain familiarity is relevant when speaking with clinics and providers.",
      "- Prospect tracking, activity logging, and pipeline handoffs through Salesforce are part of the role.",
      "- Outbound calling and prospecting to schedule discovery meetings are core daily duties.",
      "",
      "Items needing current verification:",
      "- Whether the opening is currently active on RethinkBH's official careers page.",
      "- Whether Nora has already submitted an application.",
      "- Guaranteed base salary, variable commission structure, quotas, and qualified-meeting criteria.",
      "- Internal Salesforce workflow expectations and onboarding training provided.",
      "- Actual hiring team or recruiter contact.",
    ].join("\n"),
    compensation: {
      employerPublishedBase: "",
      employerPublishedVariable: "",
      variableAssumptionsNote:
        "Quota attainment rates and variable commission terms are currently unknown. Do not treat target earnings as guaranteed pay.",
      thirdPartyEstimate: "",
      thirdPartySource: "",
      compensationSourceNote: "Needs current verification from an official RethinkBH job posting or recruiter conversation.",
      benefitsDocumented: "",
    },
    requiredQualifications: [
      "Understanding of Applied Behavior Analysis (ABA) or behavioral health clinic workflows",
      "Outbound calling and email outreach to prospective behavioral health practices",
      "Tracking prospects, conversations, and follow-up tasks in Salesforce CRM",
      "Clear verbal and written communication with clinical and administrative decision-makers",
      "Bachelor's degree or equivalent relevant work experience",
    ],
    preferredQualifications: [
      "Prior B2B sales development (BDR/SDR) or quota-carrying outreach experience",
      "Familiarity with behavioral health practice management / clinical data software",
    ],
    coreDuties: [
      "Conduct daily outbound calls and structured follow-ups with behavioral health providers",
      "Log prospect conversations, contact roles, and next actions accurately in Salesforce",
      "Identify clinic pain points and qualify introductory meetings for Account Executives",
      "Collaborate with sales and marketing teams on territory outreach",
    ],
    knownContactIds: [],
    stage: "Research / preparation",
    appliedConfirmedByNora: "unconfirmed",
    nextAction: "Add the current official RethinkBH posting URL/text and confirm whether you have already applied",
    nextActionDueDate: getTodayIsoDate(1),
    writtenAdvancementInfo:
      "Unknown — ask during screening how BDRs progress (e.g., senior BDR, Account Executive, or Customer Success/Onboarding) and over what typical timeline.",
    trainingProvidedInfo:
      "Unknown — ask what structured onboarding covers Salesforce workflows, call scripts, and ramp quota.",
    commuteAndScheduleNotes:
      "Verify remote eligibility from Oakton, VA and daily calling hours/time-zone expectations.",
    outstandingQuestions: [
      "Is this BDR opening currently active on RethinkBH's official careers page?",
      "What is the guaranteed base salary, separate from variable commission?",
      "What defines a 'qualified meeting' for quota credit, and is there a ramp period during training?",
      "What initial training is provided on RethinkBH's Salesforce setup and outbound cadence?",
    ],
    authenticityFlags: [
      {
        id: "flag-rethink-posting-missing",
        label: "Official posting URL not yet attached",
        explanation:
          "Attach the current posting from RethinkBH's official careers page to verify whether the vacancy is active and confirm location/pay facts.",
      },
      {
        id: "flag-rethink-comp-unknown",
        label: "Base vs. commission split unverified",
        explanation:
          "BDR compensation typically mixes base pay and commission. Confirm guaranteed base salary and quota criteria before comparing income reliability.",
      },
    ],
    liveVerificationLog: {
      lastCheckedAt: null,
      liveAvailable: false,
      summary: "Not yet checked against live web sources.",
      sources: [],
    },
    archived: false,
  },
];

export const INITIAL_ASSESSMENTS: RequirementAssessment[] = [
  {
    id: "ra-rethink-1",
    opportunityId: STARTER_RETHINKBH_ID,
    requirementText: "Understanding of Applied Behavior Analysis (ABA) or behavioral health clinic workflows",
    priority: "Required",
    noraEvidenceSummary:
      "Worked as an RBT at Little Leaves Behavioral Services (Jan 2023–Jul 2024) implementing ABA plans under BCBA supervision, collecting data, and communicating with families.",
    linkedEvidenceIds: ["ev-little-leaves-aba", "ev-behavioral-data", "ev-family-comm"],
    assessment: "Direct evidence",
    gapNature: "none",
    nextStep:
      "Prepare 1–2 concrete, non-confidential examples of how BCBAs and RBTs handle daily session data and family updates.",
  },
  {
    id: "ra-rethink-2",
    opportunityId: STARTER_RETHINKBH_ID,
    requirementText: "Bachelor's degree or equivalent relevant work experience",
    priority: "Required",
    noraEvidenceSummary: "Bachelor’s degree in Psychology, George Mason University (December 2021).",
    linkedEvidenceIds: ["ev-gmu-psych"],
    assessment: "Direct evidence",
    gapNature: "none",
    nextStep: "Keep degree and graduation date clear on résumé.",
  },
  {
    id: "ra-rethink-3",
    opportunityId: STARTER_RETHINKBH_ID,
    requirementText: "Clear verbal and written communication with clinical and administrative decision-makers",
    priority: "Required",
    noraEvidenceSummary:
      "Communicated directly with families and supervising BCBAs at Little Leaves; managed scheduling and follow-up in independent tutoring/coaching.",
    linkedEvidenceIds: ["ev-family-comm", "ev-tutoring-scheduling"],
    assessment: "Transferable evidence",
    gapNature: "none",
    nextStep:
      "Practice translating clinical communication skills into concise discovery questions for clinic owners and clinical directors.",
  },
  {
    id: "ra-rethink-4",
    opportunityId: STARTER_RETHINKBH_ID,
    requirementText: "Tracking prospects, conversations, and follow-up tasks in Salesforce CRM",
    priority: "Required",
    noraEvidenceSummary:
      "No established professional Salesforce experience. Strong habit of structured clinical record maintenance and tutoring follow-up tracking.",
    linkedEvidenceIds: ["ev-behavioral-data", "ev-gap-salesforce"],
    assessment: "Gap",
    gapNature: "trainable_skill",
    nextStep:
      "Complete the CRM workflow simulation in Practice & Learn to understand Accounts, Contacts, Activity Logs, and AE Handoffs without claiming workplace Salesforce history.",
  },
  {
    id: "ra-rethink-5",
    opportunityId: STARTER_RETHINKBH_ID,
    requirementText: "Outbound calling and email outreach to prospective behavioral health practices",
    priority: "Required",
    noraEvidenceSummary:
      "No established outbound calling or sales-quota history. Confirm personal comfort level with daily phone prospecting in My Profile.",
    linkedEvidenceIds: ["ev-gap-outbound", "ev-gap-quota"],
    assessment: "Gap",
    gapNature: "trainable_skill",
    nextStep:
      "Rehearse a calm 45-second ABA-informed opener and objection handling; ask in interviews about daily call volume and coaching.",
  },
  {
    id: "ra-rethink-6",
    opportunityId: STARTER_RETHINKBH_ID,
    requirementText: "Familiarity with behavioral health practice management / clinical data software",
    priority: "Preferred",
    noraEvidenceSummary:
      "Lacking documented evidence: Nora maintained behavioral data at Little Leaves, but the exact software platform used has not been recorded yet (do not assume RethinkBH).",
    linkedEvidenceIds: ["ev-behavioral-data", "ev-little-leaves-software"],
    assessment: "Unknown",
    gapNature: "missing_evidence_check",
    nextStep:
      "Record the exact clinical/scheduling software used at Little Leaves in My Profile so this moves from Unknown to verified evidence.",
  },
];

export const INITIAL_TASKS: Task[] = [
  {
    id: "task-rethink-1",
    title: "Add the current official RethinkBH posting",
    whyItMatters:
      "Confirms whether the BDR role is currently open, eligible from Virginia, and documents official responsibilities rather than relying on older notes.",
    category: "opportunity",
    estimatedMinutes: 15,
    dueDate: getTodayIsoDate(0),
    scheduledBucket: "today",
    completed: false,
    completedAt: null,
    archived: false,
    linkedOpportunityId: STARTER_RETHINKBH_ID,
  },
  {
    id: "task-rethink-2",
    title: "Confirm whether you have already applied to RethinkBH",
    whyItMatters:
      "Determines whether your next step is tailoring an application before applying or preparing targeted follow-up and interview questions.",
    category: "followup",
    estimatedMinutes: 5,
    dueDate: getTodayIsoDate(0),
    scheduledBucket: "today",
    completed: false,
    completedAt: null,
    archived: false,
    linkedOpportunityId: STARTER_RETHINKBH_ID,
  },
  {
    id: "task-rethink-3",
    title: "Identify the clinical/scheduling software you actually used at Little Leaves",
    whyItMatters:
      "Turns an unverified unknown into concrete software workflow evidence you can cite honestly for ABA tech, onboarding, and support roles.",
    category: "opportunity",
    estimatedMinutes: 10,
    dueDate: getTodayIsoDate(0),
    scheduledBucket: "today",
    completed: false,
    completedAt: null,
    archived: false,
    linkedOpportunityId: STARTER_RETHINKBH_ID,
  },
  {
    id: "task-rethink-4",
    title: "Confirm current RBT certification status",
    whyItMatters:
      "Prevents accidentally implying an active credential if it has lapsed, or unlocks roles requiring active certification if it is current.",
    category: "followup",
    estimatedMinutes: 10,
    dueDate: getTodayIsoDate(1),
    scheduledBucket: "tomorrow",
    completed: false,
    completedAt: null,
    archived: false,
  },
  {
    id: "task-rethink-5",
    title: "Practice a 45-second introduction connecting ABA experience to B2B roles",
    whyItMatters:
      "Helps you explain your transition clearly in plain English without overstating sales experience or apologizing for your clinical background.",
    category: "preparation",
    estimatedMinutes: 15,
    dueDate: getTodayIsoDate(0),
    scheduledBucket: "today",
    completed: false,
    completedAt: null,
    archived: false,
    linkedOpportunityId: STARTER_RETHINKBH_ID,
  },
  {
    id: "task-rethink-6",
    title: "Complete beginner CRM workflow practice (search, log call, follow-up, handoff)",
    whyItMatters:
      "Builds practical familiarity with BDR CRM concepts so you can discuss prospect hygiene intelligently while staying truthful about your background.",
    category: "preparation",
    estimatedMinutes: 20,
    dueDate: getTodayIsoDate(1),
    scheduledBucket: "tomorrow",
    completed: false,
    completedAt: null,
    archived: false,
    linkedOpportunityId: STARTER_RETHINKBH_ID,
  },
  {
    id: "task-rethink-7",
    title: "Prepare interview questions on base pay, quotas, training, and qualified-meeting criteria",
    whyItMatters:
      "Protects your goal of dependable income by clarifying how much pay is guaranteed versus variable before committing to a commission role.",
    category: "relationship",
    estimatedMinutes: 15,
    dueDate: getTodayIsoDate(1),
    scheduledBucket: "tomorrow",
    completed: false,
    completedAt: null,
    archived: false,
    linkedOpportunityId: STARTER_RETHINKBH_ID,
  },
];

export const INITIAL_LEARNING_ITEMS: LearningItem[] = [
  {
    id: "learn-crm-basics",
    title: "CRM Pipeline & Record Hygiene Fundamentals (Leads, Accounts, Contacts, Activities)",
    tiedToRequirement: "Tracking prospects, conversations, and follow-up tasks in Salesforce CRM",
    linkedOpportunityId: STARTER_RETHINKBH_ID,
    status: "In progress",
    estimatedHours: 2,
    practicalExercise:
      "Complete all 4 steps in the Synthetic CRM Practice Simulation (search before creating, log discovery notes, schedule next step, write AE handoff).",
    honestFramingNote:
      "Describe as self-directed study alongside clinical data logging experience — never describe simulation practice as workplace Salesforce administration or usage.",
  },
  {
    id: "learn-discovery-aba",
    title: "Translating ABA Clinic Operations into Discovery Questions",
    tiedToRequirement: "Outbound calling and discovery qualification with behavioral health practices",
    linkedOpportunityId: STARTER_RETHINKBH_ID,
    status: "Planned",
    estimatedHours: 1.5,
    practicalExercise:
      "Draft 5 open-ended questions asking a clinic director how they currently handle session notes, BCBA supervision tracking, and parent communication.",
    honestFramingNote:
      "Connects directly to your real Little Leaves RBT experience observing clinic workflows firsthand.",
  },
  {
    id: "learn-bdr-comp-math",
    title: "Evaluating BDR Compensation: Base Salary, OTE, Ramp Period, and Quota Attainment",
    tiedToRequirement: "Dependable income evaluation & offer comparison",
    linkedOpportunityId: STARTER_RETHINKBH_ID,
    status: "Planned",
    estimatedHours: 1,
    practicalExercise:
      "Review the Offer Comparison checklist in Decisions & Progress and finalize your minimum acceptable base salary in My Profile.",
    honestFramingNote:
      "Helps you evaluate whether base salary alone covers essential living costs in Northern Virginia.",
  },
];

// Synthetic CRM records for Feature 7 ("Practice simulation—not Salesforce")
export const SYNTHETIC_CRM_ACCOUNTS: SyntheticCrmAccount[] = [
  {
    id: "syn-acct-1",
    organizationName: "Potomac Valley Pediatric ABA (Synthetic)",
    sector: "Outpatient ABA Clinic (18 clinicians)",
    cityState: "Fairfax, VA (Synthetic)",
    staffSizeRange: "15–25 staff",
    currentWorkflowSummary:
      "Uses spreadsheets for staff scheduling and a legacy note tool; clinical director mentioned onboarding new RBTs takes too much admin time.",
    syntheticContacts: [
      {
        id: "syn-con-1a",
        name: "Dr. Maya Patel (Fictional)",
        title: "Clinical Director, BCBA-D",
        phonePlaceholder: "555-0142 (Simulation only)",
        notes: "Spoke at a regional webinar 4 months ago; cares about accurate session data and reducing BCBA paperwork.",
      },
      {
        id: "syn-con-1b",
        name: "Jordan Ellis (Fictional)",
        title: "Practice Operations Manager",
        phonePlaceholder: "555-0149 (Simulation only)",
        notes: "Handles billing coordination, authorizations, and software renewals.",
      },
    ],
  },
  {
    id: "syn-acct-2",
    organizationName: "Blue Ridge Family Learning Group (Synthetic)",
    sector: "School- & Home-Based Behavioral Services",
    cityState: "Reston, VA (Synthetic)",
    staffSizeRange: "30–45 staff",
    currentWorkflowSummary:
      "Growing across two counties; evaluating whether to consolidate scheduling, family portal updates, and clinical data collection.",
    syntheticContacts: [
      {
        id: "syn-con-2a",
        name: "Marcus Vance (Fictional)",
        title: "Director of Operations",
        phonePlaceholder: "555-0188 (Simulation only)",
        notes: "Requested pricing clarity and implementation timeline details last quarter; contract renewal comes up in 90 days.",
      },
    ],
  },
  {
    id: "syn-acct-3",
    organizationName: "Chesapeake Early Intervention Partners (Synthetic)",
    sector: "Early Childhood Behavioral Support",
    cityState: "Rockville, MD (Synthetic)",
    staffSizeRange: "10–15 staff",
    currentWorkflowSummary:
      "Recently opened a second center; unknown what data collection platform they currently use.",
    syntheticContacts: [
      {
        id: "syn-con-3a",
        name: "Elena Rostova (Fictional)",
        title: "Founder & Lead BCBA",
        phonePlaceholder: "555-0194 (Simulation only)",
        notes: "No prior outreach logged in CRM.",
      },
    ],
  },
];

// Optional isolated sample comparison records (NEVER mixed into Nora's real state or exports)
export const ISOLATED_SAMPLE_OPPORTUNITIES: Opportunity[] = [
  {
    id: "sample-only-onboarding-specialist",
    employer: "Example HealthTech Co. (Sample Preview Only)",
    title: "Client Onboarding Coordinator",
    officialWebsite: "https://example.com",
    postingUrl: "https://example.com/careers/onboarding-coordinator",
    applicationUrl: "https://example.com/careers/onboarding-coordinator/apply",
    location: "Tysons, VA (Hybrid — 2 days on-site)",
    eligibleLocations: "VA, MD, DC",
    workArrangement: "hybrid",
    employmentType: "full_time",
    datePosted: getTodayIsoDate(-5),
    dateFirstFound: getTodayIsoDate(-2),
    dateLastVerified: getTodayIsoDate(-2),
    openingAvailabilityStatus: "Seen on official careers page",
    intakeChannel: "Employer careers page",
    rawDescriptionText:
      "Sample comparison record showing a salaried non-commission role guiding new behavioral health clinics through software setup, training schedules, and data migration checklists.",
    compensation: {
      employerPublishedBase: "$58,000 – $64,000 annual salary",
      employerPublishedVariable: "None (100% base salary)",
      variableAssumptionsNote: "No variable commission component.",
      thirdPartyEstimate: "",
      thirdPartySource: "",
      compensationSourceNote: "Sample employer-published range",
      benefitsDocumented: "Medical, dental, vision, 401(k) with 3% match, 15 days PTO",
    },
    requiredQualifications: [
      "1+ year working in healthcare, behavioral health, or education operations/service delivery",
      "Strong written and verbal communication with clinical teams and families/clients",
      "Organized tracking of schedules, milestones, and documentation",
    ],
    preferredQualifications: [
      "Experience training staff or tutoring/coaching learners on structured processes",
      "Familiarity with ticketing or project tracking tools",
    ],
    coreDuties: [
      "Coordinate kickoff calls and onboarding checklists for new clinic customers",
      "Lead live training sessions for clinicians and front-desk coordinators",
      "Track implementation milestones and escalate technical blockers to support",
    ],
    knownContactIds: [],
    stage: "Ready to apply",
    appliedConfirmedByNora: "not_applied",
    nextAction: "Sample record only — toggle off sample preview anytime",
    nextActionDueDate: getTodayIsoDate(3),
    writtenAdvancementInfo: "Sample path: Onboarding Coordinator -> Implementation Manager or Customer Success Manager (2–3 years).",
    trainingProvidedInfo: "4-week product & shadow onboarding.",
    commuteAndScheduleNotes: "Approx. 15–20 min from Oakton, VA; M–F 8:30am–5:00pm.",
    outstandingQuestions: ["How many concurrent clinic onboardings does one coordinator manage?"],
    authenticityFlags: [],
    liveVerificationLog: {
      lastCheckedAt: null,
      liveAvailable: false,
      summary: "Sample illustration record.",
      sources: [],
    },
    archived: false,
    isSampleRecord: true,
  },
];

export interface RoleFamilyExploration {
  id: string;
  title: string;
  whyExplore: string;
  whereNoraHasEvidence: string;
  evidenceOrTrainingUsuallyRequired: string;
  entryLevelRealityCheck: string;
  sampleSearchTerms: string[];
}

export const ROLE_FAMILIES_TO_EXPLORE: RoleFamilyExploration[] = [
  {
    id: "rf-aba-bdr",
    title: "Business Development for ABA, Behavioral Health, or Education Software",
    whyExplore:
      "Vendors selling to ABA clinics or school districts value reps who genuinely understand BCBA/RBT workflows and speak credibly with clinical directors.",
    whereNoraHasEvidence:
      "Firsthand Little Leaves RBT experience, family communication, and George Mason Psychology degree.",
    evidenceOrTrainingUsuallyRequired:
      "CRM workflow hygiene (Salesforce/HubSpot), comfort with daily outbound phone/email volume, and resilience with rejection and monthly quotas.",
    entryLevelRealityCheck:
      "Often genuinely entry-level for career switchers, but compensation usually splits guaranteed base pay and variable commission. Verify base salary reliability carefully.",
    sampleSearchTerms: [
      "Business Development Representative behavioral health",
      "Sales Development Representative ABA software",
      "Education partnerships representative Virginia",
    ],
  },
  {
    id: "rf-support-cs",
    title: "Customer Support & Associate Customer Success",
    whyExplore:
      "Provides dependable salaried income while helping existing clinics, educators, or families use software or services effectively.",
    whereNoraHasEvidence:
      "Calm communication with families, structured session documentation, and tutoring/coaching follow-up.",
    evidenceOrTrainingUsuallyRequired:
      "Help-desk ticketing workflows (e.g., Zendesk/Intercom), clear written troubleshooting steps, and confirmed details on software used at Little Leaves.",
    entryLevelRealityCheck:
      "Do not assume all 'Customer Success Manager' titles are entry-level — many full CSM roles require 2–4 years of SaaS renewal/expansion ownership. Target 'Customer Support Specialist', 'Client Experience Associate', or 'Associate Customer Success' as realistic entry bridges.",
    sampleSearchTerms: [
      "Customer Support Specialist healthcare software",
      "Associate Customer Success Manager edtech",
      "Client Support Coordinator behavioral health",
    ],
  },
  {
    id: "rf-onboarding-impl",
    title: "Client Onboarding & Implementation Coordination",
    whyExplore:
      "Combines structured scheduling, training delivery, and record accuracy with predictable base compensation and strong 2–4 year growth into Implementation Manager roles.",
    whereNoraHasEvidence:
      "Independent tutoring/coaching (teaching structured steps + follow-up) and implementing multi-step ABA plans accurately.",
    evidenceOrTrainingUsuallyRequired:
      "Project checklist tracking, clear written status updates, and verified examples of coordinating schedules across multiple families or staff.",
    entryLevelRealityCheck:
      "Senior 'Implementation Manager' roles often require technical data-migration or PMP/SaaS history, whereas 'Onboarding Coordinator' or 'Implementation Associate' roles frequently hire organized clinicians and educators.",
    sampleSearchTerms: [
      "Client Onboarding Coordinator healthcare",
      "Implementation Specialist ABA education",
      "Training and Onboarding Associate Virginia",
    ],
  },
  {
    id: "rf-practice-ops",
    title: "Practice Operations & Administrative Coordination",
    whyExplore:
      "Outpatient behavioral health, pediatric therapy, and specialty practices in Northern Virginia need reliable coordinators for intake, authorizations, and scheduling.",
    whereNoraHasEvidence:
      "Direct clinic experience as an RBT, family rapport, behavioral record maintenance, and Oakton/NoVA proximity.",
    evidenceOrTrainingUsuallyRequired:
      "Insurance intake/scheduling familiarity, spreadsheet organization, and verifying any prior afterschool or front-of-house coordination on your résumé.",
    entryLevelRealityCheck:
      "Dependable base pay and straightforward hiring bar; ask clear questions during interviews about whether there is an internal path to Clinic Manager or Operations Manager within 2–4 years.",
    sampleSearchTerms: [
      "Intake Coordinator behavioral health Northern Virginia",
      "Practice Operations Coordinator Fairfax Reston",
      "Patient Care Coordinator pediatric therapy",
    ],
  },
  {
    id: "rf-edu-family",
    title: "Education-Program & Family-Services Coordination",
    whyExplore:
      "Universities, school contractors, non-profits, and tutoring organizations hire program coordinators to manage family communication, tutor/staff scheduling, and compliance records.",
    whereNoraHasEvidence:
      "Psychology BA (GMU), independent tutoring/coaching scheduling, ABA family communication, and potential afterschool coordination once verified on résumé.",
    evidenceOrTrainingUsuallyRequired:
      "Confirmed résumé bullets from tutoring/afterschool work, program scheduling accuracy, and clear written parent/student communication.",
    entryLevelRealityCheck:
      "Strong mission alignment and steady benefits (especially in university or larger education organizations), though salary ceilings vary — compare base pay and advancement paths early.",
    sampleSearchTerms: [
      "Program Coordinator George Mason Fairfax",
      "Family Services Coordinator Northern Virginia",
      "Academic Operations Coordinator",
    ],
  },
];

export const BEYOND_JOB_BOARDS_CHANNELS = [
  {
    id: "ch-employer-direct",
    title: "Verified Employer Openings",
    description:
      "Go directly to official `/careers` pages of ABA platforms, pediatric therapy groups, and education technology companies rather than third-party repost boards.",
    firstStep:
      "Build a shortlist of 8–10 real organizations (e.g., ABA software vendors, Northern Virginia clinic networks, GMU/Fairfax education providers) and check their official career pages weekly.",
  },
  {
    id: "ch-target-research",
    title: "Target-Employer Research",
    description:
      "Identify growing behavioral health and edtech employers that hire support, onboarding, or business development staff even before reposting widely.",
    firstStep:
      "Look up which software tools ABA clinics in Virginia mention in their own RBT/BCBA job postings — each tool named is a potential B2B employer where your clinic background matters.",
  },
  {
    id: "ch-informational",
    title: "Referrals & Informational Conversations",
    description:
      "Ask former clinicians or GMU Psychology alumni who moved into software support, onboarding, or BDR roles for a 15-minute perspective check.",
    firstStep:
      "Add 2 alumni or former clinic contacts in People & Outreach and draft a low-pressure informational question about their day-to-day work.",
  },
  {
    id: "ch-colleagues",
    title: "Former Colleagues & Supervisors",
    description:
      "Supervising BCBAs, clinic coordinators, or tutoring families often know regional clinic directors, vendor trainers, or operations leads.",
    firstStep:
      "List 1–2 trusted contacts from Little Leaves or GMU who have seen your reliability firsthand and let them know the types of coordination/operations roles you are exploring.",
  },
  {
    id: "ch-adjacent",
    title: "Adjacent Roles Using Clinical & Tutoring Evidence",
    description:
      "Look beyond sales-only titles to Client Onboarding, Provider Support, Intake Operations, and Training Coordination where structured communication is the core job.",
    firstStep:
      "Compare at least one salaried coordination/onboarding posting alongside RethinkBH BDR so you have a clear benchmark for guaranteed base pay.",
  },
  {
    id: "ch-local-nova",
    title: "Local Northern Virginia Organizations",
    description:
      "Oakton sits near Fairfax, Tysons, Reston, Vienna, and Arlington — hybrid roles often have far fewer applicants than nationwide remote postings.",
    firstStep:
      "Set your maximum commute preference in My Profile so hybrid Fairfax/Reston/Tysons roles can be evaluated accurately.",
  },
];

export function createStarterWorkspaceState(): WorkspaceState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: structuredClone(INITIAL_PROFILE),
    evidence: structuredClone(INITIAL_EVIDENCE),
    opportunities: structuredClone(INITIAL_OPPORTUNITIES),
    assessments: structuredClone(INITIAL_ASSESSMENTS),
    applicationVersions: [],
    contacts: [],
    outreachDrafts: [],
    tasks: structuredClone(INITIAL_TASKS),
    practiceSessions: [],
    learningItems: structuredClone(INITIAL_LEARNING_ITEMS),
    timeLogs: [],
    documents: [],
    relationships: [],
    authenticityReviews: [],
    crmSimulation: {
      searchedQueries: [],
      conversationLogs: [],
      followUpTasks: [],
      handoffNotes: [],
    },
    settings: {
      availableMinutesToday: 45,
      allowServerSideAi: true,
      showSampleComparisonData: false,
    },
  };
}
