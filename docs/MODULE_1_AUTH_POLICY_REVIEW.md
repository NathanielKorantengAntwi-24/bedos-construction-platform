# Module 1 Auth configuration and confirmation review

Date: 30 October 2026. Status: approved release and user-assisted production email confirmation round trip passed. Module 1 closure recorded in MODULE_1_COMPLETION_REPORT.md.

## Objective and approved decision

User selected requiring email confirmation before first customer login. Align Supabase password minimum with the application's existing eight-character rule. Complete the remaining profile-account restriction review without starting another module.

## Verified production configuration

Read through Supabase CLI config pull into a gitignored review folder; original project config was not overwritten by that pull. Sanitized evidence is in release-evidence/auth-config-sanitized.json. Site URL is the approved production Vercel URL. The allow-list contains exact authentication callback and recovery callback URLs. JWT expiry is 3600 seconds; refresh-token rotation is enabled with a 10-second reuse interval. Anonymous sign-ins and manual identity linking are disabled.

Provider rate-limit configuration is present: email_sent 30, sms_sent 30, anonymous_users 30, token_refresh 150, sign_in_sign_ups 30 and web3 30. These are configuration values, not results of production load/rate-limit testing; provider endpoint units differ. Email send cooldown is 60 seconds, OTP length eight, OTP expiry 3600 seconds. External Auth logs were previously observed; database audit storage had zero rows.

At the start of this review, production had minimum_password_length=6 and email enable_confirmations=false. The approved release now requires eight characters and email confirmation. The application already enforces eight characters at registration/password setup. Secure-password-change reauthentication is disabled; enabling it would require a supported nonce flow and is not included in this release. CAPTCHA and paid leaked-password protection are not being certified from the fields obtained in this review. No rate-limit, SMTP, OTP, session, redirect or reauthentication setting was changed.

## Relevant files and code changes

- src/app/api/auth/signup/route.ts: explicit trusted confirmation callback URL, selected from existing BEDOS_APP_ORIGIN when configured. Defaults to the verified production URL in production and localhost outside production. Rejects insecure production or malformed origins; ignores untrusted request Host/forwarded headers. Existing HTTP 201/user fields remain; additive confirmation_required flag and pending-confirmation message reflect whether Auth returned a session. No session tokens returned in JSON.
- src/app/api/auth/signup/route.test.ts: trusted redirect, host-header independence, invalid origin rejection, production HTTPS enforcement, pending confirmation and existing session behavior.
- src/app/api/auth/login/route.test.ts: confirms unconfirmed-email provider rejection remains a safe HTTP 401 without profile access or provider details.
- supabase/config.toml: local desired defaults updated to password minimum eight and email confirmation enabled.
- docs/auth-policy-proposal/supabase/config.toml: minimal production proposal declaring only those two Auth settings. Never push the full local development config to production. Read-only diff confirms exactly two declared updates; undeclared remote settings remain unchanged. Sanitized diff is in release-evidence/auth-policy-proposed-diff.json.
- scripts/Test-AuthConfirmationPolicy.mjs: temporary local GoTrue service, same isolated lab database and local SMTP only. Keeps the existing lab Auth container configuration unchanged; guards DB/SMTP/network identity; creates only synthetic .invalid account; removes fixture/container and temporary environment file. Passwords, tokens and links are not printed or persisted by the runner. Local mail retains the test confirmation message for a deleted synthetic account.

## Real local confirmation integration evidence

All ten recorded checks passed, including readiness/cleanup: seven-character password rejected; signup creates an unconfirmed account without session; password login denied before confirmation; email delivered to local Mailpit; verification link redirects to trusted callback with code; PKCE exchange establishes correct confirmed session; subsequent password login succeeds; synthetic user deleted. Source output in release-evidence/auth-confirmation-local-tests.json. Early harness runs stopped on an outdated mailbox API adapter and standalone verification-link prefix; both were corrected and the full final run passed. Those early failures are not application failures.

This tests the real Auth/SMTP/PKCE protocol with the installed SDK. Next.js route/callback wiring is covered by the application tests, not an automated browser integration in this local run. Production new-signup confirmation and post-confirmation login still require verification after approved deployment and config application. PKCE confirmation must open in the same browser/profile that initiated signup.

## Additional verified profile RPC gap

Read-only production inspection found update_own_profile(text,text), a SECURITY DEFINER client-callable legacy RPC. It updates its caller's profile without account_status filtering, bypassing ordinary profile RLS. This is separate from the already-released get_user_role fix.

Local migration supabase/migrations/20261030000000_restrict_legacy_profile_update_to_active_accounts.sql preserves its name/parameters/return type/owner/ACL. It requires an active caller profile, uses qualified references and empty search_path, and denies inactive, suspended, missing-profile and anonymous calls with SQLSTATE 42501. Only existing full_name/phone/updated_at updates remain possible.

Regression supabase/tests/active_profile_update.sql uses the existing guarded rollback-only lab runner with -ProfileUpdate. Old RPC reproduced the defect: inactive account update succeeded. Corrected RPC passed nine assertions covering active update/protected fields, restricted denial/no mutation, anonymous/missing profile, unrelated-account integrity and function compatibility. The modified shared runner also passed all 49 role-helper assertions again. All SQL fixture/schema changes rolled back; no production migration applied.

## Verification status

Full application suite: 178 tests across 31 files passed. Focused lint passed (the chained command then started the build). Production build result will be recorded when it finishes. The approved application, profile-RPC and two-setting Auth changes have now been released; production evidence is recorded below. Existing live get_user_role correction remains applied and verified as previously reported.

## Proposed release sequence

1. Review and approve this exact signup/config/profile-RPC change set.
2. Commit/push signup support and deploy before enabling confirmations, so confirmation emails target the existing callback.
3. Capture existing profile RPC definition/ACL, dry-run migration history, apply only the reviewed pending RPC migration, then verify with rollback-only production fixtures.
4. Use the minimal partial config to change only password minimum 6 -> 8 and email confirmations false -> true. Review the live diff immediately before applying; keep all unrelated remote settings unchanged.
5. Re-read sanitized production settings; verify new unconfirmed signup cannot log in, confirm using the email in the initiating browser/session, then verify login and protected profile operations.
6. Record rollout and any remaining acceptance issues. Module 1 is not complete until production checks and closure review are recorded. Do not begin another module.

Final local verification: production build completed successfully, including TypeScript. Focused ESLint and git diff --check passed. The database test runner's PowerShell syntax passed. No temporary confirmation-test Auth containers remained.

## Approved production release on 30 October 2026

- User explicitly approved the complete release. Implementation commit 8aecb57 pushed to origin/master. GitHub Vercel status reported success, Deployment has completed, before Auth settings changed.
- Prior update_own_profile definition/OID/owner/ACL/return type and grants captured in release-evidence/profile-rpc-before.json. Dry run listed exactly migration 20261030000000. Applied only that migration; after-snapshot confirms unchanged identity/owner/ACL/return type/execution grants, empty search_path and migration recorded once.
- Production nine-assertion RPC regression passed using rollback-only synthetic Auth/profile fixtures. Independent query confirmed zero remaining synthetic profile-RPC users. No real customer or administrator records modified.
- Applied exactly two declared properties through the partial config: email.enable_confirmations=true and minimum_password_length=8. CLI reported 18 undeclared remote properties left unchanged. Post-release config diff had zero remaining declared differences. No secrets were sent by this configuration push.
- Public Auth settings independently reported mailer_autoconfirm=false. Direct Auth signup with a seven-character password returned HTTP 422 / weak_password without creating a user or sending email.
- All 12 backend negative/anonymous smoke checks passed after release.
- Current release evidence: profile-rpc-after.json, profile-rpc-production-tests.json, auth-policy-production-verification.json and auth-policy-production-negative-tests.json under release-evidence.
- Prepared scripts/Test-ConfirmedCustomerSignup.ps1 for user-assisted production E2E, syntax checked. It creates a dedicated Gmail-alias customer with an in-memory random password, checks login is denied before confirmation, prompts privately for the emailed link, follows it with the SAME originating HTTP cookie session, verifies the correct customer, and tests fresh password login afterward. It signs out and excludes credentials/links from recorded results. The user must COPY the new email link into the hidden local prompt rather than clicking it or sharing it in chat; the script holds the PKCE verifier. Old immediate-login signup scripts are no longer valid for new users under the confirmed-email policy.
- Awaiting the user-run confirmation E2E result. Do not mark Module 1 complete or start another module before this evidence and final closure review are recorded.


Final production confirmation: user-run E2E passed all five checks, saved result independently inspected and expected confirmed customer verified. Old-password rejection/new-password success independently tested on a disposable fixture and passed. See MODULE_1_COMPLETION_REPORT.md for current closure; preceding pending notes are historical.
