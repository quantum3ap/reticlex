<#
.SYNOPSIS
    Builds the Windows release artifacts.

.DESCRIPTION
    Produces two executables from one source tree:

      ReticleX-v<version>-Setup.exe     Inno Setup installer, per-user, no
                                        administrator prompt. Framework
                                        dependent, so .NET updates apply to it.
      ReticleX-v<version>-Portable.exe  One self-contained file with the web
                                        front end, the catalogues and the
                                        presets embedded. Runs from anywhere,
                                        including a USB stick.

    The native core must already be built; pass its path or let the script use
    the conventional build/native location.

.PARAMETER Version
    Version stamped into the assemblies, the installer and the file names.

.PARAMETER NativeDll
    Path to reticlex_core.dll. Defaults to build/native/Release.

.PARAMETER OutputDir
    Where the finished executables are written. build/artifacts by default.

.PARAMETER SkipInstaller
    Produce only the portable build (useful when Inno Setup is unavailable).

.EXAMPLE
    pwsh scripts/package.ps1 -Version 1.0.0
#>
[CmdletBinding()]
param(
    [string]$Version = '1.0.0',
    [string]$NativeDll = '',
    [string]$OutputDir = '',
    [switch]$SkipInstaller
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not $NativeDll)  { $NativeDll  = Join-Path $root 'build/native/Release/reticlex_core.dll' }
if (-not $OutputDir)  { $OutputDir  = Join-Path $root 'build/artifacts' }

$publishDir   = Join-Path $root 'build/publish'
$portableDir  = Join-Path $root 'build/portable'
$appProject   = Join-Path $root 'desktop/csharp/ReticleX.App/ReticleX.App.csproj'

# AssemblyVersion, FileVersion and the installer's VersionInfoVersion only
# accept numbers, so a prerelease suffix — "1.0.0-rc.1", or the "0.0.0-ci" the
# CI packaging check uses — is stripped for those. $Version itself keeps the
# full string, since that is what names the files and what the About page shows.
if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)') {
    throw "Version '$Version' has to start with major.minor.patch."
}
$numericVersion = '{0}.{1}.{2}.0' -f $Matches[1], $Matches[2], $Matches[3]

if (-not (Test-Path $NativeDll)) {
    throw "reticlex_core.dll was not found at $NativeDll. Run scripts/build-native.ps1 first."
}

foreach ($dir in @($publishDir, $portableDir, $OutputDir)) {
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$common = @(
    '-c', 'Release',
    '-r', 'win-x64',
    "-p:Version=$Version",
    "-p:FileVersion=$numericVersion",
    "-p:AssemblyVersion=$numericVersion",
    "-p:ReticleXNativeDll=$NativeDll",
    '-p:DebugType=none',
    # Precompiled to native alongside the IL. The alternative is jitting the
    # whole start-up path on every launch, which is the single largest cost
    # between double-clicking the icon and seeing a window. It costs disk.
    '-p:PublishReadyToRun=true',
    '--nologo'
)

# --- Installed build: framework-dependent, so updates to .NET apply to it ----
Write-Host "==> Publishing the installed build" -ForegroundColor Cyan
dotnet publish $appProject @common --self-contained false -o $publishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)." }

# --- Portable build: one self-contained file, nothing to install -------------
# IncludeAllContentForSelfExtract matters here: the web front end has to exist
# on disk for WebView2 to serve it, so without it the single file would start
# and then find nothing to show. With it, the content is unpacked beside the
# extracted binaries and AppContext.BaseDirectory points at them.
#
# Compressed. Dropping this in 1.4.1 to save a second on the very first launch
# took the portable build from 66 MB to 157 MB, which is past what a release
# asset uploads reliably and is paid by everyone who downloads it. The cost it
# saves is paid once: the bundle is extracted to a cache on first run and
# reused afterwards. Megabytes every time beats a second once.
Write-Host "==> Publishing the portable build" -ForegroundColor Cyan
dotnet publish $appProject @common `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:IncludeAllContentForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -o $portableDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish (portable) failed ($LASTEXITCODE)." }

# The installed layout keeps everything as loose files.
foreach ($required in @('ReticleX.exe', 'reticlex_core.dll', 'app/frontend/index.html',
                        'app/localization/ar.json', 'app/presets/builtin.json')) {
    if (-not (Test-Path (Join-Path $publishDir $required))) {
        throw "$required is missing from the installed build."
    }
}

# The portable layout is a single file; everything else is inside it.
$portableSource = Join-Path $portableDir 'ReticleX.exe'
if (-not (Test-Path $portableSource)) { throw 'The portable ReticleX.exe was not produced.' }
$portableSize = (Get-Item $portableSource).Length
if ($portableSize -lt 30MB) {
    throw "The portable build is only $portableSize bytes, so its payload cannot be embedded."
}
# A ceiling as well as a floor. 1.4.1 shipped a 157 MB portable because the
# compression flag had been dropped, and nothing noticed until the release
# upload refused it. A compressed build is around 66 MB, so this catches the
# flag going missing again while leaving room for the app to grow.
if ($portableSize -gt 120MB) {
    throw ("The portable build is {0:N0} bytes. That is far past a compressed " +
           "single file, so EnableCompressionInSingleFile is not taking effect." -f $portableSize)
}

$portableExe = Join-Path $OutputDir "ReticleX-v$Version-Portable.exe"
Copy-Item $portableSource $portableExe -Force

# --- Installer ---------------------------------------------------------------
if (-not $SkipInstaller) {
    $iscc = @(
        'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
        'C:\Program Files\Inno Setup 6\ISCC.exe'
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (-not $iscc) {
        Write-Warning 'Inno Setup 6 was not found; skipping the installer.'
    } else {
        Write-Host "==> Building the installer" -ForegroundColor Cyan
        & $iscc `
            "/DAppVersion=$Version" `
            "/DAppNumericVersion=$numericVersion" `
            "/DPayloadDir=$publishDir" `
            "/DOutputDir=$OutputDir" `
            (Join-Path $root 'installer/ReticleX.iss')
        if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed ($LASTEXITCODE)." }
    }
}

Write-Host "==> Artifacts" -ForegroundColor Green
Get-ChildItem $OutputDir | ForEach-Object {
    '{0,-44} {1,10:N0} bytes' -f $_.Name, $_.Length | Write-Host
}
