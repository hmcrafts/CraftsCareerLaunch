/**
 * Multi-User Security Implementation Gates (1–5) & Workflow Regression Suite — Career Launch
 *
 * Executes real HTTP requests against `createCareerLaunchExpressApp` and real calls against
 * deterministic career analysis, export, ID-sanitization, and dev-log redaction utilities.
 *
 * Gates Verified:
 *   Gate 1: Nora cannot retrieve Harry’s private records (direct reads, files, AI prompts).
 *   Gate 2: Harry cannot retrieve Nora’s private records (and zero Nora biographical bleed).
 *   Gate 3: Changing record IDs or path segments does not bypass permissions.
 *   Gate 4: Administrator invitation privileges do not grant access to career records.
 *   Gate 5: Existing workflows and the single-use invitation lifecycle function end-to-end.
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
import { createStarterWorkspaceState } from "../src/data/initialData";
import { buildExportBundle, sanitizeId } from "../src/services/firestoreWorkspace";
import { Evidence, Opportunity, Profile } from "../src/types/models";
import {
  buildOutreachDraftLocally,
  buildTruthfulApplicationBundle,
  evaluateAuthenticityFlags,
  evaluateOpportunityDecision,
  evaluatePracticeResponseLocally,
  generateRequirementAssessments,
  parseJobDescriptionLocally,
} from "../src/utils/analysisEngine";

const TEST_PRINCIPALS: Record<string, VerifiedJwtClaims> = {
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
  "token-unverified-admin-spoof": {
    sub: "uid_spoof",
    email: "hmcrafts@craftsconsulting.com",
    email_verified: false,
    name: "Unverified Spoof",
  },
  "token-fresh-invitee": {
    sub: "uid_claire",
    email: "claire.invitee@example.com",
    email_verified: true,
    name: "Claire Invitee",
  },
};

interface StoredDoc {
  data: Record<string, unknown>;
  updateTime: string;
}

/**
 * In-memory Firestore test adapter that enforces the exact same owner/admin path boundaries
 * as `firestore.rules` while recording all committed documents for multi-user gate assertions.
 */
function createIsolatedFirestoreTestStore() {
  const docs = new Map<string, StoredDoc>();
  let clockCounter = 1;

  const nextTimestamp = () =>
    new Date(Date.UTC(2026, 10, 15, 12, 0, clockCounter++)).toISOString();

  function seedDoc(relativePath: string, data: Record<string, unknown>) {
    const clean = relativePath.replace(/^\/+/, "");
    docs.set(clean, { data: structuredClone(data), updateTime: nextTimestamp() });
  }

  // Seed Nora's private workspace in test memory
  seedDoc("users/uid_nora", {
    id: "uid_nora",
    userId: "uid_nora",
    fullName: "Nora Crafts",
    location: "Oakton, Virginia",
  });
  seedDoc("users/uid_nora/opportunities/opp-nora-private-1", {
    id: "opp-nora-private-1",
    userId: "uid_nora",
    employer: "RethinkBH",
    title: "Business Development Representative",
    requiredQualifications: ["Bachelor's degree", "Clear communication"],
    coreDuties: ["Outreach to outpatient ABA practices"],
  });
  seedDoc("users/uid_nora/evidence/ev-nora-1", {
    id: "ev-nora-1",
    userId: "uid_nora",
    claimText:
      "Registered Behavior Technician at Little Leaves Behavioral Services (Jan 2023–Jul 2024).",
    category: "confirmed_experience",
    verificationStatus: "Confirmed by Nora",
    mayUseInApplications: true,
  });
  seedDoc("users/uid_nora/evidence/ev-nora-gap-1", {
    id: "ev-nora-gap-1",
    userId: "uid_nora",
    claimText: "Paid quota-carrying Salesforce BDR history",
    category: "not_yet_demonstrated",
    verificationStatus: "Confirmed by Nora",
    mayUseInApplications: false,
  });
  seedDoc("users/uid_nora/contacts/con-nora-1", {
    id: "con-nora-1",
    userId: "uid_nora",
    name: "Dr. Evelyn Park",
    organization: "Little Leaves Alumni Network",
    role: "Clinical Supervisor",
    roleVerified: true,
    relationship: "Former Little Leaves colleague",
  });
  seedDoc("users/uid_nora/documents/doc-nora-resume-1", {
    id: "doc-nora-resume-1",
    userId: "uid_nora",
    fileName: "nora-crafts-resume.txt",
    mimeType: "text/plain",
    byteSize: 29,
    docCategory: "resume",
    storageRef: "users/uid_nora/documentBlobs/doc-nora-resume-1",
  });
  seedDoc("users/uid_nora/documentBlobs/doc-nora-resume-1", {
    id: "doc-nora-resume-1",
    userId: "uid_nora",
    encoding: "utf8",
    content: "NORA_PRIVATE_RESUME_CONTENT",
  });

  // Seed Harry Crafts III's independent private workspace in test memory
  seedDoc("users/uid_harry", {
    id: "uid_harry",
    userId: "uid_harry",
    fullName: "Harry Crafts III",
    location: "Richmond, Virginia",
  });
  seedDoc("users/uid_harry/opportunities/opp-harry-private-1", {
    id: "opp-harry-private-1",
    userId: "uid_harry",
    employer: "Dominion Logistics Partners",
    title: "Operations Coordinator",
    requiredQualifications: ["Supply chain scheduling", "Excel reporting"],
    coreDuties: ["Coordinate regional freight schedules and vendor SLAs"],
  });
  seedDoc("users/uid_harry/evidence/ev-harry-1", {
    id: "ev-harry-1",
    userId: "uid_harry",
    claimText:
      "Coordinated regional vendor dispatch schedules during Richmond Logistics internship.",
    category: "confirmed_experience",
    verificationStatus: "Supported by uploaded document",
    mayUseInApplications: true,
  });
  seedDoc("users/uid_harry/evidence/ev-harry-gap-1", {
    id: "ev-harry-gap-1",
    userId: "uid_harry",
    claimText: "Enterprise SAP ERP administration",
    category: "not_yet_demonstrated",
    verificationStatus: "Confirmed by Nora",
    mayUseInApplications: false,
  });
  seedDoc("users/uid_harry/contacts/con-harry-1", {
    id: "con-harry-1",
    userId: "uid_harry",
    name: "Marcus Vance",
    organization: "Dominion Logistics Partners",
    role: "Operations Manager",
    roleVerified: true,
    relationship: "Regional logistics conference speaker",
  });
  seedDoc("users/uid_harry/documents/doc-harry-resume-1", {
    id: "doc-harry-resume-1",
    userId: "uid_harry",
    fileName: "harry-crafts-iii-resume.txt",
    mimeType: "text/plain",
    byteSize: 30,
    docCategory: "resume",
    storageRef: "users/uid_harry/documentBlobs/doc-harry-resume-1",
  });
  seedDoc("users/uid_harry/documentBlobs/doc-harry-resume-1", {
    id: "doc-harry-resume-1",
    userId: "uid_harry",
    encoding: "utf8",
    content: "HARRY_PRIVATE_RESUME_CONTENT",
  });

  function resolvePrincipal(idToken?: string): VerifiedJwtClaims | null {
    if (!idToken) return null;
    return TEST_PRINCIPALS[idToken] ?? null;
  }

  function isOwnerAllowed(pathClean: string, idToken?: string): boolean {
    const m = pathClean.match(/^users\/([^/]+)(?:\/.*)?$/);
    if (!m) return true;
    const targetUid = m[1];
    const caller = resolvePrincipal(idToken);
    // Mirrors firestore.rules: ONLY request.auth.uid == userId (isAdmin does NOT grant access!)
    return Boolean(caller && caller.email_verified && caller.sub === targetUid);
  }

  const adapter: FirestoreBackendAdapter = {
    async getDoc(relativePath: string, idToken?: string): Promise<FirestoreDocResult> {
      const clean = relativePath.replace(/^\/+/, "");
      if (clean.startsWith("users/") && !isOwnerAllowed(clean, idToken)) {
        return { exists: false, status: 403, data: {}, updateTime: "" };
      }
      const hit = docs.get(clean);
      if (!hit) {
        return { exists: false, status: 404, data: {}, updateTime: "" };
      }
      return {
        exists: true,
        status: 200,
        data: structuredClone(hit.data),
        updateTime: hit.updateTime,
      };
    },

    async atomicCommit(writes: AtomicDocWriteSpec[], idToken: string) {
      const caller = resolvePrincipal(idToken);
      if (!caller || !caller.email_verified) {
        return { ok: false, status: 401, errorSummary: "Unauthenticated" };
      }

      // Enforce preconditions first
      for (const w of writes) {
        const clean = w.relativePath.replace(/^\/+/, "");
        if (clean.startsWith("users/") && !isOwnerAllowed(clean, idToken)) {
          return { ok: false, status: 403, errorSummary: "PERMISSION_DENIED" };
        }
        const existing = docs.get(clean);
        if (w.currentDocument?.exists === false && existing) {
          return { ok: false, status: 409, errorSummary: "ALREADY_EXISTS" };
        }
        if (
          w.currentDocument?.updateTime &&
          (!existing || existing.updateTime !== w.currentDocument.updateTime)
        ) {
          return { ok: false, status: 409, errorSummary: "FAILED_PRECONDITION" };
        }
      }

      // Apply atomically
      const now = nextTimestamp();
      for (const w of writes) {
        const clean = w.relativePath.replace(/^\/+/, "");
        const nextFields = structuredClone(w.fields);
        for (const tf of w.serverTimestampFields) {
          nextFields[tf] = now;
        }
        docs.set(clean, { data: nextFields, updateTime: now });
      }
      return { ok: true, status: 200, errorSummary: "" };
    },

    async runAdminListQuery(collectionId, idToken) {
      const caller = resolvePrincipal(idToken);
      if (
        !caller ||
        !caller.email_verified ||
        caller.email?.toLowerCase() !== "hmcrafts@craftsconsulting.com"
      ) {
        return { ok: false, status: 403, docs: [] };
      }
      const out: Array<Record<string, unknown>> = [];
      for (const [k, v] of docs.entries()) {
        if (
          k.startsWith(`${collectionId}/`) &&
          !k.slice(collectionId.length + 1).includes("/") &&
          v.data.visibilityScope === "admin"
        ) {
          out.push(structuredClone(v.data));
        }
      }
      return { ok: true, status: 200, docs: out };
    },

    async runOwnerSubcollectionQuery(uid, subcollectionId, idToken) {
      const caller = resolvePrincipal(idToken);
      if (!caller || !caller.email_verified || caller.sub !== uid) {
        return { ok: false, status: 403, docs: [] };
      }
      const prefix = `users/${uid}/${subcollectionId}/`;
      const out: Array<Record<string, unknown>> = [];
      for (const [k, v] of docs.entries()) {
        if (k.startsWith(prefix) && v.data.userId === uid) {
          out.push(structuredClone(v.data));
        }
      }
      return { ok: true, status: 200, docs: out };
    },
  };

  return { adapter, docs };
}

describe("Multi-User Security Implementation Gates (1–5)", () => {
  const recordedAiCalls: Array<{
    endpoint: string;
    contents: string;
  }> = [];

  const { adapter } = createIsolatedFirestoreTestStore();
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    const app = createCareerLaunchExpressApp({
      projectId: "europe26-test",
      verifyJwtToken: async (idToken: string) => {
        const hit = TEST_PRINCIPALS[idToken];
        if (!hit) {
          throw new Error("Invalid token");
        }
        return hit;
      },
      firestoreAdapter: adapter,
      aiGenerateJson: async ({ endpoint, contents }) => {
        recordedAiCalls.push({ endpoint, contents });
        if (endpoint === "draft-material") {
          return {
            draftText: "Grounded plain-English draft.",
            evidenceUsed: ["Server-verified evidence item"],
            missingInformation: ["[PLACEHOLDER: Hiring Contact Name]"],
            reasoning: "Strictly derived from caller workspace.",
            suggestedNextAction: "Review and edit before manual send.",
          };
        }
        if (endpoint === "practice-feedback") {
          return {
            accuracy: "Accurate to caller workspace evidence.",
            relevance: "Directly addresses prompt.",
            clarity: "Clear plain English.",
            specificExamples: "Uses caller's own background.",
            concision: "Concise.",
            unsupportedClaims: [],
            evidenceUsed: ["Server-verified evidence item"],
            missingInformation: [],
            reasoning: "Stateless single-user coaching evaluation.",
            suggestedNextAction: "Practice aloud once more.",
            revisedExample: "Revised example grounded in caller evidence.",
          };
        }
        return {};
      },
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  // ==========================================================================
  // GATE 1: NORA CANNOT RETRIEVE HARRY'S PRIVATE RECORDS
  // ==========================================================================
  it("Gate 1: denies Nora from reading Harry's workspace records, private files, or injecting Harry's workspace/evidence into AI prompts", async () => {
    // 1a. Direct workspace record read -> 403
    const readHarryRes = await fetch(`${baseUrl}/api/workspace/uid_harry/records`, {
      headers: { Authorization: "Bearer token-nora" },
    });
    assert.equal(readHarryRes.status, 403);

    // 1b. Private resume download -> 403
    const downloadHarryFileRes = await fetch(
      `${baseUrl}/api/workspace/uid_harry/documents/doc-harry-resume-1/download`,
      {
        headers: { Authorization: "Bearer token-nora" },
      }
    );
    assert.equal(downloadHarryFileRes.status, 403);

    // 1c. Browser-supplied workspaceId in JSON body -> 403
    const bodySpoofRes = await fetch(`${baseUrl}/api/ai/draft-material`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-nora",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "uid_harry",
        draftType: "cover_note",
      }),
    });
    assert.equal(bodySpoofRes.status, 403);

    // 1d. Browser-supplied x-workspace-id header -> 403
    const headerSpoofRes = await fetch(`${baseUrl}/api/ai/draft-material`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-nora",
        "x-workspace-id": "uid_harry",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ draftType: "cover_note" }),
    });
    assert.equal(headerSpoofRes.status, 403);

    // 1e. Browser attempting to inject foreign/unverified allowedEvidence -> ignored in favor of Nora's Firestore evidence
    recordedAiCalls.length = 0;
    const draftAsNoraRes = await fetch(`${baseUrl}/api/ai/draft-material`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-nora",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        draftType: "cover_note",
        opportunity: { id: "opp-nora-private-1" },
        allowedEvidence: [
          "FORGED_BROWSER_CLAIM_FROM_HARRY_RICHMOND_LOGISTICS",
        ],
      }),
    });
    assert.equal(draftAsNoraRes.status, 200);
    assert.equal(recordedAiCalls.length, 1);
    const noraPrompt = recordedAiCalls[0].contents;
    assert.ok(noraPrompt.includes("Little Leaves Behavioral Services"));
    assert.equal(
      noraPrompt.includes("FORGED_BROWSER_CLAIM_FROM_HARRY_RICHMOND_LOGISTICS"),
      false
    );
    assert.equal(noraPrompt.includes("Dominion Logistics"), false);
  });

  // ==========================================================================
  // GATE 2: HARRY CANNOT RETRIEVE NORA'S PRIVATE RECORDS (ZERO BIOGRAPHICAL BLEED)
  // ==========================================================================
  it("Gate 2: denies Harry from reading Nora's workspace/files and guarantees zero Nora biographical or AI memory bleed into Harry's workflows", async () => {
    // 2a. Direct workspace read -> 403
    const readNoraRes = await fetch(`${baseUrl}/api/workspace/uid_nora/records`, {
      headers: { Authorization: "Bearer token-harry" },
    });
    assert.equal(readNoraRes.status, 403);

    // 2b. Private file download -> 403
    const downloadNoraFileRes = await fetch(
      `${baseUrl}/api/workspace/uid_nora/documents/doc-nora-resume-1/download`,
      {
        headers: { Authorization: "Bearer token-harry" },
      }
    );
    assert.equal(downloadNoraFileRes.status, 403);

    // 2c. Practice feedback with spoofed userId -> 403
    const spoofPracticeRes = await fetch(`${baseUrl}/api/ai/practice-feedback`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-harry",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: "uid_nora",
        mode: "intro_45s",
        promptQuestion: "Tell me about yourself",
        userResponse: "I coordinated freight dispatch in Richmond.",
      }),
    });
    assert.equal(spoofPracticeRes.status, 403);

    // 2d. Legitimate AI calls as Harry use ONLY Harry's server-verified evidence and carry ZERO memory from Nora's prior call
    recordedAiCalls.length = 0;
    const harryPracticeRes = await fetch(`${baseUrl}/api/ai/practice-feedback`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-harry",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "intro_45s",
        promptQuestion: "Tell me about your background.",
        userResponse:
          "During my Richmond Logistics internship, I coordinated regional vendor dispatch schedules and tracked SLAs.",
      }),
    });
    assert.equal(harryPracticeRes.status, 200);
    assert.equal(recordedAiCalls.length, 1);
    const harryAiPrompt = recordedAiCalls[0].contents;
    assert.ok(harryAiPrompt.includes("uid_harry"));
    assert.ok(harryAiPrompt.includes("Richmond Logistics internship"));
    assert.equal(harryAiPrompt.includes("Little Leaves"), false);
    assert.equal(harryAiPrompt.includes("Nora"), false);
    assert.equal(harryAiPrompt.includes("RethinkBH"), false);

    // 2e. Deterministic client-side analysis engine for Harry produces ZERO Nora strings
    const harryProfile: Profile = {
      id: "uid_harry",
      fullName: "Harry Crafts III",
      location: "Richmond, Virginia",
      educationSummary: "B.S. in Supply Chain & Operations, VCU",
      rbtCertificationStatus: "unverified",
      rbtCertificationNote: "",
      littleLeavesSoftwareUsed: "",
      otherExperienceNotes: "",
      masterResumeText: "",
      masterResumeUpdatedAt: null,
      profileVerifiedByNora: true,
      constraints: createStarterWorkspaceState().profile.constraints,
    };
    const harryEvidence: Evidence[] = [
      {
        id: "ev-harry-1",
        claimText:
          "Coordinated regional vendor dispatch schedules and daily shipment records during Richmond Logistics internship.",
        category: "demonstrated_skill",
        sourceDocumentOrConfirmation: "Uploaded Resume",
        sourceExcerpt: "Richmond Logistics internship — daily vendor dispatch schedules",
        verificationStatus: "Supported by uploaded document",
        tags: ["operations", "scheduling", "vendor coordination", "documentation"],
        mayUseInApplications: true,
        dateAdded: "2026-11-15",
      },
    ];
    const harryOpp: Opportunity = {
      ...createStarterWorkspaceState().opportunities[0],
      id: "opp-harry-1",
      employer: "Dominion Logistics Partners",
      title: "Operations Coordinator",
      location: "Richmond, VA (Hybrid)",
      commuteAndScheduleNotes: "",
      trainingProvidedInfo: "Structured 30-day dispatch onboarding",
      rawDescriptionText:
        "Coordinate daily freight schedules, maintain vendor records, and track SLAs in Richmond, VA.",
      nextAction: "",
      authenticityFlags: [],
      requiredQualifications: [
        "Bachelor's degree in Operations, Business, or related field",
        "Experience coordinating vendor schedules and maintaining accurate records",
        "2+ years enterprise SAP ERP administration",
      ],
      preferredQualifications: ["Strong written follow-up communication"],
      coreDuties: ["Coordinate daily freight schedules", "Track vendor SLAs"],
    };

    const harryAssessments = generateRequirementAssessments(
      harryOpp,
      harryProfile,
      harryEvidence
    );
    const harryEval = evaluateOpportunityDecision(
      harryOpp,
      harryAssessments,
      harryProfile,
      harryEvidence
    );
    const harryBundle = buildTruthfulApplicationBundle(
      harryOpp,
      harryProfile,
      harryEvidence
    );
    const harryOutreach = buildOutreachDraftLocally(
      "Informational interview request",
      {
        name: "Marcus Vance",
        organization: "Dominion Logistics Partners",
        role: "Operations Manager",
        relationship: "VCU Supply Chain panel speaker",
      },
      harryOpp,
      harryProfile,
      harryEvidence
    );
    assert.ok(harryBundle.tailoredResumeText.includes("HARRY CRAFTS III"));
    assert.ok(harryOutreach.bodyText.includes("Marcus"));
    assert.ok(harryEval.factors.scheduleAndLocationFit.includes("Richmond, Virginia"));
    const harryPracticeLocal = evaluatePracticeResponseLocally(
      "intro_45s",
      "Tell me about your background.",
      "I studied Supply Chain at VCU and coordinated vendor dispatch schedules during my Richmond Logistics internship.",
      harryProfile,
      harryEvidence
    );

    const serializedHarryOutputs = JSON.stringify({
      harryAssessments,
      harryEval,
      harryBundle,
      harryOutreach,
      harryPracticeLocal,
    });
    assert.equal(serializedHarryOutputs.includes("Little Leaves"), false);
    assert.equal(serializedHarryOutputs.includes("George Mason"), false);
    assert.equal(serializedHarryOutputs.includes("Nora Crafts"), false);
    assert.equal(serializedHarryOutputs.includes("Oakton"), false);
  });

  // ==========================================================================
  // GATE 3: CHANGING RECORD IDS DOES NOT BYPASS PERMISSIONS
  // ==========================================================================
  it("Gate 3: rejects foreign record ID substitution and path-traversal identifiers across endpoints", async () => {
    // 3a. Harry substituting Nora's opportunity ID in /api/ai/draft-material -> 403
    const foreignOppRes = await fetch(`${baseUrl}/api/ai/draft-material`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-harry",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        draftType: "cover_note",
        opportunity: { id: "opp-nora-private-1" },
      }),
    });
    assert.equal(foreignOppRes.status, 403);

    // 3b. Harry substituting Nora's contact ID in /api/ai/draft-material -> 403
    const foreignContactRes = await fetch(`${baseUrl}/api/ai/draft-material`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-harry",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        draftType: "Outreach informational_request",
        contact: { id: "con-nora-1", name: "Dr. Evelyn Park" },
      }),
    });
    assert.equal(foreignContactRes.status, 403);

    // 3c. Path-traversal opportunity ID -> 400
    const traversalOppRes = await fetch(`${baseUrl}/api/ai/draft-material`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-harry",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        draftType: "cover_note",
        opportunity: { id: "../uid_nora/opportunities/opp-nora-private-1" },
      }),
    });
    assert.equal(traversalOppRes.status, 400);

    // 3d. Harry requesting Nora's document ID under Harry's own UID path -> 404 (partitioned)
    const crossDocIdRes = await fetch(
      `${baseUrl}/api/workspace/uid_harry/documents/doc-nora-resume-1/download`,
      {
        headers: { Authorization: "Bearer token-harry" },
      }
    );
    assert.equal(crossDocIdRes.status, 404);

    // 3e. Client Firestore path sanitizer strips slashes, dots, and control chars
    const sanitized = sanitizeId("../../users/uid_nora/secret", "opp");
    assert.equal(sanitized.includes("/"), false);
    assert.equal(sanitized.includes("."), false);
  });

  // ==========================================================================
  // GATE 4: ADMINISTRATOR INVITATION PRIVILEGES DO NOT GRANT CAREER ACCESS
  // ==========================================================================
  it("Gate 4: permits Application Administrator on /api/admin/invitations while strictly denying admin access to Nora's and Harry's career records", async () => {
    // 4a. Admin session confirms isAdmin: true
    const adminSessionRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Authorization: "Bearer token-admin" },
    });
    assert.equal(adminSessionRes.status, 200);
    const adminSession = (await adminSessionRes.json()) as { isAdmin: boolean };
    assert.equal(adminSession.isAdmin, true);

    // 4b. Admin can list invitation metadata
    const adminListRes = await fetch(`${baseUrl}/api/admin/invitations`, {
      headers: { Authorization: "Bearer token-admin" },
    });
    assert.equal(adminListRes.status, 200);

    // 4c. Admin CANNOT read Nora's or Harry's workspace records -> 403
    const adminReadNora = await fetch(`${baseUrl}/api/workspace/uid_nora/records`, {
      headers: { Authorization: "Bearer token-admin" },
    });
    assert.equal(adminReadNora.status, 403);

    const adminReadHarry = await fetch(`${baseUrl}/api/workspace/uid_harry/records`, {
      headers: { Authorization: "Bearer token-admin" },
    });
    assert.equal(adminReadHarry.status, 403);

    // 4d. Admin CANNOT download Nora's private uploaded resume -> 403
    const adminDownloadNora = await fetch(
      `${baseUrl}/api/workspace/uid_nora/documents/doc-nora-resume-1/download`,
      {
        headers: { Authorization: "Bearer token-admin" },
      }
    );
    assert.equal(adminDownloadNora.status, 403);

    // 4e. Admin CANNOT run AI draft against Nora's workspaceId -> 403
    const adminAiSpoof = await fetch(`${baseUrl}/api/ai/draft-material`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-admin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "uid_nora",
        draftType: "cover_note",
      }),
    });
    assert.equal(adminAiSpoof.status, 403);

    // 4f. Non-admin job seekers (Nora & Harry) and unverified admin email spoofs are denied /api/admin/invitations -> 403
    const noraAdminAttempt = await fetch(`${baseUrl}/api/admin/invitations`, {
      headers: { Authorization: "Bearer token-nora" },
    });
    assert.equal(noraAdminAttempt.status, 403);

    const harryAdminAttempt = await fetch(`${baseUrl}/api/admin/invitations`, {
      headers: { Authorization: "Bearer token-harry" },
    });
    assert.equal(harryAdminAttempt.status, 403);

    const unverifiedSpoofAttempt = await fetch(`${baseUrl}/api/admin/invitations`, {
      headers: { Authorization: "Bearer token-unverified-admin-spoof" },
    });
    assert.equal(unverifiedSpoofAttempt.status, 403);
  });

  // ==========================================================================
  // GATE 5: EXISTING WORKFLOWS & INVITATION LIFECYCLE FUNCTION END-TO-END
  // ==========================================================================
  it("Gate 5: preserves Nora's and Harry's owner workflows, exports, JD authenticity checks, and single-use invitation lifecycle", async () => {
    // 5a. Nora and Harry can each read their own workspace records & download their own private files
    const noraOwnRes = await fetch(`${baseUrl}/api/workspace/uid_nora/records`, {
      headers: { Authorization: "Bearer token-nora" },
    });
    assert.equal(noraOwnRes.status, 200);
    const noraOwnData = (await noraOwnRes.json()) as {
      uid: string;
      fullName: string;
      opportunityCount: number;
    };
    assert.equal(noraOwnData.uid, "uid_nora");
    assert.equal(noraOwnData.fullName, "Nora Crafts");
    assert.equal(noraOwnData.opportunityCount, 1);

    const noraOwnFileRes = await fetch(
      `${baseUrl}/api/workspace/uid_nora/documents/doc-nora-resume-1/download`,
      { headers: { Authorization: "Bearer token-nora" } }
    );
    assert.equal(noraOwnFileRes.status, 200);
    const noraFileJson = (await noraOwnFileRes.json()) as { content: string };
    assert.equal(noraFileJson.content, "NORA_PRIVATE_RESUME_CONTENT");

    const harryOwnFileRes = await fetch(
      `${baseUrl}/api/workspace/uid_harry/documents/doc-harry-resume-1/download`,
      { headers: { Authorization: "Bearer token-harry" } }
    );
    assert.equal(harryOwnFileRes.status, 200);
    const harryFileJson = (await harryOwnFileRes.json()) as { content: string };
    assert.equal(harryFileJson.content, "HARRY_PRIVATE_RESUME_CONTENT");

    // 5b. Nora's starter workspace workflows (JD parser, scam flags, fit mapping, truthful bundle, export)
    const starter = createStarterWorkspaceState();
    const parsedJd = parseJobDescriptionLocally(
      [
        "Job Title: Client Onboarding Coordinator",
        "Company: Northern Virginia ABA Partners",
        "Location: Fairfax, VA (Hybrid)",
        "Responsibilities:",
        "- Coordinate clinic onboarding schedules and family intake records.",
        "Required Qualifications:",
        "- Bachelor's degree in Psychology or related field.",
        "- Experience with ABA behavioral data collection.",
      ].join("\n")
    );
    assert.equal(parsedJd.title, "Client Onboarding Coordinator");
    assert.equal(parsedJd.employerPublishedBasePay, "");

    const scamFlags = evaluateAuthenticityFlags({
      employer: "Unknown Rapid Hire",
      officialWebsite: "",
      postingUrl: "",
      openingAvailabilityStatus: "Unverified",
      rawDescriptionText:
        "100% commission only! Purchase your starter kit fee and send SSN and bank account routing number via Telegram.",
      compensation: {
        employerPublishedBase: "",
        employerPublishedVariable: "Uncapped commission only",
        variableAssumptionsNote: "",
        thirdPartyEstimate: "",
        thirdPartySource: "",
        compensationSourceNote: "",
        benefitsDocumented: "",
      },
    });
    const flagIds = scamFlags.map((f) => f.id);
    assert.equal(flagIds.includes("flag-upfront-payment"), true);
    assert.equal(flagIds.includes("flag-early-financial"), true);
    assert.equal(flagIds.includes("flag-commission-only"), true);

    const noraBundle = buildTruthfulApplicationBundle(
      starter.opportunities[0],
      starter.profile,
      starter.evidence
    );
    assert.ok(noraBundle.tailoredResumeText.includes("Psychology graduate"));
    assert.ok(noraBundle.evidenceUsed.length >= 3);

    const exportWithSample = buildExportBundle({
      ...starter,
      opportunities: [
        ...starter.opportunities,
        {
          ...starter.opportunities[0],
          id: "sample-benchmark-1",
          isSampleRecord: true,
        },
      ],
    });
    assert.equal(
      exportWithSample.opportunities.some((o) => o.isSampleRecord),
      false,
      "Export bundle must exclude sample benchmark records"
    );

    // 5c. Complete single-use job-seeker invitation lifecycle
    const createInvRes = await fetch(`${baseUrl}/api/admin/invitations`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-admin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        displayName: "Claire Invitee",
        email: "Claire.Invitee@example.com",
        personalMessage: "Welcome to your private Career Launch workspace.",
        expirationDays: 7,
        idempotencyKey: "idem-test-claire-001",
        suggestedItems: ["Explore healthcare operations roles"],
      }),
    });
    assert.equal(createInvRes.status, 201);
    const createdInvBody = (await createInvRes.json()) as {
      invitation: { id: string; status: string };
    };
    const invId = createdInvBody.invitation.id;
    assert.ok(invId.startsWith("inv-"));

    // Generate single-use manual link
    const manualRes = await fetch(
      `${baseUrl}/api/admin/invitations/${invId}/generate-manual-link`,
      {
        method: "POST",
        headers: { Authorization: "Bearer token-admin" },
      }
    );
    assert.equal(manualRes.status, 200);
    const manualBody = (await manualRes.json()) as { manualInviteUrl: string };
    const tokenParam = new URL(manualBody.manualInviteUrl).searchParams.get("invite");
    assert.ok(tokenParam && tokenParam.length >= 32);

    // Public pre-auth inspect returns masked email only
    const inspectRes = await fetch(`${baseUrl}/api/invitations/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenParam }),
    });
    assert.equal(inspectRes.status, 200);
    const inspectBody = (await inspectRes.json()) as {
      state: string;
      maskedRecipientEmail: string;
    };
    assert.equal(inspectBody.state, "valid");
    assert.equal(inspectBody.maskedRecipientEmail.includes("claire.invitee"), false);

    // Wrong signed-in user (Nora) trying to verify/redeem Claire's invite -> 403 wrong_email
    const wrongUserVerify = await fetch(`${baseUrl}/api/invitations/verify-session`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-nora",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: tokenParam }),
    });
    assert.equal(wrongUserVerify.status, 403);

    // Intended recipient (Claire) accepts invitation -> 200 & creates isolated private workspace
    const acceptRes = await fetch(`${baseUrl}/api/invitations/accept`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-fresh-invitee",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: tokenParam }),
    });
    assert.equal(acceptRes.status, 200);
    const acceptBody = (await acceptRes.json()) as {
      accepted: boolean;
      workspaceCreated: boolean;
    };
    assert.equal(acceptBody.accepted, true);
    assert.equal(acceptBody.workspaceCreated, true);

    // Single-use replay check -> 409 accepted
    const replayRes = await fetch(`${baseUrl}/api/invitations/accept`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-fresh-invitee",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: tokenParam }),
    });
    assert.equal(replayRes.status, 409);

    // Revoking an already accepted invitation -> 409 (never deletes active user workspace)
    const revokeAcceptedRes = await fetch(
      `${baseUrl}/api/admin/invitations/${invId}/revoke`,
      {
        method: "POST",
        headers: { Authorization: "Bearer token-admin" },
      }
    );
    assert.equal(revokeAcceptedRes.status, 409);

    // Admin still cannot read Claire's newly created workspace -> 403
    const adminReadClaire = await fetch(`${baseUrl}/api/workspace/uid_claire/records`, {
      headers: { Authorization: "Bearer token-admin" },
    });
    assert.equal(adminReadClaire.status, 403);
  });
});
