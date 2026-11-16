/**
 * Evidence Relationship Graph — Acceptance & Multi-User Isolation Suite
 *
 * Executes automated checks verifying all 6 mandatory acceptance criteria:
 *   1. Nora’s evidence never appears in Harry’s recommendations (engine + HTTP backend).
 *   2. Unsupported relationships remain suggestions (including claimed affiliations).
 *   3. Removing access to evidence prevents its subsequent retrieval & downgrades dependent edges.
 *   4. Training does not become claimed job experience.
 *   5. Counts match the underlying saved opportunities (Required vs. Preferred, excluding archived/sample).
 *   6. Every explanation has a traceable evidence path or states that the path is incomplete
 *      (plus tuple validation, duplicate prevention, and rejected-suggestion stickiness).
 */

import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  AtomicDocWriteSpec,
  FirestoreBackendAdapter,
  FirestoreDocResult,
  VerifiedJwtClaims,
  createCareerLaunchExpressApp,
} from "../server";
import {
  ISOLATED_SAMPLE_OPPORTUNITIES,
  createStarterWorkspaceState,
} from "../src/data/initialData";
import {
  Contact,
  Evidence,
  Opportunity,
  PrivateDocumentMeta,
  WorkspaceState,
} from "../src/types/models";
import {
  buildEmployerId,
  explainOpportunityFitWithGraph,
  exploreAdjacentWorkFromGraph,
  prioritizeSkillsAcrossSavedOpportunities,
  resolveAccessibleWorkspaceGraph,
  validateRelationshipEdgeCandidate,
} from "../src/utils/relationshipGraphEngine";

const GRAPH_PRINCIPALS: Record<string, VerifiedJwtClaims> = {
  "token-nora": {
    sub: "uid_nora",
    email: "nora.crafts@example.com",
    email_verified: true,
    name: "Nora Crafts",
  },
  "token-harry": {
    sub: "uid_harry",
    email: "harry.crafts@example.com",
    email_verified: true,
    name: "Harry Crafts III",
  },
  "token-admin": {
    sub: "uid_admin",
    email: "hmcrafts@craftsconsulting.com",
    email_verified: true,
    name: "H. M. Crafts",
  },
};

function buildHarryWorkspace(): WorkspaceState {
  const base = createStarterWorkspaceState();
  return {
    ...base,
    profile: {
      ...base.profile,
      id: "uid_harry",
      fullName: "Harry Crafts III",
      location: "Chicago, Illinois",
      educationSummary: "B.S. in Supply Chain Management, DePaul University",
      rbtCertificationStatus: "unverified",
      rbtCertificationNote: "",
      littleLeavesSoftwareUsed: "",
      otherExperienceNotes: "",
      masterResumeText:
        "HARRY CRAFTS III\nLogistics Coordinator — Coordinated regional freight schedules and vendor SLAs.",
      profileVerifiedByNora: true,
    },
    evidence: [
      {
        id: "ev-harry-logistics-1",
        claimText:
          "Coordinated regional freight dispatch schedules and tracked vendor SLA compliance across 14 distribution routes.",
        category: "demonstrated_skill",
        sourceDocumentOrConfirmation: "Confirmed by Harry's logistics resume",
        sourceExcerpt: "Coordinated regional freight dispatch schedules and tracked vendor SLA compliance.",
        verificationStatus: "Confirmed by Nora",
        dateAdded: "2026-11-15",
        mayUseInApplications: true,
        tags: ["logistics", "vendor", "scheduling"],
      },
    ],
    opportunities: [
      {
        ...base.opportunities[0],
        id: "opp-harry-ops-1",
        title: "Regional Supply Chain Coordinator",
        employer: "Midwest Freight Partners",
        location: "Chicago, IL (Hybrid)",
        commuteAndScheduleNotes: "Chicago Loop hybrid schedule, 25 minutes by Metra.",
        requiredQualifications: [
          "Experience coordinating freight schedules and vendor SLAs",
          "Hands-on SAP ERP administration experience",
        ],
        preferredQualifications: [
          "Salesforce CRM activity logging familiarity",
        ],
        authenticityFlags: [],
      },
    ],
    assessments: [],
    contacts: [],
    learningItems: [
      {
        id: "learn-harry-sap",
        title: "SAP ERP Inventory Navigation Basics",
        tiedToRequirement: "Hands-on SAP ERP administration experience",
        linkedOpportunityId: "opp-harry-ops-1",
        status: "Completed",
        estimatedHours: 3,
        practicalExercise: "Complete intro SAP navigation walkthrough.",
        honestFramingNote:
          "Self-study only — never claim as paid SAP administration work.",
      },
    ],
    documents: [],
    relationships: [],
  };
}

function createGraphFirestoreAdapter(
  noraWs: WorkspaceState,
  harryWs: WorkspaceState
): FirestoreBackendAdapter {
  const docs = new Map<string, Record<string, unknown>>();

  const seedWorkspace = (uid: string, ws: WorkspaceState) => {
    docs.set(`users/${uid}`, {
      id: uid,
      userId: uid,
      fullName: ws.profile.fullName,
      location: ws.profile.location,
      educationSummary: ws.profile.educationSummary,
      constraints: ws.profile.constraints,
    });
    for (const ev of ws.evidence) {
      docs.set(`users/${uid}/evidence/${ev.id}`, { ...ev, userId: uid });
    }
    for (const opp of ws.opportunities) {
      docs.set(`users/${uid}/opportunities/${opp.id}`, { ...opp, userId: uid });
    }
    for (const learn of ws.learningItems) {
      docs.set(`users/${uid}/learningItems/${learn.id}`, {
        ...learn,
        userId: uid,
      });
    }
    for (const rel of ws.relationships || []) {
      docs.set(`users/${uid}/relationships/${rel.id}`, { ...rel, userId: uid });
    }
  };

  seedWorkspace("uid_nora", noraWs);
  seedWorkspace("uid_harry", harryWs);
  docs.set("admins/uid_admin", { id: "uid_admin", uid: "uid_admin" });

  return {
    async getDoc(relativePath: string): Promise<FirestoreDocResult> {
      const clean = relativePath.replace(/^\/+/, "");
      const found = docs.get(clean);
      return {
        exists: Boolean(found),
        status: found ? 200 : 404,
        data: found ? structuredClone(found) : {},
        updateTime: new Date().toISOString(),
      };
    },
    async atomicCommit(_writes: AtomicDocWriteSpec[]) {
      return { ok: true, status: 200, errorSummary: "" };
    },
    async runAdminListQuery() {
      return { ok: true, status: 200, docs: [] };
    },
    async runOwnerSubcollectionQuery(uid: string, subcollectionId: string) {
      const prefix = `users/${uid}/${subcollectionId}/`;
      const matched: Array<Record<string, unknown>> = [];
      for (const [k, v] of docs.entries()) {
        if (k.startsWith(prefix) && v.userId === uid) {
          matched.push(structuredClone(v));
        }
      }
      return { ok: true, status: 200, docs: matched };
    },
  };
}

describe("Evidence Relationship Graph — Acceptance Tests 1 through 6", () => {
  let server: http.Server;
  let baseUrl = "";
  const noraStarter = createStarterWorkspaceState();
  const harryStarter = buildHarryWorkspace();

  before(async () => {
    const app = createCareerLaunchExpressApp({
      projectId: "europe26-graph-test",
      verifyJwtToken: async (token: string) => {
        const claims = GRAPH_PRINCIPALS[token];
        if (!claims) throw new Error("Invalid JWT");
        return claims;
      },
      firestoreAdapter: createGraphFirestoreAdapter(noraStarter, harryStarter),
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // ==========================================================================
  // ACCEPTANCE TEST 1: Nora's evidence never appears in Harry's recommendations
  // ==========================================================================
  it("Acceptance Test 1: Nora's evidence never appears in Harry's recommendations (engine + HTTP backend)", async () => {
    // Even if a foreign record were accidentally present in memory with userId="uid_nora",
    // Harry's graph resolver, fit explainer, skill prioritizer, and adjacent-work explorer reject it.
    const contaminatedHarry: WorkspaceState = {
      ...structuredClone(harryStarter),
      evidence: [
        ...structuredClone(harryStarter.evidence),
        {
          ...structuredClone(noraStarter.evidence[1]), // Little Leaves RBT
          userId: "uid_nora",
        } as Evidence & { userId: string },
      ],
    };

    const harryGraph = resolveAccessibleWorkspaceGraph(
      contaminatedHarry,
      "uid_harry"
    );
    const harryFit = explainOpportunityFitWithGraph(
      contaminatedHarry.opportunities[0],
      contaminatedHarry,
      "uid_harry"
    );
    const harrySkills = prioritizeSkillsAcrossSavedOpportunities(
      contaminatedHarry,
      "uid_harry"
    );
    const harryAdjacent = exploreAdjacentWorkFromGraph(
      contaminatedHarry,
      "uid_harry"
    );

    const serializedBundle = JSON.stringify({
      harryGraph,
      harryFit,
      harrySkills,
      harryAdjacent,
    });

    assert.equal(serializedBundle.includes("Little Leaves"), false);
    assert.equal(serializedBundle.includes("George Mason"), false);
    assert.equal(serializedBundle.includes("RethinkBH"), false);
    assert.equal(serializedBundle.includes("ev-little-leaves-aba"), false);

    // Backend HTTP verification: Harry fetches his own graph -> zero Nora bleed
    const harryHttpResp = await fetch(
      `${baseUrl}/api/workspace/uid_harry/graph?opportunityId=opp-harry-ops-1`,
      {
        headers: { Authorization: "Bearer token-harry" },
      }
    );
    assert.equal(harryHttpResp.status, 200);
    const harryHttpText = await harryHttpResp.text();
    assert.equal(harryHttpText.includes("Little Leaves"), false);
    assert.equal(harryHttpText.includes("George Mason"), false);
    assert.equal(harryHttpText.includes("Midwest Freight Partners"), true);

    // Cross-user graph read & Admin snooping on Nora's graph -> HTTP 403
    const harryReadsNoraGraph = await fetch(
      `${baseUrl}/api/workspace/uid_nora/graph`,
      {
        headers: { Authorization: "Bearer token-harry" },
      }
    );
    assert.equal(harryReadsNoraGraph.status, 403);

    const adminReadsNoraGraph = await fetch(
      `${baseUrl}/api/workspace/uid_nora/graph`,
      {
        headers: { Authorization: "Bearer token-admin" },
      }
    );
    assert.equal(adminReadsNoraGraph.status, 403);

    // Harry attempting to create a relationship referencing Nora's evidence ID -> HTTP 403
    const crossUserEdgeAttempt = await fetch(
      `${baseUrl}/api/workspace/uid_harry/relationships/validate`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-harry",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "create",
          candidate: {
            sourceType: "experience",
            sourceId: "exp-ev-harry-logistics-1",
            sourceLabel: "Harry Logistics",
            targetType: "skill",
            targetId: "skill-aba-clinical-delivery",
            targetLabel: "ABA Delivery",
            relationshipType: "demonstrates",
            evidenceIds: ["ev-little-leaves-aba"], // Nora's private evidence!
            status: "confirmed",
            origin: "user",
          },
        }),
      }
    );
    assert.equal(crossUserEdgeAttempt.status, 403);
    const crossBody = (await crossUserEdgeAttempt.json()) as {
      valid: boolean;
      errorCode: string;
    };
    assert.equal(crossBody.valid, false);
    assert.equal(crossBody.errorCode, "INACCESSIBLE_EVIDENCE_REFERENCE");
  });

  // ==========================================================================
  // ACCEPTANCE TEST 2: Unsupported relationships remain suggestions
  // ==========================================================================
  it("Acceptance Test 2: Unsupported relationships and claimed affiliations remain suggestions", () => {
    const ws = structuredClone(harryStarter);
    const unverifiedEv: Evidence = {
      id: "ev-unverified-claim",
      claimText: "Possibly helped with CRM lead imports during summer internship.",
      category: "transferable_experience",
      sourceDocumentOrConfirmation: "Unverified rough note",
      sourceExcerpt: "",
      verificationStatus: "Needs clarification",
      dateAdded: "2026-11-15",
      mayUseInApplications: false,
      tags: ["crm"],
    };
    const unverifiedContact: Contact = {
      id: "con-unverified-1",
      name: "Jordan Example",
      organization: "Midwest Freight Partners",
      role: "Operations Lead",
      roleVerified: false,
      relationship: "Found via public post",
      source: "Public post",
      contactChannelNote: "Public LinkedIn profile",
      lastContactDate: "",
      nextAction: "",
      nextActionDueDate: "",
      replyStatus: "Not contacted yet",
      doNotContact: false,
      linkedOpportunityId: "opp-harry-ops-1",
      notes: "",
    };
    ws.evidence.push(unverifiedEv);
    ws.contacts.push(unverifiedContact);

    // 1. Derived edges from unverified evidence & unverified contacts are strictly 'suggested'
    const graph = resolveAccessibleWorkspaceGraph(ws, "uid_harry");
    const unverifiedDemoEdge = graph.edges.find(
      (e) =>
        e.sourceId === "exp-ev-unverified-claim" &&
        e.relationshipType === "demonstrates"
    );
    assert.ok(unverifiedDemoEdge);
    assert.equal(unverifiedDemoEdge.effectiveStatus, "suggested");
    assert.equal(unverifiedDemoEdge.evidencePathComplete, false);

    const claimedAffiliationEdge = graph.edges.find(
      (e) =>
        e.sourceId === "con-unverified-1" &&
        e.relationshipType === "claims_affiliation_with"
    );
    assert.ok(claimedAffiliationEdge);
    assert.equal(claimedAffiliationEdge.effectiveStatus, "suggested");

    // 2. Attempting to confirm an unsupported relationship is rejected in strict mode
    const confirmWithoutSupport = validateRelationshipEdgeCandidate(
      {
        userId: "uid_harry",
        sourceType: "experience",
        sourceId: "exp-ev-unverified-claim",
        sourceLabel: "Unverified CRM note",
        targetType: "skill",
        targetId: "skill-crm-pipeline-hygiene",
        targetLabel: "Salesforce / CRM Pipeline Tracking",
        relationshipType: "demonstrates",
        evidenceIds: ["ev-unverified-claim"],
        status: "confirmed",
        origin: "user",
      },
      ws,
      "uid_harry",
      [],
      { mode: "create", strictConfirmCheck: true }
    );
    assert.equal(confirmWithoutSupport.valid, false);
    assert.equal(
      confirmWithoutSupport.errorCode,
      "UNSUPPORTED_RELATIONSHIP_REMAINS_SUGGESTION"
    );

    // 3. Attempting to mark 'claims_affiliation_with' as 'confirmed' is strictly rejected
    const confirmClaimedAffiliation = validateRelationshipEdgeCandidate(
      {
        userId: "uid_harry",
        sourceType: "contact",
        sourceId: "con-unverified-1",
        sourceLabel: "Jordan Example",
        targetType: "employer",
        targetId: buildEmployerId("Midwest Freight Partners"),
        targetLabel: "Midwest Freight Partners",
        relationshipType: "claims_affiliation_with",
        evidenceIds: [],
        status: "confirmed",
        origin: "user",
      },
      ws,
      "uid_harry",
      [],
      { mode: "create", strictConfirmCheck: true }
    );
    assert.equal(confirmClaimedAffiliation.valid, false);
    assert.equal(
      confirmClaimedAffiliation.errorCode,
      "CLAIMED_AFFILIATION_CANNOT_BE_CONFIRMED"
    );
  });

  // ==========================================================================
  // ACCEPTANCE TEST 3: Removing access to evidence prevents its subsequent retrieval
  // ==========================================================================
  it("Acceptance Test 3: Removing access to evidence or its backing private document prevents retrieval and downgrades dependent edges", () => {
    const ws = structuredClone(harryStarter);
    const privateDoc: PrivateDocumentMeta = {
      id: "doc-sap-cert-1",
      userId: "uid_harry",
      fileName: "harry-warehouse-erp-letter.txt",
      mimeType: "text/plain",
      byteSize: 1024,
      docCategory: "supporting_document",
      linkedOpportunityId: "opp-harry-ops-1",
      storageRef: "users/uid_harry/documentBlobs/doc-sap-cert-1",
      sha256: "a".repeat(64),
      createdAtIso: "2026-11-15T12:00:00.000Z",
    };
    const docBackedEvidence: Evidence = {
      id: "ev-harry-sap-docbacked",
      claimText:
        "Maintained SAP ERP shipment records during peak distribution season.",
      category: "demonstrated_skill",
      sourceDocumentOrConfirmation: "Uploaded warehouse letter",
      sourceDocumentId: "doc-sap-cert-1",
      sourceExcerpt: "Maintained SAP ERP shipment records.",
      verificationStatus: "Supported by uploaded document",
      dateAdded: "2026-11-15",
      mayUseInApplications: true,
      tags: ["sap", "erp"],
    };
    ws.documents = [privateDoc];
    ws.evidence.push(docBackedEvidence);

    // Persist an explicit confirmed edge backed by ev-harry-sap-docbacked
    const validated = validateRelationshipEdgeCandidate(
      {
        userId: "uid_harry",
        sourceType: "experience",
        sourceId: "exp-ev-harry-logistics-1",
        sourceLabel: "Harry Logistics Coordinator",
        targetType: "skill",
        targetId: "skill-erp-sap-administration",
        targetLabel: "Enterprise ERP / SAP Administration",
        relationshipType: "demonstrates",
        evidenceIds: ["ev-harry-sap-docbacked"],
        status: "confirmed",
        origin: "user",
      },
      ws,
      "uid_harry",
      [],
      { mode: "create", strictConfirmCheck: true }
    );
    assert.equal(validated.valid, true);
    ws.relationships = [validated.normalizedEdge!];

    // Before revocation: SAP requirement has a complete verified path
    const fitBefore = explainOpportunityFitWithGraph(
      ws.opportunities[0],
      ws,
      "uid_harry"
    );
    const sapBefore = fitBefore.requirementPaths.find((r) =>
      r.requirementText.includes("SAP")
    );
    assert.ok(sapBefore);
    assert.equal(sapBefore.supportKind, "verified_experience");
    assert.equal(sapBefore.pathComplete, true);

    // Revoke access to the backing private document (delete privateDoc from workspace.documents)
    const wsAfterDocRemoved: WorkspaceState = {
      ...ws,
      documents: [],
    };

    const graphAfter = resolveAccessibleWorkspaceGraph(
      wsAfterDocRemoved,
      "uid_harry"
    );
    // Removed document-backed evidence is NEVER retrieved on any resolved edge
    for (const edge of graphAfter.edges) {
      assert.equal(edge.evidenceIds.includes("ev-harry-sap-docbacked"), false);
      assert.equal(
        edge.accessibleEvidence.some((e) => e.id === "ev-harry-sap-docbacked"),
        false
      );
    }

    // Previously confirmed persisted edge was downgraded to 'suggested' with incomplete path!
    const downgradedEdge = graphAfter.edges.find(
      (e) => e.id === validated.normalizedEdge!.id
    );
    assert.ok(downgradedEdge);
    assert.equal(downgradedEdge.effectiveStatus, "suggested");
    assert.equal(downgradedEdge.evidencePathComplete, false);

    // Fit explanation no longer claims verified SAP experience (falls back to training-only item)
    const fitAfter = explainOpportunityFitWithGraph(
      wsAfterDocRemoved.opportunities[0],
      wsAfterDocRemoved,
      "uid_harry"
    );
    const sapAfter = fitAfter.requirementPaths.find((r) =>
      r.requirementText.includes("SAP")
    );
    assert.ok(sapAfter);
    assert.notEqual(sapAfter.supportKind, "verified_experience");
    assert.equal(
      sapAfter.supportingEvidence.some((e) => e.id === "ev-harry-sap-docbacked"),
      false
    );
  });

  // ==========================================================================
  // ACCEPTANCE TEST 4: Training does not become claimed job experience
  // ==========================================================================
  it("Acceptance Test 4: Course completion and training never become claimed job experience", () => {
    const ws = structuredClone(harryStarter);
    ws.evidence.push({
      id: "ev-completed-crm-course",
      claimText: "Completed 4-hour introductory Salesforce CRM online course.",
      category: "completed_training",
      sourceDocumentOrConfirmation: "Course completion certificate",
      sourceExcerpt: "Completed introductory Salesforce CRM course.",
      verificationStatus: "Confirmed by Nora",
      dateAdded: "2026-11-15",
      mayUseInApplications: true,
      tags: ["salesforce", "crm"],
    });

    // 1. Attempting to save a completed training item as Experience -> demonstrates -> Skill is rejected
    const badAttemptFromCourseEv = validateRelationshipEdgeCandidate(
      {
        userId: "uid_harry",
        sourceType: "experience",
        sourceId: "exp-ev-completed-crm-course",
        sourceLabel: "Completed Salesforce course",
        targetType: "skill",
        targetId: "skill-crm-pipeline-hygiene",
        targetLabel: "Salesforce / CRM Pipeline Tracking",
        relationshipType: "demonstrates",
        evidenceIds: ["ev-completed-crm-course"],
        status: "confirmed",
        origin: "user",
      },
      ws,
      "uid_harry",
      [],
      { mode: "create", strictConfirmCheck: true }
    );
    assert.equal(badAttemptFromCourseEv.valid, false);
    assert.equal(
      badAttemptFromCourseEv.errorCode,
      "TRAINING_CANNOT_CLAIM_EXPERIENCE"
    );

    // 2. Attempting to save a LearningItem ID as Experience -> demonstrates -> Skill is rejected
    const badAttemptFromLearnItem = validateRelationshipEdgeCandidate(
      {
        userId: "uid_harry",
        sourceType: "experience",
        sourceId: "learn-harry-sap",
        sourceLabel: "SAP ERP Inventory Navigation Basics",
        targetType: "skill",
        targetId: "skill-erp-sap-administration",
        targetLabel: "Enterprise ERP / SAP Administration",
        relationshipType: "demonstrates",
        evidenceIds: [],
        status: "suggested",
        origin: "user",
      },
      ws,
      "uid_harry",
      [],
      { mode: "create" }
    );
    assert.equal(badAttemptFromLearnItem.valid, false);
    assert.equal(
      badAttemptFromLearnItem.errorCode,
      "TRAINING_CANNOT_CLAIM_EXPERIENCE"
    );

    // 3. In "Why this fits", completed courses map strictly to 'training_only_not_experience' (pathComplete: false)
    const fit = explainOpportunityFitWithGraph(
      ws.opportunities[0],
      ws,
      "uid_harry"
    );
    const crmPath = fit.requirementPaths.find((r) =>
      r.requirementText.includes("Salesforce")
    );
    assert.ok(crmPath);
    assert.equal(crmPath.supportKind, "training_only_not_experience");
    assert.equal(crmPath.pathComplete, false);

    // 4. In "Skills worth developing", completed training remains 'training_only_not_experience', never 'demonstrated_experience'
    const skills = prioritizeSkillsAcrossSavedOpportunities(ws, "uid_harry");
    const crmSkill = skills.find(
      (s) => s.skillId === "skill-crm-pipeline-hygiene"
    );
    assert.ok(crmSkill);
    assert.equal(crmSkill.coverageState, "training_only_not_experience");
    assert.equal(crmSkill.worthDeveloping, true);
  });

  // ==========================================================================
  // ACCEPTANCE TEST 5: Counts match the underlying saved opportunities
  // ==========================================================================
  it("Acceptance Test 5: Skill counts match the exact saved opportunities and separate Required from Preferred", () => {
    const ws = structuredClone(harryStarter);

    const opp2: Opportunity = {
      ...ws.opportunities[0],
      id: "opp-harry-ops-2",
      title: "Client Operations Associate",
      employer: "Great Lakes Distribution",
      requiredQualifications: [
        "Salesforce CRM pipeline tracking and daily activity logging",
      ],
      preferredQualifications: [
        "Hands-on SAP ERP administration experience",
      ],
      archived: false,
      isSampleRecord: false,
    };

    const archivedOpp: Opportunity = {
      ...ws.opportunities[0],
      id: "opp-harry-archived",
      title: "Archived Role",
      employer: "Old Employer",
      requiredQualifications: [
        "Salesforce CRM pipeline tracking",
        "Hands-on SAP ERP administration",
      ],
      archived: true,
      isSampleRecord: false,
    };

    const sampleOpp: Opportunity = {
      ...ISOLATED_SAMPLE_OPPORTUNITIES[0],
      isSampleRecord: true,
    };

    ws.opportunities.push(opp2, archivedOpp, sampleOpp);

    const prioritized = prioritizeSkillsAcrossSavedOpportunities(ws, "uid_harry");
    assert.ok(prioritized.length > 0);

    for (const item of prioritized) {
      // Exact count invariant against underlying opportunities array
      assert.equal(item.totalOpportunityCount, item.opportunities.length);
      assert.equal(
        item.requiredOpportunityCount,
        item.opportunities.filter((o) => o.hasRequired).length
      );
      assert.equal(
        item.preferredOpportunityCount,
        item.opportunities.filter((o) => o.hasPreferred).length
      );
      assert.equal(
        item.preferredOnlyOpportunityCount,
        item.opportunities.filter((o) => !o.hasRequired && o.hasPreferred).length
      );

      // Archived and sample opportunities never inflate counts
      for (const oppEntry of item.opportunities) {
        assert.notEqual(oppEntry.opportunityId, "opp-harry-archived");
        assert.equal(
          ISOLATED_SAMPLE_OPPORTUNITIES.some(
            (s) => s.id === oppEntry.opportunityId
          ),
          false
        );
      }
    }

    // Verify specific Required vs Preferred split on CRM & SAP across opp-1 and opp-2:
    // CRM is Preferred in opp-1 and Required in opp-2 -> total 2, required 1, preferred 1
    const crmRec = prioritized.find(
      (s) => s.skillId === "skill-crm-pipeline-hygiene"
    );
    assert.ok(crmRec);
    assert.equal(crmRec.totalOpportunityCount, 2);
    assert.equal(crmRec.requiredOpportunityCount, 1);
    assert.equal(crmRec.preferredOpportunityCount, 1);

    // SAP is Required in opp-1 and Preferred in opp-2 -> total 2, required 1, preferred 1
    const sapRec = prioritized.find(
      (s) => s.skillId === "skill-erp-sap-administration"
    );
    assert.ok(sapRec);
    assert.equal(sapRec.totalOpportunityCount, 2);
    assert.equal(sapRec.requiredOpportunityCount, 1);
    assert.equal(sapRec.preferredOpportunityCount, 1);
  });

  // ==========================================================================
  // ACCEPTANCE TEST 6: Traceable evidence paths, incomplete-path honesty, tuple/duplicate/rejection validation
  // ==========================================================================
  it("Acceptance Test 6: Every explanation has a traceable evidence path or states that the path is incomplete, and validation locks rejected suggestions", () => {
    const noraFit = explainOpportunityFitWithGraph(
      noraStarter.opportunities[0],
      noraStarter,
      "uid_nora"
    );

    assert.ok(noraFit.requirementPaths.length > 0);
    for (const pathItem of noraFit.requirementPaths) {
      if (pathItem.pathComplete) {
        assert.ok(
          pathItem.supportingEdges.length > 0,
          `Complete path "${pathItem.requirementText}" must cite supportingEdges`
        );
        assert.ok(
          pathItem.supportingEvidence.length > 0,
          `Complete path "${pathItem.requirementText}" must cite accessible supportingEvidence`
        );
      } else {
        assert.match(
          pathItem.pathSummary,
          /Incomplete/i,
          `Incomplete path "${pathItem.requirementText}" must explicitly disclose that the path is incomplete`
        );
      }
    }

    // Adjacent work labels speculative suggestions explicitly and never invents contacts or availability
    const noraAdjacent = exploreAdjacentWorkFromGraph(noraStarter, "uid_nora");
    assert.ok(noraAdjacent.documentedBridges.length >= 1);
    assert.ok(noraAdjacent.speculativeSuggestions.length >= 1);
    for (const spec of noraAdjacent.speculativeSuggestions) {
      assert.equal(spec.isSpeculative, true);
      assert.match(spec.speculativeLabel, /Speculative suggestion/i);
      assert.ok(spec.groundedInSkills.length > 0);
    }

    // Invalid entity/relationship combination is rejected
    const invalidTuple = validateRelationshipEdgeCandidate(
      {
        userId: "uid_nora",
        sourceType: "contact",
        sourceId: "con-1",
        sourceLabel: "Contact",
        targetType: "skill",
        targetId: "skill-aba-clinical-delivery",
        targetLabel: "ABA",
        relationshipType: "demonstrates",
        status: "suggested",
        origin: "user",
      },
      noraStarter,
      "uid_nora",
      [],
      { mode: "create" }
    );
    assert.equal(invalidTuple.valid, false);
    assert.equal(invalidTuple.errorCode, "INVALID_ENTITY_RELATIONSHIP_TUPLE");

    // Duplicate prevention & sticky rejected suggestion unless explicit new evidence is introduced
    const ws = structuredClone(harryStarter);
    const firstCreate = validateRelationshipEdgeCandidate(
      {
        userId: "uid_harry",
        sourceType: "experience",
        sourceId: "exp-ev-harry-logistics-1",
        sourceLabel: "Harry Logistics",
        targetType: "skill",
        targetId: "skill-vendor-sla-logistics",
        targetLabel: "Vendor Management & SLA Tracking",
        relationshipType: "demonstrates",
        evidenceIds: ["ev-harry-logistics-1"],
        status: "suggested",
        origin: "ai_suggestion",
      },
      ws,
      "uid_harry",
      [],
      { mode: "create" }
    );
    assert.equal(firstCreate.valid, true);

    const duplicateCreate = validateRelationshipEdgeCandidate(
      {
        userId: "uid_harry",
        sourceType: "experience",
        sourceId: "exp-ev-harry-logistics-1",
        sourceLabel: "Harry Logistics",
        targetType: "skill",
        targetId: "skill-vendor-sla-logistics",
        targetLabel: "Vendor Management & SLA Tracking",
        relationshipType: "demonstrates",
        evidenceIds: ["ev-harry-logistics-1"],
        status: "suggested",
        origin: "user",
      },
      ws,
      "uid_harry",
      [firstCreate.normalizedEdge!],
      { mode: "create" }
    );
    assert.equal(duplicateCreate.valid, false);
    assert.equal(duplicateCreate.errorCode, "DUPLICATE_RELATIONSHIP");

    // Reject the suggestion
    const rejectedUpdate = validateRelationshipEdgeCandidate(
      {
        ...firstCreate.normalizedEdge!,
        status: "rejected",
      },
      ws,
      "uid_harry",
      [firstCreate.normalizedEdge!],
      { mode: "update" }
    );
    assert.equal(rejectedUpdate.valid, true);
    assert.equal(rejectedUpdate.normalizedEdge!.status, "rejected");

    // Re-promoting without new evidence fails with REJECTED_SUGGESTION_LOCKED
    const reopenWithoutNewEv = validateRelationshipEdgeCandidate(
      {
        ...rejectedUpdate.normalizedEdge!,
        status: "suggested",
      },
      ws,
      "uid_harry",
      [rejectedUpdate.normalizedEdge!],
      { mode: "update", explicitNewEvidence: false }
    );
    assert.equal(reopenWithoutNewEv.valid, false);
    assert.equal(reopenWithoutNewEv.errorCode, "REJECTED_SUGGESTION_LOCKED");

    // Add genuinely new accessible evidence to Harry's workspace and explicitly reconsider -> succeeds!
    ws.evidence.push({
      id: "ev-harry-logistics-2-new",
      claimText:
        "Signed annual vendor carrier performance reviews across 14 freight lanes.",
      category: "demonstrated_skill",
      sourceDocumentOrConfirmation: "Performance evaluation",
      sourceExcerpt: "Signed annual vendor carrier performance reviews.",
      verificationStatus: "Confirmed by Nora",
      dateAdded: "2026-11-15",
      mayUseInApplications: true,
      tags: ["vendor", "sla"],
    });

    const reopenWithNewEv = validateRelationshipEdgeCandidate(
      {
        ...rejectedUpdate.normalizedEdge!,
        evidenceIds: ["ev-harry-logistics-1", "ev-harry-logistics-2-new"],
        status: "confirmed",
      },
      ws,
      "uid_harry",
      [rejectedUpdate.normalizedEdge!],
      { mode: "update", explicitNewEvidence: true, strictConfirmCheck: true }
    );
    assert.equal(reopenWithNewEv.valid, true);
    assert.equal(reopenWithNewEv.normalizedEdge!.status, "confirmed");
  });
});
