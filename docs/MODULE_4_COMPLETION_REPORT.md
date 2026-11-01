# Module 4 completion report

1 November 2026. **COMPLETE for the agreed backend scope.** This report supersedes earlier pending/open entries. Modules 1–3 remain closed. Module 5 has not started; frontend development remains deferred.

## 1. Module objective

Complete property CRUD, property-record specifications, filtering, publication, featured listings and the approved six-state lifecycle. Preserve role boundaries, related records, storage cleanup boundaries and the existing stack.

## 2. Existing implementation and dependencies

Property handlers now validate input and use service-only guarded database functions. Active actor permissions and administrator/content-manager roles are rechecked in the database. Public readers receive published properties with a fixed projection; authorized staff retain preview access. Administrator-only deletion blocks viewing/image/floor-plan references, preserves feature/amenity cascades and audits enquiry detachment.

The separately approved compatibility guard locks and rechecks publication for new viewing/enquiry property references. Existing records and workflows remain usable after withdrawal. Module 3 authorization/audit helpers, existing RLS and property role mappings were preserved.

## 3. Relevant files

The full file/dependency map and contracts are in MODULE_4_IMPLEMENTATION.md. Main changes include property routes/services/types, validation/HTTP helpers, staff-list and lifecycle routes, focused tests and two staged migrations. The only enquiry/viewing service edits map the publication-race error safely.

Release/verification tooling includes Test-Module4PropertySql.mjs, Test-Module4PropertyIntegration.mjs, Prepare-Module4Release.mjs, Test-Module4ReleaseSql.mjs, Test-ProductionPropertyAnonymous.mjs, Test-ProductionPropertyManagement.ps1 and Verify-ProductionPropertyFixtures.mjs.

## 4. Implementation plan and release

The user approved contracts, lifecycle rules, protected deletion and the publication guard, then authorized commit/push, staged production migrations/deployment and two temporary production properties. Fresh read-only production preflight confirmed compatibility and no rented records. Migration 20261101060000 installed the five functions, corrected constraint and two guards before application commit 1c888f0 deployed successfully. After 13 public checks passed, 20261101070000 restricted direct writes. Both migrations were recorded once. Commit 05cb5d3 records release evidence and passed Vercel deployment.

Independent production metadata verified function source/owner/search-path/ACL parity, both guard bindings, the corrected constraint, RLS retention, zero effective direct table/column write privileges and no synthetic rollback fixtures/failure triggers. Post-release columns, policies, original trigger fingerprints, role mappings and intended grants matched the reviewed baseline.

## 5. Code changes

- Strict body/query/UUID/numeric/text validation, partial edits, safe errors and no-store responses.
- Literal search, range filters, exact counts and deterministic pagination.
- Draft-only creation and explicit expected-status/reason lifecycle requests, with stale/no-op/unsupported transitions rejected.
- Atomic mutations and before/after audit, including protected deletion and reference detachment.
- Published-only public reads and database-checked staff preview/management boundaries.
- New-reference publication locks prevent withdrawal races without implementing viewing/enquiry workflows.

## 6. Testing and verification

| Evidence | Result |
| --- | --- |
| Application regressions | 512 tests in 42 files passed |
| Local SQL | 114 rollback assertions passed, including all 36 lifecycle pairs |
| Local HTTP/Auth/PostgREST/concurrency | 57 integration checks passed; production PowerShell helper passed 35 local checks |
| Build/type/lint | Production build, TypeScript and focused lint passed |
| Release wrappers | 114 assertions passed locally; exact original lab state restored |
| Production SQL | 114 assertions passed and rolled back |
| Production public/anonymous | All 13 checks passed before and after write restrictions |
| Production administrator workflow | All 35 saved checks passed, including logout HTTP 200 and both fixture deletions |
| Independent production reconciliation | All 53 checks passed: exact fixture absence, 14 retained audits, correct actor/state/specification chains and active administrator |

Sanitized evidence is in module-4-evidence/production-property-admin.json, production-property-release.json, production-property-anonymous.json and production-property-completion.json. The identity journal is complete, records both fixtures deleted and remains Git-ignored. Reconciliation used read-only requests; no production account, property or audit was modified during reconciliation.

## 7. Completion status

All agreed acceptance criteria are satisfied. Module 4 is COMPLETE. No temporary property fixtures remain and audit history was retained. No additional administrator test is required for this scope.

## 8. Remaining risks or issues

Property images/galleries, floor plans, feature/amenity management and storage lifecycle remain Module 5 work. Full viewing management remains Module 6 work. New/existing classification requires an approved representation; rental transactions, online property payments and new map fields were not introduced. Administrative reserved/sold statuses do not constitute a transaction system. Old direct-writing application versions are incompatible after phase two; use compatible releases or forward fixes. Trusted database owners can still administer data; audit is not external immutable archival.

## 9. Next module

Module 5 — property media, galleries, floor plans, features/amenities and upload/storage management. Inspect its approved requirements and existing implementation before proposing changes. Continue backend only.
