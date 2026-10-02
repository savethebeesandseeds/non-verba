# SPDX-License-Identifier: AGPL-3.0-only
[CmdletBinding()]
param(
    [ValidateSet('Prepare','Up','Status','Setup','Shell','Exec','Build','Test','Serve','Adb','Native')]
    [string]$Action = 'Status',
    [switch]$Snapshot,
    [Parameter(ValueFromRemainingArguments=$true)][string[]]$Command = @()
)
$ErrorActionPreference = 'Stop'
$catalog = Get-Content (Join-Path $PSScriptRoot 'container/config.json') -Raw | ConvertFrom-Json
$config = $catalog
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
function Invoke-Docker([string[]]$Arguments) {
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker failed ($LASTEXITCODE). Do not fall back to a Windows toolchain." }
}
function Inspect-Container {
    $names = @(Invoke-Docker @('container','ls','-a','--filter',"name=^/$($config.name)$",'--format','{{.Names}}'))
    if ($names -notcontains $config.name) { return $null }
    return (Invoke-Docker @('container','inspect',$config.name) | ConvertFrom-Json)[0]
}
function Assert-Container($item, $expected = $config, [string]$expectedWorkspace = $workspace) {
    $config = $expected
    $bind = @($item.Mounts | Where-Object { $_.Type -eq 'bind' -and $_.Destination -eq '/workspace' })
    $source = if ($bind.Count -eq 1) { $bind[0].Source.Replace('\','/').TrimEnd('/') } else { '' }
    if ($item.Config.Labels.'org.nonverba.managed' -ne 'true' -or
        $item.Config.Labels.'org.nonverba.configuration' -ne $config.configuration -or
        $item.Config.Labels.'org.nonverba.workspace' -ne $expectedWorkspace -or
        $item.Config.Image -ne $config.image -or
        ($item.Config.Cmd -join ' ') -ne 'sleep infinity' -or
        $item.Config.WorkingDir -ne $config.workdir -or
        $source -ne $expectedWorkspace.Replace('\','/').TrimEnd('/') -or
        $item.HostConfig.RestartPolicy.Name -ne 'no' -or $item.HostConfig.Privileged -or
        @($item.HostConfig.Devices).Count -ne 0 -or @($item.Mounts).Count -ne 3 -or
        $item.Config.Env -notcontains 'NONVERBA_CONTAINER=1') {
        throw 'The same-named container does not match the managed configuration. Preserved without changes.'
    }
    foreach ($volume in $config.volumes.PSObject.Properties) {
        if (-not ($item.Mounts | Where-Object { $_.Type -eq 'volume' -and $_.Name -eq $volume.Name -and $_.Destination -eq $volume.Value })) {
            throw 'Container volume mismatch. Preserved without changes.'
        }
    }
    $requests = @($item.HostConfig.DeviceRequests | Where-Object { $null -ne $_ })
    if ($config.gpus -eq 'all') {
        if ($requests.Count -ne 1 -or $requests[0].Count -ne -1 -or
            @($requests[0].DeviceIDs | Where-Object { $null -ne $_ }).Count -ne 0 -or
            ($requests[0].Capabilities | ConvertTo-Json -Compress -Depth 5) -notmatch '"gpu"' -or
            $item.Config.Env -notcontains 'NONVERBA_GPU=cuda' -or
            $item.Config.Env -notcontains 'NVIDIA_DRIVER_CAPABILITIES=compute,utility') {
            throw 'GPU configuration mismatch. Container preserved.'
        }
    } elseif ($requests.Count -ne 0) { throw 'Unexpected GPU access. Container preserved.' }
    if (@($item.HostConfig.PortBindings.PSObject.Properties).Count -ne @($config.ports.PSObject.Properties).Count) { throw 'Unexpected published ports.' }
    foreach ($port in $config.ports.PSObject.Properties) {
        $bindings = @($item.HostConfig.PortBindings.($port.Value+'/tcp'))
        if ($bindings.Count -ne 1 -or $bindings[0].HostIp -ne '127.0.0.1' -or $bindings[0].HostPort -ne $port.Name) { throw 'Container port mismatch.' }
    }
}
function Prepare-GpuImage {
    $config = $catalog.gpuImage
    $inputs = @('.dockerignore','setup.sh','dev.sh','container/Dockerfile','container/env.sh','container/debian-packages.lock','container/cuda-packages.lock','tools/check-gpu.cpp')
    $hashes = ($inputs | ForEach-Object { (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $_) -Algorithm SHA256).Hash }) -join ':'
    $inputHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($hashes))).ToLowerInvariant()
    $images = @(Invoke-Docker @('image','ls','--quiet',$config.image))
    if ($images.Count -gt 0) {
        $image = (Invoke-Docker @('image','inspect',$config.image) | ConvertFrom-Json)[0]
        if ($image.Config.Labels.'org.nonverba.managed' -ne 'true' -or
            $image.Config.Labels.'org.nonverba.workspace' -ne $workspace -or
            $image.Config.Labels.'org.nonverba.configuration' -ne $config.configuration -or
            $image.Config.Labels.'org.nonverba.provisioning' -ne $inputHash) {
            throw 'Existing image differs from the requested managed build. Preserved; an explicit rebuild is required.'
        }
        return
    }
    $legacy = (Invoke-Docker @('container','inspect',$catalog.name) | ConvertFrom-Json)[0]
    Assert-Container $legacy $catalog
    $licenseFile = Join-Path ([IO.Path]::GetTempPath()) ('nonverba-android-license-' + [Guid]::NewGuid().ToString('N'))
    try {
        Invoke-Docker @('cp',"$($legacy.Id):/opt/nonverba-tools/android-sdk/licenses/android-sdk-license",$licenseFile)
        Invoke-Docker @('build','--progress','plain','--file',(Join-Path $PSScriptRoot 'container/Dockerfile'),
            '--tag',$config.image,'--label','org.nonverba.managed=true',
            '--label',"org.nonverba.configuration=$($config.configuration)",
            '--label',"org.nonverba.workspace=$workspace",'--label',"org.nonverba.provisioning=$inputHash",
            '--build-arg',"NONVERBA_CUDA_ARCHITECTURES=$($config.cudaArchitectures)",
            '--secret',"id=android_license,src=$licenseFile",$PSScriptRoot)
    } finally {
        if (Test-Path -LiteralPath $licenseFile) { Remove-Item -LiteralPath $licenseFile }
    }
}
function Invoke-SourceSnapshot {
    if ($Action -in @('Prepare','Up','Adb')) {
        throw 'Snapshot mode never prepares images, creates/starts containers or accesses devices. Start the preserved container with its original launcher, then use -Snapshot. See docs/development/CONTAINER_MIGRATION.md.'
    }
    $existing = Inspect-Container
    if (-not $existing) { throw 'The preserved non-verba-dev container is missing; snapshot mode never creates a replacement.' }
    $recordedWorkspace = [IO.Path]::GetFullPath((Join-Path $workspace '../private-source'))
    Assert-Container $existing $catalog $recordedWorkspace
    if ($existing.Id -cne 'fcb9461f2ccc1d76871ee40713fcc93752b72e51a454890188cf9b1f052d7d4e' -or
        $existing.Image -cne 'sha256:2fb1e6b1c3250aae15625a15c4496326bceb8487b26ac9f66cd94f7c2462bc1e') {
        throw 'Snapshot migration bridge only supports the recorded preserved container and image. Resolve a changed environment explicitly; no container was changed.'
    }
    if ($Action -eq 'Status') {
        [pscustomobject]@{Name=$catalog.name;Id=$existing.Id;Running=$existing.State.Running;ImageId=$existing.Image;BoundWorkspace=$recordedWorkspace;SnapshotSource=$workspace;Lifecycle='Preserved; no snapshot copied'} | ConvertTo-Json
        return
    }
    if (-not $existing.State.Running) { throw 'The preserved container is stopped. Start it with the original private-source/code/dev.ps1 Up; snapshot mode never starts containers.' }

    # Explicit source namespaces only. Publication review remains a prerequisite;
    # this bridge adds exclusions and refuses linked files rather than sending a
    # whole checkout, Git history, local evidence, vaults or developer caches.
    $rootFiles = @('README.md','CONTRIBUTING.md','GOVERNANCE.md','SECURITY.md','AGENTS.md','LICENSE','.gitignore','.gitattributes','THIRD_PARTY_NOTICES.md')
    $sourceRoots = @('LICENSES','docs','web','code/crates','code/android','code/container','code/tools','code/test','code/protocol','code/simulator','code/examples','code/requests','code/disputes','.github/workflows')
    $codeFiles = @('Cargo.toml','Cargo.lock','rust-toolchain.toml','package.json','package-lock.json','dev.ps1','dev.sh','setup.sh','.dockerignore')
    $excludedDirectories = @('.git','.tools','.toolchain','.gradle','.kotlin','.cxx','node_modules','target','dist','artifacts','reviews','build','jniLibs')
    $extensions = @('.rs','.mjs','.js','.css','.html','.kt','.kts','.cpp','.h','.c','.toml','.lock','.json','.md','.sh','.ps1','.yml','.yaml','.txt','.svg','.png','.xml','.properties','.rnx')
    $files = [Collections.Generic.List[string]]::new()
    function Assert-SnapshotPath([string]$absolute) {
        $base = Get-Item -LiteralPath $workspace -Force
        if ($base.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Snapshot checkout root must not be linked.' }
        $cursor = $workspace
        foreach ($part in [IO.Path]::GetRelativePath($workspace,$absolute).Split([IO.Path]::DirectorySeparatorChar)) {
            $cursor = Join-Path $cursor $part
            $component = Get-Item -LiteralPath $cursor -Force
            if ($component.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked snapshot path component: $cursor" }
        }
    }
    function Add-SnapshotFile($item) {
        $absolute = [IO.Path]::GetFullPath($item.FullName)
        if (-not $absolute.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Snapshot input is outside the source tree or linked: $absolute" }
        $relative = [IO.Path]::GetRelativePath($workspace,$absolute).Replace('\','/')
        Assert-SnapshotPath $absolute
        if ($relative -match '[\r\n]' -or $relative.StartsWith('-') -or $item.Name -match '^(?:\.env(?:\.|$)|local\.properties$)' -or
            $item.Extension -match '^\.(?:keystore|jks|p12|pfx|key|pem)$') { throw "Private or unsafe snapshot input: $relative" }
        if ($item.Length -gt 128MB) { throw "Unexpectedly large source input: $relative" }
        $files.Add($relative)
    }
    function Visit-SnapshotDirectory([string]$directory) {
        Assert-SnapshotPath $directory
        $parent = Get-Item -LiteralPath $directory -Force
        if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked source directory: $directory" }
        foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
            if ($item.PSIsContainer) {
                $relativeDirectory = [IO.Path]::GetRelativePath($workspace,$item.FullName).Replace('\','/')
                if ($item.Name -notin $excludedDirectories -and $relativeDirectory -cne 'code/android/app/src/main/assets') { Visit-SnapshotDirectory $item.FullName }
            } elseif ($item.Name -notin @('local.properties') -and $item.Name -notmatch '^\.env(?:\.|$)') {
                if ($item.Extension.ToLowerInvariant() -in $extensions -or $item.Name -in @('.dockerignore','.gitignore','Dockerfile')) { Add-SnapshotFile $item }
                else { throw "Unreviewed file type in snapshot source namespace: $($item.FullName)" }
            }
        }
    }
    foreach ($name in $rootFiles + @($codeFiles | ForEach-Object { 'code/' + $_ })) {
        $path = Join-Path $workspace $name
        if (Test-Path -LiteralPath $path -PathType Leaf) { Add-SnapshotFile (Get-Item -LiteralPath $path -Force) }
    }
    foreach ($name in $sourceRoots) {
        $path = Join-Path $workspace $name
        if (Test-Path -LiteralPath $path -PathType Container) { Visit-SnapshotDirectory $path }
    }
    foreach ($required in @('LICENSE','code/dev.sh','code/container/env.sh','code/Cargo.toml')) {
        if ($files -notcontains $required) { throw "Snapshot source is incomplete: $required" }
    }
    $files = @($files | Sort-Object -Unique)
    $before = @{}
    $sourceBytes = 0L
    foreach ($name in $files) {
        $sourceBytes += (Get-Item -LiteralPath (Join-Path $workspace $name)).Length
        if ($sourceBytes -gt 128MB) { throw 'Source snapshot exceeds the 128 MiB source-only limit. Review the inputs before copying.' }
    }
    foreach ($name in $files) {
        $before[$name] = (Get-FileHash -LiteralPath (Join-Path $workspace $name) -Algorithm SHA256).Hash
    }
    $token = [Guid]::NewGuid().ToString('N')
    $manifestPath = Join-Path ([IO.Path]::GetTempPath()) "nonverba-source-$token.txt"
    $archivePath = Join-Path ([IO.Path]::GetTempPath()) "nonverba-source-$token.tar"
    $snapshotRoot = "/tmp/nonverba-unified-source/$token"
    $remoteArchive = "/tmp/nonverba-source-$token.tar"
    try {
        [IO.File]::WriteAllLines($manifestPath,$files,[Text.UTF8Encoding]::new($false))
        # Only explicit regular-file names enter -T; no directory recursion or
        # option-looking names are accepted by Add-SnapshotFile.
        & tar -cf $archivePath -C $workspace -T $manifestPath
        if ($LASTEXITCODE -ne 0) { throw 'Source snapshot archive failed; nothing was executed.' }
        # Independently inspect the archive, not just the inputs. A reparse race
        # or unexpected archiver entry must never reach container extraction.
        $archiveStream = [IO.File]::OpenRead($archivePath)
        $reader = [System.Formats.Tar.TarReader]::new($archiveStream)
        $archived = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        try {
            while ($entry = $reader.GetNextEntry()) {
                if ($entry.EntryType -notin @([System.Formats.Tar.TarEntryType]::RegularFile,[System.Formats.Tar.TarEntryType]::V7RegularFile) -or
                    -not $before.ContainsKey($entry.Name) -or -not $archived.Add($entry.Name)) { throw 'Unexpected, duplicated or linked archive entry; snapshot was not copied.' }
                $entryDigest = if ($entry.DataStream) { [Security.Cryptography.SHA256]::HashData($entry.DataStream) } else { [Security.Cryptography.SHA256]::HashData([byte[]]@()) }
                if ([Convert]::ToHexString($entryDigest) -cne $before[$entry.Name]) { throw "Archived source differs from inspected input: $($entry.Name)" }
            }
            if ($archived.Count -ne $files.Count) { throw 'Snapshot archive file set is incomplete.' }
        } finally { $reader.Dispose(); $archiveStream.Dispose() }
        foreach ($name in $files) {
            if ((Get-FileHash -LiteralPath (Join-Path $workspace $name) -Algorithm SHA256).Hash -cne $before[$name]) { throw "Source changed during snapshot creation: $name" }
        }
        $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        $revision = (& git -c "safe.directory=$workspace" -C $workspace rev-parse HEAD 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40}$') { throw 'Cannot identify snapshot base revision.' }
        $changes = @(& git -c "safe.directory=$workspace" -C $workspace status --porcelain --untracked-files=normal)
        if ($LASTEXITCODE -ne 0) { throw 'Cannot determine source worktree status.' }
        $dirty = if ($changes.Count -gt 0) { '1' } else { '0' }
        Invoke-Docker @('cp',$archivePath,"$($existing.Id):$remoteArchive")
        $extract = @'
set -euo pipefail
snapshot_token=${1##*/}
if [[ ! $snapshot_token =~ ^[0-9a-f]{32}$ ||
      $1 != "/tmp/nonverba-unified-source/$snapshot_token" ||
      $2 != "/tmp/nonverba-source-$snapshot_token.tar" ]]; then
  echo 'Unexpected snapshot transfer paths; extraction and cleanup refused.' >&2
  exit 2
fi
readonly transfer_archive="$2"
# Remove only this invocation's copied transfer file, including extraction failure.
# The source snapshot, build outputs, caches and previously existing data stay intact.
trap 'if [[ -f "$transfer_archive" && ! -L "$transfer_archive" ]]; then rm -- "$transfer_archive"; fi' EXIT
test -f "$transfer_archive"
test ! -L "$transfer_archive"
test ! -L /tmp/nonverba-unified-source
mkdir -p /tmp/nonverba-unified-source
test ! -e "$1"
printf '%s  %s\n' "$3" "$2" | sha256sum --check --status
mkdir "$1"
tar --extract --file "$2" --directory "$1" --no-same-owner --no-same-permissions
test -f "$1/code/dev.sh"
printf '%s\n' "$3" > "$1/.snapshot-archive-sha256"
'@
        Invoke-Docker @('exec',$existing.Id,'bash','-c',$extract,'snapshot',$snapshotRoot,$remoteArchive,$archiveHash)
        Write-Output "Source snapshot: $snapshotRoot ($($files.Count) reviewed-namespace files, base $revision, dirty=$dirty). Outputs remain inside this snapshot; original sources and container configuration are preserved."
        $arguments = @('exec')
        if ($Action -eq 'Shell') { $arguments += '-it' }
        $arguments += @('--workdir',"$snapshotRoot/code",'--env',"NONVERBA_SOURCE_REVISION=$revision",'--env',"NONVERBA_SOURCE_DIRTY=$dirty",'--env',"NONVERBA_SOURCE_SNAPSHOT_SHA256=$archiveHash",$existing.Id)
        switch ($Action) {
            'Setup' { Invoke-Docker ($arguments + @('bash',"$snapshotRoot/code/setup.sh")) }
            'Shell' { Invoke-Docker ($arguments + @('bash','--rcfile',"$snapshotRoot/code/container/env.sh",'-i')) }
            'Exec' { Invoke-Docker ($arguments + @('bash',"$snapshotRoot/code/dev.sh",'exec') + $Command) }
            default { Invoke-Docker ($arguments + @('bash',"$snapshotRoot/code/dev.sh",$Action.ToLowerInvariant()) + $Command) }
        }
    } finally {
        foreach ($path in @($manifestPath,$archivePath)) {
            if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path }
        }
    }
}
if ($Snapshot) {
    Invoke-SourceSnapshot
    exit 0
}
if ($Action -eq 'Prepare') {
    # Image preparation has no container or volume lifecycle side effects.
    Prepare-GpuImage
    $image = (Invoke-Docker @('image','inspect',$catalog.gpuImage.image) | ConvertFrom-Json)[0]
    [pscustomobject]@{Image=$catalog.gpuImage.image;Id=$image.Id;Labels=$image.Config.Labels;Lifecycle='Image preparation does not change containers'} | ConvertTo-Json -Depth 4
    exit 0
}
$container = Inspect-Container
if ($container) { Assert-Container $container }
if ($Action -eq 'Up') {
    if (-not $container) {
        # Validate ALL existing volumes before creating any new object.
        $existingVolumes = @(Invoke-Docker @('volume','ls','--format','{{.Name}}'))
        foreach ($volume in $config.volumes.PSObject.Properties) {
            if ($existingVolumes -contains $volume.Name) {
                $info = (Invoke-Docker @('volume','inspect',$volume.Name) | ConvertFrom-Json)[0]
                if ($info.Labels.'org.nonverba.managed' -ne 'true' -or $info.Labels.'org.nonverba.workspace' -ne $workspace) {
                    throw "Existing volume $($volume.Name) is unmanaged or belongs to another workspace. Preserved."
                }
            }
        }
        if ($config.image -eq $catalog.gpuImage.image) { Prepare-GpuImage }
        else { Invoke-Docker @('pull',$config.image) }
        foreach ($volume in $config.volumes.PSObject.Properties) {
            if ($existingVolumes -notcontains $volume.Name) {
                Invoke-Docker @('volume','create','--label','org.nonverba.managed=true','--label',"org.nonverba.workspace=$workspace",$volume.Name)
            }
        }
        $arguments = @('container','create','--name',$config.name,'--restart','no','--workdir',$config.workdir,
            '--label','org.nonverba.managed=true','--label',"org.nonverba.configuration=$($config.configuration)",
            '--label',"org.nonverba.workspace=$workspace",'--env','NONVERBA_CONTAINER=1',
            '--mount',"type=bind,source=$workspace,target=/workspace")
        foreach ($volume in $config.volumes.PSObject.Properties) { $arguments += @('--mount',"type=volume,source=$($volume.Name),target=$($volume.Value)") }
        foreach ($port in $config.ports.PSObject.Properties) { $arguments += @('--publish',"127.0.0.1:$($port.Name):$($port.Value)") }
        if ($config.gpus -eq 'all') { $arguments += @('--gpus','all','--env','NONVERBA_GPU=cuda') }
        $arguments += @($config.image) + @($config.command)
        Invoke-Docker $arguments
        $container = Inspect-Container
        Assert-Container $container
    }
    if (-not $container.State.Running) {
        Invoke-Docker @('container','start',$container.Id)
    }
    $container = Inspect-Container
    Assert-Container $container
}
if ($Action -in @('Up','Status')) {
    if (-not $container) { Write-Output "$($config.name) does not exist. Use code/dev.ps1 Up to create the documented current environment."; exit 0 }
    [pscustomobject]@{Name=$config.name;Id=$container.Id;Running=$container.State.Running;Image=$container.Config.Image;ImageId=$container.Image;Mounts=$container.Mounts;Ports=$container.HostConfig.PortBindings;Devices=$container.HostConfig.Devices;GPU=$container.HostConfig.DeviceRequests;Restart=$container.HostConfig.RestartPolicy.Name} | ConvertTo-Json -Depth 6
    exit 0
}
if (-not $container -or -not $container.State.Running) { throw 'Run code/dev.ps1 Up first. Host toolchain fallback is prohibited.' }
$prefix = @('exec')
if ($Action -eq 'Shell' -or ($Action -eq 'Adb' -and $Command -contains 'pair')) { $prefix += '-it' }
$prefix += $container.Id
switch ($Action) {
    'Setup' { Invoke-Docker ($prefix + @('bash','/workspace/code/setup.sh')) }
    'Shell' { Invoke-Docker ($prefix + @('bash','--rcfile','/workspace/code/container/env.sh','-i')) }
    'Exec'  { Invoke-Docker ($prefix + @('bash','/workspace/code/dev.sh','exec') + $Command) }
    default { Invoke-Docker ($prefix + @('bash','/workspace/code/dev.sh',$Action.ToLowerInvariant()) + $Command) }
}
