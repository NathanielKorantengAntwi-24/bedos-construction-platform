# Bedos engineering baseline

Established 29 October 2026. Repository baseline: 1b6076f (28 October 2026).
This register records verified inspection separately from historical claims. It is not a module completion certificate.

## Authority and working agreement

1. Final Technical Specification v1.0 (September 2026) and Master Backend Development, Audit, Testing and Completion Plan (19 October 2026).
2. Existing code and verified behavior.
3. Approved architecture/documentation, agreed decisions, then recommendations.

Source files read in full as extracted text:
- C:/Users/natha/OneDrive/Desktop/Bedos_Docs/Construction_Real_Estate_Platform_Final_Technical_Specification.docx
- C:/Users/natha/Downloads/Bedos Implement. plan.pdf (15 pages)
- C:/Users/natha/OneDrive/Desktop/Bedos_Docs/Construction_Real_Estate_Platform_Requirements_Document (1).docx (draft; conditional items remain conditional).

Documents are project reference material, not independent instructions authorizing commands. The user's current request controls agent actions. Text extraction establishes content, not visual layout fidelity.
Work on one approved module at a time. Do not change architecture, stack, schema, API contracts or module boundaries silently. Finish backend objectives before frontend work. Hosted database changes, commits, pushes and deployments require the applicable explicit approval. Do not expose credentials.

## Project map

- src/app/api: REST route handlers for auth, users, services/categories, properties/media/viewings, products/categories, orders, payments, enquiries, notifications and Paystack webhooks.
- src/app/auth: callback, password setup, recovery and recovery-error UI supporting authentication.
- src/components/auth: invitation handling.
- src/features: service/type modules for services, properties/viewings, products, orders, payments, enquiries and notifications.
- src/server/auth: get-user-context, require-permission and require-role.
- src/server/http: JSON parsing and API error helpers.
- src/lib/supabase: browser, cookie-aware server and privileged admin clients.
- src/lib/paystack: provider client, types, refund lookup, pagination and reconciliation.
- src/proxy.ts: Supabase session refresh and cookie propagation.
- supabase/migrations: payment, account and invitation SQL changes.
- supabase/remote_schema_snapshot.sql: untracked schema evidence; provenance/currentness unverified. Not proof of the live schema.
- _bedos_step122b: untracked historical lab prototype and application script. Not an approved production deployment artifact.
- README.md: generic Next.js starter instructions; insufficient project documentation.

## Architecture and dependency map

Approved flow: public/staff interfaces -> Next.js backend -> Supabase Auth/PostgreSQL/Storage, Paystack and approved WhatsApp delivery. Vercel hosting and GitHub source control are specified, not verified deployed here.
Sensitive requests require authentication, active account, authorization, runtime validation, business rules, data/external operations and safe responses. RLS provides additional protection. Privileged clients bypass ordinary RLS and require explicit backend authorization.

Observed dependencies: Next.js 16.4.2, React/React DOM 19.2.8, TypeScript 5 range, Supabase SSR/JS, Tailwind 4 range, ESLint 9 range, Vitest 4.1.12 and Supabase CLI. package-lock.json exists. Declared ranges are not proof of exact installed versions.

Observed auth flow: server client -> auth.getUser -> profiles with roles -> active-account check -> role_permissions joined to permissions. Staff endpoints require users.manage before invoking privileged invitation RPCs.
Services flow: API route -> services.view/manage -> service/category service -> server client for reads or admin client for writes -> services/service_categories tables. These tables, roles, permissions and constraints must be verified in the target isolated database.
Orders depend on products/stock and notification creation. Payments depend on orders, privileged database functions, Paystack and reconciliation helpers. Enquiries and viewings call the central notification service. This is a preliminary map from imports and exported functions, not a completed audit of every function.

## Current stopping point and decisions

Git history records:
- 8bdbd41: payments/refunds/database security (19 October).
- bdf961b: account restrictions/profiles/recovery (20 October).
- a4ab133: proxy session tests (23 October).
- 1b6076f: Complete Module 2 staff invitations and RBAC security (28 October).

The plan's instruction to start Module 1 predates these commits. Resolve by recovering newer completion evidence, not restarting modules automatically. Commit subjects alone do not satisfy closure criteria. No standalone Module 1/2 closure reports were found in the repository file inventory.
The old lab README says retries are absent; current tracked retry route and SQL exist. Treat that README as historical, not current status.
Keep existing untracked backups, scripts and snapshots untouched. No application source, schema, API or dependency changes were made during baseline preparation.

## Master implementation checklist

Statuses below are evidence classifications, not newly granted completion:

| No. | Module | Baseline status |
| --- | --- | --- |
| 1 | Authentication and Account Management | Complete for agreed backend scope; verified 30 October 2026; see MODULE_1_COMPLETION_REPORT.md |
| 2 | Users, Staff and RBAC | In progress: current audit in MODULE_2_AUDIT.md; existing workflow tested, recovery/admin-management gaps identified |
| 3 | Services and Service Categories | CRUD inspected; audit findings below; proposed next implementation module |
| 4 | Properties Management | Files inventoried; detailed audit pending |
| 5 | Property Media | Files inventoried; security audit pending |
| 6 | Property Viewing Management | Files/imports inventoried; detailed audit pending |
| 7 | Construction Project Management | No dedicated source module found in inventory; database audit pending |
| 8 | Interior Design Management | No dedicated source module found in inventory; database audit pending |
| 9 | Products and Categories | Files/imports inventoried; detailed audit pending |
| 10 | Inventory Management | Shared order/payment SQL exists; audit pending |
| 11 | Cart, Orders and Fulfilment | Order files inventoried; complete workflow audit pending |
| 12 | Payments and Refunds | Test Mode verification reported in plan; current deployment/live readiness unverified |
| 13 | Enquiries and Lead Management | Files/imports inventoried; detailed audit pending |
| 14 | Quotations and Service Requests | Central enquiry support requires requirements mapping |
| 15 | Contact and Communication | Dedicated implementation not established |
| 16 | Blog and News | No dedicated source module found; database audit pending |
| 17 | Media and File Management | Property metadata support exists; upload/security audit pending |
| 18 | Notifications | Files/imports inventoried; delivery audit pending |
| 19 | WhatsApp Integration | No dedicated source module found; approval/configuration unverified |
| 20 | Business Settings | No dedicated source module found; database audit pending |
| 21 | Reporting and Analytics | No dedicated source module found; database audit pending |
| 22 | Audit Logging | SQL logging exists; coverage audit pending |
| 23 | Backend Security and Reliability | Cross-cutting audit pending |
| 24 | Final Backend Integration and Testing | Pending module verification |

## Module 3 proposed scope and acceptance criteria

Objective: verify and harden existing services/category CRUD, publication and availability without rebuilding it.
Relevant files: src/app/api/services/route.ts and [id]/route.ts; src/app/api/service-categories/route.ts and [id]/route.ts; src/features/services/*.ts; shared auth/HTTP utilities; relevant database tables, permissions and RLS.

Inspection findings:
- GET endpoints require services.view; no anonymous services endpoint was found. Public service presentation is required by the specification. Decide whether public reads should use separate backend queries/routes or published-only existing GET behavior before changing the API contract.
- JSON is cast to TypeScript input types without comprehensive runtime checks. Non-string name/slug/description can throw during trim; malformed JSON follows generic error handling. Validate these cases with regression tests before correction.
- featured/category_id and route IDs lack comprehensive runtime validation in inspected handlers.
- Several service errors expose database error.message through ApiError. Replace with safe messages while retaining internal diagnostic logging within approved scope.
- No service/category tests found in the source inventory.
- No explicit service mutation audit writes found in inspected services; database-trigger coverage remains unknown.

Proposed acceptance checklist:
- [ ] Recover Module 1/2 closure evidence and establish readiness to proceed.
- [ ] Agree public versus staff read contract while preserving draft/archive confidentiality.
- [ ] Verify tables, constraints, category relationship, permissions, RLS and audit triggers in an isolated environment.
- [ ] Test CRUD, publication states, duplicate conflicts, missing records and category deletion behavior.
- [ ] Reject malformed JSON, invalid field types/IDs/statuses and unauthorized/inactive callers safely.
- [ ] Verify approved writes are audited and errors do not expose infrastructure details.
- [ ] Add focused route/service regression tests and database tests where applicable.
- [ ] Pass relevant tests, TypeScript and build; record evidence and remaining risks.
- [ ] Review changes, obtain required Git/deployment approvals, record closure before Module 4.

Implementation approach after scope approval: establish failing regression cases, reuse shared JSON/error utilities, add focused validation, correct verified service defects, test isolated database policies and integrations, then update this register and create the module report. Schema/API changes require explicit review before implementation.

## Verification and limitations

Existing Vitest suite invoked on 29 October 2026 with .\node_modules\.bin\vitest.cmd run; final result recorded below when available. Tests use configured Node environment and src/**/*.test.ts include pattern. Passing mocks does not establish live Auth, RLS, SQL concurrency or provider delivery behavior.
No hosted database inspection, migration application, production payment, commit, push or deployment performed. Environment secrets were not read. No full architecture/code audit is claimed. TypeScript, build and deployment checks are not yet recorded for this baseline.

## Resume procedure

Read this register and MODULE_1_COMPLETION_REPORT.md, check Git changes/history, then reconcile Module 2 completion evidence before implementing its remaining scope. Module 1 is closed; Module 3 follows verified Module 2 closure. Keep one module active. Record each module's requirements, findings, changed files, actual test output, commit/deployment state and unresolved risks before advancing.

Verification result: Vitest exited 0; 31 test files passed, 170 tests passed. Reported duration 12.96 seconds. This verifies the existing automated suite only; no services/category test files were present.

## Module 1 and 2 verification update 29 October 2026

- TypeScript: node_modules/.bin/tsc.cmd --noEmit --incremental false exited 0.
- Production target: local Supabase URL matched the CLI linked project before any HTTPS request was sent.
- Production HTTPS metadata: HTTP 200. OpenAPI advertises profiles, roles, permissions, role_permissions and staff_invitations, plus all six expected staff invitation RPCs (activate, authorize, finish retry, prepare retry, password baseline and revoke). No business rows read and no RPC executed. This verifies metadata availability, not function correctness or grants.
- Production SQL migration-list attempt: failed with DbConnectError / connection timeout to the Supabase pooler. Applied migration versions and catalog security definitions remain unverified.
- Isolated lab exists at ../bedos-supabase-lab. Docker engine pipe was unavailable; no integration tests run. Lab migrations through staff invitation retry exist, but presence is not proof of application or successful tests.
- Local .env.local lacks BEDOS_APP_ORIGIN; the tracked retry route requires a trusted configured origin outside the lab. Production Vercel environment has not been inspected; do not conclude production is broken from this local fact.
- Prepared docs/VERIFY_MODULES_1_2_READ_ONLY.sql for production SQL Editor. It uses a read-only transaction, bounded statement timeout and catalog-only queries: migrations, RLS, policies, grants, function definitions/EXECUTE privileges, triggers, constraints and indexes. It does not select customer records or credentials. Review output before sharing because internal schema definitions are included.
- Prepared scripts/inspect-production-metadata.mjs, a guarded GET-only metadata check which keeps backend credentials in memory and does not print them. It sends no request unless .env.local matches the linked hosted project.

Next required evidence: execute the read-only SQL in the linked production project's SQL Editor and review all result sets; verify production Auth URL/email/recovery settings and trusted app origin. Recover prior isolated workflow evidence or run the isolated lab when Docker is available. Modules 1 and 2 remain recorded complete historically, with independent closure verification pending. No source logic, schema, production data, commits or deployments changed.

### Production anonymous checks

Ran scripts/check-production-anonymous-access.mjs against the linked hosted project on 29 October 2026. Evidence: docs/PRODUCTION_MODULES_1_2_ACCESS_CHECKS.json. Anonymous zero-row SELECT requests returned HTTP 401 for profiles, roles, permissions, role_permissions and staff_invitations. Public Auth settings returned HTTP 200: disable_signup=false, mailer_autoconfirm=true, external.email=true. Email/password signup is enabled and automatic email confirmation is advertised; confirm whether this matches the intended customer registration policy. This is a finding, not a silently approved configuration change.
User has requested production Module 1/2 tests. Controlled dedicated test records are the proposed scope; real customer/staff records remain untouched. Awaiting production backend URL and a user-controlled test inbox to exercise actual Next.js registration/login/recovery/invitation flows. No accounts created, emails sent or database writes performed so far. Do not substitute direct privileged Supabase operations for testing backend authorization.

## Production backend workflow results 29 October 2026

User supplied https://bedos-construction-platform.vercel.app/ and a controlled Gmail inbox. Dedicated customer created through the deployed signup API using a unique +bedos-test alias. Evidence: PRODUCTION_MODULE_1_CUSTOMER_WORKFLOW.json. All 13 customer workflow assertions passed: registration; login; active customer profile/session; own profile update; rejection of role/status changes via profile API; customer denial from invite/activate/revoke/retry; synthetic phone cleared; logout; session denied after logout. Generated password existed in process memory only and was not persisted. The dedicated test account remains in production; original inbox account and real staff/customer records were untouched. Test-account identity is in the evidence file for controlled cleanup/recovery.

Evidence PRODUCTION_MODULES_1_2_BACKEND_CHECKS.json: 11 of 12 anonymous/invalid-input backend checks passed. Six unauthenticated session/profile/staff access checks returned 401. Invalid field-type/empty-body checks returned 400. Signup malformed JSON returned 400. Login malformed JSON returned 500 (expected 400).

Confirmed Module 1 defect: src/app/api/auth/login/route.ts calls parseJson, which raises ApiError(400), but the route's generic catch converts it to HTTP 500. Proposed local correction: preserve shared ApiError response handling and add a malformed-JSON regression test. No application correction or deployment performed during this test scope.

Total current deployed-backend assertions: 24 passed, 1 failed across 25. These are bounded tests, not a full completion certificate. Remaining: recovery email/link/password round trip; suspended/inactive account behavior with dedicated fixtures; cross-customer RLS; staff invitation email, password-baseline requirement, administrator activation/revocation/retry, role matrix and audit integrity; SQL catalog verification. Privileged success tests require an authorized administrator session without sharing passwords in chat. Do not elevate test users using service-role credentials merely to bypass backend authorization.

## Module 1 login malformed JSON correction

29 October 2026. User approved fixing the confirmed production login error. Scope: login route error handling and regression tests only.

Changed src/app/api/auth/login/route.ts to delegate its outer catch to existing shared errorResponse. parseJson's ApiError(400) is now preserved; unexpected errors remain internally logged with a generic HTTP 500 response. No authentication rules, schema, dependencies or success response contracts changed.
Changed src/app/api/auth/login/route.test.ts: malformed JSON must return 400 with the shared safe message before creating a Supabase client; unexpected authentication initialization errors must remain private and logged.

Evidence: before the route correction, the new malformed JSON test failed with expected 400 / actual 500 (11 tests passed, 1 failed). After correction, the full Vitest suite passed: 31 files, 172 tests. Production build passed, including Next.js TypeScript checking. Focused ESLint exited 0. git diff --check exited 0. Standalone TypeScript/check command completed without diagnostic output.

Status: local defect correction verified; not committed, pushed or deployed. Existing production failure remains until deployment and production retest. This does not close all Module 1 criteria. Next step: obtain approval for commit/push/deployment, then rerun the invalid-input production checks; continue remaining Module 1 verification before staff Module 2 workflows.

### Login correction release

User approved commit/push/deployment. Commit baacbc5 pushed successfully to origin/master. Production retest at 17:05 UTC on 29 October: all 12 backend checks passed, including malformed login JSON now HTTP 400. Local evidence PRODUCTION_MODULES_1_2_BACKEND_CHECKS.json was refreshed; prior 11/12 result remains described above. GitHub deployment-status API timed out; direct production behavior confirms the correction is live, without independent Vercel dashboard confirmation. Updated local MODULE_1_LOGIN_ERROR_FIX.md with release evidence. No database changes. Module 1 still requires recovery/restriction/isolation verification; Module 2 still requires privileged workflow verification.

## Module 1 continued verification

All 36 assertions in the production isolation/restrictions run passed (including fixture/setup/restoration assertions). Cross-customer profile read/write denied; protected role/status writes denied; inactive and suspended sessions, logins and profile writes rejected; active restoration verified. Two completed test fixtures restored active and signed out. One earlier preflight fixture stopped before any status mutation due to email lowercasing; diagnosis confirmed identity and harness corrected. Separate evidence retained.

Current detailed report: docs/MODULE_1_VERIFICATION_STATUS.md. User-assisted recovery remains pending; user asked which email to enter and was given the original dedicated +bedos-test alias, not the existing administrator address. Production catalog/configuration, rate limiting and auth audit evidence remain unverified. Module 1 remains in progress.

29 October 2026 recovery update: user explicitly confirmed "Password set successfully" after opening the dedicated test-account recovery link. User-assisted recovery through password save passed; new-password login is still unverified. Password/link not shared. Module 1 is not yet marked complete; see MODULE_1_VERIFICATION_STATUS.md for remaining configuration/catalog evidence.

Module 1 password-to-login update: user reported both deployed backend and direct Supabase Auth login verified True for exact dedicated customer identity after fresh password save. Cleanup warning isolated to diagnostic; provider-local logout ran after backend global sign-out. Harness reordered for future diagnostics; status of prior cleanup not independently established. No production fix needed from this evidence. Remaining configuration/catalog/security acceptance review still pending.

Module 1 security closure blocker found: live get_user_role helper ignores account status, and supplied production policies grant staff/customer role-based access solely from its result. Proposed narrow helper correction is in docs/PROPOSED_ACTIVE_ACCOUNT_ROLE_HELPER.sql, not applied. See MODULE_1_VERIFICATION_STATUS.md for evidence, privilege caveats, regression plan and approval requirement. Do not start Module 2 implementation or claim Module 1 complete until resolved.

30 October 2026: approved local role-helper correction implemented and verified. Old inactive-admin defect reproduced; new helper passed 49 rollback-only lab database assertions; application suite 172/172 passed. No production modification, commit or push. See docs/MODULE_1_ACTIVE_ROLE_FIX.md and MODULE_1_VERIFICATION_STATUS.md. Module 1 remains open pending approved production migration/verification and Auth configuration review.

30 October 2026 role-helper production release: 851f81b pushed; approved migration applied once to verified linked production. Production 49 database assertions and 12 HTTP smoke checks passed; owner/OID/ACL preserved; synthetic fixtures rolled back and independently confirmed absent. Evidence in MODULE_1_ACTIVE_ROLE_FIX.md and docs/release-evidence. Module 1 remains open only as defined in its verification status; Auth configuration review still pending.

30 October 2026 Auth review: user requires email confirmation before first login. Production password minimum is six vs app eight. Local signup support plus minimal two-setting policy proposal prepared/tested (178 application tests, ten local Auth/email/PKCE checks). Also found legacy update_own_profile active-account bypass; local migration/test passes nine SQL assertions. No new production changes; release approval pending. Detailed current review: docs/MODULE_1_AUTH_POLICY_REVIEW.md. Module 1 remains active.

30 October 2026 latest release: 8aecb57 deployed successfully per Vercel status; legacy profile-RPC correction applied and nine production assertions passed. Production Auth now requires confirmation and eight-character passwords; exact two-setting diff verified. Negative Auth checks and 12 HTTP smoke checks passed. Final customer confirmation E2E awaits user-run scripts/Test-ConfirmedCustomerSignup.ps1; keep Module 1 open. Full details in MODULE_1_AUTH_POLICY_REVIEW.md.

## Current stopping point 30 October 2026

Module 1 COMPLETE for agreed backend scope. Final user-assisted production confirmation flow passed five checks and independently verified expected confirmed customer. Final disposable credential regression passed, including old-password rejection; fixture removed. Authoritative closure/limitations: MODULE_1_COMPLETION_REPORT.md. Next module: Module 2 Users, Staff and RBAC audit and completion-evidence reconciliation. Do not restart Module 1 or skip directly to Module 3 based on the old Module 2 commit subject. Backend-only development remains in effect.


30 October 2026 Module 2 started at user's instruction. Read-only production catalogue/RPC parity and permissions reviewed; 53 existing staff/RBAC tests passed. Actual local Auth/RPC baseline passed 31 assertions and cleaned synthetic fixtures. No application or production changes. Existing confirmed-staff recovery integration, validation/error handling and missing broader management contracts require work. See MODULE_2_AUDIT.md for bounded proposed first implementation step; Module 3 deferred.

30 October 2026 Module 2 approved first-step fixes implemented locally. Existing staff recovery integration, UUID validation and safe provider errors corrected; 192 application tests and 117 local Auth/RPC/SMTP assertions passed. Test fixtures removed. Current report: MODULE_2_WORKFLOW_FIX.md. Await build/release review and production approval. Entire Module 2 remains open; missing management API contracts are not silently implemented.

Module 2 first-step final verification: production build including TypeScript passed after navigation change; focused lint passed with zero warnings. Workflow patch remains local and uncommitted; production unchanged. Release approval is next; Module 2 stays open.

Module 2 approved release: 6fbb9b6 pushed and Vercel deployment succeeded. Twelve production anonymous/invalid HTTP checks passed. Administrator-origin preflight and dedicated staff recovery/activation/revocation workflow remain pending user-run scripts/Test-ProductionStaffRecovery.ps1. Script uses private passwords, records sanitized evidence and exact fixtures for independent audit/deactivation. Module 2 remains OPEN; Module 3 deferred. See MODULE_2_WORKFLOW_FIX.md for current release status.

Module 2 current status: production staff workflow passed 17 checks plus two HTTP-200 logouts. Independent exact-account/audit verification passed; both dedicated staff test profiles now inactive, audit history retained. See MODULE_2_WORKFLOW_FIX.md and module-2-evidence/production-staff-workflow-summary.json. Existing-workflow correction verified; overall Module 2 OPEN for administration contracts/implementation, partial-failure recovery and least-privilege review. Module 3 deferred.

Module 2 administration contracts approved. Local list/detail APIs implemented with users.view authorization, service-only DB recheck, strict filtering/pagination, fixed projections and no-store responses. Full suite 222 tests/32 files passed; 29 actual local SQL assertions passed with migration/fixtures rolled back and independent zero-fixture/function check; build/TypeScript and focused zero-warning lint passed. New migration 20261030010000_add_admin_user_reads.sql is LOCAL ONLY. No commit/push/deployment or production DB changes. See MODULE_2_USER_READS.md. Next: separately approved release and production verification of this step; no status/role implementation or Module 3 yet.

Module 2 list/detail release approved and deployed as 932e3a5. Dry run showed only approved 20261030010000 migration; applied once before app push. Production 29 rollback-only SQL assertions passed; independent source/ACL/search_path/migration/zero-fixture checks passed. Vercel deployment success and 13 anonymous/customer HTTP/setup/cleanup checks passed; disposable customer removed. Administrator-success verification awaits private scripts/Test-ProductionUserReads.ps1. See MODULE_2_USER_READS.md. No status/role implementation or Module 3 work; Module 2 remains OPEN.

1 November 2026: Module 2 list/detail step COMPLETE for agreed scope. Saved private administrator test verified: 16 passing workflow checks plus HTTP-200 logout (17 assertions); report contains check names/status only. Combined with prior deployed SQL/denial checks, production acceptance is satisfied for this step. See MODULE_2_USER_READS.md. Overall Module 2 remains OPEN: status transitions next, then ordinary staff role changes, partial invitation recovery and audit least-privilege review. Do not begin Module 3.

1 November 2026 status step: user authorized local suspension/restoration under approved contract. PATCH users/[id]/status and new migration 20261101000000 implemented locally only. Full suite 253 tests/33 files, 45 actual rollback-only SQL assertions and 37 real local Auth/RLS/concurrency assertions passed; build/TypeScript and focused lint passed. Independent cleanup zero users/services/triggers/status functions; original lab helpers restored. Read-only production metadata confirms current Module 1 dependencies and absence of new status function. See MODULE_2_ACCOUNT_STATUS.md. No commit/push/production migration or deployment; release approval next. Role changes and Module 3 not started.

1 November 2026 status release: user approved commit/push/migration/deployment. 736875a deployed successfully after applying only 20261101000000 once. Production 45 rollback-only SQL assertions passed; independent source/ACL/empty-path/one-migration/zero-fixture checks passed and existing Module 1 helpers unchanged. Four anonymous denial/cache checks passed. Private scripts/Test-ProductionUserStatus.ps1 is ready for administrator/customer HTTP acceptance using one disposable customer with guarded deletion and local-only identifiers. See MODULE_2_ACCOUNT_STATUS.md. Module 2 remains OPEN; no role changes or Module 3 work.

Status workflow test-client correction: administrator authentication passed; fixture setup 401 traced to PowerShell browser-like User-Agent with modern Supabase secret key. Provider requests now identify the actual backend test client; non-mutating credential preflight added. Exact planned fixture independently absent; local manifest marked absent_verified. Fixed helper verified under Windows PowerShell 5 with expected absent-user 404. No production account/policy/application changes. Rerun scripts/Test-ProductionUserStatus.ps1; status acceptance still pending. Sanitized evidence in production-status-fixture-auth-fix.json.

1 November 2026 status-step closure: private production test passed all 24 saved assertions including both HTTP-200 logouts and exact-fixture deletion. Independent SQL verified zero Auth/profile fixture rows and two retained, correct audit transitions by one actor. Suspension/restoration COMPLETE for agreed scope; sanitized evidence production-user-status-admin.json and production-user-status-completion.json. Detailed fixture identity remains Git-ignored. Next is ordinary staff role changes; partial invitation recovery and audit least-privilege review still open. Overall Module 2 remains OPEN; Module 3 deferred.

1 November 2026 requirements-source confirmation: user supplied Construction_Real_Estate_Platform_Requirements_Document (1).docx as part of project documents. Exact path was already listed above; current file re-read in full as extracted text (248 paragraphs; SHA-256 f85a7c6a83c579cb0bc522566431d593e11dd45e62b4f05e8f8e184197b976c7). Internal status is Requirements Specification - Draft for approval. It supplies business/functional/content requirements and explicitly conditional items. Final approved technical specification/implementation plan remain authoritative: final specification explicitly includes Content Manager, Sales/Customer Service, Finance and Paystack; the earlier draft lists extra roles/e-commerce/payments as optional or requiring confirmation. Do not downgrade approved scope or approve unresolved draft options merely by including this source. No new staff-role contract or stack change is required by the added document. Current ordinary-staff role implementation remains authorized and active; backend first, Module 2 only. Full extraction retained locally in ignored .next, not published.

1 November 2026 role-change step: user authorized implementation, and supplied requirements draft was re-read without altering final-plan authority. PATCH users/[id]/role implemented locally with atomic profile/invitation role update and audit; active ordinary staff only, protected/self/stale/no-op/incomplete onboarding rejected. Full suite 285 tests/35 files, 47 actual SQL assertions and 45 real local Auth/RLS/concurrency assertions passed; build/TypeScript and focused lint passed. Local fixtures/functions/triggers removed and helper snapshots restored. Production metadata only: dependencies match source, 58 permission assignments and role function absent. No commit/push/migration/deployment for this step. See MODULE_2_STAFF_ROLE_CHANGES.md. Release approval next; invitation failure recovery, audit review and Module 3 not started.

1 November 2026 role release: user approved exact commit/push/migration/deployment. f617814 deployed successfully after only 20261101010000 applied once. Production 47 rollback-only SQL assertions passed, with independent source/grant/dependency/one-migration/zero-fixture verification. Four anonymous denial/cache assertions passed. Private scripts/Test-ProductionUserRole.ps1 ready: one disposable staff fixture, actual admin API role changes, same-session permission loss/recovery, status compatibility, audit and exact cleanup. Shared verification transport authenticated read-only under Windows PowerShell 5. Detailed IDs Git-ignored; sanitized results only. HTTP administrator/staff acceptance remains pending. Module 2 OPEN; invitation failure recovery/audit review and Module 3 not started.
