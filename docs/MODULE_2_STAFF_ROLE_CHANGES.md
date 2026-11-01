# Module 2 ordinary staff role changes

1 November 2026. Status: implemented and verified locally under the approved administration contracts. No commit, push, production migration or deployment. Overall Module 2 remains open.

## Module objective

PATCH /api/users/[id]/role accepts {role_id, expected_role_id, reason} and returns {user_id, role: {id,name}}. An active caller with users.manage may change an active, fully onboarded ordinary staff account between content_manager, finance and sales_customer_service. Administrator/customer conversions, self-changes, stale/no-op edits and incomplete onboarding are rejected.

## Existing implementation and dependencies

Reuses requirePermission, parseJson, ApiError/errorResponse and the Supabase admin client. getUserContext reads profile/role per request; requirePermission reads that current role's permission mapping. No Auth metadata or token role is used as the application role source.

The final technical specification explicitly defines the three ordinary staff roles. The user-supplied Requirements Document (1).docx was re-read in full and registered with its hash in PROJECT_BASELINE.md. Its internal status is Draft for approval and its optional role/payment wording does not supersede the final approved scope or authorize new architecture changes.

Fresh read-only production metadata confirmed 38 relevant column definitions and 58 permission assignments. The deployed Module 1 helpers and status function match committed source/security settings. The new role function is absent in production. No production account rows were read or changed for this implementation. Evidence: user-role-schema-preflight.json/.sql and user-role-preflight-summary.json.

## Relevant files and code changes

- src/app/api/users/[id]/role/route.ts: new PATCH handler; users.manage before validation; UUID/body/query validation; private/no-store response handling.
- src/features/users/user.types.ts: ordinary staff role allow-list and explicit request/result types.
- src/features/users/user.service.ts: requested/expected UUID normalization, unknown-field rejection, bound RPC parameters, safe error classification and strict result projection. Existing status validation now shares the same unchanged audit-reason validator; full status regressions pass.
- supabase/migrations/20261101010000_add_admin_staff_role_changes.sql: new bedos_update_user_role function, SECURITY DEFINER with empty search_path. EXECUTE granted only to service_role, with actor status/permission independently checked in SQL. No existing migration changed and no new table/column/package/permission mapping.
- src/app/api/users/user-role.routes.test.ts: 31 new route/service assertions.
- src/server/auth/role-change-permissions.test.ts: exercises actual requirePermission/getUserContext with a stable authenticated user and changed DB-role fixtures, proving per-request permission refresh.
- scripts/Test-Module2UserRole.mjs and scripts/sql/Test-Module2UserRole.sql: 47 actual rollback-only SQL assertions.
- scripts/Test-Module2UserRoleIntegration.mjs: actual local Auth/RLS and role/status concurrency, with exact fixture cleanup and helper restoration.

## Implementation approach

Use the shared actor -> invitation -> target lock order. Reject administrator/customer targets before exclusive target locking, then recheck the locked profile and proof. Destination role must resolve to a permitted ordinary staff role; nonexistent role IDs are invalid requests. Require active target, matching expected role, a distinct destination and an activated invitation whose current approved_role_id matches the profile.

Atomically update profile.role_id/updated_at and invitation.approved_role_id, then insert staff_role_changed with actor, target, invitation, previous/new role IDs/names and trimmed reason. Other invitation fields, original approval audit events, confirmation and password state stay unchanged. Audit failure rolls back both updates. The current invitation proof represents the latest approved role; the immutable original authorization event and subsequent role-change events preserve its history.

Error classification: 400 invalid request/unknown requested role, 401 unauthenticated, 403 missing permission or protected role/self target, 404 absent target, 409 stale/no-op/ineligible lifecycle, 500 sanitized unexpected DB/audit failure. Reasons must be nonblank and at most 500 characters; they must not contain secrets. Application logs contain only error codes, not provider messages or audit reasons.

## Testing and verification

- Full application suite: 285 tests across 35 files passed. Includes all existing list/detail, status, authentication and invitation regressions, 31 new role-route tests and one permission-refresh regression.
- Actual local SQL: 47 assertions passed. Covers all destination roles, profile/invitation atomicity, preservation of other invitation fields and original approval audit, exact audit contents, permission/protected-target guards, suspended/inactive/pending/revoked/mismatched proof, stale/no-op/invalid input, forged actor denial, audit-trigger rollback of both records and status compatibility after role change.
- Same-claims SQL checks prove content draft access disappears after finance assignment and returns after content reassignment.
- Real local Auth/RLS/concurrency: 45 assertions passed, including setup and cleanup. Staff changed their own password after baseline and were activated through the existing RPC. The same real access token then resolved the changed DB role, lost/recovered draft access and supported suspension/restoration with the updated proof. Competing role requests had one winner/one conflict and no extra audit; concurrent role/status requests had a valid serial outcome and consistent profile/proof.
- Local Auth email confirmation is explicit fixture setup, not new invitation email-flow evidence. Existing production email onboarding acceptance remains recorded separately.
- Independent local cleanup: zero test users in both domains, zero temporary status/role functions, zero audit test triggers and zero integration draft fixtures. Original helper definitions, owners and ACLs restored.
- Production build/TypeScript and focused zero-warning ESLint passed. An initial generated-cache EPERM was resolved by preserving .next under ignored node_modules/.cache and building fresh; no source/evidence deletion.

Commands:

```powershell
.\node_modules\.bin\vitest.cmd run
node scripts/Test-Module2UserRole.mjs
node scripts/Test-Module2UserRoleIntegration.mjs
npm run build
.\node_modules\.bin\eslint.cmd src/features/users/user.types.ts src/features/users/user.service.ts 'src/app/api/users/[id]/role/route.ts' src/app/api/users/user-role.routes.test.ts src/server/auth/role-change-permissions.test.ts --max-warnings 0
```

## Completion status

- [x] Approved local role-change scope implemented and tested.
- [x] Audit atomicity, existing-session behavior and concurrency verified locally.
- [x] Compatibility suite, build, TypeScript and focused lint passed.
- [x] Fixture cleanup and unchanged lab dependencies independently verified.
- [ ] Separate approval for exact-file commit/push, additive production migration and deployment.
- [ ] Production SQL and dedicated administrator/staff HTTP verification, with private credentials and local-only account identifiers.

This is local acceptance only. Before a release, review pending migrations and apply only the approved role function, then deploy its caller. Temporary lab Module 1/status dependency setup is not an additional production migration. No existing live staff/customer role should be changed for verification; use dedicated fixtures and controlled cleanup. Publish only sanitized result counts/statuses.

## Remaining risks or issues

No deployed role-route end-to-end test is claimed. The permission-refresh unit case uses representative permission mappings; it is not proof of every business module's complete finance/sales/content authorization. Actual local RLS assertions cover the selected draft-service path. Existing policies and backend guards must continue to read current database role/status; changing a role does not cancel in-flight requests or promise provider-wide token revocation. No arbitrary role/permission catalogue editor is introduced.

## Next module

Complete this role step's release/production checkpoint before starting partial invitation setup recovery or audit least-privilege changes. Overall Module 2 remains open; Module 3 deferred.
