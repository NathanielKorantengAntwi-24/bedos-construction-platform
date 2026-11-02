# Module 7 — Construction Project Management

Status: LOCALLY VERIFIED; production release APPROVED and phase one verified. OPEN pending compatible deployment, phase two and production acceptance. Backend only. 2 November 2026.

## 1. Module objective

Implement the user-approved contract in `MODULE_7_REVIEW_AND_PROPOSAL.md`: construction projects/categories, service references, stages and derived progress, lifecycle/public portfolio, phased images, recoverable Storage operations, permissions and transactional audits. Approval covered local implementation/testing. No Module 7 production migration/configuration/fixture write, Git publication or deployment has occurred.

## 2. Existing implementation and dependencies

The previously empty project feature now has project-specific validation, service and route orchestration. Existing projects/project_stages/project_images are retained. Additive categories, service links, versions, image phases and a private operation ledger fill the documented gaps. Direct project-table access is removed in phase two; narrowly granted backend functions perform authorized operations.

Dependencies and compatibility:

- Modules 1–2: existing verified user context/active-account permission checks; both HTTP and database require administrator/content_manager for management. The existing customer projects.view mapping is preserved but cannot authorize management reads.
- Module 3: existing catalog permission/audit helpers; project_services has restrictive service references, so referenced service deletion returns its existing safe 409 mapping. Published service rows are locked when linking; later unpublication hides the public summary and retains the link.
- Module 5: image decoder extracted without behavior changes into `src/server/media/image.ts`; the old property module re-exports it to preserve its interface and tests. Property buckets, ledger and workflows are otherwise unchanged.
- Existing PostgreSQL/Supabase Storage/sharp/Next stack retained. No new package dependency, scheduler, general media abstraction or frontend feature.

## 3. Relevant files / project and dependency map

| Files | Responsibility |
| --- | --- |
| `src/features/projects/project.validation.ts` and test | Strict text/UUID/date/version/query/body/multipart boundaries |
| `src/features/projects/project.service.ts` and test | Backend RPC errors, upload/finalize acknowledgement recovery, removal and guarded byte delivery |
| `src/features/projects/project.routes.ts` | Active staff/public boundaries, API envelopes and no-store responses |
| `src/server/media/image.ts`, `src/features/properties/media.validation.ts` | Shared actual image decoding; existing property export compatibility |
| `src/app/api/projects/**`, `project-categories/**`, `project-media/**`, `public/projects/**`, `public/project-categories/**` | Sixteen thin route handlers using promised Next route params |
| `supabase/migrations/20261102030000_secure_construction_projects.sql` | Guarded schema, seven functions, authorization/version/lifecycle/audit/media rules |
| `supabase/migrations/20261102040000_restrict_construction_project_access.sql` | Privilege/RLS checks, private capped bucket, restrictive Storage guard; preserves original policies |
| `scripts/Test-Module7ProjectsSql.mjs`, `scripts/sql/Test-Module7Projects.sql` | Local rollback business/security/atomicity assertions |
| `scripts/Test-Module7ProjectsIntegration.mjs` | Actual loopback Next/Auth/PostgREST/Storage, concurrency, failure recovery, Windows PowerShell helper and independent reconciliation |
| `scripts/Prepare-Module7Release.mjs`, `Test-Module7ReleaseSql.mjs` | Concrete staged release wrappers, drift/refusal checks and metadata/source manifest |
| `scripts/Test-ProductionConstructionProjects.ps1` | Private administrator acceptance with exact labelled fixtures and guarded cleanup; not run in production |
| `scripts/Prepare-ConstructionFixtureVerification.mjs` | Generates private read-only cleanup/audit/operation SQL from the completed exact fixture journal |
| `scripts/Verify-Module7LocalCleanup.mjs` | Independent catalog, fixture, role helper and server restoration checks |

Architecture: thin handler → verified active role/permission → bounded project validation → service-only RPC → transactional actor/parent locks and business/audit changes. Storage orchestration is outside the SQL transaction and is backed by a persisted, leased project operation. Public files go through an owned backend URL, proof validation and a second authorization/publication check after download.

## 4. Implementation plan / decisions recorded

The approved project vocabulary remains draft/ongoing/completed/archived; ongoing/completed alone are public. Explicit transitions and completion dates are enforced. Completed projects require at least one stage, all completed; their stages remain frozen until reopening. Progress is the rounded equal-stage completed percentage, null without stages. Stage creation begins pending and later date/state transitions are validated; reorder is atomic and unique within a project.

All project/child changes lock the parent and advance its version. Requests supply expected_version; project/category deletion supplies it in a JSON body. Category rows have their own versions. Stage/reorder requests carry the parent version. Upload multipart carries expected_version and a required UUID Idempotency-Key header. An upload reservation and finalize each advance the parent; deletion claim and completion do likewise. Pending results are HTTP 202 with operation ID/state; refresh the management detail for the current version. Idempotent upload replay must repeat the original version, normalized metadata and bytes.

Public project/category/detail and gallery fields are explicitly projected. client_name/creator/version/operation details/storage paths are not public. Lists are bounded to 25 by default/100 maximum with exact counts, strict queries and no-store. Detail/children/progress and count/page results use one query snapshot.

Image operations persist generated path, hash/type/size, original actor/project/media/request identity and immutable initial metadata. Only ready images are visible, exactly one primary exists when ready images exist, and pending/uncertain operations remain recoverable. Administrative recovery waits for the five-minute lease and cleans an incomplete upload rather than guessing that it committed. Ready images require explicit versioned deletion. Parent deletion is blocked until files/operations are deleted; terminal provenance survives with a detached nullable parent. No automatic retry worker is added.

## 5. Code changes and API contracts

The complete route table and field/limit contract are retained in the approved proposal. JSON mutation examples:

```json
{"title":"Example construction","slug":"example-construction"}
```

```json
{"expected_version":1,"status":"ongoing"}
```

```json
{"expected_version":2,"name":"Foundation","stage_order":0}
```

Status requests use `/api/projects/[id]/status`; stages use the nested collection/item and reorder routes. Stage status is in its PATCH body with start/completion dates. Stage creation returns the updated full project, including the new child ID. Image mutations return image/project_version or a pending result. Public reads use `/api/public/projects`, slug details and public project categories; management routes never double as public lists. Files use `/api/projects/[id]/images/[imageId]/file`.

HTTP errors: malformed inputs 400, unauthenticated staff route 401, denied role/permission 403, absent/hidden/cross-parent records 404, stale version/reference/lifecycle conflict 409, oversized body/file 413, provider/database unavailability 503. Errors also receive no-store. Storage failure does not trigger blind compensating deletion after a possibly committed finalize.

## 6. Testing and verification

Verified commands/results (final evidence files below):

- `npx vitest run`: 724 tests / 51 files passed, including 52 new project tests and all 26 property image-validation tests.
- `node scripts/Test-Module7ProjectsSql.mjs`: 103 isolated local SQL rollback assertions passed, including role/endpoint/helper ACLs, lifecycle/progress, strict fields/dates, image phases/primary replacement, stale leases, parent guards, retained provenance and audit-failure rollback.
- `node scripts/Test-Module7ProjectsIntegration.mjs`: real local HTTP/Auth/PostgREST/Storage checks, concurrent edit conflict, suspended stale session behavior, file withdrawal, synthetic finalize-audit failure recovery, actual Windows PowerShell helper and independent fixture query. Latest final run is recorded in `module-7-evidence/local-project-integration.json`.
- Windows PowerShell acceptance helper: 39 checks passed locally; independent fixture/audit/operation query: 15 passed locally. Production executions remain pending.
- `node scripts/Test-Module7ReleaseSql.mjs`: exact release wrappers plus 103 rollback assertions, both registry rows and five refusal checks passed locally; all writes rolled back.
- `node scripts/Verify-Module7LocalCleanup.mjs`: 18 independent read-only restoration checks passed against the persisted corrected-run baseline.
- Existing `Verify-Module6LocalCleanup.mjs`: 19 prior-viewing baseline/fixture/process checks also passed; this run's evidence is saved as `module-7-evidence/local-viewing-compatibility.json`, preserving Module 6's original evidence file.
- `npm run build`, `npx tsc --noEmit`, focused ESLint and `git diff --check`: passed. Next's installed route-handler documentation was read before implementation.

The initial integration helper stopped before media creation because its SQL INSERT result parser included a command-status line. Its cleanup attempted forbidden direct Storage bucket deletion. The corrected harness uses the Storage API, persists pre-run restoration data in ignored `node_modules/.cache/module7`, and verified all eleven captured catalog sections restored. The pre-run role helper was initially only in process memory; the user explicitly approved restoring its historical snapshot definition and the exact broader local cleanup. That limitation and approval are recorded in `MODULE_7_LOCAL_HELPER_RECOVERY.md` / `MODULE_7_LOCAL_CLEANUP_PLAN.md`; subsequent runs verify the saved baseline exactly. No hosted system was involved.

## 7. Completion status

OPEN. Local implementation passes the recorded checks. Do not mark Module 7 complete until the staged production release, private administrator workflow and independent exact cleanup/audit/provenance reconciliation pass.

Release package is prepared under ignored `.next/module7-release/` (regenerate with `node scripts/Prepare-Module7Release.mjs` after a build clears generated files). It includes read-only preflight, two independently transactional guarded registry-recording migrations, rollback-only business verification, source/ACL metadata verification and a function/source manifest. These files have not been executed in production. Fresh preflight must match all recorded sections immediately before any release; refuse drift or existing content instead of adopting it silently.

## 8. Remaining risks or issues / release checklist

- [x] User approved explicit Git publication, both hosted migrations/Storage restrictions, compatible deployment and labelled disposable production acceptance fixtures.
- [x] Fresh production schema/grants/roles/policies/empty-content preflight and unchanged prerequisite migration baseline. Approved phase one 20261102030000 committed; nine read-only checks, including seven exact function definitions/owners/paths/ACLs, passed. Original grants, bucket configuration and all original Storage policies retained; no fixtures.
- [ ] Phase one, compatible app deployment, phase two; preserve unrelated policies/buckets and recheck source/owner/search-path/ACL metadata.
- [ ] Rollback-only production SQL verification and private `Test-ProductionConstructionProjects.ps1` acceptance (briefly public labelled portfolio, tiny image).
- [ ] Generate private independent SQL from the completed journal and verify exact records/objects removed, terminal operation and audit history retained, original administrator active.
- [ ] Record release/acceptance evidence and closure before Module 8.

Five-minute leases may temporarily block recovery after a provider timeout. Historical audit actor FK retention remains Module 22's known issue; project operations retain immutable actor IDs without changing shared audit schema. Local and production permissions/Storage configuration differ; release wrappers are tested against a rollback-only reproduction of the observed production metadata. Application compatibility is checked locally, not a claim of a hosted release.

## 9. Next module

Module 8 interior design remains deferred. Next action for Module 7 is release review and authorization, followed by controlled production verification.
