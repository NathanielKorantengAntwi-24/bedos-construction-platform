# Module 2 partial staff invitation recovery

1 November 2026. Status: recovery workflow acceptance passed. Patch ee5768f is deployed; production SQL and anonymous/compatibility checks passed. The final private administrator/email workflow report contains 31 passing checks and no failures, including staff login, both HTTP 200 logouts, and removal of both dedicated fixtures. Audit-grant changes are not included. Overall Module 2 remains open.

## Module objective

Recover NEW staff setup failures after Auth creation without converting unrelated accounts, discarding password-change proof or automatically activating staff. Add users.manage POST /api/users/[id]/resume-invitation with body {reason}; success is HTTP 202 using the existing retry response shape. Keep legacy trusted pending retry available.

## Existing implementation and dependencies

Initial invite previously configured a profile and then recorded approval in separate operations. Early failure left an inactive Auth identity with no trusted pending invitation, which retry could not repair. Auth user_metadata is editable and cannot prove an administrator intended a staff account.

New creation stores a versioned bedos_staff_invitation object in server-owned app_metadata atomically with the Auth identity: random request ID, requested role, original administrator, normalized email/name/phone. The route generates it explicitly rather than spreading caller metadata. SQL reads authoritative raw_app_meta_data, binds it to the exact current Auth email, and never uses a supplied marker or mutable pending flag as permission evidence. User metadata retains the existing pending state marker for legacy retry compatibility; changing that state closes resume rather than granting access.

The existing six invitation RPCs are unchanged. Fresh production metadata verified their bodies/grants/security settings match source and the four required Auth columns exist. The new setup RPC is absent in production. No production account rows were read or changed. Evidence: staff-resume-schema-preflight.json/.sql.

## Relevant files and code changes

- src/app/api/users/invite/route.ts: generate server-owned provenance; replace separate profile update/approval with bedos_setup_staff_invitation; require a valid setup result before email; preserve the existing 201 response, duplicate-account denial, provider identity check and post-send baseline. Retain failed Auth accounts for controlled recovery; do not automatically delete them.
- src/features/users/staff-invitation.service.ts: shared trusted-origin validation and existing prepare -> Auth identity check -> invite/recovery -> finish dispatch, with static/safe logs. Resume repairs/rechecks setup first, then binds retry to the returned invitation ID. Provider acceptance is not a delivery guarantee.
- src/app/api/users/[id]/retry-invitation/route.ts: thin wrapper around the shared service, preserving its public contract and legacy behavior.
- src/app/api/users/[id]/resume-invitation/route.ts: permission-first UUID/body/query validation, trimmed reason, origin check before mutation, canonical target ID and private/no-store responses. Caller cannot choose role/email/actor/status.
- supabase/migrations/20261101020000_add_trusted_staff_setup_resume.sql: additive service-only SECURITY DEFINER setup/resume RPC with empty search_path. No table/column/audit-grant change or new dependency.
- src/app/api/users/staff-resume.routes.test.ts and invite/route.provenance.test.ts: new route/failure/configuration/provenance tests. Seven existing invitation test files adapted from direct profile-write assertions to the new atomic RPC boundary, preserving duplicate, identity, failure, no-mail and no-deletion safeguards. Existing retry tests remain unchanged.
- scripts/Test-Module2StaffResume.mjs and scripts/sql/Test-Module2StaffResume.sql: rollback-only actual SQL regression.
- scripts/Test-Module2StaffResumeIntegration.mjs: transpiles the actual shared service using installed TypeScript and exercises it against guarded local Auth/SQL/Mailpit, including failure injection and races. It does not substitute a second orchestration implementation.

## Implementation approach

The database independently checks active actor/users.manage, reason and trusted marker structure/version, original ordinary role, exact email and bound original profile details. Only inactive default-customer or already-matching staff profiles qualify. Missing profiles require controlled review. Unknown/incompatible role, missing/forged provenance, self/admin targets and active/suspended accounts fail closed.

A per-target transaction advisory lock serializes missing-invitation setup before taking invitation/profile locks. This prevents two setup requests from both observing an absent invitation and then reversing the established actor -> invitation -> profile ordering. Other lifecycle RPCs need no changes. Hash collisions can only serialize unrelated setup requests, not change eligibility.

Profile repair and initial authorization/audit share one transaction. Existing matching pending invitations reuse their identity and baseline; revoked/activated or mismatched approval cannot be reopened. Bound original name/phone are used only when configuring/repairing the profile, not to overwrite an already-consistent pending profile. Every explicit resume records the current actor, original creator/request, reason and whether repair/new approval occurred. Repeated requests may record repeated resume checks, but never duplicate the initial approval; actual dispatch still uses existing cooldown/attempt controls.

Expected errors: 400 invalid request, 401 unauthenticated, 403 missing permission/provenance, 404 missing Auth user, 409 incompatible setup/lifecycle, 429 retry cooldown, 502 provider rejection, 503 invalid/missing trusted origin and 500 unexpected/audit failure. A setup audit is not a claim that email was accepted. A provider acceptance followed by outcome-audit failure returns 500, preserves preparation proof and does not claim success.

## Testing and verification

- Full application suite: 313 tests across 37 files passed, including all existing authentication, staff lifecycle, user-read/status/role and legacy retry regressions. No old test cases removed.
- Actual SQL: 60 assertions passed with function, fixtures and profile/audit failure triggers rolled back. Covers all ordinary bound roles, corrupted/forged metadata, unrelated customer/admin targets, missing profiles, changed role/status/pending flags, actor restrictions, idempotent approval, original creator retention, profile/audit rollback, proof preservation and legacy retry compatibility.
- Actual shared-service/Auth/mail integration: 73 assertions passed, including setup and cleanup. Profile and approval audit failures prevented dispatch and left recoverable state. Concurrent resumes produced one accepted dispatch and one cooldown rejection, with one initial approval. Races against existing retry, revocation and eligible activation had valid serial outcomes; no revoked/activated invitation was reopened.
- Real invite/recovery links established the exact fixture session through the existing implicit-root/PKCE-client bridge. An invitation link or re-send alone could not activate staff; a genuine owner password change was required. Missing post-send baseline recovered safely. Provider-accepted email plus failed outcome audit remained recoverable, including when the owner had already set a password; existing baseline was preserved.
- Public Auth could not write server-owned app metadata, and a customer's forged editable metadata did not authorize conversion. Synthetic failures/fixtures stayed inside the local lab; no real inbox was used.
- Production build/TypeScript and focused zero-warning ESLint passed. Independent local checks returned zero users in both test domains, zero setup/injection functions and zero failure triggers. Existing lifecycle functions and grants were untouched.

Commands from project root:

```powershell
.\node_modules\.bin\vitest.cmd run
node scripts/Test-Module2StaffResume.mjs
node scripts/Test-Module2StaffResumeIntegration.mjs
npm run build
.\node_modules\.bin\eslint.cmd src/features/users/staff-invitation.service.ts 'src/app/api/users/[id]/resume-invitation/route.ts' 'src/app/api/users/[id]/retry-invitation/route.ts' src/app/api/users/staff-resume.routes.test.ts src/app/api/users/invite --max-warnings 0
```

## Completion status

- [x] Approved local contract implemented with protected provenance and atomic setup.
- [x] Unit, actual SQL, provider/mail/failure/race and compatibility checks passed.
- [x] Build/TypeScript, focused lint and independent local cleanup passed.
- [x] Separate approval for exact-file commit/push, additive production migration and deployment.
- [ ] Production SQL and dedicated administrator HTTP/email verification with private credentials and local-only account identifiers.

Local acceptance and partial production verification are complete. User approved release; the dry run contained only 20261101020000_add_trusted_staff_setup_resume.sql. Applied once before application push; Vercel reported successful deployment of ee5768f. Existing invitation functions and audit grants were independently verified unchanged. Administrator/email acceptance remains pending, and old in-flight/legacy setup failures remain subject to the runbook below rather than receiving invented provenance.

## Production release verification

- All 60 actual SQL assertions passed inside a rollback-only production transaction with synthetic fixtures and profile/audit failure triggers. Independent source, SECURITY DEFINER/empty-path, service-only EXECUTE, one-migration and zero-fixture/trigger checks passed. Six legacy invitation function bodies and audit-table grants matched their pre-release snapshot.
- Five anonymous/compatibility assertions passed: valid and malformed resume requests returned 401 before validation and no-store responses; existing retry still returned 401 for an anonymous caller. No account or mail change from those HTTP probes.
- Sanitized evidence: production-staff-resume-release.json and production-staff-resume-anonymous.json. Metadata reproduction: verify-staff-resume-release.sql.
- Remaining private workflow: scripts/Test-ProductionStaffResume.ps1 prompts for the existing registered administrator Gmail/password privately. Its shared transport and script syntax were verified in Windows PowerShell using only a read-only nonexistent-user probe. Exact fixture details are recorded solely in Git-ignored private-staff-resume-fixtures.json; an unfinished journal blocks a fresh run.
- Two fixtures: the actual initial invitation API verifies production creation of server-owned proof, then that invitation is revoked. Ignore its email. A second service-created fixture models a NEW backend-proven Auth account whose profile/approval stage did not finish. This fixture setup is not a claim of persistent production failure injection. The deployed resume API must repair its inactive default profile/approval and send the controlled-inbox invitation. Real SQL failure injection was tested only inside rollback transactions.
- The user opens ONLY the printed recovery alias email in Chrome, reaches password setup WITHOUT setting it, and returns to the script. The script verifies exact email confirmation and activation denial before password change. The user then sets a new staff test password privately and follows the activation/login prompt. It verifies caller-selected role denial, cooldown, bound inactive role, normal staff denial, post-activation resume rejection and audit creator/request/proof/reason consistency.
- Both fixture Auth identities, profiles and invitation rows are deleted only after exact identity guards; audit history retained. All published results contain check names/statuses only. Unknown creation/deletion outcomes retain the private journal for controlled review. Never delete/reassign an unrelated user or stamp an existing ambiguous account to make the test pass.

Run from the project folder:

```powershell
powershell.exe -NoProfile -File .\scripts\Test-ProductionStaffResume.ps1
```

Keep PowerShell open and follow its Chrome email/password prompts. Do not set the staff password until asked. Share PASS/STOPPED lines and logout statuses only. If cleanup stops, do not rerun or publish the private journal; retain it for exact-identity review.

## Remaining risks or issues and operator runbook

After a failed new invitation/uncertain create response, an authorized administrator can search GET /api/users?q=<email> without a staff-role filter, inspect the exact result and use its UUID for resume with a non-secret reason. A failed new setup may still have the default inactive customer profile. The backend-owned marker, not that apparent role or administrator assertion, determines whether repair is allowed. Repeated initial invite to an existing email still returns 409; it never reassigns the existing account.

Use existing retry for a legacy trusted pending invitation. For legacy Auth accounts without server provenance, missing profiles, changed recipient/role or ambiguous ownership, stop and retain the inactive account for controlled review. Do not stamp metadata, change roles, delete accounts or create substitute profiles to force recovery. Verify provenance through backend evidence and agree any exact remediation separately. This release does not claim every historical orphan was inventoried or automatically repaired.

An accepted email may already arrive when later audit/baseline work fails. Do not treat that as completed onboarding or bypass activation proof. Origin/configuration failure causes no setup mutation. A resume that rechecks setup may still return cooldown or dispatch failure afterward; existing approval/proof is retained and the response does not claim mail success. Existing-session/provider token behavior and email delivery limits remain as previously documented.

## Next module

Complete this recovery release/production checkpoint, then implement the separately reviewed audit least-privilege step. Overall Module 2 stays open; Module 3 deferred.

## Administrator workflow follow-up (1 November 2026)

Two user-run attempts remain incomplete: the first passed activation but staff password login returned 401; the second stopped at the combined provider identity/email-confirmation check despite a 200 lookup. Both runs reported exact fixture deletion and administrator logout. Neither establishes a callback defect or an incorrect password as the cause. The verification script now separately checks lookup success, exact fixture identity, and email confirmation, and labels staff password-login failures correctly. Acceptance remains pending; no application or schema change was made for this diagnostic update.

## Final administrator workflow result (1 November 2026)

The saved production-staff-resume-admin.json contains 31 passing checks and zero failures. Exact recovery identity and email confirmation, password completion, activation, fresh staff login, active finance role, authorization restrictions, duplicate approval prevention and resume audit binding all passed. Both logouts returned HTTP 200. The private Git-ignored journal records both fixtures deleted and state complete. These are script-verified results; this checkpoint does not claim a separate independent database reconciliation. The earlier failed attempts remain historical failures rather than being reclassified. Remaining Module 2 work is the separately reviewed audit-permission restriction.
