# Module 1 authentication verification status

Current status: COMPLETE for the agreed Module 1 backend scope, verified 30 October 2026. See MODULE_1_COMPLETION_REPORT.md for the acceptance/evidence matrix and explicit limitations. The chronological notes below retain the original in-progress states; they are superseded where the completion report records resolution.

## Objective

Verify production registration, login/logout, sessions, profile creation and updates, recovery, account restrictions, validation, credential security and relevant database authorization. Scope is backend and existing authentication flow verification; no new frontend work.

## Existing implementation and dependencies

Next.js auth routes use Supabase Auth and server-side cookies. Profiles reference roles. Login checks account_status and signs out rejected sessions; profile update allows only full_name and phone. Database privileges restrict protected columns and RLS restricts profile ownership. Password recovery uses the existing Supabase browser client, auth callback and password setup route.

## Relevant files

- src/app/api/auth/{signup,login,logout,me}/route.ts
- src/app/auth/{forgot-password,set-password}/page.tsx
- src/app/auth/callback/route.ts
- src/server/auth and src/lib/supabase
- src/proxy.ts and applicable Supabase migrations
- docs/PRODUCTION_MODULE_1_CUSTOMER_WORKFLOW.json
- docs/PRODUCTION_MODULE_1_ISOLATION_RESTRICTIONS.json
- docs/PRODUCTION_MODULES_1_2_BACKEND_CHECKS.json
- docs/VERIFY_MODULES_1_2_READ_ONLY.sql

## Code changes

Login malformed JSON error correction committed and pushed as baacbc5. Details in MODULE_1_LOGIN_ERROR_FIX.md. No additional application changes in this verification pass.

## Testing and verification

- Full local suite: 172 tests in 31 files passed after the login correction. Build with TypeScript and focused lint passed.
- Production customer workflow: all 13 assertions passed for registration, customer role/active profile, login, session access, profile update, protected field rejection, staff-operation denial and logout.
- Production invalid-input/unauthenticated suite after deployment: all 12 assertions passed, including malformed login JSON -> 400.
- Production isolation/restrictions run: all 36 recorded assertions passed, including fixture guards, setup/restoration and substantive behavior checks. Two customers could read their own profiles but could not read/update each other's profiles. Direct protected role/status writes were rejected. For inactive and suspended test accounts: existing backend session denied, backend and database profile updates denied, login denied and rejected-login session cleared. Restoring active allowed backend login again. Fixture names/phones/statuses verified unchanged after denied operations. Sessions signed out.
- An earlier fixture preflight stopped because Supabase lowercases email addresses. A read-only diagnosis confirmed identity. Harness corrected to generate lowercase aliases. That stopped run is preserved separately and is not an application failure; no status mutation occurred in that run.

## Completion status

Verified behavior supports registration, ordinary login/logout, active-account session/profile behavior, targeted profile ownership RLS and inactive/suspended restrictions. These bounded checks do not establish all database policies or all authentication security controls.

## Remaining risks and evidence

- Password recovery email delivery, callback, new-password save and subsequent login: awaiting user-assisted verification using the original dedicated customer alias. No recovery token or password should be shared in chat.
- Catalog SQL (applied migrations, all relevant grants, trigger/function definitions and RLS policies): production SQL connection timed out; prepared read-only SQL remains available.
- Authentication rate limiting, abuse protection, production redirect allow-list, password policy and security-event audit coverage need verified configuration evidence. No explicit application rate limiter or auth audit writes were identified in the inspected auth paths; provider/hosting protections and Auth logs remain unverified. Do not treat absence in these paths as proof those external protections are absent.
- Dedicated test accounts remain for reproducibility/controlled cleanup. Three accounts were created during this pass (one preflight, two completed fixtures), in addition to the earlier customer workflow account. Their identifiers are recorded in local evidence. Only the two completed fixtures received temporary status changes, and both were restored active. No administrator or real customer records changed. Generated passwords and tokens were not persisted.

## Next task

Finish recovery verification and resolve configuration/catalog evidence before issuing a Module 1 completion report. Do not advance implementation to another module while Module 1 remains open.

## User-assisted recovery evidence

29 October 2026: user reports receiving/opening the recovery link for the dedicated +bedos-test customer account, setting a new password, and seeing the exact message "Password set successfully". Record this as user-reported recovery-link/password-save success, not an agent-observed browser test. Login with the new password and rejection of the previous password have not been independently verified. User kept the password and recovery link private. Module 1 remains open pending remaining configuration/catalog evidence and final acceptance review.

## Recovery retry issue

29 October 2026: after a subsequent reset attempt, user reported the Recovery link unavailable page. Earlier password-save success remains historical user evidence, but recovery-to-login end-to-end acceptance is unresolved (login attempt returned 401; user suspects forgotten password). Callback inspection confirms the same recovery error page handles both missing codes and exchangeCodeForSession errors. Thus its wording does not prove expiration. Installed Supabase SSR clients both use PKCE; browser/profile mismatch or missing verifier is a possibility, not a confirmed diagnosis. Next establish whether the link was from the latest request and opened in the initiating browser/profile. Do not request or log tokens, full recovery URLs, passwords or cookies. No recovery code change made.

## Recovery login diagnosis 29 October 2026

User reports HTTP 401 from PowerShell after retrying recovery in Chrome. Independent read-only lookup of the exact original fixture confirmed email identity, confirmed email, active customer profile, last_sign_in_at 17:59:07 UTC and updated_at 17:59:28 UTC. These timestamps show recent account activity, not proof of the entered password or of a successful password-authenticated login. Do not mark recovery-to-login complete.
Prepared scripts/Test-RecoveredCustomerLogin.ps1: fixed exact customer email, secure password prompt, explicit UTF-8 JSON bytes, no token/password output, verifies own customer identity on success, and signs out in finally. This removes editable credential-dialog username and request encoding ambiguity without changing application code or account credentials. Await user-run result.

Latest user-run secure fixed-email UTF-8 login diagnostic still returned HTTP 401. Recovery-to-login is unresolved; do not classify it as passed or assume forgotten password. Prepared and syntax-checked scripts/Compare-RecoveredCustomerLogin.ps1 to compare deployed backend password login with direct linked Supabase Auth using the same privately prompted credentials. It reads only public configuration, checks linked project, prints statuses/identity-match booleans, and signs out created sessions. User-run execution pending. Successful direct provider login with backend failure would justify investigation of deployed runtime configuration; failure of both does not alone identify the root cause.

User provided Chrome /api/auth/me output confirming original dedicated recovery fixture ID, matching email, active account and customer role. This establishes correct recovery-session identity; it does not establish successful password login. User comparison script reported backend 401 and direct Auth 400; exact provider error code was not captured. Updated comparison script to emit only a bounded machine-readable provider error code, not raw error payloads or credentials. No application or production configuration changes made.

## Recovery diagnostic next evidence

Provider comparison explicitly reported invalid_credentials. Chrome /api/auth/me confirmed the intended customer session; account identity mismatch is not supported by current evidence. Inspected current password form and installed Auth SDK: form awaits updateUser({password}); SDK issues authenticated PUT /user and returns provider errors. Existing form tests mock the provider and cannot establish password storage. No verified application root cause identified.
Supabase official Auth Audit Logs documentation identifies user_recovery_requested and user_updated_password events and notes database audit storage is optional. Prepared docs/CHECK_RECOVERY_AUTH_EVENTS.sql: read-only, dedicated-fixture-filtered event times/actions only. This can establish whether Auth recorded a password update without handling credentials. Direct production SQL connectivity previously timed out; user execution in SQL Editor needed. Empty database results may reflect disabled retention/storage and do not prove no update occurred. Do not repeat resets or alter production code until the evidence is reviewed.

User executed CHECK_RECOVERY_AUTH_EVENTS.sql successfully with no rows. This does not establish password-update failure. Next prepared CHECK_AUTH_AUDIT_AVAILABILITY.sql to confirm exact test-account existence and total audit storage, plus aggregate action counts/times without other user identities. Database audit storage may be disabled; event payload filtering may also differ. No root-cause conclusion or production changes made.

## Pasted production Auth log reviewed

User supplied raw log text for 29 October 2026 17:59:28 UTC. Verified nested event_message: method PUT, path /user, status 200, auth_event.action user_modified, actor_id b19b20a8-75a1-490b-bd5d-634b76158687 and matching dedicated customer alias. This rules out administrator-account identity for this update. Generic user_modified event does not independently identify which attributes were updated; no password/token content was requested or retained in this report. Source pasted log includes network metadata, which is not reproduced here.
Next controlled check: while Chrome remains authenticated as the verified customer, use the existing /auth/set-password page to set a fresh test password saved privately in a password manager, then use the identical stored value in the comparison script. No new recovery email is needed if that authenticated session is still valid. This tests update-to-password-login without a further email/PKCE exchange. Recovery-to-login remains unverified; no application change justified yet.

## Password update to login passed

29 October 2026: after setting a fresh password through the existing authenticated customer password page, user ran Compare-RecoveredCustomerLogin.ps1 and reported Backend login verified: True and Supabase Auth login verified: True. Both checks compare the returned identity to the original dedicated customer UUID. This establishes successful password update to fresh password-authenticated login, based on user-run diagnostic output. Earlier invalid_credentials failures remain historical; their exact cause was not independently established. Alias collision is not supported by evidence.

User output included Provider session cleanup not verified. Inspected diagnostic: it called backend logout first, whose Supabase signOut() defaults to global, then attempted local logout of a second direct Auth session. Global logout may invalidate that second session before cleanup. SDK itself tolerates expired/missing-session 401/403/404 on sign-out. No cleanup HTTP status was captured in the user run, so this is a plausible harness ordering issue, not a confirmed application logout defect. Changed diagnostic to close direct provider session first, then backend, and emit cleanup status on future errors. Syntax validation passed. No application/production change and no further user rerun required solely for this diagnostic edit.

Verified recovery evidence now includes email receipt, correct recovery-session identity, successful password save, and subsequent new-password login on both paths. Final Module 1 closure still requires review of remaining production configuration/catalog/security requirements and documented acceptance decisions. Do not claim complete merely from this workflow pass.

## Production index evidence received

User pasted final result set of prior multi-query catalog script. Observed profiles_pkey(id), role_permissions_pkey(role_id,permission_id), permission_id index, staff invitation primary key, unique user_id and status/created_at index. This verifies these index definitions only, not RLS/grants/triggers or applied migrations. Prepared VERIFY_MODULE_1_SECURITY_SUMMARY.sql to return remaining Module 1 catalog evidence as seven sections in ONE result table, avoiding loss of earlier SQL Editor result sets. Read-only; no auth.users records/passwords/tokens selected. Await evidence before closure.

## Production security summary reviewed

User supplied all seven result sections. Verified migration history includes all 18 local migration versions through 20261024180000. RLS enabled for profiles/roles/permissions/role_permissions (FORCE RLS false, not by itself a defect). Authenticated profile SELECT is own-row; UPDATE requires own active row with matching WITH CHECK. Only full_name and phone have authenticated UPDATE column grants; id/role_id/account_status have no such grant. No anonymous or PUBLIC table grants were shown in the requested roles. Roles/permissions/mappings are SELECT-only for authenticated clients. Service role retains privileged access as designed.

Exactly one non-internal auth.users trigger was returned: on_bedos_auth_user_created, enabled O, calling bedos_create_customer_profile. Its current function uses SECURITY DEFINER with empty search_path, assigns customer role from trusted roles table, and permits user metadata only to restrict initial status to inactive. Direct anon/authenticated execution denied. Legacy handle_new_user exists but is not attached to the returned auth.users trigger set. Trigger-function EXECUTE grants alone do not establish a directly callable privilege bypass.

Dependency finding: current get_user_role is SECURITY DEFINER, search_path public, and returns profile role by auth.uid without account_status filtering. This is not alone proof of an exploit. Production policies in other domains must be examined to determine whether suspended staff can retain direct database rights. Prepared CHECK_MODULE_1_ROLE_POLICY_DEPENDENCIES.sql to retrieve only referencing public policies and untrusted CREATE rights in the public schema. No schema/function/API change made; any correction must be reviewed before implementation.

Remaining configuration evidence: production email/password policy, URL/redirect allow-list and effective rate limits/abuse protection. Earlier public Auth settings report mailer_autoconfirm true; whether this matches approved registration policy remains a decision to confirm, not an automatically mandated change. Production Auth logs are available externally, while database audit table has zero rows. Recovery/new-password login passed user-assisted verification. Module 1 closure remains pending targeted role-policy/configuration review.

## Production role-policy finding and proposed correction

User supplied live policy definitions: 47 public policies reference get_user_role across properties and their metadata, enquiries/attachments, viewings, products/categories, services/categories and payments. Many staff read/write policies check only returned role; no active-account predicate appears in those expressions. Combined with the verified current helper (role by auth.uid without account_status), a suspended/inactive caller still satisfies those role predicates. Effective access also depends on table grants and other applicable database controls; no real staff record or business row was used to demonstrate exploitation. This is a confirmed active-account enforcement gap in the helper/policy combination and a Module 1 closure blocker.

User-supplied schema check shows anon/authenticated cannot CREATE in public. Thus the inspected search_path setting is not being reported as a confirmed untrusted schema-creation exploit.

Proposed correction: docs/PROPOSED_ACTIVE_ACCOUNT_ROLE_HELPER.sql (review-only; not in migrations and not executed). Preserve get_user_role() RETURNS text, SQL STABLE SECURITY DEFINER and existing ACLs; use fully qualified relations and empty search_path; add account_status='active'. Returns NULL when no active profile matches. This changes authorization behavior for inactive/suspended users across dependent policies as intended, so regression verification is required. No table/schema shape, API contract, role assignment or module boundary change proposed.

Acceptance/testing before production: active fixture retains expected role; inactive/suspended fixture returns NULL even with an existing valid Auth session; anonymous/missing-profile caller returns NULL; test role-protected access to synthetic fixtures is denied for restricted users and allowed for intended active roles; confirm function signature, search_path and ACLs; verify representative affected property/service/product/enquiry/viewing/payment policy behavior in isolated fixtures. Review other policies separately: this correction only addresses policies using the helper, not all possible ownership-based access. Production apply requires explicit user approval and a reviewed migration with saved prior function definition. Isolated lab database was unavailable earlier; must establish test execution before certifying the correction.

## Active role helper implementation verified 30 October 2026

Approved local correction implemented as supabase/migrations/20261029000000_restrict_role_lookup_to_active_accounts.sql with PostgreSQL regression and fixed-lab runner. Old helper failed for inactive administrator as expected; new helper passed 49 real database assertions across all five roles and three statuses, representative service RLS reads/updates, anonymous/missing profile and function metadata compatibility. All fixtures and migration rolled back. Independent query confirmed zero synthetic users and original helper restored. Full application suite: 172 tests across 31 files passed after sandbox temp-file permission failure was resolved by authorized escalation. Detailed report docs/MODULE_1_ACTIVE_ROLE_FIX.md.

Status: locally verified only; no commit/push/production application authorized or performed for this fix. Production approval is the next release gate. Remaining Auth configuration/security acceptance evidence still needed for Module 1 closure.

## Active-account role-helper production release verified 30 October 2026

User explicitly approved commit/push/production apply. Commit 851f81b pushed to origin/master. Production connectivity recovered; CLI Management API SQL queries are now available via supabase db query --linked. Captured prior function/owner/ACL; dry run showed only the approved migration; db push applied 20261029000000 once. Production rollback-only synthetic regression passed all 49 assertions. After-state verified unchanged function OID, owner, ACL, execution grants, STABLE and SECURITY DEFINER, with empty search_path and active predicate. Independent cleanup confirmed zero synthetic Auth/service fixtures. Production backend smoke 12/12 passed. See MODULE_1_ACTIVE_ROLE_FIX.md and release-evidence files. No real users or business records modified.

This resolves the previously recorded helper/policy active-account enforcement gap for policies that depend on get_user_role. Other ownership/public policies are not newly certified. Remaining Module 1 work is Auth URL/redirect/password/rate-limit/security configuration and final acceptance/documentation review. Do not mark all Module 1 complete or begin another module yet.

## Auth configuration and confirmation decision 30 October 2026

Read-only remote configuration review completed via CLI config pull into ignored review folder. Verified exact production callbacks, token rotation, disabled anonymous/manual linking and provider rate-limit values. Found provider password minimum six vs existing app eight. User selected requiring confirmation before first customer login. Local signup callback/response handling, tests, desired local config and minimal two-setting production proposal prepared. Ten local Auth/email/PKCE integration checks passed, and full application suite passed 178 tests. Production policy not changed; see MODULE_1_AUTH_POLICY_REVIEW.md for scope and release requirements.

Additional current production gap: client-callable SECURITY DEFINER update_own_profile RPC lacks active-account check. Reproduced in isolated lab. Local correction migration 20261030000000 preserves interface/ACL and denies restricted accounts; nine SQL assertions passed; reused role-helper runner passed 49 assertions. Production RPC remains unchanged pending explicit release approval. Module 1 still open.

## Auth/profile release applied 30 October 2026

User approved the complete release. 8aecb57 pushed; Vercel status success verified. Migration 20261030000000 applied alone after backup/dry run. Nine production rollback-only profile-RPC assertions passed; prior owner/OID/ACL/return type/grants preserved; no synthetic users remained. Exactly two Auth properties applied: password minimum eight and email confirmation required. Post-diff zero declared drift; public Auth confirms autoconfirm false; seven-character direct signup rejected 422 weak_password. Twelve backend smoke checks passed. Production E2E email confirmation still needs user inbox action, requested via scripts/Test-ConfirmedCustomerSignup.ps1 with private link prompt and same cookie session. No passwords or links should be sent in chat. Module 1 remains open for that final workflow/closure evidence; no other module started.

## Module 1 closure 30 October 2026

User-run production confirmation E2E recorded all five assertions true; expected test account independently confirmed in production. Final disposable customer password-change regression passed all 11 recorded assertions, including old-password rejection and new-password success through Auth and backend, then fixture removed. An initial BOM parsing failure in the local evidence reader stopped before any account creation and was corrected; not an application failure. Closure report written as MODULE_1_COMPLETION_REPORT.md. Module 1 complete for the agreed backend scope, with broader launch hardening/test-account cleanup explicitly documented. Next is Module 2 audit/evidence reconciliation; do not repeat Module 1 work.
