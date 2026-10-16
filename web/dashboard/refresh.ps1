# SPDX-License-Identifier: AGPL-3.0-only
# Host orchestration only: validation, bundling and browser checks run in Debian.
param([switch]$Check, [switch]$BrowserCheck)
$ErrorActionPreference = 'Stop'
$dashboardRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $dashboardRoot '../..'))
$launcherPath = Join-Path $repositoryRoot 'code/dev.ps1'
$manifest = Get-Content -LiteralPath (Join-Path $dashboardRoot 'manifest.json') -Raw | ConvertFrom-Json
$inputs = @('manifest.json', 'src/model.js', 'tools/project.mjs', 'src/template.html', 'src/dashboard.js',
    'src/dashboard.css', 'tools/build-standalone.mjs', 'tools/branding.mjs', 'tools/validate.mjs', 'refresh.ps1', 'refresh.sh',
    'schemas/hero.schema.json', 'schemas/manifest.schema.json', 'test/model.test.mjs', 'test/browser.mjs')
$inputs += @(
    'assets/branding/portrait.png', 'assets/branding/identity.png', 'assets/branding/assignments.png',
    'assets/branding/priors.png', 'assets/branding/disputes.png', 'assets/branding/union.png',
    'assets/branding/incidents.png', 'assets/branding/workflows.png', 'assets/branding/governance.png',
    'assets/branding/apk.png', 'assets/branding/services.png', '../site/branding/sprout.svg',
    '../site/branding/individual/01-sprout.png', '../site/branding/individual/02-leafy.png',
    '../site/branding/individual/14-vine.png', '../site/branding/individual/09-mushroom.png',
    '../site/branding/individual/15-lotus.png', '../site/branding/individual/13-clover.png',
    '../site/branding/individual/08-cactus.png', '../site/branding/individual/18-bamboo.png',
    '../site/branding/individual/17-oak.png', '../site/branding/individual/21-seedling.png',
    '../site/branding/individual/24-multi.png'
)
foreach ($hero in $manifest.heroes) {
    if ($hero.file -cnotmatch '^[0-9]{2,3}-[a-z0-9-]+\.json$') { throw 'Hero filenames must be numbered JSON beside index.html.' }
    $inputs += $hero.file
}
$inputs += 'index.html'
$before = @{}
foreach ($name in $inputs) {
    $before[$name] = (Get-FileHash -LiteralPath (Join-Path $dashboardRoot $name) -Algorithm SHA256).Hash
}
$command = @('bash', '../web/dashboard/refresh.sh')
if ($Check) { $command += '--check' }
if ($BrowserCheck) { $command += '--browser-check' }
if ($BrowserCheck -and $env:NONVERBA_DASHBOARD_SCREENSHOTS) {
    # The browser checks accept only destinations inside their current snapshot.
    $command = @('env', "NONVERBA_DASHBOARD_SCREENSHOTS=$($env:NONVERBA_DASHBOARD_SCREENSHOTS)") + $command
}
# The authoritative bridge verifies the immutable container, image and mounts.
# It neither starts a server nor creates/replaces a container.
# Git Bash puts POSIX tar first; the Windows launcher needs native tools for C:\ paths.
$previousPath = $env:PATH
try {
    $systemTools = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
    if (-not [IO.File]::Exists((Join-Path $systemTools 'tar.exe'))) { throw 'The required Windows archive tool is unavailable.' }
    $env:PATH = $systemTools + [IO.Path]::PathSeparator + $previousPath
    $output = @(& $launcherPath -Snapshot -Action Exec -Command $command)
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard checks failed; the workspace HTML was preserved.' }
} finally {
    $env:PATH = $previousPath
}
$output | Write-Output
foreach ($name in $inputs) {
    if ((Get-FileHash -LiteralPath (Join-Path $dashboardRoot $name) -Algorithm SHA256).Hash -cne $before[$name]) {
        throw "Dashboard source changed during refresh: $name. HTML was preserved; rerun with the current files."
    }
}
if ($Check) { return }
$snapshotPaths = @($output | ForEach-Object {
    if ($_ -is [string] -and $_ -match '^Source snapshot: (/tmp/nonverba-unified-source/[a-f0-9]{32}) ') { $Matches[1] }
})
if ($snapshotPaths.Count -ne 1) { throw 'Could not identify the verified snapshot; workspace HTML was preserved.' }
$containerId = 'fcb9461f2ccc1d76871ee40713fcc93752b72e51a454890188cf9b1f052d7d4e'
$temporaryHtml = Join-Path $dashboardRoot ('.index-' + [Guid]::NewGuid().ToString('N') + '.html')
try {
    & docker cp "${containerId}:$($snapshotPaths[0])/web/dashboard/index.html" $temporaryHtml
    if ($LASTEXITCODE -ne 0) { throw 'Could not copy the generated dashboard; workspace HTML was preserved.' }
    foreach ($name in $inputs) {
        if ((Get-FileHash -LiteralPath (Join-Path $dashboardRoot $name) -Algorithm SHA256).Hash -cne $before[$name]) {
            throw "Dashboard source changed during copy: $name. HTML was preserved; rerun with the current files."
        }
    }
    [IO.File]::Move($temporaryHtml, (Join-Path $dashboardRoot 'index.html'), $true)
    Write-Output "Refreshed standalone dashboard: $dashboardRoot/index.html. Reload the browser to see it."
} finally {
    # Only the current invocation's explicit transfer file is disposable.
    if (Test-Path -LiteralPath $temporaryHtml -PathType Leaf) { Remove-Item -LiteralPath $temporaryHtml }
}
