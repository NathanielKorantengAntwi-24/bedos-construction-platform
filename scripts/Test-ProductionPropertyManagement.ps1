# Run only after approved Module 4 deployment and both database phases are verified.
# Uses real backend APIs; no Auth fixtures, email links or service-role credentials.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$origin='https://bedos-construction-platform.vercel.app';$provider='https://zjdqomckldeipigqqfqm.supabase.co'
$directory=Join-Path $root 'docs/module-4-evidence'
$privatePath=Join-Path $directory 'private-property-fixtures.json'
if(Test-Path -LiteralPath $privatePath){$old=Get-Content -LiteralPath $privatePath -Raw | ConvertFrom-Json;if($old.state -ne 'complete'){throw 'Prior property fixtures need controlled review. Do not rerun.'}}
$session=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$anonymous=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$checks=New-Object System.Collections.Generic.List[object]
$fixtures=New-Object System.Collections.Generic.List[object]
$prefix='bedos-property-'+[Guid]::NewGuid().ToString('N')
$stage='administrator login';$lastStatus=$null;$loggedIn=$false;$credential=$null;$secure=$null;$actor=$null
. (Join-Path $PSScriptRoot 'lib/ProductionVerification.ps1')
function Property-Request([string]$Path,[string]$Method='GET',[object]$Payload=$null,[bool]$Public=$false){
    if(-not $Path.StartsWith('/api/')){throw 'Backend API path guard failed'}
    $jar=$session;if($Public){$jar=$anonymous}
    $r=Invoke-BedosVerificationRequest -Base $origin -Origin $origin -Provider $provider -Path $Path -Method $Method -Payload $Payload -Session $jar -ProviderHeaders @{}
    $script:lastStatus=$r.status;return $r
}
function Assert-Property([string]$Name,[bool]$Pass){$checks.Add([pscustomobject]@{name=$Name;pass=$Pass});if(-not $Pass){throw 'Property verification stopped'};Write-Host "PASS: $Name"}
function Save-PropertyJournal {
    $complete=@($fixtures.ToArray() | Where-Object {$_.state -ne 'deleted'}).Count -eq 0
    [pscustomobject]@{state=if($complete){'complete'}else{'review_required'};actor=$actor;fixtures=@($fixtures.ToArray())} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $privatePath -Encoding utf8
}
function New-PropertyFixture([string]$Label){
    $f=[pscustomobject]@{id=$null;title="Temporary verification $prefix $Label";slug="$prefix-$Label";state='create_requested'}
    $fixtures.Add($f);Save-PropertyJournal
    $r=Property-Request '/api/properties' 'POST' @{title=$f.title;slug=$f.slug;property_type='verification';listing_type='verification';description='Temporary backend verification. Not a real property offer.';price=123.45;currency='GHS';bedrooms=2;bathrooms=1}
    if($r.status -eq 201 -and $r.data.property.title -eq $f.title -and $r.data.property.slug -eq $f.slug -and $r.data.property.created_by -eq $actor -and $r.data.property.id -match '^[0-9a-f-]{36}$'){$f.id=$r.data.property.id;$f.state='created';Save-PropertyJournal}
    Assert-Property "Dedicated $Label draft created" ($f.state -eq 'created' -and $r.data.property.status -eq 'draft')
    return $f
}
function Set-PropertyState([object]$Fixture,[string]$Expected,[string]$Status){
    $r=Property-Request "/api/properties/$($Fixture.id)/status" 'PATCH' @{status=$Status;expected_status=$Expected;reason='Dedicated production property verification'}
    Assert-Property "Lifecycle $Expected to $Status" ($r.status -eq 200 -and $r.data.property.status -eq $Status)
}
try {
    Write-Host 'This approved test briefly publishes two clearly labelled temporary properties and removes those exact records. Audit history is retained.'
    Write-Host 'No new accounts, emails, uploads, viewing requests or enquiries are created.'
    $email=(Read-Host 'Existing administrator email').Trim().ToLowerInvariant()
    $secure=Read-Host 'Administrator password (hidden; never send in chat)' -AsSecureString
    $credential=New-Object System.Management.Automation.PSCredential($email,$secure)
    $r=Property-Request '/api/auth/login' 'POST' @{email=$email;password=$credential.GetNetworkCredential().Password}
    Assert-Property 'Administrator login' ($r.status -eq 200);$loggedIn=$true
    $r=Property-Request '/api/auth/me'
    Assert-Property 'Expected active administrator session' ($r.status -eq 200 -and $r.data.user.email -eq $email -and $r.data.role.name -eq 'administrator' -and $r.data.profile.account_status -eq 'active');$actor=$r.data.user.id
    $stage='property fixtures'
    $first=New-PropertyFixture 'lifecycle';$second=New-PropertyFixture 'sale-status'
    $r=Property-Request "/api/properties/manage?search=$prefix"
    Assert-Property 'Administrator sees both drafts' ($r.status -eq 200 -and $r.data.pagination.total -eq 2 -and @($r.data.properties).Count -eq 2)
    Assert-Property 'Management response not cacheable' ($r.cache -match 'no-store')
    $r=Property-Request "/api/properties?search=$prefix" 'GET' $null $true
    Assert-Property 'Public list hides drafts' ($r.status -eq 200 -and $r.data.pagination.total -eq 0)
    $r=Property-Request "/api/properties/$($first.id)" 'GET' $null $true
    Assert-Property 'Public draft detail hidden' ($r.status -eq 404)
    $r=Property-Request "/api/properties/$($first.id)" 'PATCH' @{status='published'}
    Assert-Property 'Ordinary edit cannot change lifecycle' ($r.status -eq 400)
    $r=Property-Request "/api/properties/$($first.id)" 'PATCH' @{featured=$true;city='Verification';description='Temporary verification description'}
    Assert-Property 'Partial specification edit succeeds' ($r.status -eq 200 -and $r.data.property.featured -eq $true -and $r.data.property.price -eq 123.45 -and $r.data.property.status -eq 'draft')
    Set-PropertyState $first 'draft' 'published'
    $r=Property-Request "/api/properties?search=$prefix&featured=true&min_price=123&max_price=124&min_bedrooms=2&max_bathrooms=1&city=Verification" 'GET' $null $true
    Assert-Property 'Combined public filters and publication' ($r.status -eq 200 -and $r.data.pagination.total -eq 1 -and $r.data.properties[0].id -eq $first.id)
    $r=Property-Request "/api/properties/$($first.id)" 'GET' $null $true
    $fields='address,bathrooms,bedrooms,city,created_at,currency,description,featured,floor_area,id,land_area,listing_type,location,price,property_type,region,slug,status,title,updated_at'
    Assert-Property 'Public detail exact approved fields' ($r.status -eq 200 -and (($r.data.property.PSObject.Properties.Name | Sort-Object)-join ',') -eq $fields)
    Assert-Property 'Public detail not cacheable' ($r.cache -match 'no-store')
    $r=Property-Request "/api/properties/manage?search=$prefix&page=2&limit=2"
    Assert-Property 'Empty page retains count' ($r.status -eq 200 -and @($r.data.properties).Count -eq 0 -and $r.data.pagination.total -eq 2)
    foreach($path in @('/api/properties?status=draft','/api/properties?limit=101','/api/properties?page=1&page=2','/api/properties/invalid')){$r=Property-Request $path 'GET' $null $true;Assert-Property 'Invalid property query or ID rejected' ($r.status -eq 400)}
    $r=Property-Request '/api/properties/manage' 'GET' $null $true
    Assert-Property 'Anonymous management denied' ($r.status -eq 401)
    $r=Property-Request "/api/properties/$($first.id)/status" 'PATCH' @{status='reserved';expected_status='published';reason='Unauthorized test'} $true
    Assert-Property 'Anonymous status mutation denied' ($r.status -eq 401)
    $r=Property-Request "/api/properties/$($first.id)/status" 'PATCH' @{status='reserved';expected_status='draft';reason='Stale verification'}
    Assert-Property 'Stale lifecycle rejected' ($r.status -eq 409)
    Set-PropertyState $first 'published' 'reserved'
    $r=Property-Request "/api/properties/$($first.id)" 'GET' $null $true
    Assert-Property 'Reserved listing hidden publicly' ($r.status -eq 404)
    Set-PropertyState $first 'reserved' 'published'
    Set-PropertyState $first 'published' 'unavailable'
    Set-PropertyState $first 'unavailable' 'archived'
    Set-PropertyState $first 'archived' 'draft'
    Set-PropertyState $second 'draft' 'published'
    Set-PropertyState $second 'published' 'sold'
    $r=Property-Request "/api/properties/$($second.id)/status" 'PATCH' @{status='published';expected_status='sold';reason='Invalid reopening verification'}
    Assert-Property 'Sold listing cannot republish directly' ($r.status -eq 409)
    Set-PropertyState $second 'sold' 'archived'
} catch {
    $checks.Add([pscustomobject]@{name='Property verification stopped';pass=$false;stage=$stage;http_status=$lastStatus})
    Write-Host "STOPPED: $stage (HTTP $lastStatus). Share PASS/STOPPED lines only."
} finally {
    if($loggedIn){
        foreach($f in $fixtures.ToArray()){
            if($f.state -eq 'created'){
                try {
                    $r=Property-Request "/api/properties/$($f.id)"
                    if($r.status -ne 200 -or $r.data.property.id -ne $f.id -or $r.data.property.title -ne $f.title -or $r.data.property.slug -ne $f.slug -or $r.data.property.created_by -ne $actor){throw 'Exact fixture guard failed'}
                    $f.state='delete_requested';Save-PropertyJournal
                    $r=Property-Request "/api/properties/$($f.id)" 'DELETE'
                    Assert-Property 'Exact disposable property removed' ($r.status -eq 200 -and $r.data.property_id -eq $f.id)
                    $f.state='deleted';Save-PropertyJournal
                } catch { $checks.Add([pscustomobject]@{name='Exact fixture cleanup requires review';pass=$false});Write-Host 'STOPPED: Exact fixture cleanup needs controlled review. Do not rerun.' }
            }
        }
        try{$r=Property-Request '/api/auth/logout' 'POST';$checks.Add([pscustomobject]@{name='Administrator logout';pass=($r.status -eq 200);http_status=$r.status});Write-Host "Administrator logout HTTP: $($r.status)"}catch{Write-Host 'STOPPED: Logout not verified.';$checks.Add([pscustomobject]@{name='Administrator logout';pass=$false})}
    }
    $credential=$null;$secure=$null;$email=$null
    if(-not (Test-Path -LiteralPath $directory)){New-Item -ItemType Directory -Path $directory | Out-Null}
    if($actor){Save-PropertyJournal}
    [pscustomobject]@{date=[DateTime]::UtcNow.ToString('o');scope='Production administrator property workflow; identifiers only in ignored private journal';results=@($checks.ToArray())} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $directory 'production-property-admin.json') -Encoding utf8
    Write-Host 'Sanitized results saved. Never share credentials or the private fixture journal.'
}
