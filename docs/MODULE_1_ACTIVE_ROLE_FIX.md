# Module 1 active account role helper correction

Verified locally on 30 October 2026. Production unchanged. Module 1 remains open.

## Objective and acceptance criteria

The shared database role helper must return the assigned role only for active accounts, including when a previously issued session subject remains unchanged after deactivation or suspension. Preserve function signature, identity, owner, EXECUTE grants, SQL stability and SECURITY DEFINER behavior. Restrict name resolution to explicitly qualified relations.

## Existing implementation and dependencies

Production evidence shows get_user_role() returns the role by auth.uid() without checking account_status. Forty-seven supplied policies reference it, including role-based operations on properties/media, enquiries, viewings, products, services and payments. Effective access still depends on grants and other policies. Ownership/public policies that do not call the helper are outside this correction.

## Relevant files and implementation

- supabase/migrations/20261029000000_restrict_role_lookup_to_active_accounts.sql: CREATE OR REPLACE adds account_status = 'active', fully qualified names and empty search_path. No table, API, role assignment or dependency change.
- supabase/tests/active_account_role_helper.sql: real PostgreSQL regression using synthetic transactional fixtures and authenticated/anon database roles.
- scripts/Test-ActiveAccountRoleHelper.ps1: fixed local container target supabase_db_bedos-supabase-lab, verified lab config, migration applied inside a test transaction and always rolled back. Never connects to production.

## Testing and verification

1. Old helper reproduced the defect: inactive administrator returned administrator; test exited nonzero at that assertion. A prior test-authoring syntax error was corrected before this reproduction; it is not counted as evidence of the application defect. An interrupted tool run was not counted.
2. Corrected helper passed 49 database assertions: five roles times three statuses for role lookup, service RLS reads and service RLS updates (45); missing profile and anonymous caller (2); preserved identity/owner/ACL/type/security/stability (1); empty search_path (1).
3. Same simulated JWT subject retained through status changes. Active administrator/content manager retained read/update service access; active customer retained published-only service reads; inactive/suspended roles lost these role-based permissions. Finance/sales retained no service-management rights. These are real RLS tests using simulated claims, not full Auth HTTP integration tests of every affected module.
4. ROLLBACK confirmed. Independent lab query returned zero remaining synthetic test users and the original helper search_path=public. The correction was not persisted in the lab.
5. Full application regression: 31 files and 172 tests passed. The initial sandbox run could not import tests due to EPERM temp-file renames; rerun outside the sandbox passed. No source test failures remain.
6. Runner PowerShell syntax and git diff --check passed. No application code or build inputs changed, so no new production build was required for this SQL-only correction.

Commands from the project root:

```powershell
powershell.exe -NoProfile -File .\scripts\Test-ActiveAccountRoleHelper.ps1 -BeforeFix
# Expected failure demonstrating old helper returns a role for inactive account.
powershell.exe -NoProfile -File .\scripts\Test-ActiveAccountRoleHelper.ps1
# Expected PASS: 49 database assertions; ROLLBACK.
.\node_modules\.bin\vitest.cmd run
```

## Completion status and remaining issues

Local correction verified and ready for review. Not committed, pushed or applied to production. No real accounts or business data changed. Role-helper migration affects shared authorization; representative service policy behavior is tested, but not every one of the 47 dependent policies end to end. Remaining Module 1 Auth configuration/security acceptance work is recorded in MODULE_1_VERIFICATION_STATUS.md.

## Production release approach

After explicit production approval: capture current function definition/owner/ACL, verify target and migration history, apply the reviewed migration once, verify active and restricted dedicated fixtures plus function metadata and backend compatibility, and record the applied migration. A Vercel deployment alone does not apply this SQL. Do not use db push blindly or replay unrelated migrations. Preserve prior definition for recovery without silently reverting security behavior.

## Next task

Obtain approval for production release of this exact migration. Keep Module 1 active until production verification and remaining Auth settings review are recorded. Do not start another module implementation.
