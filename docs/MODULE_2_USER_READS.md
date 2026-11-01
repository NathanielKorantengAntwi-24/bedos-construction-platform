# Module 2 administrator list/detail implementation

1 November 2026. Status: list/detail step COMPLETE for agreed scope. Approved patch 932e3a5 deployed; production database, anonymous/customer denial and private administrator-success checks passed. Overall Module 2 remains open.

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
- [x] Separate release approval for exact-file commit/push, production migration and deployment.
- [x] Production route verification with an authorized administrator session, ordinary-user denial and safe response checks. Keep detailed identity evidence local; publish sanitized counts/status only.

Local and production acceptance of this list/detail step are complete; overall Module 2 remains open. The dry run contained only 20261030010000_add_admin_user_reads.sql. Applied once before pushing application commit 932e3a5; Vercel reported deployment success. No unrelated migration was applied.

## Production release evidence

- All 29 actual DB assertions passed against the new production function inside a rollback-only synthetic-fixture transaction. Independent check confirmed zero remaining fixture users, one installed function and one recorded migration version.
- Production function body matches committed source after whitespace normalization. SECURITY DEFINER, empty search_path, service_role EXECUTE and no anon/authenticated EXECUTE independently verified.
- Thirteen deployed anonymous/customer checks passed, including fixture setup and cleanup assertions. Anonymous list/detail returned 401; active customer list/detail returned 403 even for their own ID; permission denial preceded query validation. Temporary confirmed customer setup is not signup-confirmation evidence. Exact disposable Auth identity and profile deletion verified. No administrator credentials or account records were saved.
- Sanitized evidence: module-2-evidence/production-user-read-release.json and production-user-read-denials.json. Reproduction: verify-user-read-release.sql and scripts/Test-ProductionUserReadDenials.mjs.
- Administrator verification completed 1 November 2026 at 01:38:33 UTC: 16 workflow checks passed plus successful HTTP-200 administrator logout (17 saved assertions). Defaults/counts, safe fields, no-store caching, combined filters, empty next page, administrator detail, missing user and invalid query/UUID behavior passed. Saved report inspected for all passing results and restricted field names; no emails, IDs, account records or credentials retained. Evidence: production-user-reads-admin.json. No account changes.

## Remaining risks or issues

The deployed administrator script covers the listed success/validation cases; it is not a load test. Query scale limits noted above remain unmeasured. Existing audit grants and partial invitation setup recovery remain Module 2 gaps. New list/detail reads do not change audit retention or add read-event logging; mutations require atomic audit in their later step.

## Next module

Continue Module 2 after the release/verification checkpoint. Status transitions and ordinary staff role changes remain separate implementation steps under the reviewed design. Module 3 stays deferred.
