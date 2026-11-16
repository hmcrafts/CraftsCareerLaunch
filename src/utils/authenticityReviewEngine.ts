import type {
  AuthenticityDimension,
  AuthenticityDimensionState,
  AuthenticityOverallStatus,
  AuthenticityReview,
  AuthenticityUserDecision,
  DimensionAssessmentSummary,
  ImpersonationConfirmationEvidence,
  Opportunity,
  ReviewArtifact,
  RiskFinding,
  RiskFindingResolution,
  RiskFindingSeverity,
  VerificationCheck,
  WorkspaceState,
} from "../types/models.ts";

export const FORBIDDEN_SAFETY_LABELS = [
  "verified safe",
  "guaranteed legitimate",
  "ai fraud probability",
] as const;

export const OVERALL_STATUS_LABELS: Record<AuthenticityOverallStatus, string> = {
  not_reviewed: "Not reviewed",
  partially_corroborated: "Partially corroborated",
  unresolved_concerns: "Unresolved concerns",
  high_risk_request_detected: "High-risk request detected",
  corroborated_within_stated_scope: "Corroborated within stated scope",
  documented_impersonation_confirmation: "Documented impersonation confirmation",
};

export const DIMENSION_LABELS: Record<AuthenticityDimension, string> = {
  employer_identity: "Employer identity",
  opening_authenticity: "Opening authenticity",
  recruiter_affiliation: "Claimed recruiter affiliation",
  sender_channel_authenticity: "Sender / channel authenticity",
  requested_action: "Requested action",
};

export const DIMENSION_STATE_LABELS: Record<AuthenticityDimensionState, string> = {
  unchecked: "Not checked yet",
  corroborated: "Corroborated in scope",
  unconfirmed: "Unconfirmed",
  concern_or_conflict: "Concern or conflict",
  high_risk: "High-risk request",
};

export const USER_DECISION_LABELS: Record<AuthenticityUserDecision, string> = {
  undecided: "Undecided — still reviewing",
  proceed_within_scope: "Proceed within verified channels only",
  pause_until_verified: "Pause — verify open questions before replying",
  decline_and_disengage: "Decline / stop engagement",
};

const KNOWN_EXTERNAL_ATS_HOSTS: Array<{ hostSuffix: string; platformName: string }> = [
  { hostSuffix: "greenhouse.io", platformName: "Greenhouse" },
  { hostSuffix: "lever.co", platformName: "Lever" },
  { hostSuffix: "myworkdayjobs.com", platformName: "Workday" },
  { hostSuffix: "workday.com", platformName: "Workday" },
  { hostSuffix: "icims.com", platformName: "iCIMS" },
  { hostSuffix: "ashbyhq.com", platformName: "Ashby" },
  { hostSuffix: "smartrecruiters.com", platformName: "SmartRecruiters" },
  { hostSuffix: "bamboohr.com", platformName: "BambooHR" },
  { hostSuffix: "jobvite.com", platformName: "Jobvite" },
  { hostSuffix: "ultipro.com", platformName: "UKG / UltiPro" },
  { hostSuffix: "ukg.net", platformName: "UKG" },
  { hostSuffix: "paylocity.com", platformName: "Paylocity" },
  { hostSuffix: "adp.com", platformName: "ADP Recruiting" },
];

const FREE_WEBMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "mail.com",
  "gmx.com",
]);

export function extractRegistrableDomain(rawUrlOrEmail: string): string {
  const trimmed = String(rawUrlOrEmail || "").trim().toLowerCase();
  if (!trimmed) return "";

  let host = "";
  if (trimmed.includes("@") && !trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    const emailMatch = trimmed.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
    host = emailMatch ? emailMatch[1].toLowerCase() : "";
  } else {
    try {
      const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const parsed = new URL(candidate);
      host = parsed.hostname.toLowerCase();
    } catch {
      host = "";
    }
  }

  if (!host) return "";
  const cleaned = host.replace(/^www\./, "");
  const parts = cleaned.split(".").filter(Boolean);
  if (parts.length <= 2) return cleaned;

  // Handle common multi-part public suffixes (.co.uk, .org.uk, .com.au)
  const lastTwo = parts.slice(-2).join(".");
  if (["co.uk", "org.uk", "com.au", "co.nz", "org.au"].includes(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

export function extractFullHostname(rawUrlOrEmail: string): string {
  const trimmed = String(rawUrlOrEmail || "").trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.includes("@") && !trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    const emailMatch = trimmed.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
    return emailMatch ? emailMatch[1].toLowerCase() : "";
  }
  try {
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function detectExternalAtsPlatform(urlOrHost: string): {
  isExternalAts: boolean;
  platformName: string;
  hostname: string;
} {
  const hostname = extractFullHostname(urlOrHost);
  if (!hostname) {
    return { isExternalAts: false, platformName: "", hostname: "" };
  }
  for (const entry of KNOWN_EXTERNAL_ATS_HOSTS) {
    if (hostname === entry.hostSuffix || hostname.endsWith(`.${entry.hostSuffix}`)) {
      return {
        isExternalAts: true,
        platformName: entry.platformName,
        hostname,
      };
    }
  }
  return { isExternalAts: false, platformName: "", hostname };
}

export function assertNoForbiddenSafetyLabels(text: string): {
  clean: boolean;
  violatingLabel: string | null;
} {
  const lower = String(text || "").toLowerCase();
  for (const forbidden of FORBIDDEN_SAFETY_LABELS) {
    if (lower.includes(forbidden)) {
      return { clean: false, violatingLabel: forbidden };
    }
  }
  return { clean: true, violatingLabel: null };
}

export function scrubForbiddenSafetyPhrases(text: string): string {
  let out = String(text || "");
  out = out.replace(/verified\s+safe/gi, "reviewed within stated scope");
  out = out.replace(/guaranteed\s+legitimate/gi, "corroborated within stated scope");
  out = out.replace(/ai\s+fraud\s+probability/gi, "pattern review note");
  out = out.replace(/\bfraud\s+probability\b/gi, "pattern review note");
  return out;
}

/**
 * Prompts users to redact sensitive personal, banking, or credential strings before storing evidence.
 * Never asks for passwords, banking credentials, authentication codes, or full identity documents.
 */
export function detectUnredactedSensitivePatterns(rawText: string): string[] {
  const text = String(rawText || "");
  if (!text.trim()) return [];
  const warnings: string[] = [];

  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) {
    warnings.push(
      "Possible Social Security Number format (XXX-XX-XXXX) detected — replace digits with [REDACTED-SSN] before saving."
    );
  }
  if (/\b(?:\d[ -]*?){13,19}\b/.test(text)) {
    warnings.push(
      "Long numeric sequence (13–19 digits, such as a card or account number) detected — redact account or card digits before saving."
    );
  }
  if (
    /\b(?:routing\s*number|account\s*number|iban|swift)\s*[:#-]?\s*[0-9a-z]{6,}/i.test(text)
  ) {
    warnings.push(
      "Possible bank routing or account number detected — redact banking numbers before saving."
    );
  }
  if (
    /\b(?:password|passcode|otp|verification\s*code|2fa\s*code|security\s*code)\s*[:=]\s*\S+/i.test(
      text
    )
  ) {
    warnings.push(
      "Possible password or one-time authentication code detected — never store or share credentials or authentication codes."
    );
  }
  return warnings;
}

export function createDefaultVerificationChecklist(params?: {
  employerName?: string;
  officialDomain?: string;
}): VerificationCheck[] {
  const empLabel = params?.employerName?.trim() || "the stated employer";
  const domainHint = params?.officialDomain?.trim()
    ? ` (${params.officialDomain.trim()})`
    : "";

  return [
    {
      id: "chk-employer-identity",
      dimension: "employer_identity",
      question: `Does ${empLabel} operate an established, independently verifiable official website${domainHint} and physical/organizational presence?`,
      status: "not_started",
      outcome: "not_evaluated",
      method: "Navigate directly to the employer's official website (not via links inside an unsolicited message).",
      evidenceArtifactIds: [],
      notes: "",
      datePerformed: "",
    },
    {
      id: "chk-opening-authenticity",
      dimension: "opening_authenticity",
      question: `Is this specific opening currently listed on ${empLabel}'s official careers page or an external applicant portal linked directly from that careers page?`,
      status: "not_started",
      outcome: "not_evaluated",
      method: "Open the employer's official careers page and search for the exact job title and location.",
      evidenceArtifactIds: [],
      notes: "",
      datePerformed: "",
    },
    {
      id: "chk-recruiter-affiliation",
      dimension: "recruiter_affiliation",
      question: `If a recruiter or hiring contact reached out, is their current affiliation with ${empLabel} corroborated through an official employer channel?`,
      status: "not_started",
      outcome: "not_evaluated",
      method: "Confirm via the employer's official HR/careers contact address or verified corporate portal — a public profile claim alone is not proof.",
      evidenceArtifactIds: [],
      notes: "",
      datePerformed: "",
    },
    {
      id: "chk-sender-channel",
      dimension: "sender_channel_authenticity",
      question: `Do all sender email domains, message channels, and application URLs match ${empLabel}'s official domain or their verified applicant tracking system?`,
      status: "not_started",
      outcome: "not_evaluated",
      method: "Inspect the exact sender domain character-by-character for lookalike domains, free webmail, or unverified chat apps.",
      evidenceArtifactIds: [],
      notes: "",
      datePerformed: "",
    },
    {
      id: "chk-requested-action",
      dimension: "requested_action",
      question:
        "Are the requested next steps limited to standard job-application actions (no fees, check deposits, crypto transfers, authentication codes, or pre-offer banking/ID requests)?",
      status: "not_started",
      outcome: "not_evaluated",
      method: "Review every action the sender or portal asks you to take before proceeding.",
      evidenceArtifactIds: [],
      notes: "",
      datePerformed: "",
    },
  ];
}

function buildExcerptSnippet(fullText: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - 55);
  const end = Math.min(fullText.length, matchIndex + matchLength + 95);
  const slice = fullText.slice(start, end).replace(/\s+/g, " ").trim();
  const prefix = start > 0 ? "..." : "";
  const suffix = end < fullText.length ? "..." : "";
  return `${prefix}${slice}${suffix}`.slice(0, 280);
}

/**
 * Runs deterministic, transparent safety rules over supplied artifacts.
 * Separates observed behavior (fact) from interpretation, cites the exact artifact & excerpt,
 * and never accuses legitimate ATS platforms of fraud.
 */
export function runDeterministicArtifactRules(params: {
  artifacts: ReviewArtifact[];
  officialEmployerDomain: string;
  subjectLabel: string;
}): RiskFinding[] {
  const { artifacts, officialEmployerDomain } = params;
  const normalizedOfficialDomain = extractRegistrableDomain(officialEmployerDomain);
  const findings: RiskFinding[] = [];
  const seenRuleArtifactPairs = new Set<string>();

  const pushFinding = (item: Omit<RiskFinding, "id" | "userResolution" | "userResolutionExplanation" | "resolvedAtIso">) => {
    const dedupeKey = `${item.ruleKey}::${item.supportingArtifactId}`;
    if (seenRuleArtifactPairs.has(dedupeKey)) return;
    seenRuleArtifactPairs.add(dedupeKey);
    findings.push({
      ...item,
      id: `fnd-${item.ruleKey}-${item.supportingArtifactId}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 110),
      observedBehavior: scrubForbiddenSafetyPhrases(item.observedBehavior).slice(0, 600),
      interpretation: scrubForbiddenSafetyPhrases(item.interpretation).slice(0, 600),
      supportingExcerpt: item.supportingExcerpt.slice(0, 350),
      recommendedAction: scrubForbiddenSafetyPhrases(item.recommendedAction).slice(0, 500),
      userResolution: "active",
      userResolutionExplanation: "",
      resolvedAtIso: "",
    });
  };

  for (const artifact of artifacts) {
    const combinedText = [
      artifact.title,
      artifact.sourceProvenance,
      artifact.senderAddress,
      artifact.targetUrl,
      artifact.contentExcerpt,
    ]
      .filter(Boolean)
      .join("\n");

    // ------------------------------------------------------------------------
    // 1. HIGH-RISK REQUEST RULES (stop_and_verify on requested_action)
    // ------------------------------------------------------------------------

    // Rule 1A: Equipment check + forward/wire/vendor payment instructions
    const checkMatch = combinedText.match(
      /\b(?:check|cheque|e-?check|mobile\s+deposit|cashier'?s\s+check)\b[\s\S]{0,160}\b(?:equipment|laptop|home\s+office|software|supplies|vendor|forward|send\s+back|wire|zelle|venmo|cash\s*app|gift\s*card)\b|\b(?:equipment|laptop|vendor)\b[\s\S]{0,160}\b(?:deposit\s+(?:the|a)\s+check|e-?check|mobile\s+deposit|forward\s+(?:the\s+)?funds|pay\s+our\s+(?:approved\s+)?vendor)\b/i
    );
    if (checkMatch && checkMatch.index !== undefined) {
      pushFinding({
        ruleKey: "high_risk_equipment_check_forward_funds",
        dimension: "requested_action",
        category: "Equipment check / fund-forwarding request",
        severity: "stop_and_verify",
        observedBehavior:
          "The supplied material describes receiving or depositing a check for equipment/supplies and forwarding or paying funds to a third party or vendor.",
        interpretation:
          "Depositing a check and sending money onward exposes you to personal financial loss if the check later reverses as counterfeit, even after funds appear available.",
        supportingArtifactId: artifact.id,
        supportingExcerpt: buildExcerptSnippet(combinedText, checkMatch.index, checkMatch[0].length),
        basis: "deterministic_rule",
        recommendedAction:
          "Stop and do not deposit any check or transfer funds. Legitimate employers purchase and ship required equipment directly or reimburse documented expenses after verified onboarding.",
      });
    }

    // Rule 1B: Task earnings / optimization requiring cryptocurrency deposit or wallet top-up
    const cryptoTaskMatch = combinedText.match(
      /\b(?:crypto(?:currency)?|usdt|tether|bitcoin|btc|eth(?:ereum)?|wallet\s+(?:balance|top-?up|deposit|address))\b[\s\S]{0,180}\b(?:task|commission|withdraw|unlock|earnings|workbench|optimization|recharge|negative\s+balance|deposit)\b|\b(?:task\s+earnings|unlock\s+(?:your\s+)?(?:earnings|withdrawal)|complete\s+\d+\s+tasks|optimization\s+tasks)\b[\s\S]{0,180}\b(?:deposit|usdt|crypto|wallet|top\s*up|recharge)\b/i
    );
    if (cryptoTaskMatch && cryptoTaskMatch.index !== undefined) {
      pushFinding({
        ruleKey: "high_risk_crypto_task_deposit",
        dimension: "requested_action",
        category: "Cryptocurrency deposit required for task earnings",
        severity: "stop_and_verify",
        observedBehavior:
          "The supplied material links job tasks, commissions, or withdrawals to depositing cryptocurrency (such as USDT/BTC/ETH) or topping up a wallet.",
        interpretation:
          "Legitimate employment pays wages rather than requiring workers to deposit cryptocurrency to unlock tasks or withdraw earnings.",
        supportingArtifactId: artifact.id,
        supportingExcerpt: buildExcerptSnippet(
          combinedText,
          cryptoTaskMatch.index,
          cryptoTaskMatch[0].length
        ),
        basis: "deterministic_rule",
        recommendedAction:
          "Do not send cryptocurrency, connect a wallet, or deposit funds to unlock earnings. Disengage until independently checked.",
      });
    }

    // Rule 1C: Upfront fee / wire / gift cards / peer-to-peer payment request
    const sendMoneyMatch = combinedText.match(
      /\b(?:application\s+fee|training\s+fee|background\s+check\s+fee|security\s+deposit|processing\s+fee|purchase\s+gift\s+cards?|apple\s+gift\s+card|steam\s+card|wire\s+transfer\s+of\s+\$|\bsend\s+\$\d+|\bpay\s+\$\d+\s+(?:to\s+start|for\s+training|for\s+onboarding|via\s+(?:zelle|venmo|cash\s*app|paypal\s+friends)))\b/i
    );
    if (sendMoneyMatch && sendMoneyMatch.index !== undefined) {
      pushFinding({
        ruleKey: "high_risk_send_money_or_fee",
        dimension: "requested_action",
        category: "Request to send money, fees, or gift cards",
        severity: "stop_and_verify",
        observedBehavior:
          "The supplied material asks the applicant to pay an upfront fee, send money, or purchase gift cards.",
        interpretation:
          "Requests for applicants to pay fees or send money during recruiting are a high-risk warning sign that requires immediate pause.",
        supportingArtifactId: artifact.id,
        supportingExcerpt: buildExcerptSnippet(
          combinedText,
          sendMoneyMatch.index,
          sendMoneyMatch[0].length
        ),
        basis: "deterministic_rule",
        recommendedAction:
          "Do not send money, pay upfront fees, or buy gift cards. Verify directly through the employer's main public contact page before taking any further step.",
      });
    }

    // Rule 1D: Request for authentication codes, passwords, bank login, or pre-offer SSN/ID
    const authOrIdMatch = combinedText.match(
      /\b(?:send\s+(?:me|us)\s+(?:the\s+)?(?:verification|authentication|2fa|otp|6-digit)\s+code|id\.me\s+(?:login|password|code)|online\s+banking\s+(?:username|login|password)|provide\s+your\s+(?:full\s+)?(?:ssn|social\s+security\s+number|bank\s+login|passport\s+scan|driver'?s\s+license\s+front\s+and\s+back)\s+(?:before\s+(?:interview|applying)|to\s+schedule\s+your\s+interview|in\s+your\s+reply))\b/i
    );
    if (authOrIdMatch && authOrIdMatch.index !== undefined) {
      pushFinding({
        ruleKey: "high_risk_auth_code_or_preoffer_identity",
        dimension: "requested_action",
        category: "Request for authentication codes, login credentials, or early identity/banking data",
        severity: "stop_and_verify",
        observedBehavior:
          "The supplied material asks for an authentication/verification code, account login credentials, or sensitive identity/banking documents prior to a verified hiring stage.",
        interpretation:
          "Sharing verification codes, login credentials, or early identity documents can enable account takeover or identity misuse.",
        supportingArtifactId: artifact.id,
        supportingExcerpt: buildExcerptSnippet(
          combinedText,
          authOrIdMatch.index,
          authOrIdMatch[0].length
        ),
        basis: "deterministic_rule",
        recommendedAction:
          "Never share authentication codes, passwords, or banking logins. Withhold government ID and tax forms until you have verified the employer, opening, and written offer through official channels.",
      });
    }

    // ------------------------------------------------------------------------
    // 2. EXTERNAL ATS / RECRUITMENT PLATFORM CHECK (informational, NOT fraud)
    // ------------------------------------------------------------------------
    const urlCandidate = artifact.targetUrl || artifact.sourceProvenance;
    const atsDetection = detectExternalAtsPlatform(urlCandidate);
    if (atsDetection.isExternalAts) {
      pushFinding({
        ruleKey: "info_external_ats_platform",
        dimension: "opening_authenticity",
        category: `External recruitment platform (${atsDetection.platformName})`,
        severity: "informational",
        observedBehavior: `The posting or application URL is hosted on ${atsDetection.hostname} (${atsDetection.platformName}), which is a third-party applicant tracking system rather than the employer's primary corporate domain.`,
        interpretation: `Many legitimate employers use ${atsDetection.platformName} to host job postings and applications. Using an external ATS is normal, though anyone can verify whether this specific board belongs to the employer by starting from the employer's official website.`,
        supportingArtifactId: artifact.id,
        supportingExcerpt: (artifact.targetUrl || artifact.sourceProvenance).slice(0, 260),
        basis: "deterministic_rule",
        recommendedAction: `Open the employer's official website independently, visit their Careers page, and confirm that their job listings link to this ${atsDetection.platformName} board.`,
      });
    }

    // ------------------------------------------------------------------------
    // 3. SENDER / CHANNEL DOMAIN & MESSAGING CHECKS (caution)
    // ------------------------------------------------------------------------
    if (artifact.senderAddress.trim()) {
      const senderHost = extractFullHostname(artifact.senderAddress);
      const senderRegDomain = extractRegistrableDomain(artifact.senderAddress);

      if (senderRegDomain && FREE_WEBMAIL_DOMAINS.has(senderRegDomain)) {
        pushFinding({
          ruleKey: "caution_free_webmail_sender",
          dimension: "sender_channel_authenticity",
          category: "Free webmail sender address",
          severity: "caution",
          observedBehavior: `The sender email address (${artifact.senderAddress.trim()}) uses a public webmail domain (${senderRegDomain}) rather than a verified organizational domain.`,
          interpretation:
            "Anyone can register a free webmail account bearing an employer's or recruiter's name. Even if the named employer and person are real, this address alone does not establish that the message came from them.",
          supportingArtifactId: artifact.id,
          supportingExcerpt: `Sender: ${artifact.senderAddress.trim()}`,
          basis: "deterministic_rule",
          recommendedAction:
            "Do not rely on this email address as proof of affiliation. Contact the organization through an email address or form listed on its official website to ask whether they sent this outreach.",
        });
      } else if (
        senderRegDomain &&
        normalizedOfficialDomain &&
        senderRegDomain !== normalizedOfficialDomain
      ) {
        const senderAts = detectExternalAtsPlatform(senderHost);
        if (!senderAts.isExternalAts) {
          pushFinding({
            ruleKey: "caution_sender_domain_mismatch",
            dimension: "sender_channel_authenticity",
            category: "Sender domain differs from official employer domain",
            severity: "caution",
            observedBehavior: `The sender address domain (${senderHost}) does not match the stated official employer domain (${normalizedOfficialDomain}).`,
            interpretation:
              "This could be a lookalike domain used for impersonation, or an external staffing agency whose relationship with the employer has not yet been corroborated.",
            supportingArtifactId: artifact.id,
            supportingExcerpt: `Sender: ${artifact.senderAddress.trim()} vs. official domain: ${normalizedOfficialDomain}`,
            basis: "deterministic_rule",
            recommendedAction:
              "Compare every letter of the domain carefully and confirm through the employer's official careers or HR contact page whether this domain is authorized to recruit for them.",
          });
        }
      }
    }

    // Unverified encrypted/chat-only interview channel
    const chatChannelMatch = combinedText.match(
      /\b(?:text-?only\s+interview|interview\s+(?:via|on|through)\s+(?:telegram|whatsapp|signal|wire\s+app|icq|google\s+chat)|contact\s+(?:our\s+)?(?:hiring\s+manager|hr)\s+on\s+(?:telegram|whatsapp|signal))\b/i
    );
    if (chatChannelMatch && chatChannelMatch.index !== undefined) {
      pushFinding({
        ruleKey: "caution_chat_app_interview_channel",
        dimension: "sender_channel_authenticity",
        category: "Chat-app or text-only interview request",
        severity: "caution",
        observedBehavior:
          "The supplied material directs the candidate to conduct an interview or hiring check over Telegram, WhatsApp, Signal, or a text-only chat channel.",
        interpretation:
          "Off-domain chat channels make it difficult to verify who is on the other end and are frequently used when impersonating real employers or recruiters.",
        supportingArtifactId: artifact.id,
        supportingExcerpt: buildExcerptSnippet(
          combinedText,
          chatChannelMatch.index,
          chatChannelMatch[0].length
        ),
        basis: "deterministic_rule",
        recommendedAction:
          "Ask to communicate via a verified corporate email address from the employer's official domain and confirm the opening on the employer's official careers page before continuing.",
      });
    }

    // ------------------------------------------------------------------------
    // 4. MISSING OR EXPIRED POSTING CHECKS (caution on opening_authenticity)
    // ------------------------------------------------------------------------
    const expiredMatch = combinedText.match(
      /\b(?:404\s+not\s+found|page\s+not\s+found|job\s+(?:is\s+)?no\s+longer\s+(?:available|open|listed|active)|no\s+longer\s+accepting\s+applications|this\s+(?:position|requisition|job)\s+has\s+(?:been\s+filled|expired|closed)|posting\s+(?:expired|removed))\b/i
    );
    if (
      artifact.httpStatus === 404 ||
      artifact.httpStatus === 410 ||
      (expiredMatch && expiredMatch.index !== undefined)
    ) {
      const excerpt =
        artifact.httpStatus === 404 || artifact.httpStatus === 410
          ? `HTTP ${artifact.httpStatus} returned for ${artifact.targetUrl || artifact.sourceProvenance}`
          : buildExcerptSnippet(combinedText, expiredMatch!.index!, expiredMatch![0].length);

      pushFinding({
        ruleKey: "caution_missing_or_expired_posting",
        dimension: "opening_authenticity",
        category: "Missing, closed, or expired job posting",
        severity: "caution",
        observedBehavior:
          artifact.httpStatus === 404 || artifact.httpStatus === 410
            ? `Retrieving the supplied posting URL returned HTTP ${artifact.httpStatus} (not found or removed).`
            : "The supplied posting page or note indicates the job is closed, expired, or no longer accepting applications.",
        interpretation:
          "An active vacancy has not been corroborated. Either the role recently closed, the link is outdated, or an outreach message is referencing a nonexistent or closed opening.",
        supportingArtifactId: artifact.id,
        supportingExcerpt: excerpt,
        basis: "deterministic_rule",
        recommendedAction:
          "Search the employer's official careers page directly to see if an active requisition exists before investing time in an application or sharing personal details.",
      });
    }

    // ------------------------------------------------------------------------
    // 5. EXPLICIT CONFLICT / IMPERSONATION NOTICE IN OFFICIAL SOURCE (caution)
    // ------------------------------------------------------------------------
    const conflictNoticeMatch = combinedText.match(
      /\b(?:no\s+open\s+(?:remote\s+)?(?:positions|roles|vacancies)|not\s+currently\s+hiring|beware\s+of\s+(?:recruiting|job)\s+(?:scams|impersonators|fraud)|we\s+never\s+(?:conduct\s+interviews\s+via|recruit\s+through|ask\s+for\s+money|use\s+gmail)|does\s+not\s+employ\s+anyone\s+by\s+that\s+name)\b/i
    );
    if (conflictNoticeMatch && conflictNoticeMatch.index !== undefined) {
      pushFinding({
        ruleKey: "caution_conflicting_official_statement",
        dimension: "opening_authenticity",
        category: "Conflicting statement or recruiting warning in supplied evidence",
        severity: "caution",
        observedBehavior:
          "A supplied source contains a statement about no open roles, unauthorized recruiting channels, or recruiting impersonation.",
        interpretation:
          "This directly conflicts with claims of an active opening or authorized outreach unless resolved through direct verification with the employer.",
        supportingArtifactId: artifact.id,
        supportingExcerpt: buildExcerptSnippet(
          combinedText,
          conflictNoticeMatch.index,
          conflictNoticeMatch[0].length
        ),
        basis: "deterministic_rule",
        recommendedAction:
          "Compare this statement against any outreach you received and pause engagement unless confirmed directly via the employer's official careers contact.",
      });
    }
  }

  return findings;
}

export interface RawAiCandidateFinding {
  dimension?: string;
  category?: string;
  severity?: string;
  observedBehavior?: string;
  interpretation?: string;
  supportingArtifactId?: string;
  supportingExcerpt?: string;
  recommendedAction?: string;
}

const VALID_DIMENSIONS = new Set<AuthenticityDimension>([
  "employer_identity",
  "opening_authenticity",
  "recruiter_affiliation",
  "sender_channel_authenticity",
  "requested_action",
]);

const UNSUPPORTED_CERTAINTY_OR_ACCUSATION_PATTERNS = [
  /\bverified\s+safe\b/i,
  /\bguaranteed\s+legitimate\b/i,
  /\bfraud\s+probability\b/i,
  /\b\d{1,3}%\s*(?:scam|fraud|legitimate|safe)\b/i,
  /\bdefinitely\s+(?:a\s+)?(?:scam|fraud|fraudulent|criminal)\b/i,
  /\bcertified\s+(?:safe|legitimate)\b/i,
  /\bconfirmed\s+(?:scammer|criminal|fraudster)\b/i,
];

function normalizeForSubstringCheck(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Guardrail for AI-generated suggestions:
 * - Forces basis = "ai_suggestion" (never adjudicated fact).
 * - Rejects any candidate finding that lacks a valid supportingArtifactId in the workspace review.
 * - Rejects any candidate finding whose supportingExcerpt is empty (< 8 chars) or not grounded in the cited artifact's text/provenance.
 * - Rejects any candidate finding that fails to separate observedBehavior and interpretation or uses banned fraud-probability / certainty accusations.
 */
export function sanitizeAndFilterAiSuggestedFindings(
  rawCandidates: RawAiCandidateFinding[],
  artifacts: ReviewArtifact[]
): {
  acceptedFindings: RiskFinding[];
  rejectedCount: number;
} {
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    return { acceptedFindings: [], rejectedCount: 0 };
  }

  const artifactMap = new Map<string, ReviewArtifact>();
  for (const a of artifacts) {
    artifactMap.set(a.id, a);
  }

  const acceptedFindings: RiskFinding[] = [];
  let rejectedCount = 0;

  for (let i = 0; i < rawCandidates.length; i++) {
    const c = rawCandidates[i];
    if (!c || typeof c !== "object") {
      rejectedCount++;
      continue;
    }

    const artifactId = String(c.supportingArtifactId || "").trim();
    const artifact = artifactMap.get(artifactId);
    if (!artifact) {
      rejectedCount++;
      continue;
    }

    const excerpt = String(c.supportingExcerpt || "").trim();
    if (excerpt.length < 8) {
      rejectedCount++;
      continue;
    }

    const artifactCorpus = normalizeForSubstringCheck(
      [
        artifact.title,
        artifact.sourceProvenance,
        artifact.senderAddress,
        artifact.targetUrl,
        artifact.contentExcerpt,
      ].join(" ")
    );
    const normalizedExcerpt = normalizeForSubstringCheck(excerpt);
    if (!artifactCorpus.includes(normalizedExcerpt)) {
      rejectedCount++;
      continue;
    }

    const observed = String(c.observedBehavior || "").trim();
    const interp = String(c.interpretation || "").trim();
    const category = String(c.category || "").trim();
    const recAction = String(c.recommendedAction || "").trim();

    if (!observed || !interp || !category || observed.toLowerCase() === interp.toLowerCase()) {
      rejectedCount++;
      continue;
    }

    const combinedCandidateText = `${category} ${observed} ${interp} ${recAction}`;
    if (UNSUPPORTED_CERTAINTY_OR_ACCUSATION_PATTERNS.some((rx) => rx.test(combinedCandidateText))) {
      rejectedCount++;
      continue;
    }

    const dim: AuthenticityDimension = VALID_DIMENSIONS.has(c.dimension as AuthenticityDimension)
      ? (c.dimension as AuthenticityDimension)
      : "opening_authenticity";

    const sev: RiskFindingSeverity =
      c.severity === "stop_and_verify" || c.severity === "caution" || c.severity === "informational"
        ? c.severity
        : "caution";

    acceptedFindings.push({
      id: `fnd-ai-${i + 1}-${artifactId}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 110),
      ruleKey: `ai_pattern_${i + 1}`,
      dimension: dim,
      category: scrubForbiddenSafetyPhrases(category).slice(0, 160),
      severity: sev,
      observedBehavior: scrubForbiddenSafetyPhrases(observed).slice(0, 600),
      interpretation: scrubForbiddenSafetyPhrases(interp).slice(0, 600),
      supportingArtifactId: artifactId,
      supportingExcerpt: excerpt.slice(0, 350),
      basis: "ai_suggestion",
      recommendedAction: scrubForbiddenSafetyPhrases(
        recAction || "Verify this item directly through the employer's official website before acting."
      ).slice(0, 500),
      userResolution: "active",
      userResolutionExplanation: "",
      resolvedAtIso: "",
    });
  }

  return { acceptedFindings, rejectedCount };
}

export function isValidImpersonationConfirmation(
  conf: ImpersonationConfirmationEvidence | null | undefined,
  artifacts: ReviewArtifact[]
): boolean {
  if (!conf) return false;
  const who = String(conf.confirmedByIdentity || "").trim();
  const how = String(conf.identityEstablishmentMethod || "").trim();
  const artId = String(conf.supportingArtifactId || "").trim();
  if (who.length < 3 || how.length < 5 || !artId) return false;
  return artifacts.some((a) => a.id === artId);
}

/**
 * Evaluates all five authenticity & safety dimensions strictly independently.
 * Confirming employer_identity NEVER marks opening_authenticity, recruiter_affiliation,
 * sender_channel_authenticity, or requested_action as corroborated.
 */
export function assessFiveDimensionsSeparately(params: {
  checks: VerificationCheck[];
  findings: RiskFinding[];
  artifacts: ReviewArtifact[];
}): Record<AuthenticityDimension, DimensionAssessmentSummary> {
  const { checks, findings, artifacts } = params;
  const activeFindings = findings.filter((f) => f.userResolution === "active");

  const dimensions: AuthenticityDimension[] = [
    "employer_identity",
    "opening_authenticity",
    "recruiter_affiliation",
    "sender_channel_authenticity",
    "requested_action",
  ];

  const result = {} as Record<AuthenticityDimension, DimensionAssessmentSummary>;

  for (const dim of dimensions) {
    const dimChecks = checks.filter((c) => c.dimension === dim);
    const dimFindings = activeFindings.filter((f) => f.dimension === dim);

    const hasStopFinding = dimFindings.some((f) => f.severity === "stop_and_verify");
    const hasCautionFinding = dimFindings.some((f) => f.severity === "caution");
    const hasInfoFinding = dimFindings.some((f) => f.severity === "informational");

    const hasConflictCheck = dimChecks.some(
      (c) => c.status === "completed" && c.outcome === "conflict_or_missing"
    );
    const hasCorroboratedCheck = dimChecks.some(
      (c) => c.status === "completed" && c.outcome === "corroborated"
    );
    const hasInconclusiveOrUnavailableCheck = dimChecks.some(
      (c) =>
        c.status === "inconclusive" ||
        c.status === "unavailable" ||
        (c.status === "completed" && c.outcome === "inconclusive")
    );

    let state: AuthenticityDimensionState = "unchecked";
    let summary = "Not checked yet.";

    if (hasStopFinding) {
      state = "high_risk";
      summary = `High-risk pattern detected (${dimFindings.filter((f) => f.severity === "stop_and_verify").length} item) — pause and verify before acting.`;
    } else if (hasCautionFinding || hasConflictCheck) {
      state = "concern_or_conflict";
      if (hasCautionFinding && hasConflictCheck) {
        summary = "Unresolved concern in supplied evidence and a conflict/missing check recorded.";
      } else if (hasConflictCheck) {
        summary = "Manual verification recorded a conflict or missing confirmation on this dimension.";
      } else {
        summary = `Caution flag raised (${dimFindings.filter((f) => f.severity === "caution").length} active item) — requires independent verification.`;
      }
    } else if (hasCorroboratedCheck && !hasInconclusiveOrUnavailableCheck) {
      state = "corroborated";
      summary = hasInfoFinding
        ? "Corroborated within your stated check scope (includes informational platform note)."
        : "Corroborated within your stated check scope.";
    } else if (hasInconclusiveOrUnavailableCheck || (artifacts.length > 0 && hasInfoFinding)) {
      state = "unconfirmed";
      summary = hasInfoFinding
        ? "Noted in supplied artifacts (informational) — still needs manual check completion."
        : "Checked, but remains inconclusive or unavailable.";
    } else if (artifacts.length > 0) {
      state = "unconfirmed";
      summary = "Artifacts supplied, but this specific dimension has not been corroborated yet.";
    }

    result[dim] = {
      dimension: dim,
      label: DIMENSION_LABELS[dim],
      state,
      summary,
    };
  }

  return result;
}

/**
 * Computes strictly one of the 6 allowed overall statuses without ever certifying
 * anyone "Verified safe" or "Guaranteed legitimate".
 */
export function computeAuthenticityOverallStatus(params: {
  dimensionAssessments: Record<AuthenticityDimension, DimensionAssessmentSummary>;
  findings: RiskFinding[];
  artifacts: ReviewArtifact[];
  checks: VerificationCheck[];
  impersonationConfirmation: ImpersonationConfirmationEvidence | null;
}): AuthenticityOverallStatus {
  const { dimensionAssessments, findings, artifacts, checks, impersonationConfirmation } = params;
  const activeFindings = findings.filter((f) => f.userResolution === "active");

  // 1. High-risk request takes immediate priority if any active stop_and_verify finding exists
  if (activeFindings.some((f) => f.severity === "stop_and_verify")) {
    return "high_risk_request_detected";
  }

  // 2. Documented impersonation confirmation ONLY if who + how identity was established + valid artifact exist
  if (
    impersonationConfirmation &&
    isValidImpersonationConfirmation(impersonationConfirmation, artifacts)
  ) {
    return "documented_impersonation_confirmation";
  }

  const dims = Object.values(dimensionAssessments);
  const anyStartedCheck = checks.some((c) => c.status !== "not_started");

  if (artifacts.length === 0 && !anyStartedCheck && activeFindings.length === 0) {
    return "not_reviewed";
  }

  // 3. Any concern/conflict across the 5 dimensions or incomplete impersonation report -> unresolved_concerns
  const hasIncompleteImpersonationClaim =
    impersonationConfirmation !== null &&
    !isValidImpersonationConfirmation(impersonationConfirmation, artifacts);

  if (
    hasIncompleteImpersonationClaim ||
    dims.some((d) => d.state === "concern_or_conflict" || d.state === "high_risk")
  ) {
    return "unresolved_concerns";
  }

  // 4. Corroborated within stated scope ONLY when ALL 5 dimensions are independently corroborated
  if (dims.every((d) => d.state === "corroborated")) {
    return "corroborated_within_stated_scope";
  }

  // 5. Partially corroborated if at least one dimension is corroborated while others remain unconfirmed/unchecked
  if (dims.some((d) => d.state === "corroborated")) {
    return "partially_corroborated";
  }

  // 6. If artifacts or inconclusive checks exist with zero corroboration yet -> unresolved_concerns if checks were inconclusive, else partially_corroborated/unresolved_concerns
  if (
    checks.some((c) => c.status === "inconclusive" || c.status === "unavailable") ||
    artifacts.length > 0
  ) {
    return "unresolved_concerns";
  }

  return "not_reviewed";
}

export function deriveTransparencyLists(params: {
  dimensionAssessments: Record<AuthenticityDimension, DimensionAssessmentSummary>;
  checks: VerificationCheck[];
  findings: RiskFinding[];
  artifacts: ReviewArtifact[];
  impersonationConfirmation: ImpersonationConfirmationEvidence | null;
  liveResearchStatus: AuthenticityReview["liveResearchStatus"];
}): {
  whatWasChecked: string[];
  whatRemainsUnknown: string[];
  nextVerificationSteps: string[];
} {
  const {
    dimensionAssessments,
    checks,
    findings,
    artifacts,
    impersonationConfirmation,
    liveResearchStatus,
  } = params;

  const whatWasChecked: string[] = [];
  const whatRemainsUnknown: string[] = [];
  const nextVerificationSteps: string[] = [];

  if (artifacts.length > 0) {
    whatWasChecked.push(
      `Evaluated ${artifacts.length} supplied artifact(s) (${artifacts.map((a) => a.type).join(", ")}) against deterministic safety and channel rules.`
    );
  } else {
    whatRemainsUnknown.push("No message text, posting URL, or document has been attached yet.");
    nextVerificationSteps.push(
      "Add the job posting URL, recruiter message, or sender address you want to evaluate (redacting any private numbers first)."
    );
  }

  for (const chk of checks) {
    if (chk.status === "completed") {
      whatWasChecked.push(
        `${DIMENSION_LABELS[chk.dimension]}: ${
          chk.outcome === "corroborated"
            ? "Corroborated manually"
            : chk.outcome === "conflict_or_missing"
            ? "Conflict or missing confirmation recorded"
            : "Reviewed (inconclusive)"
        }${chk.notes ? ` — ${chk.notes.slice(0, 120)}` : ""}`
      );
    } else if (chk.status === "inconclusive" || chk.status === "unavailable") {
      whatWasChecked.push(
        `${DIMENSION_LABELS[chk.dimension]}: Attempted check (${chk.status}).`
      );
    }
  }

  if (liveResearchStatus === "unavailable") {
    whatRemainsUnknown.push(
      "Live verification unavailable — analysis covers only the artifacts and manual checks you recorded here."
    );
  }

  for (const dim of Object.values(dimensionAssessments)) {
    if (dim.state === "unchecked" || dim.state === "unconfirmed") {
      whatRemainsUnknown.push(
        `${dim.label} is not yet corroborated (confirming another dimension does not confirm ${dim.label.toLowerCase()}).`
      );
    } else if (dim.state === "concern_or_conflict") {
      whatRemainsUnknown.push(
        `${dim.label} has an unresolved concern or conflicting evidence.`
      );
    }
  }

  if (
    impersonationConfirmation &&
    !isValidImpersonationConfirmation(impersonationConfirmation, artifacts)
  ) {
    whatRemainsUnknown.push(
      "Impersonation report is missing documented proof of who confirmed it, how their identity was established, or a linked artifact."
    );
    nextVerificationSteps.push(
      "To record Documented impersonation confirmation, attach the official confirmation artifact and document both who confirmed it and how you established their identity."
    );
  }

  const activeFindings = findings.filter((f) => f.userResolution === "active");
  for (const f of activeFindings) {
    if (nextVerificationSteps.length < 6 && f.recommendedAction) {
      nextVerificationSteps.push(f.recommendedAction);
    }
  }

  for (const chk of checks) {
    if (chk.status !== "completed" && nextVerificationSteps.length < 6) {
      nextVerificationSteps.push(`${DIMENSION_LABELS[chk.dimension]}: ${chk.method}`);
    }
  }

  return {
    whatWasChecked: whatWasChecked.slice(0, 12),
    whatRemainsUnknown: whatRemainsUnknown.slice(0, 12),
    nextVerificationSteps: Array.from(new Set(nextVerificationSteps)).slice(0, 8),
  };
}

export function createInitialAuthenticityReview(params: {
  id?: string;
  userId: string;
  opportunity?: Opportunity | null;
  subjectLabel?: string;
  officialEmployerDomain?: string;
  nowIso?: string;
}): AuthenticityReview {
  const nowIso = params.nowIso || new Date().toISOString();
  const opp = params.opportunity || null;
  const employerLabel = opp
    ? `${opp.employer} — ${opp.title}`
    : (params.subjectLabel || "").trim() || "Standalone Recruiting / Posting Review";
  const officialDomain = opp?.officialWebsite
    ? extractRegistrableDomain(opp.officialWebsite)
    : extractRegistrableDomain(params.officialEmployerDomain || "");

  const initialArtifacts: ReviewArtifact[] = [];
  if (opp) {
    if (opp.postingUrl.trim()) {
      initialArtifacts.push({
        id: `art-opp-url-${opp.id}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 90),
        type: "url",
        title: "Opportunity Posting URL",
        sourceProvenance: opp.intakeChannel || "Saved opportunity record",
        senderAddress: "",
        targetUrl: opp.postingUrl.trim(),
        contentExcerpt: opp.rawDescriptionText.slice(0, 2500),
        privateDocumentId: "",
        httpStatus: null,
        redactionConfirmed: true,
        dateSupplied: nowIso.slice(0, 10),
      });
    } else if (opp.rawDescriptionText.trim()) {
      initialArtifacts.push({
        id: `art-opp-desc-${opp.id}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 90),
        type: "document",
        title: "Supplied Job Description Text",
        sourceProvenance: opp.intakeChannel || "Saved opportunity record",
        senderAddress: "",
        targetUrl: opp.applicationUrl.trim(),
        contentExcerpt: opp.rawDescriptionText.slice(0, 2500),
        privateDocumentId: "",
        httpStatus: null,
        redactionConfirmed: true,
        dateSupplied: nowIso.slice(0, 10),
      });
    }
  }

  const checks = createDefaultVerificationChecklist({
    employerName: opp?.employer || params.subjectLabel,
    officialDomain,
  });

  // Pre-seed opening availability if already recorded as closed on the opportunity
  if (opp?.openingAvailabilityStatus === "No longer listed / Closed") {
    const openingIdx = checks.findIndex((c) => c.dimension === "opening_authenticity");
    if (openingIdx >= 0) {
      checks[openingIdx] = {
        ...checks[openingIdx],
        status: "completed",
        outcome: "conflict_or_missing",
        notes: "Opportunity record marks vacancy status as No longer listed / Closed.",
        datePerformed: nowIso.slice(0, 10),
      };
    }
  }

  const baseReview: AuthenticityReview = {
    id:
      params.id ||
      `authrev-${opp ? opp.id : Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .slice(0, 110),
    userId: params.userId,
    opportunityId: opp ? opp.id : "",
    subjectLabel: employerLabel.slice(0, 240),
    officialEmployerDomain: officialDomain,
    reviewScope: opp
      ? "Supplied opportunity text, links, and manual verification checklist"
      : "Pre-entry review of supplied message, URL, or recruiting request",
    overallStatus: "not_reviewed",
    dimensionAssessments: assessFiveDimensionsSeparately({
      checks,
      findings: [],
      artifacts: initialArtifacts,
    }),
    impersonationConfirmation: null,
    userDecision: "undecided",
    userDecisionNote: "",
    liveResearchStatus: "not_requested",
    liveResearchSummary: "",
    whatWasChecked: [],
    whatRemainsUnknown: [],
    nextVerificationSteps: [],
    artifacts: initialArtifacts,
    checks,
    findings: [],
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };

  return recheckAuthenticityReview(baseReview, { nowIso });
}

/**
 * Re-evaluates all supplied artifacts, merges any sanitized AI suggestions, preserves prior
 * user corrections/dismissals, recomputes the 5 independent dimensions, and derives overall status.
 */
export function recheckAuthenticityReview(
  review: AuthenticityReview,
  options?: {
    aiCandidateFindings?: RawAiCandidateFinding[];
    liveResearchStatus?: AuthenticityReview["liveResearchStatus"];
    liveResearchSummary?: string;
    nowIso?: string;
  }
): AuthenticityReview {
  const nowIso = options?.nowIso || new Date().toISOString();

  // Preserve prior user resolutions & user-created/documented findings
  const priorByKey = new Map<string, RiskFinding>();
  for (const prev of review.findings) {
    priorByKey.set(`${prev.ruleKey}::${prev.supportingArtifactId}`, prev);
    priorByKey.set(prev.id, prev);
  }

  const deterministic = runDeterministicArtifactRules({
    artifacts: review.artifacts,
    officialEmployerDomain: review.officialEmployerDomain,
    subjectLabel: review.subjectLabel,
  });

  const { acceptedFindings: aiAccepted } = sanitizeAndFilterAiSuggestedFindings(
    options?.aiCandidateFindings || [],
    review.artifacts
  );

  // Keep user_report / independently_documented_confirmation findings + prior AI findings if not re-supplied
  const preservedManualFindings = review.findings.filter(
    (f) =>
      (f.basis === "user_report" || f.basis === "independently_documented_confirmation") &&
      review.artifacts.some((a) => a.id === f.supportingArtifactId)
  );

  const preservedPriorAi =
    options?.aiCandidateFindings !== undefined
      ? []
      : review.findings.filter(
          (f) =>
            f.basis === "ai_suggestion" &&
            review.artifacts.some((a) => a.id === f.supportingArtifactId)
        );

  const combinedRaw = [
    ...deterministic,
    ...aiAccepted,
    ...preservedPriorAi,
    ...preservedManualFindings,
  ];

  const mergedFindings: RiskFinding[] = [];
  const seenIds = new Set<string>();

  for (const item of combinedRaw) {
    const existingMatch =
      priorByKey.get(`${item.ruleKey}::${item.supportingArtifactId}`) ||
      priorByKey.get(item.id);
    const merged: RiskFinding = existingMatch
      ? {
          ...item,
          id: existingMatch.id,
          userResolution: existingMatch.userResolution,
          userResolutionExplanation: existingMatch.userResolutionExplanation,
          resolvedAtIso: existingMatch.resolvedAtIso,
        }
      : item;

    if (!seenIds.has(merged.id)) {
      seenIds.add(merged.id);
      mergedFindings.push(merged);
    }
  }

  const nextLiveStatus = options?.liveResearchStatus ?? review.liveResearchStatus;
  const nextLiveSummary =
    options?.liveResearchSummary !== undefined
      ? scrubForbiddenSafetyPhrases(options.liveResearchSummary)
      : review.liveResearchSummary;

  const dimensionAssessments = assessFiveDimensionsSeparately({
    checks: review.checks,
    findings: mergedFindings,
    artifacts: review.artifacts,
  });

  const overallStatus = computeAuthenticityOverallStatus({
    dimensionAssessments,
    findings: mergedFindings,
    artifacts: review.artifacts,
    checks: review.checks,
    impersonationConfirmation: review.impersonationConfirmation,
  });

  const transparency = deriveTransparencyLists({
    dimensionAssessments,
    checks: review.checks,
    findings: mergedFindings,
    artifacts: review.artifacts,
    impersonationConfirmation: review.impersonationConfirmation,
    liveResearchStatus: nextLiveStatus,
  });

  return {
    ...review,
    overallStatus,
    dimensionAssessments,
    liveResearchStatus: nextLiveStatus,
    liveResearchSummary:
      nextLiveStatus === "unavailable" && !nextLiveSummary.trim()
        ? "Live verification unavailable"
        : nextLiveSummary,
    whatWasChecked: transparency.whatWasChecked,
    whatRemainsUnknown: transparency.whatRemainsUnknown,
    nextVerificationSteps: transparency.nextVerificationSteps,
    findings: mergedFindings.slice(0, 40),
    updatedAtIso: nowIso,
  };
}

export function resolveFindingWithExplanation(
  review: AuthenticityReview,
  findingId: string,
  resolution: RiskFindingResolution,
  explanation: string,
  nowIso?: string
): { ok: boolean; updatedReview?: AuthenticityReview; error?: string } {
  const cleanedExplanation = String(explanation || "").trim();
  if (resolution !== "active" && cleanedExplanation.length < 3) {
    return {
      ok: false,
      error: "Provide a brief note explaining why you are correcting or dismissing this finding.",
    };
  }

  const ts = nowIso || new Date().toISOString();
  const nextFindings = review.findings.map((f) =>
    f.id === findingId
      ? {
          ...f,
          userResolution: resolution,
          userResolutionExplanation:
            resolution === "active" ? "" : scrubForbiddenSafetyPhrases(cleanedExplanation).slice(0, 500),
          resolvedAtIso: resolution === "active" ? "" : ts,
        }
      : f
  );

  return {
    ok: true,
    updatedReview: recheckAuthenticityReview({ ...review, findings: nextFindings }, { nowIso: ts }),
  };
}

/**
 * Enforces workspace ownership and relational isolation for AuthenticityReview records:
 * - Rejects cross-workspace review ownership.
 * - Rejects linking to an opportunityId not owned by activeUserId.
 * - Rejects referencing a privateDocumentId not owned by activeUserId.
 */
export function validateReviewWorkspaceIsolation(params: {
  review: AuthenticityReview;
  activeUserId: string;
  workspace: WorkspaceState;
}): { valid: boolean; errorCode?: string; errorMessage?: string } {
  const { review, activeUserId, workspace } = params;
  if (!activeUserId || review.userId !== activeUserId) {
    return {
      valid: false,
      errorCode: "CROSS_WORKSPACE_DENIED",
      errorMessage: "Forbidden: Authenticity review belongs to a different workspace.",
    };
  }

  if (review.opportunityId.trim()) {
    const ownsOpp = workspace.opportunities.some(
      (o) => !o.isSampleRecord && o.id === review.opportunityId
    );
    if (!ownsOpp) {
      return {
        valid: false,
        errorCode: "FOREIGN_OPPORTUNITY_DENIED",
        errorMessage: "Forbidden: Linked opportunity does not exist in your private workspace.",
      };
    }
  }

  for (const art of review.artifacts) {
    if (art.privateDocumentId.trim()) {
      const ownsDoc = workspace.documents.some(
        (d) => d.id === art.privateDocumentId && d.userId === activeUserId
      );
      if (!ownsDoc) {
        return {
          valid: false,
          errorCode: "FOREIGN_DOCUMENT_DENIED",
          errorMessage:
            "Forbidden: Referenced private document does not exist in your private workspace.",
        };
      }
    }
  }

  return { valid: true };
}
