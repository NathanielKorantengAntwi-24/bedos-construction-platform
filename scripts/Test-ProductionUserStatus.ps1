# Production test: private existing-admin login, one disposable CUSTOMER only.
# Service credentials are used solely for fixture setup, audit verification and exact cleanup.
# No passwords, tokens, emails or IDs are included in the published results.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$origin='https://bedos-construction-platform.vercel.app'
$provider='https://zjdqomckldeipigqqfqm.supabase.co'
$privatePath=Join-Path $root 'docs/module-2-evidence/private-user-status-fixture.json'
if(Test-Path -LiteralPath $privatePath){
    $previous=Get-Content -Raw -LiteralPath $privatePath | ConvertFrom-Json
    if($previous.state -ne 'deleted'){throw 'Previous dedicated fixture needs controlled cleanup. Do not create another test account.'}
}
$config=@{}
foreach($line in Get-Content -LiteralPath (Join-Path $root '.env.local')){
    if($line -match '^\s*(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$'){
        $config[$Matches[1]]=$Matches[2].Trim().Trim([char]34).Trim([char]39)
    }
}
$linked=(Get-Content -Raw -LiteralPath (Join-Path $root 'supabase/.temp/project-ref')).Trim()
if($linked -ne 'zjdqomckldeipigqqfqm' -or $config.NEXT_PUBLIC_SUPABASE_URL.TrimEnd('/') -ne $provider -or -not $config.SUPABASE_SERVICE_ROLE_KEY){throw 'Production fixture setup target/credential guard failed.'}
$serviceHeaders=@{apikey=$config.SUPABASE_SERVICE_ROLE_KEY;Authorization="Bearer $($config.SUPABASE_SERVICE_ROLE_KEY)"}
$adminSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$customerSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$anonymousSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$providerSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$checks=New-Object System.Collections.Generic.List[object]
$adminLoggedIn=$false; $customerLoggedIn=$false; $fixtureId=$null
$stage='administrator login'; $lastStatus=$null; $credential=$null; $secure=$null
$run=[Guid]::NewGuid().ToString()
$fixtureEmail="status-$run@bedos-production-status-test.invalid"
$fixtureName="Bedos Disposable Account Status $run"
$random=New-Object byte[] 32
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try{$rng.GetBytes($random);$fixturePassword=[Convert]::ToBase64String($random)+'aA1!'}finally{$rng.Dispose();[Array]::Clear($random,0,$random.Length)}
function Status-Request([string]$Base,[string]$Path,[string]$Method,[object]$Payload,[object]$Session){
    $bytes=$null; $json=$null
    try{
        if($Base -ne $origin -and $Base -ne $provider){throw 'Request origin guard failed'}
        $parameters=@{Uri="$Base$Path";Method=$Method;WebSession=$Session;UseBasicParsing=$true;TimeoutSec=30;MaximumRedirection=0;ErrorAction='Stop'}
        if($Base -eq $provider){$parameters.Headers=$serviceHeaders}
        if($null -ne $Payload){$json=$Payload | ConvertTo-Json -Depth 6 -Compress;$bytes=[Text.Encoding]::UTF8.GetBytes($json);$parameters.ContentType='application/json; charset=utf-8';$parameters.Body=$bytes}
        $response=Invoke-WebRequest @parameters
        $script:lastStatus=[int]$response.StatusCode
        $data=$null
        if($response.Content){$data=$response.Content | ConvertFrom-Json}
        if($Base -eq $provider -and $Path -like '/auth/v1/admin/users*' -and $null -ne $data.user){$data=$data.user}
        return [pscustomobject]@{status=$script:lastStatus;data=$data;cache=$response.Headers['Cache-Control']}
    }catch{
        $script:lastStatus=$null
        if($_.Exception.Response){$script:lastStatus=[int]$_.Exception.Response.StatusCode}
        return [pscustomobject]@{status=$script:lastStatus;data=$null;cache=$null}
    }finally{if($bytes){[Array]::Clear($bytes,0,$bytes.Length)};$bytes=$null;$json=$null}
}
function Assert-StatusCheck([string]$Name,[bool]$Pass){
    $checks.Add([pscustomobject]@{name=$Name;pass=$Pass})
    if(-not $Pass){throw 'Account status verification stopped'}
    Write-Output "PASS: $Name"
}
function Save-PrivateFixture([string]$State){
    [pscustomobject]@{id=$fixtureId;email=$fixtureEmail;full_name=$fixtureName;state=$State} | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath $privatePath
}
try{
    Write-Output 'This test creates one disposable customer, suspends/restores it, verifies audits, then deletes it.'
    Write-Output 'The normal backend logout is performed for both sessions at the end. No email step is required.'
    $email=(Read-Host 'Existing administrator email').Trim().ToLowerInvariant()
    $secure=Read-Host 'Administrator password (hidden; never send in chat)' -AsSecureString
    $credential=New-Object System.Management.Automation.PSCredential($email,$secure)
    $r=Status-Request $origin '/api/auth/login' 'POST' @{email=$email;password=$credential.GetNetworkCredential().Password} $adminSession
    Assert-StatusCheck 'Administrator login' ($r.status -eq 200 -and $r.data.user.email -eq $email)
    $adminLoggedIn=$true; $actorId=$r.data.user.id
    $r=Status-Request $origin '/api/auth/me' 'GET' $null $adminSession
    Assert-StatusCheck 'Active administrator session' ($r.status -eq 200 -and $r.data.user.id -eq $actorId -and $r.data.role.name -eq 'administrator' -and $r.data.profile.account_status -eq 'active')
    $stage='disposable fixture setup'
    # Explicit confirmation is fixture setup only, not evidence of public signup.
    Save-PrivateFixture 'creation_requested'
    $r=Status-Request $provider '/auth/v1/admin/users' 'POST' @{email=$fixtureEmail;password=$fixturePassword;email_confirm=$true;user_metadata=@{full_name=$fixtureName}} $providerSession
    $fixtureId=$r.data.id
    if($fixtureId){Save-PrivateFixture 'created'}
    Assert-StatusCheck 'Dedicated disposable customer created' ($r.status -in @(200,201) -and $fixtureId -match '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$' -and $r.data.email -eq $fixtureEmail)
    $r=Status-Request $origin "/api/users/$fixtureId" 'GET' $null $adminSession
    Assert-StatusCheck 'Exact active customer fixture verified' ($r.status -eq 200 -and $r.data.user.id -eq $fixtureId -and $r.data.user.email -eq $fixtureEmail -and $r.data.user.full_name -eq $fixtureName -and $r.data.user.role.name -eq 'customer' -and $r.data.user.account_status -eq 'active' -and $null -eq $r.data.user.invitation)
    $r=Status-Request $origin '/api/auth/login' 'POST' @{email=$fixtureEmail;password=$fixturePassword} $customerSession
    Assert-StatusCheck 'Dedicated customer login' ($r.status -eq 200 -and $r.data.user.id -eq $fixtureId)
    $customerLoggedIn=$true
    $body=@{account_status='suspended';expected_account_status='active';reason='Production status verification suspension'}
    $stage='authorization and suspension'
    $r=Status-Request $origin "/api/users/$fixtureId/status" 'PATCH' $body $anonymousSession
    Assert-StatusCheck 'Anonymous status mutation denied' ($r.status -eq 401)
    $r=Status-Request $origin "/api/users/$fixtureId/status" 'PATCH' $body $customerSession
    Assert-StatusCheck 'Ordinary customer status mutation denied' ($r.status -eq 403)
    $r=Status-Request $origin "/api/users/$fixtureId/status" 'PATCH' $body $adminSession
    Assert-StatusCheck 'Administrator suspends dedicated customer' ($r.status -eq 200 -and $r.data.user_id -eq $fixtureId -and $r.data.account_status -eq 'suspended')
    Save-PrivateFixture 'suspended'
    Assert-StatusCheck 'Status response contains only approved fields' ((($r.data.PSObject.Properties.Name | Sort-Object)-join ',') -eq 'account_status,user_id' -and $r.cache -match 'no-store')
    $r=Status-Request $origin "/api/users/$fixtureId/status" 'PATCH' $body $adminSession
    Assert-StatusCheck 'Stale suspension request rejected' ($r.status -eq 409)
    $r=Status-Request $origin '/api/auth/me' 'GET' $null $customerSession
    Assert-StatusCheck 'Existing customer session blocked while suspended' ($r.status -eq 403)
    $r=Status-Request $origin '/api/auth/me' 'PATCH' @{full_name='Denied suspended edit'} $customerSession
    Assert-StatusCheck 'Suspended profile change denied' ($r.status -eq 403)
    $stage='restoration'
    $restore=@{account_status='active';expected_account_status='suspended';reason='Production status verification restoration'}
    $r=Status-Request $origin "/api/users/$fixtureId/status" 'PATCH' $restore $adminSession
    Assert-StatusCheck 'Administrator restores confirmed customer' ($r.status -eq 200 -and $r.data.user_id -eq $fixtureId -and $r.data.account_status -eq 'active')
    Save-PrivateFixture 'restored'
    $r=Status-Request $origin '/api/auth/me' 'GET' $null $customerSession
    Assert-StatusCheck 'Existing customer session works after restoration' ($r.status -eq 200 -and $r.data.user.id -eq $fixtureId -and $r.data.profile.account_status -eq 'active')
    $stage='input and conflict checks'
    $r=Status-Request $origin "/api/users/$fixtureId/status" 'PATCH' $restore $adminSession
    Assert-StatusCheck 'Stale restoration request rejected' ($r.status -eq 409)
    $r=Status-Request $origin "/api/users/$fixtureId/status" 'PATCH' @{account_status='inactive';expected_account_status='active';reason='Invalid transition check'} $adminSession
    Assert-StatusCheck 'Unsupported requested status rejected' ($r.status -eq 400)
    $r=Status-Request $origin "/api/users/$fixtureId/status" 'PATCH' @{account_status='suspended';expected_account_status='active';reason=' '} $adminSession
    Assert-StatusCheck 'Blank audit reason rejected' ($r.status -eq 400)
    $r=Status-Request $origin ("/api/users/"+[Guid]::NewGuid().ToString()+"/status") 'PATCH' $body $adminSession
    Assert-StatusCheck 'Missing target returns 404' ($r.status -eq 404)
    $stage='audit verification'
    $r=Status-Request $provider "/rest/v1/audit_logs?entity_id=eq.$fixtureId&action=eq.user_account_status_changed&select=actor_id,metadata&order=created_at.asc,id.asc" 'GET' $null $providerSession
    $events=@($r.data)
    Assert-StatusCheck 'Exactly two status transitions audited' ($r.status -eq 200 -and $events.Count -eq 2)
    Assert-StatusCheck 'Audit actor before after and reasons verified' ($events[0].actor_id -eq $actorId -and $events[1].actor_id -eq $actorId -and $events[0].metadata.previous_account_status -eq 'active' -and $events[0].metadata.account_status -eq 'suspended' -and $events[0].metadata.reason -eq $body.reason -and $events[1].metadata.previous_account_status -eq 'suspended' -and $events[1].metadata.account_status -eq 'active' -and $events[1].metadata.reason -eq $restore.reason)
}catch{
    $checks.Add([pscustomobject]@{name="Stopped at $stage";pass=$false;http_status=$lastStatus})
    Write-Output "STOPPED: $stage (HTTP $lastStatus). Share PASS/STOPPED lines only."
}finally{
    foreach($pair in @(@('Customer',$customerLoggedIn,$customerSession),@('Administrator',$adminLoggedIn,$adminSession))){
        if($pair[1]){$out=Status-Request $origin '/api/auth/logout' 'POST' $null $pair[2];$checks.Add([pscustomobject]@{name="$($pair[0]) logout";pass=($out.status -eq 200);http_status=$out.status});Write-Output "$($pair[0]) logout HTTP: $($out.status)"}
    }
    if($fixtureId){
        $cleanupOk=$false
        try{
            $actual=Status-Request $provider "/auth/v1/admin/users/$fixtureId" 'GET' $null $providerSession
            if($actual.status -ne 200 -or $actual.data.id -ne $fixtureId -or $actual.data.email -ne $fixtureEmail -or $actual.data.user_metadata.full_name -ne $fixtureName){throw 'Exact fixture cleanup identity guard failed'}
            $removed=Status-Request $provider "/auth/v1/admin/users/$fixtureId" 'DELETE' @{should_soft_delete=$false} $providerSession
            if($removed.status -notin @(200,204)){throw 'Dedicated fixture deletion failed'}
            $absent=Status-Request $provider "/auth/v1/admin/users/$fixtureId" 'GET' $null $providerSession
            $profile=Status-Request $provider "/rest/v1/profiles?id=eq.$fixtureId&select=id" 'GET' $null $providerSession
            $cleanupOk=$absent.status -eq 404 -and $profile.status -eq 200 -and @($profile.data | Where-Object {$null -ne $_}).Count -eq 0
            if($cleanupOk){Save-PrivateFixture 'deleted'}
        }catch{$cleanupOk=$false}
        $checks.Add([pscustomobject]@{name='Exact disposable Auth account and profile removed';pass=$cleanupOk})
        if($cleanupOk){Write-Output 'PASS: Exact disposable Auth account and profile removed'}else{Write-Output 'STOPPED: Dedicated fixture cleanup needs controlled review. Do not rerun.'}
    }elseif($stage -eq 'disposable fixture setup' -and (Test-Path -LiteralPath $privatePath)){
        $checks.Add([pscustomobject]@{name='Fixture creation outcome needs controlled review';pass=$false})
        Write-Output 'STOPPED: Fixture creation outcome needs controlled review. Do not rerun.'
    }
    [pscustomobject]@{date=[DateTime]::UtcNow.ToString('o');scope='Production administrator status workflow on one disposable customer; confirmation is setup only; no account identifiers or credentials in this report; audit history retained';results=@($checks.ToArray())} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $root 'docs/module-2-evidence/production-user-status-admin.json')
    $fixturePassword=$null;$credential=$null;$secure=$null;$serviceHeaders=$null;$config=$null;$email=$null;$actorId=$null;$r=$null;$events=$null
    Write-Output 'Sanitized results saved. Never share passwords, keys or the private fixture file.'
}
