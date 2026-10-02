# SPDX-License-Identifier: AGPL-3.0-only
# Public pre-challenge signaling transport only. Importing runs no device command.
function Assert-CameraPairingRecord([byte[]]$Bytes, [ValidateSet('offer','answer')][string]$Kind) {
    if ($Bytes.Length -lt 1 -or $Bytes.Length -gt 120000) { throw 'Camera pairing JSON must be 1..120000 bytes.' }
    $source = (New-Object Text.UTF8Encoding($false,$true)).GetString($Bytes)
    $document = [System.Text.Json.JsonDocument]::Parse($source)
    try {
        $root = $document.RootElement
        if ($root.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { throw 'Expected a public camera pairing object.' }
        # Enumerating before ConvertFrom-Json rejects repeated/unknown root keys.
        $names = @($root.EnumerateObject() | ForEach-Object { $_.Name })
        $value = $source | ConvertFrom-Json
        $composed = $value.version -ceq 2
        $fields = @('version','type','pairing_id','requester_pin','operator_pin','description')
        if ($Kind -ceq 'offer') { $fields += 'hints' }
        if ($composed) { $fields += 'operator_location_pin' }
        if ($value.version -isnot [long] -and $value.version -isnot [int]) { throw 'Invalid pairing version.' }
        if ($value.version -notin @(1,2) -or $value.type -cne ('nonverba-camera-' + $Kind) -or $names.Count -ne $fields.Count) { throw 'Unexpected camera pairing shape.' }
        foreach ($field in $fields) { if (@($names | Where-Object { $_ -ceq $field }).Count -ne 1) { throw 'Repeated or unexpected camera pairing field.' } }
        foreach ($field in @('pairing_id','requester_pin','operator_pin') + $(if ($composed) { @('operator_location_pin') } else { @() })) {
            if ($value.$field -isnot [string] -or $value.$field -cnotmatch '\A[a-f0-9]{64}\z') { throw 'Invalid public camera pairing ID.' }
        }
        if ($value.description -isnot [pscustomobject] -or
            (@($value.description.PSObject.Properties.Name | Sort-Object) -join ',') -cne 'sdp,type' -or
            $value.description.type -cne $Kind -or $value.description.sdp -isnot [string] -or
            [Text.Encoding]::UTF8.GetByteCount($value.description.sdp) -gt 100000) { throw 'Invalid bounded camera SDP description.' }
        $media = @($value.description.sdp -split '\r?\n' | Where-Object { $_.StartsWith('m=') })
        if ($media.Count -ne 1 -or $media[0] -cnotmatch '\Am=application\s') { throw 'Only a single data-only camera pairing is allowed.' }
        # Product policy/pin/consent validation still runs in the app's existing
        # camera parser and signed-request path; this transport grants no trust.
        return $value
    } finally { $document.Dispose() }
}
function Read-CameraOfferFile([string]$Path, [string]$Root) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
    if (-not $absolute.StartsWith($rootPath + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetExtension($absolute) -cne '.json') { throw 'Camera offer must be a JSON file beneath device-acceptance.' }
    $cursor = $absolute
    while ($cursor) {
        $item = Get-Item -LiteralPath $cursor -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked camera offer paths are not accepted.' }
        if ($cursor -ceq $absolute -and ($item.PSIsContainer -or $item.Length -lt 1 -or $item.Length -gt 120000)) { throw 'Invalid bounded regular offer file.' }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    $stream = [IO.File]::Open($absolute,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        if ($stream.Length -lt 1 -or $stream.Length -gt 120000) { throw 'Camera offer changed size before reading.' }
        $bytes = New-Object byte[] ([int]$stream.Length)
        $stream.ReadExactly($bytes)
        if ($stream.ReadByte() -ne -1) { throw 'Camera offer changed while reading.' }
        $value = Assert-CameraPairingRecord $bytes offer
        return [pscustomobject]@{path=$absolute;bytes=$bytes;value=$value;
            sha256=([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))).ToLowerInvariant()}
    } finally { $stream.Dispose() }
}
function Send-CameraOfferBytes([byte[]]$Bytes, [string]$Token) {
    if ($Token -cnotmatch '\A[a-f0-9]{32}\z' -or $Bytes.Length -lt 1 -or $Bytes.Length -gt 120000) { throw 'Invalid bounded camera offer transfer.' }
    $script = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'camera-offer-stage.sh')).Replace("`r`n","`n").Replace('@TOKEN@',$Token)
    # ADB joins remote arguments. Quote the fixed script for that remote shell;
    # the caller's JSON is binary stdin and is never part of the command string.
    $remote = "'" + $script.Replace("'", "'\''") + "'"
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $adb; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($arg in @('-H','127.0.0.1','-P','5038','-d','shell','-T','run-as','org.nonverba.camera','sh','-c',$remote)) { $start.ArgumentList.Add($arg) }
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Could not start USB camera offer staging.' }
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        $write = $process.StandardInput.BaseStream.WriteAsync($Bytes,0,$Bytes.Length)
        if (-not $write.Wait(10000)) { $process.Kill(); throw 'Camera offer stdin transfer timed out; partial evidence preserved.' }
        # The runtime may expose Task<VoidTaskResult>; keep its implementation
        # result out of PowerShell's success-output stream (the digest channel).
        [void]$write.GetAwaiter().GetResult(); $process.StandardInput.Close()
        if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'Camera offer staging timed out; partial evidence preserved.' }
        $output = $stdout.GetAwaiter().GetResult(); $errors = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0 -or $errors.Length -gt 0) { throw 'USB camera offer staging failed; any partial staged file is preserved.' }
        return $output.Trim()
    } finally { $process.Dispose() }
}
