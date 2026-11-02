# Run only after approved Module 5 deployment and both database phases are verified.
# Uses real backend APIs; no Auth fixtures, email links or service-role credentials.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$origin='https://bedos-construction-platform.vercel.app';$provider='https://zjdqomckldeipigqqfqm.supabase.co'
$directory=Join-Path $root 'docs/module-5-evidence'
$privatePath=Join-Path $directory 'private-media-fixtures.json'
if(Test-Path -LiteralPath $privatePath){$old=Get-Content -LiteralPath $privatePath -Raw | ConvertFrom-Json;if($old.state -ne 'complete'){throw 'Prior property fixtures need controlled review. Do not rerun.'}}
$session=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$anonymous=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$checks=New-Object System.Collections.Generic.List[object]
$fixtures=New-Object System.Collections.Generic.List[object]
$prefix='bedos-media-'+[Guid]::NewGuid().ToString('N')
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
$png=[Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAIAAABChommAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQYlWNgYPhPBGIY6YoA7TJfofQRhCAAAAAASUVORK5CYII=')
function Media-Upload([string]$Path,[hashtable]$Fields,[string]$Key,[byte[]]$FileBytes=$png,[string]$Mime='image/png') {
    if(-not $Path.StartsWith('/api/properties/')){throw 'Upload destination guard failed'}
    $boundary='bedos-'+[Guid]::NewGuid().ToString('N');$stream=New-Object IO.MemoryStream;$bodyBytes=$null
    $write={param([string]$Value) $part=[Text.Encoding]::UTF8.GetBytes($Value);$stream.Write($part,0,$part.Length)}
    try {
        foreach($name in $Fields.Keys){& $write "--$boundary`r`nContent-Disposition: form-data; name=`"$name`"`r`n`r`n$($Fields[$name])`r`n"}
        & $write "--$boundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"fixture.png`"`r`nContent-Type: $Mime`r`n`r`n"
        $stream.Write($FileBytes,0,$FileBytes.Length);& $write "`r`n--$boundary--`r`n";$bodyBytes=$stream.ToArray()
        $response=Invoke-WebRequest -Uri "$origin$Path" -Method Post -WebSession $session -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 60 -ContentType "multipart/form-data; boundary=$boundary" -Headers @{'Idempotency-Key'=$Key} -Body $bodyBytes -ErrorAction Stop
        $script:lastStatus=[int]$response.StatusCode;return [pscustomobject]@{status=[int]$response.StatusCode;data=($response.Content|ConvertFrom-Json);cache=$response.Headers['Cache-Control']}
    } catch {$status=$null;if($_.Exception.Response){$status=[int]$_.Exception.Response.StatusCode};$script:lastStatus=$status;return [pscustomobject]@{status=$status;data=$null;cache=$null}}
    finally {if($bodyBytes){[Array]::Clear($bodyBytes,0,$bodyBytes.Length)};$stream.Dispose()}
}
function Media-File([string]$Path,[bool]$Public=$false){
    if($Path -notmatch '^/api/properties/[0-9a-f-]{36}/(images|floor-plans)/[0-9a-f-]{36}/file$'){throw 'Owned file URL guard failed'}
    $jar=$session;if($Public){$jar=$anonymous}
    try {$r=Invoke-WebRequest -Uri "$origin$Path" -WebSession $jar -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 60 -ErrorAction Stop;$bytes=$r.RawContentStream.ToArray();return [pscustomobject]@{status=[int]$r.StatusCode;type=$r.Headers['Content-Type'];cache=$r.Headers['Cache-Control'];nosniff=$r.Headers['X-Content-Type-Options'];valid_png=($bytes.Length -gt 8 -and $bytes[0] -eq 137 -and $bytes[1] -eq 80)}}
    catch {$status=$null;if($_.Exception.Response){$status=[int]$_.Exception.Response.StatusCode};return [pscustomobject]@{status=$status}}
}
function New-MediaProperty([string]$Label){
    $f=[pscustomobject]@{kind='properties';id=$null;parent=$null;title="Temporary verification $prefix $Label";slug="$prefix-$Label";state='create_requested'};$fixtures.Add($f);Save-PropertyJournal
    $r=Property-Request '/api/properties' 'POST' @{title=$f.title;slug=$f.slug;property_type='verification';listing_type='verification';description='Temporary property media verification. Not a real property offer.'}
    if($r.status -eq 201 -and $r.data.property.title -eq $f.title -and $r.data.property.slug -eq $f.slug -and $r.data.property.created_by -eq $actor){$f.id=$r.data.property.id;$f.state='created';Save-PropertyJournal}
    Assert-Property "Dedicated $Label property created as draft" ($f.state -eq 'created' -and $r.data.property.status -eq 'draft');return $f
}
function New-MediaFixture([object]$Property,[string]$Kind,[string]$Label,[hashtable]$Extra=@{}){
    $f=[pscustomobject]@{kind=$Kind;id=$null;parent=$Property.id;title="Temporary verification $prefix $Label";key=[Guid]::NewGuid().ToString();url=$null;state='create_requested'};$fixtures.Add($f);Save-PropertyJournal
    $single=@{images='image';'floor-plans'='floorPlan';features='feature';amenities='amenity'}[$Kind]
    if($Kind -eq 'images' -or $Kind -eq 'floor-plans'){
        $fields=@{};if($Kind -eq 'images'){$fields.alt_text=$f.title}else{$fields.title=$f.title};foreach($k in $Extra.Keys){$fields[$k]=$Extra[$k]}
        $r=Media-Upload "/api/properties/$($Property.id)/$Kind" $fields $f.key
    }else{$r=Property-Request "/api/properties/$($Property.id)/$Kind" 'POST' @{name=$f.title}}
    $record=$r.data.$single
    if($r.status -eq 201 -and $record.id -match '^[0-9a-f-]{36}$' -and $record.property_id -eq $f.parent){$f.id=$record.id;$f.url=$record.image_url;$f.state='created';Save-PropertyJournal}
    Assert-Property "Dedicated $Label fixture created" ($f.state -eq 'created');return $f
}
try {
    Write-Host 'Creates two temporary properties, two tiny images, one floor plan, one feature and one amenity; removes those exact fixtures. Audit and operation history are retained.'
    Write-Host 'No new accounts, email steps or real customer files. Enter existing administrator credentials privately.'
    $email=(Read-Host 'Existing administrator email').Trim().ToLowerInvariant();$secure=Read-Host 'Administrator password (hidden; never send in chat)' -AsSecureString;$credential=New-Object System.Management.Automation.PSCredential($email,$secure)
    $r=Property-Request '/api/auth/login' 'POST' @{email=$email;password=$credential.GetNetworkCredential().Password};Assert-Property 'Administrator login' ($r.status -eq 200);$loggedIn=$true
    $r=Property-Request '/api/auth/me';Assert-Property 'Expected active administrator session' ($r.status -eq 200 -and $r.data.user.email -eq $email -and $r.data.role.name -eq 'administrator' -and $r.data.profile.account_status -eq 'active');$actor=$r.data.user.id
    $stage='media fixture setup';$property=New-MediaProperty 'gallery';$other=New-MediaProperty 'cross-parent'
    $first=New-MediaFixture $property 'images' 'image-one' @{is_primary='true';display_order='2'}
    $second=New-MediaFixture $property 'images' 'image-two' @{is_primary='true';display_order='1'}
    $plan=New-MediaFixture $property 'floor-plans' 'floor-plan' @{display_order='1'}
    $feature=New-MediaFixture $property 'features' 'feature';$amenity=New-MediaFixture $property 'amenities' 'amenity'
    $stage='media authorization and publication'
    $r=Property-Request "/api/properties/$($property.id)/images?limit=100";Assert-Property 'Administrator previews both draft images' ($r.status -eq 200 -and $r.data.images.Count -eq 2 -and $r.data.pagination.total -eq 2)
    Assert-Property 'Exactly one primary after replacement' (@($r.data.images | Where-Object {$_.is_primary}).Count -eq 1 -and $r.data.images[0].id -eq $second.id -and $r.data.images[0].is_primary)
    Assert-Property 'Gallery response no-store' ($r.cache -match 'no-store')
    Assert-Property 'Metadata uses owned file URLs without storage paths' (@($r.data.images|Where-Object {$_.PSObject.Properties.Name -contains 'storage_path' -or $_.image_url -notlike '/api/properties/*/images/*/file'}).Count -eq 0)
    $r=Property-Request "/api/properties/$($property.id)/images" 'GET' $null $true;Assert-Property 'Anonymous draft gallery hidden' ($r.status -eq 404)
    $r=Media-File $first.url;Assert-Property 'Administrator previews draft file' ($r.status -eq 200 -and $r.valid_png -and $r.type -like 'image/png*' -and $r.nosniff -eq 'nosniff' -and $r.cache -match 'no-store')
    $r=Media-File $first.url $true;Assert-Property 'Anonymous draft file hidden' ($r.status -eq 404)
    $r=Property-Request "/api/properties/$($other.id)/images/$($first.id)" 'PATCH' @{alt_text='Cross-property attempt'};Assert-Property 'Cross-property image edit denied' ($r.status -eq 404)
    $r=Property-Request "/api/properties/$($property.id)/images/$($first.id)" 'PATCH' @{is_primary=$true;display_order=0};Assert-Property 'Primary image and order edited atomically' ($r.status -eq 200 -and $r.data.image.is_primary -and $r.data.image.display_order -eq 0)
    $r=Property-Request "/api/properties/$($property.id)/floor-plans/$($plan.id)" 'PATCH' @{description='Verified test floor plan'};Assert-Property 'Floor plan description edited' ($r.status -eq 200 -and $r.data.floorPlan.description -eq 'Verified test floor plan')
    $r=Property-Request "/api/properties/$($property.id)/features/$($feature.id)" 'PATCH' @{value='Verified feature'};Assert-Property 'Feature value edited' ($r.status -eq 200 -and $r.data.feature.value -eq 'Verified feature')
    $r=Property-Request "/api/properties/$($property.id)/amenities/$($amenity.id)" 'PATCH' @{name=$amenity.title};Assert-Property 'Amenity partial edit succeeds' ($r.status -eq 200)
    $r=Media-Upload "/api/properties/$($property.id)/images" @{alt_text=$first.title;is_primary='true';display_order='2'} $first.key;Assert-Property 'Idempotent replay returns original image' ($r.status -eq 201 -and $r.data.image.id -eq $first.id)
    $r=Media-Upload "/api/properties/$($property.id)/images" @{is_primary='maybe'} ([Guid]::NewGuid().ToString());Assert-Property 'Invalid multipart metadata rejected' ($r.status -eq 400)
    $r=Media-Upload "/api/properties/$($property.id)/images" @{} ([Guid]::NewGuid().ToString()) ([Text.Encoding]::UTF8.GetBytes('<svg>not an image</svg>'));Assert-Property 'Disguised image bytes rejected' ($r.status -eq 400)
    $large=New-Object byte[] (3145729);$r=Media-Upload "/api/properties/$($property.id)/images" @{} ([Guid]::NewGuid().ToString()) $large;$large=$null;Assert-Property 'File exceeding 3 MiB rejected' ($r.status -eq 413)
    foreach($path in @("/api/properties/$($property.id)/images?limit=101","/api/properties/$($property.id)/features?page=1&page=2")){$r=Property-Request $path;Assert-Property 'Invalid media pagination rejected' ($r.status -eq 400)}
    $r=Property-Request "/api/properties/$($property.id)/status" 'PATCH' @{status='published';expected_status='draft';reason='Dedicated property media verification'};Assert-Property 'Dedicated gallery property published' ($r.status -eq 200)
    foreach($url in @($first.url,$plan.url)){$r=Media-File $url $true;Assert-Property 'Published file available through guarded backend URL' ($r.status -eq 200 -and $r.valid_png -and $r.nosniff -eq 'nosniff')}
    foreach($kind in @('images','floor-plans','features','amenities')){$r=Property-Request "/api/properties/$($property.id)/$kind" 'GET' $null $true;Assert-Property "Published $kind metadata available" ($r.status -eq 200 -and $r.cache -match 'no-store')}
    $r=Property-Request "/api/properties/$($property.id)/images?page=2&limit=2" 'GET' $null $true;Assert-Property 'Empty gallery page retains exact count' ($r.status -eq 200 -and @($r.data.images).Count -eq 0 -and $r.data.pagination.total -eq 2)
    $r=Property-Request "/api/properties/$($property.id)/images/$($first.id)" 'DELETE' $null $true;Assert-Property 'Anonymous image deletion denied' ($r.status -eq 401)
    $r=Property-Request '/api/property-media/operations' 'GET' $null $true;Assert-Property 'Anonymous recovery ledger denied' ($r.status -eq 401)
    $r=Property-Request "/api/properties/$($property.id)" 'DELETE';Assert-Property 'Parent deletion blocked while files remain' ($r.status -eq 409)
    $r=Property-Request "/api/properties/$($property.id)/status" 'PATCH' @{status='unavailable';expected_status='published';reason='Dedicated property media withdrawal verification'};Assert-Property 'Dedicated property withdrawn' ($r.status -eq 200)
    foreach($url in @($first.url,$plan.url)){$r=Media-File $url $true;Assert-Property 'Existing file URL rechecks withdrawal' ($r.status -eq 404)}
} catch {$checks.Add([pscustomobject]@{name='Property media verification stopped';pass=$false;stage=$stage;http_status=$lastStatus});Write-Host "STOPPED: $stage (HTTP $lastStatus). Share PASS/STOPPED lines only."}
finally {
    if($loggedIn){
        foreach($f in @($fixtures.ToArray()|Where-Object {$_.kind -ne 'properties' -and $_.state -eq 'created'})){
            try {
                $r=Property-Request "/api/properties/$($f.parent)/$($f.kind)?limit=100";$collection=@{images='images';'floor-plans'='floorPlans';features='features';amenities='amenities'}[$f.kind];$field=@{images='alt_text';'floor-plans'='title';features='name';amenities='name'}[$f.kind]
                $matches=@($r.data.$collection | Where-Object {$_.id -eq $f.id -and $_.property_id -eq $f.parent -and $_.$field -eq $f.title})
                if($r.status -ne 200 -or $matches.Count -ne 1){throw 'Exact media cleanup guard failed'}
                $f.state='delete_requested';Save-PropertyJournal;$r=Property-Request "/api/properties/$($f.parent)/$($f.kind)/$($f.id)" 'DELETE'
                Assert-Property 'Exact disposable media or metadata removed' ($r.status -eq 200);$f.state='deleted';Save-PropertyJournal
            }catch{$checks.Add([pscustomobject]@{name='Media cleanup requires controlled review';pass=$false});Write-Host 'STOPPED: Media cleanup needs controlled review. Do not rerun.'}
        }
        foreach($f in @($fixtures.ToArray()|Where-Object {$_.kind -eq 'properties' -and $_.state -eq 'created'})){
            try {
                if(@($fixtures.ToArray()|Where-Object {$_.parent -eq $f.id -and $_.state -ne 'deleted'}).Count){throw 'Unresolved child fixture'}
                $r=Property-Request "/api/properties/$($f.id)";if($r.status -ne 200 -or $r.data.property.title -ne $f.title -or $r.data.property.slug -ne $f.slug -or $r.data.property.created_by -ne $actor){throw 'Exact property cleanup guard failed'}
                $f.state='delete_requested';Save-PropertyJournal;$r=Property-Request "/api/properties/$($f.id)" 'DELETE';Assert-Property 'Exact disposable property removed' ($r.status -eq 200);$f.state='deleted';Save-PropertyJournal
            }catch{$checks.Add([pscustomobject]@{name='Property cleanup requires controlled review';pass=$false});Write-Host 'STOPPED: Property fixture cleanup needs controlled review. Do not rerun.'}
        }
        try{$r=Property-Request '/api/auth/logout' 'POST';$checks.Add([pscustomobject]@{name='Administrator logout';pass=($r.status -eq 200);http_status=$r.status});Write-Host "Administrator logout HTTP: $($r.status)"}catch{$checks.Add([pscustomobject]@{name='Administrator logout';pass=$false})}
    }
    $credential=$null;$secure=$null;$email=$null
    if(-not(Test-Path -LiteralPath $directory)){New-Item -ItemType Directory -Path $directory | Out-Null}
    if($actor){Save-PropertyJournal}
    [pscustomobject]@{date=[DateTime]::UtcNow.ToString('o');scope='Production property-media workflow; fixture identities remain in ignored private journal';results=@($checks.ToArray())}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $directory 'production-media-admin.json') -Encoding utf8
    Write-Host 'Sanitized results saved. Never share credentials, file URLs or the private journal.'
}
