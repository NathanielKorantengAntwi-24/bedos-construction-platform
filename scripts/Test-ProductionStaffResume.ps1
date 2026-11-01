# Private admin test of normal invitation creation and one incomplete-setup repair.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$origin='https://bedos-construction-platform.vercel.app';$provider='https://zjdqomckldeipigqqfqm.supabase.co'
$privatePath=Join-Path $root 'docs/module-2-evidence/private-staff-resume-fixtures.json'
if(Test-Path -LiteralPath $privatePath){$previous=Get-Content -Raw -LiteralPath $privatePath | ConvertFrom-Json;if($previous.state -ne 'complete'){throw 'Previous recovery fixtures need controlled review. Do not create more accounts.'}}
$config=@{};foreach($line in Get-Content -LiteralPath (Join-Path $root '.env.local')){if($line -match '^\s*(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$'){$config[$Matches[1]]=$Matches[2].Trim().Trim([char]34).Trim([char]39)}}
if((Get-Content -Raw -LiteralPath (Join-Path $root 'supabase/.temp/project-ref')).Trim() -ne 'zjdqomckldeipigqqfqm' -or $config.NEXT_PUBLIC_SUPABASE_URL.TrimEnd('/') -ne $provider -or -not $config.SUPABASE_SERVICE_ROLE_KEY){throw 'Production target/fixture credential guard failed'}
$headers=@{apikey=$config.SUPABASE_SERVICE_ROLE_KEY;Authorization="Bearer $($config.SUPABASE_SERVICE_ROLE_KEY)"}
$adminSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$staffSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$anonymousSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$providerSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$checks=New-Object System.Collections.Generic.List[object];$fixtures=New-Object System.Collections.Generic.List[object]
$adminLoggedIn=$false;$staffLoggedIn=$false;$credential=$null;$secure=$null;$stage='administrator login';$lastStatus=$null
. (Join-Path $PSScriptRoot 'lib/ProductionVerification.ps1')
function Resume-Request([string]$Base,[string]$Path,[string]$Method,[object]$Payload,[object]$Session){
    $r=Invoke-BedosVerificationRequest -Base $Base -Origin $origin -Provider $provider -Path $Path -Method $Method -Payload $Payload -Session $Session -ProviderHeaders $headers
    $script:lastStatus=$r.status;return $r
}
function Assert-ResumeCheck([string]$Name,[bool]$Pass){$checks.Add([pscustomobject]@{name=$Name;pass=$Pass});if(-not $Pass){throw 'Recovery verification stopped'};Write-Output "PASS: $Name"}
function Save-ResumeJournal {
    $complete=@($fixtures.ToArray() | Where-Object {$_.state -ne 'deleted'}).Count -eq 0
    [pscustomobject]@{state=if($complete){'complete'}else{'review_required'};fixtures=@($fixtures.ToArray())} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -LiteralPath $privatePath
}
function New-ResumeFixture([string]$Kind,[string]$Email,[string]$Name){
    $f=[pscustomobject]@{kind=$Kind;id=$null;email=$Email;full_name=$Name;invitation_id=$null;request_id=$null;state='creation_requested'}
    $fixtures.Add($f);Save-ResumeJournal;return $f
}
try{
    Write-Output 'Two dedicated staff fixtures are tested and removed afterward. Existing accounts are not reassigned.'
    Write-Output 'One initial-check invitation may arrive: IGNORE it. The later prompt identifies the recovery email to open.'
    Write-Output 'Keep PowerShell open; the recovery test uses Chrome for email confirmation and password setup.'
    $email=(Read-Host 'Existing administrator Gmail address (not a test alias)').Trim().ToLowerInvariant()
    if($email -notmatch '^[^+\s@]+@gmail\.com$'){throw 'This controlled-inbox script requires the registered Gmail address without an alias'}
    $secure=Read-Host 'Administrator password (hidden; never send in chat)' -AsSecureString
    $credential=New-Object System.Management.Automation.PSCredential($email,$secure)
    $r=Resume-Request $origin '/api/auth/login' 'POST' @{email=$email;password=$credential.GetNetworkCredential().Password} $adminSession
    Assert-ResumeCheck 'Administrator login' ($r.status -eq 200 -and $r.data.user.email -eq $email)
    $adminLoggedIn=$true;$actor=$r.data.user.id
    $r=Resume-Request $origin '/api/auth/me' 'GET' $null $adminSession
    Assert-ResumeCheck 'Active administrator session' ($r.status -eq 200 -and $r.data.user.id -eq $actor -and $r.data.role.name -eq 'administrator' -and $r.data.profile.account_status -eq 'active')
    $stage='service preflight'
    $r=Resume-Request $provider '/auth/v1/admin/users/00000000-0000-4000-8000-000000000000' 'GET' $null $providerSession
    Assert-ResumeCheck 'Backend fixture service authentication' ($r.status -eq 404)
    $r=Resume-Request $provider '/rest/v1/roles?name=eq.finance&select=id,name' 'GET' $null $providerSession
    $role=@($r.data);Assert-ResumeCheck 'Ordinary finance role resolved' ($r.status -eq 200 -and $role.Count -eq 1 -and $role[0].name -eq 'finance')
    $roleId=$role[0].id;$run=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();$mailBase=$email.Substring(0,$email.IndexOf('@'))
    $stage='normal invitation creation'
    $initial=New-ResumeFixture 'initial' "$mailBase+bedos-initial-$run@gmail.com" "Bedos Initial Setup Check $run"
    $r=Resume-Request $origin '/api/users/invite' 'POST' @{email=$initial.email;full_name=$initial.full_name;role_id=$roleId} $adminSession
    $initial.id=$r.data.user.id;if($initial.id){$initial.state='created';Save-ResumeJournal}
    Assert-ResumeCheck 'Normal invitation succeeds through atomic setup' ($r.status -eq 201 -and $initial.id -match '^[0-9a-f-]{36}$' -and $r.data.user.email -eq $initial.email -and $r.data.profile.role.id -eq $roleId)
    $r=Resume-Request $provider "/auth/v1/admin/users/$($initial.id)" 'GET' $null $providerSession
    $marker=$r.data.app_metadata.bedos_staff_invitation;$initial.request_id=$marker.request_id;Save-ResumeJournal
    Assert-ResumeCheck 'Initial API generated exact server-owned creation proof' ($r.status -eq 200 -and $r.data.id -eq $initial.id -and $marker.version -eq 1 -and $marker.request_id -match '^[0-9a-f-]{36}$' -and $marker.created_by -eq $actor -and $marker.requested_role_id -eq $roleId -and $marker.email -eq $initial.email -and $marker.full_name -eq $initial.full_name)
    $r=Resume-Request $origin "/api/users/$($initial.id)/revoke-invitation" 'POST' $null $adminSession
    Assert-ResumeCheck 'Initial-check invitation safely revoked' ($r.status -eq 200)
    $initial.state='revoked';Save-ResumeJournal
    Write-Output 'Ignore the initial-check invitation email; it has been revoked.'
    $stage='incomplete setup fixture creation'
    $target=New-ResumeFixture 'resume' "$mailBase+bedos-resume-$run@gmail.com" "Bedos Setup Recovery Test $run"
    $target.request_id=[Guid]::NewGuid().ToString();Save-ResumeJournal
    # Service-created proof models a NEW request whose profile/approval stage failed.
    # This does not retrofit provenance onto any existing account.
    $proof=@{version=1;request_id=$target.request_id;requested_role_id=$roleId;created_by=$actor;email=$target.email;full_name=$target.full_name;phone=$null}
    $r=Resume-Request $provider '/auth/v1/admin/users' 'POST' @{email=$target.email;email_confirm=$false;app_metadata=@{bedos_staff_invitation=$proof};user_metadata=@{full_name=$target.full_name;bedos_staff_onboarding_pending=$true}} $providerSession
    $target.id=$r.data.id;if($target.id){$target.state='created';Save-ResumeJournal}
    Assert-ResumeCheck 'Exact incomplete setup fixture created' ($r.status -in @(200,201) -and $target.id -match '^[0-9a-f-]{36}$' -and $r.data.email -eq $target.email)
    $r=Resume-Request $origin "/api/users/$($target.id)" 'GET' $null $adminSession
    Assert-ResumeCheck 'Incomplete fixture starts inactive without staff approval' ($r.status -eq 200 -and $r.data.user.id -eq $target.id -and $r.data.user.email -eq $target.email -and $r.data.user.full_name -eq $target.full_name -and $r.data.user.role.name -eq 'customer' -and $r.data.user.account_status -eq 'inactive' -and $null -eq $r.data.user.invitation)
    $stage='resume authorization and repair';$body=@{reason='Production incomplete staff setup recovery'}
    $r=Resume-Request $origin "/api/users/$($target.id)/resume-invitation" 'POST' $body $anonymousSession
    Assert-ResumeCheck 'Anonymous setup resume denied' ($r.status -eq 401)
    $r=Resume-Request $origin "/api/users/$($target.id)/resume-invitation" 'POST' @{reason='Reject role selection';role_id=$roleId} $adminSession
    Assert-ResumeCheck 'Resume cannot accept caller-selected role' ($r.status -eq 400)
    $r=Resume-Request $origin "/api/users/$($target.id)/resume-invitation" 'POST' $body $adminSession
    $target.invitation_id=$r.data.invitation_id;if($target.invitation_id){$target.state='resumed';Save-ResumeJournal}
    Assert-ResumeCheck 'Administrator repairs setup and requests invitation' ($r.status -eq 202 -and $r.data.user_id -eq $target.id -and $target.invitation_id -match '^[0-9a-f-]{36}$' -and $r.data.recovery_method -eq 'invite')
    Assert-ResumeCheck 'Resume result is not cacheable' ($r.cache -match 'no-store')
    $r=Resume-Request $origin "/api/users/$($target.id)" 'GET' $null $adminSession
    Assert-ResumeCheck 'Repair assigns only bound role and keeps staff inactive' ($r.status -eq 200 -and $r.data.user.role.id -eq $roleId -and $r.data.user.account_status -eq 'inactive' -and $r.data.user.invitation.status -eq 'pending')
    $r=Resume-Request $origin "/api/users/$($target.id)/resume-invitation" 'POST' $body $adminSession
    Assert-ResumeCheck 'Immediate repeated resume preserves retry cooldown' ($r.status -eq 429)
    $r=Resume-Request $origin "/api/users/$($target.id)/activate" 'POST' $null $adminSession
    Assert-ResumeCheck 'Repair alone cannot activate staff' ($r.status -eq 409)
    $stage='email confirmation before password setup'
    Write-Output "Open ONLY the NEW invitation addressed to: $($target.email)"
    Write-Output 'Open its link in Chrome. When Set your password appears, DO NOT enter a password yet.'
    $null=Read-Host 'Press Enter here only after that page appears'
    $r=Resume-Request $provider "/auth/v1/admin/users/$($target.id)" 'GET' $null $providerSession
    Assert-ResumeCheck 'Recovery invitation confirmed exact fixture email' ($r.status -eq 200 -and $r.data.id -eq $target.id -and $r.data.email -eq $target.email -and [bool]$r.data.email_confirmed_at)
    $r=Resume-Request $origin "/api/users/$($target.id)/activate" 'POST' $null $adminSession
    Assert-ResumeCheck 'Email link alone cannot satisfy password setup' ($r.status -eq 409)
    Write-Output 'Now set a NEW STAFF test password in that same Chrome form and save it privately.'
    $null=Read-Host 'Press Enter only after Password set successfully appears'
    $stage='post-password activation'
    $r=Resume-Request $origin "/api/users/$($target.id)/activate" 'POST' $null $adminSession
    Assert-ResumeCheck 'Administrator activates genuinely completed recovery' ($r.status -eq 200 -and $r.data.user_id -eq $target.id)
    $target.state='activated';Save-ResumeJournal
    $staffSecure=Read-Host 'Enter the NEW STAFF test password (NOT the admin password)' -AsSecureString
    $staffCredential=New-Object System.Management.Automation.PSCredential($target.email,$staffSecure)
    $r=Resume-Request $origin '/api/auth/login' 'POST' @{email=$target.email;password=$staffCredential.GetNetworkCredential().Password} $staffSession
    Assert-ResumeCheck 'Recovered staff backend login' ($r.status -eq 200 -and $r.data.user.id -eq $target.id)
    $staffLoggedIn=$true
    $r=Resume-Request $origin '/api/auth/me' 'GET' $null $staffSession
    Assert-ResumeCheck 'Recovered active staff role verified' ($r.status -eq 200 -and $r.data.user.id -eq $target.id -and $r.data.role.id -eq $roleId -and $r.data.profile.account_status -eq 'active')
    $r=Resume-Request $origin "/api/users/$($target.id)/resume-invitation" 'POST' $body $staffSession
    Assert-ResumeCheck 'Ordinary staff cannot resume invitations' ($r.status -eq 403)
    $r=Resume-Request $origin "/api/users/$($target.id)/resume-invitation" 'POST' $body $adminSession
    Assert-ResumeCheck 'Activated staff cannot be re-onboarded' ($r.status -eq 409)
    $stage='resume audit verification'
    $r=Resume-Request $provider "/rest/v1/audit_logs?entity_id=eq.$($target.id)&action=eq.staff_invitation_authorized&select=actor_id,metadata" 'GET' $null $providerSession
    $events=@($r.data)
    Assert-ResumeCheck 'One trusted approval retained after repeated resume' ($r.status -eq 200 -and $events.Count -eq 1 -and $events[0].actor_id -eq $actor -and $events[0].metadata.approved_role_id -eq $roleId)
    $r=Resume-Request $provider "/rest/v1/audit_logs?entity_id=eq.$($target.id)&action=eq.staff_invitation_setup_resumed&select=actor_id,metadata" 'GET' $null $providerSession
    $events=@($r.data);$valid=$events.Count -eq 2
    foreach($event in $events){if($event.actor_id -ne $actor -or $event.metadata.original_creator -ne $actor -or $event.metadata.request_id -ne $target.request_id -or $event.metadata.reason -ne $body.reason -or $event.metadata.invitation_id -ne $target.invitation_id){$valid=$false}}
    Assert-ResumeCheck 'Resume audits bind creator request reason and proof' ($r.status -eq 200 -and $valid)
}catch{
    $checks.Add([pscustomobject]@{name="Stopped at $stage";pass=$false;http_status=$lastStatus});Write-Output "STOPPED: $stage (HTTP $lastStatus). Share PASS/STOPPED lines only."
}finally{
    foreach($pair in @(@('Staff',$staffLoggedIn,$staffSession),@('Administrator',$adminLoggedIn,$adminSession))){if($pair[1]){$out=Resume-Request $origin '/api/auth/logout' 'POST' $null $pair[2];$checks.Add([pscustomobject]@{name="$($pair[0]) logout";pass=($out.status -eq 200);http_status=$out.status});Write-Output "$($pair[0]) logout HTTP: $($out.status)"}}
    foreach($f in $fixtures.ToArray()){
        $removed=$false
        if($f.id){try{
            $actual=Resume-Request $provider "/auth/v1/admin/users/$($f.id)" 'GET' $null $providerSession
            if($actual.status -ne 200 -or $actual.data.id -ne $f.id -or $actual.data.email -ne $f.email -or $actual.data.user_metadata.full_name -ne $f.full_name){throw 'Exact cleanup identity guard failed'}
            $delete=Resume-Request $provider "/auth/v1/admin/users/$($f.id)" 'DELETE' @{should_soft_delete=$false} $providerSession
            if($delete.status -notin @(200,204)){throw 'Exact fixture deletion failed'}
            $absent=Resume-Request $provider "/auth/v1/admin/users/$($f.id)" 'GET' $null $providerSession
            $profile=Resume-Request $provider "/rest/v1/profiles?id=eq.$($f.id)&select=id" 'GET' $null $providerSession
            $proof=Resume-Request $provider "/rest/v1/staff_invitations?user_id=eq.$($f.id)&select=id" 'GET' $null $providerSession
            $removed=$absent.status -eq 404 -and $profile.status -eq 200 -and @($profile.data | Where-Object {$null -ne $_}).Count -eq 0 -and $proof.status -eq 200 -and @($proof.data | Where-Object {$null -ne $_}).Count -eq 0
            if($removed){$f.state='deleted'}
        }catch{$removed=$false}}
        $checks.Add([pscustomobject]@{name="Exact $($f.kind) Auth profile and invitation fixture removed";pass=$removed})
        if($removed){Write-Output "PASS: Exact $($f.kind) Auth profile and invitation fixture removed"}else{Write-Output "STOPPED: $($f.kind) fixture needs controlled review. Do not rerun."}
    }
    Save-ResumeJournal
    [pscustomobject]@{date=[DateTime]::UtcNow.ToString('o');scope='Private production normal invitation and incomplete setup recovery; one service-created orphan is fixture setup only; no identities credentials links or user records saved; audit history retained';results=@($checks.ToArray())} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $root 'docs/module-2-evidence/production-staff-resume-admin.json')
    $credential=$null;$secure=$null;$staffCredential=$null;$staffSecure=$null;$headers=$null;$config=$null;$r=$null;$events=$null;$email=$null;$actor=$null
    Write-Output 'Sanitized results saved. Never share passwords, email links, keys or the private journal.'
}
