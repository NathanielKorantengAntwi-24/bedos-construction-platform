# Module 2 administration contract proposal

1 November 2026. Status: contracts approved; list/detail complete with production acceptance. Suspension/restoration complete with production SQL and administrator/customer HTTP acceptance. Role operations are not implemented. Backend only. This document recommends concrete interfaces for gaps recorded in MODULE_2_AUDIT.md; these interfaces are not claimed to be prescribed verbatim by the approved plan.

## Module objective

Allow authorized administrators to inspect customer/staff accounts, suspend or restore eligible accounts and change ordinary staff roles without bypassing invitation onboarding or escalating privileges. Existing invitation/recovery/activation/revocation interfaces remain unchanged.

## Existing implementation and dependencies

Verified source: users currently exposes invitation lifecycle routes only. requirePermission checks active caller and database role mappings; only administrator currently has users.view/users.manage. getUserContext reads profile and role on each request. profiles supports active, suspended and inactive states. Supabase Auth holds email; do not invent an email column on profiles. Existing staff transitions use service-only SECURITY DEFINER RPCs with empty search_path and recheck actor permissions inside SQL. Existing services separate route authorization from data operations.

## Proposed API contracts

| Interface | Permission | Request and response |
| --- | --- | --- |
| GET /api/users | users.view | page=1, limit=25 (maximum 100); optional role, account_status and q filters. Return {users, page, limit, total}. Stable created_at descending then id descending ordering. |
| GET /api/users/[id] | users.view | Return {user} or 404. UUID required. Same safe user fields plus a nullable invitation summary. |
| PATCH /api/users/[id]/status | users.manage | Body {account_status, expected_account_status, reason}. Return {user_id, account_status}. |
| PATCH /api/users/[id]/role | users.manage | Body {role_id, expected_role_id, reason}. Return {user_id, role}. |

User fields: id, email, full_name, phone, account_status, role {id,name}, created_at and updated_at. Invitation summary: status and created/activated/revoked timestamps only. Exclude Auth metadata, credentials, recovery links, password-baseline digests and provider session fields. No arbitrary columns or client-supplied sort expressions.

Validate page/limit as positive integers; role against built-in role names; account_status against the existing enum; q as a trimmed literal substring of full_name/email, maximum 100 characters. Empty q means no search. Bind query parameters and escape LIKE metacharacters rather than interpolating filter expressions. Unknown query/body keys return 400. No broad Auth user listing followed by in-memory pagination; perform bounded database queries with the same filters for results/count.

Errors: 400 malformed input, 401 missing authentication, 403 insufficient permission or protected target, 404 absent target, 409 stale expected state/role or ineligible lifecycle transition, 500 sanitized unexpected failure. Permission checks precede target lookup. Reasons must be nonblank, at most 500 characters, and must not contain secrets; stored in audit history, not application request logs.

## Status and role safeguards

- General status operations initially support active -> suspended and suspended -> active only. Do not expose inactive -> active: invitation activation remains the only supported onboarding activation flow. No-op and stale transitions return 409.
- Customer restoration requires confirmed Auth email. Staff suspension/restoration requires an activated trusted invitation matching the current approved role. Pending, revoked or missing onboarding proof returns 409. Legacy staff without proof require a separate reviewed recovery decision.
- Both mutation interfaces reject administrator targets and self-targets. This deliberately avoids administrator provisioning, self-lockout and last-administrator changes in this scope.
- Role changes apply only to active, fully onboarded ordinary staff with an activated matching invitation. Both source and destination must be content_manager, finance or sales_customer_service. Reject customers, administrator assignments and no-op changes.
- Role changes atomically update profile.role_id and the activated invitation approved_role_id so subsequent authorization/restoration is consistent. Record previous/new roles and reason in the audit event. Invitation was originally approved for an earlier role; audit history must retain that approval and role-change history. This cross-record behavior requires explicit approval before implementation.
- Lock actor, target and invitation records in a documented consistent order; recheck active actor and users.manage inside the transaction. Audit failure rolls back the mutation. Concurrent attempts use expected state/role and only one can succeed.
- Suspension and role changes must affect subsequent permission checks and status-aware database policies even for existing sessions. This does not promise immediate invalidation of already issued provider access tokens or cancellation of in-flight operations; verify all relevant enforcement paths before acceptance.

## Relevant files and implementation approach

Proposed new route files: src/app/api/users/route.ts, src/app/api/users/[id]/route.ts, src/app/api/users/[id]/status/route.ts and src/app/api/users/[id]/role/route.ts. Follow existing routes, requirePermission and errorResponse; read the installed Next route-handler guide before writing application code.

Proposed shared files: src/features/users/user.service.ts and user.types.ts for explicit output types, validation and database calls. Reuse existing server Auth/admin clients and shared HTTP utilities. No dependency additions.

Add a new migration, never rewrite applied migrations: service-only read/mutation RPCs with qualified objects, empty search_path, actor permission checks and minimal grants. Confirm live schema/indexes and policy/function dependencies before final SQL. Read SQL joins selected Auth email fields with profiles/roles and never returns full auth.users rows. Audit writes use existing audit_logs columns; no schema expansion is assumed.

Implementation order within Module 2: (1) list/detail and validation; (2) status transitions; (3) ordinary staff role changes. Verify and record each step before the next. Existing invitation partial-failure recovery and unused audit-table grants remain separate Module 2 work and must not be hidden by this proposal.

## Testing and acceptance criteria

- Route tests: authentication/permission denial, malformed inputs, bounded pagination, stable ordering, combined filters, literal search escaping, absent users and safe projections/errors.
- Actual local DB tests: exact filtered counts; ordinary callers denied direct RPC execution; forged/disabled actors denied; customer vs staff eligibility; self/administrator protections; stale conflicts; lock races; profile/invitation consistency; audit actor/before/after/reason; injected audit failure rollback.
- Regression: Module 1 authentication/profile isolation and existing staff invitation lifecycle still pass; typecheck/build and focused lint pass.
- Local tests must cover current sessions after suspension and role change. Production verification, if approved later, uses dedicated fixtures and private administrator authentication; detailed identities stay local, sanitized results alone go to Git.
- No step is complete without its agreed tests and documentation. No production migration, release or account changes are authorized by approving this design alone.

## Completion status and next module

List/detail complete; see MODULE_2_USER_READS.md. Status step complete; see MODULE_2_ACCOUNT_STATUS.md for changed files, production evidence and limitations. Module 2 remains open; Module 3 deferred. Do not begin role changes before the current status checkpoint is verified and its next implementation scope agreed.
