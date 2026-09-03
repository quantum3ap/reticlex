<#
.SYNOPSIS
    Builds the ReticleX core as a WebAssembly module on Windows.

.DESCRIPTION
    The front end renders the live preview from this module, so the browser and
    the Windows host share one geometry implementation. Requires clang with a
    wasm32 target and wasm-ld, both of which ship with LLVM for Windows.

.EXAMPLE
    pwsh scripts/build-wasm.ps1
#>
[CmdletBinding()]
param(
    [string]$Output = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Output) { $Output = Join-Path $root 'frontend/assets/reticlex_core.wasm' }

foreach ($tool in @('clang', 'clang++', 'wasm-ld')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool was not found on PATH. Install LLVM (winget install LLVM.LLVM)."
    }
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null

try {
    $common = @(
        '--target=wasm32', '-O2', '-DNDEBUG', '-fno-math-errno', '-ffp-contract=off',
        '-ffunction-sections', '-fdata-sections', '-fvisibility=hidden', '-nostdlib',
        "-I$(Join-Path $root 'core/c/include')",
        "-I$(Join-Path $root 'core/cpp/include')",
        '-Wall', '-Wextra', '-Wno-unused-parameter'
    )

    $objects = @()

    foreach ($name in @('rx_math', 'rx_rand', 'rx_color', 'rx_hash', 'rx_freestanding')) {
        $object = Join-Path $work "$name.o"
        & clang @common -std=c11 -c (Join-Path $root "core/c/src/$name.c") -o $object
        if ($LASTEXITCODE -ne 0) { throw "Compiling $name.c failed." }
        $objects += $object
    }

    foreach ($name in @('config', 'geometry', 'raster', 'random', 'api')) {
        $object = Join-Path $work "$name.o"
        & clang++ @common -std=c++20 -fno-exceptions -fno-rtti `
            -c (Join-Path $root "core/cpp/src/$name.cpp") -o $object
        if ($LASTEXITCODE -ne 0) { throw "Compiling $name.cpp failed." }
        $objects += $object
    }

    New-Item -ItemType Directory -Path (Split-Path -Parent $Output) -Force | Out-Null
    & wasm-ld --no-entry --export-dynamic --gc-sections --strip-all `
        --initial-memory=4194304 --max-memory=16777216 -z stack-size=131072 `
        @objects -o $Output
    if ($LASTEXITCODE -ne 0) { throw 'Linking the WebAssembly module failed.' }

    $size = (Get-Item $Output).Length
    Write-Host "build-wasm: $Output ($size bytes)" -ForegroundColor Green
}
finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
