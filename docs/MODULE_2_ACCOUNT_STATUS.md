# Module 2 account suspension and restoration

1 November 2026. Status: suspension/restoration step COMPLETE for agreed scope. Approved patch 736875a deployed; production SQL, anonymous and administrator/customer HTTP acceptance passed. Overall Module 2 remains open.

## Module objective

PATCH /api/users/[id]/status accepts {account_status, expected_account_status, reason} and returns {user_id, account_status}. Require users.manage; permit active -> suspended and suspended -> active only. Record an audit event atomically with the profile change. No role mutation or onboarding activation in this step.

## Existing implementation and dependencies

Reuses requirePermission, parseJson, ApiError/errorResponse and the existing Supabase admin client. The database independently checks active actor plus users.manage. Relevant shared dependencies are profiles/roles/role_permissions/permissions, Auth email confirmation, staff_invitations, audit_logs, the Module 1 active-account role helper and legacy profile-update restriction.

Fresh read-only production metadata verified 47 selected column definitions, and both Module 1 helper bodies/security settings match their approved migration source. The new status function is absent in production. No production account rows were read or changed for this step. Evidence: module-2-evidence/user-status-schema-preflight.json/.sql and user-status-preflight-summary.json.

## Relevant files

- src/app/api/users/[id]/status/route.ts: PATCH handler; users.manage authorization before validation; strict UUID/body/query validation; private/no-store success and error responses.
- src/features/users/user.types.ts: status request/result types.
- src/features/users/user.service.ts: strict body parsing, bounded trimmed reason, normalized UUID and bound RPC parameters. Maps invalid/forbidden/missing/conflict/database errors to 400/403/404/409/500 with safe public messages. Returns only the approved result fields.
- supabase/migrations/20261101000000_add_admin_account_status.sql: new service-only bedos_update_user_status function. Existing migrations untouched; no new table/column/dependency/grants to ordinary clients.
- src/app/api/users/user-status.routes.test.ts: 31 route/service regression tests.
- scripts/Test-Module2UserStatus.mjs and scripts/sql/Test-Module2UserStatus.sql: 45 rollback-only actual database assertions.
- scripts/Test-Module2UserStatusIntegration.mjs: real local Auth/RLS and concurrent-request integration, plus guarded cleanup/restoration.

## Implementation plan and code changes

The function takes actor, target, requested and expected statuses, and reason. It locks the active actor profile for share, rejects self/administrator targets, locks any invitation before locking the target profile, then checks the fresh target state. This follows existing invitation -> target lock order; administrator targets are rejected before an exclusive profile lock to avoid administrator-to-administrator lock cycles.

Inactive targets, no-op/stale requests, missing/mismatched staff proof and unsupported roles conflict. Pending or revoked invitations cannot bypass onboarding. Staff in each of the three ordinary roles require an activated invitation matching their profile role. Legacy staff without proof remain ineligible. Customers cannot have incompatible staff invitation proof, and restoration requires confirmed Auth email. Confirmed-email restoration does not use service credentials to confirm ownership on the user's behalf.

The function updates profile status/timestamp and inserts user_account_status_changed into existing audit_logs within one transaction. Metadata includes previous/new status, role/invitation reference and the trimmed reason; actor comes from the trusted server context. Failed audit insertion rolls back the status update. Existing invitation and Auth records are not modified. Reasons belong in audit history and must not contain passwords, tokens or other secrets; arbitrary secrets cannot reliably be identified from free text. Application logs never include the submitted reason or provider error message.

Actor/target/role protections and expected state are rechecked in SQL, not merely in the route. EXECUTE is denied to PUBLIC/anon/authenticated and granted only to service_role. SECURITY DEFINER uses an empty search_path and qualified objects. No automatic retry of mutations: stale/concurrent attempts return conflict and require a fresh state read.

## Testing and verification

- Full application suite: 253 tests across 33 files passed. Includes 31 new status route tests plus existing authentication, user-read and invitation lifecycle regressions.
- Actual local SQL: 45 assertions passed. Covers customer and all three staff roles, protected/missing/disabled actors and targets, lifecycle proof, invalid reason/status, stale/no-op attempts, exact audit contents, synthetic audit-failure rollback and direct forged-actor invocation denial.
- Same JWT subject/claims SQL assertions proved role-based RLS and legacy profile writes are denied during suspension and allowed again after restoration.
- Real local Auth/RLS/concurrency integration: 37 assertions passed, including setup/cleanup checks. Same real access token was retained; role/service access disappeared after suspension and returned after restoration. Provider getUser still recognized the session, demonstrating why application/profile checks are required. Competing requests from two administrators produced one successful transition, one conflict and one corresponding audit event.
- Production build including TypeScript passed. Focused ESLint passed with zero warnings. No new package dependency.
- Independent local cleanup confirmed zero test users in both dedicated domains, zero test services, zero synthetic audit triggers and zero installed status functions. Original helper definitions, owners and ACLs restored after integration.

The lab baseline predates the deployed Module 1 helpers. The first same-session assertion correctly failed against that stale helper; tests now temporarily load the already-deployed corrections. SQL tests load them inside the rollback-only transaction. Real Auth tests save original definitions/ACLs locally, temporarily install dependencies and restore them afterward. An initial harness restoration failure was corrected by adding statement terminators to captured pg_get_functiondef output; final integration and independent cleanup passed. These were local harness issues, not new production fixes.

Commands from project root:

```powershell
.\node_modules\.bin\vitest.cmd run
node scripts/Test-Module2UserStatus.mjs
node scripts/Test-Module2UserStatusIntegration.mjs
npm run build
.\node_modules\.bin\eslint.cmd src/features/users/user.types.ts src/features/users/user.service.ts 'src/app/api/users/[id]/status/route.ts' src/app/api/users/user-status.routes.test.ts --max-warnings 0
```

## Completion status

- [x] Approved local status scope implemented and relevant files/dependencies traced.
- [x] Route, real SQL, existing-session and competing-request tests passed.
- [x] Audit rollback and local cleanup/restoration independently verified.
- [x] Build/TypeScript and focused lint passed.
- [x] Separate approval for exact-file commit/push, new production migration and deployment.
- [x] Production administrator-success and ordinary/anonymous denial verification with dedicated fixtures and sanitized evidence.

Local and production acceptance of this status step are complete. The approved dry run contained only 20261101000000_add_admin_account_status.sql; applied once before application push. No Module 1 helper change was applied to production. Vercel reported successful deployment of 736875a. The private administrator/customer run below passed; historical instructions are retained for reproducibility.

## Production release verification

- All 45 actual SQL assertions passed in production inside a rollback-only synthetic-fixture transaction, including all three ordinary staff roles, audit failure rollback, same-claims restrictions and protected accounts. No lasting account or test-trigger changes.
- Independent metadata query verified committed function body parity, SECURITY DEFINER/empty search_path, restricted service-only EXECUTE, exactly one migration record, unchanged Module 1 helper bodies and zero fixture users/test services/audit triggers.
- Two anonymous PATCH requests (valid and malformed) returned 401 before input processing; both denied responses contained no-store (four recorded checks).
- Sanitized evidence: module-2-evidence/production-user-status-release.json and production-user-status-anonymous.json. Reproducible metadata check: verify-user-status-release.sql.
- Remaining HTTP test: scripts/Test-ProductionUserStatus.ps1 prompts for the existing administrator email/password privately. It uses service credentials from local configuration only for one disposable confirmed-customer fixture, audit verification and exact-identity cleanup. Actual status changes use the real administrator session through the deployed PATCH API, not service-role authorization bypass.
- The script verifies ordinary/anonymous denial, customer suspension/restoration, existing-session restrictions, profile-write denial, stale/invalid/missing-target handling, exact audit contents, normal logout and deletion of the disposable Auth account/profile. Audit history is retained. Explicit confirmation is fixture setup only, not public signup proof.
- The script records only named check results/statuses in production-user-status-admin.json. Exact fixture identifiers are retained in the Git-ignored private-user-status-fixture.json, with no passwords/keys. A previous unfinished fixture blocks a fresh run until controlled cleanup. If account creation times out, the planned identity is retained locally for review rather than assuming nothing was created.

Run from project root:

```powershell
powershell.exe -NoProfile -File .\scripts\Test-ProductionUserStatus.ps1
```

No email-link action is required. Share PASS/STOPPED lines and logout statuses only. If cleanup stops, do not rerun; use the exact local fixture record for controlled review. Never upload that private record.

## Remaining risks or issues

The local Auth integration exercises provider/RPC/RLS behavior; the completed private production script additionally verifies the deployed customer status-route workflow. Production staff status transitions are verified at the SQL layer, not through a separate staff HTTP script. Suspension blocks subsequent application permission checks and status-aware database policies; it does not invalidate every provider token, revoke ownership-only policies or cancel requests already in progress. Future permission/role-changing operations must preserve the documented lock order. Existing audit-table least-privilege review and partial invitation recovery remain Module 2 work.

## Next module

Status release/production checkpoint is satisfied. Next is ordinary staff role changes under the approved design and separately agreed implementation scope. Overall Module 2 remains open; Module 3 stays deferred.

## Fixture test-client correction, 1 November 2026

User-run administrator login/role verification passed, but the privileged fixture creation request returned 401. Read-only probes using the same local credential returned 404 for a deliberately absent identity from Node, 401 from the original PowerShell helper and 404 after assigning an explicit backend-only User-Agent. Supabase secret keys reject browser-like User-Agent headers; provider documentation: https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/getting-started/api-keys.mdx. This was a verification-client issue; no credential rotation, provider policy change or application permission change was needed.

The helper now identifies provider requests as BedosBackendVerification/1.0 and tests service authentication with an absent-user GET before fixture creation. The actual helper passed that read-only probe in Windows PowerShell 5. Exact planned fixture lookup independently returned zero users; no account cleanup was needed. Its Git-ignored manifest is marked absent_verified, allowing a safe rerun. That state is accepted alongside deleted; other incomplete states still block reruns. Evidence: production-status-fixture-auth-fix.json. Production administrator/customer status workflow remains pending; do not mark the status step complete until its real test passes.

## Final production acceptance, 1 November 2026

User-run completion at 02:10:12 UTC: 24 saved assertions passed (21 workflow/setup/audit assertions, two HTTP-200 logouts and exact-fixture cleanup). Administrator suspension/restoration, ordinary/anonymous denial, existing-session restrictions/restoration, protected profile writes, safe output, stale/invalid/missing-target errors and exact audit actor/state/reasons passed. This supersedes the earlier fixture-client failure and pending-workflow notes.

Independent production SQL verified zero Auth/profile rows for the exact private fixture identity, two retained status audit rows, one actor and both correct customer-role transitions/reasons. Detailed identity stays Git-ignored. Sanitized evidence: production-user-status-admin.json and production-user-status-completion.json. No production fixture or account change remains from this test; audit history retained. List/detail and suspension/restoration steps are complete. Overall Module 2 remains OPEN for staff role changes, partial invitation setup recovery and audit least-privilege review; Module 3 deferred.
