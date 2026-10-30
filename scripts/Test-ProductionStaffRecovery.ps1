# User-run Module 2 production checks. Passwords/links/cookies are never printed or saved.
# Existing administrator signs in privately. New staff aliases are separate accounts.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$config = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'docs/module-2-evidence/production-test-role-config.json') | ConvertFrom-Json
$origin = 'https://bedos-construction-platform.vercel.app'
$adminEmail = 'nathaniel.koranteng.antwics2022@gmail.com'
$role = @($config.roles | Where-Object name -eq 'content_manager')
if ($config.project_ref -ne 'zjdqomckldeipigqqfqm' -or $config.origin -ne $origin -or $role.Count -ne 1 -or $role[0].id -notmatch '^[0-9a-f-]{36}$') {
    throw 'Production test target/role metadata invalid.'
}
$run = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$staffEmail = "nathaniel.koranteng.antwics2022+bedos-staff-$run@gmail.com"
$revokeEmail = "nathaniel.koranteng.antwics2022+bedos-revoke-$run@gmail.com"
$staffName = "Bedos Staff Workflow Test $run"
$adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$staffSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$checks = New-Object System.Collections.Generic.List[object]
$fixtures = New-Object System.Collections.Generic.List[object]
$stage = 'administrator login'
$module2LastHttpStatus = $null
$adminCredential = $null
$staffCredential = $null
$secureAdmin = $null
$secureStaff = $null
$adminLoggedIn = $false
$staffLoggedIn = $false
function Invoke-Module2Api([string]$Path,[string]$Method,[object]$Payload,[object]$Session) {
    $params = @{Uri="$origin$Path";Method=$Method;WebSession=$Session;UseBasicParsing=$true;ErrorAction='Stop';TimeoutSec=30}
    $json = $null
    $bytes = $null
    if ($null -ne $Payload) {
        $json = $Payload | ConvertTo-Json -Depth 6 -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        $params.ContentType = 'application/json; charset=utf-8'
        $params.Body = $bytes
    }
    try {
        $response = Invoke-WebRequest @params
        $script:module2LastHttpStatus = [int]$response.StatusCode
        return [pscustomobject]@{status=[int]$response.StatusCode;data=($response.Content | ConvertFrom-Json)}
    }
    catch {
        $script:module2LastHttpStatus = $null
        if ($_.Exception.Response) { $script:module2LastHttpStatus = [int]$_.Exception.Response.StatusCode }
        return [pscustomobject]@{status=$script:module2LastHttpStatus;data=$null}
    }
    finally {
        if ($bytes) { [Array]::Clear($bytes,0,$bytes.Length) }
        $bytes=$null; $json=$null
    }
}
function Check-Module2([string]$Name,[bool]$Passed) {
    $checks.Add([pscustomobject]@{name=$Name;pass=$Passed})
    if (-not $Passed) { throw 'Module 2 assertion failed.' }
    Write-Output "PASS: $Name"
}
try {
    Write-Output "Sign in as your EXISTING ADMINISTRATOR: $adminEmail"
    Write-Output 'The normal backend logout is performed at the end. Staff test accounts use separate +aliases.'
    $secureAdmin = Read-Host 'Administrator password (hidden; never send it in chat)' -AsSecureString
    $adminCredential = New-Object System.Management.Automation.PSCredential($adminEmail,$secureAdmin)
    $r = Invoke-Module2Api '/api/auth/login' 'POST' @{email=$adminEmail;password=$adminCredential.GetNetworkCredential().Password} $adminSession
    Check-Module2 'Administrator login' ($r.status -eq 200)
    $adminLoggedIn = $true
    $r = Invoke-Module2Api '/api/auth/me' 'GET' $null $adminSession
    Check-Module2 'Expected active administrator session' ($r.status -eq 200 -and $r.data.user.email -eq $adminEmail -and $r.data.role.name -eq 'administrator' -and $r.data.profile.account_status -eq 'active')

    $stage = 'deployed UUID validation'
    $r = Invoke-Module2Api '/api/users/invite' 'POST' @{email=$staffEmail;full_name=$staffName;role_id='invalid-uuid'} $adminSession
    Check-Module2 'Malformed role ID rejected without creating staff' ($r.status -eq 400)
    $stage = 'trusted recovery origin preflight'
    $probe = [Guid]::NewGuid().ToString()
    $r = Invoke-Module2Api "/api/users/$probe/retry-invitation" 'POST' $null $adminSession
    if ($r.status -eq 503) { Write-Output 'Staff recovery origin configuration requires review: BEDOS_APP_ORIGIN must be the trusted production origin.' }
    Check-Module2 'Recovery configuration passes before missing-invitation rejection' ($r.status -eq 409)

    $stage = 'dedicated staff invitation'
    $r = Invoke-Module2Api '/api/users/invite' 'POST' @{email=$staffEmail;full_name=$staffName;role_id=$role[0].id} $adminSession
    $staffId = $r.data.user.id
    if ($staffId) { $fixtures.Add([pscustomobject]@{id=$staffId;email=$staffEmail;full_name=$staffName;purpose='recovery';expected_role='content_manager'}) }
    Check-Module2 'Dedicated staff invitation created for expected role' ($r.status -eq 201 -and $r.data.user.email -eq $staffEmail -and $r.data.profile.role.name -eq 'content_manager')
    Write-Output "Open the INVITATION email addressed to: $staffEmail"
    Write-Output 'Open its link in Chrome. When Set your password appears, DO NOT enter a password yet.'
    $null = Read-Host 'Return here and press Enter only after that page appears'
    $stage = 'onboarding proof and confirmed retry'
    $r = Invoke-Module2Api "/api/users/$staffId/activate" 'POST' $null $adminSession
    Check-Module2 'Activation denied before password setup' ($r.status -eq 409)
    $r = Invoke-Module2Api "/api/users/$staffId/retry-invitation" 'POST' $null $adminSession
    Check-Module2 'Confirmed staff recovery email accepted' ($r.status -eq 202 -and $r.data.recovery_method -eq 'recovery')
    $r = Invoke-Module2Api "/api/users/$staffId/retry-invitation" 'POST' $null $adminSession
    Check-Module2 'Immediate retry blocked by cooldown' ($r.status -eq 429)
    Write-Output "Now open the NEW RESET PASSWORD email for: $staffEmail"
    Write-Output 'Open its link in Chrome, set a NEW STAFF test password privately, and save it in your password manager.'
    $null = Read-Host 'Press Enter here only after Password set successfully appears'
    $stage = 'administrator activation'
    $r = Invoke-Module2Api "/api/users/$staffId/activate" 'POST' $null $adminSession
    Check-Module2 'Administrator activates completed staff onboarding' ($r.status -eq 200 -and $r.data.user_id -eq $staffId)
    $r = Invoke-Module2Api "/api/users/$staffId/activate" 'POST' $null $adminSession
    Check-Module2 'Duplicate activation rejected' ($r.status -eq 409)
    $stage = 'staff login and permission enforcement'
    $secureStaff = Read-Host 'Enter the NEW STAFF test password (NOT your administrator password)' -AsSecureString
    $staffCredential = New-Object System.Management.Automation.PSCredential($staffEmail,$secureStaff)
    $r = Invoke-Module2Api '/api/auth/login' 'POST' @{email=$staffEmail;password=$staffCredential.GetNetworkCredential().Password} $staffSession
    Check-Module2 'Activated staff password login' ($r.status -eq 200 -and $r.data.user.id -eq $staffId)
    $staffLoggedIn = $true
    $r = Invoke-Module2Api '/api/auth/me' 'GET' $null $staffSession
    Check-Module2 'Correct active ordinary staff role' ($r.status -eq 200 -and $r.data.user.id -eq $staffId -and $r.data.role.name -eq 'content_manager' -and $r.data.profile.account_status -eq 'active')
    $r = Invoke-Module2Api '/api/users/invite' 'POST' @{} $staffSession
    Check-Module2 'Ordinary staff denied administrator invitation API' ($r.status -eq 403)

    $stage = 'pending invitation revocation'
    $revokeName = "Bedos Revocation Test $run"
    $r = Invoke-Module2Api '/api/users/invite' 'POST' @{email=$revokeEmail;full_name=$revokeName;role_id=$role[0].id} $adminSession
    $revokeId = $r.data.user.id
    if ($revokeId) { $fixtures.Add([pscustomobject]@{id=$revokeId;email=$revokeEmail;full_name=$revokeName;purpose='revocation';expected_role='content_manager'}) }
    Check-Module2 'Separate pending revocation fixture created' ($r.status -eq 201 -and $r.data.user.email -eq $revokeEmail)
    $r = Invoke-Module2Api "/api/users/$revokeId/revoke-invitation" 'POST' $null $adminSession
    Check-Module2 'Pending invitation revoked by administrator' ($r.status -eq 200)
    $r = Invoke-Module2Api "/api/users/$revokeId/activate" 'POST' $null $adminSession
    Check-Module2 'Revoked invitation cannot activate' ($r.status -eq 409)
    $r = Invoke-Module2Api "/api/users/$revokeId/retry-invitation" 'POST' $null $adminSession
    Check-Module2 'Revoked invitation cannot retry' ($r.status -eq 409)
    Write-Output 'Do not use the invitation email for the revocation fixture; it was deliberately revoked.'
}
catch {
    $checks.Add([pscustomobject]@{name="Stopped at $stage";pass=$false;http_status=$module2LastHttpStatus})
    Write-Output "STOPPED: $stage (HTTP $module2LastHttpStatus). Share only the PASS/STOPPED lines, never passwords or links."
}
finally {
    $sessionCleanup = New-Object System.Collections.Generic.List[object]
    if ($staffLoggedIn) {
        $logout=Invoke-Module2Api '/api/auth/logout' 'POST' $null $staffSession
        $sessionCleanup.Add([pscustomobject]@{session='staff';http_status=$logout.status;pass=($logout.status -eq 200)})
        Write-Output "Staff logout HTTP: $($logout.status)"
    }
    if ($adminLoggedIn) {
        $logout=Invoke-Module2Api '/api/auth/logout' 'POST' $null $adminSession
        $sessionCleanup.Add([pscustomobject]@{session='administrator';http_status=$logout.status;pass=($logout.status -eq 200)})
        Write-Output "Administrator logout HTTP: $($logout.status)"
    }
    $record=[pscustomobject]@{date=[DateTime]::UtcNow.ToString('o');scope='User-run administrator/staff production workflow; no passwords, links or cookies recorded';fixtures=@($fixtures.ToArray());results=@($checks.ToArray());session_cleanup=@($sessionCleanup.ToArray());cleanup='Dedicated fixtures retained for exact-identity database audit and controlled deactivation'}
    $record | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $projectRoot 'docs/module-2-evidence/production-staff-workflow-user-run.json')
    Write-Output 'Sanitized results saved. Dedicated staff fixtures are recorded for audit and controlled cleanup.'
    $adminCredential=$null; $staffCredential=$null; $secureAdmin=$null; $secureStaff=$null
    $adminSession=$null; $staffSession=$null
}
