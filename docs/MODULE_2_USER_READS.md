# Module 2 administrator list/detail implementation

30 October 2026. Status: locally implemented and verified under the approved administration contracts. Not committed, pushed, migrated or deployed. Module 2 remains open.

## Module objective

Provide authorized, bounded account listing and account detail through GET /api/users and GET /api/users/[id]. This step has no account-status or role mutation endpoints.

## Existing implementation and dependencies

Reuse requirePermission(users.view), the Supabase admin client and shared ApiError/errorResponse. Both route authorization and the new service-only database function check active actor permissions. Account emails come from auth.users, with selected profile/role fields only. Existing invitation lifecycle interfaces are unchanged.

Production read-only metadata inspection confirmed the required 37 column definitions and 25 existing indexes. This includes selected Auth user fields and the profile, role, permission and invitation tables; indexes support identity joins and invitation uniqueness. Evidence contains schema definitions only, with no user records. No new index is proposed without measured need. Substring search and exact filtered counts can scan matching data; response pagination limits transfer, not overall database work. Test representative production-scale performance before treating this as a high-volume search interface.

## Relevant files and code changes

- src/app/api/users/route.ts: users.view guard, strict list query parsing and private/no-store responses, including errors.
- src/app/api/users/[id]/route.ts: authorization before target validation, UUID validation, absent-user 404 and safe detail response; unsupported query keys rejected.
- src/features/users/user.types.ts: explicit list/filter, account/role and detail types.
- src/features/users/user.service.ts: bound RPC parameters; rejects unknown/repeated query keys, malformed or excessive pagination, invalid built-in roles/statuses, long/NUL search input; sanitizes DB failure messages.
- supabase/migrations/20261030010000_add_admin_user_reads.sql: new bedos_read_users RPC. SECURITY DEFINER with empty search_path, minimal EXECUTE grant to service_role only, active actor/permission recheck and actor profile share lock. Fixed column projection; exact count and page share one filtered statement snapshot. created_at/id descending order; literal LIKE metacharacters escaped. Detail invitation projection exposes only status and timestamps.
- src/app/api/users/user-reads.routes.test.ts: 30 focused authorization, input, parameter binding, response/cache and safe-error assertions.
- scripts/Test-Module2UserReads.mjs and scripts/sql/Test-Module2UserReads.sql: guarded local-only migration and actual SQL regression; migration and fixtures inside a rollback-only transaction. Includes direct anon/authenticated invocation denial with a forged administrator actor argument, service execution, active-account checks, pagination/search/projection/summary validation.
- docs/module-2-evidence/local-user-reads.json and user-read-schema-preflight.json/.sql: local results and schema-only preflight evidence.

## Testing and verification

- Full application suite: 222 tests across 32 files passed, including all existing Module 1 and staff lifecycle regressions.
- New route/validation coverage: 30 tests passed, included in the full count above.
- Actual local database: 29 assertions passed, including the assertion-count check. Migration and synthetic fixtures rolled back.
- Independent post-test DB query: zero users in the dedicated test domain and zero installed public.bedos_read_users functions.
- Production build including TypeScript passed; Next reports both routes as dynamic.
- Focused ESLint for all five new TypeScript files passed with zero warnings.
- No existing production interface behavior, account, Auth setting, schema, permission or dependency changed.

Commands from project root:

```powershell
.\node_modules\.bin\vitest.cmd run
node scripts/Test-Module2UserReads.mjs
npm run build
.\node_modules\.bin\eslint.cmd src/features/users/user.types.ts src/features/users/user.service.ts src/app/api/users/route.ts 'src/app/api/users/[id]/route.ts' src/app/api/users/user-reads.routes.test.ts --max-warnings 0
```

## Completion status

- [x] Approved local list/detail scope implemented.
- [x] Validation, safe fields and authorization tested at route/SQL layers.
- [x] Relevant compatibility tests, build, TypeScript and focused lint passed.
- [x] Local fixture/migration rollback independently verified.
- [ ] Separate release approval for exact-file commit/push, production migration and deployment.
- [ ] Production route verification with an authorized administrator session, ordinary-user denial and safe response checks. Keep detailed identity evidence local; publish sanitized counts/status only.

This is local acceptance, not production acceptance or overall Module 2 completion. The application requires the new migration before these endpoints can work in production. Release the DB function first, then deploy application routes; old application code does not call the additive function. If deployment fails, the old application continues to operate with the unused service-only function. Review the remote pending-migration list before applying this exact migration; do not apply unrelated pending changes.

## Remaining risks or issues

No full deployed administrator end-to-end test is claimed for these new routes. Query scale limits noted above remain unmeasured. Existing audit grants and partial invitation setup recovery remain Module 2 gaps. New list/detail reads do not change audit retention or add read-event logging; mutations require atomic audit in their later step.

## Next module

Continue Module 2 after the release/verification checkpoint. Status transitions and ordinary staff role changes remain separate implementation steps under the reviewed design. Module 3 stays deferred.
