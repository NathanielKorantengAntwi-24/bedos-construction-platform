# Module 6 — property viewing implementation

2 November 2026. **Implemented and verified locally; Module 6 remains OPEN pending separate production release, acceptance and reconciliation.** Modules 1–5 remain complete. Module 7 and frontend work have not started.

## 1. Module objective

The final specification and implementation plan govern. The user approved MODULE_6_REVIEW_AND_PROPOSAL.md: customer-linked property requests, scheduling, assignments, editing/cancellation rules, canonical Scheduled lifecycle, versioned/scoped APIs, guarded mutations and viewing-scoped durable notification events. The user separately approved Git publication, both hosted migrations, deployment and the documented six-fixture/in-app-notification acceptance workflow on 2 November 2026.

Local acceptance is verified: active customer submission and own access; staff permission boundaries; complete scheduled preferences/eligible assignee; version conflict handling; all 25 lifecycle pairs; terminal immutability; owner-new and staff-nonterminal cancellation; property withdrawal compatibility; atomic audit; direct write and suspended direct-read denial; durable notification failure/retry/deduplication/suppression; exact pagination and safe fields/errors.

## 2. Existing implementation and dependencies

| Component | Responsibility and verified dependency |
| --- | --- |
| Existing two property viewing handler files | Thin exports of shared authenticated route handlers; original URLs/data keys preserved |
| viewing-request.routes.ts | Auth before bodies, fixed role boundaries, view/manage permissions, strict route/query/input validation, private no-store responses |
| viewing-request.validation.ts | Civil calendar/time validation, nullable preferences, 2000-character trimmed message, IDs, expected_version and bounded streamed JSON |
| viewing-request.service.ts | Bounded service-only RPC transport, safe errors and bounded post-commit event processing |
| Central notification.service.ts | Added viewing-only deliverViewingNotificationEvent; existing order/enquiry/generic notification functions unchanged |
| Four service-only RPCs | bedos_read_viewings, bedos_mutate_viewing, bedos_viewing_events and bedos_deliver_viewing_event |
| Five private helpers | Actor checks, fixed projection, validation, version trigger and queue insertion; no client/service execute grants |
| viewing_notification_events | Private immutable request/version/actor/recipient/event binding, generated notification ID, event state, attempt/lease/version and safe failure code |
| Module 2 | Active account/role management and administrator user-detail API; account/assignment rechecks use sorted profile locks |
| Module 3 | Existing bedos_catalog_audit reused for atomic before/after audit |
| Module 4 | Existing publication/reference guard and protected parent deletion preserved; existing viewings remain usable after withdrawal |
| Modules 18–19 | General notification security/provider delivery, WhatsApp/email and scheduling workers remain deferred |

Production read-only review matched all eight structural sections against the lab and confirmed administrator/sales view/manage permissions, the enabled matching property reference guard and zero viewing/request-notification/viewing-audit records. This is review-time evidence; release must refresh it. The lab initially lacked some production helper/permission bindings, so integration installs reviewed dependency migrations temporarily and restores their original definitions/permissions.

## 3. Relevant files

Changed existing source: src/app/api/properties/[id]/viewing-requests/route.ts and [viewingRequestId]/route.ts; src/features/properties/viewing-request.service.ts and viewing-request.types.ts; property-reference.test.ts; src/features/notifications/notification.service.ts (one narrow added export).

New source: src/features/properties/viewing-request.routes.ts, viewing-request.validation.ts and focused validation/service tests; src/features/notifications/notification.viewing.test.ts; src/app/api/viewing-requests/route.ts, viewing.routes.test.ts, notification-events/route.ts and notification-events/[eventId]/retry/route.ts.

New migrations: 20261102010000_secure_property_viewings.sql and 20261102020000_restrict_property_viewing_writes.sql. No new package dependency or stack change.

Tooling: Test-Module6ViewingsSql.mjs and scripts/sql/Test-Module6Viewings.sql; Test-Module6ViewingsIntegration.mjs; Prepare-Module6Release.mjs; Test-Module6ReleaseSql.mjs; Verify-Module6LocalCleanup.mjs; Test-ProductionViewingAnonymous.mjs; Test-ProductionViewingManagement.ps1. Read-only catalog/comparison SQL and sanitized evidence are under docs/MODULE_6_* and docs/module-6-evidence. Private production fixture identities are Git-ignored.

## 4. Implementation plan and final contracts

| Endpoint | Contract |
| --- | --- |
| GET /api/viewing-requests | Forced own scope for customers; viewings.view plus administrator/sales boundary for staff; data and pagination |
| GET properties/[id]/viewing-requests | Staff property list with viewings.view; fixed parent scope |
| POST properties/[id]/viewing-requests | Active customer only; server-owned customer/property/status/assignment/version; optional preference fields |
| GET properties/[id]/viewing-requests/[viewingRequestId] | Own customer or authorized staff; foreign/cross-parent identities return 404 |
| PATCH same item URL | Required integer expected_version plus nonempty allowed changes; customers own/new only, staff manage permission; conflict 409 |
| DELETE same item URL | Administrator/manage only; exactly expected_version query, stale conflict, atomic deletion audit |
| GET /api/viewing-requests/notification-events | Administrator/manage only, bounded history with pending/processing first; no recipient or lease-token projection |
| POST notification-events/[eventId]/retry | Administrator/manage only; server-recorded ID, empty body or {}; no payload/recipient selection; 200 terminal, 202 pending, 409 busy/cooldown |

Version starts at 1 and a database trigger increments every accepted update. Return the existing fixed record fields plus version; no raw profile details. Valid date is YYYY-MM-DD, year 0001–9999; time is HH:MM or HH:MM:SS in valid clock ranges, normalized to seconds. Existing date/time-without-timezone storage is retained. No timezone, future-date, slot capacity, reminders or calendar integration is invented. Message trims to null or at most 2000 Unicode characters. JSON is streamed and capped at 16 KiB (retry 1024 bytes). Unknown/duplicate query parameters, malformed types/UUIDs and empty/no-op updates are rejected.

Lists default page=1/limit=25, maximum 100, with created_at/id descending and exact count even on empty pages. Root lists accept property/status and staff-only customer/assignee UUID filters; property lists cannot override their parent. All handled success/error responses are no-store.

Canonical transitions: new → contacted → scheduled → completed; cancellation from new/contacted/scheduled. Completed/cancelled requests cannot be edited/reopened. Customers can edit their own new preferences/message or cancel with status=cancelled as the only business change. Staff can edit nonterminal requests and assign/unassign eligible staff. Entering scheduled or changing a scheduled date/time/assignment requires both preferences and an active administrator/sales assignee with viewings.manage. Completion/cancellation does not require the old assignee still to be active. Existing viewings remain manageable after property withdrawal; only new submissions/new references require publication.

## 5. Code changes, transaction and recovery behavior

Writes recheck actor/permissions under sorted shared profile locks (actor/old/new assignee), then lock the property and request in consistent order. Version/ownership/transition/assignment checks, the business mutation, audit and event insertion commit together. Customer edits retain the existing new-status protection. No caller-supplied isStaff value is trusted. Invalid/stale/unauthorized requests produce no extra business audit/event. The existing property/enquiry reference helper is unchanged.

Events are generated per immutable request version/type/recipient. Customer confirmation, active authorized staff new-request notice, assignment, customer status and relevant assigned-staff/schedule/reschedule updates use fixed server messages. At most ten immediate events are processed concurrently after business commit with bounded transport; additional/failing events remain durable and the successful business response can include notifications_pending=true. No automatic business POST replay is attempted.

Materialization is one guarded database transaction: profile eligibility and current request/schedule/assignment are rechecked, the event row is locked NOWAIT, notification insertion and recorded state/audit commit together. Generated notification IDs and a viewing-only unique event/recipient index prevent duplicate materialization. Repeated terminal requests return the recorded/suppressed state. Temporary processing has a five-minute lease; a caught insertion failure returns pending with a 30-second cooldown and safe SQLSTATE. A lost client response cannot independently commit notification insertion without the event state. Pending notices for deleted/ineligible recipients or obsolete assignment/status/schedule are suppressed; delayed new-request notices are also suppressed after completion/cancellation. Historical recorded notifications are not retroactively rewritten. No external provider is called.

Phase one guards the reviewed empty viewing baseline, adds version/guarded functions/private queue/deduplication/indexes and temporarily admits old in_progress for deployment compatibility. Phase two refuses untracked cutover records or any legacy in_progress state, restricts direct viewing mutations and installs the canonical status constraint. No silent conversion or deletion of existing business records occurs.

Direct-read testing identified that the existing own-viewing RLS policy did not check account activity. Phase two adds bedos_viewing_active_read as a restrictive SELECT policy enforcing the approved active customer/ownership or authorized staff rules. All original viewing/notification policy definitions remain unchanged. Notification grants/original indexes and the property reference helper/guards are preserved; there is no general notification-permission rewrite.

## 6. Testing and verification

| Evidence | Verified result |
| --- | --- |
| Full application regressions | 672 tests across 49 files passed |
| Focused new/updated tests | 89 checks passed across validation, service, routes, property-reference mapping and central viewing-event integration |
| Final local SQL | 140 assertions passed, including all 25 lifecycle pairs, role/ACL boundaries, audit rollback and final delayed-confirmation suppression |
| Real local Next/Auth/PostgREST | 98 integration checks passed, including simultaneous edits, concurrent suspension, direct read/write rules, withdrawal, failures, stale schedule suppression and replay |
| Actual Windows PowerShell 5 helper locally | All 50 checks passed; six exact fixtures removed, test notifications removed, terminal event proof retained and logout 200 |
| Exact staged release wrappers | 139 production-safe rollback assertions plus three refusal guards passed; nine function source/owner/path/ACL checks and 19 metadata results match |
| Independent local restoration | All 19 checks passed; original catalog/policies/grants/indexes/permissions/aggregates restored, dependency functions/queue/version/test identities/failure triggers absent and port released |
| Production build/TypeScript and focused lint | Passed |

The final extra late customer-confirmation branch is covered by the final SQL suite and regenerated exact source/ACL release verification. Early test-harness issues (session logout scope, provider flag casing, missing local user-read dependency and OneDrive generated-cache EPERM) were corrected; none involved production writes. The final saved integration result passes. Only the verified generated .next/dev cache was removed for the OneDrive issue; source/private journals were preserved.

The production rollback script excludes the one local permission-revocation probe, so it does not delete an existing production role-permission mapping. Its synthetic SQL fixtures and notification records are uncommitted and rolled back; there is no email/external delivery. Three local release refusal tests cover pre-existing baseline records, untracked cutover writes and legacy lifecycle values. The credential-free production smoke script is prepared and syntax-checked, not run for Module 6.

Reproduce shared lab operations sequentially:

```powershell
npx vitest run
node scripts/Test-Module6ViewingsSql.mjs
node scripts/Test-Module6ViewingsIntegration.mjs
node scripts/Test-Module6ReleaseSql.mjs
node scripts/Verify-Module6LocalCleanup.mjs
npm run build
npx eslint src/features/properties/viewing-request* src/features/properties/property-reference.test.ts src/features/notifications/notification.service.ts src/features/notifications/notification.viewing.test.ts src/app/api/viewing-requests "src/app/api/properties/[id]/viewing-requests"
```

## 7. Completion status

- [x] Requirements/source/local and read-only production review; implementation scope approved.
- [x] Local implementation, acceptance tests and cross-module compatibility verification.
- [x] Build/type/lint, exact release wrapper/refusal checks and independent lab restoration.
- [x] Private acceptance script executed against local-only credentials/configuration and sanitized evidence saved.
- [x] Separate commit/push, production migrations/deployment and fixture/notification-audience approval.
- [ ] Fresh production preflight, staged release and post-release verification.
- [ ] Private administrator production acceptance.
- [ ] Independent exact fixture/notification removal, terminal queue/audit reconciliation and final closure.

Fresh production preflight matches the reviewed baseline. Phase one 20261102010000 committed; all 19 metadata checks match the staged state. Git publication/deployment and phase two are next; no Module 6 production test fixture or notification has been created.

## 8. Remaining risks or issues and release procedure

Pending event processing is operator-driven: there is no scheduler. More than ten events in one mutation can leave pending fanout even without a provider failure; inspect the administrator queue and retry eligible work. Civil date/time has no business timezone or appointment-slot collision semantics. Viewing creation itself has no idempotency key; inspect the scoped list after an uncertain response rather than blindly submitting another POST. Existing historical in-app records are retained on ordinary business deletion; test-only notifications are explicitly removed by the acceptance helper. Trusted database owners can bypass application controls.

After separate release approval, keep all viewing writers idle/drain old requests during cutover. Refresh production metadata/role bindings/helper definitions and the empty viewing baseline; stop on drift or pre-existing records for explicit review. Prepare .next/module6-release with Prepare-Module6Release.mjs. Phase one expects history 20261101090000; install and verify the nine functions/private queue/version/indexes. Commit/push only reviewed Module 6 paths and deploy. Verify compatible production code/anonymous behavior before phase two (expected predecessor 20261102010000). If deployment fails, leave phase two unapplied. After restrictions, old direct writers and in_progress mutation clients are incompatible; use a compatible release or forward fix.

Verify all 19 metadata results, unchanged policies/notification grants/indexes/publication helper, both history rows, zero synthetic rollback fixtures and all 139 rollback assertions. Run ten credential-free smoke checks before and after phase two. Then the user runs Test-ProductionViewingManagement.ps1 privately.

That workflow creates **two disposable confirmed customer accounts, two clearly labelled temporary properties and two viewing requests**. It briefly publishes one property, assigns the administrator, schedules/reschedules/completes one viewing and lets the second customer cancel a new request. **Real in-app test notices reach currently active authorized administrator/sales staff and the two disposable customers**; no emails, WhatsApp, uploads or real customer records are used. Backend service configuration is used only for guarded fixture setup/exact notification and Auth cleanup; it is never printed. The script removes exact test viewing/property/customer/notification records, retains audit/event history and records an ignored identity journal. Ambiguous creation/mutation/cleanup outcomes block blind reruns. Independent read-only reconciliation must verify exact absence, terminal event provenance, notification cleanup, correct audit chains and original administrator integrity before closure.

## 9. Next module

Finish Module 6's separate production release/acceptance/reconciliation and record closure before Module 7 construction project management. Frontend remains deferred.
