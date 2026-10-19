# SPDX-License-Identifier: AGPL-3.0-only
# SOURCE PREPARATION ONLY. A separately reviewed ROOT literal invocation is required.
[CmdletBinding()]
param(
    [switch]$ROOTIssueOneMetadataTrial,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedHostSha256
)
$whole=[System.Diagnostics.Stopwatch]::StartNew()
$failedCarryMs=50000
$ErrorActionPreference='Stop'
$dockerId='fcb9461f2ccc1d76871ee40713fcc93752b72e51a454890188cf9b1f052d7d4e'
$work='/tmp/nonverba-unified-source/4ddbd48a9d1e4187b455a1bfcf878b3f/code'
$run='/opt/nonverba-build/priors-derivation/study-v0.2/20261013-study-15000'
$stage=$run+'/qa/literal-emphasis-parent-v1-metadata-execution-staging-amendment-v7'
$node='/opt/nonverba-tools/node/bin/node'
$script=$stage+'/ROOT-issue-readback.mjs'
$nodeSHA='e337d563796c7f5595abad880393519c95cf506e4767f489135463ff84931b8f'
$nodeBytes='22509'
$entry=$work+'/disputes/prototypes/priors-derivation/study-v0.2/experiments/literal-emphasis-parent-v1/actual-entry-v1/metadata-execution-v1/bootstrap.mjs'
$decision=$run+'/qa/literal-emphasis-actualA-metadata-engineering-20261017-bound80-v8/admission/ROOT-decision.json'
function Safe-SingleCode([string]$Text,[long]$ObservedBytes,[bool]$Complete) {
    if($Complete -and $ObservedBytes -le 101 -and [System.Text.RegularExpressions.Regex]::IsMatch($Text,'\A[A-Z0-9_]{1,100}\n?\z')){return $Text.Replace("`n",'')}
    return $null
}
function New-StageEvidence($Result,[switch]$Pending) {
    if($null -eq $Result){return [ordered]@{attempted=[bool]$Pending;literal_native_exit=$null;native_exit_observed=$false;duration_ms=$null;stdout=$null;stderr=$null;transport_held=$(if($Pending){'OBSERVATION_NOT_RETURNED'}else{'NOT_ATTEMPTED'})}}
    return [ordered]@{attempted=$true;literal_native_exit=$Result.literal_native_exit;native_exit_observed=$Result.native_exit_observed;duration_ms=[Math]::Ceiling($Result.elapsed_ms);stdout=$Result.streams[0];stderr=$Result.streams[1];transport_held=$Result.held;observation_error_sha256=$Result.observation_error_sha256}
}
function Invoke-FixedManaged([string[]]$NodeArguments) {
    $timer=[System.Diagnostics.Stopwatch]::StartNew()
    $psi=[System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName='docker';$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
    $psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
    $fixed=@('exec','--env','LD_PRELOAD=','--env','LD_AUDIT=','--env','NODE_OPTIONS=','--env','BASH_ENV=','--env','ENV=','--workdir',$work,$dockerId,'bash','./dev.sh','exec','env','-i',
      'NONVERBA_CONTAINER=1','PATH=/usr/bin:/bin','LANG=C.UTF-8','TZ=UTC',$node,'--max-old-space-size=256')
    foreach($a in ($fixed+$NodeArguments)){$psi.ArgumentList.Add($a)}
    $p=[System.Diagnostics.Process]::new();$p.StartInfo=$psi
    $buffers=@([byte[]]::new(4096),[byte[]]::new(4096));$streams=@($null,$null);$tasks=@($null,$null)
    $done=@($false,$false);$counts=@(0L,0L);$kept=@([System.IO.MemoryStream]::new(),[System.IO.MemoryStream]::new())
    $hashes=@([System.Security.Cryptography.IncrementalHash]::CreateHash([System.Security.Cryptography.HashAlgorithmName]::SHA256),[System.Security.Cryptography.IncrementalHash]::CreateHash([System.Security.Cryptography.HashAlgorithmName]::SHA256))
    $started=$false;$held=$null;$literalExit=$null;$exitObserved=$false;$observationError=$null
    $texts=@('','');$streamEvidence=@($null,$null)
    try {
        $started=$p.Start();if(-not $started){throw 'ROOT_DOCKER_START_FAILED'}
        $streams=@($p.StandardOutput.BaseStream,$p.StandardError.BaseStream)
        for($i=0;$i -lt 2;$i++){$tasks[$i]=$streams[$i].ReadAsync($buffers[$i],0,4096)}
        while((-not $p.HasExited) -or (-not ($done[0] -and $done[1]))) {
            if(($whole.Elapsed.TotalMilliseconds+$failedCarryMs) -gt 180000){$held='ROOT_TRANSPORT_TIMEOUT_ABSENCE_UNKNOWN';break}
            for($i=0;$i -lt 2;$i++){
                if((-not $done[$i]) -and $tasks[$i].IsCompleted){
                    $n=$tasks[$i].GetAwaiter().GetResult()
                    if($n -eq 0){$done[$i]=$true}
                    else{
                        $counts[$i]+=$n
                        $hashes[$i].AppendData($buffers[$i],0,$n)
                        $room=[Math]::Max(0,8192-($kept[0].Length+$kept[1].Length))
                        $keep=[Math]::Min($room,$n)
                        if($keep -gt 0){$kept[$i].Write($buffers[$i],0,$keep)}
                        if($keep -ne $n){$held='ROOT_TRANSPORT_OUTPUT_OVERFLOW'}
                        $tasks[$i]=$streams[$i].ReadAsync($buffers[$i],0,4096)
                    }
                }
            }
            if((-not $p.HasExited) -or (-not ($done[0] -and $done[1]))){[System.Threading.Thread]::Sleep(1)}
        }
        if($done[0] -and $done[1] -and $p.HasExited){$p.WaitForExit()}
    } catch {
        $held='ROOT_TRANSPORT_OBSERVATION_UNKNOWN'
        $observationError=[Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([System.Text.Encoding]::UTF8.GetBytes([string]$_.Exception.Message))).ToLowerInvariant()
    } finally {
        if($started){try{if($p.HasExited){$literalExit=$p.ExitCode;$exitObserved=$true}}catch{$held='ROOT_NATIVE_EXIT_UNKNOWN'}}
        $utf8=[System.Text.UTF8Encoding]::new($false,$true)
        for($i=0;$i -lt 2;$i++){
            $validUTF8=$true
            try{$texts[$i]=$utf8.GetString($kept[$i].ToArray())}catch{$texts[$i]='';$validUTF8=$false;$held='ROOT_TRANSPORT_UTF8_UNKNOWN'}
            $sha=[Convert]::ToHexString($hashes[$i].GetHashAndReset()).ToLowerInvariant()
            $full=($done[$i] -and $validUTF8 -and $counts[$i] -eq $kept[$i].Length)
            $streamEvidence[$i]=[ordered]@{observed_bytes=$counts[$i];observed_sha256=$sha;stream_complete=$done[$i];hash_scope=$(if($done[$i]){'COMPLETE_OBSERVED_STREAM'}else{'OBSERVED_PREFIX_ONLY'});retained_bytes=$kept[$i].Length;retained_utf8_valid=$validUTF8;single_uppercase_code=(Safe-SingleCode -Text $texts[$i] -ObservedBytes $counts[$i] -Complete $full)}
            $hashes[$i].Dispose();$kept[$i].Dispose()
        }
        $p.Dispose()
    }
    return @{literal_native_exit=$literalExit;native_exit_observed=$exitObserved;stdout=$texts[0];stderr=$texts[1];elapsed_ms=$timer.Elapsed.TotalMilliseconds;held=$held;streams=$streamEvidence;observation_error_sha256=$observationError}
}
function One-JSON([string]$Text) {
    if([System.Text.Encoding]::UTF8.GetByteCount($Text) -gt 8192){throw 'ROOT_TRANSPORT_BOUND'}
    $v=ConvertFrom-Json -InputObject $Text
    if($null -eq $v -or $v -is [array]){throw 'ROOT_TRANSPORT_JSON'}
    return $v
}
$diagnostics=[ordered]@{issuer=(New-StageEvidence $null);observer=(New-StageEvidence $null);readback=(New-StageEvidence $null)}
try {
    if(-not $ROOTIssueOneMetadataTrial){throw 'ROOT_EXPLICIT_ONE_TRIAL_SWITCH_REQUIRED'}
    $hostPath='C:/Work/Non-verba/open-source/code/disputes/prototypes/priors-derivation/study-v0.2/experiments/literal-emphasis-parent-v1/tools/Invoke-ROOT-MetadataTrial.ps1'
    if([System.IO.Path]::GetFullPath($PSCommandPath) -ne [System.IO.Path]::GetFullPath($hostPath)){throw 'ROOT_FIXED_HOST_PATH'}
    if((Get-Item -LiteralPath $PSCommandPath).Attributes -band [System.IO.FileAttributes]::ReparsePoint){throw 'ROOT_HOST_REPARSE_POINT'}
    if((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHostSha256){throw 'ROOT_HOST_SOURCE_PIN'}
    $prefix=[string][long][Math]::Ceiling($whole.Elapsed.TotalMilliseconds)
    $diagnostics.issuer=New-StageEvidence -Result $null -Pending
    $issued=Invoke-FixedManaged -NodeArguments @($script,'--ROOT-ISSUE-ONE-METADATA-TRIAL',$nodeSHA,$nodeBytes,$prefix)
    $diagnostics.issuer=New-StageEvidence $issued
    $issuerOkay=($issued.native_exit_observed -and $issued.literal_native_exit -eq 0 -and $null -eq $issued.held -and $issued.stderr.Length -eq 0 -and $issued.elapsed_ms -le 1000)
    $i=$null
    if($issuerOkay){
        $i=One-JSON $issued.stdout
        $issuerOkay=($i.schema -eq 'ROOT-issuer-transport-v1' -and $i.status -eq 'ISSUED_ONE_METADATA_ONLY_NOT_EXECUTED' -and $i.decision_ref.path -eq $decision -and $i.decision_ref.sha256 -cmatch '^[a-f0-9]{64}$' -and $i.decision_ref.bytes -gt 0 -and $i.decision_ref.bytes -le 16384 -and $i.entry -eq $entry)
    }
    $observerExit=$null;$observerOkay=$false
    if($issuerOkay){
        # Issuer native process and streams have fully joined BEFORE observer.
        $diagnostics.observer=New-StageEvidence -Result $null -Pending
        $observed=Invoke-FixedManaged -NodeArguments @($entry,'--root-decision',$decision,[string]$i.decision_ref.sha256,[string]$i.decision_ref.bytes)
        $diagnostics.observer=New-StageEvidence $observed
        $observerExit=$observed.literal_native_exit
        $observerOkay=($observed.native_exit_observed -and $observerExit -eq 0 -and $null -eq $observed.held -and $observed.stdout.Length -eq 0 -and $observed.stderr.Length -eq 0)
    }
    # No human/model pause. The whole readback native call is timed externally.
    $external=[System.Diagnostics.Stopwatch]::StartNew()
    $diagnostics.readback=New-StageEvidence -Result $null -Pending
    $read=Invoke-FixedManaged -NodeArguments @($script,'--ROOT-IMMEDIATE-READBACK',$nodeSHA,$nodeBytes,$(if($null -ne $observerExit){[string]$observerExit}else{'-999'}),$(if($issuerOkay){'1'}else{'0'}),$(if($issuerOkay){[string]$i.decision_ref.sha256}else{'-'}),$(if($issuerOkay){[string]$i.decision_ref.bytes}else{'0'}))
    $diagnostics.readback=New-StageEvidence $read
    $rb=One-JSON $read.stdout
    if(-not $observerOkay -or -not $read.native_exit_observed -or $read.literal_native_exit -ne 0 -or $null -ne $read.held -or $read.stderr.Length -ne 0 -or $rb.status -ne 'NODE_VERIFIED_PENDING_HOST_EXIT_AND_DEADLINE_WITNESS'){throw 'ROOT_READBACK_HELD_OR_NATIVE_EXIT'}
    $begin=[System.Numerics.BigInteger]::Parse([string]$rb.begin_ns)
    $deadline=[System.Numerics.BigInteger]::Parse([string]$rb.issuer_deadline_ns)
    $allowed=[long][System.Numerics.BigInteger]::Divide(($deadline-$begin),[System.Numerics.BigInteger]1000000)
    if($allowed -lt 0 -or $external.Elapsed.TotalMilliseconds -gt $allowed -or ($whole.Elapsed.TotalMilliseconds+$failedCarryMs) -gt 180000){throw 'ROOT_EXTERNAL_DEADLINE'}
    $verdict=[ordered]@{schema='ROOT-metadata-trial-host-witness-v1';status='METADATA_ENGINEERING_READBACK_VERIFIED_PENDING_TOOL_EXIT0';literal_observer_Docker_exit=$observerExit;literal_readback_Docker_exit=$read.literal_native_exit;readback_receipt=$rb.receipt_ref;readback_begin_ns=[string]$rb.begin_ns;issuer_deadline_ns=[string]$rb.issuer_deadline_ns;external_readback_elapsed_ms=[Math]::Ceiling($external.Elapsed.TotalMilliseconds);whole_host_elapsed_ms=[Math]::Ceiling($whole.Elapsed.TotalMilliseconds);failed_sequence_charge_ms=$failedCarryMs;charged_host_elapsed_ms=([Math]::Ceiling($whole.Elapsed.TotalMilliseconds)+$failedCarryMs);stage_diagnostics=$diagnostics;original_denominator=200;selected=69;manual_source_reading=$false;source_or_native_qualification=$false;quality_gate_pass=$false;authority='NONE'}
    $line=ConvertTo-Json -InputObject $verdict -Compress -Depth 8
    if($line.Length -gt 4096 -or $external.Elapsed.TotalMilliseconds -gt $allowed -or ($whole.Elapsed.TotalMilliseconds+$failedCarryMs) -gt 180000){throw 'ROOT_HOST_SERIALIZATION_DEADLINE'}
    [Console]::WriteLine($line)
    if($external.Elapsed.TotalMilliseconds -gt $allowed -or ($whole.Elapsed.TotalMilliseconds+$failedCarryMs) -gt 180000){throw 'ROOT_HOST_OUTPUT_DEADLINE'}
    exit 0
} catch {
    $message=[string]$_.Exception.Message
    $code=Safe-SingleCode -Text $message -ObservedBytes ([System.Text.Encoding]::UTF8.GetByteCount($message)) -Complete $true
    $errorHash=[Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([System.Text.Encoding]::UTF8.GetBytes($message))).ToLowerInvariant()
    $held=[ordered]@{schema='ROOT-metadata-trial-host-witness-v1';status='HELD_UNUSABLE_NO_RETRY';error_code=$code;error_message_sha256=$errorHash;stage_diagnostics=$diagnostics;whole_host_elapsed_ms=[Math]::Ceiling($whole.Elapsed.TotalMilliseconds);failed_sequence_charge_ms=$failedCarryMs;charged_host_elapsed_ms=([Math]::Ceiling($whole.Elapsed.TotalMilliseconds)+$failedCarryMs);original_denominator=200;source_pilot_denominator=69;source_or_native_qualification=$false;quality_gate_pass=$false;presence_after_transport_failure='UNKNOWN_UNLESS_SEPARATELY_PROVEN';authority='NONE'}
    $line=ConvertTo-Json -InputObject $held -Compress -Depth 10
    if($line.Length -gt 8192){$line='{"schema":"ROOT-metadata-trial-host-witness-v1","status":"HELD_DIAGNOSTIC_BOUND","quality_gate_pass":false}'}
    [Console]::WriteLine($line)
    exit 2
}
