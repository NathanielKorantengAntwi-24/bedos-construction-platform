# Module 5 — property media review and proposed implementation

1 November 2026 review; user approved the proposed scope. Local implementation and verification are recorded in [MODULE_5_IMPLEMENTATION.md](MODULE_5_IMPLEMENTATION.md), updated 2 November 2026. The checklist below preserves the original proposal; current acceptance status is in that implementation record. Production release remains pending separate approval. Modules 1–4 remain complete. Backend only.

## 1. Module objective

The implementation plan, page 5, defines Module 5 as images, galleries, floor plans, features, amenities, uploads and storage security. The final technical specification's property and File & Media Security sections require intended public access, allow-listed types, size limits, generated storage names and validation before availability. The requirements draft also describes galleries, floor plans, features/amenities and alternative text; conditional items remain conditional.

Acceptance checklist:

- [ ] Authorized staff can prepare and preview media on draft properties.
- [ ] Public metadata and file requests work only for published properties and ready assets.
- [ ] File bytes are decoded and normalized before upload; unsupported, disguised, malformed, animated, oversized and excessive-pixel inputs are rejected.
- [ ] Invalid multipart/JSON input causes no storage write; safe names are generated from immutable IDs.
- [ ] Primary-image changes, ordering, features and amenities are validated, authorized and audited atomically.
- [ ] Database/storage partial failures are recorded durably, recoverable and tested; no success is claimed when deletion or publication remains pending.
- [ ] Direct client Storage access cannot bypass backend validation/publication checks; unrelated buckets remain unaffected.
- [ ] Module 4 lifecycle and protected deletion remain compatible, including concurrent upload/deletion/withdrawal cases.
- [ ] Relevant regression, real Storage integration and controlled production acceptance/cleanup evidence pass before completion.

## 2. Existing implementation and dependencies

Verified source:

| Area | Current behavior and finding |
| --- | --- |
| Routes | Eight collection/item route files implement images, floor plans, features and amenities. Public GET lists, properties.manage creation/edits, administrator-only deletion. |
| Image/floor-plan upload | Multipart; client MIME selects JPEG/PNG/WebP and extension; advertised 10 MiB limit. No byte decoding. Slug-based paths contain generated UUID filenames. No PDF support. |
| Validation | Unbounded form parsing; duplicate/unknown fields ignored; image upload occurs before some metadata validation. PATCH/body/type/text/integer validation is incomplete. |
| Storage delivery | Privileged one-hour signed URLs; public metadata includes storage_path. A previously issued URL is not re-authorized against later property withdrawal. |
| Failure handling | Image metadata insertion is followed by signing; if signing fails, the route removes the object even though metadata may already have committed. Both deletion services delete metadata before Storage removal, losing the normal retry path if removal fails. Cleanup errors after upload rollback are not durably tracked. |
| Metadata | No atomic primary-image replacement or one-primary constraint; no mutation audit in these services. Ordering lacks ID tie-breaks; lists are unbounded. |
| Related modules | Module 4 blocks property deletion with images/floor plans/viewings and audits feature/amenity cascades. Its active-role/audit helpers can be reused. Viewing management remains Module 6; general media/attachments remain Module 17. |

No dedicated property-media test files were found in the inspected source/script inventory. Existing property core/reference tests do not establish upload/storage acceptance.

Verified local catalog: four RLS-enabled, postgres-owned metadata tables; primary keys and cascading property foreign keys; property/order lookup indexes. No primary-image uniqueness, nonnegative-order checks or custom media audit triggers. SELECT policies cover published parents only; no administrator/content-manager draft-preview SELECT policy exists. Direct table grants are broad. Local Storage has no buckets or policies, so it must be explicitly configured for meaningful integration tests.

Verified read-only production preflight: all four table schemas, constraints, indexes, RLS policies, grants, column ACL counts and trigger fingerprints match local. Both expected buckets are private, but file_size_limit and allowed_mime_types are null. All four metadata counts and both object counts are zero; duplicate paths, multiple-primary groups, negative orders and dangling references are also zero. There is no existing media to rewrite or delete.

Production has 32 Storage policies. The eight property-specific predicates were inspected: authenticated SELECT checks only bucket_id, while upload/update check manager role and deletion checks administrator role. Thus the current object policy does not enforce parent publication or active-account status on reads. Direct upload/update also bypass application byte validation. No real files were accessed to test this; the finding is established from the verified policy predicates. Supabase documents that private downloads are controlled by Storage RLS: https://supabase.com/docs/guides/storage/buckets/fundamentals.

Evidence: MODULE_5_LOCAL_CATALOG.json, MODULE_5_CATALOG_PREFLIGHT.sql, MODULE_5_PRODUCTION_COMPARISON.sql and module-5-evidence/production-preflight.json. No object paths, filenames, account IDs or media contents were returned or published.

## 3. Relevant files

Existing routes to change:

- src/app/api/properties/[id]/images/route.ts and images/[imageId]/route.ts.
- src/app/api/properties/[id]/floor-plans/route.ts and floor-plans/[floorPlanId]/route.ts.
- src/app/api/properties/[id]/features/route.ts and features/[featureId]/route.ts.
- src/app/api/properties/[id]/amenities/route.ts and amenities/[amenityId]/route.ts.

Existing services/types to change: property-image, property-floor-plan, property-feature and property-amenity under src/features/properties. Reuse property ID/HTTP helpers and established auth/audit conventions. package.json/package-lock.json require a direct image-decoder dependency.

Proposed additions, not existing implementations: shared property-media validation/orchestration helpers, two file handlers, property-scoped operation list/retry handlers, focused tests, staged migrations, Storage integration scripts and sanitized evidence. Shared helpers remain scoped to property media; no platform-wide media rewrite is proposed.

## 4. Implementation plan — approval required

### Upload contract and decoding

Keep the current authenticated multipart POST URLs and field names. Recommend a **3 MiB file limit**, a **3 MiB + 64 KiB total multipart-body limit**, **20 million decoded pixels**, maximum **10,000 pixels per dimension**, and single-frame JPEG/PNG/WebP only. Apply the file-size ceiling to both input and normalized output. PDF/SVG/GIF/AVIF/video remain unsupported. These numeric limits are recommendations, not values mandated by the documents.

Reason for changing the old 10 MiB promise: Vercel documents a 4.5 MB function request-body limit, below the current API's allowance. A 3 MiB cap leaves multipart overhead below that ceiling: https://vercel.com/docs/functions/limitations. Preserving 10 MiB would require a separately approved direct-to-private-storage/finalization upload contract. This proposal selects the existing backend upload flow and a deployable limit.

Declare **sharp 0.35.5** directly and pin its lockfile. That version is already installed as Next's optional dependency; relying on it transitively would be inappropriate for an application import. Inspect bytes, enforce format/dimension/frame limits, fully decode and re-encode to the detected allowed format, apply orientation and strip metadata. Metadata inspection alone does not decode pixels. Derive content type/extension from validated content; reject conflicting declared MIME types; never use the client filename as a path. Sharp documents decoder pixel limits and metadata-free output: https://sharp.pixelplumbing.com/api-constructor/, https://sharp.pixelplumbing.com/api-input/, https://sharp.pixelplumbing.com/api-output/.

Authenticate and validate IDs before reading the body. Bound streaming body consumption before FormData parsing, then reject duplicate/unknown fields, file-valued metadata, invalid booleans/numbers and excessive text before any Storage write. New object paths use property UUID plus operation UUID, not mutable slugs. No overwrite/upsert or arbitrary client storage_path is accepted.

Proposed field limits: title/name <=200 characters, alt_text/feature value <=1000, description <=10000; optional blank text becomes null. display_order is an integer from 0 through 2147483647; duplicate positions remain legal with stable tie-breaks. Existing text values are not rewritten.

### Reads and file delivery

Preserve existing metadata URLs and response array keys (images, floorPlans, features, amenities). Add page/limit pagination, default 25/max 100, with exact counts. Missing/unpublished parents return 404 to public requests instead of indistinguishable empty lists. Active administrator/content-manager previews are checked explicitly in guarded RPCs, addressing the current absence of staff child-table SELECT access.

Recommend replacing one-hour signed URLs with owned backend file URLs in the existing image_url field:

- GET /api/properties/[id]/images/[imageId]/file.
- GET /api/properties/[id]/floor-plans/[floorPlanId]/file.

Every fresh request checks ready state and current parent publication or authorized staff preview before reading the private object. Return validated content type, generated filename, nosniff and private/no-store headers. Do not expose storage_path in public API projections. No promise is made to revoke previously downloaded copies or old signed URLs; existing signed URLs can live until expiry. Production currently has no objects.

This is an intentional image_url delivery change requiring approval. It keeps publication control in the approved backend. Bucket keys are not treated as credentials; access is enforced independently by Storage policy and the backend.

### Metadata, roles and audit

Use guarded transactional functions for reads and mutations. Recheck active actor, properties.manage and administrator/content-manager scope; preserve administrator-only DELETE for all four resource types. Check both parent and child IDs in the mutation transaction. Creation/edits/deletion/primary changes record trusted actor and before/after audit atomically.

Enforce at most one primary image per property using a partial unique index and serialized primary replacement; setting one true clears the old primary atomically. Preserve the ability to have no explicitly selected primary. Sort images/floor plans by display_order, created_at, id, and features/amenities by created_at, id. Do not introduce unique feature/amenity names without a business requirement.

Recommended quotas: 100 images, 25 floor plans, 100 features and 100 amenities per property; 30 upload starts/minute per actor and at most two in-flight uploads. Enforce quotas/rate/concurrency in the database so parallel requests cannot bypass them. Count pending reservations toward file quotas. These operational limits require approval and will be documented in errors/tests.

### Recoverable database/Storage operations

PostgreSQL and Storage object writes cannot share one transaction. Add one private **property_media_operations** ledger, with RLS/no client table grants, to bind generated operation/object/media identities, actor, property, kind, validated type/size/hash, version/lease and state. Proposed states are upload_pending, ready, cleanup_pending and deleted. Bucket/path fields are server-owned and immutable. Keep this ledger property-specific.

Record the operation before Storage upload. After upload, a guarded finalize function rechecks actor/property/operation state and commits metadata, audit and ready state atomically. If the response is uncertain, reconcile the operation before deleting anything; never assume a timeout means rollback. Optional UUID Idempotency-Key support binds retries to the same actor/property/kind/content rather than duplicating successful work.

On deletion, atomically mark the asset unavailable/cleanup_pending and record the request before removing its exact object. Retain metadata until Storage removal is confirmed; only then finalize metadata deletion and its audit. On failure return an explicit pending operation response (HTTP 202) with operation_id, rather than falsely reporting completion. Reads exclude cleanup_pending assets. The existing Module 4 image/floor-plan deletion block continues to protect parents while cleanup is unfinished.

Unattached upload operations survive parent deletion through a nullable ON DELETE SET NULL reference; immutable path/provenance remains available and finalization against a missing parent is denied. Mark those operations for cleanup. Use lease/version checks to prevent finalize/retry races. Track uncertain/late writes for idempotent rechecking; do not claim distributed atomicity or lose retry evidence.

Add administrator-only bounded GET /api/property-media/operations and POST /api/property-media/operations/[operationId]/retry. They operate only on recorded, eligible property-media work and accept no bucket/path from callers. Active uploads cannot be cleaned prematurely. No new queue provider, scheduled service or general-purpose file deletion endpoint is proposed. Operationally, administrators must retry pending/expired work; maintenance automation can be approved separately if required.

### Storage and staged release

Keep both buckets private. After compatible deployment, set matching size/MIME limits, restrict direct writes on the four metadata tables and add a restrictive Storage policy denying anon/authenticated direct operations only for the two property buckets. The backend uses its server credential with explicit validation/authorization. Preserve the 32 existing policy definitions and all unrelated bucket behavior; no global storage.objects grant revocation.

New ledger/functions/constraints are prepared additively and tested first. Direct-write restrictions and bucket limits follow deployment, as in Modules 3/4. Recheck production state at release: any newly introduced media or conflicting policy/schema change requires review rather than silent conversion/removal. Production migrations, bucket changes, commit/push/deployment and disposable uploads require separate release approval after implementation is concrete and locally verified.

## 5. Code changes

None yet. This work added read-only preflight/evidence and this review. No new dependency, route, table, policy, bucket setting or application behavior has been implemented. The proposed identifiers above are design choices, not claims of existing functions/files.

## 6. Testing and verification

Completed: document/source/usage inventory, local read-only catalog, production schema comparison, bucket configuration/counts and exact property Storage policy predicate inspection. No Module 5 acceptance tests have run and no production files were uploaded/downloaded/deleted.

Planned verification:

- Authorization for anonymous/customer/finance/suspended/manager/admin; draft preview and cross-property IDs.
- Real decoder tests: spoofed MIME, truncated files, malicious names, excessive dimensions/frames, pixel bombs, empty/oversized bodies, multipart duplicates and metadata stripping.
- Actual local Storage upload/download/removal with denied direct client upload/list/read/update/delete for property buckets; prove unrelated bucket policies remain effective.
- Concurrent primary selection, quotas, property deletion/withdrawal, suspended actors and stale operation versions.
- Upload/finalization/signing-independent delivery failures, ambiguous responses, cleanup failures and safe retries; prove retained metadata/jobs and no orphaned untracked objects.
- Atomic metadata audit rollback and recovery audit histories; bounded ordering/pagination and exact projections/cache headers.
- Full regression suite, build/TypeScript/lint, prepared release verification and controlled production fixtures followed by independent Storage/metadata/audit reconciliation.

## 7. Completion status

OPEN — review complete; implementation and acceptance pending. Starting status in the plan is an inventory label, not evidence that media security is complete.

## 8. Remaining risks or issues

Approval is required for the deployable size limit, direct sharp dependency, owned file URLs, operation ledger/recovery API, quotas and schema/storage restrictions. Image processing has CPU/memory costs; tests must exercise actual decoding and Vercel build compatibility. Pending work requires an explicit operational retry process. Future large-file support is a separate contract decision, not an unimplemented promise of 10 MiB uploads.

## 9. Next module

Implement and verify approved Module 5 scope, then record closure before Module 6 property viewing management. Do not begin frontend or general Module 17 work here.
