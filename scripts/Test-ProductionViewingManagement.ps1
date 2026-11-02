# Run ONLY after approved Module 6 production release, both migrations and fixture/notification-audience approval.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$origin='https://bedos-construction-platform.vercel.app';$provider='https://zjdqomckldeipigqqfqm.supabase.co'
$directory=Join-Path $root 'docs/module-6-evidence';$privatePath=Join-Path $directory 'private-viewing-fixtures.json'
if(Test-Path -LiteralPath $privatePath){$previous=Get-Content -LiteralPath $privatePath -Raw|ConvertFrom-Json;if($previous.state -ne 'complete'){throw 'Previous viewing fixtures need controlled review. Do not rerun.'}}
# BEGIN FIXTURE CONFIG
$config=@{};foreach($line in Get-Content -LiteralPath (Join-Path $root '.env.local')){if($line -match '^\s*(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$'){$config[$Matches[1]]=$Matches[2].Trim().Trim([char]34).Trim([char]39)}}
$linked=(Get-Content -Raw -LiteralPath (Join-Path $root 'supabase/.temp/project-ref')).Trim()
# END FIXTURE CONFIG
if($linked -ne 'zjdqomckldeipigqqfqm' -or $config.NEXT_PUBLIC_SUPABASE_URL.TrimEnd('/') -ne $provider -or -not $config.SUPABASE_SERVICE_ROLE_KEY){throw 'Viewing fixture production target guard failed.'}
$serviceHeaders=@{apikey=$config.SUPABASE_SERVICE_ROLE_KEY;Authorization="Bearer $($config.SUPABASE_SERVICE_ROLE_KEY)"}
$adminSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession;$anonymous=New-Object Microsoft.PowerShell.Commands.WebRequestSession;$providerSession=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$checks=New-Object System.Collections.Generic.List[object];$fixtures=New-Object System.Collections.Generic.List[object];$customers=New-Object System.Collections.Generic.List[object]
$prefix='bedos-viewing-'+[Guid]::NewGuid().ToString('N');$actor=$null;$loggedIn=$false;$notificationCleanupDone=$false;$eventProof=@();$stage='administrator login';$lastStatus=$null;$credential=$null;$secure=$null
. (Join-Path $PSScriptRoot 'lib/ProductionVerification.ps1')
function Viewing-Request([string]$Path,[string]$Method='GET',[object]$Payload=$null,[object]$Session=$adminSession,[bool]$UseProvider=$false){
    $base=$origin;if($UseProvider){$base=$provider;if($Path -notmatch '^/(auth/v1/admin/users|rest/v1/notifications)'){throw 'Provider fixture path guard failed'}}elseif(-not $Path.StartsWith('/api/')){throw 'Viewing backend path guard failed'}
    $r=Invoke-BedosVerificationRequest -Base $base -Origin $origin -Provider $provider -Path $Path -Method $Method -Payload $Payload -Session $Session -ProviderHeaders $serviceHeaders;$script:lastStatus=$r.status;return $r
}
function Assert-Viewing([string]$Name,[bool]$Pass){$checks.Add([pscustomobject]@{name=$Name;pass=$Pass});if(-not $Pass){throw 'Viewing verification stopped'};Write-Host "PASS: $Name"}
function Save-ViewingJournal {
    $complete=$notificationCleanupDone -and @($fixtures.ToArray()|Where-Object {$_.state -ne 'deleted'}).Count -eq 0
    if(-not(Test-Path -LiteralPath $directory)){New-Item -ItemType Directory -Path $directory|Out-Null}
    [pscustomobject]@{state=if($complete){'complete'}else{'review_required'};actor=$actor;fixtures=@($fixtures.ToArray());events=@($eventProof)}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $privatePath -Encoding utf8
}
function New-ViewingCustomer([string]$Label){
    $f=[pscustomobject]@{kind='customer';id=$null;email="$prefix-$Label@bedos-production-viewing-test.invalid";name="Temporary viewing customer $prefix $Label";state='create_requested'};$fixtures.Add($f);Save-ViewingJournal
    $random=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($random);$password=[Convert]::ToBase64String($random)+'aA1!'}finally{$rng.Dispose();[Array]::Clear($random,0,$random.Length)}
    try{
        $r=Viewing-Request '/auth/v1/admin/users' 'POST' @{email=$f.email;password=$password;email_confirm=$true;user_metadata=@{full_name=$f.name}} $providerSession $true
        if($r.status -in @(200,201) -and $r.data.id -match '^[0-9a-f-]{36}$' -and $r.data.email -eq $f.email){$f.id=$r.data.id;$f.state='created';Save-ViewingJournal}
        Assert-Viewing 'Exact disposable customer created without email delivery' ($f.state -eq 'created')
        $r=Viewing-Request "/api/users/$($f.id)";Assert-Viewing 'Fixture is exact active ordinary customer' ($r.status -eq 200 -and $r.data.user.email -eq $f.email -and $r.data.user.full_name -eq $f.name -and $r.data.user.role.name -eq 'customer' -and $r.data.user.account_status -eq 'active')
        $session=New-Object Microsoft.PowerShell.Commands.WebRequestSession
        $r=Viewing-Request '/api/auth/login' 'POST' @{email=$f.email;password=$password} $session
        Assert-Viewing 'Dedicated customer backend login' ($r.status -eq 200 -and $r.data.user.id -eq $f.id)
        $entry=[pscustomobject]@{fixture=$f;session=$session};$customers.Add($entry);return $entry
    }finally{$password=$null}
}
function New-ViewingProperty([string]$Label){
    $f=[pscustomobject]@{kind='property';id=$null;title="Temporary viewing verification $prefix $Label";slug="$prefix-$Label";state='create_requested'};$fixtures.Add($f);Save-ViewingJournal
    $r=Viewing-Request '/api/properties' 'POST' @{title=$f.title;slug=$f.slug;property_type='verification';listing_type='verification';description='Temporary viewing verification. Not a real property offer.'}
    if($r.status -eq 201 -and $r.data.property.title -eq $f.title -and $r.data.property.slug -eq $f.slug -and $r.data.property.created_by -eq $actor){$f.id=$r.data.property.id;$f.state='created';Save-ViewingJournal}
    Assert-Viewing 'Dedicated draft property created' ($f.state -eq 'created' -and $r.data.property.status -eq 'draft');return $f
}
function New-Viewing([object]$Property,[object]$Customer,[string]$Label){
    $f=[pscustomobject]@{kind='viewing';id=$null;parent=$Property.id;customer=$Customer.fixture.id;version=$null;message="Temporary viewing verification $prefix $Label";state='create_requested'};$fixtures.Add($f);Save-ViewingJournal
    $r=Viewing-Request "/api/properties/$($Property.id)/viewing-requests" 'POST' @{message=$f.message;preferred_date='2027-01-15'} $Customer.session
    if($r.status -eq 201 -and $r.data.data.id -match '^[0-9a-f-]{36}$' -and $r.data.data.property_id -eq $f.parent -and $r.data.data.customer_id -eq $f.customer){$f.id=$r.data.data.id;$f.version=$r.data.data.version;$f.state='created';Save-ViewingJournal}
    Assert-Viewing 'Exact new versioned viewing created for fixture customer' ($f.state -eq 'created' -and $f.version -eq 1 -and $r.data.data.status -eq 'new');return $f
}
function Edit-Viewing([object]$Fixture,[hashtable]$Fields,[object]$Session=$adminSession){
    $body=@{expected_version=$Fixture.version};foreach($k in $Fields.Keys){$body[$k]=$Fields[$k]}
    $r=Viewing-Request "/api/properties/$($Fixture.parent)/viewing-requests/$($Fixture.id)" 'PATCH' $body $Session
    if($r.status -eq 200 -and $r.data.data.id -eq $Fixture.id -and $r.data.data.version -eq ($Fixture.version+1)){$Fixture.version=$r.data.data.version;Save-ViewingJournal}
    elseif($null -eq $r.status -or $r.status -ge 500){$Fixture.state='mutation_unknown';Save-ViewingJournal;throw 'Viewing mutation outcome needs controlled review'}
    return $r
}
try{
    Write-Host 'Creates two disposable customers, two temporary properties and two viewings. No emails, uploads or real customer records.'
    Write-Host 'Real IN-APP test notifications will reach active authorized administrator/sales staff and the disposable customers; exact fixture notifications are removed afterward. Audits and event history remain.'
    $email=(Read-Host 'Existing administrator email').Trim().ToLowerInvariant();$secure=Read-Host 'Administrator password (hidden; never send in chat)' -AsSecureString;$credential=New-Object System.Management.Automation.PSCredential($email,$secure)
    $r=Viewing-Request '/api/auth/login' 'POST' @{email=$email;password=$credential.GetNetworkCredential().Password};Assert-Viewing 'Administrator login' ($r.status -eq 200);$loggedIn=$true;$actor=$r.data.user.id
    $r=Viewing-Request '/api/auth/me';Assert-Viewing 'Expected active administrator session' ($r.status -eq 200 -and $r.data.user.id -eq $actor -and $r.data.role.name -eq 'administrator' -and $r.data.profile.account_status -eq 'active')
    $r=Viewing-Request '/auth/v1/admin/users/00000000-0000-4000-8000-000000000000' 'GET' $null $providerSession $true;Assert-Viewing 'Backend fixture authentication verified before creation' ($r.status -eq 404)
    $stage='dedicated fixture setup';$one=New-ViewingCustomer 'one';$two=New-ViewingCustomer 'two';$property=New-ViewingProperty 'gallery';$draft=New-ViewingProperty 'draft'
    $r=Viewing-Request "/api/properties/$($property.id)/status" 'PATCH' @{status='published';expected_status='draft';reason='Dedicated production viewing verification'};Assert-Viewing 'Dedicated property published' ($r.status -eq 200)
    $r=Viewing-Request "/api/properties/$($draft.id)/viewing-requests" 'POST' @{} $one.session;Assert-Viewing 'Unpublished property rejects new viewing' ($r.status -eq 409)
    $first=New-Viewing $property $one 'one';$second=New-Viewing $property $two 'two';$path="/api/properties/$($property.id)/viewing-requests/$($first.id)"
    $stage='isolation validation and editing'
    $r=Viewing-Request '/api/viewing-requests' 'GET' $null $one.session;Assert-Viewing 'Customer scoped list and count' ($r.status -eq 200 -and $r.data.pagination.total -eq 1 -and $r.data.data[0].id -eq $first.id -and $r.cache -match 'no-store')
    $r=Viewing-Request $path 'GET' $null $two.session;Assert-Viewing 'Foreign customer detail hidden' ($r.status -eq 404)
    $r=Viewing-Request "/api/properties/$($draft.id)/viewing-requests/$($first.id)";Assert-Viewing 'Cross-property detail hidden' ($r.status -eq 404)
    $r=Viewing-Request $path 'PATCH' @{expected_version=1;message='Anonymous attempt'} $anonymous;Assert-Viewing 'Anonymous viewing mutation denied' ($r.status -eq 401)
    $r=Viewing-Request '/api/viewing-requests/notification-events' 'GET' $null $one.session;Assert-Viewing 'Customer recovery queue denied' ($r.status -eq 403)
    $r=Viewing-Request $path 'PATCH' @{message='Missing version'} $one.session;Assert-Viewing 'Missing mutation version rejected' ($r.status -eq 400)
    $r=Viewing-Request "/api/properties/$($property.id)/viewing-requests" 'POST' @{preferred_date='2026-02-29'} $one.session;Assert-Viewing 'Invalid calendar date rejected' ($r.status -eq 400)
    $r=Viewing-Request '/api/viewing-requests?limit=101';Assert-Viewing 'Excessive viewing page size rejected' ($r.status -eq 400)
    $r=Viewing-Request '/api/viewing-requests?page=1&page=2';Assert-Viewing 'Repeated viewing query rejected' ($r.status -eq 400)
    $r=Edit-Viewing $first @{message=$first.message;preferred_time='10:30'} $one.session;Assert-Viewing 'Owner edits own new preferences' ($r.status -eq 200 -and $first.version -eq 2)
    $r=Viewing-Request $path 'PATCH' @{expected_version=1;message='Stale edit'} $one.session;Assert-Viewing 'Stale edit rejected' ($r.status -eq 409)
    $r=Edit-Viewing $first @{status='contacted';assigned_to=$actor};Assert-Viewing 'Administrator contacts and assigns atomically' ($r.status -eq 200 -and $first.version -eq 3 -and $r.data.data.assigned_to -eq $actor)
    $r=Viewing-Request $path 'PATCH' @{expected_version=3;message='Late edit'} $one.session;Assert-Viewing 'Customer editing ends after staff processing' ($r.status -eq 403)
    $r=Edit-Viewing $first @{status='scheduled'};Assert-Viewing 'Canonical scheduled status confirmed with date time and assignee' ($r.status -eq 200 -and $r.data.data.status -eq 'scheduled' -and $first.version -eq 4)
    $r=Viewing-Request $path 'PATCH' @{expected_version=4;status='in_progress'};Assert-Viewing 'Legacy in-progress status rejected' ($r.status -eq 400)
    $r=Edit-Viewing $first @{preferred_time='11:30'};Assert-Viewing 'Scheduled viewing can be rescheduled by staff' ($r.status -eq 200 -and $first.version -eq 5)
    $r=Viewing-Request "/api/properties/$($property.id)" 'DELETE';Assert-Viewing 'Property deletion blocked by viewing references' ($r.status -eq 409)
    $r=Viewing-Request "/api/properties/$($property.id)/status" 'PATCH' @{status='unavailable';expected_status='published';reason='Dedicated viewing withdrawal verification'};Assert-Viewing 'Dedicated property withdrawn' ($r.status -eq 200)
    $r=Viewing-Request "/api/properties/$($property.id)/viewing-requests" 'POST' @{} $one.session;Assert-Viewing 'Withdrawal prevents new request' ($r.status -eq 409)
    $r=Viewing-Request $path 'GET' $null $one.session;Assert-Viewing 'Existing viewing stays visible after withdrawal' ($r.status -eq 200 -and $r.data.data.version -eq 5)
    $r=Edit-Viewing $first @{status='completed'};Assert-Viewing 'Existing scheduled viewing can complete after withdrawal' ($r.status -eq 200 -and $first.version -eq 6)
    $r=Viewing-Request $path 'PATCH' @{expected_version=6;message='Terminal edit'};Assert-Viewing 'Completed viewing is immutable' ($r.status -eq 409)
    $r=Edit-Viewing $second @{status='cancelled'} $two.session;Assert-Viewing 'Owner cancels own new viewing' ($r.status -eq 200 -and $second.version -eq 2)
    $r=Viewing-Request ($path+'?expected_version=5') 'DELETE';Assert-Viewing 'Stale viewing deletion rejected' ($r.status -eq 409)
}catch{$checks.Add([pscustomobject]@{name='Production viewing verification stopped';pass=$false;stage=$stage;http_status=$lastStatus});Write-Host "STOPPED: $stage (HTTP $lastStatus). Share PASS/STOPPED and logout lines only."}
finally{
    if($loggedIn){
        foreach($f in @($fixtures.ToArray()|Where-Object {$_.kind -eq 'viewing' -and $_.state -eq 'created'})){
            try{$path="/api/properties/$($f.parent)/viewing-requests/$($f.id)";$r=Viewing-Request $path;if($r.status -ne 200 -or $r.data.data.id -ne $f.id -or $r.data.data.customer_id -ne $f.customer -or $r.data.data.property_id -ne $f.parent -or $r.data.data.version -ne $f.version -or $r.data.data.message -ne $f.message){throw 'Exact viewing cleanup guard failed'}
                $f.state='delete_requested';Save-ViewingJournal;$r=Viewing-Request ($path+"?expected_version=$($f.version)") 'DELETE';Assert-Viewing 'Exact disposable viewing removed' ($r.status -eq 200);$f.state='deleted';Save-ViewingJournal
            }catch{$checks.Add([pscustomobject]@{name='Exact viewing cleanup needs review';pass=$false});Write-Host 'STOPPED: Viewing cleanup needs controlled review. Do not rerun.'}
        }
        try{
            $viewingIds=@($fixtures.ToArray()|Where-Object {$_.kind -eq 'viewing' -and $_.id}|ForEach-Object {$_.id});$collected=New-Object System.Collections.Generic.List[object];$page=1
            do{$r=Viewing-Request "/api/viewing-requests/notification-events?limit=100&page=$page";if($r.status -ne 200 -or $page -gt 100){throw 'Bounded event reconciliation failed'};foreach($e in @($r.data.events)){if($e.viewing_id -in $viewingIds){$collected.Add($e)}};$total=$r.data.pagination.total;$page++}while(($page-1)*100 -lt $total)
            foreach($e in $collected){if($e.state -notin @('recorded','suppressed')){$r=Viewing-Request "/api/viewing-requests/notification-events/$($e.id)/retry" 'POST' @{};if($r.status -ne 200 -or $r.data.id -ne $e.id -or $r.data.state -notin @('recorded','suppressed')){throw 'Fixture event pending; needs controlled retry'};$e.state=$r.data.state}}
            $eventProof=@($collected.ToArray());Assert-Viewing 'Exact fixture notification events are terminal' (@($eventProof|Where-Object {$_.state -notin @('recorded','suppressed')}).Count -eq 0);Save-ViewingJournal
            if($viewingIds.Count){
                $filter='?select=id,related_entity_id,metadata&related_entity_type=eq.viewing_request&related_entity_id=in.('+($viewingIds -join ',')+')&limit=1000';$r=Viewing-Request ('/rest/v1/notifications'+$filter) 'GET' $null $providerSession $true
                if($r.status -ne 200 -or @($r.data).Count -ge 1000){throw 'Bounded notification cleanup lookup failed'}
                foreach($n in @($r.data)){if($n.related_entity_id -notin $viewingIds -or $n.metadata.viewing_event_id -notin @($eventProof|ForEach-Object {$_.id})){throw 'Exact notification proof guard failed'}
                    $path="/rest/v1/notifications?id=eq.$($n.id)&related_entity_type=eq.viewing_request&related_entity_id=eq.$($n.related_entity_id)&metadata->>viewing_event_id=eq.$($n.metadata.viewing_event_id)";$r=Viewing-Request $path 'DELETE' $null $providerSession $true;if($r.status -notin @(200,204)){throw 'Notification cleanup outcome needs review'}
                }
                $r=Viewing-Request ('/rest/v1/notifications'+$filter) 'GET' $null $providerSession $true;Assert-Viewing 'Exact fixture in-app notifications removed' ($r.status -eq 200 -and @($r.data|Where-Object {$null -ne $_}).Count -eq 0)
            }
            $notificationCleanupDone=$true;Save-ViewingJournal
        }catch{$checks.Add([pscustomobject]@{name='Notification event reconciliation needs review';pass=$false});Write-Host 'STOPPED: Fixture notification cleanup or event retry needs controlled review. Do not rerun.'}
        foreach($f in @($fixtures.ToArray()|Where-Object {$_.kind -eq 'property' -and $_.state -eq 'created'})){
            try{if(@($fixtures.ToArray()|Where-Object {$_.kind -eq 'viewing' -and $_.parent -eq $f.id -and $_.state -ne 'deleted'}).Count){throw 'Unresolved viewing'};$r=Viewing-Request "/api/properties/$($f.id)";if($r.status -ne 200 -or $r.data.property.title -ne $f.title -or $r.data.property.slug -ne $f.slug -or $r.data.property.created_by -ne $actor){throw 'Exact property guard failed'};$f.state='delete_requested';Save-ViewingJournal;$r=Viewing-Request "/api/properties/$($f.id)" 'DELETE';Assert-Viewing 'Exact disposable property removed' ($r.status -eq 200);$f.state='deleted';Save-ViewingJournal
            }catch{$checks.Add([pscustomobject]@{name='Exact property cleanup needs review';pass=$false});Write-Host 'STOPPED: Property cleanup needs controlled review. Do not rerun.'}
        }
        foreach($entry in $customers){try{$r=Viewing-Request '/api/auth/logout' 'POST' $null $entry.session;Assert-Viewing 'Dedicated customer logout' ($r.status -eq 200)}catch{$checks.Add([pscustomobject]@{name='Customer logout failed';pass=$false})}}
        foreach($f in @($fixtures.ToArray()|Where-Object {$_.kind -eq 'customer' -and $_.state -eq 'created'})){
            try{if(@($fixtures.ToArray()|Where-Object {$_.kind -eq 'viewing' -and $_.customer -eq $f.id -and $_.state -ne 'deleted'}).Count){throw 'Unresolved customer viewing'};$r=Viewing-Request "/auth/v1/admin/users/$($f.id)" 'GET' $null $providerSession $true;if($f.id -eq $actor -or $r.status -ne 200 -or $r.data.id -ne $f.id -or $r.data.email -ne $f.email -or $r.data.user_metadata.full_name -ne $f.name){throw 'Exact disposable customer guard failed'};$f.state='delete_requested';Save-ViewingJournal;$r=Viewing-Request "/auth/v1/admin/users/$($f.id)" 'DELETE' $null $providerSession $true;Assert-Viewing 'Exact disposable customer removed' ($r.status -in @(200,204));$f.state='deleted';Save-ViewingJournal
            }catch{$checks.Add([pscustomobject]@{name='Exact customer cleanup needs review';pass=$false});Write-Host 'STOPPED: Customer cleanup needs controlled review. Do not rerun.'}
        }
        try{$r=Viewing-Request '/api/auth/logout' 'POST';$checks.Add([pscustomobject]@{name='Administrator logout';pass=($r.status -eq 200);http_status=$r.status});Write-Host "Administrator logout HTTP: $($r.status)"}catch{$checks.Add([pscustomobject]@{name='Administrator logout failed';pass=$false})}
    }
    $credential=$null;$secure=$null;$email=$null;$serviceHeaders.Clear();$config.Clear();if($actor){Save-ViewingJournal}
    if(-not(Test-Path -LiteralPath $directory)){New-Item -ItemType Directory -Path $directory|Out-Null}
    [pscustomobject]@{date=[DateTime]::UtcNow.ToString('o');scope='Production viewing workflow; exact identities and event IDs remain private';results=@($checks.ToArray())}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $directory 'production-viewing-admin.json') -Encoding utf8
    Write-Host 'Sanitized results saved. Never share credentials or the private fixture journal.'
}
