<#
.SYNOPSIS
    Builds reticlex_core.dll on Windows.

.DESCRIPTION
    Configures and builds the native core with CMake and the Visual Studio
    toolchain, then runs the C++ test suite. The resulting DLL is what the
    desktop host loads through P/Invoke; the front end uses the WebAssembly
    build of the same sources.

.PARAMETER Configuration
    CMake configuration to build. Release by default.

.PARAMETER BuildDir
    Where to put the build tree. build/native by default.

.PARAMETER SkipTests
    Build without running the core test suite.

.EXAMPLE
    pwsh scripts/build-native.ps1
#>
[CmdletBinding()]
param(
    [string]$Configuration = 'Release',
    [string]$BuildDir = '',
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $BuildDir) { $BuildDir = Join-Path $root 'build/native' }

Write-Host '==> Configuring' -ForegroundColor Cyan
cmake -S (Join-Path $root 'core') -B $BuildDir -A x64
if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed ($LASTEXITCODE)." }

Write-Host '==> Building' -ForegroundColor Cyan
cmake --build $BuildDir --config $Configuration
if ($LASTEXITCODE -ne 0) { throw "CMake build failed ($LASTEXITCODE)." }

if (-not $SkipTests) {
    Write-Host '==> Running the core test suite' -ForegroundColor Cyan
    $tests = Join-Path $BuildDir "$Configuration/reticlex_tests.exe"
    if (-not (Test-Path $tests)) { throw "Test binary not found at $tests." }
    & $tests
    if ($LASTEXITCODE -ne 0) { throw "The core test suite failed ($LASTEXITCODE)." }
}

$dll = Join-Path $BuildDir "$Configuration/reticlex_core.dll"
if (-not (Test-Path $dll)) { throw "reticlex_core.dll was not produced at $dll." }

Write-Host "==> Done. $dll" -ForegroundColor Green
Write-Output $dll
