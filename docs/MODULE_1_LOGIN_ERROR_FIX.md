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
