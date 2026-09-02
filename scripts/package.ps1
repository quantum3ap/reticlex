<#
.SYNOPSIS
    Builds the Windows release artifacts.

.DESCRIPTION
    Produces two executables from one source tree:

      ReticleX-v<version>-Setup.exe     Inno Setup installer, per-user, no
                                        administrator prompt.
      ReticleX-v<version>-Portable.exe  A single self-contained file that runs
                                        from anywhere, including a USB stick.

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
    "-p:FileVersion=$Version.0",
    "-p:AssemblyVersion=$Version.0",
    "-p:ReticleXNativeDll=$NativeDll",
    '-p:DebugType=none',
    '--nologo'
)

# --- Installed build: framework-dependent, so updates to .NET apply to it ----
Write-Host "==> Publishing the installed build" -ForegroundColor Cyan
dotnet publish $appProject @common --self-contained false -o $publishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)." }

# --- Portable build: self-contained single file, nothing to install ----------
Write-Host "==> Publishing the portable build" -ForegroundColor Cyan
dotnet publish $appProject @common `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -o $portableDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish (portable) failed ($LASTEXITCODE)." }

foreach ($dir in @($publishDir, $portableDir)) {
    $exe = Join-Path $dir 'ReticleX.exe'
    if (-not (Test-Path $exe)) { throw "ReticleX.exe was not produced in $dir." }
    if (-not (Test-Path (Join-Path $dir 'reticlex_core.dll'))) {
        throw "reticlex_core.dll is missing from $dir."
    }
    if (-not (Test-Path (Join-Path $dir 'app/frontend/index.html'))) {
        throw "The web front end is missing from $dir."
    }
    if (-not (Test-Path (Join-Path $dir 'app/localization/ar.json'))) {
        throw "The translation catalogues are missing from $dir."
    }
}

# --- Portable executable -----------------------------------------------------
# Single-file publish still leaves the content folder beside the executable, so
# the portable download is a zip of the whole folder plus the bare exe for
# people who only want to try it.
$portableExe = Join-Path $OutputDir "ReticleX-v$Version-Portable.exe"
Copy-Item (Join-Path $portableDir 'ReticleX.exe') $portableExe -Force

$portableZip = Join-Path $OutputDir "ReticleX-v$Version-Portable.zip"
Compress-Archive -Path (Join-Path $portableDir '*') -DestinationPath $portableZip -Force

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
