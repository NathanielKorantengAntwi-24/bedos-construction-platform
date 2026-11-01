# Module 4 — property management

1 November 2026. COMPLETE for agreed backend scope. Production administrator acceptance and independent cleanup/audit reconciliation passed. Authoritative closure: MODULE_4_COMPLETION_REPORT.md. Earlier pending entries below preserve release history.

## 1. Module objective

Deliver approved property CRUD, property-record specifications, filtering, publishing, featured properties and lifecycle. The user approved the review proposal and then explicitly approved the narrowly scoped viewing/enquiry compatibility guard. Modules 5/6 and frontend remain deferred.

## 2. Existing implementation and dependencies

Source of truth: final technical specification and implementation plan. Conditional rental transactions, online property payments and a new/existing classification field have not been introduced.

Read-only production comparison confirmed the inspected local columns, constraints, policies, grants and related trigger fingerprints. Production's old status check includes rented and omits reserved/unavailable; no rented records were found. The migration refuses any unapproved legacy status discovered at execution time. It changes no existing status values.

Dependency map:

| Component | Responsibility and dependency |
| --- | --- |
| Property route handlers | JSON/query validation, verified user context and properties.manage gate, no-store HTTP responses |
| property.service.ts | Service-role transport to reviewed RPCs; only trusted server-derived actor IDs |
| bedos_read_properties | Public published-only projection; administrator/content-manager preview after database permission and active-profile recheck |
| bedos_mutate_property | Role/permission recheck, property locking, mutation plus audit in one transaction |
| Existing Module 3 helpers | Reused bedos_require_catalog_permission and bedos_catalog_audit; definitions unchanged |
| Profiles/RBAC | Active actor row locked while permission and fixed property-role boundary are checked |
| Images/floor plans | Existing child APIs unchanged; metadata blocks parent deletion so storage cleanup cannot be bypassed |
| Features/amenities | Existing child APIs unchanged; parent deletion audits metadata before preserving existing cascades |
| Viewing requests | Existing workflow unchanged; references block parent deletion; new property references must target a published property |
| Enquiries | Existing workflow unchanged; parent deletion atomically detaches/audits references; new property references require publication |

The new reference trigger locks its property FOR SHARE until commit, conflicting with lifecycle updates. Existing references remain usable after withdrawal; unrelated edits and SET NULL detachment are allowed. The custom P0409 provider error maps to a safe HTTP 409 in both creation services, including anonymous/customer enquiry branches. Public API projections exclude created_by; existing direct-table SELECT/RLS permissions have not been changed.

## 3. Relevant files

Changed application files:

- src/app/api/properties/route.ts; src/app/api/properties/[id]/route.ts.
- src/features/properties/property.service.ts and property.types.ts.
- src/features/properties/viewing-request.service.ts and src/features/enquiries/enquiry.service.ts: only publication-race error mapping.

Added application files:

- src/app/api/properties/manage/route.ts; src/app/api/properties/[id]/status/route.ts.
- src/features/properties/property.validation.ts and property.http.ts.
- src/features/properties/property.validation.test.ts, property-reference.test.ts; src/app/api/properties/property.routes.test.ts.

Database/release files:

- supabase/migrations/20261101060000_secure_property_management.sql.
- supabase/migrations/20261101070000_restrict_property_writes.sql.
- scripts/Test-Module4PropertySql.mjs; scripts/sql/Test-Module4Property.sql.
- scripts/Test-Module4PropertyIntegration.mjs; scripts/Prepare-Module4Release.mjs; scripts/Test-Module4ReleaseSql.mjs.
- scripts/Test-ProductionPropertyManagement.ps1; .gitignore excludes its private identity journal.

Project evidence: MODULE_4_CATALOG_PREFLIGHT.sql, MODULE_4_PRODUCTION_COMPARISON.sql, MODULE_4_LOCAL_CATALOG.json and module-4-evidence/*.json. Local catalog evidence is labelled local, not presented as production output. Sanitized production comparison records booleans, aggregates and role names only.

## 4. Implementation plan and API contracts

| Route | Contract |
| --- | --- |
| GET /api/properties | Anonymous published-only list; existing properties/pagination envelope, page=1 and limit=12 defaults; limit <=100 |
| GET /api/properties/manage | properties.manage plus database administrator/content-manager boundary; staff list including drafts; optional status filter |
| GET /api/properties/[id] | Published public detail; active authorized administrator/content manager may preview other states |
| POST /api/properties | Authorized draft creation; client cannot select status or created_by |
| PATCH /api/properties/[id] | Authorized partial record edits; status rejected |
| PATCH /api/properties/[id]/status | status, expected_status, reason; allowed transition and expected current state checked under lock |
| DELETE /api/properties/[id] | Administrator only; blocks viewing/image/floor-plan references; 404 for missing, 409 for in-use property |

List filters: search, property_type, listing_type, city, region, featured, page, limit, min_price/max_price, min_bedrooms/max_bedrooms, min_bathrooms/max_bathrooms. Status is staff-only. Unknown/repeated keys and invalid ranges are rejected. Search uses literal substring comparison rather than interpolating PostgREST grammar. Featured DESC, created_at DESC, id DESC gives deterministic ordering. Empty pages retain the exact filtered count.

New writes require title/slug/property_type/listing_type on create. Text is trimmed; title/slug/types/location/city/region <=200 characters, description <=10000, address <=1000; optional blank text becomes null. New slugs use lowercase alphanumeric hyphen-separated segments. Currency is three uppercase letters. Featured is boolean. Numeric fields are nullable/nonnegative and bounded to actual PostgreSQL column limits. Price and area writes allow at most two decimal places; bedrooms/bathrooms are integers. These are write validation rules, not a rewrite of legacy records.

Approved lifecycle:

| Current | Allowed next states |
| --- | --- |
| draft | published, archived |
| published | draft, reserved, sold, unavailable, archived |
| reserved | published, sold, unavailable, archived |
| unavailable | published, archived |
| sold | archived |
| archived | draft |

No-op/unsupported/stale transitions return 409. Reason is nonblank, <=1000 characters. Reservations and sold states are administrative content statuses, not transaction or payment workflows.

## 5. Code changes

Phase one installs five guarded/private functions, two reference triggers and the corrected six-state constraint while preserving original table grants. Shared Module 3 helper definitions remain unchanged. Phase two requires the new RPCs and enabled reference guards, revokes direct property mutation privileges, and aborts if inherited or column privileges still allow writes. SELECT/RLS and child-table privileges remain intact. Finance/customer roles receive no property-management rights.

Creation, updates, status changes, deletion and enquiry detachments record trusted actors and before/after images atomically. Failed audits roll back the mutation and dependency changes. No new dependencies or business columns were added.

## 6. Testing and verification

Verified results:

- Full application suite: **512 tests, 42 files passed**.
- Actual rollback-only database checks: **114 assertions passed**, including all 36 lifecycle pairs, permission/ACL checks, safe deletion and audit failure rollback.
- Real local Next/Auth/PostgREST integration: **57 checks passed**, including a concurrent lifecycle conflict and an insert waiting for an uncommitted withdrawal, then rejecting the withdrawn property.
- The actual production PowerShell workflow, redirected to guarded local destinations with disposable credentials, passed **35 checks** and removed its two property fixtures.
- Prepared release/history wrappers: **114 rollback assertions passed**; all five function bodies/owners/search paths/ACLs matched; original local state restored.
- Production build including TypeScript passed; focused lint passed; PowerShell syntax passed.

Reproduce from the repository:

```powershell
npx vitest run
node scripts/Test-Module4PropertySql.mjs
node scripts/Test-Module4PropertyIntegration.mjs
node scripts/Test-Module4ReleaseSql.mjs
npm run build
npx eslint src/features/properties src/app/api/properties src/features/enquiries/enquiry.service.ts
```

Run Docker integration and database scripts sequentially because they use the same isolated lab. Integration installs temporary functions, seeds exact fixtures and restores constraints, grants, helpers and permission mappings. Cleanup verified all four Auth fixtures and all property fixtures removed. A stale OneDrive-generated Next dev cache initially caused an EPERM error; after safely clearing only .next/dev, the rerun passed. Vitest initially hit a sandbox temporary-cache EPERM; its unsandboxed rerun passed.

## 7. Completion status

- [x] Approved scope and compatibility guard recorded.
- [x] Existing source/dependencies and read-only production baseline inspected.
- [x] Local implementation and relevant verification complete.
- [x] Sanitized evidence and release procedure prepared.
- [x] Separate approval for commit/push, production migrations/deployment and two disposable production properties.
- [x] Fresh production preflight and release metadata/rollback verification.
- [x] Private administrator production HTTP workflow.
- [x] Independent exact-fixture cleanup and retained-audit reconciliation.
- [x] Final completion recorded before starting Module 5.

## 8. Remaining risks or issues and release procedure

Release approved and executed: both migrations committed, compatible application deployed, direct writes restricted, production rollback assertions and independent metadata/dependency checks passed. Private administrator fixture acceptance and reconciliation remain pending. See module-4-evidence/production-property-release.json.

Prepare reviewable scripts with node scripts/Prepare-Module4Release.mjs; outputs are under ignored .next/module4-release. Before applying them, refresh catalog preflight and check for unexpected function-name collisions, policy/trigger/column grants and migration-history drift. Legacy rented records require a new explicit decision if any appear. The baseline expected previous migration is 20261101050000.

Release sequence (steps 1–3 verified; steps 4–5 remain):

1. Apply 01-secure_property_management.sql before deployment; verify function source/ACL/owner/path, corrected constraint and guard trigger bindings while original write grants still exist.
2. Commit/push only reviewed Module 4 paths and deploy. Verify public GET, staff route authorization and safe error behavior. If deployment fails, do not apply phase two.
3. Apply 02-restrict_property_writes.sql only after the compatible application is healthy. Verify metadata and run 03-rollback-verification.sql. That script uses synthetic SQL fixtures and a transaction-local audit-failure trigger, sends no email and rolls everything back; existing business rows are not modified.
4. Run the separately approved Test-ProductionPropertyManagement.ps1 privately. It briefly publishes two clearly labelled temporary properties, tests lifecycle/specification/public visibility, deletes its exact fixtures and retains audit history. No accounts, uploads, enquiries or viewing requests are created. Never commit docs/module-4-evidence/private-property-fixtures.json. Unknown creation/deletion outcomes block reruns for controlled review.
5. Independently reconcile deleted fixture identities and audit chains, then record completion. The prepared PowerShell test has passed locally, not in production.

After phase two, an old direct-writing application is incompatible. Prefer a compatible deployment or forward fix; do not silently restore broad grants. Trusted database owners can still administer data. New/existing classification, maps, storage management and media presentation remain separate approved work.

## 9. Next module

Finish Module 4 production acceptance and closure. Only then start Module 5 property media. Continue backend only.

Independent final local cleanup passed: zero Module 4 Auth/property fixtures, temporary functions and triggers; original property constraints restored; test port 55330 free. Evidence: module-4-evidence/local-property-cleanup.json.

## Production release — 1 November 2026

User authorized commit/push, staged migration/deployment and two temporary production properties. Fresh read-only preflight matched all reviewed dependencies; new function/trigger-name collisions and explicit column ACLs were zero. Phase one 20261101060000 committed and five function sources/owners/search paths/ACLs, corrected status constraint and both enabled guard bindings verified before deployment. Application commit 1c888f0 deployed successfully to Production. All 13 anonymous/public checks passed before phase two 20261101070000 committed. Production rollback-only verification passed all 114 assertions. Independent final metadata confirms zero direct table/column writes, five matching functions, both guards, RLS retained, two migration rows and zero synthetic Auth fixtures/failure triggers. Post-release columns, constraints, policies, original trigger fingerprints, intended SELECT grants, role mappings and legacy aggregates matched. All 13 public/anonymous checks passed again. Sanitized report: module-4-evidence/production-property-release.json.

The rollback test now scopes list counts to its unique fixture nonce so existing listings cannot affect assertions; the adjusted wrapper passed locally and in production. No application logic changed after the deployed commit. The final required step is private scripts/Test-ProductionPropertyManagement.ps1 execution with the existing administrator credentials, followed by independent exact-fixture deletion/audit reconciliation. Module 4 remains OPEN; Module 5/frontend deferred.

## Production acceptance and closure — 1 November 2026

Saved administrator workflow contains 35 passing checks, logout HTTP 200 and both exact temporary properties deleted. Independent read-only reconciliation passed all 53 checks: exact IDs and shared fixture nonce absent, all 14 expected audits retained with correct actor/results and continuous identity/specification/lifecycle chains, and original administrator active with administrator role. The private identity journal is complete and remains Git-ignored. No production writes occurred during reconciliation. See MODULE_4_COMPLETION_REPORT.md and module-4-evidence/production-property-completion.json. Module 4 COMPLETE; next is Module 5 analysis. Frontend remains deferred.
