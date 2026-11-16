/**
 * Security Rules Specification & Live Cloud Firestore Enforcement Suite — Career Launch
 *
 * Executes:
 * 1. Structural & RBAC boundary audits on /firestore.rules (default-deny, zero admin access to /users/{uid}/*,
 *    email_verified enforcement, non-listable documentBlobs & invitationTokens, temporal expiration, and reviewer lock).
 * 2. Live HTTP probes against the deployed Google Cloud Firestore database (europe26) verifying that unauthenticated
 *    and forged-token reads, subcollection queries, and token enumerations are rejected with HTTP 403 / 401.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AdversarialAssertion {
  id: number;
  name: string;
  actor: {
    uid: string | null;
    email?: string;
    email_verified?: boolean;
  };
  operation: "get" | "list" | "create" | "update" | "delete";
  path: string;
  payload?: Record<string, unknown>;
  expectedOutcome: "PERMISSION_DENIED";
}

export const DIRTY_DOZEN_RBAC_SUITE: AdversarialAssertion[] = [
  {
    id: 1,
    name: "Admin snooping on invitee or Nora workspace is strictly denied",
    actor: {
      uid: "uid_admin",
      email: "hmcrafts@craftsconsulting.com",
      email_verified: true,
    },
    operation: "get",
    path: "users/uid_harry",
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 2,
    name: "Non-admin job seeker creating or listing invitations is denied",
    actor: {
      uid: "uid_nora",
      email: "nora@example.com",
      email_verified: true,
    },
    operation: "list",
    path: "invitations",
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 3,
    name: "Unverified admin email spoof is denied",
    actor: {
      uid: "uid_spoof",
      email: "hmcrafts@craftsconsulting.com",
      email_verified: false,
    },
    operation: "list",
    path: "invitations",
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 4,
    name: "Wrong signed-in email redeeming invitation is denied",
    actor: {
      uid: "uid_mallory",
      email: "mallory@example.com",
      email_verified: true,
    },
    operation: "update",
    path: "invitations/inv_harry_1",
    payload: { status: "accepted", acceptedByUid: "uid_mallory" },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 5,
    name: "Enumerating /invitationTokens collection is denied",
    actor: {
      uid: "uid_admin",
      email: "hmcrafts@craftsconsulting.com",
      email_verified: true,
    },
    operation: "list",
    path: "invitationTokens",
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 6,
    name: "Replaying an already accepted or revoked token is denied",
    actor: {
      uid: "uid_harry",
      email: "harry@example.com",
      email_verified: true,
    },
    operation: "update",
    path: "invitationTokens/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    payload: { tokenStatus: "accepted" },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 7,
    name: "Mutating or deleting immutable /auditLogs is denied",
    actor: {
      uid: "uid_admin",
      email: "hmcrafts@craftsconsulting.com",
      email_verified: true,
    },
    operation: "delete",
    path: "auditLogs/audit_1",
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 8,
    name: "Shadow ghost-field injection on /users/{uid} is denied",
    actor: {
      uid: "uid_nora",
      email: "nora@example.com",
      email_verified: true,
    },
    operation: "update",
    path: "users/uid_nora",
    payload: { isAdmin: true },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 9,
    name: "Self-assigned admin escalation on /admins/{uid} is denied",
    actor: {
      uid: "uid_mallory",
      email: "mallory@example.com",
      email_verified: true,
    },
    operation: "create",
    path: "admins/uid_mallory",
    payload: { id: "uid_mallory", uid: "uid_mallory" },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 10,
    name: "Forged client createdAt timestamp on invitation is denied",
    actor: {
      uid: "uid_admin",
      email: "hmcrafts@craftsconsulting.com",
      email_verified: true,
    },
    operation: "create",
    path: "invitations/inv_forged_time",
    payload: { createdAt: "2020-01-01T00:00:00Z" },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 11,
    name: "Oversized personalMessage (>500 chars) on invitation is denied",
    actor: {
      uid: "uid_admin",
      email: "hmcrafts@craftsconsulting.com",
      email_verified: true,
    },
    operation: "create",
    path: "invitations/inv_oversize",
    payload: { personalMessage: "x".repeat(501) },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 12,
    name: "Listing private /documentBlobs is denied",
    actor: {
      uid: "uid_harry",
      email: "harry@example.com",
      email_verified: true,
    },
    operation: "list",
    path: "users/uid_harry/documentBlobs",
    expectedOutcome: "PERMISSION_DENIED",
  },
];

const rulesSource = fs.readFileSync(path.join(__dirname, "firestore.rules"), "utf8");

describe("Firestore Security Rules — Structural Multi-User & RBAC Invariants", () => {
  it("enforces a default-deny catch-all rule across the entire database", () => {
    assert.match(
      rulesSource,
      /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/
    );
  });

  it("requires verified email tokens in isVerifiedUser() and strict UID equality in isOwner()", () => {
    assert.match(rulesSource, /request\.auth\.token\.email_verified\s*==\s*true/);
    assert.match(
      rulesSource,
      /function\s+isOwner\(userId\)\s*\{\s*return\s+isVerifiedUser\(\)\s*&&\s*request\.auth\.uid\s*==\s*userId;\s*\}/
    );
  });

  it("grants zero Application Administrator (isAdmin) privileges on /users/{userId} and all 14 private subcollections", () => {
    const usersSectionStart = rulesSource.indexOf("match /users/{userId}");
    assert.ok(usersSectionStart > 0, "Expected match /users/{userId} in firestore.rules");
    const usersSection = rulesSource.slice(usersSectionStart);

    // Every single private career collection must be governed strictly by isOwner(userId), NEVER isAdmin()
    assert.equal(
      usersSection.includes("isAdmin()"),
      false,
      "isAdmin() must NEVER appear inside /users/{userId} or any private career subcollection"
    );

    const expectedSubcollections = [
      "evidence",
      "opportunities",
      "assessments",
      "contacts",
      "outreachDrafts",
      "applicationVersions",
      "tasks",
      "practiceSessions",
      "learningItems",
      "timeLogs",
      "documents",
      "documentBlobs",
      "relationships",
      "authenticityReviews",
    ];
    for (const sub of expectedSubcollections) {
      assert.ok(
        usersSection.includes(`match /${sub}/`),
        `Expected explicit nested match rule for /${sub} under /users/{userId}`
      );
    }
  });

  it("blocks listing of /documentBlobs and /invitationTokens and enforces userId filter on all listable subcollections", () => {
    const tokenBlockStart = rulesSource.indexOf("match /invitationTokens/{tokenHash}");
    const tokenBlockEnd = rulesSource.indexOf("match /auditLogs/{auditId}");
    const tokenBlock = rulesSource.slice(tokenBlockStart, tokenBlockEnd);
    assert.match(tokenBlock, /allow\s+list:\s*if\s+false;/);
    assert.match(tokenBlock, /request\.time\.toMillis\(\)\s*<=\s*existing\(\)\.expiresAtEpochMs/);

    const blobBlockStart = rulesSource.indexOf("match /documentBlobs/{documentId}");
    assert.ok(blobBlockStart > 0);
    const blobBlock = rulesSource.slice(blobBlockStart);
    assert.match(blobBlock, /allow\s+list:\s*if\s+false;/);

    const listMatches = rulesSource.match(
      /allow\s+list:\s*if\s+isOwner\(userId\)\s*&&\s*existing\(\)\.userId\s*==\s*request\.auth\.uid;/g
    );
    assert.equal(
      listMatches?.length,
      13,
      "All 13 listable owner subcollections (including /relationships and /authenticityReviews) must enforce isOwner(userId) && existing().userId == request.auth.uid"
    );
  });

  it("enforces defined entity/relationship tuples, claims-affiliation safeguard, and rejected-suggestion lock on /relationships", () => {
    assert.match(rulesSource, /function\s+isAllowedRelationshipTuple/);
    assert.match(
      rulesSource,
      /!\(data\.relationshipType\s*==\s*'claims_affiliation_with'\s*&&\s*data\.status\s*==\s*'confirmed'\)/
    );
    assert.match(
      rulesSource,
      /incoming\(\)\.evidenceIds\s*!=\s*existing\(\)\.rejectedEvidenceIds/
    );
  });

  it("enforces strict 6-status vocabulary and documented impersonation confirmation proof on /authenticityReviews", () => {
    assert.match(rulesSource, /function\s+isValidAuthenticityReview/);
    assert.match(rulesSource, /'documented_impersonation_confirmation'/);
    assert.match(
      rulesSource,
      /data\.impersonationConfirmation\.confirmedByIdentity\.size\(\)\s*>=\s*3/
    );
    assert.match(
      rulesSource,
      /data\.impersonationConfirmation\.identityEstablishmentMethod\.size\(\)\s*>=\s*5/
    );
    assert.match(
      rulesSource,
      /isValidId\(data\.impersonationConfirmation\.supportingArtifactId\)/
    );
  });

  it("locks sharingSettings to mode=='private' and reviewersEnabled==false so unrestricted reviewer shortcuts are impossible", () => {
    assert.match(rulesSource, /sh\.mode\s*==\s*'private'/);
    assert.match(rulesSource, /sh\.reviewersEnabled\s*==\s*false/);
  });

  it("keeps all 12 Dirty Dozen RBAC adversarial test vectors defined", () => {
    assert.equal(DIRTY_DOZEN_RBAC_SUITE.length, 12);
  });
});

describe("Live Deployed Cloud Firestore REST Security Probes (europe26)", () => {
  const configPath = path.join(__dirname, "firebase-applet-config.json");
  const hasConfig = fs.existsSync(configPath);
  const cfg = hasConfig
    ? (JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        projectId?: string;
        firestoreDatabaseId?: string;
        apiKey?: string;
      })
    : {};

  const baseUrl =
    cfg.projectId && cfg.firestoreDatabaseId
      ? `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${encodeURIComponent(
          cfg.firestoreDatabaseId
        )}/documents`
      : "";
  const keyQuery = cfg.apiKey ? `?key=${encodeURIComponent(cfg.apiKey)}` : "";

  it("denies unauthenticated direct reads on Nora's and Harry's workspace documents and private documentBlobs", async (t) => {
    if (!baseUrl) {
      t.skip("Firebase config not present");
      return;
    }

    const targets = [
      `${baseUrl}/users/uid_nora${keyQuery}`,
      `${baseUrl}/users/uid_harry${keyQuery}`,
      `${baseUrl}/users/uid_nora/documentBlobs/doc-private-1${keyQuery}`,
      `${baseUrl}/users/uid_nora/authenticityReviews/rev-probe-1${keyQuery}`,
      `${baseUrl}/invitations/inv-probe-1${keyQuery}`,
    ];

    for (const url of targets) {
      const resp = await fetch(url);
      assert.equal(
        resp.status,
        403,
        `Expected deployed Cloud Firestore rules to return HTTP 403 PERMISSION_DENIED for ${url}, got ${resp.status}`
      );
    }
  });

  it("denies unauthenticated subcollection structuredQuery listing and /invitationTokens enumeration", async (t) => {
    if (!baseUrl) {
      t.skip("Firebase config not present");
      return;
    }

    const noraOppsQuery = await fetch(`${baseUrl}/users/uid_nora:runQuery${keyQuery}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "opportunities" }],
        },
      }),
    });
    assert.equal(noraOppsQuery.status, 403);

    const tokenListResp = await fetch(`${baseUrl}/invitationTokens${keyQuery}`);
    assert.equal(tokenListResp.status, 403);
  });

  it("rejects forged/tampered Bearer tokens against deployed Cloud Firestore with HTTP 401", async (t) => {
    if (!baseUrl) {
      t.skip("Firebase config not present");
      return;
    }

    const forgedResp = await fetch(`${baseUrl}/users/uid_nora${keyQuery}`, {
      headers: {
        Authorization: "Bearer forged.invalid.jwt",
      },
    });
    assert.equal(forgedResp.status, 401);
  });
});
