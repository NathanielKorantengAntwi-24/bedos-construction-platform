# Run only after approved Module 3 deployment and both database phases are verified.
# Uses real backend APIs; no Auth fixtures, email links or service-role credentials.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$origin='https://bedos-construction-platform.vercel.app';$provider='https://zjdqomckldeipigqqfqm.supabase.co'
$directory=Join-Path $root 'docs/module-3-evidence'
$privatePath=Join-Path $directory 'private-catalog-fixtures.json'
if(Test-Path -LiteralPath $privatePath){$old=Get-Content -LiteralPath $privatePath -Raw | ConvertFrom-Json;if($old.state -ne 'complete'){throw 'Prior catalog fixtures need controlled review. Do not rerun.'}}
$session=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$anonymous=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$checks=New-Object System.Collections.Generic.List[object]
$fixtures=New-Object System.Collections.Generic.List[object]
$prefix='bedos-catalog-'+[Guid]::NewGuid().ToString('N')
$stage='administrator login';$lastStatus=$null;$loggedIn=$false;$credential=$null;$secure=$null;$actor=$null
. (Join-Path $PSScriptRoot 'lib/ProductionVerification.ps1')
function Catalog-Request([string]$Path,[string]$Method='GET',[object]$Payload=$null,[bool]$Public=$false){
    if(-not $Path.StartsWith('/api/')){throw 'Backend API path guard failed'}
    $jar=$session;if($Public){$jar=$anonymous}
    $r=Invoke-BedosVerificationRequest -Base $origin -Origin $origin -Provider $provider -Path $Path -Method $Method -Payload $Payload -Session $jar -ProviderHeaders @{}
    $script:lastStatus=$r.status;return $r
}
function Assert-Catalog([string]$Name,[bool]$Pass){$checks.Add([pscustomobject]@{name=$Name;pass=$Pass});if(-not $Pass){throw 'Catalog verification stopped'};Write-Host "PASS: $Name"}
function Save-CatalogJournal {
    $complete=@($fixtures.ToArray() | Where-Object {$_.state -ne 'deleted'}).Count -eq 0
    [pscustomobject]@{state=if($complete){'complete'}else{'review_required'};actor=$actor;fixtures=@($fixtures.ToArray())} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $privatePath -Encoding utf8
}
function New-CatalogFixture([string]$Kind,[string]$Label,[hashtable]$Extra=@{}){
    $f=[pscustomobject]@{kind=$Kind;id=$null;name="Temporary verification $prefix $Label";slug="$prefix-$Label";state='create_requested'}
    $fixtures.Add($f);Save-CatalogJournal
    $body=@{name=$f.name;slug=$f.slug;description='Temporary backend verification record. Not a real service offer.'};foreach($key in $Extra.Keys){$body[$key]=$Extra[$key]}
    $r=Catalog-Request "/api/$Kind" 'POST' $body
    $record=$null;if($Kind -eq 'services'){$record=$r.data.service}else{$record=$r.data.category}
    if($r.status -eq 201 -and $record.slug -eq $f.slug -and $record.name -eq $f.name -and $record.id -match '^[0-9a-f-]{36}$'){$f.id=$record.id;$f.state='created';Save-CatalogJournal}
    Assert-Catalog "Dedicated $Label fixture created" ($f.state -eq 'created')
    return $f
}
try{
    Write-Host 'This test briefly publishes clearly labelled temporary services, then removes its exact services/categories. Audit history is retained.'
    Write-Host 'No email steps and no new login accounts. Enter only your existing administrator credentials privately.'
    $email=(Read-Host 'Existing administrator email').Trim().ToLowerInvariant()
    $secure=Read-Host 'Administrator password (hidden; never send in chat)' -AsSecureString
    $credential=New-Object System.Management.Automation.PSCredential($email,$secure)
    $r=Catalog-Request '/api/auth/login' 'POST' @{email=$email;password=$credential.GetNetworkCredential().Password}
    Assert-Catalog 'Administrator login' ($r.status -eq 200);$loggedIn=$true
    $r=Catalog-Request '/api/auth/me'
    Assert-Catalog 'Expected active administrator session' ($r.status -eq 200 -and $r.data.user.email -eq $email -and $r.data.role.name -eq 'administrator' -and $r.data.profile.account_status -eq 'active')
    $actor=$r.data.user.id
    $stage='catalog fixture setup'
    $visible=New-CatalogFixture 'service-categories' 'visible-category'
    $hidden=New-CatalogFixture 'service-categories' 'hidden-category'
    $draft=New-CatalogFixture 'services' 'draft' @{category_id=$visible.id}
    $published=New-CatalogFixture 'services' 'published' @{category_id=$visible.id;status='published';featured=$true}
    $archived=New-CatalogFixture 'services' 'archived' @{category_id=$hidden.id;status='archived'}
    $stage='catalog read and publication checks'
    $r=Catalog-Request "/api/services?q=$prefix"
    Assert-Catalog 'Administrator sees all dedicated publication states' ($r.status -eq 200 -and $r.data.pagination.total -eq 3 -and @($r.data.services).Count -eq 3)
    Assert-Catalog 'Staff list not cacheable' ($r.cache -match 'no-store')
    $r=Catalog-Request "/api/services/$($draft.id)"
    Assert-Catalog 'Draft defaults and actor are correct' ($r.status -eq 200 -and $r.data.service.status -eq 'draft' -and $r.data.service.featured -eq $false -and $r.data.service.created_by -eq $actor)
    $r=Catalog-Request "/api/public/services?q=$prefix" 'GET' $null $true
    Assert-Catalog 'Public list contains only dedicated published service' ($r.status -eq 200 -and $r.data.pagination.total -eq 1 -and @($r.data.services).Count -eq 1 -and $r.data.services[0].id -eq $published.id)
    Assert-Catalog 'Public service exposes exact approved fields' ((($r.data.services[0].PSObject.Properties.Name | Sort-Object)-join ',') -eq 'category_id,description,featured,id,name,slug')
    Assert-Catalog 'Public publication response not cacheable' ($r.cache -match 'no-store')
    $r=Catalog-Request "/api/public/service-categories?q=$prefix" 'GET' $null $true
    Assert-Catalog 'Public categories hide unpublished-only category' ($r.status -eq 200 -and $r.data.pagination.total -eq 1 -and $r.data.categories[0].id -eq $visible.id)
    Assert-Catalog 'Public category exposes exact approved fields' ((($r.data.categories[0].PSObject.Properties.Name | Sort-Object)-join ',') -eq 'description,id,name,slug')
    foreach($f in @($draft,$archived)){$r=Catalog-Request "/api/public/services/$($f.slug)" 'GET' $null $true;Assert-Catalog 'Unpublished service detail hidden' ($r.status -eq 404)}
    $r=Catalog-Request "/api/public/services/$($published.slug)" 'GET' $null $true
    Assert-Catalog 'Published public detail identity' ($r.status -eq 200 -and $r.data.service.id -eq $published.id)
    $r=Catalog-Request "/api/services?q=$prefix&page=2&page_size=3"
    Assert-Catalog 'Empty page retains exact filtered count' ($r.status -eq 200 -and @($r.data.services).Count -eq 0 -and $r.data.pagination.total -eq 3)
    foreach($case in @(@('/api/public/services?status=draft',$true),@('/api/services?page_size=101',$false),@('/api/services?page=1&page=2',$false),@('/api/services/invalid',$false))){$r=Catalog-Request $case[0] 'GET' $null $case[1];Assert-Catalog 'Invalid catalog query or ID rejected' ($r.status -eq 400)}
    $r=Catalog-Request '/api/services' 'GET' $null $true
    Assert-Catalog 'Anonymous staff read denied' ($r.status -eq 401)
    $r=Catalog-Request "/api/services/$($draft.id)" 'PATCH' @{status='published'} $true
    Assert-Catalog 'Anonymous catalog mutation denied' ($r.status -eq 401)
    $r=Catalog-Request "/api/services/$($draft.id)" 'PATCH' @{}
    Assert-Catalog 'Empty update rejected' ($r.status -eq 400)
    $r=Catalog-Request '/api/services' 'POST' @{name='Duplicate verification';slug=$draft.slug}
    Assert-Catalog 'Duplicate service slug rejected' ($r.status -eq 409)
    $r=Catalog-Request "/api/services/$($draft.id)" 'PATCH' @{featured='false'}
    Assert-Catalog 'Wrong field type rejected' ($r.status -eq 400)
    $r=Catalog-Request "/api/services/$($draft.id)" 'PATCH' @{status='published';featured=$false;description=' Updated verification description '}
    Assert-Catalog 'Partial edit and publication succeed' ($r.status -eq 200 -and $r.data.service.status -eq 'published' -and $r.data.service.featured -eq $false -and $r.data.service.description -eq 'Updated verification description' -and $r.data.service.created_by -eq $actor)
    $r=Catalog-Request "/api/public/services?q=$prefix&featured=false" 'GET' $null $true
    Assert-Catalog 'Public filters reflect immediate publication' ($r.status -eq 200 -and $r.data.pagination.total -eq 1 -and $r.data.services[0].id -eq $draft.id)
    $stage='category deletion compatibility'
    $r=Catalog-Request "/api/services?category_id=$($visible.id)"
    Assert-Catalog 'Only exact test services reference disposable category' ($r.status -eq 200 -and $r.data.pagination.total -eq 2 -and @($r.data.services | Where-Object {$_.id -notin @($draft.id,$published.id)}).Count -eq 0)
    $r=Catalog-Request "/api/service-categories/$($visible.id)" 'DELETE'
    Assert-Catalog 'Administrator deletes exact disposable category' ($r.status -eq 200);$visible.state='deleted';Save-CatalogJournal
    $r=Catalog-Request "/api/services/$($draft.id)"
    Assert-Catalog 'Category deletion retains service and clears relationship' ($r.status -eq 200 -and $null -eq $r.data.service.category_id)
    $stage='service deletion and public withdrawal'
    $r=Catalog-Request "/api/services/$($published.id)" 'DELETE'
    Assert-Catalog 'Administrator deletes exact disposable service' ($r.status -eq 200);$published.state='deleted';Save-CatalogJournal
    $r=Catalog-Request "/api/public/services/$($published.slug)" 'GET' $null $true
    Assert-Catalog 'Deleted service immediately unavailable publicly' ($r.status -eq 404)
    $r=Catalog-Request ("/api/services/"+[Guid]::NewGuid().ToString())
    Assert-Catalog 'Missing service returns 404' ($r.status -eq 404)
}catch{$checks.Add([pscustomobject]@{name="Stopped at $stage";pass=$false;http_status=$lastStatus;error_type=$_.Exception.GetType().Name;script_line=$_.InvocationInfo.ScriptLineNumber});Write-Host "STOPPED: $stage (HTTP $lastStatus). Share PASS/STOPPED lines only."}
finally{
    # Cleanup uses the still-authenticated admin API; logout follows cleanup.
    foreach($kind in @('services','service-categories')){
        foreach($f in @($fixtures.ToArray() | Where-Object {$_.kind -eq $kind -and $_.state -ne 'deleted'})){
            try{
                if(-not $loggedIn -or -not $f.id -or $f.id -notmatch '^[0-9a-f-]{36}$'){throw 'Uncertain creation outcome requires controlled review'}
                $r=Catalog-Request "/api/$kind/$($f.id)"
                if($r.status -eq 404){$f.state='deleted';Save-CatalogJournal;continue}
                $record=$null;if($kind -eq 'services'){$record=$r.data.service}else{$record=$r.data.category}
                if($r.status -ne 200 -or $record.id -ne $f.id -or $record.slug -ne $f.slug -or $record.name -ne $f.name -or ($kind -eq 'services' -and $record.created_by -ne $actor)){throw 'Exact fixture identity guard failed'}
                if($kind -eq 'service-categories'){$related=Catalog-Request "/api/services?category_id=$($f.id)";if($related.status -ne 200 -or $related.data.pagination.total -ne 0){throw 'Category still has references; controlled review required'}}
                $r=Catalog-Request "/api/$kind/$($f.id)" 'DELETE'
                if($r.status -ne 200){throw 'Fixture deletion failed'}
                $r=Catalog-Request "/api/$kind/$($f.id)"
                Assert-Catalog 'Exact disposable catalog fixture removed' ($r.status -eq 404)
                $f.state='deleted';Save-CatalogJournal
            }catch{$checks.Add([pscustomobject]@{name='Exact fixture cleanup requires review';pass=$false});Write-Host 'STOPPED: Fixture cleanup needs controlled review. Do not rerun.'}
        }
    }
    Save-CatalogJournal
    if($loggedIn){$r=Catalog-Request '/api/auth/logout' 'POST';$checks.Add([pscustomobject]@{name='Administrator logout';pass=($r.status -eq 200);http_status=$r.status});Write-Host "Administrator logout HTTP: $($r.status)"}
    [pscustomobject]@{date=[DateTime]::UtcNow.ToString('o');scope='Private user-run backend/public catalog acceptance; exact disposable content removed; no Auth accounts created; audits retained; no identities links credentials or records in this report';results=@($checks.ToArray())} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $directory 'production-catalog-admin.json') -Encoding utf8
    $credential=$null;$secure=$null;$email=$null;$actor=$null;$r=$null;$session=$null;$anonymous=$null
    Write-Host 'Sanitized results saved. Share only PASS/STOPPED and logout lines; never the private journal or credentials.'
}
