# Module 5 — property media implementation

2 November 2026. **COMPLETE for the agreed backend scope.** Production administrator acceptance and independent reconciliation passed. Modules 1–5 are closed; no Module 6 or frontend work has started. Authoritative closure: [MODULE_5_COMPLETION_REPORT.md](MODULE_5_COMPLETION_REPORT.md).

## 1. Module objective

Deliver the approved property-media scope: images/galleries, floor plans, features, amenities, validated uploads, private Storage access, audit and recoverable external operations. The user approved the concrete review proposal, including 3 MiB uploads, Sharp, owned file URLs, the private operation ledger, quotas and recovery APIs. Local scope approval was followed by separate user approval of Git publication, staged production migrations/Storage changes, deployment and the documented disposable acceptance fixtures on 2 November 2026.

## 2. Existing implementation and dependencies

The approved final specification and implementation plan govern. The requirements draft remains supplementary; PDF/video/SVG support, general attachments and a new upload provider were not introduced.

| Component | Responsibility/dependency |
| --- | --- |
| Existing eight metadata handlers | Verified auth context, strict JSON/multipart/query validation and no-store responses |
| Four property-media feature services | Small kind-specific facades over shared orchestration; no duplicate Storage logic |
| media.validation.ts | Bounded body reader, metadata validation, signature allow-list, actual Sharp decoding/re-encoding, pixel/frame/type/size checks and SHA-256 |
| media.service.ts | Bounded server-only Supabase transport, upload/finalize reconciliation, recovery, owned file delivery and safe provider errors |
| media.routes.ts | Shared collection/item/file handler behavior; public publication scope versus active staff preview |
| Five service-only RPCs | Read, metadata mutation, upload start, finalize and operation/recovery actions |
| Four private database helpers | Active actor/role checks, metadata validation, parent checks and FK-removal state handling |
| property_media_operations | Private durable provenance, idempotency, lease/version and recovery state; no client table access |
| Module 3 helpers | Existing bedos_require_catalog_permission and bedos_catalog_audit reused without definition changes |
| Module 4 | Existing property lifecycle/deletion remains intact; file metadata protects parent deletion until cleanup completes |
| Supabase Storage | Existing property-images/property-floor-plans buckets remain private; exact files handled only through server-owned paths |

The read-only production baseline was inspected on 1 November: media schemas/indexes/RLS/grants match local; both buckets private with no size/MIME caps; no metadata or objects exist. All 32 existing Storage policy fingerprints were recorded. Property SELECT predicates check only bucket ID, so direct authenticated access bypasses parent publication; direct manager writes also bypass byte validation. This baseline must be refreshed before release.

## 3. Relevant files

Changed:

- src/app/api/properties/[id] collection/item handlers for images, floor-plans, features and amenities.
- src/features/properties/property-image.service.ts, property-floor-plan.service.ts, property-feature.service.ts and property-amenity.service.ts; image/floor-plan types now omit exposed storage_path.
- src/lib/supabase/admin.ts: optional fetch override; existing callers/default behavior unchanged. Module 5 uses it for 20-second provider timeouts.
- package.json/package-lock.json: direct pinned sharp 0.35.5, previously installed transitively through Next. No other dependency versions changed.
- .gitignore: private production media journal excluded.

Added:

- src/features/properties/media.validation.ts, media.service.ts, media.routes.ts and focused validation/service tests.
- src/app/api/property-media/media.routes.test.ts.
- File handlers under images/[imageId]/file and floor-plans/[floorPlanId]/file.
- src/app/api/property-media/operations/route.ts and operations/[operationId]/retry/route.ts.
- supabase/migrations/20261101080000_secure_property_media.sql and 20261101090000_restrict_property_media_access.sql.
- scripts/Test-Module5MediaSql.mjs; scripts/sql/Test-Module5Media.sql; scripts/Test-Module5MediaIntegration.mjs.
- scripts/Prepare-Module5Release.mjs, Test-Module5ReleaseSql.mjs and Verify-Module5LocalCleanup.mjs.
- scripts/Test-ProductionPropertyMedia.ps1 and Test-ProductionMediaAnonymous.mjs.

Evidence: MODULE_5_LOCAL_CATALOG.json, read-only catalog/comparison SQL, module-5-evidence/production-preflight.json and sanitized local verification reports. No account identifiers, filenames, object paths or credential values are published in evidence.

## 4. Implementation plan and final contracts

The existing multipart POST URLs are preserved. One JPEG/PNG/WebP file is accepted, with **3 MiB input/output**, **3 MiB +64 KiB multipart body**, **20 million decoded pixels**, **10,000 pixels per dimension** and **one frame**. Other decoder families are rejected by signature before native parsing; full allowed-format decode/re-encode is still required. Orientation is applied and metadata removed. Conflicting declared MIME types, malformed/empty/oversized files, duplicate/unknown fields and file-valued metadata are rejected before Storage writes. Server-generated paths use immutable property/operation UUIDs; client filenames are ignored. No upsert.

Metadata limits: title/name 200, alt_text/value 1000 and description 10000 characters; optional blank text becomes null. display_order is an integer from 0 to 2147483647. Strict booleans and nonempty PATCH apply. Feature/amenity names are not made unique.

| Endpoint | Contract |
| --- | --- |
| Existing collection GETs | Same images/floorPlans/features/amenities keys; additive pagination; page=1/limit=25, maximum 100; exact count |
| Existing collection POSTs | properties.manage plus database manager/admin boundary; multipart for files, JSON for feature/amenity |
| Existing item PATCH | Verified manager/admin, strict partial edit and parent-child identity check |
| Existing item DELETE | Administrator only; metadata deletion atomic; physical file cleanup must complete before success |
| GET images/[imageId]/file and floor-plans/[floorPlanId]/file | Current published/ready check or authorized staff preview, private object read, size/hash verification and a second authorization check before returning bytes |
| GET /api/property-media/operations | Administrator only, bounded all-state history with pending work first, safe fields without paths/tokens |
| POST operations/[operationId]/retry | Administrator only, recorded eligible operation only; no paths/buckets/actions accepted; body bounded to 1024 bytes |

Public missing/unpublished parents return 404. Active administrator/content managers can prepare and preview draft media using database rechecks. Public API projections omit storage_path and image_url now points to the owned backend file route. File responses use validated type, generated filename, nosniff and private/no-store. Old downloaded copies cannot be revoked; no existing production assets were present in the inspected baseline.

At most one primary image is enforced by a partial unique index and parent-serialized replacement with audit for the displaced primary. No implicit primary promotion is added. Gallery order is display_order/created_at/id; feature/amenity order created_at/id. Quotas: 100 images, 25 plans, 100 features and 100 amenities per property; 30 upload starts/minute/actor and two upload_pending operations/actor. Pending cleanup reservations count toward file quotas when not already counted as metadata.

## 5. Code changes and recovery behavior

An upload operation is recorded before external upload. Its bucket/path, actor, bound property, file proof and original input are server-owned. An optional UUID Idempotency-Key binds retries; pending requests do not repeat Storage writes, ready replays return the existing record, changed inputs conflict, and deleted replays return 409 rather than resurrecting a file or falsely reporting pending work.

States: upload_pending -> ready -> cleanup_pending -> deleted; failed/unattached uploads can proceed to cleanup_pending. Actor/profile and parent locks protect quotas and state transitions. Finalization atomically inserts metadata, changes operation state and audits. A lost finalization response is reconciled before any cleanup; the object is not blindly removed.

Deletion first records cleanup_pending and hides the asset. Metadata remains until exact Storage removal and final audit/deletion succeed. Failure/uncertain completion returns HTTP 202 with operation_id/state. Leases last five minutes; retries during active work return 409 or the existing pending operation. Property deletion detaches an unattached operation rather than losing its cleanup proof. Terminal operation records are retained so an administrator can safely recheck a delayed external write; media deletion is audited only once. PostgreSQL and object storage are not claimed to be distributed-atomic.

Phase one requires private buckets and an empty/provenance-reviewed file baseline, then installs the ledger, nine functions, primary/order constraints and index without changing old table grants. Phase two requires a compatible deployment and tracked metadata/objects; it aborts if unexpected media appeared. It restricts direct writes to the four metadata tables, applies matching bucket limits and adds one restrictive Storage policy for anon/authenticated on only the two property buckets. All 32 existing policy definitions and unrelated bucket behavior are preserved. No global storage.objects grants are revoked.

## 6. Testing and verification

| Evidence | Verified result |
| --- | --- |
| Full application suite | 586 tests across 45 files passed |
| Decoder tests | Real JPEG/PNG/WebP decode, metadata stripping, animated WebP rejection, spoofing/truncation/pixel/dimension limits and bounded multipart |
| Local SQL | 125 assertions passed: role/ACL boundaries, metadata, primary replacement, audit rollback, leases/orphans, revocation, quotas/rate and Storage isolation |
| Real local Next/Auth/Storage | 96 checks passed, including actual file upload/download, concurrent primary changes, client bypass denial, provider/finalization/removal failures and late-write cleanup |
| Windows PowerShell 5 workflow | Actual production helper redirected to loopback passed all 49 checks and deleted all seven exact fixtures |
| Production-safe release wrappers | 123 rollback assertions passed; nine function source/owner/path/ACL checks, private ledger, two bucket configs and restrictive policy verified |
| Independent local restoration | 19 checks passed; original schema/indexes/policies/grants/buckets/helper dependencies restored, fixtures/functions/ledger absent and port free |
| Build/type/lint | Production build/TypeScript and focused lint passed |

The two Storage catalog probes in the local SQL suite are excluded from production rollback SQL. The latter touches only synthetic SQL fixtures inside a rollback transaction; physical Storage behavior is tested separately through actual local APIs. Local fixture confirmation is setup, not email-delivery evidence. Runtime dependency audit reported zero vulnerabilities. The local Windows build requires junction-creation permission; the sandbox-only junction failure was resolved by running the authorized build with that permission.

Reproduce sequentially for shared Docker lab tests:

```powershell
npx vitest run
node scripts/Test-Module5MediaSql.mjs
node scripts/Test-Module5MediaIntegration.mjs
node scripts/Test-Module5ReleaseSql.mjs
node scripts/Verify-Module5LocalCleanup.mjs
npm run build
npx eslint src/features/properties src/app/api/properties src/app/api/property-media src/lib/supabase/admin.ts
```

## 7. Completion status

- [x] Requirements/source/schema/storage review and significant design approval.
- [x] Local implementation, real decoder and Storage recovery verification.
- [x] Regression/build/type/lint and prepared release checks.
- [x] Independent local fixture/configuration restoration.
- [x] Separate commit/push, hosted migration/bucket configuration/deployment and production fixture approval.
- [x] Fresh production preflight, staged release and post-release checks.
- [x] Private administrator production acceptance.
- [x] Independent exact-file/metadata/operation/audit reconciliation and final completion report.

Release approved and deployed: application 817db99, followed by phase-two restrictions after the production deployment and anonymous checks passed. Both migrations are committed. All 123 production-safe rollback assertions passed; final definitions/owners/search paths/ACLs match, direct table/column writes are zero, ledger private, five RLS tables retained, two private buckets configured, restrictive guard present and all existing Storage policy fingerprints unchanged. Production rollback fixtures, media rows, objects and operations are absent. Private administrator acceptance passed all 49 saved checks; independent reconciliation passed all 81 checks. The seven fixtures and three uploaded files are absent, with 31 retained audits and three terminal deleted operations.

## 8. Remaining risks or issues and release procedure

The 3 MiB cap replaces an undeployable 10 MiB promise; larger uploads require a separate contract. File delivery through the backend incurs function bandwidth and hashing work and deliberately avoids public caching so withdrawal is rechecked. Native decoder CPU/memory bounds and the successful Vercel-targeted build were tested. No automated cleanup scheduler is introduced: administrators must inspect pending work, wait for leases to expire and use the retry endpoint; completed records remain available for delayed-write rechecks. Trusted database owners can bypass application rules.

Prepare .next/module5-release scripts with node scripts/Prepare-Module5Release.mjs. They include history guards expecting production version 20261101070000 before phase one and source/ACL/Storage metadata verification. Production preflight must reconfirm zero legacy assets, private buckets, policy fingerprints, helper dependencies, version and unused new names. Unexpected records or drift require controlled review, never automatic conversion or deletion.

After separate release approval: keep staff upload activity idle during cutover and confirm old requests have drained; apply phase one and verify nine functions/private ledger/constraints while old grants remain. Commit/push only reviewed Module 5 paths and deploy. Verify the compatible APIs, then apply phase two and verify effective privileges, bucket limits, restrictive guard and unchanged unrelated policies. If deployment fails, do not apply phase two. After restrictions, old direct-writing application versions are incompatible; prefer a compatible deployment or forward fix.

Run the production-safe rollback checks and anonymous smoke checks. Then the user runs scripts/Test-ProductionPropertyMedia.ps1 privately. It creates **two properties, two tiny generated images, one image floor plan, one feature and one amenity**, briefly publishes the gallery, checks public/preview/withdrawal behavior and removes exact fixtures. No accounts, email steps or customer files. Audit/operation histories are retained. Its private-media-fixtures.json is Git-ignored; ambiguous creation or incomplete cleanup blocks reruns. Independently reconcile physical object absence, metadata deletion, terminal operation states and audit chains before closing Module 5.

## 9. Next module

Module 5 production acceptance and closure are verified. Next is Module 6 property viewing management inspection and acceptance definition. General media/attachments remain Module 17. Frontend remains deferred.

## Release attempt — 2 November 2026

User separately approved the full documented release. No release mutation has executed: the Windows dashboard helper could not verify the URL on the first attempt, then timed out twice capturing the SQL Editor after user handoff. The browser connector exposes no Chrome tabs. Manual read-only preflight is prepared in MODULE_5_RELEASE_PREFLIGHT.sql; production result must be reviewed before phase one. No Git commit/push or production changes.

## Production release verified — 2 November 2026

The approved release completed after dashboard access recovered. Fresh preflight: 15/15 checks passed. Phase one 20261101080000 committed and nine function definitions/owners/paths/ACLs matched before deployment. GitHub application commit 817db9915d4e0cb688797f39a7d3610421b50d19 deployed successfully to Production (GitHub deployment 7481967715; Vercel DKa95SfNvfpMBNvuqKvkrfW7y6mH). All 23 credential-free API checks passed before phase two. Phase two 20261101090000 committed; all 23 checks passed again. Production SQL returned 123 assertions_verified and rolled_back. Final read-only reconciliation found zero direct table/column writes and ledger privileges, nine matching functions, five RLS tables, both migration rows, two capped private buckets, one restrictive guard, unchanged existing Storage policy fingerprints and zero synthetic Auth/failure triggers/media rows/property objects/operations.

Sanitized release results: module-5-evidence/production-release-preflight.json, production-phase-one.json, production-release-verification.json and production-media-anonymous*.json. No real administrator credentials were used. Required next step is the user-run Test-ProductionPropertyMedia.ps1 administrator workflow, followed by independent physical-object/metadata/operation/audit reconciliation. Module 5 remains OPEN; Module 6 and frontend deferred.

## Verified closure — 2 November 2026

The user completed the production administrator helper: all 49 saved checks passed, including logout HTTP 200. Verify-ProductionPropertyMediaFixtures.mjs independently passed all 81 read-only checks. Both properties, all five child records and all three exact Storage objects are absent. Three retained operations are deleted/version 4 with intact immutable provenance and detached parents. Twenty-two business and nine operation audits have correct actor, counts and continuous images; the administrator remains active with administrator role. The private journal is complete and ignored. MODULE_5_COMPLETION_REPORT.md supersedes earlier open/pending notes. Module 5 COMPLETE; Module 6 not started; frontend deferred.
