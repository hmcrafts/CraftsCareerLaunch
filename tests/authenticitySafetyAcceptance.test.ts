/**
 * Authenticity & Safety Review — Acceptance, SSRF Hardening & Multi-User Isolation Suite
 *
 * Executes automated verification across all 9 mandatory acceptance tests:
 *   1. Real employer with an impersonated recruiter (5 dimensions assessed separately; documented impersonation gate).
 *   2. Legitimate employer using an external recruitment platform (Greenhouse/Workday informational note, zero fraud accusation).
 *   3. Equipment check with instructions to forward funds (high_risk_request_detected).
 *   4. Task earnings requiring a cryptocurrency deposit (high_risk_request_detected).
 *   5. Missing or expired job posting (HTTP 404 & closed-posting text -> unresolved_concerns).
 *   6. Conflicting evidence + user correction/dismissal with required explanation preserved on recheck.
 *   7. Unsupported AI accusation rejected; grounded AI observation labeled strictly as ai_suggestion.
 *   8. No live research capability ("Live verification unavailable", never simulated).
 *   9. Cross-workspace access attempts (Nora vs. Harry vs. Admin), SSRF / private IP / redirect protections,
 *      sensitive-pattern redaction warnings, forbidden-label bans, and UI pass-condition checks.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AtomicDocWriteSpec,
  FirestoreBackendAdapter,
  FirestoreDocResult,
  VerifiedJwtClaims,
  controlledFetchPublicUrl,
  createCareerLaunchExpressApp,
  isPrivateOrReservedIpAddress,
  validateSafeExternalUrl,
} from "../server";
import { createStarterWorkspaceState } from "../src/data/initialData";
import {
  AuthenticityOverallStatus,
  PrivateDocumentMeta,
  ReviewArtifact,
  WorkspaceState,
} from "../src/types/models";
import {
  OVERALL_STATUS_LABELS,
  assertNoForbiddenSafetyLabels,
  createInitialAuthenticityReview,
  detectUnredactedSensitivePatterns,
  isValidImpersonationConfirmation,
  recheckAuthenticityReview,
  resolveFindingWithExplanation,
  validateReviewWorkspaceIsolation,
} from "../src/utils/authenticityReviewEngine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SAFETY_PRINCIPALS: Record<string, VerifiedJwtClaims> = {
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

const ALLOWED_OVERALL_STATUSES = new Set<AuthenticityOverallStatus>([
  "not_reviewed",
  "partially_corroborated",
  "unresolved_concerns",
  "high_risk_request_detected",
  "corroborated_within_stated_scope",
  "documented_impersonation_confirmation",
]);

function buildHarryWorkspace(): WorkspaceState {
  const base = createStarterWorkspaceState();
  const harryDoc: PrivateDocumentMeta = {
    id: "doc-harry-private-1",
    userId: "uid_harry",
    fileName: "harry-recruiter-email.txt",
    mimeType: "text/plain",
    byteSize: 512,
    docCategory: "supporting_document",
    linkedOpportunityId: "opp-harry-ops-1",
    storageRef: "users/uid_harry/documentBlobs/doc-harry-private-1",
    sha256: "b".repeat(64),
    createdAtIso: "2026-11-15T12:00:00.000Z",
  };
  return {
    ...base,
    profile: {
      ...base.profile,
      id: "uid_harry",
      fullName: "Harry Crafts III",
      location: "Chicago, Illinois",
      profileVerifiedByNora: true,
    },
    opportunities: [
      {
        ...base.opportunities[0],
        id: "opp-harry-ops-1",
        title: "Regional Supply Chain Coordinator",
        employer: "Midwest Freight Partners",
        officialWebsite: "https://midwestfreight.example.com",
      },
    ],
    documents: [harryDoc],
    authenticityReviews: [],
  };
}

function createSafetyFirestoreAdapter(
  noraWs: WorkspaceState,
  harryWs: WorkspaceState
): FirestoreBackendAdapter {
  const docs = new Map<string, Record<string, unknown>>();

  const seedWs = (uid: string, ws: WorkspaceState) => {
    docs.set(`users/${uid}`, {
      id: uid,
      userId: uid,
      fullName: ws.profile.fullName,
    });
    for (const opp of ws.opportunities) {
      docs.set(`users/${uid}/opportunities/${opp.id}`, { ...opp, userId: uid });
    }
    for (const d of ws.documents) {
      docs.set(`users/${uid}/documents/${d.id}`, { ...d, userId: uid });
    }
    for (const rev of ws.authenticityReviews || []) {
      docs.set(`users/${uid}/authenticityReviews/${rev.id}`, {
        ...rev,
        userId: uid,
      });
    }
  };

  seedWs("uid_nora", noraWs);
  seedWs("uid_harry", harryWs);
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

describe("Authenticity & Safety Review — Mandatory Acceptance Tests 1 through 9", () => {
  let aiEnabledServer: http.Server;
  let aiEnabledBaseUrl = "";

  let noAiServer: http.Server;
  let noAiBaseUrl = "";

  const noraStarter = createStarterWorkspaceState();
  noraStarter.documents = [
    {
      id: "doc-nora-private-1",
      userId: "uid_nora",
      fileName: "nora-saved-posting.txt",
      mimeType: "text/plain",
      byteSize: 640,
      docCategory: "job_description",
      linkedOpportunityId: noraStarter.opportunities[0].id,
      storageRef: "users/uid_nora/documentBlobs/doc-nora-private-1",
      sha256: "a".repeat(64),
      createdAtIso: "2026-11-15T10:00:00.000Z",
    },
  ];
  const harryStarter = buildHarryWorkspace();

  const capturedOutboundHeaders: Array<{ url: string; headers: Record<string, string> }> = [];

  before(async () => {
    const adapter = createSafetyFirestoreAdapter(noraStarter, harryStarter);

    // Server 1: Controlled mock AI + controlled mock HTTP/DNS for deterministic tests
    const appWithAi = createCareerLaunchExpressApp({
      projectId: "europe26-safety-test",
      verifyJwtToken: async (token: string) => {
        const claims = SAFETY_PRINCIPALS[token];
        if (!claims) throw new Error("Invalid JWT");
        return claims;
      },
      firestoreAdapter: adapter,
      dnsLookup: async (hostname: string) => {
        if (hostname === "evil-rebind.example.com") {
          return [{ address: "192.168.1.25", family: 4 }];
        }
        return [{ address: "93.184.216.34", family: 4 }];
      },
      externalHttpFetch: async (url, init) => {
        capturedOutboundHeaders.push({ url, headers: { ...init.headers } });
        if (url === "https://jobs.example.com/closed-role") {
          return {
            status: 404,
            headers: {
              get: (name: string) =>
                name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null,
            },
            bodyText: "<html><head><title>404 Not Found</title></head><body>Job removed</body></html>",
          };
        }
        if (url === "https://jobs.example.com/filled-role") {
          return {
            status: 200,
            headers: {
              get: (name: string) =>
                name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null,
            },
            bodyText:
              "<html><head><title>Careers Portal</title></head><body><script>window.steal()</script>This position has been filled and is no longer accepting applications.</body></html>",
          };
        }
        if (url === "https://jobs.example.com/redirect-to-metadata") {
          return {
            status: 302,
            headers: {
              get: (name: string) =>
                name.toLowerCase() === "location"
                  ? "http://169.254.169.254/latest/meta-data/"
                  : null,
            },
            bodyText: "",
          };
        }
        if (url === "https://jobs.example.com/malware.exe") {
          return {
            status: 200,
            headers: {
              get: (name: string) =>
                name.toLowerCase() === "content-type"
                  ? "application/x-msdownload"
                  : null,
            },
            bodyText: "MZ...",
          };
        }
        return {
          status: 200,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null,
          },
          bodyText:
            "<html><head><title>Customer Implementation Specialist</title></head><body>Apply on our official careers portal.</body></html>",
        };
      },
      aiGenerateJson: async ({ endpoint }) => {
        assert.equal(endpoint, "safety-analyze");
        return {
          analysisNote:
            "Evaluated supplied message text only; Verified safe labels are never used.",
          candidateFindings: [
            // (a) Uncited accusation -> MUST BE REJECTED
            {
              dimension: "recruiter_affiliation",
              category: "Uncited claim",
              severity: "stop_and_verify",
              observedBehavior: "Sender is impersonating HR.",
              interpretation: "Do not reply.",
              supportingArtifactId: "art-nonexistent-999",
              supportingExcerpt: "Immediate remote hire",
              recommendedAction: "Ignore.",
            },
            // (b) Fabricated quote not present in artifact -> MUST BE REJECTED
            {
              dimension: "requested_action",
              category: "Fabricated quote",
              severity: "caution",
              observedBehavior: "Message mentions wire transfers to Cayman Islands.",
              interpretation: "Verify payment request.",
              supportingArtifactId: "art-msg-1",
              supportingExcerpt: "wire $5,000 to our Cayman Islands account today",
              recommendedAction: "Do not wire funds.",
            },
            // (c) Banned fraud-probability / certainty accusation -> MUST BE REJECTED
            {
              dimension: "sender_channel_authenticity",
              category: "AI fraud probability score",
              severity: "stop_and_verify",
              observedBehavior: "Immediate remote hire without video interview",
              interpretation: "AI fraud probability is 96% — definitely a scammer.",
              supportingArtifactId: "art-msg-1",
              supportingExcerpt: "Immediate remote hire without video interview",
              recommendedAction: "Block sender.",
            },
            // (d) Grounded, artifact-cited observation separating fact from interpretation -> ACCEPTED as ai_suggestion
            {
              dimension: "opening_authenticity",
              category: "Compressed hiring process claim",
              severity: "caution",
              observedBehavior:
                "The message offers an immediate remote hire without a live video or phone interview with the hiring team.",
              interpretation:
                "Skipping standard interviews is uncommon for salaried roles and warrants checking the opening directly on the employer's official careers page.",
              supportingArtifactId: "art-msg-1",
              supportingExcerpt: "Immediate remote hire without video interview",
              recommendedAction:
                "Check the employer's official careers page and confirm the interview process through an official HR contact.",
            },
          ],
        };
      },
    });

    aiEnabledServer = http.createServer(appWithAi);
    await new Promise<void>((resolve) => {
      aiEnabledServer.listen(0, "127.0.0.1", () => resolve());
    });
    aiEnabledBaseUrl = `http://127.0.0.1:${(aiEnabledServer.address() as AddressInfo).port}`;

    // Server 2: No AI / No live research capability available (forceDisableAi: true)
    const appWithoutAi = createCareerLaunchExpressApp({
      projectId: "europe26-safety-noai-test",
      verifyJwtToken: async (token: string) => {
        const claims = SAFETY_PRINCIPALS[token];
        if (!claims) throw new Error("Invalid JWT");
        return claims;
      },
      firestoreAdapter: adapter,
      forceDisableAi: true,
    });

    noAiServer = http.createServer(appWithoutAi);
    await new Promise<void>((resolve) => {
      noAiServer.listen(0, "127.0.0.1", () => resolve());
    });
    noAiBaseUrl = `http://127.0.0.1:${(noAiServer.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (aiEnabledServer) {
      await new Promise<void>((resolve) => aiEnabledServer.close(() => resolve()));
    }
    if (noAiServer) {
      await new Promise<void>((resolve) => noAiServer.close(() => resolve()));
    }
  });

  // ==========================================================================
  // ACCEPTANCE TEST 1: Real employer with an impersonated recruiter
  // ==========================================================================
  it("Acceptance Test 1: Real employer with an impersonated recruiter assesses all 5 dimensions separately and gates documented impersonation confirmation", () => {
    let review = createInitialAuthenticityReview({
      id: "rev-test-1",
      userId: "uid_nora",
      subjectLabel: "RethinkFirst — Implementation Associate",
      officialEmployerDomain: "https://www.rethinkfirst.com",
    });

    // Step A: Nora independently confirms ONLY employer_identity (rethinkfirst.com exists and is real)
    review = recheckAuthenticityReview({
      ...review,
      checks: review.checks.map((c) =>
        c.dimension === "employer_identity"
          ? {
              ...c,
              status: "completed",
              outcome: "corroborated",
              notes: "Visited rethinkfirst.com directly; established behavioral health software company.",
              datePerformed: "2026-11-15",
            }
          : c
      ),
    });

    // Confirming employer_identity MUST NOT confirm the other 4 dimensions!
    assert.equal(review.dimensionAssessments.employer_identity.state, "corroborated");
    assert.notEqual(review.dimensionAssessments.opening_authenticity.state, "corroborated");
    assert.notEqual(review.dimensionAssessments.recruiter_affiliation.state, "corroborated");
    assert.notEqual(review.dimensionAssessments.sender_channel_authenticity.state, "corroborated");
    assert.notEqual(review.dimensionAssessments.requested_action.state, "corroborated");
    assert.equal(review.overallStatus, "partially_corroborated");

    // Step B: Add unsolicited recruiter message claiming to represent RethinkFirst from a free webmail + Telegram channel
    const impersonatorArtifact: ReviewArtifact = {
      id: "art-impersonator-msg",
      type: "message",
      title: "Unsolicited Recruiter Email",
      sourceProvenance: "Direct inbox email",
      senderAddress: "rethinkfirst.talent.desk@gmail.com",
      targetUrl: "",
      contentExcerpt:
        "Hello Nora, I am a Senior Talent Partner at RethinkFirst. Please contact our hiring manager on Telegram @RethinkDesk for a text-only interview today.",
      privateDocumentId: "",
      httpStatus: null,
      redactionConfirmed: true,
      dateSupplied: "2026-11-15",
    };

    review = recheckAuthenticityReview({
      ...review,
      artifacts: [impersonatorArtifact],
    });

    assert.equal(review.dimensionAssessments.employer_identity.state, "corroborated");
    assert.equal(
      review.dimensionAssessments.sender_channel_authenticity.state,
      "concern_or_conflict"
    );
    assert.equal(review.dimensionAssessments.recruiter_affiliation.state, "unconfirmed");
    assert.equal(review.overallStatus, "unresolved_concerns");
    assert.ok(
      review.findings.some((f) => f.ruleKey === "caution_free_webmail_sender"),
      "Expected free webmail sender caution finding"
    );
    assert.ok(
      review.findings.some((f) => f.ruleKey === "caution_chat_app_interview_channel"),
      "Expected Telegram/text-only interview caution finding"
    );

    // Step C: Attempting to set documented_impersonation_confirmation WITHOUT who + how + valid artifact is rejected
    const incompleteImpersonation = {
      confirmedByIdentity: "Someone at HR",
      identityEstablishmentMethod: "",
      supportingArtifactId: "nonexistent-artifact",
      confirmedAtIso: "2026-11-15T12:00:00.000Z",
    };
    assert.equal(
      isValidImpersonationConfirmation(incompleteImpersonation, review.artifacts),
      false
    );
    const reviewWithIncompleteClaim = recheckAuthenticityReview({
      ...review,
      impersonationConfirmation: incompleteImpersonation,
    });
    assert.equal(reviewWithIncompleteClaim.overallStatus, "unresolved_concerns");

    // Step D: Nora contacts RethinkFirst via official website careers email and attaches documented confirmation
    const officialHrReplyArtifact: ReviewArtifact = {
      id: "art-official-hr-reply",
      type: "message",
      title: "Official RethinkFirst HR Confirmation Email",
      sourceProvenance: "Reply from careers@rethinkfirst.com initiated from rethinkfirst.com/contact",
      senderAddress: "careers@rethinkfirst.com",
      targetUrl: "https://www.rethinkfirst.com/careers",
      contentExcerpt:
        "Thank you for checking with us. RethinkFirst never uses @gmail.com addresses or Telegram for interviews; that sender is not affiliated with our team.",
      privateDocumentId: "",
      httpStatus: null,
      redactionConfirmed: true,
      dateSupplied: "2026-11-15",
    };

    const documentedReview = recheckAuthenticityReview({
      ...review,
      artifacts: [...review.artifacts, officialHrReplyArtifact],
      impersonationConfirmation: {
        confirmedByIdentity: "RethinkFirst People Operations (careers@rethinkfirst.com)",
        identityEstablishmentMethod:
          "Initiated inquiry directly via official contact page on rethinkfirst.com and verified DKIM-signed @rethinkfirst.com reply.",
        supportingArtifactId: "art-official-hr-reply",
        confirmedAtIso: "2026-11-15T14:30:00.000Z",
      },
    });

    assert.equal(
      documentedReview.overallStatus,
      "documented_impersonation_confirmation"
    );
    assert.equal(
      assertNoForbiddenSafetyLabels(JSON.stringify(documentedReview)).clean,
      true
    );
  });

  // ==========================================================================
  // ACCEPTANCE TEST 2: Legitimate employer using an external recruitment platform
  // ==========================================================================
  it("Acceptance Test 2: Legitimate employer using an external ATS (Greenhouse / Workday) receives an informational note rather than a fraud accusation", () => {
    const atsArtifact: ReviewArtifact = {
      id: "art-greenhouse-url",
      type: "url",
      title: "Greenhouse Application Board Link",
      sourceProvenance: "Linked from RethinkFirst official careers page",
      senderAddress: "no-reply@greenhouse.io",
      targetUrl: "https://boards.greenhouse.io/rethinkfirst/jobs/4910284",
      contentExcerpt:
        "Implementation Specialist — Hybrid in Reston, VA. Apply through our standard application form.",
      privateDocumentId: "",
      httpStatus: 200,
      redactionConfirmed: true,
      dateSupplied: "2026-11-15",
    };

    let review = createInitialAuthenticityReview({
      id: "rev-test-2",
      userId: "uid_nora",
      subjectLabel: "RethinkFirst — Implementation Specialist",
      officialEmployerDomain: "rethinkfirst.com",
    });

    review = recheckAuthenticityReview({
      ...review,
      artifacts: [atsArtifact],
    });

    // Must produce an INFORMATIONAL finding for Greenhouse, zero caution/stop_and_verify domain mismatch!
    const atsFinding = review.findings.find(
      (f) => f.ruleKey === "info_external_ats_platform"
    );
    assert.ok(atsFinding, "Expected informational external ATS finding for Greenhouse");
    assert.equal(atsFinding.severity, "informational");
    assert.equal(atsFinding.supportingArtifactId, "art-greenhouse-url");
    assert.equal(
      review.findings.some(
        (f) => f.severity === "caution" || f.severity === "stop_and_verify"
      ),
      false,
      "Legitimate external ATS must NOT trigger caution or stop_and_verify accusations"
    );

    // Once Nora corroborates all 5 dimensions manually in the checklist, status reaches corroborated_within_stated_scope
    const allCorroboratedReview = recheckAuthenticityReview({
      ...review,
      checks: review.checks.map((c) => ({
        ...c,
        status: "completed",
        outcome: "corroborated",
        notes: "Confirmed directly from official website and careers link.",
        datePerformed: "2026-11-15",
      })),
    });

    assert.equal(
      allCorroboratedReview.overallStatus,
      "corroborated_within_stated_scope"
    );
    assert.equal(
      OVERALL_STATUS_LABELS[allCorroboratedReview.overallStatus],
      "Corroborated within stated scope"
    );
    assert.equal(
      assertNoForbiddenSafetyLabels(JSON.stringify(allCorroboratedReview)).clean,
      true
    );
  });

  // ==========================================================================
  // ACCEPTANCE TEST 3: Equipment check with instructions to forward funds
  // ==========================================================================
  it("Acceptance Test 3: Equipment check with instructions to deposit and pay a vendor triggers High-risk request detected", () => {
    const checkArtifact: ReviewArtifact = {
      id: "art-fake-check",
      type: "message",
      title: "Onboarding Equipment Check Instructions",
      sourceProvenance: "Email attachment / onboarding message",
      senderAddress: "onboarding@rethink-careers-portal.com",
      targetUrl: "",
      contentExcerpt:
        "Congratulations! Our accounting department will email an e-check for $2,850 for your MacBook Pro and home office setup. Complete mobile deposit today and forward the funds via Zelle to our approved equipment vendor.",
      privateDocumentId: "",
      httpStatus: null,
      redactionConfirmed: true,
      dateSupplied: "2026-11-15",
    };

    let review = createInitialAuthenticityReview({
      id: "rev-test-3",
      userId: "uid_nora",
      subjectLabel: "Remote Administrative Coordinator",
      officialEmployerDomain: "rethinkfirst.com",
    });

    // Even if employer_identity was marked corroborated, high-risk requested_action overrides!
    review = recheckAuthenticityReview({
      ...review,
      artifacts: [checkArtifact],
      checks: review.checks.map((c) =>
        c.dimension === "employer_identity"
          ? { ...c, status: "completed", outcome: "corroborated", datePerformed: "2026-11-15" }
          : c
      ),
    });

    const stopFinding = review.findings.find(
      (f) => f.ruleKey === "high_risk_equipment_check_forward_funds"
    );
    assert.ok(stopFinding, "Expected deterministic high_risk_equipment_check_forward_funds finding");
    assert.equal(stopFinding.severity, "stop_and_verify");
    assert.equal(stopFinding.dimension, "requested_action");
    assert.equal(stopFinding.basis, "deterministic_rule");
    assert.notEqual(stopFinding.observedBehavior, stopFinding.interpretation);
    assert.equal(review.dimensionAssessments.requested_action.state, "high_risk");
    assert.equal(review.overallStatus, "high_risk_request_detected");
  });

  // ==========================================================================
  // ACCEPTANCE TEST 4: Task earnings requiring a cryptocurrency deposit
  // ==========================================================================
  it("Acceptance Test 4: Task earnings requiring a USDT / cryptocurrency deposit triggers High-risk request detected", () => {
    const cryptoArtifact: ReviewArtifact = {
      id: "art-crypto-workbench",
      type: "message",
      title: "App Optimization Workbench Message",
      sourceProvenance: "WhatsApp recruiting message",
      senderAddress: "",
      targetUrl: "",
      contentExcerpt:
        "Complete 40 app optimization tasks daily to earn commission. To clear a combination task and unlock withdrawal of your task earnings, deposit 350 USDT into your workbench wallet address.",
      privateDocumentId: "",
      httpStatus: null,
      redactionConfirmed: true,
      dateSupplied: "2026-11-15",
    };

    const review = recheckAuthenticityReview({
      ...createInitialAuthenticityReview({
        id: "rev-test-4",
        userId: "uid_nora",
        subjectLabel: "Digital Product Optimization Part-Time",
      }),
      artifacts: [cryptoArtifact],
    });

    const cryptoFinding = review.findings.find(
      (f) => f.ruleKey === "high_risk_crypto_task_deposit"
    );
    assert.ok(cryptoFinding, "Expected deterministic high_risk_crypto_task_deposit finding");
    assert.equal(cryptoFinding.severity, "stop_and_verify");
    assert.equal(cryptoFinding.dimension, "requested_action");
    assert.equal(review.overallStatus, "high_risk_request_detected");
  });

  // ==========================================================================
  // ACCEPTANCE TEST 5: Missing or expired job posting
  // ==========================================================================
  it("Acceptance Test 5: Missing (HTTP 404) or expired/filled job posting flags opening_authenticity and sets Unresolved concerns", async () => {
    // 5A: Controlled URL retrieval for HTTP 404 posting
    const fetch404Resp = await fetch(
      `${aiEnabledBaseUrl}/api/workspace/uid_nora/safety/fetch-url`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-nora",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "https://jobs.example.com/closed-role" }),
      }
    );
    assert.equal(fetch404Resp.status, 200);
    const fetch404Json = (await fetch404Resp.json()) as {
      ok: boolean;
      httpStatus: number;
      missingOrExpired: boolean;
      textExcerpt: string;
    };
    assert.equal(fetch404Json.ok, true);
    assert.equal(fetch404Json.httpStatus, 404);
    assert.equal(fetch404Json.missingOrExpired, true);

    // 5B: Controlled URL retrieval for HTTP 200 "position has been filled" page (and strips <script>)
    const fetchFilledResp = await fetch(
      `${aiEnabledBaseUrl}/api/workspace/uid_nora/safety/fetch-url`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-nora",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "https://jobs.example.com/filled-role" }),
      }
    );
    assert.equal(fetchFilledResp.status, 200);
    const fetchFilledJson = (await fetchFilledResp.json()) as {
      ok: boolean;
      httpStatus: number;
      missingOrExpired: boolean;
      textExcerpt: string;
    };
    assert.equal(fetchFilledJson.missingOrExpired, true);
    assert.equal(
      fetchFilledJson.textExcerpt.includes("window.steal"),
      false,
      "HTML script tags must be stripped from fetched text snippets"
    );

    // 5C: Evaluate review with the 404 artifact -> caution_missing_or_expired_posting on opening_authenticity
    const review = recheckAuthenticityReview({
      ...createInitialAuthenticityReview({
        id: "rev-test-5",
        userId: "uid_nora",
        subjectLabel: "Example Corp — Client Associate",
        officialEmployerDomain: "example.com",
      }),
      artifacts: [
        {
          id: "art-404-url",
          type: "url",
          title: "Supplied Job Link",
          sourceProvenance: "Controlled URL fetch",
          senderAddress: "",
          targetUrl: "https://jobs.example.com/closed-role",
          contentExcerpt: fetch404Json.textExcerpt,
          privateDocumentId: "",
          httpStatus: fetch404Json.httpStatus,
          redactionConfirmed: true,
          dateSupplied: "2026-11-15",
        },
      ],
    });

    assert.ok(
      review.findings.some((f) => f.ruleKey === "caution_missing_or_expired_posting")
    );
    assert.equal(
      review.dimensionAssessments.opening_authenticity.state,
      "concern_or_conflict"
    );
    assert.equal(review.overallStatus, "unresolved_concerns");
  });

  // ==========================================================================
  // ACCEPTANCE TEST 6: Conflicting evidence & user correction/dismissal persistence
  // ==========================================================================
  it("Acceptance Test 6: Conflicting evidence surfaces unresolved concerns, and user corrections require explanation and persist across rechecks", () => {
    const outreachArt: ReviewArtifact = {
      id: "art-outreach-remote",
      type: "message",
      title: "Recruiter DM",
      sourceProvenance: "Direct message",
      senderAddress: "talent@care-staffing-partner.org",
      targetUrl: "",
      contentExcerpt:
        "We are hiring immediately for full-time remote Client Services Coordinators at CareBridge Health.",
      privateDocumentId: "",
      httpStatus: null,
      redactionConfirmed: true,
      dateSupplied: "2026-11-15",
    };

    const careersFaqArt: ReviewArtifact = {
      id: "art-official-faq",
      type: "user_note",
      title: "CareBridge Official Careers Page Banner",
      sourceProvenance: "Copied directly from carebridgehealth.org/careers",
      senderAddress: "",
      targetUrl: "https://carebridgehealth.org/careers",
      contentExcerpt:
        "Recruiting notice: CareBridge Health currently has no open remote positions and we never conduct interviews via chat apps.",
      privateDocumentId: "",
      httpStatus: 200,
      redactionConfirmed: true,
      dateSupplied: "2026-11-15",
    };

    const review = recheckAuthenticityReview({
      ...createInitialAuthenticityReview({
        id: "rev-test-6",
        userId: "uid_nora",
        subjectLabel: "CareBridge Health — Remote Coordinator",
        officialEmployerDomain: "carebridgehealth.org",
      }),
      artifacts: [outreachArt, careersFaqArt],
    });

    const conflictFinding = review.findings.find(
      (f) => f.ruleKey === "caution_conflicting_official_statement"
    );
    const domainMismatchFinding = review.findings.find(
      (f) => f.ruleKey === "caution_sender_domain_mismatch"
    );
    assert.ok(conflictFinding, "Expected conflicting official statement finding");
    assert.ok(domainMismatchFinding, "Expected sender domain mismatch finding");
    assert.equal(review.overallStatus, "unresolved_concerns");

    // Dismissing a finding WITHOUT an explanation must be rejected
    const emptyDismiss = resolveFindingWithExplanation(
      review,
      domainMismatchFinding.id,
      "dismissed",
      "  "
    );
    assert.equal(emptyDismiss.ok, false);

    // Dismissing with an explicit explanation succeeds and persists across a subsequent recheck!
    const validDismiss = resolveFindingWithExplanation(
      review,
      domainMismatchFinding.id,
      "corrected",
      "Confirmed with CareBridge HR that care-staffing-partner.org is their contracted regional agency, though remote opening conflict still stands."
    );
    assert.equal(validDismiss.ok, true);
    const afterDismiss = validDismiss.updatedReview!;

    // Add a new user note and run recheckAuthenticityReview -> prior user resolution is preserved!
    const rechecked = recheckAuthenticityReview({
      ...afterDismiss,
      artifacts: [
        ...afterDismiss.artifacts,
        {
          id: "art-followup-note",
          type: "user_note",
          title: "Phone call note",
          sourceProvenance: "Called main reception",
          senderAddress: "",
          targetUrl: "",
          contentExcerpt: "Left voicemail for HR coordinator to clarify onsite vs remote.",
          privateDocumentId: "",
          httpStatus: null,
          redactionConfirmed: true,
          dateSupplied: "2026-11-15",
        },
      ],
    });

    const preservedFinding = rechecked.findings.find(
      (f) => f.id === domainMismatchFinding.id
    );
    assert.ok(preservedFinding);
    assert.equal(preservedFinding.userResolution, "corrected");
    assert.match(preservedFinding.userResolutionExplanation, /contracted regional agency/);
    // Conflict finding is still active -> overallStatus remains unresolved_concerns
    assert.equal(rechecked.overallStatus, "unresolved_concerns");
  });

  // ==========================================================================
  // ACCEPTANCE TEST 7: Unsupported AI accusation
  // ==========================================================================
  it("Acceptance Test 7: Unsupported AI accusations, fabricated quotes, and fraud-probability scores are stripped; grounded observations are labeled ai_suggestion", async () => {
    const suppliedArtifact: ReviewArtifact = {
      id: "art-msg-1",
      type: "message",
      title: "Inbound Hiring Note",
      sourceProvenance: "Email",
      senderAddress: "recruiting@acme-ops.example.com",
      targetUrl: "",
      contentExcerpt:
        "We reviewed your resume. Immediate remote hire without video interview starting at $38/hr if you reply by 5pm.",
      privateDocumentId: "",
      httpStatus: null,
      redactionConfirmed: true,
      dateSupplied: "2026-11-15",
    };

    const resp = await fetch(
      `${aiEnabledBaseUrl}/api/workspace/uid_nora/safety/analyze`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-nora",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: "uid_nora",
          opportunityId: "",
          subjectLabel: "Acme Ops — Operations Specialist",
          officialEmployerDomain: "acme-ops.example.com",
          artifacts: [suppliedArtifact],
          allowServerSideAi: true,
        }),
      }
    );

    assert.equal(resp.status, 200);
    const body = (await resp.json()) as {
      deterministicFindings: Array<Record<string, unknown>>;
      aiSuggestedFindings: Array<{
        id: string;
        basis: string;
        supportingArtifactId: string;
        supportingExcerpt: string;
        observedBehavior: string;
        interpretation: string;
      }>;
      rejectedAiSuggestionCount: number;
      liveResearchStatus: string;
      liveResearchSummary: string;
    };

    // Candidates (a), (b), and (c) MUST be rejected; only grounded candidate (d) survives!
    assert.equal(body.rejectedAiSuggestionCount, 3);
    assert.equal(body.aiSuggestedFindings.length, 1);

    const surviving = body.aiSuggestedFindings[0];
    assert.equal(surviving.basis, "ai_suggestion");
    assert.equal(surviving.supportingArtifactId, "art-msg-1");
    assert.equal(
      surviving.supportingExcerpt,
      "Immediate remote hire without video interview"
    );
    assert.notEqual(surviving.observedBehavior, surviving.interpretation);
    assert.equal(assertNoForbiddenSafetyLabels(JSON.stringify(body)).clean, true);
  });

  // ==========================================================================
  // ACCEPTANCE TEST 8: No live research capability
  // ==========================================================================
  it("Acceptance Test 8: When live research / AI is unavailable or disabled, shows 'Live verification unavailable' and never simulates live lookups", async () => {
    const sampleArt: ReviewArtifact = {
      id: "art-local-only",
      type: "message",
      title: "Recruiter Outreach",
      sourceProvenance: "Email",
      senderAddress: "hiring.team@gmail.com",
      targetUrl: "",
      contentExcerpt: "Hello Nora, reply if interested in our Operations role.",
      privateDocumentId: "",
      httpStatus: null,
      redactionConfirmed: true,
      dateSupplied: "2026-11-15",
    };

    // 8A: Server has no AI key / capability (forceDisableAi: true)
    const noAiResp = await fetch(
      `${noAiBaseUrl}/api/workspace/uid_nora/safety/analyze`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-nora",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: "uid_nora",
          opportunityId: "",
          subjectLabel: "Operations Role",
          officialEmployerDomain: "realcompany.com",
          artifacts: [sampleArt],
          allowServerSideAi: true,
        }),
      }
    );
    assert.equal(noAiResp.status, 200);
    const noAiBody = (await noAiResp.json()) as {
      deterministicFindings: Array<{ ruleKey: string }>;
      aiSuggestedFindings: unknown[];
      liveResearchStatus: string;
      liveResearchSummary: string;
    };

    assert.equal(noAiBody.liveResearchStatus, "unavailable");
    assert.equal(noAiBody.liveResearchSummary, "Live verification unavailable");
    assert.equal(noAiBody.aiSuggestedFindings.length, 0);
    // Deterministic local rules still run cleanly
    assert.ok(
      noAiBody.deterministicFindings.some(
        (f) => f.ruleKey === "caution_free_webmail_sender"
      )
    );

    // 8B: User turns off allowServerSideAi -> also returns Live verification unavailable
    const optOutResp = await fetch(
      `${aiEnabledBaseUrl}/api/workspace/uid_nora/safety/analyze`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-nora",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: "uid_nora",
          opportunityId: "",
          subjectLabel: "Operations Role",
          officialEmployerDomain: "realcompany.com",
          artifacts: [sampleArt],
          allowServerSideAi: false,
        }),
      }
    );
    assert.equal(optOutResp.status, 200);
    const optOutBody = (await optOutResp.json()) as {
      liveResearchStatus: string;
      liveResearchSummary: string;
    };
    assert.equal(optOutBody.liveResearchStatus, "unavailable");
    assert.equal(optOutBody.liveResearchSummary, "Live verification unavailable");

    // 8C: Review engine surfaces "Live verification unavailable" in whatRemainsUnknown
    const review = recheckAuthenticityReview(
      {
        ...createInitialAuthenticityReview({
          id: "rev-test-8",
          userId: "uid_nora",
          subjectLabel: "Operations Role",
        }),
        artifacts: [sampleArt],
      },
      {
        liveResearchStatus: "unavailable",
        liveResearchSummary: "Live verification unavailable",
      }
    );
    assert.equal(review.liveResearchSummary, "Live verification unavailable");
    assert.ok(
      review.whatRemainsUnknown.some((line) =>
        line.includes("Live verification unavailable")
      )
    );
  });

  // ==========================================================================
  // ACCEPTANCE TEST 9: Cross-workspace isolation, SSRF protection & UI Pass Condition
  // ==========================================================================
  it("Acceptance Test 9: Blocks cross-workspace access (Nora/Harry/Admin), enforces SSRF/protocol/redirect safety, warns on unredacted PII, and meets UI pass conditions", async () => {
    // 9A: Unauthenticated request -> HTTP 401
    const unauthResp = await fetch(
      `${aiEnabledBaseUrl}/api/workspace/uid_nora/safety/analyze`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifacts: [] }),
      }
    );
    assert.equal(unauthResp.status, 401);

    // 9B: Nora attempting to access Harry's safety endpoints -> HTTP 403
    const noraToHarryAnalyze = await fetch(
      `${aiEnabledBaseUrl}/api/workspace/uid_harry/safety/analyze`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-nora",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ artifacts: [] }),
      }
    );
    assert.equal(noraToHarryAnalyze.status, 403);

    const noraToHarryFetchUrl = await fetch(
      `${aiEnabledBaseUrl}/api/workspace/uid_harry/safety/fetch-url`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-nora",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "https://jobs.example.com/open" }),
      }
    );
    assert.equal(noraToHarryFetchUrl.status, 403);

    // 9C: Bootstrapped Application Administrator attempting to access Nora's safety review -> HTTP 403
    const adminToNoraAnalyze = await fetch(
      `${aiEnabledBaseUrl}/api/workspace/uid_nora/safety/analyze`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-admin",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ artifacts: [] }),
      }
    );
    assert.equal(adminToNoraAnalyze.status, 403);

    // 9D: Nora attempting to link Harry's opportunityId or Harry's privateDocumentId -> HTTP 403
    const foreignOppResp = await fetch(
      `${aiEnabledBaseUrl}/api/workspace/uid_nora/safety/analyze`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-nora",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: "uid_nora",
          opportunityId: "opp-harry-ops-1",
          artifacts: [],
        }),
      }
    );
    assert.equal(foreignOppResp.status, 403);
    const foreignOppJson = (await foreignOppResp.json()) as { errorCode: string };
    assert.equal(foreignOppJson.errorCode, "FOREIGN_OPPORTUNITY_DENIED");

    const foreignDocResp = await fetch(
      `${aiEnabledBaseUrl}/api/workspace/uid_nora/safety/analyze`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-nora",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: "uid_nora",
          opportunityId: "",
          artifacts: [
            {
              id: "art-stolen-doc",
              type: "document",
              title: "Stolen doc ref",
              privateDocumentId: "doc-harry-private-1",
              contentExcerpt: "test",
            },
          ],
        }),
      }
    );
    assert.equal(foreignDocResp.status, 403);
    const foreignDocJson = (await foreignDocResp.json()) as { errorCode: string };
    assert.equal(foreignDocJson.errorCode, "FOREIGN_DOCUMENT_DENIED");

    // Engine workspace isolation validator also blocks foreign userId, opportunityId, and privateDocumentId
    const baseRev = createInitialAuthenticityReview({
      id: "rev-iso-1",
      userId: "uid_nora",
    });
    assert.equal(
      validateReviewWorkspaceIsolation({
        review: { ...baseRev, userId: "uid_harry" },
        activeUserId: "uid_nora",
        workspace: noraStarter,
      }).valid,
      false
    );
    assert.equal(
      validateReviewWorkspaceIsolation({
        review: { ...baseRev, opportunityId: "opp-harry-ops-1" },
        activeUserId: "uid_nora",
        workspace: noraStarter,
      }).valid,
      false
    );

    // 9E: SSRF, protocol, private IP, redirect hop, binary content-type & cookie-free header checks
    assert.equal(isPrivateOrReservedIpAddress("127.0.0.1"), true);
    assert.equal(isPrivateOrReservedIpAddress("10.24.0.5"), true);
    assert.equal(isPrivateOrReservedIpAddress("172.16.10.2"), true);
    assert.equal(isPrivateOrReservedIpAddress("192.168.1.1"), true);
    assert.equal(isPrivateOrReservedIpAddress("169.254.169.254"), true);
    assert.equal(isPrivateOrReservedIpAddress("100.64.1.1"), true);
    assert.equal(isPrivateOrReservedIpAddress("::1"), true);
    assert.equal(isPrivateOrReservedIpAddress("::ffff:127.0.0.1"), true);
    assert.equal(isPrivateOrReservedIpAddress("93.184.216.34"), false);

    const fileProto = await validateSafeExternalUrl("file:///etc/passwd");
    assert.equal(fileProto.safe, false);
    assert.equal(fileProto.errorCode, "DISALLOWED_PROTOCOL");

    const jsProto = await validateSafeExternalUrl("javascript:alert(1)");
    assert.equal(jsProto.safe, false);
    assert.equal(jsProto.errorCode, "DISALLOWED_PROTOCOL");

    const credsUrl = await validateSafeExternalUrl("https://admin:secret@example.com/jobs");
    assert.equal(credsUrl.safe, false);
    assert.equal(credsUrl.errorCode, "CREDENTIALS_IN_URL_BLOCKED");

    const localhostUrl = await validateSafeExternalUrl("http://localhost:3000/api/admin/invitations");
    assert.equal(localhostUrl.safe, false);
    assert.equal(localhostUrl.errorCode, "PRIVATE_HOST_BLOCKED");

    const metadataUrl = await validateSafeExternalUrl("http://169.254.169.254/latest/meta-data/");
    assert.equal(metadataUrl.safe, false);
    assert.equal(metadataUrl.errorCode, "PRIVATE_IP_BLOCKED");

    const dnsRebindResp = await fetch(
      `${aiEnabledBaseUrl}/api/workspace/uid_nora/safety/fetch-url`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-nora",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "https://evil-rebind.example.com/job" }),
      }
    );
    assert.equal(dnsRebindResp.status, 400);
    const dnsRebindJson = (await dnsRebindResp.json()) as { errorCode: string };
    assert.equal(dnsRebindJson.errorCode, "PRIVATE_IP_BLOCKED");

    // Redirect from safe public URL -> 169.254.169.254 MUST be blocked on the redirect hop!
    const redirectSsrfResp = await fetch(
      `${aiEnabledBaseUrl}/api/workspace/uid_nora/safety/fetch-url`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-nora",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "https://jobs.example.com/redirect-to-metadata" }),
      }
    );
    assert.equal(redirectSsrfResp.status, 400);
    const redirectSsrfJson = (await redirectSsrfResp.json()) as {
      ok: boolean;
      errorCode: string;
    };
    assert.equal(redirectSsrfJson.ok, false);
    assert.equal(redirectSsrfJson.errorCode, "PRIVATE_IP_BLOCKED");

    // Binary / executable attachment URL is blocked and never executed
    const binaryFetch = await controlledFetchPublicUrl(
      "https://jobs.example.com/malware.exe",
      {
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        externalHttpFetch: async () => ({
          status: 200,
          headers: {
            get: (n: string) =>
              n.toLowerCase() === "content-type" ? "application/x-msdownload" : null,
          },
          bodyText: "MZ",
        }),
      }
    );
    assert.equal(binaryFetch.ok, false);
    assert.equal(binaryFetch.errorCode, "DISALLOWED_CONTENT_TYPE");

    // Outbound URL checks never attach Cookie or Authorization headers
    assert.ok(capturedOutboundHeaders.length > 0);
    for (const call of capturedOutboundHeaders) {
      const lowerKeys = Object.keys(call.headers).map((k) => k.toLowerCase());
      assert.equal(lowerKeys.includes("cookie"), false);
      assert.equal(lowerKeys.includes("authorization"), false);
    }

    // 9F: Redaction warnings & UI Pass Condition checks
    const piiWarnings = detectUnredactedSensitivePatterns(
      "My SSN is 123-45-6789, routing number: 021000021, verification code: 849201"
    );
    assert.ok(piiWarnings.length >= 3);

    // Every allowed overall status maps cleanly and contains zero forbidden labels
    for (const status of ALLOWED_OVERALL_STATUSES) {
      const label = OVERALL_STATUS_LABELS[status];
      assert.ok(label.length > 0);
      assert.equal(assertNoForbiddenSafetyLabels(label).clean, true);
    }

    // Verify UI component source meets the Pass Condition & navigation requirements
    const panelSource = fs.readFileSync(
      path.join(__dirname, "../src/components/AuthenticitySafetyReviewPanel.tsx"),
      "utf8"
    );
    const oppsSource = fs.readFileSync(
      path.join(__dirname, "../src/components/OpportunitiesView.tsx"),
      "utf8"
    );
    const findEvalSource = fs.readFileSync(
      path.join(__dirname, "../src/components/FindEvaluateView.tsx"),
      "utf8"
    );

    assert.ok(oppsSource.includes("Authenticity & Safety"));
    assert.ok(findEvalSource.includes("Authenticity & Safety Review"));
    assert.match(panelSource, /What Was Checked/i);
    assert.match(panelSource, /What Remains Unknown/i);
    assert.match(panelSource, /What You Should Verify Next/i);
    assert.match(panelSource, /Observed behavior \(fact\)/i);
    assert.match(panelSource, /Interpretation \(for your judgment\)/i);
  });
});
