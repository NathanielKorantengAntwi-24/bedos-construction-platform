# Module 3 implementation and release review

1 November 2026. Status: **a41066c deployed; both production migrations, database assertions and anonymous checks passed; private administrator acceptance pending**. User approved MODULE_3_REVIEW_AND_PROPOSAL.md. User approved commit/push, staged production migration/deployment and the five-record disposable content test. Fresh production preflight and staged release passed. Module 4 remains deferred.

## 1. Module objective

Complete the existing backend Services and Service Categories module: CRUD, publication/availability, bounded retrieval, public published content, authorization, safe input/error handling and atomic audit. Preserve the approved stack and existing relationships. No frontend feature work.

## 2. Existing implementation and dependencies

The four existing route files retain their paths, success response fields/messages and services.view/services.manage checks. Requests now pass through feature-local runtime validation, the existing parseJson utility, shared safe responses and guarded database RPCs.

Dependency map: HTTP route → existing authentication/permission helper → catalog validation/service → Supabase service client → guarded catalog RPC → profiles/roles/permissions/role_permissions and services/service_categories/audit_logs. Category deletion also detaches linked services; service deletion detaches linked enquiries. Those existing ON DELETE SET NULL relationships are preserved and each detachment is audited in the same transaction.

Important verified compatibility detail: the saved production Module 2 catalogue grants customers services.view. Old cookie-client/RLS reads limited them to published services. The new privileged read RPC explicitly preserves that scope: administrator/content_manager may see all states; customer may see published services and its existing category scope; other roles receive no additional row visibility even if a view permission is later assigned. The current production catalogue still requires fresh verification before release. Local tests seed the missing mappings explicitly, including customer view access, and restore the original empty lab mappings afterward.

## 3. Relevant files

- Existing src/app/api/services and src/app/api/service-categories collection/detail handlers.
- Existing src/features/services service/category services and type definitions; input type fields remain compatible.
- New catalog.validation.ts, catalog.service.ts and catalog.http.ts under src/features/services; new validation and route regression tests.
- New src/app/api/public/services/route.ts, services/[slug]/route.ts and service-categories/route.ts.
- New migrations 20261101040000_secure_service_catalog.sql and 20261101050000_restrict_service_catalog_writes.sql.
- scripts/Test-Module3CatalogSql.mjs; scripts/sql/Test-Module3Catalog.sql; local-only Test-Module3CatalogDirectWriteDenials.sql; scripts/Test-Module3CatalogIntegration.mjs.
- scripts/Prepare-Module3Release.mjs, scripts/Test-Module3ReleaseSql.mjs and scripts/Test-ProductionServiceCatalog.ps1.
- MODULE_3_CATALOG_PREFLIGHT.sql, MODULE_3_LOCAL_CATALOG.json and module-3-evidence/*.json.

## 4. Implementation plan and final contracts

Public endpoints are read-only:

| Endpoint | Behavior |
| --- | --- |
| GET /api/public/services | Published services only; fields id/category_id/name/slug/description/featured |
| GET /api/public/services/[slug] | Exact existing slug; missing/draft/archived returns 404; same safe fields |
| GET /api/public/service-categories | id/name/slug/description; only categories referenced by published services |

Lists accept page (default 1), page_size (default 25, maximum 100), q (literal case-insensitive search, maximum 100 characters). Service lists also accept category_id and featured=true/false; protected service lists may filter status. Public callers cannot choose a publication status. Category lists accept only page/page_size/q. Unknown/repeated/invalid query keys are rejected. Responses retain services/categories arrays and add pagination {page,page_size,total}; empty pages retain exact filtered counts. Service ordering is created_at/id descending; categories name/id ascending. Responses and errors use no-store to make withdrawal/restriction changes effective on subsequent requests.

Write inputs accept only existing fields with exact JSON types. Names/slugs are trimmed nonblank strings, maximum 200 Unicode code points; descriptions are nullable/trimmed strings, maximum 10,000. UUIDs/statuses/booleans are checked; empty PATCH is rejected. Only supplied fields are validated/updated, preserving unrelated legacy fields that exceed new limits. Existing slug case and uniqueness semantics remain intact. Published means publicly available; no independent availability column/state was invented.

Six new functions form the internal database path: bedos_require_catalog_permission, bedos_validate_catalog_input, bedos_catalog_audit, bedos_mutate_service, bedos_mutate_service_category and bedos_read_service_catalog. Only the three read/mutation entry points are executable by service_role; anonymous/authenticated cannot execute them or private helpers. Mutations recheck and lock the active actor, validate inputs independently, lock category before service where applicable, merge partial edits into the current locked row, and write audits atomically. Unique/missing/invalid/authorization/unexpected errors map to safe 409/404/400/403/500 responses. Database/transport details are not returned to clients.

## 5. Code changes and rollout decision

Database work is deliberately split into two phases to avoid breaking the old deployed staff writers:

1. **20261101040000** installs the guarded functions and their function grants. It leaves all existing table grants unchanged, verified by a local before/after permission matrix. Both migrations notify PostgREST to reload its schema cache after commit.
2. Deploy/verify the new application against those functions.
3. **20261101050000** then revokes INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on services/service_categories from PUBLIC, anon, authenticated and service_role. SELECT grants and RLS policies remain unchanged. It checks prerequisites and rejects residual effective/inherited/column write access.

This is the same approved final mutation/grant scope, split for release compatibility. Do **not** apply both pending migrations together before the new application is healthy. The protected mutation contract intentionally makes old direct-writing deployments unable to mutate after phase two.

## 6. Testing and verification

| Check | Verified result |
| --- | --- |
| Full application suite | 443 tests in 39 files passed; includes 130 new catalog validation/route cases; existing 313 tests preserved |
| Actual local SQL | 184 assertions passed: 160 production-safe CRUD/visibility/audit/metadata checks plus 24 actual direct-write denial probes restricted to the local lab |
| Phased compatibility | Phase one preserves the existing table permission matrix; phase two enforces effective table and column write restrictions |
| Real local Next/Auth/PostgREST/RLS | 95 integration assertions passed, including customers with services.view, no draft/archive disclosure, same-session role/status changes, concurrent partial edits, category deletion races, real HTTP audit failures and reference detachments |
| Windows PowerShell workflow | 40 checks passed against guarded local endpoints using an ignored copy of the actual production helper with local destinations/output paths and private local fixture prompts; five content fixtures removed and administrator logout HTTP 200 |
| Generated release scripts | Exact transactional history wrappers, six function body/owner/path/ACL checks and the 160-check production-safe rollback script validated locally; all temporary migration history and fixtures rolled back |
| TypeScript / build / lint | TypeScript, production build and focused zero-warning lint passed |

Evidence: local-catalog-sql.json, local-catalog-integration.json, local-release-wrapper-verification.json and local-independent-cleanup.json under module-3-evidence. Earlier local harness failures were corrected; one retained set of four local accounts/content was removed under exact journal/ownership guards before rerunning. Final integration independently verified exact Auth/content cleanup, original grants, helper definitions/ACLs and local permission mappings restored. No failed attempt is being represented as a production pass.

The real Auth integration temporarily uses Module 1's active-role helper and explicit local permission seeds. Both are restored afterward. Disposable confirmed fixtures are setup for authorization tests, not email-confirmation workflow evidence. Production credentials are never read by the local harness.

## 7. Completion status

- [x] Approved requirements/contracts and implementation/dependency inspection.
- [x] Local CRUD/publication/filtering/public projections and customer compatibility verified.
- [x] Safe input/errors, authorization, audit rollback, direct-write restrictions and concurrency verified.
- [x] Relevant regressions, build, type and lint checks passed; local cleanup verified.
- [x] Reviewable two-phase release scripts and private production acceptance helper prepared.
- [x] Fresh production catalog/trigger/constraint/permission/aggregate-length preflight reviewed; all comparisons passed.
- [x] Separate user approval for commit/push, staged database release/deployment and disposable production content test.
- [x] Both migrations applied once; deployed application healthy; source/ACL/owner/path/RLS checks and 160 rollback assertions passed; synthetic fixture cleanup verified; 13 anonymous/public HTTP checks passed.
- [ ] Private administrator CRUD/publication/cleanup acceptance via Test-ProductionServiceCatalog.ps1 and exact fixture/audit reconciliation.
- [ ] Module 3 closure recorded before Module 4.

## 8. Remaining risks or issues and production procedure

Run node scripts/Prepare-Module3Release.mjs to prepare .next/module3-release/00-read-only-preflight.sql, both numbered migration/history scripts, 03-rollback-verification.sql and 04-metadata-verification.sql. These are local preparation outputs, not executed releases. The wrappers abort on unexpected migration history and store the reviewed body with the matching version atomically. Expected post-release metadata: six functions, zero source/owner/path/ACL mismatches, zero effective table/column write privileges, two new migration rows, RLS on both tables, zero rollback Auth fixtures/failure triggers.

Before release, compare production constraints, RLS policy scope, trigger fingerprints, role mappings and length aggregates with reviewed dependencies. Unexpected policies/triggers, conflicting function names or history require controlled review. Trigger bodies/arguments are fingerprinted rather than printed because unrelated webhook arguments could contain secrets. Length limits do not rewrite existing values and unrelated legacy edits remain supported.

After phase two, run the prepared 160-check rollback script: it creates only synthetic SQL/Auth fixtures and temporary failure triggers, writes no existing business records, sends no emails and rolls everything back. Never run Test-Module3CatalogDirectWriteDenials.sql against production. That file contains local-only destructive permission-denial probes.

After separately approved deployment, the user runs powershell.exe -NoProfile -File .\scripts\Test-ProductionServiceCatalog.ps1 with their existing administrator credentials privately. This creates two categories and three clearly labelled temporary services, briefly publishes test content, checks CRUD/public visibility and deletes only exact fixtures through backend APIs. No new login accounts or email steps. Existing audit history is retained. Identity journal docs/module-3-evidence/private-catalog-fixtures.json is Git-ignored; published evidence contains check names/status only. Unknown creation/cleanup outcomes block reruns for controlled review. This helper has not been run against production; it is now ready for the user to run with private administrator credentials.

If application deployment fails before phase two, existing writers remain functional and phase two must not run. After phase two, prefer a compatible guarded-RPC deployment or a forward fix; do not silently restore broad direct-write grants or deploy an old direct-writing version.

The enquiry module can currently accept service references through its privileged lookup independently of public publication. That pre-existing cross-module rule was not changed here; review it in the enquiry module. Trusted database owners can still administer data; audits are not immutable external archival.

## 9. Next module

Continue Module 3 production release/acceptance once approved. Module 4 remains deferred. Backend-only development continues.

## Reproducible local verification commands

- node node_modules/vitest/vitest.mjs run
- node scripts/Test-Module3CatalogSql.mjs
- node scripts/Test-Module3CatalogIntegration.mjs
- node scripts/Test-Module3ReleaseSql.mjs
- node node_modules/typescript/bin/tsc --noEmit
- node node_modules/eslint/bin/eslint.js src/features/services src/app/api/services src/app/api/service-categories src/app/api/public --max-warnings 0
- npm run build

Docker tests require the existing isolated bedos-supabase-lab stack. The integration test binds only loopback port 55330 and supplies local Auth credentials to its temporary Next process; production environment files are not changed. Prepare-Module3Release.mjs can regenerate review SQL after a build clears .next.

## Production preflight — 1 November 2026

Read-only SQL Editor comparison passed: tables, columns, constraints, policies, trigger fingerprints (including related enquiries/audit), grants and role mappings match the reviewed baseline. Module 1 active-role helper matches. No column ACLs or new-function collisions; latest production migration 20261101030000. Aggregate maximum service name/slug/description lengths 36/34/46, category lengths 25/23/96, all below proposed input bounds. Evidence: module-3-evidence/production-catalog-preflight.json. No account or business record contents were returned.

## Production release — 1 November 2026

Application a41066c pushed and Vercel deployment succeeded. Phase one 20261101040000 installed all six reviewed functions and preserved existing table grants; source/owner/path/ACL parity passed before push. After new public routes passed 13 anonymous checks, phase two 20261101050000 revoked direct mutations. Production-safe verification passed all 160 assertions and rolled back. Final metadata: six functions, zero source/owner/path/ACL mismatches, zero effective table/column write privileges, two new migration rows, RLS enabled on both tables, zero synthetic Auth fixtures/failure triggers. Independent post-release comparison confirms columns, constraints, policies, trigger fingerprints, role mappings, active-role helper and existing length aggregates unchanged; grant differences are the intended restrictions. All 13 public/anonymous checks passed again after phase two. Evidence: production-catalog-phase-one.json, production-catalog-release.json and production-catalog-anonymous.json. No real administrator account was altered. Private administrator HTTP CRUD/publication acceptance remains pending; Module 3 stays open.
