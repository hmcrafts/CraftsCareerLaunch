# Security Specification — Career Launch (Zero-Trust Workspace Isolation & RBAC Invitations)

## 1. Master Source of Truth & Data Invariants

1. **Identity & Verified Ownership Invariant**: Every private career workspace document lives under `/users/{userId}` or `/users/{userId}/<subcollection>/{docId}` where `userId == request.auth.uid` AND `request.auth.token.email_verified == true`.
2. **Administrator Isolation Invariant (No Admin Escape Hatch on Private Workspaces)**: Application Administrators (`hmcrafts@craftsconsulting.com` with `email_verified == true`, or entries in `/admins/{adminUid}`) may manage `/invitations`, `/invitationTokens`, `/admins`, and `/auditLogs`, **but have ZERO read, list, create, update, or delete privileges on `/users/{otherUserId}` or any subcollection**. Inviting Nora or Harry never grants the inviter access to their private career records.
3. **Split-Collection Invitation PII & Token-Hash Invariant**:
   - Raw 256-bit invitation tokens are **never** persisted; only 64-character hex SHA-256 hashes (`^[a-f0-9]{64}$`) are stored.
   - `/invitations/{invitationId}` stores the full invitation record and is accessible ONLY to `isAdmin()` or (on `get` / acceptance `update`) to the verified recipient whose `request.auth.token.email.lower() == resource.data.recipientEmailNormalized`.
   - `/invitationTokens/{tokenHash}` is strictly non-listable (`allow list: if false`) and stores only masked recipient email (`h***i@domain.com`), salted email hash, inviter display name, and lifecycle status (`active`, `superseded`, `revoked`, `accepted`) — zero unmasked email addresses or personal messages.
4. **Single-Use & Terminal Invitation Lifecycle Invariant**:
   - Once `/invitations/{id}.status == 'accepted'` or `/invitationTokens/{hash}.tokenStatus != 'active'`, redemption is blocked (`PERMISSION_DENIED`).
   - Resending an invitation marks the prior `/invitationTokens/{oldHash}` as `'superseded'` and clears display fields, invalidating the old link.
5. **Immutable Append-Only Audit Log Invariant**: `/auditLogs/{logId}` enforces `actorUid == request.auth.uid`, `createdAt == request.time`, allows `get`/`list` only for `isAdmin()`, and forbids all `update` and `delete` operations (`allow update, delete: if false`).
6. **Master Gate Relational Sync & Subcollection Integrity**: Every subcollection under `/users/{userId}/...` verifies parent `/users/{userId}` ownership (`exists` or `existsAfter`), foreign-key existence (`opportunities`, `contacts`, `documents`), and non-listable `documentBlobs` (`allow list: if false`).
7. **Evidence Relationship Graph Isolation & Integrity (`/users/{userId}/relationships/{relationshipId}`)**:
   - Strictly isolated to `isOwner(userId)` (`existing().userId == request.auth.uid` on `list`; zero `isAdmin()` privileges).
   - Enforces the permitted `(sourceType, relationshipType, targetType)` matrix (`isAllowedRelationshipTuple`), preventing `learning -> demonstrates -> skill` or arbitrary edge combinations.
   - Forbids marking `claims_affiliation_with` as `'confirmed'`, requires `evidenceIds.size() >= 1` when confirming `demonstrates` / `supports` / `adjacent_to`, verifies `evidenceIds[0]` belongs to `/users/$(userId)/evidence/...` or `/users/$(userId)/documents/...` when non-empty, and prevents reopening a `'rejected'` relationship unless `incoming().evidenceIds` introduces new evidence (`incoming().evidenceIds.size() >= 1 && incoming().evidenceIds != existing().rejectedEvidenceIds`).
8. **Authenticity & Safety Review Isolation & Honesty Gate (`/users/{userId}/authenticityReviews/{reviewId}`)**:
   - Strictly isolated to `isOwner(userId)` (`existing().userId == request.auth.uid` on `list`; zero `isAdmin()` privileges; zero cross-workspace sharing or public allegations).
   - Enforces the 6 allowed `overallStatus` values (`not_reviewed`, `partially_corroborated`, `unresolved_concerns`, `high_risk_request_detected`, `corroborated_within_stated_scope`, `documented_impersonation_confirmation`), validates all 5 separate dimension summaries in `dimensionAssessments`, verifies optional `opportunityId` belongs to `/users/$(userId)/opportunities/...`, and forbids setting `overallStatus == 'documented_impersonation_confirmation'` unless `impersonationConfirmation.active == true` with non-empty `confirmedByIdentity`, non-empty `identityEstablishmentMethod`, and a valid `supportingArtifactId`.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Admin Snooping on Invitee Workspace**: Bootstrapped admin (`hmcrafts@craftsconsulting.com`, `email_verified: true`) attempting `get(/users/uid_harry)` or `list(/users/uid_nora/opportunities)` -> `PERMISSION_DENIED`.
2. **Non-Admin Invoking Invitation Creation**: Verified job seeker `uid_nora` attempting `create(/invitations/inv_1)` or `list(/invitations)` -> `PERMISSION_DENIED`.
3. **Unverified Admin Email Spoof**: Attacker with `email: "hmcrafts@craftsconsulting.com"` and `email_verified: false` attempting `list(/invitations)` -> `PERMISSION_DENIED`.
4. **Wrong Signed-In Email Redeeming Invitation**: Verified user `mallory@example.com` attempting `update(/invitations/inv_harry)` (`recipientEmailNormalized: "harry@example.com"`) to `status: "accepted"` -> `PERMISSION_DENIED`.
5. **Token Enumeration Scrape**: Attacker or signed-in user attempting `list(/invitationTokens)` -> `PERMISSION_DENIED` (`allow list: if false`).
6. **Redeemed / Revoked Token Replay**: Verified recipient attempting `update(/invitationTokens/hash_1)` when `existing().tokenStatus == "accepted"` or `"revoked"` -> `PERMISSION_DENIED`.
7. **Audit Log Tampering / Deletion**: Admin or user attempting `update` or `delete` on `/auditLogs/log_1` -> `PERMISSION_DENIED`.
8. **Shadow Ghost-Field Injection**: Owner attempting `update` on `/users/uid_nora` adding `{ "isAdmin": true }` -> Rejected by `hasOnly()`.
9. **Self-Assigned Admin Escalation**: Regular user attempting `create(/admins/uid_mallory)` -> `PERMISSION_DENIED`.
10. **Client Timestamp Forgery**: Admin or user attempting `create` with `createdAt != request.time` -> `PERMISSION_DENIED`.
11. **Value / Denial-of-Wallet String Poisoning**: Admin attempting `create(/invitations/inv_bad)` with a 5,000-character `personalMessage` (limit 500) -> Rejected by `isValidInvitation()`.
12. **Private File Bulk Enumeration**: Any user attempting `list(/users/uid_harry/documentBlobs)` -> `PERMISSION_DENIED`.
