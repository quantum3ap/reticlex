#!/usr/bin/env bash
# Builds and verifies the native core on Linux or macOS.
#
#   scripts/build-core.sh [build-dir]
#
# Compiles the library, runs the C++ test suite, regenerates the golden
# geometry fixtures the JavaScript conformance test reads, and rebuilds the
# WebAssembly module when a wasm-capable clang is available.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${1:-$ROOT/build/core}"

echo "==> Configuring"
cmake -S "$ROOT/core" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release

echo "==> Building"
cmake --build "$BUILD_DIR" -j "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

echo "==> Running the core test suite"
"$BUILD_DIR/reticlex_tests"

echo "==> Regenerating golden fixtures"
"$BUILD_DIR/reticlex_fixtures" "$ROOT/frontend/tests/fixtures/geometry-golden.json"

if command -v wasm-ld >/dev/null 2>&1 && clang --print-targets 2>/dev/null | grep -q wasm32; then
  echo "==> Building the WebAssembly module"
  "$ROOT/scripts/build-wasm.sh"
else
  echo "==> Skipping the WebAssembly module (clang with a wasm32 target and wasm-ld are required)"
fi

echo "==> Done. Library: $(ls "$BUILD_DIR"/libreticlex_core.* 2>/dev/null | head -1)"
