# Production confirmation E2E. Only a newly created dedicated Gmail-alias customer.
# Keep this window open. COPY the email link; do not click or paste it in chat.
$ErrorActionPreference = 'Stop'
$origin = 'https://bedos-construction-platform.vercel.app'
$authHost = 'zjdqomckldeipigqqfqm.supabase.co'
$run = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$email = "nathaniel.koranteng.antwics2022+bedos-confirm-$run@gmail.com"
$entropy = New-Object byte[] 24
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($entropy)
$rng.Dispose()
$password = [Convert]::ToBase64String($entropy) + 'aA1!'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$results = New-Object System.Collections.Generic.List[object]
$userId = $null
$stage = 'signup'
$link = $null
$secureLink = $null
$body = $null
$bodyBytes = $null
function Record-Check([string]$Name, [bool]$Pass) {
    $results.Add([pscustomobject]@{ name=$Name; pass=$Pass })
    if (-not $Pass) { throw 'Test assertion failed.' }
    Write-Output "PASS: $Name"
}
try {
    $body = @{ email=$email; password=$password; full_name="Bedos Confirmation Test $run" } | ConvertTo-Json -Compress
    $bodyBytes = [Text.Encoding]::UTF8.GetBytes($body)
    $signup = Invoke-RestMethod -Uri "$origin/api/auth/signup" -Method Post `
        -ContentType 'application/json; charset=utf-8' -Body $bodyBytes -WebSession $session -TimeoutSec 30
    $userId = $signup.user.id
    Record-Check 'Signup requires confirmation' ($signup.confirmation_required -eq $true -and -not [string]::IsNullOrEmpty($userId))
    $loginBody = [Text.Encoding]::UTF8.GetBytes((@{ email=$email; password=$password } | ConvertTo-Json -Compress))
    $stage = 'login before confirmation'
    $denied = $false
    try { $null = Invoke-RestMethod -Uri "$origin/api/auth/login" -Method Post -ContentType 'application/json; charset=utf-8' -Body $loginBody -WebSession $session -TimeoutSec 30 }
    catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { $denied=$true } else { throw } }
    Record-Check 'Login denied before email confirmation' $denied
    Write-Output "Find the NEW confirmation email addressed to: $email"
    Write-Output 'COPY the confirmation link address without opening it. Paste it at the hidden prompt below.'
    $stage = 'private confirmation link'
    $secureLink = Read-Host 'Paste confirmation link (hidden; never send it in chat)' -AsSecureString
    $linkCredential = New-Object System.Management.Automation.PSCredential('confirmation-link',$secureLink)
    $link = [Uri]$linkCredential.GetNetworkCredential().Password
    if ($link.Scheme -ne 'https' -or $link.Host -ne $authHost -or $link.AbsolutePath -ne '/auth/v1/verify' -or $link.UserInfo) {
        throw 'Unexpected confirmation destination.'
    }
    Add-Type -AssemblyName System.Web
    $query = [System.Web.HttpUtility]::ParseQueryString($link.Query)
    $redirect = [Uri]$query['redirect_to']
    if ($query['type'] -ne 'signup' -or $redirect.GetLeftPart([UriPartial]::Authority) -ne $origin -or $redirect.AbsolutePath -ne '/auth/callback' -or $redirect.UserInfo) {
        throw 'Unexpected confirmation type or callback.'
    }
    $stage = 'email verification and callback'
    $null = Invoke-WebRequest -UseBasicParsing -Uri $link.AbsoluteUri -WebSession $session -MaximumRedirection 5 -TimeoutSec 30
    $me = Invoke-RestMethod -Uri "$origin/api/auth/me" -WebSession $session -TimeoutSec 30
    Record-Check 'Email callback established correct customer session' ($me.user.id -eq $userId -and $me.user.email -eq $email -and $me.role.name -eq 'customer')
    $null = Invoke-RestMethod -Uri "$origin/api/auth/logout" -Method Post -WebSession $session -TimeoutSec 30
    $stage = 'password login after confirmation'
    $login = Invoke-RestMethod -Uri "$origin/api/auth/login" -Method Post -ContentType 'application/json; charset=utf-8' -Body $loginBody -WebSession $session -TimeoutSec 30
    Record-Check 'Fresh password login succeeds after confirmation' ($login.user.id -eq $userId)
    $me = Invoke-RestMethod -Uri "$origin/api/auth/me" -WebSession $session -TimeoutSec 30
    Record-Check 'Fresh customer session verified' ($me.user.id -eq $userId -and $me.role.name -eq 'customer' -and $me.profile.account_status -eq 'active')
}
catch {
    $status = $null
    if ($_.Exception.Response) { $status=[int]$_.Exception.Response.StatusCode }
    $results.Add([pscustomobject]@{name="Stopped at $stage";pass=$false;http_status=$status})
    Write-Output "Test stopped at: $stage. HTTP status: $status. Do not share the link or credentials."
}
finally {
    try {
        $null = Invoke-RestMethod -Uri "$origin/api/auth/logout" -Method Post -WebSession $session -TimeoutSec 20
        Write-Output 'Test session signed out.'
    } catch { Write-Output 'Test session cleanup not verified.' }
    $report = [pscustomobject]@{date=[DateTime]::UtcNow.ToString('o');scope='User-run dedicated customer confirmation E2E; credentials and links excluded';email=$email;userId=$userId;results=@($results.ToArray())}
    $output = Join-Path (Split-Path $PSScriptRoot -Parent) 'docs/release-evidence/customer-confirmation-production-e2e.json'
    $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -LiteralPath $output
    Write-Output 'Sanitized test results recorded. Share only the PASS/stopped lines.'
    if ($bodyBytes) { [Array]::Clear($bodyBytes,0,$bodyBytes.Length) }
    if ($loginBody) { [Array]::Clear($loginBody,0,$loginBody.Length) }
    [Array]::Clear($entropy,0,$entropy.Length)
    $password=$null; $body=$null; $bodyBytes=$null; $loginBody=$null
    $link=$null; $secureLink=$null; $linkCredential=$null; $query=$null; $session=$null
}
