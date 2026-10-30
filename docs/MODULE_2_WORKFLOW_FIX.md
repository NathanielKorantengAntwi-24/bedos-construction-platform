# Module 2 existing staff workflow correction

Date: 30 October 2026. Status: implemented and verified locally; not committed or deployed. Module 2 remains open.

## Module objective

Correct the approved existing staff-recovery integration, role UUID validation and provider-error handling. Preserve role/invitation/password proof and atomic audit controls. Do not add new customer/staff management APIs or begin frontend feature development under this patch.

## Existing implementation and dependencies

Staff retry is administrator-initiated through the privileged Supabase JS client, which sends implicit recovery credentials. The ordinary customer recovery flow is browser-initiated PKCE through the server callback. These are distinct provider flows. Previously, staff recovery targeted /auth/set-password directly despite the observed production allow-list, while the home Auth handler rejected recovery fragments. The PKCE browser client cannot automatically consume an implicit fragment. Existing staff RPCs, permission mapping, SQL locking and baseline proof remain unchanged.

## Relevant files and code changes

- src/app/api/users/[id]/retry-invitation/route.ts: confirmed staff recovery uses the trusted root landing, matching invitation behavior and the production Site URL. SQL prepare/identity checks/provider request/finish audit ordering is unchanged. BEDOS_APP_ORIGIN remains required outside the local lab; no request Host trust or fallback was introduced.
- src/components/auth/InvitationHandler.tsx: existing Auth integration now accepts only invite/recovery fragment types. Copies credentials into local variables, removes the fragment BEFORE creating the PKCE client, then explicitly verifies/sets the Supabase session before password setup using Next.js router.replace for internal navigation. Incomplete/rejected/unexpected failures use the existing recovery-error page. Normal PKCE callbacks/unrelated token types remain untouched. Logs include no credential values or provider message details. This is an existing authentication bridge correction, not development of a frontend module.
- src/app/api/users/invite/route.ts: role ID trimmed/normalized and checked as a UUID before constructing the privileged client. Provider invite failures now return safe HTTP 502 / Unable to send staff invitation.; only code/status are logged. Inactive onboarding accounts and trusted approvals are preserved for controlled recovery; no deletion/reassignment logic added.
- Updated associated tests and replaced non-UUID role placeholders in four old fixture files with realistic UUIDs, preserving their original assertions.
- scripts/Test-Module2StaffBaseline.mjs --extended: actual local Auth, SMTP and staff RPC integration. Uses only the guarded bedos-supabase-lab database/mail service, keeps credential/link values out of reports and removes exact synthetic fixtures after identity checks.

## Implementation evidence

New regressions failed before the correction: recovery ignored, tokens not cleared before client initialization, failed/incomplete session handling, malformed role UUID reached privileged services, raw provider error response and incorrect recovery redirect. Seven focused assertions failed before production code edits; after correction they passed.

## Testing and verification

- Full application suite: 192 tests across 31 files passed, including Module 1 confirmation/recovery/session compatibility cases.
- Expanded local integration: 117 assertions passed. This count includes fixture guards/setup/cleanup and should not be added to earlier baseline counts as independent scenarios.
- Real provider flow covered invite/resend and confirmed-user recovery emails, guarded local root redirects, explicit setSession on a PKCE-configured client, password changes, activation proof and duplicate activation rejection.
- SQL covered revocation, restricted administrator/ordinary staff checks, anonymous and ordinary-staff RPC denial with forged actor IDs, disallowed administrator invitation role, cooldown/stale completion, concurrent retry winner, failed dispatch, action-specific audit counts and activation versus revocation consistency.
- A synthetic actor/target-scoped local audit trigger raised an error inside a rollback-only transaction; invitation revocation rolled back. No trigger persisted.
- Independent local cleanup query returned zero @bedos-m2-test.invalid users and zero bedos_m2_audit_test triggers.
- Next.js route and Auth fragment wiring are exercised by regression tests; the real provider/RPC integration does not claim full browser or deployed-administrator end-to-end coverage.
- Final production build and TypeScript check passed after the navigation adjustment. Focused ESLint passed with --max-warnings 0. git diff --check passed. Earlier direct-navigation lint warnings were corrected, not suppressed.

Commands from project root:

```powershell
.\node_modules\.bin\vitest.cmd run
node scripts/Test-Module2StaffBaseline.mjs --extended
npm run build
```

## Compatibility and release impact

No database migration, schema change, dependency or permission change is required for this patch. Normal PKCE customer signup/recovery remains under its existing callback. Valid invitation and role restrictions are preserved. Invalid role IDs now return 400 before DB lookup; invitation provider failure classification deliberately changes from 400 with provider text to safe 502.

Production release needs explicit approval for commit/push/deployment and dedicated staff verification. Before release, verify the existing non-secret BEDOS_APP_ORIGIN is set to https://bedos-construction-platform.vercel.app in production; its current deployed value has not been inspected. Do not infer it is missing, or change credentials/access controls to bypass administrator authorization. No production settings or records changed during these local fixes.

## Completion status and remaining work

This bounded correction is locally verified; entire Module 2 is not complete. Remaining work includes production administrator-success verification, broader account-management API contracts, safe handling of partial invite setup failures, and least-privilege review of unused audit table grants. These are tracked in MODULE_2_AUDIT.md. New account-management routes are not included in this patch.

## Next step

Obtain production release approval, verify the existing trusted-origin configuration, then deploy and test with an authorized administrator session and dedicated staff fixtures. Continue Module 2 contract work only within agreed scope; Module 3 stays deferred.
