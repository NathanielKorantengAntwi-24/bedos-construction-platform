# Run ONLY after separately approved Module 7 deployment and both migrations are verified.
# Dedicated fixtures only; no provider keys, new accounts or emails.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$origin='https://bedos-construction-platform.vercel.app';$provider='https://zjdqomckldeipigqqfqm.supabase.co'
$directory=Join-Path $root 'docs/module-7-evidence';$privatePath=Join-Path $directory 'private-project-fixtures.json'
if(Test-Path -LiteralPath $privatePath){$old=Get-Content -LiteralPath $privatePath -Raw | ConvertFrom-Json;if($old.state -ne 'complete'){throw 'Prior construction fixtures need controlled review. Do not rerun.'}}
$session=New-Object Microsoft.PowerShell.Commands.WebRequestSession;$anonymous=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$checks=New-Object System.Collections.Generic.List[object];$fixtures=New-Object System.Collections.Generic.List[object]
$prefix='bedos-project-'+[Guid]::NewGuid().ToString('N');$actor=$null;$loggedIn=$false;$stage='administrator login';$lastStatus=$null
. (Join-Path $PSScriptRoot 'lib/ProductionVerification.ps1')
function Call-Project([string]$Path,[string]$Method='GET',[object]$Payload=$null,[bool]$Public=$false){
 if(-not $Path.StartsWith('/api/')){throw 'Backend path guard'};$jar=$session;if($Public){$jar=$anonymous}
 $r=Invoke-BedosVerificationRequest -Base $origin -Origin $origin -Provider $provider -Path $Path -Method $Method -Payload $Payload -Session $jar -ProviderHeaders @{};$script:lastStatus=$r.status;return $r
}
function Check-Project([string]$Name,[bool]$Pass){$checks.Add([pscustomobject]@{name=$Name;pass=$Pass});if(-not $Pass){throw 'Construction verification stopped'};Write-Host "PASS: $Name"}
function Save-ProjectJournal {
 $complete=@($fixtures.ToArray()|Where-Object {$_.state -ne 'deleted'}).Count -eq 0
 [pscustomobject]@{state=if($complete){'complete'}else{'review_required'};actor=$actor;prefix=$prefix;fixtures=@($fixtures.ToArray())}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $privatePath -Encoding utf8
}
function Current-Project([object]$Fixture){
 $r=Call-Project "/api/projects/$($Fixture.id)"
 if($r.status -ne 200 -or $r.data.project.id -ne $Fixture.id -or $r.data.project.slug -ne $Fixture.slug -or $r.data.project.created_by -ne $actor){throw 'Exact project identity guard'}
 return $r.data.project
}
function New-Construction([string]$Label,[string]$Category){
 $f=[pscustomobject]@{kind='project';id=$null;parent=$null;slug="$prefix-$Label";state='create_requested'};$fixtures.Add($f);Save-ProjectJournal
 $body=@{title="Temporary construction verification $prefix $Label";slug=$f.slug;description='Temporary backend test portfolio. Not a real construction project.';client_name='Private disposable fixture'};if($Category){$body.category_id=$Category}
 $r=Call-Project '/api/projects' 'POST' $body
 if($r.status -eq 201 -and $r.data.project.slug -eq $f.slug -and $r.data.project.created_by -eq $actor){$f.id=$r.data.project.id;$f.state='created';Save-ProjectJournal}
 Check-Project "Exact $Label draft created" ($f.state -eq 'created' -and $r.data.project.status -eq 'draft' -and $r.data.project.version -eq 1);return $f
}
$png=[Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAIAAABChommAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQYlWNgYPhPBGIY6YoA7TJfofQRhCAAAAAASUVORK5CYII=')
function Upload-Construction([object]$Project,[object]$Image,[int]$Version){
 $boundary='bedos-'+[Guid]::NewGuid().ToString('N');$stream=New-Object IO.MemoryStream;$bodyBytes=$null
 $write={param([string]$Text) $b=[Text.Encoding]::UTF8.GetBytes($Text);$stream.Write($b,0,$b.Length)}
 try{
  foreach($pair in @(@('expected_version',"$Version"),@('phase','before'),@('alt_text',"Temporary $prefix image"),@('is_primary','true'))){& $write "--$boundary`r`nContent-Disposition: form-data; name=`"$($pair[0])`"`r`n`r`n$($pair[1])`r`n"}
  & $write "--$boundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"fixture.png`"`r`nContent-Type: image/png`r`n`r`n";$stream.Write($png,0,$png.Length);& $write "`r`n--$boundary--`r`n";$bodyBytes=$stream.ToArray()
  $response=Invoke-WebRequest -Uri "$origin/api/projects/$($Project.id)/images" -Method Post -WebSession $session -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 60 -ContentType "multipart/form-data; boundary=$boundary" -Headers @{'Idempotency-Key'=$Image.key} -Body $bodyBytes
  $script:lastStatus=[int]$response.StatusCode;return [pscustomobject]@{status=[int]$response.StatusCode;data=($response.Content|ConvertFrom-Json)}
 }catch{$status=$null;if($_.Exception.Response){$status=[int]$_.Exception.Response.StatusCode};$script:lastStatus=$status;return [pscustomobject]@{status=$status;data=$null}}
 finally{if($bodyBytes){[Array]::Clear($bodyBytes,0,$bodyBytes.Length)};$stream.Dispose()}
}
function Construction-File([string]$Path,[bool]$Public=$false){
 if($Path -notmatch '^/api/projects/[0-9a-f-]{36}/images/[0-9a-f-]{36}/file$'){throw 'Owned file URL guard'};$jar=$session;if($Public){$jar=$anonymous}
 try{$r=Invoke-WebRequest -Uri "$origin$Path" -WebSession $jar -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 60;$b=$r.RawContentStream.ToArray();return [pscustomobject]@{status=[int]$r.StatusCode;png=($b.Length -gt 8 -and $b[0] -eq 137 -and $b[1] -eq 80);cache=$r.Headers['Cache-Control'];nosniff=$r.Headers['X-Content-Type-Options']}}
 catch{$status=$null;if($_.Exception.Response){$status=[int]$_.Exception.Response.StatusCode};return [pscustomobject]@{status=$status}}
}
try{
 Write-Host 'Creates one category, two clearly labelled temporary construction projects, one stage and one tiny image; briefly publishes one project, then removes exact fixtures. Audit/operation history remains.'
 Write-Host 'No new accounts or email steps. Keep credentials and the private fixture journal private.'
 $email=(Read-Host 'Existing administrator email').Trim().ToLowerInvariant();$secure=Read-Host 'Administrator password (hidden; never send in chat)' -AsSecureString;$credential=New-Object System.Management.Automation.PSCredential($email,$secure)
 $r=Call-Project '/api/auth/login' 'POST' @{email=$email;password=$credential.GetNetworkCredential().Password};Check-Project 'Administrator login' ($r.status -eq 200);$loggedIn=$true
 $r=Call-Project '/api/auth/me';Check-Project 'Expected active administrator' ($r.status -eq 200 -and $r.data.user.email -eq $email -and $r.data.role.name -eq 'administrator' -and $r.data.profile.account_status -eq 'active');$actor=$r.data.user.id
 $stage='fixture setup';$category=[pscustomobject]@{kind='category';id=$null;parent=$null;slug="$prefix-category";state='create_requested'};$fixtures.Add($category);Save-ProjectJournal
 $r=Call-Project '/api/project-categories' 'POST' @{name="Temporary $prefix category";slug=$category.slug}
 if($r.status -eq 201 -and $r.data.category.slug -eq $category.slug){$category.id=$r.data.category.id;$category.state='created';Save-ProjectJournal};Check-Project 'Exact category created' ($category.state -eq 'created')
 $project=New-Construction 'portfolio' $category.id;$other=New-Construction 'other' $null;$item="/api/projects/$($project.id)"
 $r=Call-Project "/api/projects?q=$prefix";Check-Project 'Staff scoped list and no-store' ($r.status -eq 200 -and $r.data.pagination.total -eq 2 -and $r.cache -match 'no-store')
 $r=Call-Project "/api/public/projects?q=$prefix" 'GET' $null $true;Check-Project 'Drafts hidden publicly' ($r.status -eq 200 -and $r.data.pagination.total -eq 0)
 $r=Call-Project "/api/public/projects/$($project.slug)" 'GET' $null $true;Check-Project 'Draft detail hidden' ($r.status -eq 404)
 $r=Call-Project $item 'PATCH' @{expected_version=1;status='ongoing'};Check-Project 'Ordinary edit cannot publish' ($r.status -eq 400)
 $r=Call-Project $item 'PATCH' @{expected_version=1;title="Updated temporary $prefix"};Check-Project 'Versioned edit' ($r.status -eq 200 -and $r.data.project.version -eq 2)
 $r=Call-Project $item 'PATCH' @{expected_version=1;title='Stale'};Check-Project 'Stale edit rejected' ($r.status -eq 409)
 $r=Call-Project "/api/project-categories/$($category.id)" 'DELETE' @{expected_version=1};Check-Project 'Referenced category deletion blocked' ($r.status -eq 409)
 $child=[pscustomobject]@{kind='stage';id=$null;parent=$project.id;slug=$null;state='create_requested'};$fixtures.Add($child);Save-ProjectJournal
 $r=Call-Project "$item/stages" 'POST' @{expected_version=2;name="Temporary $prefix stage";stage_order=0}
 if($r.status -eq 201 -and $r.data.project.stages[0].project_id -eq $project.id){$child.id=$r.data.project.stages[0].id;$child.state='created';Save-ProjectJournal};Check-Project 'Pending stage and zero progress' ($child.state -eq 'created' -and $r.data.project.progress -eq 0)
 $r=Call-Project "/api/projects/$($other.id)/stages/$($child.id)" 'PATCH' @{expected_version=1;name='Cross parent'};Check-Project 'Cross-project stage edit denied' ($r.status -eq 404)
 $r=Call-Project "$item/stages/$($child.id)" 'PATCH' @{expected_version=3;status='in_progress';start_date='2026-01-01'};Check-Project 'Stage starts' ($r.status -eq 200)
 $r=Call-Project "$item/stages/$($child.id)" 'PATCH' @{expected_version=4;status='completed';completion_date='2026-02-01'};Check-Project 'Stage completion calculates progress' ($r.status -eq 200 -and $r.data.project.progress -eq 100)
 $image=[pscustomobject]@{kind='image';id=$null;parent=$project.id;slug=$null;key=[Guid]::NewGuid().ToString();url=$null;state='create_requested'};$fixtures.Add($image);Save-ProjectJournal
 $r=Upload-Construction $project $image 5
 if($r.status -eq 201 -and $r.data.image.project_id -eq $project.id){$image.id=$r.data.image.id;$image.url=$r.data.image.image_url;$image.state='created';Save-ProjectJournal};Check-Project 'Exact before image uploaded' ($image.state -eq 'created' -and $r.data.image.is_primary)
 $r=Construction-File $image.url;Check-Project 'Staff previews draft image' ($r.status -eq 200 -and $r.png -and $r.nosniff -eq 'nosniff')
 $r=Construction-File $image.url $true;Check-Project 'Public draft image hidden' ($r.status -eq 404)
 $r=Upload-Construction $project $image 5;Check-Project 'Idempotent replay same image' ($r.status -eq 201 -and $r.data.image.id -eq $image.id)
 $current=Current-Project $project;$r=Call-Project "$item/status" 'PATCH' @{expected_version=$current.version;status='ongoing'};Check-Project 'Ongoing portfolio published' ($r.status -eq 200)
 $r=Call-Project "/api/public/projects/$($project.slug)" 'GET' $null $true
 $fields='category,completed_stage_count,completion_date,description,featured,id,images,location,progress,project_type,services,slug,stage_count,stages,start_date,status,title'
 Check-Project 'Public detail exact safe fields' ($r.status -eq 200 -and (($r.data.project.PSObject.Properties.Name|Sort-Object)-join ',') -eq $fields -and $r.data.project.progress -eq 100 -and $r.cache -match 'no-store')
 $r=Construction-File $image.url $true;Check-Project 'Published image bytes and no-store' ($r.status -eq 200 -and $r.png -and $r.cache -match 'no-store')
 $r=Call-Project "/api/public/projects?category_id=$($category.id)&status=ongoing&page=2" 'GET' $null $true;Check-Project 'Empty page retains exact count' ($r.status -eq 200 -and $r.data.pagination.total -eq 1 -and @($r.data.projects).Count -eq 0)
 foreach($q in @('page_size=101','page=1&page=2','status=draft','unknown=true')){$r=Call-Project "/api/public/projects?$q" 'GET' $null $true;Check-Project "Invalid query rejected $q" ($r.status -eq 400)}
 $r=Call-Project $item 'GET' $null $true;Check-Project 'Anonymous management denied' ($r.status -eq 401)
 $current=Current-Project $project;$r=Call-Project "$item/status" 'PATCH' @{expected_version=$current.version;status='completed';completion_date='2026-03-01'};Check-Project 'Completed portfolio status' ($r.status -eq 200)
 $current=Current-Project $project;$r=Call-Project "$item/stages/$($child.id)" 'DELETE' @{expected_version=$current.version};Check-Project 'Completed stages immutable until reopen' ($r.status -eq 409)
 $r=Call-Project $item 'DELETE' @{expected_version=$current.version};Check-Project 'Parent file cleanup required' ($r.status -eq 409)
 $r=Call-Project "$item/status" 'PATCH' @{expected_version=$current.version;status='archived'};Check-Project 'Portfolio withdrawn' ($r.status -eq 200)
 $r=Construction-File $image.url $true;Check-Project 'Existing file URL rechecks withdrawal' ($r.status -eq 404)
}catch{Write-Host "STOPPED: $stage (HTTP $lastStatus). Share PASS/STOPPED lines only.";$checks.Add([pscustomobject]@{name=$stage;pass=$false})}
finally{
 if($loggedIn -and $actor){
  foreach($f in @($fixtures.ToArray()|Where-Object {$_.kind -eq 'image' -and $_.state -eq 'created'})){
   try{$parent=@($fixtures.ToArray()|Where-Object {$_.kind -eq 'project' -and $_.id -eq $f.parent})[0];$current=Current-Project $parent
    if(@($current.images|Where-Object {$_.id -eq $f.id -and $_.project_id -eq $f.parent}).Count -ne 1){throw 'Exact image guard'}
    $r=Call-Project "/api/projects/$($f.parent)/images/$($f.id)" 'DELETE' @{expected_version=$current.version};if($r.status -ne 200 -or -not $r.data.deleted){throw 'Image removal uncertain'};$f.state='deleted';Save-ProjectJournal;Check-Project 'Exact test image removed' $true
   }catch{Write-Host 'STOPPED: exact image cleanup requires controlled review';$checks.Add([pscustomobject]@{name='Exact image cleanup';pass=$false})}
  }
  foreach($f in @($fixtures.ToArray()|Where-Object {$_.kind -eq 'project' -and $_.state -eq 'created'})){
   try{$current=Current-Project $f;$r=Call-Project "/api/projects/$($f.id)" 'DELETE' @{expected_version=$current.version};if($r.status -ne 200 -or -not $r.data.project.deleted){throw 'Project deletion uncertain'};$f.state='deleted'
    foreach($s in @($fixtures.ToArray()|Where-Object {$_.kind -eq 'stage' -and $_.parent -eq $f.id -and $_.state -eq 'created'})){$s.state='deleted'};Save-ProjectJournal;Check-Project 'Exact test project and stages removed' $true
   }catch{Write-Host 'STOPPED: exact project cleanup requires controlled review';$checks.Add([pscustomobject]@{name='Exact project cleanup';pass=$false})}
  }
  foreach($f in @($fixtures.ToArray()|Where-Object {$_.kind -eq 'category' -and $_.state -eq 'created'})){
   try{$r=Call-Project "/api/project-categories/$($f.id)";if($r.status -ne 200 -or $r.data.category.slug -ne $f.slug){throw 'Exact category guard'};$version=$r.data.category.version;$r=Call-Project "/api/project-categories/$($f.id)" 'DELETE' @{expected_version=$version};if($r.status -ne 200 -or -not $r.data.category.deleted){throw 'Category deletion uncertain'};$f.state='deleted';Save-ProjectJournal;Check-Project 'Exact test category removed' $true
   }catch{Write-Host 'STOPPED: exact category cleanup requires controlled review';$checks.Add([pscustomobject]@{name='Exact category cleanup';pass=$false})}
  }
 }
 if($loggedIn){$r=Call-Project '/api/auth/logout' 'POST' @{};Write-Host "Administrator logout HTTP: $($r.status)";$checks.Add([pscustomobject]@{name='Administrator logout';pass=($r.status -eq 200)})}
 if($fixtures.Count){Save-ProjectJournal};$credential=$null;$secure=$null;$png=$null
 [pscustomobject]@{date=[DateTime]::UtcNow.ToString('o');results=@($checks.ToArray())}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $directory 'production-project-admin.json') -Encoding utf8
 Write-Host 'Sanitized results saved. Never share credentials, file URLs or the private fixture journal.'
}
