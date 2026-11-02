# Module 6 completion report

2 November 2026. **COMPLETE for the agreed backend scope.** This report supersedes earlier open/pending Module 6 entries. Modules 1–6 are closed. Module 7 has not started; frontend remains deferred.

## 1. Module objective

Deliver the approved property viewing workflow: customer requests and own access, staff operational lists, scheduling, assignments, editing/cancellation rules, canonical Scheduled lifecycle, versioned mutations, atomic audit and recoverable in-app notification events. The final technical specification and implementation plan govern; the supplementary requirements do not independently expand scope.

## 2. Existing implementation and dependencies

Existing property viewing URLs now use strict shared handlers and service-only guarded functions. Customers receive their own records; authorized administrators/sales staff receive the operational scope. Active-account and view/manage permissions are rechecked in the database, including assignee eligibility under sorted profile locks. The existing Module 4 publication-reference guard and protected property deletion remain intact. Existing viewings stay usable after property withdrawal.

The central notification service materializes immutable viewing-specific events after the business transaction commits. Notification insertion and event completion are atomic and deduplicated. Failures retain pending intent without undoing the viewing; administrator retries respect cooldown/locks and suppress obsolete/deleted/ineligible notices. General notification delivery/providers remain Modules 18–19.

## 3. Relevant files

Full source/dependency map and API contracts: MODULE_6_IMPLEMENTATION.md. Main files: viewing-request.routes.ts, viewing-request.validation.ts, viewing-request.service.ts/types, thin existing property viewing handlers, new root viewing/event handlers, the narrow central notification export and focused tests. No new package dependency or stack change.

Release/verification tooling includes Prepare-Module6Release.mjs, Test-Module6ViewingsSql.mjs, Test-Module6ViewingsIntegration.mjs, Test-Module6ReleaseSql.mjs, Verify-Module6LocalCleanup.mjs, Test-ProductionViewingAnonymous.mjs, Test-ProductionViewingManagement.ps1 and Verify-ProductionViewingFixtures.mjs. The last script prepares additional private read-only queue SQL under ignored .next/module6-release; raw identities/audit images are not published.

## 4. Implementation plan and release

The user approved the concrete local scope and separately authorized Git publication, both production migrations/deployment and the six-fixture workflow, including in-app notices to eligible administrator/sales staff. Fresh production review matched all eight structural sections, permission bindings, the property guard and zero viewing aggregates.

Migration 20261102010000 installed additive version/functions/queue/indexes before application 672d0d7 deployed successfully to Production. Ten anonymous/compatibility checks passed before migration 20261102020000 restricted direct viewing writes, installed the active-read guard and canonical status constraint. Ten checks passed again. Production SQL passed 139 assertions and rolled back its synthetic transaction. Final 19 metadata results matched, including nine function definitions/owners/paths/ACLs, zero direct table/column writes and queue privileges, original policy/notification grant/index preservation and unchanged publication helper/guards. Commit 53bfbcc records release evidence.

## 5. Code changes

- New → Contacted → Scheduled → Completed, cancellation from nonterminal states and immutable terminal records; no silent legacy conversion.
- Strict IDs, calendar/clock/type/body limits, bounded filtered pagination, fixed fields and no-store safe responses.
- Required expected_version for updates/deletes; actor, ownership, assignment and transition checks commit atomically with business/audit/event writes.
- Complete date/time and active eligible assignee required to schedule/reschedule; customers edit/cancel only their own new requests.
- A private event queue, bounded post-commit materialization, generated notification identities, viewing-only deduplication and guarded administrator recovery.
- Restrictive direct-read eligibility preserves existing policy definitions while blocking suspended/unauthorized sessions; direct mutation grants are removed after deployment.

## 6. Testing and verification

| Evidence | Verified result |
| --- | --- |
| Application regressions | 672 tests across 49 files passed |
| Final local SQL | 140 assertions passed, including all 25 lifecycle pairs and audit/notification failure cases |
| Real local Next/Auth/PostgREST | 98 checks passed, including concurrent staff edits, concurrent restrictions, direct access boundaries and stale-notice suppression |
| Actual Windows PowerShell 5 helper locally | All 50 checks passed; six fixtures and their notifications removed |
| Exact release wrappers and restoration | 139 production-safe assertions, three refusal guards and 19 independent restoration checks passed |
| Build/type/lint | Production build, TypeScript and focused lint passed |
| Production release SQL/API | 139 assertions passed and rolled back; ten anonymous checks passed before and after restrictions; 19 metadata results matched |
| Production administrator acceptance | All 50 saved checks passed, including exact fixture/notification cleanup and administrator logout HTTP 200 |
| Independent production reconciliation | All 122 checks passed: 107 API checks plus 15 private database checks |

Independent reconciliation verified both property IDs/shared nonce, both viewing IDs/customer/property references, both customer Auth identities/profiles and all generated notification IDs/related references absent. All six fixture journal states are deleted and the journal is complete/ignored. The original administrator remains active with administrator role.

Retained records: six property audits, ten viewing audits and sixteen event audits, plus sixteen terminal recorded queue events. Viewing versions, preference-only edits, assignment, publication/withdrawal compatibility, canonical schedule/reschedule/completion, owner cancellation and deletion continue exact before/after chains. Invalid/stale/foreign requests produced no extra successful mutation audits. Each business audit's event count matches the queue; immutable creator/request/version/status/assignment/date/time bindings, recipient eligibility, generated notification proof and retry history reconcile exactly. No pending fixture work remains.

The database's **existing audit actor foreign key uses ON DELETE SET NULL**. Removing the two disposable customer profiles therefore cleared nine customer-linked audit actor headers. These are expected FK effects, not missing audit rows. Customer IDs remain in viewing before/after images; immutable queue created_by and recipient/request/version bindings remain and were verified independently. Original administrator actor references remain intact. This report does not claim all actor_id columns survived customer deletion.

Sanitized evidence is under module-6-evidence/production-viewing-admin.json, production-viewing-independent-api.json, production-viewing-independent-sql.json, production-viewing-completion.json and production-release-verification.json. Reconciliation used read-only record/Auth/notification requests, the list-only queue RPC and a read-only SQL transaction. It made no persistent production changes.

## 7. Completion status

All agreed acceptance criteria are satisfied. **Module 6 is COMPLETE.** The six acceptance fixtures and their in-app notifications are removed; sixteen terminal event records and thirty-two audit rows are intentionally retained. No further administrator test is required for this scope.

## 8. Remaining risks or issues

Recovery is operator-driven; there is no automatic event-processing scheduler. More than ten events in one mutation can leave pending fanout for administrator processing. Civil date/time defines no timezone, appointment capacity or collision policy. Creation has no idempotency key: inspect the scoped list after an uncertain response before resubmitting. External notification providers and general notification access rules remain separate modules.

Existing profile deletion clears audit actor_id references as described above. General durable/immutable audit-identity retention belongs to Module 22 review; it was not silently changed in Module 6. Queue provenance and viewing identity snapshots provide the verified reconciliation links for this workflow. Trusted database owners can administer underlying records. Old direct-writing/in_progress clients are incompatible after phase two; use compatible deployments or forward fixes.

## 9. Next module

Module 7 — construction project management. Inspect the approved requirements, existing project portfolio/category/stage/progress/media implementation and relevant dependencies, then define acceptance and propose significant changes before implementation. No Module 7 work has started. Continue backend only.
