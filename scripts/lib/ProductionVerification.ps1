# Shared transport for private user-run verification. Never prints response data or headers.
function Invoke-BedosVerificationRequest {
    param([string]$Base,[string]$Origin,[string]$Provider,[string]$Path,[string]$Method,
          [object]$Payload,[object]$Session,[hashtable]$ProviderHeaders)
    $bytes=$null; $json=$null
    try {
        if($Base -ne $Origin -and $Base -ne $Provider){throw 'Verification origin guard failed'}
        $parameters=@{Uri="$Base$Path";Method=$Method;WebSession=$Session;UseBasicParsing=$true;TimeoutSec=30;MaximumRedirection=0;ErrorAction='Stop'}
        if($Base -eq $Provider){
            $parameters.Headers=$ProviderHeaders
            $parameters.UserAgent='BedosBackendVerification/1.0'
        }
        if($null -ne $Payload){
            $json=$Payload | ConvertTo-Json -Depth 8 -Compress
            $bytes=[Text.Encoding]::UTF8.GetBytes($json)
            $parameters.ContentType='application/json; charset=utf-8';$parameters.Body=$bytes
        }
        $response=Invoke-WebRequest @parameters
        $data=$null
        if($response.Content){$data=$response.Content | ConvertFrom-Json}
        if($Base -eq $Provider -and $Path -like '/auth/v1/admin/users*' -and $null -ne $data.user){$data=$data.user}
        return [pscustomobject]@{status=[int]$response.StatusCode;data=$data;cache=$response.Headers['Cache-Control']}
    } catch {
        $status=$null
        if($_.Exception.Response){$status=[int]$_.Exception.Response.StatusCode}
        return [pscustomobject]@{status=$status;data=$null;cache=$null}
    } finally {
        if($bytes){[Array]::Clear($bytes,0,$bytes.Length)}
        $bytes=$null;$json=$null
    }
}
