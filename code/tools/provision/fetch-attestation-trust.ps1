# SPDX-License-Identifier: AGPL-3.0-only
<#
.SYNOPSIS
Fetch verifier-owned Android trust data directly from Google's HTTPS endpoints.
.DESCRIPTION
Run on the requester/verifier machine. Never accept this configuration from the
operator. No private data is sent. Output is a short-lived local snapshot, not a
signed revocation statement or a sensor-attestation result. Existing files are
never replaced. Fetch again when the snapshot expires.
#>
[CmdletBinding()]
param([string]$OutputPath, [ValidateRange(1,3600)][int]$FreshnessSeconds = 3600)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$knownPins = @(
    'feb2ea7551ee316ed4bb443c8293b884dbfdea40b603ee3e4f4a897e4580fbae',
    '3ee44512a1af2beb39c889490c60ea3f82e43f5d5a5532f5ab9419f676cd07ec'
)
$fetchStarted = [DateTimeOffset]::UtcNow
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(20)
$client.MaxResponseContentBufferSize = 2 * 1024 * 1024
$client.DefaultRequestHeaders.CacheControl = [Net.Http.Headers.CacheControlHeaderValue]::new()
$client.DefaultRequestHeaders.CacheControl.NoCache = $true
function Fetch-PublicJson([string]$Url) {
    $response = $client.GetAsync($Url).GetAwaiter().GetResult()
    try {
        if ($response.StatusCode -ne [Net.HttpStatusCode]::OK) { throw "Trust endpoint did not return HTTP200: $Url" }
        $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ([Text.Encoding]::UTF8.GetByteCount($text) -gt 2*1024*1024) { throw 'Trust data exceeds its size limit.' }
        $age = if ($null -ne $response.Headers.Age) { [Math]::Ceiling($response.Headers.Age.TotalSeconds) } else { 0 }
        $maxAge = if ($null -ne $response.Headers.CacheControl -and $null -ne $response.Headers.CacheControl.MaxAge) {
            [Math]::Floor($response.Headers.CacheControl.MaxAge.TotalSeconds)
        } else { 300 }
        $remaining = [Math]::Min($FreshnessSeconds, $maxAge - $age)
        if ($remaining -le 0) { throw 'The trust endpoint returned expired cache data.' }
        return @{ text=$text; data=($text | ConvertFrom-Json -AsHashtable); remaining=[int]$remaining }
    } finally { $response.Dispose() }
}
try {
    $roots = Fetch-PublicJson 'https://android.googleapis.com/attestation/root'
    if ($roots.data.Count -lt 1 -or $roots.data.Count -gt 8) { throw 'Unexpected published root set.' }
    $pins = @()
    foreach ($pem in $roots.data) {
        $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem($pem)
        $key = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($certificate)
        if ($null -eq $key) { $key = [Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPublicKey($certificate) }
        try {
            if ($null -eq $key) { throw 'Unsupported published root algorithm.' }
            $pin = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($key.ExportSubjectPublicKeyInfo())).ToLowerInvariant()
            if ($pin -cnotin $knownPins) { throw 'A new attestation root requires an explicit verifier update.' }
            if ($pin -cin $pins) { throw 'Duplicate published root key.' }
            $pins += $pin
        } finally { if ($null -ne $key) { $key.Dispose() }; $certificate.Dispose() }
    }
    $status = Fetch-PublicJson 'https://android.googleapis.com/attestation/status'
    if (-not $status.data.ContainsKey('entries') -or $status.data.entries.Count -gt 50000) { throw 'Invalid revocation list.' }
    foreach ($serial in $status.data.entries.Keys) {
        if ($serial -cnotmatch '^[1-9a-f][0-9a-f]{0,39}$' -or $status.data.entries[$serial].status -cnotin @('REVOKED','SUSPENDED')) {
            throw 'Unexpected revocation entry; no trust snapshot was issued.'
        }
    }
    $fetched = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $remaining = [Math]::Min($roots.remaining, $status.remaining)
    if (($fetched - $fetchStarted.ToUnixTimeSeconds()) -gt 60) { throw 'Trust retrieval exceeded its time budget.' }
    # Conservatively include both request durations in the validity budget.
    $snapshotTime = $fetchStarted.ToUnixTimeSeconds()
    if ($snapshotTime + $remaining -le $fetched) { throw 'Trust data expired during retrieval.' }
    $trust = [ordered]@{version=1;profile='google-hardware-attestation';root_spki_sha256=$pins;
        revocation=[ordered]@{fetched_at=$snapshotTime;valid_until=$snapshotTime+$remaining;entries=$status.data.entries}}
    if (-not $OutputPath) {
        $OutputPath = Join-Path $PSScriptRoot "../artifacts/trust/android-trust-$($fetchStarted.ToString('yyyyMMddTHHmmssZ'))-$([Guid]::NewGuid().ToString('N').Substring(0,8)).json"
    }
    $OutputPath = [IO.Path]::GetFullPath($OutputPath)
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($OutputPath)) | Out-Null
    $stream = [IO.File]::Open($OutputPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
    $writer = [IO.StreamWriter]::new($stream,[Text.UTF8Encoding]::new($false))
    try { $writer.WriteLine(($trust | ConvertTo-Json -Depth 8)) } finally { $writer.Dispose() }
    [pscustomobject]@{path=$OutputPath;roots=$pins.Count;revoked_entries=$status.data.entries.Count;
        fetched_at=$snapshotTime;valid_until=$trust.revocation.valid_until;sha256=(Get-FileHash -LiteralPath $OutputPath).Hash.ToLowerInvariant()}
} finally { $client.Dispose(); $handler.Dispose() }
