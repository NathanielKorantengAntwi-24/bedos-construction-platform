# Module 6 — property viewing review and implementation proposal

2 November 2026 historical review proposal: the user approved this local implementation scope. Current implemented contracts, evidence and completion checklist are recorded in [MODULE_6_IMPLEMENTATION.md](MODULE_6_IMPLEMENTATION.md). Module 6 remains OPEN pending separate production release and acceptance; Modules 1–5 remain closed. Backend only.

## 1. Module objective

The approved implementation plan, page 5, defines Property Viewing Management as requests, scheduling, assignments, editing rules, status transitions and cancellations. The final technical specification sections 7–10, 14 and 17–18 require linked customer/property records, sales/administrator authorization, audit, customer/staff notifications and the viewing lifecycle **New → Contacted → Scheduled → Completed**, with Cancelled available. The supplementary requirements describe Book a Viewing; their conditional items do not supersede the approved viewing scope.

Proposed acceptance criteria:

- [ ] Active customers create their own requests only for currently published properties; the existing publication-race guard remains intact.
- [ ] Customers can list/read only their own requests; administrators and authorized sales staff can list/read/manage requests across properties.
- [ ] UUIDs, actual calendar dates, clock ranges, bounded strings, JSON object shape, allowed fields and strict pagination/filter queries are validated.
- [ ] Draft/read-only/unavailable property states cannot authorize a new request. Existing requests remain accessible and manageable after property withdrawal.
- [ ] One canonical scheduled lifecycle is enforced atomically, including cancellation and immutable terminal requests.
- [ ] Staff confirm scheduling only with a date, time and active eligible assignee; customer preferences remain editable only while new.
- [ ] Customer cancellation is available only for the customer's own new request; staff can cancel nonterminal requests.
- [ ] Concurrent stale edits/transitions/assignments/deletions return conflict and produce no extra mutation, audit or notification event.
- [ ] Assignees are active administrators or sales/customer-service staff with the relevant permission, verified in the committing transaction.
- [ ] Every successful create/edit/assignment/transition/delete has an atomic before/after audit; direct client writes cannot bypass the backend rules.
- [ ] Viewing notification intent is durable and deduplicated; a notification materialization/delivery failure cannot undo an already committed viewing request.
- [ ] Customer confirmation, eligible staff new-request notice, assignment and relevant status/schedule updates use the existing central in-app notification records.
- [ ] Lists are bounded, deterministic and exactly counted; all viewing responses are private/no-store with fixed approved fields and safe errors.
- [ ] Regression, real local authorization/concurrency/failure tests, staged release checks and separately approved production acceptance/cleanup pass before closure.

## 2. Existing implementation and dependencies

Verified source: both viewing route files, the service/types, shared context/permission/role/JSON/error helpers, the central notification service/types, property publication/reference guard and the existing reference-race test. Repository-wide searches found no route using listCustomerViewingRequests; it is an unused exported service function. There is no overall staff/customer viewing list route.

Current flow: verified user context → role/permission checks in route → cookie-scoped Supabase reads/writes; customer PATCH switches to the privileged client after ownership/new-status checks. The customer update already includes customer/property/new-status conditions; this protects against staff processing beginning before that write. Staff updates, however, check the old status separately and then update only by request ID, allowing concurrent lifecycle changes to overwrite one another.

The existing assignee profile lookup is separate from the mutation and can become stale. UUIDs/JSON types/unknown fields are not consistently checked. Date/time regexes validate appearance without calendar/range validation; messages have a length check without strict runtime typing. Lists are unbounded, errors can expose provider text, mutations have no viewing audit, and notification failures are caught and logged without durable retry. Scheduling is inferred from in_progress plus optional preferred date/time; a request can enter that state without either preference or an assignee.

The final specification says Scheduled; TypeScript, service transitions and database constraint say in_progress. Resolve in favor of the final specification, with an explicitly approved compatibility release rather than silently retaining or renaming statuses.

Read-only production evidence: module-6-evidence/production-preflight.json. Tables, columns, constraints, referencing constraints, indexes, policies, grants and column ACL count match the isolated lab. Both tables have RLS. Production additionally has the enabled Module 4 viewing_property_publication_guard with matching helper source/path. Both administrator and sales_customer_service have viewings.view and viewings.manage. The lab lacks these role-permission mappings and the Module 4 guard; test fixtures must install their reviewed equivalents locally, not assume they exist.

Production aggregate counts: **zero viewings, viewing notifications and viewing audits**. Latest migration: 20261101090000. No customer messages, account IDs or request contents were read for this review.

viewing_requests has UUID/property/customer fields, nullable date/time/message/assignee, status and timestamps. Time is **without time zone**. FK deletion is restricted for customer/property; assignment references profiles; no table references viewing_requests. Existing indexes cover individual property/customer/status columns. There is no concurrency version or notification-event queue.

Direct authenticated staff UPDATE policies permit arbitrary row fields when the role matches, bypassing API editing/transition/assignment rules. The INSERT policy checks ownership/publication but does not require customer role or active account. Table grants also include broad mutation privileges. Notification policies/grants are a shared Module 18 dependency; this proposal does not rewrite their global access rules or order-confirmation uniqueness.

## 3. Relevant files

Existing files to change only after approval:

- src/app/api/properties/[id]/viewing-requests/route.ts — bounded staff property list and strict customer submission.
- src/app/api/properties/[id]/viewing-requests/[viewingRequestId]/route.ts — ownership/permissions, validated edits/cancellation, stale checks and administrator deletion.
- src/features/properties/viewing-request.service.ts and viewing-request.types.ts — guarded transactional operations, canonical scheduled status and versioned contracts.
- src/features/notifications/notification.service.ts — narrow central-service entry for materializing a recorded viewing event; existing generic notification/order behavior retained.
- src/features/properties/property-reference.test.ts — preserve the viewing publication-race contract alongside unchanged enquiry cases.

Proposed new files (not existing implementations): viewing-request.validation.ts and focused route/service/notification tests; src/app/api/viewing-requests/route.ts for scoped lists; administrator viewing notification-event list/retry handlers; staged migrations, isolated SQL/integration/release/production verification tooling and module evidence/implementation/closure documents. Final filenames/function signatures will be recorded in the approved implementation map. No frontend, property lifecycle, enquiry workflow or unrelated notification behavior is in scope.

## 4. Implementation plan and proposed contracts

### Lifecycle and editing

Use new → contacted → scheduled → completed; new/contacted/scheduled → cancelled. Completed and cancelled are terminal: no reopening or ordinary edits. Administrators retain the existing explicit deletion ability, with audit. Same-status-only/no-op requests are rejected.

Creation remains customer-only, with caller identity taken from verified authentication. Optional preferred_date, preferred_time and message remain; the server controls property/customer/status/assignment/version. Preferred date accepts a real YYYY-MM-DD calendar date, time accepts valid HH:MM or HH:MM:SS and output stays the database's local clock format, message trims to null or at most 2000 characters. Keep date/time as existing civil values: **no invented UTC conversion, timezone, past-date rule, reminders, slot capacity or collision policy**. These would need a business timezone/scheduling decision beyond this correction.

New customer requests can be edited by their owner until staff processing begins. Permit owner cancellation from new only, using status=cancelled as the sole business change. Staff with viewings.manage can edit nonterminal requests, assign/unassign active eligible staff, progress statuses and cancel. Require date/time and an active eligible assignee when entering scheduled or changing a scheduled request's date/time/assignee; a scheduled request cannot be left without them. Existing requests remain manageable after withdrawal; no automatic cancellation is added. Completing/cancelling an already scheduled request does not require its old assignee still to be active.

Add an integer version (initial 1) to viewing_requests. Every accepted update increments it atomically. PATCH requires expected_version; DELETE requires expected_version in its strictly validated query. Return 409 on stale versions; customer edits also recheck ownership/new status while locked. This is an explicit additive response and required mutation-contract change, not a silent API alteration. Version guards protect all mutable fields without relying on timestamp formatting precision.

### Reads and HTTP boundaries

Preserve existing property-scoped and item URLs and their data response key. Add GET /api/viewing-requests: customer scope is forcibly own records; authorized staff may read the operational list. Existing property collection GET remains staff-only. Staff reads use viewings.view plus the fixed administrator/sales role boundary; writes require viewings.manage. Foreign/mismatched item identities return 404 without revealing another customer's record.

Lists default page=1/limit=25, maximum 100; strict positive integer page, duplicate/unknown query rejection and exact totals on empty pages. Stable order created_at/id descending. Support property/status filters and staff-only customer/assignee filters; customer callers cannot select another identity. Include pagination beside data. Read/mutation fields remain the current fixed projection plus version; no customer email, profile internals, permission lists or provider diagnostics.

Keep backend and committing database checks: verified actor, active account, role/permissions, immutable property/customer, property publication for new references, ownership, assignee and locked lifecycle/version validation. Serialize lock order consistently with Module 2 account updates and Module 4 publication/reference locks. Reuse existing audit conventions. Restrict direct viewing table writes only after compatible deployment; retain existing read RLS and unrelated grants.

### Viewing-scoped durable notification events

Add a private viewing notification-event queue recorded in the same transaction as each relevant viewing mutation/audit. It stores immutable event/recipient/request binding and deduplication identity, pending/processing/recorded/suppressed state plus lease/retry proof; clients cannot choose recipients, message types, payloads or queue state. Preserve provenance after viewing deletion. Do not store passwords, session credentials or external-provider secrets.

After business commit, the central notification service invokes a guarded viewing-event materialization operation: insert into the existing notifications table and mark the event recorded atomically. A viewing-only unique event/recipient key prevents duplicate records after retries/lost responses; the existing order confirmation index and other module behavior remain intact. Failure leaves retryable intent and does not roll back the business record. A bounded administrator event list/retry API accepts only recorded event IDs, respects leases and rechecks eligibility; suppressed obsolete/deleted/ineligible targets remain auditable. No generic notification engine, provider delivery, scheduler or WhatsApp/email integration is added (Modules 18–19 remain separate).

Event recipients: customer confirmation on submission; active authorized administrator/sales staff new-request notice; assigned eligible staff assignment notice; appropriate customer status/schedule/reschedule confirmation and assigned-staff operational update. Capture event provenance transactionally and recheck recipient/request eligibility before materialization. Do not send stale assignment/schedule confirmations after cancellation, deletion or superseding changes. In-app notifications are real staff communications; any later production fixture release must explicitly approve their audience and exact test-only cleanup.

### Staged database release

Prepare an additive first phase for version, guarded RPCs/private event table, viewing-specific deduplication and indexes. Temporarily allow both old in_progress and canonical scheduled values at the database boundary so the existing deployment remains compatible during cutover; new guarded APIs emit scheduled only. Deploy compatible code, then restrict direct viewing writes and remove the old status from the constraint. **Fresh preflight and drained old requests are mandatory; if any legacy in_progress records appear, stop for explicit provenance/conversion review.** Do not silently update business records. The currently verified production count is zero, not a guarantee for the future release date.

## 5. Code changes

None yet. This document proposes the significant schema/API and notification-boundary changes for approval. Only read-only review SQL and sanitized catalog/evidence/documentation files have been created locally.

## 6. Testing and verification

Review evidence: both supplied DOCX documents extracted as text and the plan's complete relevant pages read; both route files, full viewing service/types, shared helpers and notification dependency inspected; repository usages searched; local catalog query executed successfully; production comparison matched all eight structural sections, permission mappings and the Module 4 publication guard. No layout fidelity claim is made for document text extraction.

No new Module 6 application tests have run because implementation has not started. Module 5 closed with 586 existing regression tests across 45 files; that is historical baseline evidence, not a Module 6 pass count.

After approval, test date/time/type/body limits; every lifecycle pair; own/foreign/suspended/anonymous/role/permission access; direct-client write denial; stale and simultaneous edits/assignment/account changes; publication withdrawal races; existing-request access after withdrawal; audit rollback; empty-page totals; event fanout/deduplication/lost responses/retry leases/recipient changes; notification failure preserving the committed request; and unchanged property/enquiry/order-notification behavior. Use real isolated Next/Auth/PostgREST and database concurrency tests, not mocks alone. Run production build/type/lint and staged migration/source/ACL/rollback checks. Provide a private production helper only with separate release and fixture/audience approval; independently reconcile exact records, notifications, queue state and audit chains before closure.

## 7. Completion status

- [x] Requirements/source/dependency inspection.
- [x] Local catalog and read-only production comparison.
- [x] Conflict/risk identification and concrete proposed contracts.
- [ ] Approval of lifecycle correction, versioned/scoped APIs, viewing-scoped event queue and staged write restrictions.
- [ ] Local implementation and verification.
- [ ] Separate production/Git release and fixture/audience approval.
- [ ] Production acceptance, independent cleanup/reconciliation and closure.

## 8. Remaining risks or issues

The current production policies permit bypasses of active-role and editing rules; the schema conflict is verified. No new vulnerability was exercised with production writes. Civil date/time does not define a timezone or guarantee appointment-slot availability; retain that existing representation explicitly. Recovery remains operator-driven, not automatically scheduled. General notification authorization/provider delivery, request-engine unification and external reminders are not silently moved into Module 6.

## 9. Next module

Implement and verify only approved Module 6 scope, then complete its separate production release/acceptance. Module 7 construction project management starts only after Module 6 closure. Frontend remains deferred.
