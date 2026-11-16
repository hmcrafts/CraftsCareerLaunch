import type {
  Contact,
  Evidence,
  GraphEntityType,
  LearningItem,
  Opportunity,
  PrivateDocumentMeta,
  RelationshipEdge,
  RelationshipOrigin,
  RelationshipStatus,
  RelationshipType,
  RequirementAssessment,
  WorkspaceState,
} from "../types/models.ts";

// ============================================================================
// 1. DEFINED ENTITY / RELATIONSHIP COMBINATION MATRIX
// ============================================================================

export interface AllowedRelationshipRule {
  sourceType: GraphEntityType;
  relationshipType: RelationshipType;
  targetType: GraphEntityType;
  humanLabel: string;
  description: string;
}

export const ALLOWED_RELATIONSHIP_COMBINATIONS: readonly AllowedRelationshipRule[] = [
  {
    sourceType: "experience",
    relationshipType: "demonstrates",
    targetType: "skill",
    humanLabel: "Experience → demonstrates → Skill",
    description:
      "Links verified paid, clinical, academic, or volunteer experience to a demonstrated or transferable skill (never course completion).",
  },
  {
    sourceType: "evidence",
    relationshipType: "supports",
    targetType: "experience",
    humanLabel: "Evidence → supports → Experience claim",
    description:
      "Connects an uploaded private document or verified confirmation record to an experience claim.",
  },
  {
    sourceType: "opportunity",
    relationshipType: "has_requirement",
    targetType: "requirement",
    humanLabel: "Opportunity → has requirement → Job requirement",
    description:
      "Connects a saved opportunity to a specific required or preferred qualification.",
  },
  {
    sourceType: "requirement",
    relationshipType: "requires",
    targetType: "skill",
    humanLabel: "Job requirement → requires → Skill",
    description:
      "Connects a job requirement (Required or Preferred) to the underlying skill needed.",
  },
  {
    sourceType: "learning",
    relationshipType: "teaches",
    targetType: "skill",
    humanLabel: "Learning activity → teaches → Skill",
    description:
      "Links a learning plan item or training exercise to a skill being developed (never treated as professional job experience).",
  },
  {
    sourceType: "contact",
    relationshipType: "claims_affiliation_with",
    targetType: "employer",
    humanLabel: "Contact → claims affiliation with → Employer",
    description:
      "Records an unverified organizational affiliation for a contact (never treated as confirmed employment).",
  },
  {
    sourceType: "contact",
    relationshipType: "confirmed_affiliation_with",
    targetType: "employer",
    humanLabel: "Contact → confirmed affiliation with → Employer",
    description:
      "Records a verified organizational affiliation backed by role verification or accessible supporting evidence.",
  },
  {
    sourceType: "opportunity",
    relationshipType: "offered_by",
    targetType: "employer",
    humanLabel: "Opportunity → offered by → Employer",
    description:
      "Associates a saved job opening with its employer inside your private workspace.",
  },
  {
    sourceType: "skill",
    relationshipType: "adjacent_to",
    targetType: "opportunity",
    humanLabel: "Skill → adjacent to → Opportunity",
    description:
      "Connects a documented skill to an adjacent saved opportunity or exploratory direction.",
  },
] as const;

export function isAllowedRelationshipTuple(
  sourceType: GraphEntityType,
  relationshipType: RelationshipType,
  targetType: GraphEntityType
): boolean {
  return ALLOWED_RELATIONSHIP_COMBINATIONS.some(
    (rule) =>
      rule.sourceType === sourceType &&
      rule.relationshipType === relationshipType &&
      rule.targetType === targetType
  );
}

// ============================================================================
// 2. CANONICAL SKILL & ID NORMALIZATION
// ============================================================================

interface CanonicalSkillPattern {
  slug: string;
  label: string;
  pattern: RegExp;
  adjacentRoleFamilies: Array<{
    roleTitle: string;
    sectorContext: string;
    rationale: string;
  }>;
}

const CANONICAL_SKILL_TAXONOMY: readonly CanonicalSkillPattern[] = [
  {
    slug: "aba-clinical-delivery",
    label: "ABA & Behavioral Health Service Delivery",
    pattern:
      /\b(aba|applied behavior analysis|registered behavior technician|\brbt\b|\bbcba\b|behavioral health|treatment plan|autism|clinic workflow)\b/i,
    adjacentRoleFamilies: [
      {
        roleTitle: "Clinical Onboarding / Implementation Specialist",
        sectorContext: "Behavioral health & outpatient practice software",
        rationale:
          "Firsthand fluency with clinic routines and treatment-plan workflows helps onboard clinical teams calmly.",
      },
      {
        roleTitle: "Care Navigation / Intake Coordinator",
        sectorContext: "Outpatient behavioral health & pediatric therapy",
        rationale:
          "Understanding family intake questions and clinician supervision structures transfers directly to care coordination.",
      },
    ],
  },
  {
    slug: "structured-data-documentation",
    label: "Structured Data Collection & Record Accuracy",
    pattern:
      /\b(behavioral data|data collection|structured.*record|accurate.*record|documentation|session data|recordkeeping|record maintenance|shipment record|audit|compliance record|data entry)\b/i,
    adjacentRoleFamilies: [
      {
        roleTitle: "Operations & Quality Assurance Coordinator",
        sectorContext: "Healthcare operations, education services, or business operations",
        rationale:
          "Consistent daily data capture and careful record maintenance reduce operational handoff errors.",
      },
    ],
  },
  {
    slug: "stakeholder-family-communication",
    label: "Client, Family & Stakeholder Communication",
    pattern:
      /\b(communicat.*famil|family communication|parent|client communication|stakeholder|written.*verbal communication|written follow-up|empathetic|customer-facing|client relations)\b/i,
    adjacentRoleFamilies: [
      {
        roleTitle: "Client Success Associate / Account Coordinator",
        sectorContext: "B2B SaaS, education technology, or healthcare services",
        rationale:
          "Clear, non-defensive communication with families and clinicians translates to post-onboarding client support.",
      },
    ],
  },
  {
    slug: "scheduling-workflow-coordination",
    label: "Scheduling, Dispatch & Follow-Up Coordination",
    pattern:
      /\b(schedul|follow-up|coordina|calendar|dispatch|vendor.*schedule|freight.*schedule|appointment|onboarding logistics|tutoring)\b/i,
    adjacentRoleFamilies: [
      {
        roleTitle: "Program / Scheduling Operations Coordinator",
        sectorContext: "Education programs, clinical networks, or regional operations",
        rationale:
          "Managing multi-party calendars, expectations, and timely follow-up is core to operational coordination.",
      },
    ],
  },
  {
    slug: "bachelors-degree-foundation",
    label: "Bachelor’s Degree & Analytical Foundation",
    pattern:
      /\b(bachelor|b\.s\.|b\.a\.|ba in|bs in|undergraduate degree|psychology.*degree|degree in psychology|degree in operations|supply chain.*degree|related field)\b/i,
    adjacentRoleFamilies: [],
  },
  {
    slug: "crm-pipeline-hygiene",
    label: "Salesforce / CRM Pipeline Tracking",
    pattern: /\b(salesforce|\bcrm\b|hubspot|pipeline hygiene|activity log|lead tracking)\b/i,
    adjacentRoleFamilies: [
      {
        roleTitle: "Revenue / Sales Operations Associate",
        sectorContext: "B2B software & services",
        rationale:
          "Structured CRM hygiene pairs well with careful operational documentation once workplace CRM usage is established.",
      },
    ],
  },
  {
    slug: "outbound-prospecting-discovery",
    label: "Outbound Prospecting & Discovery Calls",
    pattern:
      /\b(outbound|cold call|prospecting|discovery call|\bbdr\b|\bsdr\b|business development representative|qualified meeting)\b/i,
    adjacentRoleFamilies: [],
  },
  {
    slug: "sales-quota-ownership",
    label: "Quota-Carrying Sales Execution",
    pattern: /\b(quota|sales track record|closing deals|uncapped commission)\b/i,
    adjacentRoleFamilies: [],
  },
  {
    slug: "clinical-practice-software",
    label: "Clinical / EHR Practice Management Software",
    pattern: /\b(rethinkbh|centralreach|\behr\b|electronic health record|clinical software|practice management software)\b/i,
    adjacentRoleFamilies: [],
  },
  {
    slug: "rbt-credential",
    label: "Active RBT Credential Verification",
    pattern: /\b(active rbt|rbt certification|rbt credential|certified behavior technician)\b/i,
    adjacentRoleFamilies: [],
  },
  {
    slug: "erp-sap-administration",
    label: "Enterprise ERP / SAP Administration",
    pattern: /\b(\bsap\b|\berp\b|netsuite|oracle erp)\b/i,
    adjacentRoleFamilies: [],
  },
  {
    slug: "vendor-sla-logistics",
    label: "Vendor Management & SLA Tracking",
    pattern: /\b(vendor|\bsla\b|supply chain|logistics|freight|procurement)\b/i,
    adjacentRoleFamilies: [
      {
        roleTitle: "Supply Chain / Vendor Operations Analyst",
        sectorContext: "Distribution, healthcare supply, or regional logistics",
        rationale:
          "Vendor dispatch coordination and SLA monitoring build toward broader procurement and operations ownership.",
      },
    ],
  },
  {
    slug: "training-curriculum-enablement",
    label: "User Training, Coaching & Enablement",
    pattern: /\b(tutor|coach|enablement|user training|adult learning|curriculum|workshop)\b/i,
    adjacentRoleFamilies: [
      {
        roleTitle: "Customer Enablement / Training Specialist",
        sectorContext: "EdTech, healthcare software, or internal operations",
        rationale:
          "Breaking complex steps into calm, repeatable coaching translates directly to customer training roles.",
      },
    ],
  },
  {
    slug: "spreadsheets-reporting",
    label: "Spreadsheets & Operational Reporting",
    pattern: /\b(excel|google sheets|spreadsheet|pivot table|kpi reporting|dashboards)\b/i,
    adjacentRoleFamilies: [],
  },
];

export function slugifyGraphToken(raw: string, fallback = "item"): string {
  const cleaned = String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || fallback;
}

function deterministicShortHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(36);
}

export function buildCanonicalEdgeKey(
  sourceType: GraphEntityType,
  sourceId: string,
  relationshipType: RelationshipType,
  targetType: GraphEntityType,
  targetId: string
): string {
  return `${sourceType}:${sourceId.trim()}|${relationshipType}|${targetType}:${targetId.trim()}`;
}

export function buildCanonicalRelationshipId(
  sourceType: GraphEntityType,
  sourceId: string,
  relationshipType: RelationshipType,
  targetType: GraphEntityType,
  targetId: string
): string {
  const key = buildCanonicalEdgeKey(
    sourceType,
    sourceId,
    relationshipType,
    targetType,
    targetId
  );
  const srcSlug = slugifyGraphToken(sourceId, sourceType).slice(0, 22);
  const dstSlug = slugifyGraphToken(targetId, targetType).slice(0, 22);
  const relSlug = slugifyGraphToken(relationshipType, "rel").slice(0, 16);
  const hash = deterministicShortHash(key);
  return `rel-${srcSlug}-${relSlug}-${dstSlug}-${hash}`.slice(0, 120);
}

export interface ExtractedSkillNode {
  skillId: string;
  label: string;
}

export function extractSkillsFromText(
  text: string,
  tags: string[] = []
): ExtractedSkillNode[] {
  const combined = `${text || ""} ${(tags || []).join(" ")}`.trim();
  if (!combined) return [];

  const matched: ExtractedSkillNode[] = [];
  const seen = new Set<string>();

  for (const entry of CANONICAL_SKILL_TAXONOMY) {
    if (entry.pattern.test(combined)) {
      const skillId = `skill-${entry.slug}`;
      if (!seen.has(skillId)) {
        seen.add(skillId);
        matched.push({ skillId, label: entry.label });
      }
    }
  }

  if (matched.length === 0) {
    // Fallback: create a deterministic, readable skill node from concise phrase or primary tag
    const cleanedPhrase = (tags[0] || text)
      .replace(/^[\s•\-*]+/, "")
      .replace(/[.?!:;]+$/, "")
      .trim()
      .slice(0, 68);
    if (cleanedPhrase.length >= 2) {
      const slug = slugifyGraphToken(cleanedPhrase, "general-competency");
      matched.push({
        skillId: `skill-${slug}`,
        label: cleanedPhrase.length > 64 ? `${cleanedPhrase.slice(0, 61)}...` : cleanedPhrase,
      });
    }
  }

  return matched;
}

export function buildEmployerId(employerName: string): string {
  const normalized = employerName.trim() || "Unspecified Employer";
  return `emp-${slugifyGraphToken(normalized, "employer")}-${deterministicShortHash(
    normalized.toLowerCase()
  ).slice(0, 6)}`;
}

// ============================================================================
// 3. EVIDENCE ACCESSIBILITY & RELATIONSHIP VALIDATION
// ============================================================================

export interface AccessibleEvidenceCheck {
  evidenceId: string;
  accessible: boolean;
  isVerifiedSupport: boolean;
  isTrainingCategory: boolean;
  isGapPlaceholder: boolean;
  reasonIfInaccessible?: string;
  record?: Evidence;
  documentMeta?: PrivateDocumentMeta;
}

/**
 * Checks whether an evidence or private-document reference is currently accessible
 * to the active workspace owner.
 *
 * CRITICAL ACCEPTANCE INVARIANT:
 * - If an Evidence item was deleted, belongs to another user, or points to a deleted
 *   private `sourceDocumentId`, it is NOT accessible and cannot be retrieved or used
 *   to keep a relationship confirmed.
 */
export function inspectEvidenceAccessibility(
  evidenceOrDocId: string,
  workspace: WorkspaceState,
  ownerUid: string
): AccessibleEvidenceCheck {
  const cleanId = String(evidenceOrDocId || "").trim();
  if (!cleanId) {
    return {
      evidenceId: cleanId,
      accessible: false,
      isVerifiedSupport: false,
      isTrainingCategory: false,
      isGapPlaceholder: false,
      reasonIfInaccessible: "Empty evidence identifier.",
    };
  }

  const docMap = new Map<string, PrivateDocumentMeta>();
  for (const docMeta of workspace.documents || []) {
    if (!docMeta.userId || docMeta.userId === ownerUid) {
      docMap.set(docMeta.id, docMeta);
    }
  }

  const ev = (workspace.evidence || []).find((e) => e.id === cleanId);
  if (ev) {
    const evUserId = (ev as Evidence & { userId?: string }).userId;
    if (evUserId && evUserId !== ownerUid) {
      return {
        evidenceId: cleanId,
        accessible: false,
        isVerifiedSupport: false,
        isTrainingCategory: false,
        isGapPlaceholder: false,
        reasonIfInaccessible:
          "Rejected: Evidence record belongs to another user's private workspace.",
      };
    }

    // If this evidence claim depends on an uploaded private document, ensure that document wasn't deleted
    if (ev.sourceDocumentId && ev.sourceDocumentId.trim() !== "") {
      if (!docMap.has(ev.sourceDocumentId.trim())) {
        return {
          evidenceId: cleanId,
          accessible: false,
          isVerifiedSupport: false,
          isTrainingCategory:
            ev.category === "training_in_progress" ||
            ev.category === "completed_training",
          isGapPlaceholder: ev.category === "not_yet_demonstrated",
          reasonIfInaccessible:
            "Backing private document was removed and is no longer accessible.",
        };
      }
    }

    const isVerified =
      ev.verificationStatus === "Confirmed by Nora" ||
      ev.verificationStatus === "Supported by uploaded document";
    const isTraining =
      ev.category === "training_in_progress" ||
      ev.category === "completed_training";
    const isGap = ev.category === "not_yet_demonstrated";

    return {
      evidenceId: cleanId,
      accessible: true,
      isVerifiedSupport: isVerified && !isGap,
      isTrainingCategory: isTraining,
      isGapPlaceholder: isGap,
      record: ev,
    };
  }

  const privateDoc = docMap.get(cleanId);
  if (privateDoc) {
    return {
      evidenceId: cleanId,
      accessible: true,
      isVerifiedSupport: true,
      isTrainingCategory: false,
      isGapPlaceholder: false,
      documentMeta: privateDoc,
    };
  }

  return {
    evidenceId: cleanId,
    accessible: false,
    isVerifiedSupport: false,
    isTrainingCategory: false,
    isGapPlaceholder: false,
    reasonIfInaccessible:
      "Evidence reference does not exist or is no longer accessible in your workspace.",
  };
}

export interface RelationshipCandidateInput {
  id?: string;
  userId: string;
  sourceType: GraphEntityType;
  sourceId: string;
  sourceLabel: string;
  targetType: GraphEntityType;
  targetId: string;
  targetLabel: string;
  relationshipType: RelationshipType;
  requirementPriority?: "Required" | "Preferred" | "N/A";
  evidenceIds?: string[];
  rejectedEvidenceIds?: string[];
  status?: RelationshipStatus;
  origin?: RelationshipOrigin;
  explanationNote?: string;
}

export type RelationshipValidationErrorCode =
  | "FOREIGN_WORKSPACE_OWNER"
  | "INVALID_ENTITY_RELATIONSHIP_TUPLE"
  | "FOREIGN_OR_MISSING_ENTITY"
  | "INACCESSIBLE_EVIDENCE_REFERENCE"
  | "TRAINING_CANNOT_CLAIM_EXPERIENCE"
  | "CLAIMED_AFFILIATION_CANNOT_BE_CONFIRMED"
  | "UNVERIFIED_CONTACT_AFFILIATION"
  | "UNSUPPORTED_RELATIONSHIP_REMAINS_SUGGESTION"
  | "DUPLICATE_RELATIONSHIP"
  | "REJECTED_SUGGESTION_LOCKED";

export interface RelationshipValidationResult {
  valid: boolean;
  errorCode?: RelationshipValidationErrorCode;
  errorMessage?: string;
  normalizedEdge?: RelationshipEdge;
  coercedToSuggested?: boolean;
  coercionReason?: string;
}

export interface ValidateRelationshipOptions {
  mode: "create" | "update" | "derive";
  explicitNewEvidence?: boolean;
  strictConfirmCheck?: boolean;
}

function entityBelongsToForeignUser(rec: unknown, ownerUid: string): boolean {
  if (!rec || typeof rec !== "object") return false;
  const uid = (rec as { userId?: string }).userId;
  return Boolean(uid && uid !== ownerUid);
}

/**
 * Validates a proposed or updated RelationshipEdge against all security, domain,
 * honesty, deduplication, and rejection-stickiness invariants.
 */
export function validateRelationshipEdgeCandidate(
  candidate: RelationshipCandidateInput,
  workspace: WorkspaceState,
  ownerUid: string,
  existingEdges: RelationshipEdge[] = [],
  options: ValidateRelationshipOptions = { mode: "create" }
): RelationshipValidationResult {
  if (!ownerUid || candidate.userId !== ownerUid) {
    return {
      valid: false,
      errorCode: "FOREIGN_WORKSPACE_OWNER",
      errorMessage:
        "Rejected: Relationships cannot be created for or linked to another user's workspace.",
    };
  }

  if (
    !isAllowedRelationshipTuple(
      candidate.sourceType,
      candidate.relationshipType,
      candidate.targetType
    )
  ) {
    return {
      valid: false,
      errorCode: "INVALID_ENTITY_RELATIONSHIP_TUPLE",
      errorMessage: `Rejected: "${candidate.sourceType} → ${candidate.relationshipType} → ${candidate.targetType}" is not a permitted entity/relationship combination.`,
    };
  }

  const srcId = String(candidate.sourceId || "").trim();
  const dstId = String(candidate.targetId || "").trim();
  if (!srcId || !dstId) {
    return {
      valid: false,
      errorCode: "FOREIGN_OR_MISSING_ENTITY",
      errorMessage: "Source and destination entity identifiers are required.",
    };
  }

  // Verify entity existence & ownership in active workspace
  let matchedExperienceEvidence: Evidence | undefined;
  let matchedContact: Contact | undefined;

  const checkEntityAccess = (
    entityType: GraphEntityType,
    entityId: string
  ): { ok: boolean; reason?: string } => {
    switch (entityType) {
      case "experience": {
        // Experience nodes map to `exp-${ev.id}` or `ev.id` or `exp-profile-summary`
        const rawEvId = entityId.startsWith("exp-") ? entityId.slice(4) : entityId;
        if (entityId === "exp-profile-education") {
          return workspace.profile.educationSummary.trim().length > 0
            ? { ok: true }
            : { ok: false, reason: "Profile education summary is empty." };
        }
        const ev = (workspace.evidence || []).find(
          (e) => e.id === rawEvId || e.id === entityId
        );
        if (!ev || entityBelongsToForeignUser(ev, ownerUid)) {
          return {
            ok: false,
            reason: `Experience record "${entityId}" was not found in your workspace.`,
          };
        }
        matchedExperienceEvidence = ev;
        return { ok: true };
      }
      case "evidence": {
        const check = inspectEvidenceAccessibility(entityId, workspace, ownerUid);
        return check.accessible
          ? { ok: true }
          : { ok: false, reason: check.reasonIfInaccessible };
      }
      case "learning": {
        const learn = (workspace.learningItems || []).find((l) => l.id === entityId);
        if (learn && !entityBelongsToForeignUser(learn, ownerUid)) {
          return { ok: true };
        }
        // Also permit training-category Evidence items ONLY when sourceType === 'learning'
        const rawEvId = entityId.startsWith("learn-") ? entityId.slice(6) : entityId;
        const trainingEv = (workspace.evidence || []).find(
          (e) =>
            (e.id === rawEvId || e.id === entityId) &&
            (e.category === "training_in_progress" ||
              e.category === "completed_training")
        );
        if (trainingEv && !entityBelongsToForeignUser(trainingEv, ownerUid)) {
          return { ok: true };
        }
        return {
          ok: false,
          reason: `Learning activity "${entityId}" was not found in your workspace.`,
        };
      }
      case "opportunity": {
        const opp = (workspace.opportunities || []).find((o) => o.id === entityId);
        if (!opp || entityBelongsToForeignUser(opp, ownerUid)) {
          return {
            ok: false,
            reason: `Opportunity "${entityId}" was not found in your workspace.`,
          };
        }
        return { ok: true };
      }
      case "requirement": {
        const req = (workspace.assessments || []).find((a) => a.id === entityId);
        if (req && !entityBelongsToForeignUser(req, ownerUid)) {
          return { ok: true };
        }
        // Synthetic requirement IDs derived from saved opportunity (`req-<oppId>-...`)
        if (entityId.startsWith("req-")) {
          const belongsToSavedOpp = (workspace.opportunities || []).some(
            (o) =>
              !entityBelongsToForeignUser(o, ownerUid) &&
              entityId.startsWith(`req-${o.id}-`)
          );
          if (belongsToSavedOpp) return { ok: true };
        }
        return {
          ok: false,
          reason: `Job requirement "${entityId}" was not found in your workspace.`,
        };
      }
      case "contact": {
        const contact = (workspace.contacts || []).find((c) => c.id === entityId);
        if (!contact || entityBelongsToForeignUser(contact, ownerUid)) {
          return {
            ok: false,
            reason: `Contact "${entityId}" was not found in your workspace.`,
          };
        }
        matchedContact = contact;
        return { ok: true };
      }
      case "skill": {
        return entityId.startsWith("skill-")
          ? { ok: true }
          : { ok: false, reason: "Skill IDs must start with 'skill-'." };
      }
      case "employer": {
        return entityId.startsWith("emp-")
          ? { ok: true }
          : { ok: false, reason: "Employer IDs must start with 'emp-'." };
      }
    }
  };

  // Early check: if a LearningItem ID is supplied as sourceType === 'experience', reject as TRAINING_CANNOT_CLAIM_EXPERIENCE
  if (candidate.sourceType === "experience") {
    const matchesOwnedLearning = (workspace.learningItems || []).some(
      (l) =>
        !entityBelongsToForeignUser(l, ownerUid) &&
        (l.id === srcId || `exp-${l.id}` === srcId || `learn-${srcId}` === l.id)
    );
    if (matchesOwnedLearning) {
      return {
        valid: false,
        errorCode: "TRAINING_CANNOT_CLAIM_EXPERIENCE",
        errorMessage:
          "Coursework or learning activities cannot be turned into professional experience.",
      };
    }
  }

  const srcAccess = checkEntityAccess(candidate.sourceType, srcId);
  if (!srcAccess.ok) {
    return {
      valid: false,
      errorCode: "FOREIGN_OR_MISSING_ENTITY",
      errorMessage:
        srcAccess.reason ||
        "Source entity does not exist or belongs to another workspace.",
    };
  }

  const dstAccess = checkEntityAccess(candidate.targetType, dstId);
  if (!dstAccess.ok) {
    return {
      valid: false,
      errorCode: "FOREIGN_OR_MISSING_ENTITY",
      errorMessage:
        dstAccess.reason ||
        "Destination entity does not exist or belongs to another workspace.",
    };
  }

  // CRITICAL INVARIANT: Course completion / training NEVER becomes claimed job experience
  if (
    candidate.sourceType === "experience" &&
    candidate.relationshipType === "demonstrates"
  ) {
    if (
      matchedExperienceEvidence &&
      (matchedExperienceEvidence.category === "training_in_progress" ||
        matchedExperienceEvidence.category === "completed_training" ||
        matchedExperienceEvidence.category === "not_yet_demonstrated")
    ) {
      return {
        valid: false,
        errorCode: "TRAINING_CANNOT_CLAIM_EXPERIENCE",
        errorMessage:
          "Training, coursework, and unestablished skill gaps cannot be recorded as 'Experience → demonstrates → Skill'. Use 'Learning activity → teaches → Skill' instead.",
      };
    }
    const isLearningId = (workspace.learningItems || []).some(
      (l) => l.id === srcId || `exp-${l.id}` === srcId
    );
    if (isLearningId) {
      return {
        valid: false,
        errorCode: "TRAINING_CANNOT_CLAIM_EXPERIENCE",
        errorMessage:
          "Coursework or learning activities cannot be turned into professional experience.",
      };
    }
  }

  // Validate all evidence references are accessible to the active user
  const dedupedEvidenceIds = Array.from(
    new Set((candidate.evidenceIds || []).map((id) => id.trim()).filter(Boolean))
  ).slice(0, 20);

  const evidenceChecks: AccessibleEvidenceCheck[] = [];
  for (const evId of dedupedEvidenceIds) {
    const check = inspectEvidenceAccessibility(evId, workspace, ownerUid);
    if (!check.accessible) {
      return {
        valid: false,
        errorCode: "INACCESSIBLE_EVIDENCE_REFERENCE",
        errorMessage:
          check.reasonIfInaccessible ||
          `Evidence "${evId}" is not accessible in your workspace.`,
      };
    }
    if (
      candidate.sourceType === "experience" &&
      candidate.relationshipType === "demonstrates" &&
      (check.isTrainingCategory || check.isGapPlaceholder)
    ) {
      return {
        valid: false,
        errorCode: "TRAINING_CANNOT_CLAIM_EXPERIENCE",
        errorMessage:
          "Training records cannot be attached as evidence of paid/professional experience.",
      };
    }
    evidenceChecks.push(check);
  }

  // Canonical key & duplicate / rejected-stickiness checks
  const canonicalKey = buildCanonicalEdgeKey(
    candidate.sourceType,
    srcId,
    candidate.relationshipType,
    candidate.targetType,
    dstId
  );
  const canonicalId = buildCanonicalRelationshipId(
    candidate.sourceType,
    srcId,
    candidate.relationshipType,
    candidate.targetType,
    dstId
  );

  const existingMatch = existingEdges.find(
    (e) => e.canonicalKey === canonicalKey || e.id === canonicalId
  );

  if (options.mode === "create" && existingMatch) {
    return {
      valid: false,
      errorCode: "DUPLICATE_RELATIONSHIP",
      errorMessage:
        "This exact relationship already exists in your workspace graph.",
    };
  }

  // CRITICAL INVARIANT: Treat rejected suggestions as rejected unless new evidence is explicitly introduced
  if (existingMatch && existingMatch.status === "rejected") {
    const requestedStatus = candidate.status ?? "suggested";
    if (requestedStatus !== "rejected") {
      const priorRejectedSet = new Set(existingMatch.rejectedEvidenceIds || []);
      const hasGenuinelyNewAccessibleEvidence =
        Boolean(options.explicitNewEvidence) &&
        dedupedEvidenceIds.some((id) => !priorRejectedSet.has(id));

      if (!hasGenuinelyNewAccessibleEvidence) {
        if (options.mode === "derive") {
          const nowIso = new Date().toISOString();
          return {
            valid: true,
            normalizedEdge: {
              ...existingMatch,
              updatedAtIso: existingMatch.updatedAtIso || nowIso,
            },
          };
        }
        return {
          valid: false,
          errorCode: "REJECTED_SUGGESTION_LOCKED",
          errorMessage:
            "This relationship was previously rejected and remains rejected unless new accessible supporting evidence is explicitly attached.",
        };
      }
    }
  }

  // CRITICAL INVARIANT: Do not treat "claims affiliation" as confirmed employment
  let effectiveStatus: RelationshipStatus = candidate.status ?? "suggested";
  let coercedToSuggested = false;
  let coercionReason: string | undefined;

  if (candidate.relationshipType === "claims_affiliation_with") {
    if (effectiveStatus === "confirmed") {
      if (options.strictConfirmCheck) {
        return {
          valid: false,
          errorCode: "CLAIMED_AFFILIATION_CANNOT_BE_CONFIRMED",
          errorMessage:
            "'Claims affiliation with' represents an unverified claim and cannot be marked Confirmed. Verify the contact's role first to use 'Confirmed affiliation with'.",
        };
      }
      effectiveStatus = "suggested";
      coercedToSuggested = true;
      coercionReason =
        "Claimed employer affiliations remain unverified suggestions until confirmed.";
    }
  }

  // CRITICAL INVARIANT: Contact -> confirmed_affiliation_with -> Employer requires roleVerified or verified evidence
  if (candidate.relationshipType === "confirmed_affiliation_with") {
    const hasVerifiedEvidence = evidenceChecks.some((c) => c.isVerifiedSupport);
    const contactVerified = Boolean(matchedContact?.roleVerified);
    if (!contactVerified && !hasVerifiedEvidence && effectiveStatus === "confirmed") {
      if (options.strictConfirmCheck) {
        return {
          valid: false,
          errorCode: "UNVERIFIED_CONTACT_AFFILIATION",
          errorMessage:
            "Cannot confirm employer affiliation until the contact's role is marked verified or backed by confirmed supporting evidence.",
        };
      }
      effectiveStatus = "suggested";
      coercedToSuggested = true;
      coercionReason =
        "Contact role is not yet verified; affiliation remains a suggestion.";
    }
  }

  // CRITICAL INVARIANT: Unsupported relationships remain suggestions
  const requiresVerifiedSupportForConfirm =
    candidate.relationshipType === "demonstrates" ||
    candidate.relationshipType === "supports" ||
    candidate.relationshipType === "adjacent_to";

  if (requiresVerifiedSupportForConfirm && effectiveStatus === "confirmed") {
    const hasVerifiedSupport = evidenceChecks.some((c) => c.isVerifiedSupport);
    if (!hasVerifiedSupport) {
      if (options.strictConfirmCheck) {
        return {
          valid: false,
          errorCode: "UNSUPPORTED_RELATIONSHIP_REMAINS_SUGGESTION",
          errorMessage:
            "Unsupported relationships must remain suggestions until at least one confirmed or document-backed evidence item is attached.",
        };
      }
      effectiveStatus = "suggested";
      coercedToSuggested = true;
      coercionReason =
        "No verified supporting evidence attached yet — kept as a suggestion.";
    }
  }

  const nowIso = new Date().toISOString();
  const rejectedEvidenceIds =
    effectiveStatus === "rejected"
      ? Array.from(
          new Set([
            ...(existingMatch?.rejectedEvidenceIds || []),
            ...(candidate.rejectedEvidenceIds || []),
            ...dedupedEvidenceIds,
          ])
        ).slice(0, 20)
      : (existingMatch?.rejectedEvidenceIds || []).slice(0, 20);

  const priority: "Required" | "Preferred" | "N/A" =
    candidate.requirementPriority === "Required" ||
    candidate.requirementPriority === "Preferred"
      ? candidate.requirementPriority
      : "N/A";

  const origin: RelationshipOrigin =
    candidate.origin === "user" ||
    candidate.origin === "document_extraction" ||
    candidate.origin === "ai_suggestion"
      ? candidate.origin
      : "document_extraction";

  return {
    valid: true,
    coercedToSuggested,
    coercionReason,
    normalizedEdge: {
      id: existingMatch?.id || canonicalId,
      userId: ownerUid,
      canonicalKey,
      sourceType: candidate.sourceType,
      sourceId: srcId,
      sourceLabel: String(candidate.sourceLabel || srcId).slice(0, 300),
      targetType: candidate.targetType,
      targetId: dstId,
      targetLabel: String(candidate.targetLabel || dstId).slice(0, 300),
      relationshipType: candidate.relationshipType,
      requirementPriority: priority,
      evidenceIds: dedupedEvidenceIds,
      rejectedEvidenceIds,
      status: effectiveStatus,
      origin,
      explanationNote: String(
        candidate.explanationNote || coercionReason || ""
      ).slice(0, 1000),
      createdAtIso: existingMatch?.createdAtIso || nowIso,
      updatedAtIso: nowIso,
    },
  };
}

// ============================================================================
// 4. WORKSPACE GRAPH DERIVATION & LIVE ACCESSIBLE RESOLUTION
// ============================================================================

export interface GraphNode {
  id: string;
  type: GraphEntityType;
  label: string;
  subtitle: string;
  verificationState: string;
  linkedRecordId?: string;
}

export interface ResolvedRelationshipEdge extends RelationshipEdge {
  accessibleEvidence: Evidence[];
  accessibleDocuments: PrivateDocumentMeta[];
  inaccessibleEvidenceIds: string[];
  effectiveStatus: RelationshipStatus;
  evidencePathComplete: boolean;
  incompleteReason?: string;
}

export interface ResolvedWorkspaceGraph {
  ownerUid: string;
  nodes: GraphNode[];
  edges: ResolvedRelationshipEdge[];
}

function summarizeEvidenceLabel(claimText: string): string {
  const clean = claimText.trim();
  return clean.length > 88 ? `${clean.slice(0, 85)}...` : clean;
}

/**
 * Derives baseline typed relationships from the active user's own workspace records,
 * merges persisted user relationships (honoring confirmations and rejections), and
 * enforces live evidence accessibility on every returned edge.
 */
export function resolveAccessibleWorkspaceGraph(
  workspace: WorkspaceState,
  ownerUid: string,
  options?: { includeSampleOpportunities?: boolean }
): ResolvedWorkspaceGraph {
  const nodesMap = new Map<string, GraphNode>();
  const persistedEdges = (workspace.relationships || []).filter(
    (r) => !r.userId || r.userId === ownerUid
  );

  const upsertNode = (node: GraphNode) => {
    if (!nodesMap.has(node.id)) {
      nodesMap.set(node.id, node);
    }
  };

  // 1. Register private uploaded documents & evidence claims
  for (const docMeta of workspace.documents || []) {
    if (docMeta.userId && docMeta.userId !== ownerUid) continue;
    upsertNode({
      id: docMeta.id,
      type: "evidence",
      label: docMeta.fileName,
      subtitle: `Private uploaded ${docMeta.docCategory.replace(/_/g, " ")}`,
      verificationState: "Uploaded private document",
      linkedRecordId: docMeta.id,
    });
  }

  const candidateDrafts: RelationshipCandidateInput[] = [];

  for (const ev of workspace.evidence || []) {
    if (entityBelongsToForeignUser(ev, ownerUid)) continue;
    const access = inspectEvidenceAccessibility(ev.id, workspace, ownerUid);
    if (!access.accessible) continue;

    upsertNode({
      id: ev.id,
      type: "evidence",
      label: summarizeEvidenceLabel(ev.claimText),
      subtitle: ev.sourceDocumentOrConfirmation || "Workspace Evidence Library",
      verificationState: ev.verificationStatus,
      linkedRecordId: ev.id,
    });

    if (
      ev.category === "demonstrated_skill" ||
      ev.category === "transferable_experience"
    ) {
      const expId = `exp-${ev.id}`;
      upsertNode({
        id: expId,
        type: "experience",
        label: summarizeEvidenceLabel(ev.claimText),
        subtitle:
          ev.category === "demonstrated_skill"
            ? "Demonstrated experience claim"
            : "Transferable experience claim",
        verificationState: ev.verificationStatus,
        linkedRecordId: ev.id,
      });

      const isConfirmedSupport = access.isVerifiedSupport;
      const supportEvIds = [
        ev.id,
        ...(ev.sourceDocumentId &&
        inspectEvidenceAccessibility(ev.sourceDocumentId, workspace, ownerUid).accessible
          ? [ev.sourceDocumentId]
          : []),
      ];

      // Evidence -> supports -> Experience claim
      candidateDrafts.push({
        userId: ownerUid,
        sourceType: "evidence",
        sourceId: ev.sourceDocumentId &&
          inspectEvidenceAccessibility(ev.sourceDocumentId, workspace, ownerUid).accessible
            ? ev.sourceDocumentId
            : ev.id,
        sourceLabel:
          ev.sourceDocumentOrConfirmation || summarizeEvidenceLabel(ev.claimText),
        targetType: "experience",
        targetId: expId,
        targetLabel: summarizeEvidenceLabel(ev.claimText),
        relationshipType: "supports",
        evidenceIds: supportEvIds,
        status: isConfirmedSupport ? "confirmed" : "suggested",
        origin: ev.sourceDocumentId ? "document_extraction" : "user",
        explanationNote: isConfirmedSupport
          ? `Backed by ${ev.verificationStatus.toLowerCase()} (${ev.sourceDocumentOrConfirmation}).`
          : `Unverified claim (${ev.verificationStatus}) — remains a suggestion until confirmed.`,
      });

      // Experience -> demonstrates -> Skill
      const extractedSkills = extractSkillsFromText(ev.claimText, ev.tags);
      for (const sk of extractedSkills) {
        upsertNode({
          id: sk.skillId,
          type: "skill",
          label: sk.label,
          subtitle: "Canonical workspace skill",
          verificationState: isConfirmedSupport
            ? "Demonstrated in verified experience"
            : "Suggested from unverified claim",
        });

        candidateDrafts.push({
          userId: ownerUid,
          sourceType: "experience",
          sourceId: expId,
          sourceLabel: summarizeEvidenceLabel(ev.claimText),
          targetType: "skill",
          targetId: sk.skillId,
          targetLabel: sk.label,
          relationshipType: "demonstrates",
          evidenceIds: supportEvIds,
          status: isConfirmedSupport ? "confirmed" : "suggested",
          origin: "document_extraction",
          explanationNote: isConfirmedSupport
            ? `${
                ev.category === "transferable_experience"
                  ? "Transferable experience"
                  : "Direct experience"
              } supported by "${ev.sourceDocumentOrConfirmation}".`
            : `Remains a suggestion until "${summarizeEvidenceLabel(ev.claimText)}" is verified.`,
        });
      }
    } else if (
      ev.category === "training_in_progress" ||
      ev.category === "completed_training"
    ) {
      // Training-category evidence maps STRICTLY to Learning activity -> teaches -> Skill (NEVER Experience -> demonstrates)
      const learnNodeId = `learn-${ev.id}`;
      upsertNode({
        id: learnNodeId,
        type: "learning",
        label: summarizeEvidenceLabel(ev.claimText),
        subtitle:
          ev.category === "completed_training"
            ? "Completed training (not paid work experience)"
            : "Training in progress (not paid work experience)",
        verificationState: ev.verificationStatus,
        linkedRecordId: ev.id,
      });

      const extractedSkills = extractSkillsFromText(ev.claimText, ev.tags);
      for (const sk of extractedSkills) {
        upsertNode({
          id: sk.skillId,
          type: "skill",
          label: sk.label,
          subtitle: "Canonical workspace skill",
          verificationState: "Covered by training/rehearsal",
        });

        candidateDrafts.push({
          userId: ownerUid,
          sourceType: "learning",
          sourceId: learnNodeId,
          sourceLabel: summarizeEvidenceLabel(ev.claimText),
          targetType: "skill",
          targetId: sk.skillId,
          targetLabel: sk.label,
          relationshipType: "teaches",
          evidenceIds: [ev.id],
          status: access.isVerifiedSupport ? "confirmed" : "suggested",
          origin: "document_extraction",
          explanationNote:
            "Builds foundational familiarity through training — never claimed as professional job experience.",
        });
      }
    }
  }

  // 2. Register Learning Plan Items -> teaches -> Skill
  for (const learn of workspace.learningItems || []) {
    if (entityBelongsToForeignUser(learn, ownerUid)) continue;
    upsertNode({
      id: learn.id,
      type: "learning",
      label: learn.title,
      subtitle: `Learning activity (${learn.status}) — foundational preparation, not paid work`,
      verificationState: learn.status,
      linkedRecordId: learn.id,
    });

    const skills = extractSkillsFromText(
      `${learn.title} ${learn.tiedToRequirement}`,
      []
    );
    for (const sk of skills) {
      upsertNode({
        id: sk.skillId,
        type: "skill",
        label: sk.label,
        subtitle: "Canonical workspace skill",
        verificationState: `Learning ${learn.status.toLowerCase()}`,
      });

      candidateDrafts.push({
        userId: ownerUid,
        sourceType: "learning",
        sourceId: learn.id,
        sourceLabel: learn.title,
        targetType: "skill",
        targetId: sk.skillId,
        targetLabel: sk.label,
        relationshipType: "teaches",
        evidenceIds: [],
        status: learn.status === "Completed" ? "confirmed" : "suggested",
        origin: "user",
        explanationNote:
          learn.honestFramingNote ||
          `Learning activity (${learn.status}) teaches foundational concepts; frame honestly as preparation rather than job tenure.`,
      });
    }
  }

  // 3. Register Saved Opportunities, Employers, and Job Requirements
  const relevantOpps = (workspace.opportunities || []).filter((o) => {
    if (entityBelongsToForeignUser(o, ownerUid)) return false;
    if (o.isSampleRecord && !options?.includeSampleOpportunities) return false;
    return true;
  });

  for (const opp of relevantOpps) {
    upsertNode({
      id: opp.id,
      type: "opportunity",
      label: `${opp.title} — ${opp.employer}`,
      subtitle: `${opp.stage} · ${opp.openingAvailabilityStatus}`,
      verificationState: opp.openingAvailabilityStatus,
      linkedRecordId: opp.id,
    });

    const empId = buildEmployerId(opp.employer);
    upsertNode({
      id: empId,
      type: "employer",
      label: opp.employer,
      subtitle: opp.officialWebsite || "Employer in workspace",
      verificationState:
        opp.openingAvailabilityStatus === "Seen on official careers page"
          ? "Official careers page checked"
          : "Employer opening unverified",
    });

    candidateDrafts.push({
      userId: ownerUid,
      sourceType: "opportunity",
      sourceId: opp.id,
      sourceLabel: `${opp.title} — ${opp.employer}`,
      targetType: "employer",
      targetId: empId,
      targetLabel: opp.employer,
      relationshipType: "offered_by",
      evidenceIds: [],
      status:
        opp.openingAvailabilityStatus === "Seen on official careers page"
          ? "confirmed"
          : "suggested",
      origin: "document_extraction",
      explanationNote:
        opp.openingAvailabilityStatus === "Seen on official careers page"
          ? "Opening seen directly on the employer's official careers page."
          : "Opening availability has not yet been confirmed on the employer's official careers page.",
    });

    // Map stored RequirementAssessments or raw qualifications for this opportunity
    const storedReqs = (workspace.assessments || []).filter(
      (a) => a.opportunityId === opp.id && !entityBelongsToForeignUser(a, ownerUid)
    );

    const reqRecords: Array<{
      id: string;
      text: string;
      priority: "Required" | "Preferred";
    }> =
      storedReqs.length > 0
        ? storedReqs.map((r) => ({
            id: r.id,
            text: r.requirementText,
            priority: r.priority,
          }))
        : [
            ...(opp.requiredQualifications || []).map((q, idx) => ({
              id: `req-${opp.id}-req-${idx + 1}`,
              text: q,
              priority: "Required" as const,
            })),
            ...(opp.preferredQualifications || []).map((q, idx) => ({
              id: `req-${opp.id}-pref-${idx + 1}`,
              text: q,
              priority: "Preferred" as const,
            })),
          ];

    for (const req of reqRecords) {
      upsertNode({
        id: req.id,
        type: "requirement",
        label:
          req.text.length > 90 ? `${req.text.slice(0, 87)}...` : req.text,
        subtitle: `${req.priority} qualification · ${opp.employer}`,
        verificationState: req.priority,
        linkedRecordId: opp.id,
      });

      candidateDrafts.push({
        userId: ownerUid,
        sourceType: "opportunity",
        sourceId: opp.id,
        sourceLabel: `${opp.title} — ${opp.employer}`,
        targetType: "requirement",
        targetId: req.id,
        targetLabel: req.text.slice(0, 200),
        relationshipType: "has_requirement",
        requirementPriority: req.priority,
        evidenceIds: [],
        status: "confirmed",
        origin: "document_extraction",
        explanationNote: `${req.priority} qualification extracted from ${opp.employer} job posting.`,
      });

      const reqSkills = extractSkillsFromText(req.text, []);
      for (const sk of reqSkills) {
        upsertNode({
          id: sk.skillId,
          type: "skill",
          label: sk.label,
          subtitle: "Canonical workspace skill",
          verificationState: `${req.priority} in saved opportunity`,
        });

        candidateDrafts.push({
          userId: ownerUid,
          sourceType: "requirement",
          sourceId: req.id,
          sourceLabel: req.text.slice(0, 200),
          targetType: "skill",
          targetId: sk.skillId,
          targetLabel: sk.label,
          relationshipType: "requires",
          requirementPriority: req.priority,
          evidenceIds: [],
          status: "confirmed",
          origin: "document_extraction",
          explanationNote: `${opp.title} (${opp.employer}) lists this as a ${req.priority.toLowerCase()} qualification.`,
        });
      }
    }
  }

  // 4. Register Contacts -> claims_affiliation_with vs confirmed_affiliation_with -> Employer
  for (const contact of workspace.contacts || []) {
    if (entityBelongsToForeignUser(contact, ownerUid)) continue;
    upsertNode({
      id: contact.id,
      type: "contact",
      label: contact.name,
      subtitle: `${contact.role || "Role unverified"} · ${
        contact.organization || "Organization unspecified"
      }`,
      verificationState: contact.roleVerified
        ? "Role & affiliation verified"
        : "Affiliation claimed (unverified)",
      linkedRecordId: contact.id,
    });

    if (contact.organization && contact.organization.trim() !== "") {
      const empId = buildEmployerId(contact.organization);
      upsertNode({
        id: empId,
        type: "employer",
        label: contact.organization.trim(),
        subtitle: "Organization in workspace",
        verificationState: contact.roleVerified
          ? "Verified contact affiliation"
          : "Claimed contact affiliation",
      });

      if (contact.roleVerified) {
        candidateDrafts.push({
          userId: ownerUid,
          sourceType: "contact",
          sourceId: contact.id,
          sourceLabel: `${contact.name} (${contact.role || "Verified role"})`,
          targetType: "employer",
          targetId: empId,
          targetLabel: contact.organization.trim(),
          relationshipType: "confirmed_affiliation_with",
          evidenceIds: [],
          status: "confirmed",
          origin: "user",
          explanationNote: `Verified by workspace owner (${
            contact.source || "direct verification"
          }).`,
        });
      } else {
        candidateDrafts.push({
          userId: ownerUid,
          sourceType: "contact",
          sourceId: contact.id,
          sourceLabel: `${contact.name} (${contact.role || "Unverified role"})`,
          targetType: "employer",
          targetId: empId,
          targetLabel: contact.organization.trim(),
          relationshipType: "claims_affiliation_with",
          evidenceIds: [],
          status: "suggested",
          origin: "user",
          explanationNote:
            "Claimed affiliation only — do not treat as confirmed employment until independently verified.",
        });
      }
    }
  }

  // 5. Merge persisted relationships first (preserving user confirmations, custom edges, and rejections)
  const mergedByKey = new Map<string, RelationshipEdge>();

  for (const saved of persistedEdges) {
    if (
      !isAllowedRelationshipTuple(
        saved.sourceType,
        saved.relationshipType,
        saved.targetType
      )
    ) {
      continue;
    }
    const key =
      saved.canonicalKey ||
      buildCanonicalEdgeKey(
        saved.sourceType,
        saved.sourceId,
        saved.relationshipType,
        saved.targetType,
        saved.targetId
      );
    mergedByKey.set(key, {
      ...saved,
      canonicalKey: key,
    });

    upsertNode({
      id: saved.sourceId,
      type: saved.sourceType,
      label: saved.sourceLabel || saved.sourceId,
      subtitle: saved.sourceType,
      verificationState: saved.status,
    });
    upsertNode({
      id: saved.targetId,
      type: saved.targetType,
      label: saved.targetLabel || saved.targetId,
      subtitle: saved.targetType,
      verificationState: saved.status,
    });
  }

  // Merge derived candidates without clobbering user decisions or resurrected rejected edges
  const existingSnapshot = Array.from(mergedByKey.values());
  for (const draft of candidateDrafts) {
    const key = buildCanonicalEdgeKey(
      draft.sourceType,
      draft.sourceId,
      draft.relationshipType,
      draft.targetType,
      draft.targetId
    );
    const existing = mergedByKey.get(key);
    if (existing) {
      // Never overwrite a rejected edge during automatic derivation
      if (existing.status === "rejected") {
        continue;
      }
      // Keep user-confirmed or user-edited edges intact
      continue;
    }

    const validated = validateRelationshipEdgeCandidate(
      draft,
      workspace,
      ownerUid,
      existingSnapshot,
      { mode: "derive" }
    );
    if (validated.valid && validated.normalizedEdge) {
      mergedByKey.set(key, validated.normalizedEdge);
    }
  }

  // 6. Live Evidence Accessibility Filter on EVERY resolved edge
  // Removing access to evidence immediately prevents its retrieval and downgrades unsupported edges!
  const resolvedEdges: ResolvedRelationshipEdge[] = [];

  for (const edge of mergedByKey.values()) {
    // Also verify source/target entity wasn't deleted if it references evidence/contact/opportunity/learning
    if (edge.sourceType === "evidence") {
      const srcCheck = inspectEvidenceAccessibility(
        edge.sourceId,
        workspace,
        ownerUid
      );
      if (!srcCheck.accessible) {
        // Source evidence was removed -> do not expose stale evidence edge
        continue;
      }
    }
    if (edge.sourceType === "experience" && edge.sourceId.startsWith("exp-")) {
      const rawEvId = edge.sourceId.slice(4);
      const expCheck = inspectEvidenceAccessibility(rawEvId, workspace, ownerUid);
      if (!expCheck.accessible) {
        // Underlying experience claim or its private backing document was removed -> prevent retrieval
        continue;
      }
    }

    const accessibleEvidence: Evidence[] = [];
    const accessibleDocuments: PrivateDocumentMeta[] = [];
    const inaccessibleEvidenceIds: string[] = [];
    let hasVerifiedAccessibleSupport = false;

    for (const evId of edge.evidenceIds || []) {
      const check = inspectEvidenceAccessibility(evId, workspace, ownerUid);
      if (!check.accessible) {
        inaccessibleEvidenceIds.push(evId);
      } else {
        if (check.record) accessibleEvidence.push(check.record);
        if (check.documentMeta) accessibleDocuments.push(check.documentMeta);
        if (check.isVerifiedSupport) hasVerifiedAccessibleSupport = true;
      }
    }

    let effectiveStatus: RelationshipStatus = edge.status;
    let evidencePathComplete = true;
    let incompleteReason: string | undefined;

    if (edge.relationshipType === "claims_affiliation_with") {
      effectiveStatus = edge.status === "rejected" ? "rejected" : "suggested";
      evidencePathComplete = false;
      incompleteReason =
        "Affiliation is claimed, not verified — never treated as confirmed employment.";
    } else if (edge.relationshipType === "confirmed_affiliation_with") {
      const contact = (workspace.contacts || []).find(
        (c) => c.id === edge.sourceId && !entityBelongsToForeignUser(c, ownerUid)
      );
      if (!contact) {
        continue;
      }
      if (!contact.roleVerified && !hasVerifiedAccessibleSupport) {
        effectiveStatus = edge.status === "rejected" ? "rejected" : "suggested";
        evidencePathComplete = false;
        incompleteReason =
          "Contact role verification or supporting evidence is missing — remains a suggestion.";
      }
    } else if (
      edge.relationshipType === "demonstrates" ||
      edge.relationshipType === "supports" ||
      edge.relationshipType === "adjacent_to"
    ) {
      if (!hasVerifiedAccessibleSupport) {
        if (effectiveStatus === "confirmed") {
          effectiveStatus = "suggested";
        }
        evidencePathComplete = false;
        incompleteReason =
          inaccessibleEvidenceIds.length > 0
            ? "Supporting evidence was removed or is no longer accessible; path is incomplete and downgraded to a suggestion."
            : "Supporting evidence is unverified or missing; path remains a suggestion.";
      }
    } else if (edge.relationshipType === "offered_by") {
      const opp = relevantOpps.find((o) => o.id === edge.sourceId);
      if (opp && opp.openingAvailabilityStatus !== "Seen on official careers page") {
        evidencePathComplete = false;
        incompleteReason =
          "Vacancy availability has not yet been verified on the employer's official careers page.";
      }
    }

    resolvedEdges.push({
      ...edge,
      // Strip inaccessible IDs from active evidenceIds so removed evidence is never retrieved
      evidenceIds: [
        ...accessibleEvidence.map((e) => e.id),
        ...accessibleDocuments.map((d) => d.id),
      ],
      accessibleEvidence,
      accessibleDocuments,
      inaccessibleEvidenceIds,
      effectiveStatus,
      evidencePathComplete,
      incompleteReason,
    });
  }

  return {
    ownerUid,
    nodes: Array.from(nodesMap.values()),
    edges: resolvedEdges,
  };
}

// ============================================================================
// 5. FUNCTION 1: EXPLAIN FIT ("Why this fits" on Opportunity Pages)
// ============================================================================

export type RequirementGraphSupportKind =
  | "verified_experience"
  | "transferable_experience"
  | "training_only_not_experience"
  | "suggested_unverified"
  | "gap_incomplete_path";

export interface RequirementFitPathExplanation {
  requirementId: string;
  requirementText: string;
  priority: "Required" | "Preferred";
  skills: ExtractedSkillNode[];
  supportKind: RequirementGraphSupportKind;
  pathComplete: boolean;
  pathSummary: string;
  honestyNote?: string;
  supportingEdges: ResolvedRelationshipEdge[];
  supportingEvidence: Evidence[];
  trainingEdges: ResolvedRelationshipEdge[];
}

export interface EmployerContactConnection {
  contactId: string;
  contactName: string;
  role: string;
  affiliationType: "confirmed_affiliation_with" | "claims_affiliation_with";
  isConfirmedEmployment: boolean;
  verificationLabel: string;
  edge: ResolvedRelationshipEdge;
}

export interface OpportunityGraphFitExplanation {
  opportunityId: string;
  employerName: string;
  employerId: string;
  counts: {
    requiredTotal: number;
    requiredVerified: number;
    requiredTrainingOnly: number;
    requiredIncompleteOrGap: number;
    preferredTotal: number;
    preferredVerified: number;
  };
  requirementPaths: RequirementFitPathExplanation[];
  employerContacts: EmployerContactConnection[];
  safetyReviewContext: {
    openingAvailabilityStatus: Opportunity["openingAvailabilityStatus"];
    authenticityFlags: Opportunity["authenticityFlags"];
    isolationDisclosure: string;
  };
}

export function explainOpportunityFitWithGraph(
  opportunity: Opportunity,
  workspace: WorkspaceState,
  ownerUid: string
): OpportunityGraphFitExplanation {
  // Include sample opportunities only if the user is actively viewing an isolated sample comparison record
  const workspaceWithTarget: WorkspaceState = workspace.opportunities.some(
    (o) => o.id === opportunity.id
  )
    ? workspace
    : {
        ...workspace,
        opportunities: [...workspace.opportunities, opportunity],
      };

  const graph = resolveAccessibleWorkspaceGraph(workspaceWithTarget, ownerUid, {
    includeSampleOpportunities: Boolean(opportunity.isSampleRecord),
  });

  const activeEdges = graph.edges.filter((e) => e.effectiveStatus !== "rejected");

  const storedReqs = (workspace.assessments || []).filter(
    (a) =>
      a.opportunityId === opportunity.id && !entityBelongsToForeignUser(a, ownerUid)
  );

  const reqList: Array<{
    id: string;
    text: string;
    priority: "Required" | "Preferred";
  }> =
    storedReqs.length > 0
      ? storedReqs.map((r) => ({
          id: r.id,
          text: r.requirementText,
          priority: r.priority,
        }))
      : [
          ...(opportunity.requiredQualifications || []).map((q, idx) => ({
            id: `req-${opportunity.id}-req-${idx + 1}`,
            text: q,
            priority: "Required" as const,
          })),
          ...(opportunity.preferredQualifications || []).map((q, idx) => ({
            id: `req-${opportunity.id}-pref-${idx + 1}`,
            text: q,
            priority: "Preferred" as const,
          })),
        ];

  const requirementPaths: RequirementFitPathExplanation[] = reqList.map((req) => {
    const reqSkills = extractSkillsFromText(req.text, []);
    const skillIds = new Set(reqSkills.map((s) => s.skillId));

    const reqToSkillEdges = activeEdges.filter(
      (e) =>
        e.sourceType === "requirement" &&
        e.sourceId === req.id &&
        e.relationshipType === "requires"
    );

    const expEdges = activeEdges.filter(
      (e) =>
        e.sourceType === "experience" &&
        e.relationshipType === "demonstrates" &&
        skillIds.has(e.targetId)
    );

    const confirmedExpEdges = expEdges.filter(
      (e) => e.effectiveStatus === "confirmed" && e.evidencePathComplete
    );
    const suggestedExpEdges = expEdges.filter(
      (e) => e.effectiveStatus === "suggested" || !e.evidencePathComplete
    );

    const trainingEdges = activeEdges.filter(
      (e) =>
        e.sourceType === "learning" &&
        e.relationshipType === "teaches" &&
        skillIds.has(e.targetId)
    );

    // Collect upstream Evidence -> supports -> Experience edges for full traceability
    const expNodeIds = new Set(expEdges.map((e) => e.sourceId));
    const upstreamSupportEdges = activeEdges.filter(
      (e) =>
        e.sourceType === "evidence" &&
        e.relationshipType === "supports" &&
        expNodeIds.has(e.targetId)
    );

    const uniqueEvidenceMap = new Map<string, Evidence>();
    for (const edge of [...confirmedExpEdges, ...suggestedExpEdges, ...upstreamSupportEdges]) {
      for (const ev of edge.accessibleEvidence) {
        uniqueEvidenceMap.set(ev.id, ev);
      }
    }
    const supportingEvidence = Array.from(uniqueEvidenceMap.values());

    const skillNames = reqSkills.map((s) => s.label).join(", ");

    if (confirmedExpEdges.length > 0) {
      const hasDirect = supportingEvidence.some(
        (ev) => ev.category === "demonstrated_skill"
      );
      const supportKind: RequirementGraphSupportKind = hasDirect
        ? "verified_experience"
        : "transferable_experience";

      const sourceCitations = supportingEvidence
        .map(
          (ev) =>
            `"${summarizeEvidenceLabel(ev.claimText)}" (${ev.verificationStatus} · ${
              ev.sourceDocumentOrConfirmation
            })`
        )
        .join("; ");

      return {
        requirementId: req.id,
        requirementText: req.text,
        priority: req.priority,
        skills: reqSkills,
        supportKind,
        pathComplete: true,
        pathSummary: `Requirement → ${skillNames} ← ${
          hasDirect ? "Demonstrated experience" : "Transferable experience"
        } backed by ${sourceCitations || "confirmed workspace evidence"}.`,
        supportingEdges: [
          ...reqToSkillEdges,
          ...confirmedExpEdges,
          ...upstreamSupportEdges,
        ],
        supportingEvidence,
        trainingEdges,
      };
    }

    if (trainingEdges.length > 0 && suggestedExpEdges.length === 0) {
      const trainingLabels = trainingEdges.map((t) => t.sourceLabel).join("; ");
      return {
        requirementId: req.id,
        requirementText: req.text,
        priority: req.priority,
        skills: reqSkills,
        supportKind: "training_only_not_experience",
        pathComplete: false,
        pathSummary: `Incomplete work-experience path: Requirement → ${skillNames} is linked only to learning/training (${trainingLabels}), not professional job experience.`,
        honestyNote:
          "Coursework or practice teaches foundational concepts only — never present training completion as prior paid work experience.",
        supportingEdges: [...reqToSkillEdges, ...trainingEdges],
        supportingEvidence: [],
        trainingEdges,
      };
    }

    if (suggestedExpEdges.length > 0) {
      return {
        requirementId: req.id,
        requirementText: req.text,
        priority: req.priority,
        skills: reqSkills,
        supportKind: "suggested_unverified",
        pathComplete: false,
        pathSummary: `Incomplete path (suggestion only): Potential connection to ${skillNames} exists in unverified notes, but supporting evidence has not been confirmed yet.`,
        honestyNote:
          "Unsupported or unverified relationships remain suggestions until backed by confirmed evidence or an uploaded source document.",
        supportingEdges: [
          ...reqToSkillEdges,
          ...suggestedExpEdges,
          ...upstreamSupportEdges,
        ],
        supportingEvidence,
        trainingEdges,
      };
    }

    return {
      requirementId: req.id,
      requirementText: req.text,
      priority: req.priority,
      skills: reqSkills,
      supportKind: "gap_incomplete_path",
      pathComplete: false,
      pathSummary: `Incomplete path: No experience, verified evidence, or active learning item in your workspace currently connects to ${skillNames}.`,
      supportingEdges: reqToSkillEdges,
      supportingEvidence: [],
      trainingEdges: [],
    };
  });

  const employerId = buildEmployerId(opportunity.employer);
  const contactAffiliationEdges = activeEdges.filter(
    (e) =>
      e.sourceType === "contact" &&
      (e.relationshipType === "confirmed_affiliation_with" ||
        e.relationshipType === "claims_affiliation_with") &&
      e.targetId === employerId
  );

  const employerContacts: EmployerContactConnection[] = contactAffiliationEdges
    .map((edge) => {
      const contact = (workspace.contacts || []).find(
        (c) => c.id === edge.sourceId && !entityBelongsToForeignUser(c, ownerUid)
      );
      if (!contact) return null;
      const isConfirmed =
        edge.relationshipType === "confirmed_affiliation_with" &&
        edge.effectiveStatus === "confirmed";
      return {
        contactId: contact.id,
        contactName: contact.name,
        role: contact.role || "Role unverified",
        affiliationType: edge.relationshipType as
          | "confirmed_affiliation_with"
          | "claims_affiliation_with",
        isConfirmedEmployment: isConfirmed,
        verificationLabel: isConfirmed
          ? "Confirmed affiliation (role verified in workspace)"
          : "Claims affiliation only — unverified (do not treat as confirmed employment)",
        edge,
      };
    })
    .filter((x): x is EmployerContactConnection => x !== null);

  const reqItems = requirementPaths.filter((r) => r.priority === "Required");
  const prefItems = requirementPaths.filter((r) => r.priority === "Preferred");

  return {
    opportunityId: opportunity.id,
    employerName: opportunity.employer,
    employerId,
    counts: {
      requiredTotal: reqItems.length,
      requiredVerified: reqItems.filter(
        (r) =>
          r.supportKind === "verified_experience" ||
          r.supportKind === "transferable_experience"
      ).length,
      requiredTrainingOnly: reqItems.filter(
        (r) => r.supportKind === "training_only_not_experience"
      ).length,
      requiredIncompleteOrGap: reqItems.filter(
        (r) =>
          r.supportKind === "gap_incomplete_path" ||
          r.supportKind === "suggested_unverified"
      ).length,
      preferredTotal: prefItems.length,
      preferredVerified: prefItems.filter(
        (r) =>
          r.supportKind === "verified_experience" ||
          r.supportKind === "transferable_experience"
      ).length,
    },
    requirementPaths,
    employerContacts,
    safetyReviewContext: {
      openingAvailabilityStatus: opportunity.openingAvailabilityStatus,
      authenticityFlags: opportunity.authenticityFlags || [],
      isolationDisclosure:
        "Safety & authenticity findings apply strictly to this posting's review evidence inside your private workspace (never shared across users).",
    },
  };
}

// ============================================================================
// 6. FUNCTION 2: PRIORITIZE LEARNING ("Skills worth developing")
// ============================================================================

export interface SkillOpportunityBreakdownItem {
  opportunityId: string;
  title: string;
  employer: string;
  stage: Opportunity["stage"];
  highestPriority: "Required" | "Preferred";
  hasRequired: boolean;
  hasPreferred: boolean;
  matchingRequirements: Array<{
    requirementId: string;
    requirementText: string;
    priority: "Required" | "Preferred";
  }>;
}

export interface PrioritizedSkillRecommendation {
  skillId: string;
  skillLabel: string;
  totalOpportunityCount: number;
  requiredOpportunityCount: number;
  preferredOpportunityCount: number;
  preferredOnlyOpportunityCount: number;
  opportunities: SkillOpportunityBreakdownItem[];
  coverageState:
    | "demonstrated_experience"
    | "transferable_experience"
    | "training_only_not_experience"
    | "unverified_suggestion"
    | "gap";
  coverageExplanation: string;
  linkedLearningItems: LearningItem[];
  worthDeveloping: boolean;
}

/**
 * Aggregates skills across saved, non-archived, non-sample workspace opportunities.
 *
 * CRITICAL INVARIANT:
 * - `totalOpportunityCount === opportunities.length`
 * - `requiredOpportunityCount === opportunities.filter(o => o.hasRequired).length`
 * - `preferredOpportunityCount === opportunities.filter(o => o.hasPreferred).length`
 * - Training never counts as `demonstrated_experience`.
 */
export function prioritizeSkillsAcrossSavedOpportunities(
  workspace: WorkspaceState,
  ownerUid: string
): PrioritizedSkillRecommendation[] {
  const savedOpps = (workspace.opportunities || []).filter(
    (o) =>
      !o.archived &&
      !o.isSampleRecord &&
      !entityBelongsToForeignUser(o, ownerUid)
  );

  const graph = resolveAccessibleWorkspaceGraph(workspace, ownerUid, {
    includeSampleOpportunities: false,
  });
  const activeEdges = graph.edges.filter((e) => e.effectiveStatus !== "rejected");

  const skillBuckets = new Map<
    string,
    {
      skillId: string;
      skillLabel: string;
      byOpp: Map<string, SkillOpportunityBreakdownItem>;
    }
  >();

  for (const opp of savedOpps) {
    const storedReqs = (workspace.assessments || []).filter(
      (a) => a.opportunityId === opp.id && !entityBelongsToForeignUser(a, ownerUid)
    );
    const reqs: Array<{
      id: string;
      text: string;
      priority: "Required" | "Preferred";
    }> =
      storedReqs.length > 0
        ? storedReqs.map((r) => ({
            id: r.id,
            text: r.requirementText,
            priority: r.priority,
          }))
        : [
            ...(opp.requiredQualifications || []).map((q, idx) => ({
              id: `req-${opp.id}-req-${idx + 1}`,
              text: q,
              priority: "Required" as const,
            })),
            ...(opp.preferredQualifications || []).map((q, idx) => ({
              id: `req-${opp.id}-pref-${idx + 1}`,
              text: q,
              priority: "Preferred" as const,
            })),
          ];

    for (const req of reqs) {
      const skills = extractSkillsFromText(req.text, []);
      for (const sk of skills) {
        let bucket = skillBuckets.get(sk.skillId);
        if (!bucket) {
          bucket = {
            skillId: sk.skillId,
            skillLabel: sk.label,
            byOpp: new Map(),
          };
          skillBuckets.set(sk.skillId, bucket);
        }

        let oppEntry = bucket.byOpp.get(opp.id);
        if (!oppEntry) {
          oppEntry = {
            opportunityId: opp.id,
            title: opp.title,
            employer: opp.employer,
            stage: opp.stage,
            highestPriority: req.priority,
            hasRequired: req.priority === "Required",
            hasPreferred: req.priority === "Preferred",
            matchingRequirements: [],
          };
          bucket.byOpp.set(opp.id, oppEntry);
        } else {
          if (req.priority === "Required") {
            oppEntry.hasRequired = true;
            oppEntry.highestPriority = "Required";
          } else {
            oppEntry.hasPreferred = true;
          }
        }

        if (
          !oppEntry.matchingRequirements.some(
            (m) => m.requirementId === req.id
          )
        ) {
          oppEntry.matchingRequirements.push({
            requirementId: req.id,
            requirementText: req.text,
            priority: req.priority,
          });
        }
      }
    }
  }

  const results: PrioritizedSkillRecommendation[] = [];

  for (const bucket of skillBuckets.values()) {
    const opportunities = Array.from(bucket.byOpp.values());
    const totalOpportunityCount = opportunities.length;
    const requiredOpportunityCount = opportunities.filter(
      (o) => o.hasRequired
    ).length;
    const preferredOpportunityCount = opportunities.filter(
      (o) => o.hasPreferred
    ).length;
    const preferredOnlyOpportunityCount = opportunities.filter(
      (o) => !o.hasRequired && o.hasPreferred
    ).length;

    const expEdges = activeEdges.filter(
      (e) =>
        e.sourceType === "experience" &&
        e.relationshipType === "demonstrates" &&
        e.targetId === bucket.skillId
    );
    const confirmedExp = expEdges.filter(
      (e) => e.effectiveStatus === "confirmed" && e.evidencePathComplete
    );
    const suggestedExp = expEdges.filter(
      (e) => e.effectiveStatus === "suggested" || !e.evidencePathComplete
    );
    const trainingEdges = activeEdges.filter(
      (e) =>
        e.sourceType === "learning" &&
        e.relationshipType === "teaches" &&
        e.targetId === bucket.skillId
    );

    const linkedLearningItems = (workspace.learningItems || []).filter((item) => {
      if (entityBelongsToForeignUser(item, ownerUid)) return false;
      const itemSkills = extractSkillsFromText(
        `${item.title} ${item.tiedToRequirement}`,
        []
      );
      return itemSkills.some((s) => s.skillId === bucket.skillId);
    });

    let coverageState: PrioritizedSkillRecommendation["coverageState"] = "gap";
    let coverageExplanation =
      "Incomplete path: No verified experience or learning activity is linked to this skill yet.";

    if (confirmedExp.length > 0) {
      const hasDirect = confirmedExp.some((e) =>
        e.accessibleEvidence.some((ev) => ev.category === "demonstrated_skill")
      );
      coverageState = hasDirect
        ? "demonstrated_experience"
        : "transferable_experience";
      const firstEv = confirmedExp[0]?.accessibleEvidence[0];
      coverageExplanation = firstEv
        ? `Supported by ${
            hasDirect ? "direct" : "transferable"
          } experience: "${summarizeEvidenceLabel(firstEv.claimText)}" (${
            firstEv.verificationStatus
          }).`
        : "Supported by confirmed workspace experience.";
    } else if (trainingEdges.length > 0 || linkedLearningItems.length > 0) {
      coverageState = "training_only_not_experience";
      const titles = [
        ...linkedLearningItems.map((l) => `${l.title} (${l.status})`),
        ...trainingEdges
          .filter((t) => !linkedLearningItems.some((l) => l.id === t.sourceId))
          .map((t) => t.sourceLabel),
      ].join("; ");
      coverageExplanation = `Training / rehearsal only (${titles}) — builds foundational readiness, not claimed as paid work experience.`;
    } else if (suggestedExp.length > 0) {
      coverageState = "unverified_suggestion";
      coverageExplanation =
        "Suggested from unverified notes — confirm supporting evidence in My Profile before claiming.";
    }

    const worthDeveloping =
      coverageState === "gap" ||
      coverageState === "training_only_not_experience" ||
      coverageState === "unverified_suggestion";

    results.push({
      skillId: bucket.skillId,
      skillLabel: bucket.skillLabel,
      totalOpportunityCount,
      requiredOpportunityCount,
      preferredOpportunityCount,
      preferredOnlyOpportunityCount,
      opportunities,
      coverageState,
      coverageExplanation,
      linkedLearningItems,
      worthDeveloping,
    });
  }

  // Sort: skills worth developing first (by required count desc, then total count desc), then demonstrated skills
  results.sort((a, b) => {
    if (a.worthDeveloping !== b.worthDeveloping) {
      return a.worthDeveloping ? -1 : 1;
    }
    if (b.requiredOpportunityCount !== a.requiredOpportunityCount) {
      return b.requiredOpportunityCount - a.requiredOpportunityCount;
    }
    if (b.totalOpportunityCount !== a.totalOpportunityCount) {
      return b.totalOpportunityCount - a.totalOpportunityCount;
    }
    return a.skillLabel.localeCompare(b.skillLabel);
  });

  return results;
}

// ============================================================================
// 7. FUNCTION 3: EXPLORE ADJACENT WORK (Documented vs Speculative Labeled)
// ============================================================================

export interface DocumentedOpportunityBridge {
  opportunityId: string;
  title: string;
  employer: string;
  sharedVerifiedSkills: string[];
  trainingSupportedSkills: string[];
  openGapSkills: string[];
  traceableSummary: string;
}

export interface SpeculativeAdjacentDirection {
  id: string;
  roleTitle: string;
  sectorContext: string;
  isSpeculative: true;
  speculativeLabel: string;
  groundedInSkills: string[];
  supportingEvidenceClaims: string[];
  rationale: string;
  verificationNextStep: string;
}

export interface AdjacentWorkExplorationResult {
  documentedBridges: DocumentedOpportunityBridge[];
  speculativeSuggestions: SpeculativeAdjacentDirection[];
}

export function exploreAdjacentWorkFromGraph(
  workspace: WorkspaceState,
  ownerUid: string
): AdjacentWorkExplorationResult {
  const graph = resolveAccessibleWorkspaceGraph(workspace, ownerUid, {
    includeSampleOpportunities: false,
  });
  const activeEdges = graph.edges.filter((e) => e.effectiveStatus !== "rejected");

  const confirmedSkillEdges = activeEdges.filter(
    (e) =>
      e.sourceType === "experience" &&
      e.relationshipType === "demonstrates" &&
      e.effectiveStatus === "confirmed" &&
      e.evidencePathComplete
  );

  const confirmedSkillIds = new Set(confirmedSkillEdges.map((e) => e.targetId));

  // 1. Documented connections to saved opportunities already in workspace
  const savedOpps = (workspace.opportunities || []).filter(
    (o) =>
      !o.archived &&
      !o.isSampleRecord &&
      !entityBelongsToForeignUser(o, ownerUid)
  );

  const documentedBridges: DocumentedOpportunityBridge[] = savedOpps.map((opp) => {
    const fit = explainOpportunityFitWithGraph(opp, workspace, ownerUid);
    const sharedVerifiedSkills = Array.from(
      new Set(
        fit.requirementPaths
          .filter(
            (r) =>
              r.supportKind === "verified_experience" ||
              r.supportKind === "transferable_experience"
          )
          .flatMap((r) => r.skills.map((s) => s.label))
      )
    );
    const trainingSupportedSkills = Array.from(
      new Set(
        fit.requirementPaths
          .filter((r) => r.supportKind === "training_only_not_experience")
          .flatMap((r) => r.skills.map((s) => s.label))
      )
    );
    const openGapSkills = Array.from(
      new Set(
        fit.requirementPaths
          .filter(
            (r) =>
              r.supportKind === "gap_incomplete_path" ||
              r.supportKind === "suggested_unverified"
          )
          .flatMap((r) => r.skills.map((s) => s.label))
      )
    );

    const traceableSummary =
      sharedVerifiedSkills.length > 0
        ? `Documented connection via ${sharedVerifiedSkills.join(", ")}${
            openGapSkills.length > 0
              ? `; incomplete path on ${openGapSkills.join(", ")}.`
              : "."
          }`
        : "Incomplete path: No verified experience skills overlap with this saved opportunity yet.";

    return {
      opportunityId: opp.id,
      title: opp.title,
      employer: opp.employer,
      sharedVerifiedSkills,
      trainingSupportedSkills,
      openGapSkills,
      traceableSummary,
    };
  });

  // 2. Speculative adjacent role families derived ONLY from the active user's confirmed skills
  const speculativeMap = new Map<string, SpeculativeAdjacentDirection>();

  for (const taxonomyItem of CANONICAL_SKILL_TAXONOMY) {
    const skillId = `skill-${taxonomyItem.slug}`;
    if (!confirmedSkillIds.has(skillId)) continue;

    const matchingEdges = confirmedSkillEdges.filter(
      (e) => e.targetId === skillId
    );
    const claimSnippets = Array.from(
      new Set(
        matchingEdges.flatMap((e) =>
          e.accessibleEvidence.map((ev) => summarizeEvidenceLabel(ev.claimText))
        )
      )
    );

    for (const adj of taxonomyItem.adjacentRoleFamilies) {
      const key = adj.roleTitle.toLowerCase();
      const existing = speculativeMap.get(key);
      if (existing) {
        if (!existing.groundedInSkills.includes(taxonomyItem.label)) {
          existing.groundedInSkills.push(taxonomyItem.label);
        }
        for (const c of claimSnippets) {
          if (!existing.supportingEvidenceClaims.includes(c)) {
            existing.supportingEvidenceClaims.push(c);
          }
        }
      } else {
        speculativeMap.set(key, {
          id: `spec-${slugifyGraphToken(adj.roleTitle, "role")}`,
          roleTitle: adj.roleTitle,
          sectorContext: adj.sectorContext,
          isSpeculative: true,
          speculativeLabel:
            "Speculative suggestion — does not imply live openings, referrals, or guaranteed fit",
          groundedInSkills: [taxonomyItem.label],
          supportingEvidenceClaims: claimSnippets,
          rationale: adj.rationale,
          verificationNextStep:
            "Search official employer career pages to verify real openings, guaranteed base pay, and location eligibility before pursuing.",
        });
      }
    }
  }

  return {
    documentedBridges,
    speculativeSuggestions: Array.from(speculativeMap.values()),
  };
}
