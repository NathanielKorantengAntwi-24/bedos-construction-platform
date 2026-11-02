# Module 7 — Construction Project Management

Status: implementation contract APPROVED by the user; local implementation tracked in `MODULE_7_IMPLEMENTATION.md`. Module remains OPEN pending release/production acceptance. Backend only. 2 November 2026.

## Module objective

Deliver the construction portfolio, categories, stages, progress, images and project statuses required by implementation-plan page 5. The final technical specification also requires location, services and a before/during/after gallery. Content managers and administrators manage construction content. Interior portfolios remain Module 8.

## Existing implementation and dependencies

Verified repository inspection: `src/features/projects` exists but contains no files; no construction project API directory exists. Local database inspection found `projects`, `project_stages` and `project_images`, each with zero rows. This is local evidence, not production evidence.

Projects currently hold title, unique slug, description, free-text project_type, location, client_name, dates, status, featured and creator/timestamps. Historical snapshot constraints allow draft/ongoing/completed/archived. Stages hold name, description, order, pending/in_progress/completed status and dates. Images hold a storage path, alt text, order and primary marker. The local column inspection matches these snapshot fields. Local policy inspection returned no public policies for these three tables; grants, RLS flags and production security remain to be checked.

No category relation, linked services, explicit progress representation or image phase field was found in these local table columns. These are requirements gaps; the proposed additions below require approval.

### Verified production comparison

The intended production project `zjdqomckldeipigqqfqm` was inspected through its authenticated SQL Editor with `scripts/MODULE_7_READONLY_REVIEW.sql`, in an explicit READ ONLY transaction. Eleven result sections were observed and saved in `module-7-evidence/production-readonly-review.json`. No application rows, credentials or file contents were retrieved. Counts: projects 0, stages 0, images 0, project-bucket objects 0.

Eight sections match local exactly: columns, constraints, RLS flags, policies, grants, indexes, triggers and counts. Three differ: permission mappings, buckets and Storage policies. Local fixtures must reproduce the production differences deliberately; the local lab is not a production replica.

Production has RLS enabled on all three tables, no table policies, and broad table privileges for anon/authenticated/service_role. RLS does not govern TRUNCATE; the future release must restrict grants as well as enforce row access. There is no existing project-specific version, operation ledger, category or service relationship. Existing image/stage foreign keys cascade on project deletion, which does not delete Storage objects.

Production `projects.manage` maps to administrator/content_manager; `projects.view` also maps to customer. Do not use that permission alone for management reads. Preserve the mapping and require an active administrator/content_manager role plus the corresponding permission for staff routes and database operations. Public routes expose the public projection independently.

The `project-images` bucket is private with no size/MIME cap. Its existing authenticated SELECT policy checks only the bucket; upload/update/delete policies check administrator/content_manager via get_user_role. Add a project-specific restrictive backend-only Storage guard and bucket caps in the separately approved release; preserve existing policy definitions and all other buckets. No production objects currently require adoption.

Reviewed dependencies: `src/server/auth/require-permission.ts` checks current active account and permission; `get-user-context.ts` supplies verified identity; `src/features/services/catalog.service.ts` wraps backend RPCs and maps foreign-key conflicts to HTTP 409; `catalog.http.ts` applies no-store responses. Migration `20261101040000_secure_service_catalog.sql` defines the locked active-actor permission helper, transactional catalog audit helper and service deletion. `src/features/properties/media.validation.ts` and `media.service.ts` demonstrate bounded decoding, owned file URLs and recoverable file operations. Reuse the shared auth/HTTP/audit helpers where compatible; retain project-specific validation and orchestration. Property-specific buckets and operation records must not be repurposed for projects.

## Relevant files

- Existing: `src/features/projects/` (empty), `supabase/remote_schema_snapshot.sql` (historical reference only), existing shared auth/HTTP/catalog and property-media implementations.
- Proposed, not created: project validation/service/routes/tests under `src/features/projects`; project management/public API handlers; scoped migration(s); release and acceptance scripts.

## Approved implementation contract

The following are engineering recommendations, not requirements explicitly specified by the documents. Approval covers local implementation and verification only; Git publication, deployment, hosted migrations/configuration and disposable production acceptance require a separate release decision.

### Data and lifecycle

- Retain the existing project status vocabulary: draft, ongoing, completed, archived. Only ongoing/completed are public. Draft creation never publishes content. Explicit versioned transitions: draft→ongoing/archived; ongoing→completed/archived; completed→ongoing/archived; archived→draft. Reopening clears project completion_date and is audited. Archive is the withdrawal mechanism; this scope does not add a separate publication field.
- Add integer `version` to projects, initially 1. Every successful project, stage, service-link or image mutation locks its parent and advances the version. Mutations require expected_version; stale requests return 409. Protected fields/status/version cannot be changed by an ordinary metadata edit. Return the new project version with child mutation results.
- Proposed new `project_categories`: id, name, unique slug, description, created_at, updated_at, version. Add nullable projects.category_id with restrictive deletion. Categories in use return 409 on deletion; reassignment is explicit and audited. Keep existing project_type as optional free-text metadata; it does not silently become a category.
- Proposed new `project_services`: project_id/service_id composite key and creation timestamp, with restrictive service deletion and project cascade. Project updates replace an explicitly supplied bounded unique service_ids list atomically. Link only currently published services, locking reference rows; hide a service from public projection if it is later unpublished, retain the internal link. Service deletion returns the existing safe 409 until links are explicitly removed; regression-test this Module 3 integration.
- Retain stage status pending/in_progress/completed. New stages start pending. Explicit transitions pending→in_progress→completed, completed→in_progress and in_progress→pending; reject no-op transitions. Require a start date on in_progress and a completion date on completed; start≤completion. Reset obsolete dates on reopening/reset. A completed project cannot have stages added, changed or removed until explicitly reopened. Completion requires at least one stage and all stages completed, plus project completion_date. Allow multiple in-progress stages; do not invent sequential dependencies.
- Derive progress as completed stage count / total stage count ×100, rounded to an integer; return null when there are no stages. Stage counts and progress come from the same database snapshot. No caller-supplied percentage or speculative weights. Unique nonnegative stage_order per project, atomic reorder using expected_version.
- Validate dates as real calendar dates; reject project completion before start. Bound title/name/slug to 200 characters, descriptions to 10,000, location/client_name to 500, project_type to 200, stages to 100/project, linked services to 50/project and images to 100/project. These proposed limits are server and database enforced.

### Images and recovery

- Add required image `phase` before/during/after. Metadata exposes id, project_id, phase, alt_text, order, primary, creation time and owned image_url; never storage paths. Exactly one primary when ready images exist; replacement/removal chooses the next ordered image atomically. Cross-project child access returns 404. Phase is a gallery label, independent of the project's current status.
- Retain private project-images bucket. Allow actual decoded JPEG/PNG/WebP, cap incoming and normalized output at 3 MiB, 20 megapixels/10,000 dimensions and one frame; strip metadata and generate server-owned object paths. Reject spoofed types, SVG, malformed/repeated multipart fields and caller-selected paths. No new image package required: sharp already exists.
- Proposed private `project_media_operations` ledger records immutable actor/project/image/request/object hash/type/size provenance, state, version and bounded leases before Storage writes. Require UUID Idempotency-Key; replay returns the original operation, mismatched reuse returns 409. Uncertain commits remain recoverable, not falsely successful; incomplete images stay hidden. Administrator-only recovery list/retry supports controlled cleanup. No new scheduler or generic media module.
- Backend file delivery rechecks project visibility/active staff preview and ready operation proof, verifies bytes/type/hash/size, then rechecks visibility before response. Use no-store and nosniff. Withdrawing a project blocks its existing public file URL on the next request. Do not issue durable public or signed provider URLs.
- Block parent deletion while image metadata or nonterminal file operations remain. Once clean, project deletion may cascade stages/service links while retaining their snapshots in the root audit; no cross-module cascade. Retain terminal operation history with detached parent references.

### Proposed API surface

All paths below are new proposals, not existing endpoints. Consistent JSON envelopes and safe errors follow the existing catalog conventions.

| Routes | Contract |
| --- | --- |
| `/api/projects`, `/api/projects/[id]` | Active authorized staff list/create/detail/edit/delete; view permission for reads, manage for writes |
| `/api/projects/[id]/status` | PATCH explicit status transition and expected_version |
| `/api/project-categories`, `/api/project-categories/[id]` | Staff category CRUD with category version checks |
| `/api/projects/[id]/stages`, `/api/projects/[id]/stages/[stageId]`, `/api/projects/[id]/stages/reorder` | Staff stage CRUD/status/reorder; parent expected_version |
| `/api/projects/[id]/images`, `/api/projects/[id]/images/[imageId]` | Staff upload/edit/delete; parent expected_version and upload idempotency |
| `/api/projects/[id]/images/[imageId]/file` | Guarded public/staff file delivery |
| `/api/project-media/operations`, `/api/project-media/operations/[operationId]/retry` | Active administrator recovery only |
| `/api/public/projects`, `/api/public/projects/[slug]`, `/api/public/project-categories` | Public portfolio/detail and categories represented by public projects |

Public project fields: id, title, slug, description, project_type, location, category, dates, status, featured, progress and stage counts; detail also includes ordered public stage descriptions/status/dates, linked published service summaries and ready gallery metadata. Keep client_name, created_by, audit/operation data and storage paths staff-only. Public filters: q, category_id, service_id, status (ongoing/completed), featured, page, page_size. Staff filters additionally accept all project statuses. Stable featured/created_at/id ordering; defaults page 1/page_size 25, maximum 100. Empty pages retain exact filtered count; unknown/repeated query parameters fail 400. Apply no-store to success/error responses.

Database authorization and mutation/audit occur transactionally through narrow backend-only functions with fixed search paths, input allow-lists and safe errors. Revoke direct project-table writes and unnecessary TRUNCATE/REFERENCES/TRIGGER grants, including service_role writes; backend RPCs own mutations. Keep RLS enabled and deny direct reads unless explicitly justified by the approved contract. Never trust actor IDs, paths or role selections from request bodies. Preserve unrelated table/Storage policies and permissions. Stage audit, project progress/version and image primary changes must commit together; failed/stale changes produce no business audit.

### Implementation sequence and files

1. Create scoped, guarded migration(s) under `supabase/migrations` plus rollback-only SQL assertions and release refusal guards. Preflight refuses unexpected nonempty/untracked project state or schema drift. Use production metadata as reference, not assumptions from the local lab.
2. Add `project.validation.ts`, `project.service.ts`, `project.routes.ts`, project/category/stage/media types and focused tests under `src/features/projects`; keep project-specific upload/recovery service separate there. Add thin API handlers under the proposed paths. Only extract reusable image decoding if necessary and retain Module 5 behavior/regressions.
3. Verify real local Next/Auth/PostgREST/Storage workflows, direct-API denials, concurrency and uncertain file operations; restore exact local lab configuration afterward.
4. Record changed files, API contracts, dependencies, decisions and tests in a Module 7 implementation document. Run build, TypeScript, relevant lint and existing regression suite.
5. Present a concrete staged release package for separate approval, then production acceptance with clearly labelled disposable projects/files and independent exact cleanup/audit reconciliation. No frontend or Module 8 implementation.

### Acceptance checklist

- [ ] Bounded lists/combined filters/stable ordering/exact empty-page counts; strict IDs, dates, fields and query validation.
- [ ] Draft/archived records and files hidden; ongoing/completed visible with exact safe public fields and immediate withdrawal.
- [ ] Active administrator/content manager allowed; customer, ordinary staff, anonymous and suspended accounts denied management, including stale sessions and direct provider calls.
- [ ] Lifecycle, stage dates/reopening, derived progress, parent versions/reordering and concurrent stale writes behave consistently with one atomic audit chain.
- [ ] Categories in use and linked service deletion return safe conflicts; explicit detach/reassignment audited; unpublished linked services hidden without corrupting portfolio links.
- [ ] Valid image upload/edit/primary/order/phase/file delivery; spoofing, oversize, cross-parent mutation and client storage bypass denied.
- [ ] Idempotent replay, ambiguous upload/commit/delete and expired lease recovery proven; pending files hidden; parent deletion blocked until clean.
- [ ] Existing Modules 1–6 regression checks, production build and TypeScript pass; local state restored.
- [ ] Separately authorized production acceptance and independent exact fixture/object cleanup plus retained audit/operation evidence pass before completion.

## Code changes

The user approved the proposed contract after this review. Actual changes and verification are recorded separately in `MODULE_7_IMPLEMENTATION.md`; the review evidence above remains the pre-implementation baseline.

## Testing and verification

Read-only repository/document inspection and local/production PostgreSQL metadata/count queries completed. All eleven production sections were recorded and compared; eight match local and three known environment differences are recorded above. No Module 7 application tests exist or have passed at this stage. No production migration, upload or fixture write has been performed for Module 7. The SQL Editor contains a new metadata-only review snippet; this does not change application data/schema.

## Completion status

OPEN. Contract approved and local implementation undertaken; see `MODULE_7_IMPLEMENTATION.md` for current verification/release status. Modules 1–6 remain closed under their recorded acceptance evidence.

## Remaining risks or issues

Fresh pre-release comparison remains necessary because production can change after this review. Proposed lifecycle/progress rules, category/service relationships and media recovery require approval. Service deletion gains a deliberate restrictive reference; test and document its HTTP 409 behavior. Local permissions/buckets/Storage policies differ from production. Audit identity retention remains the known shared Module 22 issue; do not silently alter shared audit schema in Module 7.

## Next module

Module 8 remains deferred until Module 7 satisfies approved acceptance criteria and its completion is recorded.
