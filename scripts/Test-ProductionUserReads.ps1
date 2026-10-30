# Administrator enters credentials privately; report contains no user records/identifiers.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$origin = 'https://bedos-construction-platform.vercel.app'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$checks = New-Object System.Collections.Generic.List[object]
$loggedIn = $false
$stage = 'administrator login'
$lastStatus = $null
$credential = $null
$securePassword = $null
function Read-Api([string]$Path,[string]$Method='GET',[object]$Payload=$null) {
    $bytes = $null
    $json = $null
    try {
        $params = @{Uri="$origin$Path";Method=$Method;WebSession=$session;UseBasicParsing=$true;TimeoutSec=30;ErrorAction='Stop'}
        if ($null -ne $Payload) {
            $json = $Payload | ConvertTo-Json -Compress
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            $params.ContentType='application/json; charset=utf-8'; $params.Body=$bytes
        }
        $r = Invoke-WebRequest @params
        $script:lastStatus = [int]$r.StatusCode
        return [pscustomobject]@{status=$script:lastStatus;data=($r.Content | ConvertFrom-Json);cache=$r.Headers['Cache-Control']}
    } catch {
        $script:lastStatus=$null
        if ($_.Exception.Response) { $script:lastStatus=[int]$_.Exception.Response.StatusCode }
        return [pscustomobject]@{status=$script:lastStatus;data=$null;cache=$null}
    } finally {
        if ($bytes) { [Array]::Clear($bytes,0,$bytes.Length) }
        $bytes=$null; $json=$null
    }
}
function Assert-Read([string]$Name,[bool]$Pass) {
    $checks.Add([pscustomobject]@{name=$Name;pass=$Pass})
    if (-not $Pass) { throw 'User-read verification failed' }
    Write-Output "PASS: $Name"
}
try {
    $email=(Read-Host 'Existing administrator email (not a test alias)').Trim().ToLowerInvariant()
    $securePassword=Read-Host 'Administrator password (hidden; never send in chat)' -AsSecureString
    $credential=New-Object System.Management.Automation.PSCredential($email,$securePassword)
    $r=Read-Api '/api/auth/login' 'POST' @{email=$email;password=$credential.GetNetworkCredential().Password}
    Assert-Read 'Administrator login' ($r.status -eq 200 -and $r.data.user.email -eq $email)
    $loggedIn=$true
    $id=$r.data.user.id
    $r=Read-Api '/api/auth/me'
    Assert-Read 'Active administrator session' ($r.status -eq 200 -and $r.data.user.id -eq $id -and $r.data.role.name -eq 'administrator' -and $r.data.profile.account_status -eq 'active')
    $stage='default list'
    $r=Read-Api '/api/users'
    Assert-Read 'Bounded default list and count' ($r.status -eq 200 -and $r.data.page -eq 1 -and $r.data.limit -eq 25 -and @($r.data.users).Count -le 25 -and $r.data.total -ge 1)
    Assert-Read 'List response not cacheable' ($r.cache -match 'no-store')
    $expected='account_status,created_at,email,full_name,id,phone,role,updated_at'
    $safe=$true
    foreach($u in $r.data.users){if((($u.PSObject.Properties.Name | Sort-Object)-join ',') -ne $expected){$safe=$false}}
    Assert-Read 'List exposes only approved user fields' $safe
    $stage='filtered administrator list'
    $encoded=[Uri]::EscapeDataString($email)
    $r=Read-Api "/api/users?role=administrator&account_status=active&q=$encoded&limit=1"
    Assert-Read 'Combined role status email filters' ($r.status -eq 200 -and $r.data.total -eq 1 -and @($r.data.users).Count -eq 1 -and $r.data.users[0].id -eq $id)
    $r=Read-Api "/api/users?role=administrator&account_status=active&q=$encoded&limit=1&page=2"
    Assert-Read 'Empty next page retains filtered count' ($r.status -eq 200 -and $r.data.total -eq 1 -and @($r.data.users).Count -eq 0)
    $stage='administrator detail'
    $r=Read-Api "/api/users/$id"
    Assert-Read 'Administrator detail identity and role' ($r.status -eq 200 -and $r.data.user.id -eq $id -and $r.data.user.email -eq $email -and $r.data.user.role.name -eq 'administrator')
    Assert-Read 'Detail exposes only approved fields' ((($r.data.user.PSObject.Properties.Name | Sort-Object)-join ',') -eq 'account_status,created_at,email,full_name,id,invitation,phone,role,updated_at')
    Assert-Read 'Detail response not cacheable' ($r.cache -match 'no-store')
    $stage='input and missing-user checks'
    $r=Read-Api ("/api/users/"+[Guid]::NewGuid().ToString())
    Assert-Read 'Missing user returns 404' ($r.status -eq 404)
    foreach($case in @(@('/api/users?limit=101','Excessive page size rejected'),@('/api/users?role=owner','Invalid role rejected'),@('/api/users?sort=email','Unknown query key rejected'),@('/api/users?limit=1&limit=2','Repeated query key rejected'),@('/api/users/invalid','Invalid user UUID rejected'))){
        $r=Read-Api $case[0]
        Assert-Read $case[1] ($r.status -eq 400)
    }
} catch {
    $checks.Add([pscustomobject]@{name="Stopped at $stage";pass=$false;http_status=$lastStatus})
    Write-Output "STOPPED: $stage (HTTP $lastStatus). Share PASS/STOPPED lines only."
} finally {
    if($loggedIn){
        $r=Read-Api '/api/auth/logout' 'POST'
        $checks.Add([pscustomobject]@{name='Administrator logout';pass=($r.status -eq 200);http_status=$r.status})
        Write-Output "Administrator logout HTTP: $($r.status)"
    }
    [pscustomobject]@{date=[DateTime]::UtcNow.ToString('o');scope='User-run production list/detail verification; no emails, IDs, user records or credentials saved';results=@($checks.ToArray())} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $projectRoot 'docs/module-2-evidence/production-user-reads-admin.json')
    $credential=$null; $securePassword=$null; $email=$null; $id=$null; $r=$null; $session=$null
    Write-Output 'Sanitized check results saved. No accounts were created or changed.'
}
