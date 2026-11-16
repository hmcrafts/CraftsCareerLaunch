import {
  AuthenticityFlag,
  Evidence,
  FitRecommendationVerdict,
  Opportunity,
  OutreachMessageType,
  PracticeFeedback,
  PracticeMode,
  Profile,
  RequirementAssessment,
  RequirementFitLevel,
} from "../types/models";

export interface DecisionEvaluationReport {
  verdict: FitRecommendationVerdict;
  evidenceUsed: string[];
  missingInformation: string[];
  reasoning: string;
  suggestedNextAction: string;
  hardEligibilityIssues: string[];
  trainableGaps: string[];
  evidenceVsSkillNote: string;
  factors: {
    incomeReliability: string;
    benefits: string;
    scheduleAndLocationFit: string;
    dayToDayWork: string;
    trainingBurden: string;
    transferableCareerCapital: string;
    advancementQuestions: string[];
    unresolvedRisks: string[];
  };
}

export function extractDomainFromUrl(rawUrl: string): string | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  try {
    const withProto = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
    const u = new URL(withProto);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

const KNOWN_ATS_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "myworkdayjobs.com",
  "ashbyhq.com",
  "icims.com",
  "bamboohr.com",
  "paylocity.com",
  "adp.com",
  "ultipro.com",
  "ukg.net",
  "smartrecruiters.com",
  "jazzhr.com",
  "applytojob.com",
];

export function evaluateAuthenticityFlags(opp: Partial<Opportunity>): AuthenticityFlag[] {
  const flags: AuthenticityFlag[] = [];
  const text = `${opp.rawDescriptionText || ""} ${opp.compensation?.employerPublishedBase || ""} ${
    opp.compensation?.employerPublishedVariable || ""
  }`.toLowerCase();

  if (!opp.employer?.trim() || !opp.officialWebsite?.trim()) {
    flags.push({
      id: "flag-employer-identity",
      label: "Employer official website not yet established",
      explanation:
        "Confirm the organization's official domain independently before submitting personal contact details.",
    });
  }

  const officialDom = extractDomainFromUrl(opp.officialWebsite || "");
  const applyDom = extractDomainFromUrl(opp.applicationUrl || opp.postingUrl || "");
  if (officialDom && applyDom && officialDom !== applyDom) {
    const isKnownAts = KNOWN_ATS_DOMAINS.some((ats) => applyDom === ats || applyDom.endsWith(`.${ats}`));
    if (!isKnownAts && !applyDom.endsWith(`.${officialDom}`)) {
      flags.push({
        id: "flag-domain-mismatch",
        label: "Application URL domain differs from official employer domain",
        explanation: `Official website is '${officialDom}', while the posting/application link uses '${applyDom}'. Check that the employer's own careers page links to this destination.`,
      });
    }
  }

  if (
    /upfront fee|pay for training|purchase equipment|starter kit fee|check to buy equipment|wire transfer|crypto/i.test(
      text
    )
  ) {
    flags.push({
      id: "flag-upfront-payment",
      label: "Possible upfront payment or equipment-check language",
      explanation:
        "The description mentions upfront fees, paid training, or equipment check handling. Investigate carefully before proceeding.",
    });
  }

  if (/social security|ssn|bank account|routing number|direct deposit form before interview|credit card/i.test(text)) {
    flags.push({
      id: "flag-early-financial",
      label: "Unusually early request for sensitive financial or identity details",
      explanation:
        "Legitimate employers do not need banking or Social Security numbers prior to a verified written job offer and onboarding.",
    });
  }

  const hasBase = Boolean(opp.compensation?.employerPublishedBase?.trim());
  const isCommissionOnlyText =
    /100%\s*commission|commission[\s-]only|uncapped earning potential|make up to \$/i.test(text) && !hasBase;

  if (isCommissionOnlyText) {
    flags.push({
      id: "flag-commission-only",
      label: "Unclear or commission-only compensation language",
      explanation:
        "Compensation highlights 'up to' or commission-only earnings without a stated guaranteed base pay.",
    });
  } else if (!hasBase) {
    flags.push({
      id: "flag-missing-base",
      label: "Guaranteed base compensation not documented",
      explanation:
        "No employer-published base salary or hourly rate is recorded yet. Confirm guaranteed base pay early.",
    });
  }

  if (opp.openingAvailabilityStatus !== "Seen on official careers page") {
    flags.push({
      id: "flag-unverified-active",
      label: "Current vacancy status unverified on official careers page",
      explanation:
        "Check the employer's official careers page directly to confirm the opening is still accepting applications.",
    });
  }

  return flags;
}

export function findDuplicateOpportunities(
  candidate: { employer: string; title: string; postingUrl?: string; id?: string },
  existing: Opportunity[]
): Opportunity[] {
  const normEmp = (candidate.employer || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const normTitle = (candidate.title || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const normUrl = (candidate.postingUrl || "").trim().toLowerCase().replace(/\/+$/, "");

  return existing.filter((opp) => {
    if (opp.isSampleRecord || opp.id === candidate.id) return false;
    const eEmp = opp.employer.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
    const eTitle = opp.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
    const eUrl = opp.postingUrl.trim().toLowerCase().replace(/\/+$/, "");

    if (normUrl && eUrl && normUrl === eUrl) return true;
    if (normEmp && normTitle && eEmp && eTitle) {
      const empMatch = eEmp.includes(normEmp) || normEmp.includes(eEmp);
      const titleMatch = eTitle === normTitle;
      return empMatch && titleMatch;
    }
    return false;
  });
}

export interface ParsedJdResult {
  employer: string;
  title: string;
  location: string;
  workArrangement: "remote" | "hybrid" | "onsite" | "unknown";
  employmentType: "full_time" | "part_time" | "contract" | "unknown";
  employerPublishedBasePay: string;
  employerPublishedVariablePay: string;
  benefitsSummary: string;
  requiredQualifications: string[];
  preferredQualifications: string[];
  coreDuties: string[];
}

export function parseJobDescriptionLocally(rawText: string): ParsedJdResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let title = "";
  let employer = "";
  let location = "";

  for (const line of lines.slice(0, 10)) {
    const clean = line.replace(/^[-*#]+\s*/, "");
    if (!title && /^(job\s*title|role|position)\s*:/i.test(clean)) {
      title = clean.replace(/^(job\s*title|role|position)\s*:\s*/i, "").trim();
    } else if (!employer && /^(company|employer|organization)\s*:/i.test(clean)) {
      employer = clean.replace(/^(company|employer|organization)\s*:\s*/i, "").trim();
    } else if (!location && /^location\s*:/i.test(clean)) {
      location = clean.replace(/^location\s*:\s*/i, "").trim();
    }
  }

  if (!title && lines.length > 0) {
    title = lines[0].replace(/^[-*#]+\s*/, "").slice(0, 90);
  }

  const lower = rawText.toLowerCase();
  let workArrangement: "remote" | "hybrid" | "onsite" | "unknown" = "unknown";
  if (/\bhybrid\b/.test(lower)) workArrangement = "hybrid";
  else if (/\b(remote|work from home)\b/.test(lower)) workArrangement = "remote";
  else if (/\b(on-site|onsite|in-person|in office)\b/.test(lower)) workArrangement = "onsite";

  let employmentType: "full_time" | "part_time" | "contract" | "unknown" = "unknown";
  if (/\bfull[\s-]time\b/.test(lower)) employmentType = "full_time";
  else if (/\bpart[\s-]time\b/.test(lower)) employmentType = "part_time";
  else if (/\b(contract|temporary|1099)\b/.test(lower)) employmentType = "contract";

  // Extract explicit salary/hourly only if stated — never invent!
  let employerPublishedBasePay = "";
  const salaryMatch = rawText.match(
    /(?:base\s*(?:salary|pay)|salary|pay\s*range|compensation|hourly\s*rate)?\s*:?\s*(\$\d{2,3}(?:,\d{3})+(?:\s*[-–to]+\s*\$\d{2,3}(?:,\d{3})+)?(?:\s*(?:per\s*year|\/yr|annually|base))?|\$\d{2}(?:\.\d{2})?(?:\s*[-–to]+\s*\$\d{2}(?:\.\d{2})?)?\s*(?:\/hr|per\s*hour|hourly))/i
  );
  if (salaryMatch && salaryMatch[1]) {
    employerPublishedBasePay = salaryMatch[1].trim();
  }

  let employerPublishedVariablePay = "";
  const varMatch = rawText.match(
    /((?:commission|bonus|ote|on-target earnings|variable\s*pay)[^.\n]{0,95})/i
  );
  if (varMatch && varMatch[1]) {
    employerPublishedVariablePay = varMatch[1].trim();
  }

  let benefitsSummary = "";
  const benMatch = rawText.match(
    /((?:medical|health insurance|dental|401\(k\)|401k|paid time off|pto)[^.\n]{0,120})/i
  );
  if (benMatch && benMatch[1]) {
    benefitsSummary = benMatch[1].trim();
  }

  const requiredQualifications: string[] = [];
  const preferredQualifications: string[] = [];
  const coreDuties: string[] = [];

  let currentBucket: "duties" | "req" | "pref" = "duties";

  for (const line of lines) {
    const headerCheck = line.toLowerCase();
    if (/^(requirements|required qualifications|what you bring|minimum qualifications|must have)/i.test(headerCheck)) {
      currentBucket = "req";
      continue;
    }
    if (/^(preferred|nice to have|bonus points|desired qualifications)/i.test(headerCheck)) {
      currentBucket = "pref";
      continue;
    }
    if (/^(responsibilities|what you'll do|duties|role overview|key duties|in this role)/i.test(headerCheck)) {
      currentBucket = "duties";
      continue;
    }

    const isBullet = /^([-•*]|\d+\.)\s+/.test(line);
    if (isBullet) {
      const cleaned = line.replace(/^([-•*]|\d+\.)\s+/, "").trim();
      if (cleaned.length < 6) continue;
      if (currentBucket === "req") requiredQualifications.push(cleaned);
      else if (currentBucket === "pref") preferredQualifications.push(cleaned);
      else coreDuties.push(cleaned);
    }
  }

  // Fallback extraction if posting had paragraph sentences rather than bullet headers
  if (requiredQualifications.length === 0) {
    for (const line of lines) {
      if (
        /\b(bachelor|degree|experience|salesforce|crm|aba|communication|outbound|certification|rbt|bcba|years)\b/i.test(
          line
        ) &&
        line.length >= 18 &&
        line.length <= 220
      ) {
        if (/preferred|nice to have|plus\b/i.test(line)) {
          preferredQualifications.push(line.replace(/^([-•*]|\d+\.)\s+/, ""));
        } else {
          requiredQualifications.push(line.replace(/^([-•*]|\d+\.)\s+/, ""));
        }
      }
    }
  }

  return {
    employer,
    title,
    location,
    workArrangement,
    employmentType,
    employerPublishedBasePay,
    employerPublishedVariablePay,
    benefitsSummary,
    requiredQualifications: requiredQualifications.slice(0, 10),
    preferredQualifications: preferredQualifications.slice(0, 6),
    coreDuties: coreDuties.slice(0, 8),
  };
}

function isNoraProfileContext(profile: Profile, evidence?: Evidence[]): boolean {
  if (profile.fullName.trim().toLowerCase() === "nora crafts") {
    return true;
  }
  if (
    evidence &&
    evidence.some(
      (e) => e.id === "ev-little-leaves-aba" || /little leaves/i.test(e.claimText)
    )
  ) {
    return true;
  }
  return false;
}

function findMatchingUserEvidence(
  reqText: string,
  usableEvidence: Evidence[]
): Evidence[] {
  const stopWords = new Set([
    "with",
    "from",
    "that",
    "this",
    "have",
    "will",
    "your",
    "able",
    "work",
    "role",
    "team",
    "years",
    "year",
    "experience",
    "ability",
    "strong",
    "skills",
    "preferred",
    "required",
    "must",
    "including",
  ]);
  const tokens = reqText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stopWords.has(w));

  if (tokens.length === 0) return [];

  return usableEvidence.filter((ev) => {
    const hay = `${ev.claimText} ${(ev.tags || []).join(" ")}`.toLowerCase();
    return tokens.some((tok) => hay.includes(tok));
  });
}

export function assessSingleRequirement(
  reqText: string,
  priority: "Required" | "Preferred",
  opportunityId: string,
  index: number,
  profile: Profile,
  evidence: Evidence[]
): RequirementAssessment {
  const lower = reqText.toLowerCase();
  const usableEvidence = evidence.filter(
    (e) =>
      e.category !== "not_yet_demonstrated" &&
      (e.verificationStatus === "Confirmed by Nora" ||
        e.verificationStatus === "Supported by uploaded document")
  );
  const explicitGaps = evidence.filter((e) => e.category === "not_yet_demonstrated");

  // Multi-user isolation: for non-Nora workspaces, assess strictly against that user's own profile & evidence
  if (!isNoraProfileContext(profile, evidence)) {
    const matchedGap = explicitGaps.find((g) => {
      const gapTokens = g.claimText
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4);
      return gapTokens.some((t) => lower.includes(t));
    });
    if (matchedGap) {
      return {
        id: `ra-${opportunityId}-${index}`,
        opportunityId,
        requirementText: reqText,
        priority,
        noraEvidenceSummary: `Recorded development area: ${matchedGap.claimText}`,
        linkedEvidenceIds: [matchedGap.id],
        assessment: "Gap",
        gapNature: "trainable_skill",
        nextStep:
          "Frame honestly during applications and use Practice & Learn to build foundational familiarity.",
      };
    }

    const matchedUsable = findMatchingUserEvidence(reqText, usableEvidence);
    if (matchedUsable.length > 0) {
      const hasDirect = matchedUsable.some((m) => m.category === "demonstrated_skill");
      return {
        id: `ra-${opportunityId}-${index}`,
        opportunityId,
        requirementText: reqText,
        priority,
        noraEvidenceSummary: matchedUsable
          .slice(0, 2)
          .map((m) => m.claimText)
          .join(" · "),
        linkedEvidenceIds: matchedUsable.slice(0, 3).map((m) => m.id),
        assessment: hasDirect ? "Direct evidence" : "Transferable evidence",
        gapNature: "none",
        nextStep:
          "Cite this verified claim with a concrete, non-exaggerated example.",
      };
    }

    if (
      /bachelor|master|degree|university|college|education/i.test(lower) &&
      profile.educationSummary.trim()
    ) {
      return {
        id: `ra-${opportunityId}-${index}`,
        opportunityId,
        requirementText: reqText,
        priority,
        noraEvidenceSummary: `Profile education summary: ${profile.educationSummary.trim()}`,
        linkedEvidenceIds: [],
        assessment: "Direct evidence",
        gapNature: "none",
        nextStep: "Confirm degree details match the posting's stated education level.",
      };
    }

    return {
      id: `ra-${opportunityId}-${index}`,
      opportunityId,
      requirementText: reqText,
      priority,
      noraEvidenceSummary:
        "Not yet mapped to a confirmed claim in your Evidence Library — review your résumé or profile to check whether you have supporting evidence.",
      linkedEvidenceIds: [],
      assessment: "Unknown",
      gapNature: "missing_evidence_check",
      nextStep:
        "Add a confirmed claim in My Profile if you have done this, or treat as a topic to clarify.",
    };
  }

  // Nora's workspace-specific domain rules (backed by Nora's own profile & evidence)
  // 1. Check hard / credential unknowns first (e.g., active RBT, BCBA license, Master's)
  if (
    /\bbcba\b|board certified behavior analyst|master'?s degree/i.test(lower) &&
    !/under bcba|bcba supervision|with bcbas/i.test(lower)
  ) {
    return {
      id: `ra-${opportunityId}-${index}`,
      opportunityId,
      requirementText: reqText,
      priority,
      noraEvidenceSummary:
        "Nora holds a Bachelor’s degree in Psychology (GMU, Dec 2021) and worked under BCBA supervision, not as a credentialed BCBA.",
      linkedEvidenceIds: ["ev-gmu-psych"],
      assessment: "Gap",
      gapNature: "hard_eligibility",
      nextStep:
        priority === "Required"
          ? "Hard credential barrier if BCBA/Master's licensure is mandatory. Confirm whether equivalent bachelor's-level experience is accepted or deprioritize."
          : "Preferred credential only — emphasize experience collaborating closely with BCBAs.",
    };
  }

  if (/active rbt|current rbt|registered behavior technician certification/i.test(lower)) {
    if (profile.rbtCertificationStatus === "active") {
      return {
        id: `ra-${opportunityId}-${index}`,
        opportunityId,
        requirementText: reqText,
        priority,
        noraEvidenceSummary:
          "Nora confirmed active RBT certification status and prior Little Leaves RBT experience.",
        linkedEvidenceIds: ["ev-little-leaves-aba"],
        assessment: "Direct evidence",
        gapNature: "none",
        nextStep: "Include credential number/expiration date if requested on application.",
      };
    }
    if (profile.rbtCertificationStatus === "inactive_or_expired") {
      return {
        id: `ra-${opportunityId}-${index}`,
        opportunityId,
        requirementText: reqText,
        priority,
        noraEvidenceSummary:
          "Prior RBT work experience (Jan 2023–Jul 2024), but RBT certification is marked inactive/expired.",
        linkedEvidenceIds: ["ev-little-leaves-aba"],
        assessment: "Gap",
        gapNature: priority === "Required" ? "hard_eligibility" : "trainable_skill",
        nextStep:
          "Check whether employer sponsors RBT renewal upon hire or requires an active credential on day one.",
      };
    }
    return {
      id: `ra-${opportunityId}-${index}`,
      opportunityId,
      requirementText: reqText,
      priority,
      noraEvidenceSummary:
        "Lacking confirmed evidence: Prior RBT role at Little Leaves is recorded, but current RBT certification status is unverified.",
      linkedEvidenceIds: ["ev-little-leaves-aba", "ev-rbt-cert-status"],
      assessment: "Unknown",
      gapNature: "missing_evidence_check",
      nextStep: "Verify your current RBT certification status in My Profile before applying.",
    };
  }

  // 2. Check known Salesforce / CRM gap (never rewrite missing Salesforce experience as experience!)
  if (/salesforce|hubspot|\bcrm\b/i.test(lower)) {
    const hasVerifiedCrmWork = usableEvidence.some(
      (e) => /salesforce|crm/i.test(e.claimText) && e.category === "demonstrated_skill"
    );
    if (!hasVerifiedCrmWork) {
      return {
        id: `ra-${opportunityId}-${index}`,
        opportunityId,
        requirementText: reqText,
        priority,
        noraEvidenceSummary:
          "Skill gap (trainable): No established professional Salesforce experience. Transferable habit of accurate behavioral data logging and follow-up tracking.",
        linkedEvidenceIds: ["ev-behavioral-data", "ev-gap-salesforce"],
        assessment: "Gap",
        gapNature: "trainable_skill",
        nextStep:
          "Complete the synthetic CRM simulation to learn record search, call logging, and handoffs; frame honestly as clinical record accuracy + self-study.",
      };
    }
  }

  // 3. Check outbound calling / sales quota gap
  if (
    /outbound|cold call|sales quota|quota[\s-]carrying|\bbdr\b|\bsdr\b|prospecting|inside sales/i.test(
      lower
    )
  ) {
    return {
      id: `ra-${opportunityId}-${index}`,
      opportunityId,
      requirementText: reqText,
      priority,
      noraEvidenceSummary:
        "Skill gap (trainable): No established outbound calling or sales-quota history. Experience communicating with families and managing tutoring follow-ups.",
      linkedEvidenceIds: [
        "ev-family-comm",
        "ev-tutoring-scheduling",
        "ev-gap-outbound",
        "ev-gap-quota",
      ],
      assessment: "Gap",
      gapNature: "trainable_skill",
      nextStep:
        "Rehearse discovery call openers in Practice & Learn and clarify onboarding ramp/call volume expectations.",
    };
  }

  // 4. Check specific clinical / EHR software (distinguish lacking evidence vs lacking skill!)
  if (/rethinkbh|centralreach|ehr|emr|practice management software|clinical software/i.test(lower)) {
    if (!profile.littleLeavesSoftwareUsed.trim()) {
      return {
        id: `ra-${opportunityId}-${index}`,
        opportunityId,
        requirementText: reqText,
        priority,
        noraEvidenceSummary:
          "Lacking documented evidence (not necessarily lacking skill): Nora logged session data at Little Leaves, but has not yet recorded which clinical platform she used.",
        linkedEvidenceIds: ["ev-behavioral-data", "ev-little-leaves-software"],
        assessment: "Unknown",
        gapNature: "missing_evidence_check",
        nextStep:
          "Confirm the exact software used at Little Leaves in My Profile (do not assume RethinkBH).",
      };
    }
    return {
      id: `ra-${opportunityId}-${index}`,
      opportunityId,
      requirementText: reqText,
      priority,
      noraEvidenceSummary: `Used ${profile.littleLeavesSoftwareUsed} during ABA data collection and record maintenance at Little Leaves.`,
      linkedEvidenceIds: ["ev-behavioral-data"],
      assessment:
        /rethink/i.test(lower) && !/rethink/i.test(profile.littleLeavesSoftwareUsed)
          ? "Transferable evidence"
          : "Direct evidence",
      gapNature: "none",
      nextStep: `Reference hands-on clinical data entry in ${profile.littleLeavesSoftwareUsed} accurately.`,
    };
  }

  // 5. Direct ABA / Behavioral Health / Psychology Degree matches
  if (/\baba\b|applied behavior|behavioral health|autism|clinical|treatment plan/i.test(lower)) {
    return {
      id: `ra-${opportunityId}-${index}`,
      opportunityId,
      requirementText: reqText,
      priority,
      noraEvidenceSummary:
        "Direct experience as an RBT at Little Leaves Behavioral Services (Jan 2023–Jul 2024) implementing ABA plans under BCBA supervision.",
      linkedEvidenceIds: ["ev-little-leaves-aba", "ev-behavioral-data"],
      assessment: "Direct evidence",
      gapNature: "none",
      nextStep:
        "Highlight hands-on familiarity with clinic routines, data accuracy, and family collaboration.",
    };
  }

  if (/bachelor|degree|psychology|education/i.test(lower)) {
    return {
      id: `ra-${opportunityId}-${index}`,
      opportunityId,
      requirementText: reqText,
      priority,
      noraEvidenceSummary:
        "Bachelor’s degree in Psychology, George Mason University (December 2021).",
      linkedEvidenceIds: ["ev-gmu-psych"],
      assessment: "Direct evidence",
      gapNature: "none",
      nextStep: "List degree clearly in education section.",
    };
  }

  // 6. Transferable communication, scheduling, onboarding, training, customer service
  if (
    /communicat|client|customer|famil|schedul|coordinat|follow[\s-]up|train|coach|tutor|onboard|organi|data|record|documentation/i.test(
      lower
    )
  ) {
    const directData = /data|record|documentation/i.test(lower);
    const level: RequirementFitLevel = directData
      ? "Direct evidence"
      : "Transferable evidence";
    return {
      id: `ra-${opportunityId}-${index}`,
      opportunityId,
      requirementText: reqText,
      priority,
      noraEvidenceSummary: directData
        ? "Collected behavioral data and maintained structured client records at Little Leaves Behavioral Services."
        : "Communicated with families in ABA care and managed independent tutoring/coaching scheduling and follow-up.",
      linkedEvidenceIds: directData
        ? ["ev-behavioral-data"]
        : ["ev-family-comm", "ev-tutoring-scheduling"],
      assessment: level,
      gapNature: "none",
      nextStep:
        "Provide a specific, plain-English example from Little Leaves or tutoring without inventing volume metrics.",
    };
  }

  // 7. Multi-year corporate tenure checks (e.g., "3+ years of SaaS CSM experience")
  const yearsMatch = lower.match(/(\d+)\+?\s*years/);
  if (yearsMatch && Number(yearsMatch[1]) >= 3) {
    return {
      id: `ra-${opportunityId}-${index}`,
      opportunityId,
      requirementText: reqText,
      priority,
      noraEvidenceSummary: `Requests ${yearsMatch[1]}+ years of specialized experience; Nora has ~1.5 years at Little Leaves (Jan 2023–Jul 2024) plus independent tutoring.`,
      linkedEvidenceIds: ["ev-little-leaves-aba", "ev-tutoring-scheduling"],
      assessment: "Gap",
      gapNature: priority === "Required" ? "hard_eligibility" : "trainable_skill",
      nextStep:
        "Check whether the employer considers clinical + tutoring experience together or strictly filters for multi-year corporate tenure.",
    };
  }

  return {
    id: `ra-${opportunityId}-${index}`,
    opportunityId,
    requirementText: reqText,
    priority,
    noraEvidenceSummary:
      "Not yet mapped to a confirmed claim in your Evidence Library — review your full résumé to check whether you have supporting evidence.",
    linkedEvidenceIds: [],
    assessment: "Unknown",
    gapNature: "missing_evidence_check",
    nextStep:
      "Add a confirmed claim in My Profile if you have done this, or treat as a topic to clarify.",
  };
}

export function generateRequirementAssessments(
  opp: Opportunity,
  profile: Profile,
  evidence: Evidence[]
): RequirementAssessment[] {
  const results: RequirementAssessment[] = [];
  opp.requiredQualifications.forEach((req, idx) => {
    results.push(assessSingleRequirement(req, "Required", opp.id, idx + 1, profile, evidence));
  });
  opp.preferredQualifications.forEach((pref, idx) => {
    results.push(
      assessSingleRequirement(
        pref,
        "Preferred",
        opp.id,
        opp.requiredQualifications.length + idx + 1,
        profile,
        evidence
      )
    );
  });
  return results;
}

function parseLowestDollarFigure(text: string): number | null {
  if (!text.trim()) return null;
  const fullMatch = text.match(/\$(\d{2,3}(?:,\d{3})+)/);
  if (fullMatch) {
    return Number(fullMatch[1].replace(/,/g, ""));
  }
  const hourlyMatch = text.match(/\$(\d{2}(?:\.\d{1,2})?)\s*(?:\/hr|per\s*hour|hourly)/i);
  if (hourlyMatch) {
    return Math.round(Number(hourlyMatch[1]) * 2080);
  }
  return null;
}

export function evaluateOpportunityDecision(
  opp: Opportunity,
  assessments: RequirementAssessment[],
  profile: Profile,
  evidence: Evidence[]
): DecisionEvaluationReport {
  const c = profile.constraints;
  const noraContext = isNoraProfileContext(profile, evidence);
  const hardEligibilityIssues = assessments
    .filter((a) => a.gapNature === "hard_eligibility" && a.priority === "Required")
    .map((a) => a.requirementText);

  const trainableGaps = assessments
    .filter((a) => a.gapNature === "trainable_skill")
    .map((a) => a.requirementText);

  const missingEvidenceChecks = assessments
    .filter((a) => a.assessment === "Unknown")
    .map((a) => a.requirementText);

  const directOrTransferable = assessments.filter(
    (a) => a.assessment === "Direct evidence" || a.assessment === "Transferable evidence"
  );

  const evidenceUsed: string[] = [];
  const usedIds = new Set<string>();
  for (const a of directOrTransferable) {
    for (const eid of a.linkedEvidenceIds) {
      if (!usedIds.has(eid)) {
        usedIds.add(eid);
        const found = evidence.find((e) => e.id === eid);
        if (found) evidenceUsed.push(found.claimText);
      }
    }
  }
  if (evidenceUsed.length === 0) {
    if (noraContext) {
      evidenceUsed.push(
        "Bachelor’s degree in Psychology (GMU, Dec 2021) and Little Leaves RBT experience (Jan 2023–Jul 2024)."
      );
    } else if (profile.educationSummary.trim()) {
      evidenceUsed.push(profile.educationSummary.trim());
    } else {
      evidenceUsed.push(
        "No verified claims in your Evidence Library are linked to this opening yet."
      );
    }
  }

  const missingInformation: string[] = [];
  if (opp.openingAvailabilityStatus !== "Seen on official careers page") {
    missingInformation.push(
      "Current vacancy availability on the employer's official careers page."
    );
  }
  if (opp.appliedConfirmedByNora === "unconfirmed") {
    missingInformation.push(
      "Confirmation on whether an application has already been submitted."
    );
  }
  if (!opp.compensation.employerPublishedBase.trim()) {
    missingInformation.push("Employer-published guaranteed base salary or hourly pay.");
  }
  if (
    opp.compensation.employerPublishedVariable.trim() ||
    /bdr|business development|sales/i.test(opp.title)
  ) {
    if (
      !opp.compensation.employerPublishedBase.trim() ||
      !opp.compensation.variableAssumptionsNote.trim()
    ) {
      missingInformation.push(
        "Exact base-to-commission ratio, ramp period, and qualified-meeting definitions."
      );
    }
  }
  if (!opp.compensation.benefitsDocumented.trim()) {
    missingInformation.push("Documented health/retirement/PTO benefits.");
  }
  for (const m of missingEvidenceChecks) {
    missingInformation.push(`Unverified profile detail for requirement: "${m}"`);
  }

  // Evaluate compensation constraint gap
  const statedAnnualBase = parseLowestDollarFigure(opp.compensation.employerPublishedBase);
  let baseBelowConstraint = false;
  if (statedAnnualBase !== null && !c.minBaseSalaryUnsure && c.minBaseSalary !== null) {
    if (statedAnnualBase < c.minBaseSalary) {
      baseBelowConstraint = true;
    }
  }

  const isOutboundHeavy =
    assessments.some((a) => /outbound|cold call|prospecting/i.test(a.requirementText)) ||
    /outbound|cold call|daily calling/i.test(opp.rawDescriptionText);

  const avoidsOutbound = c.outboundCallingComfort === "avoid" && isOutboundHeavy;
  const avoidsCommission =
    c.commissionTolerance === "none_base_only" &&
    Boolean(
      opp.compensation.employerPublishedVariable.trim() ||
        /commission/i.test(opp.rawDescriptionText)
    );

  // Determine qualitative verdict (no fake percentages!)
  let verdict: FitRecommendationVerdict = "Clarify first";
  let reasoning = "";
  let suggestedNextAction = opp.nextAction || "Review missing details before applying.";

  if (hardEligibilityIssues.length > 0 || baseBelowConstraint || avoidsOutbound || avoidsCommission) {
    verdict = "Deprioritize";
    const reasons: string[] = [];
    if (hardEligibilityIssues.length > 0) {
      reasons.push(`Hard eligibility barrier(s): ${hardEligibilityIssues.join("; ")}`);
    }
    if (baseBelowConstraint && statedAnnualBase !== null && c.minBaseSalary !== null) {
      reasons.push(
        `Published base floor ($${statedAnnualBase.toLocaleString()}/yr) is below your minimum acceptable base ($${c.minBaseSalary.toLocaleString()}/yr)`
      );
    }
    if (avoidsOutbound) {
      reasons.push(
        "Role requires outbound calling, which conflicts with your 'Avoid outbound calling' constraint"
      );
    }
    if (avoidsCommission) {
      reasons.push(
        "Role involves variable commission, conflicting with your 'Base salary only' preference"
      );
    }
    reasoning = `${reasons.join(". ")}. Deprioritizing protects your time for roles that match your constraints and eligibility.`;
    suggestedNextAction =
      "Keep on file for reference only, or focus energy on salaried coordination, onboarding, or matching-base roles.";
  } else if (
    opp.openingAvailabilityStatus !== "Seen on official careers page" ||
    !opp.compensation.employerPublishedBase.trim() ||
    opp.appliedConfirmedByNora === "unconfirmed"
  ) {
    verdict = "Clarify first";
    reasoning = `You have ${directOrTransferable.length} mapped requirement(s) supported by your workspace evidence, but critical baseline facts remain unverified — specifically current posting availability, guaranteed base pay, or application status.`;
    suggestedNextAction =
      opp.nextAction ||
      "Verify the official employer posting, confirm whether you have applied, and establish the guaranteed base salary range.";
  } else if (trainableGaps.length >= 2) {
    verdict = "Prepare, then pursue";
    reasoning = `Your verified evidence supports core requirements, while ${trainableGaps.length} trainable gap(s) (${trainableGaps
      .map((g) => g.slice(0, 55))
      .join(
        "; "
      )}) benefit from targeted rehearsal before interviewing so you can address them honestly and confidently.`;
    suggestedNextAction =
      "Complete a targeted practice exercise and tailor your cover note around verified workspace evidence, then submit.";
  } else {
    verdict = "Pursue now";
    reasoning = `Confirmed profile evidence aligns directly or transferably with core requirements, the opening is verified on an official source, and documented base compensation does not conflict with your constraints.`;
    suggestedNextAction =
      "Prepare a truthful, tailored résumé version and cover note in the Application Workspace, verify all placeholders are resolved, and apply.";
  }

  const incomeReliability = opp.compensation.employerPublishedBase.trim()
    ? `Employer-published base: ${opp.compensation.employerPublishedBase}${
        opp.compensation.employerPublishedVariable.trim()
          ? ` | Variable component: ${opp.compensation.employerPublishedVariable} (treat variable pay as uncertain until ramp & attainment rates are verified).`
          : " (no variable commission noted)."
      }`
    : "Unknown — no employer-published base salary is recorded yet. Never assume third-party OTE estimates represent guaranteed income.";

  const benefits = opp.compensation.benefitsDocumented.trim()
    ? `Documented: ${opp.compensation.benefitsDocumented}`
    : `Undocumented in current record${
        c.benefitsRequirement === "essential"
          ? " (Note: You marked benefits as essential — confirm early)."
          : "."
      }`;

  const homeLocationLabel = profile.location.trim() || "your location";
  const scheduleAndLocationFit = `${opp.location || "Location unverified"} (${
    opp.workArrangement === "unknown" ? "arrangement unverified" : opp.workArrangement
  }). ${
    opp.commuteAndScheduleNotes || `Confirm commute from ${homeLocationLabel} and daily hours.`
  }`;

  const dayToDayWork =
    opp.coreDuties.length > 0
      ? opp.coreDuties.slice(0, 3).join("; ")
      : "Core daily workflow needs verification from the full official job description.";

  const trainingBurden =
    trainableGaps.length === 0
      ? "Low external skill gap — primarily employer-specific product/process onboarding."
      : `Moderate, focused preparation needed across ${trainableGaps.length} trainable area(s). ${opp.trainingProvidedInfo}`;

  const transferableCareerCapital = isOutboundHeavy
    ? "Builds B2B discovery, CRM pipeline management, and client market fluency — portable toward Account Executive, Partnerships, or Customer Success paths over 2–4 years (outcomes depend on performance and employer structure, never guaranteed)."
    : "Builds operational coordination, client onboarding, and multi-stakeholder communication — portable toward Implementation Manager, Operations Lead, or Customer Success roles over 2–4 years.";

  const advancementQuestions = [
    "What concrete responsibilities separate someone in year 1 of this role from someone promoted in years 2–3?",
    "Are promotion criteria documented in writing, and which roles have previous hires actually moved into?",
    ...(isOutboundHeavy
      ? [
          "What percentage of reps met quota over the past two quarters, and what does onboarding ramp look like in months 1–3?",
        ]
      : ["How is strong performance measured during the first 6–12 months?"]),
  ];

  const unresolvedRisks: string[] = [
    ...opp.authenticityFlags.map((f) => f.label),
    ...(baseBelowConstraint ? ["Published base pay sits below your target base floor."] : []),
    ...(trainableGaps.length > 0
      ? ["Requires honest framing of trainable gaps without overstating prior experience."]
      : []),
  ];

  return {
    verdict,
    evidenceUsed,
    missingInformation,
    reasoning,
    suggestedNextAction,
    hardEligibilityIssues,
    trainableGaps,
    evidenceVsSkillNote: noraContext
      ? "Lacking documented evidence (such as not yet recording which clinical software you used at Little Leaves) means a fact may already exist once verified. Definitely lacking a skill (such as having no prior Salesforce or sales-quota history) is a real gap to address honestly through beginner preparation rather than résumé exaggeration."
      : "Lacking documented evidence means a relevant detail from your past work has not yet been recorded in your Evidence Library. Definitely lacking a skill is a real gap to address honestly through preparation rather than résumé exaggeration.",
    factors: {
      incomeReliability,
      benefits,
      scheduleAndLocationFit,
      dayToDayWork,
      trainingBurden,
      transferableCareerCapital,
      advancementQuestions,
      unresolvedRisks:
        unresolvedRisks.length > 0
          ? unresolvedRisks
          : ["Confirm standard workload and manager expectations during interviews."],
    },
  };
}

export function detectEvidenceConflicts(profile: Profile, evidence: Evidence[]): string[] {
  const conflicts: string[] = [];

  const claimsActiveRbt = evidence.some(
    (e) =>
      e.mayUseInApplications &&
      /active rbt|currently certified rbt|current rbt certification/i.test(e.claimText)
  );
  if (claimsActiveRbt && profile.rbtCertificationStatus !== "active") {
    conflicts.push(
      "Conflict detected: An evidence item marked usable in applications mentions active RBT certification, while your Profile marks RBT certification status as unverified or inactive. Clarify which is accurate."
    );
  }

  const claimsSalesforceWork = evidence.some(
    (e) =>
      e.category === "demonstrated_skill" &&
      e.mayUseInApplications &&
      /\bsalesforce\b/i.test(e.claimText)
  );
  const stillHasNoSalesforceGap = evidence.some(
    (e) => e.category === "not_yet_demonstrated" && /\bsalesforce\b/i.test(e.claimText)
  );
  if (claimsSalesforceWork && stillHasNoSalesforceGap) {
    conflicts.push(
      "Conflict detected: 'Salesforce' appears both as a demonstrated skill usable in applications and under 'Skills not yet demonstrated'. Please clarify whether you have workplace Salesforce experience or beginner training only."
    );
  }

  const claimsRethinkUsed = evidence.some(
    (e) => e.mayUseInApplications && /used rethinkbh|rethinkbh user/i.test(e.claimText)
  );
  if (claimsRethinkUsed && !/rethink/i.test(profile.littleLeavesSoftwareUsed)) {
    conflicts.push(
      "Conflict detected: An evidence claim states RethinkBH usage, but clinical software in your Profile does not confirm RethinkBH."
    );
  }

  return conflicts;
}

export interface LocalDraftBundle {
  tailoredResumeText: string;
  coverNoteText: string;
  whyThisRoleText: string;
  applicationQuestionsText: string;
  interviewTalkingPoints: string;
  evidenceUsed: string[];
  missingInformation: string[];
  reasoning: string;
  suggestedNextAction: string;
}

export function buildTruthfulApplicationBundle(
  opp: Opportunity,
  profile: Profile,
  evidence: Evidence[]
): LocalDraftBundle {
  const usable = evidence.filter(
    (e) =>
      e.mayUseInApplications &&
      e.category !== "not_yet_demonstrated" &&
      (e.verificationStatus === "Confirmed by Nora" ||
        e.verificationStatus === "Supported by uploaded document")
  );
  const noraContext = isNoraProfileContext(profile, evidence);

  // Strict multi-user isolation: non-Nora workspaces build drafts strictly from their own profile & evidence
  if (!noraContext) {
    const ownerName = profile.fullName.trim() || "[PLACEHOLDER: Your Full Name]";
    const ownerLocation = profile.location.trim() || "[PLACEHOLDER: City, State]";
    const ownerEducation =
      profile.educationSummary.trim() ||
      "[PLACEHOLDER: Add verified education or credentials in My Profile]";
    const bulletLines =
      usable.length > 0
        ? usable.map((u) => `- ${u.claimText}`)
        : [
            "- [PLACEHOLDER: Add verified experience claims in My Profile > Evidence Library before exporting]",
          ];

    const tailoredResumeText = [
      ownerName.toUpperCase(),
      ownerLocation,
      "[PLACEHOLDER: Your preferred phone & email]",
      "",
      `TARGET ROLE: ${opp.title} — ${opp.employer}`,
      "",
      "VERIFIED EXPERIENCE & STRENGTHS",
      ...bulletLines,
      "",
      "EDUCATION & CREDENTIALS",
      ownerEducation,
    ].join("\n");

    const topClaimsSentence =
      usable.length > 0
        ? `My background includes ${usable
            .slice(0, 2)
            .map((u) => u.claimText)
            .join("; ")}.`
        : "I am currently assembling verified experience highlights in my workspace [PLACEHOLDER: Insert 1–2 concrete accomplishments from your work history].";

    const coverNoteText = [
      `Dear [PLACEHOLDER: Hiring Manager Name or ${opp.employer} Hiring Team],`,
      "",
      `I am writing to express my interest in the ${opp.title} opening at ${opp.employer}. ${topClaimsSentence}`,
      "",
      `I value clear communication, reliable follow-through, and honest preparation, and would welcome the opportunity to discuss how my background aligns with ${opp.employer}'s needs.`,
      "",
      "Sincerely,",
      ownerName,
    ].join("\n");

    const whyThisRoleText = `I am interested in the ${opp.title} role at ${opp.employer} because it aligns with my verified strengths and long-term career goals. [PLACEHOLDER: Add 1 sentence connecting a specific responsibility from ${opp.employer}'s posting to your experience.]`;

    const applicationQuestionsText = [
      "Q: Describe your relevant experience for this role.",
      usable.length > 0
        ? `A: ${usable.map((u) => u.claimText).join(" ")}`
        : "A: [PLACEHOLDER: Add verified experience claims in My Profile so they can be cited accurately here.]",
    ].join("\n");

    const interviewTalkingPoints = [
      "- Ground every answer in verified examples from your Evidence Library.",
      "- Address any skill gaps directly and calmly without overstating prior tools or tenure.",
      "- Ask about guaranteed base pay, benefits, onboarding expectations, and 2–4 year advancement paths.",
    ].join("\n");

    const missingInformation: string[] = [
      "Replace [PLACEHOLDER: ...] brackets with verified details before exporting.",
    ];
    if (usable.length === 0) {
      missingInformation.push(
        "No verified claims marked 'May be used in external applications' were found in your Evidence Library yet."
      );
    }

    return {
      tailoredResumeText,
      coverNoteText,
      whyThisRoleText,
      applicationQuestionsText,
      interviewTalkingPoints,
      evidenceUsed: usable.map((u) => u.claimText),
      missingInformation,
      reasoning:
        "Drafts use strictly the signed-in workspace owner's verified profile and Evidence Library claims, inserting explicit placeholders where details are not yet recorded.",
      suggestedNextAction:
        "Review every sentence in the editor below, resolve any [PLACEHOLDER] tags, and save a numbered version before submitting.",
    };
  }

  const hasSalesforceRequirement = [
    ...opp.requiredQualifications,
    ...opp.preferredQualifications,
  ].some((q) => /salesforce|crm/i.test(q));
  const hasOutboundRequirement = [
    ...opp.requiredQualifications,
    ...opp.preferredQualifications,
  ].some((q) => /outbound|calling|prospecting|bdr/i.test(q));

  const softwareLine = profile.littleLeavesSoftwareUsed.trim()
    ? `- Recorded daily behavioral session data using ${profile.littleLeavesSoftwareUsed} and maintained organized client records.`
    : `- Collected behavioral session data and maintained structured client records. [PLACEHOLDER: Optional — specify software used at Little Leaves once verified]`;

  const tailoredResumeText = [
    profile.fullName.toUpperCase(),
    profile.location,
    "[PLACEHOLDER: Your preferred phone & email]",
    "",
    `TARGET ROLE: ${opp.title} — ${opp.employer}`,
    "",
    "SUMMARY",
    `Psychology graduate (George Mason University) with hands-on Applied Behavior Analysis (ABA) service delivery at Little Leaves Behavioral Services and independent tutoring/coaching experience. Brings structured record maintenance, clear communication with families and supervising clinicians, and dependable follow-through.`,
    "",
    "RELEVANT EXPERIENCE",
    "Little Leaves Behavioral Services | Registered Behavior Technician | January 2023 – July 2024",
    "- Implemented individualized ABA treatment plans under Board Certified Behavior Analyst (BCBA) supervision.",
    softwareLine,
    "- Communicated clearly with families regarding daily progress, expectations, and session coordination.",
    "",
    "Independent Tutoring & Coaching",
    "- Delivered one-on-one tutoring and coaching tailored to individual learner goals.",
    "- Managed scheduling, reminders, and consistent follow-up with families and students.",
    "",
    "EDUCATION",
    profile.educationSummary,
  ].join("\n");

  const gapHonestySentence =
    hasSalesforceRequirement || hasOutboundRequirement
      ? "While my background is rooted in clinical ABA service delivery and tutoring coordination rather than quota-carrying sales or workplace Salesforce administration, I am accustomed to structured daily documentation, clear follow-up, and learning new workflows methodically."
      : "My experience maintaining accurate records under BCBA supervision and coordinating independent tutoring schedules translates directly to organized, reliable execution in this role.";

  const coverNoteText = [
    `Dear [PLACEHOLDER: Hiring Manager Name or ${opp.employer} Hiring Team],`,
    "",
    `I am writing to express my interest in the ${opp.title} opening at ${opp.employer}. Having worked directly in ABA service delivery as a Registered Behavior Technician at Little Leaves Behavioral Services after completing my Psychology degree at George Mason University, I understand firsthand how important clear communication, accurate documentation, and reliable tools are for clinical teams and families.`,
    "",
    `At Little Leaves (January 2023 – July 2024), I implemented ABA treatment plans under BCBA supervision, collected behavioral data, and communicated regularly with families. Alongside my clinical work, I have coordinated scheduling and ongoing follow-up through independent tutoring and coaching. ${gapHonestySentence}`,
    "",
    `Thank you for considering my application. I would welcome the opportunity to discuss how my background and preparation align with ${opp.employer}'s needs.`,
    "",
    "Sincerely,",
    profile.fullName,
  ].join("\n");

  const whyThisRoleText = [
    `Working as an RBT at Little Leaves Behavioral Services gave me a grounded view of daily clinic realities — how BCBAs, technicians, and families rely on organized systems and clear communication. I am looking for a role at ${opp.employer} where that practical context is useful every day, while building long-term operational and client-facing skills.`,
    hasSalesforceRequirement
      ? "I have been building foundational familiarity with CRM prospect-tracking workflows so I can pair my clinical documentation habits with structured pipeline hygiene from day one."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const applicationQuestionsText = [
    "Q: Describe your relevant experience with our industry or workflows.",
    `A: From January 2023 to July 2024, I worked at Little Leaves Behavioral Services implementing ABA treatment plans under BCBA supervision, collecting behavioral session data, and communicating with families. I also hold a Bachelor’s degree in Psychology from George Mason University (December 2021) and manage scheduling and follow-up in independent tutoring.`,
    "",
    hasSalesforceRequirement
      ? [
          "Q: Do you have prior Salesforce or CRM experience?",
          "A: I have not used Salesforce in a prior paid role. In my RBT work I maintained structured session data and client records daily, and I have been completing introductory CRM workflow practice covering account search, call logging, follow-up tasks, and handoff notes.",
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const interviewTalkingPoints = [
    "- Lead with concrete clinic empathy: you know what a busy BCBA or clinic coordinator's afternoon actually looks like.",
    "- Connect behavioral data accuracy + tutoring follow-up to reliable scheduling and documentation.",
    hasSalesforceRequirement
      ? "- Be straightforward about Salesforce: state clearly that you have not used it professionally yet, then share how you practiced record hygiene, logging discovery notes, and preparing clean handoffs."
      : "- Ask what software tools the team uses day to day and how new hires ramp during the first 30–60 days.",
    "- Ask your compensation & growth questions: guaranteed base pay, benefits, training structure, and how strong performers advance over 2–4 years.",
  ].join("\n");

  const missingInformation: string[] = [
    "Replace [PLACEHOLDER: ...] brackets with verified recipient/contact details before exporting.",
  ];
  if (!profile.littleLeavesSoftwareUsed.trim()) {
    missingInformation.push(
      "Exact software used at Little Leaves is still unverified and omitted from definitive claims."
    );
  }
  if (profile.rbtCertificationStatus === "unverified") {
    missingInformation.push(
      "Current RBT certification status is unverified, so active certification is not claimed."
    );
  }

  return {
    tailoredResumeText,
    coverNoteText,
    whyThisRoleText,
    applicationQuestionsText,
    interviewTalkingPoints,
    evidenceUsed: usable.map((u) => u.claimText),
    missingInformation,
    reasoning:
      "Drafts use only confirmed claims marked usable in applications. Missing Salesforce and outbound quota history are acknowledged honestly rather than disguised, and training/practice is never presented as paid work experience.",
    suggestedNextAction:
      "Review every sentence in the editor below, resolve any [PLACEHOLDER] tags, and save a numbered version before submitting.",
  };
}

export interface DraftAuditResult {
  unresolvedPlaceholders: string[];
  newlyIntroducedWarnings: string[];
}

export function auditDraftClaimsAndPlaceholders(
  combinedText: string,
  profile: Profile,
  evidence: Evidence[]
): DraftAuditResult {
  const placeholderMatches =
    combinedText.match(/\[PLACEHOLDER:[^\]]*\]|\[[^\]]*TBD[^\]]*\]/gi) ?? [];
  const unresolvedPlaceholders = Array.from(new Set(placeholderMatches));

  const newlyIntroducedWarnings: string[] = [];
  const lower = combinedText.toLowerCase();

  // Check for unverified Salesforce experience claims
  const hasVerifiedSalesforce = evidence.some(
    (e) =>
      e.category === "demonstrated_skill" &&
      e.mayUseInApplications &&
      /salesforce/i.test(e.claimText)
  );
  if (
    !hasVerifiedSalesforce &&
    /\b(\d+\s*years?\s*(of\s*)?salesforce|proficient in salesforce|experienced salesforce user|managed salesforce pipeline)\b/i.test(
      lower
    )
  ) {
    newlyIntroducedWarnings.push(
      "Draft appears to claim workplace Salesforce proficiency, which is not confirmed in your Evidence Library."
    );
  }

  // Check for active RBT claim when unverified/inactive
  if (
    profile.rbtCertificationStatus !== "active" &&
    /\b(active rbt|currently certified rbt|licensed rbt)\b/i.test(lower)
  ) {
    newlyIntroducedWarnings.push(
      "Draft mentions an active RBT credential, but your Profile lists RBT certification status as unverified or inactive."
    );
  }

  // Check for unverified RethinkBH software usage claim
  if (
    !/rethink/i.test(profile.littleLeavesSoftwareUsed) &&
    /\b(used rethinkbh|experienced with rethinkbh|rethinkbh power user)\b/i.test(lower)
  ) {
    newlyIntroducedWarnings.push(
      "Draft implies prior hands-on RethinkBH software usage, which has not been verified in your Profile."
    );
  }

  // Check for newly introduced percentage/metric claims not in Evidence Library
  const numberClaims =
    combinedText.match(
      /\b\d{1,3}%\b|\$\d[\d,]*|\b\d{2,}\+?\s*(clients|patients|students|calls per day|quota)/gi
    ) ?? [];
  const allConfirmedText = evidence
    .filter((e) => e.mayUseInApplications)
    .map((e) => e.claimText.toLowerCase())
    .join(" ");

  for (const metric of numberClaims) {
    if (!allConfirmedText.includes(metric.toLowerCase())) {
      newlyIntroducedWarnings.push(
        `Newly introduced numeric claim detected ("${metric}") — confirm this exact figure comes from a verified source and is not an estimate.`
      );
    }
  }

  return {
    unresolvedPlaceholders,
    newlyIntroducedWarnings: Array.from(new Set(newlyIntroducedWarnings)),
  };
}

export function buildOutreachDraftLocally(
  messageType: OutreachMessageType,
  contact: { name: string; organization: string; role: string; relationship: string },
  opportunity: Opportunity | undefined,
  profile: Profile,
  evidence?: Evidence[]
): {
  bodyText: string;
  evidenceUsed: string[];
  missingInformation: string[];
  reasoning: string;
  suggestedNextAction: string;
} {
  const firstName = contact.name.trim().split(/\s+/)[0] || "[PLACEHOLDER: First Name]";
  const org =
    contact.organization.trim() ||
    opportunity?.employer ||
    "[PLACEHOLDER: Organization]";
  const roleMention = opportunity
    ? `the ${opportunity.title} role at ${opportunity.employer}`
    : `roles at ${org}`;
  const senderName = profile.fullName.trim() || "[PLACEHOLDER: Your Name]";
  const noraContext = isNoraProfileContext(profile, evidence);

  if (!noraContext) {
    const usableClaims = (evidence || []).filter(
      (e) => e.mayUseInApplications && e.category !== "not_yet_demonstrated"
    );
    const backgroundSnippet = usableClaims[0]?.claimText
      ? usableClaims[0].claimText
      : profile.educationSummary.trim() ||
        "[PLACEHOLDER: Brief summary of your verified background]";

    let bodyText = "";
    switch (messageType) {
      case "Connection request":
        bodyText = `Hi ${firstName} — I’m exploring ${org}’s work (${backgroundSnippet}) and would appreciate connecting here.`;
        break;
      case "Informational interview request":
        bodyText = `Hi ${firstName},\n\nI’m researching ${org} and learning more about ${
          contact.role || "your team's work"
        }. For context on my background: ${backgroundSnippet}.\n\nWould you be open to a brief 15-minute call in the next couple of weeks to share what day-to-day work looks like on your team? No pressure at all if your schedule is full.\n\nThank you,\n${senderName}`;
        break;
      case "Referral request":
        bodyText = `Hi ${firstName},\n\nThank you again for ${
          contact.relationship || "connecting and sharing your perspective"
        }. After reviewing ${roleMention} carefully against my verified experience, I plan to apply this week.\n\nIf you feel comfortable based on what you know of my background, would it make sense for me to mention our conversation or ask how referrals work at ${org}? Completely understand if not.\n\nBest,\n${senderName}`;
        break;
      case "Recruiter message":
        bodyText = `Hi ${firstName},\n\nI’m reaching out regarding ${roleMention}. For quick context: ${backgroundSnippet}.\n\nCould you share whether this opening is currently active and confirm the base salary range? Happy to send my résumé.\n\nThank you,\n${senderName}`;
        break;
      case "Follow-up":
        bodyText = `Hi ${firstName},\n\nFollowing up briefly on my note from [PLACEHOLDER: Date of prior message] regarding ${roleMention}. I remain very interested in ${org} and am glad to share any additional details about my background if helpful.\n\nBest regards,\n${senderName}`;
        break;
      case "Thank-you note":
        bodyText = `Hi ${firstName},\n\nThank you for taking the time to speak with me today about ${roleMention}. Hearing more about [PLACEHOLDER: Specific topic discussed] helped clarify what day-to-day success looks like on the team.\n\nPlease let me know if any follow-up information would be useful.\n\nBest,\n${senderName}`;
        break;
    }

    return {
      bodyText,
      evidenceUsed: [
        ...(usableClaims[0] ? [usableClaims[0].claimText] : []),
        `Contact context: ${contact.name} (${contact.role || "role unverified"} at ${org})`,
      ],
      missingInformation: [
        "Verify recipient's current role and preferred channel (never guess personal email addresses).",
        ...(bodyText.includes("[PLACEHOLDER:")
          ? ["Resolve [PLACEHOLDER] bracket before copying or sending."]
          : []),
      ],
      reasoning:
        "Uses concise, plain English grounded strictly in your own workspace profile and verified evidence without assuming hiring authority or exaggerating experience.",
      suggestedNextAction:
        "Edit the message so it sounds like your voice, check the recipient & content approval box, and send manually through your chosen channel.",
    };
  }

  let bodyText = "";
  switch (messageType) {
    case "Connection request":
      bodyText = `Hi ${firstName} — I’m a George Mason Psychology alum in Northern Virginia with an ABA background at Little Leaves Behavioral Services. I’m exploring ${org}’s work and would appreciate connecting here.`;
      break;
    case "Informational interview request":
      bodyText = `Hi ${firstName},\n\nI’m a GMU Psychology graduate in Oakton who worked as an RBT at Little Leaves Behavioral Services (2023–2024), and I’m exploring how clinicians transition into operations, onboarding, and business development roles at organizations like ${org}.\n\nSince you work as ${
        contact.role || "part of the team"
      } at ${org}, would you be open to a brief 15-minute phone call in the next couple of weeks to share what day-to-day work looks like on your team? No pressure at all if your schedule is full.\n\nThank you,\n${senderName}`;
      break;
    case "Referral request":
      bodyText = `Hi ${firstName},\n\nThank you again for ${
        contact.relationship || "connecting and sharing your perspective"
      }. After reviewing ${roleMention} carefully against my ABA clinic and tutoring coordination background, I plan to apply this week.\n\nIf you feel comfortable based on what you know of my background, would it make sense for me to mention our conversation or ask how referrals work at ${org}? Completely understand if not.\n\nBest,\n${senderName}`;
      break;
    case "Recruiter message":
      bodyText = `Hi ${firstName},\n\nI’m reaching out regarding ${roleMention}. I hold a BA in Psychology from George Mason University and worked from Jan 2023 to Jul 2024 as an RBT at Little Leaves Behavioral Services implementing ABA plans, maintaining behavioral data, and communicating with families.\n\nCould you share whether this opening is currently active and eligible from Northern Virginia, along with the base salary range? Happy to send my résumé.\n\nThank you,\n${senderName}`;
      break;
    case "Follow-up":
      bodyText = `Hi ${firstName},\n\nFollowing up briefly on my note from [PLACEHOLDER: Date of prior message] regarding ${roleMention}. I remain very interested in ${org} and am glad to share any additional details about my ABA and scheduling coordination background if helpful.\n\nBest regards,\n${senderName}`;
      break;
    case "Thank-you note":
      bodyText = `Hi ${firstName},\n\nThank you for taking the time to speak with me today about ${roleMention}. Hearing more about [PLACEHOLDER: Specific topic discussed] helped clarify what day-to-day success looks like on the team, and reinforced how my ABA documentation and family communication background would contribute.\n\nPlease let me know if any follow-up information would be useful.\n\nBest,\n${senderName}`;
      break;
  }

  return {
    bodyText,
    evidenceUsed: [
      "Psychology bachelor’s degree, George Mason University (Dec 2021)",
      "Registered Behavior Technician at Little Leaves Behavioral Services (Jan 2023–Jul 2024)",
      `Contact context: ${contact.name} (${contact.role || "role unverified"} at ${org})`,
    ],
    missingInformation: [
      "Verify recipient's current role and preferred channel (never guess personal email addresses).",
      ...(bodyText.includes("[PLACEHOLDER:")
        ? ["Resolve [PLACEHOLDER] bracket before copying or sending."]
        : []),
    ],
    reasoning:
      "Uses concise, plain English grounded in genuine common ground (GMU / Northern Virginia / ABA clinic experience) without assuming hiring authority or exaggerating experience.",
    suggestedNextAction:
      "Edit the message so it sounds like your voice, check the recipient & content approval box, and send manually through your chosen channel.",
  };
}

export function evaluatePracticeResponseLocally(
  mode: PracticeMode,
  promptQuestion: string,
  responseText: string,
  profile: Profile,
  evidence?: Evidence[]
): PracticeFeedback {
  const words = responseText.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const lower = responseText.toLowerCase();
  const noraContext = isNoraProfileContext(profile, evidence);
  const usableEvidence = (evidence || []).filter(
    (e) => e.mayUseInApplications && e.category !== "not_yet_demonstrated"
  );

  const unsupportedClaims: string[] = [];
  if (
    profile.rbtCertificationStatus !== "active" &&
    /\b(i am a certified rbt|my active rbt|currently licensed rbt)\b/i.test(lower)
  ) {
    unsupportedClaims.push(
      "Mentions active/current RBT certification — confirm your current credential status in My Profile before stating it in the present tense."
    );
  }
  const hasVerifiedSalesforce = usableEvidence.some(
    (e) => /salesforce/i.test(e.claimText) && e.category === "demonstrated_skill"
  );
  if (
    !hasVerifiedSalesforce &&
    /\b(used salesforce at|years of salesforce|managed a salesforce pipeline)\b/i.test(
      lower
    )
  ) {
    unsupportedClaims.push(
      "Implies prior workplace Salesforce experience not recorded in your Evidence Library. Frame CRM preparation honestly."
    );
  }
  const hasVerifiedQuota = usableEvidence.some(
    (e) => /quota|outbound/i.test(e.claimText) && e.category === "demonstrated_skill"
  );
  if (
    !hasVerifiedQuota &&
    /\b(exceeded quota|hit 1\d\d% of quota|cold called \d+ prospects)\b/i.test(lower)
  ) {
    unsupportedClaims.push(
      "Includes sales quota or outbound volume claims not supported by your Evidence Library."
    );
  }

  const mentionsConcreteEvidence = noraContext
    ? /little leaves|aba|bcba|george mason|gmu|psychology|tutor|families|behavioral data/i.test(
        lower
      )
    : usableEvidence.some((ev) =>
        findMatchingUserEvidence(responseText, [ev]).length > 0
      ) || wordCount >= 45;

  const concision =
    mode === "intro_45s"
      ? wordCount >= 75 && wordCount <= 135
        ? `Well-paced (${wordCount} words — roughly 35–55 seconds spoken calmly).`
        : wordCount < 75
        ? `Quite brief (${wordCount} words). Aim for ~90–120 words to cover your verified background, transferable strengths, and what you are targeting next.`
        : `A bit long for a 45-second opener (${wordCount} words). Trim extra background details to stay near 95–125 words.`
      : wordCount < 40
      ? `Short (${wordCount} words) — consider adding one specific situation and outcome from your verified work history.`
      : wordCount > 240
      ? `Detailed (${wordCount} words) — tighten the opening sentence so your main point lands in the first 15 seconds.`
      : `Good spoken length (${wordCount} words).`;

  return {
    accuracy:
      unsupportedClaims.length === 0
        ? "Stays faithful to your verified background without overstating certifications or unverified tool history."
        : `Review ${unsupportedClaims.length} flagged statement(s) below to keep every claim 100% accurate.`,
    relevance: mentionsConcreteEvidence
      ? `Directly connects your background to the prompt ("${promptQuestion.slice(0, 70)}...").`
      : "Addresses the prompt generally, but could connect more explicitly to concrete examples from your verified experience.",
    clarity: /\b(synergy|rockstar|guru|crush quota|passionate hustler)\b/i.test(lower)
      ? "Contains recruiting/sales clichés — replace with calm, plain English."
      : "Clear, natural plain-English tone.",
    specificExamples: mentionsConcreteEvidence
      ? "Includes grounded context from your verified background."
      : "Add one specific, non-confidential example from your Evidence Library.",
    concision,
    unsupportedClaims,
    evidenceUsed: noraContext
      ? [
          "Little Leaves Behavioral Services RBT experience (Jan 2023–Jul 2024)",
          "BA in Psychology, George Mason University (Dec 2021)",
          "Independent tutoring & coaching scheduling/follow-up",
        ]
      : usableEvidence.slice(0, 3).map((e) => e.claimText),
    missingInformation:
      noraContext && !profile.littleLeavesSoftwareUsed.trim()
        ? [
            "Adding the specific clinical software you used at Little Leaves will make software-transition answers even stronger.",
          ]
        : !noraContext && usableEvidence.length === 0
        ? [
            "Adding verified experience items in My Profile > Evidence Library will allow coaching feedback to reference your exact background.",
          ]
        : [],
    reasoning:
      "Evaluated against your confirmed Evidence Library and known development areas to ensure clarity, specificity, and strict factual honesty.",
    suggestedNextAction:
      unsupportedClaims.length > 0
        ? "Revise the flagged phrasing and run feedback once more."
        : "Read your answer aloud once to check natural breathing pace, then save this session.",
    revisedExample:
      mode === "intro_45s" && noraContext
        ? "I graduated from George Mason University with a degree in Psychology and spent a year and a half as a Registered Behavior Technician at Little Leaves Behavioral Services. Day to day, I implemented ABA treatment plans under BCBA supervision, recorded structured behavioral data, and communicated closely with families, alongside managing scheduling and follow-up in independent tutoring. Because I know firsthand how clinics balance client care and administrative coordination, I’m looking to bring that domain context and organized follow-through into a team supporting behavioral health or education providers."
        : undefined,
  };
}
