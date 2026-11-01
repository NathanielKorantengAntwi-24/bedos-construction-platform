# Private administrator workflow; one disposable staff identity only.
# Service access is limited to fixture setup/proof/audit/cleanup, never role API authorization.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$origin='https://bedos-construction-platform.vercel.app'
$provider='https://zjdqomckldeipigqqfqm.supabase.co'
$privatePath=Join-Path $root 'docs/module-2-evidence/private-user-role-fixture.json'
if(Test-Path -LiteralPath $privatePath){$previous=Get-Content -Raw -LiteralPath $privatePath | ConvertFrom-Json;if($previous.state -notin @('deleted','absent_verified')){throw 'Earlier role fixture needs controlled cleanup. Do not create another account.'}}
$config=@{}
foreach($line in Get-Content -LiteralPath (Join-Path $root '.env.local')){
    if($line -match '^\s*(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$'){$config[$Matches[1]]=$Matches[2].Trim().Trim([char]34).Trim([char]39)}
}
if((Get-Content -Raw -LiteralPath (Join-Path $root 'supabase/.temp/project-ref')).Trim() -ne 'zjdqomckldeipigqqfqm' -or $config.NEXT_PUBLIC_SUPABASE_URL.TrimEnd('/') -ne $provider -or -not $config.SUPABASE_SERVICE_ROLE_KEY -or -not $config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY){throw 'Production target/fixture credential guard failed'}
$serviceHeaders=@{apikey=$config.SUPABASE_SERVICE_ROLE_KEY;Authorization="Bearer $($config.SUPABASE_SERVICE_ROLE_KEY)"}
$publicHeaders=@{apikey=$config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
$adminSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$staffSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$anonymousSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$providerSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$checks=New-Object System.Collections.Generic.List[object]
$stage='administrator login';$lastStatus=$null;$fixtureId=$null;$invitationId=$null;$adminLoggedIn=$false;$staffLoggedIn=$false;$staffToken=$null
$run=[Guid]::NewGuid().ToString();$fixtureEmail="role-$run@bedos-production-role-test.invalid";$fixtureName="Bedos Disposable Staff Role $run"
. (Join-Path $PSScriptRoot 'lib/ProductionVerification.ps1')
function Role-Request([string]$Base,[string]$Path,[string]$Method,[object]$Payload,[object]$Session,[hashtable]$AuthHeaders=$serviceHeaders){
    $r=Invoke-BedosVerificationRequest -Base $Base -Origin $origin -Provider $provider -Path $Path -Method $Method -Payload $Payload -Session $Session -ProviderHeaders $AuthHeaders
    $script:lastStatus=$r.status;return $r
}
function Assert-RoleCheck([string]$Name,[bool]$Pass){$checks.Add([pscustomobject]@{name=$Name;pass=$Pass});if(-not $Pass){throw 'Role verification stopped'};Write-Output "PASS: $Name"}
function Save-RoleFixture([string]$State){[pscustomobject]@{id=$fixtureId;email=$fixtureEmail;full_name=$fixtureName;invitation_id=$invitationId;state=$State} | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath $privatePath}
function New-FixturePassword {
    $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try{$rng.GetBytes($bytes);return [Convert]::ToBase64String($bytes)+'aA1!'}finally{$rng.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}
}
$password=New-FixturePassword;$changedPassword=New-FixturePassword
try{
    Write-Output 'This tests one disposable ordinary staff account and deletes it afterward. No email step is required.'
    Write-Output 'Fixture confirmation is test setup only. Role changes use your administrator backend session.'
    Write-Output 'The normal backend logout is performed for both sessions at the end.'
    $email=(Read-Host 'Existing administrator email').Trim().ToLowerInvariant();$secure=Read-Host 'Administrator password (hidden; never send in chat)' -AsSecureString
    $credential=New-Object System.Management.Automation.PSCredential($email,$secure)
    $r=Role-Request $origin '/api/auth/login' 'POST' @{email=$email;password=$credential.GetNetworkCredential().Password} $adminSession
    Assert-RoleCheck 'Administrator login' ($r.status -eq 200 -and $r.data.user.email -eq $email)
    $adminLoggedIn=$true;$actorId=$r.data.user.id
    $r=Role-Request $origin '/api/auth/me' 'GET' $null $adminSession
    Assert-RoleCheck 'Active administrator session' ($r.status -eq 200 -and $r.data.user.id -eq $actorId -and $r.data.role.name -eq 'administrator' -and $r.data.profile.account_status -eq 'active')
    $stage='service preflight'
    $r=Role-Request $provider '/auth/v1/admin/users/00000000-0000-4000-8000-000000000000' 'GET' $null $providerSession
    Assert-RoleCheck 'Backend service authentication before fixture creation' ($r.status -eq 404)
    $r=Role-Request $provider '/rest/v1/roles?select=id,name' 'GET' $null $providerSession
    $roles=@{};foreach($role in $r.data){$roles[$role.name]=$role.id}
    Assert-RoleCheck 'Expected built-in roles resolved' ($r.status -eq 200 -and $roles.content_manager -and $roles.finance -and $roles.sales_customer_service -and $roles.administrator -and $roles.customer)
    $stage='disposable staff setup';Save-RoleFixture 'creation_requested'
    $r=Role-Request $provider '/auth/v1/admin/users' 'POST' @{email=$fixtureEmail;password=$password;email_confirm=$true;user_metadata=@{full_name=$fixtureName;bedos_staff_onboarding_pending=$true}} $providerSession
    $fixtureId=$r.data.id;if($fixtureId){Save-RoleFixture 'created'}
    Assert-RoleCheck 'Exact disposable staff Auth identity created' ($r.status -in @(200,201) -and $fixtureId -match '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$' -and $r.data.email -eq $fixtureEmail)
    $r=Role-Request $provider "/rest/v1/profiles?id=eq.$fixtureId" 'PATCH' @{role_id=$roles.content_manager;account_status='inactive'} $providerSession
    Assert-RoleCheck 'Inactive ordinary staff fixture configured' ($r.status -in @(200,204))
    $r=Role-Request $origin "/api/users/$fixtureId" 'GET' $null $adminSession
    Assert-RoleCheck 'Exact fixture profile and role verified' ($r.status -eq 200 -and $r.data.user.id -eq $fixtureId -and $r.data.user.email -eq $fixtureEmail -and $r.data.user.full_name -eq $fixtureName -and $r.data.user.role.name -eq 'content_manager' -and $r.data.user.account_status -eq 'inactive')
    $r=Role-Request $provider '/rest/v1/rpc/bedos_authorize_staff_invitation' 'POST' @{p_user_id=$fixtureId;p_invited_by=$actorId;p_approved_role_id=$roles.content_manager} $providerSession
    $invitationId=$r.data;if($invitationId){Save-RoleFixture 'authorized'}
    Assert-RoleCheck 'Trusted fixture invitation authorization recorded' ($r.status -eq 200 -and $invitationId -match '^[0-9a-f-]{36}$')
    $r=Role-Request $provider '/rest/v1/rpc/bedos_record_staff_invitation_password_baseline' 'POST' @{p_user_id=$fixtureId} $providerSession
    Assert-RoleCheck 'Fixture password baseline captured' ($r.status -eq 200 -and $r.data -eq $invitationId)
    $r=Role-Request $provider '/auth/v1/token?grant_type=password' 'POST' @{email=$fixtureEmail;password=$password} $providerSession $publicHeaders
    $staffToken=$r.data.access_token
    Assert-RoleCheck 'Fixture provider setup session verified' ($r.status -eq 200 -and $r.data.user.id -eq $fixtureId -and $staffToken)
    $staffHeaders=@{apikey=$config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;Authorization="Bearer $staffToken"}
    $r=Role-Request $provider '/auth/v1/user' 'PUT' @{password=$changedPassword} $providerSession $staffHeaders
    Assert-RoleCheck 'Fixture staff changes own password after baseline' ($r.status -eq 200 -and (($r.data.id -eq $fixtureId) -or ($r.data.user.id -eq $fixtureId)))
    $r=Role-Request $origin "/api/users/$fixtureId/activate" 'POST' $null $adminSession
    Assert-RoleCheck 'Administrator activates completed fixture onboarding' ($r.status -eq 200 -and $r.data.user_id -eq $fixtureId)
    Save-RoleFixture 'activated'
    $r=Role-Request $origin '/api/auth/login' 'POST' @{email=$fixtureEmail;password=$changedPassword} $staffSession
    Assert-RoleCheck 'Activated staff backend login' ($r.status -eq 200 -and $r.data.user.id -eq $fixtureId)
    $staffLoggedIn=$true;$missingService=[Guid]::NewGuid().ToString()
    $r=Role-Request $origin "/api/services/$missingService" 'GET' $null $staffSession
    Assert-RoleCheck 'Content staff permission reaches absent-service lookup' ($r.status -eq 404)
    $stage='role change permission checks'
    $body=@{role_id=$roles.finance;expected_role_id=$roles.content_manager;reason='Production role verification finance'}
    $r=Role-Request $origin "/api/users/$fixtureId/role" 'PATCH' $body $anonymousSession
    Assert-RoleCheck 'Anonymous role change denied' ($r.status -eq 401)
    $r=Role-Request $origin "/api/users/$fixtureId/role" 'PATCH' $body $staffSession
    Assert-RoleCheck 'Ordinary staff role change denied' ($r.status -eq 403)
    $r=Role-Request $origin "/api/users/$fixtureId/role" 'PATCH' $body $adminSession
    Assert-RoleCheck 'Administrator assigns finance role' ($r.status -eq 200 -and $r.data.user_id -eq $fixtureId -and $r.data.role.id -eq $roles.finance -and $r.data.role.name -eq 'finance')
    Assert-RoleCheck 'Safe role response and no-store cache policy' ((($r.data.PSObject.Properties.Name | Sort-Object)-join ',') -eq 'role,user_id' -and (($r.data.role.PSObject.Properties.Name | Sort-Object)-join ',') -eq 'id,name' -and $r.cache -match 'no-store')
    Save-RoleFixture 'finance'
    $r=Role-Request $origin '/api/auth/me' 'GET' $null $staffSession
    Assert-RoleCheck 'Existing staff session sees finance role' ($r.status -eq 200 -and $r.data.user.id -eq $fixtureId -and $r.data.role.name -eq 'finance')
    $r=Role-Request $origin "/api/services/$missingService" 'GET' $null $staffSession
    Assert-RoleCheck 'Existing session loses content service permission' ($r.status -eq 403)
    $r=Role-Request $provider "/rest/v1/staff_invitations?user_id=eq.$fixtureId&select=id,approved_role_id,status" 'GET' $null $providerSession
    $proof=@($r.data)
    Assert-RoleCheck 'Activated invitation proof matches new role' ($r.status -eq 200 -and $proof.Count -eq 1 -and $proof[0].id -eq $invitationId -and $proof[0].approved_role_id -eq $roles.finance -and $proof[0].status -eq 'activated')
    $r=Role-Request $origin "/api/users/$fixtureId/role" 'PATCH' $body $adminSession
    Assert-RoleCheck 'Stale expected role rejected' ($r.status -eq 409)
    $r=Role-Request $origin "/api/users/$fixtureId/role" 'PATCH' @{role_id=$roles.finance;expected_role_id=$roles.finance;reason='No-op role check'} $adminSession
    Assert-RoleCheck 'No-op role request rejected' ($r.status -eq 409)
    foreach($protected in @('administrator','customer')){
        $r=Role-Request $origin "/api/users/$fixtureId/role" 'PATCH' @{role_id=$roles[$protected];expected_role_id=$roles.finance;reason='Protected destination check'} $adminSession
        Assert-RoleCheck "Protected $protected assignment rejected" ($r.status -eq 403)
    }
    $stage='role status compatibility'
    $r=Role-Request $origin "/api/users/$fixtureId/status" 'PATCH' @{account_status='suspended';expected_account_status='active';reason='Production role compatibility suspension'} $adminSession
    Assert-RoleCheck 'Updated staff proof supports suspension' ($r.status -eq 200 -and $r.data.account_status -eq 'suspended')
    Save-RoleFixture 'suspended'
    $r=Role-Request $origin "/api/users/$fixtureId/role" 'PATCH' @{role_id=$roles.sales_customer_service;expected_role_id=$roles.finance;reason='Suspended role check'} $adminSession
    Assert-RoleCheck 'Suspended staff role edit rejected' ($r.status -eq 409)
    $r=Role-Request $origin "/api/users/$fixtureId/status" 'PATCH' @{account_status='active';expected_account_status='suspended';reason='Production role compatibility restoration'} $adminSession
    Assert-RoleCheck 'Updated staff proof supports restoration' ($r.status -eq 200 -and $r.data.account_status -eq 'active')
    Save-RoleFixture 'restored'
    $stage='remaining role transitions'
    $r=Role-Request $origin "/api/users/$fixtureId/role" 'PATCH' @{role_id=$roles.sales_customer_service;expected_role_id=$roles.finance;reason='Production role verification sales'} $adminSession
    Assert-RoleCheck 'Administrator assigns sales customer service role' ($r.status -eq 200 -and $r.data.role.name -eq 'sales_customer_service')
    $r=Role-Request $origin "/api/users/$fixtureId/role" 'PATCH' @{role_id=$roles.content_manager;expected_role_id=$roles.sales_customer_service;reason='Production role verification content'} $adminSession
    Assert-RoleCheck 'Administrator reassigns content manager role' ($r.status -eq 200 -and $r.data.role.id -eq $roles.content_manager)
    Save-RoleFixture 'content_restored'
    $r=Role-Request $origin '/api/auth/me' 'GET' $null $staffSession
    Assert-RoleCheck 'Existing staff session sees restored content role' ($r.status -eq 200 -and $r.data.user.id -eq $fixtureId -and $r.data.role.name -eq 'content_manager')
    $r=Role-Request $origin "/api/services/$missingService" 'GET' $null $staffSession
    Assert-RoleCheck 'Existing session regains content service permission' ($r.status -eq 404)
    $stage='audit verification'
    $r=Role-Request $provider "/rest/v1/audit_logs?entity_id=eq.$fixtureId&action=eq.staff_role_changed&select=actor_id,metadata&order=created_at.asc,id.asc" 'GET' $null $providerSession
    $events=@($r.data)
    Assert-RoleCheck 'Exactly three successful role edits audited' ($r.status -eq 200 -and $events.Count -eq 3)
    $expected=@(@($roles.content_manager,$roles.finance,'Production role verification finance'),@($roles.finance,$roles.sales_customer_service,'Production role verification sales'),@($roles.sales_customer_service,$roles.content_manager,'Production role verification content'))
    $auditOk=$true
    for($i=0;$i -lt 3;$i++){if($events[$i].actor_id -ne $actorId -or $events[$i].metadata.previous_role_id -ne $expected[$i][0] -or $events[$i].metadata.role_id -ne $expected[$i][1] -or $events[$i].metadata.reason -ne $expected[$i][2] -or $events[$i].metadata.invitation_id -ne $invitationId){$auditOk=$false}}
    Assert-RoleCheck 'Role audit actors before after reasons and proof verified' $auditOk
    $r=Role-Request $provider "/rest/v1/audit_logs?entity_id=eq.$fixtureId&action=eq.staff_invitation_authorized&select=metadata" 'GET' $null $providerSession
    $original=@($r.data)
    Assert-RoleCheck 'Original staff approval audit preserved' ($r.status -eq 200 -and $original.Count -eq 1 -and $original[0].metadata.approved_role_id -eq $roles.content_manager)
}catch{
    $checks.Add([pscustomobject]@{name="Stopped at $stage";pass=$false;http_status=$lastStatus})
    Write-Output "STOPPED: $stage (HTTP $lastStatus). Share PASS/STOPPED lines only."
}finally{
    foreach($pair in @(@('Staff',$staffLoggedIn,$staffSession),@('Administrator',$adminLoggedIn,$adminSession))){if($pair[1]){$out=Role-Request $origin '/api/auth/logout' 'POST' $null $pair[2];$checks.Add([pscustomobject]@{name="$($pair[0]) logout";pass=($out.status -eq 200);http_status=$out.status});Write-Output "$($pair[0]) logout HTTP: $($out.status)"}}
    if($fixtureId){
        $cleanupOk=$false
        try{
            $actual=Role-Request $provider "/auth/v1/admin/users/$fixtureId" 'GET' $null $providerSession
            if($actual.status -ne 200 -or $actual.data.id -ne $fixtureId -or $actual.data.email -ne $fixtureEmail -or $actual.data.user_metadata.full_name -ne $fixtureName){throw 'Exact fixture cleanup identity guard failed'}
            $removed=Role-Request $provider "/auth/v1/admin/users/$fixtureId" 'DELETE' @{should_soft_delete=$false} $providerSession
            if($removed.status -notin @(200,204)){throw 'Exact fixture deletion failed'}
            $absent=Role-Request $provider "/auth/v1/admin/users/$fixtureId" 'GET' $null $providerSession
            $profile=Role-Request $provider "/rest/v1/profiles?id=eq.$fixtureId&select=id" 'GET' $null $providerSession
            $proof=Role-Request $provider "/rest/v1/staff_invitations?user_id=eq.$fixtureId&select=id" 'GET' $null $providerSession
            $cleanupOk=$absent.status -eq 404 -and $profile.status -eq 200 -and @($profile.data | Where-Object {$null -ne $_}).Count -eq 0 -and $proof.status -eq 200 -and @($proof.data | Where-Object {$null -ne $_}).Count -eq 0
            if($cleanupOk){Save-RoleFixture 'deleted'}
        }catch{$cleanupOk=$false}
        $checks.Add([pscustomobject]@{name='Exact disposable Auth profile and invitation removed';pass=$cleanupOk})
        if($cleanupOk){Write-Output 'PASS: Exact disposable Auth profile and invitation removed'}else{Write-Output 'STOPPED: Dedicated staff fixture cleanup needs review. Do not rerun.'}
    }elseif($stage -eq 'disposable staff setup' -and (Test-Path -LiteralPath $privatePath)){
        $checks.Add([pscustomobject]@{name='Fixture creation outcome needs review';pass=$false});Write-Output 'STOPPED: Fixture creation outcome needs review. Do not rerun.'
    }
    [pscustomobject]@{date=[DateTime]::UtcNow.ToString('o');scope='Production role workflow on one disposable staff fixture; confirmation is setup only; no account identifiers credentials or user records retained; audit history preserved';results=@($checks.ToArray())} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $root 'docs/module-2-evidence/production-user-role-admin.json')
    $password=$null;$changedPassword=$null;$credential=$null;$secure=$null;$staffToken=$null;$staffHeaders=$null;$serviceHeaders=$null;$publicHeaders=$null;$config=$null;$email=$null;$actorId=$null;$r=$null;$events=$null
    Write-Output 'Sanitized results saved. Never share passwords, keys or the private fixture record.'
}
