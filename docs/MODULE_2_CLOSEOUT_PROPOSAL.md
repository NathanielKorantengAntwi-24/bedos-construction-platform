# Module 2 remaining invitation recovery and audit scope

1 November 2026. Status: user approved recovery implementation and release; deployed with production SQL checks passed and private administrator/email acceptance pending. Audit-grant changes remain a separate unimplemented subsequent step. Earlier list/detail, status and ordinary staff role steps remain complete. Module 2 remains open; Module 3 deferred.

## Module objective

Close the verified partial invitation setup recovery gap and remove unnecessary audit-table privileges while preserving existing onboarding proofs, inactive-account protections, atomic audit and backend behavior. Implement and verify recovery first; audit grants form a separate subsequent step.

## Existing implementation and dependencies

POST /api/users/invite creates an Auth identity, configures its inactive profile, records trusted invitation authorization/audit, sends mail and records password baseline. Configuration or authorization failure deliberately retains the Auth account; repeated initial invite returns 409 for the existing email. This prevents customer reassignment but leaves those early failures without a recovery API.

POST /api/users/[id]/retry-invitation already covers failures AFTER a trusted pending invitation exists. Its SQL prepares a baseline if missing, preserves an existing baseline, serializes attempts, imposes cooldown, chooses invite/recovery and audits dispatch outcome. It does not repair a missing invitation or mismatched profile. The provider accepting mail is not proof of delivery. Failed/stale dispatch completion and actor/identity changes remain audited or fail closed.

The existing bedos_staff_onboarding_pending flag lives in user_metadata. It is user editable and must not authorize account reassignment. Installed AdminUserAttributes supports app_metadata, documented as modifiable only through service access; production has raw_app_meta_data. A server-owned creation marker can supply durable evidence for NEW incomplete setup attempts, even if later profile/audit work fails. A timestamp or mutable flag alone is insufficient evidence for legacy orphan recovery.

Production metadata-only preflight confirmed audit_logs owner postgres, RLS enabled and no policies. anon, authenticated and service_role each retain SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER. No production audit rows or account records were read in this review. Source search found no application direct audit-table consumers; inspected mutations write through SECURITY DEFINER RPCs. Service SELECT is used by verification; backend INSERT remains appropriate for append-only audit writing. TRUNCATE is not ordinary PostgREST CRUD, and no HTTP exploit is claimed.

Evidence: module-2-evidence/module2-closeout-preflight.json/.sql and inspected invitation routes/RPCs. Historical failure-path tests preserve inactive accounts and prohibit silent customer reassignment.

## Proposed recovery contract

Add POST /api/users/[id]/resume-invitation with body {reason}, users.manage required, UUID/unknown-field/reason validation and private/no-store responses. Reason is nonblank, maximum 500 characters, and must not contain secrets. The caller cannot select a different email, role, account status or actor.

For NEW initial invitation requests, create a backend-owned versioned app_metadata marker atomically with Auth user creation: random request ID, requested ordinary staff role and originating administrator ID. Generate it on the server; never copy caller-supplied metadata or treat the request ID as a secret authorization token. Existing customer signup does not create this marker. An existing-email conflict remains 409 and does not retrofit provenance.

A new service-only SQL setup/resume RPC independently checks the acting administrator, reads authoritative server-owned marker fields from Auth and locks actor -> existing invitation -> target profile consistently with current transitions. Only the original bound ordinary role may be configured. Require an inactive profile in its default customer role or already-matching intended staff role; reject other roles/statuses, administrator/self targets and missing/tampered/unknown-version markers. A customer without this backend provenance cannot be converted to staff.

For an absent invitation, configure that exact profile and create trusted approval/audit atomically. For an existing matching pending invitation, perform an idempotent eligibility check without duplicating initial approval. Reject activated/revoked invitations and mismatched approval. Preserve original creator/request reference and record the current resuming actor/reason in a separate setup-resumed audit. Audit failure rolls back configuration and approval together. A missing profile or ambiguous legacy record fails closed for controlled review; this endpoint does not create arbitrary replacement profiles.

Initial invite and explicit resume share this atomic setup operation to avoid divergence. After successful setup, use the existing guarded retry machinery for resume email dispatch; preserve cooldown, attempt outcomes and password-change proof. Do not duplicate provider dispatch or overwrite an established baseline. Verify actual invite/recovery provider behavior before accepting the integration, including email acceptance followed by baseline/outcome failure and a password already set before retry.

Suggested success response: HTTP 202 {user_id, invitation_id, recovery_method, message}, using the existing retry response shape. Setup repair must not imply email acceptance when dispatch fails. Errors: 400 malformed input, 401 unauthenticated, 403 forbidden/missing trusted provenance, 404 absent user, 409 incompatible lifecycle/profile/approval, 429 retry cooldown, 502 provider rejection, 503 missing trusted origin, 500 sanitized unexpected/audit failure. Check trusted origin before any setup mutation.

Legacy early-failure accounts cannot be safely certified from mutable flags alone. Keep them inactive and document a controlled exact-identity review; do not automatically delete them or stamp them as trusted. Existing legacy trusted pending invitations continue through their current retry endpoint. No marker is required retroactively for already-working invitation, activation, status or role flows.

## Relevant files and implementation plan

- src/app/api/users/invite/route.ts and tests: add server-owned provenance on new creation and replace separate configure/approve steps with the atomic setup RPC; retain duplicate-customer safeguards and safe errors.
- Proposed src/app/api/users/[id]/resume-invitation/route.ts and shared invitation service: users.manage, input/config checks, setup resume, shared existing retry dispatch.
- src/app/api/users/[id]/retry-invitation/route.ts and tests: extract shared orchestration without changing its public contract; keep legacy trusted pending behavior.
- One NEW setup/resume migration and local SQL/Auth/failure/concurrency tests. Never rewrite applied migrations or bypass proven baseline/activation requirements.
- Update the project map/checklist and record local acceptance before requesting a separate production release.

Acceptance: failures after Auth creation, during profile/approval/audit, during dispatch, baseline or completion can be resumed only within their allowed evidence/lifecycle boundary. Test forged mutable flags, missing/mismatched server markers, unrelated customer/admin accounts, revoked/activated targets, inactive/suspended actors, reason validation, duplicates, concurrent setup/retry/activation/revocation and audit rollback. Real local Auth/mail tests must prove no premature activation or role change. All existing Module 1/2 regressions, build and lint must pass. Keep production identifiers local.

## Proposed subsequent audit-grant step

After recovery is verified, separately review/apply a new migration that revokes all audit_logs table privileges from PUBLIC/anon/authenticated and removes UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from service_role, retaining its existing SELECT/INSERT. No new privilege is granted, no RLS bypass is added, no audit row/policy is deleted and SECURITY DEFINER owners retain required writes. Verify actual role memberships/inherited effective privileges, not only explicit grant rows.

Acceptance: local actual SQL proves ordinary roles cannot read/write/truncate audit data, service access retains permitted reads/inserts and cannot alter/remove history, and existing authorized RPC mutations still insert audits atomically. Run destructive permission-denial probes only in the isolated local lab, never against production audit data. Production verification uses effective-privilege metadata plus rollback-only synthetic mutation/audit assertions. Document that trusted database owners can still administer data; this is least privilege, not immutable external archival.

## Completion status and next module

Recovery implemented and locally verified under user approval; current report MODULE_2_INVITATION_RECOVERY.md. No production migration/deployment or audit-grant changes made. Separate recovery release approval/production verification is next. Verify that checkpoint before starting the audit-grant work. Module 2 remains active until both accepted steps and limitations are recorded; Module 3 deferred.
