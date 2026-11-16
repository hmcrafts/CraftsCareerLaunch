# Migration, Multi-User Ownership, and Rollback Plan

## 1. Guiding Principles
1. **Extend, Never Replace**: Keep the existing React 19 + Express (`server.ts`) architecture, Firebase Authentication (Google Sign-In), and Google Cloud Firestore (`projectId: "europe26"`, `firestoreDatabaseId: "ai-studio-norascareerlaunc-ad070931-6fa9-4084-9978-166619e4f5c2"`).
2. **Additive Schema Evolution (`CURRENT_SCHEMA_VERSION = 2`)**: All multi-user, onboarding, and sharing additions are strictly additive optional fields or separate top-level administrative collections. Existing documents under `/users/{noraUid}` and `/users/{harryUid}` remain valid without destructive backfills or overwrites.
3. **Zero Fictional Seeding in Real Workspaces**:
   - Existing `/users/{uid}` documents are never overwritten (`if (snap.exists()) return` on client bootstrap; `currentDocument: { exists: false }` precondition on backend invitation acceptance).
   - Non-Nora users receive a clean, empty private workspace (`opportunities: []`, `evidence: []`, `contacts: []`, `tasks: []`) and never receive Nora's personal starter data or fictional sample records in Firestore.
   - Sample benchmark opportunities (`ISOLATED_SAMPLE_OPPORTUNITIES`, `isSampleRecord: true`) and synthetic CRM practice accounts (`SYNTHETIC_CRM_ACCOUNTS`) exist strictly as read-only constants in UI memory when explicitly toggled and are filtered out before any database write or export.

---

## 2. Record Ownership & Permitted Access Matrix

Every Firestore collection and subcollection enforces verified identity (`request.auth != null && request.auth.token.email_verified == true`) and explicit ownership:

| Firestore Path | Owner / Scope Field | Read (`get` / `list`) | Write (`create` / `update` / `delete`) | Admin Career Access? |
| :--- | :--- | :--- | :--- | :--- |
| `/users/{userId}` | `userId == userId` (immutable) | `get`: `isOwner(userId)` only; `list`: `false` | `isOwner(userId)` only (strict key allowlist) | **No (`DENIED`)** |
| `/users/{userId}/evidence/{evidenceId}` | `userId` + Master Gate on `/users/{userId}` | `isOwner(userId)` + `existing().userId == request.auth.uid` | `isOwner(userId)` + `incoming().userId == request.auth.uid` | **No (`DENIED`)** |
| `/users/{userId}/opportunities/{opportunityId}` | `userId` + Master Gate | `isOwner(userId)` + `existing().userId == request.auth.uid` | `isOwner(userId)` + `incoming().userId == request.auth.uid` | **No (`DENIED`)** |
| `/users/{userId}/assessments/{assessmentId}` | `userId` + parent `opportunityId` `exists`/`existsAfter` | `isOwner(userId)` + `existing().userId == request.auth.uid` | `isOwner(userId)` + parent opportunity in same `userId` | **No (`DENIED`)** |
| `/users/{userId}/contacts/{contactId}` | `userId` + Master Gate | `isOwner(userId)` + `existing().userId == request.auth.uid` | `isOwner(userId)` + `incoming().userId == request.auth.uid` | **No (`DENIED`)** |
| `/users/{userId}/outreachDrafts/{draftId}` | `userId` + parent `contactId` `exists`/`existsAfter` | `isOwner(userId)` + `existing().userId == request.auth.uid` | `isOwner(userId)`; locked when `sentState == 'logged_sent'` | **No (`DENIED`)** |
| `/users/{userId}/applicationVersions/{versionId}` | `userId` + parent `opportunityId` `exists`/`existsAfter` | `isOwner(userId)` + `existing().userId == request.auth.uid` | `isOwner(userId)`; locked when `submitted == true` | **No (`DENIED`)** |
| `/users/{userId}/tasks/{taskId}` | `userId` + Master Gate | `isOwner(userId)` + `existing().userId == request.auth.uid` | `isOwner(userId)` + `incoming().userId == request.auth.uid` | **No (`DENIED`)** |
| `/users/{userId}/practiceSessions/{sessionId}` | `userId` + Master Gate | `isOwner(userId)` + `existing().userId == request.auth.uid` | `create`/`delete`: `isOwner(userId)`; `update`: `false` | **No (`DENIED`)** |
| `/users/{userId}/learningItems/{itemId}` | `userId` + Master Gate | `isOwner(userId)` + `existing().userId == request.auth.uid` | `isOwner(userId)` + `incoming().userId == request.auth.uid` | **No (`DENIED`)** |
| `/users/{userId}/timeLogs/{logId}` | `userId` + Master Gate | `isOwner(userId)` + `existing().userId == request.auth.uid` | `create`/`delete`: `isOwner(userId)`; `update`: `false` | **No (`DENIED`)** |
| `/users/{userId}/documents/{documentId}` | `userId` + Master Gate | `isOwner(userId)` + `existing().userId == request.auth.uid` | `create`/`delete`: `isOwner(userId)`; `update`: `false` | **No (`DENIED`)** |
| `/users/{userId}/documentBlobs/{documentId}` | `userId` + parent `documents/{documentId}` | `get`: `isOwner(userId)` only; `list`: **`false`** | `create`/`delete`: `isOwner(userId)`; `update`: `false` | **No (`DENIED`)** |
| `/users/{userId}/relationships/{relationshipId}` | `userId` + Master Gate + tuple/evidence rules | `isOwner(userId)` + `existing().userId == request.auth.uid` | `isOwner(userId)` + `isValidRelationshipEdge` + rejected-edge lock | **No (`DENIED`)** |
| `/users/{userId}/authenticityReviews/{reviewId}` | `userId` + Master Gate + optional parent `opportunityId` | `isOwner(userId)` + `existing().userId == request.auth.uid` | `isOwner(userId)` + `isValidAuthenticityReview` + impersonation proof gate | **No (`DENIED`)** |
| `/admins/{adminUid}` | `uid == adminUid` | `isOwner(adminUid) \|\| isAdmin()` | `isAdmin()` only | Admin registry only |
| `/invitations/{invitationId}` | `inviterUid`, `visibilityScope: 'admin'` | `isAdmin()` or verified matching `recipientEmailNormalized` (`get` only) | `create`: `isAdmin()`; `update`: admin lifecycle or verified recipient redeem; `delete`: `false` | Invitation metadata only |
| `/invitationTokens/{tokenHash}` | SHA-256 `tokenHash` (64 hex) | `get`: capability lookup by 64-hex hash; `list`: **`false`** | `create`: `isAdmin()`; `update`: supersede/revoke/redeem; `delete`: `false` | Masked metadata only |
| `/auditLogs/{logId}` | `actorUid == request.auth.uid` | `isAdmin()` | Append-only `create` by verified actor; `update`/`delete`: `false` | Event codes only (no career PII) |

*Infrastructure Disclosure*: Application permissions prevent administrators from reading `/users/{otherUid}` through the app or client SDKs. However, Google Cloud / Firebase project owners with IAM console privileges on `europe26` retain infrastructure-level database access unless client-side end-to-end encryption is added in a future phase.

---

## 3. Additive Database Changes (Forward Migration)
1. **Existing `/users/{userId}` documents (v1 -> v2)**:
   - Optional fields added to `/users/{userId}`:
     - `onboardingWizard` (`map`, optional)
     - `sharingSettings` (`map`, optional; defaults to `{ mode: "private", reviewersEnabled: false }` on read if absent)
     - `inviterSuggestions` (`list`, max 10 items, optional)
   - Validation helper `isValidUserProfile(data)` in `firestore.rules` explicitly permits both v1 documents (without optional fields) and v2 documents (with optional fields) via `!('onboardingWizard' in data) || ...`.
   - Zero destructive migration scripts are run against existing `/users/{uid}` documents.
2. **New Top-Level Administrative Collections**:
   - `/admins/{adminUid}`
   - `/invitations/{invitationId}`
   - `/invitationTokens/{tokenHash}`
   - `/auditLogs/{logId}`
   - Completely disjoint from `/users/{userId}`; cannot collide with or alter existing career records.
3. **Additive Evidence Relationship Graph Subcollection (v2.1)**:
   - `/users/{userId}/relationships/{relationshipId}` stores workspace-private typed edges (`suggested`, `confirmed`, `rejected`) in the existing Cloud Firestore database without introducing an external graph database or modifying any existing user records.
   - There is no shared cross-workspace graph or shared "fraudulent people" graph; employer safety and authenticity notes remain scoped to the individual workspace's opportunity record.
4. **Additive Authenticity & Safety Review Subcollection (v2.2)**:
   - `/users/{userId}/authenticityReviews/{reviewId}` stores workspace-private authenticity reviews (both opportunity-linked and standalone pre-opportunity reviews) with bounded `artifacts`, `checks`, and `findings` lists. Existing user documents and opportunities are preserved untouched.

---

## 4. Rollback Plan
If a regression is detected in the invitation or multi-user layer:
1. **Application Rollback (Non-Destructive to User Data)**:
   - Disable administrative invitation entry points in UI/server while keeping `/users/{userId}` routes and `subscribeToUserWorkspace` intact.
   - Because `/users/{userId}` additions (`onboardingWizard`, `sharingSettings`, `inviterSuggestions`) are optional fields and all 12 subcollections retain identical field schemas, Nora's and Harry's workspaces continue reading and saving without data loss.
2. **Security Rules Rollback**:
   - In `firestore.rules`, `/invitations`, `/invitationTokens`, and `/admins` can be locked to `allow read, write: if false;` and redeployed via `DeployRules` without modifying `/users/{userId}` or any of its 12 subcollection match blocks.
   - Never delete `/users/{userId}` documents during a rollback.
3. **Offline User-Controlled Snapshots**:
   - Before major account changes, any workspace owner can export a full JSON snapshot (`Settings -> Export JSON Backup` or `Decisions & Progress -> Export Full Records (.json)`).
