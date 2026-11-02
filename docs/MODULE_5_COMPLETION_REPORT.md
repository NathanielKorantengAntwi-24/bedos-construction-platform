# Module 5 completion report

2 November 2026. **COMPLETE for the agreed backend scope.** This report supersedes earlier open/pending Module 5 entries. Modules 1–5 are closed. Module 6 has not started; frontend development remains deferred.

## 1. Module objective

Deliver the approved property media scope: images/galleries, image floor plans, features, amenities, validated uploads, private Storage delivery, audit and recoverable external operations. The final technical specification and implementation plan govern; the supplementary requirements draft does not independently expand the approved scope.

## 2. Existing implementation and dependencies

Existing property-media URLs now use shared strict validation and orchestration over five service-only guarded RPCs and four private database helpers. Module 3 permission/audit helpers and Module 4 property lifecycle/deletion boundaries remain in use. Active staff authorization and publication state are rechecked in the database. File delivery verifies current access, stored file proof and access again after the provider read.

The private operation ledger records server-owned file provenance before upload and retains idempotency, lease/version and cleanup state. PostgreSQL and object storage are separate systems: uncertain finalization is reconciled, while incomplete physical removal retains hidden metadata and returns a pending operation for controlled retry.

## 3. Relevant files

The complete implementation/dependency map and API contracts are in MODULE_5_IMPLEMENTATION.md. Main source changes are media.validation.ts, media.service.ts and media.routes.ts; four kind-specific services/types; collection/item/file handlers; administrator operation/retry handlers; focused tests; Sharp pinned as a direct dependency; and migrations 20261101080000/20261101090000.

Release and verification tooling includes Prepare-Module5Release.mjs, Test-Module5MediaSql.mjs, Test-Module5MediaIntegration.mjs, Test-Module5ReleaseSql.mjs, Verify-Module5LocalCleanup.mjs, Test-ProductionMediaAnonymous.mjs, Test-ProductionPropertyMedia.ps1 and Verify-ProductionPropertyMediaFixtures.mjs.

## 4. Implementation plan and release

The user approved the reviewed contracts, ledger/recovery model, validation limits and narrowly scoped database/Storage changes, then separately approved Git publication, staged production release and the seven disposable acceptance fixtures. Fresh production preflight passed all 15 checks with no existing media assets. Phase one installed the guarded functions and private ledger while retaining existing grants. Application commit 817db99 deployed successfully to Production before phase two restricted direct metadata writes and access to the two property buckets. Twenty-three anonymous checks passed before and after phase two. Commit 22df884 records release verification.

Both migrations are recorded. Final source/owner/search-path/ACL comparison found nine matching functions; effective direct table/column write privileges and ledger privileges were zero; five tables retained RLS; both private buckets had the approved limits; the restrictive property Storage guard was present; and all original Storage policy fingerprints remained unchanged. All 123 production SQL assertions passed and their synthetic fixtures rolled back.

## 5. Code changes

- JPEG/PNG/WebP signature screening followed by actual decode and normalization; orientation applied and metadata stripped. Input/output capped at 3 MiB, multipart body bounded, decoded pixels/dimensions/frame count limited and unsupported/disguised/malformed files rejected.
- Generated immutable paths, no upsert, fixed public projections without Storage paths and guarded owned file URLs with no-store/nosniff responses.
- Draft staff preview, published-only public access, immediate withdrawal rechecks, bounded deterministic pagination and strict metadata edits.
- Parent-serialized primary replacement with a unique primary index, nonnegative order constraints, quotas and upload throttling.
- Atomic metadata/audits and durable upload/finalization/deletion recovery with guarded administrator retries and safe idempotent replay.
- Property-specific restrictive Storage access preserves unrelated buckets and existing policy definitions.

## 6. Testing and verification

| Evidence | Verified result |
| --- | --- |
| Application suite | 586 tests across 45 files passed |
| Local SQL | 125 assertions passed |
| Real local Next/Auth/Storage | 96 checks passed, including concurrent primary changes and external failure recovery |
| Actual Windows PowerShell helper locally | 49 checks passed and seven fixtures removed |
| Release wrappers and local restoration | 123 rollback assertions and 19 independent restoration checks passed |
| Build/type/lint and runtime dependency audit | Passed; zero reported runtime dependency vulnerabilities at verification time |
| Production SQL | 123 assertions passed; synthetic transaction rolled back |
| Production anonymous/API checks | All 23 passed before and after restrictions |
| Production administrator acceptance | All 49 saved checks passed, including upload/preview/publication/withdrawal, exact cleanup and logout HTTP 200 |
| Independent production reconciliation | All 81 checks passed: exact record/provider absence, terminal operation provenance, retained audits and administrator integrity |

Independent read-only reconciliation verified both property IDs and the shared fixture nonce absent, all five child metadata records and parent references absent, and provider listings empty with each of the three exact objects no longer downloadable. Three retained operations have deleted state, version 4, detached deleted parents and matching immutable actor/property/media/idempotency/path/file proof. Twenty-two business audits and nine operation audits retain the correct actor, exact identities, action counts and continuous before/after images. Rejected operations and upload replay produced no additional business mutations. The original administrator remains active with administrator role.

Sanitized evidence: module-5-evidence/production-media-admin.json, production-media-completion.json, production-release-verification.json, production-phase-one.json, production-release-preflight.json and production-media-anonymous*.json. The private identity journal is complete and Git-ignored; credentials, fixture identities, object paths and raw audit images are not published. Reconciliation used record/Storage reads and the status-only operation RPC; no persistent production mutation was made.

## 7. Completion status

All agreed acceptance criteria are satisfied. **Module 5 is COMPLETE.** All seven acceptance fixtures and three uploaded files are removed; operation/audit histories are intentionally retained. No further administrator test is required for this module scope.

## 8. Remaining risks or issues

Only approved JPEG/PNG/WebP image floor plans are supported; PDF, SVG, video, larger files and general attachments require separate scope. Private backend delivery incurs function bandwidth and hashing work, and already downloaded copies cannot be revoked. No automated cleanup scheduler is introduced: administrators must inspect pending operations and retry after leases expire. Old direct-writing application versions are incompatible after phase two; use compatible releases or forward fixes. Trusted database owners can administer underlying records; audit history is not external immutable archival.

## 9. Next module

Module 6 — property viewing management. Inspect the approved requirements, existing implementation and relevant dependencies before defining acceptance criteria and proposing changes. Backend only; no Module 6 implementation has started.
