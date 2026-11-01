# Module 3: Services and Service Categories

1 November 2026. Status: user approved the proposed scope; local implementation and verification passed. Authoritative implementation, compatibility decisions and pending release checklist: MODULE_3_IMPLEMENTATION.md. Modules 1 and 2 are closed. Production remains unchanged. Earlier proposal/pending statements below are retained as the reviewed starting scope.

## Module objective

Implementation plan page 5 specifies service creation, retrieval, editing, deletion, categories, publication and availability. The final specification requires public service content, content-manager access to services, backend authorization/validation and auditing of important actions. Complete the existing backend rather than rebuild it. Frontend development remains deferred.

## Existing implementation and dependencies

Verified source:

- Four route files expose list/create/detail/update/delete for services and categories. Reads require services.view; writes require services.manage.
- Two feature services perform cookie-client reads and service-client direct mutations. Service creation derives created_by from the authenticated context. Category mutations and service update/delete do not receive an audit actor.
- Fields: services has category_id, name, slug, description, status, featured, created_by and timestamps; categories has name, slug, description and timestamps. Existing service statuses are draft/published/archived. There is no separate availability field.
- Enquiry creation looks up service_id through its privileged client. This module must preserve the reference contract; changing enquiry eligibility is separate coordinated work requiring review.
- Existing shared parseJson converts malformed JSON to 400. ApiError/errorResponse and requirePermission/getUserContext can be reused. Module 2 established database actor rechecks, atomic audit and safe-error patterns.
- No dedicated service/category test files were found in the inspected source or script inventory. The repository regression baseline is 313 tests/37 files, freshly passed during Module 2 closeout.

Actual isolated local database metadata (MODULE_3_LOCAL_CATALOG.json): both tables are postgres-owned with RLS enabled. Service slug and category name/slug are unique; status has a three-value check. Deleting a category sets services.category_id to NULL; deleting a service sets enquiries.service_id to NULL. The only non-internal triggers are timestamp updates, so no service/category audit trigger was found locally. Authenticated administrator/content-manager policies permit direct table writes. Customer policies permit published service reads and category reads. No anonymous public-read policy was found locally. Broad table grants exist. Local service permission mappings are absent, so the lab requires explicit temporary RBAC fixtures for meaningful tests.

The untracked schema snapshot agrees with these findings but is historical reference, not current production evidence. Current production policies, grants, constraints and triggers still require the read-only catalog preflight before release. Production service records were not queried. Chrome was being used on another page during this review; no dashboard input was attempted.

## Relevant files

Existing implementation:

- src/app/api/services/route.ts and src/app/api/services/[id]/route.ts.
- src/app/api/service-categories/route.ts and src/app/api/service-categories/[id]/route.ts.
- src/features/services/service.service.ts, service-category.service.ts and their type files.
- src/server/http/parse-json.ts, api-error.ts; src/server/auth/require-permission.ts and get-user-context.ts (dependencies; no broad refactor proposed).
- src/features/enquiries/enquiry.service.ts (compatibility dependency; no change proposed).

Proposed additions: feature-local validators and focused route/service tests; separate public route handlers; one new service/category mutation migration and guarded SQL/Auth/RLS integration tests. Proposed identifiers are design choices, not claims that those files or RPCs already exist.

## Verified gaps

1. Wrong JSON shapes/types can throw through optional trim calls and become 500 responses. IDs, featured and category_id lack comprehensive runtime validation. Empty update objects are accepted into the database call.
2. Multiple feature-service errors expose database messages. Detail lookups also convert arbitrary database failures into 404, obscuring availability errors.
3. Public browsing required by the specification has no anonymous backend endpoint in these routes. Existing reads are protected and must not be silently changed into public reads.
4. Lists are unbounded. Existing response projections include created_by, which should not become part of a new public projection.
5. Direct privileged mutations have no explicit atomic audit operation in source; the local database has no compensating audit trigger. Direct authenticated table writes could bypass a new backend-only audit path unless grants/policies are restricted together.
6. Delete handlers perform a separate lookup and delete, with a race between those operations. Foreign-key detachment affects related records and must be preserved and verified rather than replaced by an invented restriction.

## Implementation plan proposed for approval

1. Keep existing staff route paths, permission names, singular response fields and success messages. Add strict JSON-object/allowed-key/type/UUID/status validation, trimmed nonblank names/slugs, nullable description/category handling, nonempty PATCH and safe error mapping. Proposed bounds: name/slug 200 characters, description 10,000. Retain current case-sensitive uniqueness; do not silently rewrite existing slugs.
2. Add separate GET /api/public/services and GET /api/public/services/[slug]. Public service fields: id, category_id, name, slug, description, featured; always filter status=published in the trusted backend. Draft/archived records return 404 on public detail. No author/account fields, unpublished counts or privileged errors. Add GET /api/public/service-categories exposing id/name/slug/description only for categories referenced by published services.
3. Add strict bounded list queries: page default 1, page_size default 25/max 100; optional category_id, featured and literal text search; staff service list may also filter status. Return existing services/categories arrays with additive pagination metadata. Reject invalid/unknown/repeated query keys. Use deterministic ordering and exact filtered count. Changing default staff list bounds is an explicit proposed contract change requiring approval.
4. Treat published as publicly available and draft/archived as unavailable for public browsing. This is a proposed interpretation of the plan's availability requirement, not a claim that a separate bookable/disabled state already exists. Do not add an availability column or additional lifecycle without a separately approved requirement.
5. Move service/category mutations into guarded service-only SECURITY DEFINER RPCs, using the same architectural pattern as Module 2: recheck active services.manage actor, serialize target changes, validate database inputs and insert audit atomically. Preserve timestamp behavior, defaults, uniqueness and current SET NULL foreign-key behavior. Record before/after changes and related detachment effects without exposing sensitive actor data in responses. Audit failure must roll back the business mutation.
6. Restrict direct client/service table mutation privileges that would bypass those RPCs, while preserving required reads and owner-managed writes. Inspect all inherited/column grants and actual policies before defining the exact migration. Do not widen anonymous database access: public routes use fixed trusted-backend queries/projections. No Auth, user-role, payment or enquiry workflow changes.
7. Verify locally first; present exact migration and production release evidence for separate approval. Use disposable fixtures and retain existing production records. No production service mutation tests without an approved fixture/cleanup scope.

## Testing and verification acceptance

- Staff/category CRUD, all three publication states, featured/category filters, bounded stable pagination, uniqueness, missing records and foreign-key detachments.
- Public list/detail expose only published records and approved fields; guessed unpublished slugs and draft-only categories remain hidden.
- Malformed JSON, null/array/scalar bodies, wrong field types, unknown fields, oversized input, invalid UUID/status/query and empty updates return safe 400 responses before privileged writes.
- Anonymous/customer/ordinary unprivileged/inactive callers cannot manage content; active authorized staff can. Existing session permission changes take effect, preserving Module 1/2 behavior.
- Real SQL/Auth/RLS tests prove direct-write restrictions, database actor rechecks, concurrent target operations and audit rollback. Seed explicit temporary roles/mappings in the lab rather than treating its empty RBAC catalogue as production truth.
- Safe 409 conflicts, 404 missing records and sanitized unexpected 500 errors; no raw database details in HTTP responses.
- Full regressions, TypeScript, production build and focused lint pass; current production metadata matches reviewed migration dependencies before release.

## Completion status

Source/dependency/requirements inspection and local read-only catalog capture completed. These are analysis results, not functional test passes. No implementation yet. Approval is needed for the explicit public API, pagination/availability interpretation and audited mutation/grant contracts above.

## Remaining risks or issues

Production catalog parity is not yet verified; local permission seeds are incomplete. The final specification does not define independent service availability semantics or exact public endpoints. Existing published data may exceed proposed input bounds; inspect metadata/aggregate lengths before enforcing bounds on edits to legacy records. The enquiry reference check can currently accept non-public services through its privileged lookup; this is a cross-module compatibility finding to review in the enquiry module, not silently change here.

## Next module

Remain on Module 3 until agreed acceptance and production verification are recorded. Module 4 is deferred.

## Approved implementation refinements

The final implementation preserves customer services.view visibility according to existing RLS (published services only), verified from the saved production permission catalogue and new SQL/real-session regressions. Deployment is split into two migrations: install guarded operations first, deploy the app, then restrict direct writes, avoiding interruption to the old deployed writers. These preserve the approved scope; see MODULE_3_IMPLEMENTATION.md for actual files, results and release conditions.
