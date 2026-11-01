# Module 2 audit privilege restriction

1 November 2026. Status: COMPLETE. Approved production migration applied once and verified through the authenticated SQL Editor. Module 2 closeout: MODULE_2_COMPLETION_REPORT.md.

## Module objective

Remove audit-table privileges that application roles do not need. Preserve service SELECT/INSERT and owner-managed guarded RPC audit writes. Do not modify audit rows, policies, schema, API contracts or module boundaries.

## Existing implementation and dependencies

The prior production review found audit_logs owned by postgres with RLS enabled and no policies, but all seven table privileges granted to anon, authenticated and service_role. Staff mutations write through SECURITY DEFINER functions. Service access reads audit evidence. Restricting table grants does not make records immutable to trusted database owners.

## Relevant files and implementation plan

- supabase/migrations/20261101030000_restrict_audit_log_privileges.sql: revoke all table privileges from PUBLIC/anon/authenticated; revoke UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from service_role. Grant nothing new.
- scripts/sql/Test-Module2AuditPrivileges.sql and scripts/Test-Module2AuditPrivileges.mjs: guarded local rollback-only actual SQL tests, including destructive permission-denial probes restricted to the named local container.
- docs/module-2-evidence/audit-privileges-preflight.sql: production metadata-only role, grant, ownership and policy inspection.

## Code changes

No application code changes. Migration uses an explicit transaction. Existing audit rows and SECURITY DEFINER function bodies remain unchanged.

## Testing and verification

`node scripts/Test-Module2AuditPrivileges.mjs` passed: 35 effective-privilege and actual-role SQL assertions, followed by 60 existing staff setup/resume SQL regressions under the reduced grants, including audit failures and atomic rollback. Service inserted and read a real synthetic audit row inside the transaction. All grants, synthetic rows, triggers and temporary setup function changes were rolled back. Evidence: module-2-evidence/local-audit-privileges.json. JavaScript syntax and git diff whitespace checks passed. No production destructive probes were executed.

## Completion status

Local verification passed. No production migration has been applied for this step. Before release, inspect current effective/inherited grants and column privileges, confirm only this migration is pending, and obtain production release approval. Production verification must use privilege metadata and rollback-only synthetic authorized RPC/audit assertions, never TRUNCATE/UPDATE/DELETE probes against production audit records.

## Remaining risks or issues

Column-specific or inherited grants could retain access and must be reviewed before release. Trusted owner/service credentials still require operational protection. This change is least privilege, not external immutable archival.

## Next module

Finish this release and record the overall Module 2 acceptance status before starting Module 3.

Current production metadata preflight could not complete: CLI stalled at login-role initialization. No successful fresh production metadata result is claimed. The migration also checks effective table and column privileges and rolls back on any unexpected inherited access. No audit privilege production migration was applied.

## Production release completed

User approved release. Production preflight confirmed current migration history and broad effective grants with no explicit column ACLs. Migration 20261101030000 and its history entry committed atomically through SQL Editor, bypassing only the stalled CLI connection initialization. No credential extraction was performed. Production 60 rollback-only staff RPC assertions and service audit insert/read passed. Final verification: zero table/column privilege mismatches, one migration row, zero synthetic users/triggers/service audit rows; owner postgres, RLS true, no policies. Final application suite: 313 tests/37 files passed. Earlier pending notes above are historical. Evidence: production-audit-privileges-preflight.json and production-audit-privileges-release.json.
