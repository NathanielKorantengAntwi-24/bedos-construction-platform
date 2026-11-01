# Module 4: property management — review and proposed scope

Date: 1 November 2026. Status: scope approved; implementation and local verification recorded in MODULE_4_IMPLEMENTATION.md. Production acceptance pending. This review preserves the original proposal. Backend only. Modules 5 and 6 are not started by this review.

## 1. Module objective

Implement property CRUD, specifications stored on the property record, filtering, publication, featured properties and lifecycle. The final specification and implementation plan govern; conditional options in the requirements draft do not authorize rental transactions, property payments or new schema fields.

Acceptance: validated and bounded APIs; published-only public visibility; authorized staff previews; correct role boundaries; explicit lifecycle transitions with stale-state protection; atomic mutation/audit; safe deletion; meaningful route, database and integration checks; sanitized production acceptance and cleanup evidence before completion.

## 2. Existing implementation and dependencies

Verified source: anonymous GET /api/properties lists published properties; default page 1, limit 12. GET /api/properties/[id] relies on cookie-client RLS, including staff previews. POST/PATCH/DELETE require properties.manage. Creation forces draft. Updates accept any of the six TypeScript statuses without transition checks. Input validation, error handling, audit and deterministic pagination need improvement. Search interpolates input into PostgREST filter grammar. No dedicated property tests were found in the inspected inventory.

Verified LOCAL catalog: status check permits draft, published, sold, rented, archived, conflicting with the source/final-plan reserved and unavailable statuses. Local data is empty; that proves nothing about production records. Local deletion cascades media/features/amenities metadata, sets enquiry references null, and is restricted by viewing references. Only timestamp triggers were found. RLS permits administrator deletion; administrator/content-manager creation and updates. Preserve this deletion boundary.

Storage removal occurs in child-media service code, which parent deletion does not call. Cascading metadata therefore risks leaving storage objects behind. Enquiry and viewing creation check publication separately from insertion; lifecycle concurrency needs an explicit compatibility review. Production catalog and legacy data remain UNVERIFIED in this Module 4 review; the historical snapshot is not production proof.

## 3. Relevant files

- src/app/api/properties/route.ts and src/app/api/properties/[id]/route.ts.
- src/features/properties/property.service.ts and property.types.ts.
- Related property-image, property-floor-plan, property-feature and property-amenity services; enquiry.service.ts and viewing-request.service.ts are compatibility dependencies.
- Shared permission, user-context, JSON parsing and safe-error helpers are reusable.
- Proposed additions: property validation/tests, staff collection route, lifecycle route, guarded mutation migration and verification scripts. These additions do not exist yet.

## 4. Implementation plan — requires approval

1. Run the read-only production catalog preflight before designing migration SQL. Inventory legacy statuses using aggregates only. If rented records exist, stop for a specific mapping decision; never silently relabel or delete them. Align constraints with the six approved statuses only after checking actual production compatibility.
2. Preserve the current public collection URL, pagination envelope and defaults. Add strict single-valued query validation, literal search, deterministic ordering and price/bedroom/bathroom range filters. Keep property/listing types as validated text until an approved vocabulary exists. No new building-condition, map or transaction fields.
3. Add protected GET /api/properties/manage for staff listing and status filtering. Preserve authorized draft preview on the existing detail route; expose only approved public fields to anonymous readers, excluding created_by. Explicit no-store responses. Finance receives no implicit management rights.
4. Validate object bodies, unknown keys, text, slugs, booleans, finite nonnegative numeric values, UUIDs and pagination bounds. Retain partial record edits. Create draft only. Move status edits to PATCH /api/properties/[id]/status with status, expected_status and a required audit reason; reject status on the ordinary edit endpoint. This is an intentional API contract change requiring approval.
5. Proposed lifecycle: draft -> published or archived; published -> draft, reserved, sold, unavailable or archived; reserved -> published, sold, unavailable or archived; unavailable -> published or archived; sold -> archived; archived -> draft. Direct published -> sold supports sales recorded outside this platform. Reopening archived listings requires draft review. No-op and stale transitions are rejected. This matrix is a recommendation, not an already approved business rule.
6. Use database-checked actor permissions and atomic mutation/audit transactions. Preserve administrator-only hard deletion; content managers can manage records and lifecycle. Block deletion with viewing references or image/floor-plan metadata; archive instead or remove media through its existing cleanup workflow. Preserve existing feature/amenity cascades and enquiry SET NULL behavior, with audit evidence. Recheck dependencies inside the deletion transaction.
7. Review publication-check races with enquiry/viewing creation and document any minimal required integration change for approval before editing those modules. Do not claim atomic eligibility enforcement from separate reads. Do not change their workflows or implement media management here.
8. Use an additive migration followed by deployment and a separate direct-write restriction phase, following Module 3's compatibility approach. No production migration, deployment or Git publication is authorized by this proposal alone.

## 5. Code changes

No application or schema changes. Added this review, a read-only catalog preflight and explicitly LOCAL catalog evidence. No production records were changed.

## 6. Testing and verification

Local catalog inspection completed. Module 4 acceptance tests have not run because implementation has not started. Planned checks cover input errors, public/private visibility, all role boundaries, each allowed/denied lifecycle edge, stale/concurrent mutations, audit rollback, duplicate slugs, filters/counts, dependency-protected deletion and regression compatibility. Use isolated fixtures first; production fixtures require controlled creation, exact cleanup and sanitized evidence. Prior Module 3 results are not Module 4 acceptance evidence.

## 7. Completion status

OPEN — review complete enough to request scope approval; production preflight and implementation pending. No completion claim.

## 8. Remaining risks or issues

Production status/constraint drift, legacy rented data, media storage cleanup and publication concurrency remain release gates. New/existing property classification is mentioned in the draft but lacks a verified schema field; defer that filter pending a separate approved representation.

## 9. Next module

Finish and verify Module 4 before Module 5 property media. No frontend work.
