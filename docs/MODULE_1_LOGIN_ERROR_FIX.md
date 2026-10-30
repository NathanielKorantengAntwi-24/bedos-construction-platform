# Module 1 login input error correction

Date: 29 October 2026

## Objective and scope

Malformed JSON submitted to POST /api/auth/login must return HTTP 400 before authentication is attempted. Unexpected errors must remain HTTP 500 with a safe public message and internal logging. Normal login and account restrictions retain their existing behavior.

## Implementation

The login route now uses the existing shared errorResponse helper in its outer catch, preserving the ApiError status raised by parseJson. Added regression coverage for malformed JSON and private unexpected authentication errors. No database, dependency or architecture changes.

## Verification

The malformed JSON regression failed before the correction (actual 500, expected 400). After correction: 31 Vitest files passed, 172 tests passed; production build including TypeScript passed; focused ESLint and git diff --check passed.

## Status and remaining work

Local correction verified. Deployment and production retest are pending at commit creation. This report closes only this defect locally, not Module 1. Password recovery, account restrictions, customer isolation and database security evidence still require completion verification. Module 2 staff workflows remain separate.

## Production release verification

Commit baacbc5 was pushed to origin/master on 29 October 2026 with user approval. At 17:05 UTC the production backend check suite passed all 12 checks. Malformed JSON at POST /api/auth/login returned HTTP 400 with Invalid JSON request body. Anonymous access restrictions and invalid-input responses also passed. Evidence is saved locally in PRODUCTION_MODULES_1_2_BACKEND_CHECKS.json.

GitHub's deployment status API timed out, so the Vercel dashboard status was not independently retrieved. The changed behavior is verified directly on the production URL. No database changes were made. Remaining Module 1 verification is unchanged.
