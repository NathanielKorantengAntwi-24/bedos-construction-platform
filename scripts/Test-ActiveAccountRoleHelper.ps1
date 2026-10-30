param([switch]$BeforeFix, [switch]$ProfileUpdate)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$labConfig = Join-Path $projectRoot '../bedos-supabase-lab/supabase/config.toml'
if ((Get-Content -Raw -LiteralPath $labConfig) -notmatch '(?m)^project_id = "bedos-supabase-lab"\s*$') {
    throw 'Isolated lab identity check failed.'
}
$container = 'supabase_db_bedos-supabase-lab'
$migrationPath = Join-Path $projectRoot 'supabase/migrations/20261029000000_restrict_role_lookup_to_active_accounts.sql'
$testPath = Join-Path $projectRoot 'supabase/tests/active_account_role_helper.sql'
$functionSignature = 'public.get_user_role()'
if ($ProfileUpdate) {
    $migrationPath = Join-Path $projectRoot 'supabase/migrations/20261030000000_restrict_legacy_profile_update_to_active_accounts.sql'
    $testPath = Join-Path $projectRoot 'supabase/tests/active_profile_update.sql'
    $functionSignature = 'public.update_own_profile(text,text)'
}
$migrationBody = ''
if (-not $BeforeFix) {
    $migrationBody = Get-Content -Raw -LiteralPath $migrationPath
    $migrationBody = $migrationBody -replace '(?m)^BEGIN;\s*$', '' -replace '(?m)^COMMIT;\s*$', ''
}
$sql = @"
BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE tested_function_before ON COMMIT DROP AS
SELECT oid AS function_oid, proowner AS owner_oid, proacl AS function_acl
FROM pg_proc WHERE oid = '$functionSignature'::regprocedure;
$migrationBody
$(Get-Content -Raw -LiteralPath $testPath)
ROLLBACK;
"@
Write-Output "Target: local Docker container $container; all changes rolled back."
$sql | & docker exec -i $container psql -U postgres -d postgres -X -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Database regression test failed; transaction rolled back when the connection closed.' }
