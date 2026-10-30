# Module 2 Users Staff and RBAC audit

Started 30 October 2026 after Module 1 closure. Status: partially implemented; audit in progress. No Module 2 application changes or production writes performed in this audit.

## Module objective

Complete approved backend staff invitations, role assignment, permissions, customer/staff management and access control. Preserve verified Module 1 authentication/account protections. No staff dashboard or other frontend module is in scope. Existing minimal Auth handlers may need integration corrections for staff onboarding.

## Sources and verified boundaries

Final Technical Specification (roles/RBAC, users/staff administration, audit and security sections), 24-module implementation plan Module 2, Module 1 closure, current source and production metadata. Historical commit 1b6076f claimed Module 2 complete; this audit reconciles that claim rather than treating it as acceptance evidence. The staff migration's DRAFT comment is historical: its version is already recorded in production. Do not rerun or rewrite an applied migration merely to remove that comment.

## Existing implementation and dependencies

- POST /api/users/invite validates caller users.manage, checks allowed ordinary staff role, creates an inactive marked Auth/profile account, atomically records trusted approval/audit, sends the invitation and records password baseline.
- POST /api/users/[id]/activate requires users.manage and invokes DB activation. Email confirmation, password change after baseline, matching inactive staff profile and pending trusted invitation are checked in SQL.
- POST /api/users/[id]/revoke-invitation requires users.manage, revokes only eligible pending invitations and keeps staff inactive.
- POST /api/users/[id]/retry-invitation prepares a serialized/cooldown-limited attempt, selects invite/recovery based on email confirmation, checks Auth identity and records dispatch outcome.
- Shared requirePermission/requireRole check active account and database-backed roles/mappings. Supabase privileged client is used only behind backend authorization in inspected routes. SQL revalidates actor permissions for administrative transitions.
- Existing public staff roles: content_manager, finance, sales_customer_service; invitation flow excludes customer and administrator role assignment. Built-in role catalogue and permissions are not user-editable via the inspected routes.
- Dependencies: Supabase Auth/email delivery, profiles/roles/permissions/role_permissions, staff_invitations, audit_logs, six staff RPCs, existing invitation/password handlers and trusted application origin.

## Production evidence

Read-only capture: module-2-evidence/production-catalog.json. No Auth user rows, credentials or password-baseline values were queried.

- Six staff RPCs match repository SQL bodies after whitespace normalization, use SECURITY DEFINER and empty search_path; anon/authenticated cannot EXECUTE; service_role can.
- staff_invitations has 13 constraints, RLS enabled and no direct client policies; service_role has SELECT/INSERT/UPDATE only. No client table grants returned.
- Five built-in roles and 58 role-permission assignments returned. Only administrator has users.view and users.manage.
- audit_logs has RLS enabled and no client policies, so ordinary client row operations are denied. However anon/authenticated retain broad table grants including TRUNCATE. TRUNCATE is not exposed by ordinary PostgREST table CRUD; no HTTP exploit is being claimed. Least-privilege/audit-integrity review remains needed, including whether unused client grants should be revoked in a separately reviewed migration.
- Related public function inventory and source search found no admin list/detail/status/role-edit functions or REST handlers beyond the invitation lifecycle. Existing self-profile update is Module 1, not administrator customer/staff management.

## Testing and verification

Existing staff/RBAC test baseline: 15 files, 53 tests passed. These are mocked route/authorization tests, not proof of all provider/database behavior.

New audit harness scripts/Test-Module2StaffBaseline.mjs ran actual local Auth/RPC/SMTP against the guarded bedos-supabase-lab only. All 31 recorded assertions passed (including fixture guards/setup/cleanup): invitation authorization, identity consistency, post-send baseline, email verification, activation denied before password setup, authenticated password change, activation success, duplicate activation denial, invitation retry selection/result audit and denial of activation after resend without a genuine password change. The suspected baseline/resend bypass did not reproduce and is not a confirmed defect. Source: module-2-evidence/local-staff-lifecycle-baseline.json.

Synthetic actor/staff fixtures, invitation rows and matching audit records created by this harness were removed using exact-ID/identity guards. No real administrator role was changed. Tests call real RPC/Auth services; they do not yet exercise all Next.js administrator-success routes end to end. Full revocation, confirmed recovery, cooldown races, permission/audit failures and concurrency still require additional cases.

## Gap analysis

| Area | Finding | Evidence classification |
| --- | --- | --- |
| Confirmed invitation recovery | Retry uses privileged Supabase JS client (default implicit flow) and redirectTo /auth/set-password, which is not in the observed production redirect allow-list. Home InvitationHandler explicitly ignores recovery fragments. SSR browser client enforces PKCE and does not automatically accept implicit fragments. Simply replacing the redirect with a code-only callback would not fix this server-initiated implicit flow. | Verified source/config integration mismatch; full browser reproduction still pending |
| Invitation input validation | role_id is checked for string/nonblank only; malformed UUID proceeds to database role lookup and may be classified as server failure. Lifecycle ID validation exists in other routes. | Verified missing runtime UUID check; HTTP regression to add |
| Safe provider errors | Initial invite forwards invitationError.message directly to client; other stages use safe public errors. | Verified source inconsistency; add sanitized error regression |
| Customer/staff administration | No list/search/detail or administrator account-status management API found. Existing activation is strictly pending-invitation activation, not general reactivation. | Missing relative to broad approved Module 2 scope; exact API/status/role-change contracts require review |
| Role management | Role assignment occurs at invitation, but post-onboarding role changes are not implemented. Arbitrary role/permission editing and administrator creation are not implied by the invitation flow. | Contract/acceptance decision needed before new interfaces |
| Trusted origin | Retry requires BEDOS_APP_ORIGIN outside local lab. Deployed environment value has not been inspected; do not claim it is missing in production. | Unknown configuration evidence |
| Privilege/audit integrity | Broad unused audit_logs client grants, and actual rollback/concurrency/failure-path tests need review. | Metadata verified; exploit not claimed; targeted tests pending |
| Partial invite failure recovery | Accounts deliberately remain inactive if setup/approval/dispatch fails. Existing retry requires a trusted pending invitation, so not every partial setup has an exposed recovery route. | Verified control-flow limit; define safe recovery behavior without reassigning existing real accounts |

## Relevant files for first implementation step

Existing files to change, subject to scope approval:
- src/app/api/users/[id]/retry-invitation/route.ts and route.test.ts: choose trusted recovery landing compatible with actual provider flow and current allow-list; preserve cooldown/identity/audit ordering.
- src/components/auth/InvitationHandler.tsx and InvitationHandler.test.ts: extend existing authentication integration to explicitly handle trusted recovery fragments alongside invitations, establish/clean the session and land on password setup. This is existing Auth plumbing, not frontend feature development. Normal PKCE customer recovery remains unchanged.
- src/app/api/users/invite/route.ts and applicable invitation tests: strict UUID validation and safe provider errors, preserving account/role safeguards.
- New focused integration/regression tests and Module 2 documentation. Do not add new account-management endpoints or change database grants under this first step without reviewing their concrete contracts.

## Proposed implementation approach

1. Approve bounded step: correct existing staff retry recovery integration and validation/error gaps.
2. Add failing regressions, implement minimal changes, and run real local provider/RPC cases for invite/recovery, activation/revocation, cooldown, stale attempts, unauthorized roles and audit failure handling. Preserve existing working code and Module 1 flows.
3. Report exact files/test evidence and review production deployment separately; no hosted changes without explicit approval.
4. Within the same Module 2, propose administrator-only list/detail and account-status contracts with pagination and audit. Pending/revoked invitations must never be activated through a generic status endpoint; no self-escalation or silent administrator creation. Review whether post-onboarding ordinary staff role changes are required and define safeguards before implementation.
5. Finish end-to-end production administrator workflows through authorized sessions and synthetic staff accounts, then record module closure. Do not begin Module 3 until agreed Module 2 acceptance criteria are met.

## Initial acceptance checklist

- [x] Approved scope and existing files inventoried; source/production RPC parity inspected.
- [x] Existing mocked test baseline and initial local provider/RPC baseline passed.
- [ ] Agree exact customer/staff administration and role-change contracts.
- [ ] Correct confirmed-staff recovery integration without breaking Module 1 PKCE recovery.
- [ ] Complete malformed-input, safe-error, unauthorized/inactive role coverage.
- [ ] Verify invite/retry/activate/revoke transitions, duplicates, cooldown and concurrency.
- [ ] Verify audit atomicity, client write restrictions and partial-failure recovery behavior.
- [ ] Implement approved missing administration scope only after review.
- [ ] Relevant tests, TypeScript/build and production verification pass; no unresolved high-severity defects.
- [ ] Approved Git/release changes recorded, completion report and master register updated.

## Completion status and next module

Module 2 remains in progress; not complete. Next action is approval of the bounded existing-workflow correction scope above. Module 3 remains deferred. Module 1 stays closed; reuse its verified infrastructure.

## Approved existing-workflow fix update 30 October 2026

User instructed "fix them" after bounded scope was presented. Implemented the three existing workflow corrections locally: confirmed-staff retry -> trusted root/Auth bridge; explicit invite/recovery session adoption with credentials removed before PKCE client initialization; role UUID validation before privileged calls; safe invitation provider errors. Regression/fixture updates preserve original safeguards. Full suite 192 tests passed. Actual local Auth/RPC/SMTP extended integration passed 117 assertions, including races and synthetic audit failure rollback; independent cleanup verified zero synthetic users/triggers. No production code/configuration/data changes or new management APIs. See MODULE_2_WORKFLOW_FIX.md for exact scope, evidence and remaining release conditions.

Final patch verification: 192 application tests passed; 117 local Auth/RPC/SMTP assertions passed; production build/TypeScript and zero-warning focused lint passed. Final Auth bridge uses documented Next.js router.replace. No production changes or Git commit/push performed; release approval pending.

## Production workflow verification completed 30 October 2026

User-run production test completed at 01:59:28 UTC: all 17 workflow assertions passed and both logout requests returned HTTP 200. Administrator authentication, UUID rejection, trusted-origin preflight, invitation, blocked premature activation, confirmed recovery, retry cooldown, activation, duplicate rejection, staff login/role/permission denial, and separate pending-invitation revocation all passed. This supersedes the earlier administrator-login blocker and pending workflow status; it does not certify all Module 2 scope.

Independent production Auth/admin and PostgREST checks at 02:02:55 UTC verified exact fixture identities, roles, invitation state, accepted recovery attempt and administrator-attributed lifecycle audit actions. The activated test profile was changed from active to inactive after both fixture identities/states/audits passed guards; the revoked fixture was already inactive. Both profiles independently re-read as inactive. Auth identities, invitations and audit records retained. No real administrator modified. Direct fixture cleanup is not evidence of a general account-status management API. Backend successful logouts do not independently prove every provider refresh token is revoked; inactive profile/role restrictions continue to apply.

Published evidence: module-2-evidence/production-staff-workflow-summary.json contains counts, verified behaviors, cleanup status and limitations only. Detailed identity-bearing evidence and exact-fixture diagnostics are retained locally and excluded from Git.

Completion: bounded staff-workflow correction verified in production. Module 2 remains OPEN for missing administration API contracts/implementation, partial invitation setup recovery and audit-table least privilege review. Next module remains Module 2; Module 3 deferred.

Module 2 user-read step update: user approved administration contracts and local list/detail implementation. Local implementation and verification passed (222 application tests, 29 local rollback-only SQL assertions, build/TypeScript and focused lint); production release pending. See MODULE_2_USER_READS.md for exact files, evidence, limitations and acceptance checklist. The earlier audit gap table is historical: list/detail is now implemented locally, while status/role interfaces and other open work remain unimplemented.

List/detail release checkpoint: user approved production release, 932e3a5 deployed, additive migration applied once. Production SQL assertions and anonymous/customer denial checks passed; administrator-success route acceptance pending private user-run script. Detailed current evidence and next action: MODULE_2_USER_READS.md. Overall Module 2 stays open.
